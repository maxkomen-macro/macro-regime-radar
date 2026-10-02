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

desk/cap-weight: the cap-weighted answers read share counts as the full
refresh stores them (src/market_data/share_counts.py, Yahoo's quote summary
checked against its market cap), fetched once into the cache with the New
York date of the fetch, and basket-shares.json is the /basket/shares answer
over those counts.

Each basket file is `{"note", "answers": {<request key>: <payload>}}`, the key
being the request the page makes: `legs|method|notional`, the legs as the page
writes them (the saved weights' digits, in the basket's order; tickers alone
for a cap-weighted basket, whose key ends `|cap`).
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
# The requests the fixtures answer: the AI Infrastructure 10 preset cap-weighted (its default since
# desk/cap-weight) and at equal weight, each held and rebalanced monthly, and the sample basket.
REQUESTS = [
    ([(s, None) for s in PRESET], "hold", "1000000"),
    ([(s, None) for s in PRESET], "monthly", "1000000"),
    ([(s, "10") for s in PRESET], "hold", "1000000"),
    ([(s, "10") for s in PRESET], "monthly", "1000000"),
    (list(SAMPLE), "hold", "1000000"),
]


def request_key(legs: list[tuple[str, str | None]], method: str, notional: str) -> str:
    """The page's request as the fixture resolver keys it (web/src/fixtures/desk/index.ts `basketKey`)."""
    cap = all(w is None for _, w in legs)
    text = ",".join(s if w is None else f"{s}:{w}" for s, w in legs)
    return f"{text}|{method}|{notional}" + ("|cap" if cap else "")


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


# The quote-summary fields the share-count check reads (src/market_data/share_counts.checked_count).
INFO_FIELDS = ("sharesOutstanding", "impliedSharesOutstanding", "marketCap", "regularMarketPrice", "currentPrice",
               "previousClose", "currency")


def share_counts(symbols: list[str], cache: Path | None) -> dict[str, dict]:
    """The stored counts the full refresh would write for `symbols`: Yahoo's quote summary through the
    refresh's own check, dated the New York day it was fetched. Kept in `cache` under "_share_counts", so
    the counts, like the closes, are one download."""
    from datetime import datetime, timezone

    from api.calendar import NY
    from src.market_data import share_counts as sc

    saved = json.loads(cache.read_text()) if cache and cache.exists() else {}
    keep = saved.get("_share_counts") or {"fetched": None, "info": {}}
    for s in symbols:
        if s not in keep["info"]:
            info = sc.yahoo_info(s)
            keep["info"][s] = {k: info.get(k) for k in INFO_FIELDS}
            keep["fetched"] = datetime.now(timezone.utc).astimezone(NY).date().isoformat()
    if cache:
        saved["_share_counts"] = keep
        cache.write_text(json.dumps(saved))
    out = {}
    for s in symbols:
        n, note = sc.checked_count(s, keep["info"][s])
        out[s] = {"shares_outstanding": n, "as_of": keep["fetched"], "source": sc.SOURCE}
        print(f"{s}: {n:,.0f} shares" + (f" ({note})" if note else ""))
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
    counts = share_counts(list(PRESET), args.cache)
    note = (f"Real closes: Yahoo daily history through {args.through}, priced by api/desk_basket's own functions "
            "(scripts/desk_basket_fixture.py). The API prices from EODHD. Cap-weighted answers read Yahoo's share "
            f"counts as the full refresh stores them, read {counts[PRESET[0]]['as_of']}.")
    prices, hedges = {}, {}
    for legs, method, notional in REQUESTS:
        key = request_key(legs, method, notional)
        cap = all(w is None for _, w in legs)
        parsed = [(s, None if w is None else float(w)) for s, w in legs]
        with_counts = {"counts": {s: counts[s] for s, _ in legs}} if cap else {}
        prices[key] = db.price_answer(hist, parsed, method, float(notional), provider="Yahoo", source=SOURCE, **with_counts)
        hedges[key] = db.hedge_answer(hist, parsed, method, float(notional), provider="Yahoo", source=SOURCE, **with_counts)
    (OUT / "basket-price.json").write_text(json.dumps({"note": note, "answers": prices}, separators=(",", ":"), allow_nan=False) + "\n")
    print("wrote basket-price.json")
    if hedges:
        (OUT / "basket-hedge.json").write_text(json.dumps({"note": note, "answers": hedges}, separators=(",", ":"), allow_nan=False) + "\n")
        print("wrote basket-hedge.json")
    # §12.18: the stored counts, as /basket/shares serves them.
    shares = {"provider": db.counts_provider(counts.values()), "source": db.COUNTS_SOURCE,
              "counts_as_of": min(c["as_of"] for c in counts.values()),
              "counts": [{"symbol": s, **counts[s]} for s in sorted(counts)], "excluded": []}
    (OUT / "basket-shares.json").write_text(json.dumps(shares, indent=1, allow_nan=False) + "\n")
    print("wrote basket-shares.json")


if __name__ == "__main__":
    main()
