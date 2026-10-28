#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${PORT:-8090}"

usage() {
  cat <<EOF
Usage: $0 [options] [local_port]

Forward a local port to the GKE svc/hso-console Kubernetes service.

Options:
  -p, --port <port>   Local port to forward from (default: 8090, or \$PORT)
  -h, --help          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      [[ $# -ge 2 ]] || { echo "Error: $1 requires a port argument." >&2; usage >&2; exit 1; }
      LOCAL_PORT="$2"
      shift 2
      ;;
    --port=*)
      LOCAL_PORT="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Error: Unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
    *)
      LOCAL_PORT="$1"
      shift
      ;;
  esac
done

if [[ ! "${LOCAL_PORT}" =~ ^[0-9]+$ ]] || (( LOCAL_PORT < 1 || LOCAL_PORT > 65535 )); then
  echo "Error: Invalid port '${LOCAL_PORT}' (must be 1-65535)." >&2
  usage >&2
  exit 1
fi

if ! kubectl get svc/hso-console >/dev/null 2>&1; then
  echo "Error: Service 'hso-console' not found in the current Kubernetes context." >&2
  echo "Run ./scripts/deploy-app.sh first." >&2
  exit 1
fi

echo "==> Forwarding http://localhost:${LOCAL_PORT} -> svc/hso-console:80 (Ctrl+C to stop)..."
exec kubectl port-forward svc/hso-console "${LOCAL_PORT}:80"
