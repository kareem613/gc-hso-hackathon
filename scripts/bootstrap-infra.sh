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

MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"
MIN_NODES="${MIN_NODES:-1}"
MAX_NODES="${MAX_NODES:-2}"

GKE_NODE_SA_EMAIL="${GKE_NODE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KCC_SA_EMAIL="${KCC_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Retry helper for GCP IAM read-after-write eventual consistency
retry_with_backoff() {
  local max_attempts=6
  local delay=2
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      echo "Error: Command failed after ${max_attempts} attempts: $*" >&2
      return 1
    fi
    echo "  (Waiting ${delay}s for IAM propagation before retry $((attempt + 1))/${max_attempts}...)" >&2
    sleep "${delay}"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

echo "==> [1/6] Enabling bootstrap GCP APIs on project '${PROJECT_ID}'..."
gcloud services enable \
  compute.googleapis.com \
  container.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> [2/6] Checking for any failed '${CLUSTER_NAME}' clusters..."
ERROR_LOCATIONS="$(gcloud container clusters list \
  --project="${PROJECT_ID}" \
  --filter="name=${CLUSTER_NAME} AND status=ERROR" \
  --format="value(location)" 2>/dev/null || true)"

for err_loc in ${ERROR_LOCATIONS}; do
  echo "Warning: Cluster '${CLUSTER_NAME}' in '${err_loc}' is in ERROR state and must be deleted and recreated."
  if [[ "${AUTO_APPROVE}" != "true" ]]; then
    read -r -p "Delete failed cluster '${CLUSTER_NAME}' in '${err_loc}'? [y/N]: " confirm
    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
  gcloud container clusters delete "${CLUSTER_NAME}" \
    --region="${err_loc}" \
    --project="${PROJECT_ID}" \
    --quiet
  if [[ "${err_loc}" != "${REGION}" ]] && gcloud compute networks subnets describe "${SUBNET_NAME}" \
    --region="${err_loc}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud compute networks subnets delete "${SUBNET_NAME}" \
      --region="${err_loc}" \
      --project="${PROJECT_ID}" \
      --quiet
  fi
done

echo "==> [3/6] Ensuring VPC network '${NETWORK_NAME}' and subnet '${SUBNET_NAME}' exist in '${REGION}'..."
if ! gcloud compute networks describe "${NETWORK_NAME}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks create "${NETWORK_NAME}" \
    --project="${PROJECT_ID}" \
    --subnet-mode=custom
fi

if ! gcloud compute networks subnets describe "${SUBNET_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks subnets create "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --network="${NETWORK_NAME}" \
    --region="${REGION}" \
    --range="10.0.0.0/20" \
    --enable-private-ip-google-access
else
  gcloud compute networks subnets update "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --enable-private-ip-google-access
fi

echo "==> [4/6] Ensuring bootstrap Service Accounts ('${GKE_NODE_SA_EMAIL}', '${KCC_SA_EMAIL}') and project IAM bindings exist..."
if ! gcloud iam service-accounts describe "${GKE_NODE_SA_EMAIL}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${GKE_NODE_SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="GKE Least-Privilege Node Service Account"
fi

if ! gcloud iam service-accounts describe "${KCC_SA_EMAIL}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${KCC_SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="Config Connector Controller"
fi

retry_with_backoff gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GKE_NODE_SA_EMAIL}" \
  --role="roles/container.defaultNodeServiceAccount" \
  --condition=None \
  --quiet >/dev/null

for ROLE in \
  roles/editor \
  roles/iam.securityAdmin \
  roles/resourcemanager.projectIamAdmin \
  roles/servicemanagement.admin \
  roles/servicenetworking.networksAdmin; do
  retry_with_backoff gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${KCC_SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "==> [5/6] Ensuring GKE cluster '${CLUSTER_NAME}' exists in '${REGION}' and binding Config Connector Workload Identity..."
CLUSTER_STATUS="$(gcloud container clusters describe "${CLUSTER_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status)" 2>/dev/null || true)"

if [[ -n "${CLUSTER_STATUS}" ]]; then
  echo "Cluster '${CLUSTER_NAME}' already exists (status: ${CLUSTER_STATUS}). Verifying Workload Identity, ConfigConnector, and GcsFuseCsiDriver add-ons..."
  CURRENT_POOL="$(gcloud container clusters describe "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(workloadIdentityConfig.workloadPool)")"
  if [[ "${CURRENT_POOL}" != "${PROJECT_ID}.svc.id.goog" ]]; then
    gcloud container clusters update "${CLUSTER_NAME}" \
      --region="${REGION}" \
      --project="${PROJECT_ID}" \
      --workload-pool="${PROJECT_ID}.svc.id.goog"
  fi
  DNS_ACCESS_ENABLED="$(gcloud container clusters describe "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)")"
  if [[ "${DNS_ACCESS_ENABLED}" != "True" ]]; then
    gcloud container clusters update "${CLUSTER_NAME}" \
      --region="${REGION}" \
      --project="${PROJECT_ID}" \
      --enable-dns-access
  fi
  KCC_ENABLED="$(gcloud container clusters describe "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(addonsConfig.configConnectorConfig.enabled)")"
  GCSFUSE_ENABLED="$(gcloud container clusters describe "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(addonsConfig.gcsFuseCsiDriverConfig.enabled)")"
  if [[ "${KCC_ENABLED}" != "True" || "${GCSFUSE_ENABLED}" != "True" ]]; then
    gcloud container clusters update "${CLUSTER_NAME}" \
      --region="${REGION}" \
      --project="${PROJECT_ID}" \
      --update-addons=ConfigConnector=ENABLED,GcsFuseCsiDriver=ENABLED
  fi
else
  gcloud container clusters create "${CLUSTER_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network="${NETWORK_NAME}" \
    --subnetwork="${SUBNET_NAME}" \
    --service-account="${GKE_NODE_SA_EMAIL}" \
    --machine-type="${MACHINE_TYPE}" \
    --num-nodes="${MIN_NODES}" \
    --enable-autoscaling \
    --min-nodes="${MIN_NODES}" \
    --max-nodes="${MAX_NODES}" \
    --enable-private-nodes \
    --enable-dns-access \
    --shielded-secure-boot \
    --shielded-integrity-monitoring \
    --workload-pool="${PROJECT_ID}.svc.id.goog" \
    --addons=HttpLoadBalancing,HorizontalPodAutoscaling,ConfigConnector,GcsFuseCsiDriver \
    --logging=SYSTEM \
    --monitoring=SYSTEM \
    --enable-ip-alias
fi

retry_with_backoff gcloud iam service-accounts add-iam-policy-binding "${KCC_SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[cnrm-system/cnrm-controller-manager]" \
  --role="roles/iam.workloadIdentityUser" \
  --condition=None \
  --quiet >/dev/null

echo "==> [6/6] Configuring kubectl and applying ConfigConnector cluster resource..."
CLOUDSDK_CONTAINER_USE_APPLICATION_DEFAULT_CREDENTIALS=false \
  gcloud container clusters get-credentials "${CLUSTER_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --dns-endpoint

kubectl apply -f - <<EOF
apiVersion: core.cnrm.cloud.google.com/v1beta1
kind: ConfigConnector
metadata:
  name: configconnector.core.cnrm.cloud.google.com
spec:
  mode: cluster
  googleServiceAccount: "${KCC_SA_EMAIL}"
EOF

echo "==> Waiting for Config Connector controller pod to be created and become ready..."
for _ in {1..30}; do
  if kubectl get pod -n cnrm-system -l cnrm.cloud.google.com/component=cnrm-controller-manager 2>/dev/null | grep -q cnrm-controller-manager; then
    break
  fi
  sleep 2
done

kubectl wait -n cnrm-system \
  --for=condition=Ready pod \
  -l cnrm.cloud.google.com/component=cnrm-controller-manager \
  --timeout=180s

echo "==> Bootstrap complete! Config Connector is ready in cluster '${CLUSTER_NAME}'."
