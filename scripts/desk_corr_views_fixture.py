"""scripts/desk_corr_views_fixture.py — the Macro fixture's correlation blocks with their P1b views.

The Desk fixtures (web/src/fixtures/desk/, PROVENANCE.md) are one snapshot cut
at 2026-09-23. Their stock_bond, correlations and matrix blocks came from
scripts/desk_etf_fixtures.py, which needs the audit's store, an owner-held
copy. Desk P1b (docs/desk/CORRELATION_VIEWS.md) adds keys to those three
blocks, and the 60-return view must equal each block's own 60-return fields.
So this script rebuilds the three blocks whole, from one store, as follows:

1. Copy a database the full refresh filled (the public data-latest release
   asset) to --store, which is a scratch path, never under data/.
2. Cut asset_prices at CUT (2026-09-23), the fixture world's last completed
   session.
3. Keep the regimes rows through 2026-08, as the fixture world has them. The
   copy has no 2025-10 row, and neither does the fixture world.
4. Compute the blocks with the desk_etf item's own builders, with the views
   on. The Store is built with the item's keys and the cut as its as-of.
5. Write each block's data into macro.json, leaving every other key of the
   file as it is.

Adjusted closes restate after each distribution, so the 60-return values
rebuilt here can differ from the audit-era ones in the sixth decimal. The
two-decimal values the page prints are unchanged; PROVENANCE.md records the
source.

Read-only on --db.

    python scripts/desk_corr_views_fixture.py --db data/macro_radar.db --store <scratch path> [--check]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURE = ROOT / "web" / "src" / "fixtures" / "desk" / "macro.json"
CUT = "2026-09-23"
LAST_REGIME = "2026-08-01"


def build_store(db: Path, store: Path) -> Path:
    shutil.copyfile(db, store)
    conn = sqlite3.connect(store)
    try:
        conn.execute("DELETE FROM asset_prices WHERE date > ?", (CUT,))
        conn.execute("DELETE FROM regimes WHERE date > ?", (LAST_REGIME,))
        conn.commit()
    finally:
        conn.close()
    return store


def blocks(store: Path) -> dict:
    from api import desk_items_etf as etf

    conn = sqlite3.connect(f"file:{store}?mode=ro", uri=True)
    try:
        st = etf.Store(conn, [etf.BENCHMARK, *etf.SECTOR_KEYS, "rsp", "iwm", *(k for k, _ in etf.CORR_ASSETS),
                              etf.VIX[0], "smh"], CUT)
        st.regimes = etf._regimes(conn)
    finally:
        conn.close()
    return {"stock_bond": etf.stock_bond(st, True), "correlations": etf.correlations(st, True),
            "matrix": etf.matrix(st, True)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", type=Path, required=True)
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--check", action="store_true", help="exit 1 when macro.json differs from what would be written")
    a = ap.parse_args()
    if a.store.resolve().parent == (ROOT / "data").resolve():
        raise SystemExit("--store must be a scratch path, not under data/")
    got = blocks(build_store(a.db, a.store))
    fixture = json.loads(FIXTURE.read_text())
    for key, data in got.items():
        fixture[key] = {**fixture[key], "status": "ready", "data": data, "unavailable": None}
    text = json.dumps(fixture, indent=1, ensure_ascii=False) + "\n"
    if a.check:
        same = FIXTURE.read_text() == text
        print("macro.json is current" if same else "macro.json differs")
        return 0 if same else 1
    FIXTURE.write_text(text)
    print(f"wrote {FIXTURE.relative_to(ROOT)}: stock_bond, correlations, matrix (cut {CUT}, regimes through {LAST_REGIME[:7]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
