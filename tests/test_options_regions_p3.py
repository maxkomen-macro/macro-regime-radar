"""Phase 3 claim regions, sizes and conditioned strata (design-P3-approved.md section 8.2; build step 10)."""

from __future__ import annotations

import inspect
import json

import pytest

from scripts.options_bench import cases
from scripts.options_bench import regions_p3 as R
from src.desk import options_greeks as G
from src.desk import options_math as om

SEED = 20261026


def ctx(is_call=False, spot=100.0, strike=105.0, days=60, rho=0.05, q=0.0, sigma=0.3, divs=()):
    return om.Context(is_call, spot, strike, days, rho, q, sigma, tuple(divs))


@pytest.fixture(scope="module")
def dev():
    return [cases.case(SEED, g, i) for g in cases.IN_DOMAIN_GROUPS for i in range(150)]


@pytest.fixture(scope="module")
def regions(dev):
    return R.Regions(R.support_from_dev(dev), {G.GAMMA: (R.Carve("sigma < 0.05", "sigma", "<", 0.05),)},
                     (R.Carve("puts, days > 1000", "days", ">", 1000, kind="put"),))


def test_the_support_is_the_dev_draws_bounds(dev):
    s = R.support_from_dev(dev)
    assert s.days == (1, 1464) and s.sigma_bands == ((0.001, 1.5), (2.0, 5.0))
    assert s.rho[0] == min(c.rho for c in dev) and s.q[1] == max(c.q for c in dev)
    calls = sorted(c.strike / c.spot for c in dev if c.is_call)
    assert calls[0] <= s.ks_call[0] <= s.ks_call[1] <= calls[-1]


def test_in_domain_inputs_outside_the_support_have_a_rule(regions):
    assert regions.greek_region(ctx(sigma=1.75), G.VEGA) == R.OUTSIDE_SAMPLED          # between the σ bands
    assert regions.greek_region(ctx(strike=5.0), G.VEGA) == R.OUTSIDE_SAMPLED          # K/S = 0.05
    assert om.in_domain(ctx(sigma=1.75)) is None and om.in_domain(ctx(strike=5.0)) is None
    assert regions.greek_region(ctx(), G.VEGA) is None


def test_carve_outs_remove_inputs_from_one_greek_s_region(regions):
    low = ctx(sigma=0.03)
    assert regions.greek_region(low, G.GAMMA) == R.OUTSIDE_VALIDATED
    assert regions.greek_region(low, G.VEGA) is None
    assert regions.fd_role_region(ctx(days=1200)) == R.OUTSIDE_FD_ROLE
    assert regions.fd_role_region(ctx(is_call=True, strike=95.0, days=1200)) is None


def test_the_regions_round_trip_through_the_freeze_manifest(regions, dev):
    back = R.Regions.from_json(json.loads(json.dumps(regions.to_json())))
    assert back.to_json() == regions.to_json()
    for c in dev[:200]:
        x = om.Context(c.is_call, c.spot, c.strike, c.days, c.rho, c.q, c.sigma, tuple(c.divs))
        for g in G.GREEKS:
            assert back.greek_region(x, g) == regions.greek_region(x, g)
        assert back.fd_role_region(x) == regions.fd_role_region(x)


def test_predicates_read_the_context_alone_never_a_group():
    # the features are computed from the Context's fields, and no predicate names a group or a case id
    src = inspect.getsource(R.features) + inspect.getsource(R.Support.reason) + inspect.getsource(R.Carve.hits) \
        + inspect.getsource(R.Regions.greek_region) + inspect.getsource(R.Regions.fd_role_region)
    for word in ("group", ".id", "GROUPS", "seed"):
        assert word not in src, word
    assert set(R.features(ctx())) == {"is_call", "days", "sigma", "rho", "q", "k_over_s", "n_divs", "pv_over_s",
                                      "first_div_day"}


# ── sizes ───────────────────────────────────────────────────────────────────

def test_the_dr_03_example():
    assert R.required_n(0.08) == 4688
    assert R.required_n(0.8) == 469
    plan = R.plan_sizes({"G2-dividends": {G.DIVIDEND: (100, 0.08), G.GAMMA: (1000, 0.9)},
                         "G1-nodiv": {G.DIVIDEND: (0, 0.0), G.GAMMA: (1000, 0.0)}})
    assert plan["pairs"][("G2-dividends", G.DIVIDEND)]["standing"] == "decision needed"
    assert plan["pairs"][("G2-dividends", G.GAMMA)] == {"standing": "targeted", "pi": 0.9, "n": 417}
    assert plan["pairs"][("G1-nodiv", G.DIVIDEND)] == {"standing": "not applicable"}
    assert plan["pairs"][("G1-nodiv", G.GAMMA)]["standing"] == "not targeted"
    assert plan["groups"] == {"G2-dividends": 417, "G1-nodiv": 400}


def test_a_group_size_is_at_least_400_and_at_most_the_cap():
    plan = R.plan_sizes({"g": {G.VEGA: (10, 0.99)}, "h": {G.VEGA: (10, 0.151)}})
    assert plan["groups"]["g"] == 400 and plan["groups"]["h"] == R.required_n(0.151) <= R.N_CAP


def test_stratum_proposals_follow_the_frozen_formula_and_cap():
    assert R.stratum_proposals(469, 0.1) == 9380
    assert R.stratum_proposals(469, 0.001) == R.P_CAP
    assert R.stratum_proposals(469, 0.0) is None


def test_a_stratum_is_a_fixed_proposal_population_filtered_on_inputs(regions):
    a = R.stratum(SEED, "G2-dividends", G.DIVIDEND, 300, regions, n_required=50)
    b = R.stratum(SEED, "G2-dividends", G.DIVIDEND, 300, regions, n_required=50)
    assert [c.id for c in a["cases"]] == [c.id for c in b["cases"]]
    assert a["proposals"] == 300 and a["kept"] == len(a["cases"]) <= 300
    assert all(c.divs for c in a["cases"]) and a["status"] == "reached"
    short = R.stratum(SEED, "G2-dividends", G.DIVIDEND, 20, regions, n_required=50)
    assert short["status"] == "not established: sample not reached"
    # its stream is its own: not the group's random draws
    assert {c.strike for c in a["cases"]}.isdisjoint({cases.case(SEED, "G2-dividends", i).strike for i in range(50)})


def test_the_held_out_population_is_the_frozen_sizes_in_seed_order():
    pop = R.held_out(20261999, {"G1-nodiv": 3, "G6-long": 2})
    assert [c.id for c in pop] == ["G1-nodiv/0", "G1-nodiv/1", "G1-nodiv/2", "G6-long/0", "G6-long/1"]
    assert pop[0] == cases.case(20261999, "G1-nodiv", 0)
