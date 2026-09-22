"""The Desk's daily series store (desk/event-study, 2026-09-21).

src/market_data/desk_history.py stores the registry's fred and market series
(src/desk/series.py) as daily observations in `desk_series`, with one
watermark per series and one for the table. FRED and the provider layer are
stubbed; nothing reaches the network. The registry itself is pinned: the
tier-1 set is Max's list, every target is also a shock asset, units and roles
are from the declared vocabularies, and the module imports nothing that needs
FRED_API_KEY (the API process imports it)."""

from __future__ import annotations

import ast
import sqlite3
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from api.providers import market
from api.providers.errors import ProviderUnavailable
from src import watermarks
from src.desk import series as registry
from src.market_data import desk_history

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)  # Monday; last completed session Fri 2026-09-18
TIER1 = ["DGS10", "DGS2", "T10Y2Y", "VIXCLS", "BAMLH0A0HYM2"]  # gold is GC=F from asset_prices (decision 2026-09-21)


def _bdays(start: str, end: str) -> list[str]:
    d, out = date.fromisoformat(start), []
    stop = date.fromisoformat(end)
    while d <= stop:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


@pytest.fixture()
def fred(monkeypatch):
    """A FRED stub: every series answers from 2020 with a value that can go
    negative for the curve; `failing` raises; `calls` records the ids."""
    calls: list[tuple[str, str]] = []
    failing: set[str] = set()
    end = {"": "2026-09-18"}
    start_floor = {"": "2020-01-02"}  # FRED serves nothing earlier (HY OAS: its rolling window)

    def fred_daily(series_id: str, start: str):
        calls.append((series_id, start))
        if series_id in failing:
            raise RuntimeError("FRED down")
        days = _bdays(max(start, start_floor[""]), end[""])
        base = -0.5 if series_id == "T10Y2Y" else 100.0
        return [(d, base + i * 0.01) for i, d in enumerate(days)]

    monkeypatch.setattr(desk_history, "fred_daily", fred_daily)
    return types.SimpleNamespace(calls=calls, failing=failing, end=end, start_floor=start_floor)


@pytest.fixture()
def providers(monkeypatch):
    """The provider layer stub: answers from EODHD unless `yahoo` names the
    code, with one bar dated after the last completed session (must be dropped)."""
    calls: list[tuple] = []
    yahoo: set[str] = set()
    broken: set[str] = set()
    start_floor: set[str] = set()

    def daily_history(eodhd_code, yahoo_code, start, end=None, *, allow_yahoo=False):
        calls.append((eodhd_code, yahoo_code, start, allow_yahoo))
        assert allow_yahoo, "the refresh path must allow the disclosed Yahoo fallback"
        if yahoo_code in broken:
            raise ProviderUnavailable("eodhd", "down")
        floor = max(start_floor) if start_floor else "2020-01-02"
        rows = [(d, 50.0 + i * 0.05) for i, d in enumerate(_bdays(max(start, floor), "2026-09-21"))]
        provider = "yfinance" if yahoo_code in yahoo else "eodhd"
        return {"provider": provider, "fallback_used": provider != "eodhd", "fallback_reason": None, "rows": rows}

    monkeypatch.setattr(market, "daily_history", daily_history)
    return types.SimpleNamespace(calls=calls, yahoo=yahoo, broken=broken, start_floor=start_floor)


def _rows(path: Path) -> dict[str, dict]:
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return desk_history.stored_summary(c)
    finally:
        c.close()


def _wm(path: Path) -> dict[str, dict]:
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return watermarks.read_all(c)
    finally:
        c.close()


# ── registry ─────────────────────────────────────────────────────────────────

def test_registry_tier1_is_the_agreed_list_and_the_vocabularies_hold():
    assert [s.series_id for s in registry.fetched(1)] == TIER1
    assert registry.get("spx").source == "asset_prices" and registry.get("spx").table == "asset_prices"
    gold = registry.get("gold")
    assert (gold.series_id, gold.source, gold.history_from, gold.label) == ("GC=F", "asset_prices", "2000-08-30", "Gold (COMEX front month)")
    lbma = registry.get("gold_lbma")
    assert not lbma.available and lbma.reason and lbma.roles == ()
    assert lbma not in registry.fetched(3) and lbma not in registry.with_role("shock")
    assert registry.get("hy_oas").history_from == "2023-09-22", "what FRED serves since April 2026, not what it once served"
    # timing rules (verifier defect 1; review R-01, R-03): FRED daily Treasury and OAS values are known at the
    # next session open; VIX after the close; gold and copper at 17:00 ET and deferred as targets
    for key in ("us10y", "us2y", "curve_2s10s", "hy_oas"):
        assert registry.get(key).known == registry.NEXT_OPEN and registry.get(key).known_by == "after_close", key
    assert registry.get("us10y").fixed == ("close", -30) and registry.get("hy_oas").fixed == ("close", -60)
    assert registry.get("vix").known == ("close", 15) and registry.get("vix").known_by == "after_close"
    assert registry.get("spx").fixed == registry.AT_CLOSE and registry.get("spx").known_by == "close"
    assert registry.get("gold").fixed == registry.clock(17, 0) and registry.get("gold").defer_as_target and registry.get("gold").known_by == "after_close"
    assert registry.get("copper").defer_as_target and not registry.get("spx").defer_as_target
    assert registry.rule_str(registry.NEXT_OPEN) == "next session open" and registry.rule_str(registry.clock(17, 0)) == "17:00 ET clock"
    assert registry.rule_str(("close", -30)) == "session close − 30 min" and registry.rule_str(("close", 15)) == "session close + 15 min"
    keys = [s.key for s in registry.SERIES]
    ids = [s.series_id for s in registry.SERIES]
    assert len(set(keys)) == len(keys) and len(set(ids)) == len(ids)
    for s in registry.SERIES:
        assert s.unit in registry.UNITS and s.source in registry.SOURCES and s.known_by in registry.KNOWN_BY
        assert s.fixed[0] in registry.ANCHORS and s.known[0] in registry.ANCHORS, s.key
        assert isinstance(s.defer_as_target, bool)
        assert set(s.roles) <= set(registry.ROLES) and (bool(s.roles) == s.available), s.key
        assert (s.reason is not None) == (not s.available), s.key
        assert (s.scale == 100.0) == (s.unit == "bp"), s.key  # FRED serves yields and OAS in percent
        if s.source != "market":
            assert s.eodhd is None, s.key  # only market series have an EODHD address; copper is Yahoo-only
        assert s.tier in (1, 2, 3)
    targets = {s.key for s in registry.with_role("target")}
    assert targets == {"spx", "ndx", "gold", "us10y", "dxy", "hy_oas", "vix"}  # §3
    assert targets <= {s.key for s in registry.with_role("shock")}
    assert [s.series_id for s in registry.fetched(3)] == [s.series_id for s in registry.fetched(2)]  # tier 3 deferred
    assert registry.get("hy_oas").warn and registry.get("usdjpy").warn and registry.get("gold").warn and not registry.get("spx").warn
    with pytest.raises(KeyError):
        registry.get("nope")


def test_registry_is_keyless():
    """The API process imports the registry without FRED_API_KEY: no src.config,
    no third-party imports."""
    tree = ast.parse((ROOT / "src/desk/series.py").read_text())
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module.split(".")[0])
    assert mods <= {"__future__", "dataclasses"}, mods


# ── writer ───────────────────────────────────────────────────────────────────

def test_tier1_stores_the_fred_series_only_and_records_watermarks(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    out = desk_history.refresh(db, now=NOW, tier=1)
    assert out["status"] == "ok" and out["stored"] == TIER1 and out["providers"] == {"fred": 5}
    assert out["short"] == {sid: "2020-01-02" for sid in TIER1 if sid != "BAMLH0A0HYM2"}, "the stub serves from 2020; HY OAS declares 2023-09-22"
    assert providers.calls == [], "tier 1 never calls the provider layer"
    assert [c[0] for c in fred.calls] == TIER1
    assert dict(fred.calls)["DGS10"] == "1962-01-02", "fetched from the declared history_from"
    rows = _rows(db)
    assert set(rows) == set(TIER1)
    assert all(r["provider"] == "fred" and r["last"] == "2026-09-18" for r in rows.values())
    wm = _wm(db)
    assert wm["desk_series"]["status"] == "ok" and wm["desk_series"]["last_obs"] == "2026-09-18"
    assert wm["desk_series"]["detail"].startswith("fred 5; short history: DGS10 (from 2020-01-02), DGS2 (from 2020-01-02)")
    assert wm["desk:DGS10"]["last_obs"] == "2026-09-18" and wm["desk:DGS10"]["status"] == "short"
    assert wm["desk:DGS10"]["detail"] == "fred; served from 2020-01-02; stored from 2020-01-02; 1752 rows; declared 1962-01-02"


def test_negative_values_are_stored_as_served(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=1)
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    v = c.execute("SELECT value FROM desk_series WHERE series_id='T10Y2Y' ORDER BY date LIMIT 1").fetchone()[0]
    c.close()
    assert v == -0.5


def test_a_failed_series_keeps_its_previous_rows_and_the_watermark_says_so(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=1)
    before = _rows(db)
    fred.failing.add("VIXCLS")
    fred.end[""] = "2026-09-21"  # the others advance
    out = desk_history.refresh(db, now=NOW + timedelta(days=1), tier=1)
    assert out["status"] == "partial" and out["failed"] == ["VIXCLS"]
    after = _rows(db)
    assert after["VIXCLS"] == before["VIXCLS"], "previous rows kept"
    assert after["DGS10"]["last"] == "2026-09-21"
    wm = _wm(db)
    assert wm["desk:VIXCLS"]["status"] == "error" and wm["desk:VIXCLS"]["detail"] == "RuntimeError"
    assert wm["desk:VIXCLS"]["last_obs"] == "2026-09-18", "the last good observation stands"
    assert wm["desk_series"]["status"] == "partial"
    assert wm["desk_series"]["last_obs"] == "2026-09-18", "the table's as-of is the oldest newest observation"
    assert "failed: VIXCLS (RuntimeError)" in wm["desk_series"]["detail"]


def test_fred_rows_merge_so_a_rolling_window_never_forgets(tmp_path, fred, providers):
    """FRED serves the ICE BofA series as a rolling three-year window (checked
    2026-09-21): a later run that is served less must keep what was stored."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=1)
    assert _rows(db)["BAMLH0A0HYM2"]["first"] == "2023-09-22"
    fred.start_floor[""] = "2024-01-02"  # the window rolled forward
    fred.end[""] = "2026-09-21"
    desk_history.refresh(db, now=NOW + timedelta(days=1), tier=1)
    r = _rows(db)["BAMLH0A0HYM2"]
    assert r["first"] == "2023-09-22" and r["last"] == "2026-09-21", "merged, not replaced"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    v = c.execute("SELECT value FROM desk_series WHERE series_id='BAMLH0A0HYM2' AND date='2024-01-02'").fetchone()[0]
    c.close()
    assert v == 100.0, "a served value revises the stored one in place"


def test_market_rows_are_replaced_whole(tmp_path, fred, providers):
    """Adjusted closes restate through history: a market series is replaced."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=2)
    providers.start_floor.add("2024-01-02")
    desk_history.refresh(db, now=NOW, tier=2)
    assert _rows(db)["^NDX"]["first"] == "2024-01-02"


def test_a_short_history_is_flagged_against_the_declared_start(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    fred.start_floor[""] = "2023-09-22"
    out = desk_history.refresh(db, now=NOW, tier=1)
    assert out["short"]["DGS10"] == "2023-09-22" and "BAMLH0A0HYM2" not in out["short"]
    wm = _wm(db)
    assert wm["desk:DGS10"]["status"] == "short" and wm["desk:BAMLH0A0HYM2"]["status"] == "ok"
    assert "short history: DGS10 (from 2023-09-22)" in wm["desk_series"]["detail"]


def test_tier2_adds_the_market_series_through_the_provider_layer(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    providers.yahoo.add("JPY=X")
    out = desk_history.refresh(db, now=NOW, tier=2)
    assert out["status"] == "ok"
    assert [c[1] for c in providers.calls] == ["^NDX", "DX-Y.NYB", "JPY=X"]
    assert [c[0] for c in providers.calls] == ["NDX.INDX", "DXY.INDX", "USDJPY.FOREX"]
    assert "DCOILWTICO" in out["stored"] and "^RUT" not in out["stored"], "asset_prices rows are not this writer's"
    rows = _rows(db)
    assert rows["^NDX"]["provider"] == "eodhd" and rows["JPY=X"]["provider"] == "yfinance"
    assert rows["^NDX"]["last"] == "2026-09-18", "the bar dated after the last completed session is dropped"
    assert out["fallbacks"] == ["JPY=X"]
    assert "(fallback: JPY=X)" in _wm(db)["desk_series"]["detail"]


def test_a_provider_error_is_a_typed_failure(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    providers.broken.add("^NDX")
    out = desk_history.refresh(db, now=NOW, tier=2)
    assert out["status"] == "partial" and out["failed"] == ["^NDX"]
    assert _wm(db)["desk:^NDX"]["detail"] == "unavailable"


def test_cli_never_fails_the_refresh(tmp_path, fred, providers, capsys):
    db = tmp_path / "t.db"
    fred.failing.add("DGS2")
    assert desk_history.main(["--db", str(db), "--tier", "1"]) == 0
    assert "FAILED DGS2" in capsys.readouterr().out


def test_api_never_imports_the_writer():
    """The writer reaches Yahoo (disclosed fallback); the server process must not."""
    for p in (ROOT / "api").rglob("*.py"):
        assert "desk_history" not in p.read_text(), p


# ── the refresh, the validator and the freshness contract ─────────────────────

def test_the_desk_step_runs_on_the_full_mode_install():
    """`python -m src.market_data.desk_history --tier 1` runs in full mode
    (requirements.txt + requirements-snapshot.txt) after the allocation
    histories; every third-party import on its path must be installed there."""
    from tests.test_workflows import STDLIB, _module_imports, _requirement_modules

    files = ["src/market_data/desk_history.py", "src/desk/series.py", "src/watermarks.py", "api/calendar.py", "src/utils/fred_client.py"]
    files += [str(p.relative_to(ROOT)) for p in sorted((ROOT / "api/providers").glob("*.py"))]
    mods: set[str] = set()
    for f in files:
        mods |= _module_imports(ROOT / f)
    third_party = {m for m in mods if m not in STDLIB and m not in {"src", "api"}}
    full = _requirement_modules(ROOT / "requirements.txt") | _requirement_modules(ROOT / "requirements-snapshot.txt")
    assert third_party <= full, third_party - full
    wf = (ROOT / ".github/workflows/refresh-data.yml").read_text()
    assert "python -m src.market_data.desk_history --tier 1" in wf
    assert wf.index("python -m src.market_data.asset_history") < wf.index("python -m src.market_data.desk_history")
    assert wf.index("python -m src.market_data.desk_history") < wf.index("rm -f .env"), "FRED needs the key the run wrote"


def test_validate_db_requires_the_table_in_full_mode_and_reports_short_series(tmp_path):
    import scripts.validate_db as v
    from tests.test_validate_db import _make

    now = datetime(2026, 9, 5, 21, 30, tzinfo=timezone.utc)
    ok = tmp_path / "ok.db"
    _make(ok)
    rep = v.validate(ok, None, "full", now=now)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(r["feed"] == "desk_series" and r["verdict"] == "current" for r in rep["sla_all"]), rep["sla_all"]
    c = sqlite3.connect(ok)
    c.execute("INSERT INTO source_watermarks VALUES ('desk:BAMLH0A0HYM2','2026-09-04',3.0,'2026-09-05T21:00:00Z','2026-09-05T21:00:00Z','short','fred; served from 2023-09-22; stored from 2023-09-22; 785 rows; declared 1996-12-31')")
    c.commit(); c.close()
    rep = v.validate(ok, None, "full", now=now)
    assert rep["verdict"] == "pass" and any("desk:BAMLH0A0HYM2 short" in w for w in rep["warnings"])
    gone = tmp_path / "gone.db"
    _make(gone)
    c = sqlite3.connect(gone)
    c.execute("DROP TABLE desk_series"); c.commit(); c.close()
    rep = v.validate(gone, None, "full", now=now)
    assert rep["verdict"] == "fail" and any(f.startswith("desk_series: missing") for f in rep["failures"])
    assert v.validate(gone, None, "news-only", now=now)["verdict"] == "pass", "lean modes never judge it"


def test_freshness_verdict_is_t_plus_one_and_absent_before_the_table():
    from api import freshness as fm

    base = {"regimes_date": "2026-07-01", "signals_date": "2026-07-01", "market_daily_date": "2026-09-18",
            "market_intraday_ts": None, "news_published_at": None, "raw_series_date": "2026-09-01", "asset_prices_date": "2026-09-18"}
    now = datetime(2026, 9, 21, 23, 0, tzinfo=timezone.utc)  # Monday after the close: last session 09-21
    rows = {r["feed"]: r for r in fm.assess(db_fresh={**base, "desk_series_date": "2026-09-18"}, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})["sla"]}
    assert rows["desk_series"]["verdict"] == "current" and rows["desk_series"]["expected"] == "2026-09-18"
    rows = {r["feed"]: r for r in fm.assess(db_fresh={**base, "desk_series_date": "2026-09-16"}, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})["sla"]}
    assert rows["desk_series"]["verdict"] == "stale"
    rows = {r["feed"]: r for r in fm.assess(db_fresh={**base, "desk_series_date": None}, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})["sla"]}
    assert rows["desk_series"]["verdict"] == "unavailable" and "not stored" in rows["desk_series"]["reason"]
    rows = {r["feed"]: r for r in fm.assess(db_fresh=base, series_latest=[], relay=None, bootstrap=None, now=now, watermarks={})["sla"]}
    assert "desk_series" not in rows, "a database that predates the table has no verdict, like asset_prices"
