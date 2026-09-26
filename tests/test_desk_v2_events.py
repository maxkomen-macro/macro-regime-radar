"""tests/test_desk_v2_events.py — GET /study/events and its CSV (desk/frame-3-api, B1 commit 4).

docs/desk/FRAME3_API_PLAN.md §1.4 and §2. Every retained event of a catalog
study, newest first, projected from the run's own event table: the JSON rows
and the CSV rows are the same rows, the CSV header is §12.4's string, and the
table agrees with /study's counts (the projection parity). S-31's RSI rule
holds here as on /study, and with `Accept: text/csv` an answer that is not
ready keeps its JSON envelope and status code.
"""

from __future__ import annotations

import csv
import io
import math

import pytest
from fastapi.testclient import TestClient

from api import desk_catalog as catalog, desk_v2, security
from api.main import app
from tests import desk_contract as dc
from tests.test_desk_v2_study import DESK_ITEMS, SPEC, TIER2, _serve, synth_path  # noqa: F401 (fixture)

client = TestClient(app)
CSV = {"accept": "text/csv"}


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):  # noqa: F811
    return _serve(install_worker, monkeypatch, synth_path)


def _events(qs: str) -> dict:
    return dc.check_response("/study/events", client.get(f"/api/desk/study/events?{qs}"))


def test_the_csv_header_is_section_12_4s():
    sec = SPEC[SPEC.index("### 12.4"):SPEC.index("### 12.5")]
    assert f"`{','.join(desk_v2.EVENTS_CSV_COLUMNS)}`" in sec
    assert desk_v2.EVENTS_CSV_COLUMNS == dc.EVENTS_CSV_COLUMNS


@pytest.mark.parametrize("slug", catalog.CATALOG_QUERY_SLUGS)
def test_every_catalog_studys_events_agree_with_its_study(served, slug):
    body = _events(f"preset={slug}")
    if slug in TIER2:
        assert body["status"] == "awaiting" and "desk_series" in body["unavailable"]["reason"]
        return
    events = body["data"]["events"]
    study = dc.check_response("/study", client.get(f"/api/desk/study?preset={slug}"))["data"]
    assert body["data"]["slug"] == slug and len(events) == study["matched_n"]
    dates = [e["event_date"] for e in events]
    assert dates == sorted(dates, reverse=True), "newest event first"
    if events:
        assert (dates[-1], dates[0]) == (study["first_event"], study["last_event"])
    assert [{k: e[k] for k in ("event_date", "entry_date", "regime")} | {"value_20": e["value_20"]} for e in events[:5]] \
        == study["last_events"]
    for row in study["horizons"]:
        h = row["h"]
        done = [e[f"value_{h}"] for e in events if e[f"complete_{h}"]]
        assert len(done) == row["n"] and len(events) - len(done) == row["n_incomplete"], (slug, h)
        assert sum(1 for v in done if v > 0) == row["up_n"] and all(math.isfinite(v) for v in done)
        assert all((e[f"exit_{h}"] is None) == (e[f"value_{h}"] is None) == (not e[f"complete_{h}"]) for e in events)
        if done:
            assert min(done) == row["worst"]["value"] and max(done) == row["best"]["value"]


def test_the_csv_rows_are_the_json_rows(served):
    js = _events("preset=vix-spike-2sigma-5d")["data"]["events"]
    r = client.get("/api/desk/study/events?preset=vix-spike-2sigma-5d", headers=CSV)
    assert r.status_code == 200 and r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["cache-control"] == "no-store"
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0] == list(desk_v2.EVENTS_CSV_COLUMNS) and len(rows) == len(js) + 1 and js
    for row, e in zip(rows[1:], js):
        for col, cell in zip(rows[0], row):
            v = e[col]
            if v is None:
                assert cell == "", (col, cell)
            elif isinstance(v, bool):
                assert cell == ("true" if v else "false"), (col, cell)
            elif isinstance(v, float):
                assert float(cell) == v and cell == repr(v), (col, cell)
            else:
                assert cell == v, (col, cell)
    assert r.text.endswith("\n") and "\r" not in r.text


def test_an_answer_that_is_not_ready_keeps_its_envelope_under_accept_csv(served):
    for qs, status, state in (("preset=rsi-above-70", 200, "awaiting"), ("preset=oil-2sigma-20d", 200, "awaiting"),
                              ("preset=rsi-above-70&horizon=20", 422, "error"), ("preset=golden-cross&window=5", 422, "error")):
        r = client.get(f"/api/desk/study/events?{qs}", headers=CSV)
        body = dc.check_response("/study/events", r)
        assert r.status_code == status and body["status"] == state, qs


def test_rsi_presets_follow_s31_on_study_events(served):
    for slug in ("rsi-above-70", "rsi-below-30"):
        b = _events(f"preset={slug}")
        assert b["status"] == "awaiting" and b["unavailable"] == {"reason": "RSI is not computed yet.", "until": None}
        for h in ("20", "5", "abc"):
            r = client.get(f"/api/desk/study/events?preset={slug}&horizon={h}")
            assert r.status_code == 422 and "horizon" in r.json()["error"]["message"], (slug, h)


def test_the_six_slots_answer_the_same_events(served):
    a = _events("preset=golden-cross")["data"]
    b = _events("shock=spx&move=cross_above&target=spx")["data"]
    assert a == b


def test_a_preset_events_request_is_a_lookup():
    import asyncio

    assert "/api/desk/study/events" in security.DESK_STUDY_PATHS

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    mw = security.SecurityMiddleware(inner, desk_study_slots=1, per_client_per_min=1000, per_client_burst=1000, global_per_min=1000)
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    def get(qs: bytes):
        sent.clear()
        asyncio.run(mw({"type": "http", "path": "/api/desk/study/events", "method": "GET", "query_string": qs,
                        "headers": [], "client": ("1.2.3.4", 1)}, receive, send))
        return sent[0]["status"]

    assert mw.desk_study.acquire(blocking=False)
    try:
        assert get(b"preset=golden-cross") == 200 and get(b"preset=golden-cross&horizon=5") == 200
        assert get(b"preset=rsi-below-30") == 200 and get(b"preset=rsi-below-30&horizon=20") == 200
        assert get(b"shock=spx&move=cross_above&target=spx") == 429
    finally:
        mw.desk_study.release()
