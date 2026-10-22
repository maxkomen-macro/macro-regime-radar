"""alert_feed is recomputed whole each run (scripts/validate_db.RECOMPUTED_TABLES):
a run whose triggers have all cleared must leave the feed empty, never keep the
last run's alerts (Codex S-03)."""
import sqlite3

from src.analytics import alerts

SCHEMA = """CREATE TABLE alert_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, alert_type TEXT NOT NULL,
    name TEXT NOT NULL, level TEXT NOT NULL, value REAL, threshold REAL, direction TEXT,
    message TEXT NOT NULL, created_at TEXT NOT NULL)"""
STALE = ("2026-10-02", "market", "VIX_shock", "watch", 2.1, 2.0, "above", "VIX weekly z-score=2.10", "2026-10-02T12:00:00")


def _store(path):
    conn = sqlite3.connect(path)
    conn.execute(SCHEMA)
    conn.execute("INSERT INTO alert_feed (date, alert_type, name, level, value, threshold, direction, message, created_at) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", STALE)
    conn.commit()
    return conn


def _rows(path):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT name, date FROM alert_feed").fetchall()


def test_an_empty_result_clears_the_feed(tmp_path):
    path = tmp_path / "radar.db"
    conn = _store(path)
    assert alerts.upsert_alert_feed(conn, []) == 0
    conn.close()
    assert _rows(path) == []  # committed: a fresh connection sees no rows


def test_a_run_with_no_alerts_clears_the_last_runs_alerts(tmp_path, monkeypatch):
    path = tmp_path / "radar.db"
    _store(path).close()
    monkeypatch.setattr(alerts, "DB_PATH", path)
    monkeypatch.setattr(alerts, "build_macro_alerts", lambda conn: [])
    monkeypatch.setattr(alerts, "build_market_alerts", lambda conn: [])
    alerts.run()
    assert _rows(path) == []


def test_a_run_with_alerts_replaces_the_feed(tmp_path):
    path = tmp_path / "radar.db"
    conn = _store(path)
    fresh = ("2026-10-21", "market", "USD_breakout", "watch", 2.3, 2.0, "above", "UUP", "2026-10-21T12:00:00")
    assert alerts.upsert_alert_feed(conn, [fresh]) == 1
    conn.close()
    assert _rows(path) == [("USD_breakout", "2026-10-21")]
