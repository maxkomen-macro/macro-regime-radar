"""Private storage (Change 1, 2026-11-05): one setting, DATA_RELEASE_REPO, names
the repo whose data-latest release holds the database, validation.json and
snapshot-latest.json. Unset, every reader and writer behaves exactly as before
(this repo). The sealed earnings ledger stays on this repo's release whatever
the setting says. GitHub is an httpx MockTransport; the database is a scratch
file; the workflow checks read the YAML and run the token switch in bash."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path

import httpx
import pytest
import yaml

from api import bootstrap, db

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"
HOME = "maxkomen-macro/macro-regime-radar"
PRIVATE = "maxkomen-macro/macro-radar-data"
WRITERS = ("refresh-data.yml", "intraday-refresh.yml", "daily-memo.yml", "weekly-memo.yml")
BAD = ["foo", "a/b/c", "owner/..", "owner/.", "https://github.com/a/b", "a b/c", "-x/y", "/repo", "owner/"]


# ── the API bootstrap ────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", [None, "", "   "])
def test_unset_or_blank_means_this_repo(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("DATA_RELEASE_REPO", raising=False)
    else:
        monkeypatch.setenv("DATA_RELEASE_REPO", value)
    assert bootstrap.data_release_repo() == HOME == bootstrap.DEFAULT_DATA_REPO


def test_a_named_repo_is_used_as_given_stripped(monkeypatch):
    monkeypatch.setenv("DATA_RELEASE_REPO", f"  {PRIVATE}\n")
    assert bootstrap.data_release_repo() == PRIVATE


@pytest.mark.parametrize("value", BAD)
def test_a_malformed_setting_is_refused(monkeypatch, value):
    monkeypatch.setenv("DATA_RELEASE_REPO", value)
    with pytest.raises(bootstrap.DataRepoError):
        bootstrap.data_release_repo()


def _regimes_db(path: Path) -> bytes:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE regimes (date TEXT, label TEXT)")
    conn.execute("INSERT INTO regimes VALUES ('2026-10-01', 'Goldilocks')")
    conn.commit()
    conn.close()
    return path.read_bytes()


class Release:
    """One repo's data-latest release holding a database and the verdict bound to it by
    hash (scripts/validation_asset.py's shape); records every URL asked for."""

    def __init__(self, repo: str, payload: bytes):
        self.api = f"https://api.github.com/repos/{repo}"
        self.payload = payload
        self.sha = hashlib.sha256(payload).hexdigest()
        self.verdict = json.dumps({"verdict": "pass", "mode": "full", "timestamp": "2026-11-05T07:19:00Z",
                                   "db_sha256": self.sha}).encode()
        self.urls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.urls.append(url)
        if url == f"{self.api}/releases/tags/data-latest":
            return httpx.Response(200, json={"assets": [
                {"id": 7, "name": "macro_radar.db", "updated_at": "2026-11-05T07:19:20Z", "size": len(self.payload),
                 "digest": f"sha256:{self.sha}", "url": f"{self.api}/releases/assets/7"},
                {"id": 8, "name": "validation.json", "updated_at": "2026-11-05T07:19:30Z", "size": len(self.verdict),
                 "url": f"{self.api}/releases/assets/8"}]})
        if url == f"{self.api}/releases/assets/7":
            return httpx.Response(200, content=self.payload)
        if url == f"{self.api}/releases/assets/8":
            return httpx.Response(200, content=self.verdict)
        return httpx.Response(404)


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    target = tmp_path / "served" / "macro_radar.db"
    monkeypatch.setattr(db, "DB_PATH", target)
    monkeypatch.setenv("GH_DB_TOKEN", "test-token-not-real")
    monkeypatch.setattr(bootstrap, "_poke_worker", lambda: None)
    db.reset_connections_for_tests()
    bootstrap.reset_validation_for_tests()
    yield target
    db.reset_connections_for_tests()
    bootstrap.reset_validation_for_tests()


@pytest.mark.parametrize("setting, repo", [(None, HOME), (PRIVATE, PRIVATE)])
def test_the_database_is_read_from_the_named_repo_and_nowhere_else(scratch, tmp_path, monkeypatch, setting, repo):
    if setting is None:
        monkeypatch.delenv("DATA_RELEASE_REPO", raising=False)
    else:
        monkeypatch.setenv("DATA_RELEASE_REPO", setting)
    release = Release(repo, _regimes_db(tmp_path / "published.db"))
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(release.handler))
    assert bootstrap.refresh_db() is True
    assert scratch.read_bytes() == release.payload
    assert release.urls and all(u.startswith(release.api + "/") for u in release.urls), release.urls
    assert f"{release.api}/releases/assets/8" in release.urls, "the verdict is read from the same repo"
    assert bootstrap.status()["last_result"] == "downloaded"
    held = bootstrap.validation_state()
    assert held is not None and held["verdict"] == "pass" and held["db_sha256"] == release.sha


def test_a_malformed_setting_fails_the_refresh_without_any_request_and_keeps_the_served_file(scratch, monkeypatch):
    scratch.parent.mkdir(parents=True)
    scratch.write_bytes(b"served bytes")
    monkeypatch.setenv("DATA_RELEASE_REPO", "not a repo")
    asked: list = []
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(lambda r: asked.append(r) or httpx.Response(500)))
    with pytest.raises(bootstrap.DataRepoError):
        bootstrap.refresh_db()
    assert asked == []
    assert scratch.read_bytes() == b"served bytes"
    state = bootstrap.status()
    assert state["last_result"] == "error" and state["last_error"] == "DATA_RELEASE_REPO is not owner/name"


def test_without_a_token_the_setting_is_never_read(scratch, monkeypatch):
    monkeypatch.delenv("GH_DB_TOKEN", raising=False)
    monkeypatch.setenv("DATA_RELEASE_REPO", "not a repo")
    assert bootstrap.refresh_db() is False
    assert bootstrap.status()["last_result"] == "skipped"


def test_the_earnings_ledger_reader_stays_on_this_repo(monkeypatch):
    from api import earnings_ledger_reader as lr

    monkeypatch.setenv("DATA_RELEASE_REPO", PRIVATE)
    assert bootstrap._GH_API_REPO == f"https://api.github.com/repos/{HOME}"
    assert lr.LIST_URL == f"https://api.github.com/repos/{HOME}/releases/tags/data-latest"
    assert PRIVATE not in lr.asset_url(12)


# ── the legacy Streamlit app (read from source: importing it downloads at import) ──


def _dashboard_reader(secrets: dict):
    tree = ast.parse((ROOT / "dashboard" / "app.py").read_text())
    keep = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name == "_data_release_repo")
            or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in ("_DEFAULT_DATA_REPO", "_REPO_NAME") for t in n.targets))]
    assert len(keep) == 3, "dashboard/app.py lost its DATA_RELEASE_REPO reader"

    class St:
        pass

    st = St()
    st.secrets = secrets
    ns: dict = {"os": os, "re": re, "st": st}
    exec(compile(ast.Module(body=keep, type_ignores=[]), "dashboard/app.py", "exec"), ns)
    return ns["_data_release_repo"]


def test_the_dashboard_reads_the_same_setting_from_secrets_or_env(monkeypatch):
    monkeypatch.delenv("DATA_RELEASE_REPO", raising=False)
    assert _dashboard_reader({})() == HOME
    assert _dashboard_reader({"DATA_RELEASE_REPO": PRIVATE})() == PRIVATE
    monkeypatch.setenv("DATA_RELEASE_REPO", PRIVATE)
    assert _dashboard_reader({})() == PRIVATE
    for bad in BAD:
        with pytest.raises(ValueError):
            _dashboard_reader({"DATA_RELEASE_REPO": bad})()
    src = (ROOT / "dashboard" / "app.py").read_text()
    assert "repos/{_data_release_repo()}/releases/tags/data-latest" in src
    assert "repos/maxkomen-macro/macro-regime-radar/releases" not in src


def test_sync_data_prefers_the_setting_then_the_old_override():
    src = (ROOT / "scripts" / "sync_data.sh").read_text()
    assert 'REPO="${DATA_RELEASE_REPO:-${MRR_REPO:-maxkomen-macro/macro-regime-radar}}"' in src
    assert src.count('--repo "$REPO"') >= 2


_FETCH_STUB = """
globalThis.fetch = async (url) => { console.log("ASKED " + url); return { ok: false, status: 404 }; };
"""


def _vercel_fetch_asks(tmp_path: Path, env: dict) -> list[str]:
    """Run the Vercel build's snapshot fetcher with fetch stubbed; the URLs it asked for."""
    stub = tmp_path / "stub.mjs"
    stub.write_text(_FETCH_STUB)
    base = {"PATH": os.environ.get("PATH", ""), "GH_SNAPSHOT_TOKEN": "test-token-not-real"}
    done = subprocess.run(["node", "--import", stub.as_uri(), str(ROOT / "web" / "scripts" / "fetch-snapshot.mjs")],
                          cwd=tmp_path, env={**base, **env}, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr  # a failed lookup never fails the build
    assert "test-token-not-real" not in done.stdout + done.stderr
    return [ln.split(" ", 1)[1] for ln in done.stdout.splitlines() if ln.startswith("ASKED ")]


@pytest.mark.parametrize("env, repo", [
    ({}, HOME),
    ({"DATA_RELEASE_REPO": "  "}, HOME),
    ({"DATA_RELEASE_REPO": PRIVATE}, PRIVATE),
    ({"SNAPSHOT_REPO": "someone/else", "DATA_RELEASE_REPO": PRIVATE}, "someone/else"),
    ({"SNAPSHOT_REPO": "", "DATA_RELEASE_REPO": PRIVATE}, PRIVATE),
])
def test_the_vercel_snapshot_fetch_reads_snapshot_repo_then_the_shared_setting(tmp_path, env, repo):
    assert _vercel_fetch_asks(tmp_path, env) == [f"https://api.github.com/repos/{repo}/releases/tags/data-latest"]


# ── the four writers ─────────────────────────────────────────────────────────

DEFAULT_EXPR = "${{ vars.DATA_RELEASE_REPO || github.repository }}"
SWITCH = ('[ "$DATA_RELEASE_REPO" = "$GITHUB_REPOSITORY" ] || export GH_TOKEN="${DATA_RELEASE_TOKEN:?DATA_RELEASE_REPO '
          'names another repo but the DATA_RELEASE_TOKEN secret is not set}"')
MIRROR = "Mirror the data repo's files to this repo's data-latest (cutover only)"


def _steps(name: str) -> list[dict]:
    doc = yaml.safe_load((WF / name).read_text())
    return next(iter(doc["jobs"].values()))["steps"]


def _gh_release_lines(run: str) -> list[str]:
    return [ln.strip() for ln in run.splitlines() if re.search(r"\bgh release (view|create|download|upload)\b", ln)]


@pytest.mark.parametrize("name", WRITERS)
def test_every_database_release_command_names_the_setting_and_falls_back_to_this_repo(name):
    doc = yaml.safe_load((WF / name).read_text())
    assert doc["env"]["DATA_RELEASE_REPO"] == DEFAULT_EXPR
    seen = 0
    for step in _steps(name):
        run = step.get("run") or ""
        lines = _gh_release_lines(run)
        if not lines:
            continue
        seen += 1
        assert all('--repo "$DATA_RELEASE_REPO"' in ln for ln in lines), (step["name"], lines)
        assert step["env"]["GH_TOKEN"] == "${{ secrets.GITHUB_TOKEN }}", step["name"]
        assert step["env"]["DATA_RELEASE_TOKEN"] == "${{ secrets.DATA_RELEASE_TOKEN }}", step["name"]
        assert SWITCH in run, step["name"]
        assert run.index(SWITCH) < min(run.index(ln) for ln in lines), f"{step['name']}: the token is chosen before any gh call"
        assert "secrets." not in run, step["name"]
    assert seen >= 1, name


def _ledger_steps(name: str) -> list[dict]:
    return [s for s in _steps(name) if "earnings_cache" in (s.get("run") or "") or "ledger" in s.get("name", "").lower()]


def test_the_ledger_steps_keep_this_repo_and_the_builtin_token():
    steps = _ledger_steps("refresh-data.yml")
    runs = [s["run"] for s in steps]
    assert any("--fetch-ledger" in r for r in runs) and any("--publish-ledger" in r for r in runs), runs
    for step in steps:
        assert "DATA_RELEASE" not in step["run"], step["name"]
        assert "DATA_RELEASE_TOKEN" not in (step.get("env") or {}), step["name"]
        assert (step.get("env") or {}).get("GH_TOKEN") == "${{ secrets.GITHUB_TOKEN }}", step["name"]
    # the ledger code never reads the setting; only the manual probe's download does
    assert "DATA_RELEASE" not in (ROOT / "src" / "events" / "earnings_ledger.py").read_text()
    cache = (ROOT / "src" / "events" / "earnings_cache.py").read_text()
    assert cache.count("_download_public_db(") == 2, "defined once, called once (the --probe branch)"


@pytest.mark.parametrize("name", ("refresh-data.yml", "intraday-refresh.yml"))
def test_the_cutover_mirror_follows_both_publishes_runs_on_unchanged_refreshes_and_never_blocks(name):
    steps = _steps(name)
    names = [s.get("name", "") for s in steps]
    m = names.index(MIRROR)
    assert names[m - 1] == "Publish the validation verdict", names
    step = steps[m]
    # not gated on this run's upload: it copies the data repo's state, so a mirror that failed is repaired later
    assert step["if"] == "vars.DATA_RELEASE_MIRROR == 'true' && env.DATA_RELEASE_REPO != github.repository"
    assert step["continue-on-error"] is True and int(step["timeout-minutes"]) == 5
    assert step["env"] == {"GH_TOKEN": "${{ secrets.GITHUB_TOKEN }}", "DATA_RELEASE_TOKEN": "${{ secrets.DATA_RELEASE_TOKEN }}"}
    assert step["run"].strip() == "bash scripts/mirror_data_release.sh"


@pytest.mark.parametrize("name", ("daily-memo.yml", "weekly-memo.yml"))
def test_a_manual_memo_reads_the_named_repo_and_a_dispatched_one_still_uses_the_run_artifact(name):
    step = next(s for s in _steps(name) if s["name"] == "Use the validated snapshot (or the current release on manual runs)")
    run = step["run"]
    artifact, manual = run.split("else", 1)
    assert "cp validated/macro_radar.db data/macro_radar.db" in artifact and "gh release" not in artifact
    assert SWITCH in manual and 'gh release download data-latest --pattern macro_radar.db --dir data --clobber --repo "$DATA_RELEASE_REPO"' in manual


def _switch(env: dict) -> subprocess.CompletedProcess:
    script = SWITCH + '\nprintf "%s" "$GH_TOKEN"'
    base = {"PATH": os.environ.get("PATH", ""), "GH_TOKEN": "builtin"}
    return subprocess.run(["bash", "-euo", "pipefail", "-c", script], env={**base, **env}, capture_output=True, text=True)


def test_the_token_switch_keeps_the_builtin_token_for_this_repo_even_when_the_secret_exists():
    done = _switch({"DATA_RELEASE_REPO": HOME, "GITHUB_REPOSITORY": HOME, "DATA_RELEASE_TOKEN": "data-token"})
    assert done.returncode == 0 and done.stdout == "builtin"
    done = _switch({"DATA_RELEASE_REPO": HOME, "GITHUB_REPOSITORY": HOME, "DATA_RELEASE_TOKEN": ""})
    assert done.returncode == 0 and done.stdout == "builtin"


def test_the_token_switch_uses_the_secret_for_another_repo_and_stops_without_it():
    done = _switch({"DATA_RELEASE_REPO": PRIVATE, "GITHUB_REPOSITORY": HOME, "DATA_RELEASE_TOKEN": "data-token"})
    assert done.returncode == 0 and done.stdout == "data-token"
    done = _switch({"DATA_RELEASE_REPO": PRIVATE, "GITHUB_REPOSITORY": HOME, "DATA_RELEASE_TOKEN": ""})
    assert done.returncode != 0 and done.stdout == ""
    assert "DATA_RELEASE_TOKEN secret is not set" in done.stderr and "builtin" not in done.stderr


# ── the cutover mirror script, against a fake `gh` over two scratch releases ──

_FAKE_GH = r'''#!/usr/bin/env python3
import hashlib, json, os, shutil, sys
from pathlib import Path

state = Path(os.environ["FAKE_GH_STATE"])
args = sys.argv[1:]
with open(state / "calls.jsonl", "a") as fh:
    fh.write(json.dumps({"args": args, "token": os.environ.get("GH_TOKEN", "")}) + "\n")


def rel(repo):
    return state / "releases" / repo.replace("/", "__")


def opt(name):
    return args[args.index(name) + 1]


if args[:1] == ["api"]:
    repo = args[1].split("/")[1] + "/" + args[1].split("/")[2]
    if (state / f"busy-{repo.replace('/', '__')}").exists():
        print("gh: Service Unavailable (HTTP 503)", file=sys.stderr)
        sys.exit(1)
    if (state / f"deny-{repo.replace('/', '__')}").exists() or not rel(repo).is_dir():
        print("gh: Not Found (HTTP 404)", file=sys.stderr)
        sys.exit(1)
    for f in sorted(rel(repo).iterdir()):
        digest = "" if (state / f"nodigest-{repo.replace('/', '__')}-{f.name}").exists() else "sha256:" + hashlib.sha256(f.read_bytes()).hexdigest()
        print(f"{f.name}\t{digest}")
elif args[:2] == ["release", "create"]:
    rel(opt("--repo")).mkdir(parents=True)
elif args[:2] == ["release", "download"]:
    name = opt("--pattern")
    data = (rel(opt("--repo")) / name).read_bytes()
    if (state / f"corrupt-{name}").exists():
        data += b"!"
    Path(opt("--dir"), name).write_bytes(data)
elif args[:2] == ["release", "upload"]:
    src = Path(args[3])
    shutil.copyfile(src, rel(opt("--repo")) / src.name)
else:
    print("fake gh: unexpected " + " ".join(args), file=sys.stderr)
    sys.exit(2)
'''

MIRROR_SCRIPT = ROOT / "scripts" / "mirror_data_release.sh"
FILES = ("macro_radar.db", "snapshot-latest.json", "validation.json")


class Mirror:
    def __init__(self, tmp_path: Path):
        self.state = tmp_path / "gh-state"
        (self.state / "releases").mkdir(parents=True)
        bindir = tmp_path / "bin"
        bindir.mkdir()
        gh = bindir / "gh"
        gh.write_text(_FAKE_GH)
        gh.chmod(0o755)
        self.path = f"{bindir}:{os.environ.get('PATH', '')}"

    def release(self, repo: str, files: dict[str, bytes]) -> None:
        d = self.state / "releases" / repo.replace("/", "__")
        d.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (d / name).write_bytes(data)

    def files(self, repo: str) -> dict[str, bytes]:
        d = self.state / "releases" / repo.replace("/", "__")
        return {f.name: f.read_bytes() for f in d.iterdir()} if d.is_dir() else {}

    def flag(self, name: str) -> None:
        (self.state / name).touch()

    def calls(self) -> list[dict]:
        log = self.state / "calls.jsonl"
        return [json.loads(ln) for ln in log.read_text().splitlines()] if log.exists() else []

    def run(self, **env) -> subprocess.CompletedProcess:
        base = {"PATH": self.path, "FAKE_GH_STATE": str(self.state), "DATA_RELEASE_REPO": PRIVATE,
                "GITHUB_REPOSITORY": HOME, "DATA_RELEASE_TOKEN": "data-token", "GH_TOKEN": "builtin"}
        base.update(env)
        return subprocess.run(["bash", str(MIRROR_SCRIPT)], env={k: v for k, v in base.items() if v is not None},
                              capture_output=True, text=True, timeout=60)


PUBLISHED = {"macro_radar.db": b"database v2", "snapshot-latest.json": b'{"entries": 2}', "validation.json": b'{"v": 2}'}


def test_the_mirror_does_nothing_when_the_data_repo_is_this_repo(tmp_path):
    m = Mirror(tmp_path)
    done = m.run(DATA_RELEASE_REPO=HOME, DATA_RELEASE_TOKEN=None)
    assert done.returncode == 0 and "nothing to mirror" in done.stdout
    assert m.calls() == []


def test_the_mirror_stops_before_any_call_without_the_data_token(tmp_path):
    m = Mirror(tmp_path)
    done = m.run(DATA_RELEASE_TOKEN="")
    assert done.returncode != 0 and "DATA_RELEASE_TOKEN" in done.stderr
    assert m.calls() == []


def test_the_mirror_copies_every_file_in_order_reading_with_the_data_token_and_writing_with_the_builtin(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, PUBLISHED)
    done = m.run()
    assert done.returncode == 0, done.stderr
    assert m.files(HOME) == PUBLISHED
    calls = m.calls()
    uploads = [Path(c["args"][3]).name for c in calls if c["args"][:2] == ["release", "upload"]]
    assert uploads == list(FILES), "database, then snapshot, then verdict"
    for c in calls:
        reads_private = PRIVATE in " ".join(c["args"])
        assert c["token"] == ("data-token" if reads_private else "builtin"), c
        if reads_private:
            assert c["args"][0] == "api" or c["args"][:2] == ["release", "download"], "the data repo is only read"
    assert "data-token" not in done.stdout + done.stderr and "builtin" not in done.stdout + done.stderr


def test_the_mirror_repairs_a_stale_copy_on_a_later_run_and_leaves_current_files_alone(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, PUBLISHED)
    # an earlier mirror got the database across, then failed: this repo holds an old verdict, no snapshot
    m.release(HOME, {"macro_radar.db": PUBLISHED["macro_radar.db"], "validation.json": b'{"v": 1}',
                     "earnings-cache-ledger-000041.bin": b"sealed"})
    done = m.run()
    assert done.returncode == 0, done.stderr
    uploads = [Path(c["args"][3]).name for c in m.calls() if c["args"][:2] == ["release", "upload"]]
    assert uploads == ["snapshot-latest.json", "validation.json"]
    assert "macro_radar.db already current" in done.stdout
    assert m.files(HOME) == {**PUBLISHED, "earnings-cache-ledger-000041.bin": b"sealed"}, "the ledger is untouched"
    # and once current, a run uploads nothing (no new asset ids for readers to chase)
    before = len(m.calls())
    assert m.run().returncode == 0
    assert not [c for c in m.calls()[before:] if c["args"][:2] in (["release", "upload"], ["release", "download"])]


def test_a_file_missing_from_the_data_repo_is_skipped_and_one_without_a_digest_is_copied(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, {"macro_radar.db": b"database v3", "validation.json": b'{"v": 3}'})
    m.release(HOME, {"macro_radar.db": b"database v3", "validation.json": b'{"v": 2}'})
    m.flag(f"nodigest-{PRIVATE.replace('/', '__')}-validation.json")
    done = m.run()
    assert done.returncode == 0, done.stderr
    assert "snapshot-latest.json is not on the data repo; skipped" in done.stdout
    uploads = [Path(c["args"][3]).name for c in m.calls() if c["args"][:2] == ["release", "upload"]]
    assert uploads == ["validation.json"], "no digest to compare, so it is downloaded, hashed and copied"
    assert m.files(HOME)["validation.json"] == b'{"v": 3}'


def test_a_file_without_a_digest_whose_bytes_already_match_is_not_uploaded_again(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, {"macro_radar.db": b"database v3"})
    m.release(HOME, {"macro_radar.db": b"database v3"})
    m.flag(f"nodigest-{PRIVATE.replace('/', '__')}-macro_radar.db")  # an older asset on the data repo
    for _ in range(2):  # hourly runs: hashed after download, never re-uploaded
        done = m.run()
        assert done.returncode == 0, done.stderr
        assert "macro_radar.db already current" in done.stdout
    assert [c for c in m.calls() if c["args"][:2] == ["release", "upload"]] == []


def test_a_failure_other_than_404_listing_this_repo_stops_without_creating_anything(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, PUBLISHED)
    m.release(HOME, {"macro_radar.db": b"database v1"})
    m.flag(f"busy-{HOME.replace('/', '__')}")
    done = m.run()
    assert done.returncode != 0 and "could not list this repo's data-latest" in done.stderr and "HTTP 503" in done.stderr
    assert not [c for c in m.calls() if c["args"][0] == "release"]
    assert m.files(HOME) == {"macro_radar.db": b"database v1"}


def test_a_download_that_does_not_match_its_digest_is_never_uploaded(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, PUBLISHED)
    m.release(HOME, {"macro_radar.db": b"database v1"})
    m.flag("corrupt-macro_radar.db")
    done = m.run()
    assert done.returncode != 0 and "did not match its listed digest" in done.stderr
    assert m.files(HOME) == {"macro_radar.db": b"database v1"}, "nothing after it is uploaded either"


def test_the_mirror_fails_without_writing_when_the_data_repo_cannot_be_listed(tmp_path):
    m = Mirror(tmp_path)
    m.release(PRIVATE, PUBLISHED)
    m.release(HOME, {"macro_radar.db": b"database v1"})
    m.flag(f"deny-{PRIVATE.replace('/', '__')}")
    done = m.run()
    assert done.returncode != 0
    assert m.files(HOME) == {"macro_radar.db": b"database v1"}
    assert not [c for c in m.calls() if c["args"][0] == "release"]


# ── the earnings-cache probe's download (manual tool, src/events/earnings_cache.py) ──


class _Resp:
    def __init__(self, status: int, content: bytes = b"", doc: dict | None = None):
        self.status_code, self.content, self._doc = status, content, doc

    def json(self):
        return self._doc


def _probe_get(asked: list, repo: str = PRIVATE):
    api = f"https://api.github.com/repos/{repo}"

    def get(url, headers=None, timeout=None):
        asked.append((url, dict(headers or {})))
        if url == f"{api}/releases/tags/data-latest":
            return _Resp(200, doc={"assets": [{"name": "earnings-cache-ledger-000001.bin", "url": f"{api}/releases/assets/1"},
                                              {"name": "macro_radar.db", "url": f"{api}/releases/assets/2"}]})
        if url == f"{api}/releases/assets/2":
            return _Resp(200, content=b"private db")
        return _Resp(200, content=b"public db")

    return get


def test_the_probe_downloads_the_public_copy_when_the_setting_is_unset_or_this_repo(tmp_path):
    from src.events import earnings_cache as ec

    for env in ({}, {"DATA_RELEASE_REPO": " "}, {"DATA_RELEASE_REPO": HOME, "GH_DB_TOKEN": "t"}):
        asked: list = []
        dest = tmp_path / "probe.db"
        ec._download_public_db(dest, get=_probe_get(asked), env=env)
        assert [u for u, _ in asked] == [ec.PUBLIC_DB_URL] and dest.read_bytes() == b"public db"


def test_the_probe_reads_the_named_repo_through_the_api_with_the_token(tmp_path):
    from src.events import earnings_cache as ec

    asked: list = []
    dest = tmp_path / "probe.db"
    ec._download_public_db(dest, get=_probe_get(asked), env={"DATA_RELEASE_REPO": PRIVATE, "GH_DB_TOKEN": "t"})
    api = f"https://api.github.com/repos/{PRIVATE}"
    assert [u for u, _ in asked] == [f"{api}/releases/tags/data-latest", f"{api}/releases/assets/2"]
    assert all(h["Authorization"] == "Bearer t" for _, h in asked)
    assert asked[1][1]["Accept"] == "application/octet-stream"
    assert dest.read_bytes() == b"private db"


@pytest.mark.parametrize("env, why", [
    ({"DATA_RELEASE_REPO": PRIVATE}, "set GH_DB_TOKEN"),
    ({"DATA_RELEASE_REPO": "a/b/c", "GH_DB_TOKEN": "t"}, "not owner/name"),
])
def test_the_probe_refuses_without_a_token_or_with_a_malformed_setting_and_asks_nothing(tmp_path, env, why):
    from src.events import earnings_cache as ec

    asked: list = []
    with pytest.raises(RuntimeError, match=why):
        ec._download_public_db(tmp_path / "probe.db", get=_probe_get(asked), env=env)
    assert asked == [] and not (tmp_path / "probe.db").exists()
