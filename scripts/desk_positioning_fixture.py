"""scripts/desk_positioning_fixture.py — the Positioning card's fixture from invented positions (Desk P4).

Writes web/src/fixtures/desk/positioning.json, the answer GET /api/desk/positioning
?names=<the preset basket> gives on a store holding invented weekly reports for the
five markets and invented 13F filings, built through the served code: the CFTC rows
below are fed to src/market_data/cot.py's own parser and writer (`refresh` with a
fake reader), the invented 13F data sets and fails files to src/market_data/sec_13f.py's
(`refresh` with a fake client), and the item's own readers
(api/desk_positioning.futures_block, holdings_block, holdings_for) turn the store
into the blocks.

The positions and filings are invented (a seeded random walk that satisfies the
CFTC's open-interest identity; seeded 13F filers, issuers and CUSIPs), never the
CFTC's or the SEC's: the repo's test-data rule (.claude/rules/test-data.md). Each
block's `credit`, the line the card prints under its table, says so, and so does
the file's row in web/src/fixtures/desk/PROVENANCE.md.

Run from the repo root:  python scripts/desk_positioning_fixture.py
"""

from __future__ import annotations

import io
import json
import random
import sqlite3
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.desk import presets  # noqa: E402
from src.market_data import cot  # noqa: E402
from src.market_data import sec_13f as s13  # noqa: E402

OUT = ROOT / "web" / "src" / "fixtures" / "desk" / "positioning.json"
NOTE = "Invented positions, not CFTC data: a seeded random walk run through the served parser, store and reader."
SEC_NOTE = "Invented filings, not SEC data: seeded 13F filers and issuers run through the served parser, store and reader."
END = date(2026, 9, 15)          # a Tuesday; the CFTC's 2026 schedule releases it on 2026-09-18
WEEKS = 4 * 52 + 2
STORED_AT = datetime(2026, 9, 19, 11, 20, tzinfo=timezone.utc)
SEED = 20260922
# Each invented market's open interest scale (contracts), so the five read differently.
SCALE = {"13874A": 2_000_000, "043602": 5_000_000, "098662": 40_000, "088691": 400_000, "067651": 1_800_000}


def synth_rows(report: cot.Report, codes: list[str], end: date = END, weeks: int = WEEKS, seed: int = SEED) -> list[dict]:
    """Socrata-shaped rows, as the CFTC's API serves them (strings), for every week to `end`: each category's
    long, short and spreading positions invented, the open interest their identity's sum."""
    rng = random.Random(f"{seed}-{report.key}")
    out = []
    for code in codes:
        scale = SCALE[code]
        drift = {c[0]: rng.uniform(-0.2, 0.2) for c in report.categories}
        for w in range(weeks):
            as_of = end - timedelta(weeks=weeks - 1 - w)
            row = {"id": f"SYN{as_of:%y%m%d}{code}F", "market_and_exchange_names": f"INVENTED MARKET {code}",
                   "report_date_as_yyyy_mm_dd": f"{as_of.isoformat()}T00:00:00.000", "cftc_contract_market_code": code,
                   "futonly_or_combined": "FutOnly"}
            longs = shorts = spreads = 0
            share = []
            for cat, lo, sh, sp in report.categories:
                drift[cat] = max(-0.6, min(0.6, drift[cat] + rng.gauss(0, 0.03)))
                base = rng.uniform(0.04, 0.2)
                share.append((cat, lo, sh, sp, base * (1 + drift[cat]), base * (1 - drift[cat]), rng.uniform(0, 0.04) if sp else 0))
            # long side and short side must carry the same total; scale the short side to the long side's sum
            lsum = sum(s[4] for s in share)
            ssum = sum(s[5] for s in share)
            for cat, lo, sh, sp, lw, sw, pw in share:
                lv = int(scale * lw)
                sv = int(scale * sw * lsum / ssum)
                pv = int(scale * pw) if sp else 0
                row[lo], row[sh] = str(lv), str(sv)
                if sp:
                    row[sp] = str(pv)
                longs, shorts, spreads = longs + lv, shorts + sv, spreads + pv
            # rounding: put the difference on the non-reportables' short side, so long + spread = short + spread
            nl, ns = report.categories[-1][1], report.categories[-1][2]
            row[ns] = str(int(row[ns]) + longs - shorts)
            row["open_interest_all"] = str(longs + spreads)
            out.append(row)
    return out


def fake_get(url: str):
    for report in cot.REPORTS.values():
        if f"/{report.dataset}.json" in url:
            codes = [m.contract_code for m in cot.MARKETS if m.report == report.key]
            return synth_rows(report, codes)
    raise AssertionError(url)


# ── invented 13F data sets and fails files (sec_13f's own shapes) ──────────

SEC_SETS = (("structureddata", "01dec2025", "28feb2026"), ("structureddata", "01mar2026", "31may2026"),
            ("datastandardsinnovation", "01jun2026", "31aug2026"))
SEC_FILERS = 240
SEC_FILLER_ISSUERS = 60
# preset names the fixture shows refused or missing: NBIS's names disagree, CRWV's CUSIP has no 13F row
SEC_MISMATCH = "NBIS"
SEC_UNHELD = "CRWV"


def _tsv(rows: list[list]) -> bytes:
    return ("\n".join("\t".join(str(x) for x in r) for r in rows) + "\n").encode()


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, blob in files.items():
            z.writestr(name, blob)
    return buf.getvalue()


def _sec_day(d: date) -> str:
    return d.strftime("%d-%b-%Y").upper()


def synth_sec(seed: int = SEED, symbols: tuple[str, ...] | None = None) -> dict[str, bytes]:
    """Every file the SEC 13F step reads, by site path: the two index pages, three data sets and six fails files.
    Invented: filers SYN-<n>, issuers 'INVENTED <ticker> CORP', CUSIPs SYN<n> (never a real one)."""
    rng = random.Random(f"{seed}-sec")
    symbols = symbols or tuple(presets.constituents())
    issuers = [(sym, f"SYN{i:05d}0", f"INVENTED {sym} CORP") for i, sym in enumerate(symbols)]
    issuers += [(f"ZQ{i:02d}", f"SYN{900 + i:05d}0", f"INVENTED FILLER {i} INC") for i in range(SEC_FILLER_ISSUERS)]
    price = {c: round(rng.uniform(5, 900), 2) for _s, c, _n in issuers}
    held = [x for x in issuers if x[0] != SEC_UNHELD]
    periods = {date(2026, 3, 31): (date(2026, 4, 20), date(2026, 5, 15)), date(2026, 6, 30): (date(2026, 7, 20), date(2026, 8, 14))}
    sets = {name: {"sub": [list(s13.SUBMISSION_COLUMNS)], "cover": [list(s13.COVER_COLUMNS)], "info": [list(s13.INFO_COLUMNS)]}
            for name in SEC_SETS}

    def set_of(filed: date):
        for key in SEC_SETS:
            if s13._name_date(key[1]) <= filed <= s13._name_date(key[2]):
                return sets[key]
        raise AssertionError(filed)

    n_acc = [0]

    def file(cik: int, period: date, filed: date, kind: str, amend: str, report_type: str, rows: list[tuple]):
        n_acc[0] += 1
        acc = f"9999999{cik:03d}-26-{n_acc[0]:06d}"
        t = set_of(filed)
        t["sub"].append([acc, _sec_day(filed), kind, f"{cik:010d}", _sec_day(period)])
        t["cover"].append([acc, "Y" if kind.endswith("/A") else "N", amend, report_type])
        for name, cusip, value, shares, kind_sh, putcall in rows:
            t["info"].append([acc, name, cusip, value, shares, kind_sh, putcall])
        return acc

    for cik in range(1, SEC_FILERS + 1):
        size = rng.lognormvariate(0, 1.4)
        thousands = cik == 7  # one filer writes its values in thousands: its rank must not move
        book = rng.sample(held, rng.randint(8, 30))
        for period, (first, last) in periods.items():
            rows = []
            # the quarter before, some filers held fewer names: holders change on the quarter
            for _sym, cusip, name in (book[: len(book) - cik % 4] if period.month == 3 else book):
                shares = max(1, int(size * rng.uniform(1_000, 400_000)))
                value = int(shares * price[cusip] * rng.uniform(0.999, 1.001))
                rows.append((name, cusip, value // 1000 if thousands else value, shares, "SH", ""))
            if cik % 50 == 3:
                rows.append((book[0][2], book[0][1], 12345, 100, "SH", "Put"))   # an option row: not shares held
                rows.append((book[0][2], book[0][1], 50000, 50000, "PRN", ""))   # a principal amount: not shares
            filed = first + timedelta(days=rng.randint(0, (last - first).days))
            file(cik, period, filed, "13F-HR", "", "13F HOLDINGS REPORT", rows)
            if cik % 40 == 5:   # a restatement filed a week later replaces it, every position doubled
                file(cik, period, filed + timedelta(days=7), "13F-HR/A", "RESTATEMENT", "13F HOLDINGS REPORT",
                     [(n, c, v * 2, sh * 2, k, pc) for n, c, v, sh, k, pc in rows])
            if cik % 60 == 11:  # a new-holdings amendment filed later adds one position
                extra = next(x for x in held if x not in book)
                file(cik, period, min(filed + timedelta(days=25), date(2026, 8, 31)), "13F-HR/A", "NEW HOLDINGS", "13F HOLDINGS REPORT",
                     [(extra[2], extra[1], 1_000 * int(price[extra[1]]), 1_000, "SH", "")])
            if cik % 80 == 13:  # an amendment of no stated type: set aside
                file(cik, period, filed + timedelta(days=3), "13F-HR/A", "", "13F HOLDINGS REPORT", rows[:1])
    for cik in (901, 902):  # notices hold no positions
        file(cik, date(2026, 6, 30), date(2026, 8, 1), "13F-NT", "", "13F NOTICE", [])
    out: dict[str, bytes] = {}
    links = []
    for (folder, a, b), t in sets.items():
        path = f"/files/{folder}/data/form-13f-data-sets/{a}-{b}_form13f.zip"
        links.append(f'<a href="{path}">{a}</a>')
        out[path] = _zip({"SUBMISSION.tsv": _tsv(t["sub"]), "COVERPAGE.tsv": _tsv(t["cover"]), "INFOTABLE.tsv": _tsv(t["info"])})
    out[s13._path(s13.SETS_PAGE)] = ("<html>" + "".join(links) + "</html>").encode()
    ftd_links = []
    for i, half in enumerate(("202609b", "202609a", "202608b", "202608a", "202607b", "202607a")):
        day = f"2026{half[4:6]}{'20' if half.endswith('b') else '05'}"
        lines = ["SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE"]
        for sym, cusip, name in issuers:
            desc = "NOT THE SAME CO COM" if sym == SEC_MISMATCH else f"{name} COM"
            lines.append(f"{day}|{cusip}|{sym}|{rng.randint(100, 9999)}|{desc}|{price[cusip]}")
        if i == 0:
            lines.append(f"{day}|SYN777770|ZQTWO|10|INVENTED TWO CUSIPS A|1")   # one ticker, two CUSIPs on its newest day
            lines.append(f"{day}|SYN777780|ZQTWO|10|INVENTED TWO CUSIPS B|1")
        lines.append(f"{day}|SYN99999X||10|INVENTED NOTE DUE 2030|1.00")   # a security with no ticker: not paired
        lines += [f"Trailer record count {len(lines) - 1}", "Trailer total quantity of shares 0"]
        path = f"/files/data/fails-deliver-data/cnsfails{half}.zip"
        ftd_links.append(f'<a href="{path}">{half}</a>')
        out[path] = _zip({f"cnsfails{half}.txt": ("\n".join(lines) + "\n").encode("latin-1")})
    out[s13._path(s13.FTD_PAGE)] = ("<html>" + "".join(ftd_links) + "</html>").encode()
    return out


class FakeSec:
    """sec_13f.Client's interface over `synth_sec`'s files; counts requests like the real one."""

    def __init__(self, files: dict[str, bytes], fail: set[str] | None = None):
        self.files, self.fail, self.requests, self.paths = files, fail or set(), 0, []

    def get(self, path: str, dest: Path | None = None):
        self.requests += 1
        self.paths.append(path)
        if path in self.fail:
            raise s13.FetchFailed(f"{path}: refused by the SEC (HTTP 403); not retried")
        body = self.files[path]
        if dest is None:
            return body
        Path(dest).write_bytes(body)
        return Path(dest)


def build(db: Path) -> dict:
    from api import desk_positioning as dp

    cot.refresh(db, now=STORED_AT, get=fake_get, retry_wait=0)
    s13.refresh(db, now=STORED_AT, client=FakeSec(synth_sec()))
    conn = sqlite3.connect(db)
    try:
        futures = dp.futures_block(conn)
        holdings = dp.holdings_for(dp.holdings_block(conn), list(presets.constituents()))
    finally:
        conn.close()
    # The card prints each block's credit line: here it says the data are invented (PROVENANCE.md has the row).
    futures["credit"] = NOTE
    holdings["credit"] = SEC_NOTE
    return {
        # the fixture world's envelope (web/src/fixtures/desk/index.ts FIXTURE_META): the reports are older than it
        "generation_id": "gen-fixture-2026-09-24",
        "as_of": "2026-09-24",
        "futures": futures,
        "holdings": holdings,
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        payload = build(Path(tmp) / "fixture.db")
    OUT.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(payload['futures']['markets'])} markets, "
          f"{len(payload['holdings']['names'])} 13F names, {len(payload['holdings']['excluded'])} excluded")


if __name__ == "__main__":
    main()
