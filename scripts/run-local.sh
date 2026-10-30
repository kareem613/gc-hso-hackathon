#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOCAL_PORT="${PORT:-8080}"
BIND_HOST="${HOST:-127.0.0.1}"
API_UPSTREAM="${API_ORIGIN:-http://127.0.0.1:3000}"

usage() {
  cat <<EOF
Usage: $0 [options] [port]

Serve the frontend locally from ./src with /.env mounted from the repo root
and /api/* proxied to a local Node API server if running.

Options:
  -p, --port <port>       Local port to listen on (default: 8080, or \$PORT)
  -H, --host <host>       Bind address (default: 127.0.0.1, or \$HOST)
  -a, --api <origin>      Upstream origin for /api/* proxy (default: http://127.0.0.1:3000, or \$API_ORIGIN)
  -h, --help              Show this help message
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
    -a|--api)
      [[ $# -ge 2 ]] || { echo "Error: $1 requires an origin argument." >&2; usage >&2; exit 1; }
      API_UPSTREAM="$2"
      shift 2
      ;;
    --api=*)
      API_UPSTREAM="${1#*=}"
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

echo "==> Serving local console at http://localhost:${LOCAL_PORT} (bind ${BIND_HOST}:${LOCAL_PORT}, /api/* -> ${API_UPSTREAM}, Ctrl+C to stop)..."
exec python3 -u - "${REPO_ROOT}" "${BIND_HOST}" "${LOCAL_PORT}" "${API_UPSTREAM}" <<'PY'
import http.server
import json
import os
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.realpath(sys.argv[1])
HOST = sys.argv[2]
PORT = int(sys.argv[3])
API_UPSTREAM = sys.argv[4].rstrip("/")
SRC_DIR = os.path.realpath(os.path.join(ROOT, "src"))
ENV_FILE = os.path.realpath(os.path.join(ROOT, ".env"))


def safe_join(base_dir: str, rel_path: str) -> str:
    candidate = os.path.realpath(os.path.join(base_dir, rel_path))
    if candidate == base_dir or candidate.startswith(base_dir + os.sep):
        return candidate
    return os.path.join(base_dir, "__forbidden__")


class LocalConsoleHandler(http.server.SimpleHTTPRequestHandler):
    def _proxy_api(self) -> None:
        target_url = f"{API_UPSTREAM}{self.path}"
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else None
        req = urllib.request.Request(target_url, data=body, method=self.command)
        for hdr in ("Content-Type", "Accept"):
            if hdr in self.headers:
                req.add_header(hdr, self.headers[hdr])
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)
        except urllib.error.HTTPError as err:
            payload = err.read()
            self.send_response(err.code)
            self.send_header("Content-Type", err.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except Exception as exc:
            payload = json.dumps({
                "ok": False,
                "error": f"Local API upstream ({API_UPSTREAM}) unavailable: {exc}",
            }).encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/api" or self.path.startswith("/api/"):
            self._proxy_api()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api" or self.path.startswith("/api/"):
            self._proxy_api()
            return
        self.send_error(405)

    def translate_path(self, path: str) -> str:
        raw = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
        clean = raw.lstrip("/")
        if clean == ".env":
            return ENV_FILE
        if clean in ("", "."):
            return os.path.join(SRC_DIR, "index.html")
        return safe_join(SRC_DIR, clean)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ReusableThreadingHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


signal.signal(signal.SIGINT, signal.default_int_handler)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

try:
    with ReusableThreadingHTTPServer((HOST, PORT), LocalConsoleHandler) as httpd:
        httpd.serve_forever()
except OSError as exc:
    print(f"Error: Could not bind to {HOST}:{PORT} ({exc.strerror or exc}). Try --port <port>.", file=sys.stderr)
    sys.exit(1)
except (KeyboardInterrupt, SystemExit):
    print("\n==> Stopped local console.", file=sys.stderr)
    sys.exit(0)
PY
