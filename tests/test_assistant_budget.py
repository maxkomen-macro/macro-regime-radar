"""tests/test_assistant_budget.py — the assistant's hard daily spend ceiling.

The assistant is open to the public on the launch deploy, so the ceiling is
what stands between a visitor and the owner's Anthropic bill. These tests pin:
the day's sum, the resting state, that no model call is made once the day is
spent, that the answer's cost lands in the ledger, and that a long answer
stops mid-loop rather than carrying the day past the cap.

Nothing here calls Anthropic: the agent is a stub and the ledger is a scratch
file in tmp_path.
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


# ── recording what an answer cost ────────────────────────────────────────────


def test_an_answer_records_its_cost_in_the_ledger(ledger, monkeypatch):
    """The usage the SDK reports is priced at the model's published rates and
    appended to the ledger, so the next question sees the spend."""
    import api.chat as api_chat
    from src.analytics import chat as chat_mod

    class _UsageAgent:
        def ask_streaming(self, user_msg, history=None):
            sink = chat_mod.USAGE_SINK.get()
            yield "one "
            if sink:
                sink({"input_tokens": 10_000, "output_tokens": 500, "model": "claude-sonnet-4-5-20250929"})
            yield "two"

    monkeypatch.setattr(api_chat, "_agent", _UsageAgent())
    assert budget.spent_today() == 0.0
    r = client.post("/api/assistant/ask", json={"message": "hi", "history": []})
    assert r.status_code == 200

    expected = (10_000 * ai_spend.SONNET_INPUT_USD_PER_MTOK + 500 * ai_spend.SONNET_OUTPUT_USD_PER_MTOK) / 1_000_000
    assert budget.spent_today() == pytest.approx(expected, rel=1e-6)
    conn = sqlite3.connect(ledger)
    try:
        row = conn.execute("SELECT provider, purpose, status, model, input_tokens, output_tokens FROM ai_spend_ledger").fetchone()
    finally:
        conn.close()
    assert row[:3] == ("anthropic", "assistant_ask", "ok")
    assert row[4] == 10_000 and row[5] == 500


# ── the mid-answer stop ──────────────────────────────────────────────────────


def test_the_tool_loop_stops_when_the_budget_runs_out_mid_answer(monkeypatch):
    """A question that keeps calling tools cannot run the day past the cap:
    the loop asks the gate before every further model call."""
    from src.analytics import chat as chat_mod

    calls = {"n": 0}

    class _Final:
        stop_reason = "tool_use"
        content: list = []
        usage = None

    class _Stream:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def __iter__(self):
            return iter(())

        def get_final_message(self):
            return _Final()

    class _Messages:
        def stream(self, **kwargs):
            calls["n"] += 1
            return _Stream()

    class _Client:
        messages = _Messages()

    agent = chat_mod.MacroRadarAgent.__new__(chat_mod.MacroRadarAgent)
    agent.client = _Client()
    agent.model = "claude-sonnet-4-5-20250929"
    monkeypatch.setattr(chat_mod, "_build_state_snapshot", lambda: "snapshot")
    monkeypatch.setattr(chat_mod, "_TOOL_IMPLS", {})

    token = chat_mod.BUDGET_GATE.set(lambda: False)  # out of budget after the first call
    try:
        list(agent.ask_streaming("hi", history=[]))
    finally:
        chat_mod.BUDGET_GATE.reset(token)

    assert calls["n"] == 1, "the loop must stop instead of making a second paid call"
