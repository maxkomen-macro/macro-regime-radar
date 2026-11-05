"""Private storage (Change 1, 2026-11-05): one setting, DATA_RELEASE_REPO, names
the repo whose data-latest release holds the database, validation.json and
snapshot-latest.json. Unset, every reader and writer behaves exactly as before
(this repo). The sealed earnings ledger stays on this repo's release whatever
the setting says. GitHub is an httpx MockTransport; the database is a scratch
file; the workflow checks read the YAML and run the token switch in bash."""

from __future__ import annotations

import ast
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
    """One repo's data-latest release holding one database asset; records every URL asked for."""

    def __init__(self, repo: str, payload: bytes):
        self.api = f"https://api.github.com/repos/{repo}"
        self.payload = payload
        self.urls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.urls.append(url)
        if url == f"{self.api}/releases/tags/data-latest":
            return httpx.Response(200, json={"assets": [{
                "id": 7, "name": "macro_radar.db", "updated_at": "2026-11-05T07:19:20Z",
                "size": len(self.payload), "url": f"{self.api}/releases/assets/7"}]})
        if url == f"{self.api}/releases/assets/7":
            return httpx.Response(200, content=self.payload)
        return httpx.Response(404)


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    target = tmp_path / "served" / "macro_radar.db"
    monkeypatch.setattr(db, "DB_PATH", target)
    monkeypatch.setenv("GH_DB_TOKEN", "test-token-not-real")
    monkeypatch.setattr(bootstrap, "_poke_worker", lambda: None)
    db.reset_connections_for_tests()
    yield target
    db.reset_connections_for_tests()


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
    assert bootstrap.status()["last_result"] == "downloaded"


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


def test_the_vercel_snapshot_fetch_already_takes_its_repo_from_the_environment():
    src = (ROOT / "web" / "scripts" / "fetch-snapshot.mjs").read_text()
    assert 'const REPO = process.env.SNAPSHOT_REPO ?? "maxkomen-macro/macro-regime-radar";' in src


# ── the four writers ─────────────────────────────────────────────────────────

DEFAULT_EXPR = "${{ vars.DATA_RELEASE_REPO || github.repository }}"
SWITCH = ('[ "$DATA_RELEASE_REPO" = "$GITHUB_REPOSITORY" ] || export GH_TOKEN="${DATA_RELEASE_TOKEN:?DATA_RELEASE_REPO '
          'names another repo but the DATA_RELEASE_TOKEN secret is not set}"')
MIRROR = "Mirror the published files to this repo's data-latest (cutover only)"


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
        if "earnings" in step["name"].lower():
            # the sealed ledger stays on this repo: no setting, no other token
            assert "DATA_RELEASE" not in run and step["env"] == {"GH_TOKEN": "${{ secrets.GITHUB_TOKEN }}"}, step["name"]
            continue
        if step["name"] == MIRROR:
            assert all('--repo "$GITHUB_REPOSITORY"' in ln for ln in lines), lines
            assert step["env"] == {"GH_TOKEN": "${{ secrets.GITHUB_TOKEN }}"}
            continue
        seen += 1
        assert all('--repo "$DATA_RELEASE_REPO"' in ln for ln in lines), (step["name"], lines)
        assert step["env"]["GH_TOKEN"] == "${{ secrets.GITHUB_TOKEN }}", step["name"]
        assert step["env"]["DATA_RELEASE_TOKEN"] == "${{ secrets.DATA_RELEASE_TOKEN }}", step["name"]
        assert SWITCH in run, step["name"]
        assert run.index(SWITCH) < min(run.index(ln) for ln in lines), f"{step['name']}: the token is chosen before any gh call"
        assert "secrets." not in run, step["name"]
    assert seen >= 1, name


@pytest.mark.parametrize("name, cond", [
    ("refresh-data.yml", "steps.mode.outputs.mode != 'verify-only' && steps.validate.outputs.upload == 'true'"),
    ("intraday-refresh.yml", "steps.validate.outputs.upload == 'true'"),
])
def test_the_cutover_mirror_follows_both_publishes_in_the_same_order_and_never_blocks(name, cond):
    steps = _steps(name)
    names = [s.get("name", "") for s in steps]
    m = names.index(MIRROR)
    assert names[m - 1] == "Publish the validation verdict", names
    step = steps[m]
    assert step["if"] == f"{cond} && vars.DATA_RELEASE_MIRROR == 'true' && env.DATA_RELEASE_REPO != github.repository"
    assert step["continue-on-error"] is True and int(step["timeout-minutes"]) == 5
    run = step["run"]
    order = [run.index(f) for f in ("data/macro_radar.db --clobber", "snapshot-latest.json --clobber", "publish/validation.json --clobber")]
    assert order == sorted(order), "database, then snapshot, then verdict, as on the primary"


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
