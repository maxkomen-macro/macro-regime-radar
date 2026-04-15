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

# ── Filter + row button CSS ───────────────────────────────────────────────────
_FILTER_CSS = """<style>
/* Filter bar pill buttons — horizontal block */
div[data-testid="stHorizontalBlock"] > div > div > div > button {
    background: transparent !important;
    border: 1px solid #30363d !important;
    color: #6e7681 !important;
    border-radius: 16px !important;
    padding: 0px 14px !important;
    font-size: 11px !important;
    font-family: 'SF Mono', 'Fira Code', monospace !important;
    letter-spacing: 0.8px !important;
    height: 28px !important;
    min-height: 28px !important;
    line-height: 28px !important;
    white-space: nowrap !important;
    display: inline-flex !important;
    align-items: center !important;
}
div[data-testid="stHorizontalBlock"] > div > div > div > button:hover {
    border-color: #4a9eff !important;
    color: #4a9eff !important;
    background: rgba(74,158,255,0.08) !important;
}
div[data-testid="stHorizontalBlock"] > div > div > div > button:focus {
    border-color: #4a9eff !important;
    color: #4a9eff !important;
    box-shadow: 0 0 0 2px rgba(74,158,255,0.2) !important;
    background: rgba(74,158,255,0.08) !important;
}
/* Tighten column padding in filter row */
div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
    padding: 0 3px !important;
}
/* Headline row click buttons — collapse to zero height */
section[data-testid="stMain"] div[data-testid="stVerticalBlock"]
    button[kind="secondary"] {
    height: 0px !important;
    min-height: 0px !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    position: absolute !important;
    opacity: 0 !important;
}
/* Balanced column heights — targets only the 2-column news feed row */
div[data-testid="stHorizontalBlock"]:has(> div[data-testid="stColumn"]:nth-child(2):last-child) > div[data-testid="stColumn"] {
    min-height: 600px;
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
    """Five coloured significance dots as HTML spans."""
    filled = min(max(int(round(score)), 0), 5)
    parts = []
    for i in range(5):
        color = accent if i < filled else _BORDER
        parts.append(
            f'<span style="color:{color};font-size:12px;line-height:1;">●</span>'
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

def render_filter_bar() -> None:
    cat_labels  = ["ALL", "MACRO", "M&A", "EARN", "GEO", "SECTOR"]
    time_labels = ["24H", "48H", "7D"]

    # cols layout: 6 category + 0.3 divider + 3 time + 4 spacer
    cols = st.columns([1, 1, 1, 1, 1, 1, 0.3, 1, 1, 1, 4])

    for i, label in enumerate(cat_labels):
        stored = _CAT_DISPLAY_MAP.get(label, label)
        is_sel = st.session_state["ei_cat"] == stored
        btn_label = f"● {label}" if is_sel else label
        with cols[i]:
            if st.button(btn_label, key=f"ei_cat_btn_{label}", type="primary"):
                st.session_state["ei_cat"] = stored
                st.rerun()

    # col 6 is empty divider

    for j, t in enumerate(time_labels):
        is_sel = st.session_state["ei_time"] == t
        btn_label = f"● {t}" if is_sel else t
        with cols[7 + j]:
            if st.button(btn_label, key=f"ei_time_btn_{t}", type="primary"):
                st.session_state["ei_time"] = t
                st.rerun()

    st.markdown(
        '<div style="height:1px;background:#21262d;margin:8px 0 12px 0;"></div>',
        unsafe_allow_html=True,
    )


# ── Zone 3 left: Headline List ────────────────────────────────────────────────

def render_headline_list(df: pd.DataFrame) -> None:
    n = len(df)
    st.markdown(
        f'<div style="color:#8b949e;font-size:10px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',monospace;'
        f'padding:0 0 8px 0;border-bottom:1px solid #21262d;">'
        f'HEADLINES <span style="color:#30363d;">({n})</span></div>',
        unsafe_allow_html=True,
    )

    with st.container(height=600):
        for _, item in df.iterrows():
            sig        = float(item.get("overall_significance", 1.0))
            sig_color  = _accent_color(sig)
            cat        = str(item.get("category", ""))
            cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
            cat_short  = _CAT_SHORT.get(cat, cat[:3] if cat else "—")
            item_id    = int(item["id"])
            is_sel     = st.session_state["ei_selected"] == item_id
            bg             = "#1c2128" if is_sel else "transparent"
            left_bdr       = _ACCENT if is_sel else "transparent"
            headline_color = "#ffffff" if is_sel else "#e6edf3"
            headline_e     = html.escape(str(item.get("headline", "")))
            ta         = _time_ago(str(item.get("published_at", "")))
            source_e   = html.escape(str(item.get("source", "")))

            row_html = (
                f'<div style="display:flex;align-items:flex-start;gap:8px;'
                f'padding:8px 10px;background:{bg};'
                f'border-left:3px solid {left_bdr};'
                f'border-radius:0 4px 4px 0;margin-bottom:2px;'
                f'border-bottom:1px solid #21262d;">'
                f'<div style="width:6px;height:6px;border-radius:50%;'
                f'background:{sig_color};margin-top:5px;flex-shrink:0;"></div>'
                f'<div style="flex:1;min-width:0;">'
                f'<div style="color:{headline_color};font-size:14px;font-weight:500;line-height:1.35;'
                f'display:-webkit-box;-webkit-line-clamp:2;'
                f'-webkit-box-orient:vertical;overflow:hidden;'
                f'margin-bottom:3px;">{headline_e}</div>'
                f'<div style="color:#6e7681;font-size:11px;'
                f'font-family:\'SF Mono\',monospace;">'
                f'{ta} · {source_e}</div>'
                f'</div>'
                f'<span style="background:{cat_style["bg"]};color:{cat_style["color"]};'
                f'font-size:9px;padding:2px 6px;border-radius:8px;font-weight:700;'
                f'white-space:nowrap;flex-shrink:0;'
                f'font-family:\'SF Mono\',monospace;">{cat_short}</span>'
                f'</div>'
            )

            st.markdown(row_html, unsafe_allow_html=True)
            if st.button(" ", key=f"hl_{item_id}", use_container_width=True):
                st.session_state["ei_selected"] = item_id
                st.rerun()


# ── Zone 3 right: Detail Card ─────────────────────────────────────────────────

def render_detail_card(row: pd.Series) -> None:
    cat        = str(row.get("category", ""))
    cat_style  = _CAT_STYLES.get(cat, _CAT_DEFAULT)
    sig        = float(row.get("overall_significance", 1.0))
    sig_color  = _accent_color(sig)
    accent     = sig_color

    headline_e  = html.escape(str(row.get("headline", "")))
    source_e    = html.escape(str(row.get("source", "")))
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

    # Summary block — strip trailing source name if present
    summary_block = ""
    source_raw = str(row.get("source", "") or "")
    if summary_raw.strip():
        summary_text = summary_raw
        if source_raw and summary_text.endswith(source_raw):
            summary_text = summary_text[: -len(source_raw)].strip()
        preview = html.escape(summary_text[:300])
        if len(summary_text) > 300:
            preview += "..."
        summary_block = (
            f'<div style="color:#8b949e;font-size:13px;line-height:1.6;'
            f'margin-bottom:16px;padding-bottom:16px;'
            f'border-bottom:1px solid #21262d;">{preview}</div>'
        )

    # 5-cell score grid
    score_fields = [
        ("MARKET",     "market_impact"),
        ("DEAL SIZE",  "deal_size"),
        ("SECTOR",     "sector_relevance"),
        ("TIMELINESS", "time_sensitivity"),
        ("REGIME",     "regime_relevance"),
    ]
    score_cells = ""
    for label, field in score_fields:
        v    = int(row.get(field, 1))
        sc   = _score_color(v)
        dots = _sig_dots_html(float(v), sc)
        score_cells += (
            f'<div style="background:#0d1117;border:1px solid #21262d;'
            f'border-radius:6px;padding:8px;text-align:center;">'
            f'<div style="color:#6e7681;font-size:9px;font-weight:700;'
            f'letter-spacing:1px;font-family:\'SF Mono\',monospace;'
            f'margin-bottom:4px;">{label}</div>'
            f'<div style="color:{sc};font-size:18px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;">{v}</div>'
            f'<div style="display:flex;justify-content:center;gap:2px;margin-top:3px;">'
            f'{dots}</div>'
            f'</div>'
        )

    # Significance bar
    bar_mb    = "16" if regime_raw.strip() else "0"
    sig_pct   = f"{sig / 5 * 100:.1f}"
    sig_bar   = (
        f'<div style="margin-bottom:{bar_mb}px;">'
        f'<div style="display:flex;justify-content:space-between;margin-bottom:4px;">'
        f'<span style="color:#6e7681;font-size:10px;'
        f'font-family:\'SF Mono\',monospace;letter-spacing:1px;">'
        f'OVERALL SIGNIFICANCE</span>'
        f'<span style="color:{sig_color};font-size:12px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;">{sig:.1f} / 5.0</span>'
        f'</div>'
        f'<div style="height:4px;background:#21262d;border-radius:2px;overflow:hidden;">'
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

    card_height = 300 + (80 if summary_raw.strip() else 0) + (50 if regime_raw.strip() else 0)

    card_html = (
        f'<div style="background:#161b22;border:1px solid #30363d;'
        f'border-top:3px solid {accent};border-radius:0 8px 8px 8px;'
        f'padding:20px;font-family:system-ui,-apple-system,sans-serif;'
        f'box-sizing:border-box;">'
        # Badges row
        f'<div style="display:flex;align-items:center;gap:8px;'
        f'margin-bottom:14px;flex-wrap:wrap;">'
        f'<span style="background:{cat_style["bg"]};color:{cat_style["color"]};'
        f'font-size:10px;padding:3px 10px;border-radius:10px;font-weight:700;'
        f'font-family:\'SF Mono\',monospace;letter-spacing:0.5px;">'
        f'{html.escape(cat)}</span>'
        f'<span style="color:#6e7681;font-size:11px;">{source_e}</span>'
        f'<span style="color:#6e7681;font-size:11px;">·</span>'
        f'<span style="color:#6e7681;font-size:11px;">{ta}</span>'
        f'{deal_badge}'
        f'{url_btn}'
        f'</div>'
        # Headline
        f'<div style="color:#e6edf3;font-size:16px;font-weight:600;'
        f'line-height:1.4;margin-bottom:14px;">{headline_e}</div>'
        # Summary
        + summary_block
        # Score grid
        + f'<div style="display:grid;grid-template-columns:repeat(5,1fr);'
        f'gap:8px;margin-bottom:16px;">{score_cells}</div>'
        # Significance bar
        + sig_bar
        # AI block
        + regime_block
        + '</div>'
    )

    components.html(card_html, height=card_height)


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
            render_headline_list(df)
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
