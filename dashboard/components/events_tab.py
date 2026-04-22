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
/* Feed row (left: list iframe, right: detail iframe) — align items to top
   so the right column sizes to the detail card rather than stretching to
   match the 600px list. Scoped via :has(iframe) so it matches the 2+3
   column block on this tab. */
div[data-testid="stHorizontalBlock"]:has(iframe) {
    align-items: flex-start !important;
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
                              overall_significance, regime_interpretation, ticker
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

# Embedded CSS for the single-iframe headline list (Problem 1 fix — no
# Streamlit widget artifacts, no overlay hacks). All click detection
# happens via anchor tags with target="_top" that update the parent's
# query params; render_events_tab() syncs ei_selected back into session.
_LIST_HTML_CSS = """
* { box-sizing: border-box; }
html, body {
    margin: 0;
    padding: 0;
    background: #0d1117;
    color: #e6edf3;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow-x: hidden;
}
.ei-list { display: flex; flex-direction: column; }
.ei-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    text-decoration: none;
    color: inherit;
    border-left: 4px solid transparent;
    border-bottom: 1px solid #21262d;
    border-radius: 0 4px 4px 0;
    height: 96px;
    box-sizing: border-box;
    overflow: hidden;
    cursor: pointer;
    transition: background 120ms ease, border-left-color 120ms ease;
}
.ei-row:focus { outline: none; }
.ei-row.ei-unselected:hover {
    background: rgba(74,158,255,0.08);
    border-left-color: rgba(74,158,255,0.45);
}
.ei-row.ei-selected {
    background: rgba(74,158,255,0.22);
    border-left-color: #4a9eff;
    box-shadow: inset 0 0 0 1px rgba(74,158,255,0.5),
                0 0 14px rgba(74,158,255,0.2);
}
.ei-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-top: 7px;
    flex-shrink: 0;
}
.ei-content { flex: 1; min-width: 0; }
.ei-headline {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 4px;
    color: #e6edf3;
}
.ei-selected .ei-headline {
    color: #4a9eff;
    font-weight: 700;
}
.ei-caret {
    display: inline-block;
    color: #4a9eff;
    font-weight: 900;
    font-size: 18px;
    margin-right: 6px;
    line-height: 1;
    vertical-align: -1px;
}
.ei-meta {
    color: #6e7681;
    font-size: 10px;
    font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    letter-spacing: 0.3px;
    margin-bottom: 2px;
}
.ei-selected .ei-meta { color: #c9d1d9; }
.ei-tag {
    color: #6e7681;
    font-size: 10px;
    font-style: italic;
    letter-spacing: 0.2px;
}
.ei-selected .ei-tag { color: #8ab4f8; }
.ei-badge {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 8px;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
    font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    align-self: flex-start;
}
"""


def render_headline_list(df: pd.DataFrame, current_regime: str = "Goldilocks") -> None:
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

    # Build every row as a <a target="_top"> anchor in one HTML blob.
    # Click = native browser navigation to ?ei_selected=<id>. No buttons,
    # no overlays, no Streamlit widget artifacts.
    rows_parts: list[str] = []
    for _, item in df.iterrows():
        sig        = float(item.get("overall_significance", 1.0))
        sig_color  = _accent_color(sig)
        cat        = str(item.get("category", ""))
        cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
        cat_short  = _CAT_SHORT.get(cat, cat[:3] if cat else "—")
        item_id    = int(item["id"])
        is_sel     = st.session_state["ei_selected"] == item_id
        src_raw    = str(item.get("source", ""))
        src_cfg    = _source_badge_style(src_raw)

        row_cls      = "ei-row ei-selected" if is_sel else "ei-row ei-unselected"
        caret        = '<span class="ei-caret">▸</span>' if is_sel else ""
        headline_e   = html.escape(str(item.get("headline", "")))
        ta           = html.escape(_time_ago(str(item.get("published_at", ""))))
        source_e     = html.escape(src_raw)
        regime_tag_e = html.escape(_regime_tag(cat, current_regime))

        rows_parts.append(
            f'<a class="{row_cls}" href="?ei_selected={item_id}" target="_top" '
            f'data-id="{item_id}" '
            f'style="--sig:{sig_color};">'
            f'<span class="ei-dot" style="background:{sig_color};"></span>'
            f'<span class="ei-content">'
            f'<span class="ei-headline">{caret}{headline_e}</span>'
            f'<span class="ei-meta" style="display:block;">'
            f'{ta} · <span style="color:{src_cfg["color"]};">{source_e}</span>'
            f'</span>'
            f'<span class="ei-tag" style="display:block;">{regime_tag_e}</span>'
            f'</span>'
            f'<span class="ei-badge" '
            f'style="background:{cat_style["bg"]};color:{cat_style["color"]};">'
            f'{cat_short}</span>'
            f'</a>'
        )

    # Inline script — belt-and-suspenders click handler. The anchor's
    # native target="_top" handles most browsers, but srcdoc iframe base
    # URI can resolve relative hrefs against about:srcdoc; the explicit
    # window.top.location.search assignment guarantees navigation.
    click_script = """
    <script>
    (function() {
        document.querySelectorAll('a.ei-row').forEach(function(el) {
            el.addEventListener('click', function(e) {
                var id = this.getAttribute('data-id');
                if (!id) return;
                e.preventDefault();
                try {
                    window.top.location.search = '?ei_selected=' + id;
                } catch (err) {
                    window.location.href = '?ei_selected=' + id;
                }
            });
        });
    })();
    </script>
    """

    list_html = (
        f'<style>{_LIST_HTML_CSS}</style>'
        f'<div class="ei-list">{"".join(rows_parts)}</div>'
        f'{click_script}'
    )
    components.html(list_html, height=600, scrolling=True)


# ── Zone 3 right: Detail Card ─────────────────────────────────────────────────

def render_detail_card(row: pd.Series) -> None:
    cat        = str(row.get("category", ""))
    cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
    sig        = float(row.get("overall_significance", 1.0))
    sig_color  = _accent_color(sig)
    accent     = sig_color

    headline_e  = html.escape(str(row.get("headline", "")))
    source_raw  = str(row.get("source", "") or "")
    source_e    = html.escape(source_raw)
    source_cfg  = _source_badge_style(source_raw)
    ta          = _time_ago(str(row.get("published_at", "")))
    url         = str(row.get("url", "") or "")
    url_e       = html.escape(url)
    summary_raw = str(row.get("summary", "") or "")
    regime_raw  = str(row.get("regime_interpretation", "") or "")

    # Deal size badge (M&A only, deal_size > 1)
    deal_size  = int(row.get("deal_size", 1))
    deal_badge = ""
    if cat == "M&A" and deal_size > 1:
        deal_label = _DEAL_LABELS.get(deal_size, "")
        deal_badge = (
            f'<span style="background:#3a2a0a;color:#ff8c00;'
            f'font-size:10px;padding:3px 8px;border-radius:10px;'
            f'font-weight:700;font-family:\'SF Mono\',monospace;">'
            f'{html.escape(deal_label)}</span>'
        )

    # Read article link
    url_btn = ""
    if url:
        url_btn = (
            f'<a href="{url_e}" target="_blank" style="'
            f'margin-left:auto;background:rgba(74,158,255,0.1);'
            f'border:1px solid rgba(74,158,255,0.3);color:#4a9eff;'
            f'font-size:11px;padding:4px 12px;border-radius:12px;'
            f'text-decoration:none;font-family:\'SF Mono\',monospace;'
            f'white-space:nowrap;">READ FULL ARTICLE →</a>'
        )

    # Colored source chip (FIX 6 — NEWS_SOURCES-driven)
    src_chip = (
        f'<span style="background:{source_cfg["bg"]};'
        f'color:{source_cfg["color"]};font-size:10px;padding:2px 8px;'
        f'border-radius:8px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;letter-spacing:0.3px;">'
        f'{source_e}</span>'
    )

    # Summary block — strip trailing source name if present
    summary_block = ""
    if summary_raw.strip():
        summary_text = summary_raw
        if source_raw and summary_text.endswith(source_raw):
            summary_text = summary_text[: -len(source_raw)].strip()
        preview = html.escape(summary_text[:300])
        if len(summary_text) > 300:
            preview += "..."
        summary_block = (
            f'<div style="color:#8b949e;font-size:13px;line-height:1.6;'
            f'margin-bottom:14px;padding-bottom:14px;'
            f'border-bottom:1px solid #21262d;">{preview}</div>'
        )

    # 5-cell score grid — each cell stacks number + verdict + / 5
    score_fields = [
        ("MARKET",     "market_impact"),
        ("DEAL SIZE",  "deal_size"),
        ("SECTOR",     "sector_relevance"),
        ("TIMELINESS", "time_sensitivity"),
        ("REGIME",     "regime_relevance"),
    ]
    score_cells = ""
    for label, field in score_fields:
        v             = int(row.get(field, 1))
        sc            = _score_color(v)
        verdict, vcol = _score_verdict(v)
        dots          = _sig_dots_html(float(v), vcol)
        score_cells += (
            f'<div style="background:#0d1117;border:1px solid #21262d;'
            f'border-radius:6px;padding:8px 6px;text-align:center;">'
            f'<div style="color:#6e7681;font-size:9px;font-weight:700;'
            f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
            f'margin-bottom:4px;">{label}</div>'
            f'<div style="color:{sc};font-size:20px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;line-height:1;">{v}'
            f'<span style="color:#30363d;font-size:10px;font-weight:600;'
            f'margin-left:3px;">/ 5</span></div>'
            f'<div style="color:{vcol};font-size:9px;font-weight:700;'
            f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
            f'margin-top:4px;">{verdict}</div>'
            f'<div style="margin-top:5px;line-height:1;">{dots}</div>'
            f'</div>'
        )

    # Significance bar — labeled "SIGNIFICANCE SCORE" with verdict chip
    bar_mb             = "14" if regime_raw.strip() else "0"
    sig_pct            = f"{sig / 5 * 100:.1f}"
    sig_verdict, svcol = _sig_verdict(sig)
    sig_bar = (
        f'<div style="margin-bottom:{bar_mb}px;">'
        # Header row: label + sub-label
        f'<div style="margin-bottom:6px;">'
        f'<div style="color:#c9d1d9;font-size:11px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;">'
        f'SIGNIFICANCE SCORE</div>'
        f'<div style="color:#6e7681;font-size:10px;'
        f'font-family:system-ui,-apple-system,sans-serif;'
        f'font-style:italic;margin-top:1px;">'
        f'measures market, deal, and regime impact (1–5 scale)</div>'
        f'</div>'
        # Score line: number + verdict chip
        f'<div style="display:flex;align-items:center;gap:8px;'
        f'margin-bottom:5px;">'
        f'<span style="color:{sig_color};font-size:14px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;">{sig:.1f} / 5.0</span>'
        f'<span style="background:{sig_color}22;color:{svcol};'
        f'border:1px solid {svcol}66;'
        f'font-size:9px;font-weight:700;letter-spacing:1px;'
        f'font-family:\'SF Mono\',monospace;'
        f'padding:2px 8px;border-radius:8px;">{sig_verdict}</span>'
        f'</div>'
        # Progress bar
        f'<div style="height:4px;background:#21262d;'
        f'border-radius:2px;overflow:hidden;">'
        f'<div style="height:100%;width:{sig_pct}%;'
        f'background:linear-gradient(90deg,{sig_color}88,{sig_color});'
        f'border-radius:2px;"></div>'
        f'</div>'
        f'</div>'
    )

    # AI regime interpretation block
    regime_block = ""
    if regime_raw.strip():
        regime_e     = html.escape(regime_raw)
        regime_block = (
            f'<div style="background:#0d1117;border:1px solid #21262d;'
            f'border-left:3px solid #7c3aed;border-radius:0 6px 6px 0;'
            f'padding:10px 14px;display:flex;align-items:flex-start;gap:10px;">'
            f'<div>'
            f'<div style="color:#7c3aed;font-size:9px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;letter-spacing:1px;'
            f'margin-bottom:3px;">◆ AI REGIME ANALYSIS</div>'
            f'<div style="color:#8b949e;font-size:12px;line-height:1.5;'
            f'font-style:italic;">{regime_e}</div>'
            f'</div></div>'
        )

    # Fixed 480px height — dynamic calc kept leaving blank space under
    # short cards. 480 fits the full chrome + badges + headline + score
    # grid + significance bar comfortably; a long summary or AI block
    # clips slightly, which is a better trade-off than visible padding.
    card_height = 480

    card_html = (
        f'<div style="background:#161b22;border:1px solid #30363d;'
        f'border-top:3px solid {accent};border-radius:0 8px 8px 8px;'
        f'padding:18px 20px;font-family:system-ui,-apple-system,sans-serif;'
        f'box-sizing:border-box;">'
        # Badges row — colored source chip (FIX 6)
        f'<div style="display:flex;align-items:center;gap:8px;'
        f'margin-bottom:12px;flex-wrap:wrap;">'
        f'<span style="background:{cat_style["bg"]};color:{cat_style["color"]};'
        f'font-size:10px;padding:3px 10px;border-radius:10px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;letter-spacing:0.5px;">'
        f'{html.escape(cat)}</span>'
        f'{src_chip}'
        f'<span style="color:#6e7681;font-size:11px;">·</span>'
        f'<span style="color:#6e7681;font-size:11px;">{ta}</span>'
        f'{deal_badge}'
        f'{url_btn}'
        f'</div>'
        # Headline
        f'<div style="color:#e6edf3;font-size:16px;font-weight:600;'
        f'line-height:1.4;margin-bottom:12px;">{headline_e}</div>'
        # Summary
        + summary_block
        # Score grid
        + f'<div style="display:grid;grid-template-columns:repeat(5,1fr);'
        f'gap:8px;margin-bottom:14px;">{score_cells}</div>'
        # Significance bar
        + sig_bar
        # AI block
        + regime_block
        + '</div>'
    )

    components.html(card_html, height=card_height, scrolling=False)


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

    # ── Session state defaults ────────────────────────────────────────────────
    if "ei_cat" not in st.session_state:
        st.session_state["ei_cat"] = "ALL"
    if "ei_time" not in st.session_state:
        st.session_state["ei_time"] = "24H"
    if "ei_selected" not in st.session_state:
        st.session_state["ei_selected"] = None

    # ── Sync query param → session (headline list anchor clicks) ──────────────
    # Each headline renders as <a href="?ei_selected=<id>" target="_top">.
    # Clicking triggers a top-level navigation with that param; read it here
    # on the subsequent run so the selection survives the reload.
    qp_selected = st.query_params.get("ei_selected")
    if qp_selected is not None:
        try:
            st.session_state["ei_selected"] = int(qp_selected)
        except (TypeError, ValueError):
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

        left, right = st.columns([2, 3])
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
