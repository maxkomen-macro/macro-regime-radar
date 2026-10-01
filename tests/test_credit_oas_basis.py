"""/api/credit/oas changes say what they are measured against (fix/freshness 2).

raw_series keeps one row per month for a FRED daily series (the newest
in-month value, dated the 1st), so the old 7-day lookback on it reached the
previous month's row: the 10Y "+49 bps 1W" on 2026-09-28 was the change since
Aug 31 (5.24 − 4.75); the true week was +28 bp (5.24 − 4.96 on Sep 21).
desk_series holds DGS10 and the HY OAS by observation date. Each change label
must map to its lookback: "1w" only for a true seven-calendar-day change,
"month_end" against the previous month's row.
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest

from api import db


def _weekdays(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _store(path: Path, *, desk: dict[str, dict[str, float]] | None, raw: dict[str, dict[str, float]], marks: dict[str, str]) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL, PRIMARY KEY (series_id, date))")
    conn.execute("CREATE TABLE source_watermarks (source TEXT PRIMARY KEY, last_obs TEXT, last_value REAL, advanced_at TEXT, checked_at TEXT, status TEXT, detail TEXT)")
    if desk is not None:
        conn.execute("CREATE TABLE desk_series (series_id TEXT, date TEXT, value REAL, provider TEXT, PRIMARY KEY (series_id, date))")
        for sid, rows in desk.items():
            conn.executemany("INSERT INTO desk_series VALUES (?, ?, ?, 'FRED')", [(sid, d, v) for d, v in rows.items()])
    for sid, rows in raw.items():
        conn.executemany("INSERT INTO raw_series VALUES (?, ?, ?)", [(sid, d, v) for d, v in rows.items()])
    for source, last in marks.items():
        conn.execute("INSERT INTO source_watermarks (source, last_obs) VALUES (?, ?)", (source, last))
    conn.commit()
    conn.close()


# The 2026-09 record (FRED's own CSV, /tmp/mrr-brief/notes/fred_DGS10.csv; desk_series on the release DB).
DGS10_DAILY = {
    "2026-09-14": 4.90, "2026-09-15": 4.92, "2026-09-16": 4.93, "2026-09-17": 4.94, "2026-09-18": 5.01,
    "2026-09-21": 4.96, "2026-09-22": 4.96, "2026-09-23": 5.11, "2026-09-24": 5.18, "2026-09-25": 5.17, "2026-09-28": 5.24,
}
HY_DAILY = {"2026-09-21": 2.66, "2026-09-22": 2.68, "2026-09-23": 2.73, "2026-09-24": 2.80, "2026-09-25": 2.93, "2026-09-28": 3.02, "2026-09-29": 3.08}
RAW = {
    "DGS10": {"2026-08-01": 4.75, "2026-09-01": 5.24},
    "BAMLH0A0HYM2": {"2026-08-01": 2.63, "2026-09-01": 3.08},
    "BAMLC0A0CM": {"2026-08-01": 0.80, "2026-09-01": 0.84},
}
MARKS = {"fred:DGS10": "2026-09-28", "fred:BAMLH0A0HYM2": "2026-09-29", "fred:BAMLC0A0CM": "2026-09-29"}
DAYS = 3650  # the window runs from date('now'); wide enough to hold the fixed 2026 rows


@pytest.fixture
def store(tmp_path, monkeypatch):
    def make(**kw):
        path = tmp_path / "macro_radar.db"
        _store(path, **kw)
        monkeypatch.setattr(db, "DB_PATH", path)
        return {s["series_id"]: s for s in db.credit_oas(DAYS)["series"]}

    return make


def test_the_10y_reads_a_true_week_from_the_daily_store_not_the_month_row(store):
    out = store(desk={"DGS10": DGS10_DAILY, "BAMLH0A0HYM2": HY_DAILY}, raw=RAW, marks=MARKS)
    ten = out["DGS10"]
    assert ten["date"] == "2026-09-28"  # the observation's own date, never "2026-09-01"
    assert ten["change_basis"] == "1w" and ten["change_from"] == "2026-09-21"
    assert ten["change_bps"] == pytest.approx(28.0)  # not the month row's +49
    assert ten["change_1w_bps"] == pytest.approx(28.0)
    assert ten["history_basis"] == "daily" and len(ten["history"]) == len(DGS10_DAILY)
    hy = out["BAMLH0A0HYM2"]
    assert (hy["change_basis"], hy["change_from"]) == ("1w", "2026-09-22")
    assert hy["change_bps"] == pytest.approx(40.0)


def test_a_month_stamped_series_reads_against_the_previous_month_and_never_claims_a_week(store):
    out = store(desk={"DGS10": DGS10_DAILY}, raw=RAW, marks=MARKS)
    ig = out["BAMLC0A0CM"]
    assert (ig["change_basis"], ig["change_from"]) == ("month_end", "2026-08")
    assert ig["change_bps"] == pytest.approx(4.0)
    assert ig["change_1w_bps"] is None
    assert ig["date"] == "2026-09-29"  # the watermark's true date inside the September row's month
    assert ig["history_basis"] == "monthly"


def test_a_daily_store_behind_the_month_row_is_not_read(store):
    behind = {d: v for d, v in HY_DAILY.items() if d <= "2026-09-25"}
    hy = store(desk={"BAMLH0A0HYM2": behind}, raw=RAW, marks=MARKS)["BAMLH0A0HYM2"]
    assert hy["change_basis"] == "month_end" and hy["value_pct"] == 3.08 and hy["date"] == "2026-09-29"


def test_a_hole_wider_than_ten_days_prints_no_week(store):
    holey = {"2026-09-10": 4.80, "2026-09-28": 5.24}
    ten = store(desk={"DGS10": holey}, raw=RAW, marks=MARKS)["DGS10"]
    assert ten["change_bps"] is None and ten["change_basis"] is None and ten["change_1w_bps"] is None


def test_without_a_desk_store_every_series_is_month_end(store):
    out = store(desk=None, raw=RAW, marks=MARKS)
    assert {s["change_basis"] for s in out.values()} == {"month_end"}
    assert out["DGS10"]["change_bps"] == pytest.approx(49.0) and out["DGS10"]["change_from"] == "2026-08"


@pytest.mark.skipif(not (Path(__file__).resolve().parents[1] / "data" / "macro_radar.db").exists(), reason="macro_radar.db not present")
def test_every_served_label_maps_to_its_lookback_on_the_stored_database(monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", Path(__file__).resolve().parents[1] / "data" / "macro_radar.db")
    for s in db.credit_oas(90)["series"]:
        basis, frm = s["change_basis"], s["change_from"]
        if basis == "1w":
            gap = (date.fromisoformat(s["date"]) - date.fromisoformat(frm)).days
            # Codex R-24: the stated limit, typed here, never read back from the code under test.
            assert 7 <= gap <= 10, (s["series_id"], s["date"], frm)
            assert s["change_1w_bps"] == s["change_bps"] and s["history_basis"] == "daily"
        elif basis == "month_end":
            assert len(frm) == 7 and frm < s["date"][:7], (s["series_id"], frm, s["date"])
            assert s["change_1w_bps"] is None
        else:
            assert s["change_bps"] is None and s["change_1w_bps"] is None


# ── Codex round 1 (R-05, R-06): the Desk's eligibility rules, and no watermark ──

def _migrate(path: Path, *, committed_on: str) -> None:
    """Give desk_series provenance the way the refresh does: every stored row
    becomes the committed pre-provenance run dated `committed_on` (New York)."""
    from datetime import datetime, timezone

    from api import provenance

    conn = sqlite3.connect(path)
    y, m, d = map(int, committed_on.split("-"))
    provenance.migrate(conn, now=datetime(y, m, d, 22, tzinfo=timezone.utc))  # 18:00 ET that day
    conn.commit()
    conn.close()


def _add_desk_rows(path: Path, series_id: str, rows: dict[str, float], *, run_id: str, run_as_of: str, status: str) -> None:
    from api import provenance

    conn = sqlite3.connect(path)
    conn.execute(f"INSERT OR IGNORE INTO {provenance.RUNS} (run_id, started_at, as_of, committed_at, status) VALUES (?, ?, ?, ?, ?)",
                 (run_id, f"{run_as_of}T21:00:00Z", run_as_of, f"{run_as_of}T21:05:00Z" if status == "committed" else None, status))
    conn.executemany("INSERT OR REPLACE INTO desk_series (series_id, date, value, provider, run_id, ingested_at) VALUES (?, ?, ?, 'FRED', ?, ?)",
                     [(series_id, d, v, run_id, f"{run_as_of}T21:00:00Z") for d, v in rows.items()])
    conn.commit()
    conn.close()


def _read(path: Path, monkeypatch) -> dict:
    monkeypatch.setattr(db, "DB_PATH", path)
    return {s["series_id"]: s for s in db.credit_oas(DAYS)["series"]}


def test_r05_rows_the_desk_refuses_never_reach_the_rates(tmp_path, monkeypatch):
    """Codex R-05: an uncommitted DGS10 row of 999 (the repro's 99,500 bp), a
    row dated after its committed run's day, a far-future row and a non-finite
    value are all left out of the latest value, the week and the sparkline,
    exactly as the Desk's reader leaves them out."""
    path = tmp_path / "macro_radar.db"
    _store(path, desk={"DGS10": DGS10_DAILY}, raw=RAW, marks=MARKS)
    _migrate(path, committed_on="2026-09-28")
    _add_desk_rows(path, "DGS10", {"2026-09-29": 999.0}, run_id="uncommitted", run_as_of="2026-09-29", status="started")
    _add_desk_rows(path, "DGS10", {"2026-09-30": 888.0}, run_id="early-run", run_as_of="2026-09-29", status="committed")
    _add_desk_rows(path, "DGS10", {"2999-01-04": 777.0}, run_id="far-future", run_as_of="2999-01-04", status="committed")
    _add_desk_rows(path, "DGS10", {"2026-09-25": float("inf")}, run_id="inf-run", run_as_of="2026-09-28", status="committed")
    ten = _read(path, monkeypatch)["DGS10"]
    assert ten["date"] == "2026-09-28" and ten["value_pct"] == pytest.approx(5.24)
    assert (ten["change_basis"], ten["change_from"]) == ("1w", "2026-09-21")
    assert ten["change_bps"] == pytest.approx(28.0)  # never 99,500 bp
    dates = [h["date"] for h in ten["history"]]
    assert "2026-09-29" not in dates and "2026-09-30" not in dates and "2999-01-04" not in dates
    assert "2026-09-25" not in dates  # the non-finite value is dropped, not served
    assert all(abs(h["value"]) < 100 for h in ten["history"])


def test_r05_the_comparison_value_obeys_the_same_rules(tmp_path, monkeypatch):
    """The only candidate in the 7–10 day window is uncommitted: no week is claimed."""
    path = tmp_path / "macro_radar.db"
    newest_only = {d: v for d, v in DGS10_DAILY.items() if d >= "2026-09-22"}
    _store(path, desk={"DGS10": newest_only}, raw=RAW, marks=MARKS)
    _migrate(path, committed_on="2026-09-28")
    _add_desk_rows(path, "DGS10", {"2026-09-21": 1.0}, run_id="uncommitted", run_as_of="2026-09-28", status="started")
    ten = _read(path, monkeypatch)["DGS10"]
    assert ten["date"] == "2026-09-28"
    assert ten["change_basis"] is None and ten["change_bps"] is None


def test_r06_without_a_source_watermark_the_month_row_is_read(store):
    """Codex R-06: desk DGS10 Aug 31 = 4, raw DGS10 Sep 1 = 5, no fred:DGS10
    watermark: nothing shows the desk row is current, so raw_series serves."""
    raw = {"DGS10": {"2026-08-01": 4.75, "2026-09-01": 5.0}}
    ten = store(desk={"DGS10": {"2026-08-28": 4.6, "2026-08-31": 4.0}}, raw=raw, marks={})["DGS10"]
    assert ten["value_pct"] == pytest.approx(5.0)
    assert (ten["change_basis"], ten["change_from"]) == ("month_end", "2026-08")
    assert ten["history_basis"] == "monthly"


# ── Codex round 1 (R-24): the seven-to-ten-day window, asserted on its own ──

@pytest.mark.parametrize(
    ("case", "daily", "want"),
    [
        ("exactly 7 days", {"2026-09-21": 4.96, "2026-09-28": 5.24}, ("1w", "2026-09-21")),
        ("10 days: the limit", {"2026-09-18": 5.01, "2026-09-28": 5.24}, ("1w", "2026-09-18")),
        ("11 days: past the limit", {"2026-09-17": 4.94, "2026-09-28": 5.24}, (None, None)),
        # Labor Day (Mon Sep 7 2026, no bond session): seven days before Mon Sep 14 has no row; Fri Sep 4 is 10 back.
        ("Labor Day week", {"2026-09-04": 4.70, "2026-09-08": 4.72, "2026-09-11": 4.80, "2026-09-14": 4.85}, ("1w", "2026-09-04")),
        # Thanksgiving (Thu Nov 27 2025): seven days before Thu Dec 4 has no row; Wed Nov 26 is 8 back, and
        # Fri Nov 28 is less than seven days back, so it is never the comparison. (A past year: the Desk's reader
        # refuses rows dated after today, R-05.)
        ("Thanksgiving week", {"2025-11-26": 4.00, "2025-11-28": 4.02, "2025-12-04": 4.11}, ("1w", "2025-11-26")),
    ],
)
def test_r24_the_week_is_seven_to_ten_calendar_days_back(store, case, daily, want):
    newest = max(daily)
    raw = {"DGS10": {f"{newest[:4]}-08-01": 4.75, f"{newest[:7]}-01": daily[newest]}}
    ten = store(desk={"DGS10": daily}, raw=raw, marks={"fred:DGS10": newest})["DGS10"]
    assert ten["date"] == newest, case
    assert (ten["change_basis"], ten["change_from"]) == want, case
    if want[0] == "1w":
        gap = (date.fromisoformat(newest) - date.fromisoformat(want[1])).days
        assert 7 <= gap <= 10, case
        assert ten["change_bps"] == pytest.approx((daily[newest] - daily[want[1]]) * 100.0), case
    else:
        assert ten["change_bps"] is None and ten["change_1w_bps"] is None, case


# ── fix/freshness 8: the 30Y Treasury, its own field on the same path ───────

DGS30_DAILY = {"2026-09-21": 4.88, "2026-09-22": 4.89, "2026-09-25": 5.02, "2026-09-28": 5.06}


def _with_desk_mark(path: Path, series_id: str, last_obs: str) -> None:
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO source_watermarks (source, last_obs, status) VALUES (?, ?, 'ok')", (f"desk:{series_id}", last_obs))
    conn.commit()
    conn.close()


def test_the_30y_is_its_own_field_with_a_true_week(tmp_path, monkeypatch):
    path = tmp_path / "macro_radar.db"
    _store(path, desk={"DGS10": DGS10_DAILY, "DGS30": DGS30_DAILY}, raw=RAW, marks=MARKS)
    _with_desk_mark(path, "DGS30", "2026-09-28")
    monkeypatch.setattr(db, "DB_PATH", path)
    out = db.credit_oas(DAYS)
    assert "DGS30" not in {s["series_id"] for s in out["series"]}  # no Credit chart draws it
    u = out["ust30y"]
    assert (u["series_id"], u["label"], u["date"], u["value_pct"]) == ("DGS30", "UST30Y", "2026-09-28", 5.06)
    assert (u["change_basis"], u["change_from"]) == ("1w", "2026-09-21")
    assert u["change_bps"] == pytest.approx(18.0) and u["change_1w_bps"] == pytest.approx(18.0)
    assert u["history_basis"] == "daily" and [h["date"] for h in u["history"]] == sorted(DGS30_DAILY)
    assert out["as_of"] == "2026-09-29"  # the 30Y, like the 10Y, never dates the credit block


def test_the_30y_obeys_the_desks_eligibility_rules(tmp_path, monkeypatch):
    path = tmp_path / "macro_radar.db"
    _store(path, desk={"DGS30": DGS30_DAILY}, raw=RAW, marks=MARKS)
    _with_desk_mark(path, "DGS30", "2026-09-28")
    _migrate(path, committed_on="2026-09-28")
    _add_desk_rows(path, "DGS30", {"2026-09-29": 999.0}, run_id="uncommitted", run_as_of="2026-09-29", status="started")
    monkeypatch.setattr(db, "DB_PATH", path)
    u = db.credit_oas(DAYS)["ust30y"]
    assert u["date"] == "2026-09-28" and u["value_pct"] == pytest.approx(5.06)
    assert all(h["value"] < 100 for h in u["history"])


def test_without_a_watermark_or_a_desk_store_the_30y_is_null(tmp_path, monkeypatch):
    path = tmp_path / "macro_radar.db"
    _store(path, desk={"DGS30": DGS30_DAILY}, raw=RAW, marks=MARKS)  # no desk:DGS30 watermark
    monkeypatch.setattr(db, "DB_PATH", path)
    assert db.credit_oas(DAYS)["ust30y"] is None
    path2 = tmp_path / "older.db"
    _store(path2, desk=None, raw=RAW, marks=MARKS)
    monkeypatch.setattr(db, "DB_PATH", path2)
    assert db.credit_oas(DAYS)["ust30y"] is None
