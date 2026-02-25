import sqlite3
from src.config import DB_PATH


def get_connection() -> sqlite3.Connection:
    """
    Open (or create) the SQLite database at DB_PATH and return a connection.
    WAL journal mode is enabled for better read performance.
    Row factory is set so results are accessible by column name.

    Caller is responsible for closing the connection.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
