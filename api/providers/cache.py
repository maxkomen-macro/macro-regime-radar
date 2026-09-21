"""Bounded keyed single-flight TTL cache and a small token bucket.

The cache is the one that api/lookup.py shipped with (2026-08-26), lifted here
so every provider family shares it; `clear()` and `size` exist for tests."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable


class KeyedTTLCache:
    def __init__(self, ttl_seconds: float, max_entries: int = 256) -> None:
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._data: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._gate = threading.Lock()

    def _lock_for(self, key: str) -> threading.Lock:
        with self._gate:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def get(self, key: str, compute: Callable[[], Any], ttl: float | None = None) -> Any:
        limit = ttl if ttl is not None else self.ttl
        with self._lock_for(key):
            hit = self._data.get(key)
            now = time.monotonic()
            if hit is not None and now - hit[0] <= limit:
                return hit[1]
            value = compute()
            with self._gate:
                if len(self._data) >= self.max_entries:
                    oldest = min(self._data, key=lambda k: self._data[k][0])
                    self._data.pop(oldest, None)
                    lock = self._locks.get(oldest)
                    # A lock another thread holds stays (single-flight keeps
                    # working); it is reaped once idle (review P3-4).
                    if lock is not None and not lock.locked():
                        self._locks.pop(oldest, None)
                if len(self._locks) > 4 * self.max_entries:
                    for k in [k for k, lk in self._locks.items() if k not in self._data and not lk.locked()]:
                        self._locks.pop(k, None)
                self._data[key] = (now, value)
            return value

    def peek(self, key: str) -> Any | None:
        hit = self._data.get(key)
        return hit[1] if hit else None

    def age(self, key: str) -> float | None:
        """Seconds since the entry was stored; None when absent. The worker's
        prefetch refreshes an entry before its TTL runs out (fix/prelaunch-1)."""
        hit = self._data.get(key)
        return None if hit is None else time.monotonic() - hit[0]

    def put(self, key: str, value: Any) -> None:
        """Store a freshly computed value regardless of the current entry's age,
        under the key's single-flight lock."""
        with self._lock_for(key):
            with self._gate:
                self._data[key] = (time.monotonic(), value)

    def clear(self) -> None:
        with self._gate:
            self._data.clear()
            self._locks.clear()

    @property
    def size(self) -> int:
        return len(self._data)


class TokenBucket:
    """Process-wide ceiling on upstream calls: `rate` tokens per second up to
    `burst`. take() returns False instead of blocking, so callers fail fast
    with RateLimited rather than queueing behind a burst."""

    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.burst = burst
        self._tokens = float(burst)
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def available(self, n: int = 1) -> bool:
        """Whether n tokens are there now, without taking them: a batch job
        (the asset-history refresh) waits on this instead of failing."""
        with self._lock:
            now = time.monotonic()
            return min(self.burst, self._tokens + (now - self._last) * self.rate) >= n

    def take(self, n: int = 1) -> bool:
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self.burst, self._tokens + (now - self._last) * self.rate)
            self._last = now
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False
