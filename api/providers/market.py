"""Market-data orchestration, FRED never routed here (2026-09-06).

On-demand symbol lookups (search, profile, candles, corporate actions,
options, ticks) are EODHD only: the API process never calls Yahoo
(fix/prelaunch-1). When EODHD cannot answer, the caller gets a typed,
disclosed error ({detail, kind, provider, retryable}) instead of a silent
second source. Yahoo survives in exactly one place, daily_history(...,
allow_yahoo=True), which only the refresh pipeline calls to store
allocation's price histories, and which says in its envelope which provider
supplied each series.

Every function returns a normalized envelope carrying provider, fetched_at,
market timestamp, live/delayed, fallback_used and fallback_reason. A series
never mixes providers, retries are bounded in the client, caches are keyed
single-flight with TTL and size limits, and nothing here writes to SQLite.
"""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from api.providers import eodhd as eod
from api.providers import finnhub as fh
from api.providers import quota
from api.providers import entitlements
from api.providers import yf
from api.providers.cache import KeyedTTLCache
from api.providers.errors import (
    EmptyResult,
    MissingToken,
    ProviderError,
    RateLimited,
    Unauthorized,
    UnknownSymbol,
    UnsupportedInstrument,
)
from api.providers.symbols import Instrument, SymbolError, from_eodhd_hit, parse

log = logging.getLogger("mrr.providers.market")

# ── configuration ─────────────────────────────────────────────────────────────


def _load_token() -> str | None:
    """EODHD_API_TOKEN from the environment, else the repo-root .env (the same
    rule api/stream.py uses). Never logged, never returned to a client."""
    tok = os.environ.get("EODHD_API_TOKEN")
    if tok:
        return tok.strip() or None
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("EODHD_API_TOKEN=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    except OSError:
        pass
    return None


_client: eod.EodhdClient | None = None


def client() -> eod.EodhdClient:
    global _client
    if _client is None:
        _client = eod.EodhdClient(_load_token())
    return _client


def set_client_for_tests(c: eod.EodhdClient | None) -> None:
    global _client
    _client = c
    clear_caches()


# Upstream concurrency ceiling: the FastAPI worker pool must never be eaten by
# provider round trips. Non-blocking acquire → callers get RateLimited fast.
_slots = threading.BoundedSemaphore(int(os.environ.get("PROVIDER_MAX_CONCURRENCY", "8")))


def _with_slot(fn: Callable[[], Any]) -> Any:
    if not _slots.acquire(blocking=False):
        raise RateLimited("api", "The market-data layer is busy; retry in a moment.")
    try:
        return fn()
    finally:
        _slots.release()


# ── caches (bounded, single-flight) ───────────────────────────────────────────

_search_cache = KeyedTTLCache(3600.0, 256)
_identity_cache = KeyedTTLCache(24 * 3600.0, 512)
_profile_cache = KeyedTTLCache(45.0, 256)
_candles_cache = KeyedTTLCache(900.0, 512)
_actions_cache = KeyedTTLCache(6 * 3600.0, 256)
_exp_cache = KeyedTTLCache(3600.0, 128)
_chain_cache = KeyedTTLCache(900.0, 256)
_ticks_cache = KeyedTTLCache(30.0, 64)
# Fundamentals change at most once a day; the quote beside them refreshes
# every 45 s, so they get their own long-lived cache (launch-1). A failure is
# remembered only briefly, so an outage does not blank the panel for half a day.
FUNDAMENTALS_TTL = 12 * 3600.0
FUNDAMENTALS_RETRY_TTL = 300.0
_fundamentals_cache = KeyedTTLCache(FUNDAMENTALS_TTL, 512)
RANGE_TTL = {"1D": 60.0, "5D": 120.0, "1M": 300.0}
_RANGE_TTL = RANGE_TTL
# The profile's two EODHD calls (delayed quote, identity from the search
# index) run side by side (fix/prelaunch-1, 4d); created on first use.
_pool: ThreadPoolExecutor | None = None
_pool_lock = threading.Lock()


def _executor() -> ThreadPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="mrr-provider")
        return _pool


def clear_caches() -> None:
    for c in (_search_cache, _identity_cache, _profile_cache, _candles_cache, _actions_cache, _exp_cache, _chain_cache, _ticks_cache, _fundamentals_cache):
        c.clear()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts_iso(unix_seconds: float | int | None) -> str | None:
    if unix_seconds is None:
        return None
    return datetime.fromtimestamp(float(unix_seconds), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _f(x: Any) -> float | None:
    if x is None or x == "":
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if v != v else v


# ── candle ranges ─────────────────────────────────────────────────────────────

RANGES: dict[str, dict[str, Any]] = {
    "1D": {"kind": "intraday", "interval": "5m", "lookback_days": 4, "yf": ("1d", "5m"), "session_only": True},
    "5D": {"kind": "intraday", "interval": "5m", "lookback_days": 9, "yf": ("5d", "15m")},
    "1M": {"kind": "intraday", "interval": "1h", "lookback_days": 32, "yf": ("1mo", "1h")},
    "6M": {"kind": "eod", "period": "d", "lookback_days": 183, "yf": ("6mo", "1d")},
    "1Y": {"kind": "eod", "period": "d", "lookback_days": 366, "yf": ("1y", "1d")},
    "5Y": {"kind": "eod", "period": "w", "lookback_days": 1830, "yf": ("5y", "1wk")},
    "MAX": {"kind": "eod", "period": "m", "lookback_days": None, "yf": ("max", "1mo")},
}
INTERVAL_LABEL = {"d": "1d", "w": "1wk", "m": "1mo"}


def _eodhd_candles(inst: Instrument, range_key: str) -> tuple[list[dict], str]:
    spec = RANGES[range_key]
    c = client()
    if spec["kind"] == "eod":
        today = datetime.now(timezone.utc).date()
        from_ = (today - timedelta(days=spec["lookback_days"])).isoformat() if spec["lookback_days"] else None
        rows = c.eod(inst.eodhd, from_=from_, to=today.isoformat(), period=spec["period"])
        bars: list[dict] = []
        for r in rows:
            close = _f(r.get("close"))
            date = r.get("date")
            if close is None or not date:
                continue
            adj = _f(r.get("adjusted_close"))
            factor = (adj / close) if (adj and close) else 1.0

            def a(v: Any) -> float | None:
                x = _f(v)
                return round(x * factor, 6) if x is not None else None

            bars.append(
                {
                    "ts": f"{date}T00:00:00Z",
                    "open": a(r.get("open")),
                    "high": a(r.get("high")),
                    "low": a(r.get("low")),
                    "close": round(close * factor, 6),
                    "volume": _f(r.get("volume")),
                }
            )
        return bars, INTERVAL_LABEL[spec["period"]]
    now = int(datetime.now(timezone.utc).timestamp())
    from_ts = now - spec["lookback_days"] * 86400
    rows = c.intraday(inst.eodhd, interval=spec["interval"], from_ts=from_ts, to_ts=now)
    bars = []
    for r in rows:
        close = _f(r.get("close"))
        ts = r.get("timestamp")
        if close is None or ts is None:
            continue
        bars.append(
            {
                "ts": _ts_iso(ts),
                "open": _f(r.get("open")),
                "high": _f(r.get("high")),
                "low": _f(r.get("low")),
                "close": close,
                "volume": _f(r.get("volume")),
            }
        )
    if spec.get("session_only") and bars:
        last_day = bars[-1]["ts"][:10]
        bars = [b for b in bars if b["ts"][:10] == last_day]
    return bars, spec["interval"]


def _candles_compute(inst: Instrument, range_key: str) -> dict:
    """One EODHD fetch of a candle series. EODHD's failure is the answer,
    typed: the API never calls Yahoo (fix/prelaunch-1)."""
    family = "intraday" if RANGES[range_key]["kind"] == "intraday" else "historical"
    blocked = entitlements.is_blocked(family)
    if blocked is not None:
        raise Unauthorized(eod.PROVIDER, blocked.reason, status=blocked.status)
    try:
        bars, interval = _with_slot(lambda: _eodhd_candles(inst, range_key))
    except ProviderError as exc:
        if exc.kind in ("unauthorized", "missing_token"):
            entitlements.record_live(family, False, exc.status, f"{exc.kind}: {exc.public}")
        if exc.kind == "unknown_symbol":
            raise UnknownSymbol("api", f"No listing found for '{inst.canonical}' on EODHD.", status=exc.status, detail=repr(exc)) from exc
        raise
    entitlements.record_live(family, True, 200, "ok")
    if not bars:
        raise EmptyResult(eod.PROVIDER, f"EODHD holds no {range_key} bars for {inst.canonical}.")
    return _series(inst, range_key, bars, interval, eod.PROVIDER, None, None)


def candles(symbol: str, range_key: str) -> dict:
    """OHLCV bars for one symbol over a named range, from EODHD."""
    if range_key not in RANGES:
        raise KeyError(range_key)
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc
    ttl = RANGE_TTL.get(range_key, 900.0)
    return _candles_cache.get(f"{inst.canonical}:{range_key}", lambda: _candles_compute(inst, range_key), ttl=ttl)


def refresh_candles(symbol: str, range_key: str, margin_s: float) -> bool:
    """Prefetch (fix/prelaunch-1, 4d): fetch one candle series into the cache
    when it is missing or within margin_s of expiring, so a visitor's request
    for a fixed symbol finds it warm. True when it fetched."""
    inst = parse(symbol)
    key = f"{inst.canonical}:{range_key}"
    age = _candles_cache.age(key)
    if age is not None and age < RANGE_TTL.get(range_key, 900.0) - margin_s:
        return False
    _candles_cache.put(key, _candles_compute(inst, range_key))
    return True


def daily_history(eodhd_code: str | None, yahoo_code: str, start: str, end: str | None = None, *, allow_yahoo: bool = False) -> dict:
    """Full daily adjusted-close history for one series, for the refresh
    pipeline's stored histories (src/market_data/asset_history.py): EODHD
    first where it carries the instrument, Yahoo only when the caller allows
    it, one provider per series, the envelope saying which. The API never
    calls this."""
    primary_err: ProviderError
    if eodhd_code is None:
        primary_err = UnsupportedInstrument(eod.PROVIDER, f"EODHD does not carry {yahoo_code}.")
    elif entitlements.is_blocked("historical") is not None:
        primary_err = Unauthorized(eod.PROVIDER, "Historical prices are not in the EODHD plan on this server.")
    else:
        try:
            raw = client().eod(eodhd_code, from_=start, to=end, period="d")
            rows = []
            for r in raw:
                d = r.get("date")
                adj = _f(r.get("adjusted_close"))
                if adj is None:
                    adj = _f(r.get("close"))
                if d and adj is not None and adj > 0:
                    rows.append((str(d)[:10], adj))
            if not rows:
                raise EmptyResult(eod.PROVIDER, f"EODHD holds no daily history for {eodhd_code}.")
            return {"provider": eod.PROVIDER, "fallback_used": False, "fallback_reason": None, "rows": rows}
        except ProviderError as exc:
            primary_err = exc
    if not allow_yahoo:
        raise primary_err
    rows = yf.daily_closes(yahoo_code, start, end)
    if not rows:
        raise EmptyResult(yf.PROVIDER, f"No daily history for {yahoo_code} from either provider.")
    return {"provider": yf.PROVIDER, "fallback_used": True, "fallback_reason": primary_err.kind, "rows": rows}


def _series(inst: Instrument, range_key: str, bars: list[dict], interval: str, provider: str, fallback_used: bool | None, reason: str | None) -> dict:
    return {
        "symbol": inst.canonical,
        "provider": provider,
        "fallback_used": bool(fallback_used),
        "fallback_reason": reason,
        "fetched_at": _now_iso(),
        "market_ts": bars[-1]["ts"] if bars else None,
        "delayed": True,  # REST history is never a live feed
        "interval": interval,
        "range": range_key,
        "exchange": inst.exchange,
        "timezone": "America/New_York" if inst.exchange == "US" else ("UTC" if inst.kind in ("crypto", "forex") else None),
        "adjustment": "split_dividend_adjusted",
        "count": len(bars),
        "bars": bars,
    }


# ── search ────────────────────────────────────────────────────────────────────

_TYPE_WORDS = {"Common Stock": "Equity", "ETF": "ETF", "FUND": "Fund", "Index": "Index", "Currency": "FX", "Crypto": "Crypto"}


def search(q: str, limit: int = 10) -> dict:
    query = q.strip()
    key = query.lower()

    def compute() -> dict:
        primary_err: ProviderError | None = None
        if entitlements.is_blocked("search") is None:
            try:
                rows = _with_slot(lambda: client().search(query, limit=max(limit, 10)))
                entitlements.record_live("search", True, 200, "ok")
                hits = []
                for r in rows:
                    code, exch = r.get("Code"), r.get("Exchange")
                    if not code:
                        continue
                    try:
                        canon = from_eodhd_hit(str(code), exch)
                    except SymbolError:
                        continue
                    hits.append(
                        {
                            "symbol": canon,
                            "name": r.get("Name") or canon,
                            "exchange": exch,
                            "type": _TYPE_WORDS.get(str(r.get("Type")), r.get("Type")),
                            "sector": None,
                            "country": r.get("Country"),
                            "currency": r.get("Currency"),
                            "primary": bool(r.get("isPrimary", True)),
                        }
                    )
                # Desk relevance: US listings and primary listings first.
                hits.sort(key=lambda h: (h["exchange"] != "US", not h["primary"]))
                return {"provider": eod.PROVIDER, "fallback_used": False, "fallback_reason": None, "fetched_at": _now_iso(), "hits": hits[:limit]}
            except ProviderError as exc:
                primary_err = exc
                if exc.kind in ("unauthorized", "missing_token"):
                    entitlements.record_live("search", False, exc.status, f"{exc.kind}: {exc.public}")
        else:
            primary_err = Unauthorized(eod.PROVIDER, "Symbol search is not in the EODHD plan on this server.")
        # The API never calls Yahoo (fix/prelaunch-1): EODHD's error is the answer.
        assert primary_err is not None
        raise primary_err

    return _search_cache.get(f"{key}:{limit}", compute)


def _identity(inst: Instrument) -> dict:
    """Name / type / country / currency for one listing via the search index
    (the real-time endpoint carries prices only). Cached a day."""

    def compute() -> dict:
        code = inst.eodhd.split(".")[0]
        try:
            rows = _with_slot(lambda: client().search(code, limit=10, exchange=None if inst.kind != "equity" else inst.exchange))
        except ProviderError:
            return {}
        for r in rows:
            if str(r.get("Code", "")).upper() == code and (inst.kind != "equity" or str(r.get("Exchange", "")).upper() == inst.exchange):
                return {"name": r.get("Name"), "type": _TYPE_WORDS.get(str(r.get("Type")), r.get("Type")), "country": r.get("Country"), "currency": r.get("Currency")}
        return {}

    return _identity_cache.get(inst.canonical, compute)


# ── fundamentals (Finnhub; EODHD's plan has none) ─────────────────────────────


# Types the EODHD identity names that have no company behind them.
_NOT_A_COMPANY = {"ETF", "Fund", "Index", "FX", "Crypto", "Mutual Fund"}


class _NotCached(Exception):
    """Raised through the cache so a local refusal is never stored."""


def _fundamentals(inst: Instrument, type_word: str | None = None) -> tuple[dict, str]:
    """The panel's fundamentals for one listing and what they are:
    ("ok") filled from Finnhub, ("not_covered") nobody publishes company
    fundamentals for it, or ("unavailable") the source did not answer this
    time. Never raises: a fundamentals outage must not take the quote down,
    and it must not tell a visitor that NVDA is not a company (loop 1)."""
    if inst.kind != "equity" or inst.exchange != "US" or (type_word or "") in _NOT_A_COMPANY:
        return {}, "not_covered"  # crypto, FX, indices, funds and foreign lines

    def compute() -> dict:
        try:
            fields = fh.fundamentals(inst.eodhd.split(".")[0])
        except fh.LocalThrottle as exc:
            # Nothing was sent, so nothing was learned: do not remember it.
            raise _NotCached() from exc
        except ProviderError as exc:
            log.info("finnhub fundamentals %s: %s", inst.canonical, exc.kind)
            return {"ok": False, "fields": {}}
        except Exception as exc:  # noqa: BLE001 — never break a quote
            log.warning("finnhub fundamentals %s failed: %s", inst.canonical, type(exc).__name__)
            return {"ok": False, "fields": {}}
        return {"ok": True, "fields": fields}

    try:
        entry = _fundamentals_cache.get(inst.canonical, compute)
        if not entry["ok"]:
            # Re-read the same entry against the short window: a failure older
            # than FUNDAMENTALS_RETRY_TTL is recomputed, a fresh one is not.
            entry = _fundamentals_cache.get(inst.canonical, compute, ttl=FUNDAMENTALS_RETRY_TTL)
    except _NotCached:
        return {}, "unavailable"
    if not entry["ok"]:
        return {}, "unavailable"
    return (entry["fields"], "ok") if entry["fields"] else ({}, "not_covered")


# ── profile (quote + fundamentals) ────────────────────────────────────────────


def profile(symbol: str) -> dict:
    """Delayed quote plus identity for one listing from EODHD, with company
    fundamentals from Finnhub (launch-1). The two EODHD calls (the real-time
    quote and the search-index identity) run concurrently (fix/prelaunch-1,
    4d). The API never fills anything from Yahoo."""
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc

    def compute() -> dict:
        if entitlements.is_blocked("realtime") is not None:
            raise Unauthorized(eod.PROVIDER, "Delayed quotes are not in the EODHD plan on this server.")
        c = client()
        if not c.token:
            raise MissingToken(eod.PROVIDER, "EODHD is not configured on this server.")
        ident_future = _executor().submit(_identity, inst)
        try:
            rows = _with_slot(lambda: c.realtime(inst.eodhd))
        except ProviderError as exc:
            if exc.kind in ("unauthorized", "missing_token"):
                entitlements.record_live("realtime", False, exc.status, f"{exc.kind}: {exc.public}")
            raise
        row = rows[0] if rows else {}
        last = _f(row.get("close"))
        if last is None or str(row.get("code", "")).upper() != inst.eodhd.upper():
            raise UnknownSymbol(eod.PROVIDER, f"EODHD has no quote for '{inst.canonical}'.")
        entitlements.record_live("realtime", True, 200, "ok")
        try:
            ident = ident_future.result(timeout=c.timeout * (c.max_retries + 1) + 2.0)
        except Exception:  # noqa: BLE001 — identity is decoration; the quote stands without it
            ident = {}
        out = {
            "symbol": inst.canonical,
            "name": ident.get("name") or inst.canonical,
            "exchange": inst.exchange,
            "currency": ident.get("currency") or ("USD" if inst.exchange == "US" else None),
            "quote_type": ident.get("type"),
            "sector": None,
            "industry": None,
            "last": last,
            "prev_close": _f(row.get("previousClose")),
            "day_change_pct": _f(row.get("change_p")),
            "day_low": _f(row.get("low")),
            "day_high": _f(row.get("high")),
            "year_low": None,
            "year_high": None,
            "market_cap": None,
            "last_volume": _f(row.get("volume")),
            "avg_volume_3m": None,
            "trailing_pe": None,
            "forward_pe": None,
            "eps_ttm": None,
            "beta": None,
            "dividend_yield": None,
            "price_to_book": None,
            "profit_margin": None,
            "revenue_growth": None,
            "fifty_two_wk_change": None,
            "market_ts": _ts_iso(_f(row.get("timestamp"))),
            "fetched_at": _now_iso(),
            "quote_provider": eod.PROVIDER,
            "delayed": True,
            "delay_note": "EODHD delayed quote (15–20 min for stocks, ~1 min for FX)",
            "fallback_used": False,
            "fallback_reason": None,
            "fundamentals_provider": None,
        }
        # Fundamentals come from Finnhub (launch-1): EODHD's plan has none, and
        # the API never calls Yahoo. Only fields it actually publishes are
        # filled, and the payload names the source on screen.
        fundamentals, status = _fundamentals(inst, ident.get("type"))
        filled = {k: v for k, v in fundamentals.items() if v is not None}
        out.update(filled)
        out["fundamentals_provider"] = fh.PROVIDER if filled else None
        # What the caption says: named source, not published for this kind of
        # instrument, or not answering right now (launch-1, loop 1).
        out["fundamentals_status"] = status if (filled or status != "ok") else "not_covered"
        return out

    return _profile_cache.get(inst.canonical, compute)


# ── corporate actions ─────────────────────────────────────────────────────────


def corporate_actions(symbol: str, years: int = 5) -> dict:
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc
    if inst.kind != "equity":
        raise UnsupportedInstrument("api", "Splits and dividends apply to listed equities and funds only.")
    from_ = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()

    def compute() -> dict:
        primary_err: ProviderError | None = None
        if entitlements.is_blocked("splits_dividends") is None:
            try:
                c = client()
                splits_raw = _with_slot(lambda: c.splits(inst.eodhd, from_=from_))
                divs_raw = _with_slot(lambda: c.dividends(inst.eodhd, from_=from_))
                entitlements.record_live("splits_dividends", True, 200, "ok")
                splits = []
                for s in splits_raw:
                    txt = str(s.get("split", ""))
                    num, _, den = txt.partition("/")
                    ratio = (_f(num) or 0) / (_f(den) or 1) if den else _f(txt)
                    splits.append({"date": s.get("date"), "ratio": ratio, "text": txt})
                dividends = [
                    {
                        "date": d.get("date"),
                        "value": _f(d.get("value")),
                        "unadjusted_value": _f(d.get("unadjustedValue")),
                        "currency": d.get("currency"),
                        "period": d.get("period"),
                        "declaration_date": d.get("declarationDate"),
                        "record_date": d.get("recordDate"),
                        "payment_date": d.get("paymentDate"),
                    }
                    for d in divs_raw
                ]
                return {"symbol": inst.canonical, "provider": eod.PROVIDER, "fallback_used": False, "fallback_reason": None, "fetched_at": _now_iso(), "from": from_, "splits": splits, "dividends": dividends}
            except ProviderError as exc:
                primary_err = exc
                if exc.kind in ("unauthorized", "missing_token"):
                    entitlements.record_live("splits_dividends", False, exc.status, f"{exc.kind}: {exc.public}")
        else:
            primary_err = Unauthorized(eod.PROVIDER, "Splits and dividends are not in the EODHD plan on this server.")
        # The API never calls Yahoo (fix/prelaunch-1): EODHD's error is the answer.
        raise primary_err

    return _actions_cache.get(f"{inst.canonical}:{years}", compute)


# ── options (EODHD marketplace, end-of-day) ───────────────────────────────────

_OPTION_FIELDS = "contract,underlying_symbol,exp_date,expiration_type,type,strike,bid,bid_date,ask,ask_date,last,midpoint,volume,open_interest,volatility,delta,gamma,theta,vega,rho,moneyness,tradetime,dte"


def _require_options(inst: Instrument) -> str:
    if not inst.is_us_equity:
        raise UnsupportedInstrument("api", "Options data covers US-listed stocks and ETFs only.")
    blocked = entitlements.is_blocked("options")
    if blocked is not None:
        raise Unauthorized(eod.PROVIDER, "Options data is not included in the EODHD plan on this server.", status=blocked.status)
    return inst.eodhd.split(".")[0]


def _as_of(rows: list[dict]) -> str | None:
    stamps = [str(v) for r in rows for v in (r.get("bid_date"), r.get("ask_date"), r.get("tradetime")) if v]
    return max(stamps)[:19].replace("T", " ") if stamps else None


def options_expirations(symbol: str) -> dict:
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc
    underlying = _require_options(inst)

    def compute() -> dict:
        try:
            today = datetime.now(timezone.utc).date().isoformat()
            d = _with_slot(lambda: client().options_contracts(underlying, exp_date_from=today, limit=1000, sort="exp_date", fields="exp_date,bid_date,ask_date,tradetime"))
            entitlements.record_live("options", True, 200, "ok")
        except ProviderError as exc:
            if exc.kind in ("unauthorized", "missing_token"):
                entitlements.record_live("options", False, exc.status, f"{exc.kind}: {exc.public}")
            raise
        rows = [r.get("attributes", r) for r in d.get("data") or []]
        exps = sorted({str(r.get("exp_date")) for r in rows if r.get("exp_date")})
        if not exps:
            raise EmptyResult(eod.PROVIDER, f"No listed options on file for {inst.canonical}.")
        return {"symbol": inst.canonical, "underlying": underlying, "provider": eod.PROVIDER, "as_of": _as_of(rows), "cadence": "end_of_day", "fetched_at": _now_iso(), "expirations": exps, "truncated": bool((d.get("links") or {}).get("next"))}

    return _exp_cache.get(inst.canonical, compute)


def options_chain(symbol: str, *, expiration: str, type_: str | None, strike_from: float | None, strike_to: float | None, page: int, limit: int) -> dict:
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc
    underlying = _require_options(inst)
    limit = max(1, min(int(limit), 200))
    page = max(0, int(page))
    key = f"{inst.canonical}:{expiration}:{type_ or 'all'}:{strike_from}:{strike_to}:{page}:{limit}"

    def compute() -> dict:
        try:
            d = _with_slot(
                lambda: client().options_contracts(
                    underlying,
                    exp_date_eq=expiration,
                    type_=type_,
                    strike_from=strike_from,
                    strike_to=strike_to,
                    limit=limit,
                    offset=page * limit,
                    sort="strike",
                    fields=_OPTION_FIELDS,
                )
            )
            entitlements.record_live("options", True, 200, "ok")
        except ProviderError as exc:
            if exc.kind in ("unauthorized", "missing_token"):
                entitlements.record_live("options", False, exc.status, f"{exc.kind}: {exc.public}")
            raise
        rows = [r.get("attributes", r) for r in d.get("data") or []]
        contracts = [
            {
                "contract": r.get("contract"),
                "type": r.get("type"),
                "strike": _f(r.get("strike")),
                "exp_date": r.get("exp_date"),
                "expiration_type": r.get("expiration_type"),
                "dte": r.get("dte"),
                "bid": _f(r.get("bid")),
                "ask": _f(r.get("ask")),
                "last": _f(r.get("last")),
                "midpoint": _f(r.get("midpoint")),
                "volume": _f(r.get("volume")),
                "open_interest": _f(r.get("open_interest")),
                "implied_vol": _f(r.get("volatility")),
                "delta": _f(r.get("delta")),
                "gamma": _f(r.get("gamma")),
                "theta": _f(r.get("theta")),
                "vega": _f(r.get("vega")),
                "rho": _f(r.get("rho")),
                "moneyness": _f(r.get("moneyness")),
                "tradetime": r.get("tradetime"),
                "last_quote": (str(r.get("bid_date") or r.get("ask_date") or "")[:19].replace("T", " ") or None),
            }
            for r in rows
        ]
        meta = d.get("meta") or {}
        return {
            "symbol": inst.canonical,
            "underlying": underlying,
            "provider": eod.PROVIDER,
            "cadence": "end_of_day",
            "as_of": _as_of(rows),
            "fetched_at": _now_iso(),
            "expiration": expiration,
            "type": type_,
            "strike_from": strike_from,
            "strike_to": strike_to,
            "page": page,
            "limit": limit,
            "count": len(contracts),
            "total": meta.get("total"),
            "has_more": bool((d.get("links") or {}).get("next")),
            "contracts": contracts,
        }

    return _chain_cache.get(key, compute)


# ── bounded tick requests (aggregated, never persisted) ───────────────────────


def recent_trades(symbol: str, *, minutes: int, limit: int) -> dict:
    try:
        inst = parse(symbol)
    except SymbolError as exc:
        raise UnknownSymbol("api", str(exc)) from exc
    if not inst.is_us_equity:
        raise UnsupportedInstrument("api", "Tick data covers US equities only.")
    blocked = entitlements.is_blocked("ticks")
    if blocked is not None:
        raise Unauthorized(eod.PROVIDER, "Tick data is not included in the EODHD plan on this server.", status=blocked.status)
    minutes = max(1, min(int(minutes), 30))
    limit = max(1, min(int(limit), 5000))
    code = inst.eodhd.split(".")[0]

    def compute() -> dict:
        now = int(datetime.now(timezone.utc).timestamp())
        from_ts = now - minutes * 60
        try:
            d = _with_slot(lambda: client().ticks(code, from_ts=from_ts, to_ts=now, limit=limit))
            entitlements.record_live("ticks", True, 200, "ok")
        except ProviderError as exc:
            if exc.kind in ("unauthorized", "missing_token"):
                entitlements.record_live("ticks", False, exc.status, f"{exc.kind}: {exc.public}")
            raise
        ts_list = d.get("ts") or []
        px = d.get("price") or []
        sh = d.get("shares") or []
        buckets: dict[str, dict] = {}
        last_ts: str | None = None
        for i, ts_ms in enumerate(ts_list):
            t = _f(ts_ms)
            p = _f(px[i]) if i < len(px) else None
            if t is None or p is None:
                continue
            sec = t / 1000.0  # ticks arrive in milliseconds; requests are in seconds
            minute = datetime.fromtimestamp(sec, tz=timezone.utc).replace(second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
            v = _f(sh[i]) if i < len(sh) else 0.0
            b = buckets.get(minute)
            if b is None:
                buckets[minute] = {"ts": minute, "open": p, "high": p, "low": p, "close": p, "volume": v or 0.0, "trades": 1}
            else:
                b["high"] = max(b["high"], p)
                b["low"] = min(b["low"], p)
                b["close"] = p
                b["volume"] += v or 0.0
                b["trades"] += 1
            last_ts = _ts_iso(sec)
        return {
            "symbol": inst.canonical,
            "provider": eod.PROVIDER,
            "fetched_at": _now_iso(),
            "window_from": _ts_iso(from_ts),
            "window_to": _ts_iso(now),
            "last_trade_ts": last_ts,
            "trades": len(ts_list),
            "bars": [buckets[k] for k in sorted(buckets)],
        }

    return _ticks_cache.get(f"{inst.canonical}:{minutes}:{limit}", compute)


# ── status ────────────────────────────────────────────────────────────────────

PRIMARY_MATRIX = {
    "live_us_equity_quotes": ("eodhd websocket", "latest validated stored close"),
    "live_crypto_fx": ("eodhd websocket", "latest validated stored quote"),
    "vix_delayed_quote": ("eodhd rest", "latest validated stored close"),
    # On-demand lookups are EODHD only (fix/prelaunch-1): no second source,
    # a typed and disclosed error instead.
    "daily_candles": ("eodhd eod", None),
    "intraday_candles": ("eodhd intraday", None),
    "symbol_search": ("eodhd search", None),
    "splits_dividends": ("eodhd", None),
    "exchange_hours": ("eodhd exchange-details", "built-in NYSE calendar"),
    # EODHD's plan here has no fundamentals (403 at the probe); Finnhub's
    # free tier publishes them for US listings (launch-1).
    "fundamentals": ("finnhub (free tier, US listings)", None),
    # The refresh pipeline's stored histories: the one place Yahoo remains.
    "allocation_histories": ("eodhd eod (refresh pipeline, stored)", "yfinance (refresh pipeline only, disclosed)"),
    "options": ("eodhd marketplace (end-of-day)", "explicit unavailable state"),
    "ticks": ("eodhd (bounded, only when entitled)", "no fallback"),
    "macro_series": ("FRED", "none"),
    "news": ("Finnhub, NewsAPI, RSS", "stored feed"),
}


def status() -> dict:
    ents = entitlements.snapshot()
    return {
        "generated_at": _now_iso(),
        "eodhd_configured": bool(client().token),
        "finnhub_configured": bool(fh.client().token),
        "primary": {k: {"primary": v[0], "fallback": v[1]} for k, v in PRIMARY_MATRIX.items()},
        "entitlements": ents,
        "cache": {"candles": _candles_cache.size, "search": _search_cache.size, "profile": _profile_cache.size, "options": _chain_cache.size},
        # What this process has spent at EODHD since it started, in the
        # plan's own units (launch-1): the runbook's daily figure.
        "quota": quota.snapshot(),
    }
