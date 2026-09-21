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
