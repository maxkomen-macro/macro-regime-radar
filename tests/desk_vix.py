"""The VIX close the next full refresh stores (desk/fill-compute, the owner's item 7).

The Desk reads the VIX from `asset_prices` ^VIX, stored by the full refresh
beside ^GSPC (src/market_data/asset_history.DESK_DAILY). A store filled before
that (hardening's scratch copy, the audit's copy of the published store) holds
the VIX only as FRED's VIXCLS in `desk_series`. `add_vix_close` gives a copy of
such a store the ^VIX rows the next full refresh stores: the same CBOE close,
here taken from FRED's copy (Yahoo's ^VIX matched VIXCLS within 0.01 on 9,236
of 9,247 common sessions, 2026-09-27), so every VIX number the tests pin keeps
its value. Never run on a file that is not a test's own copy.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def add_vix_close(conn: sqlite3.Connection) -> int:
    """Store ^VIX in asset_prices from the store's own VIXCLS rows; the count written."""
    from src.market_data import asset_history

    rows = conn.execute(
        "SELECT date, value FROM desk_series WHERE series_id = 'VIXCLS' AND value IS NOT NULL ORDER BY date"
    ).fetchall()
    return asset_history.write_series(conn, "^VIX", "1d", [(d, float(v)) for d, v in rows], provider="test")


def with_vix_close(src: Path, dst: Path) -> Path:
    """A copy of `src` at `dst` with `add_vix_close` applied (read-only on `src`)."""
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    s.backup(d)
    s.close()
    assert add_vix_close(d) > 0, f"{src.name} stores no VIXCLS rows"
    d.commit()
    d.close()
    return dst
