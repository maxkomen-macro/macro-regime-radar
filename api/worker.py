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
a computation. Handlers only look results up.

Before the first generation exists, a request waits up to WAIT_S seconds for
it, then gets 503 with Retry-After and a "warming" body; /health/ready reports
ready only once the first pass has completed.

The worker also keeps the market strip's and the default watchlist's candles
warm (prefetch_tick), so a first visitor does not wait on EODHD for them.
"""

from __future__ import annotations

import collections
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

Item = tuple[str, Callable[[dict], Any]]


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _same_path(a: Path | str, b: Path | str) -> bool:
    return os.path.realpath(a) == os.path.realpath(b)


def _preload_libraries() -> None:
    """Import everything a build touches, off the request path, once."""
    import numpy  # noqa: F401
    import pandas  # noqa: F401
    import scipy.optimize  # noqa: F401
    import sklearn.linear_model  # noqa: F401
    import sklearn.preprocessing  # noqa: F401

    import src.analytics.allocation  # noqa: F401
    import src.analytics.credit  # noqa: F401
    import src.analytics.intelligence  # noqa: F401
    import src.analytics.lbo  # noqa: F401
    import src.analytics.recession  # noqa: F401
    import src.analytics.regimes  # noqa: F401

    try:
        import riskfolio  # noqa: F401  (CVaR and HERC)
    except Exception:  # noqa: BLE001 — allocation falls back and says so
        pass


def _default_items() -> list[Item]:
    from api import analytics_cache

    return analytics_cache.ITEMS


def prefetch_tick() -> int:
    """Warm (or refresh ahead of expiry) the fixed symbols' candles. Returns
    how many series were fetched; provider errors are logged, never raised."""
    from api.providers import market
    from api.providers.errors import ProviderError

    fetched = 0
    for sym in PREFETCH_SYMBOLS:
        for rk in PREFETCH_RANGES:
            try:
                if market.refresh_candles(sym, rk, PREFETCH_MARGIN_S):
                    fetched += 1
            except ProviderError as exc:
                log.info("prefetch %s %s: %s", sym, rk, exc.kind)
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
            self._cond.notify_all()
        if gen is not None:
            gen.close()

    def poke(self) -> None:
        self._poke.set()

    def _served(self) -> Generation | None:
        return self._current

    # ── building ─────────────────────────────────────────────────────────

    def _run(self) -> None:
        if self._preload:
            self.state = "preloading"
            try:
                _preload_libraries()
            except Exception:  # noqa: BLE001
                log.exception("preload failed; builds will import on demand")
        while not self._stop.is_set():
            try:
                self._maybe_build()
            except Exception as exc:  # noqa: BLE001 — the loop must survive
                self.last_error = repr(exc)
                log.exception("generation build failed")
            if self.prefetch and time.monotonic() >= self._next_prefetch:
                try:
                    from api.providers import market

                    if market.client().token:
                        prefetch_tick()
                except Exception:  # noqa: BLE001
                    log.exception("prefetch failed")
                self._next_prefetch = time.monotonic() + PREFETCH_EVERY_S
            self._poke.wait(self.poll_s)
            self._poke.clear()

    def _maybe_build(self) -> None:
        src = Path(db.DB_PATH)
        key = dbpath.file_key(src)
        cur = self._current
        if key is None:
            if cur is None:
                self.state = "no_database"
            return
        if cur is not None and cur.key == key and _same_path(cur.source, src):
            return
        self._build(src, key)

    def _stage(self, src: Path, key: tuple) -> Generation | None:
        gid = next(self._ids)
        uri = f"file:mrr-gen-{os.getpid()}-{id(self):x}-{gid}?mode=memory&cache=shared"
        anchor = sqlite3.connect(uri, uri=True, check_same_thread=False)
        try:
            source = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
            try:
                source.backup(anchor)
            finally:
                source.close()
        except sqlite3.Error as exc:
            anchor.close()
            self.last_error = f"staging {src.name}: {exc}"
            log.warning("could not stage %s: %s", src, exc)
            return None
        return Generation(id=gid, key=key, source=src, uri=uri, anchor=anchor, staged_at=_now_iso())

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
        with dbpath.pinned(gen):
            for name, fn in items:
                if self._stop.is_set():
                    gen.close()
                    return
                t = time.perf_counter()
                self.compute_threads.add(threading.current_thread().name)
                try:
                    value = fn(ctx)
                except Exception as exc:  # noqa: BLE001 — stored as this item's answer
                    gen.errors[name] = exc
                    log.warning("generation %d: %s failed: %s", gen.id, name, exc)
                else:
                    ctx[name] = value
                    gen.results[name] = value
                self.compute_counts[name] += 1
                gen.item_ms[name] = round((time.perf_counter() - t) * 1000, 1)
        gen.build_ms = round((time.perf_counter() - t0) * 1000, 1)
        gen.built_at = _now_iso()
        self._publish(gen)

    def _publish(self, gen: Generation) -> None:
        with self._cond:
            old, self._current = self._current, gen
            self.builds += 1
            self.state = "ready"
            self._cond.notify_all()
        if old is not None:
            old.close()
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

    def result(self, name: str) -> Any:
        """The current generation's result for `name` (or its stored error).
        Never computes. Without a usable generation, waits up to wait_s for
        one, then raises Warming."""
        self.ensure_started()
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
        if name in gen.errors:
            raise gen.errors[name]
        if name not in gen.results:
            raise KeyError(f"no result named {name!r}")
        return gen.results[name]

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
            "current_with_file": bool(gen and gen.key == dbpath.file_key(src) and _same_path(gen.source, src)),
            "builds": self.builds,
            "last_error": self.last_error,
        }


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
