"""The periodic refresh judges the published database by the release asset's
identity, never by the local file's modification time (fix/prelaunch-1, B-H1).

An unchanged asset means no download, no swap and therefore no new generation
and no recompute; a changed asset is downloaded, validated and swapped in, and
the worker rebuilds from it. GitHub is replaced by an httpx MockTransport; the
database files are scratch copies."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path

import httpx
import pytest

from api import bootstrap, db
from src.analytics import dbpath

REPO_DB = db.DB_PATH
pytestmark = pytest.mark.skipif(not REPO_DB.exists(), reason="local DB snapshot absent")

API = "https://api.github.com/repos/maxkomen-macro/macro-regime-radar"


def _copy(src: Path, dst: Path) -> Path:
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    s.backup(d)
    s.close()
    d.close()
    return dst


def _asset(asset_id: int, updated_at: str, size: int) -> dict:
    return {"id": asset_id, "name": "macro_radar.db", "updated_at": updated_at, "size": size,
            "url": f"{API}/releases/assets/{asset_id}", "digest": f"sha256:{asset_id:064x}"}


class GitHub:
    """A fake data-latest release. `downloads` counts asset-byte requests."""

    def __init__(self, asset: dict, payload: bytes = b"") -> None:
        self.asset = asset
        self.payload = payload
        self.requests: list[str] = []
        self.downloads = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        assert request.headers.get("Authorization", "").startswith("Bearer "), "every call is authenticated"
        if request.url.path.endswith("/releases/tags/data-latest"):
            return httpx.Response(200, json={"assets": [self.asset]})
        if request.url.path.endswith(f"/releases/assets/{self.asset['id']}"):
            self.downloads += 1
            return httpx.Response(200, content=self.payload)
        return httpx.Response(404)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    live = _copy(REPO_DB, tmp_path / "macro_radar.db")
    monkeypatch.setattr(db, "DB_PATH", live)
    monkeypatch.setenv("GH_DB_TOKEN", "test-token-not-real")
    db.reset_connections_for_tests()
    yield live
    db.reset_connections_for_tests()


def _install(monkeypatch, gh: GitHub) -> None:
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(gh.handler))


def _write_identity(asset: dict) -> None:
    bootstrap.identity_path().write_text(json.dumps(bootstrap.asset_identity(asset)))


def test_an_unchanged_asset_triggers_no_download_no_swap_and_no_recompute(env, monkeypatch):
    from api import worker as worker_mod

    asset = _asset(11, "2026-09-20T11:30:00Z", env.stat().st_size)
    _write_identity(asset)
    gh = GitHub(asset)
    _install(monkeypatch, gh)
    counter: list = []
    w = worker_mod.AnalyticsWorker(items=[("probe", lambda ctx: counter.append(1) or len(counter))], poll_s=0.05)
    monkeypatch.setattr(worker_mod, "_worker", w)
    try:
        w.start(serving=True)
        assert w.wait_published(timeout=30)
        gen_id, key, inode = w.current.id, dbpath.file_key(env), env.stat().st_ino
        assert bootstrap.refresh_db() is False
        assert gh.downloads == 0 and len(gh.requests) == 1, gh.requests
        assert bootstrap.status()["last_result"] == "unchanged"
        time.sleep(0.4)  # several worker polls
        assert env.stat().st_ino == inode and dbpath.file_key(env) == key
        assert w.current.id == gen_id and len(counter) == 1, "no swap, so no new generation and no recompute"
    finally:
        w.stop()
        dbpath.clear_provider()


def test_an_old_file_with_the_current_identity_is_never_redownloaded(env, monkeypatch):
    asset = _asset(11, "2026-09-20T11:30:00Z", env.stat().st_size)
    _write_identity(asset)
    month_ago = time.time() - 30 * 86400
    os.utime(env, (month_ago, month_ago))
    monkeypatch.setenv("BOOTSTRAP_DB_MAX_AGE_MIN", "60")
    gh = GitHub(asset)
    _install(monkeypatch, gh)
    assert bootstrap.refresh_db() is False
    assert gh.downloads == 0


def test_a_changed_asset_is_downloaded_validated_swapped_and_rebuilt(env, tmp_path, monkeypatch):
    from api import worker as worker_mod

    old = _asset(11, "2026-09-20T11:30:00Z", env.stat().st_size)
    _write_identity(old)
    changed = _copy(REPO_DB, tmp_path / "changed.db")
    c = sqlite3.connect(changed)
    c.execute("UPDATE raw_series SET value = value + 0.5 WHERE series_id='BAMLH0A0HYM2' AND date = (SELECT MAX(date) FROM raw_series WHERE series_id='BAMLH0A0HYM2')")
    c.commit()
    c.close()
    payload = changed.read_bytes()
    new = _asset(12, "2026-09-21T00:30:00Z", len(payload))
    gh = GitHub(new, payload)
    _install(monkeypatch, gh)
    counter: list = []
    w = worker_mod.AnalyticsWorker(items=[("probe", lambda ctx: counter.append(1) or len(counter))], poll_s=0.05)
    monkeypatch.setattr(worker_mod, "_worker", w)
    try:
        w.start(serving=True)
        assert w.wait_published(timeout=30)
        first = w.current.id
        inode = env.stat().st_ino
        assert bootstrap.refresh_db() is True
        assert gh.downloads == 1
        assert env.stat().st_ino != inode
        assert json.loads(bootstrap.identity_path().read_text()) == bootstrap.asset_identity(new)
        assert w.wait_published(min_id=first + 1, timeout=30), "the swap starts a new generation"
        assert len(counter) == 2
        # and a second refresh against the same asset is a no-op
        assert bootstrap.refresh_db() is False and gh.downloads == 1
    finally:
        w.stop()
        dbpath.clear_provider()


def test_no_recorded_identity_downloads_once_then_trusts_it(env, tmp_path, monkeypatch):
    payload = _copy(REPO_DB, tmp_path / "same.db").read_bytes()
    asset = _asset(21, "2026-09-21T00:30:00Z", len(payload))
    gh = GitHub(asset, payload)
    _install(monkeypatch, gh)
    assert not bootstrap.identity_path().exists()
    assert bootstrap.refresh_db() is True and gh.downloads == 1
    assert bootstrap.refresh_db() is False and gh.downloads == 1


def test_a_torn_download_never_replaces_the_database_or_its_identity(env, monkeypatch):
    old = _asset(11, "2026-09-20T11:30:00Z", env.stat().st_size)
    _write_identity(old)
    before = (env.stat().st_ino, env.read_bytes()[:4096])
    gh = GitHub(_asset(13, "2026-09-21T00:30:00Z", 10), b"not a database")
    _install(monkeypatch, gh)
    with pytest.raises(ValueError):
        bootstrap.refresh_db()
    assert (env.stat().st_ino, env.read_bytes()[:4096]) == before
    assert json.loads(bootstrap.identity_path().read_text()) == bootstrap.asset_identity(old)
    assert bootstrap.status()["last_result"] == "error"


def test_the_periodic_refresh_is_judged_by_identity_not_forced(monkeypatch):
    import asyncio

    seen: list = []

    def fake_refresh(force: bool = False) -> bool:
        seen.append(force)
        raise asyncio.CancelledError

    monkeypatch.setattr(bootstrap, "refresh_db", fake_refresh)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(bootstrap.periodic_refresh(0.0001))
    assert seen == [False]
