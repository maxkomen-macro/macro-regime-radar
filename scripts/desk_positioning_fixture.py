"""scripts/desk_positioning_fixture.py — the Positioning card's fixture from invented positions (Desk P4).

Writes web/src/fixtures/desk/positioning.json, the answer GET /api/desk/positioning
gives on a store holding invented weekly reports for the five markets, built
through the served code: the CFTC rows below are fed to src/market_data/cot.py's
own parser and writer (`refresh` with a fake reader), and the item's own reader
(api/desk_positioning.futures_block) turns the store into the block.

The positions are invented (a seeded random walk that satisfies the CFTC's
open-interest identity), never the CFTC's: the repo's test-data rule
(.claude/rules/test-data.md). The block's `credit`, the line the card prints under
the table, says so, and so does the file's row in web/src/fixtures/desk/PROVENANCE.md.

Run from the repo root:  python scripts/desk_positioning_fixture.py
"""

from __future__ import annotations

import json
import random
import sqlite3
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.market_data import cot  # noqa: E402

OUT = ROOT / "web" / "src" / "fixtures" / "desk" / "positioning.json"
NOTE = "Invented positions, not CFTC data: a seeded random walk run through the served parser, store and reader."
END = date(2026, 9, 22)          # a Tuesday; the CFTC's 2026 schedule releases it on 2026-09-25
WEEKS = 4 * 52 + 2
STORED_AT = datetime(2026, 9, 26, 11, 20, tzinfo=timezone.utc)
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


def build(db: Path) -> dict:
    from api import desk_positioning as dp

    cot.refresh(db, now=STORED_AT, get=fake_get, retry_wait=0)
    conn = sqlite3.connect(db)
    try:
        futures = dp.futures_block(conn)
    finally:
        conn.close()
    # The card prints the block's credit line: here it says the positions are invented (PROVENANCE.md has the row).
    futures["credit"] = NOTE
    return {
        "generation_id": "gen-fixture",
        "as_of": "2026-09-26",
        "futures": futures,
        "holdings": {"status": "awaiting", "data": None, "unavailable": {"reason": dp.HOLDINGS_NOT_STORED, "until": None}},
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        payload = build(Path(tmp) / "fixture.db")
    OUT.write_text(json.dumps(payload, indent=1, sort_keys=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(payload['futures']['markets'])} markets")


if __name__ == "__main__":
    main()
