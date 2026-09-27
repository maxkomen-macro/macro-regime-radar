"""scripts/desk_usability_fixtures.py — the Desk fixtures desk/usability adds (item 2).

Writes, under web/src/fixtures/desk/, from the real functions the API serves:
- technicals.json: the S&P 500 fixture's §14.2 fields (symbol, name,
  scored, drawdown, realized_vol, rs), computed by the shared technicals
  function on the given store's ^GSPC closes; the fixture's existing fields
  (main's, desk/fill-compute's RSI, MACD and seasonality included) are kept
  and checked, every one, against the same computation (run it on the
  fixture store of scripts/desk_etf_fixtures.py, PROVENANCE.md);
- technicals-<ETF>.json for each stored ETF named in --etf: the instruments
  item's own answer (its stored closes, relative strength against the stored
  S&P);
- technicals-<SYM>.json for each --stock: two years of EODHD daily candles
  through the provider layer, as /technicals?symbol= asks them (needs
  EODHD_API_TOKEN in the environment; one candles call and one search call
  per symbol), relative strength against the store's S&P;
- with --yahoo-standin instead (no EODHD token on this machine): the same
  function over two years of Yahoo daily adjusted closes (yfinance, keyless,
  run here only, never by the API), the fixture's `source` saying so.

Read-only on the store. Usage:
  python scripts/desk_usability_fixtures.py --db <copy of the audit store> [--etf GLD] [--stock NVDA]
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
NEW = ("symbol", "name", "scored", "drawdown", "realized_vol", "rs")


def _served(t: dict, sectors: dict, **extra) -> dict:
    """A symbol's answer as the route serves it: its figures, the options block deferred, and the S&P's
    sector-leadership block (the same block the S&P's answer carries, desk/fill-etf)."""
    from api import desk_envelope as env
    from api.desk_v2 import TECHNICALS_KEYS

    out = {"excluded_bars": None, **t, **extra, "freq": "daily", "vol": env.block_deferred("/technicals", "vol"), "sectors": sectors}
    return {k: out[k] for k in TECHNICALS_KEYS if k in out}


def _write(name: str, doc: dict) -> None:
    # One line, as the other endpoint fixtures are.
    (OUT / name).write_text(json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    print("wrote", OUT / name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--etf", action="append", default=[])
    ap.add_argument("--stock", action="append", default=[])
    ap.add_argument("--yahoo-standin", action="store_true")
    ap.add_argument("--name", action="append", default=[], help="SYM=Name for a Yahoo stand-in")
    a = ap.parse_args()

    from api import desk_items
    from api.desk_v2 import CANDLES_SOURCE, STOCK_RANGES, stock_technicals
    from src.desk import event_study as es

    es.DB_PATH = Path(a.db)
    spx = desk_items.desk_technicals({})
    assert spx["ok"], spx
    level = spx["_level"]

    fx = json.loads((OUT / "technicals.json").read_text())
    assert fx["date"] == spx["date"], (fx["date"], spx["date"])

    def same(a_, b_) -> bool:
        if isinstance(a_, float) and isinstance(b_, float):
            return math.isclose(a_, b_, rel_tol=1e-9, abs_tol=1e-12)
        if isinstance(a_, dict) and isinstance(b_, dict):
            return a_.keys() == b_.keys() and all(same(a_[k], b_[k]) for k in a_)
        if isinstance(a_, list) and isinstance(b_, list):
            return len(a_) == len(b_) and all(same(x, y) for x, y in zip(a_, b_))
        return a_ == b_

    # Every figure the fixture already carries is the one this store and the shared function give.
    for k in fx:
        if k in spx and k not in NEW:
            assert same(fx[k], spx[k]), k
    fx.update({"symbol": "^GSPC", "name": "S&P 500", "scored": True, "drawdown": spx["drawdown"],
               "realized_vol": spx["realized_vol"], "rs": None})
    _write("technicals.json", fx)  # the fixture's own keys in their order, the new ones after them
    sectors = fx["sectors"]

    if a.etf:
        inst = desk_items.desk_instruments({"desk_technicals": spx})
        names = {r["symbol"]: r["name"] for r in inst["instruments"]}
        for sym in a.etf:
            t = inst["technicals"][sym]
            _write(f"technicals-{sym}.json", _served(t, sectors, symbol=sym, name=names[sym], scored=False, source=f"asset_prices {sym}",
                                                     move_20d_sigma=None, move_20d_date=None, signals_allowlist=[]))
    names_given = dict(x.split("=", 1) for x in a.name)
    for sym in a.stock:
        if a.yahoo_standin:
            import pandas as pd
            import yfinance as yf

            from api.desk_items import technicals_from_level
            from src.desk.technicals import PRICE_SPEC

            h = yf.Ticker(sym).history(period="2y", interval="1d", auto_adjust=True)
            closes = pd.Series(h["Close"].to_numpy(dtype=float), index=pd.DatetimeIndex([d.strftime("%Y-%m-%d") for d in h.index]))
            closes = closes[closes.index <= pd.Timestamp(spx["date"])]  # the fixture world ends with the audit's store
            src = "Yahoo daily closes (fixture stand-in for EODHD 2Y candles)"
            t = technicals_from_level(closes, spec=PRICE_SPEC, ranges=STOCK_RANGES, bench=level, source=src)
            t.pop("_sessions")
            _write(f"technicals-{sym}.json", _served(t, sectors, symbol=sym, name=names_given.get(sym, sym), scored=False,
                                                     source=src,
                                                     move_20d_sigma=None, move_20d_date=None, signals_allowlist=[]))
            continue
        t, name = stock_technicals(sym, level)
        assert set(t["series"]) == set(STOCK_RANGES)
        _write(f"technicals-{sym}.json", _served(t, sectors, symbol=sym, name=name, scored=False, source=CANDLES_SOURCE,
                                                 move_20d_sigma=None, move_20d_date=None, signals_allowlist=[]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
