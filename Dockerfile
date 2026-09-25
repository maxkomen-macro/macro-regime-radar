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
# The Desk's Build Notes page renders docs/desk/BUILD_NOTES.md (frame-3,
# R-15): the file lives outside web/, so it is copied to where the page's
# relative import finds it (/build/web/../docs/desk). .dockerignore lets
# this one file through its docs and *.md exclusions.
COPY docs/desk/BUILD_NOTES.md /build/docs/desk/BUILD_NOTES.md
# tsc -b && vite build (web/package.json). No VITE_API_BASE here on purpose:
# the bundle calls the API same-origin (web/src/api/client.ts defaults to "").
RUN npm run build

# ── Stage 2: Python API serving the bundle ───────────────────────────────────
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
# Pinned to the set the branch's tests ran against (launch-1): an unpinned
# build installed whatever resolved that day, and pandas 4 changes a concat
# default this code relies on. Regenerate with
# scripts/lock_api_requirements.py after changing requirements-api.txt.
COPY requirements-api.lock ./
RUN pip install --no-cache-dir -r requirements-api.lock
# api/ is the service; src/ carries the analytics modules it imports
# (recession, credit, lbo, allocation, chat — all deliberately config-free,
# so no FRED_API_KEY is needed in the container). NOT copied: dashboard/
# (Streamlit stays on its own host), .env (secrets live in the host's secret
# store), data/*.db (the DB arrives at startup via GH_DB_TOKEN bootstrap).
COPY api/ api/
COPY src/ src/
COPY --from=webbuild /build/web/dist web/dist
# Runs as a non-root user (launch-1). /app/data holds the database the
# bootstrap downloads; /var/data is where DEPLOY.md mounts a disk for the
# assistant's spend ledger. Both are created and owned here, so the ledger
# path works with or without a disk (a disk the user cannot write is reported
# at startup and by the smoke check, and the analyst rests).
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin app \
    && mkdir -p /app/data /var/data \
    && chown -R app:app /app /var/data
USER app
EXPOSE 8000
# --workers 1 is pinned (launch-1): uvicorn otherwise takes its worker count
# from $WEB_CONCURRENCY, and a host that sets it would start a second EODHD
# relay on one token, whose 50 live symbols are shared across every socket.
# $PORT is honoured for hosts that assign one (Render, Railway, Fly).
# --limit-concurrency: a burst beyond the worker pool answers 503 instead of
# queueing without bound (2026-09-06 review).
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --limit-concurrency 64 --timeout-graceful-shutdown 10"]
