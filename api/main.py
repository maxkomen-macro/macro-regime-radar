"""api/main.py — local, read-only FastAPI service exposing Macro Regime Radar
outputs (latest regime, signals, and FRED macro/credit series) for Atlas.

Localhost-only by design; no auth/CORS since it's same-machine server-to-server.
Run with:

    uvicorn api.main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

from typing import Callable, TypeVar

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from api import db

app = FastAPI(
    title="Macro Regime Radar API",
    version="1.0.0",
    description="Read-only access to the latest macro regime, signals, and FRED series.",
)

T = TypeVar("T")


def _guarded(fn: Callable[[], T]) -> T:
    """Translate a missing/unopenable DB into a 503 instead of a 500."""
    try:
        return fn()
    except db.DBUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ── Response models ───────────────────────────────────────────────────────────

class Health(BaseModel):
    status: str
    db_present: bool


class Regime(BaseModel):
    date: str
    label: str
    confidence: float
    growth_trend: float | None
    inflation_trend: float | None
    prob_goldilocks: float | None
    prob_overheating: float | None
    prob_stagflation: float | None
    prob_recession: float | None


class Signal(BaseModel):
    signal_name: str
    value: float
    triggered: bool


class SignalsSnapshot(BaseModel):
    date: str
    signals: list[Signal]


class SeriesPoint(BaseModel):
    series_id: str
    date: str
    value: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", db_present=db.db_present())


@app.get("/regime/latest", response_model=Regime)
def regime_latest() -> Regime:
    row = _guarded(db.latest_regime)
    if row is None:
        raise HTTPException(status_code=404, detail="No regime data available.")
    return Regime(**row)


@app.get("/signals/latest", response_model=SignalsSnapshot)
def signals_latest() -> SignalsSnapshot:
    snap = _guarded(db.latest_signals)
    if snap is None:
        raise HTTPException(status_code=404, detail="No signal data available.")
    return SignalsSnapshot(**snap)


@app.get("/series", response_model=list[str])
def series_catalog() -> list[str]:
    return _guarded(db.list_series)


@app.get("/series/latest", response_model=list[SeriesPoint])
def series_latest_all() -> list[SeriesPoint]:
    return [SeriesPoint(**r) for r in _guarded(db.latest_series_all)]


@app.get("/series/{series_id}/latest", response_model=SeriesPoint)
def series_latest_one(series_id: str) -> SeriesPoint:
    row = _guarded(lambda: db.latest_series_one(series_id))
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown series_id: {series_id}")
    return SeriesPoint(**row)
