"""scripts/options_bench/phase4a/eligibility.py — each candidate's fate in one run (section 4's eligibility trace).

Records, per contract of the request's rows, the first screen or refusal that removed it, or "ranked out" (passed
the screens, never priced), or "passed". Changes nothing in the Finder: the engine-dependent stages are read from
wrappers that only record (quote_screen, no_arbitrage, sigma_range, ranges, implied_vols, value_rows), and the few
inline screens of run() between them (the window and row checks, spread, open interest, an outside-domain carry,
the budget) are re-evaluated with the Finder's own helpers. Every reason's total is then checked against the
answer's own `dropped` counts and `ranked_out`; a run whose trace disagrees is marked inconsistent, never patched.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from decimal import Decimal

from src.desk import options_finder as of


class Trace:
    def __init__(self) -> None:
        self.phase = "candidates"          # quote_screen calls before no_arbitrage are the candidate loop's
        self.screened: dict[str, str | None] = {}
        self.arb_in: list[str] = []
        self.arb_kept: list = []           # the Quotes no_arbitrage kept, in order
        self.sigma_results: list[object] = []
        self.ranged: dict[str, str | None] = {}
        self.iv: dict[str, object] = {}
        self.sent_to_iv: set[str] = set()
        self.valued: dict[str, str | None] = {}
        self.row_ctx: dict[str, dict] = {}   # contract -> {scenario: the on-date context at the row's sigma}
        self.time_ok: dict[str, bool] = {}   # contract -> the time lens's cost filter on the unrounded P&L (B-10)

    def wrappers(self) -> dict:
        tr = self

        def quote_screen(fn):
            def inner(row, session, root):
                got = fn(row, session, root)
                if tr.phase == "candidates" and isinstance(row.get("contract"), str):
                    tr.screened.setdefault(row["contract"], got[0])
                return got
            return inner

        def no_arbitrage(fn):
            def inner(quotes, *a, **k):
                kept, n = fn(quotes, *a, **k)
                tr.phase = "after"
                tr.arb_in = [q.contract for q in quotes]
                tr.arb_kept = list(kept)
                return kept, n
            return inner

        def sigma_range(fn):
            def inner(rc, c0, mid):
                got = fn(rc, c0, mid)
                tr.sigma_results.append(got if isinstance(got, str) else None)
                return got
            return inner

        def ranges(fn):
            def inner(rc, z, lo, hi):
                got = fn(rc, z, lo, hi)
                tr.ranged[z.q.contract] = got if isinstance(got, str) else None
                return got
            return inner

        def implied_vols(fn):
            def inner(rc, quotes):
                got = fn(rc, quotes)
                tr.sent_to_iv |= {q.contract for q in quotes}
                tr.iv.update(got)
                return got
            return inner

        def value_rows(fn):
            def inner(rc, sized):
                for z in sized:   # the on-date contexts value_rows builds at the row's own sigma (ranking trace)
                    if z.q.exp != rc.t.by:
                        tr.row_ctx[z.q.contract] = {name: of._context_on(rc, z.q, z.sigma, rc.t.by, float(rc.prices[name]))
                                                    for name in rc.prices}
                got = fn(rc, sized)
                for key, (reason, row) in got.items():
                    if reason is None and not of._finite(row):
                        reason = "unpriceable"
                    tr.valued[key] = reason
                    if reason is None:   # the rule of options_finder.lens_order, on the same unrounded numbers
                        tr.time_ok[key] = bool(row["_pnl"]["target"] >= Decimal(row["_cost_c"]) / 100)
                return got
            return inner

        return {"quote_screen": quote_screen, "no_arbitrage": no_arbitrage, "sigma_range": sigma_range,
                "ranges": ranges, "implied_vols": implied_vols, "value_rows": value_rows}


def fates(tr: Trace, req, answer: dict) -> dict:
    """{"fate": {contract: reason}, "consistent": bool, "diff": {...}} for one answered run."""
    t, m = req.thesis, req.market
    s0, session = float(m.spot), m.session
    win = of.window(t, s0)
    lo_k, hi_k = win["_bounds"]
    exp_to = date.fromisoformat(win["exp_to"])
    fate: dict[str, str] = {}
    for raw in req.rows:
        contract = raw.get("contract")
        k, e = of._num(raw.get("strike")), of._date(raw.get("exp_date"))
        if not isinstance(contract, str) or not contract or k is None or k <= 0 or e is None:
            fate.setdefault(f"#bad{len(fate)}", "bad_row")
            continue
        if (raw.get("type") != t.kind or not (t.by <= e <= exp_to) or not (lo_k <= of._dec(k) <= hi_k)
                or k > of.QUOTE_MAX or (e - session).days > of.MAX_EXPIRY_DAYS):
            fate[contract] = "outside_window"
        elif e > m.calendar_through:
            fate[contract] = "beyond_calendar"
        elif tr.screened.get(contract) is not None:
            fate[contract] = tr.screened[contract]
    kept = {q.contract for q in tr.arb_kept}
    for c in tr.arb_in:
        if c not in kept:
            fate[c] = "no_arbitrage"
    carries = {c["exp"]: c["source"] for c in answer["carry"]}
    limit = of._dec(t.max_spread)
    comm_c, budget_c = of.commission_cents(t.commission), of.budget_cents(t.budget)
    sized = []
    for q in tr.arb_kept:
        if not of._spread_ok(q, limit):
            fate[q.contract] = "wide_spread"
            continue
        oi = of._num(q.raw.get("open_interest"))
        if oi is None or oi < t.min_oi:
            fate[q.contract] = "low_oi"
            continue
        if carries.get(q.exp.isoformat()) == "outside domain":
            fate[q.contract] = "unpriceable"
            continue
        price_c = of.premium_cents(q.ask_d if t.fill == "ask" else q.mid_d)
        if budget_c // (price_c + comm_c) < 1:
            fate[q.contract] = "over_budget"
            continue
        sized.append(q.contract)
    diff = {}
    if len(sized) != len(tr.sigma_results):
        diff["sized"] = (len(sized), len(tr.sigma_results))
    for c, got in zip(sized, tr.sigma_results):
        if got is not None:
            fate[c] = got
        elif tr.ranged.get(c) is not None:
            fate[c] = tr.ranged[c]
        elif c not in tr.sent_to_iv:
            fate[c] = "ranked out"
        elif isinstance(tr.iv.get(c), str):
            fate[c] = tr.iv[c]
        elif tr.valued.get(c) is not None:
            fate[c] = tr.valued[c]
        else:
            fate[c] = "passed"
    counts = Counter(fate.values())
    want = {k: v for k, v in answer["universe"]["dropped"].items() if v}
    got = {k: v for k, v in counts.items() if k not in ("passed", "ranked out")}
    if got != want:
        diff["dropped"] = {"trace": got, "answer": want}
    if counts.get("ranked out", 0) != answer["universe"].get("ranked_out", 0):
        diff["ranked_out"] = (counts.get("ranked out", 0), answer["universe"].get("ranked_out", 0))
    if counts.get("passed", 0) != len(answer["rows"]):
        diff["passed"] = (counts.get("passed", 0), len(answer["rows"]))
    return {"fate": {c: r for c, r in fate.items() if not c.startswith("#")}, "consistent": not diff, "diff": diff}
