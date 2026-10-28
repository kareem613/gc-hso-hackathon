#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${1:-${PORT:-8080}}"

if [[ ! "${LOCAL_PORT}" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [local_port]" >&2
  exit 1
fi

if ! kubectl get svc/hso-console >/dev/null 2>&1; then
  echo "Error: Service 'hso-console' not found in the current Kubernetes context." >&2
  echo "Run ./scripts/deploy-app.sh first." >&2
  exit 1
fi

echo "==> Forwarding http://localhost:${LOCAL_PORT} -> svc/hso-console:80 (Ctrl+C to stop)..."
exec kubectl port-forward svc/hso-console "${LOCAL_PORT}:80"
