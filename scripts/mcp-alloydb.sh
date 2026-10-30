#!/usr/bin/env bash
set -euo pipefail

# Stdio MCP server wrapper for AlloyDB (via MCP Toolbox for Databases).
# Forwards a local ephemeral port to the alloydb-auth-proxy sidecar in
# deploy/hso-console and runs `@toolbox-sdk/server --prebuilt postgres --stdio`.
# All non-protocol output is redirected to stderr so stdout stays pure JSON-RPC.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/k8s/config/infra.env"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Error: ${CONFIG_FILE} not found. Configure PROJECT_ID first." >&2
  exit 1
fi

# shellcheck source=../k8s/config/infra.env
source "${CONFIG_FILE}"

: "${PROJECT_ID:?PROJECT_ID must be set in k8s/config/infra.env}"
: "${REGION:?REGION must be set in k8s/config/infra.env}"
: "${CLUSTER_NAME:?CLUSTER_NAME must be set in k8s/config/infra.env}"

KUBE_CONTEXT="gke_${PROJECT_ID}_${REGION}_${CLUSTER_NAME}"

LOCAL_PORT="$(python3 -c '
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
')"

kubectl --context="${KUBE_CONTEXT}" port-forward deploy/hso-console "${LOCAL_PORT}:5432" >/dev/null 2>&1 &
PF_PID=$!

cleanup() {
  kill "${PF_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python3 - "${LOCAL_PORT}" <<'PY' >&2
import socket, sys, time
port = int(sys.argv[1])
for _ in range(50):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            sys.exit(0)
    except OSError:
        time.sleep(0.1)
print(f"Error: Timed out waiting for kubectl port-forward on 127.0.0.1:{port}", file=sys.stderr)
sys.exit(1)
PY

export POSTGRES_HOST="127.0.0.1"
export POSTGRES_PORT="${LOCAL_PORT}"
export POSTGRES_DATABASE="postgres"
export POSTGRES_USER="hso-app-gsa@${PROJECT_ID}.iam"
export POSTGRES_PASSWORD="unused"

npx -y @toolbox-sdk/server --prebuilt postgres --stdio
