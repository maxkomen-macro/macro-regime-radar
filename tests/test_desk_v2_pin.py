"""tests/test_desk_v2_pin.py — one generation per request (desk/frame-3-api, Codex R-01).

api/worker.PinGeneration pins a request only when a generation is already
published. A request that arrived before the first publication read its item
from the generation `result()` waited for, then named whichever generation was
current later: Codex's repro had a cold /study?preset=spx-5d-2sigma read
generation 1, generation 2 publish before the memo was built, and the response
and every later warm hit report generation 2 with generation 1's 73 events and
inputs_hash. `desk_envelope.answer` now pins one generation before any item
read, including after the cold wait, and holds it through the projection, the
memo key and the envelope. This test is that interleaving, on real engine
results: the first build waits for the request, and a second publication lands
between the request's item lookup and its memo.
"""

from __future__ import annotations

import sqlite3
import threading

from fastapi.testclient import TestClient

from api import db, desk_envelope as env, desk_items, desk_v2
from api import worker as worker_mod
from api.main import app
from tests import desk_contract as dc
from tests.test_event_study import _synthetic_db

client = TestClient(app)
SLUG = "spx-5d-2sigma"


def test_a_cold_request_reads_one_generation_through_a_publication(tmp_path, install_worker, monkeypatch):
    path = _synthetic_db(tmp_path / "macro_radar.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    desk_v2.clear_memo()
    gate = threading.Event()
    w = install_worker(worker_mod.AnalyticsWorker([(f"desk_study:{SLUG}", desk_items.desk_study(SLUG))], poll_s=0.05,
                                                  preload=False, wait_s=60, build_gate=gate))
    w.start(serving=True)
    assert w.current is None, "the request must arrive before the first publication"

    gens: dict = {}
    real_item = desk_v2._item

    def item_then_publish(slug):
        item = real_item(slug)
        if "first" not in gens:
            gens["first"] = w.current
            with sqlite3.connect(path) as c:  # a new file: fewer S&P events in generation 2
                c.execute("DELETE FROM asset_prices WHERE symbol = '^GSPC' AND date < '2005-01-01'")
            assert w.wait_published(min_id=gens["first"].id + 1, timeout=120), "generation 2 published"
            gens["second"] = w.current
        return item

    monkeypatch.setattr(desk_v2, "_item", item_then_publish)
    threading.Timer(0.3, gate.set).start()  # the first build starts once the request is waiting
    cold = dc.check_response("/study", client.get(f"/api/desk/study?preset={SLUG}"))
    g1, g2 = gens["first"], gens["second"]
    n1 = g1.results[f"desk_study:{SLUG}"]["native"]["provenance"]
    n2 = g2.results[f"desk_study:{SLUG}"]["native"]["provenance"]
    assert g1.id < g2.id and n1["n_events"] != n2["n_events"] and n1["inputs_hash"] != n2["inputs_hash"]

    # the cold answer is generation 1's, whole
    assert cold["generation_id"] == env.generation_id(g1) and cold["as_of"] == env.as_of(g1)
    assert (cold["data"]["matched_n"], cold["data"]["inputs_hash"]) == (n1["n_events"], n1["inputs_hash"])
    assert cold["data"]["served_from_cache"] is False

    # the warm repeats are generation 2's, whole: no memo entry carries one generation's numbers under another's id
    for hit in (False, True):
        warm = dc.check_response("/study", client.get(f"/api/desk/study?preset={SLUG}"))
        assert warm["generation_id"] == env.generation_id(g2), hit
        assert (warm["data"]["matched_n"], warm["data"]["inputs_hash"]) == (n2["n_events"], n2["inputs_hash"]), hit
        assert warm["data"]["served_from_cache"] is hit
    for key in desk_v2._memo:
        gid = key[0]
        payload, _trace = desk_v2._memo[key]
        want = n1 if gid == env.generation_id(g1) else n2
        assert gid in (env.generation_id(g1), env.generation_id(g2))
        assert payload["inputs_hash"] == want["inputs_hash"], key
