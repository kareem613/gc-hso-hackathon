#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"
DATASETS_DIR="${REPO_ROOT}/datasets"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy k8s/config/infra.env.example to k8s/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

# shellcheck source=../k8s/config/infra.env
source "${CONFIG_FILE}"

: "${PROJECT_ID:?PROJECT_ID must be set in k8s/config/infra.env}"

shopt -s nullglob
FILES=()
for f in "${DATASETS_DIR}"/*; do
  [[ -f "${f}" ]] && FILES+=("${f}")
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "==> No dataset files found in ${DATASETS_DIR} yet (skipping upload)."
  echo "    Place dataset files in ./datasets/ and re-run ./scripts/upload-datasets.sh."
  exit 0
fi

BUCKET_URI="gs://${PROJECT_ID}-datasets/"

if ! gcloud storage buckets describe "gs://${PROJECT_ID}-datasets" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Error: Bucket 'gs://${PROJECT_ID}-datasets' does not exist yet." >&2
  echo "Run ./scripts/deploy-app.sh first so Config Connector creates the StorageBucket." >&2
  exit 1
fi

echo "==> Uploading ${#FILES[@]} file(s) from datasets/ to ${BUCKET_URI}..."
gcloud storage cp "${FILES[@]}" "${BUCKET_URI}" --project="${PROJECT_ID}"

echo "==> Dataset upload complete: ${BUCKET_URI}"
