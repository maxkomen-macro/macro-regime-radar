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

from src.analytics import backtest as bt
from src.market_data.asset_history import DDL as ASSET_PRICES_DDL


def _sessions(start: date, n: int) -> list[str]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
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
