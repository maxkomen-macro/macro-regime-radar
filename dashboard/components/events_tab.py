"""
dashboard/components/events_tab.py — Events & Intelligence tab (Phase 11).
Bloomberg-terminal aesthetic — full design overhaul.

Sections:
  1) Header Bar       — headline count, high-impact count, last-updated
  2) Filter Bar       — category pills + time/sig pills
  3) Tier Headers     — glow dot + gradient trailing line
  4) News Cards       — tiered, per-card dynamic height
  5) Other Expander   — collapsed, capped at 20 cards
  6) Calendar Section — upcoming macro events with countdown badges
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
_BG             = "#0d1117"
_CARD_BG        = "#161b22"
_BORDER         = "#30363d"
_BORDER_SUBTLE  = "#21262d"
_TEXT           = "#e6edf3"
_MUTED          = "#8b949e"
_TEXT_MUTED     = "#6e7681"
_ACCENT         = "#4a9eff"
_ACCENT_GREEN   = "#2ecc71"
_ACCENT_ORANGE  = "#ff8c00"
_ACCENT_RED     = "#ff4444"
_ACCENT_YELLOW  = "#ffd700"
_ACCENT_PURPLE  = "#7c3aed"
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
    "GEO":      "GEOPOLITICAL",
    "SECTOR":   "SECTOR",
}

# ── Pill button CSS ───────────────────────────────────────────────────────────
_PILL_CSS = """<style>
div[data-testid="stHorizontalBlock"] > div > div > div > button {
    background: transparent !important;
    border: 1px solid #30363d !important;
    color: #8b949e !important;
    border-radius: 20px !important;
    padding: 3px 14px !important;
    font-size: 11px !important;
    font-family: 'SF Mono', 'Fira Code', monospace !important;
    letter-spacing: 0.5px !important;
    white-space: nowrap !important;
    min-height: 28px !important;
    line-height: 1 !important;
    transition: all 0.15s !important;
}
div[data-testid="stHorizontalBlock"] > div > div > div > button:hover {
    border-color: #4a9eff !important;
    color: #4a9eff !important;
}
div[data-testid="stHorizontalBlock"] > div > div > div > button:focus {
    border-color: #4a9eff !important;
    color: #4a9eff !important;
    box-shadow: 0 0 0 2px rgba(74,158,255,0.2) !important;
    background: rgba(74,158,255,0.08) !important;
}
</style>"""


# ── DB helpers ────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def _load_news(hours: int = 168) -> pd.DataFrame:
    """Load news_feed rows from the last `hours` hours, newest first."""
    try:
        conn = sqlite3.connect(DB_PATH)
        df = pd.read_sql_query(
            """SELECT id, headline, summary, url, source, category,
                      published_at, fetched_at, market_impact, deal_size,
                      sector_relevance, time_sensitivity, regime_relevance,
                      overall_significance, regime_interpretation, ticker
               FROM news_feed
               WHERE published_at >= datetime('now', ?)
               ORDER BY overall_significance DESC, published_at DESC""",
            conn,
            params=(f"-{hours} hours",),
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
        char  = "●" if i < filled else "●"
        parts.append(
            f'<span style="color:{color};font-size:12px;line-height:1;">{char}</span>'
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


# ── Section 1: Header bar ─────────────────────────────────────────────────────

def _render_header_bar(total_count: int, high_count: int, last_updated: str) -> None:
    header_html = f"""
<div style="
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px 16px 4px;
    border-bottom: 1px solid #30363d;
    margin-bottom: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
">
    <div style="display: flex; align-items: center; gap: 16px;">
        <div style="
            width: 3px; height: 22px;
            background: linear-gradient(180deg, #4a9eff, #7c3aed);
            border-radius: 2px;
        "></div>
        <span style="
            color: #e6edf3; font-size: 13px; font-weight: 700;
            letter-spacing: 2px;
        ">MARKET INTELLIGENCE</span>
        <div style="
            background: rgba(74,158,255,0.15);
            border: 1px solid rgba(74,158,255,0.3);
            color: #4a9eff;
            font-size: 9px; font-weight: 700;
            padding: 2px 8px; border-radius: 10px;
            letter-spacing: 1px;
            animation: pulse 2s infinite;
        ">&#9679; LIVE</div>
    </div>
    <div style="display: flex; align-items: center; gap: 20px;">
        <div style="text-align: right;">
            <div style="color: #8b949e; font-size: 10px; letter-spacing: 1px;">HEADLINES</div>
            <div style="color: #e6edf3; font-size: 18px; font-weight: 700;">{total_count}</div>
        </div>
        <div style="text-align: right;">
            <div style="color: #8b949e; font-size: 10px; letter-spacing: 1px;">HIGH IMPACT</div>
            <div style="color: #ff4444; font-size: 18px; font-weight: 700;">{high_count}</div>
        </div>
        <div style="text-align: right;">
            <div style="color: #8b949e; font-size: 10px; letter-spacing: 1px;">UPDATED</div>
            <div style="color: #8b949e; font-size: 12px;">{last_updated}</div>
        </div>
    </div>
</div>
<style>
@keyframes pulse {{
    0%, 100% {{ opacity: 1; }}
    50% {{ opacity: 0.5; }}
}}
</style>
"""
    components.html(header_html, height=80)


# ── Section 3: Tier header ────────────────────────────────────────────────────

def _render_tier_header(label: str, color: str, n: int) -> None:
    tier_html = (
        f'<div style="display:flex;align-items:center;gap:10px;padding:12px 0 8px 0;'
        f'border-bottom:1px solid #21262d;margin-bottom:4px;">'
        f'<div style="width:8px;height:8px;border-radius:50%;background:{color};'
        f'box-shadow:0 0 6px {color};flex-shrink:0;"></div>'
        f'<span style="color:{color};font-size:11px;font-weight:700;'
        f'letter-spacing:1.5px;font-family:\'SF Mono\',\'Fira Code\',monospace;">'
        f'{html.escape(label)}</span>'
        f'<span style="color:#30363d;font-size:11px;">({n})</span>'
        f'<div style="flex:1;height:1px;'
        f'background:linear-gradient(90deg,{color}33,transparent);'
        f'margin-left:8px;"></div>'
        f'</div>'
    )
    st.markdown(tier_html, unsafe_allow_html=True)


# ── Section 4: Card HTML builder ──────────────────────────────────────────────

def _card_html(row: pd.Series) -> str:
    """Build Bloomberg-styled HTML for a single news card."""
    score     = float(row.get("overall_significance", 1.0))
    accent    = _accent_color(score)
    headline  = html.escape(str(row.get("headline", "")))
    source    = html.escape(str(row.get("source", "")))
    category  = str(row.get("category", "")).strip().upper()
    cat_esc   = html.escape(category)
    time_str  = _time_ago(str(row.get("published_at", "")))
    dots_html = _sig_dots_html(score, accent)
    impact    = int(row.get("market_impact", 1) or 1)
    deal_size = int(row.get("deal_size", 1) or 1)
    url       = html.escape(str(row.get("url", "#")))
    interp    = html.escape(str(row.get("regime_interpretation", "") or ""))

    cat_style = _CAT_STYLES.get(category, _CAT_DEFAULT)

    # Deal badge (M&A only)
    deal_badge = ""
    if category == "M&A" and deal_size > 1:
        deal_label = _DEAL_LABELS.get(deal_size, "")
        deal_badge = (
            f'<span style="background:#3a1f00;border:1px solid #ff8c0044;'
            f'color:#ff8c00;font-size:10px;padding:2px 8px;border-radius:10px;'
            f'font-family:\'SF Mono\',monospace;font-weight:700;">'
            f'{html.escape(deal_label)}</span>'
        )

    # Deal size text in significance row
    deal_size_text = ""
    if deal_size > 1:
        deal_size_text = (
            f'<span style="color:{_TEXT_MUTED};font-size:10px;">'
            f'· Deal: {_DEAL_LABELS.get(deal_size, "")}</span>'
        )

    # AI interpretation bar
    ai_bar = ""
    if interp:
        ai_bar = (
            f'<div style="background:#0d1117;border:1px solid #21262d;'
            f'border-left:2px solid #7c3aed;border-radius:0 4px 4px 0;'
            f'padding:6px 12px;margin-top:8px;'
            f'display:flex;align-items:center;gap:8px;">'
            f'<span style="color:#7c3aed;font-size:10px;font-weight:700;'
            f'font-family:\'SF Mono\',monospace;white-space:nowrap;">&#9670; AI</span>'
            f'<span style="color:#8b949e;font-size:11px;font-style:italic;">{interp}</span>'
            f'</div>'
        )

    return (
        f'<div style="'
        f'background:#161b22;'
        f'border:1px solid #30363d;'
        f'border-left:3px solid {accent};'
        f'border-radius:0 8px 8px 0;'
        f'padding:14px 16px 10px 16px;'
        f'margin-bottom:6px;'
        f'font-family:system-ui,-apple-system,sans-serif;'
        f'position:relative;'
        f'">'

        # Gradient overlay on left
        f'<div style="'
        f'position:absolute;left:0;top:0;bottom:0;width:40px;'
        f'background:linear-gradient(90deg,{accent}11,transparent);'
        f'pointer-events:none;'
        f'"></div>'

        # Headline
        f'<div style="'
        f'color:#e6edf3;font-size:13px;font-weight:500;'
        f'line-height:1.45;margin-bottom:9px;'
        f'padding-right:80px;'
        f'">{headline}</div>'

        # Meta row
        f'<div style="'
        f'display:flex;align-items:center;'
        f'gap:12px;margin-bottom:8px;flex-wrap:nowrap;'
        f'">'
        f'<span style="color:#6e7681;font-size:11px;white-space:nowrap;">&#9200; {time_str}</span>'
        f'<span style="color:#6e7681;font-size:11px;white-space:nowrap;">{source}</span>'
        f'<span style="'
        f'background:{cat_style["bg"]};color:{cat_style["color"]};'
        f'font-size:10px;padding:2px 8px;border-radius:10px;'
        f'font-weight:700;letter-spacing:0.5px;'
        f'font-family:\'SF Mono\',monospace;white-space:nowrap;'
        f'">{cat_esc}</span>'
        f'{deal_badge}'
        f'<a href="{url}" target="_blank" style="'
        f'margin-left:auto;color:#4a9eff;font-size:11px;'
        f'text-decoration:none;white-space:nowrap;'
        f'font-family:\'SF Mono\',monospace;'
        f'">READ &#8594;</a>'
        f'</div>'

        # Significance row
        f'<div style="display:flex;align-items:center;gap:10px;">'
        f'<div style="display:flex;gap:3px;align-items:center;">{dots_html}</div>'
        f'<span style="color:#6e7681;font-size:10px;font-family:\'SF Mono\',monospace;">'
        f'SIG {score:.1f}</span>'
        f'<span style="color:#6e7681;font-size:10px;">&#183;</span>'
        f'<span style="color:#6e7681;font-size:10px;">IMPACT {impact}</span>'
        f'{deal_size_text}'
        f'</div>'

        # AI bar (conditional)
        f'{ai_bar}'
        f'</div>'
    )


def _card_height(row: pd.Series) -> int:
    """Estimate pixel height for a single card."""
    interp = str(row.get("regime_interpretation", "") or "")
    return 95 + (44 if interp else 0) + 10


# ── Section 4+9: Cards section renderer ──────────────────────────────────────

def _render_cards_section(df: pd.DataFrame, tier_label: str, tier_color: str) -> None:
    """Render a tier header + news cards."""
    if df.empty:
        return

    _render_tier_header(tier_label, tier_color, len(df))

    cards_html = "".join(_card_html(row) for _, row in df.iterrows())
    section_html = (
        f'<div style="background:{_BG};padding:4px 0;">'
        f'{cards_html}'
        f'</div>'
    )
    total_h = sum(_card_height(row) for _, row in df.iterrows())
    components.html(section_html, height=total_h + 8, scrolling=False)


# ── Section 5: Other news expander ───────────────────────────────────────────

def _render_other_expander(other_df: pd.DataFrame) -> None:
    if other_df.empty:
        return

    _render_tier_header("OTHER NEWS", _ACCENT_GREEN, len(other_df))

    with st.expander(f"Show {len(other_df)} other headlines", expanded=False):
        cap = 20
        display_df = other_df.head(cap)
        extra = len(other_df) - cap

        cards_html = "".join(_card_html(row) for _, row in display_df.iterrows())
        if extra > 0:
            cards_html += (
                f'<div style="color:#6e7681;font-size:11px;text-align:center;'
                f'padding:12px 8px;">'
                f'+{extra} more headlines — narrow your filters to see all'
                f'</div>'
            )

        section_html = f'<div style="background:{_BG};padding:4px 0;">{cards_html}</div>'
        total_h = sum(_card_height(row) for _, row in display_df.iterrows())
        if extra > 0:
            total_h += 36
        components.html(section_html, height=total_h + 8, scrolling=True)


# ── Empty state HTML ──────────────────────────────────────────────────────────

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


# ── Section 6: Calendar section ───────────────────────────────────────────────

def _render_calendar_section() -> None:
    calendar = load_event_calendar()
    upcoming = get_upcoming_events(calendar, days=30)

    now_utc = datetime.now(timezone.utc)

    # Header
    cal_header = (
        f'<div style="'
        f'display:flex;align-items:center;gap:12px;'
        f'padding:20px 0 14px 0;'
        f'border-top:1px solid #30363d;'
        f'margin-top:8px;'
        f'font-family:\'SF Mono\',\'Fira Code\',monospace;'
        f'">'
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

    # Table header
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

    # Event rows
    rows_html = ""
    for i, (_, row) in enumerate(upcoming.iterrows()):
        bg        = _CARD_BG if i % 2 == 0 else _BG
        imp       = str(row.get("importance", "")).lower()
        imp_color = imp_colors.get(imp, _MUTED)
        imp_str   = html.escape(str(row.get("importance", "")).upper())
        event_str = html.escape(str(row.get("event_name", "")))
        src_str   = html.escape(str(row.get("source", "")))

        # Parse event datetime for countdown
        try:
            evt_dt = pd.to_datetime(row.get("event_datetime"), utc=True, errors="coerce")
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
            f'text-transform:uppercase;">'
            f'&#9679;&nbsp;{imp_str}</span>'
            f'<span style="color:#6e7681;font-size:11px;">{src_str}</span>'
            f'</div>'
        )

    n = len(upcoming)
    calendar_html = (
        cal_header
        + f'<div style="border:1px solid #30363d;border-radius:6px;overflow:hidden;">'
        + table_header
        + rows_html
        + f'</div>'
    )
    components.html(calendar_html, height=50 + 36 + n * 42 + 60, scrolling=False)


# ── Main render ───────────────────────────────────────────────────────────────

def render_events_tab(latest_signals: pd.DataFrame | None = None) -> None:
    """Main entry point — call from app.py inside the Events & Intelligence tab."""

    # ── Session state defaults ────────────────────────────────────────────────
    if "news_cat_filter" not in st.session_state:
        st.session_state.news_cat_filter = "ALL"
    if "news_time_filter" not in st.session_state:
        st.session_state.news_time_filter = "7D"
    if "news_sig_filter" not in st.session_state:
        st.session_state.news_sig_filter = "ALL"

    # ── Load data ─────────────────────────────────────────────────────────────
    hours_map = {"24H": 24, "48H": 48, "7D": 168}
    hours     = hours_map.get(st.session_state.news_time_filter, 168)
    news_all  = _load_news(hours=hours)

    high_count   = int((news_all["overall_significance"] >= 4.0).sum()) if not news_all.empty else 0
    last_upd     = _last_updated(news_all)

    # Pre-filter for total_count display (apply cat + sig, not time — time already in query)
    _news_display = news_all.copy() if not news_all.empty else pd.DataFrame()
    if not _news_display.empty and st.session_state.news_cat_filter != "ALL":
        _stored = _CAT_DISPLAY_MAP.get(st.session_state.news_cat_filter, st.session_state.news_cat_filter)
        _news_display = _news_display[_news_display["category"] == _stored]
    if not _news_display.empty:
        if st.session_state.news_sig_filter == "HIGH":
            _news_display = _news_display[_news_display["overall_significance"] >= 4.0]
        elif st.session_state.news_sig_filter == "MED":
            _news_display = _news_display[
                (_news_display["overall_significance"] >= 2.0)
                & (_news_display["overall_significance"] < 4.0)
            ]
    total_count = len(_news_display)

    # ── Section 1: Header bar ─────────────────────────────────────────────────
    _render_header_bar(total_count, high_count, last_upd)

    # ── Section 2: Filter bar ─────────────────────────────────────────────────
    st.markdown(_PILL_CSS, unsafe_allow_html=True)

    # Category row
    cat_labels  = ["ALL", "MACRO", "M&A", "EARNINGS", "GEO", "SECTOR"]
    cat_cols    = st.columns([1, 1, 1, 1, 1.4, 1, 4])
    for col, label in zip(cat_cols, cat_labels):
        stored_val = _CAT_DISPLAY_MAP.get(label, label)
        is_sel = st.session_state.news_cat_filter == stored_val
        with col:
            btn_label = f"› {label}" if is_sel else label
            if st.button(btn_label, key=f"news_cat_{label}",
                         type="primary" if is_sel else "secondary"):
                st.session_state.news_cat_filter = stored_val
                st.rerun()

    st.markdown("<div style='margin-top:8px'></div>", unsafe_allow_html=True)

    # Time + Significance row
    time_opts = ["24H", "48H", "7D"]
    sig_opts  = ["ALL", "HIGH", "MED"]
    r2 = st.columns([1, 1, 1, 1, 1, 1, 1, 4])

    for i, t in enumerate(time_opts):
        is_sel = st.session_state.news_time_filter == t
        with r2[i]:
            btn_label = f"› {t}" if is_sel else t
            if st.button(btn_label, key=f"news_time_{t}",
                         type="primary" if is_sel else "secondary"):
                st.session_state.news_time_filter = t
                st.rerun()

    # r2[3] is spacer (empty)

    for j, s in enumerate(sig_opts):
        is_sel = st.session_state.news_sig_filter == s
        with r2[j + 4]:
            btn_label = f"› {s}" if is_sel else s
            if st.button(btn_label, key=f"news_sig_{s}",
                         type="primary" if is_sel else "secondary"):
                st.session_state.news_sig_filter = s
                st.rerun()

    st.markdown(
        '<hr style="border:none;border-top:1px solid #21262d;margin:16px 0 8px 0;">',
        unsafe_allow_html=True,
    )

    # ── Sections 3–5: News feed ───────────────────────────────────────────────
    if news_all.empty:
        st.markdown(
            _empty_state(
                "No headlines loaded yet",
                "Run the Refresh News Feed step or wait for the scheduled workflow "
                "to populate the news_feed table.",
            ),
            unsafe_allow_html=True,
        )
    else:
        news = news_all.copy()

        # Apply category filter
        if st.session_state.news_cat_filter != "ALL":
            news = news[news["category"] == st.session_state.news_cat_filter]

        # Apply significance filter
        if st.session_state.news_sig_filter == "HIGH":
            news = news[news["overall_significance"] >= 4.0]
        elif st.session_state.news_sig_filter == "MED":
            news = news[
                (news["overall_significance"] >= 2.0)
                & (news["overall_significance"] < 4.0)
            ]

        if news.empty:
            st.markdown(
                _empty_state(
                    "No headlines match current filters",
                    "Try expanding the time range or changing the category filter",
                ),
                unsafe_allow_html=True,
            )
        else:
            # Tier 1: High Impact (sig >= 4)
            high = news[news["overall_significance"] >= 4.0]
            _render_cards_section(high, "HIGH IMPACT", _ACCENT_RED)

            # Tier 2: M&A & Deals (M&A category, sig < 4)
            ma = news[
                (news["category"] == "M&A") & (news["overall_significance"] < 4.0)
            ]
            _render_cards_section(ma, "M&A & DEALS", _ACCENT_ORANGE)

            # Tier 3: Macro & Fed (MACRO category, sig < 4)
            macro = news[
                (news["category"] == "MACRO") & (news["overall_significance"] < 4.0)
            ]
            _render_cards_section(macro, "MACRO & FED", _ACCENT)

            # Tier 4: Other (everything else, sig < 4) — collapsed expander
            other = news[
                ~news["category"].isin(["M&A", "MACRO"])
                & (news["overall_significance"] < 4.0)
            ]
            _render_other_expander(other)

    # ── Section 6: Macro Events Calendar ─────────────────────────────────────
    _render_calendar_section()
