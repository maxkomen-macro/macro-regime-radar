"""
dashboard/components/events_tab.py — Events & Intelligence tab (Phase 11).
Bloomberg-terminal aesthetic — three-zone intelligence interface.

Zones:
  1) Intelligence Summary Bar  — 5 stat cards
  2) Filter Bar                — category + time pills
  3) Two-Column Feed           — headline list (left) + detail card (right)
  4) Macro Events Calendar     — upcoming events with countdown badges
"""

import html
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from components.db_helpers import get_upcoming_events, load_event_calendar

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"

# ── Bloomberg palette ─────────────────────────────────────────────────────────
_BG              = "#0d1117"
_CARD_BG         = "#161b22"
_BORDER          = "#30363d"
_BORDER_SUBTLE   = "#21262d"
_TEXT            = "#e6edf3"
_MUTED           = "#8b949e"
_TEXT_MUTED      = "#6e7681"
_ACCENT          = "#4a9eff"
_ACCENT_GREEN    = "#2ecc71"
_ACCENT_ORANGE   = "#ff8c00"
_ACCENT_RED      = "#ff4444"
_ACCENT_YELLOW   = "#ffd700"
_ACCENT_PURPLE   = "#7c3aed"
_ACCENT_BLUE_DIM = "#1a3a5c"

# ── News source config ────────────────────────────────────────────────────────
# Adding a new feed requires only a new entry here plus a fetch function in
# src/analytics/news.py. Render logic reads categories, labels, and badge
# colors from this dict — no UI changes needed to light up a new source.
NEWS_SOURCES = {
    "finnhub": {
        "label":      "Finnhub",
        "color":      "#4a9eff",
        "bg":         "#1a3a5c",
        "categories": ["M&A", "MACRO", "EARNINGS"],
    },
    "newsapi": {
        "label":      "NewsAPI",
        "color":      "#2ecc71",
        "bg":         "#1a3a1a",
        "categories": ["MACRO", "GEOPOLITICAL", "SECTOR"],
    },
}
_SOURCE_DEFAULT = {"label": "", "color": _MUTED, "bg": "#21262d", "categories": []}

# ── Source credibility tiers ─────────────────────────────────────────────────
# Display-only. To add FT/WSJ/Economist as actual sources, add their RSS
# feeds or APIs to src/analytics/news.py in Phase 12.
SOURCE_TIERS = {
    "ft":                  1,
    "financial times":     1,
    "wsj":                 1,
    "wall street journal": 1,
    "economist":           1,
    "nyt":                 1,
    "new york times":      1,
    "bloomberg":           1,
    "reuters":             1,
    "cnbc":                2,
    "businesswire":        2,
    "seekingalpha":        2,
    "barrons":             2,
    "marketwatch":         2,
    "globalnewswire":      3,
    "pr newswire":         3,
    "prnewswire":          3,
}

# Tier → (color, weight) for source name in the row meta line.
_TIER_STYLES = {
    1: ("#e6edf3", 600),
    2: ("#8b949e", 500),
    3: ("#6e7681", 400),
}


def _source_tier(source: str) -> int:
    s = (source or "").lower()
    for key, tier in SOURCE_TIERS.items():
        if key in s:
            return tier
    return 2

# ── Category badge styles ─────────────────────────────────────────────────────
_CAT_STYLES = {
    "MACRO":        {"bg": "#1a3a5c",  "color": "#4a9eff"},
    "M&A":          {"bg": "#3a2a0a",  "color": "#ff8c00"},
    "EARNINGS":     {"bg": "#1a3a1a",  "color": "#2ecc71"},
    "GEOPOLITICAL": {"bg": "#3a1a1a",  "color": "#ff4444"},
    "SECTOR":       {"bg": "#2a1f3a",  "color": "#a78bfa"},
}
_CAT_DEFAULT = {"bg": "#21262d", "color": "#8b949e"}

# ── Deal size labels ──────────────────────────────────────────────────────────
_DEAL_LABELS = {2: "<$1B", 3: "$1-10B", 4: "$10-50B", 5: "$50B+"}

# ── GEO display → stored value mapping ───────────────────────────────────────
_CAT_DISPLAY_MAP = {
    "ALL":      "ALL",
    "MACRO":    "MACRO",
    "M&A":      "M&A",
    "EARNINGS": "EARNINGS",
    "EARN":     "EARNINGS",
    "GEO":      "GEOPOLITICAL",
    "SECTOR":   "SECTOR",
}

# ── Category short labels ─────────────────────────────────────────────────────
_CAT_SHORT = {
    "MACRO": "MAC", "M&A": "M&A", "EARNINGS": "ERN",
    "GEOPOLITICAL": "GEO", "SECTOR": "SEC",
}

# ── Regime-aware headline tags ────────────────────────────────────────────────
# (category, regime) → short phrase (≤ 30 chars) shown under each row.
# `"*"` is the catch-all when the specific regime isn't keyed.
_REGIME_TAGS: dict[tuple[str, str], str] = {
    ("M&A",          "Overheating"):    "Credit expansion signal",
    ("M&A",          "Goldilocks"):     "Deal flow indicator",
    ("M&A",          "Stagflation"):    "Strategic consolidation",
    ("M&A",          "Recession Risk"): "Distressed M&A watch",
    ("M&A",          "*"):              "Deal flow indicator",
    ("MACRO",        "*"):              "Policy direction signal",
    ("GEOPOLITICAL", "Stagflation"):    "Supply chain risk",
    ("GEOPOLITICAL", "Overheating"):    "Inflation pass-through",
    ("GEOPOLITICAL", "*"):              "Macro risk factor",
    ("EARNINGS",     "Recession Risk"): "Earnings deterioration",
    ("EARNINGS",     "Overheating"):    "Margin pressure signal",
    ("EARNINGS",     "Goldilocks"):     "Corporate health read",
    ("EARNINGS",     "*"):              "Corporate health read",
    ("SECTOR",       "*"):              "Sector rotation signal",
}

# ── Filter + row button CSS ───────────────────────────────────────────────────
_FILTER_CSS = """<style>
/* Filter bar pill buttons — unselected (secondary) */
div[data-testid="stHorizontalBlock"] .stButton > button[kind="secondary"] {
    background: transparent !important;
    border: 1px solid #30363d !important;
    color: #8b949e !important;
    border-radius: 16px !important;
    padding: 4px 14px !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    font-family: 'SF Mono', 'Fira Code', monospace !important;
    letter-spacing: 0.8px !important;
    height: 28px !important;
    min-height: 28px !important;
    line-height: 1 !important;
    white-space: nowrap !important;
    width: 100% !important;
    box-shadow: none !important;
    text-align: center !important;
    /* Defeat the invisible-overlay rule below so pills stay visible */
    opacity: 1 !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    position: static !important;
    z-index: auto !important;
}
div[data-testid="stHorizontalBlock"] .stButton > button[kind="secondary"]:hover {
    border-color: #4a9eff !important;
    color: #4a9eff !important;
    background: rgba(74,158,255,0.08) !important;
}
/* Filter bar pill buttons — selected (primary) */
div[data-testid="stHorizontalBlock"] .stButton > button[kind="primary"] {
    background: #4a9eff !important;
    border: 1px solid #4a9eff !important;
    color: #0d1117 !important;
    border-radius: 16px !important;
    padding: 4px 14px !important;
    font-size: 11px !important;
    font-weight: 700 !important;
    font-family: 'SF Mono', 'Fira Code', monospace !important;
    letter-spacing: 0.8px !important;
    height: 28px !important;
    min-height: 28px !important;
    line-height: 1 !important;
    white-space: nowrap !important;
    width: 100% !important;
    box-shadow: 0 0 0 2px rgba(74,158,255,0.25) !important;
    text-align: center !important;
    /* Defeat the invisible-overlay rule below so pills stay visible */
    opacity: 1 !important;
    margin-top: 0 !important;
    margin-bottom: 0 !important;
    position: static !important;
    z-index: auto !important;
}
div[data-testid="stHorizontalBlock"] .stButton > button[kind="primary"]:hover {
    background: #66b0ff !important;
    border-color: #66b0ff !important;
    color: #0d1117 !important;
}
/* Tighten column padding in filter row */
div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
    padding: 0 3px !important;
}

/* ─── Headline rows — clean terminal feed (FT + Bloomberg) ───────────── */
.ei-hrow {
    display: block;
    border-left: 3px solid transparent;
    border-bottom: 1px solid #21262d;
    padding: 12px 16px;
    margin: 0;
    cursor: pointer;
    transition: background 100ms ease, border-left-color 100ms ease;
}
.ei-hrow:hover { background: #161b22; }
.ei-hrow-sel {
    background: #1c2128;
    border-left-color: #4a9eff;
}
.ei-hrow-sel .ei-hrow-head { color: #4a9eff; }
.ei-hrow-sel .ei-hrow-cat  { filter: brightness(1.2); }

.ei-hrow-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.ei-hrow-cat {
    font-family: 'SF Mono','Fira Code',monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
}
.ei-hrow-sig {
    font-family: 'SF Mono','Fira Code',monospace;
    font-size: 12px;
    font-weight: 700;
}
.ei-hrow-head {
    font-family: system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    color: #e6edf3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
    margin-bottom: 6px;
}
.ei-hrow-meta {
    font-family: 'SF Mono','Fira Code',monospace;
    font-size: 11px;
    color: #6e7681;
    margin-bottom: 4px;
}
.ei-hrow-sep  { color: #30363d; margin: 0 6px; }
.ei-hrow-time { color: #6e7681; }
.ei-hrow-tag {
    font-family: system-ui,-apple-system,sans-serif;
    font-style: italic;
    font-size: 11px;
    color: rgba(74,158,255,0.7);
}

/* ─── Invisible overlay button — sits on top of the .ei-hrow above it ──
   Filter / refresh pills stay styled by the stHorizontalBlock-scoped
   rules above (higher specificity), so only headline-row buttons hit
   these transparent-overlay rules. */
.stButton > button[kind="secondary"],
.stButton > button[kind="primary"] {
    position: relative !important;
    width: 100% !important;
    height: 112px !important;
    min-height: 112px !important;
    margin-top: -114px !important;
    margin-bottom: 0 !important;
    padding: 0 !important;
    opacity: 0 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    cursor: pointer !important;
    z-index: 2;
}
.stButton > button[kind="secondary"]:hover,
.stButton > button[kind="primary"]:hover {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

/* LIVE pulse for fresh-data indicator */
@keyframes ei-pulse {
    0%   { opacity: 0.35; transform: scale(1.0); }
    50%  { opacity: 1.0;  transform: scale(1.15); }
    100% { opacity: 0.35; transform: scale(1.0); }
}
.ei-live-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #2ecc71;
    box-shadow: 0 0 6px rgba(46,204,113,0.7);
    animation: ei-pulse 1.4s ease-in-out infinite;
    margin-right: 6px;
    vertical-align: middle;
}

/* Refresh button — a subtle icon-sized round button */
button[data-testid="baseButton-secondary"][aria-label="ei-refresh"] {
    border-radius: 50% !important;
    padding: 0 !important;
    width: 28px !important;
    height: 28px !important;
    min-height: 28px !important;
}
</style>"""


# ── Data loader ───────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_news(db_path: str, time_hours: int, category: str) -> pd.DataFrame:
    """Load news_feed rows filtered by time window and optional category."""
    try:
        conn = sqlite3.connect(db_path)
        time_filter = f"-{time_hours} hours"
        base_cols = """SELECT id, headline, summary, url, source, category,
                              published_at, fetched_at, market_impact, deal_size,
                              sector_relevance, time_sensitivity, regime_relevance,
                              overall_significance, regime_interpretation,
                              perplexity_research, ticker
                       FROM news_feed
                       WHERE published_at >= datetime('now', ?)"""
        if category != "ALL":
            df = pd.read_sql_query(
                base_cols + " AND category = ? ORDER BY overall_significance DESC,"
                " published_at DESC LIMIT 150",
                conn,
                params=(time_filter, category),
            )
        else:
            df = pd.read_sql_query(
                base_cols + " ORDER BY overall_significance DESC,"
                " published_at DESC LIMIT 150",
                conn,
                params=(time_filter,),
            )
        conn.close()
        return df
    except Exception:
        return pd.DataFrame()


# ── Formatting helpers ────────────────────────────────────────────────────────

def _time_ago(published_at: str) -> str:
    try:
        pub = datetime.fromisoformat(published_at)
        if pub.tzinfo is None:
            pub = pub.replace(tzinfo=timezone.utc)
        secs = (datetime.now(timezone.utc) - pub).total_seconds()
        if secs < 3600:
            return f"{int(secs / 60)}m ago"
        if secs < 86400:
            return f"{int(secs / 3600)}h ago"
        return f"{int(secs / 86400)}d ago"
    except Exception:
        return ""


def _last_updated(df: pd.DataFrame) -> str:
    if df.empty or "fetched_at" not in df.columns:
        return "—"
    try:
        latest = pd.to_datetime(df["fetched_at"], utc=True, errors="coerce").max()
        return latest.strftime("%H:%M UTC")
    except Exception:
        return "—"


def _sig_dots_html(score: float, accent: str) -> str:
    """Five filled-circle dots. Active dots use `accent`, inactive use #30363d.

    Uses inline-block divs with a solid background so the dots render as
    true filled circles on every browser/font — the unicode `●` glyph
    renders as a faint outline in many system fonts.
    """
    filled = min(max(int(round(score)), 0), 5)
    parts = []
    for i in range(5):
        bg = accent if i < filled else "#30363d"
        parts.append(
            f'<span style="display:inline-block;width:7px;height:7px;'
            f'border-radius:50%;background:{bg};margin:0 2px;'
            f'vertical-align:middle;"></span>'
        )
    return "".join(parts)


def _accent_color(score: float) -> str:
    if score >= 4.5:
        return _ACCENT_RED
    if score >= 3.5:
        return _ACCENT_ORANGE
    if score >= 2.5:
        return _ACCENT_YELLOW
    return _ACCENT_GREEN


def _score_color(v: int) -> str:
    if v >= 5:
        return _ACCENT_RED
    if v >= 4:
        return _ACCENT_ORANGE
    if v >= 3:
        return _ACCENT_YELLOW
    if v >= 2:
        return _ACCENT
    return _TEXT_MUTED


def _score_verdict(v: int) -> tuple[str, str]:
    """Verdict label + color for a 1–5 dimension score."""
    if v >= 4:
        return ("HIGH",     _ACCENT_RED)
    if v == 3:
        return ("MODERATE", _ACCENT_YELLOW)
    return     ("LOW",      _TEXT_MUTED)


def _sig_verdict(score: float) -> tuple[str, str]:
    """Verdict label + color for overall significance (1.0–5.0)."""
    if score >= 4.5:
        return ("CRITICAL",    _ACCENT_RED)
    if score >= 3.5:
        return ("HIGH IMPACT", _ACCENT_ORANGE)
    if score >= 2.5:
        return ("NOTABLE",     _ACCENT_YELLOW)
    return     ("ROUTINE",     _ACCENT_GREEN)


def _regime_tag(category: str, regime: str) -> str:
    """Short descriptive tag derived from (category, regime)."""
    cat = (category or "").upper()
    reg = regime or ""
    if (cat, reg) in _REGIME_TAGS:
        return _REGIME_TAGS[(cat, reg)]
    if (cat, "*") in _REGIME_TAGS:
        return _REGIME_TAGS[(cat, "*")]
    return "Market signal"


@st.cache_data(ttl=300)
def _current_regime(db_path: str) -> str:
    """Latest regime label from the regimes table (Goldilocks if missing)."""
    try:
        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT label FROM regimes ORDER BY date DESC LIMIT 1"
            ).fetchone()
            return (row[0] if row and row[0] else "Goldilocks")
    except Exception:
        return "Goldilocks"


def _source_badge_style(source_name: str) -> dict:
    """Map an arbitrary source string to a NEWS_SOURCES entry by substring."""
    if not source_name:
        return _SOURCE_DEFAULT
    src = source_name.lower()
    for cfg in NEWS_SOURCES.values():
        label = cfg.get("label", "").lower()
        if label and label in src:
            return cfg
    return _SOURCE_DEFAULT


def _is_fresh(df: pd.DataFrame, hours: float = 1.0) -> bool:
    """True if most recent fetched_at is within `hours` of now."""
    if df.empty or "fetched_at" not in df.columns:
        return False
    try:
        latest = pd.to_datetime(df["fetched_at"], utc=True, errors="coerce").max()
        if pd.isna(latest):
            return False
        delta = (datetime.now(timezone.utc) - latest.to_pydatetime()).total_seconds()
        return 0 <= delta <= hours * 3600
    except Exception:
        return False


# ── Zone 1: Intelligence Summary Bar ─────────────────────────────────────────

def render_summary_bar(df: pd.DataFrame) -> None:
    total   = len(df)
    high    = int((df["overall_significance"] >= 4).sum()) if not df.empty else 0
    ma_n    = int((df["category"] == "M&A").sum()) if not df.empty else 0
    macro_n = int((df["category"] == "MACRO").sum()) if not df.empty else 0
    geo_n   = int((df["category"] == "GEOPOLITICAL").sum()) if not df.empty else 0

    def _card(label: str, count: int, accent: str) -> str:
        return (
            f'<div style="flex:1;background:#161b22;border:1px solid #30363d;'
            f'border-top:2px solid {accent};border-radius:0 0 6px 6px;'
            f'padding:12px 16px;text-align:center;">'
            f'<div style="color:#6e7681;font-size:10px;font-weight:700;'
            f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
            f'margin-bottom:6px;">{label}</div>'
            f'<div style="color:{accent};font-size:22px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;line-height:1;">{count}</div>'
            f'</div>'
        )

    bar_html = (
        '<div style="display:flex;gap:8px;padding:0 0 16px 0;font-family:system-ui;">'
        + _card("HEADLINES", total, _ACCENT)
        + _card("HIGH IMPACT", high, _ACCENT_RED)
        + _card("M&amp;A DEALS", ma_n, _ACCENT_ORANGE)
        + _card("MACRO/FED", macro_n, _ACCENT)
        + _card("GEOPOLITICAL", geo_n, _ACCENT_YELLOW)
        + "</div>"
    )
    components.html(bar_html, height=90)


# ── Zone 2: Filter Bar ────────────────────────────────────────────────────────

# Preserve a stable display order; filter pills are derived from the union
# of categories across all configured NEWS_SOURCES (FIX 6 — extensible).
_PILL_ORDER: list[str] = ["MACRO", "M&A", "EARNINGS", "GEOPOLITICAL", "SECTOR"]
_PILL_SHORT: dict[str, str] = {
    "MACRO":        "MACRO",
    "M&A":          "M&A",
    "EARNINGS":     "EARN",
    "GEOPOLITICAL": "GEO",
    "SECTOR":       "SECTOR",
}


def _available_category_labels() -> list[str]:
    """Derive filter-pill labels from NEWS_SOURCES. `ALL` is always first."""
    available = {c for s in NEWS_SOURCES.values() for c in s.get("categories", [])}
    return ["ALL"] + [_PILL_SHORT[c] for c in _PILL_ORDER if c in available]


def render_filter_bar() -> None:
    cat_labels  = _available_category_labels()
    time_labels = ["24H", "48H", "7D"]

    # cols: N category + 0.3 divider + 3 time + spacer + 0.6 refresh
    n_cat   = len(cat_labels)
    col_specs = [1] * n_cat + [0.3] + [1] * len(time_labels) + [3.5, 0.6]
    cols    = st.columns(col_specs)

    for i, label in enumerate(cat_labels):
        stored = _CAT_DISPLAY_MAP.get(label, label)
        is_sel = st.session_state["ei_cat"] == stored
        with cols[i]:
            if st.button(
                label,
                key=f"ei_cat_btn_{label}",
                type="primary" if is_sel else "secondary",
                use_container_width=True,
            ):
                st.session_state["ei_cat"] = stored
                st.rerun()

    # divider column (n_cat) intentionally empty

    for j, t in enumerate(time_labels):
        is_sel = st.session_state["ei_time"] == t
        with cols[n_cat + 1 + j]:
            if st.button(
                t,
                key=f"ei_time_btn_{t}",
                type="primary" if is_sel else "secondary",
                use_container_width=True,
            ):
                st.session_state["ei_time"] = t
                st.rerun()

    # Rightmost: manual refresh button (↻)
    with cols[-1]:
        if st.button("↻", key="ei_refresh", help="Refresh news feed",
                     use_container_width=True):
            st.cache_data.clear()
            st.rerun()

    st.markdown(
        '<div style="height:1px;background:#21262d;margin:8px 0 12px 0;"></div>',
        unsafe_allow_html=True,
    )


# ── Zone 3 left: Headline List ────────────────────────────────────────────────


def render_headline_list(df: pd.DataFrame, current_regime: str = "Goldilocks") -> None:
    """Native Streamlit headline list — one st.button per row.

    Click detection uses session_state, not query_params. Each row button's
    `type` reflects selection state (primary=selected, secondary=not). Row
    styling lives in _FILTER_CSS (scoped via absence of stHorizontalBlock
    ancestor). A scrollable st.container caps the list height at 600px.
    """
    n     = len(df)
    fresh = _is_fresh(df, hours=1.0)
    live_html = (
        '<span class="ei-live-dot"></span>'
        '<span style="color:#2ecc71;font-size:9px;font-weight:700;'
        'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
        'margin-right:8px;">LIVE</span>'
        if fresh else ""
    )
    st.markdown(
        f'<div style="display:flex;align-items:center;'
        f'color:#8b949e;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
        f'padding:0 0 8px 0;border-bottom:1px solid #21262d;">'
        f'<span style="flex:1;">HEADLINES '
        f'<span style="color:#30363d;">({n})</span></span>'
        f'{live_html}</div>',
        unsafe_allow_html=True,
    )

    list_box = st.container(height=600, border=False)
    with list_box:
        for _, item in df.iterrows():
            item_id   = int(item["id"])
            is_sel    = st.session_state["ei_selected"] == item_id
            headline  = str(item.get("headline", ""))
            ta        = _time_ago(str(item.get("published_at", "")))
            cat       = str(item.get("category", ""))
            cat_short = _CAT_SHORT.get(cat, cat[:3] if cat else "—")
            src_raw   = str(item.get("source", ""))
            sig       = float(item.get("overall_significance", 1.0) or 1.0)

            # Significance number color (per spec): gray < 2.5, yellow 2.5–3.5,
            # red ≥ 3.5. This drives the top-right digit only — no label.
            if sig >= 3.5:
                sig_color = _ACCENT_RED
            elif sig >= 2.5:
                sig_color = _ACCENT_YELLOW
            else:
                sig_color = _TEXT_MUTED

            cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
            tag        = _regime_tag(cat, current_regime)
            tier       = _source_tier(src_raw)
            t_color, t_weight = _TIER_STYLES.get(tier, _TIER_STYLES[2])

            headline_e  = html.escape(headline)
            src_e       = html.escape(src_raw)
            ta_e        = html.escape(ta)
            tag_e       = html.escape(tag)
            cat_short_e = html.escape(cat_short)

            sel_class = " ei-hrow-sel" if is_sel else ""
            cat_badge = (
                f'<span class="ei-hrow-cat" style="background:'
                f'{cat_style["bg"]};color:{cat_style["color"]};">'
                f'{cat_short_e}</span>'
            ) if cat_short else ""

            sig_num = (
                f'<span class="ei-hrow-sig" style="color:{sig_color};">'
                f'{sig:.1f}</span>'
            )

            meta_inner = ""
            if src_e:
                meta_inner += (
                    f'<span style="color:{t_color};font-weight:{t_weight};">'
                    f'{src_e}</span>'
                )
            if src_e and ta_e:
                meta_inner += '<span class="ei-hrow-sep">·</span>'
            if ta_e:
                meta_inner += f'<span class="ei-hrow-time">{ta_e}</span>'

            tag_block = (
                f'<div class="ei-hrow-tag">{tag_e}</div>' if tag_e else ""
            )

            row_html = (
                f'<div class="ei-hrow{sel_class}">'
                f'<div class="ei-hrow-top">{cat_badge}{sig_num}</div>'
                f'<div class="ei-hrow-head">{headline_e}</div>'
                f'<div class="ei-hrow-meta">{meta_inner}</div>'
                f'{tag_block}'
                f'</div>'
            )
            st.markdown(row_html, unsafe_allow_html=True)

            # Invisible click target — overlaps the .ei-hrow above via
            # negative margin in the row-button CSS rules.
            if st.button(
                " ",
                key=f"ei_row_{item_id}",
                type="primary" if is_sel else "secondary",
                use_container_width=True,
            ):
                st.session_state["ei_selected"] = item_id
                st.rerun()


# ── Zone 3 right: Detail Card ─────────────────────────────────────────────────

def render_detail_card(row: pd.Series) -> None:
    """Detail card built from native Streamlit elements.

    No outer iframe wrapping — that was what caused the earlier about:srcdoc
    navigation bug and left blank space below short cards. Each section is
    its own `st.markdown` / `st.progress` / `st.columns` block, separated by
    `st.divider()`. Height is whatever the content needs; no fixed container.
    `components.v1.html()` is used only for the five small score boxes.
    """
    cat        = str(row.get("category", ""))
    cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
    sig        = float(row.get("overall_significance", 1.0))
    sig_color  = _accent_color(sig)

    headline_e   = html.escape(str(row.get("headline", "")))
    source_raw   = str(row.get("source", "") or "")
    source_e     = html.escape(source_raw)
    tier         = _source_tier(source_raw)
    t_color, t_weight = _TIER_STYLES.get(tier, _TIER_STYLES[2])
    ta           = _time_ago(str(row.get("published_at", "")))
    ta_e         = html.escape(ta)
    url          = str(row.get("url", "") or "")
    url_e        = html.escape(url)
    summary_raw  = str(row.get("summary", "") or "")
    regime_raw   = str(row.get("regime_interpretation", "") or "")
    research_raw = str(row.get("perplexity_research", "") or "")

    # ── Section 1: Header bar ────────────────────────────────────────────
    deal_size  = int(row.get("deal_size", 1))
    deal_badge = ""
    if cat == "M&A" and deal_size > 1:
        deal_label = _DEAL_LABELS.get(deal_size, "")
        deal_badge = (
            f'<span style="background:#3a2a0a;color:#ff8c00;'
            f'font-size:10px;padding:2px 8px;border-radius:10px;'
            f'font-weight:700;font-family:\'SF Mono\',monospace;'
            f'margin-left:4px;">{html.escape(deal_label)}</span>'
        )

    url_btn = ""
    if url:
        url_btn = (
            f'<a href="{url_e}" target="_blank" rel="noopener" style="'
            f'margin-left:auto;background:rgba(74,158,255,0.1);'
            f'border:1px solid rgba(74,158,255,0.3);color:#4a9eff;'
            f'font-size:11px;padding:4px 12px;border-radius:12px;'
            f'text-decoration:none;font-family:\'SF Mono\',monospace;'
            f'white-space:nowrap;">READ FULL ARTICLE →</a>'
        )

    cat_badge = (
        f'<span style="background:{cat_style["bg"]};color:{cat_style["color"]};'
        f'font-size:10px;padding:2px 10px;border-radius:10px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;letter-spacing:0.8px;'
        f'text-transform:uppercase;">{html.escape(cat)}</span>'
    )
    src_chip = (
        f'<span style="color:{t_color};font-weight:{t_weight};'
        f'font-size:11px;font-family:\'SF Mono\',monospace;">'
        f'{source_e}</span>'
    ) if source_e else ""
    time_chip = (
        f'<span style="color:#6e7681;font-size:11px;'
        f'font-family:\'SF Mono\',monospace;">{ta_e}</span>'
    ) if ta_e else ""
    sep = '<span style="color:#30363d;font-size:11px;">·</span>'

    header_parts = [cat_badge]
    if src_chip:
        header_parts += [sep, src_chip]
    if time_chip:
        header_parts += [sep, time_chip]
    if deal_badge:
        header_parts.append(deal_badge)
    if url_btn:
        header_parts.append(url_btn)

    st.markdown(
        '<div style="display:flex;align-items:center;gap:8px;'
        'flex-wrap:wrap;">'
        + "".join(header_parts)
        + "</div>",
        unsafe_allow_html=True,
    )

    # ── Section 2: Headline ──────────────────────────────────────────────
    st.markdown(
        f'<div style="color:#e6edf3;font-size:20px;font-weight:700;'
        f'line-height:1.35;margin:14px 0 0 0;'
        f'font-family:system-ui,-apple-system,sans-serif;">{headline_e}</div>',
        unsafe_allow_html=True,
    )

    # ── Section 3: Summary (optional) ────────────────────────────────────
    if summary_raw.strip():
        st.divider()
        summary_text = summary_raw
        if source_raw and summary_text.endswith(source_raw):
            summary_text = summary_text[: -len(source_raw)].strip()
        summary_e = html.escape(summary_text)
        st.markdown(
            f'<div style="border-left:3px solid {cat_style["color"]};'
            f'padding:2px 0 2px 12px;color:#8b949e;font-size:13px;'
            f'line-height:1.6;font-family:system-ui,-apple-system,sans-serif;">'
            f'{summary_e}</div>',
            unsafe_allow_html=True,
        )

    # ── Section 4: Significance ──────────────────────────────────────────
    st.divider()
    sig_verdict, svcol = _sig_verdict(sig)
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:12px;'
        f'margin-bottom:8px;">'
        f'<span style="color:#6e7681;font-size:11px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">'
        f'SIGNIFICANCE</span>'
        f'<span style="color:{sig_color};font-size:18px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;">{sig:.1f}'
        f'<span style="color:#30363d;font-size:12px;font-weight:600;'
        f'margin-left:3px;">/ 5.0</span></span>'
        f'<span style="background:{sig_color}22;color:{svcol};'
        f'border:1px solid {svcol}66;font-size:9px;font-weight:700;'
        f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
        f'padding:2px 8px;border-radius:8px;">{sig_verdict}</span>'
        f'</div>',
        unsafe_allow_html=True,
    )
    st.progress(min(max(sig / 5.0, 0.0), 1.0))

    score_fields = [
        ("MARKET",     "market_impact"),
        ("DEAL SIZE",  "deal_size"),
        ("SECTOR",     "sector_relevance"),
        ("TIMELINESS", "time_sensitivity"),
        ("REGIME",     "regime_relevance"),
    ]
    score_cols = st.columns(5)
    for col, (label, field) in zip(score_cols, score_fields):
        v             = int(row.get(field, 1))
        sc            = _score_color(v)
        verdict, vcol = _score_verdict(v)
        dots          = _sig_dots_html(float(v), vcol)
        with col:
            components.html(
                f'<div style="background:#0d1117;border:1px solid #21262d;'
                f'border-radius:6px;padding:6px 4px;text-align:center;'
                f'font-family:system-ui,-apple-system,sans-serif;">'
                f'<div style="color:#6e7681;font-size:9px;font-weight:700;'
                f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
                f'margin-bottom:3px;">{label}</div>'
                f'<div style="color:{sc};font-size:18px;font-weight:700;'
                f'font-family:\'SF Mono\',monospace;line-height:1;">{v}'
                f'<span style="color:#30363d;font-size:9px;font-weight:600;'
                f'margin-left:2px;">/5</span></div>'
                f'<div style="color:{vcol};font-size:9px;font-weight:700;'
                f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
                f'margin-top:3px;">{verdict}</div>'
                f'<div style="margin-top:4px;line-height:1;">{dots}</div>'
                f'</div>',
                height=78,
            )

    # ── Section 5: Regime interpretation (optional) ──────────────────────
    if regime_raw.strip():
        st.divider()
        regime_e = html.escape(regime_raw)
        st.markdown(
            f'<div style="color:#2ecc71;font-size:10px;font-weight:700;'
            f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
            f'margin-bottom:6px;">REGIME READ</div>'
            f'<div style="color:#8b949e;font-size:12px;line-height:1.55;'
            f'font-style:italic;'
            f'font-family:system-ui,-apple-system,sans-serif;">'
            f'{regime_e}</div>',
            unsafe_allow_html=True,
        )

    # ── Section 6: Perplexity research (optional, supplementary) ────────
    if research_raw.strip():
        st.divider()
        body_text, _, sources_text = research_raw.partition("Sources:")
        body_e = html.escape(body_text.strip())
        src_html = ""
        if sources_text.strip():
            srcs = [ln.strip(" -\t") for ln in sources_text.splitlines()
                    if ln.strip(" -\t")]
            if srcs:
                link_items = "".join(
                    f'<a href="{html.escape(u)}" target="_blank" rel="noopener" '
                    f'style="color:#2ecc71;text-decoration:none;'
                    f'font-size:10px;display:block;overflow:hidden;'
                    f'text-overflow:ellipsis;white-space:nowrap;">'
                    f'{html.escape(u)}</a>'
                    for u in srcs[:5]
                )
                src_html = (
                    f'<div style="margin-top:8px;padding-top:8px;'
                    f'border-top:1px solid #21262d;color:#6e7681;'
                    f'font-size:9px;font-weight:700;letter-spacing:1px;'
                    f'font-family:\'SF Mono\',monospace;margin-bottom:4px;">'
                    f'SOURCES</div><div>{link_items}</div>'
                )
        st.markdown(
            f'<div style="color:#2ecc71;font-size:10px;font-weight:700;'
            f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
            f'margin-bottom:6px;">◆ PERPLEXITY RESEARCH</div>'
            f'<div style="color:#8b949e;font-size:12px;line-height:1.55;'
            f'white-space:pre-wrap;'
            f'font-family:system-ui,-apple-system,sans-serif;">{body_e}</div>'
            f'{src_html}',
            unsafe_allow_html=True,
        )


# ── Empty state ───────────────────────────────────────────────────────────────

def _empty_state(title: str, subtitle: str) -> str:
    return (
        f'<div style="background:{_CARD_BG};border:1px solid {_BORDER};'
        f'border-radius:8px;padding:40px;text-align:center;margin:20px 0;'
        f'font-family:system-ui,-apple-system,sans-serif;">'
        f'<div style="font-size:32px;margin-bottom:12px;">&#128225;</div>'
        f'<div style="color:{_TEXT};font-size:14px;margin-bottom:8px;">'
        f'{html.escape(title)}</div>'
        f'<div style="color:{_MUTED};font-size:12px;">{html.escape(subtitle)}</div>'
        f'</div>'
    )


# ── Zone 4: Macro Events Calendar ────────────────────────────────────────────

def _render_calendar_section() -> None:
    calendar = load_event_calendar()
    upcoming = get_upcoming_events(calendar, days=30)

    now_utc = datetime.now(timezone.utc)

    # Header — margin-top:20px added per Phase 11 spec
    cal_header = (
        f'<div style="'
        f'display:flex;align-items:center;gap:12px;'
        f'padding:20px 0 14px 0;'
        f'border-top:1px solid #30363d;'
        f'margin-top:20px;'
        f'font-family:\'SF Mono\',\'Fira Code\',monospace;">'
        f'<div style="width:3px;height:22px;'
        f'background:linear-gradient(180deg,#2ecc71,#4a9eff);'
        f'border-radius:2px;flex-shrink:0;"></div>'
        f'<span style="color:#e6edf3;font-size:13px;font-weight:700;'
        f'letter-spacing:2px;">UPCOMING MACRO EVENTS</span>'
        f'<span style="color:#6e7681;font-size:11px;">&#183; next 30 days</span>'
        f'<div style="flex:1;height:1px;'
        f'background:linear-gradient(90deg,#30363d,transparent);'
        f'margin-left:8px;"></div>'
        f'</div>'
    )

    if upcoming.empty:
        empty_html = (
            cal_header
            + f'<div style="background:{_CARD_BG};border:1px solid {_BORDER};'
            f'border-radius:8px;padding:40px;text-align:center;margin:20px 0;">'
            f'<div style="font-size:32px;margin-bottom:12px;">&#128197;</div>'
            f'<div style="color:{_TEXT};font-size:14px;">No upcoming events in the next 30 days</div>'
            f'</div>'
        )
        components.html(empty_html, height=200)
        return

    imp_colors = {
        "high":   _ACCENT_RED,
        "medium": _ACCENT_YELLOW,
        "low":    _ACCENT_GREEN,
    }

    col_grid = "grid-template-columns:110px 1fr 90px 90px"
    table_header = (
        f'<div style="display:grid;{col_grid};'
        f'padding:6px 12px;border-bottom:1px solid #30363d;margin-bottom:2px;">'
        f'<span style="color:#4a9eff;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">DATE</span>'
        f'<span style="color:#4a9eff;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">EVENT</span>'
        f'<span style="color:#4a9eff;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">PRIORITY</span>'
        f'<span style="color:#4a9eff;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">SOURCE</span>'
        f'</div>'
    )

    rows_html = ""
    for i, (_, row) in enumerate(upcoming.iterrows()):
        bg        = _CARD_BG if i % 2 == 0 else _BG
        imp       = str(row.get("importance", "")).lower()
        imp_color = imp_colors.get(imp, _MUTED)
        imp_str   = html.escape(str(row.get("importance", "")).upper())
        event_str = html.escape(str(row.get("event_name", "")))
        src_str   = html.escape(str(row.get("source", "")))

        try:
            evt_dt     = pd.to_datetime(row.get("event_datetime"), utc=True, errors="coerce")
            date_label = evt_dt.strftime("%b %-d, %Y")
            delta_days = (evt_dt.normalize() - pd.Timestamp(now_utc).normalize()).days
            if delta_days == 0:
                countdown = (
                    f'<span style="color:#ff4444;font-size:10px;'
                    f'font-family:\'SF Mono\',monospace;font-weight:700;'
                    f'margin-left:6px;">TODAY</span>'
                )
            elif 0 < delta_days <= 7:
                countdown = (
                    f'<span style="color:#ff8c00;font-size:10px;'
                    f'font-family:\'SF Mono\',monospace;'
                    f'margin-left:6px;">+{delta_days}d</span>'
                )
            else:
                countdown = ""
        except Exception:
            date_label = str(row.get("event_datetime", ""))
            countdown  = ""

        date_cell = (
            f'<div style="display:flex;align-items:center;">'
            f'<span style="color:#8b949e;font-size:12px;'
            f'font-family:\'SF Mono\',monospace;">{html.escape(date_label)}</span>'
            f'{countdown}'
            f'</div>'
        )

        rows_html += (
            f'<div style="display:grid;{col_grid};'
            f'padding:10px 12px;background:{bg};'
            f'border-bottom:1px solid #21262d;align-items:center;">'
            f'{date_cell}'
            f'<span style="color:#e6edf3;font-size:13px;font-weight:500;">'
            f'{event_str}</span>'
            f'<span style="color:{imp_color};font-size:11px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;letter-spacing:0.5px;'
            f'text-transform:uppercase;">&#9679;&nbsp;{imp_str}</span>'
            f'<span style="color:#6e7681;font-size:11px;">{src_str}</span>'
            f'</div>'
        )

    n = len(upcoming)
    calendar_html = (
        cal_header
        + f'<div style="border:1px solid #30363d;border-radius:6px;overflow:hidden;">'
        + table_header
        + rows_html
        + "</div>"
    )
    components.html(calendar_html, height=50 + 36 + n * 42 + 60, scrolling=False)


# ── Main render ───────────────────────────────────────────────────────────────

def render_events_tab(latest_signals: pd.DataFrame | None = None) -> None:
    """Main entry point — call from app.py inside the Events & Intelligence tab."""
    from utils.tab_context import register_tab_context
    register_tab_context("Events & Intelligence", {
        "shows": "ranked news headlines (5-dimension significance), regime interpretations, Perplexity-cited research",
        "key_tools": ["get_recent_headlines"],
        "tables": ["news_feed"],
    })

    # ── Session state defaults ────────────────────────────────────────────────
    if "ei_cat" not in st.session_state:
        st.session_state["ei_cat"] = "ALL"
    if "ei_time" not in st.session_state:
        st.session_state["ei_time"] = "24H"
    if "ei_selected" not in st.session_state:
        st.session_state["ei_selected"] = None

    # Strip any lingering ?ei_selected= param left over from prior sessions
    # that used query-param-based click detection. Click detection now lives
    # entirely in session_state; the URL param would only pollute the parent
    # URL for any child iframe on the page.
    if "ei_selected" in st.query_params:
        try:
            del st.query_params["ei_selected"]
        except Exception:
            pass

    # ── Inject CSS ────────────────────────────────────────────────────────────
    st.markdown(_FILTER_CSS, unsafe_allow_html=True)

    # ── Load data ─────────────────────────────────────────────────────────────
    time_map  = {"24H": 24, "48H": 48, "7D": 168}
    cat_query = (
        "GEOPOLITICAL"
        if st.session_state["ei_cat"] == "GEO"
        else st.session_state["ei_cat"]
    )
    df = load_news(
        str(DB_PATH),
        time_map[st.session_state["ei_time"]],
        cat_query,
    )

    # Resolve the current macro regime once per render — powers per-headline tags.
    current_regime = _current_regime(str(DB_PATH))

    # ── Zone 1: Summary bar ───────────────────────────────────────────────────
    render_summary_bar(df)

    # ── Zone 2: Filter bar ────────────────────────────────────────────────────
    render_filter_bar()

    # ── Zone 3: Two-column feed ───────────────────────────────────────────────
    if df.empty:
        st.markdown(
            _empty_state(
                "No headlines loaded yet",
                "Run the Refresh News Feed step or wait for the scheduled workflow "
                "to populate the news_feed table.",
            ),
            unsafe_allow_html=True,
        )
    else:
        # Auto-select first item if nothing selected
        if st.session_state["ei_selected"] is None:
            st.session_state["ei_selected"] = int(df.iloc[0]["id"])

        left, right = st.columns([2, 3], vertical_alignment="top")
        with left:
            render_headline_list(df, current_regime=current_regime)
        with right:
            selected = df[df["id"] == st.session_state["ei_selected"]]
            if len(selected) > 0:
                render_detail_card(selected.iloc[0])
            else:
                # Fallback: selected id not in current filter — show first item
                st.session_state["ei_selected"] = int(df.iloc[0]["id"])
                render_detail_card(df.iloc[0])

    # ── Zone 4: Calendar ──────────────────────────────────────────────────────
    _render_calendar_section()
