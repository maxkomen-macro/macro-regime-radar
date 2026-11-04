"""tests/test_refresh_status.py — the refresh-attempt status (release-aware freshness F-3; Max, 2026-11-04).

- **The writer** (api/refresh_status start_doc / finish_doc, scripts/refresh_status.py): the macro outcome
  comes from the FRED, validation and publish steps only (DR-06, DR-09); a finish without its start record
  creates it (DR-11); a missing or invalid previous document vouches only from this attempt; pruning
  advances `covers_since` (DR-08).
- **The reader** (parse_doc) refuses anything but a valid schema-1 document.
- **The decision** (decide): unknown (conservative) whenever the status cannot vouch for the time since
  the release; failed for a relevant failed, cancelled or abandoned attempt; waiting otherwise. Order is
  by start (serialization), abandoned ends are bounded by the next start and RUN_MAX (DR-13, DR-14).
- **The freshness states** it produces, **the API's read** of the asset (api/bootstrap) and **the
  workflow steps** that publish it.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import yaml

from api import bootstrap, freshness
from api import refresh_status as rs

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import refresh_status as cli  # noqa: E402


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _rec(run_id, started, status, updated=None, *, attempt=1, estimated=False):
    return {"run_id": str(run_id), "run_attempt": attempt, "mode": "full", "event": "schedule", "started_at": started,
            "started_at_estimated": estimated, "updated_at": updated or started, "status": status,
            "steps": {"fred": "", "validate": "", "publish": ""}, "verdict": "", "upload": "", "db_published": status == "success",
            "job_status": ""}


def _held(records, *, now="2026-10-14T16:00:00Z", covers="2026-10-01T00:00:00Z", updated=None, error=None, fetched=None):
    doc = {"schema": 1, "workflow": "refresh-data", "updated_at": updated or now, "covers_since": covers, "attempts": records}
    assert rs.parse_doc(json.dumps(doc)) is not None or error is not None
    return {"doc": None if error else doc, "fetched_at": _t(fetched) if fetched else _t(now) - timedelta(minutes=2), "error": error}


R = _t("2026-10-14T12:30:00Z")  # CPI, Wed Oct 14 2026, 08:30 EDT
NOW = _t("2026-10-14T16:00:00Z")


def _decide(held, now=NOW, newest_check=None):
    return rs.decide(held, released_at=R, now=now, newest_check=newest_check)


# ── the writer ──────────────────────────────────────────────────────────────

FIN = dict(run_id="7", run_attempt=1, event="schedule", started_at="2026-10-14T14:00:00Z")


@pytest.mark.parametrize(("stages", "status"), [
    (dict(job_status="success", fred="success", validate="success", publish="success", verdict="pass", upload="true"), "success"),
    # ancillary steps after the publish failed (memo dispatch, playbook): the macro update still succeeded (DR-06)
    (dict(job_status="failure", fred="success", validate="success", publish="success", verdict="pass", upload="true"), "success"),
    # validation passed with nothing to upload: a successful no-change check (DR-06, DR-09)
    (dict(job_status="success", fred="success", validate="success", publish="skipped", verdict="pass", upload="false"), "unchanged"),
    # changed data whose publish never ran (the snapshot build failed first): failure, not unchanged (DR-09)
    (dict(job_status="failure", fred="success", validate="success", publish="skipped", verdict="pass", upload="true"), "failure"),
    (dict(job_status="failure", fred="success", validate="success", publish="skipped", verdict="", upload=""), "failure"),
    (dict(job_status="failure", fred="failure", validate="skipped", publish="skipped", verdict="", upload=""), "failure"),
    (dict(job_status="failure", fred="success", validate="failure", publish="skipped", verdict="fail", upload="false"), "failure"),
    (dict(job_status="cancelled", fred="success", validate="", publish="", verdict="", upload=""), "cancelled"),
    (dict(job_status="cancelled", fred="cancelled", validate="skipped", publish="skipped", verdict="", upload=""), "cancelled"),
])
def test_the_macro_outcome_comes_from_the_three_stages(stages, status):
    doc = rs.finish_doc(None, now=_t("2026-10-14T14:09:00Z"), **FIN, **stages)
    rec = doc["attempts"][0]
    assert rec["status"] == status and rec["db_published"] == (stages["publish"] == "success")
    assert rs.parse_doc(json.dumps(doc)) == doc


def test_start_then_finish_is_one_record_and_a_finish_without_its_start_creates_it():
    prev = rs.start_doc(None, now=_t("2026-10-14T14:00:05Z"), **FIN)
    assert prev["attempts"][0]["status"] == "in_progress" and prev["covers_since"] == "2026-10-14T14:00:00Z"
    stages = dict(job_status="success", fred="success", validate="success", publish="success", verdict="pass", upload="true")
    done = rs.finish_doc(prev, now=_t("2026-10-14T14:09:00Z"), **FIN, **stages)
    assert len(done["attempts"]) == 1 and done["attempts"][0]["status"] == "success"
    assert done["attempts"][0]["started_at"] == "2026-10-14T14:00:00Z"
    # DR-11: the start upload failed, the finish download failed: the record still carries the attempt's own start
    alone = rs.finish_doc(None, now=_t("2026-10-14T14:09:00Z"), **FIN, **stages)
    assert alone["attempts"][0]["started_at"] == "2026-10-14T14:00:00Z" and alone["covers_since"] == "2026-10-14T14:00:00Z"


def test_a_missing_start_is_estimated_conservatively():
    doc = rs.start_doc(None, now=_t("2026-10-14T14:00:00Z"), run_id="8", run_attempt=1, event="schedule", started_at="")
    rec = doc["attempts"][0]
    assert rec["started_at_estimated"] is True and _t(rec["started_at"]) == _t("2026-10-14T14:00:00Z") - rs.RUN_MAX


def test_covers_since_carries_over_and_advances_past_pruned_records():
    doc = None
    for i in range(25):
        start = rs.stamp(_t("2026-10-01T00:00:00Z") + timedelta(hours=12 * i))
        doc = rs.start_doc(doc, now=_t(start), run_id=str(100 + i), run_attempt=1, event="schedule", started_at=start)
    assert len(doc["attempts"]) == rs.MAX_ATTEMPTS
    oldest_kept = min(_t(a["started_at"]) for a in doc["attempts"])
    newest_dropped = _t("2026-10-01T00:00:00Z") + timedelta(hours=12 * 4)
    assert _t(doc["covers_since"]) == newest_dropped + timedelta(seconds=1) <= oldest_kept  # DR-08


@pytest.mark.parametrize("raw", [None, b"", b"{", b"[]", json.dumps({"schema": 2}).encode(),
                                 json.dumps({"schema": 1, "workflow": "refresh-data", "updated_at": "2026-10-14 16:00",
                                             "covers_since": "2026-10-01T00:00:00Z", "attempts": []}).encode(),
                                 json.dumps({"schema": 1, "workflow": "refresh-data", "updated_at": "2026-10-14T16:00:00Z",
                                             "covers_since": "2026-10-01T00:00:00Z", "attempts": [{"run_id": "1"}]}).encode()])
def test_anything_but_a_valid_document_is_unreadable(raw):
    assert rs.parse_doc(raw) is None


def test_the_command_line_writes_the_document_and_survives_a_bad_previous_file(tmp_path):
    bad = tmp_path / "prev.json"
    bad.write_text("not json")
    out = tmp_path / "out.json"
    assert cli.main(["start", "--prev", str(bad), "--out", str(out), "--run-id", "9", "--run-attempt", "1",
                     "--event", "schedule", "--started-at", "2026-10-14T14:00:00Z"], now=_t("2026-10-14T14:00:04Z")) == 0
    assert cli.main(["finish", "--prev", str(out), "--out", str(out), "--run-id", "9", "--run-attempt", "1",
                     "--event", "schedule", "--started-at", "2026-10-14T14:00:00Z", "--job-status", "failure",
                     "--fred", "failure", "--validate", "skipped", "--publish", "skipped"], now=_t("2026-10-14T14:03:00Z")) == 0
    doc = rs.parse_doc(out.read_bytes())
    assert doc is not None and [a["status"] for a in doc["attempts"]] == ["failure"]
    assert cli.main(["finish", "--prev", str(tmp_path / "absent.json"), "--out", str(out), "--run-id", "9"],
                    now=_t("2026-10-14T14:03:00Z")) == 0


# ── the decision ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("held", "why"), [
    (None, "no refresh status"),
    ({"doc": None, "fetched_at": NOW, "error": "missing"}, "missing"),
    ({"doc": None, "fetched_at": NOW, "error": "unreadable"}, "unreadable"),
    ({"doc": None, "fetched_at": NOW, "error": "fetch failed"}, "fetch failed"),
])
def test_no_status_is_unknown(held, why):
    out = _decide(held)
    assert out["outcome"] == "unknown" and why in out["why"]


def test_a_status_that_cannot_vouch_for_the_time_since_the_release_is_unknown():
    assert _decide(_held([], fetched="2026-10-14T15:20:00Z"))["outcome"] == "unknown"           # read 40 min ago
    assert _decide(_held([], covers="2026-10-14T09:00:00Z"))["outcome"] == "unknown"            # covers less than R - RUN_MAX
    assert _decide(_held([], updated="2026-10-14T13:00:00Z"), newest_check=_t("2026-10-14T14:05:00Z"))["outcome"] == "unknown"
    assert _decide(_held([_rec(2, "2026-10-14T18:00:00Z", "success")]))["outcome"] == "unknown"  # a future stamp
    two = [_rec(3, "2026-10-14T14:00:00Z", "success", "2026-10-14T14:08:00Z"),
           _rec(4, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:08:00Z")]
    assert _decide(_held(two))["outcome"] == "unknown"                                         # DR-12: same start
    overdue = [_rec(5, "2026-10-14T14:30:00Z", "in_progress")]
    assert _decide(_held(overdue))["outcome"] == "unknown"                                     # 90 min, no finish
    est = [_rec(6, "2026-10-14T09:45:00Z", "success", "2026-10-14T15:45:00Z", estimated=True)]
    assert _decide(_held(est))["outcome"] == "unknown"


def test_waiting_when_no_relevant_attempt_has_finished_or_the_last_succeeded():
    assert _decide(_held([]))["outcome"] == "waiting"
    running = [_rec(7, "2026-10-14T15:30:00Z", "in_progress")]
    assert _decide(_held(running))["outcome"] == "waiting"
    before = [_rec(8, "2026-10-14T11:20:00Z", "failure", "2026-10-14T11:28:00Z")]                # finished before R
    assert _decide(_held(before))["outcome"] == "waiting"
    after = [_rec(9, "2026-10-14T14:00:00Z", "unchanged", "2026-10-14T14:08:00Z"), *before]
    assert _decide(_held(after))["outcome"] == "waiting"


def test_failed_for_a_relevant_failure_cancellation_or_a_spanning_run():
    fail = [_rec(10, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:05:00Z")]
    out = _decide(_held(fail))
    assert out["outcome"] == "failed" and out["why"] == "failed" and out["attempt"]["run_id"] == "10"
    assert _decide(_held([_rec(11, "2026-10-14T14:00:00Z", "cancelled", "2026-10-14T14:02:00Z")]))["why"] == "was cancelled"
    span = [_rec(12, "2026-10-14T12:25:00Z", "failure", "2026-10-14T12:40:00Z")]               # DR-05: spans R
    assert _decide(_held(span))["outcome"] == "failed"
    # the newest started decides: a later success (a re-run) supersedes the failure
    rerun = [_rec(10, "2026-10-14T14:30:00Z", "success", "2026-10-14T14:38:00Z", attempt=2), *fail]
    assert _decide(_held(rerun))["outcome"] == "waiting"
    assert _decide(_held(list(reversed(rerun))))["outcome"] == "waiting"                        # order in the file


def test_an_abandoned_run_is_bounded_by_the_next_start_and_run_max():
    a_before = _rec(20, "2026-10-14T09:00:00Z", "in_progress")                                 # DR-13: lost its finish
    for b, outcome in [(_rec(21, "2026-10-14T14:00:00Z", "success", "2026-10-14T14:10:00Z"), "waiting"),
                       (_rec(21, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:10:00Z"), "failed"),
                       (_rec(21, "2026-10-14T15:50:00Z", "in_progress"), "failed")]:              # B still running: A decides
        assert _decide(_held([b, a_before]))["outcome"] == outcome
    # DR-14: abandoned a day earlier, the next run starts after R: A ended by its RUN_MAX, before R
    a_old = _rec(22, "2026-10-13T09:00:00Z", "in_progress")
    for b, outcome in [(_rec(23, "2026-10-14T15:50:00Z", "in_progress"), "waiting"),
                       (_rec(23, "2026-10-14T14:00:00Z", "success", "2026-10-14T14:10:00Z"), "waiting"),
                       (_rec(23, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:10:00Z"), "failed")]:
        assert _decide(_held([b, a_old], covers="2026-10-13T00:00:00Z"))["outcome"] == outcome
    # abandoned with the next start after R: A could have spanned R, so it stopped reporting on it
    a_span = _rec(24, "2026-10-14T12:20:00Z", "in_progress")
    out = _decide(_held([_rec(25, "2026-10-14T15:50:00Z", "in_progress"), a_span]))
    assert out["outcome"] == "failed" and out["why"] == "stopped reporting"
    # the newest still in progress past RUN_MAX: terminated
    late = _decide(_held([_rec(26, "2026-10-14T12:40:00Z", "in_progress")], now="2026-10-14T19:00:00Z"),
                   now=_t("2026-10-14T19:00:00Z"))
    assert late["outcome"] == "failed" and late["why"] == "stopped reporting"


# ── the freshness states ────────────────────────────────────────────────────

RELEASES = {"CPI Release": ["2026-10-14T12:30:00Z"]}


def _cpi(held, now="2026-10-14T16:00:00Z", stored="2026-08-01", watermarks=None):
    fresh = {"regimes_date": "2026-08-01", "signals_date": "2026-08-01", "market_daily_date": "2026-10-13",
             "news_published_at": "2026-10-14 14:00:00", "raw_series_date": "2026-10-01", "release_times": RELEASES}
    latest = [{"series_id": "CPIAUCSL", "date": stored, "value": 1.0}, {"series_id": "INDPRO", "date": "2026-08-01", "value": 1.0},
              {"series_id": "UNRATE", "date": "2026-09-01", "value": 1.0}]
    rep = freshness.assess(db_fresh=fresh, series_latest=latest, relay=None, bootstrap=None, now=_t(now), watermarks=watermarks,
                           attempts=held)
    return {s["id"]: s for s in rep["series"]}["CPIAUCSL"], {r["feed"]: r for r in rep["sla"]}["fred:CPIAUCSL"]


def test_a_relevant_failed_refresh_reads_stale_with_the_failure_and_keeps_the_stored_print():
    s, sla = _cpi(_held([_rec(30, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:05:00Z")]))
    assert (s["state"], s["word"], s["cycles_behind"], s["as_of"]) == ("stale", None, 1, "2026-08-01")
    assert "the full refresh that started Oct 14 10:00 ET failed" in s["reason"] and "newest stored print is Aug 2026" in s["reason"]
    assert sla["verdict"] == "delayed" and not sla.get("word")


def test_the_neutral_wait_needs_a_status_that_vouches_for_it():
    s, sla = _cpi(_held([]))
    assert (s["state"], s["word"]) == ("delayed", "Released, awaiting refresh") and sla.get("word") == "Released, awaiting refresh"
    for held in (None, {"doc": None, "fetched_at": NOW, "error": "unreadable"}, _held([], fetched="2026-10-14T15:00:00Z")):
        s, sla = _cpi(held)
        assert (s["state"], s["word"]) == ("stale", None) and not sla.get("word")
        assert "release(s) behind" in s["reason"]  # today's reason, unchanged
    # a status older than the store it describes: its publisher lost a run (rule 1)
    wm = {"fred:CPIAUCSL": {"last_obs": "2026-08-01", "checked_at": "2026-10-14T15:00:00Z", "status": "ok"}}
    s, _ = _cpi(_held([], updated="2026-10-14T13:00:00Z"), watermarks=wm)
    assert s["state"] == "stale"


def test_the_deadline_still_ends_every_case():
    for held in (_held([], now="2026-10-15T06:00:00Z"),
                 _held([_rec(31, "2026-10-14T14:00:00Z", "failure", "2026-10-14T14:05:00Z")], now="2026-10-15T06:00:00Z")):
        s, _ = _cpi(held, now="2026-10-15T06:00:00Z")
        assert s["state"] == "stale" and "release(s) behind" in s["reason"]


def test_the_newest_fred_check_reads_only_fred_watermarks():
    wms = {"fred:DGS10": {"checked_at": "2026-10-14T11:20:00Z"}, "fred:CPIAUCSL": {"checked_at": "2026-10-14T11:21:00Z"},
           "desk_series": {"checked_at": "2026-10-14T20:00:00Z"}, "fred:X": {"checked_at": None}}
    assert freshness.newest_fred_check(wms) == _t("2026-10-14T11:21:00Z")
    assert freshness.newest_fred_check(None) is None


# ── the API's read of the asset ─────────────────────────────────────────────

API = "https://api.github.com/repos/maxkomen-macro/macro-regime-radar"


def _client(assets, status_body=None, status_code=200, raise_on_status=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/releases/tags/data-latest"):
            return httpx.Response(200, json={"assets": assets})
        if request.url.path.endswith("/assets/9"):
            if raise_on_status:
                raise httpx.ConnectError("boom")
            return httpx.Response(status_code, content=status_body or b"")
        return httpx.Response(404)
    return httpx.Client(transport=httpx.MockTransport(handler))


STATUS_ASSET = {"name": "refresh-status.json", "url": f"{API}/releases/assets/9"}
GOOD = json.dumps({"schema": 1, "workflow": "refresh-data", "updated_at": "2026-10-14T14:09:00Z",
                   "covers_since": "2026-10-01T00:00:00Z", "attempts": [_rec(40, "2026-10-14T14:00:00Z", "success", "2026-10-14T14:09:00Z")]}).encode()


@pytest.mark.parametrize(("assets", "body", "code", "boom", "error"), [
    ([STATUS_ASSET], GOOD, 200, False, None),
    ([], None, 200, False, "missing"),
    ([STATUS_ASSET], b"{nope", 200, False, "unreadable"),
    ([STATUS_ASSET], b"", 500, False, "fetch failed"),
    ([STATUS_ASSET], b"", 200, True, "fetch failed"),
])
def test_the_api_holds_this_checks_view_of_the_status_and_never_the_last_ones(assets, body, code, boom, error):
    bootstrap.reset_refresh_status_for_tests()
    bootstrap._read_refresh_status(_client(assets), {}, [{"name": "x"}])  # a first view: missing
    with _client(assets, body, code, boom) as c:
        bootstrap._read_refresh_status(c, {}, assets)
    held = bootstrap.refresh_attempts()
    assert held["error"] == error and (held["doc"] is not None) == (error is None)
    assert isinstance(held["fetched_at"], datetime)
    bootstrap.reset_refresh_status_for_tests()


def test_a_failed_release_listing_holds_no_status_and_still_raises(monkeypatch):
    bootstrap.reset_refresh_status_for_tests()
    monkeypatch.setattr(bootstrap, "_token", lambda: "t")
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(lambda r: httpx.Response(502)))
    with pytest.raises(httpx.HTTPStatusError):
        bootstrap.refresh_db()
    assert bootstrap.refresh_attempts()["error"] == "fetch failed"
    bootstrap.reset_refresh_status_for_tests()


def test_a_status_read_never_affects_the_database_check(monkeypatch, tmp_path):
    """The listing has the status asset but no database: the database path answers no_asset as before,
    and the status is held; a status download that raises is caught."""
    bootstrap.reset_refresh_status_for_tests()
    monkeypatch.setattr(bootstrap, "_token", lambda: "t")
    def handler(request):
        if request.url.path.endswith("/releases/tags/data-latest"):
            return httpx.Response(200, json={"assets": [STATUS_ASSET]})
        raise httpx.ConnectError("status host down")
    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(handler))
    assert bootstrap.refresh_db() is False
    assert bootstrap.status()["last_result"] == "no_asset"
    assert bootstrap.refresh_attempts()["error"] == "fetch failed"
    bootstrap.reset_refresh_status_for_tests()


# ── the workflow steps ──────────────────────────────────────────────────────

def _steps():
    doc = yaml.safe_load((ROOT / ".github" / "workflows" / "refresh-data.yml").read_text())
    return doc["jobs"]["refresh"]["steps"]


def test_the_status_steps_run_in_full_mode_only_bounded_and_unable_to_fail_the_refresh():
    steps = _steps()
    names = [s["name"] for s in steps]
    start, finish = steps[names.index("Upload refresh-attempt status (started)")], steps[-1]
    rec = steps[names.index("Record the attempt start")]
    assert finish["name"] == "Upload refresh-attempt status (finished)"
    assert names.index("Resolve refresh mode") < names.index("Record the attempt start") < names.index(start["name"]) \
        < names.index("Install dependencies (full)")
    assert rec["id"] == "attempt" and rec["if"] == "steps.mode.outputs.mode == 'full'" and "gh " not in rec["run"]
    assert start["if"] == "steps.mode.outputs.mode == 'full'"
    assert finish["if"] == "always() && steps.mode.outputs.mode == 'full'"
    for s in (start, finish):
        assert s["continue-on-error"] is True and s["timeout-minutes"] <= 2
        assert s["env"] == {"GH_TOKEN": "${{ secrets.GITHUB_TOKEN }}"}
        assert "gh release upload data-latest refresh-status.json --clobber" in s["run"]
        assert "macro_radar.db" not in s["run"] and "validation.json" not in s["run"]
        assert "--started-at \"${{ steps.attempt.outputs.started_at }}\"" in s["run"]
    for arg in ('--fred "${{ steps.fred.outcome }}"', '--validate "${{ steps.validate.outcome }}"',
                '--publish "${{ steps.publish.outcome }}"', '--verdict "${{ steps.validate.outputs.verdict }}"',
                '--upload "${{ steps.validate.outputs.upload }}"', '--job-status "${{ job.status }}"'):
        assert arg in finish["run"], arg


def test_the_fred_and_publish_steps_only_gain_ids():
    steps = {s["name"]: s for s in _steps()}
    fred = steps["Run FRED pipeline (fetch + regimes + signals)"]
    pub = steps["Publish validated DB snapshot to data-latest release"]
    assert fred == {"name": fred["name"], "id": "fred", "if": "steps.mode.outputs.mode == 'full'", "run": "python main.py"}
    assert pub["id"] == "publish" and "steps.validate.outputs.upload == 'true'" in pub["if"]


def test_no_other_workflow_writes_the_status():
    for wf in (ROOT / ".github" / "workflows").glob("*.yml"):
        if wf.name != "refresh-data.yml":
            assert "refresh-status" not in wf.read_text(), wf.name
