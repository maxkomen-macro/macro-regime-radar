"""src/analytics/news.py — News fetch, classify, score, and store pipeline."""

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from src.analytics.perplexity import format_with_citations, sonar_research

# ── Constants ──────────────────────────────────────────────────────────────────

MACRO_KEYWORDS = [
    "federal reserve", "fomc", "powell", "fed chair", "inflation",
    "cpi", "ppi", "pce", "unemployment", "jobs report", "nonfarm payroll",
    "gdp", "recession", "interest rate", "rate hike", "rate cut",
    "treasury", "yield curve", "10-year", "2-year", "basis points",
]

MA_KEYWORDS = [
    "acquisition", "acquire", "merger", "deal", "buyout", "ipo",
    "public offering", "spac", "takeover", "private equity",
    "leveraged buyout", "lbo", "billion", "debt offering", "bond issuance",
]

EARNINGS_KEYWORDS = [
    "earnings", "quarterly results", "beats estimates", "misses estimates",
    "revenue", "guidance", "eps", "profit", "loss", "q1", "q2", "q3", "q4",
]

GEOPOLITICAL_KEYWORDS = [
    "tariff", "trade war", "sanctions", "china trade", "opec",
    "oil embargo", "russia", "ukraine", "election", "congress",
    "treasury secretary", "debt ceiling", "fiscal",
]

HIGH_IMPACT_TICKERS = [
    "SPY", "QQQ", "TLT", "GLD", "JPM", "GS", "BAC", "XOM",
    "AAPL", "MSFT", "NVDA", "BRK.B", "VIX",
]

REGIME_KEYWORD_MAP = {
    "Overheating": ["inflation", "rate hike", "cpi", "ppi", "hot", "wage"],
    "Goldilocks":  ["soft landing", "goldilocks", "balanced", "moderate growth"],
    "Stagflation": ["stagflation", "recession", "unemployment", "slowdown"],
    "Deflation":   ["deflation", "rate cut", "quantitative easing", "depression"],
}

_MAJOR_SECTORS = [
    "technology", "healthcare", "finance", "energy", "consumer",
    "industrial", "utilities", "real estate", "materials", "telecom",
]

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"


# ── Shared Claude system prompt (prompt-cached across calls) ──────────────────
#
# Used by both news.py (per-headline structured scoring) and daily_memo.py
# (daily Opus narrative). Sent as a content block with cache_control so the
# Anthropic cache serves identical system prompts across calls within 1 hour.

REGIME_SYSTEM_PROMPT = """You are a senior macro research analyst at a hedge fund.

REGIME TAXONOMY
Four macroeconomic regimes, each with distinct growth/inflation signatures:
  • Goldilocks  — growth trending up, inflation contained
  • Overheating — growth hot, inflation accelerating
  • Stagflation — growth slowing, inflation sticky or rising
  • Deflation   — growth contracting, inflation falling / Recession Risk

SIGNIFICANCE RUBRIC (1-5 on each of 5 dimensions)

market (market impact)
  5  Fed/FOMC/rate decisions, emergency actions
  4  Tier-1 data prints: CPI, PPI, jobs report, GDP, earnings beats/misses
  3  Large M&A ($1B+), credit events
  2  Guidance/outlook changes, rating actions
  1  Routine news with minimal cross-asset read

deal_size (M&A only; 1 for non-M&A)
  5  ≥$50B deal or "trillion"
  4  $10-50B
  3  $1-10B
  2  <$1B disclosed
  1  non-M&A or undisclosed

sector (sector relevance)
  5  Cross-sector story touching ≥2 major sectors
  4  Single sector + high-impact ticker (SPY/QQQ/TLT/etc.)
  3  Single sector focus
  2  High-impact ticker mentioned only
  1  Narrow/irrelevant

timeliness (time sensitivity)
  5  Breaking (≤2h old)
  4  Recent (≤6h)
  3  Same-day (≤24h)
  2  Within 48h
  1  Stale

regime (relevance to the current regime)
  5  Directly reinforces or refutes the current regime
  3  Partial confirmation
  1  Neutral / off-topic for macro regime framing

OUTPUT CONTRACT
Respond with structured data only. Interpretation must be ≤20 words,
declarative, macro-framed. macro_theme is one of MACRO, M&A, EARNINGS,
GEO, SECTOR."""


_SCORING_TOOL = {
    "name":        "record_headline_analysis",
    "description": "Record the macro-regime analysis of a single headline.",
    "input_schema": {
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "regime_interpretation": {
                "type":        "string",
                "description": "One-sentence (≤20 words) macro regime interpretation.",
            },
            "significance_scores": {
                "type": "object",
                "properties": {
                    "market":     {"type": "integer", "minimum": 1, "maximum": 5},
                    "deal_size":  {"type": "integer", "minimum": 1, "maximum": 5},
                    "sector":     {"type": "integer", "minimum": 1, "maximum": 5},
                    "timeliness": {"type": "integer", "minimum": 1, "maximum": 5},
                    "regime":     {"type": "integer", "minimum": 1, "maximum": 5},
                },
                "required": ["market", "deal_size", "sector", "timeliness", "regime"],
            },
            "overall": {"type": "number", "minimum": 1.0, "maximum": 5.0},
            "macro_theme": {
                "type": "string",
                "enum": ["MACRO", "M&A", "EARNINGS", "GEO", "SECTOR"],
            },
        },
        "required": [
            "headline", "regime_interpretation",
            "significance_scores", "overall", "macro_theme",
        ],
    },
}


# ── Perplexity system prompt for per-headline research ────────────────────────

NEWS_RESEARCH_SYSTEM_PROMPT = (
    "You are a macro finance research analyst. Given a recent news headline "
    "and the current macroeconomic regime, produce a concise (≤150 words) "
    "sourced research note: (1) why the headline matters in this regime, "
    "(2) the most relevant prior context a trader should know, (3) what to "
    "watch next. Cite primary sources."
)


# ── Category Classifier ────────────────────────────────────────────────────────

def classify_category(headline: str, summary: str) -> str:
    """Classify a news item into a category based on keyword matching."""
    text = (headline + " " + (summary or "")).lower()

    if any(kw in text for kw in MA_KEYWORDS):
        return "M&A"
    if any(kw in text for kw in MACRO_KEYWORDS):
        return "MACRO"
    if any(kw in text for kw in EARNINGS_KEYWORDS):
        return "EARNINGS"
    if any(kw in text for kw in GEOPOLITICAL_KEYWORDS):
        return "GEOPOLITICAL"
    return "SECTOR"


# ── Significance Scorer ────────────────────────────────────────────────────────

def _score_market_impact(text: str) -> int:
    if any(kw in text for kw in ["fed ", "fomc", "rate decision", "emergency"]):
        return 5
    if any(kw in text for kw in ["cpi", "jobs report", "gdp", "earnings beat", "earnings miss"]):
        return 4
    if any(kw in text for kw in ["acquisition", "merger"]) or re.search(r'\$\d+\.?\d*\s*b', text):
        return 3
    if any(kw in text for kw in ["guidance", "outlook", "upgrade", "downgrade"]):
        return 2
    return 1


def _score_deal_size(text: str, category: str) -> int:
    if category != "M&A":
        return 1
    match = re.search(r'\$(\d+\.?\d*)\s*(billion|trillion|b\b|t\b)', text, re.IGNORECASE)
    if not match:
        return 1
    amount = float(match.group(1))
    unit   = match.group(2).lower()
    if "trillion" in unit or unit == "t":
        return 5
    if amount >= 50:
        return 5
    if amount >= 10:
        return 4
    if amount >= 1:
        return 3
    return 2


def _score_sector_relevance(text: str) -> int:
    sectors_found = sum(1 for s in _MAJOR_SECTORS if s in text)
    tickers_found = any(t.lower() in text for t in HIGH_IMPACT_TICKERS)
    if sectors_found >= 2:
        return 5
    if sectors_found == 1 and tickers_found:
        return 4
    if sectors_found == 1:
        return 3
    if tickers_found:
        return 2
    return 1


def _score_time_sensitivity(published_at: str) -> int:
    try:
        pub = datetime.fromisoformat(published_at)
        if pub.tzinfo is None:
            pub = pub.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        hours_ago = (now - pub).total_seconds() / 3600
        if hours_ago <= 2:
            return 5
        if hours_ago <= 6:
            return 4
        if hours_ago <= 24:
            return 3
        if hours_ago <= 48:
            return 2
        return 1
    except Exception:
        return 1


def _score_regime_relevance(text: str, current_regime: str) -> int:
    keywords = REGIME_KEYWORD_MAP.get(current_regime, [])
    if not keywords:
        return 1
    matches = sum(1 for kw in keywords if kw in text)
    if matches >= 3:
        return 5
    if matches >= 1:
        return 3
    return 1


def score_significance(item: dict, current_regime: str) -> dict:
    """
    Score a news item across 5 dimensions and compute overall_significance.

    Returns dict with keys: market_impact, deal_size, sector_relevance,
    time_sensitivity, regime_relevance, overall_significance.
    """
    text = (item.get("headline", "") + " " + item.get("summary", "")).lower()
    category = item.get(
        "category",
        classify_category(item.get("headline", ""), item.get("summary", "")),
    )

    market_impact    = _score_market_impact(text)
    deal_size        = _score_deal_size(text, category)
    sector_relevance = _score_sector_relevance(text)
    time_sensitivity = _score_time_sensitivity(item.get("published_at", ""))
    regime_relevance = _score_regime_relevance(text, current_regime)

    overall = round(
        market_impact    * 0.35
        + deal_size      * 0.15
        + sector_relevance * 0.20
        + time_sensitivity * 0.15
        + regime_relevance * 0.15,
        2,
    )

    return {
        "market_impact":       market_impact,
        "deal_size":           deal_size,
        "sector_relevance":    sector_relevance,
        "time_sensitivity":    time_sensitivity,
        "regime_relevance":    regime_relevance,
        "overall_significance": overall,
    }


# ── Finnhub Fetcher ────────────────────────────────────────────────────────────

def fetch_finnhub_news(api_key: str, hours_back: int = 24) -> list[dict]:
    """Fetch general and merger news from Finnhub, filtered to hours_back window."""
    if not api_key:
        return []
    cutoff  = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    results = []
    for category in ("general", "merger"):
        try:
            resp = requests.get(
                "https://finnhub.io/api/v1/news",
                params={"category": category, "token": api_key},
                timeout=15,
            )
            resp.raise_for_status()
            for item in resp.json():
                try:
                    pub = datetime.fromtimestamp(item["datetime"], tz=timezone.utc)
                    if pub < cutoff:
                        continue
                    results.append({
                        "headline":     item["headline"],
                        "summary":      item.get("summary", ""),
                        "url":          item.get("url", ""),
                        "source":       item.get("source", "Finnhub"),
                        "published_at": pub.isoformat(),
                        "ticker":       item.get("related", ""),
                    })
                except (KeyError, TypeError, ValueError):
                    continue
        except Exception:
            continue
    return results


# ── NewsAPI Fetcher ────────────────────────────────────────────────────────────

def fetch_newsapi_news(api_key: str, hours_back: int = 24) -> list[dict]:
    """Fetch macro and M&A news from NewsAPI."""
    if not api_key:
        return []
    from_dt = (
        datetime.now(timezone.utc) - timedelta(hours=hours_back)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    queries = [
        "federal reserve OR inflation OR CPI OR interest rates OR FOMC",
        "merger acquisition OR IPO OR leveraged buyout OR private equity OR debt offering OR M&A",
    ]
    results = []
    for q in queries:
        try:
            resp = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q":        q,
                    "language": "en",
                    "sortBy":   "publishedAt",
                    "pageSize": 20,
                    "from":     from_dt,
                    "apiKey":   api_key,
                },
                timeout=15,
            )
            resp.raise_for_status()
            for article in resp.json().get("articles", []):
                title = article.get("title", "")
                if not title or "[Removed]" in title:
                    continue
                results.append({
                    "headline":     title,
                    "summary":      article.get("description", ""),
                    "url":          article.get("url", ""),
                    "source":       article.get("source", {}).get("name", "NewsAPI"),
                    "published_at": article.get("publishedAt", ""),
                    "ticker":       "",
                })
        except Exception:
            continue
    return results


# ── Deduplication ─────────────────────────────────────────────────────────────

def _word_overlap(a: str, b: str) -> float:
    """Jaccard word-set overlap between two headline strings."""
    set_a = set(a.lower().split())
    set_b = set(b.lower().split())
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def _deduplicate(items: list[dict]) -> list[dict]:
    """Remove near-duplicate headlines (word overlap > 0.8)."""
    unique: list[dict] = []
    for item in items:
        headline = item.get("headline", "")
        if any(_word_overlap(headline, u["headline"]) > 0.8 for u in unique):
            continue
        unique.append(item)
    return unique


# ── Claude Structured-Output Interpreter ──────────────────────────────────────

def get_structured_interpretation(
    headline: str,
    summary: str,
    current_regime: str,
    regime_probabilities: dict,
    api_key: str,
) -> dict:
    """Call Claude Haiku with a forced tool-schema to get schema-guaranteed JSON.

    Uses tool_use with `tool_choice` forced to `record_headline_analysis`, which
    guarantees Anthropic's API returns a tool_use block whose `input` validates
    against `_SCORING_TOOL["input_schema"]`. Zero possibility of malformed JSON
    writing to the DB.

    System prompt is sent as a cache-eligible content block (1h ephemeral TTL)
    so identical text across the hourly refresh + daily memo call hits cache.

    Returns
    -------
    dict
        {"regime_interpretation": str, "macro_theme": str,
         "significance_scores": {...}, "overall": float}.
        Empty strings / zero scores on any failure.
    """
    empty = {
        "regime_interpretation": "",
        "macro_theme":           "",
        "significance_scores":   {},
        "overall":               0.0,
    }
    if not api_key:
        return empty

    user_content = (
        f"Current regime: {current_regime}\n"
        f"Regime probabilities: {regime_probabilities}\n"
        f"Headline: {headline}\n"
        f"Summary: {(summary or 'N/A')[:400]}\n\n"
        "Score this headline and write a ≤20-word regime interpretation. "
        "Call record_headline_analysis with your result."
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
                "model":      "claude-haiku-4-5-20251001",
                "max_tokens": 400,
                "system": [{
                    "type":          "text",
                    "text":          REGIME_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                "tools":       [_SCORING_TOOL],
                "tool_choice": {"type": "tool", "name": _SCORING_TOOL["name"]},
                "messages":    [{"role": "user", "content": user_content}],
            },
            timeout=25,
        )
        resp.raise_for_status()
        payload = resp.json()
        for block in payload.get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == _SCORING_TOOL["name"]:
                data = block.get("input") or {}
                return {
                    "regime_interpretation": str(data.get("regime_interpretation", "")).strip(),
                    "macro_theme":           str(data.get("macro_theme", "")).strip(),
                    "significance_scores":   data.get("significance_scores") or {},
                    "overall":               float(data.get("overall", 0.0) or 0.0),
                }
        return empty
    except Exception:
        return empty


def get_regime_interpretation(
    headline: str,
    summary: str,
    current_regime: str,
    regime_probabilities: dict,
    api_key: str,
) -> str:
    """Backwards-compatible shim: return only the interpretation string.

    Retained so any external caller (tests, ad-hoc scripts) continues to work.
    New code should call `get_structured_interpretation` directly.
    """
    return get_structured_interpretation(
        headline, summary, current_regime, regime_probabilities, api_key,
    ).get("regime_interpretation", "")


# ── Main Orchestrator ─────────────────────────────────────────────────────────

def fetch_and_store_news(db_path: str, config: dict) -> int:
    """
    Full pipeline: fetch → deduplicate → classify → score → AI interpret → store.

    Args:
        db_path: path to macro_radar.db
        config: dict with keys finnhub_key, newsapi_key, anthropic_key

    Returns:
        Number of new rows inserted.
    """
    finnhub_key    = config.get("finnhub_key", "")
    newsapi_key    = config.get("newsapi_key", "")
    anthropic_key  = config.get("anthropic_key", "")
    perplexity_key = config.get("perplexity_key", "")

    # 1. Get current regime from DB
    current_regime = "Goldilocks"
    regime_probs: dict = {}
    try:
        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT label, prob_goldilocks, prob_overheating, "
                "prob_stagflation, prob_recession "
                "FROM regimes ORDER BY date DESC LIMIT 1"
            ).fetchone()
            if row:
                current_regime = row[0] or "Goldilocks"
                regime_probs = {
                    "Goldilocks":  row[1],
                    "Overheating": row[2],
                    "Stagflation": row[3],
                    "Deflation":   row[4],
                }
    except Exception:
        pass

    # 2. Fetch from both sources
    finnhub_items = fetch_finnhub_news(finnhub_key)
    newsapi_items = fetch_newsapi_news(newsapi_key)
    all_items = _deduplicate(finnhub_items + newsapi_items)

    if not all_items:
        return 0

    # 3. Classify, score, and optionally interpret + research
    #    Rule-based scoring remains authoritative for DB writes. For headlines
    #    above the significance threshold we additionally call Claude (for a
    #    schema-guaranteed interpretation) and Perplexity (for grounded
    #    research), both capped per-run to protect API budgets.
    ai_calls  = 0
    ppx_calls = 0
    enriched  = []
    for item in all_items:
        item["category"] = classify_category(
            item.get("headline", ""), item.get("summary", "")
        )
        scores = score_significance(item, current_regime)
        item.update(scores)

        item["regime_interpretation"] = ""
        item["perplexity_research"]   = ""

        if item["overall_significance"] >= 4.0:
            if ai_calls < 5:
                result = get_structured_interpretation(
                    item["headline"],
                    item.get("summary", ""),
                    current_regime,
                    regime_probs,
                    anthropic_key,
                )
                item["regime_interpretation"] = result.get("regime_interpretation", "")
                ai_calls += 1

            if ppx_calls < 5 and perplexity_key:
                query = (
                    f"Current macro regime: {current_regime}. "
                    f"Headline: {item['headline']}. "
                    f"What does a trader need to know about this now?"
                )
                res = sonar_research(query, NEWS_RESEARCH_SYSTEM_PROMPT, perplexity_key)
                item["perplexity_research"] = format_with_citations(res)
                ppx_calls += 1

        enriched.append(item)

    # 4. Insert into DB and prune old rows
    inserted = 0
    try:
        with sqlite3.connect(db_path) as conn:
            for item in enriched:
                try:
                    conn.execute(
                        """INSERT OR IGNORE INTO news_feed
                           (headline, summary, url, source, category, published_at,
                            market_impact, deal_size, sector_relevance, time_sensitivity,
                            regime_relevance, overall_significance, regime_interpretation,
                            perplexity_research, ticker)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            item.get("headline", ""),
                            item.get("summary", ""),
                            item.get("url", ""),
                            item.get("source", ""),
                            item["category"],
                            item.get("published_at", ""),
                            item["market_impact"],
                            item["deal_size"],
                            item["sector_relevance"],
                            item["time_sensitivity"],
                            item["regime_relevance"],
                            item["overall_significance"],
                            item.get("regime_interpretation", ""),
                            item.get("perplexity_research", ""),
                            item.get("ticker", ""),
                        ),
                    )
                    if conn.execute("SELECT changes()").fetchone()[0] > 0:
                        inserted += 1
                except Exception:
                    continue

            # Prune headlines older than 7 days
            conn.execute(
                "DELETE FROM news_feed WHERE published_at < datetime('now', '-7 days')"
            )
            conn.commit()
    except Exception:
        pass

    return inserted
