#!/usr/bin/env bash
set -euo pipefail

# Runs the one-shot 'hso-ingest' Kubernetes Job (api/ingest.js + AlloyDB Auth
# Proxy sidecar, authenticated via Workload Identity / IAM database auth) to
# apply api/schema.sql and ingest dataset files from the GCS FUSE mount into
# AlloyDB.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/manifests/config/infra.env"
NAMESPACE="hso-hackathon"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy manifests/config/infra.env.example to manifests/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

# shellcheck source=../manifests/config/infra.env
source "${CONFIG_FILE}"
: "${PROJECT_ID:?PROJECT_ID must be set in manifests/config/infra.env}"

if ! kubectl get -n "${NAMESPACE}" configmap hso-alloydb-config >/dev/null 2>&1; then
  echo "Error: ConfigMap 'hso-alloydb-config' not found in namespace '${NAMESPACE}'. Run ./scripts/deploy-app.sh first." >&2
  exit 1
fi

if ! gcloud storage ls "gs://${PROJECT_ID}-datasets/" --project="${PROJECT_ID}" 2>/dev/null | grep -q .; then
  echo "==> Note: Bucket 'gs://${PROJECT_ID}-datasets/' currently has no dataset files."
  echo "    Running 'hso-ingest' Job to apply api/schema.sql and verify AlloyDB connectivity..."
fi

echo "==> Waiting for AlloyDB primary instance 'hso-primary' to be Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  alloydbinstance.alloydb.cnrm.cloud.google.com/hso-primary \
  --timeout=600s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  alloydbuser.alloydb.cnrm.cloud.google.com/hso-app-iam-user \
  --timeout=300s

echo "==> Removing any previous 'hso-ingest' Job..."
kubectl delete -n "${NAMESPACE}" job hso-ingest --ignore-not-found=true --wait=true

echo "==> Creating 'hso-ingest' Job (manifests/ingest)..."
kubectl apply -k "${REPO_ROOT}/manifests/ingest"

echo "==> Waiting for ingest pod to start..."
for _ in {1..60}; do
  POD="$(kubectl get -n "${NAMESPACE}" pods -l job-name=hso-ingest -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD}" ]]; then
    PHASE="$(kubectl get -n "${NAMESPACE}" pod "${POD}" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "${PHASE}" != "Pending" ]]; then
      break
    fi
  fi
  sleep 3
done

if [[ -n "${POD:-}" ]]; then
  echo "==> Streaming ingest logs from pod '${POD}'..."
  kubectl logs -n "${NAMESPACE}" -f "${POD}" -c hso-ingest 2>/dev/null || true
fi

echo "==> Waiting for Job 'hso-ingest' to complete..."
if ! kubectl wait -n "${NAMESPACE}" --for=condition=complete job/hso-ingest --timeout=600s; then
  echo "Error: Ingest Job did not complete successfully. Diagnostics:" >&2
  kubectl describe -n "${NAMESPACE}" job hso-ingest >&2 || true
  [[ -n "${POD:-}" ]] && kubectl logs -n "${NAMESPACE}" "${POD}" --all-containers=true --tail=100 >&2 || true
  exit 1
fi

echo "==> Verifying API -> AlloyDB health check..."
APP_POD="$(kubectl get -n "${NAMESPACE}" pods -l app=hso-console --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "${APP_POD}" ]]; then
  kubectl exec -n "${NAMESPACE}" "${APP_POD}" -c hso-api -- node -e '
    fetch("http://127.0.0.1:8080/api/health").then(r => r.json()).then(j => {
      console.log("    /api/health:", JSON.stringify(j));
    }).catch(e => { console.error("    (could not query /api/health:", e.message, ")"); });
  ' || true
fi

echo "==> AlloyDB ingest job complete."
