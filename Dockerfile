# ── Stage 1: build the React SPA ────────────────────────────
FROM node:20-alpine AS web

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python runtime ─────────────────────────────────
FROM python:3.11-slim AS run

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps for psycopg (libpq) and pandas.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 tini \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

# Backend + Alembic
COPY backend/ ./backend/
COPY alembic/ ./alembic/
COPY alembic.ini pyproject.toml ./

# Built frontend
COPY --from=web /app/frontend/dist ./frontend/dist

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
# Run migrations then start. Railway sets $PORT.
CMD sh -c "alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"
