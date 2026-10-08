"""One rounding rule for odds printed as whole percents (fix/site-audit D1).

The live regimes row stored prob_overheating = 0.425. The Regime Lab's
takeaway narrative printed "Overheating regime (42% odds)" (Python's round()
sends the tie 42.5 to the even digit) while the Dashboard, the Regime Lab
sidebar, the Desk and Tools printed 43% (the web's Math.round rounds it up).
Every surface reads the same stored column; the rule is half up on the stored
decimal, in src/utils/format.py and web/src/lib/format.ts, and one
fixture (web/src/lib/__fixtures__/whole-percent.json) drives both suites.
"""

from __future__ import annotations

import ast
import json
import re
import sqlite3
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "web/src/lib/__fixtures__/whole-percent.json").read_text())

# The served row the defect was seen on (/api/regime/latest, 2026-10-07).
LIVE = {"goldilocks": 0.1102, "overheating": 0.425, "stagflation": 0.3691, "recession_risk": 0.0957}


@pytest.mark.parametrize("frac,expected", FIXTURE["unit"])
def test_whole_pct_matches_the_shared_fixture(frac, expected):
    from src.utils.format import whole_pct

    assert whole_pct(frac) == expected


@pytest.mark.parametrize("value,expected", FIXTURE["percent"])
def test_round_half_up_on_the_percent_scale_matches_the_shared_fixture(value, expected):
    from src.utils.format import round_half_up

    assert round_half_up(value) == expected


def test_the_tie_at_exactly_0425_prints_43():
    from src.utils.format import pct_text, whole_pct

    assert whole_pct(0.425) == 43
    assert pct_text(0.425) == "43%"


def test_the_takeaway_narrative_prints_the_tie_as_43(monkeypatch):
    from src.analytics import intelligence

    # The divergence block reads the store and swallows its errors; an empty
    # in-memory database keeps the narrative hermetic.
    monkeypatch.setattr(intelligence, "_get_conn", lambda: sqlite3.connect(":memory:"))
    out = intelligence.generate_market_takeaway(LIVE, "Overheating", {"hy_pct_rank": 30}, 9.74)
    assert "Overheating</strong> regime (43% odds)" in out["narrative"]


def test_the_takeaway_reads_odds_already_on_the_percent_scale_with_the_same_rule(monkeypatch):
    from src.analytics import intelligence

    monkeypatch.setattr(intelligence, "_get_conn", lambda: sqlite3.connect(":memory:"))
    probs = {k: v * 100 for k, v in LIVE.items()}
    out = intelligence.generate_market_takeaway(probs, "Overheating", {"hy_pct_rank": 30}, 9.74)
    assert "(43% odds)" in out["narrative"]


def test_the_playbook_summary_prints_confidence_with_the_rule():
    from src.analytics.playbook import build_playbook_dict

    out = build_playbook_dict({"label": "Overheating", "confidence": 0.285, "date": "2026-08-01"}, [])
    assert "(confidence 29%)" in out["summary"]


def test_the_daily_memo_prints_the_four_odds_with_the_rule():
    from src.daily_memo import build_html

    regime = {"label": "Overheating", "confidence": 0.2069, "as_of": "2026-08-01",
              "prob_goldilocks": 0.1102, "prob_overheating": 0.425, "prob_stagflation": 0.3691, "prob_recession": 0.0957}
    html = build_html(regime, {}, [], False, [], [], [], date(2026, 10, 7))
    assert "<b>43%</b>" in html
    assert "GL 11% &bull; OV 43% &bull; ST 37% &bull; RR 10%" in html


def test_codex_s03_the_scenario_carries_the_raw_odds_and_prints_them_half_up(monkeypatch):
    """Codex S-03: _get_current_regime_state turned the stored 0.425 into round(42.5) = 42 for the scenario's
    "stored odds" and its stress rule. It now carries the stored value ×100 exactly (42.5), the stress rule
    computes on it, and every printer rounds half up (43)."""
    from src.analytics import intelligence
    from src.utils.format import round_half_up

    def conn():
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.execute("CREATE TABLE regimes (date TEXT, label TEXT, confidence REAL, prob_goldilocks REAL, prob_overheating REAL, "
                  "prob_stagflation REAL, prob_recession REAL)")
        c.execute("INSERT INTO regimes VALUES ('2026-08-01', 'Overheating', 0.2069, 0.1102, 0.425, 0.3691, 0.0957)")
        return c

    monkeypatch.setattr(intelligence, "_get_conn", conn)
    state = intelligence._get_current_regime_state()
    assert state["probs"] == {"Goldilocks": 11.02, "Overheating": 42.5, "Stagflation": 36.91, "Recession Risk": 9.57}
    out = intelligence.run_scenario(custom_shocks={"hy_spread_delta_bps": 0})
    assert out["current_regime_probs"]["overheating"] == 42.5
    assert round_half_up(out["current_regime_probs"]["overheating"]) == 43
    assert sum(out["stressed_regime_probs"].values()) == pytest.approx(100.0)


# Modules that print the classifier's odds or confidence as whole percents.
# format(x, ".0%") rounds the double's binary value (0.425 is 0.42499… → 42)
# and round() sends a tie to even; both are the defect, so none may remain.
# Codex S-03: round(… * 100) is caught too, and the weekly memo is in.
# fix/site-audit D-e: and every other module that prints a probability (the regime odds, the classifier's
# confidence, the credit-state transition odds) as a whole percent: the Streamlit header and tabs and the
# allocation CLI. Percentile ranks, weights and returns are not probabilities and stay out.
ODDS_PRINTERS = ("src/analytics/intelligence.py", "src/analytics/chat.py", "src/analytics/playbook.py",
                 "src/daily_memo.py", "src/memo.py", "dashboard/components/intelligence_tab.py",
                 "src/analytics/allocation.py", "dashboard/app.py", "dashboard/components/decision_view.py",
                 "dashboard/components/allocation_tab.py", "dashboard/components/credit_tab.py")
# fix/site-audit D-e: the guard reads the parse tree, so a comment, a docstring or a string literal that only
# mentions a pattern never trips it, and extra parentheses or `100 * p` never hide one. A whole-percent print is
# round(…×100) or numpy's around/round(…×100) to 0 places, format(p, ".0%"), "{:.0%}".format(p), f"{p:.0%}",
# f"{p*100:.0f}%" and "%.0f%%" % (p*100). A round to 1 place or more is not a whole percent.


def _is_100(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and type(node.value) in (int, float) and node.value == 100


def _times_100(node: ast.AST) -> bool:
    return any(isinstance(n, ast.BinOp) and isinstance(n.op, ast.Mult) and (_is_100(n.left) or _is_100(n.right))
               for n in ast.walk(node))


def _to_whole(call: ast.Call, places: str) -> bool:
    nd = call.args[1] if len(call.args) > 1 else next((k.value for k in call.keywords if k.arg == places), None)
    return nd is None or (isinstance(nd, ast.Constant) and nd.value == 0)


def _spec(node: ast.AST | None) -> str:
    return "".join(v.value for v in getattr(node, "values", []) if isinstance(v, ast.Constant) and isinstance(v.value, str))


# A whole-percent print of something that is not a probability (a weight, a basis-point change, a completeness
# share) in a module the guard reads says so on its line, and keeps its own rounding: `# not a probability`.
PRAGMA = "# not a probability"


def whole_percent_offences(src: str) -> list[str]:
    """Every place `src` prints a 0–1 value as a whole percent its own way (line: snippet)."""
    out: list[str] = []
    lines = src.splitlines()
    for node in ast.walk(ast.parse(src)):
        hit = False
        if isinstance(node, ast.Call) and node.args:
            f = node.func
            if isinstance(f, ast.Name) and f.id == "round":
                hit = _times_100(node.args[0]) and _to_whole(node, "ndigits")
            elif (isinstance(f, ast.Attribute) and f.attr in ("around", "round", "rint")
                  and isinstance(f.value, ast.Name) and f.value.id in ("np", "numpy")):
                hit = _times_100(node.args[0]) and _to_whole(node, "decimals")
            elif isinstance(f, ast.Name) and f.id == "format" and len(node.args) > 1:
                spec = node.args[1]
                hit = isinstance(spec, ast.Constant) and isinstance(spec.value, str) and spec.value.endswith(".0%")
            elif (isinstance(f, ast.Attribute) and f.attr == "format" and isinstance(f.value, ast.Constant)
                  and isinstance(f.value.value, str)):
                hit = bool(re.search(r"\{[^{}]*:[^{}]*\.0%\}", f.value.value))
        elif isinstance(node, ast.JoinedStr):
            vals = node.values
            for i, v in enumerate(vals):
                if not isinstance(v, ast.FormattedValue):
                    continue
                spec = _spec(v.format_spec)
                after = vals[i + 1] if i + 1 < len(vals) else None
                if spec.endswith(".0%") or (spec.endswith(".0f") and _times_100(v.value) and isinstance(after, ast.Constant)
                                            and str(after.value).startswith("%")):
                    hit = True
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod) and isinstance(node.left, ast.Constant):
            hit = isinstance(node.left.value, str) and "%.0f%%" in node.left.value and _times_100(node.right)
        if hit and PRAGMA not in lines[node.lineno - 1]:
            out.append(f"{node.lineno}: {ast.get_source_segment(src, node)}")
    return out


@pytest.mark.parametrize("path", ODDS_PRINTERS)
def test_no_odds_printer_formats_a_whole_percent_its_own_way(path):
    hits = whole_percent_offences((ROOT / path).read_text())
    assert not hits, f"{path} prints a whole percent its own way: {hits}; use src.utils.format.pct_text / round_half_up"


# fix/site-audit D-e: the forms the guard must catch, and what it must leave alone.
GUARD_CATCHES = [
    "probs = {k: round(float(v) * 100) for k, v in stored.items()}",
    "return int(round((arr.values < current_val).mean() * 100))",
    "x = round(100 * p)",
    "x = round((p) * 100)",
    "x = round(((p * 100)))",
    "x = round(p * 100.0)",
    "x = round(p * 100, 0)",
    "x = np.around(p * 100)",
    "x = numpy.round(100 * p)",
    "s = format(p, '.0%')",
    's = f"{p:.0%}"',
    's = f"{p * 100:.0f}%"',
    's = "{:.0%}".format(p)',
    's = "%.0f%%" % (p * 100)',
]
GUARD_LEAVES = [
    "x = round_half_up(v, 2)",
    "progress = round(months / avg * 100, 1)",
    "x = np.around(p * 100, 1)",
    "x = round(p * 10)",
    "# x = round(p * 100)",
    "s = 'round(p * 100) and {p:.0%}'",
    'def f():\n    """Never format(p, \'.0%\') or round(100 * p)."""\n    return 1',
    's = f"{p:.1%}"',
    's = f"{w * 100:.1f}%"',
    "s = format(p, '.1%')",
    "bps = round((y_now - y_prev) * 100)  # not a probability: a yield change in basis points",
]


@pytest.mark.parametrize("src", GUARD_CATCHES)
def test_the_guard_catches_every_whole_percent_form(src):
    assert whole_percent_offences(src), src


@pytest.mark.parametrize("src", GUARD_LEAVES)
def test_the_guard_ignores_comments_strings_and_other_precisions(src):
    assert not whole_percent_offences(src), src
