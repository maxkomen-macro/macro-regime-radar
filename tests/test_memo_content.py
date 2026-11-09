"""CS-2: what a queued memo shows (design .loop/design-CS2.md v16, sections 4 and 6).

scripts/memo_content.py (the price pin, the session-dated market metrics and the
market alert fix-up), src/utils/memo_clock.py, the daily memo's session loaders and
the weekly memo's session snapshot. Synthetic databases with invented prices
(.claude/rules/test-data.md)."""

from __future__ import annotations

import math
import random
import re
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import memo_content as mc  # noqa: E402
from src.market_data import session  # noqa: E402

UTC = timezone.utc


def test_the_window_constants_match_the_refresh_pipeline():
    from src.analytics import surprise

    assert (mc.ZSCORE_WINDOW, mc.MIN_PERIODS) == (surprise.ZSCORE_WINDOW, surprise.MIN_PERIODS)


# ── z-scores (DR-69, DR-70) ───────────────────────────────────────────────────


def exact_z(window: list[float]) -> float:
    xs = [Fraction(v) for v in window]
    n = len(xs)
    mu = sum(xs) / n
    var = sum((x - mu) ** 2 for x in xs) / (n - 1)
    num = xs[-1] - mu
    # sqrt of the exact variance, then the ratio, both rounded once
    return float(num) / math.sqrt(float(var)) if var else math.nan


def test_the_z_score_matches_exact_arithmetic():
    rng = random.Random(20261116)
    worst = 0.0
    for _ in range(400):
        n = rng.randint(26, 104)
        w = [rng.gauss(0.001, 0.02) for _ in range(n)]
        z, ref = mc.zscore(w), exact_z(w)
        worst = max(worst, abs(z - ref) / max(abs(ref), 1e-300))
    assert worst < 1e-13


def test_the_z_score_survives_extreme_scales_and_tiny_spreads():
    rng = random.Random(7)
    w = [rng.gauss(0, 1) for _ in range(60)]
    base = mc.zscore(w)
    for scale in (1e200, 1e-200, 2.0 ** 900, 2.0 ** -1000):
        got = mc.zscore([v * scale for v in w])
        assert got is not None and math.isfinite(got) and abs(got - base) / abs(base) < 1e-12, scale
    near = [1.0 + k * 2 ** -50 for k in range(30)]          # spread far below the mean's ulp-level noise
    assert abs(mc.zscore(near) - exact_z(near)) < 1e-12


@pytest.mark.parametrize("w", [[0.01] * 30, [0.0] * 30, [0.01] * 24 + [0.02], [0.01] * 29 + [math.nan],
                               [0.01] * 29 + [math.inf]])
def test_an_undefined_z_score_is_none(w):
    assert mc.zscore(w) is None


# ── weekly buckets, returns and the stored rows ──────────────────────────────


def sessions(first: date, last: date) -> list[date]:
    out, d = [], first
    while d <= last:
        if session.is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def invented_closes(days: list[date], seed=11, start=100.0) -> list[tuple[str, float]]:
    rng = random.Random(seed)
    c, out = start, []
    for d in days:
        c *= math.exp(rng.gauss(0.0003, 0.012))
        out.append((d.isoformat(), round(c, 4)))
    return out


def market_db(tmp_path: Path, series: dict[str, list[tuple[str, float]]]) -> sqlite3.Connection:
    conn = sqlite3.connect(tmp_path / "m.db")
    conn.execute("CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL)")
    conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL)")
    conn.execute("CREATE TABLE market_intraday (symbol TEXT, ts TEXT, close REAL)")
    conn.execute("CREATE TABLE derived_metrics (name TEXT, date TEXT, value REAL, computed_at TEXT)")
    for sym, rows in series.items():
        conn.executemany("INSERT INTO market_daily VALUES (?, ?, ?)", [(sym, d, c) for d, c in rows])
    conn.commit()
    return conn


P = date(2026, 11, 18)          # a Wednesday session: its W-FRI bucket is still open


def test_on_ordinary_data_the_pinned_bucket_equals_the_refresh_pipelines(tmp_path):
    from src.analytics.surprise import build_market_metrics

    days = sessions(date(2024, 9, 2), date(2026, 11, 24))
    conn = market_db(tmp_path, {"TST": invented_closes(days)})
    mc.pin(conn, P, ["TST"], [])
    assert conn.execute("SELECT MAX(date) FROM market_daily").fetchone()[0] == P.isoformat()
    ref = {(n, d): v for n, d, v in build_market_metrics(conn, ["TST"])}
    label = mc.friday(P).isoformat()
    m = mc.symbol_metrics(conn.execute("SELECT date, close FROM market_daily ORDER BY date").fetchall(), P)
    assert m["label"].isoformat() == label == "2026-11-20"
    assert m["obs"] == P and m["from"] == date(2026, 11, 13)
    assert m["ret"] == pytest.approx(ref[("TST_weekly_ret", label)], rel=1e-14)
    assert m["z"] == pytest.approx(ref[("TST_weekly_ret_z", label)], rel=1e-9)
    assert ref[("TST_weekly_ret_obs", label)] == float(P.toordinal())


def test_the_last_row_of_the_week_decides_and_an_invalid_one_is_never_replaced(tmp_path):
    days = sessions(date(2025, 11, 3), P)
    rows = invented_closes(days)
    assert mc.symbol_metrics(rows, P) is not None
    for bad in (0.0, -1.0, math.nan, math.inf, None):
        broken = rows[:-1] + [(P.isoformat(), bad)]
        assert mc.symbol_metrics(broken, P) is None, bad      # Monday/Tuesday's valid closes do not stand in
    # an invalid close in an earlier week drops two returns from the z window, not the bucket at P
    i = next(k for k, (d, _) in enumerate(rows) if d == "2026-06-05")
    holed = rows[:i] + [(rows[i][0], math.nan)] + rows[i + 1:]
    assert mc.symbol_metrics(holed, P)["z"] is not None


def test_a_week_with_no_rows_breaks_the_chain_instead_of_bridging_it():
    days = [d for d in sessions(date(2025, 11, 3), P) if not (date(2026, 11, 9) <= d <= date(2026, 11, 13))]
    rows = invented_closes(days)
    assert mc.symbol_metrics(rows, P) is None              # the week before P is missing: no defined return
    assert mc.symbol_metrics(rows, date(2026, 11, 6)) is not None


def test_too_short_a_history_or_no_row_in_the_week_of_p_stores_nothing():
    assert mc.symbol_metrics(invented_closes(sessions(date(2026, 6, 1), P)), P) is None    # fewer than 26 buckets
    rows = invented_closes(sessions(date(2025, 11, 3), date(2026, 11, 13)))
    assert mc.symbol_metrics(rows, P) is None


def test_store_market_metrics_keeps_only_the_bucket_at_p(tmp_path):
    days = sessions(date(2024, 9, 2), P)
    conn = market_db(tmp_path, {"SPY": invented_closes(days, 1), "HYG": invented_closes(days[-40:], 2)})
    conn.executemany("INSERT INTO derived_metrics VALUES (?, ?, ?, 'x')",
                     [("SPY_weekly_ret", "2026-11-13", 0.5), ("SPY_weekly_ret_z", "2026-11-27", 9.0),
                      ("HYG_weekly_ret", "2026-11-20", 0.1), ("DGS10_weekly_chg", "2026-11-20", 0.02)])
    msg = mc.store_market_metrics(conn, ["SPY", "HYG"], P)
    assert "1 symbols stored" in msg and "no defined return for HYG" in msg
    rows = conn.execute("SELECT name, date FROM derived_metrics ORDER BY name").fetchall()
    assert rows == [("DGS10_weekly_chg", "2026-11-20"), ("SPY_weekly_ret", "2026-11-20"),
                    ("SPY_weekly_ret_from", "2026-11-20"), ("SPY_weekly_ret_obs", "2026-11-20"),
                    ("SPY_weekly_ret_z", "2026-11-20")]
    frm = conn.execute("SELECT value FROM derived_metrics WHERE name = 'SPY_weekly_ret_from'").fetchone()[0]
    assert date.fromordinal(int(frm)) == date(2026, 11, 13)


def test_the_pin_removes_every_price_after_p_and_the_buckets_observed_after_it(tmp_path):
    conn = market_db(tmp_path, {"SPY": [("2026-11-17", 1.0), ("2026-11-18", 2.0), ("2026-11-19", 3.0)]})
    conn.executemany("INSERT INTO asset_prices VALUES ('GLD', ?, ?, 1.0)",
                     [("1d", "2026-11-18"), ("1d", "2026-11-19"), ("1mo", "2026-12-01")])
    conn.executemany("INSERT INTO market_intraday VALUES ('SPY', ?, 1.0)",
                     [("2026-11-18T20:55:00Z",), ("2026-11-19T14:30:00Z",)])
    o = lambda d: float(d.toordinal())  # noqa: E731
    conn.executemany("INSERT INTO derived_metrics VALUES (?, ?, ?, 'x')", [
        ("SPY_weekly_ret", "2026-11-20", 0.1), ("SPY_weekly_ret_obs", "2026-11-20", o(date(2026, 11, 19))),
        ("SPY_weekly_ret_z", "2026-11-20", 1.0),
        ("SPY_weekly_ret", "2026-11-13", 0.2), ("SPY_weekly_ret_obs", "2026-11-13", o(date(2026, 11, 13))),
        ("GLD_weekly_ret", "2026-11-20", 0.3), ("GLD_weekly_ret_obs", "2026-11-20", o(P)),
        ("UNRATE_weekly_chg", "2026-11-20", 0.1),
    ])
    mc.pin(conn, P, ["SPY"], ["GLD"])
    assert conn.execute("SELECT MAX(date) FROM market_daily").fetchone()[0] == "2026-11-18"
    assert conn.execute("SELECT date FROM asset_prices ORDER BY date").fetchall() == [("2026-11-18",)]
    assert conn.execute("SELECT ts FROM market_intraday").fetchall() == [("2026-11-18T20:55:00Z",)]
    left = {(n, d) for n, d in conn.execute("SELECT name, date FROM derived_metrics")}
    assert left == {("SPY_weekly_ret", "2026-11-13"), ("SPY_weekly_ret_obs", "2026-11-13"),
                    ("GLD_weekly_ret", "2026-11-20"), ("GLD_weekly_ret_obs", "2026-11-20"),
                    ("UNRATE_weekly_chg", "2026-11-20")}


# ── market alerts in the memo's copy (DR-67, DR-68) ───────────────────────────


def alerts_db(tmp_path, intervals: dict[str, tuple[date, date]]) -> sqlite3.Connection:
    conn = market_db(tmp_path, {})
    conn.execute("CREATE TABLE alert_feed (id INTEGER PRIMARY KEY, date TEXT, alert_type TEXT, name TEXT, "
                 "level TEXT, value REAL, message TEXT)")
    for sym, (frm, obs) in intervals.items():
        conn.executemany("INSERT INTO derived_metrics VALUES (?, '2026-11-20', ?, 'x')",
                         [(f"{sym}_weekly_ret_from", float(frm.toordinal())), (f"{sym}_weekly_ret_obs", float(obs.toordinal()))])
    conn.executemany("INSERT INTO alert_feed (date, alert_type, name, level, value, message) VALUES ('2026-11-20', ?, ?, 'risk', ?, ?)", [
        ("market", "SPY_drawdown", -0.051, "SPY weekly return -5.10% — risk-off pressure"),
        ("market", "credit_stress", -0.021, "HYG lagging SPY by 2.10% — credit stress"),
        ("market", "USD_breakout", 2.4, "UUP weekly z 2.40 — dollar breakout"),
        ("macro", "VIX_spike", 30.0, "VIX above 30"),
    ])
    conn.commit()
    return conn


def test_market_alerts_are_dated_and_worded_to_the_interval_they_measure(tmp_path):
    same = (date(2026, 11, 13), P)
    conn = alerts_db(tmp_path, {"SPY": same, "HYG": same, "UUP": (date(2026, 11, 12), date(2026, 11, 17))})
    assert mc.fix_market_alerts(conn, P) == ""
    got = {n: (d, m) for n, d, m in conn.execute("SELECT name, date, message FROM alert_feed")}
    assert got["SPY_drawdown"] == ("2026-11-18", "SPY return from 2026-11-13 to 2026-11-18 -5.10% — risk-off pressure")
    assert got["credit_stress"] == ("2026-11-18", "HYG underperformed SPY by -2.10% from 2026-11-13 to 2026-11-18 — credit stress")
    assert got["USD_breakout"] == ("2026-11-17", "UUP return from 2026-11-12 to 2026-11-17, z-score 2.40 — dollar breakout")
    assert got["VIX_spike"] == ("2026-11-20", "VIX above 30")


def test_the_credit_comparison_is_withdrawn_when_spy_and_hyg_cover_different_sessions(tmp_path):
    conn = alerts_db(tmp_path, {"SPY": (date(2026, 11, 13), P), "HYG": (date(2026, 11, 13), date(2026, 11, 17)),
                                "UUP": (date(2026, 11, 13), P)})
    note = mc.fix_market_alerts(conn, P)
    assert note == ("Credit comparison unavailable: SPY and HYG returns cover different sessions "
                    "(2026-11-13-2026-11-18, 2026-11-13-2026-11-17)")
    assert "credit_stress" not in {n for (n,) in conn.execute("SELECT name FROM alert_feed")}


def test_an_alert_without_a_stored_interval_stops_the_memo(tmp_path):
    conn = alerts_db(tmp_path, {"SPY": (date(2026, 11, 13), P), "HYG": (date(2026, 11, 13), P)})
    with pytest.raises(ValueError, match="USD_breakout has no stored interval"):
        mc.fix_market_alerts(conn, P)


# ── the content clock ─────────────────────────────────────────────────────────


def test_the_content_clock(monkeypatch):
    from src.utils.memo_clock import clock_set, memo_clock

    monkeypatch.delenv("MEMO_CLOCK", raising=False)
    assert not clock_set() and abs(memo_clock() - datetime.now(UTC)) < timedelta(seconds=5)
    monkeypatch.setenv("MEMO_CLOCK", "2026-11-17T02:00:00Z")
    assert clock_set() and memo_clock() == datetime(2026, 11, 17, 2, 0, tzinfo=UTC)
    monkeypatch.setenv("MEMO_CLOCK", "2026-11-16T21:00:00-05:00")
    assert memo_clock() == datetime(2026, 11, 17, 2, 0, tzinfo=UTC) and memo_clock().tzinfo == UTC
    monkeypatch.setenv("MEMO_CLOCK", "2026-11-17T02:00:00")
    with pytest.raises(ValueError, match="no time zone"):
        memo_clock()


def test_the_analytics_read_today_from_the_content_clock(monkeypatch):
    from src.analytics import priced

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL)")
    monkeypatch.setenv("MEMO_CLOCK", "2026-11-17T02:00:00Z")
    rows = priced.build_priced_metrics(conn)
    assert all(d <= "2026-11-17" for _, d, _ in rows)
    for mod in ("priced", "playbook", "alerts"):
        src = (ROOT / "src" / "analytics" / f"{mod}.py").read_text()
        assert "from src.utils.memo_clock import memo_clock" in src and "memo_clock()" in src, mod


# ── the daily memo at a session ───────────────────────────────────────────────


@pytest.fixture()
def daily(tmp_path, monkeypatch):
    from src import daily_memo as dm

    db = tmp_path / "d.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL)")
    conn.execute("CREATE TABLE derived_metrics (name TEXT, date TEXT, value REAL, computed_at TEXT)")
    conn.execute("CREATE TABLE news_feed (headline TEXT, summary TEXT, regime_interpretation TEXT, perplexity_research TEXT, "
                 "overall_significance REAL, published_at TEXT, source TEXT)")
    conn.execute("CREATE TABLE event_calendar (event_name TEXT, event_datetime TEXT, importance TEXT, source TEXT)")
    conn.commit()
    monkeypatch.setattr(dm, "DB_PATH", db)
    return dm, conn


def test_the_watchlist_reads_exactly_the_session_and_the_one_before(daily):
    dm, conn = daily
    p = date(2026, 11, 27)                                   # after Thanksgiving: the previous session is the 25th
    assert dm.previous_session(p) == date(2026, 11, 25)
    conn.executemany("INSERT INTO market_daily VALUES (?, ?, ?)", [
        ("SPY", "2026-11-25", 100.0), ("SPY", "2026-11-27", 101.0), ("SPY", "2026-11-30", 150.0),
        ("QQQ", "2026-11-27", 50.0), ("QQQ", "2026-11-24", 49.0),
        ("IWM", "2026-11-25", 20.0), ("IWM", "2026-11-27", 0.0),
        ("TLT", "2026-11-25", -1.0), ("TLT", "2026-11-27", 90.0),
    ])
    conn.commit()
    rows, closed = dm.load_watchlist_at(p)
    by = {r["symbol"]: r for r in rows}
    assert not closed and [r["symbol"] for r in rows] == dm.WATCHLIST_ORDER
    assert by["SPY"]["price"] == 101.0 and by["SPY"]["chg_pct"] == pytest.approx(1.0)
    assert by["QQQ"]["price"] == 50.0 and by["QQQ"]["chg_pct"] is None        # no close on the 25th: no change
    assert by["IWM"]["price"] is None and by["IWM"]["chg_pct"] is None        # an invalid close is "—"
    assert by["TLT"]["price"] == 90.0 and by["TLT"]["chg_pct"] is None
    assert by["USO"]["price"] is None
    assert dm.load_watchlist_at(date(2026, 12, 1)) == (dm.load_watchlist_at(date(2026, 12, 1))[0], True)


def test_movers_are_the_buckets_observed_at_the_session(daily):
    dm, conn = daily
    p = date(2026, 11, 18)
    o = float(p.toordinal())
    conn.executemany("INSERT INTO derived_metrics VALUES (?, '2026-11-20', ?, 'x')", [
        ("SPY_weekly_ret_obs", o), ("SPY_weekly_ret_z", -2.5), ("SPY_weekly_ret", -0.03),
        ("TLT_weekly_ret_obs", o), ("TLT_weekly_ret_z", 1.0), ("TLT_weekly_ret", 0.01),
        ("HYG_weekly_ret_obs", o), ("HYG_weekly_ret", 0.02),                         # no z: dropped
        ("GLD_weekly_ret_obs", o - 1), ("GLD_weekly_ret_z", 3.0), ("GLD_weekly_ret", 0.04),   # another session
    ])
    conn.commit()
    movers = dm.load_top_movers_at(p)
    assert [(m["symbol"], m["z"], m["ret_pct"]) for m in movers] == [("SPY", -2.5, pytest.approx(-3.0)),
                                                                     ("TLT", 1.0, pytest.approx(1.0))]


def test_news_and_the_calendar_read_through_the_content_clock(daily):
    dm, conn = daily
    clock = datetime(2026, 11, 17, 2, 0, tzinfo=UTC)
    conn.executemany("INSERT INTO news_feed VALUES (?, '', '', '', ?, ?, 'x')", [
        ("in window", 5.0, "2026-11-16 12:00:00"), ("too old", 5.0, "2026-11-15 13:00:00"),
        ("after the clock", 5.0, "2026-11-17 03:00:00"), ("minor", 3.0, "2026-11-16 12:00:00"),
    ])
    conn.executemany("INSERT INTO event_calendar VALUES (?, ?, 'High', ?)", [
        ("CPI", "2026-11-18T13:30:00Z", "fred"), ("Past", "2026-11-16T13:30:00Z", "fred"),
        ("Far", "2026-11-20T13:30:00Z", "fred"), ("ACME earnings", "2026-11-17T20:00:00Z", "finnhub_earnings"),
    ])
    conn.commit()
    assert [n["headline"] for n in dm.load_top_news_at(clock)] == ["in window"]
    assert [e["name"] for e in dm.load_calendar_at(clock)] == ["CPI"]


# ── the weekly memo at a session ──────────────────────────────────────────────


def test_the_weekly_snapshot_shows_a_return_and_z_only_for_the_exact_interval():
    from src import memo

    p, q = date(2026, 11, 18), date(2026, 11, 11)           # five sessions back
    assert memo._sessions_back(p, 5) == q
    mk = pd.DataFrame([("SPY", q, 100.0), ("SPY", p, 102.0), ("HYG", p, 80.0), ("TLT", q, 0.0), ("TLT", p, 90.0)],
                      columns=["symbol", "date", "close"])
    mk["date"] = pd.to_datetime(mk["date"])
    dm = pd.DataFrame({"SPY_weekly_ret_z": [1.234], "SPY_weekly_ret_obs": [float(p.toordinal())],
                       "SPY_weekly_ret_from": [float(q.toordinal())],
                       "TLT_weekly_ret_z": [0.5], "TLT_weekly_ret_obs": [float(p.toordinal())],
                       "TLT_weekly_ret_from": [float(date(2026, 11, 13).toordinal())]},
                      index=[pd.Timestamp("2026-11-20")])
    rows = {r["symbol"]: r for r in memo.build_market_snapshot_at(mk, dm, pd.DataFrame(), p)}
    assert rows["SPY"]["ret_1w_str"] == "+2.00%" and rows["SPY"]["z_str"] == "+1.2σ"
    assert rows["HYG"]["ret_1w_str"] == "—" and rows["HYG"]["z_score"] is None
    assert rows["TLT"]["ret_1w_str"] == "—" and rows["TLT"]["z_score"] is None    # a bucket over another interval


BASE = "0d8f2c85"
BLOCK = re.compile(r"\{% if (memo_banner|data_as_of|alerts_summary\.note) %\}.*?\{% endif %\}", re.S)


@pytest.mark.parametrize("name", ["memo.html", "memo_email.html"])
def test_the_weekly_templates_are_unchanged_when_the_queue_variables_are_unset(name):
    text = (ROOT / "templates" / name).read_text()
    assert "{%-" not in text and "-%}" not in text
    stripped = BLOCK.sub("", text)
    for var in ("memo_banner", "data_as_of", "alerts_summary.note"):
        assert var not in stripped
    old = subprocess.run(["git", "show", f"{BASE}:templates/{name}"], cwd=ROOT, capture_output=True, text=True)
    if old.returncode != 0:
        pytest.skip(f"commit {BASE} is not in this clone")
    assert stripped == old.stdout
