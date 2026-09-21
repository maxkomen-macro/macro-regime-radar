"""Test-session defaults (2026-09-06).

The publication gates (api/security.py) are tuned for browsers: a 120-request
burst per client. The suite fires hundreds of requests from one TestClient in
seconds, so the app under test gets generous buckets here; the middleware's
own behaviour is pinned by tests/test_security.py, which instantiates it with
explicit small limits. No network probes at import time either.
"""

import os

os.environ.setdefault("EODHD_PROBE_ON_START", "0")
for var in ("RATE_LIMIT_PER_CLIENT_PER_MIN", "RATE_LIMIT_PER_CLIENT_BURST", "RATE_LIMIT_GLOBAL_PER_MIN", "RATE_LIMIT_GLOBAL_BURST"):
    os.environ.setdefault(var, "1000000")
os.environ.setdefault("DB_MAX_CONCURRENCY", "16")
# fix/prelaunch-1: handlers read results the background worker builds. In a
# test process the worker starts on the first request and a cold interpreter
# can take longer than production's 5 s wait (pinned separately by
# tests/test_generations.py) to import the libraries, so the harness waits longer.
os.environ.setdefault("WORKER_WAIT_S", "90")
os.environ.setdefault("PREFETCH_MARKET", "0")
# launch-1: the assistant's spend ledger. Set unconditionally, before any api
# import, so no test can read or write a developer's real ledger; the autouse
# fixture below gives each test its own empty one.
import tempfile  # noqa: E402

os.environ["ASSISTANT_LEDGER_PATH"] = os.path.join(tempfile.mkdtemp(prefix="mrr-ledger-"), "assistant_spend.db")


import pytest  # noqa: E402


@pytest.fixture()
def install_worker(monkeypatch):
    """Install a worker as the process's singleton for one test (fix/prelaunch-1).
    The singleton already running (one a request started lazily) is stopped
    first, so exactly one worker builds during the test; it restarts on demand
    afterwards. Every installed worker is stopped, and the read provider
    cleared, at teardown."""
    from api import worker as worker_mod
    from src.analytics import dbpath

    made: list = []

    def install(w):
        old = worker_mod._worker
        if old is not None and old is not w:
            old.stop()
        monkeypatch.setattr(worker_mod, "_worker", w)
        made.append(w)
        return w

    yield install
    for w in made:
        w.stop()
    dbpath.clear_provider()


@pytest.fixture(autouse=True)
def _own_assistant_ledger(request, monkeypatch):
    """Each test that has the budget module loaded gets a fresh, empty spend
    ledger (launch-1, verify loop 1: two API tests used to read the
    developer's own ledger and rested on a day it held spend)."""
    import sys

    budget = sys.modules.get("api.assistant_budget")
    if budget is not None:
        monkeypatch.setattr(budget, "LEDGER_PATH", request.getfixturevalue("tmp_path") / "assistant_spend.db")
        budget.reset_for_tests()
    yield
    if budget is not None:
        budget.reset_for_tests()
