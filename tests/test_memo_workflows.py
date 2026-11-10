"""CS-2: the memo workflows' shape (design .loop/design-CS2.md v16, sections 2-7).

Permissions, concurrency, inputs, the queued steps in order with their gates and
deadlines, the provider keys (paid commentary only after a reservation, none in the
weekly memo), the sender, and the outcome artifact. The refresh side is pinned in
tests/test_close_sentinel.py (MEMO_HANDOFF_CS2)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows"
GO = "steps.plan.outputs.go == 'true'"
AFTER_SEND = "always() && steps.plan.outputs.go == 'true' && steps.send.outcome != 'skipped'"


def _doc(name: str) -> dict:
    return yaml.safe_load((WF / name).read_text())


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


def _steps(name: str) -> list[dict]:
    return _doc(name)["jobs"]["email-memo"]["steps"]


QUEUED = {
    "daily-memo.yml": [
        ("Plan the memo", 20), ("Download the source snapshot", 10), ("Check the source snapshot", 10),
        ("Pin the private copy to the session", 10), ("Reserve the paid commentary", 15),
        ("Generate daily memo", 20), ("Publish the memo page and mark it sending", 15), ("Finalize the message", 5),
        ("Send memo email", 5), ("Write the memo outcome", None), ("Upload the memo outcome", None),
        ("Record the memo outcome", 20), ("Chain the next queued session", 2), ("Fail on a session that will not be sent", None),
    ],
    "weekly-memo.yml": [
        ("Plan the memo", 20), ("Download the source snapshot", 10), ("Check the source snapshot", 10),
        ("Write .env for scripts that use load_dotenv()", None),
        ("Pin the private copy and recompute its analytics", 20), ("Generate weekly memo", 20),
        ("Publish the memo page and mark it sending", 15), ("Finalize the message", 5), ("Send memo email", 5),
        ("Write the memo outcome", None), ("Upload the memo outcome", None), ("Record the memo outcome", 20),
        ("Chain the next queued week", 2), ("Fail on a week that will not be sent", None),
    ],
}


@pytest.mark.parametrize("name", list(QUEUED))
def test_the_queue_shape(name):
    doc = _doc(name)
    kind = name.split("-")[0]
    assert doc["permissions"] == {"contents": "write", "actions": "write"}
    assert doc["concurrency"] == {
        "group": "${{ (inputs.wake != '' || inputs.run_id != '' || inputs.resend_key != '') && "
                 f"'{kind}-memo-queue' || format('{kind}-memo-manual-{{0}}', github.run_id) }}}}",
        "cancel-in-progress": False}
    on = _on(doc)
    assert set(on) == {"workflow_dispatch"}                      # no cron: refresh-data wakes the queue
    assert {k: v["default"] for k, v in on["workflow_dispatch"]["inputs"].items()} == {"wake": "", "run_id": "", "resend_key": ""}
    job = doc["jobs"]["email-memo"]
    assert job["timeout-minutes"] == 110
    assert job["env"]["MEMO_MODE"] == ("${{ inputs.resend_key != '' && 'resend' || ((inputs.wake != '' || "
                                       "inputs.run_id != '') && 'auto' || 'manual') }}")
    queued = [(s["name"], s.get("timeout-minutes")) for s in job["steps"]
              if "steps.plan" in str(s.get("if", "")) or s["name"] == "Plan the memo"]
    assert queued == QUEUED[name]
    names = [s["name"] for s in job["steps"]]
    assert [names.index(n) for n, _ in QUEUED[name]] == sorted(names.index(n) for n, _ in QUEUED[name])


@pytest.mark.parametrize("name", list(QUEUED))
def test_the_gates(name):
    steps = {s["name"]: s for s in _steps(name)}
    kind = name.split("-")[0]
    plan = steps["Plan the memo"]
    assert plan["if"] == "env.MEMO_MODE != 'manual' && github.ref == 'refs/heads/main'"
    assert plan["run"] == f'python scripts/memo_queue.py plan --kind {kind} --wake "$WAKE" --resend-key "$RESEND_KEY"'
    assert plan["env"]["WAKE"] == "${{ inputs.wake || inputs.run_id }}"
    for n in ("Download the source snapshot", "Check the source snapshot", f"Generate {kind} memo",
              "Publish the memo page and mark it sending", "Finalize the message", "Send memo email"):
        assert steps[n]["if"] == GO, n
    for n in ("Write the memo outcome", "Upload the memo outcome", "Record the memo outcome"):
        assert steps[n]["if"] == AFTER_SEND, n
    up = steps["Upload the memo outcome"]
    assert up["with"] == {"name": f"memo-outcome-{kind}-${{{{ steps.plan.outputs.key }}}}-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}",
                          "path": "output/memo-outcome/", "retention-days": 30}
    chain = [s for s in _steps(name) if s["name"].startswith("Chain the next queued")][0]
    assert chain["if"] == "always() && steps.plan.outputs.more == 'true' && steps.record.outputs.terminal == 'true'"
    assert f'gh workflow run {name} -f wake="chain-${{{{ github.run_id }}}}"' in chain["run"]
    alarm = [s for s in _steps(name) if s["name"].startswith("Fail on a")][0]
    assert alarm["if"] == "always() && steps.plan.outputs.alarm == 'true'" and "exit 1" in alarm["run"]
    for s in _steps(name):
        if s["name"].endswith("(manual run)"):
            assert s["if"].startswith("env.MEMO_MODE == 'manual'"), s["name"]


@pytest.mark.parametrize("name", list(QUEUED))
def test_the_sender_is_send_memo_everywhere(name):
    text = (WF / name).read_text()
    assert "dawidd6" not in text and "action-send-mail" not in text
    sends = [s for s in _steps(name) if s["name"].startswith("Send memo email")]
    assert len(sends) == 2
    for s in sends:
        assert s["run"].strip().startswith("python scripts/send_memo.py") and s["timeout-minutes"] == 5
        assert set(s["env"]) == {"GMAIL_ADDRESS", "GMAIL_APP_PASSWORD", "MEMO_RECIPIENTS"}
    queued = next(s for s in sends if s["name"] == "Send memo email")
    assert "--subject-file output/memo-final/subject.txt --html-file output/memo-final/email.html" in queued["run"]
    assert "--out output/memo-final/outcome.json" in queued["run"]


def test_paid_commentary_needs_the_reservation_and_the_weekly_memo_has_no_paid_key():
    steps = {s["name"]: s for s in _steps("daily-memo.yml")}
    gen = steps["Generate daily memo"]["env"]
    assert gen["ANTHROPIC_API_KEY"] == "${{ steps.reserve.outputs.commentary == 'paid' && secrets.ANTHROPIC_API_KEY || '' }}"
    assert gen["PERPLEXITY_API_KEY"] == "${{ steps.reserve.outputs.commentary == 'paid' && secrets.PERPLEXITY_API_KEY || '' }}"
    assert gen["MEMO_SESSION"] == "${{ steps.plan.outputs.key }}" and gen["MEMO_CLOCK"] == "${{ steps.plan.outputs.validated_at }}"
    queued = [s for s in _steps("daily-memo.yml") if "steps.plan" in str(s.get("if", ""))]
    paid = [s["name"] for s in queued if re.search(r"ANTHROPIC|PERPLEXITY", str(s))]
    assert paid == ["Generate daily memo"]
    weekly = (WF / "weekly-memo.yml").read_text()
    assert "ANTHROPIC" not in weekly and "PERPLEXITY" not in weekly


def test_the_weekly_pin_recomputes_in_order_under_the_content_clock():
    s = next(x for x in _steps("weekly-memo.yml") if x["name"] == "Pin the private copy and recompute its analytics")
    assert s["env"] == {"PIN": "${{ steps.plan.outputs.pin_session }}", "MEMO_CLOCK": "${{ steps.plan.outputs.validated_at }}"}
    assert [ln.strip() for ln in s["run"].strip().splitlines()] == [
        'python scripts/memo_queue.py pin --db data/macro_radar.db --session "$PIN"',
        "python -m src.analytics.surprise",
        'python scripts/memo_queue.py market-metrics --db data/macro_radar.db --session "$PIN"',
        "python -m src.analytics.backtest",
        "python -m src.analytics.alerts",
        "python -m src.analytics.priced",
        "python -m src.analytics.playbook",
        'python scripts/memo_queue.py market-alerts --db data/macro_radar.db --session "$PIN"',
    ]
    gen = next(x for x in _steps("weekly-memo.yml") if x["name"] == "Generate weekly memo")
    assert gen["env"] == {"MEMO_KEY": "${{ steps.plan.outputs.key }}", "MEMO_SESSION": "${{ steps.plan.outputs.pin_session }}",
                          "MEMO_CLOCK": "${{ steps.plan.outputs.validated_at }}"}
    daily = next(x for x in _steps("daily-memo.yml") if x["name"] == "Pin the private copy to the session")
    assert "memo_queue.py pin" in daily["run"] and "memo_queue.py market-metrics" in daily["run"]


@pytest.mark.parametrize("name", list(QUEUED))
def test_the_queued_path_never_reads_the_release_or_commits_itself(name):
    for s in _steps(name):
        if "steps.plan" in str(s.get("if", "")):
            run = str(s.get("run", ""))
            assert "gh release" not in run and "git commit" not in run and "git push" not in run, s["name"]


def test_every_ledger_and_registry_writer_runs_on_main_only():
    refresh = {s["name"]: s for s in _doc("refresh-data.yml")["jobs"]["refresh"]["steps"]}
    assert "github.ref == 'refs/heads/main'" in refresh["Record memo sources"]["if"]
    for name in QUEUED:
        plan = next(s for s in _steps(name) if s["name"] == "Plan the memo")
        assert "github.ref == 'refs/heads/main'" in plan["if"]      # every later queued step needs the plan's go


def test_the_memo_records_are_committed_and_not_ignored():
    import subprocess

    for rel in ("docs/memo/ledger-daily.json", "docs/memo/ledger-weekly.json", "docs/memo/sources.json"):
        assert (ROOT / rel).is_file(), rel
        ignored = subprocess.run(["git", "check-ignore", "-q", rel], cwd=ROOT)
        assert ignored.returncode == 1, f"{rel} is git-ignored"


def test_the_readme_link_does_not_call_the_memo_todays():
    # S-7: the queue publishes the latest completed session, so on a weekend or holiday the
    # linked page carries an earlier date than today
    readme = (ROOT / "README.md").read_text()
    assert "[Latest daily memo](" in readme and "Today's daily memo" not in readme
