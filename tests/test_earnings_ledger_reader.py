"""The API's earnings ledger reader (api/earnings_ledger_reader.py, its child api/earnings_ledger_fetch.py; design LR
sections 2, 2.2, 3.4, 3.5, 4, 5; Amendment A-3 clarifications C1-C4).

The reader runs against a fake GitHub release fed with real ledger assets that the cache job wrote (tests in
test_earnings_cache.py build them), and a fake monotonic clock. The child is run for real against a local HTTP
server. No test reaches the network or Finnhub.
"""

from __future__ import annotations

import ast
import json
import os
import threading
import time
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from api import earnings_ledger_reader as lr
from src.events import earnings_store as store
from tests.test_earnings_cache import (  # noqa: F401  (fixtures)
    NOW,
    SECRET,
    TODAY,
    Clock,
    Finnhub,
    _no_network,
    _reconciled_market,
    db,
    market,
    mod,
    release_of,
    run,
    vault_of,
)


class Mono:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


class GitHub:
    """The data-latest release as the child reports it: (exit code, stdout) per request."""

    def __init__(self, assets: dict[str, bytes] | None = None, mono: Mono | None = None):
        self.assets = dict(assets or {})
        self.ids = {n: i + 100 for i, n in enumerate(sorted(self.assets))}
        self.fail: dict[str, tuple[int, bytes]] = {}
        self.calls: list[tuple[str, str, float]] = []
        self.mono = mono
        self.cost = {"list": 0.0, "asset": 0.0}  # fake seconds each request takes

    def put(self, name: str, body: bytes) -> None:
        self.assets[name] = body
        self.ids[name] = max(self.ids.values(), default=99) + 1

    def __call__(self, op, url, deadline):
        self.calls.append((op, url, deadline))
        assert deadline == (lr.LIST_S if op == "list" else lr.DOWNLOAD_S)
        if self.mono is not None:
            self.mono.t += self.cost[op]
        if op in self.fail:
            return self.fail[op]
        if op == "list":
            assert url == lr.LIST_URL
            listing = [{"name": "macro_radar.db", "id": 1}] + [{"name": n, "id": self.ids[n]} for n in sorted(self.assets)]
            return 0, json.dumps(listing).encode()
        aid = int(url.rsplit("/", 1)[1])
        assert url == lr.asset_url(aid)
        name = next(n for n, i in self.ids.items() if i == aid and n in self.assets)
        return 0, self.assets[name]


def ledger_assets(db):
    rel = release_of(db)
    return {n: rel.assets[n] for n in rel.ledger_names()}


def two_runs(mod, db):
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    return rows


@pytest.fixture
def gh(mod, db):
    two_runs(mod, db)
    mono = Mono()
    return GitHub(ledger_assets(db), mono)


def reader(gh, **kw):
    return lr.Reader(SECRET, gh, mono=gh.mono, **kw)


def newest(gh):
    return max(store.ledger_seq(n) for n in gh.assets)


# ── off, starting, ok ───────────────────────────────────────────────────────

def test_no_reader_is_off_and_start_needs_both_settings(monkeypatch):
    assert lr.current().status == "off"
    assert lr.start({"GH_DB_TOKEN": "t"}) is False
    assert lr.start({store.KEY_ENV: SECRET}) is False
    assert lr.current().status == "off"


def test_a_new_reader_is_starting_until_its_first_success(gh):
    r = reader(gh)
    assert r.current().status == "starting"
    gh.fail["list"] = (-1, b"")
    assert r.check_once() == "transient"
    assert r.current().status == "starting"  # nothing from before is trusted (design LR 3.5)
    del gh.fail["list"]
    assert r.check_once() == "ok"
    s = r.current()
    assert s.status == "ok" and s.seq == newest(gh) and s.vault["seq"] == s.seq
    assert s.index == store.index(s.vault)


def test_an_unchanged_listing_downloads_nothing(gh):
    r = reader(gh)
    r.check_once()
    n = len(gh.calls)
    gh.mono.t += 600
    assert r.check_once() == "ok"
    assert [c[0] for c in gh.calls[n:]] == ["list"]
    assert gh.mono.t - r.current().last_success == 0


# ── transient vs confirmed invalid (C2) ─────────────────────────────────────

@pytest.mark.parametrize("failure", [(-1, b""), (30, b"network"), (30, b"rate_limited"), (1, b""), (0, b"not json")])
def test_a_transient_failure_keeps_the_last_good_state_until_30_minutes(gh, failure):
    r = reader(gh)
    r.check_once()
    gh.fail["list"] = failure
    for _ in range(14):
        gh.mono.t += 120
        assert r.check_once() == "transient"
    assert gh.mono.t - r.current().last_success == 1680
    assert r.current().status == "ok"
    gh.mono.t += 119
    assert r.current().status == "ok"
    gh.mono.t += 1
    assert r.current().status == "stale"  # 1800 s after the last success
    del gh.fail["list"]
    assert r.check_once() == "ok" and r.current().status == "ok"  # recovery: the next success


def test_a_transient_download_failure_keeps_the_last_good_state(gh, mod, db):
    r = reader(gh)
    r.check_once()
    held = r.current().seq
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=40)))
    for n, b in ledger_assets(db).items():
        gh.put(n, b) if n not in gh.assets else None
    gh.fail["asset"] = (30, b"gone")
    assert r.check_once() == "transient"
    assert r.current().status == "ok" and r.current().seq == held


@pytest.mark.parametrize("word,status", [(b"unauthorized", "unauthorized"), (b"forbidden", "unauthorized"),
                                         (b"missing", "missing"), (b"malformed", "unreadable")])
def test_a_confirmed_invalid_listing_is_unknown_at_once_and_recovers(gh, word, status):
    r = reader(gh)
    assert r.check_once() == "ok"
    gh.fail["list"] = (20, word)
    assert r.check_once() == "invalid"
    assert r.current().status == status  # no grace (C2)
    del gh.fail["list"]
    assert r.check_once() == "ok" and r.current().status == "ok"


def test_a_listing_with_no_ledger_asset_is_missing(gh):
    r = reader(gh)
    gh.assets = {}
    assert r.check_once() == "invalid" and r.current().status == "missing"


def test_a_ledger_like_name_out_of_sequence_form_is_misnamed(gh):
    r = reader(gh)
    gh.put(store.LEDGER_PREFIX + "12" + store.LEDGER_SUFFIX, b"x")
    assert r.check_once() == "invalid" and r.current().status == "misnamed"


@pytest.mark.parametrize("case", ["garbage", "rotated", "oversized", "child_oversized", "child_unauthorized"])
def test_a_newest_asset_that_cannot_be_trusted_is_unknown_at_once(gh, case):
    r = reader(gh)
    r.check_once()
    name = store.ledger_name(newest(gh) + 1)
    if case == "garbage":
        gh.put(name, b"not a ledger")
    elif case == "rotated":
        v = dict(r.current().vault, seq=newest(gh) + 1)
        gh.put(name, store.seal_ledger(v, "another-key", v["seq"], NOW))
    elif case == "oversized":
        gh.put(name, b"x" * (lr.MAX_ASSET + 1))
    else:
        gh.put(name, b"x")
        gh.fail["asset"] = (20, b"oversized" if case == "child_oversized" else b"unauthorized")
    assert r.check_once() == "invalid"
    want = {"rotated": "rotated", "child_unauthorized": "unauthorized"}.get(case, "unreadable")
    assert r.current().status == want


# ── continuity and monotonic seq (C3) ───────────────────────────────────────

def test_a_listing_that_goes_backwards_is_regressed_until_a_higher_seq_continues(gh, mod, db):
    r = reader(gh)
    r.check_once()
    top = newest(gh)
    del gh.assets[store.ledger_name(top)]
    assert r.check_once() == "invalid" and r.current().status == "regressed"
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=40)))
    for n, b in ledger_assets(db).items():
        if store.ledger_seq(n) > top:
            gh.put(n, b)
    assert r.check_once() == "ok" and r.current().seq > top


def test_the_same_seq_under_another_asset_with_other_contents_is_regressed(gh):
    r = reader(gh)
    r.check_once()
    top = newest(gh)
    v = dict(r.current().vault)
    v["withdrawn"] = {}
    v["runs"] = list(v["runs"]) + [{"id": "x", "started": store.iso(NOW)}]
    gh.put(store.ledger_name(top), store.seal_ledger(v, SECRET, top, NOW))  # re-uploaded: a new id
    assert r.check_once() == "invalid" and r.current().status == "regressed"


def test_the_same_seq_under_another_asset_with_equal_contents_is_ok(gh):
    r = reader(gh)
    r.check_once()
    top = newest(gh)
    gh.put(store.ledger_name(top), store.seal_ledger(r.current().vault, SECRET, top, NOW))
    assert r.check_once() == "ok" and r.current().asset_id == gh.ids[store.ledger_name(top)]


def test_a_higher_seq_that_drops_evidence_is_inconsistent(gh, mod, db):
    rows = _reconciled_market()
    r = reader(gh)
    run(mod, db, Finnhub(rows, None, fail_at={1: 429}), clock=Clock(NOW + timedelta(hours=44)))
    for n, b in ledger_assets(db).items():
        if n not in gh.assets:
            gh.put(n, b)
    assert r.check_once() == "ok"
    held = r.current()
    assert held.vault["withdrawn"]
    fork = json.loads(json.dumps(held.vault))
    fork["withdrawn"] = {}
    fork["seq"] = held.seq + 1
    gh.put(store.ledger_name(fork["seq"]), store.seal_ledger(fork, SECRET, fork["seq"], NOW))
    assert r.check_once() == "invalid" and r.current().status == "inconsistent"
    assert r._good.seq == held.seq  # the last good state is what a later seq must continue


def test_a_restarted_reader_trusts_nothing_until_its_first_success(gh):
    r = reader(gh)
    r.check_once()
    again = reader(gh)  # a new process: nothing persisted
    assert again.current().status == "starting" and again.current().vault is None
    assert again.check_once() == "ok"


# ── propagation, bounds and shutdown (C1, DR-26) ────────────────────────────

class FakeStop:
    def __init__(self, mono, checks):
        self.mono, self.left = mono, checks

    def is_set(self):
        return self.left <= 0

    def wait(self, s):
        self.left -= 1
        self.mono.t += s
        return self.is_set()


def test_an_upload_is_held_within_10_minutes_45_seconds_with_both_deadlines_at_their_limit(gh, mod, db):
    r = reader(gh)
    gh.cost = {"list": lr.LIST_S, "asset": lr.DOWNLOAD_S}
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=40)))
    later = {n: b for n, b in ledger_assets(db).items() if n not in gh.assets}
    target = max(store.ledger_seq(n) for n in later)
    first = gh.mono.t
    upload_at = first + 0.001  # just after a check started: the worst case
    held_at = {}
    real_call = gh.__call__

    def calling(op, url, deadline):
        if gh.mono.t >= upload_at and later:
            for n, b in list(later.items()):
                gh.put(n, b)
                later.pop(n)
        out = real_call(op, url, deadline)
        return out

    r._run = calling
    orig_publish = r._publish

    def publish(snap):
        orig_publish(snap)
        if snap.seq == target and "t" not in held_at:
            held_at["t"] = gh.mono.t

    r._publish = publish
    r._stop = FakeStop(gh.mono, 3)
    r._loop()
    assert held_at["t"] - upload_at <= 600 + lr.LIST_S + lr.DOWNLOAD_S  # 10 min 45 s


def test_after_a_failed_check_the_next_starts_within_2_minutes(gh):
    r = reader(gh)
    gh.fail["list"] = (-1, b"")
    starts = []
    real = gh.__call__

    def calling(op, url, deadline):
        starts.append(gh.mono.t)
        return real(op, url, deadline)

    r._run = calling
    r._stop = FakeStop(gh.mono, 3)
    r._loop()
    assert [b - a for a, b in zip(starts, starts[1:])] == [120, 120]


def test_shutdown_returns_within_5_seconds_with_a_check_in_flight(gh):
    release = threading.Event()

    def stuck(op, url, deadline):
        release.wait(60)
        return -1, b""

    r = lr.Reader(SECRET, stuck)
    r.start()
    time.sleep(0.1)
    t0 = time.monotonic()
    r.stop()
    assert time.monotonic() - t0 <= lr.JOIN_S + 0.5
    release.set()


# ── consistent snapshots, unchanged ages (C4) ───────────────────────────────

def test_concurrent_reads_during_swaps_see_whole_snapshots(gh):
    r = reader(gh)
    r.check_once()
    good = r.current()
    snaps = [lr.Snapshot("ok", seq=s, vault={"seq": s}, index={}, last_success=gh.mono.t, high=s) for s in range(50)]
    bad = []

    def read():
        for _ in range(2000):
            s = r.current()
            if s.vault is not None and s.vault.get("seq") != s.seq:
                bad.append(s)

    ts = [threading.Thread(target=read) for _ in range(4)]
    for t in ts:
        t.start()
    for s in snaps * 20:
        r._publish(s)
    for t in ts:
        t.join()
    r._publish(good)
    assert not bad


def test_checks_downloads_and_restarts_never_change_an_observations_age(gh):
    r = reader(gh)
    r.check_once()
    v = r.current().vault
    sealed = json.dumps(v, sort_keys=True)
    session = TODAY + timedelta(days=2)
    raws = store.index(v)["ZQZZ9"]
    at = NOW + timedelta(hours=30)
    before = store.coverage(v, raws, session, at)
    for _ in range(5):  # repeated checks, a re-download under a new asset id, a restart
        gh.mono.t += 600
        r.check_once()
    top = newest(gh)
    gh.put(store.ledger_name(top), store.seal_ledger(v, SECRET, top, NOW + timedelta(days=3)))
    r.check_once()
    again = reader(gh)
    again.check_once()
    for s in (r.current(), again.current()):
        assert json.dumps(s.vault, sort_keys=True) == sealed
        after = store.coverage(s.vault, s.index["ZQZZ9"], session, at)
        assert after == before  # the same entries' `at`, so the same ages


# ── settings (DR-27) ────────────────────────────────────────────────────────

@pytest.mark.parametrize("refresh,stale,want", [
    (None, None, (600, 1800)), ("300", "900", (300, 900)), ("900", "1800", (900, 1800)),
    ("nan", None, (600, 1800)), ("inf", "inf", (600, 1800)), ("-60", "-1", (600, 1800)), ("60.5", None, (600, 1800)),
    ("0", None, (600, 1800)), ("59", None, (600, 1800)), ("901", None, (600, 1800)), ("1e3", None, (600, 1800)),
    ("600", "1801", (600, 1800)), ("600", "659", (600, 1800)), ("600", "660", (600, 660)), ("600", "99999999", (600, 1800)),
])
def test_settings_are_bounded_and_staleness_never_exceeds_30_minutes(refresh, stale, want):
    env = {k: v for k, v in ((lr.REFRESH_ENV, refresh), (lr.STALE_ENV, stale)) if v is not None}
    assert lr.settings(env) == want
    assert lr.settings(env)[1] <= 1800


# ── the child (DR-34, DR-35) ────────────────────────────────────────────────

def test_the_child_imports_only_the_standard_library_and_httpx():
    tree = ast.parse(lr.CHILD.read_text())
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names.add((node.module or "").split(".")[0])
    assert names <= {"json", "math", "os", "signal", "sys", "httpx"}
    assert lr.CHILD.is_absolute()


BIG = lr.MAX_ASSET + 1


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body=b"", headers=()):
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: C901
        assert self.headers.get("Authorization") == "Bearer gh-TESTONLY"
        p = self.path
        if p == "/list/ok":
            return self._send(200, json.dumps({"assets": [{"name": "a.bin", "id": 7, "url": "x"}]}).encode())
        if p == "/list/bad":
            return self._send(200, b"<html>")
        if p == "/asset/ok":
            return self._send(200, b"sealed-bytes")
        if p == "/asset/big":
            return self._send(200, b"x" * BIG)
        if p.startswith("/status/"):
            _, _, code, extra = (p.split("/") + [""])[:4]
            hdrs = [("x-ratelimit-remaining", "0")] if extra == "rl" else []
            return self._send(int(code), b"{}", hdrs)
        if p == "/slow-headers":
            time.sleep(4)
            return self._send(200, b"late")
        if p.startswith("/hop/"):
            n = int(p.rsplit("/", 1)[1])
            time.sleep(0.8)
            if n == 0:
                return self._send(200, b"end")
            return self._send(302, b"", [("Location", f"/hop/{n - 1}")])
        if p == "/drip":
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            for _ in range(1000):
                self.wfile.write(b"x")
                self.wfile.flush()
                time.sleep(0.5)
            return None
        if p == "/never":
            time.sleep(30)
            return None
        return self._send(500)


@pytest.fixture
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def child_env():
    env = {k: v for k, v in os.environ.items() if "proxy" not in k.lower()}
    env["GH_DB_TOKEN"] = "gh-TESTONLY"
    return env


def live_children():
    out = []
    for p in Path("/proc").iterdir():
        if p.name.isdigit():
            try:
                if lr.CHILD.name.encode() in (p / "cmdline").read_bytes():
                    out.append(p.name)
            except OSError:
                pass
    return out


@pytest.mark.parametrize("op,path,want", [
    ("list", "/list/ok", (0, None)),
    ("list", "/list/bad", (20, b"malformed")),
    ("list", "/status/401", (20, b"unauthorized")),
    ("list", "/status/403/rl", (30, b"rate_limited")),
    ("list", "/status/403", (20, b"forbidden")),
    ("list", "/status/404", (20, b"missing")),
    ("list", "/status/408", (30, b"status_408")),
    ("list", "/status/429", (30, b"status_429")),
    ("list", "/status/502", (30, b"status_502")),
    ("list", "/status/418", (30, b"status_418")),
    ("asset", "/asset/ok", (0, b"sealed-bytes")),
    ("asset", "/asset/big", (20, b"oversized")),
    ("asset", "/status/401", (20, b"unauthorized")),
    ("asset", "/status/403/rl", (30, b"rate_limited")),
    ("asset", "/status/403", (20, b"forbidden")),
    ("asset", "/status/404", (30, b"gone")),
    ("asset", "/status/410", (30, b"gone")),
    ("asset", "/status/503", (30, b"status_503")),
    ("asset", "/hop/1", (0, b"end")),
    ("asset", "/hop/5", (30, b"network")),  # more than 3 redirects
])
def test_the_real_child_classifies_every_response(server, tmp_path, monkeypatch, op, path, want):
    monkeypatch.chdir(tmp_path)  # run from outside the repository: -I keeps it off sys.path anyway
    code, out = lr.run_child(op, server + path, 10.0, env=child_env())
    assert code == want[0]
    if want[1] is not None:
        assert out == want[1]
    else:
        assert json.loads(out) == [{"name": "a.bin", "id": 7}]


def test_the_child_without_a_token_is_unauthorized(server):
    env = child_env()
    del env["GH_DB_TOKEN"]
    assert lr.run_child("list", server + "/list/ok", 10.0, env=env) == (20, b"unauthorized")


@pytest.mark.parametrize("path", ["/slow-headers", "/drip", "/never", "/hop/3"])
def test_the_real_child_is_killed_at_its_deadline_and_leaves_nothing_running(server, path):
    t0 = time.monotonic()
    code, _ = lr.run_child("asset", server + path, 2.0, env=child_env())
    took = time.monotonic() - t0
    assert code not in (0, 20)  # transient
    assert took < 3.0
    assert not live_children()
    assert lr.run_child("list", server + "/list/ok", 10.0, env=child_env())[0] == 0  # the next check succeeds


def test_the_listing_url_and_asset_urls_point_at_the_repository():
    from api.bootstrap import _GH_API_REPO

    assert lr.LIST_URL == f"{_GH_API_REPO}/releases/tags/data-latest"
    assert lr.asset_url(12) == f"{_GH_API_REPO}/releases/assets/12"
    with pytest.raises(ValueError):
        lr.asset_url("12/../../x")
