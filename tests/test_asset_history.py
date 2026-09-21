"""Allocation's price histories are stored by the refresh pipeline, never
downloaded by the API (fix/prelaunch-1, item 4a).

The full refresh fetches every series allocation reads through the provider
layer (EODHD first where entitled, Yahoo as the disclosed fallback, one
provider per series), stores them in the additive `asset_prices` table with a
source watermark, and validate_db judges the table; /api/freshness carries its
as-of. The API computes allocation from the table and, on a database without
it, says so instead of downloading. EODHD is an httpx MockTransport and Yahoo a
stub here; nothing reaches the network."""

from __future__ import annotations

import sqlite3
import sys
import time
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

import httpx
import pytest

from api import db
from api import freshness as freshness_mod
from api.providers import eodhd as eod
from api.providers import market
from api.providers import yf as yf_provider
from api.providers.cache import TokenBucket
from src.market_data import asset_history
from tests.test_generations import _copy, _seed_asset_prices

REPO_DB = db.DB_PATH
ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)  # a Monday; last completed session Fri 2026-09-18


class _BlockedYahoo(types.ModuleType):
    """Stands in for the yfinance package: any use fails the test."""

    def __getattr__(self, name):
        raise AssertionError(f"yfinance.{name} was reached")


@pytest.fixture()
def no_yahoo(monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", _BlockedYahoo("yfinance"))


def _bdays(start: str, end: str = "2026-09-18") -> list[str]:
    d, out = date.fromisoformat(start), []
    stop = date.fromisoformat(end)
    while d <= stop:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _eod_payload(start: str) -> list[dict]:
    rows = []
    for i, d in enumerate(_bdays(max(start, "2020-01-01"))):
        close = 100.0 + i * 0.1
        rows.append({"date": d, "open": close, "high": close, "low": close, "close": close,
                     "adjusted_close": round(close * 0.97, 6), "volume": 1000})
    return rows


@pytest.fixture()
def eodhd(monkeypatch):
    """Install a mock EODHD; returns the set of codes that should 404."""
    missing: set[str] = set()
    failing: set[str] = set()
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        code = unquote(request.url.path.rsplit("/", 1)[-1])
        calls.append(code)
        if code in failing:
            return httpx.Response(503, text="upstream down")
        if code in missing:
            return httpx.Response(404, text="Ticker Not Found.")
        spec = next((s for s in asset_history.SERIES if s.eodhd == code), None)
        if spec is None:
            return httpx.Response(404, text="Ticker Not Found.")
        return httpx.Response(200, json=_eod_payload(spec.start))

    monkeypatch.setattr(eod, "_bucket", TokenBucket(rate=1000.0, burst=1000))
    market.set_client_for_tests(eod.EodhdClient("test-token", transport=httpx.MockTransport(handler), max_retries=0))
    yield types.SimpleNamespace(missing=missing, failing=failing, calls=calls)
    market.set_client_for_tests(None)


@pytest.fixture()
def yahoo(monkeypatch):
    calls: list[str] = []
    broken: set[str] = set()

    def daily_closes(code: str, start: str, end: str | None = None):
        calls.append(code)
        if code in broken:
            raise yf_provider.ProviderUnavailable("yfinance", "fallback down")
        return [(d, 50.0 + i * 0.05) for i, d in enumerate(_bdays(max(start, "2020-01-01")))]

    monkeypatch.setattr(yf_provider, "daily_closes", daily_closes)
    return types.SimpleNamespace(calls=calls, broken=broken)


def _stored(path: Path) -> dict[str, set[str]]:
    c = sqlite3.connect(path)
    try:
        out: dict[str, set[str]] = {}
        for sym, prov in c.execute("SELECT symbol, provider FROM asset_prices GROUP BY symbol, provider"):
            out.setdefault(sym, set()).add(prov)
        return out
    finally:
        c.close()


def _watermark(path: Path) -> dict:
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    try:
        return dict(c.execute("SELECT * FROM source_watermarks WHERE source='asset_prices'").fetchone())
    finally:
        c.close()


# ── what gets stored ─────────────────────────────────────────────────────────

def test_the_series_cover_every_ticker_allocation_reads():
    from src.analytics import allocation

    daily = {s.symbol for s in asset_history.SERIES if s.interval == "1d"}
    monthly = {s.symbol for s in asset_history.SERIES if s.interval == "1mo"}
    for cfg in allocation.ASSET_CLASSES.values():
        assert cfg["etf"] in daily
        if cfg["index"]:
            assert cfg["index"] in daily
    for p in allocation.FACTOR_PROXIES.values():
        assert {p["long"], p["short"]} <= monthly
    assert set(allocation.STYLE_ETFS.values()) <= monthly
    assert set(allocation.CURRENCY_PAIRS.values()) <= monthly
    assert all(s.yahoo for s in asset_history.SERIES), "every series has a disclosed fallback address"


def test_month_end_closes_are_dated_the_first_and_carry_the_last_close():
    rows = [("2026-07-30", 1.0), ("2026-07-31", 2.0), ("2026-08-03", 3.0), ("2026-08-31", 4.0), ("2026-09-18", 5.0)]
    assert asset_history.month_end_closes(rows) == [("2026-07-01", 2.0), ("2026-08-01", 4.0), ("2026-09-01", 5.0)]


def test_refresh_stores_every_series_eodhd_first_with_a_disclosed_yahoo_fallback(tmp_path, eodhd, yahoo):
    target = tmp_path / "pipeline.db"
    sqlite3.connect(target).close()
    fallback = {s.symbol for s in asset_history.SERIES if s.symbol in ("GC=F", "DX-Y.NYB")}
    eodhd.missing.update(s.eodhd for s in asset_history.SERIES if s.symbol in fallback and s.eodhd)
    summary = asset_history.refresh(target, now=NOW)
    stored = _stored(target)
    assert set(stored) == {s.symbol for s in asset_history.SERIES}
    for s in asset_history.SERIES:
        want = "yfinance" if (s.symbol in fallback or not s.eodhd) else "eodhd"
        assert stored[s.symbol] == {want}, (s.symbol, stored[s.symbol])
    assert set(yahoo.calls) == {s.yahoo for s in asset_history.SERIES if s.symbol in fallback or not s.eodhd}
    wm = _watermark(target)
    assert wm["status"] == "ok" and wm["last_obs"] == "2026-09-18"
    assert "yfinance" in wm["detail"] and all(f in wm["detail"] for f in fallback)
    assert summary["stored"] == len(asset_history.SERIES) and summary["failed"] == []


def test_a_failed_series_keeps_its_previous_rows_and_never_mixes_providers(tmp_path, eodhd, yahoo):
    target = tmp_path / "pipeline.db"
    sqlite3.connect(target).close()
    asset_history.refresh(target, now=NOW)
    c = sqlite3.connect(target)
    spy_before = c.execute("SELECT COUNT(*), MIN(provider), MAX(provider) FROM asset_prices WHERE symbol='SPY' AND interval='1d'").fetchone()
    c.close()
    assert spy_before[1] == spy_before[2] == "eodhd"

    # EODHD down for SPY, and the fallback down too: SPY keeps its stored rows
    spy = next(s for s in asset_history.SERIES if s.symbol == "SPY" and s.interval == "1d")
    eodhd.failing.add(spy.eodhd)
    yahoo.broken.add(spy.yahoo)
    summary = asset_history.refresh(target, now=NOW)
    c = sqlite3.connect(target)
    assert c.execute("SELECT COUNT(*), MIN(provider), MAX(provider) FROM asset_prices WHERE symbol='SPY' AND interval='1d'").fetchone() == spy_before
    c.close()
    assert "SPY" in summary["failed"]
    wm = _watermark(target)
    assert wm["status"] == "partial" and "SPY" in wm["detail"]

    # EODHD still down, the fallback back: SPY is replaced whole from Yahoo, never mixed
    yahoo.broken.clear()
    asset_history.refresh(target, now=NOW)
    c = sqlite3.connect(target)
    assert c.execute("SELECT MIN(provider), MAX(provider) FROM asset_prices WHERE symbol='SPY' AND interval='1d'").fetchone() == ("yfinance", "yfinance")
    c.close()


def test_a_bar_is_stored_only_once_its_session_is_complete(tmp_path, eodhd, yahoo, monkeypatch):
    """A provider can hand back today's partial bar (Yahoo's GC=F did, on a
    Monday morning before the open); nothing after the last completed NYSE
    session is stored, the rule market_daily already follows (B6)."""
    monkeypatch.setattr(yf_provider, "daily_closes",
                        lambda code, start, end=None: [(d, 50.0) for d in _bdays(max(start, "2020-01-01"), "2026-09-21")])
    eodhd.missing.update(s.eodhd for s in asset_history.SERIES if s.eodhd)
    target = tmp_path / "pipeline.db"
    sqlite3.connect(target).close()
    asset_history.refresh(target, now=NOW)  # Monday 12:00 UTC: last completed session Fri 2026-09-18
    c = sqlite3.connect(target)
    try:
        assert c.execute("SELECT MAX(date) FROM asset_prices WHERE interval = '1d'").fetchone()[0] == "2026-09-18"
    finally:
        c.close()


# ── the API reads, never downloads ───────────────────────────────────────────

def test_allocation_is_computed_from_stored_histories_and_never_reaches_yahoo(tmp_path, monkeypatch, no_yahoo):
    from src.analytics import allocation

    assert not hasattr(allocation, "yf"), "allocation must not import yfinance at module level"
    path = _copy(REPO_DB, tmp_path / "alloc.db")
    _seed_asset_prices(path)
    monkeypatch.setattr(allocation, "DB_PATH", path)
    data = allocation.get_allocation_data()
    assert data["n_months"] > 100
    assert data["regime_stats"] and data["regime_factors"] is not None
    assert data["style_performance"] is not None and data["currency_impact"] is not None
    assert data["histories"]["provider_counts"] == {"eodhd": len(asset_history.SERIES)}
    assert data["histories"]["as_of"] == "2026-09-18"


def test_without_the_table_the_endpoint_says_the_histories_are_not_stored(tmp_path, monkeypatch, no_yahoo):
    from api import worker as worker_mod
    from api.main import app
    from fastapi.testclient import TestClient
    from src.analytics import dbpath

    path = _copy(REPO_DB, tmp_path / "macro_radar.db")  # the local snapshot has no asset_prices table
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = worker_mod.AnalyticsWorker(poll_s=0.05)
    monkeypatch.setattr(worker_mod, "_worker", w)
    try:
        w.start(serving=True)
        assert w.wait_published(timeout=120)
        r = TestClient(app, raise_server_exceptions=False).get("/api/allocation")
        assert r.status_code == 503
        body = r.json()
        assert body["kind"] == "not_stored" and body["retryable"] is False
        assert "not stored" in body["detail"] and "download" in body["detail"]
    finally:
        w.stop()
        dbpath.clear_provider()
        db.reset_connections_for_tests()


def test_allocation_answers_in_under_500_ms_after_the_first_pass_with_yahoo_blocked(tmp_path, monkeypatch, no_yahoo):
    from api import worker as worker_mod
    from api.main import app
    from fastapi.testclient import TestClient
    from src.analytics import dbpath

    path = _copy(REPO_DB, tmp_path / "macro_radar.db")
    _seed_asset_prices(path)
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = worker_mod.AnalyticsWorker(poll_s=0.05)
    monkeypatch.setattr(worker_mod, "_worker", w)
    try:
        w.start(serving=True)
        assert w.wait_published(timeout=120)
        client = TestClient(app, raise_server_exceptions=False)
        t = time.perf_counter()
        r = client.get("/api/allocation")
        ms = (time.perf_counter() - t) * 1000
        assert r.status_code == 200, r.text[:300]
        assert ms < 500, f"{ms:.0f} ms"
        body = r.json()
        assert body["optimizations"] is not None or body["optimizations_skipped"] is not None
        assert body["histories"]["as_of"] == "2026-09-18"
        assert body["freshness"]["asset_prices"]["as_of"] == "2026-09-18"
    finally:
        w.stop()
        dbpath.clear_provider()
        db.reset_connections_for_tests()


# ── validation and freshness ─────────────────────────────────────────────────

def _validate_copy(tmp_path: Path, *, seed: bool, watermark: dict | None = None, bad_close: bool = False,
                   mode: str = "full", previous: Path | None = None):
    from scripts import validate_db

    path = _copy(REPO_DB, tmp_path / f"v{time.monotonic_ns()}.db")
    if seed:
        _seed_asset_prices(path)
    c = sqlite3.connect(path)
    if bad_close:
        c.execute("UPDATE asset_prices SET close = 0 WHERE symbol = 'SPY' AND interval = '1d'"
                  " AND date = (SELECT MIN(date) FROM asset_prices WHERE symbol = 'SPY' AND interval = '1d')")
    if watermark is not None:
        from src import watermarks

        watermarks.ensure_table(c)
        watermarks.record(c, "asset_prices", watermark["last_obs"], status=watermark.get("status", "ok"),
                          detail=watermark.get("detail"), now=watermark["checked"])
    c.commit()
    c.close()
    return validate_db.validate(path, previous, mode, now=NOW)


def _ap(items: list[str]) -> list[str]:
    return [x for x in items if "asset_prices" in x]


def test_validate_requires_the_table_in_full_mode_only(tmp_path):
    rep = _validate_copy(tmp_path, seed=False)
    assert _ap(rep["failures"]), rep["failures"]
    rep = _validate_copy(tmp_path, seed=False, mode="news-only")
    assert not _ap(rep["failures"])


def test_validate_passes_a_fresh_table_and_rejects_a_non_positive_close(tmp_path):
    fresh = {"last_obs": "2026-09-18", "checked": NOW - timedelta(minutes=5), "detail": "eodhd 25"}
    rep = _validate_copy(tmp_path, seed=True, watermark=fresh)
    assert not _ap(rep["failures"]) and not _ap(rep["warnings"]), (rep["failures"], rep["warnings"])
    row = next(r for r in rep["sla_all"] if r["feed"] == "asset_prices")
    assert row["verdict"] == "current"
    rep = _validate_copy(tmp_path, seed=True, watermark=fresh, bad_close=True)
    assert any("non-positive" in f for f in _ap(rep["failures"]))


def test_validate_treats_a_checked_but_stale_table_as_an_outage_and_an_unchecked_one_as_a_failure(tmp_path):
    from scripts import validate_db

    path = _copy(REPO_DB, tmp_path / "stale.db")
    _seed_asset_prices(path)
    c = sqlite3.connect(path)
    c.execute("DELETE FROM asset_prices WHERE date > '2026-09-10'")
    from src import watermarks

    watermarks.ensure_table(c)
    watermarks.record(c, "asset_prices", "2026-09-10", status="ok", detail="eodhd 25", now=NOW - timedelta(minutes=5))
    c.commit()
    c.close()
    rep = validate_db.validate(path, None, "full", now=NOW)
    assert not _ap(rep["failures"]) and _ap(rep["warnings"]), (rep["failures"], rep["warnings"])
    c = sqlite3.connect(path)
    c.execute("UPDATE source_watermarks SET checked_at = '2026-09-11T00:00:00Z' WHERE source = 'asset_prices'")
    c.commit()
    c.close()
    rep = validate_db.validate(path, None, "full", now=NOW)
    assert _ap(rep["failures"])


def test_validate_catches_a_regressed_history(tmp_path):
    from scripts import validate_db

    prev = _copy(REPO_DB, tmp_path / "prev.db")
    _seed_asset_prices(prev)
    cur = _copy(prev, tmp_path / "cur.db")
    c = sqlite3.connect(cur)
    c.execute("DELETE FROM asset_prices WHERE date > '2026-09-01'")
    c.commit()
    c.close()
    rep = validate_db.validate(cur, prev, "full", now=NOW)
    assert any("regressed" in f for f in _ap(rep["failures"]))


def test_freshness_carries_the_stored_histories_as_of_and_provider():
    base = {"regimes_date": "2026-08-01", "signals_date": "2026-08-01", "market_daily_date": "2026-09-18",
            "market_intraday_ts": "2026-09-18 15:55:00", "news_published_at": "2026-09-21T11:00:00Z",
            "raw_series_date": "2026-09-01"}
    marks = {"asset_prices": {"source": "asset_prices", "last_obs": "2026-09-18", "checked_at": "2026-09-21T11:20:00Z",
                              "advanced_at": "2026-09-21T11:20:00Z", "status": "ok",
                              "detail": "eodhd 23 · yfinance 2 (GC=F, DX-Y.NYB)"}}
    rep = freshness_mod.assess(db_fresh={**base, "asset_prices_date": "2026-09-18"}, series_latest=[], relay=None,
                               bootstrap=None, now=NOW, watermarks=marks)
    s = next(x for x in rep["series"] if x["id"] == "asset_prices")
    assert s["as_of"] == "2026-09-18" and s["state"] == "close" and s["kind"] == "market"
    assert "yfinance" in s["reason"] and "GC=F" in s["reason"]
    assert next(r for r in rep["sla"] if r["feed"] == "asset_prices")["verdict"] == "current"
    assert rep["overall"] == freshness_mod.assess(db_fresh=base, series_latest=[], relay=None, bootstrap=None,
                                                  now=NOW, watermarks={})["overall"], "the histories never move the model verdict"
    none = freshness_mod.assess(db_fresh={**base, "asset_prices_date": None}, series_latest=[], relay=None,
                                bootstrap=None, now=NOW, watermarks={})
    s = next(x for x in none["series"] if x["id"] == "asset_prices")
    assert s["state"] == "unknown" and "not stored" in s["reason"]


@pytest.mark.skipif(not REPO_DB.exists(), reason="local DB snapshot absent")
def test_db_freshness_reports_the_histories_date_or_none():
    assert "asset_prices_date" in db.freshness()


# ── the workflow step ────────────────────────────────────────────────────────

def test_the_full_refresh_stores_the_histories_before_validation():
    import yaml

    from tests.test_workflows import STDLIB, _module_imports, _requirement_modules

    steps = yaml.safe_load((ROOT / ".github/workflows/refresh-data.yml").read_text())["jobs"]["refresh"]["steps"]
    names = [s["name"] for s in steps]
    step = next(s for s in steps if "asset_history" in (s.get("run") or ""))
    assert step["if"] == "steps.mode.outputs.mode == 'full'"
    assert step["run"].strip() == "python -m src.market_data.asset_history"
    assert names.index("Fetch market data (incremental)") < names.index(step["name"]) < names.index("Validate the refreshed database")
    mods: set[str] = set()
    for rel in ("src/market_data/asset_history.py", "api/providers/market.py", "api/providers/eodhd.py",
                "api/providers/yf.py", "api/providers/symbols.py", "api/providers/cache.py",
                "api/providers/errors.py", "api/providers/entitlements.py", "src/analytics/allocation.py"):
        mods |= _module_imports(ROOT / rel)
    third_party = {m for m in mods if m not in STDLIB and m not in ("src", "api")}
    full = _requirement_modules(ROOT / "requirements.txt") | _requirement_modules(ROOT / "requirements-snapshot.txt")
    assert third_party <= full | {"riskfolio", "scipy"}, third_party - full
