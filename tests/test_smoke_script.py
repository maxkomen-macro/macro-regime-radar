"""tests/test_smoke_script.py — the owner's smoke check, on a mock deployment.

Item 8's verifier found no test exercising `scripts/smoke_public.py`. These
pin what the script claims: a FAIL is never hidden behind a WARN, the route
list covers what the site reads, a database without the stored price
histories gets one verdict rather than two that contradict, the body-cap
probe runs whatever the status read answered, and a same-origin deploy's
`connect-src 'self'` satisfies the CSP check. No network: httpx.MockTransport.
"""

from __future__ import annotations

import json

import httpx

from scripts import smoke_public as smoke

API = "http://api.test"


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), timeout=5.0)


def _json(status: int, body) -> httpx.Response:
    return httpx.Response(status, json=body)


def _rows(rep: smoke.Report) -> dict[str, tuple[str, str]]:
    return {check: (verdict, detail) for verdict, check, detail in rep.rows}


def test_a_fail_is_never_hidden_behind_a_warn():
    rep = smoke.Report()
    for i in range(6):
        rep.warn(f"w{i}", "a fact")
    assert rep.failures == 0
    rep.fail("x", "broken")
    assert rep.failures == 1


def test_the_route_list_covers_what_the_site_reads():
    assert "/series/FEDFUNDS/latest" in smoke.STORED_ROUTES and "/series/VIXCLS/latest" in smoke.STORED_ROUTES
    assert any(r.startswith("/api/market/options/") for r in smoke.PROVIDER_ROUTES)


def test_a_database_without_price_histories_gets_one_verdict():
    """The worker lists `allocation` among its errors and the route answers
    503 not_stored: a WARN in both places, not a FAIL beside a WARN."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health/ready":
            return _json(200, {"status": "ready", "worker": {"generation": 3, "build_ms": 5000, "errors": ["allocation"], "held": None}})
        if request.url.path == "/api/allocation":
            return _json(503, {"detail": "This database predates the stored price histories.", "kind": "not_stored", "provider": "api", "retryable": False})
        return _json(200, {})

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_readiness(c, API, rep)
        smoke.check_routes(c, API, ["/api/allocation"], rep, "stored")
    rows = _rows(rep)
    assert rows["worker items"][0] == "WARN" and rows["stored /api/allocation"][0] == "WARN"
    assert rep.failures == 0

    def broken(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health/ready":
            return _json(200, {"status": "ready", "worker": {"generation": 3, "build_ms": 5000, "errors": ["credit"], "held": None}})
        return _json(200, {})

    rep = smoke.Report()
    with _client(broken) as c:
        smoke.check_readiness(c, API, rep)
    assert _rows(rep)["worker items"][0] == "FAIL"


def test_the_body_cap_probe_runs_whatever_the_status_read_answered():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return _json(413, {"detail": "too large"})
        return _json(429, {"detail": "rate limited"})

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_assistant(c, API, rep)
    rows = _rows(rep)
    assert rows["assistant status"][0] == "FAIL"
    assert rows["assistant body cap"] == ("PASS", "413 over 16 KB")


def test_a_same_origin_deploy_satisfies_the_csp_check():
    csp = "default-src 'self'; connect-src 'self'; frame-ancestors 'none'"
    headers = {"content-security-policy": csp, "x-content-type-options": "nosniff", "x-frame-options": "DENY",
               "referrer-policy": "strict-origin-when-cross-origin", "cross-origin-opener-policy": "same-origin"}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers=headers, text="<div id=\"root\"></div>")

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_security_headers(c, API + "/", rep, "site", want_csp=True, api=API)
    assert _rows(rep)["site CSP"][0] == "PASS", _rows(rep)["site CSP"]

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_security_headers(c, "http://site.test/", rep, "site", want_csp=True, api=API)
    assert _rows(rep)["site CSP"][0] == "FAIL", "a split deploy must name the API's origins"


def test_the_docstring_describes_what_the_script_sends():
    doc = smoke.__doc__ or ""
    assert "HEAD" not in doc
    assert "POST" in doc
