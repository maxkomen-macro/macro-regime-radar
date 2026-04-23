"""
src/daily_memo.py — Daily Briefing Generator

Run:
    python src/daily_memo.py

Output:
    output/daily_memo.html  (dark-themed 1-page HTML briefing)

Stdout (for GitHub Actions metadata capture):
    MEMO_DATE=YYYY-MM-DD
    MEMO_REGIME=RegimeLabel

Standalone — does NOT import src.config so no FRED_API_KEY is required.
"""

import html as _html_mod
import os
import sqlite3
import sys
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import requests

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

ROOT       = Path(__file__).resolve().parent.parent
DB_PATH    = ROOT / "data" / "macro_radar.db"
OUTPUT_DIR = ROOT / "output"
MEMO_PATH  = OUTPUT_DIR / "daily_memo.html"


def _load_secrets_toml() -> None:
    """Copy keys from .streamlit/secrets.toml into os.environ if unset.

    Kept local (not imported from src.config) so this module stays standalone
    — the docstring above explicitly avoids src.config to sidestep FRED_API_KEY.
    """
    try:
        import tomllib
    except ImportError:
        return
    path = ROOT / ".streamlit" / "secrets.toml"
    if not path.exists():
        return
    try:
        with path.open("rb") as f:
            data = tomllib.load(f)
    except Exception:
        return
    for key in ("ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY",
                "FINNHUB_API_KEY", "NEWS_API_KEY"):
        val = data.get(key)
        if isinstance(val, str) and val and not os.environ.get(key):
            os.environ[key] = val

# Make `src.*` importable when invoked as `python src/daily_memo.py`.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analytics.news       import REGIME_SYSTEM_PROMPT  # noqa: E402
from src.analytics.perplexity import sonar_research        # noqa: E402

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

REGIME_COLORS = {
    "Goldilocks":     "#2ecc71",
    "Overheating":    "#e67e22",
    "Stagflation":    "#e74c3c",
    "Recession Risk": "#95a5a6",
}

SIGNAL_LABELS = {
    "yield_curve_inversion": "Yield Curve Inversion",
    "unemployment_spike":    "Unemployment Spike",
    "cpi_hot":               "CPI Hot",
    "cpi_cold":              "CPI Cold",
    "vix_spike":             "VIX Spike",
}

SYMBOL_NAMES = {
    "SPY": "S&P 500",
    "QQQ": "Nasdaq",
    "IWM": "Russell 2000",
    "TLT": "20Y Treasury",
    "HYG": "High Yield",
    "LQD": "IG Bonds",
    "UUP": "US Dollar",
    "GLD": "Gold",
    "USO": "Oil",
}

WATCHLIST_ORDER = ["SPY", "QQQ", "IWM", "TLT", "HYG", "LQD", "UUP", "GLD", "USO"]

IMPORTANCE_COLORS = {
    "high":   "#e74c3c",
    "medium": "#e67e22",
    "low":    "#95a5a6",
}

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _load(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = _connect()
    try:
        return pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()


def _table_exists(table: str) -> bool:
    conn = _connect()
    try:
        cur = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        )
        return cur.fetchone()[0] > 0
    finally:
        conn.close()

# ─────────────────────────────────────────────────────────────────────────────
# Data loaders
# ─────────────────────────────────────────────────────────────────────────────

def load_regime() -> dict:
    """Return current regime: label, confidence, prob distribution, as_of date."""
    df = _load(
        "SELECT label, confidence, date, "
        "prob_goldilocks, prob_overheating, prob_stagflation, prob_recession "
        "FROM regimes ORDER BY date DESC LIMIT 1"
    )
    if df.empty:
        return {"label": "Unknown", "confidence": 0.0, "as_of": "N/A"}
    row = df.iloc[0]
    return {
        "label":            row["label"],
        "confidence":       float(row["confidence"]),
        "as_of":            row["date"],
        "prob_goldilocks":  row.get("prob_goldilocks"),
        "prob_overheating": row.get("prob_overheating"),
        "prob_stagflation": row.get("prob_stagflation"),
        "prob_recession":   row.get("prob_recession"),
    }


def load_key_levels() -> dict:
    """
    Return fed_funds, t10y, t2y, spread, vix — each with current value and change.
    Change is MoM for FRED monthly series, recent-change for VIXCLS.
    """
    df = _load(
        """
        SELECT series_id, date, value FROM raw_series
        WHERE series_id IN ('FEDFUNDS', 'DGS10', 'DGS2', 'VIXCLS')
        ORDER BY series_id, date DESC
        """
    )
    if df.empty:
        return {}

    result = {}
    for sid, grp in df.groupby("series_id"):
        grp = grp.sort_values("date", ascending=False)
        latest_val = float(grp.iloc[0]["value"])
        change     = float(grp.iloc[0]["value"] - grp.iloc[1]["value"]) if len(grp) >= 2 else 0.0
        result[sid] = {"value": latest_val, "change": change}

    # Compute 2s10s spread from DGS10 and DGS2
    gs10 = df[df["series_id"] == "DGS10"].sort_values("date", ascending=False)
    gs2  = df[df["series_id"] == "DGS2"].sort_values("date", ascending=False)
    if not gs10.empty and not gs2.empty:
        spread_latest = float(gs10.iloc[0]["value"]) - float(gs2.iloc[0]["value"])
        if len(gs10) >= 2 and len(gs2) >= 2:
            spread_prev   = float(gs10.iloc[1]["value"]) - float(gs2.iloc[1]["value"])
            spread_change = spread_latest - spread_prev
        else:
            spread_change = 0.0
        result["SPREAD"] = {"value": spread_latest, "change": spread_change}

    return result


def load_watchlist() -> tuple[list[dict], bool]:
    """
    Return (rows, market_closed).
    rows: list of {symbol, name, price, chg_pct}.
    market_closed: True if latest 2 dates are the same or only 1 date available.
    """
    if not _table_exists("market_daily"):
        return [], True

    df = _load(
        """
        SELECT symbol, date, close FROM market_daily
        WHERE symbol IN ('SPY','QQQ','IWM','TLT','HYG','LQD','UUP','GLD','USO')
          AND date >= date((SELECT MAX(date) FROM market_daily), '-14 days')
        ORDER BY symbol, date DESC
        """
    )
    if df.empty:
        return [], True

    rows = []
    market_closed = False
    for sym in WATCHLIST_ORDER:
        grp = df[df["symbol"] == sym].sort_values("date", ascending=False)
        if grp.empty:
            rows.append({"symbol": sym, "name": SYMBOL_NAMES.get(sym, sym),
                         "price": None, "chg_pct": None})
            continue

        price = float(grp.iloc[0]["close"])
        if len(grp) >= 2:
            prev   = float(grp.iloc[1]["close"])
            chg    = (price / prev - 1.0) * 100.0 if prev != 0 else 0.0
            # Check if dates are the same (market closed)
            if grp.iloc[0]["date"] == grp.iloc[1]["date"]:
                market_closed = True
                chg = None
        else:
            chg = None
            market_closed = True

        rows.append({
            "symbol":  sym,
            "name":    SYMBOL_NAMES.get(sym, sym),
            "price":   price,
            "chg_pct": chg,
        })

    return rows, market_closed


def load_signals() -> list[dict]:
    """Return triggered signals at the latest signal date."""
    df = _load(
        """
        SELECT signal_name, value, triggered, date FROM signals
        WHERE date = (SELECT MAX(date) FROM signals)
        ORDER BY signal_name
        """
    )
    if df.empty:
        return []
    triggered = df[df["triggered"] == 1]
    return [
        {
            "name":  SIGNAL_LABELS.get(r["signal_name"], r["signal_name"]),
            "value": float(r["value"]),
            "date":  r["date"],
        }
        for _, r in triggered.iterrows()
    ]


def load_top_movers(n: int = 3) -> list[dict]:
    """Return top N market movers by absolute weekly z-score."""
    if not _table_exists("derived_metrics"):
        return []

    z_df = _load(
        """
        SELECT name, value FROM derived_metrics
        WHERE name LIKE '%_weekly_ret_z'
          AND date = (SELECT MAX(date) FROM derived_metrics WHERE name LIKE '%_weekly_ret_z')
        ORDER BY ABS(value) DESC
        LIMIT 10
        """
    )
    ret_df = _load(
        """
        SELECT name, value FROM derived_metrics
        WHERE name LIKE '%_weekly_ret'
          AND name NOT LIKE '%_z'
          AND date = (SELECT MAX(date) FROM derived_metrics
                      WHERE name LIKE '%_weekly_ret' AND name NOT LIKE '%_z')
        """
    )
    if z_df.empty:
        return []

    # Build symbol → return lookup
    ret_map = {}
    for _, row in ret_df.iterrows():
        sym = row["name"].replace("_weekly_ret", "")
        ret_map[sym] = float(row["value"])

    movers = []
    for _, row in z_df.iterrows():
        sym = row["name"].replace("_weekly_ret_z", "")
        z   = float(row["value"])
        ret = ret_map.get(sym, 0.0)
        movers.append({
            "symbol":  sym,
            "name":    SYMBOL_NAMES.get(sym, sym),
            "z":       z,
            "ret_pct": ret * 100.0,
        })
        if len(movers) >= n:
            break

    return movers


def load_top_news(n: int = 3) -> list[dict]:
    """Return the most recent N headlines with overall_significance >= 4.0.

    Used both to build the Perplexity research query and to feed Claude the
    set of headlines that should anchor today's regime narrative.
    """
    if not _table_exists("news_feed"):
        return []
    df = _load(
        """
        SELECT headline, summary, regime_interpretation, perplexity_research,
               overall_significance, published_at, source
        FROM news_feed
        WHERE overall_significance >= 4.0
          AND published_at >= datetime('now', '-36 hours')
        ORDER BY published_at DESC
        LIMIT ?
        """,
        params=(n,),
    )
    if df.empty:
        return []
    return [
        {
            "headline":              str(row["headline"]),
            "summary":               str(row.get("summary") or "")[:280],
            "regime_interpretation": str(row.get("regime_interpretation") or ""),
            "perplexity_research":   str(row.get("perplexity_research") or ""),
            "source":                str(row.get("source") or ""),
        }
        for _, row in df.iterrows()
    ]


def load_calendar(days: int = 2) -> list[dict]:
    """Return economic events in the next `days` calendar days (UTC)."""
    if not _table_exists("event_calendar"):
        return []

    df = _load(
        f"""
        SELECT event_name, event_datetime, importance FROM event_calendar
        WHERE datetime(event_datetime) >= datetime('now')
          AND datetime(event_datetime) <= datetime('now', '+{days} days')
        ORDER BY event_datetime
        """
    )
    if df.empty:
        return []

    events = []
    for _, row in df.iterrows():
        try:
            dt = datetime.fromisoformat(str(row["event_datetime"]).replace("Z", "+00:00"))
        except ValueError:
            dt = None
        events.append({
            "name":       row["event_name"],
            "dt":         dt,
            "importance": str(row["importance"]).lower(),
        })
    return events

# ─────────────────────────────────────────────────────────────────────────────
# Intelligence layer — Perplexity context + Claude Opus narrative
# ─────────────────────────────────────────────────────────────────────────────

_MEMO_RESEARCH_SYSTEM_PROMPT = (
    "You are a macro finance research analyst. Produce a ≤200-word grounded "
    "briefing on today's macro backdrop and the provided headlines. Prioritize "
    "fresh, primary-source context (Fed, BLS, Treasury releases, central-bank "
    "speeches, earnings prints). Cite sources."
)


def fetch_memo_research_context(
    regime_label: str,
    top_news: list[dict],
    api_key: str,
) -> str:
    """Query Perplexity Sonar for real-time grounding of today's memo.

    Returns an empty string on missing key or any failure — memo renders
    without the research block in that case.
    """
    if not api_key or not regime_label:
        return ""
    headlines = "; ".join(n["headline"] for n in top_news[:3] if n.get("headline"))
    if not headlines:
        query = (
            f"Briefing for traders: current macro regime is {regime_label}. "
            "What are the most important macro developments in the last 24 "
            "hours and what should we watch today?"
        )
    else:
        query = (
            f"Current macro regime: {regime_label}. Recent top headlines: "
            f"{headlines}. Provide a trader-focused grounding brief with the "
            "most important context a portfolio manager needs right now."
        )
    res = sonar_research(query, _MEMO_RESEARCH_SYSTEM_PROMPT, api_key, max_tokens=500)
    content   = (res.get("content") or "").strip()
    citations = res.get("citations") or []
    if content and citations:
        srcs = "\n".join(f"- {u}" for u in citations[:4])
        return f"{content}\n\nSources:\n{srcs}"
    return content


def generate_narrative(
    regime:     dict,
    levels:     dict,
    top_news:   list[dict],
    research:   str,
    api_key:    str,
) -> str:
    """Generate the memo's analyst-prose regime narrative.

    Uses claude-opus-4-7 with adaptive thinking so the model can reason
    through cross-currents before writing rather than pattern-matching to a
    template. The shared regime/scoring system prompt is sent as a
    cache-eligible content block.

    Returns "" on missing key or any API failure — the memo renders without
    the narrative block in that case, preserving backwards compatibility.
    """
    if not api_key:
        return ""

    regime_label = regime.get("label", "Unknown")
    confidence   = regime.get("confidence", 0.0)
    probs = {
        "Goldilocks":  regime.get("prob_goldilocks"),
        "Overheating": regime.get("prob_overheating"),
        "Stagflation": regime.get("prob_stagflation"),
        "Recession":   regime.get("prob_recession"),
    }

    def _fmt_level(key: str, label: str, unit: str = "%") -> str:
        d = levels.get(key, {}) or {}
        v = d.get("value")
        if v is None:
            return f"{label}: n/a"
        chg = d.get("change", 0.0) or 0.0
        sign = "+" if chg >= 0 else ""
        return f"{label}: {v:.2f}{unit} ({sign}{chg:.2f} MoM)"

    level_lines = "\n".join([
        _fmt_level("FEDFUNDS", "Fed Funds"),
        _fmt_level("DGS10",    "10Y UST"),
        _fmt_level("SPREAD",   "2s10s"),
        _fmt_level("VIXCLS",   "VIX", unit=""),
    ])

    news_lines = ""
    if top_news:
        for i, n in enumerate(top_news[:3], 1):
            interp = f" — {n['regime_interpretation']}" if n.get("regime_interpretation") else ""
            news_lines += f"{i}. {n['headline']} [{n.get('source','')}]{interp}\n"
    else:
        news_lines = "(no high-significance headlines in the last 36h)\n"

    research_block = (
        f"\nPERPLEXITY RESEARCH CONTEXT (real-time, sourced):\n{research}\n"
        if research.strip() else ""
    )

    user_content = (
        f"Write today's regime narrative for the daily briefing.\n\n"
        f"CURRENT REGIME: {regime_label} (confidence {confidence:.0%})\n"
        f"PROBABILITIES: {probs}\n\n"
        f"KEY LEVELS:\n{level_lines}\n\n"
        f"HIGH-SIGNIFICANCE HEADLINES (last 36h):\n{news_lines}"
        f"{research_block}\n"
        "Deliverables (4 short paragraphs, ~220 words total, no bullets):\n"
        "  1. REGIME READ — what the data says about the regime right now; "
        "whether today's prints/headlines reinforce or challenge it.\n"
        "  2. CROSS-CURRENTS — the single most interesting tension or "
        "contradiction in the data today.\n"
        "  3. WHAT'S PRICED vs WHAT'S AT RISK — one sentence each.\n"
        "  4. WHAT TO WATCH — the specific release, speaker, or market tell "
        "to watch over the next 24-48h.\n\n"
        "Write like a human PM briefing a colleague. Concrete. Specific. "
        "No hedging language. No recap of the headlines themselves. "
        "Plain text only — no markdown, no headers, no bullet points."
    )

    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      "claude-opus-4-7",
                "max_tokens": 1400,
                "thinking":   {"type": "adaptive"},
                "system": [{
                    "type":          "text",
                    "text":          REGIME_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                "messages": [{"role": "user", "content": user_content}],
            },
            timeout=120,
        )
        resp.raise_for_status()
        payload = resp.json()
        for block in payload.get("content", []):
            if block.get("type") == "text":
                return (block.get("text") or "").strip()
        return ""
    except Exception:
        return ""


def _render_narrative_html(narrative: str, research: str) -> str:
    """Render the Opus narrative + (optionally) the Perplexity sources block."""
    if not narrative.strip():
        return ""

    # Narrative — split paragraphs on double newline; fall back to single \n.
    raw_paras = [p.strip() for p in narrative.split("\n\n") if p.strip()]
    if len(raw_paras) == 1:
        raw_paras = [p.strip() for p in narrative.split("\n") if p.strip()]
    para_html = "".join(
        f'<p style="color:#d0d4dc; font-size:13px; line-height:1.55; '
        f'margin:0 0 10px 0;">{_html_mod.escape(p)}</p>'
        for p in raw_paras
    )

    # Perplexity sources sidebar — only rendered if research includes citations.
    sources_html = ""
    if "Sources:" in research:
        _, _, sources_part = research.partition("Sources:")
        urls = [ln.strip(" -\t") for ln in sources_part.splitlines() if ln.strip(" -\t")]
        if urls:
            links = "".join(
                f'<li style="margin-bottom:3px;">'
                f'<a href="{_html_mod.escape(u)}" '
                f'style="color:#4a9eff; text-decoration:none; font-size:11px;" '
                f'target="_blank">{_html_mod.escape(u)}</a></li>'
                for u in urls[:4]
            )
            sources_html = (
                '<div style="margin-top:10px; padding-top:10px; '
                'border-top:1px solid #2c3e50;">'
                '<div style="color:#7c3aed; font-size:9px; font-weight:700; '
                'letter-spacing:1px; margin-bottom:5px;">'
                '◆ PERPLEXITY SOURCES</div>'
                f'<ul style="margin:0; padding-left:14px;">{links}</ul>'
                '</div>'
            )

    return (
        f'<div {_CARD}>'
        f'{_section_header("REGIME READ")}'
        f'<div style="color:#95a5a6; font-size:10px; letter-spacing:1px; '
        f'margin-bottom:8px;">◆ CLAUDE OPUS 4.7 · ADAPTIVE THINKING</div>'
        f'{para_html}'
        f'{sources_html}'
        f'</div>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# HTML helpers
# ─────────────────────────────────────────────────────────────────────────────

def _arrow(change: float) -> str:
    """Return colored arrow + formatted change string."""
    if change > 0:
        return f'<span style="color:#2ecc71;">▲ +{change:.2f}</span>'
    elif change < 0:
        return f'<span style="color:#e74c3c;">▼ {change:.2f}</span>'
    return f'<span style="color:#95a5a6;">→ {change:.2f}</span>'


def _chg_color(chg_pct: float | None) -> str:
    if chg_pct is None:
        return "#95a5a6"
    return "#2ecc71" if chg_pct >= 0 else "#e74c3c"


def _fmt_chg(chg_pct: float | None) -> str:
    if chg_pct is None:
        return "—"
    sign = "+" if chg_pct >= 0 else ""
    return f"{sign}{chg_pct:.2f}%"

# ─────────────────────────────────────────────────────────────────────────────
# HTML builder
# ─────────────────────────────────────────────────────────────────────────────

# Shared inline style fragments
_CARD  = 'style="background:#16213e; border-radius:8px; padding:12px; margin-bottom:12px;"'
_LABEL = 'style="color:#7f8c8d; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;"'
_H2    = 'style="color:#bdc3c7; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin:0 0 8px 0; padding-bottom:6px; border-bottom:1px solid #2c3e50;"'


def _section_header(title: str) -> str:
    return f'<p {_H2}>{title}</p>'


def build_html(
    regime:    dict,
    levels:    dict,
    watchlist: list[dict],
    mkt_closed: bool,
    signals:   list[dict],
    movers:    list[dict],
    calendar:  list[dict],
    today:     date,
    narrative_html: str = "",
) -> str:

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    date_str  = today.strftime("%A, %B %-d, %Y")

    regime_label = regime.get("label", "Unknown")
    regime_color = REGIME_COLORS.get(regime_label, "#7f8c8d")
    confidence   = regime.get("confidence", 0.0)
    regime_as_of = regime.get("as_of", "")

    # Build probability detail HTML
    prob_gl = regime.get("prob_goldilocks")
    prob_ov = regime.get("prob_overheating")
    prob_st = regime.get("prob_stagflation")
    prob_rr = regime.get("prob_recession")
    has_probs = all(v is not None for v in [prob_gl, prob_ov, prob_st, prob_rr])
    if has_probs:
        prob_gl = float(prob_gl)  # type: ignore[arg-type]
        prob_ov = float(prob_ov)  # type: ignore[arg-type]
        prob_st = float(prob_st)  # type: ignore[arg-type]
        prob_rr = float(prob_rr)  # type: ignore[arg-type]
        dominant_prob = max(prob_gl, prob_ov, prob_st, prob_rr)
        conviction_label = (
            "High" if dominant_prob > 0.60
            else "Moderate" if dominant_prob >= 0.40
            else "Low"
        )
        regime_detail_html = (
            f"<div style='color:#7f8c8d; font-size:11px; margin-top:4px;'>"
            f"<b>{dominant_prob:.0%}</b> &bull; as of {regime_as_of}</div>"
            f"<div style='color:#aaa; font-size:10px; margin-top:2px;'>"
            f"GL {prob_gl:.0%} &bull; OV {prob_ov:.0%} &bull; "
            f"ST {prob_st:.0%} &bull; RR {prob_rr:.0%}</div>"
            f"<div style='color:#888; font-size:10px;'>Conviction: {conviction_label}</div>"
        )
    else:
        regime_detail_html = (
            f"<div style='color:#7f8c8d; font-size:11px; margin-top:4px;'>"
            f"{confidence*100:.0f}% conf &bull; as of {regime_as_of}</div>"
        )

    # ── 1. HEADER ─────────────────────────────────────────────────────────────
    header_html = f"""
    <div {_CARD}>
      <div style="display:table; width:100%;">
        <div style="display:table-cell; vertical-align:middle;">
          <div style="color:#e0e0e0; font-size:18px; font-weight:bold; margin-bottom:4px;">
            Macro Regime Radar
          </div>
          <div style="color:#7f8c8d; font-size:13px;">Daily Briefing &mdash; {date_str}</div>
        </div>
        <div style="display:table-cell; vertical-align:middle; text-align:right;">
          <span style="background:{regime_color}; color:#fff; font-size:12px; font-weight:bold;
                       padding:5px 12px; border-radius:20px; white-space:nowrap;">
            {regime_label}
          </span>
          {regime_detail_html}
        </div>
      </div>
    </div>
    """

    # ── 2. KEY LEVELS ─────────────────────────────────────────────────────────
    def _level_cell(label: str, series_key: str, unit: str = "%") -> str:
        data = levels.get(series_key, {})
        val  = data.get("value")
        chg  = data.get("change", 0.0)
        if val is None:
            return f"""
            <td style="width:25%; padding:4px 6px; vertical-align:top;">
              <div {_LABEL}>{label}</div>
              <div style="color:#e0e0e0; font-size:18px; font-weight:bold;">—</div>
            </td>"""
        return f"""
        <td style="width:25%; padding:4px 6px; vertical-align:top;">
          <div {_LABEL}>{label}</div>
          <div style="color:#e0e0e0; font-size:18px; font-weight:bold;">{val:.2f}{unit}</div>
          <div style="font-size:12px; margin-top:2px;">{_arrow(chg)}</div>
        </td>"""

    levels_html = f"""
    <div {_CARD}>
      {_section_header('Key Levels')}
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          {_level_cell('Fed Funds', 'FEDFUNDS')}
          {_level_cell('10Y Treasury', 'DGS10')}
          {_level_cell('2s10s Spread', 'SPREAD')}
          {_level_cell('VIX', 'VIXCLS', '')}
        </tr>
      </table>
    </div>
    """

    # ── 3. WATCHLIST SNAPSHOT ─────────────────────────────────────────────────
    if mkt_closed:
        watchlist_body = """
        <tr>
          <td colspan="3" style="padding:10px 0; color:#7f8c8d; font-style:italic; font-size:13px;">
            Market closed — no trading day data available.
          </td>
        </tr>
        """
    else:
        rows_html = ""
        for w in watchlist:
            price_str = f"${w['price']:.2f}" if w["price"] is not None else "—"
            chg_str   = _fmt_chg(w["chg_pct"])
            chg_col   = _chg_color(w["chg_pct"])
            rows_html += f"""
            <tr style="border-top:1px solid #2c3e50;">
              <td style="padding:5px 4px; font-size:13px; font-weight:bold; color:#e0e0e0; width:15%;">{w['symbol']}</td>
              <td style="padding:5px 4px; font-size:13px; color:#bdc3c7; width:45%;">{w['name']}</td>
              <td style="padding:5px 4px; font-size:13px; color:#e0e0e0; text-align:right; width:20%;">{price_str}</td>
              <td style="padding:5px 4px; font-size:13px; color:{chg_col}; text-align:right; font-weight:bold; width:20%;">{chg_str}</td>
            </tr>"""
        watchlist_body = rows_html

    watchlist_html = f"""
    <div {_CARD}>
      {_section_header('Watchlist Snapshot')}
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <th style="padding:4px; font-size:11px; color:#7f8c8d; text-align:left; font-weight:normal;">SYM</th>
          <th style="padding:4px; font-size:11px; color:#7f8c8d; text-align:left; font-weight:normal;">NAME</th>
          <th style="padding:4px; font-size:11px; color:#7f8c8d; text-align:right; font-weight:normal;">PRICE</th>
          <th style="padding:4px; font-size:11px; color:#7f8c8d; text-align:right; font-weight:normal;">1D CHG</th>
        </tr>
        {watchlist_body}
      </table>
    </div>
    """

    # ── 4. SIGNAL CHECK ───────────────────────────────────────────────────────
    if signals:
        sig_rows = ""
        for s in signals:
            sig_rows += f"""
            <div style="background:#2c1b18; border-left:3px solid #e74c3c; padding:7px 10px;
                        margin-bottom:6px; border-radius:0 4px 4px 0; font-size:13px;">
              <span style="color:#e74c3c; font-weight:bold;">⚠ {s['name']}</span>
              <span style="color:#bdc3c7; margin-left:8px;">value: {s['value']:.2f}</span>
              <span style="color:#7f8c8d; margin-left:8px; font-size:11px;">since {s['date']}</span>
            </div>"""
        signals_html = f"""
        <div {_CARD}>
          {_section_header('Signal Check')}
          {sig_rows}
        </div>"""
    else:
        signals_html = f"""
        <div {_CARD}>
          {_section_header('Signal Check')}
          <div style="color:#2ecc71; font-size:13px;">&#10003; All clear &mdash; no active signals</div>
        </div>"""

    # ── 5. TOP MOVERS ─────────────────────────────────────────────────────────
    if movers:
        mover_rows = ""
        for m in movers:
            direction = "surged" if m["ret_pct"] >= 0 else "fell"
            sign      = "+" if m["ret_pct"] >= 0 else ""
            col       = "#2ecc71" if m["ret_pct"] >= 0 else "#e74c3c"
            mover_rows += f"""
            <div style="font-size:13px; padding:5px 0; border-bottom:1px solid #2c3e50; color:#e0e0e0;">
              <span style="font-weight:bold; color:{col};">{m['symbol']}</span>
              <span style="color:#bdc3c7;"> ({m['name']})</span>
              <span style="color:{col};"> {direction} {sign}{m['ret_pct']:.2f}%</span>
              <span style="color:#7f8c8d; font-size:12px;"> &mdash; {m['z']:+.1f}&sigma; move</span>
            </div>"""
        movers_html = f"""
        <div {_CARD}>
          {_section_header('Top Movers (weekly)')}
          {mover_rows}
        </div>"""
    else:
        movers_html = ""

    # ── 6. CALENDAR LOOKAHEAD ─────────────────────────────────────────────────
    if calendar:
        cal_rows = ""
        for ev in calendar:
            imp_color = IMPORTANCE_COLORS.get(ev["importance"], "#95a5a6")
            if ev["dt"]:
                dt_str = ev["dt"].strftime("%b %-d, %H:%M UTC")
            else:
                dt_str = "TBD"
            cal_rows += f"""
            <div style="font-size:13px; padding:5px 0; border-bottom:1px solid #2c3e50; color:#e0e0e0;">
              <span style="color:{imp_color}; font-size:11px; text-transform:uppercase;
                           font-weight:bold; margin-right:6px;">&#9679; {ev['importance']}</span>
              <span style="color:#bdc3c7;">{dt_str}</span>
              <span style="color:#e0e0e0; margin-left:8px;">{ev['name']}</span>
            </div>"""
        calendar_html = f"""
        <div {_CARD}>
          {_section_header('Calendar Lookahead (next 2 days)')}
          {cal_rows}
        </div>"""
    else:
        calendar_html = f"""
        <div {_CARD}>
          {_section_header('Calendar Lookahead (next 2 days)')}
          <div style="color:#7f8c8d; font-size:13px; font-style:italic;">
            No major releases in the next 2 days.
          </div>
        </div>"""

    # ── 7. FOOTER ─────────────────────────────────────────────────────────────
    footer_html = f"""
    <div style="padding:10px 0; text-align:center;">
      <a href="https://maxkomen-macro.github.io/macro-regime-radar/memo/daily_memo.html"
         style="color:#3498db; text-decoration:none; font-size:12px;">View in browser</a>
      &nbsp;&bull;&nbsp;
      <a href="https://macro-regime-radar.streamlit.app/"
         style="color:#3498db; text-decoration:none; font-size:12px;">Live Dashboard</a>
      <div style="color:#4a5568; font-size:11px; margin-top:6px;">
        Generated {generated}
      </div>
      <div style="color:#4a5568; font-size:11px; margin-top:2px;">
        Automated briefing from Macro Regime Radar. Not investment advice.
      </div>
    </div>
    """

    # ── Assemble ───────────────────────────────────────────────────────────────
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Briefing — {date_str}</title>
</head>
<body style="margin:0; padding:16px; background:#1a1a2e; color:#e0e0e0;
             font-family:Arial, Helvetica, sans-serif;">
  <div style="max-width:600px; margin:0 auto;">
    {header_html}
    {narrative_html}
    {levels_html}
    {watchlist_html}
    {signals_html}
    {movers_html}
    {calendar_html}
    {footer_html}
  </div>
</body>
</html>
"""

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    _load_secrets_toml()
    today = date.today()

    regime     = load_regime()
    levels     = load_key_levels()
    watchlist, mkt_closed = load_watchlist()
    signals    = load_signals()
    movers     = load_top_movers(n=3)
    calendar   = load_calendar(days=2)
    top_news   = load_top_news(n=3)

    # Intelligence layer — Perplexity grounding + Opus 4.7 narrative.
    # Both are fully optional: missing keys / API failures fall back to the
    # standard memo with no narrative block.
    anthropic_key  = os.environ.get("ANTHROPIC_API_KEY",  "")
    perplexity_key = os.environ.get("PERPLEXITY_API_KEY", "")

    research  = fetch_memo_research_context(
        regime.get("label", ""), top_news, perplexity_key,
    )
    narrative = generate_narrative(regime, levels, top_news, research, anthropic_key)
    narrative_html = _render_narrative_html(narrative, research)

    html = build_html(
        regime=regime,
        levels=levels,
        watchlist=watchlist,
        mkt_closed=mkt_closed,
        signals=signals,
        movers=movers,
        calendar=calendar,
        today=today,
        narrative_html=narrative_html,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MEMO_PATH.write_text(html, encoding="utf-8")

    # These lines are parsed by the GitHub Actions workflow
    print(f"MEMO_DATE={today.isoformat()}")
    print(f"MEMO_REGIME={regime['label']}")


if __name__ == "__main__":
    main()
