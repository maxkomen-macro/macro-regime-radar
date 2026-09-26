"""tests/test_bootstrap_validation.py — the verdict published with the database,
as bootstrap verifies and holds it (desk/frame-3-api-b2a; FRAME3_API_PLAN.md
§1.9 parts 1 and 2, §6 S-01, Codex R-01/R-05/R-07).

Hermetic: the release is tests/desk_release.Release behind an httpx
MockTransport, and every database is a WAL-mode hermetic store, so nothing
here skips. The per-request key gate and the commit races are in
tests/test_desk_v2_pipeline.py."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from api import bootstrap, db
from src.analytics import dbpath
from tests import desk_release as rel

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """DB_PATH on a store B, a token, a fresh release, nothing held."""
    live = tmp_path / "live" / "macro_radar.db"
    live.parent.mkdir()
    live.write_bytes(rel.store_bytes(tmp_path, "b.db", seed=8))
    monkeypatch.setattr(db, "DB_PATH", live)
    monkeypatch.setenv("GH_DB_TOKEN", "test-token-not-real")
    monkeypatch.setattr(bootstrap, "_poke_worker", lambda: None)
    release = rel.Release()
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(release.handler))
    bootstrap.reset_validation_for_tests()
    db.reset_connections_for_tests()
    yield live, release
    bootstrap.reset_validation_for_tests()
    db.reset_connections_for_tests()


def test_a_matching_verdict_is_held_with_the_swapped_files_key(env, tmp_path):
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a)
    release.publish_validation(rel.verdict(a, mode="full", timestamp="2026-09-26T11:30:00Z"))
    assert bootstrap.refresh_db() is True
    assert live.read_bytes() == a
    held = bootstrap.validation_state()
    assert held == {"verdict": "pass", "mode": "full", "timestamp": "2026-09-26T11:30:00Z",
                    "validated_key": dbpath.file_key(live), "db_sha256": rel.sha(a)}
    assert bootstrap.validation_for(dbpath.file_key(live)) == "pass"
    assert bootstrap.validation_for(("another", "key")) is None and bootstrap.validation_for(None) is None


def test_a_fail_verdict_is_held_as_fail(env, tmp_path):
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a)
    release.publish_validation(rel.verdict(a, verdict="fail", mode="intraday"))
    assert bootstrap.refresh_db() is True
    assert bootstrap.validation_for(dbpath.file_key(live)) == "fail"
    assert bootstrap.validation_state()["mode"] == "intraday"


@pytest.mark.parametrize("body", [None, "mismatch", b"not json", b'{"verdict": "pass"}', "extra", "maybe"])
def test_no_verdict_is_held_without_a_matching_published_one(env, tmp_path, body):
    """A missing validation.json, a hash of other bytes, or one that is not
    exactly the four fields with pass/fail binds nothing: the verdict is unknown."""
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a)
    if body == "mismatch":
        body = rel.verdict(db_sha256="0" * 64)
    elif body == "extra":
        body = json.dumps({**json.loads(rel.verdict(a)), "failures": []}).encode()
    elif body == "maybe":
        body = rel.verdict(a, verdict="maybe")
    release.publish_validation(body)
    assert bootstrap.refresh_db() is True and live.read_bytes() == a, "the database never waits on the verdict"
    assert bootstrap.validation_state() is None
    assert bootstrap.validation_for(dbpath.file_key(live)) is None


def test_a_download_clears_the_previous_files_verdict(env, tmp_path):
    live, release = env
    a, c = rel.store_bytes(tmp_path, "a.db", seed=7), rel.store_bytes(tmp_path, "c.db", seed=9)
    release.publish_db(a)
    release.publish_validation(rel.verdict(a))
    bootstrap.refresh_db()
    assert bootstrap.validation_state() is not None
    release.publish_db(c)  # the next upload, its verdict not yet listed
    release.publish_validation(None)
    assert bootstrap.refresh_db() is True and live.read_bytes() == c
    assert bootstrap.validation_state() is None


def test_a_missed_upload_recovers_on_the_next_poll_with_no_database_download(env, tmp_path):
    """R-05, the repro: poll one lists a new database beside the previous run's
    validation.json (another file's hash): the database swaps in and the verdict
    is unknown. Poll two lists the same database asset with its own
    validation.json: no second database download, and the verdict is held."""
    live, release = env
    old, new = rel.store_bytes(tmp_path, "old.db", seed=7), rel.store_bytes(tmp_path, "new.db", seed=9)
    release.publish_db(new)
    release.publish_validation(rel.verdict(old))
    assert bootstrap.refresh_db() is True
    assert bootstrap.validation_state() is None and release.db_downloads == 1
    release.publish_validation(rel.verdict(new))
    assert bootstrap.refresh_db() is False
    assert release.db_downloads == 1, "the database asset is unchanged: no download"
    assert bootstrap.validation_for(dbpath.file_key(live)) == "pass"
    before = release.validation_downloads
    assert bootstrap.refresh_db() is False
    assert release.validation_downloads == before, "a held verdict for the current asset is not fetched again"


def test_a_restart_rebinds_the_verdict_to_the_file_on_disk(env, tmp_path):
    """A fresh process holds nothing; with the asset unchanged its startup poll
    re-fetches validation.json and verifies it against the file on disk."""
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a)
    release.publish_validation(rel.verdict(a))
    bootstrap.refresh_db()
    bootstrap.reset_validation_for_tests()  # the restart
    downloads = release.db_downloads
    assert bootstrap.refresh_db() is False and release.db_downloads == downloads
    assert bootstrap.validation_for(dbpath.file_key(live)) == "pass"


def test_without_a_listed_digest_the_poll_compares_the_file_on_disk(env, tmp_path):
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a, digest=False)
    release.publish_validation(rel.verdict(a))
    bootstrap.refresh_db()
    assert bootstrap.validation_for(dbpath.file_key(live)) == "pass"
    before = release.validation_downloads
    bootstrap.refresh_db()
    assert release.validation_downloads == before, "the file's own hash is the held one: nothing to fetch"


def test_a_failing_verdict_fetch_never_fails_the_database_refresh(env, tmp_path):
    live, release = env
    a = rel.store_bytes(tmp_path, "a.db", seed=7)
    release.publish_db(a)
    release.publish_validation(rel.verdict(a))
    release.fail_validation = True
    assert bootstrap.refresh_db() is True and live.read_bytes() == a
    assert bootstrap.validation_state() is None and bootstrap.status()["last_result"] == "downloaded"
    release.fail_validation = False
    assert bootstrap.refresh_db() is False
    assert bootstrap.validation_for(dbpath.file_key(live)) == "pass"


def test_without_a_token_nothing_is_fetched_or_held(env, monkeypatch):
    monkeypatch.delenv("GH_DB_TOKEN")
    assert bootstrap.refresh_db() is False and bootstrap.validation_state() is None


def test_the_published_verdict_parses_exactly_four_fields():
    ok = rel.verdict(b"x")
    assert bootstrap.parse_validation(ok) == json.loads(ok)
    for bad in (b"", b"[]", b"{}", rel.verdict(db_sha256="ABC"), rel.verdict(db_sha256="g" * 64),
                json.dumps({"verdict": "pass", "mode": "full", "timestamp": "t"}).encode()):
        assert bootstrap.parse_validation(bad) is None, bad


def test_the_workflow_script_writes_the_four_fields_of_the_file_it_hashes(tmp_path):
    """scripts/validation_asset.py, as the two workflows run it: the
    validator's verdict, mode and generated_at, and the database's sha256."""
    dbf = tmp_path / "macro_radar.db"
    dbf.write_bytes(b"SQLite format 3\x00" + b"\x01" * 4096)
    report = tmp_path / "validation.json"
    report.write_text(json.dumps({"verdict": "pass", "mode": "intraday", "generated_at": "2026-09-26T14:05:00Z",
                                  "failures": [], "warnings": ["w"], "upload": True}))
    out = tmp_path / "publish" / "validation.json"
    proc = subprocess.run([sys.executable, str(ROOT / "scripts" / "validation_asset.py"), str(report), str(dbf), str(out)],
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    doc = json.loads(out.read_text())
    assert doc == {"verdict": "pass", "mode": "intraday", "timestamp": "2026-09-26T14:05:00Z",
                   "db_sha256": rel.sha(dbf.read_bytes())}
    assert bootstrap.parse_validation(out.read_bytes()) == doc, "what the workflows publish is what bootstrap reads"
