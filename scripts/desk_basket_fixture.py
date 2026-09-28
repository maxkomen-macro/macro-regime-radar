"""Write Basket & Hedge's fixtures (desk/books) from real prices.

    python scripts/desk_basket_fixture.py [--through 2026-09-23]

The routes price from EODHD (api/providers/market.daily_bars), whose token
lives only on the API host. This script prices the fixture baskets through the
same pure functions the routes run (api/desk_basket.price_answer and
hedge_answer) from Yahoo's daily history instead: two years of adjusted closes
with volume, cut at the fixture world's last session (2026-09-23, the audit
store's; web/src/fixtures/desk/PROVENANCE.md). The numbers are real closes run
through the served engine; they differ from what EODHD would give only by the
two providers' adjustments. A developer tool: it never runs in the API process,
and it writes only web/src/fixtures/desk/basket-*.json.

Each file is `{"note", "answers": {<request key>: <payload>}}`, the key being
the request the page makes: `legs|method|notional`, the legs as the page
writes them (the saved weights' digits, in the basket's order).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUT = ROOT / "web" / "src" / "fixtures" / "desk"
# What the fixture answers say of their closes: Yahoo's, run through the served engine.
SOURCE = "Yahoo daily bars, split- and dividend-adjusted (fixture; the API prices from EODHD)"
PRESET = ("NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS")
SAMPLE = (("NVDA", "22"), ("AVGO", "16"), ("VRT", "14"), ("CRWV", "12"), ("ANET", "12"), ("CEG", "12"), ("SMCI", "12"))
# The requests the fixtures answer: the AI Infrastructure 10 preset both ways, and the sample basket.
REQUESTS = [
    ([(s, "10") for s in PRESET], "hold", "1000000"),
    ([(s, "10") for s in PRESET], "monthly", "1000000"),
    (list(SAMPLE), "hold", "1000000"),
]


def request_key(legs: list[tuple[str, str]], method: str, notional: str) -> str:
    return f"{','.join(f'{s}:{w}' for s, w in legs)}|{method}|{notional}"


def yahoo(symbols: list[str], through: str, cache: Path | None = None) -> dict:
    """Two years and a margin of Yahoo daily bars per symbol, through `through`.
    Yahoo re-adjusts its closes on every download (the 7th digit moves), so
    `cache` (a JSON file outside the repo) keeps one download: when it holds a
    symbol, that is used; otherwise the symbol is downloaded and added."""
    from src.desk import basket as bk

    saved = json.loads(cache.read_text()) if cache and cache.exists() else {}
    out = {}
    for s in symbols:
        if s not in saved:
            import yfinance as yf

            df = yf.download(s, period="2y", interval="1d", auto_adjust=False, progress=False, threads=False)
            if df.empty:
                raise SystemExit(f"Yahoo returned nothing for {s}")
            df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
            rows = []
            for ts, row in df.iterrows():
                adj, raw, vol = float(row["Adj Close"]), float(row["Close"]), float(row["Volume"])
                rows.append([ts.strftime("%Y-%m-%d"), adj, raw, vol])
            saved[s] = rows
        dates, close, dv = [], [], []
        for d, adj, raw, vol in saved[s]:
            if d > through or not (math.isfinite(adj) and adj > 0):
                continue
            dates.append(d)
            close.append(adj)
            dv.append(raw * vol if math.isfinite(raw) and math.isfinite(vol) and vol > 0 else None)
        out[s] = bk.History(tuple(dates), tuple(close), tuple(dv))
        print(f"{s}: {dates[0]} → {dates[-1]} ({len(dates)} sessions)")
    if cache:
        cache.write_text(json.dumps(saved))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--through", default="2026-09-23")
    ap.add_argument("--cache", type=Path, default=None, help="a JSON file outside the repo that keeps one Yahoo download")
    args = ap.parse_args()
    from api import desk_basket as db

    symbols = sorted({s for legs, _, _ in REQUESTS for s, _ in legs} | {sym for sym, _ in db.BENCHMARKS.values()}
                     | set(getattr(db, "HEDGE_ETFS", ())))
    hist = yahoo(symbols, args.through, args.cache)
    note = (f"Real closes: Yahoo daily history through {args.through}, priced by api/desk_basket's own functions "
            "(scripts/desk_basket_fixture.py). The API prices from EODHD.")
    prices, hedges = {}, {}
    for legs, method, notional in REQUESTS:
        key = request_key(legs, method, notional)
        parsed = [(s, float(w)) for s, w in legs]
        prices[key] = db.price_answer(hist, parsed, method, float(notional), provider="Yahoo", source=SOURCE)
        if hasattr(db, "hedge_answer"):
            hedges[key] = db.hedge_answer(hist, parsed, method, float(notional), provider="Yahoo", source=SOURCE)
    (OUT / "basket-price.json").write_text(json.dumps({"note": note, "answers": prices}, separators=(",", ":"), allow_nan=False) + "\n")
    print("wrote basket-price.json")
    if hedges:
        (OUT / "basket-hedge.json").write_text(json.dumps({"note": note, "answers": hedges}, separators=(",", ":"), allow_nan=False) + "\n")
        print("wrote basket-hedge.json")


if __name__ == "__main__":
    main()
