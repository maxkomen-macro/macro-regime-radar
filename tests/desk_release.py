"""tests/desk_release.py — a fake data-latest release and WAL-mode stores for
the published-verdict tests (desk/frame-3-api-b2a; FRAME3_API_PLAN.md §1.9,
S-01). Not a test module.

`Release` answers api/bootstrap's calls (the listing, the database asset, the
`validation.json` asset) through an httpx MockTransport, and counts the
downloads of each. `store_bytes` builds a hermetic store (tests/desk_macro_store)
in WAL mode, as the refresh workflows publish it, and returns its bytes.
`wal_commit` commits one row to a served file in WAL mode and returns the open
writer, so the commit stays in the -wal file (the last connection to close
checkpoints it) until the test checkpoints or closes it.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import httpx

from tests import desk_macro_store as store

API = "https://api.github.com/repos/maxkomen-macro/macro-regime-radar"


def store_bytes(tmp_path: Path, name: str, seed: int) -> bytes:
    path = store.build(tmp_path / name, seed=seed)
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    finally:
        conn.close()
    return path.read_bytes()


def sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def verdict(payload: bytes | None = None, *, db_sha256: str | None = None, verdict: str = "pass", mode: str = "full",
            timestamp: str = "2026-09-26T11:30:00Z") -> bytes:
    return json.dumps({"verdict": verdict, "mode": mode, "timestamp": timestamp,
                       "db_sha256": db_sha256 if db_sha256 is not None else sha(payload)}).encode()


class Release:
    """The data-latest release: one database asset and, when set, one
    validation.json asset. Each upload renews the asset's id, as --clobber does."""

    def __init__(self) -> None:
        self.db: dict | None = None
        self.db_bytes = b""
        self.validation: dict | None = None
        self.validation_bytes = b""
        self.db_downloads = 0
        self.validation_downloads = 0
        self.fail_validation = False
        self._ids = iter(range(100, 10_000))

    def publish_db(self, payload: bytes, *, digest: bool = True) -> None:
        asset_id = next(self._ids)
        self.db = {"id": asset_id, "name": "macro_radar.db", "updated_at": f"2026-09-26T11:{asset_id % 60:02d}:00Z",
                   "size": len(payload), "url": f"{API}/releases/assets/{asset_id}",
                   **({"digest": f"sha256:{sha(payload)}"} if digest else {})}
        self.db_bytes = payload

    def publish_validation(self, body: bytes | None) -> None:
        if body is None:
            self.validation, self.validation_bytes = None, b""
            return
        asset_id = next(self._ids)
        self.validation = {"id": asset_id, "name": "validation.json", "updated_at": "2026-09-26T11:31:00Z",
                           "size": len(body), "url": f"{API}/releases/assets/{asset_id}"}
        self.validation_bytes = body

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers.get("Authorization", "").startswith("Bearer "), "every call is authenticated"
        path = request.url.path
        if path.endswith("/releases/tags/data-latest"):
            return httpx.Response(200, json={"assets": [a for a in (self.db, self.validation) if a is not None]})
        if self.db is not None and path.endswith(f"/releases/assets/{self.db['id']}"):
            self.db_downloads += 1
            return httpx.Response(200, content=self.db_bytes)
        if self.validation is not None and path.endswith(f"/releases/assets/{self.validation['id']}"):
            self.validation_downloads += 1
            if self.fail_validation:
                return httpx.Response(500)
            return httpx.Response(200, content=self.validation_bytes)
        return httpx.Response(404)


def wal_commit(path: Path, value: float = 1.0) -> sqlite3.Connection:
    """One committed row (a raw_series print) in the served file's WAL. The
    writer is returned open: closing the last connection checkpoints the WAL."""
    conn = sqlite3.connect(path, check_same_thread=False)  # a worker thread may commit, the test closes
    conn.execute("PRAGMA wal_autocheckpoint = 0")
    conn.execute("INSERT OR REPLACE INTO raw_series (series_id, date, value, fetched_at) VALUES ('TEST', '2026-09-26', ?, 't')",
                 (value,))
    conn.commit()
    return conn
