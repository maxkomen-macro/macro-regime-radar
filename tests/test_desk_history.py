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
TIER1 = ["DGS10", "DGS2", "T10Y2Y", "VIXCLS", "BAMLH0A0HYM2", "DGS3MO", "DGS5", "DGS30"]  # gold is GC=F from asset_prices (decision 2026-09-21)
TENORS = ["DGS3MO", "DGS5", "DGS30"]  # desk/frame-3-api: the curve tenors /macro draws, tier 1 with no roles
TIER2 = ["DCOILWTICO", "^NDX", "DX-Y.NYB", "JPY=X"]  # desk/hardening: the full refresh stores tier 2 (^RUT is asset_prices)


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
    # desk/hardening: FRED's three-year window starts 2023-09-25 since 2026-09-22, the
    # day the deployed store was first filled (a store filled earlier holds more)
    assert registry.get("hy_oas").history_from == "2023-09-25", "what FRED serves since April 2026, not what it once served"
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
        # an available series is a study input, except the curve tenors, which only /macro reads
        assert set(s.roles) <= set(registry.ROLES) and (bool(s.roles) == s.available or s.series_id in TENORS), s.key
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


def test_registry_tier2_is_the_refresh_tier_with_its_units_starts_and_timing():
    """desk/hardening: the full refresh stores tier 2. Each series is a price
    or a level, so its shock is a log return; each start is the first date the
    production path (FRED; Yahoo, since the workflow carries no EODHD token)
    served on 2026-09-23, verified against the scratch store."""
    assert registry.REFRESH_TIER == 2 and desk_history.DEFAULT_TIER == 2
    assert [s.series_id for s in registry.fetched(registry.REFRESH_TIER)] == TIER1 + TIER2
    declared = {s.series_id: (s.key, s.source, s.unit, s.scale, s.history_from, s.eodhd) for s in registry.fetched(2) if s.tier == 2}
    assert declared == {
        "DCOILWTICO": ("wti", "fred", "log_return", 1.0, "1986-01-02", None),
        "^NDX": ("ndx", "market", "log_return", 1.0, "1985-10-01", "NDX.INDX"),
        "DX-Y.NYB": ("dxy", "market", "log_return", 1.0, "1971-01-04", "DXY.INDX"),
        "JPY=X": ("usdjpy", "market", "log_return", 1.0, "1996-10-30", "USDJPY.FOREX"),
    }
    assert all(registry.stored_by_refresh(registry.BY_SERIES_ID[sid]) for sid in TIER1 + TIER2)
    assert not any(registry.stored_by_refresh(s) for s in registry.SERIES if s.tier == 3 or not s.available)
    # timing: WTI settles 14:30 and is known at 13:00 ET on the eighth business day after (EIA
    # publishes weekly, review R-01); the Nasdaq 100 at the close; the
    # dollar index at 17:00 ET; a USD/JPY daily bar closes 19:00 to 20:00 ET (London or UTC
    # day), read at 20:00 so a same-session entry never reads it before it prints
    assert registry.get("wti").fixed == registry.clock(14, 30) and registry.get("wti").known == registry.session_clock(8, 13, 0)  # review R-01
    assert registry.get("ndx").fixed == registry.AT_CLOSE and registry.get("ndx").known_by == "close"
    assert registry.get("dxy").fixed == registry.get("dxy").known == registry.clock(17, 0)
    assert registry.get("usdjpy").fixed == registry.get("usdjpy").known == registry.clock(20, 0)
    assert registry.get("usdjpy").known[1] > registry.get("dxy").fixed[1], "a USD/JPY shock never enters DXY the same session"


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
    assert out["status"] == "ok" and out["stored"] == TIER1 and out["providers"] == {"fred": 8}
    assert out["short"] == {sid: "2020-01-02" for sid in TIER1 if sid != "BAMLH0A0HYM2"}, "the stub serves from 2020; HY OAS declares 2023-09-25"
    assert providers.calls == [], "tier 1 never calls the provider layer"
    assert [c[0] for c in fred.calls] == TIER1
    assert dict(fred.calls)["DGS10"] == "1962-01-02", "fetched from the declared history_from"
    rows = _rows(db)
    assert set(rows) == set(TIER1)
    assert all(r["provider"] == "fred" and r["last"] == "2026-09-18" for r in rows.values())
    wm = _wm(db)
    assert wm["desk_series"]["status"] == "ok" and wm["desk_series"]["last_obs"] == "2026-09-18"
    assert wm["desk_series"]["detail"].startswith("fred 8; short history: DGS10 (from 2020-01-02), DGS2 (from 2020-01-02)")
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
    declared = registry.get("hy_oas").history_from
    desk_history.refresh(db, now=NOW, tier=1)
    assert _rows(db)["BAMLH0A0HYM2"]["first"] == declared
    fred.start_floor[""] = "2024-01-02"  # the window rolled forward
    fred.end[""] = "2026-09-21"
    desk_history.refresh(db, now=NOW + timedelta(days=1), tier=1)
    r = _rows(db)["BAMLH0A0HYM2"]
    assert r["first"] == declared and r["last"] == "2026-09-21", "merged, not replaced"
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


def test_a_tier2_run_makes_nine_fred_calls_and_one_provider_call_per_market_series(tmp_path, fred, providers):
    """desk/hardening: the call counts the report and the workflow state. The
    default run is the refresh tier; each market series is one call into the
    provider layer (EODHD first with a token, the disclosed Yahoo fallback
    without), and the FRED series one request each."""
    db = tmp_path / "t.db"
    assert desk_history.main(["--db", str(db)]) == 0
    assert [c[0] for c in fred.calls] == TIER1 + ["DCOILWTICO"]
    assert [(c[0], c[1]) for c in providers.calls] == [("NDX.INDX", "^NDX"), ("DXY.INDX", "DX-Y.NYB"), ("USDJPY.FOREX", "JPY=X")]
    assert set(_rows(db)) == set(TIER1 + TIER2)
    wf = (ROOT / ".github/workflows/refresh-data.yml").read_text()
    assert "nine FRED calls" in wf and "three market series" in wf


def test_with_a_token_a_tier2_run_bills_three_eodhd_requests_and_reaches_yahoo_for_none(tmp_path, fred, monkeypatch):
    """desk/hardening: the EODHD count the report states, through the real
    provider path (market.daily_history → EodhdClient.eod) over a mock
    transport: one billed request per market series, one unit each, and no
    Yahoo call while EODHD answers."""
    import httpx

    from api.providers import cache as cache_mod
    from api.providers import eodhd as eod
    from api.providers import entitlements, quota

    seen: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        rows = [{"date": d, "close": 100.0 + i, "adjusted_close": 100.0 + i} for i, d in enumerate(_bdays("2020-01-02", "2026-09-18"))]
        return httpx.Response(200, json=rows, request=request)

    monkeypatch.setattr(eod, "_bucket", cache_mod.TokenBucket(rate=10_000, burst=100_000))
    monkeypatch.setattr(market, "_client", eod.EodhdClient("tok-not-a-real-token", timeout=1.0, max_retries=2,
                                                           transport=httpx.MockTransport(upstream)))
    monkeypatch.setattr(market.yf, "daily_closes", lambda *a, **k: pytest.fail("Yahoo reached while EODHD answered"))
    entitlements.reset_for_tests()
    quota.reset()
    try:
        out = desk_history.refresh(tmp_path / "t.db", now=NOW, tier=2)
        snap = quota.snapshot()
    finally:
        entitlements.reset_for_tests()
        quota.reset()
    assert [p.rsplit("/", 1)[-1] for p in seen] == ["NDX.INDX", "DXY.INDX", "USDJPY.FOREX"]
    assert snap["requests"] == 3 and snap["units"] == 3
    assert [c[0] for c in fred.calls] == TIER1 + ["DCOILWTICO"]
    assert out["providers"] == {"fred": 9, "eodhd": 3} and out["fallbacks"] == []


def test_a_bar_fixed_on_the_clock_after_the_close_is_stored_only_once_it_prints(tmp_path, fred, providers):
    """Verifier V-07 (desk/hardening): the store keeps market bars up to the
    last completed NYSE session, but the dollar index is fixed at 17:00 ET and
    USD/JPY at 20:00 ET, so a refresh between the close and those times would
    store a bar still moving. Such a bar for the last session waits for its
    series' fixing time; the Nasdaq 100, fixed at the close, does not."""
    def last(now):
        db = tmp_path / f"t{now:%H%M}.db"
        desk_history.refresh(db, now=now, tier=2)
        return {sid: r["last"] for sid, r in _rows(db).items() if sid in ("^NDX", "DX-Y.NYB", "JPY=X")}

    # Mon 2026-09-21: the session closed at 16:00 ET and is complete from 16:20 (B6)
    assert last(datetime(2026, 9, 21, 20, 40, tzinfo=timezone.utc)) == {"^NDX": "2026-09-21", "DX-Y.NYB": "2026-09-18", "JPY=X": "2026-09-18"}  # 16:40 ET
    assert last(datetime(2026, 9, 21, 21, 30, tzinfo=timezone.utc)) == {"^NDX": "2026-09-21", "DX-Y.NYB": "2026-09-21", "JPY=X": "2026-09-18"}  # 17:30 ET
    assert last(datetime(2026, 9, 22, 0, 23, tzinfo=timezone.utc)) == {"^NDX": "2026-09-21", "DX-Y.NYB": "2026-09-21", "JPY=X": "2026-09-21"}  # 20:23 ET


def test_a_provider_error_is_a_typed_failure(tmp_path, fred, providers):
    db = tmp_path / "t.db"
    providers.broken.add("^NDX")
    out = desk_history.refresh(db, now=NOW, tier=2)
    assert out["status"] == "partial" and out["failed"] == ["^NDX"]
    assert _wm(db)["desk:^NDX"]["detail"] == "unavailable"


def test_cli_reports_a_tier1_failure_with_a_non_zero_exit(tmp_path, fred, providers, capsys):
    """The step still never fails the workflow (continue-on-error); since review
    R-08 a tier-1 failure exits 1, as validate_db judges it."""
    db = tmp_path / "t.db"
    fred.failing.add("DGS2")
    assert desk_history.main(["--db", str(db), "--tier", "1"]) == 1
    assert "FAILED DGS2" in capsys.readouterr().out


def test_api_never_imports_the_writer():
    """The writer reaches Yahoo (disclosed fallback); the server process must not."""
    for p in (ROOT / "api").rglob("*.py"):
        assert "desk_history" not in p.read_text(), p


# ── the refresh, the validator and the freshness contract ─────────────────────

def test_the_desk_step_runs_on_the_full_mode_install():
    """`python -m src.market_data.desk_history --tier 2` runs in full mode
    (requirements.txt + requirements-snapshot.txt) after the allocation
    histories; every third-party import on its path must be installed there.
    The step runs the registry's refresh tier (2 since desk/hardening)."""
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
    assert f"python -m src.market_data.desk_history --tier {registry.REFRESH_TIER}" in wf
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
    # desk/integration (verifier V-06): a tier-1 series the refresh did not store
    # makes the verdict say so, by name; since desk/hardening review R-02 it also
    # fails the run on its own.
    c = sqlite3.connect(ok)
    c.execute("DELETE FROM desk_series WHERE series_id = 'DGS2'"); c.commit(); c.close()
    rep = v.validate(ok, None, "full", now=now)
    row = next(r for r in rep["sla_all"] if r["feed"] == "desk_series")
    assert row["verdict"] != "current" and "2Y Treasury" in row["reason"], row
    assert rep["verdict"] == "fail" and "desk:DGS2 (tier 1): not stored; the full refresh stores it" in rep["failures"], rep["failures"]
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


# ── desk/hardening, review round 2: R-03 (future-dated rows) and R-04 (isolation) ──

def test_a_future_dated_tier2_row_is_excluded_and_recorded_while_tier1_is_stored_as_served(tmp_path, fred, providers, monkeypatch):
    """Review R-03: a row dated after the refresh's own date is excluded from a
    tier-2 series, incoming or already stored, and the watermark says so; a
    tier-1 FRED observation is stored as served, so validate_db fails on it."""
    db = tmp_path / "t.db"
    fred.start_floor[""] = "1900-01-01"  # served from each declared start: nothing short here
    stub = desk_history.fred_daily

    def with_future(series_id, start):
        rows = stub(series_id, start)
        return rows + [("2027-01-04", 1.0)] if series_id in ("DCOILWTICO", "DGS10") else rows

    c = sqlite3.connect(db)
    desk_history.ensure_table(c)
    c.execute("INSERT INTO desk_series VALUES ('DCOILWTICO', '2026-12-31', 2.0, 'fred')")  # stored by an older run
    c.commit()
    c.close()
    monkeypatch.setattr(desk_history, "fred_daily", with_future)
    out = desk_history.refresh(db, now=NOW, tier=2)
    rows = _rows(db)
    assert rows["DCOILWTICO"]["last"] == "2026-09-18", "excluded, incoming and stored"
    assert rows["DGS10"]["last"] == "2027-01-04", "tier 1 stored as served: validate_db fails it"
    wm = _wm(db)
    assert wm["desk:DCOILWTICO"]["status"] == "excluded" and "2 rows dated after 2026-09-21 excluded" in wm["desk:DCOILWTICO"]["detail"]
    assert wm["desk:DCOILWTICO"]["last_obs"] == "2026-09-18"
    assert out["excluded"] == {"DCOILWTICO": 2} and "future-dated rows excluded: DCOILWTICO (2)" in wm["desk_series"]["detail"]


def test_a_series_whose_write_fails_is_rolled_back_alone_and_the_run_returns_zero(tmp_path, fred, providers, monkeypatch, capsys):
    """Review R-04: each series is written in its own savepoint. A write that
    fails part-way (here after deleting the Nasdaq 100's old rows) rolls back
    that series only: its previous rows and the other series' new rows stand,
    the failure is recorded, and the command returns zero."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=2)
    before = _rows(db)
    real = desk_history.write_series

    def breaks_on_ndx(conn, series_id, rows, **kw):
        if series_id == "^NDX":
            conn.execute("DELETE FROM desk_series WHERE series_id = ?", (series_id,))
            raise sqlite3.OperationalError("probe: disk I/O error")
        return real(conn, series_id, rows, **kw)

    monkeypatch.setattr(desk_history, "write_series", breaks_on_ndx)
    fred.end[""] = "2026-09-21"  # the FRED series advance on the second run
    assert desk_history.main(["--db", str(db), "--tier", "2"]) == 0
    after = _rows(db)
    assert after["^NDX"] == before["^NDX"], "rolled back to its previous rows"
    # the others stored this run (the CLI runs on today's clock, so the market series reach later sessions)
    assert after["DGS10"]["last"] == "2026-09-21" and after["DX-Y.NYB"]["last"] >= before["DX-Y.NYB"]["last"]
    wm = _wm(db)
    assert wm["desk:^NDX"]["status"] == "error" and wm["desk:^NDX"]["detail"] == "write failed: OperationalError"
    assert wm["desk_series"]["status"] == "partial" and "^NDX (write failed: OperationalError)" in wm["desk_series"]["detail"]
    assert "FAILED ^NDX" in capsys.readouterr().out


def test_the_store_command_says_so_when_the_store_cannot_run(tmp_path, monkeypatch, capsys):
    """Review R-04: whatever stops the store (here the database cannot be
    opened), the command says so and validate_db judges the table. Nothing
    was refreshed, tier 1 included, so since review R-08 it exits 1."""
    def boom(*a, **k):
        raise sqlite3.OperationalError("probe: unable to open database file")

    monkeypatch.setattr(desk_history, "refresh", boom)
    assert desk_history.main(["--db", str(tmp_path / "t.db")]) == 1
    assert "could not run (OperationalError)" in capsys.readouterr().err


def test_the_store_step_never_fails_the_workflow():
    """Review R-04: the workflow step continues on error; validate_db decides."""
    import yaml

    wf = yaml.safe_load((ROOT / ".github/workflows/refresh-data.yml").read_text())
    steps = [s for job in wf["jobs"].values() for s in job["steps"]]
    step = next(s for s in steps if s.get("name") == "Store Desk daily series")
    assert step.get("continue-on-error") is True and "--tier 2" in step["run"]


def test_future_dated_tier2_rows_are_quarantined_even_when_the_fetch_fails(tmp_path, fred, providers):
    """Review R-06 (the failed-fetch repro): a future-dated tier-2 row an earlier
    run left behind survived whenever that series' fetch failed, because it was
    cleaned only inside a successful write. Every run now moves such rows to
    desk_series_quarantine before it fetches anything; the failed series keeps
    its real rows and says what was moved. Tier 1 is untouched: validate_db
    fails a future-dated tier-1 row."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=2)
    before = _rows(db)
    c = sqlite3.connect(db)
    c.executemany("INSERT INTO desk_series (series_id, date, value, provider) VALUES (?,?,?,?)",
                  [("DCOILWTICO", "2026-12-31", 2.0, "fred"), ("^NDX", "2027-01-04", 1.0, "eodhd"), ("DGS10", "2026-12-31", 4.0, "fred")])
    c.commit()
    c.close()
    fred.failing.add("DCOILWTICO")
    providers.broken.add("^NDX")
    out = desk_history.refresh(db, now=NOW, tier=2)
    assert out["failed"] == ["DCOILWTICO", "^NDX"] and out["excluded"] == {"DCOILWTICO": 1, "^NDX": 1}
    rows = _rows(db)
    assert rows["DCOILWTICO"] == before["DCOILWTICO"] and rows["^NDX"] == before["^NDX"], "the real rows stand, the future ones are gone"
    assert rows["DGS10"]["last"] == "2026-12-31", "tier 1 is stored as served; validate_db fails it"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, reason FROM desk_series_quarantine ORDER BY series_id").fetchall()
    finally:
        c.close()
    assert [r[:3] for r in q] == [("DCOILWTICO", "2026-12-31", 2.0), ("^NDX", "2027-01-04", 1.0)]
    # a FRED row against the run's New York date; a market row against the last completed session (Codex R-16)
    assert [r[3] for r in q] == ["stored, dated after 2026-09-21, the store run's New York date",
                                 "stored, dated after 2026-09-18, the last completed session"], q
    wm = _wm(db)
    assert wm["desk:DCOILWTICO"]["status"] == "error" and "1 row dated after 2026-09-21 moved to desk_series_quarantine" in wm["desk:DCOILWTICO"]["detail"]
    assert "future-dated rows excluded: DCOILWTICO (1), ^NDX (1)" in wm["desk_series"]["detail"]
    # a later run has nothing left to move
    fred.failing.clear()
    providers.broken.clear()
    assert desk_history.refresh(db, now=NOW, tier=2)["excluded"] == {}


# ── desk/hardening, review round 4: R-08, a junk optional-series row ────────

def _seed(db, rows):
    c = sqlite3.connect(db)
    desk_history.ensure_table(c)
    c.executemany("INSERT INTO desk_series VALUES (?,?,?,?)", rows)
    c.commit()
    c.close()


def test_a_non_numeric_future_tier2_row_is_quarantined_as_text_and_tier1_still_refreshes(tmp_path, fred, providers, capsys):
    """Review R-08 (a): ('DCOILWTICO', '2099-12-31', 'not-a-number', 'fred') made
    the quarantine's float() raise ValueError; the run stopped before any fetch,
    the CLI still exited 0, and no series refreshed, tier 1 included. The
    quarantine keeps the raw value as text and never converts it."""
    db = tmp_path / "t.db"
    _seed(db, [("DCOILWTICO", "2099-12-31", "not-a-number", "fred")])
    assert desk_history.main(["--db", str(db), "--tier", "2"]) == 0
    assert [c[0] for c in fred.calls][:len(TIER1)] == TIER1, "every tier-1 fetch ran"
    rows = _rows(db)
    assert all(rows[sid]["last"] >= "2026-09-18" for sid in TIER1), rows
    assert "DCOILWTICO" in rows and rows["DCOILWTICO"]["last"] < "2099-12-31"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, typeof(value), raw FROM desk_series_quarantine").fetchall()
    finally:
        c.close()
    assert q == [("DCOILWTICO", "2099-12-31", "not-a-number", "text", "not-a-number")], q
    assert "FAILED" not in capsys.readouterr().out


def test_a_quarantine_that_fails_fails_its_series_only_and_tier1_still_refreshes(tmp_path, fred, providers, monkeypatch):
    """Review R-08 (b): the quarantine runs per series in its own savepoint. An
    insert that raises there rolls back that series' quarantine, marks it
    failed and skips its fetch; the next series (here the Nasdaq 100) is
    quarantined, and every tier-1 series is fetched and stored. Only a tier-2
    series failed, so the CLI exits 0 (R-08 c)."""
    db = tmp_path / "t.db"
    _seed(db, [("DCOILWTICO", "2099-12-31", 2.0, "fred"), ("^NDX", "2099-12-31", 3.0, "eodhd")])
    real = desk_history._quarantine_stored_series

    def breaks_on_wti(conn, series_id, now):
        if series_id == "DCOILWTICO":
            conn.execute("DELETE FROM desk_series WHERE series_id = ? AND date > '2026-09-21'", (series_id,))
            raise RuntimeError("probe: quarantine insert failed")
        return real(conn, series_id, now)

    monkeypatch.setattr(desk_history, "_quarantine_stored_series", breaks_on_wti)
    assert desk_history.main(["--db", str(db), "--tier", "2"]) == 0
    fetched = [c[0] for c in fred.calls]
    assert fetched[:len(TIER1)] == TIER1 and "DCOILWTICO" not in fetched, "tier 1 fetched; the series whose quarantine failed was not"
    rows = _rows(db)
    assert all(rows[sid]["last"] >= "2026-09-18" for sid in TIER1)
    assert rows["DCOILWTICO"]["last"] == "2099-12-31", "its quarantine rolled back; the engine's as-of still never reads it"
    assert rows["^NDX"]["last"] < "2099-12-31", "the loop went on to the next series"
    wm = _wm(db)
    assert wm["desk:DCOILWTICO"]["status"] == "error" and wm["desk:DCOILWTICO"]["detail"] == "quarantine failed: RuntimeError"
    assert "DCOILWTICO (quarantine failed: RuntimeError)" in wm["desk_series"]["detail"]


def test_the_cli_exits_non_zero_only_when_a_tier1_series_failed(tmp_path, fred, providers, capsys):
    """Review R-08 (c), as validate_db judges it: a tier-2 failure is a warning
    (exit 0), a tier-1 failure is not (exit 1)."""
    providers.broken.add("^NDX")
    assert desk_history.main(["--db", str(tmp_path / "a.db"), "--tier", "2"]) == 0
    fred.failing.add("DGS10")
    assert desk_history.main(["--db", str(tmp_path / "b.db"), "--tier", "2"]) == 1
    assert "tier 1 failed: DGS10" in capsys.readouterr().err


# ── desk/hardening, verifier round 4: V-16, a response of future dates only ─

def test_a_response_of_only_future_dated_rows_is_quarantined_not_empty(tmp_path, fred, providers, monkeypatch, caplog):
    """Verifier V-16: when FRED served WTI only rows dated after the run, the
    filter left nothing and the series failed as "empty": the served rows were
    neither quarantined nor mentioned. They now go to the quarantine through
    the same path as any incoming future-dated row (R-06), the series says it
    was served only future-dated rows, and the run goes on."""
    import logging

    db = tmp_path / "t.db"
    stub = desk_history.fred_daily

    def wti_all_future(series_id, start):
        return [("2099-01-02", 70.0), ("2099-01-05", 71.5)] if series_id == "DCOILWTICO" else stub(series_id, start)

    monkeypatch.setattr(desk_history, "fred_daily", wti_all_future)
    with caplog.at_level(logging.WARNING, logger="mrr.desk_history"):
        out = desk_history.refresh(db, now=NOW, tier=2)
    assert out["failed"] == ["DCOILWTICO"] and out["excluded"] == {"DCOILWTICO": 2}
    assert set(TIER1) <= set(out["stored"]) and "^NDX" in out["stored"], "the run went on"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, raw, reason FROM desk_series_quarantine ORDER BY date").fetchall()
    finally:
        c.close()
    assert [r[:4] for r in q] == [("DCOILWTICO", "2099-01-02", 70.0, "70.0"), ("DCOILWTICO", "2099-01-05", 71.5, "71.5")]
    assert all(r[4].startswith("served, dated after 2026-09-21") for r in q)
    wm = _wm(db)
    assert wm["desk:DCOILWTICO"]["status"] == "error"
    # the wording both stores share since Codex R-10
    assert wm["desk:DCOILWTICO"]["detail"] == "served only future-dated rows: 2 quarantined", wm["desk:DCOILWTICO"]
    assert "empty" not in wm["desk_series"]["detail"]
    assert any("served only future-dated rows" in r.getMessage() and "DCOILWTICO" in r.getMessage() for r in caplog.records), caplog.text


# ── desk/hardening, Codex round 4 ────────────────────────────────────────────

def test_a_failed_release_rolls_that_series_back_and_every_later_series_still_stores(tmp_path, fred, providers, monkeypatch):
    """Codex R-08: when WTI's RELEASE failed ("database is locked"), its savepoint
    stayed open, every later series was written inside it, and closing the
    connection rolled them all back, while the store reported them stored. A
    RELEASE that fails now rolls that savepoint back and closes it, the series
    is failed, and the connection is back outside any transaction before the
    next series: the rest store, their watermarks advance, and what the store
    reports is what the database holds."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=2)
    before = _rows(db)
    state = {"series": None, "raised": False}
    real_write = desk_history.write_series

    def tracking_write(conn, series_id, rows, **kw):
        state["series"] = series_id
        return real_write(conn, series_id, rows, **kw)

    class LocksOnWtiRelease(sqlite3.Connection):
        def execute(self, sql, *args):
            if sql.lstrip().upper().startswith("RELEASE") and state["series"] == "DCOILWTICO" and not state["raised"]:
                state["raised"] = True
                raise sqlite3.OperationalError("database is locked")
            return super().execute(sql, *args)

    monkeypatch.setattr(desk_history, "write_series", tracking_write)
    monkeypatch.setattr(desk_history, "_connect", lambda p: sqlite3.connect(p, isolation_level=None, factory=LocksOnWtiRelease))
    fred.end[""] = "2026-09-21"
    later = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)  # Tuesday before the open: the 21st is complete
    out = desk_history.refresh(db, now=later, tier=2)
    assert state["raised"], "the injected RELEASE failure fired"
    assert out["failed"] == ["DCOILWTICO"] and out["stored"] == TIER1 + ["^NDX", "DX-Y.NYB", "JPY=X"], out
    rows = _rows(db)
    assert rows["DCOILWTICO"] == before["DCOILWTICO"], "WTI rolled back to its previous rows"
    for sid in out["stored"]:
        assert rows[sid]["last"] == "2026-09-21", (sid, rows[sid], "reported stored, so it must be in the database")
    wm = _wm(db)
    assert wm["desk:DCOILWTICO"]["status"] == "error" and wm["desk:DCOILWTICO"]["detail"] == "write failed: OperationalError"
    for sid in out["stored"]:
        assert wm[f"desk:{sid}"]["last_obs"] == "2026-09-21" and wm[f"desk:{sid}"]["checked_at"] == "2026-09-22T12:00:00Z", sid
    assert wm["desk_series"]["status"] == "partial" and wm["desk_series"]["checked_at"] == "2026-09-22T12:00:00Z"
    assert "DCOILWTICO (write failed: OperationalError)" in wm["desk_series"]["detail"]


def test_market_series_serving_only_future_dates_are_quarantined_not_empty(tmp_path, fred, providers, monkeypatch):
    """Codex R-10: a market provider's future-dated rows were cut by the
    last-session and fixing-time filters before the future split, so they
    were never quarantined and an all-future response failed as "empty". They
    are now split off the raw response first and quarantined, the path FRED
    rows take (V-16)."""
    db = tmp_path / "t.db"
    stub = market.daily_history

    def only_2099(eodhd_code, yahoo_code, start, end=None, *, allow_yahoo=False):
        if yahoo_code in ("^NDX", "DX-Y.NYB", "JPY=X"):
            return {"provider": "eodhd", "fallback_used": False, "fallback_reason": None,
                    "rows": [("2099-01-02", 101.0), ("2099-01-05", 102.5)]}
        return stub(eodhd_code, yahoo_code, start, end, allow_yahoo=allow_yahoo)

    monkeypatch.setattr(market, "daily_history", only_2099)
    out = desk_history.refresh(db, now=NOW, tier=2)
    markets = ["DX-Y.NYB", "JPY=X", "^NDX"]
    assert out["failed"] == markets and out["excluded"] == {sid: 2 for sid in markets}, out
    assert set(TIER1 + ["DCOILWTICO"]) <= set(out["stored"])
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, reason FROM desk_series_quarantine ORDER BY series_id, date").fetchall()
    finally:
        c.close()
    assert [r[:3] for r in q] == [(sid, d, v) for sid in markets for d, v in (("2099-01-02", 101.0), ("2099-01-05", 102.5))], q
    assert all(r[3].startswith("served, dated after 2026-09-21") for r in q)
    wm = _wm(db)
    for sid in markets:
        assert wm[f"desk:{sid}"]["status"] == "error" and wm[f"desk:{sid}"]["detail"] == "served only future-dated rows: 2 quarantined", wm[f"desk:{sid}"]
    assert "empty" not in wm["desk_series"]["detail"]


# ── desk/hardening, verifier round 8: V-31, the provider's own trading day ───

EVENING = datetime(2026, 9, 22, 0, 23, tzinfo=timezone.utc)  # the 00:23 UTC full run: 20:23 ET Monday, 01:23 Tuesday in London


def _fx_days(last_completed: str, in_progress: str) -> list[tuple[str, float]]:
    """A round-the-clock provider's answer in the New York evening: every
    completed day, then the bar in progress, dated the next day in London."""
    return [(d, 140.0 + i * 0.01) for i, d in enumerate(_bdays("2020-01-02", last_completed))] + [(in_progress, 149.9)]


def test_every_series_declares_its_providers_day_and_it_is_never_before_new_yorks():
    """V-31: a series' current trading day at its provider is New York's date,
    or the date in Tokyo for an instrument traded round the clock; the start
    of run's scan relies on no day being earlier than New York's."""
    from zoneinfo import ZoneInfo

    assert {s.day_zone for s in registry.SERIES} == {registry.NY_ZONE, registry.ROUND_THE_CLOCK_ZONE}
    assert [s.series_id for s in registry.fetched(2) if s.day_zone != registry.NY_ZONE] == ["DX-Y.NYB", "JPY=X"]
    for s in registry.SERIES:
        ZoneInfo(s.day_zone)
    at = {sid: desk_history.provider_day(registry.BY_SERIES_ID[sid], EVENING) for sid in TIER1 + TIER2}
    assert at == {**{sid: "2026-09-21" for sid in TIER1 + ["DCOILWTICO", "^NDX"]}, "DX-Y.NYB": "2026-09-22", "JPY=X": "2026-09-22"}


def test_the_evening_run_drops_the_in_progress_fx_bar_and_quarantines_nothing(tmp_path, fred, providers, monkeypatch, caplog):
    """Verifier V-31, a regression from Codex R-10: the evening full run
    (00:23 UTC: London has rolled over to Tuesday, New York has not) is
    served USD/JPY's and the dollar index's bar in progress, dated Tuesday.
    R-10 called it future-dated against New York's Monday and quarantined it
    every evening, with an `excluded` watermark. It is not after the
    provider's own trading day, so it goes to the session filter and is
    dropped, as before R-10: nothing quarantined, nothing warned, and two
    evenings in a row leave no row behind. Monday's bar is stored once its
    fixing time has passed."""
    import logging

    db = tmp_path / "t.db"
    stub = market.daily_history
    day = {}

    def in_the_evening(eodhd_code, yahoo_code, start, end=None, *, allow_yahoo=False):
        if yahoo_code in ("DX-Y.NYB", "JPY=X"):
            return {"provider": "eodhd", "fallback_used": False, "fallback_reason": None,
                    "rows": _fx_days(day["completed"], day["in_progress"])}
        return stub(eodhd_code, yahoo_code, start, end, allow_yahoo=allow_yahoo)

    monkeypatch.setattr(market, "daily_history", in_the_evening)
    caplog.set_level(logging.WARNING, logger=desk_history.log.name)
    for now, completed, in_progress in ((EVENING, "2026-09-21", "2026-09-22"),
                                        (EVENING + timedelta(days=1), "2026-09-22", "2026-09-23")):
        day.update(completed=completed, in_progress=in_progress)
        out = desk_history.refresh(db, now=now, tier=2)
        assert out["failed"] == [] and out["excluded"] == {}, out
        assert set(TIER1 + TIER2) <= set(out["stored"])
        rows = _rows(db)
        assert rows["JPY=X"]["last"] == completed and rows["DX-Y.NYB"]["last"] == completed, rows
        wm = _wm(db)
        for sid in ("DX-Y.NYB", "JPY=X"):
            assert wm[f"desk:{sid}"]["status"] != "excluded" and "dated after" not in wm[f"desk:{sid}"]["detail"], wm[f"desk:{sid}"]
            assert wm[f"desk:{sid}"]["last_obs"] == completed
        assert "future-dated" not in wm["desk_series"]["detail"], wm["desk_series"]
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        has_q = c.execute("SELECT 1 FROM sqlite_master WHERE name = 'desk_series_quarantine'").fetchone()
        q = c.execute("SELECT series_id, date FROM desk_series_quarantine").fetchall() if has_q else []
        in_store = c.execute("SELECT COUNT(*) FROM desk_series WHERE date > '2026-09-22'").fetchone()[0]
    finally:
        c.close()
    assert q == [], "no in-progress bar accumulates in the quarantine"
    assert in_store == 0, "and none is stored"
    assert [r.getMessage() for r in caplog.records if r.name == desk_history.log.name] == []


def test_the_evening_run_still_quarantines_a_row_past_the_providers_own_day(tmp_path, fred, providers, monkeypatch):
    """V-31: a row dated after the provider's own trading day is future-dated
    still. At the same evening hour USD/JPY, served its bar in progress and a
    2099 row, quarantines the 2099 row alone and says so against its own day;
    the completed days are stored."""
    db = tmp_path / "t.db"
    stub = market.daily_history

    def with_2099(eodhd_code, yahoo_code, start, end=None, *, allow_yahoo=False):
        if yahoo_code == "JPY=X":
            return {"provider": "eodhd", "fallback_used": False, "fallback_reason": None,
                    "rows": _fx_days("2026-09-21", "2026-09-22") + [("2099-01-02", 150.0)]}
        return stub(eodhd_code, yahoo_code, start, end, allow_yahoo=allow_yahoo)

    monkeypatch.setattr(market, "daily_history", with_2099)
    out = desk_history.refresh(db, now=EVENING, tier=2)
    assert out["excluded"] == {"JPY=X": 1} and "JPY=X" in out["stored"], out
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, reason FROM desk_series_quarantine").fetchall()
    finally:
        c.close()
    assert q == [("JPY=X", "2099-01-02", 150.0,
                  "served, dated after 2026-09-22, its provider's current trading day (the date in Asia/Tokyo)")], q
    assert _rows(db)["JPY=X"]["last"] == "2026-09-21"
    wm = _wm(db)["desk:JPY=X"]
    assert wm["status"] == "short" and "1 row dated after 2026-09-22 excluded, moved to desk_series_quarantine (tier 2)" in wm["detail"], wm


# ── desk/hardening, Codex round 5: R-16, stored market rows are judged as completed sessions ──

def test_a_stored_fx_row_for_an_unfinished_session_never_reads_after_a_failed_fetch(tmp_path, fred, providers):
    """Codex R-16, Codex's repro: DXY and USD/JPY seeded with valid 09-18 and
    09-21 rows and a 09-22 row valued 999, no per-series watermark, both
    providers failing at the evening run (2026-09-22T00:23Z) and the morning
    run (11:17Z). The run-start scan judged stored rows by the provider's day
    (Tokyo's 09-22), so neither run moved them, and the morning reader returned
    999, before either series' 09-22 fixing, with no exclusion counted. A stored
    market row is now judged as a completed session whatever the provider's
    day: the evening run moves each 999 row to the quarantine and counts one
    exclusion per series, and the morning reader returns the 09-21 close. The
    reader on its own sets such a row aside too: provenance back-fills a
    pre-provenance store with the run dated the migration's New York date."""
    from api import provenance
    from src.desk import event_study as es

    db = tmp_path / "t.db"
    seed = [(sid, d, v, "eodhd") for sid in ("DX-Y.NYB", "JPY=X") for d, v in (("2026-09-18", 100.0), ("2026-09-21", 101.0), ("2026-09-22", 999.0))]
    _seed(db, seed)
    reader_only = tmp_path / "reader.db"
    _seed(reader_only, seed)
    providers.broken.update({"DX-Y.NYB", "JPY=X"})
    morning = datetime(2026, 9, 22, 11, 17, tzinfo=timezone.utc)  # 07:17 ET: before either series' 09-22 fixing
    evening_run = desk_history.refresh(db, now=EVENING, tier=2)
    evening_wm = _wm(db)
    morning_run = desk_history.refresh(db, now=morning, tier=2)
    assert evening_run["excluded"] == {"DX-Y.NYB": 1, "JPY=X": 1} and morning_run["excluded"] == {}, (evening_run, morning_run)
    assert {"DX-Y.NYB", "JPY=X"} <= set(evening_run["failed"]) and {"DX-Y.NYB", "JPY=X"} <= set(morning_run["failed"])
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        q = c.execute("SELECT series_id, date, value, reason FROM desk_series_quarantine ORDER BY series_id").fetchall()
        assert q == [(sid, "2026-09-22", 999.0, "stored, dated after 2026-09-21, the last completed session") for sid in ("DX-Y.NYB", "JPY=X")], q
        for key in ("dxy", "usdjpy"):
            s = es.load_level(c, registry.get(key), "2026-09-22")
            assert 999.0 not in s.to_numpy() and s.iloc[-1] == 101.0 and s.index.max().strftime("%Y-%m-%d") == "2026-09-21", (key, s.tail(2))
    finally:
        c.close()
    for sid in ("DX-Y.NYB", "JPY=X"):  # the evening run said what it moved
        assert "1 row dated after 2026-09-21 moved to desk_series_quarantine" in evening_wm[f"desk:{sid}"]["detail"], evening_wm[f"desk:{sid}"]
    # the reader alone, on the same seed migrated at the evening run's instant: no 999, one exclusion
    c = sqlite3.connect(reader_only)
    provenance.migrate(c, EVENING)
    c.commit()
    try:
        for key in ("dxy", "usdjpy"):
            s = es.load_level(c, registry.get(key), "2026-09-22")
            assert 999.0 not in s.to_numpy() and s.attrs["future_excluded"] == 1 and s.attrs["after_run_dates"] == ["2026-09-21"], (key, s.attrs)
    finally:
        c.close()


# ── desk/hardening, verifier round 11: V-37, a repair that would empty a series ──

def _series_state(db: Path, series_id: str) -> tuple:
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = c.execute("SELECT COUNT(*) FROM desk_series WHERE series_id = ?", (series_id,)).fetchone()[0]
        has_q = c.execute("SELECT 1 FROM sqlite_master WHERE name = 'desk_series_quarantine'").fetchone()
        q = c.execute("SELECT COUNT(*) FROM desk_series_quarantine WHERE series_id = ?", (series_id,)).fetchone()[0] if has_q else 0
        wm = c.execute("SELECT last_obs, status FROM source_watermarks WHERE source = ?", (f"desk:{series_id}",)).fetchone()
    finally:
        c.close()
    return rows, q, wm


# ── desk/hardening, Codex round 6: R-19 (writes carry provenance), R-21 and R-22 (repair) ──

def _dgs10(conn) -> tuple:
    return conn.execute("SELECT value, run_id, ingested_at FROM desk_series WHERE series_id = 'DGS10' AND date = '2026-09-04'").fetchone()


def test_a_write_to_a_table_with_provenance_requires_it(tmp_path):
    """Codex R-19, Codex's repro: committed DGS10/2026-09-04 = 4.0, then
    `write_series(..., [("2026-09-04", 99.0)], merge=True)` without provenance.
    The value became 99.0 under the first run's run_id and ingested_at, and the
    engine read it with no exclusion. On a table with provenance, a write
    without it now raises before it touches anything, a merge or a replace
    alike; with provenance it writes 99.0 stamped with the new run."""
    from api import provenance
    from src.desk import event_study as es

    conn = desk_history._connect(tmp_path / "t.db")
    try:
        desk_history.ensure_table(conn)
        provenance.migrate(conn, NOW)
        run1, _ = provenance.start_run(conn, NOW)
        desk_history.write_series(conn, "DGS10", [("2026-09-04", 4.0)], provider="fred", merge=True, run_id=run1, ingested_at="2026-09-21T12:00:00Z")
        provenance.mark_committed(conn, run1, NOW)
        before = _dgs10(conn)
        assert before == (4.0, run1, "2026-09-21T12:00:00Z")
        for merge in (True, False):
            with pytest.raises(desk_history.ProvenanceRequired):
                desk_history.write_series(conn, "DGS10", [("2026-09-04", 99.0)], provider="test", merge=merge)
            assert _dgs10(conn) == before, "nothing was written or deleted"
        later = NOW + timedelta(days=1)
        run2, _ = provenance.start_run(conn, later)
        desk_history.write_series(conn, "DGS10", [("2026-09-04", 99.0)], provider="test", merge=True, run_id=run2, ingested_at="2026-09-22T12:00:00Z")
        provenance.mark_committed(conn, run2, later)
        assert _dgs10(conn) == (99.0, run2, "2026-09-22T12:00:00Z")
        s = es.load_level(conn, registry.get("us10y"), "2026-09-22")
        assert s.iloc[-1] == 99.0 and s.attrs["no_provenance_excluded"] == 0
    finally:
        conn.close()
    # a table not yet migrated takes an unstamped write (a synthetic store), never a stamped one
    legacy = sqlite3.connect(tmp_path / "legacy.db")
    desk_history.ensure_table(legacy)
    assert desk_history.write_series(legacy, "DGS10", [("2026-09-04", 4.0)], provider="fred", merge=True) == 1
    with pytest.raises(desk_history.ProvenanceRequired):
        desk_history.write_series(legacy, "DGS10", [("2026-09-04", 4.0)], provider="fred", merge=True, run_id="r", ingested_at="t")
    legacy.close()


def _hy_store(tmp_path, name: str) -> Path:
    """Codex's R-21 store: 186 HY OAS rows through 2026-09-03, migrated at 2026-09-05 22:00 UTC."""
    from datetime import datetime as _dt

    from api import provenance
    from tests.test_validate_db import _desk_rows, _make

    path = tmp_path / name
    _make(path)
    _desk_rows(path, {"BAMLH0A0HYM2": ("fred", "2026-09-03", 186)})
    c = sqlite3.connect(path)
    provenance.migrate(c, _dt(2026, 9, 5, 22, 0, tzinfo=timezone.utc))
    c.commit()
    c.close()
    return path


R21_NOW = datetime(2026, 9, 5, 22, 0, tzinfo=timezone.utc)


def test_a_repair_moving_most_of_a_series_refuses_without_force(tmp_path, capsys):
    """Codex R-21, Codex's two cases. The V-37 guard keyed on "no row has
    provenance": with one of 186 HY OAS rows' provenance left, 185 moved; with
    every row committed by a run dated before them all, all 186 moved; neither
    refused. It now keys on what moves: more than 10% of the series needs
    --force, and the refusal says how many rows would move and how many remain."""
    one_left = _hy_store(tmp_path, "one_left.db")
    c = sqlite3.connect(one_left)
    c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = 'BAMLH0A0HYM2' "
              "AND date <> (SELECT MAX(date) FROM desk_series WHERE series_id = 'BAMLH0A0HYM2')")
    c.commit()
    c.close()
    all_after_run = _hy_store(tmp_path, "all_after_run.db")
    c = sqlite3.connect(all_after_run)
    c.execute("UPDATE desk_series_runs SET as_of = '2020-01-01'")
    c.commit()
    c.close()
    for path, moved, left in ((one_left, 185, 1), (all_after_run, 186, 0)):
        before = _series_state(path, "BAMLH0A0HYM2")
        out = desk_history.repair(path, "BAMLH0A0HYM2", apply=True, now=R21_NOW)
        assert out["refused"] and out["applied"] is False, out
        assert out["reason"] == (f"refused: it would move {moved} of the 186 rows of BAMLH0A0HYM2 ({moved / 186:.1%}), leaving {left}. "
                                 "Pass --force to move them anyway"), out["reason"]
        assert _series_state(path, "BAMLH0A0HYM2") == before, "nothing moved"
    # --force moves them; with no committed row left the watermark is left unchanged, and says so
    forced = desk_history.repair(all_after_run, "BAMLH0A0HYM2", apply=True, force=True, now=R21_NOW)
    assert forced["applied"] and forced["result"] == "moved 186 rows to desk_series_quarantine; watermark left unchanged: no committed row remains"
    assert _series_state(all_after_run, "BAMLH0A0HYM2")[:2] == (0, 186)
    # the CLI: exit 1 on a refusal
    assert desk_history.main(["--db", str(one_left), "--repair", "BAMLH0A0HYM2", "--apply"]) == 1
    assert "refused: it would move 185 of the 186 rows of BAMLH0A0HYM2 (99.5%), leaving 1" in capsys.readouterr().out


def test_a_repair_moving_rows_the_provider_cannot_serve_again_warns_and_refuses_without_force(tmp_path, fred, providers):
    """Codex R-21: moving rows older than the provider's window refuses without
    --force, however few, since FRED serves HY OAS as a rolling three years and
    such a row would exist only in the quarantine; the warning is printed on
    the dry run, the refusal and the forced apply alike. A small repair of rows
    the provider still serves needs neither (a bogus print, R-15)."""
    db = tmp_path / "t.db"
    desk_history.refresh(db, now=NOW, tier=1)
    n = _strip_provenance_before(db, "BAMLH0A0HYM2", "2023-10-20")  # 19 of about 780 rows, 2.4%
    later = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)  # FRED's window now starts 2023-10-15
    warning = (f"WARNING 15 of the {n} rows it moves are dated before 2023-10-15: FRED serves HY OAS as a rolling three-year window, "
               "so they cannot be fetched again and would exist only in desk_series_quarantine")
    dry = desk_history.repair(db, "BAMLH0A0HYM2", now=later)
    assert dry["refused"] and dry["unrefetchable"] == 15 and dry["reason"].startswith("dry run, nothing written: --apply would refuse"), dry
    out = desk_history.repair(db, "BAMLH0A0HYM2", apply=True, now=later)
    assert out["refused"] and warning[len("WARNING "):] in out["reason"], out["reason"]
    assert _series_state(db, "BAMLH0A0HYM2")[1] == 0, "nothing moved"
    forced = desk_history.repair(db, "BAMLH0A0HYM2", apply=True, force=True, now=later)
    assert forced["applied"] and forced["warning"] == warning[len("WARNING "):], forced
    assert _series_state(db, "BAMLH0A0HYM2")[1] == n
    # a small repair of rows the provider still serves: no --force, no warning
    c = sqlite3.connect(db)
    c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = 'DGS2' AND date = '2026-09-18'")
    c.commit()
    c.close()
    small = desk_history.repair(db, "DGS2", apply=True, now=later)
    assert small["applied"] and "warning" not in small and "refused" not in small, small


def _strip_provenance_before(db: Path, series_id: str, before: str) -> int:
    c = sqlite3.connect(db)
    n = c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = ? AND date < ?", (series_id, before)).rowcount
    c.commit()
    c.close()
    return n


def test_a_dry_run_repair_previews_what_apply_does_on_a_legacy_table(tmp_path):
    """Codex R-22, Codex's repro: a legacy four-column table with DGS10 rows dated
    2026-09-04 and 2099-01-01, the clock at 2026-09-05. The dry run reported
    zero rows ("no provenance in this database yet") while --apply migrated
    the table, quarantined the 2099 row and reset the watermark. The dry run is
    now the repair itself on an in-memory copy, the migration included: it
    reports the 2099 row and the watermark reset, and the file is only read.
    (1 of 2 rows is over the 10% share, so both runs take --force, R-21.)"""
    db = tmp_path / "legacy.db"
    c = sqlite3.connect(db)
    desk_history.ensure_table(c)
    c.executemany("INSERT INTO desk_series VALUES ('DGS10', ?, ?, 'fred')", [("2026-09-04", 4.0), ("2099-01-01", 99.0)])
    c.commit()
    c.close()
    now = datetime(2026, 9, 5, 22, 0, tzinfo=timezone.utc)

    def legacy_untouched():
        c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            cols = [r[1] for r in c.execute("PRAGMA table_info(desk_series)")]
            rows = c.execute("SELECT date, value FROM desk_series ORDER BY date").fetchall()
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finally:
            c.close()
        return cols == ["series_id", "date", "value", "provider"] and rows == [("2026-09-04", 4.0), ("2099-01-01", 99.0)] \
            and "desk_series_quarantine" not in tables and "desk_series_runs" not in tables

    refused = desk_history.repair(db, "DGS10", now=now)
    assert refused["rows"] == [("2099-01-01", 99.0, "pre-provenance")] and refused["refused"], refused
    dry = desk_history.repair(db, "DGS10", force=True, now=now)
    assert dry["rows"] == [("2099-01-01", 99.0, "pre-provenance")] and dry["newest"] == "2026-09-04" and dry["applied"] is False
    assert dry["result"] == ("dry run, nothing written: --apply would move 1 row to desk_series_quarantine and reset the watermark "
                             "to 2026-09-04, the newest committed row"), dry["result"]
    assert legacy_untouched(), "the dry run only read the file"
    applied = desk_history.repair(db, "DGS10", apply=True, force=True, now=now)
    assert applied["rows"] == dry["rows"] and applied["newest"] == dry["newest"] == "2026-09-04"
    assert applied["result"] == "moved 1 row to desk_series_quarantine; watermark reset to 2026-09-04, the newest committed row"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        assert c.execute("SELECT date FROM desk_series_quarantine WHERE series_id = 'DGS10'").fetchall() == [("2099-01-01",)]
        assert c.execute("SELECT last_obs, status FROM source_watermarks WHERE source = 'desk:DGS10'").fetchone() == ("2026-09-04", "repaired")
    finally:
        c.close()


def test_the_repair_states_its_share_exactly_takes_the_safer_leap_day_window_and_refuses_a_missing_path(tmp_path, capsys):
    """Verifier V-41: (1) the refusal printed the share rounded to a whole
    percent, so 19 of 186 read "(10%)" against a rule of more than 10%; it is
    one decimal now, "(10.2%)". (2) On 29 February the HY OAS window started on
    28 February three years back, the less conservative day; it starts on
    1 March. (3) A repair of a missing path raised a traceback on the dry run,
    and --apply created an empty database; both refuse now, with exit 1, and
    no file is created."""
    path = _hy_store(tmp_path, "share.db")
    c = sqlite3.connect(path)
    c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = 'BAMLH0A0HYM2' AND date IN "
              "(SELECT date FROM desk_series WHERE series_id = 'BAMLH0A0HYM2' ORDER BY date DESC LIMIT 19)")
    c.commit()
    c.close()
    out = desk_history.repair(path, "BAMLH0A0HYM2", apply=True, now=R21_NOW)
    assert "it would move 19 of the 186 rows of BAMLH0A0HYM2 (10.2%), leaving 167" in out["reason"], out["reason"]
    leap = datetime(2028, 2, 29, 17, 0, tzinfo=timezone.utc)
    assert desk_history._unrefetchable("BAMLH0A0HYM2", ["2025-02-28", "2025-03-01"], leap) == (1, "2025-03-01")
    assert desk_history._unrefetchable("BAMLH0A0HYM2", ["2025-02-28", "2025-03-01"], datetime(2028, 3, 1, 17, 0, tzinfo=timezone.utc)) == (1, "2025-03-01")
    missing = tmp_path / "nowhere" / "macro_radar.db"
    for args in (["--repair", "DGS10"], ["--repair", "DGS10", "--apply"], ["--repair", "DGS10", "--apply", "--force"]):
        assert desk_history.main(["--db", str(missing), *args]) == 1, args
        assert f"refused: there is no database at {missing}" in capsys.readouterr().out
    assert not missing.exists() and not missing.parent.exists()


# ── desk/hardening, Codex round 7: R-24 (the repair holds the write lock), R-25 (not SQLite) ──

def _race_store(tmp_path, name: str) -> tuple[Path, dict]:
    """Codex's R-24 store: 100 committed DGS10 rows and one without provenance, and
    the histories a concurrent refresh serves: those 100 plus 99 dated 2099."""
    from api import provenance
    from tests.test_validate_db import _make

    path = tmp_path / name
    _make(path)
    c = desk_history._connect(path)
    try:
        provenance.migrate(c, R21_NOW)
        c.execute("DELETE FROM desk_series WHERE series_id = 'DGS10'")
        good = [((date(2026, 1, 1) + timedelta(days=i)).isoformat(), 4.0) for i in range(100)]
        with desk_history._savepoint(c):
            rid, _ = provenance.start_run(c, R21_NOW)
            desk_history.write_series(c, "DGS10", good, provider="fred", merge=True, run_id=rid, ingested_at="2026-09-05T22:00:00Z")
            provenance.mark_committed(c, rid, R21_NOW)
        c.execute("INSERT INTO desk_series (series_id, date, value, provider) VALUES ('DGS10', '2026-09-03', 99.0, 'hand')")
        served = {sid: [(d, val)] for sid, d, val in c.execute("SELECT series_id, date, value FROM desk_series WHERE series_id <> 'DGS10'")}
    finally:
        c.close()
    served["DGS10"] = good + [((date(2099, 1, 1) + timedelta(days=i)).isoformat(), 99.0) for i in range(99)]
    return path, served


def _repair_with_a_concurrent_refresh(path: Path, served: dict, at: str) -> tuple[dict, dict]:
    """Run `--repair DGS10 --apply` (no --force) while a second connection's real
    refresh runs at the moment the repair's connection is about to execute `at`."""
    state: dict = {"fired": False, "error": None}
    real_connect = desk_history._connect

    class Hook:
        def __init__(self, inner):
            self.c = inner

        def execute(self, sql, *args, **kwargs):
            if sql.startswith(at) and not state["fired"]:
                state["fired"] = True
                with pytest.MonkeyPatch.context() as mp:
                    mp.setattr(desk_history, "fred_daily", lambda sid, start: served[sid])
                    mp.setattr(desk_history, "_connect", lambda p: sqlite3.connect(p, isolation_level=None, timeout=0.2))
                    try:
                        state["refresh"] = desk_history.refresh(path, now=R21_NOW, tier=1)
                    except sqlite3.OperationalError as exc:  # the repair holds the write lock
                        state["error"] = str(exc)
            return self.c.execute(sql, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.c, name)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(desk_history, "_connect", lambda p: Hook(real_connect(p)))
        out = desk_history.repair(path, "DGS10", apply=True, now=R21_NOW)
    return out, state


def _dgs10_counts(path: Path) -> tuple[int, int]:
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        kept = c.execute("SELECT COUNT(*) FROM desk_series WHERE series_id = 'DGS10'").fetchone()[0]
        has_q = c.execute("SELECT 1 FROM sqlite_master WHERE name = 'desk_series_quarantine'").fetchone()
        moved = c.execute("SELECT COUNT(*) FROM desk_series_quarantine WHERE series_id = 'DGS10'").fetchone()[0] if has_q else 0
    finally:
        c.close()
    return kept, moved


def test_a_repair_moves_exactly_the_rows_it_checked_whatever_a_concurrent_refresh_does(tmp_path):
    """Codex R-24, Codex's repro: 100 committed DGS10 rows and one without
    provenance, and a second connection's real refresh that writes 99 rows dated
    2099 just before the repair's savepoint. The repair checked its guard, then
    reselected while it moved: it reported 1 row moved out of 101, and moved 100
    of 200. It now takes the write lock (BEGIN IMMEDIATE) before it selects
    anything, and moves exactly the set it checked:
    - the refresh at the savepoint cannot write (the database is locked), and the
      repair moves the one row it reported;
    - a refresh that lands before the repair begins is seen by its check: 100 of
      200 rows would move, over the 10% share, so it refuses and moves nothing."""
    path, served = _race_store(tmp_path, "at_savepoint.db")
    out, state = _repair_with_a_concurrent_refresh(path, served, "SAVEPOINT desk_series_repair")
    assert state["fired"] and "locked" in (state["error"] or ""), state
    assert not out.get("refused") and out["rows"] == [("2026-09-03", 99.0, None)] and out["total"] == 101, out
    assert _dgs10_counts(path) == (100, 1), "moved exactly the set it reported, never more"
    path, served = _race_store(tmp_path, "before_begin.db")
    out, state = _repair_with_a_concurrent_refresh(path, served, "BEGIN IMMEDIATE")
    assert state["fired"] and state["error"] is None and state["refresh"]["failed"] == [], state
    assert out["refused"] and out["reason"].startswith("refused: it would move 100 of the 200 rows of DGS10 (50.0%)"), out
    assert _dgs10_counts(path) == (200, 0), "refused: nothing moved"


def test_a_repair_refuses_a_file_that_is_not_a_sqlite_database(tmp_path, capsys):
    """Codex R-25 (V-42): an existing file that is not SQLite passed the path
    check and raised "file is not a database". Both the dry run and --apply now
    refuse, "not a SQLite database", with exit 1, and leave the file as it was."""
    import hashlib

    readme = ROOT / "README.md"
    before = hashlib.sha256(readme.read_bytes()).hexdigest()
    for args in (["--repair", "DGS2"], ["--repair", "DGS2", "--apply"], ["--repair", "DGS2", "--apply", "--force"]):
        assert desk_history.main(["--db", str(readme), *args]) == 1, args
        assert f"refused: {readme} is not a SQLite database" in capsys.readouterr().out
    for apply in (False, True):
        r = desk_history.repair(readme, "DGS2", apply=apply)
        assert r["refused"] and r["not_sqlite"] and r["applied"] is False
    assert hashlib.sha256(readme.read_bytes()).hexdigest() == before, "the file is untouched"


# ── desk/hardening, Codex round 8: R-28 (a lock), R-29 (an unreadable file) ──

def _hashed(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_a_repair_that_cannot_take_the_lock_refuses_in_both_modes(tmp_path, monkeypatch, capsys):
    """Codex R-28 (V-44): another writer holding the database made the repair's
    BEGIN IMMEDIATE raise "database is locked" after the busy timeout. It now
    refuses, "the database is locked by another writer; nothing changed; retry",
    with exit 1: --apply against a writer holding BEGIN IMMEDIATE, and the dry run
    against one holding BEGIN EXCLUSIVE (which blocks its read of the file)."""
    monkeypatch.setattr(desk_history, "REPAIR_LOCK_WAIT_S", 0.2)
    path, _ = _race_store(tmp_path, "locked.db")
    before = _hashed(path)
    for hold, args in (("BEGIN IMMEDIATE", ["--repair", "DGS10", "--apply"]), ("BEGIN EXCLUSIVE", ["--repair", "DGS10"])):
        blocker = sqlite3.connect(path, isolation_level=None)
        blocker.execute(hold)
        try:
            assert desk_history.main(["--db", str(path), *args]) == 1, args
            assert "refused: the database is locked by another writer; nothing changed; retry" in capsys.readouterr().out
        finally:
            blocker.execute("ROLLBACK")
            blocker.close()
    assert _hashed(path) == before, "nothing changed"


def test_a_repair_of_an_unreadable_database_refuses_in_both_modes(tmp_path, capsys):
    """Codex R-29 (V-45): a database whose header is valid but whose schema page is
    damaged passed the header check and raised "database disk image is
    malformed". Both modes now refuse, "database unreadable: <SQLite's words>;
    nothing changed", with exit 1, and the file is untouched."""
    path, _ = _race_store(tmp_path, "damaged.db")
    raw = bytearray(path.read_bytes())
    raw[100:4096] = bytes([0xFF]) * (4096 - 100)  # the first page's contents after the header
    path.write_bytes(bytes(raw))
    assert raw[:16] == desk_history.SQLITE_HEADER
    before = _hashed(path)
    for args in (["--repair", "DGS10"], ["--repair", "DGS10", "--apply"]):
        assert desk_history.main(["--db", str(path), *args]) == 1, args
        out = capsys.readouterr().out
        assert "refused: database unreadable: " in out and "; nothing changed" in out, out
    assert _hashed(path) == before, "the file is untouched"


def test_the_three_curve_tenors_are_stored_as_tier_1_fred_series(tmp_path, fred, providers):
    """desk/frame-3-api (FRAME3_API_PLAN.md §4.5): DGS3MO, DGS5 and DGS30 are
    tier-1 FRED series in basis points like DGS10, with no role, so no study
    can select them. A tier-1 run fetches each from its declared start (FRED
    serves them from 1981-09-01, 1962-01-02 and 1977-02-15), stores it and
    records its `desk:<id>` watermark."""
    declared = {sid: (s.key, s.tier, s.source, s.unit, s.scale, s.history_from, s.roles, s.fixed, s.known)
                for sid in TENORS for s in [registry.BY_SERIES_ID[sid]]}
    assert declared == {
        "DGS3MO": ("us3m", 1, "fred", "bp", 100.0, "1981-09-01", (), ("close", -30), registry.NEXT_OPEN),
        "DGS5": ("us5y", 1, "fred", "bp", 100.0, "1962-01-02", (), ("close", -30), registry.NEXT_OPEN),
        "DGS30": ("us30y", 1, "fred", "bp", 100.0, "1977-02-15", (), ("close", -30), registry.NEXT_OPEN),
    }
    assert all(registry.BY_SERIES_ID[sid] in registry.fetched(1) and registry.stored_by_refresh(registry.BY_SERIES_ID[sid])
               for sid in TENORS)
    for role in registry.ROLES:
        assert not {s.series_id for s in registry.with_role(role)} & set(TENORS), role
    db = tmp_path / "t.db"
    out = desk_history.refresh(db, now=NOW, tier=1)
    assert out["status"] == "ok" and set(TENORS) <= set(out["stored"])
    calls = dict(fred.calls)
    assert {sid: calls[sid] for sid in TENORS} == {"DGS3MO": "1981-09-01", "DGS5": "1962-01-02", "DGS30": "1977-02-15"}
    rows = _rows(db)
    assert all(rows[sid]["provider"] == "fred" and rows[sid]["last"] == "2026-09-18" for sid in TENORS)
    wm = _wm(db)
    for sid in TENORS:
        assert wm[f"desk:{sid}"]["last_obs"] == "2026-09-18", sid
        assert wm[f"desk:{sid}"]["status"] == "short", sid  # the stub serves from 2020 only
