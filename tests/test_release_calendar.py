"""tests/test_release_calendar.py — events/calendar.csv and its check (desk upgrade P0d).

The hand-kept calendar dates what three screens show: the CPI and jobs-report
releases the freshness rules read (api/freshness.RELEASE_EVENTS), NEXT CPI and
NEXT INDPRO on the Desk's Regime page (api/desk_items_macro.NEXT_PRINTS), and
the macro events the News calendar and the Options Finder list.

- **The file's shape** through scripts/check_calendar.py's offline check: ISO UTC
  stamps, each family's release time in New York (daylight saving included),
  no duplicates, known families only.
- **The consumers' event names** exist in the file and in the check's families.
- **The 2026 dates** of the strict families equal FRED's release dates as read
  on 2026-11-03 (fred/release/dates, releases 10, 50 and 13), pinned here so
  the suite catches an edit without the network. The live comparison is
  `python scripts/check_calendar.py` (FRED_API_KEY).
- **The 2027 dates** of every family equal the agencies' own published
  schedules as read on 2026-11-04 (FRED listed no 2027 dates then), pinned
  the same way.
- **The online check's rules** on a fake FRED, including rows after FRED's
  last listed date (reported, not failed, until FRED lists that far).
- **The loader** keeps the store to the file: a manual_csv row the file no
  longer lists is deleted; other sources' rows are untouched; an empty file
  deletes nothing.
"""

from __future__ import annotations

import csv
import sqlite3
import sys
from datetime import date
from pathlib import Path

import pytest

from api import desk_items_macro as items
from api import freshness

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "events" / "calendar.csv"
sys.path.insert(0, str(ROOT / "scripts"))
import check_calendar as cc  # noqa: E402

# FRED fred/release/dates (include_release_dates_with_no_data=true), read 2026-11-03.
FRED_2026 = {
    "cpi": ["2026-01-13", "2026-02-13", "2026-03-11", "2026-04-10", "2026-05-12", "2026-06-10", "2026-07-14",
            "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-10", "2026-12-10"],
    "jobs": ["2026-01-09", "2026-02-11", "2026-03-06", "2026-04-03", "2026-05-08", "2026-06-05", "2026-07-02",
             "2026-08-07", "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04"],
    "g17": ["2026-01-16", "2026-02-18", "2026-03-16", "2026-04-16", "2026-05-15", "2026-06-15", "2026-07-17",
            "2026-08-18", "2026-09-18", "2026-10-16", "2026-11-17", "2026-12-16"],
}


# The agencies' own schedules, read 2026-11-04 ~20:05-20:20 UTC (FRED listed no 2027 dates for these releases then):
#   g17    https://www.federalreserve.gov/releases/g17/release_dates.htm (page last updated 2026-08-18)
#   retail https://www.census.gov/economic-indicators/calendar-listview.html (2027 calendar,
#          "Advance Monthly Sales for Retail and Food Services")
#   gdp    https://www.bea.gov/news/schedule/next-year (GDP Advance, Second and Third Estimate)
#   pce    https://www.bea.gov/news/schedule/next-year ("Personal Income and Outlays")
#   fomc   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (2027 meetings, statement on the
#          second day; "each meeting date is tentative until confirmed at the meeting immediately preceding it")
#   cpi, jobs  BLS "Schedule of Selected Releases 2027" (https://www.bls.gov/schedule/2027/home.htm), from the
#          owner's browser copy printed 2026-11-04 20:20 UTC: bls.gov answers 403 to the cloud environment
AGENCY_2027 = {
    "g17": ["2027-01-15", "2027-02-17", "2027-03-15", "2027-04-15", "2027-05-17", "2027-06-16", "2027-07-16",
            "2027-08-17", "2027-09-16", "2027-10-18", "2027-11-17", "2027-12-16"],
    "retail": ["2027-01-15", "2027-02-17", "2027-03-16", "2027-04-16", "2027-05-14", "2027-06-16", "2027-07-16",
               "2027-08-16", "2027-09-16", "2027-10-15", "2027-11-16", "2027-12-15"],
    "gdp": ["2027-01-28", "2027-02-25", "2027-03-31", "2027-04-29", "2027-05-27", "2027-06-25", "2027-07-29",
            "2027-08-25", "2027-09-30", "2027-10-28", "2027-11-24", "2027-12-22"],
    "pce": ["2027-01-28", "2027-02-25", "2027-03-31", "2027-04-29", "2027-05-27", "2027-06-25", "2027-07-29",
            "2027-08-25", "2027-09-30", "2027-10-28", "2027-11-24", "2027-12-22"],
    "fomc": ["2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27",
             "2027-12-08"],
    "cpi": ["2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12", "2027-06-10", "2027-07-14",
            "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10"],
    "jobs": ["2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02", "2027-05-07", "2027-06-04", "2027-07-02",
             "2027-08-06", "2027-09-03", "2027-10-08", "2027-11-05", "2027-12-03"],
}

def _rows(path: Path = CSV_PATH) -> tuple[list[cc.Row], cc.Report]:
    rep = cc.Report()
    rows = cc.read_rows(path, rep)
    cc.check_offline(rows, rep)
    return rows, rep


def _write(path: Path, lines: list[str]) -> Path:
    path.write_text("\n".join(["event_name,event_datetime,importance", *lines]) + "\n")
    return path


# ── the file ────────────────────────────────────────────────────────────────

def test_the_calendar_passes_the_offline_check():
    rows, rep = _rows()
    assert rep.errors == [] and rep.warnings == [], (rep.errors, rep.warnings)
    assert len(rows) >= 80
    assert cc.main(["--offline"]) == 0


def test_every_consumers_event_name_is_a_checked_family_with_rows():
    rows, _ = _rows()
    names = {r.name for r in rows}
    consumed = {e for e in freshness.RELEASE_EVENTS} | {e for *_, e in items.NEXT_PRINTS}
    assert None not in consumed  # P0d: INDPRO's release is dated too
    for name in consumed:
        fam = cc.family_of(name)
        assert fam is not None and fam.fred_release is not None and fam.strict, name
        assert name in names, name


@pytest.mark.parametrize("fam", sorted(FRED_2026))
def test_the_2026_dates_are_freds(fam):
    rows, _ = _rows()
    mine = [r.ny_date.isoformat() for r in rows if r.family is not None and r.family.key == fam and r.at.year == 2026]
    assert mine == FRED_2026[fam]


@pytest.mark.parametrize("fam", sorted(AGENCY_2027))
def test_the_2027_dates_are_the_agencies(fam):
    rows, _ = _rows()
    mine = [r.ny_date.isoformat() for r in rows if r.family is not None and r.family.key == fam and r.at.year == 2027]
    assert mine == AGENCY_2027[fam]


def test_the_2027_gdp_rows_name_their_quarter_and_estimate():
    rows, _ = _rows()
    gdp = [(r.ny_date.isoformat(), r.name, r.importance) for r in rows
           if r.family is not None and r.family.key == "gdp" and r.at.year == 2027]
    assert gdp[:3] == [("2027-01-28", "GDP Advance Q4 2026", "high"),
                       ("2027-02-25", "GDP Second Estimate Q4 2026", "medium"),
                       ("2027-03-31", "GDP Third Estimate Q4 2026", "medium")]
    assert gdp[-1] == ("2027-12-22", "GDP Third Estimate Q3 2027", "medium")


def test_the_g17_rows_are_at_0915_new_york_through_both_clocks():
    rows, _ = _rows()
    g17 = {r.ny_date.isoformat(): r.stamp for r in rows if r.family is not None and r.family.key == "g17"}
    assert g17["2026-10-16"] == "2026-10-16T13:15:00Z"   # EDT
    assert g17["2026-11-17"] == "2026-11-17T14:15:00Z"   # EST


# ── the offline check ───────────────────────────────────────────────────────

def test_the_offline_check_catches_a_daylight_saving_slip_and_bad_rows(tmp_path):
    path = _write(tmp_path / "c.csv", [
        "CPI Release,2026-11-10T12:30:00Z,high",          # 07:30 EST: the EDT stamp kept past the clock change
        "CPI Release,2026-10-14T12:30:00Z,high",
        "CPI Release,2026-10-14T12:30:00Z,high",          # duplicate
        "Housing Starts,2026-10-17T12:30:00Z,low",        # no family
        "Jobs Report (NFP),2026-10-02 12:30,high",        # not the stamp format
        "PCE Inflation,2026-10-29T12:30:00Z,urgent",      # importance
    ])
    _, rep = _rows(path)
    joined = "\n".join(rep.errors)
    assert "08:30 ET on 2026-11-10 is 2026-11-10T13:30:00Z" in joined
    assert "duplicates line 3" in joined
    assert "not a known event family" in joined
    assert "must be UTC" in joined
    assert "importance 'urgent'" in joined
    assert cc.main(["--offline", "--csv", str(path)]) == 1


# ── the online check, on a fake FRED ────────────────────────────────────────

def _online(lines: list[str], fred: dict[int, list[str]], tmp_path, today="2026-11-03") -> cc.Report:
    rows, rep = _rows(_write(tmp_path / "c.csv", lines))
    assert rep.errors == []
    cc.check_online(rows, rep, key="k", start=date(2026, 1, 1), today=date.fromisoformat(today), horizon=45,
                    fetch=lambda rid, start, key: [date.fromisoformat(d) for d in fred.get(rid, [])])
    return rep


def test_a_row_fred_does_not_list_fails(tmp_path):
    rep = _online(["CPI Release,2026-10-15T12:30:00Z,high", "CPI Release,2026-11-10T13:30:00Z,high"],
                  {10: ["2026-10-14", "2026-11-10"]}, tmp_path)
    assert any("cpi: a row on 2026-10-15 is not a FRED release date" in e for e in rep.errors)
    assert any("cpi: FRED dates without a row: 2026-10-14" in e for e in rep.errors)  # strict


def test_fred_dates_after_the_last_row_fail_and_a_short_horizon_warns(tmp_path):
    rep = _online(["Industrial Production (G.17),2026-11-17T14:15:00Z,medium"],
                  {13: ["2026-11-17", "2026-12-16"]}, tmp_path)
    assert any("g17: FRED dates after the last row (2026-11-17): 2026-12-16; extend the file" in e for e in rep.errors)
    assert any(w.startswith("g17: the last row is 2026-11-17") for w in rep.warnings)


def test_rows_after_freds_last_date_are_reported_not_failed_until_fred_lists_them(tmp_path):
    lines = ["Industrial Production (G.17),2026-12-16T14:15:00Z,medium",
             "Industrial Production (G.17),2027-01-15T14:15:00Z,medium",
             "Industrial Production (G.17),2027-02-17T14:15:00Z,medium"]
    rep = _online(lines, {13: ["2026-12-16"]}, tmp_path)
    assert rep.errors == []
    assert any(n.startswith("g17: 2 rows after FRED's last listed date (2026-12-16), 2027-01-15 to 2027-02-17")
               and "federalreserve.gov/releases/g17" in n for n in rep.notes)
    # once FRED lists that far, the rows are held to it again
    rep = _online(lines, {13: ["2026-12-16", "2027-01-14", "2027-02-17"]}, tmp_path)
    assert any("g17: a row on 2027-01-15 is not a FRED release date" in e for e in rep.errors)
    assert any("g17: FRED dates without a row: 2027-01-14" in e for e in rep.errors)
    # a FRED that lists nothing for the release fails: it would otherwise pass every row unchecked
    rep = _online(lines, {}, tmp_path)
    assert rep.errors == ["g17: FRED lists no release dates for release 13 from 2026-01-01; 3 rows cannot be "
                          "checked (Fed G.17 Industrial Production and Capacity Utilization (FRED release 13))"]
    assert not [n for n in rep.notes if "after FRED's last listed date" in n]


def test_a_revision_only_fred_date_is_advisory_for_retail(tmp_path):
    rep = _online(["Retail Sales,2026-09-16T12:30:00Z,medium", "Retail Sales,2027-01-15T13:30:00Z,medium"],
                  {9: ["2026-09-16", "2026-09-28", "2027-01-15"]}, tmp_path)
    assert not [e for e in rep.errors if e.startswith("retail")]
    assert any("retail: FRED dates without a row: 2026-09-28 (advisory" in n for n in rep.notes)


def test_the_fomc_is_reported_unchecked(tmp_path):
    rep = _online(["FOMC Meeting,2026-12-09T19:00:00Z,high"], {}, tmp_path, today="2026-10-01")
    assert rep.errors == []
    assert any(n.startswith("fomc: 1 rows from 2026-01-01, not checked against FRED") for n in rep.notes)


# ── the loader keeps the store to the file ──────────────────────────────────

@pytest.fixture()
def loader(tmp_path, monkeypatch):
    from src import migrate
    from src.events import load_events as le

    db = tmp_path / "macro_radar.db"
    with sqlite3.connect(db) as conn:
        conn.executescript(migrate.EVENT_CALENDAR_DDL)
        migrate.ensure_event_calendar_schema(conn)
        conn.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                         "VALUES (?,?,?,?,?,?,?)", [
                             ("CPI Release", "2026-03-12T12:30:00Z", "high", "manual_csv", "t", None, None),  # corrected away
                             ("CPI Release", "2026-10-14T12:30:00Z", "high", "manual_csv", "t", None, None),
                             ("NVDA earnings (Q3 2027)", "2026-11-19T21:00:00Z", "medium", "finnhub_earnings", "t",
                              "NVDA", "earnings"),
                         ])
    monkeypatch.setattr(le, "DB_PATH", db)
    return le, db, tmp_path


def _stored(db: Path) -> list[tuple]:
    with sqlite3.connect(db) as conn:
        return conn.execute("SELECT event_name, event_datetime, source FROM event_calendar ORDER BY event_datetime").fetchall()


def test_the_loader_removes_a_row_the_file_no_longer_lists(loader, monkeypatch):
    le, db, tmp = loader
    monkeypatch.setattr(le, "CSV_PATH", _write(tmp / "c.csv", ["CPI Release,2026-03-11T12:30:00Z,high",
                                                               "CPI Release,2026-10-14T12:30:00Z,high"]))
    assert le.load_events() == 1
    assert _stored(db) == [("CPI Release", "2026-03-11T12:30:00Z", "manual_csv"),
                           ("CPI Release", "2026-10-14T12:30:00Z", "manual_csv"),
                           ("NVDA earnings (Q3 2027)", "2026-11-19T21:00:00Z", "finnhub_earnings")]
    assert le.load_events() == 0 and len(_stored(db)) == 3  # idempotent


def test_an_empty_file_removes_nothing(loader, monkeypatch):
    le, db, tmp = loader
    monkeypatch.setattr(le, "CSV_PATH", _write(tmp / "c.csv", []))
    before = _stored(db)
    assert le.load_events() == 0
    assert _stored(db) == before


def test_the_repo_calendar_loads_over_the_published_rows_it_corrects(loader, monkeypatch):
    """The published store holds the old file's rows; loading this one leaves exactly this file's rows."""
    le, db, _ = loader
    monkeypatch.setattr(le, "CSV_PATH", CSV_PATH)
    le.load_events()
    manual = {(n, t) for n, t, s in _stored(db) if s == "manual_csv"}
    with CSV_PATH.open() as fh:
        assert manual == {(r["event_name"], r["event_datetime"]) for r in csv.DictReader(fh)}
    assert ("NVDA earnings (Q3 2027)", "2026-11-19T21:00:00Z", "finnhub_earnings") in _stored(db)


@pytest.mark.parametrize("lines", [
    ["CPI Release,not-a-date,high"],                                              # only an invalid row (Codex S-01)
    ["CPI Release,2026-03-11T12:30:00Z,high", "CPI Release,,high"],               # a valid row and a blank field
])
def test_codex_s01_a_file_with_a_rejected_row_deletes_nothing(loader, monkeypatch, lines):
    """Codex S-01: a rejected row used to count as listed, so a file holding only an invalid row
    deleted every valid stored row. Any rejected row now skips the reconciliation: the valid rows
    still load, and nothing stored is deleted until the file is clean."""
    le, db, tmp = loader
    monkeypatch.setattr(le, "CSV_PATH", _write(tmp / "c.csv", lines))
    before = set(_stored(db))
    le.load_events()
    after = set(_stored(db))
    assert before <= after
    assert len(after - before) == (1 if len(lines) == 2 else 0)
