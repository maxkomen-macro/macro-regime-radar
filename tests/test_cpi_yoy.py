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


def _derived(path, rows):
    import sqlite3

    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE derived_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        date TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL, UNIQUE(name, date))""")
    conn.executemany("INSERT INTO derived_metrics (name, date, value, computed_at) VALUES (?, ?, ?, 'x')", rows)
    conn.commit()
    conn.close()


def _connect_to(path):
    import sqlite3

    def _c():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    return _c


SEP_ROWS = [("CPI_yoy_z", "2026-09-25", 1.7), ("CPI_yoy", "2026-09-25", 3.72)]


def test_an_older_prints_yoy_is_never_served_as_the_latest(tmp_path, monkeypatch):
    """October 2026's print has no October 2025 month (Codex S-12): September's
    YoY must not rank as the latest monthly print."""
    from api import db as api_db
    from src import memo

    marker = ("CPI_yoy_newest", "2026-10-02", float(pd.Timestamp("2026-10-01").date().toordinal()))
    path = tmp_path / "d.db"
    _derived(path, SEP_ROWS + [marker])
    monkeypatch.setattr(api_db, "_connect", _connect_to(path))
    assert [r["metric"] for r in api_db.top_surprises(15)] == []
    wide = pd.DataFrame({"CPI_yoy_z": [None, 1.7], "CPI_yoy": [None, 3.72], "CPI_yoy_newest": [marker[2], None]},
                        index=pd.DatetimeIndex(["2026-10-02", "2026-09-25"]))
    assert memo.build_surprise_ranking(wide) == []
    from dashboard.components import db_helpers
    assert db_helpers.build_surprises_df(wide).empty
    from src.analytics import playbook
    derived = {"CPI_yoy_z": {"value": 3.0, "date": "2026-09-25"}, "CPI_yoy_newest": {"value": marker[2], "date": "2026-10-02"}}
    assert playbook._zscore_sentences(derived) == []
    derived["CPI_yoy_newest"]["date"] = "2026-09-25"
    assert len(playbook._zscore_sentences(derived)) == 1
    # the marker on the row's own week: the row is the newest print's
    path2 = tmp_path / "e.db"
    _derived(path2, SEP_ROWS + [("CPI_yoy_newest", "2026-09-25", float(pd.Timestamp("2026-09-01").date().toordinal()))])
    monkeypatch.setattr(api_db, "_connect", _connect_to(path2))
    assert [r["metric"] for r in api_db.top_surprises(15)] == ["CPI_yoy_z"]
    # a store without the marker predates the rule and is served as before
    path3 = tmp_path / "f.db"
    _derived(path3, SEP_ROWS)
    monkeypatch.setattr(api_db, "_connect", _connect_to(path3))
    assert [r["metric"] for r in api_db.top_surprises(15)] == ["CPI_yoy_z"]


def test_the_refresh_dates_the_newest_print_by_the_week_that_carries_it(tmp_path, monkeypatch):
    import sqlite3

    path = tmp_path / "s.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """CREATE TABLE derived_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
               date TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL, UNIQUE(name, date));
           CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL, fetched_at TEXT);
           CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL);"""
    )
    m = _monthly("2019-01-01", "2023-10-01", skip=("2022-10-01",))
    conn.executemany("INSERT INTO raw_series VALUES ('CPIAUCSL', ?, ?, 'x')", [(d.strftime("%Y-%m-%d"), float(v)) for d, v in m.items()])
    conn.commit()
    conn.close()
    monkeypatch.setattr(surprise, "DB_PATH", path)
    monkeypatch.setattr(surprise, "ROOT", tmp_path)
    surprise.run()
    with sqlite3.connect(path) as conn:
        newest = conn.execute("SELECT date, value FROM derived_metrics WHERE name = 'CPI_yoy_newest'").fetchall()
        last_yoy = conn.execute("SELECT MAX(date) FROM derived_metrics WHERE name = 'CPI_yoy_z'").fetchone()[0]
    assert newest == [("2023-10-06", float(pd.Timestamp("2023-10-01").date().toordinal()))]
    assert last_yoy == "2023-09-29"  # October 2023 has no October 2022: the marker is later, so the row is not current
