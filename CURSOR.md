# NexRep — Cursor agent guide

Monorepo:
- `server/` — FastAPI (Python 3.11)
- `mobile/` — Expo React Native (TypeScript)

## Status checklist

- [x] bcrypt migration
- [x] JWT secret check
- [x] CORS locked down
- [x] Dev toggle removed
- [x] Alembic migrations
- [x] Docker setup
- [x] GitHub Actions CI
- [x] EAS build config
- [x] Razorpay webhook verification

## Rules

- Never commit `.env` files.
- Never hardcode secrets or put AI API keys in `mobile/`.
- Never delete existing user data.
- Never use SHA-256 for passwords.
- Never trust client-side subscription flags — use `is_pro()` on the server.
- Prefer `alembic upgrade head` over `apply_schema_updates()` for schema changes.

## Local dev

```bash
docker compose up -d
cd server && pip install -r requirements.txt && uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
cd mobile && npm install && npm start
```

Set `JWT_SECRET` (32+ chars) in `server/.env` before starting the API.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).
