#!/usr/bin/env bash
set -euo pipefail

# Loads the raw dataset files from the GCS FUSE mount into AlloyDB by running
# the one-shot 'hso-ingest' Kubernetes Job (API image + AlloyDB Auth Proxy
# sidecar, authenticated via Workload Identity / IAM database auth).
#
# Idempotent: the Job truncates and reloads every dataset table, and this
# script deletes any previous Job before creating a new one.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy k8s/config/infra.env.example to k8s/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

# shellcheck source=../k8s/config/infra.env
source "${CONFIG_FILE}"
: "${PROJECT_ID:?PROJECT_ID must be set in k8s/config/infra.env}"

if ! kubectl get configmap hso-alloydb-config >/dev/null 2>&1; then
  echo "Error: ConfigMap 'hso-alloydb-config' not found. Run ./scripts/deploy-app.sh first." >&2
  exit 1
fi

if ! gcloud storage ls "gs://${PROJECT_ID}-datasets/" --project="${PROJECT_ID}" 2>/dev/null | grep -q .; then
  echo "Error: Bucket 'gs://${PROJECT_ID}-datasets' is empty. Run ./scripts/upload-datasets.sh first." >&2
  exit 1
fi

echo "==> Waiting for AlloyDB primary instance 'hso-primary' to be Ready..."
kubectl wait --for=condition=Ready \
  alloydbinstance.alloydb.cnrm.cloud.google.com/hso-primary \
  --timeout=600s
kubectl wait --for=condition=Ready \
  alloydbuser.alloydb.cnrm.cloud.google.com/hso-app-iam-user \
  --timeout=300s

echo "==> Removing any previous 'hso-ingest' Job..."
kubectl delete job hso-ingest --ignore-not-found=true --wait=true

echo "==> Creating 'hso-ingest' Job (k8s/app/ingest)..."
kubectl apply -k "${REPO_ROOT}/k8s/app/ingest"

echo "==> Waiting for ingest pod to start..."
for _ in {1..60}; do
  POD="$(kubectl get pods -l job-name=hso-ingest -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD}" ]]; then
    PHASE="$(kubectl get pod "${POD}" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "${PHASE}" != "Pending" ]]; then
      break
    fi
  fi
  sleep 3
done

if [[ -n "${POD:-}" ]]; then
  echo "==> Streaming ingest logs from pod '${POD}'..."
  kubectl logs -f "${POD}" -c hso-ingest 2>/dev/null || true
fi

echo "==> Waiting for Job 'hso-ingest' to complete..."
if ! kubectl wait --for=condition=complete job/hso-ingest --timeout=600s; then
  echo "Error: Ingest Job did not complete successfully. Diagnostics:" >&2
  kubectl describe job hso-ingest >&2 || true
  [[ -n "${POD:-}" ]] && kubectl logs "${POD}" --all-containers=true --tail=100 >&2 || true
  exit 1
fi

echo "==> Verifying row counts via the API..."
APP_POD="$(kubectl get pods -l app=hso-console --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "${APP_POD}" ]]; then
  kubectl exec "${APP_POD}" -c hso-api -- node -e '
    fetch("http://127.0.0.1:8080/api/datasets").then(r => r.json()).then(j => {
      for (const d of j.datasets) console.log(`    ${d.dataset.padEnd(16)} ${String(d.row_count).padStart(7)} rows  (${d.source_file}, ${d.loaded_at})`);
    }).catch(e => { console.error("    (could not query /api/datasets:", e.message, ")"); });
  ' || true
fi

echo "==> Dataset ingest into AlloyDB complete."
