"""tests/desk_macro_store.py — a hermetic store for the Desk v2 /regime and
/macro tests (desk/frame-3-api-b2a). Not a test module.

`build(path)` writes a small database with what the two routes read, so their
tests never skip:

- `raw_series`, month-stamped as the pipeline stores it (CLAUDE.md B6):
  INDPRO and CPIAUCSL (the regime classifier's inputs), and the recession
  model's DGS10, DGS2, UNRATE, BAMLH0A0HYM2, T10YIE and T5YIE (no USREC, so
  the model trains on its NBER fallback, and no USSLIND, so its fifth feature
  is the breakeven spread), and IG (BAMLC0A0CM, dated by its watermark);
- `regimes`, one row a month, classified with the 3-point slope the
  classifier uses (src/regime.py), from 1996-03 to END_MONTH;
- `event_calendar`: a "CPI Release" at 12:30 UTC around the 12th of each
  month from 2026-06 to 2027-01, and no industrial-production event;
- `source_watermarks`: IG (`fred:BAMLC0A0CM`) and the Desk store's summary row;
- `desk_series` (the Desk store's table, written by its own writer): DGS2 and
  DGS10 on bond-market days to DAILY_END, and HY OAS from HY_FROM with a
  weekend month-end print.

Seeded random walks; the tests read what they need back from the store, so no
value here is load-bearing beyond its shape.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

START_MONTH = "1996-01"
END_MONTH = "2026-08"          # the newest regimes row (the audit copy's)
DAILY_START = "2020-01-02"
DAILY_END = "2026-09-22"       # the newest Treasury print (a Tuesday)
HY_FROM = "2023-09-25"
HY_END = "2026-09-23"
HY_WEEKEND = "2024-03-31"      # a FRED weekend month-end stamp
IG_LAST = ("2026-09-23", 0.77)
BOND_HOLIDAYS = ("10-12", "11-11")  # Columbus and Veterans Day: NYSE open, no Treasury print

RAW_DDL = """CREATE TABLE raw_series (id INTEGER PRIMARY KEY AUTOINCREMENT, series_id TEXT NOT NULL, date TEXT NOT NULL,
value REAL NOT NULL, fetched_at TEXT NOT NULL, UNIQUE(series_id, date))"""
REGIMES_DDL = """CREATE TABLE regimes (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
confidence REAL NOT NULL, growth_trend REAL, inflation_trend REAL, prob_goldilocks REAL, prob_overheating REAL,
prob_stagflation REAL, prob_recession REAL, computed_at TEXT NOT NULL)"""
CALENDAR_DDL = """CREATE TABLE event_calendar (id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL,
event_datetime TEXT NOT NULL, importance TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual_csv', created_at TEXT NOT NULL)"""

CPI_RELEASES = ("2026-06-10T12:30:00Z", "2026-07-15T12:30:00Z", "2026-08-12T12:30:00Z", "2026-09-11T12:30:00Z",
                "2026-10-14T12:30:00Z", "2026-11-10T13:30:00Z", "2026-12-10T13:30:00Z", "2027-01-13T13:30:00Z")

LABELS = {(True, False): "Goldilocks", (True, True): "Overheating", (False, True): "Stagflation", (False, False): "Recession Risk"}


def slope3(y: pd.Series) -> pd.Series:
    """The classifier's 3-point OLS slope over consecutive rows: (y₂ − y₀)/2."""
    return (y - y.shift(2)) / 2.0


def classify(joint: pd.DataFrame) -> pd.DataFrame:
    """Rows as src/regime.py stores them: trends over the joint frame's rows."""
    g, i = slope3(joint["growth"]), slope3(joint["inflation"])
    out = pd.DataFrame({"growth_trend": g, "inflation_trend": i}).dropna()
    out["label"] = [LABELS[(a > 0, b > 0)] for a, b in zip(out["growth_trend"], out["inflation_trend"])]
    return out


def write_raw(conn: sqlite3.Connection, series_id: str, s: pd.Series) -> None:
    conn.executemany("INSERT OR REPLACE INTO raw_series (series_id, date, value, fetched_at) VALUES (?,?,?,?)",
                     [(series_id, d.strftime("%Y-%m-%d"), float(v), "t") for d, v in s.dropna().items()])


def write_regimes(conn: sqlite3.Connection, rows: pd.DataFrame) -> None:
    conn.execute("DELETE FROM regimes")
    conn.executemany(
        "INSERT INTO regimes (date, label, confidence, growth_trend, inflation_trend, prob_goldilocks, prob_overheating, "
        "prob_stagflation, prob_recession, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(d.strftime("%Y-%m-%d"), r.label, 0.5, float(r.growth_trend), float(r.inflation_trend), 0.4, 0.3, 0.2, 0.1, "t")
         for d, r in rows.iterrows()])


def bond_days(start: str, end: str) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, end) if d.strftime("%m-%d") not in BOND_HOLIDAYS]


def build(path: Path, *, seed: int = 7, end_month: str = END_MONTH, regimes: bool = True, desk: bool = True,
          calendar: bool = True, watermarks: bool = True) -> Path:
    from src.market_data import desk_history

    rng = np.random.default_rng(seed)
    months = pd.date_range(f"{START_MONTH}-01", f"{end_month}-01", freq="MS")
    n = len(months)
    indpro = pd.Series(90.0 * np.cumprod(1.0 + rng.normal(0.0015, 0.006, n)), index=months)
    cpi = pd.Series(155.0 * np.cumprod(1.0 + rng.normal(0.002, 0.003, n)), index=months)
    dgs10 = pd.Series(np.clip(5.0 + np.cumsum(rng.normal(0.0, 0.15, n)), 0.5, 9.0), index=months)
    dgs2 = pd.Series(np.clip(dgs10.to_numpy() - 0.8 + np.cumsum(rng.normal(0.0, 0.08, n)), 0.1, 9.0), index=months)
    unrate = pd.Series(np.clip(5.0 + np.cumsum(rng.normal(0.0, 0.12, n)), 3.0, 11.0), index=months)
    hy = pd.Series(np.clip(5.0 + np.cumsum(rng.normal(0.0, 0.25, n)), 2.5, 16.0), index=months)
    t10 = pd.Series(2.2 + rng.normal(0.0, 0.2, n), index=months)
    t5 = pd.Series(2.0 + rng.normal(0.0, 0.2, n), index=months)
    ig = pd.Series(np.clip(1.2 + np.cumsum(rng.normal(0.0, 0.05, n)), 0.5, 5.0), index=months)

    conn = sqlite3.connect(path)
    conn.execute(RAW_DDL)
    conn.execute(REGIMES_DDL)
    for sid, s in (("INDPRO", indpro), ("CPIAUCSL", cpi), ("DGS10", dgs10), ("DGS2", dgs2), ("UNRATE", unrate),
                   ("BAMLH0A0HYM2", hy), ("T10YIE", t10), ("T5YIE", t5), ("BAMLC0A0CM", ig)):
        write_raw(conn, sid, s)
    if regimes:
        write_regimes(conn, classify(pd.DataFrame({"growth": indpro, "inflation": cpi}).dropna()))
    if calendar:
        conn.execute(CALENDAR_DDL)
        conn.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at) VALUES (?,?,?,?,?)",
                         [("CPI Release", t, "high", "test", "t") for t in CPI_RELEASES]
                         + [("FOMC Rate Decision", "2026-10-28T18:00:00Z", "high", "test", "t")])
    if watermarks:
        from src import watermarks as wm

        wm.ensure_table(conn)
        wm.record(conn, "fred:BAMLC0A0CM", IG_LAST[0], IG_LAST[1])
        wm.record(conn, "desk_series", DAILY_END, None)
    if desk:
        desk_history.ensure_table(conn)
        days = bond_days(DAILY_START, DAILY_END)
        d10 = 4.0 + np.cumsum(rng.normal(0.0, 0.03, len(days)))
        d2 = d10 - 0.3 + np.cumsum(rng.normal(0.0, 0.01, len(days)))
        desk_history.write_series(conn, "DGS10", list(zip(days, d10.tolist())), provider="fred", merge=False)
        desk_history.write_series(conn, "DGS2", list(zip(days, d2.tolist())), provider="fred", merge=False)
        hy_days = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(HY_FROM, HY_END)]
        hy_d = np.clip(3.5 + np.cumsum(rng.normal(0.0, 0.02, len(hy_days))), 2.0, 9.0)
        desk_history.write_series(conn, "BAMLH0A0HYM2", list(zip(hy_days, hy_d.tolist())) + [(HY_WEEKEND, 3.4)],
                                  provider="fred", merge=False)
    conn.commit()
    conn.close()
    return path
