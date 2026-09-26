"""Unit tests for the read-only SQL guard used by MacroRadarAgent.query_database."""

from src.analytics.chat import is_safe_select


# ── Allowed cases ─────────────────────────────────────────────────────────────

def test_basic_select():
    assert is_safe_select("SELECT * FROM regimes")


def test_select_lowercase():
    assert is_safe_select("select label from regimes limit 1")


def test_select_with_leading_whitespace():
    assert is_safe_select("   \n  SELECT 1")


def test_select_with_trailing_semicolon():
    assert is_safe_select("SELECT * FROM signals;")


def test_cte_with_select():
    assert is_safe_select(
        "WITH x AS (SELECT 1 AS n) SELECT n FROM x"
    )


def test_select_with_join_and_where():
    assert is_safe_select(
        "SELECT r.label FROM regimes r WHERE r.date > '2025-01-01' "
        "ORDER BY r.date DESC LIMIT 10"
    )


# ── Rejected cases ────────────────────────────────────────────────────────────

def test_reject_drop():
    assert not is_safe_select("DROP TABLE regimes")


def test_reject_insert():
    assert not is_safe_select("INSERT INTO regimes (date) VALUES ('2026-01-01')")


def test_reject_update():
    assert not is_safe_select("UPDATE regimes SET label = 'X'")


def test_reject_delete():
    assert not is_safe_select("DELETE FROM regimes")


def test_reject_pragma():
    assert not is_safe_select("PRAGMA table_info(regimes)")


def test_reject_attach():
    assert not is_safe_select("ATTACH DATABASE '/tmp/x.db' AS x")


def test_reject_chained_drop():
    assert not is_safe_select("SELECT 1; DROP TABLE regimes")


def test_reject_chained_select():
    # Two SELECTs separated by `;` is still rejected — single-statement only.
    assert not is_safe_select("SELECT 1; SELECT 2")


def test_reject_empty_string():
    assert not is_safe_select("")


def test_reject_whitespace_only():
    assert not is_safe_select("   \n\t  ")


def test_reject_non_string():
    assert not is_safe_select(None)  # type: ignore[arg-type]
    assert not is_safe_select(42)    # type: ignore[arg-type]


def test_reject_create_table():
    assert not is_safe_select("CREATE TABLE x (a INT)")


def test_reject_alter_table():
    assert not is_safe_select("ALTER TABLE regimes ADD COLUMN x INT")


def test_reject_replace():
    assert not is_safe_select("REPLACE INTO regimes VALUES (1)")


def test_reject_vacuum():
    assert not is_safe_select("VACUUM")


def test_reject_pragma_table_valued_function():
    # `pragma_table_info` must not slip past the `pragma` keyword check
    # (underscore is a word character, so `\bpragma\b` alone misses it).
    assert not is_safe_select("SELECT * FROM pragma_table_info('regimes')")


def test_reject_pragma_index_list_function():
    assert not is_safe_select("SELECT name FROM pragma_index_list('signals')")


def test_reject_randomblob():
    # Unbounded blob construction — row cap does not bound per-cell size.
    assert not is_safe_select("SELECT randomblob(999999999)")


def test_reject_zeroblob():
    assert not is_safe_select("SELECT zeroblob(999999999)")


def test_reject_load_extension():
    assert not is_safe_select("SELECT load_extension('/tmp/evil.so')")


def test_allow_identifier_containing_keyword_substring():
    # Columns like `update_date` / `created_at` must NOT be false-positives:
    # `\bupdate\b` / `\bcreate\b` do not match inside a larger identifier.
    assert is_safe_select("SELECT update_date, created_at FROM regimes")


# ── Execution bound (runaway queries the keyword guard cannot see) ────────────
#
# The guard passes an unbounded `WITH RECURSIVE` bomb (it is a legitimate
# single SELECT/CTE), so _tool_query_database bounds execution with a SQLite
# progress handler and must return an error dict instead of hanging.

import subprocess
import sys
import time
from pathlib import Path

import pytest

from src.analytics import chat as _chat

_REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(not _chat.DB_PATH.exists(), reason="macro_radar.db not present")
def test_recursive_cte_bomb_returns_error_not_hang():
    start = time.monotonic()
    result = _chat._tool_query_database(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) "
        "SELECT COUNT(*) FROM c"
    )
    elapsed = time.monotonic() - start
    assert elapsed < 10, f"query was not bounded — took {elapsed:.1f}s"
    assert isinstance(result, dict) and "error" in result
    # Aborted by the progress handler, not rejected by the keyword guard.
    assert "SQL guard" not in result["error"]


@pytest.mark.skipif(not _chat.DB_PATH.exists(), reason="macro_radar.db not present")
def test_normal_query_passes_under_execution_bound():
    # A legitimate aggregate over the biggest table must not trip the budget.
    result = _chat._tool_query_database("SELECT COUNT(*) AS n FROM raw_series")
    assert "error" not in result
    assert result["row_count"] == 1


# ── Import decoupling (api/ must import chat without FRED_API_KEY) ────────────

def test_chat_imports_without_fred_api_key_and_without_src_config():
    """src.analytics.chat must import in an environment with no FRED_API_KEY and
    must never pull src.config (which raises EnvironmentError without the key)."""
    code = (
        "import os, sys\n"
        "os.environ.pop('FRED_API_KEY', None)\n"
        "import src.analytics.chat\n"
        "assert 'src.config' not in sys.modules, 'chat.py imported src.config'\n"
        "print('ok')\n"
    )
    env = {k: v for k, v in __import__("os").environ.items() if k != "FRED_API_KEY"}
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True, text=True, cwd=str(_REPO_ROOT), env=env,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "ok"


# ── get_secret fallback chain (env → st.secrets → repo-root .env) ─────────────
#
# Bare uvicorn is launched without .env in its environment; get_secret must
# find keys in the repo-root .env file (api/stream.py:_load_token idiom) so the
# Streamlit path and the API path resolve secrets identically.

def test_get_secret_falls_back_to_env_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# a comment\n"
        "OTHER_KEY=other\n"
        "___CHAT_SECRET_PROBE___='from-dotenv'\n"
    )
    monkeypatch.delenv("___CHAT_SECRET_PROBE___", raising=False)
    monkeypatch.setattr(_chat, "_ENV_FILE", env_file)
    assert _chat.get_secret("___CHAT_SECRET_PROBE___") == "from-dotenv"


def test_get_secret_env_var_wins_over_env_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("___CHAT_SECRET_PROBE___=from-dotenv\n")
    monkeypatch.setattr(_chat, "_ENV_FILE", env_file)
    monkeypatch.setenv("___CHAT_SECRET_PROBE___", "from-env")
    assert _chat.get_secret("___CHAT_SECRET_PROBE___") == "from-env"


def test_get_secret_absent_everywhere_returns_empty(monkeypatch, tmp_path):
    monkeypatch.delenv("___CHAT_SECRET_PROBE___", raising=False)
    monkeypatch.setattr(_chat, "_ENV_FILE", tmp_path / "no-such.env")
    assert _chat.get_secret("___CHAT_SECRET_PROBE___") == ""


def test_get_secret_commented_env_file_line_ignored(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("# ___CHAT_SECRET_PROBE___=commented-out\n")
    monkeypatch.delenv("___CHAT_SECRET_PROBE___", raising=False)
    monkeypatch.setattr(_chat, "_ENV_FILE", env_file)
    assert _chat.get_secret("___CHAT_SECRET_PROBE___") == ""


# ── launch-1, item 2 re-audit: bounds the keyword guard cannot express ──────


def _scratch_db(tmp_path):
    import sqlite3 as _sq

    path = tmp_path / "scratch.db"
    conn = _sq.connect(path)
    conn.execute("CREATE TABLE regimes (date TEXT, label TEXT)")
    conn.execute("INSERT INTO regimes VALUES ('2026-08-01', 'Overheating')")
    conn.commit()
    conn.close()
    return path


def test_one_value_cannot_grow_past_a_megabyte(tmp_path, monkeypatch):
    """printf('%.*c', 999999999, 'x') passed the guard, the progress handler
    and the row cap, and allocated about 1 GB in half a second."""
    import time

    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    t = time.perf_counter()
    out = chat_mod._tool_query_database("SELECT length(printf('%.*c', 999999999, 'x')) AS n")
    # Past the limit SQLite's printf yields NULL rather than the value; either
    # way nothing near a gigabyte is built.
    assert "error" in out or out["rows"] == [{"n": None}], out
    doubling = chat_mod._tool_query_database(
        "WITH RECURSIVE s(x) AS (SELECT 'x' UNION ALL SELECT x || x FROM s WHERE length(x) < 250000000) "
        "SELECT max(length(x)) AS n FROM s")
    assert "error" in doubling or (doubling["rows"][0]["n"] or 0) <= 1_000_000, doubling
    assert time.perf_counter() - t < 2.0
    # one value is capped at 16 KB since verifier V-68 (the largest stored value is about 2 KB)
    ok = chat_mod._tool_query_database("SELECT length(printf('%.*c', 16000, 'x')) AS n")
    assert ok["rows"] == [{"n": 16000}]


def test_the_tool_connection_refuses_writes_even_on_the_file(tmp_path, monkeypatch):
    """With no generation published the tool reads the file itself, where a
    read-only open still allowed temp tables, ATTACH and VACUUM INTO. The
    guard stops those; the connection now refuses them too."""
    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    db = _scratch_db(tmp_path)
    monkeypatch.setattr(chat_mod, "DB_PATH", db)
    monkeypatch.setattr(dbpath, "_provider", None)
    target = tmp_path / "copy.db"
    for sql in (f"VACUUM INTO '{target}'", "CREATE TEMP TABLE t(x)", "ATTACH ':memory:' AS m"):
        # Called past the guard on purpose: the connection is the second wall.
        monkeypatch.setattr(chat_mod, "is_safe_select", lambda s: True)
        out = chat_mod._tool_query_database(sql)
        assert "error" in out, (sql, out)
    assert not target.exists()
    assert chat_mod._tool_query_database("SELECT label FROM regimes")["rows"] == [{"label": "Overheating"}]


def test_one_call_cannot_return_a_gigabyte_of_rows(tmp_path, monkeypatch):
    """Item 2 re-audit, loop 2: with each value capped, 200 rows of five wide
    values still grew memory by a gigabyte in 0.15 s. The result is read a
    row at a time under a byte budget, and a row has at most 32 columns."""
    import time

    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    wide = ", ".join(f"printf('%.*c', 16000, 'x') AS c{i}" for i in range(5))  # under the 16 KB value cap (V-68)
    t = time.perf_counter()
    out = chat_mod._tool_query_database(
        f"WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < 200) SELECT {wide} FROM r")
    assert "error" in out and "too large" in out["error"], {k: v for k, v in out.items() if k != "rows"}
    many = ", ".join(["1"] * 300)  # 300 columns inside the guard's 2 KB (V-88)
    out = chat_mod._tool_query_database(f"SELECT {many}")
    assert "error" in out and "too many columns" in out["error"].lower(), out
    assert time.perf_counter() - t < 3.0
    fine = chat_mod._tool_query_database("SELECT label FROM regimes")
    assert fine["rows"] == [{"label": "Overheating"}]


def test_a_query_has_a_wall_clock_budget(tmp_path, monkeypatch):
    """The instruction budget counts VM steps, not time or bytes: a sort of
    many wide rows spills to temp files at disk speed. A wall-clock budget
    bounds what one query can spend."""
    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    monkeypatch.setattr(chat_mod, "_QUERY_TIME_BUDGET_S", 0.0)
    out = chat_mod._tool_query_database(
        "WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < 100000) SELECT count(*) AS n FROM r")
    assert "error" in out and "budget; simplify it" in out["error"], out


def test_the_row_cap_is_two_hundred(tmp_path, monkeypatch):
    """SR-1c e: the cap the byte budget relies on, pinned (item 2 re-audit)."""
    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    out = chat_mod._tool_query_database(
        "WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < 500) SELECT i FROM r")
    assert out["row_count"] == 200 and len(out["rows"]) == 200


def test_a_wide_table_in_the_schema_does_not_break_every_query(tmp_path, monkeypatch):
    """Item 2 re-audit, loop 3: the column limit was set before SQLite had
    loaded the schema, so a table wider than the limit made SQLite refuse the
    whole schema ("malformed database schema") and every query with it. The
    schema is loaded first; a result set wider than the limit is still refused."""
    import sqlite3 as _sq

    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    db = _scratch_db(tmp_path)
    conn = _sq.connect(db)
    conn.execute("CREATE TABLE wide (" + ", ".join(f"c{i} INTEGER" for i in range(40)) + ")")
    conn.execute("INSERT INTO wide VALUES (" + ", ".join("1" for _ in range(40)) + ")")
    conn.commit()
    conn.close()
    monkeypatch.setattr(chat_mod, "DB_PATH", db)
    monkeypatch.setattr(dbpath, "_provider", None)
    assert chat_mod._tool_query_database("SELECT label FROM regimes")["rows"] == [{"label": "Overheating"}]
    assert chat_mod._tool_query_database("SELECT c0, c1 FROM wide")["rows"] == [{"c0": 1, "c1": 1}]
    out = chat_mod._tool_query_database("SELECT * FROM wide")
    assert "error" in out and "too many columns" in out["error"].lower(), out


def test_the_result_budget_counts_bytes_not_characters(tmp_path, monkeypatch):
    """A four-byte character is four bytes of result, not one."""
    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    monkeypatch.setattr(chat_mod, "_QUERY_MAX_RESULT_BYTES", 1_000)
    fits = chat_mod._tool_query_database("SELECT printf('%.*c', 900, 'x') AS s")
    assert fits["row_count"] == 1
    wide = chat_mod._tool_query_database("SELECT printf('%.*c', 300, char(128200)) AS s")  # 300 chars, 1,200 bytes
    assert "error" in wide and "too large" in wide["error"], {k: v for k, v in wide.items() if k != "rows"}


# ── desk/hardening, verifier V-51: the tool's connections to the copy ─────────

def test_each_tool_call_closes_its_connection(tmp_path, monkeypatch):
    """Verifier V-51: a connection's own `with` only ends a transaction, so every
    tool call left its connection (to the copy, in the API) for the garbage
    collector, and a collection inside a SQLite call on the same copy that closed
    it waited for good. Each call now closes its connection when it ends."""
    import sqlite3 as _sq

    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    opened = []
    real = dbpath.connect_private_ro  # the assistant's own copy since Codex R-34

    def spy(path):
        conn = real(path)
        opened.append(conn)
        return conn

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    monkeypatch.setattr(dbpath, "connect_private_ro", spy)
    with chat_mod._ro_conn() as conn:  # every tool reads through it
        assert conn.execute("SELECT label FROM regimes").fetchone()["label"] == "Overheating"
    assert chat_mod._tool_query_database("SELECT label FROM regimes")["rows"] == [{"label": "Overheating"}]
    assert len(opened) == 2
    for conn in opened:
        with pytest.raises(_sq.ProgrammingError, match="closed"):
            conn.execute("SELECT 1")


def test_the_tool_refuses_writes_on_a_copy_without_an_authorizer(tmp_path, monkeypatch):
    """Verifier V-51 took the Python authorizer off the copy: SQLite ran it inside
    the copy's shared-cache lock. Past the guard, the copy's connection still
    refuses every write by its own mode, creates no file, and a flip of
    query_only dies with its call's connection."""
    import sqlite3 as _sq

    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    src = _scratch_db(tmp_path)
    uri = "file:mrr-gen-test-tool?mode=memory&cache=shared"
    anchor = _sq.connect(uri, uri=True)
    seed = _sq.connect(src)
    seed.backup(anchor)
    seed.close()

    class _Gen:
        source = src
        key = (0, 0, 0)

    _Gen.uri = uri
    monkeypatch.setattr(dbpath, "_provider", lambda: _Gen)
    monkeypatch.setattr(chat_mod, "DB_PATH", src)
    monkeypatch.setattr(chat_mod, "is_safe_select", lambda s: True)  # the connection is the second wall
    try:
        with chat_mod._ro_conn() as conn:
            assert conn.execute("PRAGMA database_list").fetchone()[2] == ""  # the tool reads the copy
        vacuum, attached = tmp_path / "v.db", tmp_path / "a.db"
        for sql in (f"VACUUM INTO '{vacuum}'", "CREATE TEMP TABLE t(x)", f"ATTACH '{attached}' AS m",
                    "INSERT INTO regimes VALUES ('2099-01-01', 'x')"):
            out = chat_mod._tool_query_database(sql)
            assert "error" in out, (sql, out)
        assert not vacuum.exists() and not attached.exists()
        assert "error" not in chat_mod._tool_query_database("PRAGMA query_only = 0")
        assert "error" in chat_mod._tool_query_database("INSERT INTO regimes VALUES ('2099-01-01', 'x')")
        assert chat_mod._tool_query_database("SELECT COUNT(*) AS n FROM regimes")["rows"] == [{"n": 1}]
    finally:
        anchor.close()


# ── desk/hardening, Codex round 9: R-32, no Python callback on a generation connection ──

def test_the_tool_registers_no_python_callback_on_a_generation_and_its_budget_still_fires(tmp_path, monkeypatch):
    """Codex R-32: the query tool installed a Python progress handler on the
    generation's connection, which SQLite runs inside the copy's shared-cache
    lock. Through the tool itself, on a generation: nothing registers a progress
    handler, an authorizer, a trace callback, a function or a collation, and the
    wall-clock budget, now a timer that interrupts the connection from outside
    SQLite, still stops a query that runs past it."""
    import sqlite3 as _sq
    import time

    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    src = tmp_path / "gen-r32.db"
    seed = _sq.connect(src)
    seed.execute("CREATE TABLE regimes (date TEXT, label TEXT)")
    seed.executemany("INSERT INTO regimes VALUES (?, 'Goldilocks')", [(f"d{i:04d}",) for i in range(2000)])
    seed.commit()
    uri = "file:mrr-gen-test-r32?mode=memory&cache=shared"
    anchor = _sq.connect(uri, uri=True)
    seed.backup(anchor)
    seed.close()

    class _Gen:
        source = src
        key = (0, 0, 0)

    _Gen.uri = uri
    registered: list[str] = []

    class Spy(_sq.Connection):
        pass

    for name in ("set_progress_handler", "set_authorizer", "set_trace_callback", "create_function", "create_collation",
                 "create_aggregate", "create_window_function"):
        def record(self, *a, _name=name, **k):
            registered.append(_name)
            return getattr(_sq.Connection, _name)(self, *a, **k)
        setattr(Spy, name, record)

    real_open, opened = dbpath.open_generation, []

    def spying_open(gen, factory=_sq.Connection):
        conn = real_open(gen, factory=Spy)
        opened.append(conn)
        return conn

    monkeypatch.setattr(dbpath, "_provider", lambda: _Gen)
    monkeypatch.setattr(dbpath, "open_generation", spying_open)
    monkeypatch.setattr(chat_mod, "DB_PATH", src)
    try:
        assert chat_mod._tool_query_database("SELECT COUNT(*) AS n FROM regimes")["rows"] == [{"n": 2000}]
        monkeypatch.setattr(chat_mod, "_QUERY_TIME_BUDGET_S", 0.2)
        t = time.perf_counter()
        slow = chat_mod._tool_query_database("SELECT COUNT(*) AS n FROM regimes a, regimes b, regimes c")  # 8e9 rows
        elapsed = time.perf_counter() - t
        assert "error" in slow and "budget; simplify it" in slow["error"], slow
        assert elapsed < 2.0, elapsed
        assert len(opened) == 2 and all(isinstance(c, Spy) for c in opened)
        assert registered == [], registered
    finally:
        anchor.close()


# ── desk/hardening, verifier round 21: V-68, a 16 KB cap on one value ─────────

def test_a_250_kb_value_cannot_be_built_and_the_cap_error_names_the_limit(tmp_path, monkeypatch):
    """Verifier V-68: SQLite never interrupts inside a function, and trim() over
    a 250 KB value held the generation copy's lock 13.6 s. One value is capped at
    16 KB (the largest stored value is about 2 KB). The verifier's instr repro
    gets NULL, because past the cap printf() builds nothing, and answers within the
    budget; its trim repro is refused by the guard since V-88 (two-argument trim). Every other way of building a 250 KB value for them fails
    with an error that names the limit: concatenation, doubling and
    group_concat (the guard already refuses zeroblob, randomblob and replace).
    On the staged code the trim ran 13 s."""
    import time

    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    # the verifier's trim repro: since V-88 the guard refuses a two-argument trim before anything runs
    out = chat_mod._tool_query_database(
        "SELECT length(trim(printf('%.*c',250000,'a'), printf('%.*c',21000,'b')||'a')) AS m FROM regimes LIMIT 1")
    assert out.get("error", "").startswith("SQL guard: trim(), ltrim() and rtrim() take one argument here"), out
    for sql in ("SELECT instr(printf('%.*c',250000,'a'), printf('%.*c',120000,'b')) AS m FROM regimes",):
        t = time.perf_counter()
        out = chat_mod._tool_query_database(sql)
        assert out.get("rows") == [{"m": None}] and time.perf_counter() - t < chat_mod._QUERY_TIME_BUDGET_S, (sql, out)
    for sql in ("SELECT length(printf('%.*c', 15000, 'a') || printf('%.*c', 15000, 'a')) AS m FROM regimes",
                "SELECT instr(group_concat(printf('%.*c', 1000, 'a')), 'b') AS m FROM "
                "(WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r WHERE i < 250) SELECT i FROM r)",
                "WITH RECURSIVE s(x) AS (SELECT 'a' UNION ALL SELECT x || x FROM s WHERE length(x) < 250000) "
                "SELECT max(length(x)) AS m FROM s"):
        out = chat_mod._tool_query_database(sql)
        assert out.get("error", "").startswith("SQL error: a value in this query would pass the assistant's 16 KB limit"), (sql, out)
    assert chat_mod._tool_query_database("SELECT length(printf('%.*c', 16000, 'a')) AS m")["rows"] == [{"m": 16000}]


# ── desk/hardening, verifier round 24: V-84, LIKE and GLOB patterns capped at 256 characters ──

def test_like_and_glob_patterns_are_capped_at_256_characters(tmp_path, monkeypatch):
    """Verifier V-84: one LIKE with an 8,000-character pattern over a 16 KB value ran
    133 ms uninterrupted, and with a copy per tool call (V-80) four such statements
    burn four cores at once. The query tool caps a LIKE or GLOB pattern at 256
    characters (SQLite's SQLITE_LIMIT_LIKE_PATTERN_LENGTH, set on each call's
    connection, so a pattern built at run time is measured too), and the error
    names the limit. Codex's repro is refused at once; a 256-character pattern
    still matches. SQLite counts the pattern in bytes (verifier V-89): 85 euro
    signs and an 'a' (256 bytes) match, 86 of them (258 bytes) are refused."""
    import time

    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    limit = ("SQL error: a LIKE or GLOB pattern in this query is longer than the assistant's 256-byte limit "
             "(fewer characters for accented text).")

    def run(sql):
        t = time.perf_counter()
        return chat_mod._tool_query_database(sql), time.perf_counter() - t

    ok, _ = run("SELECT printf('%.*c', 300, 'a') LIKE ('%' || printf('%.*c', 254, 'a') || '%') AS m FROM regimes")
    assert ok.get("rows") == [{"m": 1}], ok  # exactly 256 characters
    ok, _ = run("SELECT 'abc' GLOB printf('%.*c', 255, '*') || 'c' AS m FROM regimes")
    assert ok.get("rows") == [{"m": 1}], ok
    for sql in ("SELECT printf('%.*c', 300, 'a') LIKE ('%' || printf('%.*c', 255, 'a') || '%') AS m FROM regimes",
                "SELECT 'abc' GLOB printf('%.*c', 300, '*') AS m FROM regimes",
                "SELECT label FROM regimes WHERE label LIKE '" + "_" * 300 + "'",
                # Codex's repro (8,000 characters), which ran 133 ms a call
                "SELECT (printf('%.*c',16000,'a') LIKE ('%'||printf('%.*c',8000,'a')||'b')) AS m FROM regimes LIMIT 1"):
        out, elapsed = run(sql)
        assert out.get("error", "").startswith(limit), (sql[:60], out)
        assert elapsed < 0.05, (sql[:60], elapsed)
    ok, _ = run("SELECT '" + "€" * 85 + "a' LIKE '" + "€" * 85 + "%' AS m")  # 256 bytes, 86 characters
    assert ok.get("rows") == [{"m": 1}], ok
    out, _ = run("SELECT 'x' LIKE '" + "€" * 86 + "' AS m")  # 258 bytes, 86 characters
    assert out.get("error", "").startswith(limit), out



# ── desk/hardening, verifier round 25: V-88, the guard's caps on one statement's work ──

def _glob_chain() -> str:
    """The longest single-call hold found under every cap (decision 42): 2 KB of
    GLOB operators on a 16 KB value with a 256-byte pattern, one row, no jump
    between them for an interrupt to land on. About 1.0 s."""
    head = "WITH v(x,p) AS (SELECT printf('%.*c',16000,'a'), '*'||printf('%.*c',254,'a')||'b') SELECT "
    terms: list[str] = []
    while len((head + "+".join(terms + ["(x GLOB p)"]) + " AS s FROM v").encode()) <= 2048:
        terms.append("(x GLOB p)")
    return head + "+".join(terms) + " AS s FROM v"


def test_the_guard_caps_a_statements_length_calls_and_two_argument_trims(tmp_path, monkeypatch):
    """Verifier V-88: 400 two-argument trims in 4 KB ran one call 25 s. The guard
    caps a statement at 2 KB and at 16 function calls (an identifier, bare or
    quoted, followed by "("; SQL keywords before a parenthesis, literals and
    comments do not count), and refuses trim, ltrim and rtrim with a second
    argument. Each refusal names its limit, before any connection opens; on the
    staged code each of these ran."""
    import time

    from src.analytics import chat as chat_mod
    from src.analytics import dbpath

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    opened = []
    real = dbpath.copy_private_ro
    monkeypatch.setattr(dbpath, "copy_private_ro", lambda path: opened.append(path) or real(path))
    g = chat_mod._tool_query_database

    ok = "SELECT 1 AS n" + " " * (2048 - 13)
    assert g(ok)["rows"] == [{"n": 1}]  # exactly 2 KB
    assert g(ok + " ")["error"].startswith("SQL guard: a query is limited to 2 KB of SQL (this one is 2049 bytes)")

    sixteen = "SELECT " + ", ".join(f"abs({i}) AS a{i}" for i in range(16)) + " FROM regimes"
    assert "rows" in g(sixteen), g(sixteen)
    seventeen = "SELECT " + ", ".join(f"abs({i}) AS a{i}" for i in range(17)) + " FROM regimes"
    assert g(seventeen)["error"].startswith("SQL guard: a query may call at most 16 functions (this one calls 17)")
    not_calls = ("WITH x(a) AS (SELECT 1) SELECT a FROM x WHERE a IN (SELECT 1) AND EXISTS (SELECT 1) "
                 "AND CAST (a AS TEXT) = '1' AND 'abs(1), abs(2)' <> '' -- abs(3) abs(4)")
    assert "rows" in g(not_calls), g(not_calls)  # x( is the one call

    trim_error = "SQL guard: trim(), ltrim() and rtrim() take one argument here"
    for sql in ("SELECT trim(label, 'O') FROM regimes", 'SELECT "trim"(label, \'O\') FROM regimes',
                "SELECT [LTRIM](label, 'O') FROM regimes", "SELECT `rtrim`(label, 'g') FROM regimes",
                "SELECT upper(rtrim(substr(label, 1, 5), 'e')) FROM regimes"):
        assert g(sql)["error"].startswith(trim_error), sql
    assert g("SELECT trim(label) AS t, ltrim(' a') AS l, rtrim(substr(label, 1, 3)) AS r FROM regimes")["rows"] == [
        {"t": "Overheating", "l": "a", "r": "Ove"}]

    repro = ("WITH x(s,t) AS (SELECT printf('%.*c',16000,'a'), printf('%.*c',1364,'b')||'a') SELECT "
             + ", ".join("max(" + ", ".join(["trim(s,t)"] * 100) + f") AS m{i}" for i in range(4)) + " FROM x")
    t = time.perf_counter()
    assert g(repro)["error"].startswith("SQL guard: a query is limited to 2 KB of SQL")  # the verifier's 25 s repro
    assert time.perf_counter() - t < 0.05
    refused = len(opened)
    g("SELECT trim(label, 'O') FROM regimes")
    assert len(opened) == refused, "a refused query opens no connection"


def test_an_interrupted_query_names_the_budget_first_and_the_residual_hold_stays_near_a_second(tmp_path, monkeypatch):
    """Verifier V-88: the interrupt's error names the budget alone first ("the
    query exceeded the 250 ms budget; simplify it"), since a query can pass the
    budget inside one row's functions, which reading less does not cure; the
    rewrite hints are its second sentence. Decision 42's residual: the longest
    single-call hold found under every cap, 2 KB of GLOB operators, measured at
    about 1.0 s, is pinned here under 3 s."""
    import time

    from src.analytics import chat as chat_mod

    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    out = chat_mod._tool_query_database(
        "WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r) SELECT count(*) AS n FROM r")
    first, _, rest = out["error"].partition(". ")
    assert first == "SQL error: the query exceeded the 250 ms budget; simplify it", out
    assert rest.startswith("If it reads many rows: filter by a date range first") and "regimes.date" in rest, out
    t = time.perf_counter()
    out = chat_mod._tool_query_database(_glob_chain())
    elapsed = time.perf_counter() - t
    assert out["error"].startswith("SQL error: the query exceeded the 250 ms budget"), out
    assert 0.25 < elapsed < 3.0, elapsed


# ── desk/hardening, round 27: the free-form SQL tool ships disabled ──────────

class _FakeUsage:
    input_tokens, output_tokens = 100, 10
    cache_creation_input_tokens = cache_read_input_tokens = 0


class _FakeToolUse:
    type = "tool_use"

    def __init__(self, name: str, args: dict) -> None:
        self.name, self.id, self.input = name, "toolu_1", args

    def model_dump(self) -> dict:
        return {"type": "tool_use", "id": self.id, "name": self.name, "input": self.input}


class _FakeText:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text

    def model_dump(self) -> dict:
        return {"type": "text", "text": self.text}


class _FakeFinal:
    def __init__(self, stop_reason: str, content: list) -> None:
        self.stop_reason, self.content, self.usage, self.model = stop_reason, content, _FakeUsage(), "claude"


class _FakeStream:
    def __init__(self, final: _FakeFinal) -> None:
        self.final = final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(())

    def get_final_message(self):
        return self.final


class _FakeClient:
    """Records each call's tools and messages; asks for query_database first, then answers."""

    def __init__(self) -> None:
        self.messages, self.calls = self, []

    def stream(self, **kwargs):
        self.calls.append({"tools": [t["name"] for t in kwargs["tools"]], "messages": list(kwargs["messages"])})
        if len(self.calls) == 1:
            return _FakeStream(_FakeFinal("tool_use", [_FakeToolUse("query_database", {"sql": "SELECT COUNT(*) AS n FROM regimes"})]))
        return _FakeStream(_FakeFinal("end_turn", [_FakeText("done")]))


def _agent_run(monkeypatch):
    from src.analytics import chat as chat_mod

    client = _FakeClient()
    agent = chat_mod.MacroRadarAgent.__new__(chat_mod.MacroRadarAgent)
    agent.client, agent.model = client, chat_mod.MODEL
    monkeypatch.setattr(chat_mod, "_build_state_snapshot", lambda: "snapshot")
    list(agent.ask_streaming("How many regime months are stored?"))
    result = [b for m in client.calls[1]["messages"] if m["role"] == "user" and isinstance(m["content"], list)
              for b in m["content"] if b.get("type") == "tool_result"]
    return client, result


def test_the_free_form_sql_tool_is_off_unless_its_variable_turns_it_on(tmp_path, monkeypatch):
    """Round 27: the free-form query tool ships disabled. With ASSISTANT_FREEFORM_SQL
    unset, the model is not offered query_database, a request naming it is refused
    without running any SQL, and the seven fixed-SQL tools stay. Only 1, true, yes
    or on turn it on, and then the tool is offered and dispatched through its guard.
    On the staged code the tool was always offered and ran."""
    from src.analytics import chat as chat_mod

    fixed = ["get_current_regime", "get_signal_status", "get_recession_probability", "get_credit_snapshot",
             "get_market_snapshot", "get_recent_headlines", "explain_current_view"]
    monkeypatch.setattr(chat_mod, "DB_PATH", _scratch_db(tmp_path))
    ran: list[str] = []
    real = chat_mod._tool_query_database
    monkeypatch.setitem(chat_mod._TOOL_IMPLS, "query_database", lambda sql: ran.append(sql) or real(sql))

    for value in (None, "", "0", "false", "off", "no", "2"):
        if value is None:
            monkeypatch.delenv("ASSISTANT_FREEFORM_SQL", raising=False)
        else:
            monkeypatch.setenv("ASSISTANT_FREEFORM_SQL", value)
        assert not chat_mod.freeform_sql_enabled(), value
        assert [t["name"] for t in chat_mod.active_tools()] == fixed, value
        client, result = _agent_run(monkeypatch)
        assert client.calls[0]["tools"] == fixed and client.calls[1]["tools"] == fixed, value  # offered to the model
        assert len(result) == 1 and result[0]["is_error"] is True, result
        assert "The query_database tool is not enabled on this server" in result[0]["content"], result
    assert ran == [], "a refused request ran SQL"
    assert "query_database" not in chat_mod.SYSTEM_PROMPT_TEMPLATE  # the prompt names no tool it may not offer

    for value in ("1", "true", "YES", " on "):
        monkeypatch.setenv("ASSISTANT_FREEFORM_SQL", value)
        assert chat_mod.freeform_sql_enabled(), value
        client, result = _agent_run(monkeypatch)
        assert client.calls[0]["tools"] == ["query_database"] + fixed, value
        assert result[0]["is_error"] is False and '"n": 1' in result[0]["content"], result
    assert ran == ["SELECT COUNT(*) AS n FROM regimes"] * 4
