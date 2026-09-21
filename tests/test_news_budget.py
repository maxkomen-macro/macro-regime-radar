"""B4 (2026-09-18): news AI enrichment inside a $50/month budget.

The pipeline inserts first and enriches only rows that are new in this run,
above SIGNIFICANCE_FLOOR, at most ENRICH_PER_HOUR per rolling hour (counted
from the ledger, so the full mode's double pass cannot double spend), inside a
wall-clock budget, and never past MONTHLY_CAP_USD. Every call lands in the
append-only ai_spend_ledger with its cost from the provider's own usage.
Stored model text is capped at complete sentences.

No test touches the network: requests.post is a fake that answers like the
two providers (usage included) and requests.get fails the test if called. No
key may reach the ledger, the database file or stdout.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

from src.analytics import news
from src.db_helpers import ensure_news_table

NOW = datetime(2026, 9, 18, 14, 0, tzinfo=timezone.utc)
ANTHROPIC_KEY = "sk-ant-api03-TESTONLY-7f3a9c-DO-NOT-LOG"
PPLX_KEY = "pplx-TESTONLY-51b2e8-DO-NOT-LOG"
KEYS = {"finnhub_key": "", "newsapi_key": "", "anthropic_key": ANTHROPIC_KEY, "perplexity_key": PPLX_KEY}

# Rule-scored at or above the 2.5 floor when fresh (pinned below), distinct
# enough that the near-duplicate filter keeps every one.
HOT = [
    "Fed holds rates steady as core inflation sticks",
    "Fed officials signal patience on further cuts",
    "FOMC minutes reveal split over balance sheet runoff",
    "Emergency liquidity facility tapped by regional lenders",
    "Fed chair warns tariffs could lift goods prices",
    "FOMC dot plot shifts toward two cuts next year",
    "Fed governor backs gradual easing path",
    "Rate decision looms as payroll growth slows",
    "Fed balance sheet shrinks for tenth straight month",
    "FOMC statement drops reference to labor tightness",
    "Emergency meeting rumors rattle Treasury futures",
    "Fed survey shows lending standards tightening again",
    "Fed vice chair says neutral rate has moved higher",
    "FOMC members debate pace of quantitative tightening",
    "Fed staff forecast trims growth outlook",
    "Rate decision preview: markets price a hold",
    "Fed discount window borrowing jumps overnight",
    "FOMC hawks push back on September easing",
    "Emergency repo operation calms funding stress",
    "Fed reverse repo usage falls to multi-year low",
]
QUIET = [
    "Local bakery opens a second shop downtown",
    "City council approves new bike lanes",
    "Museum extends weekend opening hours",
]

INTERPRETATION = "Hawkish hold keeps the Overheating read intact. Duration sells off. Watch the 2s10s."
RESEARCH = (
    "The Fed held rates at 4.25–4.50%, and core PCE at 2.6% keeps the Overheating read alive.[1][2] "
    "U.S. Treasury yields rose 8 bp as futures priced fewer cuts[3]. "
    "Powell said the committee is in no hurry, e.g. waiting for two more CPI prints. "
    "Credit spreads were flat at 0.81%. "
    "Watch the Sept. 17 dot plot. "
    "Equities may"
)
RESEARCH_4 = (
    "The Fed held rates at 4.25–4.50%, and core PCE at 2.6% keeps the Overheating read alive.[1][2] "
    "U.S. Treasury yields rose 8 bp as futures priced fewer cuts[3]. "
    "Powell said the committee is in no hurry, e.g. waiting for two more CPI prints. "
    "Credit spreads were flat at 0.81%."
)
CITATIONS = [
    "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260917a.htm",
    "https://www.bls.gov/news.release/cpi.nr0.htm",
    "https://home.treasury.gov/resource-center/data-chart-center",
]
A_USAGE = {"input_tokens": 1180, "output_tokens": 142, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
A_COST = 0.00118 + 0.00071
P_USAGE = {
    "prompt_tokens": 96, "completion_tokens": 212, "total_tokens": 308, "search_context_size": "low",
    "cost": {"input_tokens_cost": 0.0001, "output_tokens_cost": 0.0002, "request_cost": 0.005, "total_cost": 0.0053},
}
P_COST = 0.0053
LEDGER_COLS = (
    "ts, month, provider, model, purpose, news_id, input_tokens, output_tokens, cache_write_tokens, "
    "cache_read_tokens, request_fee_usd, cost_usd, cost_source, status, http_status, run_id"
)


def spend():
    """src.analytics.ai_spend, imported on use so each test reports on its own."""
    from src.analytics import ai_spend

    return ai_spend


# ── fakes ─────────────────────────────────────────────────────────────────────


class FakeResponse:
    def __init__(self, status: int, payload: dict):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Client Error for url: https://example.invalid/v1", response=self)


def anthropic_ok(interpretation: str = INTERPRETATION, overall: float = 4.2, usage: dict | None = None) -> dict:
    return {
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-haiku-4-5-20251001",
        "content": [{
            "type": "tool_use", "id": "toolu_test", "name": "record_headline_analysis",
            "input": {
                "headline": "x", "regime_interpretation": interpretation, "overall": overall, "macro_theme": "MACRO",
                "significance_scores": {"market": 5, "deal_size": 1, "sector": 3, "timeliness": 5, "regime": 5},
            },
        }],
        "stop_reason": "tool_use",
        "usage": dict(usage or A_USAGE),
    }


def perplexity_ok(content: str = RESEARCH, usage: dict | None = None, finish: str = "length") -> dict:
    return {
        "id": "pplx_test", "model": "sonar", "object": "chat.completion", "created": 1789740000,
        "usage": dict(usage or P_USAGE), "citations": list(CITATIONS),
        "choices": [{"index": 0, "finish_reason": finish, "message": {"role": "assistant", "content": content}}],
    }


class FakeAPIs:
    """requests.post stand-in: routes by host, records every request."""

    def __init__(self):
        self.requests: list[dict] = []
        self.anthropic = lambda body: FakeResponse(200, anthropic_ok())
        self.perplexity = lambda body: FakeResponse(200, perplexity_ok())

    def __call__(self, url, **kwargs):
        self.requests.append({"url": url, **kwargs})
        if "api.anthropic.com" in url:
            return self.anthropic(kwargs.get("json"))
        if "api.perplexity.ai" in url:
            return self.perplexity(kwargs.get("json"))
        raise AssertionError(f"unexpected POST to {url}")

    def count(self, host: str) -> int:
        return sum(host in r["url"] for r in self.requests)


@pytest.fixture(autouse=True)
def _no_run_id(monkeypatch):
    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)


@pytest.fixture
def http(monkeypatch):
    apis = FakeAPIs()
    monkeypatch.setattr(requests, "post", apis)

    def no_get(*args, **kwargs):
        raise AssertionError("network GET attempted in a test")

    monkeypatch.setattr(requests, "get", no_get)
    return apis


@pytest.fixture
def db(tmp_path) -> Path:
    path = tmp_path / "news.db"
    ensure_news_table(str(path))
    return path


def item(headline: str, published: datetime, summary: str = "") -> dict:
    return {"headline": headline, "summary": summary, "url": "https://example.com/story", "source": "Finnhub",
            "published_at": published.isoformat(), "ticker": ""}


def feed(monkeypatch, items: list[dict]) -> None:
    monkeypatch.setattr(news, "fetch_finnhub_news", lambda *a, **k: [dict(i) for i in items])
    monkeypatch.setattr(news, "fetch_newsapi_news", lambda *a, **k: [])
    monkeypatch.setattr(news, "fetch_rss_news", lambda *a, **k: [])


def insert_rows(path: Path, rows: list[tuple[str, float, datetime]]) -> list[int]:
    conn = sqlite3.connect(path)
    ids = []
    for headline, score, published in rows:
        cur = conn.execute(
            "INSERT INTO news_feed (headline, summary, url, source, category, published_at, overall_significance,"
            " regime_interpretation, perplexity_research, ticker) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (headline, f"wire summary of {headline}", "https://example.com/story", "Finnhub", "MACRO",
             published.isoformat(), score, "", "", ""),
        )
        ids.append(cur.lastrowid)
    conn.commit()
    conn.close()
    return ids


def seed_ledger(path: Path, rows: list[tuple]) -> None:
    conn = sqlite3.connect(path)
    conn.executemany(f"INSERT INTO ai_spend_ledger ({LEDGER_COLS}) VALUES ({','.join('?' * 16)})", rows)
    conn.commit()
    conn.close()


def spent(ts: str, month: str, cost: float, news_id: int = 999) -> tuple:
    return (ts, month, "anthropic", "claude-haiku-4-5-20251001", "news_interpretation", news_id,
            1000, 100, 0, 0, None, cost, "usage", "ok", 200, None)


def ledger(path: Path) -> list[dict]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM ai_spend_ledger ORDER BY id")]
    conn.close()
    return rows


def stored(path: Path) -> dict[str, dict]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    rows = {r["headline"]: dict(r) for r in conn.execute("SELECT * FROM news_feed")}
    conn.close()
    return rows


def enrich(path: Path, ids: list[int], keys: dict = KEYS, **kwargs) -> dict:
    conn = sqlite3.connect(path)
    try:
        return news.enrich_new_rows(conn, ids, keys, **kwargs)
    finally:
        conn.close()


def summary_lines(out: str) -> list[str]:
    return [line for line in out.splitlines() if line.startswith("AI enrichment:")]


def test_fixture_headlines_straddle_the_floor():
    for h in HOT:
        assert news.score_significance(item(h, NOW - timedelta(minutes=30)), "Goldilocks", now=NOW)["overall_significance"] >= news.SIGNIFICANCE_FLOOR, h
    for h in QUIET:
        assert news.score_significance(item(h, NOW - timedelta(minutes=30)), "Goldilocks", now=NOW)["overall_significance"] < news.SIGNIFICANCE_FLOOR, h
    assert news.SIGNIFICANCE_FLOOR == 2.5 and news.ENRICH_PER_HOUR == 10 and news.ENRICH_WALL_SECONDS == 150
    assert spend().MONTHLY_CAP_USD == 50.0


# ── (a) quiet hours ───────────────────────────────────────────────────────────


def test_quiet_run_below_the_floor_makes_no_ai_calls(db, http, monkeypatch, capsys):
    feed(monkeypatch, [item(h, NOW - timedelta(minutes=20)) for h in QUIET])
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 3
    assert http.requests == []
    assert ledger(db) == []
    assert summary_lines(capsys.readouterr().out) == [
        "AI enrichment: 0 enriched, 0 above the floor held for the hourly limit, 0 skipped at the cap"
        " · $0.0000 this run · $0.00 month-to-date of $50.00 · errors: none"
    ]


def test_an_empty_fetch_still_reports_and_calls_nothing(db, http, monkeypatch, capsys):
    feed(monkeypatch, [])
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 0
    assert http.requests == []
    assert len(summary_lines(capsys.readouterr().out)) == 1


def test_without_keys_nothing_is_called_or_recorded(db, http, monkeypatch, capsys):
    feed(monkeypatch, [item(h, NOW - timedelta(minutes=20)) for h in HOT[:3]])
    assert news.fetch_and_store_news(str(db), {"finnhub_key": "", "newsapi_key": ""}, now=NOW) == 3
    assert http.requests == [] and ledger(db) == []
    (line,) = summary_lines(capsys.readouterr().out)
    assert "0 enriched" in line and "no API keys configured" in line


# ── (b) the rolling hour ──────────────────────────────────────────────────────


def test_at_most_ten_per_rolling_hour_across_runs(db, http, monkeypatch, capsys):
    first = [item(h, NOW - timedelta(minutes=30)) for h in HOT[:12]]
    feed(monkeypatch, first)
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 12
    assert http.count("api.anthropic.com") == 10 and http.count("api.perplexity.ai") == 10

    # 20 minutes later four new items clear the floor, but this hour is spent
    later = NOW + timedelta(minutes=20)
    second = first + [item(h, later - timedelta(minutes=5)) for h in HOT[12:16]]
    feed(monkeypatch, second)
    assert news.fetch_and_store_news(str(db), KEYS, now=later) == 4
    assert http.count("api.anthropic.com") == 10 and http.count("api.perplexity.ai") == 10

    # the window rolls: 61 minutes after the first run there is room again
    rolled = NOW + timedelta(minutes=61)
    feed(monkeypatch, second + [item(h, rolled - timedelta(minutes=5)) for h in HOT[16:19]])
    assert news.fetch_and_store_news(str(db), KEYS, now=rolled) == 3
    assert http.count("api.anthropic.com") == 13 and http.count("api.perplexity.ai") == 13

    lines = summary_lines(capsys.readouterr().out)
    assert lines == [
        "AI enrichment: 10 enriched, 2 above the floor held for the hourly limit, 0 skipped at the cap"
        " · $0.0719 this run · $0.07 month-to-date of $50.00 · errors: none",
        "AI enrichment: 0 enriched, 4 above the floor held for the hourly limit, 0 skipped at the cap"
        " · $0.0000 this run · $0.07 month-to-date of $50.00 · errors: none",
        "AI enrichment: 3 enriched, 0 above the floor held for the hourly limit, 0 skipped at the cap"
        " · $0.0216 this run · $0.09 month-to-date of $50.00 · errors: none",
    ]
    rows = stored(db)
    assert sum(1 for r in rows.values() if r["regime_interpretation"]) == 13
    # a held row keeps its wire summary and is never enriched later
    held = [r for r in rows.values() if not r["regime_interpretation"]]
    assert len(held) == 6 and all(r["perplexity_research"] == "" for r in held)


def test_the_hourly_count_includes_the_other_pass_of_a_full_run(db, http):
    # main.py and the workflow step both run the news refresh in full mode
    first = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=10)) for h in HOT[:8]])
    assert enrich(db, first, now=NOW)["enriched"] == 8
    second = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=5)) for h in HOT[8:14]])
    stats = enrich(db, second, now=NOW + timedelta(minutes=3))
    assert stats["enriched"] == 2 and stats["held_hourly"] == 4
    assert http.count("api.anthropic.com") == 10


# ── (c) stored rows are never re-enriched ─────────────────────────────────────


def test_a_stored_row_is_topped_up_but_its_wire_text_is_never_rewritten(db, http, monkeypatch):
    """Changed by N-B1. A row stored by an earlier run (while the cap or the
    hourly limit held) used to keep its wire summary forever, which is exactly
    why the page showed wire summaries: it is one of the ten cards on screen,
    so it is now topped up. What must not change is the row's stored text — a
    re-fetch of the same headline never rewrites summary, url or source."""
    earlier = NOW - timedelta(hours=2)
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO news_feed (headline, summary, url, source, category, published_at, overall_significance,"
        " regime_interpretation, perplexity_research, ticker) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (HOT[0], "old wire summary", "https://example.com/old", "Finnhub", "MACRO", earlier.isoformat(), 3.0, "", "", ""),
    )
    conn.commit()
    conn.close()

    items = [item(HOT[0], earlier, summary="new wire summary"), item(HOT[1], NOW - timedelta(minutes=10))]
    feed(monkeypatch, items)
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 1
    assert http.count("api.anthropic.com") == 2 and http.count("api.perplexity.ai") == 2
    rows = stored(db)
    assert rows[HOT[0]]["summary"] == "old wire summary" and rows[HOT[0]]["url"] == "https://example.com/old"
    assert rows[HOT[0]]["regime_interpretation"] != "" and rows[HOT[1]]["regime_interpretation"] != ""
    assert {r["news_id"] for r in ledger(db)} == {rows[HOT[0]]["id"], rows[HOT[1]]["id"]}

    # the same fetch again: nothing new, nothing called, nothing rewritten
    before = stored(db)
    feed(monkeypatch, items)
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW + timedelta(minutes=5)) == 0
    assert len(http.requests) == 4
    assert stored(db) == before


def test_enrichment_never_overwrites_a_row_that_already_has_text(db, http):
    (rid,) = insert_rows(db, [(HOT[0], 3.0, NOW - timedelta(minutes=5))])
    conn = sqlite3.connect(db)
    conn.execute("UPDATE news_feed SET regime_interpretation = 'kept' WHERE id = ?", (rid,))
    conn.commit()
    conn.close()
    assert enrich(db, [rid], now=NOW)["eligible"] == 0
    assert http.requests == [] and stored(db)[HOT[0]]["regime_interpretation"] == "kept"


# ── (d) the monthly cap ───────────────────────────────────────────────────────


def test_month_to_date_at_the_cap_makes_no_call_and_records_one_cap_row(db, http, capsys):
    seed_ledger(db, [spent("2026-09-17T09:00:00Z", "2026-09", 49.995)])
    ids = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=10)) for h in HOT[:3]])
    stats = enrich(db, ids, now=NOW, run_id="4242")
    assert http.requests == []
    assert stats["skipped_cap"] == 3 and stats["enriched"] == 0
    caps = [r for r in ledger(db) if r["status"] == "cap_reached"]
    assert len(caps) == 1
    cap = caps[0]
    assert (cap["provider"], cap["purpose"], cap["cost_usd"], cap["run_id"], cap["month"]) == ("budget", "cap_reached", 0, "4242", "2026-09")
    # nothing was rewritten: wire summary and rule score stay
    for h in HOT[:3]:
        row = stored(db)[h]
        assert row["regime_interpretation"] == "" and row["perplexity_research"] == ""
        assert row["overall_significance"] == 3.0 and row["summary"] == f"wire summary of {h}"
    assert "3 skipped at the cap" in summary_lines(capsys.readouterr().out)[0]

    # the full mode's second pass in the same workflow run adds no second cap row
    more = insert_rows(db, [(HOT[5], 3.0, NOW - timedelta(minutes=2))])
    enrich(db, more, now=NOW + timedelta(minutes=4), run_id="4242")
    assert http.requests == [] and sum(r["status"] == "cap_reached" for r in ledger(db)) == 1


def test_room_under_the_cap_still_spends(db, http):
    seed_ledger(db, [spent("2026-09-17T09:00:00Z", "2026-09", 49.0)])
    ids = insert_rows(db, [(HOT[0], 3.0, NOW - timedelta(minutes=10))])
    assert enrich(db, ids, now=NOW)["enriched"] == 1
    assert http.count("api.anthropic.com") == 1 and http.count("api.perplexity.ai") == 1


def test_the_cap_stops_a_run_part_way(db, http):
    # room for exactly one item's worst case, not two
    s = spend()
    ids = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=10)) for h in HOT[:3]])
    one_item = 0.0125
    seed_ledger(db, [spent("2026-09-17T09:00:00Z", "2026-09", s.MONTHLY_CAP_USD - one_item)])
    stats = enrich(db, ids, now=NOW)
    assert stats["enriched"] == 1 and stats["skipped_cap"] == 2
    assert http.count("api.anthropic.com") == 1 and http.count("api.perplexity.ai") == 1
    assert sum(r["status"] == "cap_reached" for r in ledger(db)) == 1
    total = sum(r["cost_usd"] for r in ledger(db) if r["month"] == "2026-09")
    assert total <= s.MONTHLY_CAP_USD


# ── (e) month rollover ────────────────────────────────────────────────────────


def test_last_months_spend_does_not_count(db, http, capsys):
    seed_ledger(db, [spent("2026-08-31T23:59:59Z", "2026-08", 49.999)])
    september = datetime(2026, 9, 1, 0, 0, 30, tzinfo=timezone.utc)
    ids = insert_rows(db, [(HOT[0], 3.0, september - timedelta(minutes=1))])
    stats = enrich(db, ids, now=september)
    assert http.count("api.anthropic.com") == 1 and http.count("api.perplexity.ai") == 1
    assert stats["month_to_date_usd"] == pytest.approx(A_COST + P_COST)
    assert "$0.01 month-to-date of $50.00" in summary_lines(capsys.readouterr().out)[0]
    assert {r["month"] for r in ledger(db) if r["news_id"] == ids[0]} == {"2026-09"}

    # while the clock still reads August, the same spend blocks
    august = datetime(2026, 8, 31, 23, 59, 59, tzinfo=timezone.utc)
    late = insert_rows(db, [(HOT[1], 3.0, august - timedelta(minutes=1))])
    assert enrich(db, late, now=august)["skipped_cap"] == 1
    assert http.count("api.anthropic.com") == 1


# ── (f) cost from usage ───────────────────────────────────────────────────────


def test_cost_math_from_usage_for_both_providers():
    s = spend()
    assert (s.HAIKU_INPUT_USD_PER_MTOK, s.HAIKU_OUTPUT_USD_PER_MTOK) == (1.00, 5.00)
    assert s.HAIKU_CACHE_WRITE_USD_PER_MTOK == pytest.approx(1.25) and s.HAIKU_CACHE_READ_USD_PER_MTOK == pytest.approx(0.10)
    assert (s.SONAR_INPUT_USD_PER_MTOK, s.SONAR_OUTPUT_USD_PER_MTOK, s.SONAR_REQUEST_FEE_USD) == (1.00, 1.00, 0.005)

    a = s.anthropic_cost({"input_tokens": 1200, "output_tokens": 180, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 2000})
    assert a["cost_usd"] == pytest.approx(0.0012 + 0.0009 + 0.00125 + 0.0002)
    assert (a["cost_source"], a["input_tokens"], a["output_tokens"], a["cache_write_tokens"], a["cache_read_tokens"]) == ("usage", 1200, 180, 1000, 2000)

    p = s.perplexity_cost({"prompt_tokens": 96, "completion_tokens": 212, "cost": {"request_cost": 0.005, "total_cost": 0.00531}})
    assert p["cost_usd"] == pytest.approx(0.00531) and p["cost_source"] == "usage.cost"
    assert p["request_fee_usd"] == pytest.approx(0.005) and (p["input_tokens"], p["output_tokens"]) == (96, 212)

    q = s.perplexity_cost({"prompt_tokens": 100, "completion_tokens": 300})
    assert q["cost_usd"] == pytest.approx(0.0004 + 0.005) and q["cost_source"] == "price_table" and q["request_fee_usd"] == 0.005

    for none in (s.anthropic_cost(None), s.perplexity_cost(None)):
        assert none["cost_usd"] == 0 and none["cost_source"] == "none"

    # worst cases: prompt length / 4 tokens in, max_tokens out, at the price table
    assert s.anthropic_worst_case("x" * 4000, max_tokens=400) == pytest.approx(1000 * 1.25e-6 + 400 * 5e-6)
    assert s.perplexity_worst_case("x" * 400, max_tokens=350) == pytest.approx(100e-6 + 350e-6 + 0.005)


def test_ledger_rows_carry_the_cost_of_each_call(db, http, monkeypatch):
    monkeypatch.setenv("GITHUB_RUN_ID", "987654")
    answers = iter([
        FakeResponse(200, perplexity_ok()),
        FakeResponse(200, perplexity_ok(usage={"prompt_tokens": 96, "completion_tokens": 212})),
    ])
    http.perplexity = lambda body: next(answers)
    ids = insert_rows(db, [(HOT[0], 3.4, NOW - timedelta(minutes=5)), (HOT[1], 3.0, NOW - timedelta(minutes=5))])
    stats = enrich(db, ids, now=NOW)
    rows = ledger(db)
    assert [(r["provider"], r["purpose"], r["news_id"], r["status"], r["http_status"], r["cost_source"]) for r in rows] == [
        ("anthropic", "news_interpretation", ids[0], "ok", 200, "usage"),
        ("perplexity", "news_research", ids[0], "ok", 200, "usage.cost"),
        ("anthropic", "news_interpretation", ids[1], "ok", 200, "usage"),
        ("perplexity", "news_research", ids[1], "ok", 200, "price_table"),
    ]
    assert [r["cost_usd"] for r in rows] == pytest.approx([A_COST, P_COST, A_COST, (96 + 212) / 1e6 + 0.005])
    assert (rows[0]["input_tokens"], rows[0]["output_tokens"], rows[0]["cache_write_tokens"], rows[0]["cache_read_tokens"]) == (1180, 142, 0, 0)
    assert rows[0]["model"] == "claude-haiku-4-5-20251001" and rows[1]["model"] == "sonar"
    assert rows[1]["request_fee_usd"] == pytest.approx(0.005) and rows[0]["request_fee_usd"] is None
    assert {r["ts"] for r in rows} == {"2026-09-18T14:00:00Z"} and {r["month"] for r in rows} == {"2026-09"}
    assert {r["run_id"] for r in rows} == {"987654"}
    assert stats["run_cost_usd"] == pytest.approx(sum(r["cost_usd"] for r in rows))
    assert stats["month_to_date_usd"] == pytest.approx(sum(r["cost_usd"] for r in rows))


def test_claude_overall_replaces_the_rule_score_only_when_positive(db, http):
    answers = iter([FakeResponse(200, anthropic_ok(overall=4.6)), FakeResponse(200, anthropic_ok(overall=0))])
    http.anthropic = lambda body: next(answers)
    ids = insert_rows(db, [(HOT[0], 3.4, NOW - timedelta(minutes=5)), (HOT[1], 3.0, NOW - timedelta(minutes=5))])
    enrich(db, ids, now=NOW)
    rows = stored(db)
    assert rows[HOT[0]]["overall_significance"] == 4.6 and rows[HOT[1]]["overall_significance"] == 3.0


# ── (g) failures are recorded, keys never leak ────────────────────────────────


def test_anthropic_401_is_recorded_and_no_key_leaks(db, http, capsys):
    body = {"type": "error", "error": {"type": "authentication_error", "message": f"invalid x-api-key {ANTHROPIC_KEY}"}}
    http.anthropic = lambda req: FakeResponse(401, body)
    ids = insert_rows(db, [(HOT[0], 3.0, NOW - timedelta(minutes=5)), (HOT[1], 3.0, NOW - timedelta(minutes=5))])
    stats = enrich(db, ids, now=NOW)

    claude = [r for r in ledger(db) if r["provider"] == "anthropic"]
    assert [(r["status"], r["http_status"], r["cost_usd"], r["cost_source"]) for r in claude] == [("error", 401, 0, "none")] * 2
    # the key really was sent, in the header only
    sent = [r for r in http.requests if "api.anthropic.com" in r["url"]]
    assert sent[0]["headers"]["x-api-key"] == ANTHROPIC_KEY
    # research is independent of the Claude failure; the rule score stays
    rows = stored(db)
    assert rows[HOT[0]]["regime_interpretation"] == "" and rows[HOT[0]]["perplexity_research"].startswith(RESEARCH_4)
    assert rows[HOT[0]]["overall_significance"] == 3.0
    assert stats["errors"] == {"anthropic 401": 2}

    out = capsys.readouterr()
    (line,) = summary_lines(out.out)
    assert line.endswith("errors: anthropic 401×2")
    for text in (out.out, out.err):
        for secret in (ANTHROPIC_KEY, PPLX_KEY, "https://", "api.anthropic.com"):
            assert secret not in text
    dump = "\n".join(repr(r) for r in ledger(db))
    assert ANTHROPIC_KEY not in dump and PPLX_KEY not in dump
    for path in db.parent.glob(db.name + "*"):
        raw = path.read_bytes()
        assert ANTHROPIC_KEY.encode() not in raw and PPLX_KEY.encode() not in raw


def test_network_failures_and_unusable_replies_are_errors(db, http, capsys):
    def timeout(req):
        raise requests.Timeout(f"read timed out: https://api.perplexity.ai/chat/completions {PPLX_KEY}")

    http.perplexity = timeout
    no_tool = anthropic_ok()
    no_tool["content"] = [{"type": "text", "text": "I cannot score this."}]
    http.anthropic = lambda req: FakeResponse(200, no_tool)
    ids = insert_rows(db, [(HOT[0], 3.0, NOW - timedelta(minutes=5))])
    stats = enrich(db, ids, now=NOW)
    a, p = ledger(db)
    # billed but unusable: an error that still costs what the usage says
    assert (a["status"], a["http_status"], a["cost_source"]) == ("error", 200, "usage") and a["cost_usd"] == pytest.approx(A_COST)
    # no reply at all: an error at zero (no usage came back)
    assert (p["status"], p["http_status"], p["cost_usd"], p["cost_source"]) == ("error", None, 0, "none")
    assert stats["enriched"] == 0
    out = capsys.readouterr()
    (line,) = summary_lines(out.out)
    assert line.endswith("errors: anthropic no_tool_use×1, perplexity Timeout×1")
    assert PPLX_KEY not in out.out + out.err and "https://" not in out.out + out.err
    assert stored(db)[HOT[0]]["regime_interpretation"] == ""


# ── (h) complete sentences only ───────────────────────────────────────────────

CAP_CASES = [
    # decimals and multiples never end a sentence
    ("Yields rose to 4.94% after the print. The curve steepened 1.5x its average. Futures price 2.25 cuts. Oil fell 3.1%. Gold rose.", 4,
     "Yields rose to 4.94% after the print. The curve steepened 1.5x its average. Futures price 2.25 cuts. Oil fell 3.1%."),
    # U.S. inside a sentence is not an end; before "The" it is; "Fed." ends a sentence
    ("U.S. CPI rose 0.4% in August. Tariffs hit goods bound for the U.S. The pass-through is lagged. Markets price fewer cuts from the Fed. Watch the dot plot.", 4,
     "U.S. CPI rose 0.4% in August. Tariffs hit goods bound for the U.S. The pass-through is lagged. Markets price fewer cuts from the Fed."),
    # citation markers stay with their sentence: ".[1][2]", "[3].", " [2]."
    ("The Fed held rates.[1][2] Powell flagged tariff risks[3]. Futures imply two cuts [2]. Yields fell. Spreads were flat.", 3,
     "The Fed held rates.[1][2] Powell flagged tariff risks[3]. Futures imply two cuts [2]."),
    # a reply cut off by max_tokens loses its unfinished sentence
    ("The Fed cut by 25 bp. Markets rallied. Yields fell and the dollar", 4, "The Fed cut by 25 bp. Markets rallied."),
    # markdown bold labels and dates
    ("**Why it matters:** The cut confirms the Goldilocks read.[1] **Context:** Inflation cooled for three months. **Watch next:** CPI on Oct. 15. Spreads remain tight.", 2,
     "**Why it matters:** The cut confirms the Goldilocks read.[1] **Context:** Inflation cooled for three months."),
    ("**The Fed cut rates.** Markets rallied. Yields fell.", 1, "**The Fed cut rates.**"),
    # abbreviations inside a sentence
    ("Apple Inc. reported record revenue. Nvidia Corp. rose 3%. Cyclicals led, e.g. banks and energy. Defensives lagged.", 3,
     "Apple Inc. reported record revenue. Nvidia Corp. rose 3%. Cyclicals led, e.g. banks and energy."),
    # list numerals are not sentences; the unfinished last item is dropped
    ("1. **Why:** The cut supports risk assets.\n2. **Context:** Core PCE is 2.6%.\n3. **Watch:** Jobless claims.\n4. Oil is flat.\n5. More", 4,
     "1. **Why:** The cut supports risk assets.\n2. **Context:** Core PCE is 2.6%.\n3. **Watch:** Jobless claims.\n4. Oil is flat."),
    # bullet lines are units; a label line belongs to what follows it
    ("**Why it matters:**\n- Fed signals two cuts\n- Yields fall\n- Dollar slips", 2,
     "**Why it matters:**\n- Fed signals two cuts\n- Yields fall"),
    # questions, exclamations and quotes
    ('Is the Fed done? Powell said "we are not in a hurry." Markets disagree! Yields fell.', 3,
     'Is the Fed done? Powell said "we are not in a hurry." Markets disagree!'),
    ("The Fed held rates.", 4, "The Fed held rates."),
    ("Equities may", 4, ""),
    ("", 4, ""),
    (RESEARCH, 4, RESEARCH_4),
]


@pytest.mark.parametrize("text, n, expected", CAP_CASES)
def test_sentence_cap_cases(text, n, expected):
    assert news.cap_sentences(text, n) == expected


@pytest.mark.parametrize("text", [c[0] for c in CAP_CASES if c[0]])
@pytest.mark.parametrize("n", [1, 2, 3, 4, 5])
def test_sentence_cap_never_cuts_mid_sentence(text, n):
    body = text.strip()
    out = news.cap_sentences(text, n)
    assert body.startswith(out)  # a prefix: nothing rewritten
    if out:
        # the cut is a sentence end of the original, after at most n sentences
        kept = [e for e in news.sentence_ends(body) if e <= len(out)]
        assert kept[-1] == len(out) and 1 <= len(kept) <= n


def test_a_lone_unpunctuated_interpretation_is_kept():
    assert news.cap_sentences("Hawkish Fed reinforces the Overheating read", 2, keep_lone_fragment=True) == "Hawkish Fed reinforces the Overheating read"
    assert news.cap_sentences("Hawkish Fed reinforces the Overheating read", 2) == ""


def test_stored_text_is_capped_and_the_sources_list_survives(db, http):
    ids = insert_rows(db, [(HOT[0], 3.0, NOW - timedelta(minutes=5))])
    enrich(db, ids, now=NOW)
    row = stored(db)[HOT[0]]
    assert row["regime_interpretation"] == "Hawkish hold keeps the Overheating read intact. Duration sells off."
    research = row["perplexity_research"]
    assert research == RESEARCH_4 + "\n\nSources:\n" + "\n".join(f"- {u}" for u in CITATIONS)
    # the web's split: body before "Sources:", URLs after
    body, tail = research.split("Sources:")[0].strip(), research.split("Sources:")[1]
    assert body == RESEARCH_4 and len(news.sentence_ends(body)) == 4
    assert [u for u in tail.split() if u.startswith("https://")] == CITATIONS
    # the research instruction asks for four sentences, and the request carries it
    assert "Answer in at most four sentences." in news.NEWS_RESEARCH_SYSTEM_PROMPT
    sent = next(r for r in http.requests if "api.perplexity.ai" in r["url"])
    assert "Answer in at most four sentences." in sent["json"]["messages"][0]["content"]


# ── (i) validate_db publishes ledger rows and reports the spend ───────────────


def _validation_ledger(path: Path, rows: list[tuple]) -> None:
    from src.db_helpers import ensure_ai_spend_ledger

    conn = sqlite3.connect(path)
    ensure_ai_spend_ledger(conn)
    conn.executemany(f"INSERT INTO ai_spend_ledger ({LEDGER_COLS}) VALUES ({','.join('?' * 16)})", rows)
    conn.commit()
    conn.close()


VALIDATION_ROWS = [
    ("2026-08-31T23:50:00Z", "2026-08", "anthropic", "claude-haiku-4-5-20251001", "news_interpretation", 7, 1000, 100, 0, 0, None, 12.34, "usage", "ok", 200, "1"),
    ("2026-09-05T20:00:00Z", "2026-09", "anthropic", "claude-haiku-4-5-20251001", "news_interpretation", 8, 1180, 142, 0, 0, None, 0.00189, "usage", "ok", 200, "2"),
    ("2026-09-05T20:00:01Z", "2026-09", "perplexity", "sonar", "news_research", 8, 96, 212, None, None, 0.005, 0.0053, "usage.cost", "ok", 200, "2"),
    ("2026-09-05T21:00:00Z", "2026-09", "anthropic", "claude-haiku-4-5-20251001", "news_interpretation", 9, None, None, None, None, None, 0, "none", "error", 401, "3"),
    ("2026-09-05T21:30:00Z", "2026-09", "budget", None, "cap_reached", None, None, None, None, None, None, 0, "none", "cap_reached", None, "4"),
]


def test_validate_news_only_publishes_new_ledger_rows_and_reports_spend(tmp_path):
    from scripts import validate_db as v
    from tests.test_validate_db import NOW as VNOW, _make

    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)  # identical news: only the ledger differs
    _validation_ledger(prev, VALIDATION_ROWS[:2])
    _validation_ledger(cur, VALIDATION_ROWS)
    rep = v.validate(cur, prev, "news-only", now=VNOW)
    assert rep["verdict"] == "pass" and rep["changed"] is True and rep["upload"] is True
    assert rep["changed_tables"] == ["ai_spend_ledger"]
    md = v.summary_markdown(rep)
    assert "- AI spend month-to-date: $0.01 of $50.00 cap (3 calls)" in md.splitlines()

    # the first run that creates the ledger publishes it too
    base, fresh = tmp_path / "base.db", tmp_path / "fresh.db"
    _make(base)
    _make(fresh)
    _validation_ledger(fresh, VALIDATION_ROWS[1:3])
    rep = v.validate(fresh, base, "news-only", now=VNOW)
    assert rep["upload"] is True and rep["changed_tables"] == ["ai_spend_ledger"]

    assert "ai_spend_ledger" in v.MODE_TABLES["full"] and "ai_spend_ledger" in v.MODE_TABLES["news-only"]
    assert "ai_spend_ledger" not in v.REQUIRED_TABLES and "ai_spend_ledger" not in v.DATE_COLUMNS
    assert v.AI_MONTHLY_CAP_USD == spend().MONTHLY_CAP_USD

    # a database without the ledger (older snapshots) reports no spend line
    rep = v.validate(base, base, "news-only", now=VNOW)
    assert rep["upload"] is False and rep["ai_spend"] is None and "AI spend" not in v.summary_markdown(rep)


# ── (j) future-dated candidates ───────────────────────────────────────────────


def test_future_dated_candidates_are_dropped(db, http, monkeypatch):
    items = [
        item(HOT[0], NOW + timedelta(hours=2)),
        item(HOT[1], NOW + timedelta(minutes=3)),
        item(HOT[2], NOW - timedelta(minutes=10)),
    ]
    assert [i["headline"] for i in news.drop_future_dated(items, NOW)] == [HOT[1], HOT[2]]
    # a bad-clock copy listed first must not knock out its valid duplicate
    feed(monkeypatch, [item(HOT[3], NOW + timedelta(days=1))] + items + [item(HOT[3], NOW - timedelta(minutes=1))])
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 3
    rows = stored(db)
    assert set(rows) == {HOT[1], HOT[2], HOT[3]}
    assert rows[HOT[3]]["published_at"] == (NOW - timedelta(minutes=1)).isoformat()
    assert http.count("api.anthropic.com") == 3 and http.count("api.perplexity.ai") == 3


def test_an_unopenable_database_is_a_warning_not_a_crash(tmp_path, http, monkeypatch, capsys):
    feed(monkeypatch, [item(HOT[0], NOW - timedelta(minutes=5))])
    assert news.fetch_and_store_news(str(tmp_path / "missing-dir" / "news.db"), KEYS, now=NOW) == 0
    assert http.requests == []
    err = capsys.readouterr().err
    assert "[news] WARNING: news storage failed (OperationalError)" in err and ANTHROPIC_KEY not in err


# ── the ledger itself ─────────────────────────────────────────────────────────

LEDGER_SCHEMA = [
    ("id", "INTEGER", 0, None, 1), ("ts", "TEXT", 1, None, 0), ("month", "TEXT", 1, None, 0),
    ("provider", "TEXT", 1, None, 0), ("model", "TEXT", 0, None, 0), ("purpose", "TEXT", 0, None, 0),
    ("news_id", "INTEGER", 0, None, 0), ("input_tokens", "INTEGER", 0, None, 0), ("output_tokens", "INTEGER", 0, None, 0),
    ("cache_write_tokens", "INTEGER", 0, None, 0), ("cache_read_tokens", "INTEGER", 0, None, 0),
    ("request_fee_usd", "REAL", 0, None, 0), ("cost_usd", "REAL", 1, "0", 0), ("cost_source", "TEXT", 0, None, 0),
    ("status", "TEXT", 1, None, 0), ("http_status", "INTEGER", 0, None, 0), ("run_id", "TEXT", 0, None, 0),
]


def test_ensure_news_table_creates_the_ledger_idempotently(tmp_path):
    path = tmp_path / "old.db"
    # an existing database from before B4 (and before perplexity_research) gains the ledger
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE news_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, headline TEXT NOT NULL, category TEXT,"
        " published_at DATETIME, overall_significance REAL DEFAULT 1.0, UNIQUE(headline, published_at))"
    )
    conn.commit()
    conn.close()
    ensure_news_table(str(path))
    ensure_news_table(str(path))
    conn = sqlite3.connect(path)
    cols = [(r[1], r[2], r[3], r[4], r[5]) for r in conn.execute("PRAGMA table_info(ai_spend_ledger)")]
    ddl = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'ai_spend_ledger'").fetchone()[0]
    conn.close()
    assert cols == LEDGER_SCHEMA
    assert "AUTOINCREMENT" in ddl


def test_pruning_old_news_never_prunes_the_ledger(db, http, monkeypatch):
    seed_ledger(db, [spent("2026-01-05T10:00:00Z", "2026-01", 1.23)])
    insert_rows(db, [("An old story from early September", 1.0, NOW - timedelta(days=12))])
    feed(monkeypatch, [item(HOT[0], NOW - timedelta(minutes=5))])
    news.fetch_and_store_news(str(db), KEYS, now=NOW)
    assert "An old story from early September" not in stored(db)
    assert any(r["ts"] == "2026-01-05T10:00:00Z" for r in ledger(db))


def test_the_wall_clock_budget_stops_enrichment(db, http, capsys):
    # every provider call "takes" a minute: after two items the 150 s budget is gone
    ids = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=5)) for h in HOT[:4]])
    stats = enrich(db, ids, now=NOW, clock=lambda: 60.0 * len(http.requests))
    assert stats["enriched"] == 2 and stats["held_time"] == 2
    assert http.count("api.anthropic.com") == 2
    assert "2 held for the time budget" in summary_lines(capsys.readouterr().out)[0]


def test_unknown_ledger_values_are_refused(db):
    s = spend()
    conn = sqlite3.connect(db)
    try:
        with pytest.raises(ValueError):
            s.record(conn, provider="openai", purpose="news_interpretation", status="ok", now=NOW)
        with pytest.raises(ValueError):
            s.record(conn, provider="anthropic", purpose="news_interpretation", status="maybe", now=NOW)
    finally:
        conn.close()
    assert ledger(db) == []


# ── (i) N-B1: the window the page shows is the window that gets enriched ──────
#
# Enrichment used to see only the ids a run inserted, ranked by rule score,
# while the News tab ranks the whole 7-day window by significance — so the
# cards a reader saw were almost never the enriched ones. Each run now also
# tops up the displayed top ten, inside the same ledger, floor and cap.


def topups(path: Path, **kwargs) -> list[int]:
    conn = sqlite3.connect(path)
    try:
        return news.select_display_topups(conn, **kwargs)
    finally:
        conn.close()


def test_the_display_window_matches_the_api_window_and_ordering(db):
    ids = insert_rows(db, [
        ("Treasury auction draws record demand", 4.0, NOW - timedelta(days=2)),
        ("Payrolls miss and the curve steepens", 3.0, NOW - timedelta(days=6, hours=23)),
        ("Local bakery opens a second shop", 1.0, NOW - timedelta(hours=1)),
        ("Nine days ago and still the loudest headline", 9.0, NOW - timedelta(days=9)),
    ])
    assert news.DISPLAY_WINDOW_HOURS == 168 and news.DISPLAY_TOP_N == 10
    # significance DESC, then newest; below the floor and outside the window are out
    assert topups(db, now=NOW) == [ids[0], ids[1]]


def test_a_card_that_already_has_a_read_is_not_re_enriched_and_keeps_its_place(db):
    ids = insert_rows(db, [(f"Fed speaker {i} moves the front end", 5.0 - i / 10, NOW - timedelta(days=1, minutes=i)) for i in range(12)])
    conn = sqlite3.connect(db)
    conn.execute("UPDATE news_feed SET regime_interpretation = 'read', perplexity_research = 'cited' WHERE id IN (?,?)", (ids[0], ids[1]))
    conn.commit()
    conn.close()
    # the top ten is still the top ten: the two enriched cards hold their slots,
    # so the top-up covers the other eight and never reaches #11 or #12.
    assert topups(db, now=NOW) == ids[2:10]


def test_a_run_tops_up_the_displayed_ten_even_when_nothing_new_clears_the_floor(db, http, monkeypatch, capsys):
    displayed = insert_rows(db, [(h, 3.0, NOW - timedelta(days=2, minutes=i)) for i, h in enumerate(HOT[:12])])
    feed(monkeypatch, [item(h, NOW - timedelta(minutes=20)) for h in QUIET])  # nothing new above the floor
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 3
    assert http.count("api.anthropic.com") == 10 and http.count("api.perplexity.ai") == 10
    rows = {r["id"]: r for r in stored(db).values()}
    enriched = [i for i in displayed if rows[i]["regime_interpretation"]]
    assert enriched == displayed[:10]  # the ten the page would show, not the last two
    assert all(rows[i]["perplexity_research"].startswith(RESEARCH_4[:40]) for i in enriched)
    assert summary_lines(capsys.readouterr().out)[0] == (
        "AI enrichment: 10 enriched, 0 above the floor held for the hourly limit, 0 skipped at the cap,"
        " 10 topped up from the displayed window · $0.0719 this run · $0.07 month-to-date of $50.00 · errors: none"
    )


def test_a_second_run_with_no_new_rows_makes_no_calls_at_all(db, http, monkeypatch):
    insert_rows(db, [(h, 3.0, NOW - timedelta(days=2, minutes=i)) for i, h in enumerate(HOT[:10])])
    feed(monkeypatch, [])
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 0
    assert http.count("api.anthropic.com") == 10
    # an hour later the limit has rolled, the feed is quiet and the window is
    # already read: nothing is re-examined, so the budget is not touched again.
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW + timedelta(minutes=61)) == 0
    assert http.count("api.anthropic.com") == 10 and http.count("api.perplexity.ai") == 10


def test_the_displayed_window_wins_the_hourly_room_ahead_of_new_arrivals(db, http, monkeypatch):
    displayed = insert_rows(db, [(f"Auction tail widens, round {i}", 5.0, NOW - timedelta(days=1, minutes=i)) for i in range(12)])
    feed(monkeypatch, [item(h, NOW - timedelta(minutes=20)) for h in HOT[:12]])
    stats_out: list[dict] = []
    monkeypatch.setattr(news, "enrich_new_rows", _recording(news.enrich_new_rows, stats_out))
    assert news.fetch_and_store_news(str(db), KEYS, now=NOW) == 12
    rows = {r["id"]: r for r in stored(db).values()}
    assert [i for i in displayed if rows[i]["regime_interpretation"]] == displayed[:10]
    assert http.count("api.anthropic.com") == 10
    stats = stats_out[0]
    assert stats["eligible"] == 22 and stats["enriched"] == 10 and stats["held_hourly"] == 12


def _recording(fn, sink):
    def wrapper(*a, **k):
        stats = fn(*a, **k)
        sink.append(stats)
        return stats

    return wrapper


def test_the_backfill_script_is_a_dry_run_until_apply(db, http, monkeypatch, capsys):
    """The one-off for a database that is already behind. Same selection, same
    ledger, same cap; read-only and silent until --apply."""
    from scripts import backfill_enrichment as backfill

    # anchored to the real clock: the script reads the live display window
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    ids = insert_rows(db, [(h, 3.0, recent - timedelta(minutes=i)) for i, h in enumerate(HOT[:12])])
    monkeypatch.setenv("ANTHROPIC_API_KEY", ANTHROPIC_KEY)
    monkeypatch.setenv("PERPLEXITY_API_KEY", PPLX_KEY)

    assert backfill.main(["--db", str(db)]) == 0
    assert not http.requests
    assert all(r["regime_interpretation"] == "" for r in stored(db).values())
    out = capsys.readouterr().out
    assert "10 of the top 10 displayed cards carry no AI read" in out and "dry run" in out
    assert ANTHROPIC_KEY not in out and PPLX_KEY not in out

    assert backfill.main(["--db", str(db), "--apply"]) == 0
    assert http.count("api.anthropic.com") == 10 and http.count("api.perplexity.ai") == 10
    rows = {r["id"]: r for r in stored(db).values()}
    assert [i for i in ids if rows[i]["regime_interpretation"]] == ids[:10]
    assert {r["news_id"] for r in ledger(db)} == set(ids[:10])
    assert ANTHROPIC_KEY not in capsys.readouterr().out


def test_the_summary_counts_the_top_ups_it_enriched_not_the_ones_it_looked_at(db, http, monkeypatch, capsys):
    """"10 topped up from the displayed window" has to mean ten were read, not
    ten were considered and then held for the hourly limit."""
    earlier = insert_rows(db, [(h, 3.0, NOW - timedelta(minutes=10)) for h in HOT[:8]])
    assert enrich(db, earlier, now=NOW)["enriched"] == 8  # this hour has room for two more
    displayed = insert_rows(db, [(f"Auction tail widens, round {i}", 5.0, NOW - timedelta(days=1, minutes=i)) for i in range(10)])
    stats = enrich(db, [], now=NOW + timedelta(minutes=1), display_ids=displayed)
    assert stats["enriched"] == 2 and stats["held_hourly"] == 8
    assert stats["topped_up"] == 2
    assert "2 topped up from the displayed window" in stats["line"]
    capsys.readouterr()


# ── (j) B-H2 (fix/prelaunch-1): the backend and the page mean the same ten ─────
#
# The page collapses near-identical headlines (web/src/screens/news/
# news-copy.ts headlineKey) before it renders, so a top-up that took the raw
# top ten covered eight distinct cards. One fixture, generated from the page's
# own JavaScript, drives this file and web/src/screens/news/news-copy.test.ts,
# so the two keys and the two selections cannot drift apart.

STORY_FIXTURE = json.loads((Path(__file__).resolve().parent.parent / "web/src/screens/news/__fixtures__/story-keys.json").read_text())


def _insert_fixture_rows(path: Path, rows: list[dict]) -> None:
    conn = sqlite3.connect(path)
    for r in rows:
        conn.execute(
            "INSERT INTO news_feed (id, headline, summary, url, source, category, published_at, overall_significance,"
            " regime_interpretation, perplexity_research, ticker) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["headline"], f"wire summary {r['id']}", f"https://example.com/{r['id']}", "Finnhub", "MACRO",
             r["published_at"], r["overall_significance"], "a stored read" if r["has_read"] else "", "", ""),
        )
    conn.commit()
    conn.close()


def test_the_story_key_is_the_pages_key():
    for case in STORY_FIXTURE["keys"]:
        assert news.headline_key(case["headline"]) == case["key"], case


def test_the_top_up_covers_the_same_ten_distinct_stories_the_page_shows(db):
    _insert_fixture_rows(db, STORY_FIXTURE["window"])
    now = datetime.fromisoformat(STORY_FIXTURE["now"])
    conn = sqlite3.connect(db)
    try:
        rows = [dict(zip(news._ROW_COLUMNS, r)) for r in conn.execute(
            f"SELECT {', '.join(news._ROW_COLUMNS)} FROM news_feed ORDER BY overall_significance DESC, published_at DESC")]
    finally:
        conn.close()
    assert [r["id"] for r in news.display_stories(rows)] == STORY_FIXTURE["ten"]
    # the ones without a read that clear the floor, in the page's order; a
    # duplicate that carries a read does not stand in for the card it merged into
    assert topups(db, now=now) == STORY_FIXTURE["pending"]


def test_a_window_with_fewer_than_ten_stories_tops_up_every_one_it_holds(db):
    small = [r for r in STORY_FIXTURE["window"] if r["id"] in STORY_FIXTURE["small_window"]["rows"]]
    _insert_fixture_rows(db, small)
    assert topups(db, now=datetime.fromisoformat(STORY_FIXTURE["now"])) == STORY_FIXTURE["small_window"]["pending"]


def test_a_stored_read_is_a_read_exactly_when_the_page_says_so():
    # hasAiRead trims with JavaScript's whitespace set; so must the backend,
    # or a card could say "AI read pending" for a read the backend will never
    # redo (U+FEFF), or carry no read the backend thinks it has (U+0085)
    for case in STORY_FIXTURE["reads"]:
        for column in ("regime_interpretation", "perplexity_research"):
            row = {"overall_significance": 4.0, "regime_interpretation": "", "perplexity_research": "", column: case["value"]}
            assert news._eligible(row, news.SIGNIFICANCE_FLOOR) is (not case["has_read"]), (column, case)


def test_the_selection_reads_the_rows_the_page_loads():
    assert news.SIGNIFICANCE_FLOOR == STORY_FIXTURE["floor"]
    assert news.DISPLAY_TOP_N == STORY_FIXTURE["top_n"]
    assert news.DISPLAY_WINDOW_HOURS == STORY_FIXTURE["window_hours"]
    assert news.DISPLAY_LIMIT == STORY_FIXTURE["page_limit"]
    page = (Path(__file__).resolve().parent.parent / "web/src/screens/news/NewsScreen.tsx").read_text()
    assert f"useNews({news.DISPLAY_WINDOW_HOURS}, undefined, {news.DISPLAY_LIMIT}" in page, "the page's enrichment window query"
