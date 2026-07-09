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
