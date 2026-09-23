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
    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_security_headers(c, "http://API.test/", rep, "site", want_csp=True, api=API)
    assert _rows(rep)["site CSP"][0] == "PASS", "host names compare without case"


def test_an_allocation_503_that_is_not_not_stored_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        return _json(503, {"detail": "Allocation is not available on this server right now."})

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_routes(c, API, ["/api/allocation"], rep, "stored")
    assert _rows(rep)["stored /api/allocation"][0] == "FAIL"


def test_the_docstring_describes_what_the_script_sends():
    doc = smoke.__doc__ or ""
    assert "HEAD" not in doc
    assert "POST" in doc


# ── desk/integration: the Desk's reads ──────────────────────────────────────

def test_the_route_list_covers_the_desk():
    assert "/api/desk/pipeline/inventory" in smoke.DESK_ROUTES and "/api/desk/event-study/assets" in smoke.DESK_ROUTES
    for preset in ("gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross"):
        assert f"/api/desk/event-study?study={preset}" in smoke.DESK_ROUTES


def _desk_handler(*, awaiting: bool, broken: str | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        path, study = request.url.path, request.url.params.get("study")
        if broken and (path == broken or study == broken):
            return _json(500, {"detail": "Internal Server Error"})
        if path == "/api/desk/pipeline/inventory":
            state = "unknown" if awaiting else "close"
            return _json(200, {"series": [{"id": "DGS10", "state": "close"}, {"id": "desk:DGS10", "state": state}, {"id": "desk:VIXCLS", "state": state}]})
        if path == "/api/desk/event-study/assets":
            return _json(200, {"shocks": [], "awaiting_refresh": ["us10y", "vix"] if awaiting else []})
        if path == "/api/desk/event-study" and study == "spx-golden-cross":
            return _json(200, {"status": "ready", "study": {"slug": study}, "provenance": {"n_events": 30}})
        if path == "/api/desk/event-study":
            if awaiting:
                return _json(200, {"status": "awaiting_refresh", "slug": study, "series": "gold", "detail": "awaiting the first full refresh"})
            return _json(200, {"status": "ready", "study": {"slug": study}, "provenance": {"n_events": 18}})
        return _json(404, {"detail": "Not Found"})

    return handler


def test_a_desk_awaiting_the_first_refresh_is_a_warn_and_a_ready_one_passes():
    rep = smoke.Report()
    with _client(_desk_handler(awaiting=False)) as c:
        smoke.check_desk(c, API, rep)
    assert rep.failures == 0 and all(v == "PASS" for v, _, _ in rep.rows), rep.rows
    rep = smoke.Report()
    with _client(_desk_handler(awaiting=True)) as c:
        smoke.check_desk(c, API, rep)
    rows = _rows(rep)
    assert rep.failures == 0, rep.rows
    assert rows["desk /api/desk/pipeline/inventory"][0] == "WARN" and "awaiting a full refresh" in rows["desk /api/desk/pipeline/inventory"][1]
    assert rows["desk /api/desk/event-study/assets"][0] == "WARN"
    assert rows["desk /api/desk/event-study?study=gold-2sigma-spx-weak"][0] == "WARN"
    assert rows["desk /api/desk/event-study?study=spx-golden-cross"][0] == "PASS"


def test_a_broken_desk_route_fails():
    for broken in ("/api/desk/pipeline/inventory", "/api/desk/event-study/assets", "spx-death-cross"):
        rep = smoke.Report()
        with _client(_desk_handler(awaiting=False, broken=broken)) as c:
            smoke.check_desk(c, API, rep)
        assert rep.failures == 1, (broken, rep.rows)


def test_an_inventory_without_desk_rows_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/desk/pipeline/inventory":
            return _json(200, {"series": [{"id": "DGS10", "state": "close"}]})
        return _desk_handler(awaiting=False)(request)

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_desk(c, API, rep)
    assert _rows(rep)["desk /api/desk/pipeline/inventory"][0] == "FAIL"


def test_a_preset_awaiting_the_first_refresh_gets_one_verdict_in_readiness():
    """A database older than the stored price histories: the presets' worker
    items fail with the engine's awaiting state and the route says so. One
    WARN, never a FAIL beside a WARN (the allocation rule above)."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health/ready":
            return _json(200, {"status": "ready", "worker": {"generation": 3, "build_ms": 5000, "errors": ["desk_preset:gold-2sigma-spx-weak"], "held": None}})
        if request.url.path == "/api/desk/event-study":
            return _json(200, {"status": "awaiting_refresh", "slug": "gold-2sigma-spx-weak", "series": "gold", "detail": "awaiting the first full refresh"})
        return _json(200, {})

    rep = smoke.Report()
    with _client(handler) as c:
        smoke.check_readiness(c, API, rep)
    rows = _rows(rep)
    assert rep.failures == 0, rep.rows
    assert rows["worker items"][0] == "WARN" and "desk_preset:gold-2sigma-spx-weak" in rows["worker items"][1]
