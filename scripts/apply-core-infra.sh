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

echo "==> Waiting for Private Services Access peering (ComputeAddress + ServiceNetworkingConnection) to become Ready..."
kubectl wait --for=condition=Ready \
  computeaddress.compute.cnrm.cloud.google.com/hso-alloydb-psa-range \
  --timeout=300s
kubectl wait --for=condition=Ready \
  servicenetworkingconnection.servicenetworking.cnrm.cloud.google.com/hso-alloydb-psa-connection \
  --timeout=600s

echo "==> Waiting for AlloyDB cluster 'hso-alloydb' and primary instance 'hso-primary' to become Ready (first-time provisioning takes ~10-15 min)..."
kubectl wait --for=condition=Ready \
  alloydbcluster.alloydb.cnrm.cloud.google.com/hso-alloydb \
  --timeout=1200s
kubectl wait --for=condition=Ready \
  alloydbinstance.alloydb.cnrm.cloud.google.com/hso-primary \
  --timeout=1800s
kubectl wait --for=condition=Ready \
  alloydbuser.alloydb.cnrm.cloud.google.com/hso-app-iam-user \
  --timeout=600s

echo "==> Provisioning Google Maps API key and local .env..."
"${SCRIPT_DIR}/ensure-maps-key.sh"

echo "==> Core GCP infrastructure is Ready."
