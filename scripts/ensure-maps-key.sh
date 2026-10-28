#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"
ENV_FILE="${REPO_ROOT}/.env"
MAPS_KEY_DISPLAY_NAME="Geospatial Console Maps Key"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: Infra config file not found at ${CONFIG_FILE}" >&2
  echo "Copy k8s/config/infra.env.example to k8s/config/infra.env and set PROJECT_ID." >&2
  exit 1
fi

# shellcheck source=../k8s/config/infra.env
source "${CONFIG_FILE}"

: "${PROJECT_ID:?PROJECT_ID must be set in k8s/config/infra.env}"

retry_with_backoff() {
  local max_attempts=5
  local delay=3
  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      echo "Error: Command failed after ${max_attempts} attempts: $*" >&2
      return 1
    fi
    echo "  (Waiting ${delay}s for API propagation before retry $((attempt + 1))/${max_attempts}...)" >&2
    sleep "${delay}"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

# Ensure Maps JS and API Keys APIs are enabled (no-op when already enabled via Config Connector;
# enables them automatically when run standalone for localhost development without GKE).
ENABLED_APIS="$(gcloud services list --enabled \
  --project="${PROJECT_ID}" \
  --filter="config.name:(apikeys.googleapis.com OR maps-backend.googleapis.com)" \
  --format="value(config.name)")"

if ! grep -qx "apikeys.googleapis.com" <<<"${ENABLED_APIS}" || ! grep -qx "maps-backend.googleapis.com" <<<"${ENABLED_APIS}"; then
  echo "==> Enabling maps-backend.googleapis.com and apikeys.googleapis.com on '${PROJECT_ID}'..."
  gcloud services enable \
    maps-backend.googleapis.com \
    apikeys.googleapis.com \
    --project="${PROJECT_ID}"
fi

echo "==> Ensuring Google Maps API key ('${MAPS_KEY_DISPLAY_NAME}') exists in '${PROJECT_ID}'..."
KEY_NAME="$(retry_with_backoff gcloud services api-keys list \
  --project="${PROJECT_ID}" \
  --filter="displayName=\"${MAPS_KEY_DISPLAY_NAME}\"" \
  --format="value(name)" | head -n1)"

if [[ -z "${KEY_NAME}" ]]; then
  echo "==> Creating restricted Maps JavaScript API key..."
  KEY_NAME="$(retry_with_backoff gcloud services api-keys create \
    --project="${PROJECT_ID}" \
    --display-name="${MAPS_KEY_DISPLAY_NAME}" \
    --api-target=service=maps-backend.googleapis.com \
    --format="value(response.name)")"
  if [[ -z "${KEY_NAME}" ]]; then
    KEY_NAME="$(gcloud services api-keys list \
      --project="${PROJECT_ID}" \
      --filter="displayName=\"${MAPS_KEY_DISPLAY_NAME}\"" \
      --format="value(name)" | head -n1)"
  fi
else
  echo "==> Reusing existing API key: ${KEY_NAME}"
fi

if [[ -z "${KEY_NAME}" ]]; then
  echo "Error: Failed to resolve Google Maps API key resource name." >&2
  exit 1
fi

KEY_STRING="$(retry_with_backoff gcloud services api-keys get-key-string "${KEY_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(keyString)")"

if [[ -z "${KEY_STRING}" ]]; then
  echo "Error: Retrieved empty keyString for '${KEY_NAME}'." >&2
  exit 1
fi

umask 077
printf 'GOOGLE_MAPS_API_KEY=%s\n' "${KEY_STRING}" > "${ENV_FILE}"
echo "==> Wrote GOOGLE_MAPS_API_KEY to ${ENV_FILE}"
