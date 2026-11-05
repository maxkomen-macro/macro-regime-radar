"""scripts/refresh_status.py — write the refresh-attempt status (release-aware freshness F-3).

refresh-data.yml runs it in full mode only, in two continue-on-error steps that touch nothing the
database publish reads: `start` right after the mode is resolved, `finish` as the last step
(`if: always()`). Each reads the previously published document (missing or invalid is allowed: the
new one then vouches only from this attempt's start) and writes the merged one for upload as the
`refresh-status.json` release asset. The format and the rules live in api/refresh_status.py.

    python scripts/refresh_status.py start  --prev P --out O --run-id ID --run-attempt N --event E --started-at T
    python scripts/refresh_status.py finish --prev P --out O --run-id ID --run-attempt N --event E --started-at T \\
        --job-status S --fred S --validate S --publish S --verdict V --upload U

Stdlib only; no network, no database, no secrets. Always exits 0 once it has written the file, and
writes nothing (exit 1) only when the output cannot be written.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api import refresh_status as rs  # noqa: E402


def _read_prev(path: str | None) -> dict | None:
    if not path:
        return None
    try:
        return rs.parse_doc(Path(path).read_bytes())
    except OSError:
        return None


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=("start", "finish"))
    ap.add_argument("--prev")
    ap.add_argument("--out", required=True)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--run-attempt", type=int, default=1)
    ap.add_argument("--event", default="")
    ap.add_argument("--started-at", default="")
    for k in ("job-status", "fred", "validate", "publish", "verdict", "upload"):
        ap.add_argument(f"--{k}", default="")
    a = ap.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    prev = _read_prev(a.prev)
    common = {"run_id": a.run_id, "run_attempt": max(1, a.run_attempt), "event": a.event, "started_at": a.started_at, "now": now}
    if a.command == "start":
        doc = rs.start_doc(prev, **common)
    else:
        doc = rs.finish_doc(prev, **common, job_status=a.job_status, fred=a.fred, validate=a.validate, publish=a.publish,
                            verdict=a.verdict, upload=a.upload)
    Path(a.out).write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")
    rec = next((x for x in doc["attempts"] if (x["run_id"], x["run_attempt"]) == (a.run_id, max(1, a.run_attempt))), {"status": "dropped (older than the 20 kept)", "run_attempt": a.run_attempt})
    print(f"refresh status: run {a.run_id}/{rec['run_attempt']} {rec['status']}; {len(doc['attempts'])} attempts since "
          f"{doc['covers_since']}{' (previous document missing or invalid)' if prev is None else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
