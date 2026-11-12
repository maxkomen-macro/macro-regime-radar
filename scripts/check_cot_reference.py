"""scripts/check_cot_reference.py — check stored CFTC positions against the CFTC's own yearly report files (Desk P4).

The plan's gate 3 (independent reference check) for positioning: "CFTC
positions against CFTC's own report". The store reads the CFTC's Public
Reporting Environment API (src/market_data/cot.py); this script reads the
other product the CFTC publishes for the same reports, the yearly compressed
text files of the historical archive
(https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm):

    fut_fin_txt_<year>.zip     Traders in Financial Futures, futures only (FinFutYY.txt)
    fut_disagg_txt_<year>.zip  Disaggregated, futures only (f_year.txt)
    fin_fut_txt_2006_2016.zip and fut_disagg_txt_hist_2006_2016.zip, the reports before 2017 (pass them with --files)

and compares every stored number for the five markets in those years: each
category's long, short and spreading contracts and the open interest. The
tolerance, fixed before the first run, is zero: positions are whole numbers of
contracts and both products are the CFTC's, so any difference is a failure.
A report in one source and not the other is a failure too, except reports
dated after the newest one the archive file holds (the API can be a release
ahead of the archive).

Run (needs www.cftc.gov):
    python scripts/check_cot_reference.py --db data/macro_radar.db --years 2025 2026
or offline, from files already downloaded:
    python scripts/check_cot_reference.py --db … --files fut_fin_txt_2026.zip fut_disagg_txt_2026.zip
Prints one line per market and exits 1 on any difference. Read-only.
"""

from __future__ import annotations

import argparse
import csv
import io
import sqlite3
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.market_data import cot  # noqa: E402

ARCHIVE = "https://www.cftc.gov/files/dea/history"
FILES = {"tff": "fut_fin_txt_{year}.zip", "disaggregated": "fut_disagg_txt_{year}.zip"}
TOLERANCE_CONTRACTS = 0

# The archive's column for each API field the store reads (the same report, the archive's spelling).
ARCHIVE_COLUMNS = {
    "tff": {
        "dealer": ("Dealer_Positions_Long_All", "Dealer_Positions_Short_All", "Dealer_Positions_Spread_All"),
        "asset_manager": ("Asset_Mgr_Positions_Long_All", "Asset_Mgr_Positions_Short_All", "Asset_Mgr_Positions_Spread_All"),
        "leveraged_funds": ("Lev_Money_Positions_Long_All", "Lev_Money_Positions_Short_All", "Lev_Money_Positions_Spread_All"),
        "other_reportables": ("Other_Rept_Positions_Long_All", "Other_Rept_Positions_Short_All", "Other_Rept_Positions_Spread_All"),
        "nonreportables": ("NonRept_Positions_Long_All", "NonRept_Positions_Short_All", None),
    },
    "disaggregated": {
        "producer_merchant": ("Prod_Merc_Positions_Long_All", "Prod_Merc_Positions_Short_All", None),
        "swap_dealers": ("Swap_Positions_Long_All", "Swap__Positions_Short_All", "Swap__Positions_Spread_All"),
        "managed_money": ("M_Money_Positions_Long_All", "M_Money_Positions_Short_All", "M_Money_Positions_Spread_All"),
        "other_reportables": ("Other_Rept_Positions_Long_All", "Other_Rept_Positions_Short_All", "Other_Rept_Positions_Spread_All"),
        "nonreportables": ("NonRept_Positions_Long_All", "NonRept_Positions_Short_All", None),
    },
}


def _int(s: str) -> int:
    """A whole number of contracts; the 2006-2016 financial archive writes them as "2754179.000000"."""
    t = s.strip()
    if "." in t:
        whole, frac = t.split(".", 1)
        if frac.strip("0"):
            raise ValueError(f"{s!r} is not a whole number of contracts")
        t = whole
    return int(t)


def _date(s: str) -> str:
    """YYYY-MM-DD; the 2006-2016 financial archive writes "1/10/2012 12:00:00 AM" in the same column."""
    from datetime import date, datetime

    t = s.strip()
    if "/" in t:
        return datetime.strptime(t, "%m/%d/%Y %I:%M:%S %p").date().isoformat()
    return date.fromisoformat(t).isoformat()


def archive_rows(report: str, data: bytes, codes: set[str]) -> dict[tuple[str, str, str], tuple]:
    """(contract, as_of, category) -> (long, short, spread, open_interest) from one archive zip."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".txt")]
        if len(names) != 1:
            raise ValueError(f"expected one .txt file in the archive, found {names}")
        text = z.read(names[0]).decode("latin-1")
    out: dict[tuple[str, str, str], tuple] = {}
    for row in csv.DictReader(io.StringIO(text)):
        code = row["CFTC_Contract_Market_Code"].strip()
        if code not in codes:
            continue
        as_of = _date(row["Report_Date_as_YYYY-MM-DD"])
        oi = _int(row["Open_Interest_All"])
        for cat, (lo, sh, sp) in ARCHIVE_COLUMNS[report].items():
            out[(code, as_of, cat)] = (_int(row[lo]), _int(row[sh]), _int(row[sp]) if sp else None, oi)
    return out


def stored_rows(conn: sqlite3.Connection, report: str, codes: set[str], years: set[str]) -> dict[tuple[str, str, str], tuple]:
    q = (f"SELECT contract_code, as_of, category, long, short, spread, open_interest FROM {cot.TABLE} "
         f"WHERE report = ? AND withdrawn_at IS NULL AND contract_code IN ({', '.join('?' * len(codes))})")
    return {(r[0], r[1], r[2]): tuple(r[3:]) for r in conn.execute(q, (report, *sorted(codes))) if r[1][:4] in years}


def compare(stored: dict, archive: dict) -> list[str]:
    """Every difference, in words; reports newer than the archive's newest are left out."""
    newest = max((k[1] for k in archive), default="")
    diffs = []
    for key in sorted(set(stored) | set(archive)):
        if key[1] > newest:
            continue
        a, s = archive.get(key), stored.get(key)
        if a is None:
            diffs.append(f"{key}: stored, not in the archive")
        elif s is None:
            diffs.append(f"{key}: in the archive, not stored")
        elif any(abs((x or 0) - (y or 0)) > TOLERANCE_CONTRACTS or ((x is None) != (y is None)) for x, y in zip(s, a)):
            diffs.append(f"{key}: stored {s}, archive {a}")
    return diffs


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": cot.USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 — a fixed https host
        return resp.read()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True)
    ap.add_argument("--years", nargs="*", default=[])
    ap.add_argument("--files", nargs="*", default=[], help="archive zips already downloaded (named as the CFTC names them)")
    a = ap.parse_args(argv)
    sources: list[tuple[str, str, bytes]] = []  # (report, year, bytes)
    for path in a.files:
        name = Path(path).name
        report = "tff" if name.startswith(("fut_fin_txt_", "fin_fut_txt_")) else "disaggregated" if name.startswith("fut_disagg_txt_") else None
        if report is None:
            ap.error(f"{name}: not a CFTC futures-only archive name")
        sources.append((report, name.split(".")[0].split("txt_", 1)[1], Path(path).read_bytes()))
    for year in a.years:
        for report, pattern in FILES.items():
            sources.append((report, year, fetch(f"{ARCHIVE}/{pattern.format(year=year)}")))
    if not sources:
        ap.error("name --years or --files")
    conn = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    failures = 0
    try:
        for report, year, data in sources:
            for m in (m for m in cot.MARKETS if m.report == report):
                arch = archive_rows(report, data, {m.contract_code})
                # the archive's own years (a historical file spans several), within which every stored report is compared
                st = stored_rows(conn, report, {m.contract_code}, {k[1][:4] for k in arch} or {year})
                diffs = compare(st, arch)
                weeks = len({k[1] for k in arch})
                verdict = "match" if not diffs and weeks else "DIFFER" if diffs else "NO ARCHIVE ROWS"
                print(f"{year} {report:13} {m.key:6} {m.contract_code}: {weeks} reports, {len(arch)} category rows, "
                      f"tolerance {TOLERANCE_CONTRACTS} contracts: {verdict}")
                for d in diffs[:10]:
                    print(f"    {d}")
                failures += bool(diffs) or not weeks
    finally:
        conn.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
