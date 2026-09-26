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


# Everything a read needs, and nothing that writes or reconfigures. SQLite
# asks the authorizer for every action it compiles; anything not on these
# lists is denied, ATTACH and every DDL/DML verb included.
_READ_ACTIONS = frozenset({
    sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_FUNCTION,
    sqlite3.SQLITE_RECURSIVE, sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_SAVEPOINT,
})

# Pragmas that only describe the database. Callers use these to check whether a
# column exists before reading it, so denying every pragma would break ordinary
# reads; what must stay denied is anything that changes how the connection
# behaves — `query_only` above all, since turning it off is what would make the
# shared generation copy writable.
_READ_PRAGMAS = frozenset({
    "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo",
    "database_list", "foreign_key_list", "collation_list", "function_list", "module_list",
    "pragma_list", "compile_options", "data_version", "freelist_count", "page_count",
    "page_size", "encoding", "user_version", "application_id", "integrity_check", "quick_check",
})


def _read_only_authorizer(action: int, arg1, arg2, db_name, trigger) -> int:
    if action in _READ_ACTIONS:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_PRAGMA:
        return sqlite3.SQLITE_OK if str(arg1 or "").lower() in _READ_PRAGMAS else sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_DENY


# The same rule for a read connection to the file that runs SQL it did not
# write (the assistant's query tool, launch-1). Never on a connection to a
# generation's copy (verifier V-51, below).
read_only_authorizer = _read_only_authorizer


def is_copy(conn: sqlite3.Connection) -> bool:
    """Whether `conn` reads a generation's in-memory copy (its main database has no file)."""
    row = conn.execute("PRAGMA database_list").fetchone()
    return row is not None and not row[2]


def open_generation(gen: GenerationRef, factory: type = sqlite3.Connection) -> Optional[sqlite3.Connection]:
    """A read-only connection to `gen`'s in-memory copy, or None when the copy
    has been released (its name would open a new, empty database)."""
    conn = sqlite3.connect(gen.uri, uri=True, factory=factory)
    try:
        # Read-only by the connection's own mode, and by nothing written in Python
        # (verifier V-51). SQLite runs an authorizer while it holds the copy's
        # shared-cache lock; a garbage collection inside it that finalized another
        # connection to the same copy needed that lock too, and the reader waited for
        # good, taking every reader of the copy with it. A shared-cache memory database
        # cannot be opened with a read-only URI (`mode=ro` beside `mode=memory` opens
        # nothing), so query_only is the mode, with no database attachable: query_only
        # refuses every write, temp tables and VACUUM INTO included, and the attach
        # limit refuses ATTACH and the file VACUUM INTO would create. query_only is a
        # pragma: only the app's own SQL runs on these connections, and the assistant's
        # query tool, whose guard bans PRAGMA, opens and closes a connection per call,
        # so a flip could never reach a second statement (launch-1, re-audit NG-2).
        conn.execute("PRAGMA query_only = 1")
        conn.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        if conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone() is not None:
            return conn
    except sqlite3.Error:
        pass
    except BaseException:
        sqlite3.Connection.close(conn)  # on any failure, a MemoryError included (Codex R-36)
        raise
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


def _private_of(gen: GenerationRef) -> Optional[sqlite3.Connection]:
    """A connection to `gen`'s private copy (Codex R-34), or None when it has none
    (a retired generation). A reference without the method is read as it is."""
    private = getattr(gen, "private", None)
    if private is None:
        return open_generation(gen)
    ref = private()
    return open_generation(ref) if ref is not None else None


def connect_private_ro(path: Path | str) -> sqlite3.Connection:
    """A read-only connection for SQL the app did not write (the assistant's,
    Codex R-34): the generation's private copy, never the shared copy every
    other reader waits on. A model's query can hold a copy's lock for as long as
    a single SQL function runs, uninterrupted, so it holds only its own. Built on
    first use from the generation's copy; the served generation's for a request
    whose pinned one has been retired; the file itself before the first
    generation."""
    gen = generation_for(path)
    if gen is not None:
        conn = _private_of(gen)
        if conn is None:
            served = served_for(path)
            if served is not None and served is not gen:
                conn = _private_of(served)
        if conn is not None:
            return conn
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


# a per-call copy is taken in steps of this many pages, so a reader of the source waits at most
# one step while it is made (verifier V-80)
CALL_COPY_PAGES = 64


def copy_private_ro(path: Path | str) -> sqlite3.Connection:
    """A read-only copy of `path`'s data for one call (verifier V-80), which the
    caller closes: the assistant's SQL, which a model writes, holds only its own
    copy's lock. A query whose functions run uninterrupted held the generation's
    private copy 17 s, and every other visitor's tool calls waited as long. The
    copy is a plain in-memory database backed up from the generation's private
    copy (connect_private_ro; the file itself before the first generation), in
    steps, and is read-only by its own mode: query_only, no database attachable."""
    src = connect_private_ro(path)
    try:
        dst = sqlite3.connect(":memory:")
        try:
            src.backup(dst, pages=CALL_COPY_PAGES)
            dst.execute("PRAGMA query_only = 1")
            dst.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        except BaseException:
            dst.close()
            raise
        return dst
    finally:
        src.close()


def current_key(path: Path | str) -> tuple | None:
    """What a cache of results derived from `path` should key on: the
    generation's key when reads are redirected to one, the file key otherwise."""
    gen = generation_for(path)
    return gen.key if gen is not None else file_key(path)
