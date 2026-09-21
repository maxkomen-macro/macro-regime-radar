"""GitHub Actions contract (2026-09-06): the four workflows parse, the refresh
modes are explicit and resolved by one testable function, an hourly run can
never masquerade as a full refresh, validation gates every upload, the
data-write concurrency group and the retry/soft-reset commit pattern are
intact, memos depend on a validated full refresh, and the lean dependency
sets cover their modules' imports."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"

import sys  # noqa: E402

sys.path.insert(0, str(ROOT))
from scripts.workflow_mode import MODES, SCHEDULE_MODES, resolve  # noqa: E402


def _load(name: str) -> dict:
    return yaml.safe_load((WF / name).read_text())


def _on(doc: dict) -> dict:
    # PyYAML parses the bare key `on` as boolean True.
    return doc.get("on") or doc.get(True)


@pytest.mark.parametrize("name", ["refresh-data.yml", "intraday-refresh.yml", "daily-memo.yml", "weekly-memo.yml"])
def test_workflows_parse(name):
    assert isinstance(_load(name), dict)


def test_refresh_dispatch_modes_and_schedules_are_explicit():
    doc = _load("refresh-data.yml")
    on = _on(doc)
    opts = on["workflow_dispatch"]["inputs"]["mode"]["options"]
    assert opts == list(MODES)
    crons = [s["cron"] for s in on["schedule"]]
    assert set(crons) == set(SCHEDULE_MODES)
    # No schedule fires at the top of the hour.
    assert all(not c.startswith("0 ") for c in crons)


@pytest.mark.parametrize(
    "event, schedule, inp, expected",
    [
        ("schedule", "17 11 * * *", "", "full"),
        ("schedule", "23 0 * * 2-6", "", "full"),
        ("schedule", "41 * * * *", "", "news-only"),
        ("schedule", "0 * * * *", "", "verify-only"),  # an unknown cron never becomes a full refresh
        ("workflow_dispatch", "", "market-only", "market-only"),
        ("workflow_dispatch", "", "verify-only", "verify-only"),
        ("workflow_dispatch", "", "bogus", "full"),
        ("push", "", "", "verify-only"),
    ],
)
def test_mode_resolution(event, schedule, inp, expected):
    assert resolve(event, schedule, inp) == expected


def test_hourly_news_cannot_run_heavy_steps():
    doc = _load("refresh-data.yml")
    steps = doc["jobs"]["refresh"]["steps"]
    by_name = {s["name"]: s for s in steps}
    heavy = ["Run FRED pipeline (fetch + regimes + signals)", "Compute backtest results", "Generate regime playbook", "Reload event calendar (idempotent)"]
    for n in heavy:
        assert by_name[n]["if"] == "steps.mode.outputs.mode == 'full'", n
    news = by_name["Refresh news feed"]
    assert "news-only" in news["if"] and "full" in news["if"]
    assert "market-only" not in news["if"]


def test_validation_gates_every_upload():
    for name in ("refresh-data.yml", "intraday-refresh.yml"):
        doc = _load(name)
        job = next(iter(doc["jobs"].values()))
        steps = job["steps"]
        names = [s["name"] for s in steps]
        v = names.index("Validate the refreshed database")
        u = next(i for i, n in enumerate(names) if n.startswith("Publish"))
        assert v < u, name
        publish = steps[u]
        assert "steps.validate.outputs.upload == 'true'" in publish["if"], name
        assert "--clobber" in publish["run"] and "gh release upload data-latest data/macro_radar.db" in publish["run"]
        # the previous asset is kept for comparison, so a regression is detectable
        fetch = next(s for s in steps if s["name"].startswith("Fetch current DB snapshot"))
        assert "cp data/macro_radar.db data/previous.db" in fetch["run"]


def test_concurrency_and_commit_pattern_preserved():
    for name in ("refresh-data.yml", "intraday-refresh.yml"):
        doc = _load(name)
        assert doc["concurrency"] == {"group": "data-write", "cancel-in-progress": False}, name
    for name in ("refresh-data.yml", "daily-memo.yml", "weekly-memo.yml"):
        text = (WF / name).read_text()
        assert "git stash" not in text and "pull --rebase" not in text, name
        assert "git reset --soft origin/main" in text, name
        assert "for i in 1 2 3 4 5" in text, name
    assert "data/macro_radar.db merge=ours" in (ROOT / ".gitattributes").read_text()


def test_db_never_committed():
    for name in ("refresh-data.yml", "intraday-refresh.yml", "daily-memo.yml", "weekly-memo.yml"):
        text = (WF / name).read_text()
        assert "git add data/macro_radar.db" not in text, name
    assert re.search(r"^data/macro_radar\.db$", (ROOT / ".gitignore").read_text(), re.M)


def test_memos_depend_on_validated_full_refresh():
    # The refresh workflow dispatches the memos only after a validated morning full run…
    steps = {s["name"]: s for s in _load("refresh-data.yml")["jobs"]["refresh"]["steps"]}
    disp = steps["Dispatch the memo workflows (validated morning full refresh only)"]
    assert "== 'full'" in disp["if"] and "verdict == 'pass'" in disp["if"] and "slot == 'morning'" in disp["if"]
    assert "gh workflow run daily-memo.yml -f run_id=" in disp["run"] and "gh workflow run weekly-memo.yml -f run_id=" in disp["run"]
    assert _load("refresh-data.yml")["permissions"]["actions"] == "write"
    art = steps["Upload the validated snapshot as a run artifact"]
    assert art["with"]["name"] == "validated-db" and "verdict == 'pass'" in art["if"] and "== 'full'" in art["if"]
    names = [s["name"] for s in _load("refresh-data.yml")["jobs"]["refresh"]["steps"]]
    assert names.index("Upload the validated snapshot as a run artifact") < names.index("Dispatch the memo workflows (validated morning full refresh only)")
    # …and each memo workflow consumes that run's validated artifact, refusing anything else.
    for name in ("daily-memo.yml", "weekly-memo.yml"):
        doc = _load(name)
        on = _on(doc)
        assert set(on) == {"workflow_dispatch"} and "run_id" in on["workflow_dispatch"]["inputs"]
        job = next(iter(doc["jobs"].values()))
        steps = {s["name"]: s for s in job["steps"]}
        dl = steps["Download the validated snapshot from the dispatching run"]
        assert dl["with"]["name"] == "validated-db" and "inputs.run_id" in dl["with"]["run-id"]
        gate = steps["Decide whether this run produces a memo"]["run"]
        assert 'MODE" = "full"' in gate and "refresh-meta.txt" in gate and "unvalidated" in gate
        for s in job["steps"]:
            if s["name"] in ("Generate daily memo", "Generate weekly memo", "Send memo email"):
                assert s["if"] == "steps.gate.outputs.go == 'true'", (name, s["name"])


def test_no_secret_is_echoed_to_logs():
    for name in ("refresh-data.yml", "intraday-refresh.yml", "daily-memo.yml", "weekly-memo.yml"):
        doc = _load(name)
        for job in doc["jobs"].values():
            for step in job["steps"]:
                run = step.get("run") or ""
                if "secrets." not in run:
                    continue
                # A secret may be written to .env (removed before publish); it
                # is never echoed to stdout or to the step summary.
                assert "> .env" in run or ">> .env" in run, (name, step["name"])
                assert "GITHUB_STEP_SUMMARY" not in run, (name, step["name"])
            # A job that writes .env removes it (with if: always()) before the end.
            writes = [s for s in job["steps"] if "> .env" in (s.get("run") or "")]
            if writes:
                cleanup = [s for s in job["steps"] if "rm -f .env" in (s.get("run") or "")]
                assert cleanup and all(c.get("if") == "always()" for c in cleanup), name
    assert "EODHD_API_TOKEN" not in (WF / "refresh-data.yml").read_text()


def _module_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            out.add(node.module.split(".")[0])
    return out


STDLIB = set(sys.stdlib_module_names)
DIST_TO_MODULE = {"python-dotenv": "dotenv", "pyyaml": "yaml", "scikit-learn": "sklearn", "feedparser": "feedparser", "requests": "requests", "pandas": "pandas", "numpy": "numpy", "yfinance": "yfinance"}


def _requirement_modules(req: Path) -> set[str]:
    mods = set()
    for line in req.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        dist = re.split(r"[<>=!\[]", line, maxsplit=1)[0].strip().lower()
        mods.add(DIST_TO_MODULE.get(dist, dist.replace("-", "_")))
    return mods


def test_lean_requirement_sets_cover_their_modules():
    news_mods = _module_imports(ROOT / "src/analytics/news.py") | _module_imports(ROOT / "src/analytics/perplexity.py") | _module_imports(ROOT / "src/db_helpers.py")
    # B4: the AI spend ledger and the monthly cap run on the lean news set too
    news_mods |= _module_imports(ROOT / "src/analytics/ai_spend.py")
    third_party = {m for m in news_mods if m not in STDLIB and m != "src"}
    assert third_party <= _requirement_modules(ROOT / "requirements-news.txt") | {"feedparser"}, third_party
    market_mods = _module_imports(ROOT / "src/market_data/fetch_market.py") | _module_imports(ROOT / "src/market_data/yfinance_client.py")
    # B6: the session rule and the watermark writer run on the lean market set too
    market_mods |= _module_imports(ROOT / "src/market_data/session.py") | _module_imports(ROOT / "src/watermarks.py")
    third_party = {m for m in market_mods if m not in STDLIB and m != "src"}
    assert third_party <= _requirement_modules(ROOT / "requirements-market.txt"), third_party
    # validate_db.py must stay stdlib + api/ (it runs on the lean sets)
    v = {m for m in _module_imports(ROOT / "scripts/validate_db.py") if m not in STDLIB}
    assert v <= {"api"}, v
    for mod in ("api/freshness.py", "api/calendar.py"):
        deps = {m for m in _module_imports(ROOT / mod) if m not in STDLIB}
        assert deps <= {"api"}, (mod, deps)


def test_earnings_calendar_loads_after_the_calendar_reload_in_full_mode_only():
    """B5 (2026-09-19): large-cap earnings dates load right after the
    hand-maintained calendar (so a manual row is in place to win), in full
    mode only, with the Finnhub key from secrets. The module prints one
    summary line and exits 0 on a missing key or a Finnhub error, so the step
    cannot fail the refresh; full mode installs requirements.txt, which covers
    its imports."""
    steps = _load("refresh-data.yml")["jobs"]["refresh"]["steps"]
    names = [s["name"] for s in steps]
    step = steps[names.index("Reload event calendar (idempotent)") + 1]
    assert step["name"] == "Load earnings calendar"
    assert step["if"] == "steps.mode.outputs.mode == 'full'"
    assert step["env"] == {"FINNHUB_API_KEY": "${{ secrets.FINNHUB_API_KEY }}"}
    assert step["run"].strip() == "python -m src.events.earnings"
    assert names.index("Load earnings calendar") < names.index("Validate the refreshed database")
    third_party = {m for m in _module_imports(ROOT / "src/events/earnings.py") if m not in STDLIB and m != "src"}
    assert third_party <= _requirement_modules(ROOT / "requirements.txt"), third_party


def test_intraday_validates_its_own_feeds():
    """B6 (2026-09-18): intraday runs validate with --mode intraday, which judges
    market_intraday and treats a stale daily close as a warning, so one missed
    post-close run cannot freeze intraday publishing."""
    doc = _load("intraday-refresh.yml")
    job = next(iter(doc["jobs"].values()))
    step = next(s for s in job["steps"] if s["name"] == "Validate the refreshed database")
    assert "--mode intraday " in step["run"] and "--mode market-only" not in step["run"]


def test_the_stored_histories_step_runs_on_the_full_mode_install():
    """fix/prelaunch-1: `python -m src.market_data.asset_history` runs in full
    mode, which installs requirements.txt and requirements-snapshot.txt only,
    and it reaches the API's provider layer (EODHD first, Yahoo the disclosed
    fallback). Every third-party module that path imports must be installed
    there, or the morning run fails at import."""
    files = ["src/market_data/asset_history.py", "src/watermarks.py", "api/calendar.py"]
    files += [str(p.relative_to(ROOT)) for p in sorted((ROOT / "api/providers").glob("*.py"))]
    mods: set[str] = set()
    for f in files:
        mods |= _module_imports(ROOT / f)
    third_party = {m for m in mods if m not in STDLIB and m not in {"src", "api"}}
    full = _requirement_modules(ROOT / "requirements.txt") | _requirement_modules(ROOT / "requirements-snapshot.txt")
    assert third_party <= full, third_party - full
    wf = (WF / "refresh-data.yml").read_text()
    assert "python -m src.market_data.asset_history" in wf
    assert "pip install -r requirements.txt -r requirements-snapshot.txt" in wf
