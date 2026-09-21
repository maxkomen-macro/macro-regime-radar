"""One read path to the database for every analytics module (fix/prelaunch-1).

Stdlib only, and it imports nothing from api/: Streamlit, the pipeline and the
API all use it. Three things live here.

`file_key(path)` is the database's identity: the main file's inode, mtime and
size, plus the -wal file's mtime and size when it holds frames. An atomic swap
(os.replace) changes the inode; an in-place commit in WAL mode lands in -wal
first. An empty -wal is no commit at all: SQLite creates one the first time
anything opens a WAL-mode file (a swapped-in database included), so counting
it would rebuild everything for nothing. Any other change is a new database as
far as a cached result is concerned (B-H1): the analytics caches key on it,
and the API's worker starts a new generation on it.

`connect_ro(path)` opens a read-only connection. The API installs a
*generation provider*: an in-memory copy of the file the worker built every
derived result from. While one is published, reads of the database it was
built from (or of the repo's default path, which is what every analytics
module holds) go to that copy, so stored reads and derived results always come
from the same file, even in the seconds after the file on disk is replaced.
A path a caller moved on purpose (a test, a script's --db) reads that file.

`pinned(generation)` routes this context's reads to one generation: the worker
builds the next generation against its copy while request threads keep reading
the published one, and the API pins each request to the generation published
when it arrived (api/worker.PinGeneration), so one response never mixes two.
ContextVars do not cross into new threads, so a pin never leaks out of the
worker.

A generation's copy lives only while something holds it open: the worker
releases one two publishes after it stopped serving. `open_generation` checks
that the copy is still there, because opening a released copy's name creates a
new, empty database; a reader then falls back to the copy being served.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Callable, Iterator, Optional, Protocol

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "macro_radar.db"


class GenerationRef(Protocol):
    id: int
    key: tuple
    source: Path
    uri: str


_provider: Optional[Callable[[], Optional[GenerationRef]]] = None
_pinned: ContextVar[Optional[GenerationRef]] = ContextVar("mrr_db_generation", default=None)


def file_key(path: Path | str) -> tuple | None:
    """(inode, mtime_ns, size) of the file, plus (mtime_ns, size) of its -wal
    when that holds frames; None when the file does not exist."""
    p = Path(path)
    try:
        st = os.stat(p)
    except OSError:
        return None
    try:
        wal = os.stat(f"{p}-wal")
        wal_key: tuple = (wal.st_mtime_ns, wal.st_size) if wal.st_size > 0 else ()
    except OSError:
        wal_key = ()
    return (st.st_ino, st.st_mtime_ns, st.st_size) + wal_key


def install_provider(fn: Callable[[], Optional[GenerationRef]]) -> None:
    global _provider
    _provider = fn


def clear_provider() -> None:
    global _provider
    _provider = None


@contextmanager
def pinned(gen: GenerationRef) -> Iterator[None]:
    token = _pinned.set(gen)
    try:
        yield
    finally:
        _pinned.reset(token)


def pinned_generation() -> Optional[GenerationRef]:
    """The generation this thread is building, if any (the worker's pin)."""
    return _pinned.get()


def _same(a: Path | str, b: Path | str) -> bool:
    try:
        return os.path.realpath(a) == os.path.realpath(b)
    except OSError:
        return False


def generation_for(path: Path | str) -> Optional[GenerationRef]:
    """The generation a read of `path` should use, or None to read the file."""
    gen = _pinned.get()
    if gen is None and _provider is not None:
        gen = _provider()
    if gen is None:
        return None
    if _same(path, gen.source) or _same(path, DEFAULT_DB_PATH):
        return gen
    return None


def open_generation(gen: GenerationRef, factory: type = sqlite3.Connection) -> Optional[sqlite3.Connection]:
    """A read-only connection to `gen`'s in-memory copy, or None when the copy
    has been released (its name would open a new, empty database)."""
    conn = sqlite3.connect(gen.uri, uri=True, factory=factory)
    try:
        conn.execute("PRAGMA query_only = 1")
        if conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone() is not None:
            return conn
    except sqlite3.Error:
        pass
    sqlite3.Connection.close(conn)  # the base close: a factory may make close() a no-op
    return None


def served_for(path: Path | str) -> Optional[GenerationRef]:
    """The generation being served for `path`, whatever this context is pinned
    to: the fallback for a pinned read whose copy has been released."""
    cur = _provider() if _provider is not None else None
    if cur is not None and (_same(path, cur.source) or _same(path, DEFAULT_DB_PATH)):
        return cur
    return None


def connect_ro(path: Path | str) -> sqlite3.Connection:
    """A read-only connection for `path`: the published (or pinned) generation
    when one applies, the file itself otherwise. Callers set row_factory."""
    gen = generation_for(path)
    if gen is not None:
        conn = open_generation(gen)
        if conn is None:
            served = served_for(path)
            if served is not None and served is not gen:
                conn = open_generation(served)
        if conn is not None:
            return conn
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def current_key(path: Path | str) -> tuple | None:
    """What a cache of results derived from `path` should key on: the
    generation's key when reads are redirected to one, the file key otherwise."""
    gen = generation_for(path)
    return gen.key if gen is not None else file_key(path)
