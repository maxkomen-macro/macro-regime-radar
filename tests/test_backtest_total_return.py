"""The investment-return backtests score SPY's total return (Max, 2026-11-04, option A).

src/analytics/backtest.py reads only asset_prices SPY (interval '1d'), whose
closes the provider adjusts for splits and dividends, so a forward return is
the total return with each distribution reinvested on its ex-dividend date.
These tests pin that: the series comes from asset_prices and never from
market_daily (unadjusted canonical bars), a distribution is counted once,
monthly rows and other symbols are ignored, a spliced (multi-provider)
series is refused, and a missing series leaves the stored results alone.
Fixture databases only; no network.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import pandas as pd
import pytest

from api import calendar as cal
from src.analytics import backtest as bt
from src.market_data.asset_history import DDL as ASSET_PRICES_DDL


def _sessions(start: date, n: int) -> list[str]:
    out, d = [], start
    while len(out) < n:
        if cal.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _db(path, *, asset_rows=(), market_rows=(), regimes=(), signals=()):
    c = sqlite3.connect(path)
    c.executescript(ASSET_PRICES_DDL)
    c.executescript(
        """
        CREATE TABLE market_daily (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL);
        CREATE TABLE regimes (date TEXT, label TEXT);
        CREATE TABLE signals (date TEXT, signal_name TEXT, value REAL, triggered INTEGER);
        CREATE TABLE backtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT, test_name TEXT NOT NULL, cohort TEXT NOT NULL,
            horizon TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL);
        """
    )
    c.executemany("INSERT INTO asset_prices (symbol, interval, date, close, provider, volume) VALUES (?, ?, ?, ?, ?, NULL)", asset_rows)
    c.executemany("INSERT INTO market_daily VALUES (?, ?, ?, ?, ?, ?, 0)", [(s, d, p, p, p, p) for s, d, p in market_rows])
    c.executemany("INSERT INTO regimes VALUES (?, ?)", regimes)
    c.executemany("INSERT INTO signals VALUES (?, ?, 1.0, ?)", signals)
    c.commit()
    c.close()


def _results(path) -> pd.DataFrame:
    c = sqlite3.connect(path)
    try:
        return pd.read_sql("SELECT test_name, cohort, horizon, metric, value FROM backtest_results", c)
    finally:
        c.close()


def _metric(df, test_name, horizon, metric):
    v = df[(df.test_name == test_name) & (df.horizon == horizon) & (df.metric == metric)].value
    assert len(v) == 1, (test_name, horizon, metric, df)
    return float(v.iloc[0])


@pytest.fixture
def run_on(monkeypatch):
    def _run(path):
        monkeypatch.setattr(bt, "DB_PATH", path)
        bt.run()
        return _results(path)
    return _run


def test_forward_returns_come_from_asset_prices_not_market_daily(tmp_path, run_on):
    """Adjusted closes rise 10% over 21 sessions; the unadjusted market_daily
    bars fall. The stored 1M return is asset_prices' 10%."""
    days = _sessions(date(2020, 1, 1), 300)
    adj = [100.0 * (1.10 ** (i / 21)) for i in range(len(days))]
    raw = [200.0 - i * 0.1 for i in range(len(days))]
    path = tmp_path / "t.db"
    _db(
        path,
        asset_rows=[("SPY", "1d", d, p, "yfinance") for d, p in zip(days, adj)],
        market_rows=[("SPY", d, p) for d, p in zip(days, raw)],
        regimes=[(days[0], "Goldilocks")],
    )
    df = run_on(path)
    assert _metric(df, "SPY_regime_Goldilocks", "1M", "avg_return") == pytest.approx(adj[21] / adj[0] - 1, rel=1e-12)
    assert _metric(df, "SPY_regime_Goldilocks", "12M", "avg_return") == pytest.approx(adj[252] / adj[0] - 1, rel=1e-12)
    assert _metric(df, "SPY_regime_Goldilocks", "1M", "n") == 1


def test_a_distribution_is_counted_once(tmp_path, run_on):
    """Raw closes 100 then 99 on the ex-date of a $1 dividend: the price
    return is -1%, the total return 0% (the dividend offsets the drop), and
    adding the dividend to the adjusted close again would read +1%. The
    provider's factor (1 - D / prior close) = 0.99 scales every close before
    the ex-date."""
    days = _sessions(date(2021, 3, 1), 40)
    raw = [100.0] * 10 + [99.0] * 30          # ex-date is days[10]
    factor = 1 - 1.0 / 100.0
    adj = [p * factor for p in raw[:10]] + raw[10:]
    path = tmp_path / "t.db"
    _db(
        path,
        asset_rows=[("SPY", "1d", d, p, "eodhd") for d, p in zip(days, adj)],
        market_rows=[("SPY", d, p) for d, p in zip(days, raw)],
        signals=[(days[0], "vix_spike", 1)],
    )
    df = run_on(path)
    tr = _metric(df, "SPY_signal_vix_spike", "1M", "avg_return")
    assert tr == pytest.approx(0.0, abs=1e-12)          # total return
    assert tr != pytest.approx(raw[21] / raw[0] - 1)     # not the price return (-1%)
    assert _metric(df, "SPY_signal_vix_spike", "1M", "hit_rate") == 0.0  # a 0% return is not a hit


def test_monthly_rows_and_other_symbols_are_ignored(tmp_path):
    days = _sessions(date(2022, 1, 3), 30)
    path = tmp_path / "t.db"
    _db(
        path,
        asset_rows=[("SPY", "1d", d, 100.0 + i, "yfinance") for i, d in enumerate(days)]
        + [("SPY", "1mo", "2022-01-01", 5.0, "yfinance"), ("QQQ", "1d", days[0], 1.0, "yfinance")],
    )
    c = sqlite3.connect(path)
    try:
        s = bt.load_spy_total_return(c)
    finally:
        c.close()
    assert list(s.index.strftime("%Y-%m-%d")) == days
    assert s.iloc[0] == 100.0 and s.iloc[-1] == 129.0
    assert s.index.is_monotonic_increasing


def test_no_total_return_series_never_falls_back_to_market_daily(tmp_path, run_on, caplog):
    """Without asset_prices SPY the step stores nothing new (the stored
    results stay) instead of scoring market_daily's price-return bars."""
    days = _sessions(date(2020, 1, 1), 300)
    path = tmp_path / "t.db"
    _db(path, market_rows=[("SPY", d, 100.0 + i) for i, d in enumerate(days)], regimes=[(days[0], "Goldilocks")])
    c = sqlite3.connect(path)
    c.execute("INSERT INTO backtest_results (test_name, cohort, horizon, metric, value, computed_at) "
              "VALUES ('SPY_regime_Goldilocks', 'Goldilocks', '1M', 'avg_return', 0.5, '2026-01-01T00:00:00')")
    c.commit()
    c.close()
    df = run_on(path)
    assert df.to_dict("records") == [
        {"test_name": "SPY_regime_Goldilocks", "cohort": "Goldilocks", "horizon": "1M", "metric": "avg_return", "value": 0.5}
    ]
    assert "No SPY total-return closes in asset_prices" in caplog.text


def test_missing_asset_prices_table_reads_as_empty(tmp_path):
    path = tmp_path / "t.db"
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL)")
    c.execute("INSERT INTO market_daily VALUES ('SPY', '2024-01-02', 470.0)")
    try:
        assert bt.load_spy_total_return(c).empty
    finally:
        c.close()


def test_a_spliced_multi_provider_series_is_refused(tmp_path):
    """Two providers in one series means two adjustment bases; asset_history
    replaces a series whole, so this is corruption, never scored."""
    days = _sessions(date(2023, 1, 2), 10)
    path = tmp_path / "t.db"
    _db(path, asset_rows=[("SPY", "1d", d, 100.0, "yfinance" if i < 5 else "eodhd") for i, d in enumerate(days)])
    c = sqlite3.connect(path)
    try:
        with pytest.raises(RuntimeError, match="mixes providers"):
            bt.load_spy_total_return(c)
    finally:
        c.close()


def test_the_basis_is_declared_in_the_module():
    assert (bt.SOURCE_TABLE, bt.SOURCE_INTERVAL, bt.TARGET_SYMBOL, bt.RETURN_BASIS) == ("asset_prices", "1d", "SPY", "total return")
    assert "TOTAL RETURN" in bt.__doc__ and "reinvests each distribution" in bt.__doc__


# ── Codex design pass 1: DR-02 basis column, DR-03 session calendar, DR-04 finite closes ──

def test_every_written_row_records_the_total_return_basis(tmp_path, run_on):
    """DR-02: a table that predates the column gains it; every row this step
    writes says total_return, so readers label only recomputed rows."""
    days = _sessions(date(2020, 1, 2), 300)
    path = tmp_path / "t.db"
    _db(path, asset_rows=[("SPY", "1d", d, 100.0 + i, "yfinance") for i, d in enumerate(days)], regimes=[(days[0], "Goldilocks")])
    run_on(path)
    c = sqlite3.connect(path)
    try:
        assert "return_basis" in {r[1] for r in c.execute("PRAGMA table_info(backtest_results)")}
        assert c.execute("SELECT DISTINCT return_basis FROM backtest_results").fetchall() == [("total_return",)]
    finally:
        c.close()


def test_a_missing_session_never_stretches_a_horizon(tmp_path, run_on, caplog):
    """DR-03: 2026-01-05 (a Monday session) is absent. A 21-session window
    still exits 21 sessions later, and one that would start or end on the
    missing session is unscored instead of borrowing a neighbour's close."""
    days = _sessions(date(2025, 10, 1), 120)
    gone = "2026-01-05"
    assert gone in days
    closes = {d: 100.0 * (1.001 ** i) for i, d in enumerate(days)}
    i_gone = days.index(gone)
    entry_ok, entry_hit = days[i_gone - 30], days[i_gone - 21]   # exits 9 sessions before / exactly on the gap
    path = tmp_path / "t.db"
    _db(path, asset_rows=[("SPY", "1d", d, p, "yfinance") for d, p in closes.items() if d != gone],
        signals=[(entry_ok, "cpi_hot", 1), (entry_hit, "vix_spike", 1), (gone, "cpi_cold", 1)])
    df = run_on(path)
    exit_ok = days[days.index(entry_ok) + 21]
    assert _metric(df, "SPY_signal_cpi_hot", "1M", "avg_return") == pytest.approx(closes[exit_ok] / closes[entry_ok] - 1, rel=1e-12)
    assert _metric(df, "SPY_signal_vix_spike", "1M", "n") == 0   # exit session missing
    assert _metric(df, "SPY_signal_cpi_cold", "1M", "n") == 0    # entry session missing
    assert f"NYSE sessions have no SPY close" in caplog.text and gone in caplog.text


def test_a_row_on_a_non_session_date_is_dropped(tmp_path, caplog):
    """DR-03: a Saturday row would shorten every horizon that spans it."""
    days = _sessions(date(2024, 3, 1), 30)
    path = tmp_path / "t.db"
    _db(path, asset_rows=[("SPY", "1d", d, 100.0, "yfinance") for d in days] + [("SPY", "1d", "2024-03-09", 999.0, "yfinance")])
    c = sqlite3.connect(path)
    try:
        s = bt.load_spy_total_return(c)
    finally:
        c.close()
    assert list(s.index.strftime("%Y-%m-%d")) == days and (s == 100.0).all()
    assert "rows on non-session dates dropped" in caplog.text and "2024-03-09" in caplog.text


@pytest.mark.parametrize("bad", [float("inf"), float("-inf"), 0.0, -5.0])
def test_a_close_that_is_not_finite_and_positive_is_unscored(tmp_path, run_on, bad):
    """DR-04: an infinite, zero or negative stored close scores nothing,
    never an infinite return or a 100% hit rate."""
    days = _sessions(date(2022, 1, 3), 60)
    closes = [100.0] * len(days)
    closes[21] = bad
    path = tmp_path / "t.db"
    _db(path, asset_rows=[("SPY", "1d", d, p, "yfinance") for d, p in zip(days, closes)],
        signals=[(days[0], "vix_spike", 1), (days[1], "cpi_hot", 1)])
    df = run_on(path)
    assert _metric(df, "SPY_signal_vix_spike", "1M", "n") == 0          # exit on the bad close
    assert _metric(df, "SPY_signal_cpi_hot", "1M", "avg_return") == 0.0  # the next window is clean


def test_positional_scoring_matches_the_old_rule_on_a_clean_series():
    """compute_forward_return picks the same rows `asof` + `future.iloc[h-1]`
    picked, including entries on non-session dates and before the series."""
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in _sessions(date(2023, 1, 3), 40)])
    s = pd.Series([100.0 + i * 1.5 for i in range(len(idx))], index=idx)

    def old(spy, entry, h):
        p = spy.asof(entry)
        if p is None or (isinstance(p, float) and pd.isna(p)):
            return None
        fut = spy[spy.index > entry]
        return None if len(fut) < h else float(fut.iloc[h - 1] / p - 1)

    for entry in pd.date_range("2022-12-25", "2023-03-10", freq="D"):
        for h in (1, 5, 21, 39, 40):
            assert bt.compute_forward_return(s, entry, h) == old(s, entry, h), (entry, h)


# ── DR-02: /api/backtests carries the stored basis, additively ──

def _api_rows(monkeypatch, path):
    from api import db as api_db

    def conn():
        c = sqlite3.connect(path)
        c.row_factory = sqlite3.Row
        return c

    monkeypatch.setattr(api_db, "_connect", conn)
    return api_db.backtests()


def _bt_table(path, *, with_basis: bool, bases=("total_return", "total_return")):
    c = sqlite3.connect(path)
    extra = ", return_basis TEXT" if with_basis else ""
    c.execute(f"CREATE TABLE backtest_results (id INTEGER PRIMARY KEY, test_name TEXT, cohort TEXT, horizon TEXT, metric TEXT, value REAL, computed_at TEXT{extra})")
    for metric, value, basis in (("avg_return", 0.01, bases[0]), ("n", 5.0, bases[1])):
        cols, vals = "test_name, cohort, horizon, metric, value, computed_at", ["SPY_regime_Goldilocks", "Goldilocks", "1M", metric, value, "2026-11-04T00:00:00"]
        if with_basis:
            cols, vals = cols + ", return_basis", vals + [basis]
        c.execute(f"INSERT INTO backtest_results ({cols}) VALUES ({', '.join('?' * len(vals))})", vals)
    c.commit()
    c.close()


def test_api_backtests_serve_the_stored_basis(tmp_path, monkeypatch):
    path = tmp_path / "a.db"
    _bt_table(path, with_basis=True)
    [row] = _api_rows(monkeypatch, path)
    assert row["return_basis"] == "total_return" and row["avg_return"] == 0.01 and row["n"] == 5.0


def test_api_backtests_never_claim_a_basis_the_rows_do_not_record(tmp_path, monkeypatch):
    """A published table that predates the column, a NULL row, or a cell whose
    rows disagree all serve None (the web then says basis not recorded)."""
    for i, kw in enumerate(({"with_basis": False}, {"with_basis": True, "bases": (None, None)},
                            {"with_basis": True, "bases": ("total_return", None)}, {"with_basis": True, "bases": (None, "total_return")})):
        path = tmp_path / f"b{i}.db"
        _bt_table(path, **kw)
        [row] = _api_rows(monkeypatch, path)
        assert row["return_basis"] is None, kw
        assert set(row) == {"test_name", "cohort", "horizon", "avg_return", "median_return", "hit_rate", "n", "computed_at", "return_basis"}
