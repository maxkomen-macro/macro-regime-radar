"""The weekly memo runs through the entrypoint its workflow names (fix/site-audit S-06).

weekly-memo.yml ran `python src/memo.py`, which puts src/ (not the repo root) on
sys.path, so the memo's `from src.utils.format import …` raised "No module named
'src'" and no weekly memo was built (failing since at least Sep 7). The workflow now
runs `python -m src.memo`. This test reads the command from the workflow file and
runs it, in a scratch copy of the repo's src/ and templates/ over a copy of the
store, so it generates a memo exactly the way CI does without writing to output/.
"""
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "weekly-memo.yml"
DB = ROOT / "data" / "macro_radar.db"


def _memo_command() -> str:
    jobs = yaml.safe_load(WORKFLOW.read_text())["jobs"]
    steps = [s for job in jobs.values() for s in job.get("steps", []) if s.get("name") == "Generate weekly memo"]
    assert len(steps) == 1, "weekly-memo.yml has one 'Generate weekly memo' step"
    return steps[0]["run"].strip()


def test_the_workflow_runs_the_memo_as_a_module():
    assert _memo_command() == "python -m src.memo"


@pytest.mark.skipif(not DB.exists(), reason="needs data/macro_radar.db")
def test_the_workflow_command_generates_a_memo(tmp_path):
    pytest.importorskip("matplotlib")
    pytest.importorskip("jinja2")
    shutil.copytree(ROOT / "src", tmp_path / "src", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "templates", tmp_path / "templates")
    (tmp_path / "data").mkdir()
    shutil.copy2(DB, tmp_path / "data" / "macro_radar.db")
    argv = shlex.split(_memo_command())
    assert argv[0] == "python"
    run = subprocess.run([sys.executable, *argv[1:]], cwd=tmp_path, capture_output=True, text=True, timeout=600)
    assert run.returncode == 0, run.stderr[-2000:]
    html = (tmp_path / "output" / "weekly_memo.html").read_text()
    assert "Weekly" in html and "%" in html
