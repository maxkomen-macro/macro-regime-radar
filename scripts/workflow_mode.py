#!/usr/bin/env python3
"""Resolve the refresh mode for a GitHub Actions run (2026-09-06).

The workflows call this instead of comparing cron strings inline, so the
mapping is one testable function:

    python scripts/workflow_mode.py --event schedule --schedule "41 * * * *"
    → news-only

Modes: full · news-only · market-only · verify-only. An unrecognised
schedule resolves to verify-only (never to full), so a stray cron can never
masquerade as a full refresh.
"""

from __future__ import annotations

import argparse
import sys

MODES = ("full", "news-only", "market-only", "verify-only")

# One mode per cron expression; keep in sync with .github/workflows/refresh-data.yml.
SCHEDULE_MODES = {
    "17 11 * * *": "full",  # 11:17 UTC daily, before the US open
    "23 0 * * 2-6": "full",  # 00:23 UTC Tue–Sat, after the US close
    "41 * * * *": "news-only",  # hourly at :41
}


def resolve(event: str, schedule: str = "", input_mode: str = "") -> str:
    if event == "workflow_dispatch":
        return input_mode if input_mode in MODES else "full"
    if event == "schedule":
        return SCHEDULE_MODES.get(schedule.strip(), "verify-only")
    return "verify-only"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True)
    ap.add_argument("--schedule", default="")
    ap.add_argument("--input", dest="input_mode", default="")
    a = ap.parse_args(argv)
    print(resolve(a.event, a.schedule, a.input_mode))
    return 0


if __name__ == "__main__":
    sys.exit(main())
