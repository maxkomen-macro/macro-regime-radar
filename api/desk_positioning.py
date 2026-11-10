"""api/desk_positioning.py — Basket & Hedge's Positioning card from public filings (Desk P4, D7).

The worker item `desk_positioning` reads the two stored disclosure tables of
the generation's file and stores two blocks:

- `futures`: the CFTC's weekly Commitments of Traders for five macro futures
  (`cot_positions`, src/market_data/cot.py): each market's speculative
  category (leveraged funds in the financial report, managed money in the
  disaggregated one), net long contracts and their share of open interest,
  the change from the report a week before, where the share sits among the
  market's weekly reports of the last three years, and every category's
  numbers, each report dated by its positions date and its release.
- `holdings`: SEC Form 13F holder concentration for basket names
  (`holdings_13f`, src/market_data/sec_13f.py), dated by the quarter the
  holdings are as of and the filings read.

Both are lagged disclosures, never live positioning: the card says so, and
every figure carries its own dates. Method: docs/desk/POSITIONING_SPEC.md.

A stored report is read only when the run that wrote it committed, the CFTC
still serves it (not withdrawn), it has every category of its report, its
numbers satisfy the CFTC's open-interest identity and its positions date is
no later than the day the store first held it; any other report is set aside,
counted in `excluded` with why, and never enters a figure. Nothing here
depends on "now", so the route serves the item as stored. Stdlib only.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, timedelta
from typing import Any

from api import desk_envelope as env

log = logging.getLogger("mrr.desk")

PROVIDER = "CFTC"
SOURCE = "CFTC Commitments of Traders, futures only, read from the CFTC Public Reporting Environment"
CREDIT = "Source: U.S. Commodity Futures Trading Commission, Commitments of Traders."
LAG_NOTE = ("Lagged disclosure, not live positioning: each report states positions as of a Tuesday and is released "
            "the following Friday, later in a holiday week.")
NOT_STORED = "Awaiting refresh: CFTC positions are not stored in this database yet."
NONE_READABLE = "Awaiting refresh: no stored CFTC report can be read (each one is set aside, with why)."
HOLDINGS_NOT_STORED = "Awaiting refresh: SEC 13F holdings are not stored in this database yet."

# The window for "where it sits": three calendar years of weekly reports ending at the report, at least this many.
RANGE_YEARS = 3
RANGE_MIN_REPORTS = 150
# The report a week earlier: the CFTC's previous weekly report is 6 to 8 days before (holiday weeks shift it).
WEEK_DAYS = (6, 8)
SERIES_YEARS = 3

CATEGORY_LABELS = {
    "dealer": "Dealers",
    "asset_manager": "Asset managers",
    "leveraged_funds": "Leveraged funds",
    "other_reportables": "Other reportables",
    "nonreportables": "Non-reportable (small traders)",
    "producer_merchant": "Producers and merchants",
    "swap_dealers": "Swap dealers",
    "managed_money": "Managed money",
}
REPORT_TITLES = {"tff": "Traders in Financial Futures", "disaggregated": "Disaggregated"}


def _markets():
    from src.market_data import cot

    return cot.MARKETS, cot.REPORTS


def _years_before(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 February
        return d.replace(year=d.year - years, day=28)


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def read_reports(conn: sqlite3.Connection, report: str, code: str, categories: tuple[str, ...]) -> tuple[list[dict], list[dict]]:
    """A market's stored reports, oldest first, each `{as_of, open_interest, categories: {cat: (long, short, spread)},
    market_name, first_stored_at, stored_at, run_id}`, and the reports set aside, each with why."""
    from src.market_data import cot

    rows = conn.execute(
        f"SELECT p.as_of, p.category, p.long, p.short, p.spread, p.open_interest, p.market_name, p.first_stored_at, "
        f"p.stored_at, p.run_id, p.withdrawn_at, r.status FROM {cot.TABLE} p LEFT JOIN {cot.RUNS} r ON r.run_id = p.run_id "
        f"WHERE p.report = ? AND p.contract_code = ? ORDER BY p.as_of, p.category", (report, code)).fetchall()
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(r[0], []).append(r)
    good, bad = [], []
    for as_of, rs in by.items():
        why = _report_problem(as_of, rs, categories)
        if why:
            bad.append({"as_of": str(as_of), "reason": why})
            continue
        good.append({
            "as_of": as_of,
            "open_interest": int(rs[0][5]),
            "categories": {r[1]: (int(r[2]), int(r[3]), None if r[4] is None else int(r[4])) for r in rs},
            "market_name": rs[0][6],
            "first_stored_at": min(r[7] for r in rs),
            "stored_at": max(r[8] for r in rs),
        })
    return good, bad


def _report_problem(as_of: Any, rs: list, categories: tuple[str, ...]) -> str | None:
    try:
        if not isinstance(as_of, str) or date.fromisoformat(as_of).isoformat() != as_of:
            raise ValueError
    except ValueError:
        return f"its positions date {as_of!r} is not a YYYY-MM-DD date"
    if any(r[11] != "committed" for r in rs):
        return "a run that never committed wrote it"
    if any(r[10] is not None for r in rs):
        return "the CFTC no longer serves it (withdrawn)"
    cats = sorted(r[1] for r in rs)
    if cats != sorted(categories):
        return "it does not hold every trader category of its report"
    if len({r[5] for r in rs}) != 1:
        return "its categories disagree on the open interest"
    nums = [(r[2], r[3], r[4], r[5]) for r in rs]
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for n in nums for v in n if v is not None):
        return "a stored number is not a whole number of contracts"
    oi = rs[0][5]
    spreads = sum(r[4] or 0 for r in rs)
    if sum(r[2] for r in rs) + spreads != oi or sum(r[3] for r in rs) + spreads != oi:
        return "its long or short positions plus spreading are not its open interest"
    first = min(str(r[7]) for r in rs)
    if as_of > first[:10]:
        return f"it is dated after the store first held it ({first[:10]})"
    return None


def _net(cat: tuple[int, int, int | None]) -> int:
    return cat[0] - cat[1]


def _pct(n: int, oi: int) -> float | None:
    return 100.0 * n / oi if oi > 0 else None


def release_of(as_of: str, first_stored_at: str) -> dict:
    """The report's release from the CFTC's published schedule, refused when the store held the report before it."""
    from src.market_data import cot_schedule as sched

    hit = sched.release_for(date.fromisoformat(as_of))
    if hit is None:
        return {"released": None, "release_delayed": None, "release_basis": None,
                "release_note": "release date not on the CFTC schedule this store holds"}
    released, delayed = hit
    if first_stored_at[:10] < released.isoformat():
        return {"released": None, "release_delayed": None, "release_basis": None,
                "release_note": f"the store held it on {first_stored_at[:10]}, before the scheduled {released.isoformat()}"}
    return {"released": released.isoformat(), "release_delayed": delayed, "release_basis": "cftc_schedule",
            "release_note": f"CFTC schedule, {sched.RELEASE_TIME_ET} ET" + (", delayed by a federal holiday" if delayed else "")}


def market_block(market, report_def, reports: list[dict], excluded: list[dict]) -> dict:
    """One market's figures from its readable reports (oldest first)."""
    cats = [c[0] for c in report_def.categories]
    last = reports[-1]
    oi = last["open_interest"]
    prim = last["categories"][market.primary]
    net = _net(prim)
    as_of = date.fromisoformat(last["as_of"])

    change, change_reason = None, None
    if len(reports) >= 2:
        prev = reports[-2]
        gap = (as_of - date.fromisoformat(prev["as_of"])).days
        if WEEK_DAYS[0] <= gap <= WEEK_DAYS[1]:
            pnet = _net(prev["categories"][market.primary])
            ppct, cpct = _pct(pnet, prev["open_interest"]), _pct(net, oi)
            change = {"from": prev["as_of"], "net": net - pnet,
                      "net_pct_oi": None if ppct is None or cpct is None else cpct - ppct}
        else:
            change_reason = f"the report before is dated {prev['as_of']}, not the week before"
    else:
        change_reason = "no earlier report is stored"

    start = _years_before(as_of, RANGE_YEARS)
    window = [r for r in reports if start < date.fromisoformat(r["as_of"]) <= as_of and r["open_interest"] > 0]
    rng, rng_reason = None, None
    cur = _pct(net, oi)
    if cur is None:
        rng_reason = "open interest is zero"
    elif len(window) < RANGE_MIN_REPORTS:
        rng_reason = (f"needs {RANGE_MIN_REPORTS} weekly reports in the three years to {last['as_of']}; "
                      f"{len(window)} are stored")
    else:
        vals = [(_pct(_net(r["categories"][market.primary]), r["open_interest"]), r["as_of"]) for r in window]
        lo = min(vals, key=lambda v: (v[0], v[1]))
        hi = max(vals, key=lambda v: (v[0], v[1]))
        rng = {"percentile": 100.0 * sum(1 for v, _ in vals if v <= cur) / len(vals), "n": len(vals),
               "from": window[0]["as_of"], "to": last["as_of"],
               "min_pct_oi": lo[0], "min_on": lo[1], "max_pct_oi": hi[0], "max_on": hi[1]}

    s_start = _years_before(as_of, SERIES_YEARS)
    series = [{"as_of": r["as_of"], "net": _net(r["categories"][market.primary]),
               "net_pct_oi": _pct(_net(r["categories"][market.primary]), r["open_interest"])}
              for r in reports if date.fromisoformat(r["as_of"]) > s_start]
    return {
        "key": market.key,
        "label": market.label,
        "contract_code": market.contract_code,
        "market_name": last["market_name"],
        "report": market.report,
        "report_title": REPORT_TITLES[market.report],
        "category": market.primary,
        "category_label": CATEGORY_LABELS[market.primary],
        "as_of": last["as_of"],
        **release_of(last["as_of"], last["first_stored_at"]),
        "first_stored_at": last["first_stored_at"],
        "stored_at": last["stored_at"],
        "long": prim[0],
        "short": prim[1],
        "spread": prim[2],
        "net": net,
        "open_interest": oi,
        "net_pct_oi": cur,
        "change_1w": change,
        "change_reason": change_reason,
        "range_3y": rng,
        "range_reason": rng_reason,
        "categories": [{"category": c, "label": CATEGORY_LABELS[c], "long": last["categories"][c][0],
                        "short": last["categories"][c][1], "spread": last["categories"][c][2],
                        "net": _net(last["categories"][c]), "net_pct_oi": _pct(_net(last["categories"][c]), oi)} for c in cats],
        "history_from": reports[0]["as_of"],
        "reports": len(reports),
        "excluded": excluded,
        "series": series,
    }


def futures_block(conn: sqlite3.Connection) -> dict:
    from src.market_data import cot

    markets, reports_def = _markets()
    if not _table_exists(conn, cot.TABLE) or not _table_exists(conn, cot.RUNS):
        raise env.Awaiting(NOT_STORED)
    out, missing = [], []
    for m in markets:
        rdef = reports_def[m.report]
        good, bad = read_reports(conn, m.report, m.contract_code, tuple(c[0] for c in rdef.categories))
        if not good:
            missing.append({"key": m.key, "label": m.label, "excluded": bad,
                            "reason": "no readable report is stored" if bad else "no report is stored"})
            continue
        out.append(market_block(m, rdef, good, bad))
    if not out:
        raise env.Awaiting(NONE_READABLE if any(x["excluded"] for x in missing) else NOT_STORED)
    revisions = conn.execute(f"SELECT COUNT(*) FROM {cot.REVISIONS}").fetchone()[0] if _table_exists(conn, cot.REVISIONS) else 0
    return {"provider": PROVIDER, "source": SOURCE, "credit": CREDIT, "lag_note": LAG_NOTE,
            "range_years": RANGE_YEARS, "range_min_reports": RANGE_MIN_REPORTS,
            "markets": out, "missing": missing, "revisions_stored": int(revisions)}


def holdings_block(conn: sqlite3.Connection) -> dict:
    raise env.Awaiting(HOLDINGS_NOT_STORED)


def desk_positioning(ctx: dict) -> dict:
    """The worker item: each block stored as a part, so one awaits while the other serves."""
    from api import db
    from api.desk_items_macro import part
    from src.analytics import dbpath

    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        return {"futures": part("positioning futures", lambda: futures_block(conn)),
                "holdings": part("positioning holdings", lambda: holdings_block(conn))}
    finally:
        conn.close()
