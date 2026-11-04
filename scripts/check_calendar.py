"""scripts/check_calendar.py — check events/calendar.csv against FRED's release dates (desk upgrade P0d).

events/calendar.csv is kept by hand and loaded into event_calendar by every full
refresh (src/events/load_events.py). It dates the CPI and jobs-report releases the
freshness rules read (api/freshness.release_times), the next CPI and INDPRO
prints on the Desk's Regime page (api/desk_items_macro.NEXT_PRINTS), the macro
events the Options Finder lists, and the News calendar. A wrong or missing row
shows a wrong date, or none, on screen; nothing else catches it.

Two checks:

  offline (always): the file's shape. Header, ISO UTC stamps, known importance,
      no duplicate (event, time), every row in a known family, and every
      row's time equal to its family's release time in New York on that date
      (08:30 ET for BLS, BEA and Census, 09:15 ET for the Fed's G.17, 14:00 ET
      for an FOMC statement), so a daylight-saving slip is caught.

  online (needs FRED_API_KEY): each family with a FRED release against FRED's
      release dates (fred/release/dates, include_release_dates_with_no_data, so
      scheduled dates count), from --start on.
        - every row's New York date up to FRED's last listed date must be a FRED
          release date (error). Rows after it (the next year's dates, which FRED
          lists late) are reported as not yet checkable (note): they come from
          the agency's own published schedule, and the check holds them to FRED
          once FRED lists that far. Rows for a release FRED lists no dates for at
          all from --start are an error (a wrong id or a bad answer), never a pass;
        - for the strict families (CPI, the jobs report, G.17) every FRED date
          must have a row (error). Retail sales, GDP and PCE are advisory the
          other way: FRED also lists revision-only dates for them (the retail
          annual revision of 2026-09-28, say), so a FRED date without a row is
          reported, never failed;
        - FRED dates after the file's last row of that family mean the file
          needs extending (error);
        - a family whose last row is fewer than --horizon days ahead is
          reported (warning): FRED has not published further dates yet, and the
          screens go blank after that row.
      The FOMC has no FRED release with meeting dates; its rows are checked
      offline only and reported as unchecked.

Exit 0 when there are no errors, 1 otherwise. Warnings never fail the run.

    python scripts/check_calendar.py              # offline + online
    python scripts/check_calendar.py --offline    # shape only, no network
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time as _time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "events" / "calendar.csv"
NY = ZoneInfo("America/New_York")
FRED_RELEASE_DATES = "https://api.stlouisfed.org/fred/release/dates"
HEADER = ["event_name", "event_datetime", "importance"]
IMPORTANCE = {"high", "medium", "low"}
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DEFAULT_HORIZON_DAYS = 45


@dataclass(frozen=True)
class Family:
    key: str
    pattern: re.Pattern
    release_et: time
    fred_release: int | None    # FRED release id; None: no FRED release dates the event
    strict: bool                # every FRED date must have a row
    source: str
    schedule: str = ""          # the agency's own published schedule


FAMILIES: tuple[Family, ...] = (
    Family("cpi", re.compile(r"^CPI Release$"), time(8, 30), 10, True, "BLS Consumer Price Index (FRED release 10)",
           "https://www.bls.gov/schedule/2027/home.htm"),
    Family("jobs", re.compile(r"^Jobs Report \(NFP\)$"), time(8, 30), 50, True, "BLS Employment Situation (FRED release 50)",
           "https://www.bls.gov/schedule/2027/home.htm"),
    Family("g17", re.compile(r"^Industrial Production \(G\.17\)$"), time(9, 15), 13, True,
           "Fed G.17 Industrial Production and Capacity Utilization (FRED release 13)",
           "https://www.federalreserve.gov/releases/g17/release_dates.htm"),
    Family("retail", re.compile(r"^Retail Sales$"), time(8, 30), 9, False,
           "Census Advance Monthly Retail Trade (FRED release 9)",
           "https://www.census.gov/economic-indicators/calendar-listview.html"),
    Family("gdp", re.compile(r"^GDP (Advance|Second Estimate|Third Estimate) Q[1-4] \d{4}$"), time(8, 30), 53, False,
           "BEA Gross Domestic Product (FRED release 53)",
           "https://www.bea.gov/news/schedule"),
    Family("pce", re.compile(r"^PCE Inflation$"), time(8, 30), 54, False, "BEA Personal Income and Outlays (FRED release 54)",
           "https://www.bea.gov/news/schedule"),
    Family("fomc", re.compile(r"^FOMC Meeting$"), time(14, 0), None, False, "Federal Reserve FOMC calendar (no FRED release)",
           "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"),
)


@dataclass
class Row:
    line: int
    name: str
    stamp: str
    importance: str
    at: datetime | None = None
    family: Family | None = None

    @property
    def ny_date(self) -> date | None:
        return self.at.astimezone(NY).date() if self.at else None


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def family_of(name: str) -> Family | None:
    return next((f for f in FAMILIES if f.pattern.match(name)), None)


def release_stamp(day: date, fam: Family) -> str:
    """The UTC stamp of a release on that New York date at its family's time."""
    at = datetime.combine(day, fam.release_et, tzinfo=NY).astimezone(timezone.utc)
    return at.strftime("%Y-%m-%dT%H:%M:%SZ")


def read_rows(path: Path, rep: Report) -> list[Row]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header != HEADER:
            rep.errors.append(f"header is {header}, expected {HEADER}")
            return []
        rows = [Row(n, *(c.strip() for c in r)) if len(r) == 3 else Row(n, "", "", "")
                for n, r in enumerate(reader, start=2) if r]
    return rows


def check_offline(rows: list[Row], rep: Report) -> None:
    seen: dict[tuple[str, str], int] = {}
    for r in rows:
        where = f"line {r.line} ({r.name or '?'} {r.stamp or '?'})"
        if not (r.name and r.stamp and r.importance):
            rep.errors.append(f"{where}: needs three fields")
            continue
        if not STAMP.match(r.stamp):
            rep.errors.append(f"{where}: event_datetime must be UTC as YYYY-MM-DDTHH:MM:SSZ")
            continue
        r.at = datetime.strptime(r.stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if r.importance not in IMPORTANCE:
            rep.errors.append(f"{where}: importance {r.importance!r} is not one of {sorted(IMPORTANCE)}")
        if (r.name, r.stamp) in seen:
            rep.errors.append(f"{where}: duplicates line {seen[(r.name, r.stamp)]}")
        seen[(r.name, r.stamp)] = r.line
        r.family = family_of(r.name)
        if r.family is None:
            rep.errors.append(f"{where}: not a known event family; add it to FAMILIES with its source and release time")
            continue
        want = release_stamp(r.ny_date, r.family)
        if r.stamp != want:
            rep.errors.append(f"{where}: {r.family.release_et:%H:%M} ET on {r.ny_date} is {want}")
    stamps = [r.stamp for r in rows if r.at]
    if stamps != sorted(stamps):
        rep.warnings.append("rows are not in time order (the loader does not care; a reader of the file does)")


def fred_release_dates(release_id: int, start: date, key: str, *, opener=urllib.request.urlopen) -> list[date]:
    """Every release date FRED lists for the release from `start`, scheduled ones included."""
    params = {"release_id": release_id, "api_key": key, "file_type": "json", "realtime_start": start.isoformat(),
              "realtime_end": "9999-12-31", "include_release_dates_with_no_data": "true", "sort_order": "asc",
              "limit": 10000}
    url = f"{FRED_RELEASE_DATES}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        try:
            with opener(url, timeout=30) as resp:
                body = json.load(resp)
            return sorted({date.fromisoformat(d["date"]) for d in body["release_dates"]})
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 3:
                raise RuntimeError(f"FRED release {release_id}: {exc}") from exc
            _time.sleep(2 ** (attempt + 1))
    raise AssertionError("unreachable")


def check_online(rows: list[Row], rep: Report, *, key: str, start: date, today: date, horizon: int,
                 fetch=fred_release_dates) -> None:
    for fam in FAMILIES:
        mine = sorted(r.ny_date for r in rows if r.family is fam and r.at and r.ny_date >= start)
        last = max((r.ny_date for r in rows if r.family is fam and r.at), default=None)
        if fam.fred_release is None:
            rep.notes.append(f"{fam.key}: {len(mine)} rows from {start}, not checked against FRED ({fam.source})")
        else:
            fred = fetch(fam.fred_release, start, key)
            fred_set = set(fred)
            fred_last = fred[-1] if fred else None
            if mine and fred_last is None:
                # rows to check and no FRED date at all from --start: a wrong release id or a bad answer, never
                # "FRED has not listed this far" (that would pass every row unchecked)
                rep.errors.append(f"{fam.key}: FRED lists no release dates for release {fam.fred_release} from "
                                  f"{start}; {len(mine)} rows cannot be checked ({fam.source})")
            ahead = [d for d in mine if fred_last is not None and d > fred_last]
            for d in mine:
                if fred_last is not None and d not in fred_set and d not in ahead:
                    rep.errors.append(f"{fam.key}: a row on {d} is not a FRED release date ({fam.source})")
            if ahead:
                rep.notes.append(f"{fam.key}: {len(ahead)} rows after FRED's last listed date "
                                 f"({fred_last}), {ahead[0]} to {ahead[-1]}: not checkable against FRED "
                                 f"until it lists them; they come from the agency's own schedule ({fam.schedule})")
            missing = [d for d in fred if d not in set(mine)]
            beyond = [d for d in missing if last is None or d > last]
            within = [d for d in missing if d not in beyond]
            if beyond:
                rep.errors.append(f"{fam.key}: FRED dates after the last row ({last}): "
                                  f"{', '.join(map(str, beyond))}; extend the file")
            if within:
                (rep.errors if fam.strict else rep.notes).append(
                    f"{fam.key}: FRED dates without a row: {', '.join(map(str, within))}"
                    + ("" if fam.strict else " (advisory: FRED also lists revision-only dates for this release)"))
            rep.notes.append(f"{fam.key}: {len(mine)} rows from {start}; FRED lists {len(fred)}, through "
                             f"{fred[-1] if fred else 'none'}")
        if last is None or (last - today).days < horizon:
            rep.warnings.append(f"{fam.key}: the last row is {last}, fewer than {horizon} days after {today}; "
                                "after it the screens show no date")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--csv", type=Path, default=CSV_PATH)
    ap.add_argument("--offline", action="store_true", help="check the file's shape only, without FRED")
    ap.add_argument("--start", type=date.fromisoformat, default=None,
                    help="first date compared with FRED (default: 1 January of the file's first row)")
    ap.add_argument("--today", type=date.fromisoformat, default=None, help="today in New York (default: now)")
    ap.add_argument("--horizon", type=int, default=DEFAULT_HORIZON_DAYS,
                    help=f"warn when a family's last row is fewer days ahead than this (default {DEFAULT_HORIZON_DAYS})")
    a = ap.parse_args(argv)
    rep = Report()
    rows = read_rows(a.csv, rep)
    check_offline(rows, rep)
    if not a.offline and not rep.errors:
        key = os.environ.get("FRED_API_KEY", "").strip()
        if not key:
            rep.errors.append("FRED_API_KEY is not set; run with --offline for the shape check only")
        else:
            first = min((r.at for r in rows if r.at), default=None)
            start = a.start or (date(first.year, 1, 1) if first else date.today())
            today = a.today or datetime.now(timezone.utc).astimezone(NY).date()
            check_online(rows, rep, key=key, start=start, today=today, horizon=a.horizon)
    print(f"[calendar] {a.csv.relative_to(ROOT) if a.csv.is_relative_to(ROOT) else a.csv}: {len(rows)} rows")
    for kind, items in (("ERROR", rep.errors), ("WARN", rep.warnings), ("note", rep.notes)):
        for m in items:
            print(f"[calendar] {kind}: {m}")
    print(f"[calendar] {'FAIL' if rep.errors else 'PASS'}: {len(rep.errors)} errors, {len(rep.warnings)} warnings")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
