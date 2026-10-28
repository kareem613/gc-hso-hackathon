#!/usr/bin/env bash
set -euo pipefail

AUTO_APPROVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_APPROVE=true
      shift
      ;;
    *)
      echo "Usage: $0 [-y|--yes]" >&2
      exit 1
      ;;
  esac
done

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
: "${REGION:?REGION must be set in k8s/config/infra.env}"
: "${NETWORK_NAME:?NETWORK_NAME must be set in k8s/config/infra.env}"
: "${SUBNET_NAME:?SUBNET_NAME must be set in k8s/config/infra.env}"
: "${CLUSTER_NAME:?CLUSTER_NAME must be set in k8s/config/infra.env}"
: "${GKE_NODE_SA_NAME:?GKE_NODE_SA_NAME must be set in k8s/config/infra.env}"
: "${KCC_SA_NAME:?KCC_SA_NAME must be set in k8s/config/infra.env}"

GKE_NODE_SA_EMAIL="${GKE_NODE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KCC_SA_EMAIL="${KCC_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "This will tear down the HSO deployment and infrastructure in project '${PROJECT_ID}' (${REGION}):"
echo "  - App & GCS bucket via Config Connector (k8s/app/overlays/gcp)"
echo "  - Core GCP infra via Config Connector (k8s/infra/gcp)"
echo "  - GKE cluster '${CLUSTER_NAME}'"
echo "  - Bootstrap Service Accounts '${KCC_SA_EMAIL}' and '${GKE_NODE_SA_EMAIL}'"
echo "  - VPC subnet '${SUBNET_NAME}' and network '${NETWORK_NAME}'"

if [[ "${AUTO_APPROVE}" != "true" ]]; then
  read -r -p "Proceed with teardown? [y/N]: " confirm
  if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

CLUSTER_STATUS="$(gcloud container clusters describe "${CLUSTER_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status)" 2>/dev/null || true)"

if [[ "${CLUSTER_STATUS}" == "RUNNING" || "${CLUSTER_STATUS}" == "RECONCILING" || "${CLUSTER_STATUS}" == "DEGRADED" ]]; then
  echo "==> Configuring kubectl credentials for '${CLUSTER_NAME}'..."
  CLOUDSDK_CONTAINER_USE_APPLICATION_DEFAULT_CREDENTIALS=false \
    gcloud container clusters get-credentials "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --dns-endpoint

  echo "==> [1/4] Removing app resources & StorageBucket via Config Connector (k8s/app/overlays/gcp)..."
  # Unmount GCS FUSE workload first, then remove child IAMPolicyMembers before parent StorageBucket/IAMServiceAccount.
  kubectl delete \
    deployment/hso-console \
    service/hso-console \
    pvc/datasets-pvc \
    pv/datasets-pv \
    secret/hso-env-secret \
    --ignore-not-found=true \
    --wait=true

  kubectl delete iampolicymember.iam.cnrm.cloud.google.com \
    hso-app-bucket-viewer \
    hso-app-wi-binding \
    --ignore-not-found=true \
    --wait=true

  kubectl delete -k "${REPO_ROOT}/k8s/app/overlays/gcp" \
    --ignore-not-found=true \
    --wait=true

  echo "==> [2/4] Removing core GCP infrastructure via Config Connector (k8s/infra/gcp)..."
  # Remove child IAMPolicyMembers before parent IAMServiceAccount and ArtifactRegistryRepository.
  kubectl delete iampolicymember.iam.cnrm.cloud.google.com \
    hso-cloudbuild-logs \
    hso-cloudbuild-storage \
    hso-cloudbuild-ar-writer \
    hso-node-ar-reader \
    --ignore-not-found=true \
    --wait=true

  kubectl delete -k "${REPO_ROOT}/k8s/infra/gcp" \
    --ignore-not-found=true \
    --wait=true
else
  echo "==> [1/4 & 2/4] Cluster '${CLUSTER_NAME}' is not running (status: '${CLUSTER_STATUS:-NOT_FOUND}'); skipping in-cluster Config Connector deletion."
fi

echo "==> [3/4] Deleting bootstrap GKE cluster '${CLUSTER_NAME}' and bootstrap Service Accounts..."
if [[ -n "${CLUSTER_STATUS}" ]]; then
  gcloud container clusters delete "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --quiet
else
  echo "Cluster '${CLUSTER_NAME}' not found; skipping."
fi

for ROLE in \
  roles/editor \
  roles/iam.securityAdmin \
  roles/resourcemanager.projectIamAdmin \
  roles/servicemanagement.admin; do
  gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${KCC_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null 2>&1 || true
done

if gcloud iam service-accounts describe "${KCC_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts delete "${KCC_SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --quiet
fi

gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GKE_NODE_SA_EMAIL}" \
  --role="roles/container.defaultNodeServiceAccount" \
  --condition=None \
  --quiet >/dev/null 2>&1 || true

if gcloud iam service-accounts describe "${GKE_NODE_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts delete "${GKE_NODE_SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --quiet
fi

echo "==> [4/4] Deleting bootstrap VPC subnet '${SUBNET_NAME}' and network '${NETWORK_NAME}'..."
if gcloud compute networks subnets describe "${SUBNET_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks subnets delete "${SUBNET_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --quiet
else
  echo "Subnet '${SUBNET_NAME}' not found; skipping."
fi

if gcloud compute networks describe "${NETWORK_NAME}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks delete "${NETWORK_NAME}" \
    --project="${PROJECT_ID}" \
    --quiet
else
  echo "Network '${NETWORK_NAME}' not found; skipping."
fi

echo "==> Teardown complete!"
