"""Phase 4a post-fix rerun driver (unserved), as run on bench head 916ecf38 after #70 merged.

Reruns the 40 requests whose B or D records failed with the Finder next-day crash, under all four configurations
and both limits, through runner.guarded (the CPU ledger and its guard). Pre-fix records are left unchanged.
Usage: python -m scripts.options_bench.phase4a.rerun_postfix <out.jsonl>
"""
import sys
from pathlib import Path
from scripts.options_bench.phase4a import runner
IDX = [5, 11, 20, 21, 28, 30, 45, 48, 50, 53, 64, 68, 72, 76, 83, 91, 95, 96, 98, 101, 105, 106, 107, 115, 118, 130, 139, 142, 143, 151, 161, 162, 167, 185, 191, 202, 216, 218, 220, 231]
out = Path(sys.argv[1])
for i in IDX:
    rc = runner.guarded(i, 1, ["A", "B", "C", "D"], ["budget", "offline"], out)
    print(i, rc, flush=True)
    if rc == 3:
        break
