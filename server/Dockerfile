FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY alembic.ini .
COPY alembic/ ./alembic/
# Seed data read at startup (workout catalog, global exercises, food DB, quotes, recipes)
COPY workout_catalog_v2_clean.json .
COPY global_exercises_seed.json .
COPY nexrep_recipes_seed.json .
COPY nexrep_fasting_recipes_seed.json .
COPY sql/ ./sql/
COPY seeds/ ./seeds/

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
