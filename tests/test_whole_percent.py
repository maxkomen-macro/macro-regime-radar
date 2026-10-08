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


# Modules that print the classifier's odds or confidence as whole percents.
# format(x, ".0%") rounds the double's binary value (0.425 is 0.42499… → 42)
# and round() sends a tie to even; both are the defect, so none may remain.
# src/memo.py (the weekly memo) is left out: it fails at import in CI
# ("No module named 'src'", reported, not fixed here).
ODDS_PRINTERS = ("src/analytics/intelligence.py", "src/analytics/chat.py", "src/analytics/playbook.py",
                 "src/daily_memo.py")


@pytest.mark.parametrize("path", ODDS_PRINTERS)
def test_no_odds_printer_formats_a_whole_percent_its_own_way(path):
    src = (ROOT / path).read_text()
    assert not re.search(r":\.0%\}", src), f"{path} formats a percent with '.0%'; use src.utils.format.pct_text"
    assert not re.search(r"\*\s*100:\.0f\}%", src), f"{path} formats a percent with '*100:.0f'; use pct_text"
