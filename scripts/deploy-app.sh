#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
CONFIG_FILE="${REPO_ROOT}/manifests/config/infra.env"
NAMESPACE="hso-hackathon"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: App .env file not found at ${ENV_FILE}" >&2
  echo "Run ./scripts/apply-core-infra.sh (or ./scripts/ensure-maps-key.sh) first to generate .env." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy manifests/config/infra.env.example to manifests/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

echo "==> Ensuring namespace '${NAMESPACE}' exists..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying Secret 'hso-env-secret' from .env in namespace '${NAMESPACE}'..."
kubectl create secret generic hso-env-secret \
  -n "${NAMESPACE}" \
  --from-env-file="${ENV_FILE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying app, GCS bucket, Workload Identity, and GCS FUSE PV (manifests/hso-hackathon)..."
kubectl apply -k "${REPO_ROOT}/manifests/hso-hackathon"

echo "==> Waiting for StorageBucket 'hso-datasets-bucket' to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  storagebucket.storage.cnrm.cloud.google.com/hso-datasets-bucket \
  --timeout=180s

echo "==> Waiting for Workload Identity & IAM bindings to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  iamserviceaccount.iam.cnrm.cloud.google.com/hso-app-gsa \
  --timeout=180s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-wi-binding \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-bucket-viewer \
  --timeout=180s

echo "==> Waiting for AlloyDB IAM bindings and AlloyDBUser 'hso-app-iam-user' to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-alloydb-client \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-alloydb-db-user \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-serviceusage-consumer \
  --timeout=180s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  alloydbuser.alloydb.cnrm.cloud.google.com/hso-app-iam-user \
  --timeout=600s

echo "==> Restarting and waiting for Deployment 'hso-console' rollout to complete..."
kubectl rollout restart -n "${NAMESPACE}" deployment/hso-console
kubectl rollout status -n "${NAMESPACE}" deployment/hso-console --timeout=300s

echo "==> App deployment is Ready. Next steps:"
echo "    ./scripts/upload-datasets.sh   # upload raw files to GCS"
echo "    ./scripts/ingest-datasets.sh   # load them into AlloyDB"
echo "    ./scripts/port-forward.sh"
