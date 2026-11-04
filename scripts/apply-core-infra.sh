#!/usr/bin/env bash
set -euo pipefail

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

echo "==> Ensuring namespace '${NAMESPACE}' exists..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying core GCP infrastructure manifests (manifests/infra)..."
kubectl apply -k "${REPO_ROOT}/manifests/infra"

echo "==> Waiting for GCP APIs to become Ready via Config Connector..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  service.serviceusage.cnrm.cloud.google.com \
  --all \
  --timeout=180s

echo "==> Waiting for ArtifactRegistryRepository 'hso-repo' to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  artifactregistryrepository.artifactregistry.cnrm.cloud.google.com/hso-repo \
  --timeout=180s

echo "==> Waiting for Cloud Build & GKE Node IAM bindings to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  iamserviceaccount.iam.cnrm.cloud.google.com/hso-cloudbuild-sa \
  --timeout=180s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-logs \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-storage \
  iampolicymember.iam.cnrm.cloud.google.com/hso-cloudbuild-ar-writer \
  iampolicymember.iam.cnrm.cloud.google.com/hso-node-ar-reader \
  --timeout=180s

echo "==> Waiting for Private Services Access peering (ComputeAddress + ServiceNetworkingConnection) to become Ready..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  computeaddress.compute.cnrm.cloud.google.com/hso-alloydb-psa-range \
  --timeout=300s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  servicenetworkingconnection.servicenetworking.cnrm.cloud.google.com/hso-alloydb-psa-connection \
  --timeout=600s

echo "==> Waiting for AlloyDB cluster 'hso-alloydb' and primary instance 'hso-primary' to become Ready (first-time provisioning takes ~10-15 min)..."
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  alloydbcluster.alloydb.cnrm.cloud.google.com/hso-alloydb \
  --timeout=1200s
kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
  alloydbinstance.alloydb.cnrm.cloud.google.com/hso-primary \
  --timeout=1800s

ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
if [[ -n "${ACTIVE_ACCOUNT}" && "${ACTIVE_ACCOUNT}" != "(unset)" ]]; then
  OPERATOR_DB_USER="${ACTIVE_ACCOUNT%.gserviceaccount.com}"
  echo "==> Registering active gcloud user '${OPERATOR_DB_USER}' as an AlloyDB Studio IAM user..."
  kubectl apply -n "${NAMESPACE}" -f - <<EOF
apiVersion: alloydb.cnrm.cloud.google.com/v1beta1
kind: AlloyDBUser
metadata:
  name: hso-operator-iam-user
  namespace: ${NAMESPACE}
  annotations:
    cnrm.cloud.google.com/project-id: ${PROJECT_ID}
spec:
  resourceID: ${OPERATOR_DB_USER}
  userType: ALLOYDB_IAM_USER
  databaseRoles:
    - alloydbiamuser
    - alloydbsuperuser
  clusterRef:
    name: hso-alloydb
EOF
  kubectl wait -n "${NAMESPACE}" --for=condition=Ready \
    alloydbuser.alloydb.cnrm.cloud.google.com/hso-operator-iam-user \
    --timeout=300s
fi

echo "==> Provisioning Google Maps API key and local .env..."
"${SCRIPT_DIR}/ensure-maps-key.sh"

echo "==> Core GCP infrastructure is Ready."
