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
