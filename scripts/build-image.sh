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

# shellcheck source=../k8s/config/infra.env
source "${CONFIG_FILE}"

: "${PROJECT_ID:?PROJECT_ID must be set in k8s/config/infra.env}"
: "${REGION:?REGION must be set in k8s/config/infra.env}"

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/hso-repo/hso-console:latest"
API_IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/hso-repo/hso-api:latest"
CLOUDBUILD_SA="projects/${PROJECT_ID}/serviceAccounts/hso-cloudbuild-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Retry helper for GCP IAM-to-GCS/Artifact Registry access propagation after fresh SA creation
retry_with_backoff() {
  local max_attempts=5
  local delay=5
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      echo "Error: Build failed after ${max_attempts} attempts." >&2
      return 1
    fi
    echo "  (Waiting ${delay}s for Cloud Build IAM propagation before retry $((attempt + 1))/${max_attempts}...)" >&2
    sleep "${delay}"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

echo "==> Building and pushing '${IMAGE_URI}' via Cloud Build..."
retry_with_backoff gcloud builds submit "${REPO_ROOT}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${CLOUDBUILD_SA}" \
  --default-buckets-behavior=regional-user-owned-bucket \
  --tag="${IMAGE_URI}"

echo "==> Image published: ${IMAGE_URI}"

echo "==> Building and pushing '${API_IMAGE_URI}' (AlloyDB API + ingest) via Cloud Build..."
retry_with_backoff gcloud builds submit "${REPO_ROOT}/api" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${CLOUDBUILD_SA}" \
  --default-buckets-behavior=regional-user-owned-bucket \
  --tag="${API_IMAGE_URI}"

echo "==> Image published: ${API_IMAGE_URI}"
