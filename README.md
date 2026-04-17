# Calm Fitness App

Full-stack local fitness application with:

- React Native (Expo + TypeScript) mobile frontend
- FastAPI backend
- PostgreSQL database
- JWT authentication

## Project Structure

- `mobile/` React Native app with modular architecture:
  - `src/components`
  - `src/screens`
  - `src/api`
  - `src/store`
  - `src/theme`
  - `src/utils`
- `server/` FastAPI backend:
  - `src/core`, `src/db`, `src/models`, `src/schemas`, `src/services`, `src/utils`

## 1) Start PostgreSQL

From repository root:

```bash
docker compose up -d
```

## 2) Run Backend

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload
```

Seed demo data (optional, in another terminal):

```bash
cd server
source .venv/bin/activate
python seed.py
```

Demo credentials after seed:

- Email: `demo@fit.com`
- Password: `demo1234`

## 3) Run Mobile App

```bash
cd mobile
npm install
cp .env.example .env
npm run ios
```

For Android or Expo web:

```bash
npm run android
npm run web
```

If testing on a physical device, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to your machine's LAN IP:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:8000
```

## Implemented Features

- Authentication: Login/Signup + JWT token persistence
- Home dashboard: Summary cards, add meal/exercise activity, timeline
- Workout tracker: Add workouts + history view
- Calorie tracker: Meal logging + progress bar + optional macros
- AI coach chat: Chat UI + backend recommendation response
- Profile: Editable profile + discipline score circular indicator + logout

## API Endpoints

- `POST /signup`
- `POST /login`
- `GET /summary`
- `POST /activity`
- `POST /workout`
- `GET /workout/history`
- `POST /meal`
- `GET /calories`
- `POST /ai/chat`
- `GET /profile`
- `PUT /profile`
