"""tests/test_assistant_budget.py — the assistant's hard daily spend ceiling.

The assistant is open to the public on the launch deploy, so the ceiling is
what stands between a visitor and the owner's Anthropic bill. These tests pin:
the day's sum, the resting state, that no model call is made once the day is
spent, and (verify loop 1) that every call is paid for before it is made: a
visitor who hangs up, a stream that fails part-way and questions that arrive
together can no longer carry the day past the cap, and a ledger that cannot
be written rests the analyst instead of letting it spend uncounted.

Nothing here calls Anthropic: the agent's client is a stub and the ledger is a
scratch file in tmp_path.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from api import assistant_budget as budget
from api.main import app
from src.analytics import ai_spend
from src.db_helpers import ensure_ai_spend_ledger

client = TestClient(app)


@pytest.fixture()
def ledger(tmp_path, monkeypatch):
    """A scratch ledger file, installed as the assistant's."""
    path = tmp_path / "assistant_spend.db"
    monkeypatch.setattr(budget, "LEDGER_PATH", path)
    budget.reset_for_tests()
    yield path
    budget.reset_for_tests()


def _seed(path, cost_usd: float, *, when: datetime | None = None) -> None:
    conn = sqlite3.connect(path)
    try:
        ensure_ai_spend_ledger(conn)
        ai_spend.record(
            conn,
            provider="anthropic",
            purpose="assistant_ask",
            status="ok",
            now=when,
            model="claude-sonnet-4-5-20250929",
            priced={**ai_spend.unpriced(), "cost_usd": cost_usd, "cost_source": "usage"},
        )
    finally:
        conn.close()


# ── the day's sum ────────────────────────────────────────────────────────────


def test_the_day_sum_counts_only_the_current_utc_day(ledger):
    now = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
    _seed(ledger, 0.20, when=now)
    _seed(ledger, 0.05, when=now - timedelta(hours=6))
    _seed(ledger, 9.00, when=now - timedelta(days=1))  # yesterday, ignored
    assert budget.spent_today(now) == pytest.approx(0.25)


def test_the_reserve_is_one_call_priced_at_the_model_rate():
    """The reserve is what one more call could cost, so the ceiling is hard
    rather than 'hard until the last answer'."""
    expected = (
        budget.RESERVE_INPUT_TOKENS * ai_spend.SONNET_CACHE_WRITE_USD_PER_MTOK
        + budget.RESERVE_OUTPUT_TOKENS * ai_spend.SONNET_OUTPUT_USD_PER_MTOK
    ) / 1_000_000
    assert budget.reserve_usd() == pytest.approx(expected)
    assert 0 < budget.reserve_usd() < budget.daily_cap_usd()


# ── the resting state ────────────────────────────────────────────────────────


def test_state_rests_once_the_day_reaches_the_cap(ledger):
    now = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
    state = budget.state(now)
    assert state["resting"] is False and state["spent_usd"] == 0.0
    assert state["cap_usd"] == budget.daily_cap_usd()
    _seed(ledger, budget.daily_cap_usd(), when=now)
    state = budget.state(now)
    assert state["resting"] is True
    assert state["resets_at"] == "2026-09-22T00:00:00Z"


def test_state_rests_while_one_more_call_would_cross_the_cap(ledger):
    """A question is refused before the call that would cross the line, not
    after: the ceiling can never be exceeded by a call this server started."""
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    _seed(ledger, budget.daily_cap_usd() - budget.reserve_usd() / 2, when=now)
    assert budget.state(now)["resting"] is True


def test_an_unreadable_ledger_rests_rather_than_spending_blind(tmp_path, monkeypatch):
    """Fail closed: without a ledger the server cannot count the day's spend,
    so it must not call the model at all."""
    blocked = tmp_path / "blocked"
    blocked.write_text("a file where the ledger's directory should be")
    monkeypatch.setattr(budget, "LEDGER_PATH", blocked / "spend.db")
    budget.reset_for_tests()
    state = budget.state()
    assert state["resting"] is True and state["ledger"] != "ok"
    assert state["spent_usd"] is None and state["reason"]
    budget.reset_for_tests()


# ── the endpoint ─────────────────────────────────────────────────────────────


class _StubAgent:
    """Records whether the model was reached at all."""

    def __init__(self) -> None:
        self.calls = 0

    def ask_streaming(self, user_msg, history=None):
        self.calls += 1
        yield "hello"


def test_no_model_call_once_the_day_is_spent(ledger, monkeypatch):
    import api.chat as api_chat

    now = datetime.now(timezone.utc)
    _seed(ledger, budget.daily_cap_usd(), when=now)
    stub = _StubAgent()
    monkeypatch.setattr(api_chat, "_agent", stub)

    r = client.post("/api/assistant/ask", json={"message": "hi", "history": []})

    assert r.status_code == 200
    assert stub.calls == 0, "the agent must not be reached while resting"
    body = r.text
    assert "event: resting" in body
    assert "event: error" not in body
    assert body.rstrip().endswith("event: done\ndata: {}")
    frame = json.loads(body.split("event: resting\ndata: ", 1)[1].split("\n\n", 1)[0])
    assert "resting" in frame["message"].lower() and frame["resets_at"].endswith("Z")


def test_a_question_below_the_cap_still_answers(ledger, monkeypatch):
    import api.chat as api_chat

    stub = _StubAgent()
    monkeypatch.setattr(api_chat, "_agent", stub)
    r = client.post("/api/assistant/ask", json={"message": "hi", "history": []})
    assert r.status_code == 200 and stub.calls == 1
    assert 'data: {"delta": "hello"}' in r.text
    assert "event: resting" not in r.text


def test_status_reports_the_day_and_the_reset(ledger):
    r = client.get("/api/assistant/status")
    assert r.status_code == 200
    body = r.json()
    assert body["resting"] is False
    assert body["cap_usd"] == budget.daily_cap_usd()
    assert body["spent_usd"] == 0.0
    _seed(ledger, budget.daily_cap_usd())
    body = client.get("/api/assistant/status").json()
    assert body["resting"] is True and body["spent_usd"] >= body["cap_usd"]


# ── a scripted Anthropic client for the real agent loop ─────────────────────

import threading  # noqa: E402

import anthropic  # noqa: E402
import httpx  # noqa: E402

from src.analytics import chat as chat_mod  # noqa: E402

MODEL = chat_mod.MODEL


class _Text:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class _Usage:
    def __init__(self, inp: int, out: int) -> None:
        self.input_tokens = inp
        self.output_tokens = out
        self.cache_creation_input_tokens = 0
        self.cache_read_input_tokens = 0


class _TextBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text

    def model_dump(self) -> dict:
        return {"type": "text", "text": self.text}


class _ToolBlock:
    type = "tool_use"

    def __init__(self, name: str, id_: str = "toolu_1") -> None:
        self.name, self.id, self.input = name, id_, {}

    def model_dump(self) -> dict:
        return {"type": "tool_use", "id": self.id, "name": self.name, "input": self.input}


class _Final:
    def __init__(self, stop_reason: str, content: list, usage: _Usage) -> None:
        self.stop_reason, self.content, self.usage, self.model = stop_reason, content, usage, MODEL


def _answer(text: str = "an answer", inp: int = 1_000, out: int = 100) -> dict:
    return {"texts": [text], "final": _Final("end_turn", [_TextBlock(text)], _Usage(inp, out))}


def _tool_turn(name: str = "big_tool", inp: int = 1_000, out: int = 50) -> dict:
    return {"texts": [], "final": _Final("tool_use", [_ToolBlock(name)], _Usage(inp, out))}


class _Stream:
    def __init__(self, turn: dict, on_enter) -> None:
        self.turn, self.on_enter = turn, on_enter

    def __enter__(self):
        if self.on_enter:
            self.on_enter()
        if self.turn.get("raise_at_open") is not None:
            raise self.turn["raise_at_open"]
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        for text in self.turn.get("texts", []):
            yield _Text(text)
        if self.turn.get("raise_after_text") is not None:
            raise self.turn["raise_after_text"]

    def get_final_message(self):
        return self.turn["final"]


class _ScriptedClient:
    """Plays one scripted turn per model call and counts the calls made."""

    def __init__(self, turns: list[dict], on_enter=None) -> None:
        self.turns, self.on_enter, self.calls = list(turns), on_enter, 0
        self.messages = self
        self._lock = threading.Lock()

    def stream(self, **kwargs):
        with self._lock:
            self.calls += 1
            turn = self.turns.pop(0) if self.turns else _answer()
        return _Stream(turn, self.on_enter)


def _real_agent(monkeypatch, client: _ScriptedClient):
    agent = chat_mod.MacroRadarAgent.__new__(chat_mod.MacroRadarAgent)
    agent.client, agent.model = client, MODEL
    monkeypatch.setattr(chat_mod, "_build_state_snapshot", lambda: "snapshot")
    return agent


def _status_error(code: int, cls=anthropic.APIStatusError):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("upstream refused", response=httpx.Response(code, request=request), body=None)


def _rows(path) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT status, cost_usd, run_id, ts FROM ai_spend_ledger ORDER BY id").fetchall()
    finally:
        conn.close()


def _ask(message: str = "hi") -> list[str]:
    import api.chat as api_chat

    return list(api_chat._event_stream(api_chat.ChatRequest(message=message)))


# ── every call is reserved before it is made ─────────────────────────────────


def test_every_call_is_reserved_before_the_request_is_sent(ledger, monkeypatch):
    """The hold is in the ledger at the moment the stream opens: nothing the
    visitor or the network does afterwards can make the call free."""
    import api.chat as api_chat

    seen: list = []
    client_ = _ScriptedClient([_answer()], on_enter=lambda: seen.append(_rows(ledger)))
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    _ask()
    assert client_.calls == 1
    assert [r[0] for r in seen[0]] == ["reserved"], "the hold must be written before the request"
    assert seen[0][0][1] > 0


def test_an_answer_is_charged_its_real_cost_and_the_hold_released(ledger, monkeypatch):
    """The usage the SDK reports is priced at the model's published rates; the
    hold is released beside it, so the day carries exactly the real cost."""
    import api.chat as api_chat

    client_ = _ScriptedClient([_answer(inp=10_000, out=500)])
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    frames = _ask()
    assert any('"delta": "an answer"' in f for f in frames)

    expected = (10_000 * ai_spend.SONNET_INPUT_USD_PER_MTOK + 500 * ai_spend.SONNET_OUTPUT_USD_PER_MTOK) / 1_000_000
    assert budget.spent_today() == pytest.approx(expected, rel=1e-6)
    rows = _rows(ledger)
    assert [r[0] for r in rows] == ["reserved", "ok", "released"]
    assert rows[0][1] == pytest.approx(-rows[2][1]) and rows[0][1] > expected
    assert len({r[2] for r in rows}) == 1 and rows[0][2].startswith("assistant-hold:")
    conn = sqlite3.connect(ledger)
    try:
        ok = conn.execute("SELECT provider, purpose, model, input_tokens, output_tokens FROM ai_spend_ledger WHERE status = 'ok'").fetchone()
    finally:
        conn.close()
    assert ok == ("anthropic", "assistant_ask", MODEL, 10_000, 500)


def test_a_visitor_who_hangs_up_is_still_charged(ledger, monkeypatch):
    """Verify loop 1, defect 1: usage used to be recorded only after the full
    answer, so a visitor who closed the tab after the first words cost the
    owner money the ledger never saw. The hold stays charged."""
    import api.chat as api_chat

    long_answer = {"texts": ["first words", " more", " and more"], "final": _Final("end_turn", [], _Usage(1_000, 2_000))}
    client_ = _ScriptedClient([long_answer])
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    gen = api_chat._event_stream(api_chat.ChatRequest(message="hi"))
    assert '"delta": "first words"' in next(gen)
    gen.close()  # the visitor hangs up

    rows = _rows(ledger)
    assert [r[0] for r in rows] == ["reserved"]
    assert budget.spent_today() == pytest.approx(rows[0][1]) and rows[0][1] > 0


def test_an_error_after_the_answer_began_keeps_the_hold(ledger, monkeypatch):
    """Anthropic may already have billed a stream that fails part-way; the
    ledger keeps the call's worst case rather than guessing zero."""
    import api.chat as api_chat

    turn = {"texts": ["partial"], "raise_after_text": _status_error(200), "final": None}
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, _ScriptedClient([turn])))
    frames = _ask()
    assert any(f.startswith("event: error") for f in frames)
    rows = _rows(ledger)
    assert [r[0] for r in rows] == ["reserved"] and budget.spent_today() == pytest.approx(rows[0][1])


@pytest.mark.parametrize("error", [_status_error(529), _status_error(429, anthropic.RateLimitError), _status_error(400)])
def test_a_request_refused_before_streaming_is_released(ledger, monkeypatch, error):
    """An HTTP error status before any event means Anthropic refused the
    request, and it bills nothing for it: the hold is released."""
    import api.chat as api_chat

    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, _ScriptedClient([{"raise_at_open": error}])))
    frames = _ask()
    assert any(f.startswith("event: error") for f in frames)
    assert [r[0] for r in _rows(ledger)] == ["reserved", "released"]
    assert budget.spent_today() == pytest.approx(0.0, abs=1e-12)


# ── the cap cannot be crossed ────────────────────────────────────────────────


def test_concurrent_reservations_never_cross_the_cap(ledger):
    """Verify loop 1, defect 2: three questions arriving together each saw
    room for one call. The check and the hold are one write transaction."""
    amount = 0.10
    _seed(ledger, budget.daily_cap_usd() - 1.5 * amount)
    barrier = threading.Barrier(8)
    holds: list = []

    def take():
        barrier.wait()
        holds.append(budget.reserve(amount))

    threads = [threading.Thread(target=take) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert sum(h is not None for h in holds) == 1
    assert budget.spent_today() <= budget.daily_cap_usd() + 1e-9


def test_three_simultaneous_questions_with_room_for_one(ledger, monkeypatch):
    """End to end: with room for one call, one question reaches the model and
    the other two see the resting state, never an error."""
    import api.chat as api_chat

    monkeypatch.setattr(chat_mod, "prompt_token_bound", lambda *a, **k: 10_000)
    one_call = budget.call_worst_case_usd(10_000, chat_mod.MAX_TOKENS)
    _seed(ledger, budget.daily_cap_usd() - 1.5 * one_call)

    inside = threading.Event()
    release = threading.Event()

    def on_enter():
        inside.set()
        release.wait(10)

    client_ = _ScriptedClient([_answer(), _answer(), _answer()], on_enter=on_enter)
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    bodies: list[str] = []

    def ask():
        bodies.append("".join(_ask()))

    threads = [threading.Thread(target=ask) for _ in range(3)]
    for t in threads:
        t.start()
    assert inside.wait(10)
    deadline = __import__("time").monotonic() + 10
    while len(bodies) < 2 and __import__("time").monotonic() < deadline:
        __import__("time").sleep(0.01)
    release.set()
    for t in threads:
        t.join(10)
    assert client_.calls == 1
    assert sum("event: resting" in b for b in bodies) == 2
    assert not any("event: error" in b for b in bodies)
    assert budget.spent_today() <= budget.daily_cap_usd() + 1e-9


def test_the_prompt_bound_counts_bytes_not_characters():
    """One token per UTF-8 byte of the request, plus the API's framing: a
    byte-level token covers at least one byte, so this is an upper bound."""
    ascii_msgs = [{"role": "user", "content": "x" * 10_000}]
    wide_msgs = [{"role": "user", "content": "日" * 10_000}]  # three bytes each
    a = chat_mod.prompt_token_bound("sys", [], ascii_msgs)
    w = chat_mod.prompt_token_bound("sys", [], wide_msgs)
    assert a >= 10_000 + chat_mod.PROMPT_FRAMING_TOKENS
    assert w >= 30_000 + chat_mod.PROMPT_FRAMING_TOKENS
    blocks = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "r"}] * 5}]
    assert chat_mod.prompt_token_bound("sys", [], blocks) >= 5 * chat_mod.BLOCK_FRAMING_TOKENS


def test_a_large_tool_result_is_priced_before_the_next_call(ledger, monkeypatch):
    """Verify loop 1, defect 2: a 200-row SELECT of wide rows is ~140k
    characters, far past the old flat reserve. The next call is priced with
    it in the prompt, so a day that cannot pay for it stops first."""
    import api.chat as api_chat

    huge = "x" * 141_610
    monkeypatch.setitem(chat_mod._TOOL_IMPLS, "big_tool", lambda: huge)
    first_call = budget.call_worst_case_usd(chat_mod.prompt_token_bound(
        chat_mod.SYSTEM_PROMPT_TEMPLATE.format(state_snapshot="snapshot"), chat_mod.TOOLS,
        [{"role": "user", "content": "hi"}]), chat_mod.MAX_TOKENS)
    # Room for the first call and change, not for a prompt carrying the result.
    _seed(ledger, budget.daily_cap_usd() - first_call - 0.10)
    client_ = _ScriptedClient([_tool_turn(), _answer()])
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    frames = _ask()
    assert client_.calls == 1, "the second call could not be paid for and must not be made"
    assert any("budget is spent" in f for f in frames)
    assert budget.spent_today() <= budget.daily_cap_usd() + 1e-9


def test_a_first_call_the_day_cannot_cover_rests_instead_of_erroring(ledger, monkeypatch):
    """The chip said there was room, but this question's own worst case does
    not fit: the visitor sees the resting state and nothing reaches Anthropic."""
    import api.chat as api_chat

    monkeypatch.setattr(chat_mod, "prompt_token_bound", lambda *a, **k: 100_000)
    _seed(ledger, budget.daily_cap_usd() - 2 * budget.reserve_usd())
    assert budget.state()["resting"] is False
    client_ = _ScriptedClient([_answer()])
    monkeypatch.setattr(api_chat, "_agent", _real_agent(monkeypatch, client_))
    body = "".join(_ask())
    assert client_.calls == 0
    assert "event: resting" in body and "event: error" not in body


def test_the_tool_loop_stops_when_the_budget_runs_out_mid_answer(monkeypatch):
    """A question that keeps calling tools cannot run the day past the cap:
    every further model call needs its own hold."""
    granted: list = []

    class _Guard:
        def reserve(self, *, prompt_tokens, max_tokens):
            if granted:
                return None
            granted.append("hold")
            return "hold"

        def settle(self, hold, usage):
            pass

        def release(self, hold):
            pass

    monkeypatch.setitem(chat_mod._TOOL_IMPLS, "big_tool", lambda: "rows")
    client_ = _ScriptedClient([_tool_turn(), _answer()])
    agent = _real_agent(monkeypatch, client_)
    token = chat_mod.SPEND_GUARD.set(_Guard())
    try:
        out = "".join(agent.ask_streaming("hi", history=[]))
    finally:
        chat_mod.SPEND_GUARD.reset(token)
    assert client_.calls == 1, "the loop must stop instead of making a second paid call"
    assert out.endswith(chat_mod.BUDGET_STOP_NOTE)


def test_settlement_stays_on_the_day_the_call_started(ledger):
    """A call reserved at 23:59:59 and settled after midnight is charged to
    the day it started; the release cannot hand tomorrow extra room."""
    late = datetime(2026, 9, 21, 23, 59, 59, tzinfo=timezone.utc)
    hold = budget.reserve(0.05, now=late)
    assert hold is not None
    budget.settle(hold, {"input_tokens": 1_000, "output_tokens": 100, "model": MODEL})
    next_day = datetime(2026, 9, 22, 0, 0, 5, tzinfo=timezone.utc)
    assert budget.spent_today(next_day) == 0.0
    assert budget.spent_today(late) == pytest.approx((1_000 * 3.00 + 100 * 15.00) / 1_000_000)


# ── fail closed ──────────────────────────────────────────────────────────────


def test_a_read_only_ledger_rests_and_refuses_every_hold(ledger):
    """Verify loop 1, defect 3: a ledger that could be read but not written
    reported 'ok' while every record was silently dropped."""
    import os
    import stat

    _seed(ledger, 0.50)
    os.chmod(ledger, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    try:
        state = budget.state()
        assert state["resting"] is True and state["ledger"] == "read-only" and state["reason"]
        assert budget.reserve(0.01) is None
    finally:
        os.chmod(ledger, stat.S_IRUSR | stat.S_IWUSR)


def test_a_failed_write_rests_the_analyst(ledger, monkeypatch):
    """A full disk looks writable until the write fails: the failure itself
    rests the analyst for a while instead of being swallowed."""
    def full(*a, **k):
        raise sqlite3.OperationalError("database or disk is full")

    real_record = ai_spend.record
    monkeypatch.setattr(ai_spend, "record", full)
    assert budget.reserve(0.01) is None
    state = budget.state()
    assert state["resting"] is True and state["ledger"] == "unwritable"
    assert budget.reserve(0.01) is None, "a recent failure refuses holds without retrying the write"
    monkeypatch.setattr(ai_spend, "record", real_record)
    budget.reset_for_tests()  # the rest period is over
    assert budget.state()["ledger"] == "ok"
    assert budget.reserve(0.01) is not None


@pytest.mark.parametrize("raw, cap", [
    ("inf", 1.0), ("Infinity", 1.0), ("nan", 1.0), ("abc", 1.0), ("1,5", 1.0), ("", 1.0),
    ("-1", 0.0), ("-inf", 0.0), ("0", 0.0), ("2.5", 2.5),
])
def test_the_cap_must_be_a_finite_number(monkeypatch, raw, cap):
    """Verify loop 1, defect 4: `inf` turned the ceiling off."""
    monkeypatch.setenv("ASSISTANT_DAILY_CAP_USD", raw)
    assert budget.daily_cap_usd() == cap


def test_the_suite_never_touches_a_real_ledger():
    """Verify loop 1, defect 9: two API tests read the developer's own ledger
    and failed on a day it held spend. conftest points every test elsewhere."""
    from pathlib import Path

    repo_default = Path(budget.__file__).resolve().parent.parent / "data" / "assistant_spend.db"
    assert Path(budget.LEDGER_PATH).resolve() != repo_default.resolve()
