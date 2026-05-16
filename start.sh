#!/usr/bin/env bash
# One-command dev stack: Postgres → API (background) → Expo web (foreground).
# From anywhere, run:
#   cd "/path/to/fitness" && bash start.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT"

# Files from zip/WhatsApp often carry quarantine flags → "bad interpreter: Operation not permitted"
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$ROOT/server" "$ROOT/mobile" 2>/dev/null || true
fi

echo "==> Starting Postgres (Docker)"
docker compose up -d
echo "==> Waiting for database…"
sleep 2

echo "==> Freeing port 8000 (if an old API is still running, /api/calories returns 404 — Calorie Log needs the latest server)"
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti :8000 2>/dev/null || true)
  if [[ -n "${PIDS}" ]]; then
    # shellcheck disable=2086
    kill -9 ${PIDS} 2>/dev/null || true
    sleep 1
  fi
fi

venv_python() {
  echo "$ROOT/server/.venv/bin/python3"
}

venv_ok() {
  local py
  py="$(venv_python)"
  [[ -x "$py" ]] && "$py" -c "import sys" 2>/dev/null
}

echo "==> Starting API on http://0.0.0.0:8000 (localhost:8000 from your machine) (background)"
(
  cd "$ROOT/server"
  if ! venv_ok; then
    echo "    Recreating Python venv (old copy from another machine is invalid here)…"
    rm -rf .venv
    python3 -m venv .venv
  fi
  PY="$(venv_python)"
  "$PY" -m pip install -q -r requirements.txt
  if [[ ! -f .env ]]; then cp .env.example .env 2>/dev/null || true; fi
  "$PY" seed.py
  exec "$PY" -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
) &
sleep 3

echo "==> Starting Expo web (open the URL Metro prints; Ctrl+C stops Expo only)"
cd "$ROOT/mobile"
if [[ ! -d node_modules ]] || [[ ! -x node_modules/.bin/expo ]]; then
  npm install
fi
if [[ ! -f .env ]]; then cp .env.example .env 2>/dev/null || true; fi
exec npx expo start --web
