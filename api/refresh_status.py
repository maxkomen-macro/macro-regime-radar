"""api/refresh_status.py — the refresh-attempt status (release-aware freshness F-3; Max, 2026-11-04).

A full refresh publishes nothing when it fails (the database and its verdict go up only after
validation passes), so without this the store cannot tell a failed refresh from one still to run.
Every full-mode refresh-data.yml run writes `refresh-status.json` on the data-latest release, apart
from the database: a start record when it begins and a finish record at the end (an `always()` step,
so failures and cancellations are recorded too). Both steps are `continue-on-error` and touch nothing
the database publish reads. scripts/refresh_status.py is the writer's command line.

    {"schema": 1, "workflow": "refresh-data", "updated_at": <UTC>, "covers_since": <UTC>,
     "attempts": [{"run_id", "run_attempt", "mode": "full", "event", "started_at",
                   "started_at_estimated", "updated_at",
                   "status": in_progress | success | unchanged | failure | cancelled,
                   "steps": {"fred", "validate", "publish"}, "verdict", "upload",
                   "db_published", "job_status"}, ...]}        newest-started first, at most 20

`covers_since`: every full attempt with started_at >= covers_since is listed. The API reads the asset
on each release check (api/bootstrap.py) and api/freshness.py's `awaiting_refresh` decides with
`decide` below whether a monthly print one release behind may read the neutral "Released, awaiting
refresh", must show a failed refresh, or is unknown (conservative: today's stale state).

What it cannot see (design F3 §1d): a run whose start and finish uploads both fail; a run queued and
not started. A start record whose finish never arrives turns the state conservative after
IN_PROGRESS_MAX and reads "stopped reporting" after RUN_MAX. The deadline (06:00 UTC the day after
the release, api/freshness.close_grace_until) is the fallback for all of them.

Stdlib only (the workflow and the lean installs run it).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

SCHEMA = 1
WORKFLOW = "refresh-data"
ASSET_NAME = "refresh-status.json"
MAX_ATTEMPTS = 20
STATUSES = ("in_progress", "success", "unchanged", "failure", "cancelled")
FINISHED = ("success", "unchanged", "failure", "cancelled")
OUTCOMES = ("success", "failure", "cancelled", "skipped", "")
# A full refresh takes about 8 minutes (the 100 most recent completed scheduled refresh-data runs listed on
# 2026-11-04 took at most 8.3 min). An attempt still in progress after IN_PROGRESS_MAX is overdue (its status
# is unclear: conservative); after RUN_MAX (GitHub's default 360-minute job limit plus the status step) its
# runner is taken as terminated.
IN_PROGRESS_MAX = timedelta(minutes=60)
RUN_MAX = timedelta(minutes=375)
# The API's held status older than this (three of its 10-minute release checks) vouches for nothing.
STATUS_MAX_AGE = timedelta(minutes=30)
CLOCK_SLACK = timedelta(minutes=5)

_FMT = "%Y-%m-%dT%H:%M:%SZ"


def stamp(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime(_FMT)


def parse_stamp(s: Any) -> datetime | None:
    """A strict UTC stamp, YYYY-MM-DDTHH:MM:SSZ; anything else is None."""
    if not isinstance(s, str):
        return None
    try:
        return datetime.strptime(s, _FMT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── reading ─────────────────────────────────────────────────────────────────

def _valid_attempt(a: Any) -> bool:
    if not isinstance(a, dict):
        return False
    steps = a.get("steps")
    return (isinstance(a.get("run_id"), str) and a["run_id"] != ""
            and isinstance(a.get("run_attempt"), int) and not isinstance(a.get("run_attempt"), bool) and a["run_attempt"] >= 1
            and a.get("mode") == "full"
            and isinstance(a.get("event"), str)
            and parse_stamp(a.get("started_at")) is not None
            and isinstance(a.get("started_at_estimated"), bool)
            and parse_stamp(a.get("updated_at")) is not None
            and a.get("status") in STATUSES
            and isinstance(steps, dict) and all(steps.get(k) in OUTCOMES for k in ("fred", "validate", "publish"))
            and isinstance(a.get("verdict"), str) and isinstance(a.get("upload"), str)
            and isinstance(a.get("db_published"), bool) and isinstance(a.get("job_status"), str))


def parse_doc(raw: bytes | str | None) -> dict | None:
    """The document when it is a valid schema-1 refresh status, else None (unreadable)."""
    if raw is None:
        return None
    try:
        doc = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or doc.get("workflow") != WORKFLOW:
        return None
    if parse_stamp(doc.get("updated_at")) is None or parse_stamp(doc.get("covers_since")) is None:
        return None
    attempts = doc.get("attempts")
    if not isinstance(attempts, list) or len(attempts) > MAX_ATTEMPTS or not all(_valid_attempt(a) for a in attempts):
        return None
    keys = [(a["run_id"], a["run_attempt"]) for a in attempts]
    if len(set(keys)) != len(keys):
        return None
    return doc


# ── writing (scripts/refresh_status.py) ─────────────────────────────────────

def macro_status(*, job_status: str, fred: str, validate: str, publish: str, verdict: str, upload: str) -> str:
    """The macro update's outcome from the three stages that store a print (design F3 §1a, Codex DR-06,
    DR-09), never from the whole job: success = all three succeeded (published); unchanged = FRED and
    validation succeeded, the validator said pass with nothing to upload, and publish was skipped;
    cancelled = a stage, or the job before they all finished, was cancelled; else failure (including
    missing or unexpected verdict and upload values)."""
    stages = (fred, validate, publish)
    if fred == "success" and validate == "success" and publish == "success":
        return "success"
    if (fred == "success" and validate == "success" and publish == "skipped"
            and verdict == "pass" and upload == "false"):
        return "unchanged"
    if "cancelled" in stages or job_status == "cancelled":
        return "cancelled"
    return "failure"


def _resolve_start(started_at: str | None, now: datetime) -> tuple[str, bool]:
    t = parse_stamp(started_at)
    if t is None or t > now + CLOCK_SLACK:
        return stamp(now - RUN_MAX), True  # the earliest it could have started (conservative)
    return stamp(t), False


def _merge(prev: dict | None, record: dict, now: datetime) -> dict:
    started = parse_stamp(record["started_at"])
    if prev is None:
        covers, attempts = started, []
    else:
        covers = min(parse_stamp(prev["covers_since"]), started)  # type: ignore[type-var]
        attempts = [a for a in prev["attempts"] if (a["run_id"], a["run_attempt"]) != (record["run_id"], record["run_attempt"])]
    attempts.append(record)
    attempts.sort(key=lambda a: (a["started_at"], a["run_id"], a["run_attempt"]), reverse=True)
    kept, dropped = attempts[:MAX_ATTEMPTS], attempts[MAX_ATTEMPTS:]
    if dropped:  # Codex DR-08: the guarantee holds only after the newest dropped start
        newest_dropped = max(parse_stamp(a["started_at"]) for a in dropped)  # type: ignore[type-var]
        covers = max(covers, newest_dropped + timedelta(seconds=1))  # type: ignore[operator]
    return {"schema": SCHEMA, "workflow": WORKFLOW, "updated_at": stamp(now), "covers_since": stamp(covers),  # type: ignore[arg-type]
            "attempts": kept}


def start_doc(prev: dict | None, *, run_id: str, run_attempt: int, event: str, started_at: str | None, now: datetime) -> dict:
    s, estimated = _resolve_start(started_at, now)
    record = {"run_id": str(run_id), "run_attempt": int(run_attempt), "mode": "full", "event": event or "",
              "started_at": s, "started_at_estimated": estimated, "updated_at": stamp(now), "status": "in_progress",
              "steps": {"fred": "", "validate": "", "publish": ""}, "verdict": "", "upload": "",
              "db_published": False, "job_status": ""}
    return _merge(prev, record, now)


def finish_doc(prev: dict | None, *, run_id: str, run_attempt: int, event: str, started_at: str | None, now: datetime,
               job_status: str, fred: str, validate: str, publish: str, verdict: str, upload: str) -> dict:
    """The finish record. A document that lacks this attempt (its start upload failed, or the download
    failed) gets it from these inputs alone (Codex DR-11)."""
    s, estimated = _resolve_start(started_at, now)
    outcomes = {k: (v if v in OUTCOMES else "") for k, v in (("fred", fred), ("validate", validate), ("publish", publish))}
    record = {"run_id": str(run_id), "run_attempt": int(run_attempt), "mode": "full", "event": event or "",
              "started_at": s, "started_at_estimated": estimated, "updated_at": stamp(now),
              "status": macro_status(job_status=job_status, verdict=verdict, upload=upload, **outcomes),
              "steps": outcomes, "verdict": verdict or "", "upload": upload or "",
              "db_published": outcomes["publish"] == "success", "job_status": job_status or ""}
    return _merge(prev, record, now)


# ── deciding (api/freshness.awaiting_refresh) ──────────────────────────────

def decide(held: dict | None, *, released_at: datetime, now: datetime, newest_check: datetime | None) -> dict:
    """What the status says about the refresh that should store a print released at `released_at`
    (design F3 §1c). {"outcome": "unknown" | "waiting" | "failed", "why": str, "attempt": dict | None}.

    unknown (conservative: the caller keeps today's stale state) when the status cannot vouch for the
    time since the release; failed when the deciding attempt failed, was cancelled, or stopped reporting;
    waiting otherwise. `held` is bootstrap.refresh_attempts(): {"doc", "fetched_at", "error"}.
    `newest_check` is the newest `checked_at` among the store's fred:<id> watermarks."""
    def unknown(why: str) -> dict:
        return {"outcome": "unknown", "why": why, "attempt": None}

    if not isinstance(held, dict):
        return unknown("no refresh status")
    doc = held.get("doc")
    fetched = held.get("fetched_at")
    if not isinstance(doc, dict) or held.get("error"):
        return unknown(f"refresh status {held.get('error') or 'missing'}")
    if not isinstance(fetched, datetime) or now - fetched > STATUS_MAX_AGE or fetched > now + CLOCK_SLACK:
        return unknown("refresh status not read recently")
    updated = parse_stamp(doc.get("updated_at"))
    covers = parse_stamp(doc.get("covers_since"))
    if updated is None or covers is None or updated > now + CLOCK_SLACK:
        return unknown("refresh status unreadable")
    if newest_check is not None and updated < newest_check:
        return unknown("refresh status older than the stored data")  # its publisher is not reporting
    if covers > released_at - RUN_MAX:
        return unknown("refresh status does not cover the release")
    attempts = sorted(doc.get("attempts") or [], key=lambda a: a["started_at"], reverse=True)  # newest-started first
    starts = [a["started_at"] for a in attempts]
    if len(set(starts)) != len(starts):
        return unknown("refresh status lists two attempts with the same start")  # contradicts serialization
    for a in attempts:
        if parse_stamp(a["started_at"]) > now + CLOCK_SLACK or parse_stamp(a["updated_at"]) > now + CLOCK_SLACK:  # type: ignore[operator]
            return unknown("refresh status carries a future stamp")
    for a in attempts:  # an estimated start has no reliable place in the order
        if not a["started_at_estimated"]:
            continue
        upd = parse_stamp(a["updated_at"])
        # finished since the release, or still unfinished and possibly running into it (verifier V-02:
        # a start record uploaded just before the release could otherwise read as ended before it)
        if upd >= released_at or (a["status"] not in FINISHED and upd + RUN_MAX >= released_at):  # type: ignore[operator]
            return unknown("a refresh's start time is estimated")
    # End bounds (design F3 rule 2, Codex DR-13, DR-14): serialization by the data-write group means an attempt
    # that is not the newest-started ended no later than the next one's start.
    deciding = None
    for i, a in enumerate(attempts):
        start = parse_stamp(a["started_at"])
        assert start is not None
        if a["status"] in FINISHED:
            end, kind = parse_stamp(a["updated_at"]), a["status"]
        elif i > 0:  # in progress but a later attempt started: abandoned
            nxt = parse_stamp(attempts[i - 1]["started_at"])
            end, kind = min(nxt, start + RUN_MAX), "abandoned"  # type: ignore[type-var]
        elif now - start < IN_PROGRESS_MAX:
            continue  # running: the attempts before it decide
        elif now - start < RUN_MAX:
            return unknown("the current refresh is overdue and has not reported")
        else:
            end, kind = start + RUN_MAX, "abandoned"
        if end < released_at:  # type: ignore[operator]
            break  # ended before the release, as did every earlier attempt
        deciding = (a, kind)
        break
    if deciding is None:
        return {"outcome": "waiting", "why": "no refresh has finished since the release", "attempt": None}
    a, kind = deciding
    if kind in ("success", "unchanged"):
        return {"outcome": "waiting", "why": "the last refresh since the release did not include it", "attempt": a}
    return {"outcome": "failed", "why": {"failure": "failed", "cancelled": "was cancelled", "abandoned": "stopped reporting"}[kind],
            "attempt": a}
