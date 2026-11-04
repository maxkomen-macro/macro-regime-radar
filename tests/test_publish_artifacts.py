"""The workflows' Git writer must never undo a change merged while it ran.

2026-11-04 18:44 UTC: Refresh Data run 41889386889 checked out 6f126cb at 18:40,
#35 and #30 merged at 18:41 and 18:43, and its "Update playbook [skip ci]"
commit d9359019 (parent c7380ff) took main's tree back to 6f126cb plus the
playbook. The commit step fetched, ran `git reset --soft origin/main` and
committed: a soft reset keeps the runner's whole index from its checkout. The
same step undid desk/cap-weight on 2026-10-02 (4bb6c39).

These tests rebuild that race in real git repositories: a bare "origin", a
runner checkout taken before a code merge, the merge pushed from another clone,
then the workflow's own publish command run in the stale checkout. Each writer
(refresh-data, daily-memo, weekly-memo) is exercised with the exact command its
workflow runs, read from the YAML. The old command is run on the same race to
show the scenario reproduces the incident.
"""

from __future__ import annotations

import os
import shlex
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"
SCRIPT = ROOT / "scripts" / "publish_artifacts.sh"
REAL_GIT = shutil.which("git")

pytestmark = pytest.mark.skipif(REAL_GIT is None or shutil.which("bash") is None, reason="needs git and bash")

# (workflow, step name, the artifact it publishes, its commit message)
WRITERS = [
    ("refresh-data.yml", "Commit playbook.json if it changed", "output/playbook.json", "Update playbook [skip ci]"),
    ("daily-memo.yml", "Commit and push updated memo to GitHub Pages", "docs/memo/daily_memo.html", "Update daily memo [skip ci]"),
    ("weekly-memo.yml", "Commit and push updated memo to GitHub Pages", "docs/memo/weekly_memo.html", "Update weekly memo [skip ci]"),
]

# The commit step as it ran in refresh-data.yml at d9359019 (the incident).
OLD_REFRESH_STEP = """
if git diff --quiet output/playbook.json 2>/dev/null; then
  echo "playbook.json unchanged — nothing to commit"
else
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git add output/playbook.json
  git commit -m "Update playbook [skip ci]"
  COMMIT_MSG=$(git log -1 --pretty=%B)
  for i in 1 2 3 4 5; do
    if git fetch origin main \\
       && git reset --soft origin/main \\
       && git commit -m "$COMMIT_MSG" \\
       && git push; then
      echo "Push succeeded on attempt $i"
      exit 0
    fi
    sleep 0
  done
  exit 1
fi
"""


# --------------------------------------------------------------------------- helpers

def _env(tmp: Path, extra: dict | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    home = tmp / "home"
    home.mkdir(exist_ok=True)
    env.update(
        HOME=str(home),
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=str(home / ".gitconfig"),
        GIT_TERMINAL_PROMPT="0",
        TMPDIR=str(tmp),
        PUBLISH_ARTIFACTS_NO_BACKOFF="1",
    )
    env.pop("RUNNER_TEMP", None)
    if extra:
        env.update(extra)
    return env


def _git(cwd: Path, *args: str, env: dict) -> str:
    out = subprocess.run([REAL_GIT, *args], cwd=cwd, env=env, check=True, capture_output=True, text=True)
    return out.stdout.strip()


def _write(repo: Path, rel: str, text: str) -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def _identity(repo: Path, env: dict, name: str = "github-actions[bot]") -> None:
    _git(repo, "config", "user.name", name, env=env)
    _git(repo, "config", "user.email", f"{name}@users.noreply.github.com".replace("[bot]", "-bot"), env=env)


class Race:
    """origin (bare), a dev clone that merges code, and a runner checkout."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.env = _env(tmp)
        self.origin = tmp / "origin.git"
        self.dev = tmp / "dev"
        self.runner = tmp / "runner"
        _git(tmp, "init", "--quiet", "--bare", "--initial-branch=main", str(self.origin), env=self.env)
        _git(tmp, "clone", "--quiet", str(self.origin), str(self.dev), env=self.env)
        _identity(self.dev, self.env, "Max")
        _write(self.dev, "src/model.py", "VERSION = 1\n")
        _write(self.dev, "src/old_module.py", "OLD = True\n")
        _write(self.dev, "tests/test_model.py", "def test_v():\n    assert True\n")
        for _, _, path, _ in WRITERS:
            _write(self.dev, path, f"original {path}\n")
        scripts = self.dev / "scripts"
        scripts.mkdir()
        shutil.copy2(SCRIPT, scripts / "publish_artifacts.sh")
        _git(self.dev, "add", "-A", env=self.env)
        _git(self.dev, "commit", "--quiet", "-m", "initial", env=self.env)
        _git(self.dev, "push", "--quiet", "origin", "main", env=self.env)

    def checkout_runner(self) -> None:
        """actions/checkout with fetch-depth 0: a full clone of main as it is now."""
        _git(self.tmp, "clone", "--quiet", str(self.origin), str(self.runner), env=self.env)

    def merge_code(self, tag: str) -> str:
        """A reviewed PR merged to main with a merge commit, from another clone."""
        _git(self.dev, "pull", "--quiet", "--ff-only", "origin", "main", env=self.env)
        _git(self.dev, "checkout", "--quiet", "-b", f"pr-{tag}", env=self.env)
        _write(self.dev, "src/model.py", f"VERSION = '{tag}'\n")
        _write(self.dev, f"src/new_{tag}.py", f"NEW = '{tag}'\n")
        if (self.dev / "src/old_module.py").exists():
            _git(self.dev, "rm", "--quiet", "src/old_module.py", env=self.env)
        _git(self.dev, "add", "-A", env=self.env)
        _git(self.dev, "commit", "--quiet", "-m", f"PR {tag}", env=self.env)
        _git(self.dev, "checkout", "--quiet", "main", env=self.env)
        _git(self.dev, "merge", "--quiet", "--no-ff", "-m", f"Merge pull request {tag}", f"pr-{tag}", env=self.env)
        _git(self.dev, "push", "--quiet", "origin", "main", env=self.env)
        return _git(self.dev, "rev-parse", "HEAD", env=self.env)

    def tip(self) -> str:
        return _git(self.origin, "rev-parse", "refs/heads/main", env=self.env)

    def show(self, rev: str, path: str) -> str:
        return _git(self.origin, "show", f"{rev}:{path}", env=self.env)

    def changed(self, a: str, b: str) -> list[str]:
        return _git(self.origin, "diff", "--name-only", "--no-renames", a, b, env=self.env).splitlines()

    def parents(self, rev: str) -> list[str]:
        return _git(self.origin, "rev-list", "--parents", "-n", "1", rev, env=self.env).split()[1:]

    def run(self, script: str, env: dict | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", "-e", "-c", script], cwd=self.runner, env=env or self.env,
                              capture_output=True, text=True)


def _step(workflow: str, step_name: str) -> dict:
    doc = yaml.safe_load((WF / workflow).read_text())
    jobs = doc["jobs"]
    for job in jobs.values():
        for s in job["steps"]:
            if s.get("name") == step_name:
                return s
    raise AssertionError(f"{workflow}: no step named {step_name!r}")


def _workflow_publish_args(workflow: str, step_name: str) -> list[str]:
    """The arguments the workflow passes to publish_artifacts.sh, parsed from its YAML."""
    run = _step(workflow, step_name)["run"]
    lines = [ln.strip() for ln in run.splitlines() if "publish_artifacts.sh" in ln and not ln.strip().startswith("#")]
    assert len(lines) == 1, f"{workflow}: expected one publish_artifacts.sh call, found {lines}"
    words = shlex.split(lines[0])
    i = next(k for k, w in enumerate(words) if w.endswith("scripts/publish_artifacts.sh"))
    return words[i + 1:]


def _publish_cmd(args: list[str]) -> str:
    return (
        'git config user.name "github-actions[bot]"\n'
        'git config user.email "github-actions[bot]@users.noreply.github.com"\n'
        "bash scripts/publish_artifacts.sh " + " ".join(shlex.quote(a) for a in args)
    )


# --------------------------------------------------------------------------- the race, per writer

@pytest.mark.parametrize("workflow,step_name,artifact,message", WRITERS, ids=[w[0] for w in WRITERS])
def test_a_code_merge_during_the_run_survives_the_bot_commit(tmp_path, workflow, step_name, artifact, message):
    args = _workflow_publish_args(workflow, step_name)
    assert args == [message, artifact], f"{workflow} must publish exactly its own artifact"

    race = Race(tmp_path)
    race.checkout_runner()                       # 1. the run checks out main
    merge = race.merge_code("pr35")              # 2. a code PR merges while it runs
    _write(race.runner, artifact, f"generated {artifact}\n")   # 3. the run generates its file
    res = race.run(_publish_cmd(args))           # 4. and publishes it
    assert res.returncode == 0, res.stdout + res.stderr

    tip = race.tip()
    assert race.parents(tip) == [merge], "the bot commit sits directly on the merge"
    assert race.changed(merge, tip) == [artifact], "the bot commit changes only its artifact"
    assert race.show(tip, artifact) == f"generated {artifact}"
    # the merged code is all still there: an edit, an added file and a deletion
    assert race.show(tip, "src/model.py") == "VERSION = 'pr35'"
    assert race.show(tip, "src/new_pr35.py") == "NEW = 'pr35'"
    assert "src/old_module.py" not in _git(race.origin, "ls-tree", "-r", "--name-only", tip, env=race.env).splitlines()
    assert _git(race.origin, "log", "-1", "--format=%s", tip, env=race.env) == message


def test_the_old_soft_reset_step_reverts_the_merge(tmp_path):
    """The scenario reproduces the incident: the step as it ran at d9359019 undoes the merge."""
    race = Race(tmp_path)
    race.checkout_runner()
    merge = race.merge_code("pr35")
    _write(race.runner, "output/playbook.json", "generated output/playbook.json\n")
    res = race.run(OLD_REFRESH_STEP)
    assert res.returncode == 0, res.stdout + res.stderr
    tip = race.tip()
    assert race.parents(tip) == [merge]
    reverted = set(race.changed(merge, tip))
    assert {"src/model.py", "src/new_pr35.py", "src/old_module.py"} <= reverted
    assert race.show(tip, "src/model.py") == "VERSION = 1"


def test_two_merges_and_a_second_bot_commit(tmp_path):
    """Merges on both sides of an earlier bot commit, and the runner never refreshed: all survive."""
    race = Race(tmp_path)
    race.checkout_runner()
    m1 = race.merge_code("a")
    _write(race.runner, "output/playbook.json", "one\n")
    assert race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"])).returncode == 0
    race.merge_code("b")
    _write(race.runner, "docs/memo/daily_memo.html", "memo\n")
    res = race.run(_publish_cmd(["Update daily memo [skip ci]", "docs/memo/daily_memo.html"]))
    assert res.returncode == 0, res.stderr
    tip = race.tip()
    assert race.changed(race.parents(tip)[0], tip) == ["docs/memo/daily_memo.html"]
    assert race.show(tip, "src/new_a.py") == "NEW = 'a'"
    assert race.show(tip, "src/new_b.py") == "NEW = 'b'"
    assert race.show(tip, "output/playbook.json") == "one"
    assert m1 in _git(race.origin, "rev-list", tip, env=race.env).split()


def _shim_git(tmp: Path, on_first_push: str) -> dict:
    """A `git` on PATH that runs `on_first_push` just before the first push, then defers to git."""
    bindir = tmp / "shim"
    bindir.mkdir()
    marker = tmp / "pushed-once"
    shim = bindir / "git"
    shim.write_text(
        "#!/usr/bin/env bash\n"
        f'if [ "$1" = push ] && [ ! -e {shlex.quote(str(marker))} ]; then\n'
        f"  touch {shlex.quote(str(marker))}\n"
        f"  {on_first_push}\n"
        "fi\n"
        f'exec {shlex.quote(REAL_GIT)} "$@"\n'
    )
    shim.chmod(shim.stat().st_mode | stat.S_IEXEC)
    return {"PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}"}


def test_main_moving_between_fetch_and_push_rebuilds_on_the_newer_main(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    m1 = race.merge_code("first")
    _write(race.runner, "output/playbook.json", "generated\n")

    # a second merge lands after the script fetched and built, just before it pushes
    helper = tmp_path / "merge_second.sh"
    helper.write_text(
        "set -e\n"
        f"cd {shlex.quote(str(race.dev))}\n"
        f"G={shlex.quote(REAL_GIT)}\n"
        "$G pull --quiet --ff-only origin main\n"
        "echo \"VERSION = 'second'\" > src/model.py\n"
        "echo \"NEW = 'second'\" > src/new_second.py\n"
        "$G add -A && $G commit --quiet -m 'PR second' && $G push --quiet origin main\n"
    )
    env = _env(tmp_path, _shim_git(tmp_path, f"bash {shlex.quote(str(helper))} >/dev/null 2>&1"))
    res = race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"]), env=env)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "Push succeeded on attempt 2" in res.stdout, res.stdout

    tip = race.tip()
    second = race.parents(tip)
    assert len(second) == 1 and second[0] != m1
    assert _git(race.origin, "log", "-1", "--format=%s", second[0], env=race.env) == "PR second"
    assert race.changed(second[0], tip) == ["output/playbook.json"]
    assert race.show(tip, "src/model.py") == "VERSION = 'second'"
    assert race.show(tip, "src/new_first.py") == "NEW = 'first'"
    assert race.show(tip, "src/new_second.py") == "NEW = 'second'"


def test_the_runners_own_index_and_other_edits_are_never_published(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    merge = race.merge_code("pr")
    env = race.env
    # the run has dirtied its checkout: a staged edit, an unstaged edit, a new file
    _write(race.runner, "src/model.py", "VERSION = 'runner scratch'\n")
    _git(race.runner, "add", "src/model.py", env=env)
    _write(race.runner, "tests/test_model.py", "broken\n")
    _write(race.runner, "output/other.json", "{}\n")
    _write(race.runner, "output/playbook.json", "generated\n")
    res = race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"]))
    assert res.returncode == 0, res.stderr
    tip = race.tip()
    assert race.changed(merge, tip) == ["output/playbook.json"]
    assert race.show(tip, "src/model.py") == "VERSION = 'pr'"
    # the runner's checkout is left as it was
    assert (race.runner / "src/model.py").read_text() == "VERSION = 'runner scratch'\n"
    assert not list(tmp_path.glob("publish-*")), "temporary worktrees and snapshots are removed"


def test_an_artifact_already_on_main_makes_no_commit(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    merge = race.merge_code("pr")
    _write(race.runner, "output/playbook.json", "original output/playbook.json\n")
    res = race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"]))
    assert res.returncode == 0, res.stderr
    assert "Nothing to publish" in res.stdout
    assert race.tip() == merge


@pytest.mark.parametrize("bad", [
    ["src/model.py"],
    ["data/macro_radar.db"],
    ["output/../src/model.py"],
    ["./output/playbook.json"],
    ["output/playbook.json", "output/playbook.json"],
    ["output/playbook.json", "src/model.py"],
])
def test_only_allowed_generated_files_can_be_published(tmp_path, bad):
    race = Race(tmp_path)
    race.checkout_runner()
    before = race.tip()
    _write(race.runner, "output/playbook.json", "generated\n")
    _write(race.runner, "data/macro_radar.db", "db\n")
    res = race.run(_publish_cmd(["Update playbook [skip ci]", *bad]))
    assert res.returncode == 2, res.stdout + res.stderr
    assert race.tip() == before


def test_a_missing_artifact_is_an_error_not_a_deletion(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    before = race.tip()
    (race.runner / "output/playbook.json").unlink()
    res = race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"]))
    assert res.returncode == 2
    assert race.tip() == before


def test_a_push_that_keeps_failing_stops_after_five_attempts(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    before = race.tip()
    hook = race.origin / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\necho rejected >&2\nexit 1\n")
    hook.chmod(0o755)
    _write(race.runner, "output/playbook.json", "generated\n")
    res = race.run(_publish_cmd(["Update playbook [skip ci]", "output/playbook.json"]))
    assert res.returncode == 1
    assert res.stdout.count("retrying") == 5 and "Push failed after 5 attempts" in res.stdout
    assert race.tip() == before
    assert _git(race.runner, "worktree", "list", "--porcelain", env=race.env).count("worktree ") == 1


# --------------------------------------------------------------------------- the workflows use it

def test_every_git_writer_uses_the_fresh_checkout_publisher():
    for workflow, step_name, artifact, message in WRITERS:
        step = _step(workflow, step_name)
        run = step["run"]
        assert "bash scripts/publish_artifacts.sh" in run, workflow
        for banned in ("reset --soft", "git commit", "git push", "git add", "git stash", "pull --rebase", "rebase"):
            assert banned not in run, f"{workflow}: {banned!r} in the commit step"
        assert _workflow_publish_args(workflow, step_name) == [message, artifact]
    # no other workflow step writes to git, and nothing turns the backoff off
    for path in sorted(WF.glob("*.yml")):
        text = path.read_text()
        for banned in ("reset --soft", "git push", "git commit", "PUBLISH_ARTIFACTS_NO_BACKOFF"):
            assert banned not in text, f"{path.name}: {banned!r}"


def test_the_publisher_keeps_bounded_retries_and_backoff():
    text = SCRIPT.read_text()
    code = text.split("set -uo pipefail", 1)[1]   # the header comment describes the old step
    assert "ATTEMPTS=5" in code
    assert "sleep $((RANDOM % 10 + 5))" in code
    assert "--force" not in code.replace("worktree remove --force", "")
    for banned in ("reset --soft", "git stash", "rebase", "git add -A", "git add ."):
        assert banned not in code, banned
    allowed = code.split("ALLOWED=(")[1].split(")")[0].split()
    assert sorted(a.strip('"') for a in allowed) == sorted(w[2] for w in WRITERS)
