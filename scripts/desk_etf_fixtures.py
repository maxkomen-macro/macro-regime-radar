"""scripts/desk_etf_fixtures.py — the Desk fixtures' ETF values, from the API (desk/fill-etf).

The Desk fixtures (web/src/fixtures/desk/, PROVENANCE.md) are one snapshot:
the audit's store (docs/desk/FRAME3_DATA_AUDIT.md, sha 9a8b857968b8de22,
refreshed 2026-09-24 05:07 UTC). That store predates the ETFs, so this script

1. builds the fixture store: a copy of the audit's store whose 24 Desk ETFs'
   asset_prices rows are replaced by those of a database this branch's
   refresh step filled (`python -m src.market_data.asset_history --db …`),
   cut at 2026-09-23, the last completed session when the audit's store was
   refreshed, so the ETFs join the same snapshot and nothing else changes;
2. serves the Desk routes on it through the API (one worker generation, the
   clock frozen at 2026-09-24 16:00 UTC, as pipeline.json was generated) and
   writes what they serve into the fixtures: pipeline.json whole; the ETF
   blocks of the other routes (see WRITES).

Read-only on both inputs; the fixture store is written to --store (never
under data/, never committed). Needs the repo's Python environment.

    python scripts/desk_etf_fixtures.py --audit <audit copy> --etf-db <refreshed copy> --store <scratch path>
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "web" / "src" / "fixtures" / "desk"
CUT = "2026-09-23"
NOW = datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc)
META = {"as_of": "2026-09-24", "generation_id": "gen-fixture-2026-09-24"}


def etf_symbols() -> list[str]:
    from src.desk import series as registry

    return [s.series_id for s in registry.SERIES
            if s.source == "asset_prices" and s.series_id not in ("^GSPC", "GC=F", "^RUT")]


def build_store(audit: Path, etf_db: Path, store: Path) -> Path:
    """The audit's store with the ETFs' rows from `etf_db`, cut at CUT."""
    from src.market_data import asset_history

    shutil.copyfile(audit, store)
    syms = etf_symbols()
    marks = ",".join("?" * len(syms))
    src = sqlite3.connect(f"file:{etf_db}?mode=ro", uri=True)
    try:
        rows = src.execute(f"SELECT symbol, interval, date, close, provider, volume FROM asset_prices "
                           f"WHERE interval = '1d' AND date <= ? AND symbol IN ({marks})", (CUT, *syms)).fetchall()
    finally:
        src.close()
    dst = sqlite3.connect(store)
    try:
        asset_history.ensure_table(dst)
        dst.execute(f"DELETE FROM asset_prices WHERE interval = '1d' AND symbol IN ({marks})", syms)
        dst.executemany("INSERT INTO asset_prices (symbol, interval, date, close, provider, volume) VALUES (?, ?, ?, ?, ?, ?)", rows)
        dst.commit()
    finally:
        dst.close()
    return store


def serve(store: Path):
    """One worker generation on `store`, the clock frozen at NOW."""
    from api import db, desk_v2, desk_v2_macro
    from api import worker as worker_mod

    db.DB_PATH = store
    db.reset_connections_for_tests()
    desk_v2.clear_memo()
    desk_v2._now = lambda: NOW
    desk_v2_macro._now = lambda: NOW
    w = worker_mod.AnalyticsWorker(poll_s=0.05, preload=False)
    worker_mod._worker = w
    w.start(serving=True)
    if not w.wait_published(timeout=300):
        raise SystemExit("the worker did not publish a generation")
    return w


def get(client, path: str) -> dict:
    r = client.get(f"/api/desk{path}")
    body = r.json()
    if body.get("status") != "ready":
        raise SystemExit(f"{path}: {r.status_code} {body.get('status')} {body.get('unavailable') or body.get('error')}")
    return body["data"]


def _dump(path: Path, doc: dict) -> None:
    """In the file's own style: one line (technicals.json, sectors.json) or indented by one space."""
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    if old.startswith("{\"") or old.startswith("{ \""):
        text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + ("\n" if old.endswith("\n") else "")
    else:
        text = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
    path.write_text(text, encoding="utf-8")


def write(name: str, doc: dict) -> None:
    _dump(FIXTURES / name, {**META, **doc})
    print(f"wrote web/src/fixtures/desk/{name}")


def splice(name: str, blocks: dict) -> None:
    """Replace some top-level fields of an existing fixture; the rest keep their values and order."""
    doc = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    doc.update(blocks)
    _dump(FIXTURES / name, doc)
    print(f"updated {', '.join(blocks)} in web/src/fixtures/desk/{name}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--audit", required=True, type=Path)
    ap.add_argument("--etf-db", required=True, type=Path)
    ap.add_argument("--store", required=True, type=Path)
    a = ap.parse_args(argv)
    store = build_store(a.audit, a.etf_db, a.store)
    from fastapi.testclient import TestClient

    from api.main import app

    w = serve(store)
    try:
        client = TestClient(app)
        write("pipeline.json", get(client, "/pipeline"))
    finally:
        w.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
