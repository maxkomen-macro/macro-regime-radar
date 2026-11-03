"""api/earnings_ledger_reader.py — the API reads the earnings cache's durable ledger in the background (design LR).

The refresh step writes its call accounting and invalidation state to sealed, sequenced ledger assets on the
data-latest release (src/events/earnings_ledger.py). A refresh whose database fails validation still writes the
ledger, so the ledger can carry a contradiction the published database does not. This module keeps the newest
ledger state in memory so the Options Finder's earnings coverage can be withdrawn without the database changing
(Amendment A-2's pre-display requirement; Amendment A-3's approval and clarifications C1-C4).

    - One daemon thread, started in the API lifespan when GH_DB_TOKEN and EARNINGS_CACHE_KEY are both set.
    - Every EARNINGS_LEDGER_REFRESH_S (default 600 s) it lists the release; when the newest ledger asset changed it
      downloads that one asset. Each request runs in a child process (api/earnings_ledger_fetch.py) killed at its
      deadline (15 s listing, 30 s download), so a check always ends (DR-26, DR-32). An upload completed at T is
      held by T + 10 min 45 s when polling succeeds (C1).
    - A transient failure keeps the last good state until EARNINGS_LEDGER_STALE_S (at most 1800 s) after the last
      successful check; a confirmed invalid state answers unknown at once (C2).
    - A held state is only ever replaced by a higher seq that continues it (earnings_store.continues); a listing
      that goes backwards is `regressed` (C3). Nothing is persisted: after a restart the reader is `starting`
      (unknown) until its first successful check.
    - A snapshot is published whole, by one reference swap under a lock; the check time feeds only the staleness
      gate and never an observation's age (C4).

It never calls Finnhub and never touches the database, the worker or the bootstrap. Nothing it logs carries a URL,
a token, an asset name or a body: states and counts only.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Mapping

from api.bootstrap import _GH_API_REPO
from src.events import earnings_store as store

log = logging.getLogger("mrr.earnings_ledger")

REFRESH_ENV, STALE_ENV = "EARNINGS_LEDGER_REFRESH_S", "EARNINGS_LEDGER_STALE_S"
REFRESH_DEFAULT, REFRESH_RANGE = 600, (60, 900)
STALE_DEFAULT, STALE_MAX = 1800, 1800  # the owner's 30-minute limit (Amendment A-3)
LIST_S, DOWNLOAD_S = 15.0, 30.0  # hard deadlines per child (design LR 2)
RETRY_S = 120  # after a failed check
JOIN_S = 5.0  # shutdown
MAX_ASSET = 8 * 1024 * 1024
LIST_URL = f"{_GH_API_REPO}/releases/tags/data-latest"
CHILD = Path(__file__).resolve().with_name("earnings_ledger_fetch.py")
OK, INVALID, TRANSIENT = 0, 20, 30

# the statuses (design LR section 4): only `ok` serves; every other one answers unknown
INVALID_WORDS = {"unauthorized": "unauthorized", "forbidden": "unauthorized", "missing": "missing",
                 "malformed": "unreadable", "oversized": "unreadable"}


def asset_url(asset_id: int) -> str:
    """Built from the listing's numeric id, never taken from a response: the child sends the token there."""
    return f"{_GH_API_REPO}/releases/assets/{int(asset_id)}"


def _whole(raw: str | None) -> int | None:
    """A whole number of seconds written as digits only; anything else (NaN, inf, signs, floats) is None."""
    raw = (raw or "").strip()
    return int(raw) if raw.isascii() and raw.isdigit() and len(raw) <= 6 else None


def settings(env: Mapping[str, str] | None = None) -> tuple[int, int]:
    """(refresh_s, stale_s): finite whole seconds within range, else the defaults (DR-27). The staleness limit is
    never above 1800 s, whatever is set."""
    env = os.environ if env is None else env
    refresh = _whole(env.get(REFRESH_ENV))
    if refresh is None or not REFRESH_RANGE[0] <= refresh <= REFRESH_RANGE[1]:
        if env.get(REFRESH_ENV) not in (None, ""):
            log.warning("earnings ledger reader: %s is not a whole number of seconds from 60 to 900; using 600",
                        REFRESH_ENV)
        refresh = REFRESH_DEFAULT
    stale = _whole(env.get(STALE_ENV))
    if stale is None or not refresh + 60 <= stale <= STALE_MAX:
        if env.get(STALE_ENV) not in (None, ""):
            log.warning("earnings ledger reader: %s is outside its range; using 1800", STALE_ENV)
        stale = STALE_DEFAULT
    return refresh, stale


Runner = Callable[[str, str, float], "tuple[int, bytes]"]


def run_child(op: str, url: str, deadline: float, env: Mapping[str, str] | None = None) -> tuple[int, bytes]:
    """One request in a child process, killed at `deadline` seconds (design LR 2). (-1, b"") on a kill or any
    failure to run it: transient."""
    try:
        done = subprocess.run([sys.executable, "-I", str(CHILD), op, url, str(deadline)], capture_output=True,
                              timeout=deadline, env=dict(os.environ if env is None else env), stdin=subprocess.DEVNULL)
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return -1, b""
    return done.returncode, done.stdout


@dataclass(frozen=True)
class Snapshot:
    """One whole reader state (design LR 5). `vault` is owned by this snapshot and never mutated."""

    status: str  # off | starting | ok | missing | misnamed | unreadable | rotated | regressed | inconsistent | unauthorized
    seq: int | None = None
    asset_id: int | None = None
    vault: Mapping[str, Any] | None = None
    index: Mapping[str, list] | None = None
    last_success: float | None = None  # monotonic seconds of the last successful check
    high: int | None = None  # the highest seq opened ok in this process


class Reader:
    def __init__(self, secret: str, runner: Runner = run_child, *, mono: Callable[[], float] = time.monotonic,
                 refresh_s: int = REFRESH_DEFAULT, stale_s: int = STALE_DEFAULT):
        self._secret = secret
        self._run = runner
        self._mono = mono
        self.refresh_s, self.stale_s = refresh_s, stale_s
        self._lock = threading.Lock()
        self._snap = Snapshot("starting")
        self._good: Snapshot | None = None  # the last ok state, kept for continuity and the record
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ── what a request reads ────────────────────────────────────────────────

    def current(self) -> Snapshot:
        """The snapshot, read once; `ok` turns `stale` at read time when the last success is STALE_S old (so a
        hung thread cannot keep serving)."""
        with self._lock:
            snap = self._snap
        if snap.status == "ok" and (snap.last_success is None or self._mono() - snap.last_success >= self.stale_s):
            return replace(snap, status="stale")
        return snap

    def _publish(self, snap: Snapshot) -> None:
        with self._lock:
            self._snap = snap

    # ── one check ───────────────────────────────────────────────────────────

    def _invalid(self, status: str) -> str:
        g = self._good
        self._publish(Snapshot(status, seq=g.seq if g else None, asset_id=g.asset_id if g else None,
                               vault=g.vault if g else None, index=g.index if g else None,
                               last_success=g.last_success if g else None, high=g.high if g else None))
        log.info("earnings ledger reader: %s", status)
        return "invalid"

    def check_once(self) -> str:
        """One listing and, when needed, one download: "ok", "invalid" or "transient"."""
        code, out = self._run("list", LIST_URL, LIST_S)
        if code == INVALID:
            return self._invalid(INVALID_WORDS.get(out.decode("ascii", "replace").strip(), "unreadable"))
        if code != OK:
            return "transient"
        try:
            listing = json.loads(out)
            pairs = [(str(a["name"]), int(a["id"])) for a in listing]
        except (ValueError, TypeError, KeyError):
            return "transient"  # the child validated it; a garbled pipe is a failed check, not a verdict
        ledger = []
        for name, aid in pairs:
            try:
                seq = store.ledger_seq(name)
            except ValueError:
                return self._invalid("misnamed")
            if seq is not None:
                ledger.append((seq, aid))
        if not ledger:
            return self._invalid("missing")
        top, aid = max(ledger)
        good = self._good
        if good is not None and top < (good.high or 0):
            return self._invalid("regressed")
        if good is not None and top == good.seq and aid == good.asset_id:
            self._publish(replace(good, status="ok", last_success=self._mono()))
            self._good = replace(good, last_success=self._mono())
            return "ok"
        code, raw = self._run("asset", asset_url(aid), DOWNLOAD_S)
        if code == INVALID:
            return self._invalid(INVALID_WORDS.get(raw.decode("ascii", "replace").strip(), "unreadable"))
        if code != OK:
            return "transient"
        if len(raw) > MAX_ASSET:
            return self._invalid("unreadable")
        opened = store.open_ledger_bounded(raw, self._secret, top)
        if opened.status != "ok":
            return self._invalid("rotated" if opened.status == "rotated" else "unreadable")
        vault = opened.vault
        if good is not None and top == good.seq:  # the same seq under another asset id
            if vault != good.vault:
                return self._invalid("regressed")
        elif good is not None and not store.continues(good.vault, vault):
            return self._invalid("inconsistent")
        snap = Snapshot("ok", seq=top, asset_id=aid, vault=vault, index=store.index(vault),
                        last_success=self._mono(), high=max(top, good.high or 0) if good else top)
        self._good = snap
        self._publish(snap)
        log.info("earnings ledger reader: ok")
        return "ok"

    def _check(self) -> str:
        try:
            return self.check_once()
        except Exception as exc:  # noqa: BLE001 — a failed check, with no detail that could carry a URL
            log.warning("earnings ledger reader: a check failed (%s)", type(exc).__name__)
            return "transient"

    # ── the thread ──────────────────────────────────────────────────────────

    def _loop(self) -> None:
        while not self._stop.is_set():
            started = self._mono()
            result = self._check()
            gap = self.refresh_s if result == "ok" else min(RETRY_S, self.refresh_s)
            self._stop.wait(max(0.0, gap - (self._mono() - started)))

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="earnings-ledger-reader", daemon=True)
        self._thread.start()

    def stop(self, join_s: float = JOIN_S) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(join_s)


_reader: Reader | None = None


def current() -> Snapshot:
    """What the Finder's earnings coverage consults: `off` when no reader runs."""
    r = _reader
    return r.current() if r is not None else Snapshot("off")


def start(env: Mapping[str, str] | None = None) -> bool:
    """Start the reader when GH_DB_TOKEN and EARNINGS_CACHE_KEY are both set (the API lifespan). Never raises."""
    global _reader
    env = os.environ if env is None else env
    try:
        secret = env.get(store.KEY_ENV, "").strip()
        if not env.get("GH_DB_TOKEN", "").strip() or not secret or _reader is not None:
            log.info("earnings ledger reader: off")
            return False
        refresh, stale = settings(env)
        _reader = Reader(secret, refresh_s=refresh, stale_s=stale)
        _reader.start()
        log.info("earnings ledger reader: started")
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("earnings ledger reader: not started (%s)", type(exc).__name__)
        return False


def stop() -> None:
    """Stop the reader (the API lifespan's shutdown): at most JOIN_S seconds. Never raises."""
    global _reader
    r, _reader = _reader, None
    if r is not None:
        try:
            r.stop()
        except Exception:  # noqa: BLE001
            pass
