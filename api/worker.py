"""api/worker.py — generations, and the background worker that builds them
(fix/prelaunch-1: B-H1 and "off the request path").

A generation is an in-memory copy of the database file plus every
database-derived result computed from that copy: credit metrics, the
recession model and its metrics, the Regime Lab payloads, the LBO defaults and
allocation (api/analytics_cache.ITEMS). The worker thread, started with the
server, preloads the heavy libraries, builds the first generation, and builds a
new one whenever the database file key (src/analytics/dbpath.file_key) moves:
a bootstrap swap, `make sync-data`, an operator copying a file into place.

The new generation is published whole. Until it is, the previous one keeps
answering, reads and results alike (api/db.py and every analytics module read
the published copy through dbpath), so a swap can never leave one screen on
the old file and another on the new one, and no request waits for, or runs,
a computation. Handlers only look results up. Each HTTP request is pinned to
the generation published when it arrived (PinGeneration), so one response
never mixes two; a replaced generation stays readable until the next publish.

The last good result is the last good generation, whole. If an item the
served generation answers well fails on a new file, the new generation is held
back and the previous one keeps serving everything, so no screen shows a
result from one file beside another from the next; the worker retries, and
after HOLD_ATTEMPTS consecutive failed builds (whatever the file) publishes
anyway, the failed item answering with its error (never with a result carried
over from another file). A failure the served generation already has is no
reason to wait: that file publishes at once. An answer that is a fact about the file (NotStored)
is not a failure. A file that cannot be staged at all leaves the last good
generation serving, is retried with a backoff, and is reported in last_error.

Before the first generation exists, a request waits up to WAIT_S seconds for
it, then gets 503 with Retry-After and a "warming" body; /health/ready reports
ready only once the first pass has completed.

The worker also keeps the market strip's and the default watchlist's candles
warm (prefetch_tick), so a first visitor does not wait on EODHD for them.
"""

from __future__ import annotations

import collections
import copy
import gc
import itertools
import logging
import os
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from api import db
from src.analytics import dbpath

log = logging.getLogger("mrr.worker")

WAIT_S = 5.0  # a request that arrives before the first pass waits this long
POLL_S = 2.0  # how often the worker re-reads the file key (bootstrap pokes it after a swap)
RETRY_AFTER_S = 3
# The fixed strip (web/src/screens/shell/TickerLive.tsx) and the default
# watchlist (web/src/screens/shell/watchlist/storage.ts), whose rows ask for 5D
# candles until a live quote arrives. Pinned to the web sources by
# tests/test_provider_no_yahoo.py so the two cannot drift.
PREFETCH_SYMBOLS = ("SPY", "QQQ", "IWM", "EEM")
PREFETCH_RANGES = ("5D",)
PREFETCH_MARGIN_S = 20.0  # refresh this long before the cache entry expires
PREFETCH_EVERY_S = 10.0
# A series whose fetch fails is not retried every tick (launch-1 verify loop 1,
# D4): a failure or an empty answer is never cached, so a dead provider used to
# be asked every 10 s, up to three billed attempts each, which is about 85,000
# units in one session day. It now waits 2, 4, 8, 16 then 30 minutes.
PREFETCH_BACKOFF_BASE_S = 120.0
PREFETCH_BACKOFF_MAX_S = 1800.0
_prefetch_backoff: dict[tuple[str, str], tuple[float, int]] = {}
_prefetch_backoff_lock = threading.Lock()


def reset_prefetch_backoff() -> None:
    with _prefetch_backoff_lock:
        _prefetch_backoff.clear()
STAGE_RETRY_MAX_S = 60.0  # an unreadable file is retried after 2, 4, 8 … s, at most this far apart
HOLD_ATTEMPTS = 3  # builds of a new file whose items fail before it publishes with the failures as errors
HOLD_RETRY_S = 30.0  # the first retry of a held file comes after this long, then doubles

# A full garbage collection walks every tracked object; after the libraries
# load and the first generation builds that is ~180k of them, ~30 ms idle and
# more on a busy host, and it holds the GIL (/health/live spiked past 100 ms
# under visitor load, verify loop 1). The serving process freezes that heap
# once (gc.freeze): later collections walk only what came after it.
_HEAP_FROZEN = False

Item = tuple[str, Callable[[dict], Any]]
# A shared-cache in-memory database is found by name: two generations sharing
# a name would share one database. Names come from a process-wide counter,
# never from id(), which Python reuses after an object is collected.
_URI_SEQ = itertools.count(1)


class Warming(Exception):
    """No generation has been published yet (the server is starting)."""

    def __init__(self, retry_after: int = RETRY_AFTER_S) -> None:
        self.retry_after = retry_after
        self.detail = ("The server is warming up: it is computing its results for the first time. "
                       f"Retry in {retry_after} seconds.")
        super().__init__(self.detail)


@dataclass
class Generation:
    id: int
    key: tuple
    source: Path
    uri: str
    anchor: sqlite3.Connection | None
    owner: Any = None
    results: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, BaseException] = field(default_factory=dict)
    item_ms: dict[str, float] = field(default_factory=dict)
    staged_at: str = ""
    built_at: str | None = None
    build_ms: float | None = None

    def close(self) -> None:
        """Release the anchor. Readers still holding a connection keep the
        in-memory copy alive until they move to the next generation."""
        if self.anchor is not None:
            try:
                self.anchor.close()
            except sqlite3.Error:
                pass
            self.anchor = None


def _detached(exc: BaseException) -> BaseException:
    """A build error as stored: without its traceback (or its chain's), which
    held the build's frames and, through them, the generation itself in a
    reference cycle that a frozen heap never frees."""
    seen: set[int] = set()
    e: BaseException | None = exc
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        e.__traceback__ = None
        e = e.__cause__ or e.__context__
    return exc


def _fresh(exc: BaseException) -> BaseException:
    """A copy of a stored error to raise. Raising the stored object itself
    chained every request's frames onto its traceback (~53 KB a request, with
    no bound: verify loop 2)."""
    try:
        return copy.copy(exc)
    except Exception:  # noqa: BLE001 — an exception type copy cannot rebuild
        return exc.with_traceback(None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _same_path(a: Path | str, b: Path | str) -> bool:
    return os.path.realpath(a) == os.path.realpath(b)


def _preload_libraries() -> None:
    """Import everything this process's builds touch, off the request path,
    once. Allocation's libraries (riskfolio, cvxpy) load only in its child
    process (api/allocation_child.py), never here."""
    import numpy  # noqa: F401
    import pandas  # noqa: F401
    import sklearn.linear_model  # noqa: F401
    import sklearn.preprocessing  # noqa: F401

    import api.analytics_cache  # noqa: F401
    import src.analytics.credit  # noqa: F401
    import src.analytics.intelligence  # noqa: F401
    import src.analytics.lbo  # noqa: F401
    import src.analytics.recession  # noqa: F401
    import src.analytics.regimes  # noqa: F401


def _freeze_heap_once() -> None:
    global _HEAP_FROZEN
    if _HEAP_FROZEN:
        return
    _HEAP_FROZEN = True
    gc.collect()
    gc.freeze()
    log.info("heap frozen after the first build: %d objects out of the collector's reach", gc.get_freeze_count())


def _default_items() -> list[Item]:
    from api import analytics_cache

    return analytics_cache.ITEMS


def prefetch_enabled(now: datetime | None = None) -> bool:
    """Whether the market prefetch should run at all (launch-1).

    The prefetched series are 5-minute intraday bars. Outside the US session
    no new bar prints, so refreshing them costs EODHD quota for a chart that
    cannot change: weekends, holidays and every night. It resumes at the
    opening bell (the loop re-checks every couple of seconds)."""
    from api import calendar as cal

    return bool(cal.session_state(now or datetime.now(timezone.utc))["is_open"])


def _prefetch_has_token() -> bool:
    from api.providers import market

    return bool(market.client().token)


def prefetch_tick() -> int:
    """Warm (or refresh ahead of expiry) the fixed symbols' candles. Returns
    how many series were fetched; provider errors are logged, never raised."""
    from api.providers import market
    from api.providers.errors import ProviderError

    fetched = 0
    for sym in PREFETCH_SYMBOLS:
        for rk in PREFETCH_RANGES:
            key = (sym, rk)
            now = time.monotonic()
            with _prefetch_backoff_lock:
                retry_at, failures = _prefetch_backoff.get(key, (0.0, 0))
            if now < retry_at:
                continue
            try:
                if market.refresh_candles(sym, rk, PREFETCH_MARGIN_S):
                    fetched += 1
            except ProviderError as exc:
                failures += 1
                wait = min(PREFETCH_BACKOFF_BASE_S * 2 ** (failures - 1), PREFETCH_BACKOFF_MAX_S)
                with _prefetch_backoff_lock:
                    _prefetch_backoff[key] = (now + wait, failures)
                log.info("prefetch %s %s: %s; next try in %d s", sym, rk, exc.kind, wait)
                continue
            if failures:
                with _prefetch_backoff_lock:
                    _prefetch_backoff.pop(key, None)
    return fetched


class AnalyticsWorker:
    def __init__(
        self,
        items: list[Item] | None = None,
        *,
        poll_s: float = POLL_S,
        wait_s: float = WAIT_S,
        build_gate: threading.Event | None = None,
        preload: bool = True,
        prefetch: bool = False,
    ) -> None:
        self._items = items
        self.poll_s = poll_s
        self.wait_s = wait_s
        self._build_gate = build_gate
        self._preload = preload
        self.prefetch = prefetch
        self._cond = threading.Condition()
        self._current: Generation | None = None
        self._retired: Generation | None = None  # the one before, readable until the next publish
        self._failed: tuple[tuple, int, float] | None = None  # (file key, attempts, retry at): an unstageable file
        self._hold: tuple[tuple, int, float] | None = None  # (file key, attempts, retry at): a file whose items failed
        self._ids = itertools.count(1)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._poke = threading.Event()
        self.serving = False
        self.thread_name = f"mrr-analytics-worker-{id(self):x}"
        self.compute_counts: collections.Counter = collections.Counter()
        self.compute_threads: set[str] = set()
        self.builds = 0
        self.state = "idle"
        self.last_error: str | None = None
        self._next_prefetch = 0.0
        self._preloaded = False
        self.freeze_gc = False  # the API's lifespan turns it on (GC_FREEZE); tests keep a normal heap
        self.hold_retry_s = HOLD_RETRY_S
        self._held: dict | None = None  # a new file held back: its name, the attempts, the items that failed

    # ── lifecycle ────────────────────────────────────────────────────────

    def start(self, *, serving: bool = True) -> None:
        """Start the thread (idempotent). serving=True also routes every read
        in the process to the published generation; the API's lifespan does
        that. Without it (tests, scripts), results still come from the worker
        but callers only accept a generation built from the current file."""
        with self._cond:
            if serving and not self.serving:
                self.serving = True
                dbpath.install_provider(self._served)
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name=self.thread_name, daemon=True)
            self._thread.start()

    def ensure_started(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self.start(serving=False)

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._poke.set()
        t = self._thread
        if t is not None and t is not threading.current_thread():
            t.join(timeout)
        if self.serving:
            dbpath.clear_provider()
            self.serving = False
        with self._cond:
            gen, self._current = self._current, None
            retired, self._retired = self._retired, None
            self._cond.notify_all()
        for g in (gen, retired):
            if g is not None:
                g.close()

    def poke(self) -> None:
        self._poke.set()

    def _served(self) -> Generation | None:
        return self._current

    # ── building ─────────────────────────────────────────────────────────

    def _run(self) -> None:
        # The preload happens inside the first build, after its async items
        # (allocation's child process) have started, so the two overlap.
        while not self._stop.is_set():
            try:
                self._maybe_build()
            except Exception as exc:  # noqa: BLE001 — the loop must survive
                self.last_error = repr(exc)
                log.exception("generation build failed")
            self._prefetch_once()
            self._poke.wait(self.poll_s)
            self._poke.clear()

    def _prefetch_once(self) -> None:
        """One prefetch tick when it is due, the US session is open and a
        token is configured. Outside the session the cheapest EODHD call is
        the one never made (launch-1)."""
        if not self.prefetch or time.monotonic() < self._next_prefetch:
            return
        try:
            if prefetch_enabled() and _prefetch_has_token():
                prefetch_tick()
        except Exception:  # noqa: BLE001
            log.exception("prefetch failed")
        self._next_prefetch = time.monotonic() + PREFETCH_EVERY_S

    def _maybe_build(self) -> None:
        src = Path(db.DB_PATH)
        key = dbpath.file_key(src)
        cur = self._current
        if key is None:
            if cur is None:
                self.state = "no_database"
            return
        if cur is not None and cur.key == key and _same_path(cur.source, src):
            if self._held is not None or self._failed is not None:  # the file went back to the one being served
                self._held, self.last_error = None, None
            self._failed = self._hold = None
            return
        for blocked in (self._failed, self._hold):
            if blocked is not None and blocked[0] == key and time.monotonic() < blocked[2]:
                return  # this file could not be staged, or its items failed: wait out the backoff
        self._build(src, key)

    def _stage(self, src: Path, key: tuple) -> Generation | None:
        gid = next(self._ids)
        uri = f"file:mrr-gen-{os.getpid()}-{next(_URI_SEQ)}?mode=memory&cache=shared"
        anchor = sqlite3.connect(uri, uri=True, check_same_thread=False)
        try:
            source = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
            try:
                source.backup(anchor)
            finally:
                source.close()
        except sqlite3.Error as exc:
            anchor.close()
            attempts = self._failed[1] + 1 if self._failed is not None and self._failed[0] == key else 1
            self._failed = (key, attempts, time.monotonic() + min(STAGE_RETRY_MAX_S, 2.0 ** attempts))
            self.last_error = f"staging {src.name}: {exc} (attempt {attempts}; the last good generation keeps serving)"
            if attempts == 1 or attempts % 10 == 0:
                log.warning("could not stage %s (attempt %d): %s", src, attempts, exc)
            self.state = "ready" if self._current is not None else "error"
            return None
        self._failed = None
        return Generation(id=gid, key=key, source=src, uri=uri, anchor=anchor, owner=self, staged_at=_now_iso())

    def _build(self, src: Path, key: tuple) -> None:
        self.state = "building"
        t0 = time.perf_counter()
        gen = self._stage(src, key)
        if gen is None:
            return
        if self._build_gate is not None:
            while not self._build_gate.wait(0.05):
                if self._stop.is_set():
                    gen.close()
                    return
        items = self._items if self._items is not None else _default_items()
        ctx: dict[str, Any] = {}
        pending: list[tuple[str, Any, Any, float]] = []
        with dbpath.pinned(gen):
            # Async items (start/finish, e.g. allocation in its child process)
            # start first and are collected last.
            for name, fn in items:
                if hasattr(fn, "start"):
                    t = time.perf_counter()
                    self.compute_threads.add(threading.current_thread().name)
                    try:
                        pending.append((name, fn, fn.start(ctx), t))
                    except Exception as exc:  # noqa: BLE001
                        gen.errors[name] = _detached(exc)
                        self.compute_counts[name] += 1
            if self._preload and not self._preloaded:
                self.state = "preloading"
                try:
                    _preload_libraries()
                except Exception:  # noqa: BLE001
                    log.exception("preload failed; builds will import on demand")
                self._preloaded = True
                self.state = "building"
            for name, fn in items:
                if hasattr(fn, "start"):
                    continue
                if self._stop.is_set():
                    for _, afn, handle, _ in pending:
                        afn.cancel(handle)
                    gen.close()
                    return
                t = time.perf_counter()
                self.compute_threads.add(threading.current_thread().name)
                try:
                    value = fn(ctx)
                except Exception as exc:  # noqa: BLE001 — stored as this item's answer
                    gen.errors[name] = _detached(exc)
                    log.warning("generation %d: %s failed: %s", gen.id, name, exc)
                else:
                    ctx[name] = value
                    gen.results[name] = value
                self.compute_counts[name] += 1
                gen.item_ms[name] = round((time.perf_counter() - t) * 1000, 1)
            for name, fn, handle, t in pending:
                try:
                    value = fn.finish(handle)
                except Exception as exc:  # noqa: BLE001
                    gen.errors[name] = _detached(exc)
                    log.warning("generation %d: %s failed: %s", gen.id, name, exc)
                else:
                    ctx[name] = value
                    gen.results[name] = value
                self.compute_counts[name] += 1
                gen.item_ms[name] = round((time.perf_counter() - t) * 1000, 1)
            # The stored maxima every freshness block reads, once per
            # generation and off the request path (db.freshness memo).
            try:
                db.freshness()
            except Exception as exc:  # noqa: BLE001 — a request will compute them instead
                log.warning("generation %d: stored maxima not precomputed: %s", gen.id, exc)
        cur = self._current
        # Hold back only for a regression: an item the served generation
        # answers well. One it already answers as an error (or as NotStored)
        # has no good result to keep, and waiting would only make every
        # refresh late while it stays broken.
        regressed = sorted(n for n, e in gen.errors.items()
                           if not isinstance(e, db.NotStored) and cur is not None and n in cur.results)
        if regressed:
            # consecutive failed builds since the last publish, whatever the
            # file, so failing files arriving faster than the retries still publish
            attempts = self._hold[1] + 1 if self._hold is not None else 1
            if attempts < HOLD_ATTEMPTS:
                # Hold it back: the previous generation keeps serving whole.
                self._hold = (key, attempts, time.monotonic() + self.hold_retry_s * 2 ** (attempts - 1))
                self._held = {"file": src.name, "attempts": attempts, "items": regressed}
                self.last_error = (f"generation from {src.name} held back: {', '.join(regressed)} failed "
                                   f"(attempt {attempts} of {HOLD_ATTEMPTS}); the previous generation keeps serving whole")
                log.warning("%s", self.last_error)
                self.state = "ready"
                gen.close()
                return
            log.warning("generation %d publishes after %d failed builds with %s answering as errors", gen.id, attempts,
                        ", ".join(regressed))
        if self.freeze_gc:
            _freeze_heap_once()
        gen.build_ms = round((time.perf_counter() - t0) * 1000, 1)
        gen.built_at = _now_iso()
        self._publish(gen)

    def _publish(self, gen: Generation) -> None:
        with self._cond:
            old, self._current = self._current, gen
            released, self._retired = self._retired, old
            self.builds += 1
            self.state = "ready"
            self.last_error = None
            self._held = None
            self._hold = None
            self._cond.notify_all()
        # The replaced generation stays readable until the next publish: a
        # request pinned to it (or one that looked it up an instant ago) must
        # never open its name after the copy is gone.
        if released is not None:
            released.close()
        log.info("generation %d published in %.0f ms: %d results, %d errors (%s)", gen.id, gen.build_ms or 0,
                 len(gen.results), len(gen.errors), ", ".join(sorted(gen.errors)) or "none")

    # ── serving ──────────────────────────────────────────────────────────

    def _usable(self, gen: Generation) -> bool:
        src = Path(db.DB_PATH)
        if not _same_path(gen.source, src):
            return False
        if self.serving:
            return True  # served until the next generation is complete
        return gen.key == dbpath.file_key(src)

    def ready(self) -> bool:
        gen = self._current
        return gen is not None and self._usable(gen)

    def generation(self) -> Generation | None:
        """The generation this context reads: the request's pin (or the
        build's), else the published one."""
        pinned = dbpath.pinned_generation()
        if isinstance(pinned, Generation) and pinned.owner is self:
            return pinned
        return self._current

    def result(self, name: str) -> Any:
        """This request's generation's result for `name` (or a fresh copy of
        its stored error). Never computes. Without a usable generation, waits
        up to wait_s for one, then raises Warming."""
        self.ensure_started()
        gen = self.generation()
        if gen is None or not self._usable(gen):
            deadline = time.monotonic() + self.wait_s
            with self._cond:
                while True:
                    gen = self._current
                    if gen is not None and self._usable(gen):
                        break
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise Warming()
                    self._poke.set()
                    self._cond.wait(min(remaining, 0.25))
        if name in gen.results:
            return gen.results[name]
        if name in gen.errors:
            raise _fresh(gen.errors[name])
        raise KeyError(f"no result named {name!r}")

    def wait_published(self, min_id: int = 1, timeout: float = 30.0) -> bool:
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._current is None or self._current.id < min_id:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._cond.wait(remaining)
        return True

    @property
    def current(self) -> Generation | None:
        return self._current

    def status(self) -> dict:
        gen = self._current
        src = Path(db.DB_PATH)
        return {
            "state": self.state,
            "serving": self.serving,
            "generation": gen.id if gen else None,
            "built_at": gen.built_at if gen else None,
            "build_ms": gen.build_ms if gen else None,
            "results": len(gen.results) if gen else 0,
            "errors": sorted(gen.errors) if gen else [],
            "held": dict(self._held) if self._held else None,
            "current_with_file": bool(gen and gen.key == dbpath.file_key(src) and _same_path(gen.source, src)),
            "builds": self.builds,
            "last_error": self.last_error,
        }


class PinGeneration:
    """Pure-ASGI middleware: each HTTP request reads the generation published
    when it arrived, from its first lookup to its last, so one response never
    mixes two (a recession sensitivity scored on one generation's model with
    the next one's baseline, a payload with the next one's freshness block).
    Only while the worker serves; WebSockets are not pinned (the relay never
    reads the database, and a socket would hold a generation for hours)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        w = _worker
        gen = w.current if scope["type"] == "http" and w is not None and w.serving else None
        if gen is None:
            await self.app(scope, receive, send)
            return
        with dbpath.pinned(gen):
            await self.app(scope, receive, send)


_worker: AnalyticsWorker | None = None
_worker_lock = threading.Lock()


def get_worker() -> AnalyticsWorker:
    """The process's worker. WORKER_WAIT_S exists for the test harness, whose
    first request can land while a cold interpreter imports the libraries;
    production never sets it and waits WAIT_S."""
    global _worker
    with _worker_lock:
        if _worker is None:
            _worker = AnalyticsWorker(wait_s=float(os.environ.get("WORKER_WAIT_S", WAIT_S)))
        return _worker
