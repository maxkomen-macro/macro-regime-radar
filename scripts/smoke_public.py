"""scripts/smoke_public.py — check a deployed Macro Regime Radar (launch-1).

Run it after a deploy, and any time the site looks wrong. It reads only: every
check is a GET or a WebSocket connect, except one oversized POST to the
assistant that the 16 KB body cap refuses before the agent runs, so nothing it
does costs a model call.

    python scripts/smoke_public.py \
        --api https://your-api-host.example \
        --site https://your-site.vercel.app \
        --ops-key "$OPS_ACCESS_KEY"

Without --site it checks the API alone; without --ops-key it still checks that
the diagnostics are closed, which is what a public deploy should answer.

Exit code 0 when every check passed, 1 when any FAIL. WARN never fails the run:
those are facts worth seeing (an empty watchlist off-hours, say) rather than
faults. Needs the API's own dependencies (httpx, websockets), so run it from
the repo's virtual environment.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, field

import httpx

# Every route the site reads, grouped so the report says which surface broke.
STORED_ROUTES = [
    "/health", "/health/live", "/regime/latest", "/signals/latest", "/series/latest",
    "/api/regime/latest", "/api/regime/history?limit=24", "/api/signals/latest", "/api/priced",
    "/api/surprises?top_n=10", "/api/alerts?limit=5", "/api/news?hours=168&limit=5",
    "/api/news/latest?limit=5", "/api/market/daily?days=5", "/api/market/intraday",
    "/api/calendar?days=14", "/api/calendar/recent?limit=5", "/api/backtests",
    "/api/credit/oas?days=90", "/api/credit/metrics", "/api/recession/probability",
    "/api/regime/intelligence", "/api/regime/playbooks", "/api/regime/duration",
    "/api/regime/transitions", "/api/regime/analogues", "/api/regime/scenarios",
    "/api/lbo/defaults", "/api/allocation", "/api/freshness",
    "/series/FEDFUNDS/latest", "/series/VIXCLS/latest",  # the Dashboard's two series tiles
]
# desk/integration: the Desk's reads (web/src/api/desk.ts). The three presets
# are worker items, looked up; a free-form study computes on request and is
# not probed (a visitor's own query, like the POST calculators).
DESK_PRESETS = ("gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross")
DESK_ROUTES = [
    "/api/desk/pipeline/inventory",
    "/api/desk/event-study/assets",
    *[f"/api/desk/event-study?study={p}" for p in DESK_PRESETS],
]
# Each of these spends EODHD quota (the options chain bills the marketplace
# allowance): --skip-provider leaves them out. The chain itself needs an
# expiration, so the expirations list stands for the options lens.
PROVIDER_ROUTES = [
    "/api/market/search?q=AAPL&limit=3",
    "/api/market/profile/AAPL",
    "/api/market/candles/AAPL?range=5D",
    "/api/market/options/AAPL/expirations",
]
# Not probed, on purpose: the three POST calculators (they run a visitor's own
# inputs; their GET halves are above), a real question to the assistant (a
# model call costs money), /series (Atlas only), corporate actions and ticks
# (no screen reads them), and the SPA shell (Vercel serves it on the split
# deploy; the single-service fallback is covered by the site checks).
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-opener-policy": "same-origin",
}


@dataclass
class Report:
    rows: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, verdict: str, check: str, detail: str = "") -> None:
        self.rows.append((verdict, check, detail))
        print(f"{verdict:4s} {check}{'  ' + detail if detail else ''}", flush=True)

    def ok(self, check: str, detail: str = "") -> None:
        self.add("PASS", check, detail)

    def fail(self, check: str, detail: str = "") -> None:
        self.add("FAIL", check, detail)

    def warn(self, check: str, detail: str = "") -> None:
        self.add("WARN", check, detail)

    @property
    def failures(self) -> int:
        return sum(1 for v, _, _ in self.rows if v == "FAIL")


def check_routes(client: httpx.Client, base: str, routes: list[str], rep: Report, label: str) -> None:
    slow: list[str] = []
    for route in routes:
        t0 = time.perf_counter()
        try:
            r = client.get(base + route)
        except httpx.HTTPError as exc:
            rep.fail(f"{label} {route}", type(exc).__name__)
            continue
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code == 200:
            if ms > 2000:
                slow.append(f"{route} {ms:.0f}ms")
            rep.ok(f"{label} {route}", f"{r.status_code} in {ms:.0f}ms")
        elif r.status_code == 503 and route == "/api/allocation":
            kind = None
            try:
                kind = (r.json() or {}).get("kind")
            except ValueError:
                pass
            if kind == "not_stored":
                rep.warn(f"{label} {route}", "503: this database predates the stored price histories")
            else:
                rep.fail(f"{label} {route}", f"503 {r.text[:120]}")
        else:
            rep.fail(f"{label} {route}", f"{r.status_code} {r.text[:120]}")
    if slow:
        rep.warn(f"{label} slow routes", ", ".join(slow))


def _allocation_not_stored(client: httpx.Client, api: str) -> bool:
    """Whether /api/allocation answers 503 not_stored: the one worker error
    that is a fact about the database rather than a fault."""
    try:
        r = client.get(api + "/api/allocation")
        return r.status_code == 503 and (r.json() or {}).get("kind") == "not_stored"
    except (httpx.HTTPError, ValueError):
        return False


def _desk_preset_awaiting(client: httpx.Client, api: str, name: str) -> bool:
    """Whether a preset answers `awaiting_refresh`: a database older than the
    stored histories the preset reads (desk/integration), a fact, not a fault."""
    try:
        r = client.get(api + "/api/desk/event-study", params={"study": name})
        return r.status_code == 200 and (r.json() or {}).get("status") == "awaiting_refresh"
    except (httpx.HTTPError, ValueError):
        return False


def check_desk(client: httpx.Client, api: str, rep: Report) -> None:
    """The Desk (desk/integration). The deployed database has no desk_series
    table until the first full refresh after the merge: rows and studies that
    say they are awaiting it are a WARN; any other answer but ready is a FAIL."""
    for route in DESK_ROUTES:
        check = f"desk {route}"
        t0 = time.perf_counter()
        try:
            r = client.get(api + route)
            body = r.json() if r.status_code in (200, 202) else None
        except (httpx.HTTPError, ValueError) as exc:
            rep.fail(check, type(exc).__name__)
            continue
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code != 200 or not isinstance(body, dict):
            rep.fail(check, f"{r.status_code} {r.text[:120]}")
        elif route == "/api/desk/pipeline/inventory":
            rows = [s for s in body.get("series") or [] if str(s.get("id", "")).startswith("desk:")]
            waiting = [s["id"] for s in rows if s.get("state") == "unknown"]
            if not rows:
                rep.fail(check, "no desk_series rows in the inventory")
            elif waiting:
                rep.warn(check, f"{len(waiting)} of {len(rows)} desk series not stored yet, awaiting a full refresh ({', '.join(waiting)})")
            else:
                rep.ok(check, f"{len(rows)} desk series judged, in {ms:.0f}ms")
        elif route == "/api/desk/event-study/assets":
            waiting = body.get("awaiting_refresh") or []
            if waiting:
                rep.warn(check, f"awaiting the first full refresh: {', '.join(waiting)}")
            else:
                rep.ok(check, f"200 in {ms:.0f}ms")
        elif body.get("status") == "ready":
            rep.ok(check, f"ready, {(body.get('provenance') or {}).get('n_events')} events, in {ms:.0f}ms")
        elif body.get("status") == "awaiting_refresh":
            rep.warn(check, str(body.get("detail") or "awaiting a full refresh"))
        else:
            rep.fail(check, f"status {body.get('status')!r}")


def check_readiness(client: httpx.Client, api: str, rep: Report) -> None:
    try:
        r = client.get(api + "/health/ready")
    except httpx.HTTPError as exc:
        rep.fail("readiness", type(exc).__name__)
        return
    if r.status_code != 200:
        rep.fail("readiness", f"{r.status_code} {r.text[:160]}")
        return
    body = r.json()
    worker = body.get("worker") or {}
    rep.ok("readiness", f"generation {worker.get('generation')} built in {worker.get('build_ms')} ms")
    errors = list(worker.get("errors") or [])
    warned = False
    if "allocation" in errors and _allocation_not_stored(client, api):
        # One verdict, not two: a database that predates the stored price
        # histories is a WARN here and on the route, never a FAIL beside a WARN.
        errors.remove("allocation")
        rep.warn("worker items", "allocation: this database predates the stored price histories")
        warned = True
    # desk/integration: a preset reads stored histories too; the same rule.
    for name in [e for e in errors if e.startswith("desk_preset:")]:
        if _desk_preset_awaiting(client, api, name.split(":", 1)[1]):
            errors.remove(name)
            rep.warn("worker items", f"{name}: awaiting the first full refresh (the database predates the histories it reads)")
            warned = True
    if errors:
        rep.fail("worker items", f"errors: {errors}")
    elif not warned:
        rep.ok("worker items", "no item is answering with an error")
    if worker.get("held"):
        rep.warn("worker held", json.dumps(worker["held"]))
    if body.get("relay_degraded"):
        rep.warn("relay", "degraded (see /api/stream/debug with the ops key)")


def check_freshness(client: httpx.Client, api: str, rep: Report) -> None:
    try:
        body = client.get(api + "/api/freshness").json()
    except (httpx.HTTPError, ValueError) as exc:
        rep.fail("freshness", type(exc).__name__)
        return
    overall = body.get("overall")
    if overall in (None, "unknown"):
        rep.fail("freshness overall", f"{overall!r}: the deploy cannot say how fresh it is")
    elif overall == "current":
        rep.ok("freshness overall", overall)
    else:
        rep.warn("freshness overall", f"{overall} (see the sla rows)")
    gen = body.get("generation") or {}
    if gen.get("id"):
        rep.ok("served generation", f"{gen['id']} from {gen.get('source')}")
    else:
        rep.fail("served generation", "freshness names no generation")
    stale = [row.get("feed") for row in (body.get("sla") or []) if row.get("verdict") == "stale"]
    if stale:
        rep.warn("stale feeds", ", ".join(str(s) for s in stale))


def check_security_headers(client: httpx.Client, url: str, rep: Report, label: str, want_csp: bool, api: str | None = None) -> None:
    try:
        r = client.get(url)
    except httpx.HTTPError as exc:
        rep.fail(f"{label} headers", type(exc).__name__)
        return
    missing = [h for h, v in SECURITY_HEADERS.items() if r.headers.get(h, "").lower() != v.lower()]
    if missing:
        rep.fail(f"{label} security headers", f"missing or wrong: {', '.join(missing)}")
    else:
        rep.ok(f"{label} security headers", "nosniff, DENY, strict-origin, same-origin")
    csp = r.headers.get("content-security-policy", "")
    if not want_csp:
        return
    if not csp:
        rep.fail(f"{label} CSP", "no Content-Security-Policy header")
        return
    problems = []
    if "REPLACE-WITH-API-HOST" in csp:
        problems.append("still carries the placeholder API host")
    if "connect-src" not in csp:
        problems.append("no connect-src")
    if "frame-ancestors 'none'" not in csp:
        problems.append("frame-ancestors is not 'none'")
    if api and "connect-src" in csp:
        # The API's own origins, for its scheme: https + wss in production,
        # http + ws for a local rehearsal (launch-1 verify loop 1). On the
        # single-service deploy the site is the API, and 'self' names it.
        connect = csp.split("connect-src", 1)[1].split(";")[0].split()
        host = api.split("://", 1)[1].rstrip("/").lower()
        same_origin = url.split("://", 1)[1].split("/", 1)[0].lower() == host
        if not (same_origin and "'self'" in connect):
            want = [f"https://{host}", f"wss://{host}"] if api.startswith("https://") else [f"http://{host}", f"ws://{host}"]
            absent = [w for w in want if w not in connect]
            if absent:
                problems.append(f"connect-src does not name {', '.join(absent)}")
    if problems:
        rep.fail(f"{label} CSP", "; ".join(problems))
    else:
        rep.ok(f"{label} CSP", csp.split("connect-src", 1)[1].split(";")[0].strip()[:80])


def check_diagnostics(client: httpx.Client, api: str, ops_key: str | None, rep: Report) -> None:
    for route in ("/api/providers/status", "/api/stream/debug"):
        try:
            r = client.get(api + route)
        except httpx.HTTPError as exc:
            rep.fail(f"diagnostics {route}", type(exc).__name__)
            continue
        if r.status_code == 200:
            rep.fail(f"diagnostics {route}", "open to anyone: set OPS_ACCESS_KEY and DEPLOY_PUBLIC")
        elif r.status_code in (401, 503):
            rep.ok(f"diagnostics {route}", f"closed ({r.status_code})")
        else:
            rep.warn(f"diagnostics {route}", str(r.status_code))
    if not ops_key:
        rep.warn("relay report", "no --ops-key given, so the relay was not read")
        return
    try:
        r = client.get(api + "/api/stream/debug", headers={"X-Ops-Key": ops_key})
    except httpx.HTTPError as exc:
        rep.fail("relay report", type(exc).__name__)
        return
    if r.status_code != 200:
        rep.fail("relay report", f"the ops key was refused ({r.status_code})")
        return
    dbg = r.json()
    errors = {k: v for k, v in (dbg.get("feed_last_error") or {}).items() if v}
    limit_hits = {k: v for k, v in errors.items() if "422" in str(v) or "limit" in str(v).lower()}
    if limit_hits:
        rep.fail("relay symbol limit", f"{limit_hits}: another process is holding this token's symbols")
    else:
        rep.ok("relay symbol limit", "no symbol-limit rejection on any feed")
    feeds = dbg.get("feeds") or {}
    if dbg.get("degraded"):
        rep.warn("relay feeds", f"{feeds} · {dbg.get('degraded_reasons')}")
    else:
        rep.ok("relay feeds", str(feeds))
    quota = dbg.get("quota") or {}
    try:
        status = client.get(api + "/api/providers/status", headers={"X-Ops-Key": ops_key}).json()
        quota = status.get("quota") or {}
        ents = {k: v.get("available") for k, v in (status.get("entitlements") or {}).items()}
        rep.ok("plan entitlements", json.dumps(ents))
    except (httpx.HTTPError, ValueError):
        pass
    if quota:
        rep.ok("eodhd quota", f"{quota.get('units')} units in {quota.get('elapsed_s')} s "
                              f"→ {quota.get('units_per_day_projected')} a day projected")


def check_assistant(client: httpx.Client, api: str, rep: Report) -> None:
    try:
        r = client.get(api + "/api/assistant/status")
    except httpx.HTTPError as exc:
        rep.fail("assistant status", type(exc).__name__)
        return
    if r.status_code == 503:
        rep.ok("assistant", "disabled on this deployment (ASSISTANT_ACCESS=off)")
        return
    if r.status_code == 401:
        rep.ok("assistant", "key-gated on this deployment (ASSISTANT_ACCESS=key)")
        return
    if r.status_code != 200:
        rep.fail("assistant status", f"{r.status_code} {r.text[:120]}")
    else:
        body = r.json()
        spent, cap = body.get("spent_usd"), body.get("cap_usd")
        if body.get("ledger") != "ok":
            rep.fail("assistant ledger", f"{body.get('ledger')}: the ceiling cannot be counted, so the analyst is resting")
        elif body.get("resting"):
            rep.warn("assistant", f"resting: ${spent} of ${cap} spent today, wakes {body.get('resets_at')}")
        else:
            rep.ok("assistant", f"awake: ${spent} of ${cap} spent today")
        if body.get("ledger_persistent") is False:
            rep.warn("assistant ledger disk", "the ledger is on the container's own disk: each restart starts a fresh day "
                                              "(attach the disk, DEPLOY.md section 3a step 6)")
        elif body.get("ledger_persistent"):
            rep.ok("assistant ledger disk", "on a mounted disk")
    # The gate itself, without spending a model call, whatever the status read
    # answered: an oversized body must be refused by the 16 KB cap rather than
    # answered.
    try:
        r = client.post(api + "/api/assistant/ask", content=b"{" + b"x" * 17_000 + b"}",
                        headers={"content-type": "application/json"})
        if r.status_code == 413:
            rep.ok("assistant body cap", "413 over 16 KB")
        else:
            rep.fail("assistant body cap", f"{r.status_code}: an oversized question was not refused")
    except httpx.HTTPError as exc:
        rep.fail("assistant body cap", type(exc).__name__)


async def _ws_probe(url: str, origin: str | None) -> tuple[bool, str]:
    try:
        import websockets
    except ImportError:
        return False, "the websockets package is not installed in this environment"
    headers = {"Origin": origin} if origin else None
    try:
        async with websockets.connect(url, additional_headers=headers, open_timeout=15, close_timeout=5) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=15)
    except Exception as exc:  # noqa: BLE001 — every failure is one line in the report
        return False, f"{type(exc).__name__}: {str(exc)[:120]}"
    try:
        msg = json.loads(raw)
    except ValueError:
        return False, "the first frame was not JSON"
    if msg.get("type") != "snapshot":
        return False, f"the first frame was {msg.get('type')!r}, not a snapshot"
    return True, f"{len(msg.get('items') or [])} quotes, feeds {msg.get('feeds')}"


def check_client_identity(client: httpx.Client, api: str, ops_key: str | None, my_ip: str | None, rep: Report) -> None:
    """What the rate limits key this request on (launch-1). Behind a proxy that
    must be the visitor's own public address: the proxy's, or a private one,
    means every visitor shares one bucket."""
    import ipaddress

    if not ops_key:
        rep.warn("client address", "no --ops-key given, so what the rate limits see was not read")
        return
    try:
        r = client.get(api + "/api/ops/whoami", headers={"X-Ops-Key": ops_key})
    except httpx.HTTPError as exc:
        rep.fail("client address", type(exc).__name__)
        return
    if r.status_code != 200:
        rep.fail("client address", f"{r.status_code} from /api/ops/whoami")
        return
    who = r.json()
    cid, peer, hops = who.get("client_id"), who.get("peer"), who.get("forwarded_for_entries") or 0
    via = f"header {who.get('client_ip_header')}" if who.get("client_ip_header_present") else f"{who.get('trusted_proxy_hops')} hop(s) of {hops}"
    try:
        private = ipaddress.ip_address(str(cid)).is_private
    except ValueError:
        private = False
    if hops and who.get("client_ip_header"):
        # The header is trusted only because the edge overwrites it: send a
        # forged one and make sure it does not come back as the key.
        forged = "203.0.113.7"
        try:
            again = client.get(api + "/api/ops/whoami", headers={"X-Ops-Key": ops_key, who["client_ip_header"]: forged}).json()
            if again.get("client_id") == forged:
                rep.fail("client address header", f"a forged {who['client_ip_header']} became the key: the edge does not "
                                                  "overwrite it, so unset CLIENT_IP_HEADER and use TRUSTED_PROXY_HOPS")
            else:
                rep.ok("client address header", f"a forged {who['client_ip_header']} was overwritten by the edge")
        except (httpx.HTTPError, ValueError) as exc:
            rep.warn("client address header", type(exc).__name__)
    if my_ip:
        (rep.ok if cid == my_ip else rep.fail)("client address", f"limits key on {cid} ({via}); you are {my_ip}")
    elif hops and (cid == peer or private):
        rep.fail("client address", f"behind a proxy, yet the limits key on {cid} ({via}): every visitor shares one bucket. "
                                   "Set CLIENT_IP_HEADER (Render: cf-connecting-ip) or TRUSTED_PROXY_HOPS")
    elif hops:
        rep.ok("client address", f"limits key on {cid} ({via}); pass --my-ip to confirm it is yours")
    else:
        rep.ok("client address", f"no proxy in front; limits key on the socket peer {cid}")


def check_websocket(api: str, site: str | None, rep: Report) -> None:
    ws_url = api.replace("https://", "wss://").replace("http://", "ws://") + "/api/stream/ws"
    ok, detail = asyncio.run(_ws_probe(ws_url, site))
    (rep.ok if ok else rep.fail)("relay socket", detail)
    if site:
        ok, detail = asyncio.run(_ws_probe(ws_url, "https://not-the-site.example"))
        if ok:
            rep.fail("relay origin allowlist", "a foreign Origin was accepted")
        else:
            rep.ok("relay origin allowlist", "a foreign Origin was refused")


def check_site(client: httpx.Client, site: str, rep: Report) -> None:
    try:
        r = client.get(site + "/")
    except httpx.HTTPError as exc:
        rep.fail("site index", type(exc).__name__)
        return
    if r.status_code != 200 or "<div id=\"root\">" not in r.text:
        rep.fail("site index", f"{r.status_code}, and no app shell in the body")
    else:
        rep.ok("site index", f"{len(r.text)} bytes")
    deep = client.get(site + "/app/markets")
    if deep.status_code == 200 and "<div id=\"root\">" in deep.text:
        rep.ok("site deep link", "/app/markets serves the shell")
    else:
        rep.fail("site deep link", f"{deep.status_code}: the SPA rewrite is missing")
    snap = client.get(site + "/snapshot/latest.json")
    if snap.status_code == 200:
        try:
            body = snap.json()
            rep.ok("site snapshot", f"generated {body.get('generated_at')}, {len(body.get('entries') or {})} entries")
        except ValueError:
            rep.fail("site snapshot", "not JSON")
    else:
        rep.warn("site snapshot", f"{snap.status_code}: the site will paint from the API alone")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True, help="API origin, e.g. https://mrr-api.onrender.com")
    ap.add_argument("--site", help="static site origin, e.g. https://macro-regime-radar.vercel.app")
    ap.add_argument("--ops-key", default=None, help="OPS_ACCESS_KEY, to read the relay and plan report")
    ap.add_argument("--skip-provider", action="store_true", help="skip the on-demand provider routes (they spend EODHD quota)")
    ap.add_argument("--my-ip", default=None, help="your own public address, to confirm the rate limits key on it")
    args = ap.parse_args()

    api = args.api.rstrip("/")
    site = args.site.rstrip("/") if args.site else None
    rep = Report()
    print(f"Macro Regime Radar smoke check · api={api}" + (f" site={site}" if site else ""))
    with httpx.Client(timeout=30.0, follow_redirects=False, headers={"User-Agent": "mrr-smoke/1.0"}) as client:
        check_readiness(client, api, rep)
        check_routes(client, api, STORED_ROUTES, rep, "stored")
        check_desk(client, api, rep)
        if not args.skip_provider:
            check_routes(client, api, PROVIDER_ROUTES, rep, "provider")
        check_freshness(client, api, rep)
        check_security_headers(client, api + "/health", rep, "api", want_csp=False)
        check_diagnostics(client, api, args.ops_key, rep)
        check_client_identity(client, api, args.ops_key, args.my_ip, rep)
        check_assistant(client, api, rep)
        if site:
            check_site(client, site, rep)
            check_security_headers(client, site + "/", rep, "site", want_csp=True, api=api)
    check_websocket(api, site, rep)

    passed = sum(1 for v, _, _ in rep.rows if v == "PASS")
    warned = sum(1 for v, _, _ in rep.rows if v == "WARN")
    print(f"\n{passed} passed, {warned} warnings, {rep.failures} failed")
    if rep.failures:
        print("\nFailures:")
        for verdict, check, detail in rep.rows:
            if verdict == "FAIL":
                print(f"  {check}: {detail}")
    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main())
