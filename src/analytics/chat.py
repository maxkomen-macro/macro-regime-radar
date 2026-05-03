"""src/analytics/chat.py — Macro Regime Radar conversational AI agent.

Phase 12 of the project. Wraps the Anthropic SDK with a tool-use loop, a
read-only SQL guard, and tab-aware context. Designed to be embedded in the
Streamlit dashboard via `dashboard/components/chat_widget.py`, but importable
without Streamlit (tools that need session_state degrade gracefully).
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from src.config import DB_PATH, get_secret

# ── Anthropic SDK ─────────────────────────────────────────────────────────────
# Imported lazily so importing this module doesn't crash if the SDK is missing
# in some lightweight test environments — the SDK is a hard dep at runtime.
try:
    import anthropic
except ImportError:  # pragma: no cover
    anthropic = None  # type: ignore[assignment]


MODEL              = "claude-sonnet-4-5-20250929"
MAX_TOKENS         = 2000
MAX_TOOL_ITERATIONS = 10


# ── SQL guard ─────────────────────────────────────────────────────────────────

_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|replace|create|attach|detach|"
    r"vacuum|pragma|reindex|truncate)\b",
    re.IGNORECASE,
)


def is_safe_select(sql: str) -> bool:
    """Return True iff `sql` is a single read-only SELECT/CTE statement.

    Rejects anything with forbidden DDL/DML keywords, multiple statements,
    or non-SELECT openings. CTEs (`WITH ... SELECT`) are allowed.
    """
    if not isinstance(sql, str):
        return False
    s = sql.strip().rstrip(";").strip()
    if not s:
        return False
    # Reject statement chaining via `;` — by here at most one trailing `;`
    # has been stripped, so any remaining semicolons are interior.
    if ";" in s:
        return False
    if _FORBIDDEN_KEYWORDS.search(s):
        return False
    # Must start with SELECT or WITH (CTE → SELECT)
    head = s.lstrip().split(None, 1)[0].lower()
    return head in ("select", "with")


# ── DB helpers ────────────────────────────────────────────────────────────────

def _ro_conn(db_path: Path = DB_PATH) -> sqlite3.Connection:
    """Open SQLite in read-only mode via URI."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


# ── Tool implementations ──────────────────────────────────────────────────────

def _tool_query_database(sql: str) -> dict[str, Any]:
    if not is_safe_select(sql):
        return {"error": "SQL guard: only single-statement SELECT (or WITH ... SELECT) queries are permitted."}
    try:
        with _ro_conn() as conn:
            cur = conn.execute(sql)
            rows = cur.fetchmany(200)  # cap at 200 rows
            cols = [d[0] for d in cur.description] if cur.description else []
        return {"columns": cols, "rows": _rows_to_dicts(rows), "row_count": len(rows)}
    except sqlite3.Error as exc:
        return {"error": f"SQL error: {exc}"}


def _tool_get_current_regime() -> dict[str, Any]:
    with _ro_conn() as conn:
        row = conn.execute(
            "SELECT date, label, confidence, growth_trend, inflation_trend, "
            "prob_goldilocks, prob_overheating, prob_stagflation, prob_recession "
            "FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else {"error": "No regime data."}


def _tool_get_signal_status(signal_name: str | None = None) -> dict[str, Any]:
    with _ro_conn() as conn:
        if signal_name:
            rows = conn.execute(
                "SELECT date, signal_name, value, triggered FROM signals "
                "WHERE signal_name = ? ORDER BY date DESC LIMIT 1",
                (signal_name,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT date, signal_name, value, triggered FROM signals s1 "
                "WHERE date = (SELECT MAX(date) FROM signals s2 "
                "WHERE s2.signal_name = s1.signal_name) "
                "ORDER BY signal_name"
            ).fetchall()
    return {"signals": _rows_to_dicts(rows)}


def _tool_get_recession_probability() -> dict[str, Any]:
    with _ro_conn() as conn:
        rows = conn.execute(
            "SELECT date, prob_recession FROM regimes "
            "WHERE prob_recession IS NOT NULL ORDER BY date DESC LIMIT 7"
        ).fetchall()
    if not rows:
        return {"error": "No recession probability data."}
    rec = _rows_to_dicts(rows)
    latest = rec[0]
    return {
        "latest_date":     latest["date"],
        "prob_now":        latest["prob_recession"],
        "prob_1m_ago":     rec[1]["prob_recession"] if len(rec) > 1 else None,
        "prob_3m_ago":     rec[3]["prob_recession"] if len(rec) > 3 else None,
        "prob_6m_ago":     rec[6]["prob_recession"] if len(rec) > 6 else None,
    }


def _latest_series(conn: sqlite3.Connection, series_id: str) -> tuple[str | None, float | None]:
    row = conn.execute(
        "SELECT date, value FROM raw_series WHERE series_id = ? "
        "ORDER BY date DESC LIMIT 1",
        (series_id,),
    ).fetchone()
    if not row:
        return (None, None)
    return (row["date"], row["value"])


def _tool_get_credit_snapshot() -> dict[str, Any]:
    """Return latest IG/HY/CCC OAS plus 10y/30y proxies. Values in percent (× 100 for bps)."""
    out: dict[str, Any] = {}
    with _ro_conn() as conn:
        for key, sid in [
            ("ig_oas",  "BAMLC0A0CM"),
            ("hy_oas",  "BAMLH0A0HYM2"),
            ("ccc_oas", "BAMLH0A3HYC"),
            ("bb_oas",  "BAMLH0A1HYBB"),
            ("b_oas",   "BAMLH0A2HYB"),
            ("ust_10y", "DGS10"),
        ]:
            d, v = _latest_series(conn, sid)
            out[key] = {"date": d, "value_pct": v, "value_bps": (v * 100 if v is not None else None)}
    return out


def _tool_get_market_snapshot(ticker: str) -> dict[str, Any]:
    sym = (ticker or "").strip().upper()
    if not sym:
        return {"error": "ticker required"}
    with _ro_conn() as conn:
        rows = conn.execute(
            "SELECT date, close FROM market_daily WHERE symbol = ? "
            "ORDER BY date DESC LIMIT 260",
            (sym,),
        ).fetchall()
    if not rows:
        return {"error": f"No market_daily rows for {sym}."}
    closes = [r["close"] for r in rows]
    dates  = [r["date"]  for r in rows]
    px = closes[0]

    def ret(idx: int) -> float | None:
        if idx >= len(closes) or closes[idx] in (0, None):
            return None
        return (px / closes[idx] - 1) * 100

    # YTD: find first close in current year
    cur_year = dates[0][:4]
    ytd_close = next((c for c, d in zip(closes, dates) if d[:4] != cur_year), None)
    ret_ytd = ((px / ytd_close - 1) * 100) if ytd_close else None

    return {
        "symbol":       sym,
        "as_of":        dates[0],
        "price":        px,
        "ret_1d_pct":   ret(1),
        "ret_5d_pct":   ret(5),
        "ret_1m_pct":   ret(21),
        "ret_ytd_pct":  ret_ytd,
    }


def _tool_get_recent_headlines(limit: int = 5, min_significance: int = 3) -> dict[str, Any]:
    limit = max(1, min(int(limit or 5), 25))
    min_sig = max(0, min(int(min_significance or 3), 5))
    with _ro_conn() as conn:
        rows = conn.execute(
            "SELECT published_at, headline, source, category, overall_significance, "
            "regime_interpretation, perplexity_research, url "
            "FROM news_feed WHERE overall_significance >= ? "
            "ORDER BY published_at DESC LIMIT ?",
            (min_sig, limit),
        ).fetchall()
    return {"headlines": _rows_to_dicts(rows)}


def _tool_explain_current_view() -> dict[str, Any]:
    """Read tab context from Streamlit session state. Empty dict if unavailable."""
    try:
        import streamlit as st
        ctx = st.session_state.get("current_tab_context")
        if not ctx:
            return {"tab": "unknown", "note": "No tab context registered for the current view."}
        return ctx
    except Exception:
        return {"tab": "unknown", "note": "Streamlit session state unavailable."}


_TOOL_IMPLS: dict[str, Any] = {
    "query_database":            _tool_query_database,
    "get_current_regime":        _tool_get_current_regime,
    "get_signal_status":         _tool_get_signal_status,
    "get_recession_probability": _tool_get_recession_probability,
    "get_credit_snapshot":       _tool_get_credit_snapshot,
    "get_market_snapshot":       _tool_get_market_snapshot,
    "get_recent_headlines":      _tool_get_recent_headlines,
    "explain_current_view":      _tool_explain_current_view,
}


# ── Tool definitions (Anthropic SDK schema) ───────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_database",
        "description": (
            "Run a single read-only SELECT query against the macro_radar SQLite DB. "
            "Tables: raw_series(series_id,date,value), regimes(date,label,confidence,"
            "growth_trend,inflation_trend,prob_goldilocks,prob_overheating,prob_stagflation,"
            "prob_recession), signals(date,signal_name,value,triggered), market_daily(symbol,"
            "date,open,high,low,close,volume), market_intraday, derived_metrics(name,date,"
            "value), alert_feed, backtest_results(test_name,cohort,horizon,metric,value), "
            "event_calendar(event_name,event_datetime,importance), news_feed(headline,summary,"
            "url,source,category,published_at,overall_significance,regime_interpretation,"
            "perplexity_research), factor_data(date,mkt_rf,smb,hml,rmw,cma,rf). "
            "Only SELECT (or WITH ... SELECT) is allowed; capped at 200 rows."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"sql": {"type": "string", "description": "Single SELECT statement."}},
            "required": ["sql"],
        },
    },
    {
        "name": "get_current_regime",
        "description": "Latest regime row: label, confidence, growth/inflation trends, and 4 probabilities.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_signal_status",
        "description": (
            "Latest signal rows. Pass signal_name to filter; omit for all signals. "
            "Signals: yield_curve_inversion, unemployment_spike, cpi_hot, cpi_cold, vix_spike."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"signal_name": {"type": "string"}},
        },
    },
    {
        "name": "get_recession_probability",
        "description": "Latest recession probability and 1m / 3m / 6m prior values for trend.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_credit_snapshot",
        "description": (
            "Latest credit spreads (IG/HY/CCC/BB/B OAS) and the 10Y UST. "
            "Values returned in both percent and basis points."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_market_snapshot",
        "description": "Latest price + 1d/5d/1m/YTD return for a ticker (e.g. SPY, QQQ, TLT, GLD, VIX).",
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "get_recent_headlines",
        "description": (
            "Top recent news headlines with overall_significance >= min_significance. "
            "Each item includes regime_interpretation (Claude) and perplexity_research (cited)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit":            {"type": "integer", "minimum": 1, "maximum": 25, "default": 5},
                "min_significance": {"type": "integer", "minimum": 0, "maximum": 5, "default": 3},
            },
        },
    },
    {
        "name": "explain_current_view",
        "description": (
            "Return the tab the user is currently viewing and its headline metrics dict. "
            "Call this BEFORE answering any 'explain this tab / what am I looking at / this chart' question."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are the Macro Regime Radar AI Analyst — a senior macro/markets analyst embedded in a Bloomberg-terminal-style dashboard. Voice: concise, declarative, data-grounded. Default to 2–4 sentences unless explicitly asked to elaborate.

OPERATING PRINCIPLES
1. Never fabricate numbers. Every numeric claim must come from a tool call this turn.
2. Cite the source after each metric, e.g. "IG OAS at 81bps (BAMLC0A0CM, 2026-04-01)" or "(regimes table, latest)".
3. The user is viewing a specific tab. Call explain_current_view BEFORE answering "what am I looking at" / "explain this tab" / "this chart" questions.
4. For broad questions (current regime, recession risk, headlines), combine get_current_regime / get_recession_probability / get_recent_headlines as needed.
5. Refuse politely if asked to write to the database or run non-SELECT SQL — the query_database tool will reject it anyway.
6. If a tool returns empty/error, say so plainly — do not guess.
7. Don't list every tool call you made. Just answer.

CURRENT DASHBOARD STATE (refreshed each turn)
{state_snapshot}
"""


def _build_state_snapshot() -> str:
    """One-paragraph current state injected into the system prompt each turn."""
    parts: list[str] = []
    try:
        regime = _tool_get_current_regime()
        if "error" not in regime:
            label = regime.get("label", "?")
            probs = {
                "GL": regime.get("prob_goldilocks"),
                "OV": regime.get("prob_overheating"),
                "ST": regime.get("prob_stagflation"),
                "RR": regime.get("prob_recession"),
            }
            top_prob = max((p for p in probs.values() if p is not None), default=None)
            top_str = f" ({top_prob:.0%})" if top_prob is not None else ""
            parts.append(f"Regime: {label}{top_str} as of {regime.get('date','?')}")
    except Exception:
        pass
    try:
        rec = _tool_get_recession_probability()
        if "error" not in rec and rec.get("prob_now") is not None:
            parts.append(f"Recession prob: {rec['prob_now']:.0%}")
    except Exception:
        pass
    try:
        sig = _tool_get_signal_status()
        triggered = [s["signal_name"] for s in sig.get("signals", []) if s.get("triggered")]
        if triggered:
            parts.append("Triggered signals: " + ", ".join(triggered))
        else:
            parts.append("Triggered signals: none")
    except Exception:
        pass
    try:
        ctx = _tool_explain_current_view()
        tab = ctx.get("tab", "unknown")
        parts.append(f"User is viewing tab: {tab}")
    except Exception:
        pass
    return " · ".join(parts) if parts else "(state unavailable)"


# ── Agent ─────────────────────────────────────────────────────────────────────

class AgentError(Exception):
    """Raised for unrecoverable agent errors surfaced to the UI."""


class RateLimited(AgentError):
    """Raised when the upstream API rate-limits us."""


class NetworkError(AgentError):
    """Raised on connection issues talking to the upstream API."""


# Cap conversation history sent to the API to avoid runaway costs.
HISTORY_TURN_LIMIT = 20


class MacroRadarAgent:
    """Anthropic-backed agent with tool-use loop and SQL guard."""

    def __init__(self, api_key: str | None = None, model: str = MODEL):
        if anthropic is None:
            raise AgentError("anthropic SDK not installed.")
        self.api_key = api_key or get_secret("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise AgentError("ANTHROPIC_API_KEY not configured.")
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model  = model

    # ── Public API ──────────────────────────────────────────────────────────

    def ask(self, user_msg: str, history: list[dict] | None = None) -> str:
        """Synchronous: run the loop and return the final assistant text."""
        chunks = list(self.ask_streaming(user_msg, history))
        return "".join(chunks)

    def ask_streaming(
        self,
        user_msg: str,
        history: list[dict] | None = None,
    ) -> Iterator[str]:
        """Generator yielding text chunks from the final assistant turn.

        The tool-use loop runs eagerly; whenever the model emits text on its way
        to the final answer, those chunks are yielded too (typical end-state).
        """
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(state_snapshot=_build_state_snapshot())
        # Trim history to the last N turns (each user/assistant pair = 2 entries).
        trimmed = list(history or [])[-HISTORY_TURN_LIMIT * 2:]
        messages: list[dict] = trimmed
        messages.append({"role": "user", "content": user_msg})

        for _iteration in range(MAX_TOOL_ITERATIONS):
            try:
                with self.client.messages.stream(
                    model=self.model,
                    max_tokens=MAX_TOKENS,
                    system=system_prompt,
                    tools=TOOLS,
                    messages=messages,
                ) as stream:
                    for event in stream:
                        if getattr(event, "type", None) == "text":
                            yield event.text
                    final = stream.get_final_message()
            except anthropic.RateLimitError as exc:
                raise RateLimited("Hit a rate limit — try again in a moment.") from exc
            except anthropic.APIConnectionError as exc:
                raise NetworkError("AI service unreachable. Please retry.") from exc
            except anthropic.APIStatusError as exc:
                raise AgentError(f"Anthropic API error: {exc}") from exc

            self._record_usage(final)

            assistant_blocks = [b.model_dump() for b in final.content]
            messages.append({"role": "assistant", "content": assistant_blocks})

            if final.stop_reason != "tool_use":
                return

            tool_results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue
                name = block.name
                args = block.input or {}
                self._log_tool_call(name, args)
                try:
                    impl = _TOOL_IMPLS.get(name)
                    if impl is None:
                        result_obj: Any = {"error": f"Unknown tool: {name}"}
                        is_error = True
                    else:
                        result_obj = impl(**args) if args else impl()
                        is_error = isinstance(result_obj, dict) and "error" in result_obj
                except Exception as exc:  # noqa: BLE001
                    result_obj = {"error": f"{name} failed: {exc}"}
                    is_error = True
                tool_results.append({
                    "type":         "tool_result",
                    "tool_use_id":  block.id,
                    "content":      _stringify(result_obj),
                    "is_error":     is_error,
                })
            messages.append({"role": "user", "content": tool_results})

        # Loop exhausted
        yield "\n\n_(I wasn't able to complete that request within the tool-call budget.)_"

    # ── Internal helpers ────────────────────────────────────────────────────

    def _log_tool_call(self, name: str, args: dict) -> None:
        try:
            import streamlit as st
            log = st.session_state.setdefault("chat_tool_log", [])
            log.append({"tool": name, "args": args})
        except Exception:
            pass

    def _record_usage(self, message: Any) -> None:
        try:
            import streamlit as st
            usage = getattr(message, "usage", None)
            if usage is None:
                return
            log = st.session_state.setdefault("chat_token_log", {"input": 0, "output": 0})
            log["input"]  += getattr(usage, "input_tokens", 0)  or 0
            log["output"] += getattr(usage, "output_tokens", 0) or 0
        except Exception:
            pass


def _stringify(obj: Any) -> str:
    """Tool-result content must be a string for the Anthropic API."""
    import json
    try:
        return json.dumps(obj, default=str, ensure_ascii=False)
    except Exception:
        return str(obj)
