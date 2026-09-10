"""Headline categories (src/analytics/news.py): a keyword hit alone must not
decide the category — M&A needs a transaction cue, an IPO is not a merger,
"billion" is a size not a category, and an uncertain item stays neutral."""

from __future__ import annotations

import pytest

from src.analytics.news import classify_category, classify_with_confidence, score_categories

CASES = [
    # the reported defect
    ("China challenges Korean champions in flash memory race", "", "SECTOR"),
    # true M&A
    ("Microsoft to acquire Activision in $69 billion deal", "", "M&A"),
    ("Broadcom completes VMware merger", "", "M&A"),
    ("Exxon in talks to buy Pioneer for $60 billion", "", "M&A"),
    ("Pfizer to sell consumer health unit to Kenvue", "", "M&A"),
    ("Blackstone takeover of Hilton approved by shareholders", "", "M&A"),
    # IPO / listing is a capital-markets event, not M&A
    ("Arm shares jump in Nasdaq debut after $5 billion IPO", "", "SECTOR"),
    ("Reddit files for initial public offering", "", "SECTOR"),
    # semiconductor production
    ("TSMC to expand Arizona chip production capacity", "", "SECTOR"),
    # earnings
    ("Nvidia beats estimates, raises guidance on AI demand", "", "EARNINGS"),
    ("Apple reports record quarterly revenue of $120 billion", "", "EARNINGS"),
    ("Tesla profit falls 45% as price cuts bite", "Q2 net income declined", "EARNINGS"),
    # macro policy
    ("Fed holds rates steady, signals two cuts this year", "", "MACRO"),
    ("CPI rises 3.2% as inflation proves sticky", "", "MACRO"),
    ("ECB cuts rates by 25 basis points", "", "MACRO"),
    ("Jobs report: payrolls rise 187,000, unemployment ticks up", "", "MACRO"),
    # credit
    ("Credit spreads widen as high-yield issuance stalls", "", "MACRO"),
    ("Moody's downgrades regional bank on commercial real estate exposure", "", "SECTOR"),
    # geopolitics
    ("US imposes new tariffs on Chinese EVs", "", "GEOPOLITICAL"),
    ("OPEC+ extends production cuts through year end", "", "GEOPOLITICAL"),
    # ambiguous "deal" and empty text stay neutral
    ("Acme signs a deal with a new supplier", "", "SECTOR"),
    ("", "", "SECTOR"),
]


@pytest.mark.parametrize("headline, summary, expected", CASES)
def test_categories(headline, summary, expected):
    assert classify_category(headline, summary) == expected


def test_billion_alone_is_not_a_transaction():
    assert score_categories("Apple reports record quarterly revenue of $120 billion")["M&A"] == 0


def test_ipo_alone_never_scores_ma():
    assert score_categories("Reddit files for initial public offering")["M&A"] == 0


def test_confidence_low_for_ambiguous_deal():
    cat, conf = classify_with_confidence("Acme signs a deal with a new supplier")
    assert cat == "SECTOR" and conf == 0.0
    cat, conf = classify_with_confidence("Microsoft to acquire Activision in $69 billion deal")
    assert cat == "M&A" and conf >= 0.6


def test_summary_participates():
    assert classify_category("Update from the company", "The board approved the merger with Contoso") == "M&A"
