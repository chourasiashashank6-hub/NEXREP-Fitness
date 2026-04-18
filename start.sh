#!/usr/bin/env bash
# One-command dev stack: Postgres → API (background) → Expo web (foreground).
# From anywhere, run:
#   cd "/Users/vishay_11/Desktop/fitness" && bash start.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT"

echo "==> Starting Postgres (Docker)"
docker compose up -d
echo "==> Waiting for database…"
sleep 2

echo "==> Starting API on http://127.0.0.1:8000 (background)"
(
  cd "$ROOT/server"
  if [[ ! -d .venv ]]; then python3 -m venv .venv; fi
  # shellcheck disable=1091
  source .venv/bin/activate
  pip install -q -r requirements.txt
  if [[ ! -f .env ]]; then cp .env.example .env 2>/dev/null || true; fi
  python seed.py
  exec uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
) &
sleep 2

echo "==> Starting Expo web (open the URL Metro prints; Ctrl+C stops Expo only)"
cd "$ROOT/mobile"
if [[ ! -d node_modules ]]; then npm install; fi
if [[ ! -f .env ]]; then cp .env.example .env 2>/dev/null || true; fi
exec npm run web
