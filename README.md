# Calm Fitness App

Full-stack fitness application:

- **React Native (Expo + TypeScript)** — `mobile/`
- **FastAPI backend** — `server/`
- **PostgreSQL** — `docker-compose.yml`
- **JWT authentication** (+ optional Firebase sign-in)

## Repository structure

```text
fitness/
  mobile/              ← Expo React Native app
  server/              ← FastAPI backend
  docker-compose.yml   ← Local PostgreSQL
  .env.example         ← All env vars (copy into server/.env and mobile/.env)
  README.md
  .github/
    CODEOWNERS
    branch-protection.md
```

Per-app env templates also live at `server/.env.example` and `mobile/.env.example`.

## Collaboration

- Single Git repository (no nested `mobile/.git`).
- Branch from `main`, open PRs, require review before merge — see [.github/branch-protection.md](.github/branch-protection.md).
- Never commit `.env` files; use [.env.example](.env.example) as reference.

## 1) Start PostgreSQL

From repository root:

```bash
docker compose up -d
```

## 2) Run backend

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — set JWT_SECRET, DATABASE_URL, API keys as needed
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

If the **Calories** tab shows “Not Found” for `/api/calories`, an old API process may still be on port **8000**. Restart:

```bash
lsof -ti :8000 | xargs kill -9
cd server && source .venv/bin/activate && uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

From the repo root, `bash start.sh` also frees port 8000 before starting the API.

Seed demo data (optional):

```bash
cd server
source .venv/bin/activate
python seed.py
```

Demo credentials after seed:

- Email: `demo@fit.com`
- Password: `demo1234`

## 3) Run mobile app

```bash
cd mobile
npm install
cp .env.example .env
npm run ios
```

Android or Expo web:

```bash
npm run android
npm run web
```

### Food photo recognition

Groq/Gemini keys belong in **`server/.env`** only. The app calls `POST /api/calories/foods/analyze-image` on your API.

### Physical device / LAN testing

Set in `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:8000
```

Android emulator: `http://10.0.2.2:8000`

## Mobile layout

- `src/components`, `src/screens`, `src/api`, `src/store`, `src/theme`, `src/utils`

## Server layout

- `src/core`, `src/db`, `src/models`, `src/schemas`, `src/services`, `src/utils`, `src/routes`

## Features

- Authentication: login/signup, JWT persistence, Firebase optional
- Home dashboard, workouts, calorie tracking, AI coach
- Profile, subscriptions (Razorpay hooks), admin analytics

## API endpoints (sample)

- `POST /signup`, `POST /login`
- `GET /summary`, `POST /workout`, `GET /workout/history`
- `GET /calories`, `POST /api/calories/*`
- `GET /profile`, `PUT /profile`
- `POST /ai/chat`, admin routes under `/api/admin`

Interactive docs: `http://127.0.0.1:8000/docs`
