"""B6 (2026-09-18): the FRED lag was a measurement artifact, not stale data.

fred_client stores every daily series (DGS10, DGS2, VIXCLS, the BAML OAS
indices, ...) as one row per month dated the 1st, holding the newest in-month
value. api/freshness.py counted lag from that stored date, so a current value
read as nine business days behind by mid-month. The monthly rows stay exactly
as they are (published history that every monthly model reads); the fetch now
also records each series' true last observation in source_watermarks.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

import pandas as pd
import pytest

from src import watermarks
from src.utils import fred_client


def _daily() -> pd.Series:
    idx = pd.bdate_range("2026-07-01", "2026-09-17")
    s = pd.Series([4.0 + i / 100 for i in range(len(idx))], index=idx, dtype=float)
    s.iloc[-1] = float("nan")  # FRED sometimes posts a blank for the newest day
    return s


def _legacy_monthly(raw: pd.Series) -> pd.Series:
    """The pre-B6 algorithm, verbatim, as the reference for byte-for-byte parity."""
    raw = raw.dropna().sort_index()
    raw.index = pd.to_datetime(raw.index)
    out = raw.groupby(raw.index.to_period("M")).last()
    out.index = out.index.to_timestamp()
    return out


@pytest.fixture()
def stub_download(monkeypatch):
    raw = _daily()
    monkeypatch.setattr(fred_client, "_download", lambda series_id, lookback_years: raw.dropna().sort_index())
    return raw


def test_monthly_rows_are_unchanged(stub_download):
    got = fred_client.fetch_series("DGS10", 30)
    pd.testing.assert_series_equal(got, _legacy_monthly(stub_download), check_names=False)
    assert list(got.index.strftime("%Y-%m-%d")) == ["2026-07-01", "2026-08-01", "2026-09-01"]


def test_observed_returns_the_true_last_observation(stub_download):
    monthly, last_obs, last_value = fred_client.fetch_series_observed("DGS10", 30)
    assert last_obs == "2026-09-16"  # the blank on the 17th is skipped
    assert last_value == pytest.approx(float(stub_download.dropna().iloc[-1]))
    assert monthly.index[-1].strftime("%Y-%m-%d") == "2026-09-01"  # the stored row stays month-stamped
    pd.testing.assert_series_equal(monthly, _legacy_monthly(stub_download), check_names=False)


def test_fetch_all_series_records_true_dates_beside_month_stamped_rows(monkeypatch, tmp_path):
    from src import fetch_data

    path = tmp_path / "fred.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE raw_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id TEXT NOT NULL, date TEXT NOT NULL,"
        " value REAL NOT NULL, fetched_at TEXT NOT NULL, UNIQUE(series_id, date))"
    )
    conn.commit()
    conn.close()

    def connect():
        c = sqlite3.connect(path)
        c.row_factory = sqlite3.Row
        return c

    raw = _daily().dropna()
    monkeypatch.setattr(fetch_data, "get_connection", connect)
    monkeypatch.setattr(fetch_data, "SERIES", {"ten_year": "DGS10"})
    monkeypatch.setattr(
        fetch_data, "fetch_series_observed",
        lambda series_id, years: (fred_client._to_monthly(raw), "2026-09-16", float(raw.iloc[-1])),
    )
    fetch_data.fetch_all_series()
    c = connect()
    try:
        assert c.execute("SELECT MAX(date) FROM raw_series WHERE series_id='DGS10'").fetchone()[0] == "2026-09-01"
        wm = watermarks.read_all(c)["fred:DGS10"]
    finally:
        c.close()
    assert wm["last_obs"] == "2026-09-16" and wm["status"] == "ok"
    assert wm["last_value"] == pytest.approx(float(raw.iloc[-1]))


def test_watermark_advances_only_forward():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    t0 = datetime(2026, 9, 16, 4, 0, tzinfo=timezone.utc)
    watermarks.record(c, "fred:DGS10", "2026-09-14", 4.1, now=t0)
    watermarks.record(c, "fred:DGS10", "2026-09-14", 4.1, now=t0.replace(day=17))  # checked, not advanced
    wm = watermarks.read_all(c)["fred:DGS10"]
    assert wm["advanced_at"] == "2026-09-16T04:00:00Z" and wm["checked_at"] == "2026-09-17T04:00:00Z"
    watermarks.record(c, "fred:DGS10", "2026-09-16", 4.2, now=t0.replace(day=18))
    assert watermarks.read_all(c)["fred:DGS10"]["advanced_at"] == "2026-09-18T04:00:00Z"
    # A backward move (a revision) is recorded and flagged, and is not an advance.
    watermarks.record(c, "fred:DGS10", "2026-09-15", 4.2, now=t0.replace(day=18, hour=5))
    wm = watermarks.read_all(c)["fred:DGS10"]
    assert wm["status"] == "revised" and wm["last_obs"] == "2026-09-15"
    assert wm["advanced_at"] == "2026-09-18T04:00:00Z"
    # A failed check keeps the last observation and says so.
    watermarks.record(c, "fred:DGS10", None, status="error", detail="HTTPError", now=t0.replace(day=18, hour=6))
    wm = watermarks.read_all(c)["fred:DGS10"]
    assert wm["last_obs"] == "2026-09-15" and wm["status"] == "error" and wm["detail"] == "HTTPError"
    assert wm["checked_at"] == "2026-09-18T06:00:00Z"
