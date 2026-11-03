"""Write the Options Finder's web fixture (web/src/fixtures/desk/options-finder.json) from the real route.

    python scripts/options_finder_fixture.py

The answers are the route's own (api/desk_options.finder through api/desk_v2 and the envelope) on an invented
chain: tests/options_synth.py's $100 stock with quarterly dividends, its quotes priced by the engine's lattice,
served by the fake EODHD of tests/options_route_fake.py at the HTTP transport, its earnings date stored in the
fixture database as the refresh stores one, with the clock at Saturday 2026-10-24 so the quotes describe the
Oct 23 session. No provider data is involved, so nothing in the
fixture is anyone's quote: the repository is public. A developer tool: it never runs in the API process, and it
writes only that one file.

The file is `{"note", "answers": {<query>: <payload>}}`, the query being the request's parameters in the order
the page writes them.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FRED_API_KEY", "fixture")
# the stored-row answer (the display switch on, no earnings cache; plan rev 2 D6), which the fixture has always held
os.environ["FINDER_EARNINGS_DISPLAY"] = "1"
os.environ.pop("EARNINGS_CACHE_KEY", None)

OUT = ROOT / "web" / "src" / "fixtures" / "desk" / "options-finder.json"
REQUESTS = [
    dict(symbol="SYN", view="up", target="120", by="2026-12-18", budget="5000", commission="0.65"),
    dict(symbol="SYN", view="down", target="85", by="2027-01-15", budget="2500", scan_months="3"),
]
NOTE = ("Synthetic: an invented $100 stock (SYN) whose quotes were priced by the Finder's own lattice "
        "(tests/options_synth.py), answered by the real route on 2026-10-23's session "
        "(scripts/options_finder_fixture.py). Not market data.")


def main() -> None:
    import httpx
    from fastapi.testclient import TestClient

    from api import analytics_cache, db
    from api import worker as worker_mod
    from api.main import app
    from api.providers import eodhd as eod
    from api.providers import market
    from api.providers.cache import TokenBucket
    from tests import options_route_fake as fk
    from tests import options_synth as syn

    rows, _ = syn.chain()
    closes = {d: 95.0 for d in fk.sessions(date(2024, 10, 1), syn.SESSION)}
    closes[syn.SESSION] = 100.0
    fake = fk.FakeEodhd({"SYN": [fk.provider_row(r) for r in rows]}, {"SYN": closes}, dividends={"SYN": syn.DIV_ROWS})
    market._utcnow = lambda: fk.NOW
    eod._bucket = TokenBucket(rate=1e6, burst=10**6)
    market.set_client_for_tests(eod.EodhdClient("fixture", transport=httpx.MockTransport(fake), max_retries=0))
    with tempfile.TemporaryDirectory() as tmp:
        db.DB_PATH = fk.store(Path(tmp) / "fixture.db", macro=[("CPI", "2026-11-12T13:30:00Z"),
                                                               ("FOMC", "2026-12-09T19:00:00Z")],
                               earnings=[("SYN", "2026-11-30T21:30:00Z", "SYN earnings (Q3 2026)")])
        w = worker_mod.AnalyticsWorker(items=[("desk_options_inputs", analytics_cache._desk_options_inputs)],
                                       poll_s=0.05, preload=False)
        worker_mod._worker = w
        w.start(serving=True)
        assert w.wait_published(timeout=30)
        try:
            tc = TestClient(app)
            answers = {}
            for q in REQUESTS:
                r = tc.get("/api/desk/options/finder", params=q)
                body = r.json()
                if r.status_code != 200 or body["status"] != "ready":
                    raise SystemExit(f"{q}: {r.status_code} {body.get('error') or body.get('unavailable')}")
                # the store's newest market date, so the file does not change with the day it is written
                answers[urlencode(q)] = {**body["data"], "as_of": "2026-10-23"}
        finally:
            w.stop()
    OUT.write_text(json.dumps({"note": NOTE, "answers": answers}, indent=1, sort_keys=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(answers)} answers")


if __name__ == "__main__":
    main()
