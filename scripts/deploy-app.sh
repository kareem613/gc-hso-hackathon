#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: App .env file not found at ${ENV_FILE}" >&2
  echo "Run ./scripts/apply-core-infra.sh (or ./scripts/ensure-maps-key.sh) first to generate .env." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy k8s/config/infra.env.example to k8s/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

echo "==> Applying Secret 'hso-env-secret' from .env..."
kubectl create secret generic hso-env-secret \
  --from-env-file="${ENV_FILE}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying app, GCS bucket, Workload Identity, and GCS FUSE PV (k8s/app/overlays/gcp)..."
kubectl apply -k "${REPO_ROOT}/k8s/app/overlays/gcp"

echo "==> Waiting for StorageBucket 'hso-datasets-bucket' to become Ready..."
kubectl wait --for=condition=Ready \
  storagebucket.storage.cnrm.cloud.google.com/hso-datasets-bucket \
  --timeout=180s

echo "==> Waiting for Workload Identity & IAM bindings to become Ready..."
kubectl wait --for=condition=Ready \
  iamserviceaccount.iam.cnrm.cloud.google.com/hso-app-gsa \
  --timeout=180s
kubectl wait --for=condition=Ready \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-wi-binding \
  iampolicymember.iam.cnrm.cloud.google.com/hso-app-bucket-viewer \
  --timeout=180s

echo "==> Restarting and waiting for Deployment 'hso-console' rollout to complete..."
kubectl rollout restart deployment/hso-console
kubectl rollout status deployment/hso-console --timeout=180s

echo "==> App deployment is Ready. Test locally with:"
echo "    ./scripts/port-forward.sh"
