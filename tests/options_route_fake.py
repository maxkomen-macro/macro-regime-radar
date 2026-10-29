"""A fake EODHD and a fake Finnhub for the Options Finder's route tests (design F3 §8).

Both answer at the HTTP transport, so every request goes through the real clients, caches, slots and
the scanner. The chains are tests/options_synth.py's invented ones, served in EODHD's marketplace
shape (`data[].attributes`, `links.next`, `volatility` rather than `implied_vol`); no provider data is
in the repository.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from api.calendar import is_trading_day
from tests import options_synth as syn

NOW = datetime(2026, 10, 24, 14, 0, tzinfo=timezone.utc)  # a Saturday: the newest completed session is Oct 23
STAMP = "2026-10-24 00:30:00"  # overnight after the Oct 23 close: names Oct 23 read as UTC or New York time


def stamp_for(session: date) -> str:
    """An overnight stamp after `session`'s close (00:30 the next calendar day)."""
    return f"{session + timedelta(days=1):%Y-%m-%d} 00:30:00"


def provider_row(r: dict, root: str = "SYN", stamp: str = STAMP) -> dict:
    """One synthetic engine row as EODHD's marketplace serves it."""
    bid, ask = r["bid"], r["ask"]
    exp = date.fromisoformat(r["exp_date"])
    a = {"contract": r["contract"], "underlying_symbol": root, "exp_date": r["exp_date"], "expiration_type": "monthly",
         "type": r["type"], "strike": r["strike"], "bid": bid, "bid_date": stamp, "ask": ask, "ask_date": stamp,
         "last": round((bid + ask) / 2, 2), "midpoint": round((bid + ask) / 2, 4), "volume": 25,
         "open_interest": r["open_interest"], "volatility": r["_sigma"], "delta": 0.5, "gamma": 0.01, "theta": -0.02,
         "vega": 0.1, "rho": 0.05, "moneyness": 0.0, "tradetime": "2026-10-23 15:59:00",
         "dte": (exp - syn.SESSION).days}
    return {"id": r["contract"], "type": "options-contracts", "attributes": a}


def sessions(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


class FakeEodhd:
    """EODHD's daily bars, dividends, splits and options contracts for a few invented listings.

    `inclusive` says how the fake reads exp_date_from/exp_date_to (both ends together); `page_cap`
    lowers the page size it honours, so paging can be exercised on a small chain."""

    def __init__(self, chains: dict[str, list[dict]], closes: dict[str, dict[date, float]], *,
                 dividends: dict[str, list[dict]] | None = None, inclusive: bool = True, page_cap: int | None = None):
        self.chains = chains
        self.closes = closes
        self.dividends = dividends or {}
        self.inclusive = inclusive
        self.page_cap = page_cap
        self.calls: list[tuple[str, dict]] = []
        self.fail: dict[str, int] = {}  # path prefix → HTTP status to answer instead
        self.empty_fill = False  # answer every exact-expiry query with no rows (a provider contradiction)
        self.before_contracts: Any = None  # called with the call count before each contracts answer

    def contracts_calls(self) -> list[dict]:
        return [p for path, p in self.calls if path.endswith("/options/contracts")]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        p = dict(request.url.params)
        p.pop("api_token", None)
        self.calls.append((path, p))
        for prefix, status in self.fail.items():
            if path.startswith(prefix):
                return httpx.Response(status, text="fake failure")
        if path.startswith("/api/eod/"):
            sym = path.rsplit("/", 1)[1].split(".")[0]
            if sym not in self.closes:
                return httpx.Response(404, text="not found")
            return httpx.Response(200, json=[{"date": d.isoformat(), "open": c, "high": c, "low": c, "close": c,
                                              "adjusted_close": c, "volume": 1_000_000}
                                             for d, c in sorted(self.closes[sym].items())])
        if path.startswith("/api/div/"):
            sym = path.rsplit("/", 1)[1].split(".")[0]
            return httpx.Response(200, json=[{"date": d["ex_date"], "value": d["amount"], "unadjustedValue": d["amount"],
                                              "currency": "USD", "period": d.get("period"),
                                              "declarationDate": d.get("declared_on"), "recordDate": None,
                                              "paymentDate": None} for d in self.dividends.get(sym, [])])
        if path.startswith("/api/splits/"):
            return httpx.Response(200, json=[])
        if path.startswith("/api/real-time/"):
            code = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"code": code, "timestamp": 1761336000, "close": 400.0, "previousClose": 398.0,
                                             "change_p": 0.5, "low": 395.0, "high": 401.0, "volume": 1000})
        if path.startswith("/api/search/"):
            code = path.rsplit("/", 1)[1]
            return httpx.Response(200, json=[{"Code": code, "Exchange": "US", "Name": f"{code} Corp", "Type": "Common Stock",
                                              "Country": "USA", "Currency": "USD", "isPrimary": True}])
        if path == "/api/mp/unicornbay/options/contracts":
            if self.before_contracts is not None:
                self.before_contracts(len(self.contracts_calls()))
            if self.empty_fill and "filter[exp_date_eq]" in p:
                return httpx.Response(200, json={"data": [], "links": {"next": None}, "meta": {"total": None}})
            return httpx.Response(200, json=self._contracts(p))
        return httpx.Response(404, text="no such fake path")

    def _contracts(self, p: dict) -> dict:
        rows = [r["attributes"] for r in self.chains.get(p.get("filter[underlying_symbol]"), [])]
        fields = p.get("fields[options-contracts]")
        if fields and "tradetime" in fields and "filter[type]" not in p:
            # F1's expirations list is read at the real clock; the fake lists every expiry to it, one row each.
            seen, out = set(), []
            for a in sorted(rows, key=lambda a: a["exp_date"]):
                if a["exp_date"] not in seen:
                    seen.add(a["exp_date"])
                    out.append(a)
            return {"data": [{"attributes": {k: a.get(k) for k in fields.split(",")}} for a in out],
                    "links": {"next": None}, "meta": {"total": None}}
        if "filter[type]" in p:
            rows = [a for a in rows if a["type"] == p["filter[type]"]]
        if "filter[strike_from]" in p:
            rows = [a for a in rows if a["strike"] >= float(p["filter[strike_from]"])]
        if "filter[strike_to]" in p:
            rows = [a for a in rows if a["strike"] <= float(p["filter[strike_to]"])]
        if "filter[exp_date_eq]" in p:
            rows = [a for a in rows if a["exp_date"] == p["filter[exp_date_eq]"]]
        lo, hi = p.get("filter[exp_date_from]"), p.get("filter[exp_date_to]")
        if lo:
            rows = [a for a in rows if (a["exp_date"] >= lo if self.inclusive else a["exp_date"] > lo)]
        if hi:
            rows = [a for a in rows if (a["exp_date"] <= hi if self.inclusive else a["exp_date"] < hi)]
        key = (lambda a: (a["strike"], a["contract"])) if p.get("sort") == "strike" else \
              (lambda a: (a["exp_date"], a["strike"], a["contract"]))
        rows.sort(key=key)
        limit = int(p.get("page[limit]", 100))
        if self.page_cap:
            limit = min(limit, self.page_cap)
        off = int(p.get("page[offset]", 0))
        page = rows[off:off + limit]
        if fields:
            page = [{k: a.get(k) for k in fields.split(",")} for a in page]
        nxt = "https://eodhd.com/api/mp/unicornbay/options/contracts?page[offset]=next" if off + limit < len(rows) else None
        return {"data": [{"id": a.get("contract"), "type": "options-contracts", "attributes": a} for a in page],
                "links": {"next": nxt}, "meta": {"offset": off, "limit": limit, "total": None}}


class FakeFinnhub:
    def __init__(self, items: dict[str, list[dict]] | None = None, status: int = 200):
        self.items = items or {}
        self.status = status
        self.calls: list[tuple[str, dict, str | None]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        p = dict(request.url.params)
        self.calls.append((request.url.path, p, request.headers.get("X-Finnhub-Token")))
        if self.status != 200:
            return httpx.Response(self.status, text="fake failure")
        if request.url.path.endswith("/calendar/earnings"):
            return httpx.Response(200, json={"earningsCalendar": self.items.get(p.get("symbol"), [])})
        if request.url.path.endswith("/stock/profile2"):
            return httpx.Response(200, json={"ticker": p.get("symbol"), "name": f"{p.get('symbol')} Inc",
                                             "marketCapitalization": 1000.0, "finnhubIndustry": "Technology",
                                             "currency": "USD"})
        if request.url.path.endswith("/stock/metric"):
            return httpx.Response(200, json={"symbol": p.get("symbol"), "metric": {"52WeekLow": 1.0, "52WeekHigh": 2.0}})
        return httpx.Response(404, text="no such fake path")


def store(path: Path, *, curve: dict[str, list[tuple[str, float]]] | None = None, macro: list[tuple[str, str]] = (),
          earnings: list[tuple[str, str, str]] = (), newest_market: str = "2026-10-23", tables: bool = True) -> Path:
    """A hermetic store: desk_series (the Treasury tenors), event_calendar (macro and earnings rows) and
    market_daily (its newest date)."""
    curve = syn.CURVE_ROWS if curve is None else curve
    with sqlite3.connect(path) as c:
        if not tables:
            c.execute("CREATE TABLE t (x)")
            return path
        c.execute("CREATE TABLE desk_series (series_id TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL, "
                  "provider TEXT NOT NULL, run_id TEXT, ingested_at TEXT, PRIMARY KEY (series_id, date)) WITHOUT ROWID")
        for s, rows in curve.items():
            c.executemany("INSERT INTO desk_series VALUES (?, ?, ?, 'fred', NULL, NULL)", [(s, d, v) for d, v in rows])
        c.execute("CREATE TABLE event_calendar (id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, "
                  "event_datetime TEXT NOT NULL, importance TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual_csv', "
                  "created_at TEXT NOT NULL, symbol TEXT, kind TEXT)")
        c.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at) "
                      "VALUES (?, ?, 'high', 'manual_csv', '2026-10-01')", list(macro))
        c.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                      "VALUES (?, ?, 'medium', 'finnhub_earnings', '2026-10-01', ?, 'earnings')",
                      [(name, at, sym) for sym, at, name in earnings])
        c.execute("CREATE TABLE market_daily (date TEXT, symbol TEXT, close REAL)")
        c.execute("INSERT INTO market_daily VALUES (?, 'SPY', 1.0)", (newest_market,))
    return path


def dump(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, default=str)
