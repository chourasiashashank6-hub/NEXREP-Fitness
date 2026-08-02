# NexRep Security

## Completed (Phases 2 & 7)

### Password hashing
- User passwords use **bcrypt** (`passlib[bcrypt]` / `bcrypt`) instead of SHA-256.
- Legacy SHA-256 hashes (64-char hex) are detected on startup via `migrate_sha256_to_bcrypt()` and flagged with `needs_password_reset = true` (passwords are not rehashed).
- Login returns **401** with *"Please reset your password via the forgot-password flow"* when `needs_password_reset` is set.

### JWT
- Startup fails with `RuntimeError("Insecure JWT_SECRET")` if the secret is a known default or shorter than 32 characters.
- Access token expiry default: **60 minutes** (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- Generate a secret: `openssl rand -hex 32`

### CORS
- `allow_origins` is driven by `ALLOWED_ORIGINS` (comma-separated), not `*`.

### Dev endpoints
- `/dev/subscription-toggle` **removed** (was a production risk). Use Razorpay webhooks or admin tools instead.

### API keys
- Groq/Gemini/OpenAI keys belong in **server** `.env` only.
- Mobile food AI and coach features call the FastAPI backend; do not bundle `EXPO_PUBLIC_GROQ_API_KEY`.

### Payments
- Razorpay webhooks verify `X-Razorpay-Signature` with HMAC-SHA256 before processing.
- Subscription state (`subscription_status`, `subscription_expiry`, `razorpay_subscription_id`) is updated server-side; use `is_pro(user_id)` — never client flags.

## Pending / operational

- [ ] Set strong `JWT_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in production (Railway/Render).
- [ ] Restrict `ALLOWED_ORIGINS` to your app and API domains.
- [ ] Run `alembic upgrade head` on deploy instead of relying on `apply_schema_updates()`.
- [ ] App Store / Play Store digital subscriptions may require **Apple IAP / Google Play Billing** (see note in `server/src/routes/payments.py`).
- [ ] Rotate any keys that were ever committed or shared.
- [ ] Enable HTTPS-only and HSTS at the reverse proxy.

## Reporting issues

Report security concerns privately to the project maintainers.
