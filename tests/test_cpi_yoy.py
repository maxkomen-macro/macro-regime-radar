"""CPI YoY compares each monthly print with the same month a year earlier (Codex S-09).

The weekly series used to take pct_change(periods=52) of the forward-filled
weekly level: 52 weeks is 364 days, so at a month boundary a week compared one
month's print with the next month's a year earlier, and a missing print (Oct
2025) shifted the comparison for the weeks that carried it.
"""

from __future__ import annotations

import pandas as pd
import pytest

from src.analytics import surprise


def _monthly(start="2021-01-01", end="2023-12-01", skip=()):
    idx = [d for d in pd.date_range(start, end, freq="MS") if d.strftime("%Y-%m-%d") not in skip]
    return pd.Series([100.0 + i for i, _ in enumerate(pd.date_range(start, end, freq="MS"))], index=pd.date_range(start, end, freq="MS")).reindex(idx)


def test_a_month_boundary_week_compares_the_same_month():
    m = _monthly()
    yoy = surprise.cpi_yoy_weekly(m)
    want = (m[pd.Timestamp("2023-03-01")] / m[pd.Timestamp("2022-03-01")] - 1) * 100
    # Fri 2023-03-31 carries March 2023; 52 weeks back is Fri 2022-04-01, which carries April 2022
    assert yoy[pd.Timestamp("2023-03-31")] == pytest.approx(want)
    assert yoy[pd.Timestamp("2023-03-03")] == pytest.approx(want)


def test_a_missing_print_never_borrows_a_neighbouring_month():
    m = _monthly(skip=("2022-10-01",))
    yoy = surprise.cpi_yoy_weekly(m)
    # weeks of Oct 2022 carry September's print, so they carry September's YoY
    sep = (m[pd.Timestamp("2022-09-01")] / m[pd.Timestamp("2021-09-01")] - 1) * 100
    assert yoy[pd.Timestamp("2022-10-28")] == pytest.approx(sep)
    # Oct 2023 has no year-earlier month: its weeks have no row, never September's YoY
    assert pd.Timestamp("2023-10-06") not in yoy.index and pd.Timestamp("2023-10-27") not in yoy.index
    nov = (m[pd.Timestamp("2023-11-01")] / m[pd.Timestamp("2022-11-01")] - 1) * 100
    assert yoy[pd.Timestamp("2023-11-03")] == pytest.approx(nov)


def test_an_empty_series_has_no_rows():
    assert surprise.cpi_yoy_weekly(pd.Series(dtype=float)).empty


def test_a_refresh_removes_the_cpi_rows_the_old_rule_wrote(tmp_path, monkeypatch):
    """A week the same-month rule leaves without a row must not keep the row the
    52-week rule stored there (Codex S-10)."""
    import sqlite3

    path = tmp_path / "s.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """CREATE TABLE derived_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
               date TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL, UNIQUE(name, date));
           CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL, fetched_at TEXT);
           CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL);"""
    )
    m = _monthly("2019-01-01", "2023-12-01", skip=("2022-10-01",))
    conn.executemany("INSERT INTO raw_series VALUES ('CPIAUCSL', ?, ?, 'x')", [(d.strftime("%Y-%m-%d"), float(v)) for d, v in m.items()])
    # what the 52-week rule stored for the weeks of Oct 2023 (their print has no year-earlier month)
    conn.executemany("INSERT INTO derived_metrics (name, date, value, computed_at) VALUES (?, '2023-10-06', ?, 'x')",
                     [("CPI_yoy", 10.83), ("CPI_yoy_z", 1.2)])
    conn.commit()
    conn.close()
    monkeypatch.setattr(surprise, "DB_PATH", path)
    monkeypatch.setattr(surprise, "ROOT", tmp_path)
    surprise.run()
    with sqlite3.connect(path) as conn:
        left = conn.execute("SELECT name FROM derived_metrics WHERE date = '2023-10-06' AND name LIKE 'CPI_yoy%'").fetchall()
        n = conn.execute("SELECT COUNT(*) FROM derived_metrics WHERE name = 'CPI_yoy'").fetchone()[0]
    assert left == []
    assert n > 0
