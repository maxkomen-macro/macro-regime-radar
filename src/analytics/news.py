"""src/analytics/news.py — News fetch, classify, score, store and enrich pipeline.

Since B4 (2026-09-18) the pipeline inserts first and enriches only rows that
are new in this run, inside a $50/month AI budget recorded call by call in
ai_spend_ledger (see src/analytics/ai_spend.py and enrich_new_rows below).
"""

import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from src.analytics import ai_spend
from src.analytics.ai_spend import MONTHLY_CAP_USD
from src.analytics.perplexity import format_with_citations, sonar_call
from src.db_helpers import ensure_ai_spend_ledger

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
    "watch next. Cite primary sources. Answer in at most four sentences."
)


# ── AI enrichment budget (B4, 2026-09-18) ─────────────────────────────────────
#
# Enrichment runs only on rows this run inserted whose rule score clears the
# floor, highest first, at most ENRICH_PER_HOUR per rolling hour counted from
# the ledger (so the full mode's double pass cannot double spend), inside a
# wall-clock budget, and never past MONTHLY_CAP_USD (src/analytics/ai_spend.py).

SIGNIFICANCE_FLOOR = 2.5
ENRICH_PER_HOUR = 10
# The window and depth the News tab shows by default (web NewsScreen asks
# /api/news for hours=168 ordered by significance). Each run tops these cards
# up, so the ten the reader sees carry the AI read rather than whichever rows
# happened to arrive in the last hour (N-B1).
DISPLAY_WINDOW_HOURS = 168
DISPLAY_TOP_N = 10
# fix/prelaunch-1 (B-H2): the page loads the first 150 rows of that window
# (useNews(168, undefined, 150) in web/src/screens/news/NewsScreen.tsx) and
# merges near-identical headlines before it ranks; the top-up reads the same
# rows and collapses on the same key, so its ten are the page's ten cards.
DISPLAY_LIMIT = 150

# The page's story key, web/src/screens/news/news-copy.ts headlineKey:
# headline.trim().toLowerCase().replace(/\s+/g, " "). JavaScript's \s and
# trim() are one character set, and it is not Python's: str.split() also
# splits on U+001C-U+001F and U+0085, and str.strip() keeps U+FEFF. So the set
# is spelled out. The shared fixture web/src/screens/news/__fixtures__/
# story-keys.json, generated from the JavaScript, pins the two together.
_JS_SPACE = "".join(map(chr, (
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B),
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
)))
_JS_SPACE_RUN = re.compile("[" + re.escape(_JS_SPACE) + "]+")
ENRICH_WALL_SECONDS = 150
FUTURE_TOLERANCE = timedelta(minutes=5)   # later-dated candidates are dropped
INTERPRETATION_MAX_SENTENCES = 2
RESEARCH_MAX_SENTENCES = 4

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
ANTHROPIC_MAX_TOKENS = 400
RESEARCH_MAX_TOKENS = 350


# ── Category Classifier ────────────────────────────────────────────────────────
#
# Rewritten 2026-09-06. The old classifier returned M&A for any headline that
# contained a single M&A keyword — and "deal", "billion" and "ipo" were on the
# list, so "China challenges Korean champions in flash memory race" landed in
# M&A on the strength of nothing at all. This version scores every category
# from weighted cue patterns, requires a real transaction cue for M&A, treats
# an IPO/listing as a capital-markets (SECTOR) event rather than a merger, and
# falls back to SECTOR — the neutral bucket in the fixed category enum — when
# no category clears the confidence bar.

_CUES: dict[str, list[tuple[str, int]]] = {
    "M&A": [
        (r"\b(acquisition|acquisitions|acquires?|acquired|acquiring)\b", 3),
        (r"\b(merger|mergers|merges?|merged|merging)\b", 3),
        (r"\b(takeover|buyout|buy-out|leveraged buyout|lbo)\b", 3),
        (r"\b(to buy|agreed to buy|agrees to buy|in talks to buy|bid for|bids for|tender offer|offer for)\b", 3),
        (r"\b(to sell|sells?|sale of|divests?|divestiture|spin-?off|carve-?out)\b.{0,60}\b(unit|division|business|stake|to)\b", 3),
        (r"\bprivate equity\b.{0,40}\b(buy|acquire|deal|takeover|bid)", 3),
        (r"\bdeal\b", 1),
        (r"\$\s?\d[\d,.]*\s?(billion|bn|trillion)\b.{0,30}\b(deal|acquisition|merger|takeover|buyout|bid)\b", 2),
    ],
    "MACRO": [
        (r"\b(federal reserve|fomc|\bfed\b|powell|fed chair|central bank|ecb|boe|boj)\b", 3),
        (r"\b(inflation|cpi|ppi|pce|core prices)\b", 3),
        (r"\b(unemployment|jobs report|nonfarm payrolls?|payrolls|jobless claims)\b", 3),
        (r"\b(gdp|recession|soft landing|stagflation)\b", 3),
        (r"\b(rate (hike|hikes|cut|cuts|decision)|hikes? rates?|cuts? (its )?(interest )?rates?|holds? rates?|interest rates?)\b", 3),
        (r"\b(yield curve|treasury yields?|10-year|2-year|basis points|bond yields?)\b", 2),
        (r"\btreasur(y|ies)\b", 1),
        (r"\b(credit spreads?|high[- ]yield|investment[- ]grade|junk bonds?|default rates?)\b", 2),
    ],
    "EARNINGS": [
        (r"\b(earnings|quarterly (results|revenue|profit|earnings|report)|q[1-4] (results|revenue|profit|earnings))\b", 3),
        (r"\b(beats?|misses?|tops?|trails?) (estimates|expectations|forecasts|the street)\b", 3),
        (r"\b(guidance|outlook)\b.{0,40}\b(raise|raises|raised|cut|cuts|lowers?|lowered|reaffirm|maintain)|\b(raises?|cuts?|lowers?) (its )?(guidance|outlook|forecast)\b", 3),
        (r"\b(revenue|sales|profit|net income|eps|margins?)\b.{0,40}\b(rose|fell|jumped|slumped|grew|declined|up|down|record)\b", 2),
        (r"\b(revenue|profit|loss|eps|net income)\b", 1),
        (r"\bq[1-4]\b", 1),
    ],
    "GEOPOLITICAL": [
        (r"\b(tariffs?|trade war|sanctions?|embargo|export controls?)\b", 3),
        (r"\b(opec\+?|ceasefire|missile|invasion|war\b|military|geopolitic\w*)\b", 3),
        (r"\b(russia|ukraine|kremlin|taiwan strait|middle east|iran|israel|gaza)\b", 2),
        (r"\b(election|congress|senate|white house|debt ceiling|government shutdown|fiscal|treasury secretary)\b", 2),
        (r"\b(china|beijing|eu\b|brussels)\b", 1),
    ],
    "SECTOR": [
        (r"\b(ipo|initial public offering|public offering|listing|debut|direct listing|spac)\b", 2),
        (r"\b(bond issuance|debt offering|notes offering|bond sale|convertible)\b", 2),
        (r"\b(downgrades?|upgrades?|default|bankruptcy|chapter 11|restructuring)\b", 2),
        (r"\b(chips?|semiconductors?|memory|flash memory|foundry|fab\b|wafers?)\b", 2),
        (r"\b(production|capacity|factory|plant|manufacturing|supply chain|output)\b", 2),
        (r"\b(ev|evs|electric vehicles?|autos?|airlines?|banks?|pharma|drug|fda|retail|energy|oil|gas|mining|software|cloud|ai\b)\b", 1),
        (r"\b(shares?|stock)\b.{0,30}\b(jump|surge|fall|drop|slide|rally|tumble)", 1),
        (r"\b(launch|launches|unveils?|recall|strike|layoffs?|hiring)\b", 2),
    ],
}
_COMPILED = {cat: [(re.compile(pat, re.IGNORECASE), w) for pat, w in cues] for cat, cues in _CUES.items()}
# Ties resolve toward the broader read: macro first, then policy, then the
# company categories; SECTOR is the neutral bucket and never wins a tie.
_PRIORITY = ["MACRO", "GEOPOLITICAL", "EARNINGS", "M&A", "SECTOR"]
_MIN_SCORE = 2  # below this no category is confident: the item stays SECTOR (neutral)


def score_categories(headline: str, summary: str = "") -> dict[str, int]:
    """Weighted cue scores per category for one item (headline + summary)."""
    text = f"{headline or ''} {summary or ''}".lower()
    scores = {cat: 0 for cat in _COMPILED}
    for cat, cues in _COMPILED.items():
        for pat, w in cues:
            if pat.search(text):
                scores[cat] += w
    # A credit-market story (spreads, high yield) is macro; a company credit
    # event (a downgrade, a default) stays with the company.
    return scores


def classify_with_confidence(headline: str, summary: str = "") -> tuple[str, float]:
    """(category, confidence 0–1). Confidence is the winning score against a
    five-point scale, zero when the item falls to the neutral bucket."""
    scores = score_categories(headline, summary)
    best = max(_PRIORITY, key=lambda c: (scores[c], -_PRIORITY.index(c)))
    top = scores[best]
    if best == "SECTOR" or top < _MIN_SCORE:
        return "SECTOR", 0.0 if top < _MIN_SCORE else min(1.0, top / 5.0)
    return best, min(1.0, top / 5.0)


def classify_category(headline: str, summary: str) -> str:
    """Classify a news item into MACRO / M&A / EARNINGS / GEOPOLITICAL / SECTOR."""
    return classify_with_confidence(headline, summary)[0]


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


def _score_time_sensitivity(published_at: str, now: datetime | None = None) -> int:
    try:
        pub = datetime.fromisoformat(published_at)
        if pub.tzinfo is None:
            pub = pub.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
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


def score_significance(item: dict, current_regime: str, now: datetime | None = None) -> dict:
    """
    Score a news item across 5 dimensions and compute overall_significance.
    `now` anchors time sensitivity (default: the real clock).

    Returns dict with keys: market_impact, deal_size, sector_relevance,
    time_sensitivity, regime_relevance, overall_significance.
    """
    text = ((item.get("headline") or "") + " " + (item.get("summary") or "")).lower()
    category = item.get(
        "category",
        classify_category(item.get("headline", ""), item.get("summary", "")),
    )

    market_impact    = _score_market_impact(text)
    deal_size        = _score_deal_size(text, category)
    sector_relevance = _score_sector_relevance(text)
    time_sensitivity = _score_time_sensitivity(item.get("published_at", ""), now)
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

def fetch_newsapi_news(api_key: str, hours_back: int = 72) -> list[dict]:
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


# ── RSS Fetcher ────────────────────────────────────────────────────────────────

# Curated free, high-signal macro/markets RSS feeds. No API key required.
# (source_label, feed_url). source_label drives tier coloring in the dashboard
# via events_tab.SOURCE_TIERS (ft / nyt / cnbc / marketwatch already keyed).
RSS_FEEDS = [
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("NYT Business",    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
    ("CNBC",            "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
    ("FT Markets",      "https://www.ft.com/markets?format=rss"),
    ("MarketWatch",     "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
]

_RSS_UA = "Mozilla/5.0 (compatible; MacroRegimeRadar/1.0; +https://macro-regime-radar.streamlit.app)"


def fetch_rss_news(
    hours_back: int = 48,
    feeds: list[tuple[str, str]] | None = None,
) -> list[dict]:
    """Fetch recent items from a curated set of financial RSS feeds.

    Each feed is fetched with a hard timeout so a slow/hung feed can't stall
    the pipeline, then parsed with feedparser (tolerant of the RSS/Atom format
    variety across outlets). Items older than `hours_back` are dropped. Returns
    the same dict shape as the Finnhub/NewsAPI fetchers.
    """
    import feedparser

    feed_list = feeds if feeds is not None else RSS_FEEDS
    cutoff    = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    results: list[dict] = []

    for label, url in feed_list:
        try:
            resp = requests.get(url, timeout=15, headers={"User-Agent": _RSS_UA})
            resp.raise_for_status()
            parsed = feedparser.parse(resp.content)
        except Exception:
            continue
        for entry in parsed.entries:
            try:
                pub_struct = entry.get("published_parsed") or entry.get("updated_parsed")
                if not pub_struct:
                    continue
                pub = datetime(*pub_struct[:6], tzinfo=timezone.utc)
                if pub < cutoff:
                    continue
                title = (entry.get("title") or "").strip()
                if not title:
                    continue
                summary = entry.get("summary") or entry.get("description") or ""
                summary = re.sub(r"<[^>]+>", "", summary).strip()
                results.append({
                    "headline":     title,
                    "summary":      summary,
                    "url":          entry.get("link", ""),
                    "source":       label,
                    "published_at": pub.isoformat(),
                    "ticker":       "",
                })
            except (KeyError, TypeError, ValueError):
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

_SCORING_TOOL_JSON = json.dumps(_SCORING_TOOL)  # sized for the worst-case estimate


def _empty_interpretation() -> dict:
    return {
        "regime_interpretation": "",
        "macro_theme":           "",
        "significance_scores":   {},
        "overall":               0.0,
    }


def _interpretation_user_content(
    headline: str, summary: str, current_regime: str, regime_probabilities: dict,
) -> str:
    return (
        f"Current regime: {current_regime}\n"
        f"Regime probabilities: {regime_probabilities}\n"
        f"Headline: {headline}\n"
        f"Summary: {(summary or 'N/A')[:400]}\n\n"
        "Score this headline and write a ≤20-word regime interpretation. "
        "Call record_headline_analysis with your result."
    )


def call_interpretation(
    headline: str,
    summary: str,
    current_regime: str,
    regime_probabilities: dict,
    api_key: str,
    timeout: int = 25,
) -> dict:
    """Call Claude Haiku with a forced tool-schema to get schema-guaranteed JSON.

    Uses tool_use with `tool_choice` forced to `record_headline_analysis`, which
    guarantees Anthropic's API returns a tool_use block whose `input` validates
    against `_SCORING_TOOL["input_schema"]`. Zero possibility of malformed JSON
    writing to the DB. The system prompt is sent as a cache-eligible content
    block (5-minute ephemeral TTL).

    Never raises. Returns {"result": <get_structured_interpretation dict>,
    "usage": dict | None, "model": str, "http_status": int | None,
    "error": str | None, "stop_reason": str | None}. `error` is None on a
    usable reply, else a short label ("http", "bad_json", "no_tool_use",
    "no_key", an exception class name), never exception text or a URL.
    """
    out = {
        "result": _empty_interpretation(), "usage": None, "model": ANTHROPIC_MODEL,
        "http_status": None, "error": None, "stop_reason": None,
    }
    if not api_key:
        out["error"] = "no_key"
        return out

    user_content = _interpretation_user_content(headline, summary, current_regime, regime_probabilities)
    try:
        resp = requests.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      ANTHROPIC_MODEL,
                "max_tokens": ANTHROPIC_MAX_TOKENS,
                "system": [{
                    "type":          "text",
                    "text":          REGIME_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                "tools":       [_SCORING_TOOL],
                "tool_choice": {"type": "tool", "name": _SCORING_TOOL["name"]},
                "messages":    [{"role": "user", "content": user_content}],
            },
            timeout=timeout,
        )
    except Exception as exc:
        out["error"] = type(exc).__name__
        return out

    try:
        status = resp.status_code if isinstance(resp.status_code, int) else None
        out["http_status"] = status
        try:
            payload = resp.json()
        except Exception:
            payload = None
        if isinstance(payload, dict):
            if isinstance(payload.get("usage"), dict):
                out["usage"] = payload["usage"]
            out["model"] = payload.get("model") or ANTHROPIC_MODEL
            out["stop_reason"] = payload.get("stop_reason")
        if status is None or not 200 <= status < 300:
            out["error"] = "http"
            return out
        if not isinstance(payload, dict):
            out["error"] = "bad_json"
            return out
        for block in payload.get("content") or []:
            if block.get("type") == "tool_use" and block.get("name") == _SCORING_TOOL["name"]:
                data = block.get("input") or {}
                out["result"] = {
                    "regime_interpretation": str(data.get("regime_interpretation", "")).strip(),
                    "macro_theme":           str(data.get("macro_theme", "")).strip(),
                    "significance_scores":   data.get("significance_scores") or {},
                    "overall":               float(data.get("overall", 0.0) or 0.0),
                }
                return out
        out["error"] = "no_tool_use"
    except Exception as exc:
        out["result"] = _empty_interpretation()
        out["error"] = type(exc).__name__
    return out


def get_structured_interpretation(
    headline: str,
    summary: str,
    current_regime: str,
    regime_probabilities: dict,
    api_key: str,
) -> dict:
    """Schema-guaranteed interpretation of one headline (see call_interpretation).

    Returns
    -------
    dict
        {"regime_interpretation": str, "macro_theme": str,
         "significance_scores": {...}, "overall": float}.
        Empty strings / zero scores on any failure.
    """
    return call_interpretation(
        headline, summary, current_regime, regime_probabilities, api_key,
    )["result"]


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


# ── Storage caps: complete sentences only (B4) ────────────────────────────────
#
# Stored model text is capped at whole sentences and never cut mid-sentence:
# the research note at four (before its Sources block is appended, so the
# web's "Sources:" split still works), the interpretation at two. A trailing
# fragment with no terminal punctuation (a reply cut off by max_tokens) is
# dropped. Decimals (4.94%, 1.5x), initialisms (U.S.), common abbreviations
# (e.g., Inc., Sept.), list numerals, citation markers ([1], [1][2]) and
# markdown emphasis do not end a sentence on their own. "Fed." is a word, not
# an abbreviation: it ends sentences.

_CLOSERS = r"(?:[\"'”’)\]]|\*{1,2}|_{1,2}| ?\[\d+(?:\s*[,–-]\s*\d+)*\])*"
_SENTENCE_END = re.compile(r"(?P<punct>[.!?]+|…)(?P<close>" + _CLOSERS + r")(?=\s|$)")
_TERMINAL_AT_END = re.compile(r"(?:[.!?]+|…)" + _CLOSERS + r"$")
_OPEN_MARKS = "\"'“‘([*_"
# Never a sentence end: always followed by more of the same sentence.
_NEVER_ENDS = frozenset({
    "e.g", "i.e", "cf", "vs", "approx", "mr", "mrs", "ms", "dr", "prof", "st", "mt", "ft",
    "gov", "sen", "rep", "gen", "col", "lt", "sgt",
})
# An end only before an obvious sentence opener ("…from Apple Inc. The company…").
_ABBREVIATIONS = frozenset({
    "inc", "corp", "co", "ltd", "llc", "plc", "bros", "jr", "sr", "etc", "al", "est",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
})
_NUMBERED = frozenset({"no", "nos", "vol", "fig", "pp"})  # "No. 5"
_INITIALISM = re.compile(r"(?:[a-z]\.)+[a-z]")  # u.s, u.k, j.p, p.m
_OPENERS = frozenset({
    "the", "this", "that", "these", "those", "it", "its", "they", "their", "we", "our",
    "he", "she", "his", "her", "there", "however", "meanwhile", "but", "and", "yet",
    "still", "also", "so", "in", "on", "at", "as", "if", "while", "a", "an",
})
_LINE_BREAKS = "\r\n\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029"


def _is_sentence_end(text: str, m: re.Match) -> bool:
    n = len(text)
    j = m.end()
    while j < n and text[j].isspace():
        j += 1
    if j >= n:
        return True  # the text ends here
    while j < n and text[j] in _OPEN_MARKS:
        j += 1
    k = j
    while k < n and text[k].isalnum():
        k += 1
    nxt = text[j:k]
    punct = m.group("punct")
    if punct == "…" or punct.startswith(".."):
        return nxt[:1].isupper()  # an ellipsis before lower case runs on
    if punct != ".":
        return True  # ? and ! (and runs of them)
    i = m.start()
    while i > 0 and not text[i - 1].isspace():
        i -= 1
    word = text[i:m.start()].lstrip(_OPEN_MARKS).lower()
    if not word:
        return True
    if word in _NEVER_ENDS:
        return False
    if word.isdigit() and len(word) <= 2 and not text[text.rfind("\n", 0, i) + 1:i].strip():
        return False  # "1." opening a list item
    if word in _NUMBERED and nxt[:1].isdigit():
        return False
    if word in _ABBREVIATIONS or _INITIALISM.fullmatch(word) or (len(word) == 1 and word.isalpha()):
        return nxt[:1].isupper() and nxt.lower() in _OPENERS
    return True


def _is_label(line: str) -> bool:
    """A heading or "**Label:**" line belongs to the unit that follows it."""
    s = line.strip()
    return (
        s.startswith("#")
        or s.rstrip("*_ ").endswith(":")
        or (len(s) > 4 and s[:2] in ("**", "__") and s[-2:] in ("**", "__"))
    )


def sentence_ends(text: str) -> list[int]:
    """End offsets of the complete sentences in `text`, in order.

    A sentence ends at terminal punctuation (with any closing quotes,
    brackets, emphasis markers and citation markers) followed by whitespace
    or the end of the text, and at a line break after a line that has words
    but no terminal punctuation (a bullet), unless that line is a label.
    """
    ends = {m.end() for m in _SENTENCE_END.finditer(text) if _is_sentence_end(text, m)}
    pos = 0
    for line in text.splitlines(keepends=True):
        content = line.rstrip(_LINE_BREAKS)
        body = content.rstrip()
        if (
            len(content) < len(line)  # a line break follows
            and any(c.isalnum() for c in body)
            and not _is_label(body)
            and not _TERMINAL_AT_END.search(body)
        ):
            ends.add(pos + len(body))
        pos += len(line)
    return sorted(e for e in ends if text[:e].strip())


def cap_sentences(text: str, max_sentences: int, *, keep_lone_fragment: bool = False) -> str:
    """The first `max_sentences` complete sentences of `text`, verbatim.

    Never cuts inside a sentence, and drops a trailing fragment without
    terminal punctuation. A text with no complete sentence at all returns ""
    unless keep_lone_fragment (a short structured field, such as the
    interpretation, that may legitimately omit its final period).
    """
    body = (text or "").strip()
    if not body or max_sentences < 1:
        return ""
    ends = sentence_ends(body)
    if not ends:
        return body if keep_lone_fragment else ""
    return body[: ends[min(max_sentences, len(ends)) - 1]].rstrip()


# ── Store: insert first ───────────────────────────────────────────────────────

_INSERT_NEWS = """INSERT OR IGNORE INTO news_feed
   (headline, summary, url, source, category, published_at,
    market_impact, deal_size, sector_relevance, time_sensitivity,
    regime_relevance, overall_significance, regime_interpretation,
    perplexity_research, ticker)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""


def _parse_published(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def drop_future_dated(
    items: list[dict],
    now: datetime | None = None,
    tolerance: timedelta = FUTURE_TOLERANCE,
) -> list[dict]:
    """Drop candidates dated more than `tolerance` ahead of `now`: a feed's bad
    clock must not become the freshest row. Unparseable dates are kept, as before."""
    limit = ai_spend.as_utc(now) + tolerance
    kept = []
    for item in items:
        pub = _parse_published(item.get("published_at"))
        if pub is None or pub <= limit:
            kept.append(item)
    return kept


def _current_regime(conn: sqlite3.Connection) -> tuple[str, dict]:
    """Latest regime label and probabilities ("Goldilocks", {} when absent)."""
    try:
        row = conn.execute(
            "SELECT label, prob_goldilocks, prob_overheating, "
            "prob_stagflation, prob_recession "
            "FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        return "Goldilocks", {}
    if not row:
        return "Goldilocks", {}
    return row[0] or "Goldilocks", {
        "Goldilocks":  row[1],
        "Overheating": row[2],
        "Stagflation": row[3],
        "Deflation":   row[4],
    }


def store_new_items(
    conn: sqlite3.Connection,
    items: list[dict],
    current_regime: str,
    *,
    now: datetime | None = None,
) -> list[int]:
    """Classify, rule-score and INSERT OR IGNORE each candidate; return the ids
    of the rows this call inserted. A row already stored (same headline and
    published_at) is left exactly as it is: never rewritten, never re-enriched."""
    at = ai_spend.as_utc(now)
    new_ids: list[int] = []
    failed: dict[str, int] = {}
    for item in items:
        item["category"] = classify_category(
            item.get("headline", ""), item.get("summary", "")
        )
        item.update(score_significance(item, current_regime, now=at))
        try:
            cur = conn.execute(_INSERT_NEWS, (
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
                "",  # regime_interpretation: filled by enrich_new_rows
                "",  # perplexity_research: filled by enrich_new_rows
                item.get("ticker", ""),
            ))
        except Exception as exc:
            failed[type(exc).__name__] = failed.get(type(exc).__name__, 0) + 1
            continue
        if cur.rowcount == 1 and cur.lastrowid:
            new_ids.append(int(cur.lastrowid))
    conn.commit()
    if failed:
        detail = ", ".join(f"{name}×{n}" for name, n in sorted(failed.items()))
        print(f"[news] WARNING: {sum(failed.values())} candidates not stored ({detail})", file=sys.stderr)
    return new_ids


def _prune_news(conn: sqlite3.Connection, now: datetime | None = None) -> None:
    """Headlines age out after 7 days. The AI spend ledger is append-only and
    is never pruned: its month-to-date sum is the budget."""
    cutoff = (ai_spend.as_utc(now) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("DELETE FROM news_feed WHERE published_at < ?", (cutoff,))


# ── Enrich: rows new in this run, inside the budget ───────────────────────────

_ROW_COLUMNS = (
    "id", "headline", "summary", "published_at", "overall_significance",
    "regime_interpretation", "perplexity_research",
)


def _load_rows(conn: sqlite3.Connection, row_ids) -> list[dict]:
    ids = sorted({int(i) for i in (row_ids or [])})
    rows: list[dict] = []
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        rows += [
            dict(zip(_ROW_COLUMNS, r))
            for r in conn.execute(
                f"SELECT {', '.join(_ROW_COLUMNS)} FROM news_feed WHERE id IN ({','.join('?' * len(chunk))})",
                chunk,
            )
        ]
    return rows


def _eligible(row: dict, floor: float) -> bool:
    # "carries no read" is the page's hasAiRead (news-copy.ts), which trims
    # with JavaScript's whitespace set, not Python's (B-H2, fix/prelaunch-1)
    return (
        float(row["overall_significance"] or 0.0) >= floor
        and not (row["regime_interpretation"] or "").strip(_JS_SPACE)
        and not (row["perplexity_research"] or "").strip(_JS_SPACE)
    )


def _priority(row: dict, displayed=frozenset()) -> tuple:
    """Cards the page is showing first, then highest score, newest, insertion
    order. The tier matters only when the hourly room runs out: what a reader
    can see wins over what merely arrived."""
    pub = _parse_published(row["published_at"])
    return (0 if row["id"] in displayed else 1,
            -float(row["overall_significance"] or 0.0), -(pub.timestamp() if pub else 0.0), row["id"])


def headline_key(headline: str | None) -> str:
    """The page's story key (news-copy.ts headlineKey), in Python."""
    return _JS_SPACE_RUN.sub(" ", (headline or "").strip(_JS_SPACE).lower())


def display_stories(rows: list[dict], top_n: int = DISPLAY_TOP_N) -> list[dict]:
    """The first `top_n` distinct stories of rows in the page's order: one row
    per headline_key, the first one, which is the copy the page renders."""
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        key = headline_key(r["headline"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
        if len(out) == top_n:
            break
    return out


def select_display_topups(
    conn: sqlite3.Connection,
    *,
    now: datetime | None = None,
    window_hours: int = DISPLAY_WINDOW_HOURS,
    top_n: int = DISPLAY_TOP_N,
    floor: float = SIGNIFICANCE_FLOOR,
    limit: int = DISPLAY_LIMIT,
) -> list[int]:
    """The ids of the top `top_n` stories of the display window that carry no
    AI read yet, highest significance first.

    The window, the ordering and the depth mirror what the page loads
    (/api/news, api/db.py: same normalised published_at comparison, same ORDER
    BY, the page's 150 rows), and the rows are collapsed on the page's story key
    before the ten are taken (B-H2, fix/prelaunch-1), so the set is the ten
    cards the page shows, not ten rows two of which it merges away. Stories
    already enriched keep their slot in the ten and are simply not returned, so
    a run never reaches past the cards a reader can see. The SQL is written
    here rather than imported from api/db.py: the hourly workflow installs only
    requirements-news.txt.
    """
    at = ai_spend.as_utc(now)
    cutoff = (at - timedelta(hours=window_hours)).strftime("%Y-%m-%d %H:%M:%S")
    rows = [
        dict(zip(_ROW_COLUMNS, r))
        for r in conn.execute(
            f"SELECT {', '.join(_ROW_COLUMNS)} FROM news_feed "
            "WHERE replace(substr(published_at, 1, 19), 'T', ' ') >= ? "
            "ORDER BY overall_significance DESC, published_at DESC LIMIT ?",
            (cutoff, int(limit)),
        )
    ]
    return [r["id"] for r in display_stories(rows, top_n) if _eligible(r, floor)]


def _research_query(current_regime: str, headline: str) -> str:
    return (
        f"Current macro regime: {current_regime}. "
        f"Headline: {headline}. "
        f"What does a trader need to know about this now?"
    )


class _Run:
    """One enrichment pass: its clock, run id, keys and running counts."""

    def __init__(self, conn, keys, now, run_id, cap):
        self.conn = conn
        self.anthropic_key = keys.get("anthropic_key") or ""
        self.perplexity_key = keys.get("perplexity_key") or ""
        self._now = now
        self.run_id = run_id
        self.cap = cap
        self.stats = {
            "new": 0, "topped_up": 0, "eligible": 0, "enriched": 0, "held_hourly": 0, "skipped_cap": 0,
            "held_time": 0, "calls": 0, "run_cost_usd": 0.0, "month_to_date_usd": 0.0,
            "cap_usd": cap, "errors": {}, "cap_reached": False, "ledger_error": None,
            "keys": bool(self.anthropic_key or self.perplexity_key),
        }

    def now(self) -> datetime:
        # a fixed clock when injected (tests, replays); per-row real time otherwise
        return self._now if self._now is not None else ai_spend.utc_now()

    def fits(self, worst_case: float) -> bool:
        return ai_spend.within_cap(self.conn, worst_case, now=self.now(), cap=self.cap)

    def note_cap(self) -> None:
        if not self.stats["cap_reached"] and not ai_spend.cap_already_noted(self.conn, self.run_id):
            ai_spend.record(
                self.conn, provider="budget", purpose="cap_reached", status="cap_reached",
                now=self.now(), run_id=self.run_id,
            )
        self.stats["cap_reached"] = True

    def record(self, *, provider, purpose, news_id, model, priced, ok, http_status, error) -> None:
        cost = ai_spend.record(
            self.conn, provider=provider, purpose=purpose, status="ok" if ok else "error",
            now=self.now(), model=model, news_id=news_id, priced=priced,
            http_status=http_status, run_id=self.run_id,
        )
        self.stats["calls"] += 1
        self.stats["run_cost_usd"] += cost
        if not ok:
            label = f"{provider} {http_status if error == 'http' and http_status else (error or 'error')}"
            self.stats["errors"][label] = self.stats["errors"].get(label, 0) + 1


def _enrich_one(run: _Run, row: dict, regime: str, probs: dict) -> bool:
    """Enrich one stored row. False when the cap stopped it before any call."""
    user_content = _interpretation_user_content(row["headline"], row["summary"], regime, probs)
    query = _research_query(regime, row["headline"])
    plan = []
    if run.anthropic_key:
        plan.append(("anthropic", ai_spend.anthropic_worst_case(
            REGIME_SYSTEM_PROMPT, _SCORING_TOOL_JSON, user_content, max_tokens=ANTHROPIC_MAX_TOKENS)))
    if run.perplexity_key:
        plan.append(("perplexity", ai_spend.perplexity_worst_case(
            NEWS_RESEARCH_SYSTEM_PROMPT, query, max_tokens=RESEARCH_MAX_TOKENS)))
    # An item starts only if every call it would make fits, so the cap never
    # leaves a headline half enriched; each call still re-checks its own case.
    if not run.fits(sum(worst for _, worst in plan)):
        run.note_cap()
        return False

    interpretation, research, claude_overall, any_ok = "", "", 0.0, False
    for provider, worst in plan:
        if not run.fits(worst):
            run.note_cap()
            break
        if provider == "anthropic":
            res = call_interpretation(row["headline"], row["summary"], regime, probs, run.anthropic_key)
            ok = res["error"] is None
            if ok:
                interpretation = cap_sentences(
                    res["result"]["regime_interpretation"], INTERPRETATION_MAX_SENTENCES, keep_lone_fragment=True,
                )
                claude_overall = float(res["result"]["overall"] or 0.0)
            run.record(
                provider="anthropic", purpose="news_interpretation", news_id=row["id"], model=res["model"],
                priced=ai_spend.anthropic_cost(res["usage"]), ok=ok,
                http_status=res["http_status"], error=res["error"],
            )
        else:
            res = sonar_call(query, NEWS_RESEARCH_SYSTEM_PROMPT, run.perplexity_key, max_tokens=RESEARCH_MAX_TOKENS)
            content = ""
            if res["ok"]:
                # capped BEFORE the Sources block is appended
                content = cap_sentences(
                    res["content"], RESEARCH_MAX_SENTENCES,
                    keep_lone_fragment=res["finish_reason"] != "length",
                )
            ok = bool(content)
            if ok:
                research = format_with_citations({"content": content, "citations": res["citations"]})
            run.record(
                provider="perplexity", purpose="news_research", news_id=row["id"], model=res["model"],
                priced=ai_spend.perplexity_cost(res["usage"]), ok=ok,
                http_status=res["http_status"], error=res["error"] or (None if ok else "empty"),
            )
        any_ok = any_ok or ok

    if interpretation or research or claude_overall > 0:
        run.conn.execute(
            "UPDATE news_feed SET regime_interpretation = ?, perplexity_research = ?, "
            "overall_significance = ? WHERE id = ?",
            (
                interpretation,
                research,
                claude_overall if claude_overall > 0 else row["overall_significance"],
                row["id"],
            ),
        )
        run.conn.commit()
    if any_ok:
        run.stats["enriched"] += 1
    return True


def enrich_new_rows(
    conn: sqlite3.Connection,
    row_ids,
    keys: dict | None,
    *,
    now: datetime | None = None,
    floor: float = SIGNIFICANCE_FLOOR,
    per_hour: int = ENRICH_PER_HOUR,
    monthly_cap: float = MONTHLY_CAP_USD,
    wall_seconds: float = ENRICH_WALL_SECONDS,
    clock=time.monotonic,
    run_id: str | None = None,
    display_ids=(),
    emit=print,
) -> dict:
    """Enrich the given news_feed rows (the rows this run inserted, plus the
    cards the page is currently showing) with Claude and Perplexity, inside the
    budget, and print one summary line.

    Selection: rows whose rule overall_significance >= `floor` and which carry
    no enrichment yet, the displayed cards first and then highest first, at
    most `per_hour` per rolling 60 minutes counted from ai_spend_ledger. Enrichment stops when `wall_seconds` have
    passed, and no call is made unless month-to-date spend plus its worst case
    fits within `monthly_cap` (one cap_reached ledger row per run otherwise).
    Every call is recorded in the ledger with its cost from usage. A quiet run
    (nothing above the floor) makes no HTTP call.

    `display_ids` are the cards the News tab would show (select_display_topups):
    they share this run's room and cap, and they take it first, so a busy hour
    cannot leave the page showing wire summaries. `keys` uses the
    fetch_and_store_news config names (anthropic_key, perplexity_key). `now`
    fixes the clock (default: real time, per row). `run_id` defaults to
    $GITHUB_RUN_ID. Returns the run's counts, including the printed "line".
    """
    run = _Run(conn, keys or {}, now, run_id if run_id is not None else ai_spend.current_run_id(), monthly_cap)
    stats = run.stats
    started = clock()
    try:
        ensure_ai_spend_ledger(conn)
        conn.commit()
        rows = _load_rows(conn, row_ids)
        stats["new"] = len(rows)
        displayed = {int(i) for i in (display_ids or [])}
        extra = displayed - {r["id"] for r in rows}
        rows += _load_rows(conn, extra)
        eligible = sorted((r for r in rows if _eligible(r, floor)), key=lambda r: _priority(r, displayed))
        stats["eligible"] = len(eligible)
        if eligible and stats["keys"]:
            room = max(0, per_hour - ai_spend.enrichments_in_last_hour(conn, run.now()))
            batch = eligible[:room]
            stats["held_hourly"] = len(eligible) - len(batch)
            regime, probs = _current_regime(conn)
            for i, row in enumerate(batch):
                if clock() - started > wall_seconds:
                    stats["held_time"] = len(batch) - i
                    break
                enriched_before = stats["enriched"]
                started_item = _enrich_one(run, row, regime, probs)
                # Count a top-up only once it has been read, so the summary line
                # cannot claim ten while eight were held for the hourly limit.
                if stats["enriched"] > enriched_before and row["id"] in extra:
                    stats["topped_up"] += 1
                if stats["cap_reached"]:
                    stats["skipped_cap"] = len(batch) - i - (1 if started_item else 0)
                    break
        stats["month_to_date_usd"] = ai_spend.month_to_date(conn, run.now())
    except sqlite3.Error as exc:
        # fail closed: without a readable, writable ledger no further call is made
        stats["ledger_error"] = type(exc).__name__
    stats["line"] = ai_spend.summary_line(stats)
    if emit:
        emit(stats["line"])
    return stats


# ── Main Orchestrator ─────────────────────────────────────────────────────────

def fetch_and_store_news(db_path: str, config: dict, *, now: datetime | None = None) -> int:
    """
    Full pipeline: fetch → deduplicate → drop future-dated → classify → score →
    store (insert first) → AI-enrich the rows new in this run and the cards the
    News tab is showing, inside the budget → prune headlines older than 7 days.
    Prints one AI summary line.

    Args:
        db_path: path to macro_radar.db
        config: dict with keys finnhub_key, newsapi_key, anthropic_key,
            perplexity_key
        now: fixes the clock (tests); default real time

    Returns:
        Number of new rows inserted.
    """
    at = ai_spend.as_utc(now)
    finnhub_key = config.get("finnhub_key", "")
    newsapi_key = config.get("newsapi_key", "")

    # 1. Fetch from all sources (Finnhub + NewsAPI need keys; RSS is keyless)
    finnhub_items = fetch_finnhub_news(finnhub_key)
    newsapi_items = fetch_newsapi_news(newsapi_key)
    rss_items     = fetch_rss_news()
    # future-dated first, so a bad-clock copy cannot displace a valid duplicate
    all_items = _deduplicate(drop_future_dated(finnhub_items + newsapi_items + rss_items, at))

    # 2. Store first; 3. enrich only what this run inserted; 4. prune news
    new_ids: list[int] = []
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        if all_items:
            current_regime, _ = _current_regime(conn)
            new_ids = store_new_items(conn, all_items, current_regime, now=at)
        # After storing, so a headline that just arrived can already be one of
        # the ten the page is about to show.
        enrich_new_rows(conn, new_ids, config, now=now, display_ids=select_display_topups(conn, now=at))
        if all_items:
            _prune_news(conn, at)
            conn.commit()
    except sqlite3.Error as exc:
        print(
            f"[news] WARNING: news storage failed ({type(exc).__name__}); "
            f"{len(new_ids)} new rows were stored before it",
            file=sys.stderr,
        )
    finally:
        if conn is not None:
            conn.close()
    return len(new_ids)
