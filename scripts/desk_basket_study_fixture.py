"""Write Basket & Hedge's event-study fixture (desk P1a, §12.19) from stored closes.

    python scripts/desk_basket_study_fixture.py --db data/macro_radar.db [--through 2026-09-23]

The route reads each name's EODHD daily closes since 1995, whose token lives
only on the API host. This script runs the route's own functions
(api/desk_basket._study_job, then study_projection) on closes already stored
in the database the full refresh publishes: `asset_prices`, Yahoo's adjusted
daily closes, cut at the fixture world's last session (2026-09-23,
web/src/fixtures/desk/PROVENANCE.md). Nothing is downloaded. The engine runs
on a read-only copy of that database, so the regime labels are its regimes
table (revised history). The numbers are real closes through the served engine;
they differ from what EODHD would give only by the two providers' adjustments.

Only ETF baskets can be answered this way: the stored closes are the refresh's
ETFs and indices, so the preset's names (NVDA, CRWV, ...) have no fixture and
the fixture server answers 404 for them, never a made-up study. A developer
tool: it never runs in the API process, and it writes only
web/src/fixtures/desk/basket-study.json.

The file is `{"note", "answers": {<request query>: <payload>}}`, the key being
the request the page makes with its parameters in name order (the fixture
resolver's `sortedQuery`).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUT = ROOT / "web" / "src" / "fixtures" / "desk" / "basket-study.json"
SOURCE = "Yahoo daily closes stored by the full refresh (asset_prices), split- and dividend-adjusted (fixture; the API reads EODHD)"
# The requests the fixture answers: a semiconductor and technology ETF basket, held and rebalanced monthly, at the
# route's default question (a 2σ fall over 5 sessions, a month later).
REQUESTS = [
    ([("SMH", 40.0), ("SOXX", 30.0), ("XLK", 30.0)], "hold"),
    ([("SMH", 40.0), ("SOXX", 30.0), ("XLK", 30.0)], "monthly"),
]


def request_key(legs: list[tuple[str, float]], method: str) -> str:
    """The page's request, its parameters in name order (web/src/fixtures/desk/index.ts `sortedQuery`)."""
    text = ",".join(f"{s}:{w:g}" for s, w in legs)
    return "&".join(f"{k}={v}" for k, v in sorted({"legs": text, "method": method}.items()))


def stored(db: Path, symbols: list[str], through: str) -> dict:
    """Each symbol's stored adjusted daily closes through `through`, as the route's History (no traded close:
    a target-weighted basket never reads one)."""
    from src.desk import basket as bk

    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        out = {}
        for s in symbols:
            rows = conn.execute("SELECT date, close FROM asset_prices WHERE symbol = ? AND interval = '1d' AND date <= ? "
                                "AND close > 0 ORDER BY date", (s, through)).fetchall()
            if not rows:
                raise SystemExit(f"{s}: no stored closes")
            h = bk.History(tuple(r[0] for r in rows), tuple(float(r[1]) for r in rows), tuple([None] * len(rows)),
                           tuple([None] * len(rows)))
            object.__setattr__(h, "unadjusted", 0)
            out[s] = h
            print(f"{s}: {rows[0][0]} → {rows[-1][0]} ({len(rows)} closes)")
        return out
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "macro_radar.db")
    ap.add_argument("--through", default="2026-09-23")
    ap.add_argument("--as-of", default="2026-09-24", help="the generation's as-of (the fixture world's)")
    args = ap.parse_args()
    from api import desk_basket as db

    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "copy.db"
        shutil.copyfile(args.db, copy)
        gen = SimpleNamespace(id="gen-fixture-2026-09-24", key="gen-fixture-2026-09-24", as_of=args.as_of,
                              uri=f"file:{copy}?mode=ro")
        answers = {}
        for legs, method in REQUESTS:
            hist = stored(copy, [s for s, _ in legs], args.through)
            item = db._study_job(gen, args.as_of, legs, method, "target", None, db.STUDY_DEFAULTS["window"],
                                 db.STUDY_DEFAULTS["move"], provider="Yahoo", source=SOURCE, histories=hist,
                                 session=args.through)
            payload = db.study_projection(item, legs, method, "target", db.STUDY_DEFAULTS["window"],
                                          db.STUDY_DEFAULTS["move"], db.STUDY_DEFAULTS["horizon"])
            payload["elapsed_ms"] = 300.0
            if payload["study"] is not None:
                payload["study"]["provenance"]["engine_version"] = "fixture"
            answers[request_key(legs, method)] = payload
            s = payload["study"]
            print(request_key(legs, method), "→", payload["not_run"] or f"{s['matched_n']} events, {s['verdict']}")
    note = (f"Real closes: Yahoo's adjusted daily closes stored in asset_prices through {args.through}, run through "
            "api/desk_basket's own study functions on a copy of the published database (scripts/desk_basket_study_fixture.py). "
            "The API reads EODHD. elapsed_ms is set to 300 and engine_version to 'fixture'.")
    OUT.write_text(json.dumps({"note": note, "answers": answers}, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
