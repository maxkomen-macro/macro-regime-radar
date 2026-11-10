"""src/market_data/positioning.py — the full refresh's one positioning step (Desk P4, D7).

Runs the CFTC Commitments of Traders step (src/market_data/cot.py) and then the
SEC Form 13F step (src/market_data/sec_13f.py), each on its own: a failure in
one never stops the other. Both are advisory: a failed or slow read keeps what is
stored (every write is one transaction), records its watermark (`cftc_cot`,
`sec_13f`) and exits 0, and scripts/validate_db.py only warns.

The workflow step allows ten minutes; the 13F step is given what is left of
nine, so it stops cleanly, keeping what is stored, before the step is killed.

Run:  python -m src.market_data.positioning [--db data/macro_radar.db]
Stdlib only.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data import cot, sec_13f  # noqa: E402

STEP_BUDGET_S = 540.0     # the workflow step's ten minutes, less a minute for the interpreter and the margin
MIN_SEC_BUDGET_S = 60.0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Store the CFTC futures positions and the SEC 13F holdings for the Desk.")
    ap.add_argument("--db", default=str(cot.DB_PATH))
    a = ap.parse_args(argv)
    started = time.monotonic()
    cot.main(["--db", a.db])
    budget = max(MIN_SEC_BUDGET_S, STEP_BUDGET_S - (time.monotonic() - started))
    try:
        s = sec_13f.refresh(Path(a.db), budget_s=budget)
        print(f"sec_13f: {s['status']} · {s['detail']}")
    except Exception as exc:  # noqa: BLE001 — never fails the refresh; validate_db warns on the watermark
        print(f"sec_13f: not refreshed ({type(exc).__name__})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
