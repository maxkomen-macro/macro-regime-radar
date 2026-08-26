"""Regression tests for the 2026-08-26 Streamlit dashboard back-ports.

Covers two fixes back-ported from the API / web work:

1. ``events_tab.load_news`` news-window predicate — ``published_at`` mixes
   ISO-T (``2026-08-26T04:50:05+00:00``) and space (``2026-07-30 02:08:34``)
   forms while ``datetime('now', ...)`` yields the space form; lexicographic
   ``'T' > ' '`` let same-day rows OLDER than the window leak in. Fixed by
   normalizing with ``replace(substr(published_at, 1, 19), 'T', ' ')``
   (same predicate as api/db.py).

2. Regime badge hues — three copy-pasted dicts (``BADGE_STYLES`` in
   dashboard/app.py, ``_BADGE_MUTED_STYLES`` in shared_styles.py,
   ``_REGIME_BADGES`` in methodology.py) moved off the old GitHub reds/ambers
   onto the regime ramp (REGIME_COLORS / web tokens).

Assert styles used, per target:

- shared_styles / methodology: IMPORT-based — both modules import headless
  under the anaconda interpreter (verified; only harmless streamlit cache
  warnings), so asserting on the live dict objects is strictly stronger than
  grepping text.
- events_tab predicate: TEXT-based for the predicate string (it lives inside
  an ``@st.cache_data`` function body, so the source string is the artifact
  under test) PLUS a functional temp-DB test calling the real ``load_news``
  (events_tab also imports headless) to prove the leak row is excluded.
- dashboard/app.py: TEXT-based only — module level runs ``st.set_page_config``
  and downloads the DB from the data-latest release at import; unsafe to
  import in a test.
"""

import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
for p in (str(ROOT), str(DASHBOARD)):
    if p not in sys.path:
        sys.path.insert(0, p)

from components import events_tab, methodology, shared_styles  # noqa: E402

# The ratified regime ramp: (rgb triplet, text color). Stagflation text uses
# the red-on-dark contrast token #f08785, not raw #e74c3c.
RAMP = {
    "Goldilocks":     ("46,204,113",  "#2ecc71"),
    "Overheating":    ("230,126,34",  "#e67e22"),
    "Stagflation":    ("231,76,60",   "#f08785"),
    "Recession Risk": ("149,165,166", "#95a5a6"),
}
OLD_GITHUB_RED = "218,54,51"


def _assert_ramp(styles: dict) -> None:
    assert set(styles) == set(RAMP)
    for regime, (rgb, text) in RAMP.items():
        style = styles[regime]
        assert f"rgba({rgb},0.12)" in style, (regime, style)   # 12% fill
        assert f"rgba({rgb},0.25)" in style, (regime, style)   # 25% border
        assert f"color:{text}" in style, (regime, style)
        assert OLD_GITHUB_RED not in style, (regime, style)


# ── Badge dicts: import-based (modules import headless) ──────────────────────

def test_shared_styles_badge_ramp():
    _assert_ramp(shared_styles._BADGE_MUTED_STYLES)


def test_methodology_badge_ramp():
    _assert_ramp(methodology._REGIME_BADGES)


def test_muted_badge_dicts_identical():
    assert dict(shared_styles._BADGE_MUTED_STYLES) == dict(methodology._REGIME_BADGES)


# ── app.py badge dict: text-based (module unsafe to import in tests) ─────────

def test_app_badge_styles_text():
    src = (DASHBOARD / "app.py").read_text()
    start = src.index("BADGE_STYLES = {")
    block = src[start : src.index("}", start)]
    for regime, (rgb, text) in RAMP.items():
        assert f'"{regime}"' in block
        assert f"rgba({rgb},0.12) !important" in block, regime
        assert f"rgba({rgb},0.25)" in block, regime
        assert f"color:{text} !important" in block, regime
    assert OLD_GITHUB_RED not in block
    # app.py's values are the muted dicts' values plus !important per declaration
    for regime, style in shared_styles._BADGE_MUTED_STYLES.items():
        bg, color, border = style.split(";")
        assert f"{bg} !important;{color} !important;{border}" in block, regime


def test_old_github_red_gone_from_app():
    assert OLD_GITHUB_RED not in (DASHBOARD / "app.py").read_text()


# ── News window predicate: text-based ────────────────────────────────────────

def test_events_tab_predicate_text():
    src = (DASHBOARD / "components" / "events_tab.py").read_text()
    assert "replace(substr(published_at, 1, 19), 'T', ' ')" in src
    # the bare lexicographic comparison must be gone
    assert "published_at >= datetime" not in src


# ── News window predicate: functional (load_news against a temp DB) ──────────

def test_load_news_excludes_same_day_T_form_leak(tmp_path):
    """A T-form row older than the window but sharing the boundary's calendar
    day leaked in under the old predicate ('T' > ' '). Prove the real
    load_news now excludes it and still includes fresh rows of both forms."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    boundary = now - timedelta(hours=24)
    midnight = boundary.replace(hour=0, minute=0, second=0)
    # same UTC day as the boundary, strictly before it (degenerate 1s/day case:
    # boundary exactly at midnight → fall back to boundary-1s, still excluded)
    leak_dt = midnight if midnight < boundary else boundary - timedelta(seconds=1)

    t_form = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S") + "+00:00"  # noqa: E731
    space_form = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731

    db = tmp_path / "news_test.db"
    conn = sqlite3.connect(db)
    conn.execute(
        """CREATE TABLE news_feed (
            id INTEGER PRIMARY KEY, headline TEXT, summary TEXT, url TEXT,
            source TEXT, category TEXT, published_at TEXT, fetched_at TEXT,
            market_impact REAL, deal_size REAL, sector_relevance REAL,
            time_sensitivity REAL, regime_relevance REAL,
            overall_significance REAL, regime_interpretation TEXT,
            perplexity_research TEXT, ticker TEXT)"""
    )
    rows = [
        (1, t_form(leak_dt)),                          # stale, T-form → excluded
        (2, t_form(now - timedelta(hours=1))),         # fresh, T-form → included
        (3, space_form(now - timedelta(hours=2))),     # fresh, space form → included
    ]
    for rid, pub in rows:
        conn.execute(
            "INSERT INTO news_feed VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rid, f"h{rid}", "s", "http://x", "src", "MACRO", pub, pub,
             1.0, None, 1.0, 1.0, 1.0, 5.0, None, None, None),
        )
    conn.commit()

    # fixture sanity: the OLD bare predicate really does leak row 1 in
    if leak_dt.date() == boundary.date():
        leaked = conn.execute(
            "SELECT id FROM news_feed WHERE published_at >= datetime('now', ?)",
            ("-24 hours",),
        ).fetchall()
        assert (1,) in leaked, "fixture no longer reproduces the lexicographic leak"
    conn.close()

    df = events_tab.load_news(str(db), 24, "ALL")
    got = set(df["id"].tolist())
    assert got == {2, 3}, f"expected fresh rows only, got ids {got}"
