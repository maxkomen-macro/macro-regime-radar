# syntax=docker/dockerfile:1
# Macro Regime Radar — single-image build: React bundle + FastAPI backend.
# One process serves everything (api/main.py mounts web/dist when present).
# Build:  docker build -t mrr-api .
# Run:    docker run --env-file <secrets> -p 8000:8000 mrr-api
# See docs/redesign/DEPLOY.md for the full runbook (this image is the
# same-origin path; the architecture of record is the Vercel+backend split).

# ── Stage 1: build the React bundle ──────────────────────────────────────────
FROM node:22-slim AS webbuild
WORKDIR /build/web
# Lockfile-first for layer caching: npm ci re-runs only when deps change.
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# tsc -b && vite build (web/package.json). No VITE_API_BASE here on purpose:
# the bundle calls the API same-origin (web/src/api/client.ts defaults to "").
RUN npm run build

# ── Stage 2: Python API serving the bundle ───────────────────────────────────
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
COPY requirements-api.txt ./
RUN pip install --no-cache-dir -r requirements-api.txt
# api/ is the service; src/ carries the analytics modules it imports
# (recession, credit, lbo, allocation, chat — all deliberately config-free,
# so no FRED_API_KEY is needed in the container). NOT copied: dashboard/
# (Streamlit stays on its own host), .env (secrets live in the host's secret
# store), data/*.db (the DB arrives at startup via GH_DB_TOKEN bootstrap).
COPY api/ api/
COPY src/ src/
COPY --from=webbuild /build/web/dist web/dist
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
