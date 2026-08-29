# NexRep Deployment

## Environment variables (Railway / Render)

Set these on the **API** service (`server/`):

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Postgres connection string from the host |
| `JWT_SECRET` | `openssl rand -hex 32` — required, 32+ chars |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Default `60` |
| `ALLOWED_ORIGINS` | Comma-separated app/API URLs |
| `APP_ENV` | `production` |
| `RAZORPAY_*` | Keys and `RAZORPAY_WEBHOOK_SECRET` when live |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | Server-side AI only |
| `COACH_REDESIGN_ENABLED` | `true` to enable tiered coach cadence views and `/api/coach/*` (default `false`) |
| `DEV_TOGGLE_SECRET` | `openssl rand -hex 32` — required for `/dev/subscription-toggle` when `APP_ENV=development` |

Mobile (EAS / Expo): set `EXPO_PUBLIC_API_URL` to your public API URL in EAS secrets or `mobile/.env.production` at build time. Firebase client keys live in **EAS secrets** (referenced from `eas.json` as `@EXPO_PUBLIC_FIREBASE_*`), not in git.

Never commit real `.env` files.

## Deploy order

1. **Database** — provision Postgres; note `DATABASE_URL`.
2. **Migrations** — from `server/`:
   ```bash
   alembic upgrade head
   ```
3. **API** — deploy container or run:
   ```bash
   uvicorn src.main:app --host 0.0.0.0 --port 8000
   ```

The Docker image runs `alembic upgrade head` before starting uvicorn.

## Docker Compose (local)

From repo root:

```bash
cp server/.env.example server/.env
# Edit server/.env — set JWT_SECRET (32+ chars) and DATABASE_URL if needed

docker compose up -d --build
```

- API: http://localhost:8000/health  
- Postgres: `localhost:5434` (remove host port mapping before production)

## EAS mobile builds

```bash
cd mobile
npm run build:android   # production AAB
npm run build:preview   # internal APK
```

See [mobile/STORE_CHECKLIST.md](mobile/STORE_CHECKLIST.md).
