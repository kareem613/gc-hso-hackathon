#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOCAL_PORT="${PORT:-8080}"
BIND_HOST="${HOST:-127.0.0.1}"

usage() {
  cat <<EOF
Usage: $0 [options] [port]

Serve the frontend locally from ./src with /.env and /datasets mounted from the repo root.

Options:
  -p, --port <port>   Local port to listen on (default: 8080, or \$PORT)
  -H, --host <host>   Bind address (default: 127.0.0.1, or \$HOST)
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
    -H|--host)
      [[ $# -ge 2 ]] || { echo "Error: $1 requires a host argument." >&2; usage >&2; exit 1; }
      BIND_HOST="$2"
      shift 2
      ;;
    --host=*)
      BIND_HOST="${1#*=}"
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

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  if [[ -f "${REPO_ROOT}/k8s/config/infra.env" ]]; then
    echo "==> .env not found; provisioning Google Maps API key via ensure-maps-key.sh..."
    "${SCRIPT_DIR}/ensure-maps-key.sh"
  else
    echo "Warning: ${REPO_ROOT}/.env not found (configure k8s/config/infra.env and run ./scripts/ensure-maps-key.sh to provision a Maps API key)." >&2
  fi
fi

echo "==> Serving local console at http://localhost:${LOCAL_PORT} (bind ${BIND_HOST}:${LOCAL_PORT}, Ctrl+C to stop)..."
exec python3 -u - "${REPO_ROOT}" "${BIND_HOST}" "${LOCAL_PORT}" <<'PY'
import http.server
import os
import sys
import urllib.parse

ROOT = os.path.realpath(sys.argv[1])
HOST = sys.argv[2]
PORT = int(sys.argv[3])
SRC_DIR = os.path.realpath(os.path.join(ROOT, "src"))
DATASETS_DIR = os.path.realpath(os.path.join(ROOT, "datasets"))
ENV_FILE = os.path.realpath(os.path.join(ROOT, ".env"))


def safe_join(base_dir: str, rel_path: str) -> str:
    candidate = os.path.realpath(os.path.join(base_dir, rel_path))
    if candidate == base_dir or candidate.startswith(base_dir + os.sep):
        return candidate
    return os.path.join(base_dir, "__forbidden__")


class LocalConsoleHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        raw = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
        clean = raw.lstrip("/")
        if clean == ".env":
            return ENV_FILE
        if clean == "datasets" or clean.startswith("datasets/"):
            rel = clean[len("datasets"):].lstrip("/")
            return safe_join(DATASETS_DIR, rel)
        if clean in ("", "."):
            return os.path.join(SRC_DIR, "index.html")
        return safe_join(SRC_DIR, clean)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ReusableThreadingHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


ReusableThreadingHTTPServer((HOST, PORT), LocalConsoleHandler).serve_forever()
PY
