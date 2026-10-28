#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy k8s/config/infra.env.example to k8s/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

echo "==> Applying core GCP infrastructure manifests (k8s/infra/gcp)..."
kubectl apply -k "${REPO_ROOT}/k8s/infra/gcp"

echo "==> Waiting for GCP APIs to become Ready via Config Connector..."
kubectl wait --for=condition=Ready \
  service.serviceusage.cnrm.cloud.google.com \
  --all \
  --timeout=180s

echo "==> Waiting for ArtifactRegistryRepository 'hso-repo' to become Ready..."
kubectl wait --for=condition=Ready \
  artifactregistryrepository.artifactregistry.cnrm.cloud.google.com/hso-repo \
  --timeout=180s

echo "==> Waiting for Cloud Build & GKE Node IAM bindings to become Ready..."
kubectl wait --for=condition=Ready \
  iamserviceaccount.iam.cnrm.cloud.google.com/hso-cloudbuild-sa \
  --timeout=180s
kubectl wait --for=condition=Ready \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-logs \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-storage \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-ar-writer \
  iampolicymember.iam.cnrm.cloud.google.com/hso-node-ar-reader \
  --timeout=180s

echo "==> Core GCP infrastructure is Ready."
