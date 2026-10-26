"""The Options Finder's engine (src/desk/options_finder.py, method finder-2; docs/desk/OPTIONS_FINDER_MODEL.md).

Every chain here is synthetic (tests/options_synth.py): invented smiles, carry and quotes, priced by the
engine's own lattice and quoted to the cent. No provider data is in the repository. The engine must give
back what the chain was built from, and every rule of the model document is checked on a case built for it.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src.desk import options_finder as of
from src.desk import options_math as om
from tests import options_synth as syn

BY = date(2026, 12, 18)


def _thesis(view: str = "up", target: float = 120.0, by: date = BY, budget: float = 5000.0, **kw) -> of.Thesis:
    return of.Thesis(view, target, by, budget, **kw)


def _one(strike: float, exp: date, kind: str = "call", bid: float = 2.0, ask: float = 2.1, **kw) -> dict:
    return syn.row(syn.symbol("SYN", exp, kind, strike), kind, strike, exp, bid, ask, **kw)


@pytest.fixture(scope="module")
def up() -> dict:
    return syn.scan("up", 120.0, BY)


@pytest.fixture(scope="module")
def down() -> dict:
    return syn.scan("down", 85.0, BY)


# ── what the chain was built from comes back ─────────────────────────────────

@pytest.fixture(scope="module")
def exact() -> tuple[dict, list[dict], dict]:
    """Unrounded quotes: each mid is the lattice value at the contract's smile volatility."""
    exps = [BY, date(2027, 1, 15), date(2027, 3, 19), date(2027, 6, 18)]
    rows, truth = syn.build(syn.S0, syn.Q_TRUE, syn.DIV_ROWS, exps, [80.0 + 2.5 * i for i in range(25)], "SYN",
                            cents=False)
    a = of.run([r for r in rows if r["type"] == "call"], _thesis(), syn.market(),
               other_rows=[r for r in rows if r["type"] == "put"], dividends={"status": "ok", "rows": syn.DIV_ROWS},
               work_limit=10**12)
    return a, rows, truth


def test_the_forward_of_every_expiry_is_the_one_the_chain_was_built_on(exact, up):
    a, _, truth = exact
    assert len(a["carry"]) == 4
    for c in a["carry"]:
        assert c["source"] == "market" and c["pairs"] == of.PAIRS_PER_EXPIRY
        assert abs(c["forward"] - truth[date.fromisoformat(c["exp"])]) <= 1e-9 * syn.S0
        assert abs(c["q"] - syn.Q_TRUE) <= 1e-9
        assert c["words"] == of.CARRY_WORDS["market"]
    # quoted to the cent, each leg's mid is off by up to half a cent, so the forward by up to ~a cent / df
    _, truth_c = syn.chain()
    for c in up["carry"]:
        assert c["source"] == "market"
        assert abs(c["forward"] - truth_c[date.fromisoformat(c["exp"])]) <= 0.011


def test_each_contract_s_volatility_is_solved_from_its_own_mid(exact):
    a, rows, _ = exact
    sig = {r["contract"]: r["_sigma"] for r in rows}
    assert len(a["rows"]) >= 20
    for r in a["rows"]:
        assert abs(r["iv"] - sig[r["contract"]]) <= 1e-6, r["contract"]
        assert r["model_inputs"]["sigma"] == r["iv"]


def test_the_answer_names_its_method_and_tolerances(up):
    m = up["method"]
    assert m["version"] == "finder-2"
    assert m["tolerances"]["delta_tree"] == om.DELTA_TOL
    assert m["tolerances"]["delta_zone"] == "5 x tol"
    assert up["work"]["used"] <= up["work"]["limit"]


# ── inputs and validation ────────────────────────────────────────────────────

@pytest.mark.parametrize("thesis, words", [
    (dict(view="sideways"), "is not up or down"),
    (dict(target=90.0), "A view up needs a target above"),
    (dict(target=1001.0), "more than 10 times"),
    (dict(view="down", target=120.0), "A view down needs a target below"),
    (dict(by=syn.SESSION), "must be after 2026-10-23"),
    (dict(by=date(2028, 1, 3)), "known through Dec 31, 2027"),
    (dict(budget=0.5), "budget is not between"),
    (dict(commission=-1.0), "commission is not between"),
    (dict(commission=101.0), "commission is not between"),
    (dict(min_oi=-1), "minimum open interest"),
    (dict(max_spread=0.0), "widest spread"),
    (dict(scan_months=13), "scan window"),
    (dict(fill="last"), "is not ask or mid"),
])
def test_a_bad_parameter_is_refused_naming_it(thesis, words):
    with pytest.raises(of.FinderError) as err:
        of.validate(_thesis(**thesis), syn.market())
    assert words in str(err.value) and err.value.kind == "input"


def test_a_chain_two_sessions_behind_is_refused_as_stale_and_one_behind_is_warned():
    with pytest.raises(of.FinderError) as err:
        of.validate(_thesis(), syn.market(sessions_behind=2))
    assert err.value.kind == "stale"
    a = of.run([], _thesis(), syn.market(sessions_behind=1), dividends={"status": "ok", "rows": []})
    assert a["stale"] and "Oct 23, 2026 close" in a["stale"]
    b = of.run([], _thesis(), syn.market(), dividends={"status": "ok", "rows": []})
    assert b["stale"] is None


def test_a_bad_session_close_is_a_market_refusal():
    with pytest.raises(of.FinderError) as err:
        of.validate(_thesis(), syn.market(spot=float("nan")))
    assert err.value.kind == "market"


def test_input_caps_refuse_before_any_work():
    rows = [_one(100.0, BY)] * (of.CAPS["rows"] + 1)
    with pytest.raises(of.FinderError):
        of.run(rows, _thesis(), syn.market())


def test_the_curve_converts_each_quoted_basis_to_continuous():
    curve, points, notes = of.build_curve(syn.CURVE_ROWS, syn.SESSION)
    assert [p["series"] for p in points] == ["DGS3MO", "DGS2", "DGS5"]
    assert points[0]["zero_rate"] == pytest.approx(om.zero_rate_3m(4.10), abs=1e-15)
    assert points[1]["zero_rate"] == pytest.approx(om.zero_rate_par(3.70), abs=1e-15)
    assert not notes
    with pytest.raises(of.FinderError) as err:
        of.build_curve({"DGS3MO": [("2026-10-23", 4.1)], "DGS2": [("2026-10-23", 3.7)]}, syn.SESSION)
    assert err.value.kind == "market"
    _, _, old = of.build_curve({k: [("2026-10-01", v[0][1])] for k, v in syn.CURVE_ROWS.items()}, syn.SESSION)
    assert len(old) == 3 and "Oct 1, 2026" in old[0]


# ── screens (section 5) ──────────────────────────────────────────────────────

def test_every_screen_counts_what_it_dropped():
    exp = BY
    rows = [
        {"contract": "", "type": "call", "strike": 100.0, "exp_date": exp.isoformat()},          # bad_row
        _one(100.0, date(2027, 9, 17)),                                                          # outside_window
        dict(_one(105.0, exp), contract="SYN1X261218C00105000"),                                 # nonstandard
        _one(110.0, exp, bid=0.0, ask=0.5),                                                      # no_bid
        _one(112.5, exp, bid=1.0, ask=0.9),                                                      # bad_ask
        _one(115.0, exp, session=date(2026, 10, 22)),                                            # stale_quote
        _one(117.5, exp, bid=1.0, ask=2.0),                                                      # wide_spread
        _one(120.0, exp, bid=1.0, ask=1.05, oi=10),                                              # low_oi
    ]
    a = of.run(rows, _thesis(), syn.market(), dividends={"status": "ok", "rows": []})
    d = a["universe"]["dropped"]
    assert a["universe"]["seen"] == len(rows)
    for screen in ("bad_row", "outside_window", "nonstandard", "no_bid", "bad_ask", "stale_quote", "wide_spread", "low_oi"):
        assert d[screen] == 1, screen
    assert a["universe"]["passed"] + sum(d.values()) == a["universe"]["seen"]
    assert a["empty"].startswith("None of the 8 calls passed the screens")


def test_the_strike_window_and_the_standard_symbol_rule():
    w = of.window(_thesis(), 100.0)
    assert (w["strike_from"], w["strike_to"], w["exp_from"], w["exp_to"]) == (80.0, 156.0, "2026-12-18", "2027-06-18")
    wd = of.window(_thesis("down", 85.0), 100.0)
    assert (wd["strike_from"], wd["strike_to"]) == (59.5, 120.0)
    assert of.standard_symbol("SYN261218C00105500", "SYN", BY, "call", 105.5)
    assert not of.standard_symbol("SYN261218C00105500", "SYN", BY, "put", 105.5)
    assert not of.standard_symbol("SYN261218C00105500", "SYN", BY, "call", 105.0005)


def test_no_arbitrage_drops_a_bid_above_a_dominating_ask_and_the_rows_that_attain_it():
    curve, _, _ = of.build_curve(syn.CURVE_ROWS, syn.SESSION)
    # the 100 call bids $8.00 while the 95 call (worth more, always) asks $7.10
    # (the 105's wide ask keeps the three asks convex, so dominance alone is broken)
    rows = [_one(95.0, BY, bid=7.0, ask=7.1), _one(100.0, BY, bid=8.0, ask=8.1), _one(105.0, BY, bid=2.0, ask=8.9)]
    kept, dropped = of.no_arbitrage([of.quote_screen(r, syn.SESSION, "SYN")[1] for r in rows], 100.0, curve, syn.SESSION)
    assert dropped == 2 and [q.strike for q in kept] == [105.0]
    clean = [_one(95.0, BY, bid=8.0, ask=8.1), _one(100.0, BY, bid=5.0, ask=5.1), _one(105.0, BY, bid=2.9, ask=3.0)]
    kept2, dropped2 = of.no_arbitrage([of.quote_screen(r, syn.SESSION, "SYN")[1] for r in clean], 100.0, curve, syn.SESSION)
    assert dropped2 == 0 and len(kept2) == 3
    # a later expiry's ask below an earlier expiry's bid at the same strike (calendar)
    cal = [_one(100.0, BY, bid=5.0, ask=5.1), _one(100.0, date(2027, 1, 15), bid=4.0, ask=4.5)]
    kept3, dropped3 = of.no_arbitrage([of.quote_screen(r, syn.SESSION, "SYN")[1] for r in cal], 100.0, curve, syn.SESSION)
    assert dropped3 == 2 and not kept3


def test_the_arbitrage_envelope_agrees_with_brute_force_on_random_chains():
    import random
    rng = random.Random(7)
    h = Decimal("0.99")
    flagged = 0
    for _ in range(400):
        n = rng.randint(2, 7)
        ks = sorted(Decimal(k) for k in rng.sample(range(80, 121), n))
        rows = []
        for k in ks:
            bid = Decimal(rng.randint(1, 2500)) / 100
            rows.append((k, bid, bid + Decimal(rng.randint(0, 80)) / 100))
        is_call = rng.random() < 0.5
        got = of.envelope_violations(rows, is_call, h)
        brute = set()
        for j, (kj, bj, aj) in enumerate(rows):
            best = aj
            for i, (ki, _, ai) in enumerate(rows):
                if i == j:
                    continue
                dominates = ki < kj if is_call else ki > kj
                best = min(best, ai if dominates else ai + h * abs(ki - kj))
                for m, (km, _, am) in enumerate(rows):
                    if ki < kj < km:   # every convex combination of two asks around kj
                        best = min(best, ai + (am - ai) * (kj - ki) / (km - ki))
            if bj > best:
                brute.add(j)
        assert set(got) == brute
        flagged += bool(brute)
    assert 50 < flagged < 400   # the random chains include both kinds
# ── carry and its fallbacks (section 3) ──────────────────────────────────────

def test_without_pairs_the_carry_falls_back_to_dividends_then_none():
    rows = [_one(110.0, BY, bid=1.50, ask=1.55)]
    a = of.run(rows, _thesis(), syn.market(), dividends={"status": "ok", "rows": syn.DIV_ROWS})
    assert a["carry"][0]["source"] == "dividends only"
    b = of.run(rows, _thesis(), syn.market(), dividends={"status": "unavailable"})
    assert b["carry"][0]["source"] == "none"
    assert "Dividend data unavailable: no dividends are in the carry." in b["method"]["notes"]
    assert "Dividend data unavailable." in b["coverage"]


def test_projected_dividends_are_labelled_and_declared_ones_are_not(up):
    labels = {d["label"] for d in up["dividends"]}
    assert labels == {"projected, not declared"}
    declared = syn.DIV_ROWS + [{"ex_date": "2026-12-11", "cum_session": "2026-12-10", "amount": 0.52,
                                "period": "Quarterly", "declared_on": "2026-10-20"}]
    divs, ignored = of.normalize_dividends(declared, syn.S0)
    sched, _ = of.schedule(divs, syn.SESSION, date(2027, 6, 18), of.Sessions(syn.CLOSES, syn.CAL_THROUGH))
    assert not ignored
    first = sched[0]
    assert first.ex_date == date(2026, 12, 11) and not first.projected
    assert all(d.projected for d in sched[1:])


def test_a_constant_residual_yield_beyond_the_domain_prices_nothing_and_says_why():
    strikes = [80.0 + 5 * i for i in range(9)]
    exps = [BY, date(2027, 1, 15), date(2027, 2, 19)]
    for q, priced in ((0.30, False), (0.05, True)):
        rows, _ = syn.build(syn.S0, q, syn.DIV_ROWS, exps, strikes, "SYN", spread=0.015)
        t = _thesis(target=115.0, scan_months=2)
        a = of.run([r for r in rows if r["type"] == "call"], t, syn.market(),
                   other_rows=[r for r in rows if r["type"] == "put"],
                   dividends={"status": "ok", "rows": syn.DIV_ROWS}, work_limit=10**12)
        if priced:
            assert a["rows"] and all(c["source"] == "market" and abs(c["q"] - 0.05) < 2e-3 for c in a["carry"])
        else:
            assert a["carry"] and all(c["source"] == "outside domain" and c["q"] is None and c["forward"] is None
                                      for c in a["carry"])
            assert not a["rows"] and a["universe"]["dropped"]["unpriceable"] > 0
            assert any("beyond ±10% a year" in n for n in a["method"]["notes"])


def test_a_special_dividend_above_three_percent_is_kept_noted_and_its_contracts_not_priced():
    special = {"ex_date": "2026-11-13", "cum_session": "2026-11-12", "amount": 10.0, "period": None,
               "declared_on": "2026-10-20"}
    divs, ignored = of.normalize_dividends(syn.DIV_ROWS + [special], syn.S0)
    assert any(d.amount == 10.0 for d in divs) and ignored == 0
    a = syn.scan("up", 120.0, BY, months=3, divs=syn.DIV_ROWS + [special])
    assert any("more than 3% of the price" in n for n in a["method"]["notes"])
    assert all(r["exp"] < "2026-11-13" for r in a["rows"]) and a["universe"]["dropped"]["unpriceable"] > 0


def test_two_payments_close_together_count_as_one_cluster():
    two = [{"ex_date": "2026-11-13", "cum_session": "2026-11-12", "amount": 1.6, "period": None, "declared_on": "2026-10-20"},
           {"ex_date": "2026-11-17", "cum_session": "2026-11-16", "amount": 1.6, "period": None, "declared_on": "2026-10-20"}]
    a = syn.scan("up", 120.0, BY, months=3, divs=syn.DIV_ROWS + two)
    assert any(n.startswith("Dividends totalling $3.20 going ex from Nov 13, 2026 to Nov 17, 2026") for n in a["method"]["notes"])


# ── sizing, exit rule, values (section 7) ────────────────────────────────────

def test_sizing_is_exact_in_cents_with_the_commission(up):
    for r in up["rows"]:
        price_c = of.premium_cents(Decimal(repr(r["ask"])))
        assert r["n"] == 500_000 // (price_c + 65)
        assert r["cost"] == pytest.approx(r["n"] * (price_c + 65) / 100.0, abs=1e-9)
        assert r["unused"] == pytest.approx(5000.0 - r["cost"], abs=1e-9)
        assert r["max_loss"] == r["cost"] and r["commission"] == 0.65


def test_the_exit_rule_never_sells_below_nothing():
    assert of._pnl(Decimal("0.001"), 3, 65, 1000) == Decimal("-10")
    assert of._pnl(Decimal("1"), 2, 65, 1000) == Decimal("2") * (Decimal(100) - Decimal("0.65")) - Decimal("10")


def test_a_contract_expiring_on_the_date_is_worth_its_intrinsic_value_exactly(up):
    on_date = [r for r in up["rows"] if r["exp"] == BY.isoformat()]
    assert on_date
    for r in on_date:
        assert not r["modelled"] and r["model"]["on_date"] == of.MODEL_INTRINSIC
        n, k = r["n"], Decimal(repr(r["strike"]))
        exit_ = max(100 * max(Decimal(120) - k, Decimal(0)) - Decimal("0.65"), Decimal(0))
        assert Decimal(repr(r["pnl"]["target"])) == pytest.approx(n * exit_ - Decimal(repr(r["cost"])), abs=Decimal("1e-9"))
        assert r["breakeven_on_date"] == r["breakeven_expiry"]
        assert r["iv_minus_10"] is None and r["flags"] == []


def test_later_expiries_are_modelled_with_both_volatility_shifts(up):
    later = [r for r in up["rows"] if r["exp"] > BY.isoformat()]
    assert later
    for r in later:
        assert r["modelled"]
        assert r["iv_minus_10"]["target"] <= r["pnl"]["target"] <= r["iv_plus_10"]["target"] + 1e-9


def test_breakevens_reprice_to_the_entry_cost(up):
    sched = [of.Dividend(date.fromisoformat(d["ex_date"]), date.fromisoformat(d["cum_session"]), d["amount"],
                         d["period"], d["label"] != "declared") for d in up["dividends"]]
    checked = 0
    for r in up["rows"]:
        fill, comm = Decimal(repr(r["fill"])), Decimal(65)
        target = fill + 2 * comm / 10_000
        k = Decimal(repr(r["strike"]))
        assert Decimal(repr(r["breakeven_expiry"])) == pytest.approx(k + target, abs=Decimal("1e-12"))
        be = r["breakeven_on_date"]
        if not r["modelled"] or be is None or checked >= 12:
            continue
        exp = date.fromisoformat(r["exp"])
        mi = r["model_inputs"]
        c = om.Context(True, be, r["strike"], (exp - BY).days, mi["rate_on_date"], mi["q"], r["iv"], of.owed(sched, BY, exp))
        v = of.Pricer(of.Work(10**12)).one(c).value
        assert abs(v - float(target)) <= om.tolerance(float(target), be), r["contract"]
        checked += 1
    assert checked >= 5


def test_put_rows_and_parity_of_closed_forms(down):
    assert down["rows"] and all(r["type"] == "put" for r in down["rows"])
    c = om.Context(True, 100.0, 100.0, 90, 0.04, 0.0, 0.25)
    p = om.Context(False, 100.0, 100.0, 90, 0.04, 0.0, 0.25)
    assert om.european(c) - om.european(p) == pytest.approx(100.0 - 100.0 * math.exp(-0.04 * 90 / 365), abs=1e-12)


# ── the pricer's routes, deltas and their notes (sections 4, DR-50, DR-51) ────

def test_a_value_the_bound_lets_stand_serves_the_lattice_delta():
    c = om.Context(False, 100.0, 100.70, 1, 0.007, 0.0, 0.05)
    p = of.Pricer(of.Work(10**12))
    v = p.many([c])[0]
    assert v.bound is not None and v.bound <= om.tolerance(v.value, 100.0) / 5
    assert v.delta == pytest.approx(-0.99606, abs=1e-4)   # the European delta, which the row must not serve
    assert p.deltas([c])[c] == (-1.0, None)


def test_every_bound_path_row_serves_american_s_delta(up, down):
    for a, view in ((up, "up"), (down, "down")):
        bound_rows = [r for r in a["rows"] if r["model"]["session"] == of.MODEL_EUROPEAN
                      and isinstance(r["early_exercise"]["premium"], str)]
        exempt_rows = [r for r in a["rows"] if r["model"]["session"] == of.MODEL_EUROPEAN
                       and not isinstance(r["early_exercise"]["premium"], str)]
        for r in exempt_rows:
            assert r["delta"] is not None and r["delta_note"] is None
        for r in bound_rows:
            mi = r["model_inputs"]
            exp = date.fromisoformat(r["exp"])
            sched = [d for d in a["dividends"]]
            divs = of.owed([of.Dividend(date.fromisoformat(d["ex_date"]), date.fromisoformat(d["cum_session"]),
                                        d["amount"], d["period"], d["label"] != "declared") for d in sched],
                           syn.SESSION, exp)
            c = om.Context(r["type"] == "call", syn.S0, r["strike"], (exp - syn.SESSION).days, mi["rate_session"],
                           mi["q"], r["iv"], divs)
            d = of.Pricer(of.Work(10**12)).deltas([c])[c]
            assert (r["delta"], r["delta_note"]) == d, r["contract"]


def test_near_the_exercise_boundary_the_value_is_served_and_the_delta_is_withheld():
    p = of.Pricer(of.Work(10**12))
    c = om.Context(False, 100.0, 113.0, 60, 0.05, 0.0, 0.2)
    v = p.one(c)
    assert v.model == of.MODEL_AMERICAN and v.delta is None and v.delta_note == of.DELTA_NOTE_ZONE
    assert abs(v.value - 13.0) <= om.tolerance(13.0, 100.0)


def test_an_exempt_context_is_its_european_value_exactly():
    c = om.Context(True, 100.0, 105.0, 60, 0.04, 0.0, 0.3)
    assert om.exempt(c)
    v = of.Pricer(of.Work(10**12)).one(c)
    assert v.value == om.european(c) and v.delta == om.european_delta(c)


def test_out_of_domain_contexts_are_never_valued():
    c = om.Context(False, 100.0, 109.78, 30, 0.05, -0.82, 0.2, ((4, 1.01),))
    assert om.in_domain(c) == om.Q_DOMAIN_REASON
    got = of.Pricer(of.Work(10**12)).many([c])[0]
    assert got == om.Q_DOMAIN_REASON


# ── the work budget (section 12) ─────────────────────────────────────────────

def test_one_theorem_exempt_call_is_served_on_closed_forms_alone():
    e = date(2027, 10, 22)
    rows = [_one(110.0, e, bid=9.80, ask=10.20, sigma=0.3)]
    a = of.run(rows, _thesis(target=130.0, by=date(2027, 8, 20)), syn.market(), dividends={"status": "ok", "rows": []})
    assert len(a["rows"]) == 1 and a["work"]["used"] < 1_000_000


def test_a_scan_past_the_budget_is_refused_at_the_charge_that_would_pass_it():
    cands, others = syn.rows_for("down")
    with pytest.raises(of.FinderError, match="Too much to price at once"):
        of.run(cands, _thesis("down", 85.0), syn.market(), other_rows=others,
               dividends={"status": "ok", "rows": syn.DIV_ROWS}, work_limit=20_000_000)
    w = of.Work(100)
    w.charge(100)
    with pytest.raises(of.FinderError):
        w.charge(1)
    assert w.used == 100


# ── pricing only what can rank (section 7b) ──────────────────────────────────

@pytest.mark.parametrize("case", [
    ("up", date(2026, 12, 18), 120.0, 5000.0, 6, "ask"),
    ("down", date(2026, 11, 20), 95.0, 20000.0, 9, "mid"),
    ("up", date(2027, 3, 19), 140.0, 3000.0, 3, "ask"),
])
def test_pruned_top_20s_equal_full_pricing(case, monkeypatch):
    view, by, target, budget, months, fill = case
    pruned = syn.scan(view, target, by, budget, months, fill)
    monkeypatch.setattr(of, "LENS_TOP", 10**6)
    full = syn.scan(view, target, by, budget, months, fill)
    assert full["universe"]["ranked_out"] == 0
    assert pruned["picks"] == full["picks"]
    by_c = {r["contract"]: r for r in full["rows"]}

    def top(rows, lens):
        rs = [dict(r, _pnl={k: Decimal(repr(v)) for k, v in r["pnl"].items()}, _cost_c=round(r["cost"] * 100)) for r in rows]
        return [r["contract"] for r in of.lens_order(rs, lens, view)][:20]
    for lens in of.LENSES:
        assert top(pruned["rows"], lens) == top(full["rows"], lens), lens
    for r in pruned["rows"]:
        assert r["pnl"] == by_c[r["contract"]]["pnl"]


# ── lenses, curve, empty answers (section 10) ────────────────────────────────

def test_lenses_are_plain_sorts_with_a_stated_tie_break(up):
    rows = up["rows"]
    tie = lambda r: (r["cost"], r["exp"], r["strike"], r["contract"])  # noqa: E731
    by_payoff = sorted(rows, key=lambda r: (-r["pnl"]["target"], *tie(r)))
    assert [r["contract"] for r in rows] == [r["contract"] for r in by_payoff]
    assert up["picks"]["payoff"] == by_payoff[0]["contract"]
    assert up["picks"]["forgiving"] == min(rows, key=lambda r: (-r["pnl"]["half"], *tie(r)))["contract"]
    doubled = [r for r in rows if r["pnl"]["target"] >= r["cost"]]
    assert doubled and up["picks"]["time"] == min(doubled, key=lambda r: (-r["pnl"]["flat"], *tie(r)))["contract"]
    words = up["lens_reasons"]
    assert words == {"time": None}


def test_the_curve_is_drawn_for_each_pick_on_the_grid(up):
    grid = up["curve"]["prices"]
    marks = up["curve"]["marks"]
    assert grid == sorted(set(grid)) and {marks["close"], marks["half"], marks["target"]} <= set(grid)
    assert len(grid) <= of.CURVE_POINTS + 3 and grid[0] == 50.0 and grid[-1] == 180.0
    for c in set(p for p in up["picks"].values() if p):
        assert len(up["curve"]["pnl"][c]) == len(grid)


def test_an_empty_window_says_what_was_looked_for():
    a = of.run([], _thesis(), syn.market(), dividends={"status": "ok", "rows": []})
    assert a["empty"].startswith("No listed calls in the window: expiries 2026-12-18 to 2027-06-18")
    b = of.run([], _thesis(), syn.market(), dividends={"status": "ok", "rows": []}, truncated=True)
    assert "this does not mean no calls are listed" in b["empty"]


# ── events (section 8) ───────────────────────────────────────────────────────

def test_events_are_placed_against_the_dates_and_coverage_is_worded():
    evs = [{"kind": "earnings", "name": "SYN earnings", "date": "2026-11-10", "time": "amc", "at": None, "source": "test"},
           {"kind": "macro", "name": "CPI", "date": "2026-11-12", "time": "exact", "at": "2026-11-12T13:30:00Z", "source": "test"}]
    a = syn.scan("up", 120.0, BY, months=2, events=evs,
                 coverage={"earnings": "fetched", "earnings_through": "2027-11-27", "macro_through": "2027-03-31"})
    names = [e["name"] for e in a["events"]]
    assert "SYN earnings" in names and "CPI" in names
    assert "Earnings dates are from Finnhub's calendar through Nov 27, 2027." in a["coverage"]
    assert "The macro calendar is stored through Mar 31, 2027; later events are not listed." in a["coverage"]
    assert any(r["flags"] for r in a["rows"] if r["modelled"])


def test_coverage_words_for_every_earnings_status():
    w = of.coverage_words
    assert w({"earnings": "stored"}, "SYN", True, True)[0].startswith("Finnhub's calendar could not be read now")
    assert w({"earnings": "not_found", "earnings_through": "2027-11-27"}, "SYN", True, False)[0] == \
        "No earnings date found for SYN in Finnhub's calendar through Nov 27, 2027."
    assert w({"earnings": "unavailable"}, "SYN", True, False)[0] == "Earnings dates could not be read."
    assert w({"earnings": "not_checked"}, "BRK.B", True, False)[0] == \
        "Earnings dates are not checked for share-class listings such as BRK.B."
    assert "Dividend data unavailable." in w({}, "SYN", False, False)


def test_the_implied_earnings_move_is_the_jump_between_the_two_expiries_after_the_report():
    evs, _ = of.normalize_events([{"kind": "earnings", "name": "SYN earnings", "date": "2027-01-27", "time": "amc",
                                   "at": None, "source": "test"}])
    e1, e2 = date(2027, 2, 19), date(2027, 3, 19)
    t1, t2 = (e1 - syn.SESSION).days / 365, (e2 - syn.SESSION).days / 365
    s1, s2 = 0.36, 0.33
    carries = {e: of.Carry(100.0, 0.0, "market", 3, s) for e, s in ((e1, s1), (e2, s2))}
    got = of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, carries, [BY, e1, e2])
    assert len(got) == 1 and got[0]["reason"] is None and got[0]["expiries"] == [e1.isoformat(), e2.isoformat()]
    jump = t1 * t2 * (s1 * s1 - s2 * s2) / (t2 - t1)
    assert got[0]["move_sd_pct"] == pytest.approx(100 * math.sqrt(jump), rel=1e-12)
    # equal volatilities price no jump; a fallen-back expiry has no market volatility; one expiry is not two
    flat = {e: of.Carry(100.0, 0.0, "market", 3, 0.3) for e in (e1, e2)}
    assert of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, flat, [e1, e2])[0]["reason"].startswith(
        "The two expiries' volatilities do not price a jump")
    fell = {**carries, e2: of.Carry(100.0, 0.0, "dividends only", 0, None)}
    assert of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, fell, [e1, e2])[0]["reason"].startswith(
        "An expiry's forward fell back")
    assert of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, carries, [e1])[0]["reason"] == \
        "Two listed expiries after the report are not in the quotes."


def test_a_second_report_shares_its_expiries_variance_with_the_first_so_it_gets_no_move_of_its_own():
    """Codex S-8: with Nov 30 and Jan 27 both before the Feb 19 / Mar 19 pair, the pair's jump is the two reports'
    together; it is not Jan 27's alone."""
    evs, _ = of.normalize_events([{"kind": "earnings", "name": n, "date": d, "time": "amc", "at": None, "source": "test"}
                                  for n, d in (("Q3", "2026-11-30"), ("Q4", "2027-01-27"))])
    e0, e1, e2 = date(2026, 12, 18), date(2027, 2, 19), date(2027, 3, 19)
    carries = {e: of.Carry(100.0, 0.0, "market", 3, s) for e, s in ((e0, 0.45), (e1, 0.36), (e2, 0.33))}
    first, second = of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, carries, [e0, e1, e2])
    assert second["date"] == "2027-01-27" and second["move_sd_pct"] is None
    assert second["reason"] == "Another earnings date falls before the second expiry."
    assert first["date"] == "2026-11-30" and first["reason"] == "Another earnings date falls before the second expiry."
    # the first report's own pair (Dec 18, Feb 19) holds the second report too; with expiries that hold only the
    # first, it gets its move
    e1b = date(2027, 1, 15)
    only = {**carries, e1b: of.Carry(100.0, 0.0, "market", 3, 0.40)}
    first, second = of.earnings_moves(evs, syn.SESSION, e2, syn.CLOSES, only, [e0, e1b, e1, e2])
    assert first["expiries"] == [e0.isoformat(), e1b.isoformat()] and first["reason"] is None and first["move_sd_pct"] > 0
    assert second["move_sd_pct"] is None and second["reason"] == "Another earnings date falls before the second expiry."


def test_unusable_event_rows_are_counted():
    a = of.run([], _thesis(), syn.market(), dividends={"status": "ok", "rows": []},
               events=[{"kind": "earnings", "name": "x", "date": "not a date", "time": "bmo"}])
    assert "1 event rows were not usable and were ignored." in a["method"]["notes"]


def test_finiteness_check_rejects_nan_rows():
    assert of._finite({"a": [1.0, {"b": 2.0}]})
    assert not of._finite({"a": [1.0, {"b": float("nan")}]})
    assert not of._finite({"a": float("inf")})


def test_session_times_use_the_new_york_close():
    close = syn.CLOSES[syn.SESSION]
    assert close == datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc)


def test_a_context_the_pricer_cannot_converge_is_dropped_as_unpriceable_never_served(monkeypatch):
    base = syn.scan("down", 85.0, BY, months=2)
    monkeypatch.setattr(om, "REFINE_LEVELS", 0)
    monkeypatch.setattr(om, "REFINE_VALUE", 1e-9)   # no lattice pair can pass: every lattice context fails
    a = syn.scan("down", 85.0, BY, months=2)
    lattice = [r for r in base["rows"] if r["model"]["session"] == of.MODEL_AMERICAN]
    assert lattice and a["universe"]["dropped"]["unpriceable"] >= len(lattice)
    assert all(r["model"]["session"] != of.MODEL_AMERICAN for r in a["rows"])
    for ans in (base, a):
        u = ans["universe"]
        assert u["passed"] + sum(u["dropped"].values()) + u["ranked_out"] == u["seen"]


def test_on_an_aapl_like_weekly_chain_every_bound_path_delta_is_american_s(monkeypatch):
    seen = {}
    orig = of.Pricer.deltas

    def spy(self, cs):
        out = orig(self, cs)
        for c in cs:
            seen[(c.is_call, c.strike, c.days)] = out[c]
        return out
    monkeypatch.setattr(of.Pricer, "deltas", spy)
    a = syn.big_scan("up", 2)
    bound = [r for r in a["rows"] if r["model"]["session"] == of.MODEL_EUROPEAN and isinstance(r["early_exercise"]["premium"], str)]
    assert a["rows"] and bound
    for r in bound:
        key = (True, r["strike"], (date.fromisoformat(r["exp"]) - syn.SESSION).days)
        assert (r["delta"], r["delta_note"]) == seen[key], r["contract"]
    assert a["work"]["used"] <= of.WORK_LIMIT
