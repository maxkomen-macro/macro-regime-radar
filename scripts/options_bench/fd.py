"""scripts/options_bench/fd.py — the bench's finite-difference pricer (test tooling, never served).

The kernel lives in src/desk/options_fd.py (Phase 3, direction 1: one FD code, moved unchanged); this module
re-exports it so the bench's reference, its tests and its stored runs keep reading `fd.solve` and the rest. No copy
of the kernel stays here. tests/test_options_fd.py proves the move changed no bit, against the verbatim pre-move
file. The model and the solver's conventions are documented in src/desk/options_fd.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from src.desk.options_fd import (  # noqa: E402,F401  (re-exported for the bench)
    PENALTY,
    PENALTY_ITER_MAX,
    PENALTY_STOP,
    TIE_ULPS,
    YEAR_DAYS,
    coefficients,
    pv_after,
    pv_owed,
    smoothed_payoff,
    solve,
)

__all__ = ["PENALTY", "PENALTY_ITER_MAX", "PENALTY_STOP", "TIE_ULPS", "YEAR_DAYS", "coefficients", "pv_after",
           "pv_owed", "smoothed_payoff", "solve"]
