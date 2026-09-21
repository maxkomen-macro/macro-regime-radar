"""api/chat.py — Phase-12 assistant over HTTP (React-migration streaming step).

POST /api/assistant/ask — streams the agent's reply as Server-Sent Events.

Self-contained like the rest of api/: the heavy pieces (the anthropic SDK,
reached through src.analytics.chat) are imported lazily inside functions, so
importing this module pulls neither anthropic nor src.analytics.chat — and
src.analytics.chat itself no longer imports src.config, so no FRED_API_KEY is
required anywhere on this path.

Frame contract (error strings mirror dashboard/components/chat_widget.py):

    data: {"delta": "<chunk>"}\n\n                 — one text chunk
    event: error\ndata: {"message": "<msg>"}\n\n   — terminal error
    event: done\ndata: {}\n\n                      — always the final frame
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api import assistant_budget as budget

log = logging.getLogger("mrr.assistant")
router = APIRouter(prefix="/api/assistant")


# ── Request models ────────────────────────────────────────────────────────────

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)  # "" would be a token spend for nothing
    history: list[ChatTurn] = Field(default_factory=list)
    tab_context: dict[str, Any] | None = None


# ── Agent singleton (mirrors the dashboard's @st.cache_resource) ──────────────

_agent = None
_agent_lock = threading.Lock()


def _get_agent():
    """Create-or-return the process-wide MacroRadarAgent.

    The import is lazy — this is the first point at which anthropic is pulled
    in. Construction failures (missing SDK, missing ANTHROPIC_API_KEY) raise
    AgentError, which the stream turns into an SSE error frame.
    """
    global _agent
    with _agent_lock:
        if _agent is None:
            from src.analytics.chat import MacroRadarAgent
            _agent = MacroRadarAgent()
        return _agent


# ── SSE framing ───────────────────────────────────────────────────────────────

def _sse(payload: dict, event: str | None = None) -> str:
    frame = f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
    if event:
        frame = f"event: {event}\n{frame}"
    return frame


def _resting_stream(state: dict) -> Iterator[str]:
    """The day's ceiling is reached: a plain resting state, never an error
    frame (launch-1). No agent is constructed and no model call is made."""
    yield _sse({"message": state.get("reason") or budget.RESTING_MESSAGE, "resets_at": state["resets_at"]}, event="resting")
    yield _sse({}, event="done")


class _LedgerGuard:
    """The agent's spend guard on the API (launch-1): every model call is held
    in the ledger at its worst case before it is made, then settled at its real
    cost or released (api/assistant_budget.py)."""

    def reserve(self, *, prompt_tokens: int, max_tokens: int):
        return budget.reserve(budget.call_worst_case_usd(prompt_tokens, max_tokens))

    def settle(self, hold, usage: dict) -> None:
        budget.settle(hold, usage, model=usage.get("model"))

    def release(self, hold) -> None:
        budget.release(hold)


_GUARD = _LedgerGuard()


def _event_stream(req: ChatRequest) -> Iterator[str]:
    """Synchronous SSE generator over MacroRadarAgent.ask_streaming.

    The tab-context ContextVar is (re)set around every pull from the agent
    generator rather than once up front: Starlette resumes a sync body
    iterator via the threadpool, and each resume runs in a fresh copy of the
    request context — a single set() during the first resume would not be
    visible to the tool calls that execute during later resumes. The spend
    guard (launch-1) rides the same resets.
    """
    from src.analytics import chat  # lazy — pulls the anthropic SDK

    try:
        agent = _get_agent()
        history = [turn.model_dump() for turn in req.history]
        pull = agent.ask_streaming(req.message, history=history)
        while True:
            token = chat.TAB_CONTEXT.set(req.tab_context)
            guard = chat.SPEND_GUARD.set(_GUARD)
            try:
                chunk = next(pull)
            except StopIteration:
                break
            finally:
                chat.TAB_CONTEXT.reset(token)
                chat.SPEND_GUARD.reset(guard)
            yield _sse({"delta": chunk})
    except chat.BudgetExhausted:
        # The chip had room, but this answer's first call does not fit what
        # is left of the day, or another question took it first: the same
        # plain resting state, never an error.
        budget.note_cap_reached()
        yield _sse({"message": budget.RESTING_MESSAGE, "resets_at": budget.state()["resets_at"]}, event="resting")
    except chat.RateLimited:
        yield _sse({"message": "_Hit a rate limit — try again in a moment._"}, event="error")
    except chat.NetworkError:
        yield _sse({"message": "_AI service unreachable. Please retry._"}, event="error")
    except chat.AgentError as exc:
        # The upstream text can carry a model id, a request id and the
        # provider's body; the visitor gets a sentence and the server keeps
        # the detail (launch-1, re-audit SR-2d).
        log.warning("assistant failed: %s", type(exc).__name__)
        yield _sse({"message": "_The AI analyst could not answer that just now. Please try again._"}, event="error")
    except Exception:  # noqa: BLE001 — last-resort guard, mirrors chat_widget.py
        yield _sse({"message": "_AI service temporarily unavailable. Please try again._"}, event="error")
    yield _sse({}, event="done")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/ask")
def assistant_ask(req: ChatRequest) -> StreamingResponse:
    """Stream the assistant's reply as SSE.

    Deliberately `def`, not `async def`: FastAPI runs sync routes and sync
    body iterators on the threadpool, so the event loop — and with it the
    EODHD WS relay — stays unblocked while the agent waits on Anthropic.

    The day's spend ceiling is checked first (launch-1): while it is reached
    the answer is a resting frame, and nothing reaches Anthropic.
    """
    state = budget.state()
    if state["resting"]:
        budget.note_cap_reached()
        body = _resting_stream(state)
    else:
        body = _event_stream(req)
    return StreamingResponse(
        body,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/status")
def assistant_status() -> dict:
    """What the assistant chip shows before a visitor asks anything: whether
    the analyst is awake, what today's budget has been spent on, and when it
    turns over. Costs and counts only, never a key or a conversation."""
    return budget.state()
