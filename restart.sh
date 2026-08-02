#!/usr/bin/env bash
# Safe restart: stop Expo web + API on common ports, ensure Docker Postgres is up, then start full stack.
# Run from repo root: bash restart.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT"

echo "==> Freeing dev ports (ignore errors if nothing was listening)"
if command -v lsof >/dev/null 2>&1; then
  for p in 8000 8081; do
    PIDS=$(lsof -ti ":$p" 2>/dev/null || true)
    if [[ -n "${PIDS}" ]]; then
      # shellcheck disable=2086
      kill -9 ${PIDS} 2>/dev/null || true
    fi
  done
fi
sleep 1

echo "==> Ensuring Postgres (Docker)"
docker compose up -d
sleep 2

exec bash "$ROOT/start.sh"
