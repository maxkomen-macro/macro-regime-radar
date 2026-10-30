"""api/desk_options.py — the Options Finder's route (design F3; engine src/desk/options_finder.py, method finder-2).

`GET /api/desk/options/finder?symbol=SPCX&view=up&target=180&by=2026-12-18&budget=1500
[&min_oi=100&max_spread=0.10&fill=ask&scan_months=6&commission=0.65]`

A visitor's view (a US stock or ETF up or down to a target by a date, a budget to risk) against one
end-of-day option chain. Everything is read on request through api/providers (caches and concurrency slots
as there), except what the database stores, which comes from the worker item `desk_options_inputs` of the
request's pinned generation (the Treasury curve, the macro calendar and the stored earnings rows): nothing
here reads the file. The pure engine prices it, one run at a time (the Finder lock), and the answer rides in
the §12.0 envelope like every Desk route.

Additive and isolated (C1): the lens's chain, the dividends panel and the fundamentals panel are read
through their existing functions or not at all. The Finder sends no Finnhub request: its earnings dates come
from what the refresh stores (design A-3), and the route never calls `market.profile`, so no dashboard panel's
Finnhub capacity is spent here. Which stored dates it may show is the display switch's call (FINDER_EARNINGS_DISPLAY,
off unless set; plan rev 2 D6): off, only the hand-maintained earnings rows; on, the earnings cache's vault read
through src/events/earnings_store.py (design EC section 5).

The page this route serves ships unlisted (OPTIONS_FINDER_LISTED = false in the web app): reachable by its
link, not shown in any menu. Unlisted is not private.
"""

from __future__ import annotations

import logging
import math
import re
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

from api import desk_envelope as env

log = logging.getLogger("mrr.desk")

PARAMS = ("symbol", "view", "target", "by", "budget", "min_oi", "max_spread", "fill", "scan_months", "commission")
REQUIRED = ("symbol", "view", "target", "by", "budget")
TARGET_MIN, TARGET_MAX = 0.001, 10_000_000.0
BY_YEAR_MIN = 2000
EVENT_EXPIRIES_MAX = 2
LOCK_TIMEOUT_S = 10.0
CURVE_SERIES = ("DGS3MO", "DGS2", "DGS5")
CURVE_ROWS = 15
MACRO_LOOKBACK_DAYS = 30
OTHER_STRIKES = (0.8, 1.2)
EVENT_STRIKES = (0.9, 1.1)
STORED_TIMES = {(8, 0): "bmo", (16, 30): "amc"}
PROVIDER = "EODHD"

_lock = threading.Lock()


# ── parameters (section 1; the session-independent checks of section 2) ─────

def _number(q: Mapping[str, str], name: str, words: str) -> float:
    try:
        v = float(q[name])
    except ValueError:
        raise env.Unsupported(f"The {words} is not a number.") from None
    if not math.isfinite(v):
        raise env.Unsupported(f"The {words} is not a finite number.")
    return v


def _whole(q: Mapping[str, str], name: str, words: str) -> int:
    # ASCII digits, at most 9 of them: str.isdigit() passes "²", which int() refuses, and int() refuses a
    # 4,301-digit string; either raised past the typed refusal (Codex S-9). Every bound here is below 10**9.
    text = q[name].strip()
    if not re.fullmatch(r"[0-9]{1,9}", text):
        raise env.Unsupported(f"The {words} is not a whole number.")
    return int(text)


def parse_params(params: list[tuple[str, str]], today: date | None = None):
    """(instrument, thesis) or `Unsupported` naming what is wrong. `today` is the New York date."""
    from api.calendar import NY
    from api.providers import market
    from api.providers.symbols import SymbolError, parse
    from src.desk import options_finder as of

    keys = [k for k, _ in params]
    unknown = sorted({k for k in keys if k not in PARAMS})
    if unknown:
        raise env.Unsupported(f"There is no {' or '.join(unknown)} parameter.")
    repeated = sorted({k for k in keys if keys.count(k) > 1})
    if repeated:
        raise env.Unsupported(f"The {' and '.join(repeated)} parameter is given more than once.")
    q = dict(params)
    missing = [k for k in REQUIRED if not (q.get(k) or "").strip()]
    if missing:
        raise env.Unsupported(f"The Finder needs {', '.join(missing)}.")
    try:
        inst = parse(q["symbol"])
    except SymbolError as exc:
        raise env.Unsupported(str(exc)) from exc
    if not inst.is_us_equity:
        raise env.Unsupported("Options data covers US-listed stocks and ETFs only.")
    view = q["view"]
    if view not in of.VIEWS:
        raise env.Unsupported(f"The view {view!r} is not up or down.")
    target = _number(q, "target", "target")
    if not TARGET_MIN <= target <= TARGET_MAX:
        raise env.Unsupported("The target is not a price from $0.001 to $10,000,000.")
    try:
        by = date.fromisoformat(q["by"]) if len(q["by"]) == 10 else None
    except ValueError:
        by = None
    if by is None:
        raise env.Unsupported("The date is not a YYYY-MM-DD date.")
    today = today or market._utcnow().astimezone(NY).date()  # the provider layer's clock, one for the request
    if by.year < BY_YEAR_MIN or by > today + timedelta(days=of.MAX_HORIZON_DAYS):
        raise env.Unsupported("The date is more than three years ahead.")
    through = calendar_through()
    if by > through:
        raise env.Unsupported(f"The market calendar is known through {of._day(through)}; pick a date on or before it.")
    budget = _number(q, "budget", "budget")
    if not of.BUDGET_MIN <= budget <= of.BUDGET_MAX:
        raise env.Unsupported("The budget is not between $1 and $10,000,000.")
    kw: dict[str, Any] = {}
    if "min_oi" in q:
        kw["min_oi"] = _whole(q, "min_oi", "minimum open interest")
        if kw["min_oi"] > of.MIN_OI_MAX:
            raise env.Unsupported("The minimum open interest is not a whole number from 0 to 1,000,000.")
    if "max_spread" in q:
        kw["max_spread"] = _number(q, "max_spread", "widest spread")
        if not of.SPREAD_MIN <= kw["max_spread"] <= of.SPREAD_MAX:
            raise env.Unsupported("The widest spread is not between 1% and 100% of the mid.")
    if "fill" in q:
        if q["fill"] not in of.FILLS:
            raise env.Unsupported(f"The fill {q['fill']!r} is not ask or mid.")
        kw["fill"] = q["fill"]
    if "scan_months" in q:
        kw["scan_months"] = _whole(q, "scan_months", "scan window")
        if not of.SCAN_MONTHS_MIN <= kw["scan_months"] <= of.SCAN_MONTHS_MAX:
            raise env.Unsupported("The scan window is not 1 to 12 months.")
    if "commission" in q:
        kw["commission"] = _number(q, "commission", "commission")
        if not 0.0 <= kw["commission"] <= of.COMMISSION_MAX:
            raise env.Unsupported("The commission is not between $0 and $100 per contract.")
    return inst, of.Thesis(view, target, by, budget, **kw)


# ── calendar facts (section 2b), from api/calendar ─────────────────────────

def calendar_through() -> date:
    """Dec 31 of the last year api/calendar knows holidays and early closes for."""
    from api.calendar import HOLIDAYS

    return date(max(HOLIDAYS), 12, 31)


def sessions_between(after: date, through: date) -> int:
    """NYSE sessions d with after < d <= through."""
    from api.calendar import is_trading_day

    n, d = 0, after + timedelta(days=1)
    while d <= through:
        n += is_trading_day(d)
        d += timedelta(days=1)
    return n


def closes_from(start: date, end: date) -> dict:
    from api.calendar import session_bounds

    out, d = {}, start
    while d <= end:
        b = session_bounds(d)
        if b is not None:
            out[d] = b[1]
        d += timedelta(days=1)
    return out


# ── the worker item (section 4) ─────────────────────────────────────────────

ITEM_REASON = "the Options Finder's stored inputs could not be read from this database"


def desk_options_inputs(ctx: dict) -> dict:
    """The worker item `desk_options_inputs`: the stored Treasury curve, macro calendar and earnings rows.
    Never raises: a database without them answers `stored: False` with the reason, so it can never hold a
    generation back or change another item (C1)."""
    try:
        return _read_inputs()
    except Exception:  # noqa: BLE001 — a value, never an error (C1)
        log.exception("desk: the Options Finder's stored inputs could not be read")
        return {"stored": False, "missing": list(CURVE_SERIES), "reason": ITEM_REASON}


def _table(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _read_inputs() -> dict:
    from api import db
    from src.analytics import dbpath

    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        curve: dict[str, list[tuple[str, float]]] = {}
        if _table(conn, "desk_series"):
            for s in CURVE_SERIES:
                rows = conn.execute("SELECT date, value FROM desk_series WHERE series_id = ? ORDER BY date DESC", (s,)).fetchall()
                good = [(str(d)[:10], float(v)) for d, v in rows if isinstance(v, (int, float)) and math.isfinite(float(v))]
                if good:
                    curve[s] = good[:CURVE_ROWS]
        missing = [s for s in CURVE_SERIES if s not in curve]
        if missing:
            return {"stored": False, "missing": missing,
                    "reason": f"this database does not store {', '.join(missing)} yet"}
        newest = None
        if _table(conn, "market_daily"):
            newest = conn.execute("SELECT MAX(date) FROM market_daily").fetchone()[0]
        macro, earnings, symbols, macro_through = [], [], [], None
        if _table(conn, "event_calendar"):
            cols = {r[1] for r in conn.execute("PRAGMA table_info(event_calendar)")}
            has_kind = "kind" in cols and "symbol" in cols
            lo = (date.fromisoformat(str(newest)[:10]) - timedelta(days=MACRO_LOOKBACK_DAYS)).isoformat() if newest else "0000"
            q = ("SELECT event_name, event_datetime, importance, source FROM event_calendar WHERE event_datetime >= ?"
                 + (" AND (kind IS NULL OR kind != 'earnings')" if has_kind else "") + " ORDER BY event_datetime")
            for name, at, importance, source in conn.execute(q, (lo,)).fetchall():
                macro.append({"name": name, "at": at, "importance": importance, "source": source})
            last = conn.execute("SELECT MAX(event_datetime) FROM event_calendar"
                                + (" WHERE kind IS NULL OR kind != 'earnings'" if has_kind else "")).fetchone()[0]
            macro_through = str(last)[:10] if last else None
            if has_kind:
                src = "source" if "source" in cols else "NULL"
                for sym, at, name, source in conn.execute(f"SELECT symbol, event_datetime, event_name, {src} FROM event_calendar "
                                                          "WHERE kind = 'earnings' ORDER BY event_datetime").fetchall():
                    earnings.append({"symbol": sym, "at": at, "name": name, "source": source})
                symbols = sorted({e["symbol"] for e in earnings if e["symbol"]})
        return {"stored": True, "curve": curve, "macro": macro, "macro_through": macro_through,
                "earnings": earnings, "earnings_symbols": symbols, "earnings_cache": _read_cache(conn)}
    finally:
        conn.close()


def _read_cache(conn) -> dict:
    """The earnings cache's vault (design EC section 5), opened with EARNINGS_CACHE_KEY: its state, and when it
    opens the vault with its occurrences indexed by symbol. Never raises (C1); nothing here is served as is."""
    import os

    try:
        from src.events import earnings_store as store

        opened = store.open_vault(conn, os.environ.get(store.KEY_ENV, "").strip())
        if opened.status != "ok":
            return {"status": opened.status}
        return {"status": "ok", "vault": opened.vault, "index": store.index(opened.vault)}
    except Exception:  # noqa: BLE001 — a value, never an error (C1)
        log.exception("desk: the Options Finder's earnings cache could not be read")
        return {"status": "unreadable"}


def stored_inputs() -> dict:
    """The request's generation's `desk_options_inputs` item (a lookup, never a read of the file)."""
    from api.worker import get_worker

    return get_worker().result("desk_options_inputs")


# ── the route (section 2) ───────────────────────────────────────────────────

def _close_ok(v: Any) -> bool:
    from src.desk import options_finder as of

    return isinstance(v, (int, float)) and math.isfinite(v) and of.SPOT_MIN <= v <= of.SPOT_MAX


def _bad_close(what: str) -> env.Refused:
    return env.Refused(502, "bad_market_input", f"The provider served a value the Finder cannot price with: {what}.")


def _strike_window(thesis, closes: list[float]) -> tuple[int, int]:
    from src.desk import options_finder as of

    lo = min(of.strike_bounds(thesis, c)[0] for c in closes)
    hi = max(of.strike_bounds(thesis, c)[1] for c in closes)
    return math.floor(lo), math.ceil(hi)


def _inside(thesis, spot: float, strikes: tuple[int, int]) -> bool:
    from src.desk import options_finder as of

    lo, hi = of.strike_bounds(thesis, spot)
    return strikes[0] <= lo and hi <= strikes[1]


def _run_engine(fn):
    from src.desk import options_finder as of

    try:
        return fn()
    except of.FinderError as err:
        if err.kind == "stale":
            raise env.Refused(503, "stale_chain", str(err)) from err
        if err.kind == "market":
            raise env.Refused(502, "bad_market_input", f"The provider served a value the Finder cannot price with: {err}") from err
        raise env.Unsupported(str(err)) from err


def finder(params: list[tuple[str, str]]) -> dict:
    from api.providers import market
    from src.desk import options_finder as of

    inst, t = parse_params(params)
    item = stored_inputs()
    if not item.get("stored"):
        raise env.Awaiting("Awaiting refresh: the Options Finder discounts on the Treasury curve (FRED DGS3MO, DGS2 "
                           f"and DGS5); {item.get('reason') or ITEM_REASON}.")
    through = calendar_through()

    # 2. the closes
    bars = market.daily_bars(inst.canonical)["bars"]
    by_date = {b["ts"][:10]: b.get("close_raw") for b in bars}
    p1_bar = bars[-1]
    p1 = p1_bar.get("close_raw")
    if not _close_ok(p1):
        raise _bad_close(f"the {p1_bar['ts'][:10]} close")
    anchors = [p1]
    if len(bars) > 1 and _close_ok(bars[-2].get("close_raw")):
        anchors.append(bars[-2]["close_raw"])

    # 3. the window queried: strikes rounded outward, expiries one day outward, the calendar's end + 1 day
    try:
        strikes = _strike_window(t, anchors)
        wanted_end = min(of.add_months(t.by, t.scan_months), through)
        exp_lo, exp_hi = t.by - timedelta(days=1), wanted_end + timedelta(days=1)
    except (ValueError, OverflowError) as exc:
        raise env.Unsupported("The target or the date is outside the range the Finder can scan.") from exc
    requested_through = of.add_months(t.by, t.scan_months)
    route_notes: list[str] = []
    if requested_through > through:
        route_notes.append(f"Expiries after {of._day(through)} were not read: the market calendar the Finder uses ends there.")

    def wanted(rows: list[dict], kind: str, start: date, end: date) -> list[dict]:
        out = []
        for r in rows:
            e = of._date(r.get("exp_date"))
            if r.get("type") == kind and e is not None and start <= e <= min(end, through):
                out.append(r)
        return out

    requests = 0
    win = market.options_window(inst.canonical, t.kind, exp_lo, exp_hi, *strikes)
    requests += win["requests"]
    queried = strikes
    rows = wanted(win["rows"], t.kind, t.by, wanted_end)
    session: date | None = None
    spot: float | None = None
    empty_on: tuple[date, float, bool] | None = None  # (session, close, whether the quotes name that session)

    def session_close(c: date) -> float:
        v = by_date.get(c.isoformat())
        if v is None:
            raise env.Refused(503, "close_missing", f"The close for {c.isoformat()} is not served yet; the Finder prices "
                                                     "against the session the quotes describe.")
        if not _close_ok(v):
            raise _bad_close(f"the {c.isoformat()} close")
        return float(v)

    def requery(spot_: float, c: date) -> None:
        nonlocal win, rows, queried, requests
        queried = _strike_window(t, [spot_])
        win = market.options_window(inst.canonical, t.kind, exp_lo, exp_hi, *queried)
        requests += win["requests"]
        rows = wanted(win["rows"], t.kind, t.by, wanted_end)
        if rows and win["chain_session"] != c.isoformat():
            raise env.Refused(503, "session_moved", "The provider's quotes moved to a new session while they were "
                                                    "being read; retry in a moment.")

    if not rows and not win["truncated"]:
        # 5. emptiness is declared only for the session the quotes describe
        probe = market.options_probe(inst.canonical, t.kind, exp_lo, exp_hi)
        requests += probe["requests"]
        if probe["rows"] == 0 and not probe["more"]:
            empty_on = (date.fromisoformat(p1_bar["ts"][:10]), float(p1), False)
        else:
            if probe["chain_session"] is None:
                raise env.Refused(503, "no_session", "The quotes' session could not be read from their stamps.")
            c2 = date.fromisoformat(probe["chain_session"])
            s2 = session_close(c2)
            if not _inside(t, s2, queried):
                requery(s2, c2)
            if not rows:
                empty_on = (c2, s2, True)
            else:
                session, spot = c2, s2
    elif not rows:
        empty_on = (date.fromisoformat(p1_bar["ts"][:10]), float(p1), False)  # truncated: the scan was incomplete
    else:
        if win["chain_session"] is None:
            raise env.Refused(503, "no_session", "The quotes' session could not be read from their stamps.")
        session = date.fromisoformat(win["chain_session"])
        spot = session_close(session)
        if not _inside(t, spot, queried):
            requery(spot, session)  # 6. the one reconciliation query

    if empty_on is not None and not rows:
        market.options_expirations(inst.canonical)  # no listed options at all → EmptyResult (404 empty)
        session, spot, _ = empty_on

    assert session is not None and spot is not None
    latest = date.fromisoformat(market.last_session())
    m_probe = of.Market(session, spot, item["curve"], {}, through, latest, sessions_between(session, latest),
                        occ_root(inst.canonical), inst.canonical)
    _run_engine(lambda: of.validate(t, m_probe))

    # 2b. the finder-2 inputs
    last_expiry = max((of._date(r["exp_date"]) for r in rows), default=t.by)
    dividends = _dividends(inst.canonical, through)
    earn_rows, coverage, earn_source, earn_notes = _earnings(inst.canonical, session, item)
    route_notes.extend(earn_notes)
    other_rows: list[dict] = []
    event_rows: list[dict] = []
    event_last = last_expiry
    if rows:
        other = market.options_window(inst.canonical, "put" if t.kind == "call" else "call", exp_lo, exp_hi,
                                      math.floor(OTHER_STRIKES[0] * spot), math.ceil(OTHER_STRIKES[1] * spot))
        requests += other["requests"]
        other_rows = wanted(other["rows"], "put" if t.kind == "call" else "call", t.by, wanted_end)
        event_rows, event_last, n = _event_rows(inst.canonical, session, spot, earn_rows, last_expiry, through)
        requests += n
    events = [e for e in earn_rows if session <= date.fromisoformat(e["date"]) <= last_expiry]
    events += [e for e in _macro_events(item["macro"]) if session <= date.fromisoformat(e["date"]) <= last_expiry]
    coverage["macro_through"] = item.get("macro_through")
    closes = closes_from(session, min(through, max(t.by, last_expiry, event_last)))
    m = of.Market(session, spot, item["curve"], closes, through, latest, sessions_between(session, latest),
                  occ_root(inst.canonical), inst.canonical)

    if not _lock.acquire(timeout=LOCK_TIMEOUT_S):
        raise env.Refused(503, "busy", "Another options scan is being priced; retry in a moment.")
    try:
        # every report obtained from the session on, for the move check and the coverage sentence (design S-10)
        known = [e for e in earn_rows if date.fromisoformat(e["date"]) >= session]
        ans = _run_engine(lambda: of.run(rows, t, m, other_rows=other_rows, event_rows=event_rows, dividends=dividends,
                                         events=events, known_earnings=known, coverage=coverage,
                                         truncated=win["truncated"], notes=route_notes))
    finally:
        _lock.release()

    complete_through = (min(requested_through, through).isoformat() if not win["truncated"] else win["complete_through"])
    newest_quote = max((str(r.get(k) or "")[:19].replace("T", " ") for r in win["rows"] for k in ("bid_date", "ask_date")),
                       default="") or None
    chain_c = session.isoformat() if empty_on is None or empty_on[2] else None
    sources = [f"EODHD options (end of day, {chain_c} close)" if chain_c else "EODHD options (no quote session)",
               "EODHD daily bars",
               "FRED DGS3MO, DGS2, DGS5 (" + ", ".join(p["date"] for p in ans["rates"]["points"]) + ")"]
    if dividends.get("status") == "ok":
        sources.append("EODHD dividends")
    if earn_source:
        sources.append(earn_source)
    if item.get("macro"):
        sources.append(f"Macro release calendar (stored through {item.get('macro_through')})")
    return {
        "symbol": inst.canonical,
        **ans,
        "scan": {"truncated": win["truncated"], "complete_through": complete_through,
                 "requested_through": requested_through.isoformat(), "requests": requests,
                 "queried": {"type": t.kind, "exp_from": exp_lo.isoformat(), "exp_to": exp_hi.isoformat(),
                             "strike_from": queried[0], "strike_to": queried[1]}},
        "market_as_of": {"chain_session": chain_c, "latest_quote": newest_quote, "underlying_close": spot,
                         "underlying_close_date": session.isoformat(),
                         "curve": [{"series": p["series"], "date": p["date"], "value": p["yield_pct"]}
                                   for p in ans["rates"]["points"]]},
        "provider": PROVIDER,
        "sources": sources,
    }


def occ_root(canonical: str) -> str:
    """The OCC root for a US listing (decision 13): the canonical ticker, which carries no exchange suffix, with
    its share-class separator removed, so BRK.B's standard contracts read BRKB261218C00500000 (Codex S-1)."""
    return canonical.replace(".", "").replace("-", "")


def share_class(canonical: str) -> bool:
    """A US share-class listing (BRK.B): its spelling on Finnhub's earnings calendar is not verified here."""
    return "." in canonical


def _dividends(symbol: str, through: date) -> dict:
    from api.calendar import previous_trading_day
    from api.providers import market
    from api.providers.errors import ProviderError

    try:
        ca = market.corporate_actions(symbol)
    except ProviderError:
        return {"status": "unavailable", "rows": []}
    rows = []
    for d in ca.get("dividends") or []:
        try:
            ex = date.fromisoformat(str(d.get("date"))[:10])
        except ValueError:
            rows.append({"ex_date": d.get("date"), "cum_session": None, "amount": d.get("value"), "period": d.get("period"),
                         "declared_on": d.get("declaration_date")})
            continue  # the engine counts it as unusable
        if ex > through:
            continue
        rows.append({"ex_date": ex.isoformat(), "cum_session": previous_trading_day(ex).isoformat(), "amount": d.get("value"),
                     "period": d.get("period"), "declared_on": d.get("declaration_date")})
    return {"status": "ok", "rows": rows}


def _stored_time(at: str) -> tuple[str, str] | None:
    from api.calendar import NY

    try:
        t = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        return None
    ny = t.astimezone(NY)
    return ny.date().isoformat(), STORED_TIMES.get((ny.hour, ny.minute), "unknown")


DISPLAY_ENV = "FINDER_EARNINGS_DISPLAY"
FINNHUB_SOURCE = "finnhub_earnings"  # src/events/earnings.py SOURCE: the dashboard's stored Finnhub rows
HAND_SOURCE = "Earnings calendar (hand-maintained)"
CACHE_SOURCE = "Finnhub earnings calendar (whole-market calendar read by the site's refresh; provider data)"


def display_on() -> bool:
    """FINDER_EARNINGS_DISPLAY: off unless set to 1, true, on or yes (plan rev 2 D6). Read on every request."""
    import os

    return os.environ.get(DISPLAY_ENV, "").strip().lower() in ("1", "true", "on", "yes")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _earnings(symbol: str, session: date, item: dict) -> tuple[list[dict], dict, str | None, list[str]]:
    """(event rows, coverage, the source sentence or None, notes), with no Finnhub request (design A-3). The display
    switch off (D6): the hand-maintained rows only, and the coverage withheld. On, with the earnings cache open: what
    its read-time rules allow (design EC section 5). On, without it: the stored rows, as before the cache."""
    sym = symbol
    if share_class(sym):
        # an unverified spelling could read as "no earnings date found" (Codex S-1)
        return [], {"earnings": "not_checked", "earnings_through": None}, None, []
    if not display_on():
        hand, unreadable = _hand(sym, item)
        cov = {"earnings": "withheld", "earnings_through": None, "unreadable": unreadable}
        return hand, cov, (HAND_SOURCE if hand else None), []
    cache = item.get("earnings_cache") or {}
    if cache.get("status") == "ok":
        try:
            return _from_cache(sym, session, item, cache)
        except Exception:  # noqa: BLE001 — the stored rows, as before the cache, never an error (C1)
            log.exception("desk: the Options Finder's earnings cache could not be applied")
    return _stored(sym, item)


def _hand(sym: str, item: dict) -> tuple[list[dict], int]:
    """The symbol's hand-maintained earnings rows (any source but the dashboard's Finnhub rows) as event rows, and
    the number that could not be placed."""
    rows, unreadable = [], 0
    for e in item.get("earnings") or []:
        if e.get("symbol") != sym or e.get("source") == FINNHUB_SOURCE:
            continue
        placed = _stored_time(e.get("at"))
        if placed is None:
            unreadable += 1
            continue
        rows.append({"kind": "earnings", "name": e.get("name") or f"{sym} earnings", "date": placed[0],
                     "time": placed[1], "at": None, "source": HAND_SOURCE})
    return rows, unreadable


def _seen(t: datetime) -> str:
    from api.calendar import NY

    ny = t.astimezone(NY)
    return f"{ny:%b} {ny.day}, {ny:%H:%M} ET"


def _from_cache(sym: str, session: date, item: dict, cache: dict) -> tuple[list[dict], dict, str | None, list[str]]:
    from src.desk.options_finder import _day
    from src.events import earnings_store as store

    hand, unreadable = _hand(sym, item)
    vault, now = cache["vault"], _now()
    cov = store.coverage(vault, cache["index"].get(sym, []), session, now,
                         [date.fromisoformat(h["date"]) for h in hand])
    hand_days = {h["date"] for h in hand}
    rows = list(hand)
    for o in cov.events:
        if o.day.isoformat() in hand_days:
            continue  # one report per day: the hand-maintained row wins, as in src/events/earnings.py
        if o.possible:
            src = f"Finnhub earnings calendar (no longer listed, last seen {_seen(o.last_seen)}; a possible report)"
        else:
            src = f"Finnhub earnings calendar (last seen {_seen(o.last_seen)}; scheduled, not confirmed by the company"
            src += "".join(f"; moved from {_day(d)}" for d in o.moved_from) + ")"
        name = f"{sym} earnings" + (f" (Q{o.label[1]} {o.label[0]})" if o.label else "")
        rows.append({"kind": "earnings", "name": name, "date": o.day.isoformat(),
                     "time": o.hour if o.hour in ("bmo", "amc", "dmh") else "unknown", "at": None, "source": src})
    out = {"earnings": cov.state, "earnings_through": cov.through.isoformat() if cov.through else None,
           "listed_through": cov.listed_through.isoformat() if cov.listed_through else None, "unreadable": unreadable}
    if cov.state == "unconfirmed":
        newest = ((vault.get("days") or {}).get(session.isoformat()) or [None])[0]
        contested = isinstance(newest, dict) and not (newest.get("status") == store.PASSING and newest.get("complete") is True)
        out["reason"] = "contested" if contested else "unread"
    sources = [CACHE_SOURCE] if any(r["source"] != HAND_SOURCE for r in rows) or cov.state in ("reconciled", "unlisted") else []
    if hand:
        sources.append(HAND_SOURCE)
    return rows, out, "; ".join(sources) or None, []


def _stored(sym: str, item: dict) -> tuple[list[dict], dict, str | None, list[str]]:
    """The item's stored rows for the symbol (the route before the earnings cache). A stored row is a date Finnhub
    listed at some refresh; when it was last checked, and whether every report is stored, is not recorded, so the
    coverage is never complete."""
    stored, unreadable = [], 0
    for e in item.get("earnings") or []:
        if e.get("symbol") != sym:
            continue
        placed = _stored_time(e.get("at"))
        if placed is None:
            unreadable += 1  # this symbol's report, not placed: discovery is incomplete (design S-10 step 5)
            continue
        stored.append({"kind": "earnings", "name": e.get("name") or f"{sym} earnings", "date": placed[0],
                       "time": placed[1], "at": None, "source": "Finnhub earnings calendar (stored)"})
    cov = {"earnings": "stored" if stored else "unknown", "earnings_through": None, "unreadable": unreadable}
    return stored, cov, ("Finnhub earnings calendar (stored by the site's refresh)" if stored else None), []


def _macro_events(rows: list[dict]) -> list[dict]:
    from api.calendar import NY

    out = []
    for r in rows:
        try:
            at = datetime.fromisoformat(str(r.get("at")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if at.tzinfo is None:
            continue
        out.append({"kind": "macro", "name": r.get("name"), "date": at.astimezone(NY).date().isoformat(), "time": "exact",
                    "at": at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Macro release calendar"})
    return out


def _event_rows(symbol: str, session: date, spot: float, earnings: list[dict], last_expiry: date,
                through: date) -> tuple[list[dict], date, int]:
    """Near-the-money rows of both types at the two nearest listed expiries after each upcoming report (at most
    two reports; design F3 §2b), for the implied earnings move, plus an expiry on the report's own day, which the
    engine counts only when the report is before its close. (rows, the last expiry read, requests)."""
    from api.providers import market
    from api.providers.errors import ProviderError

    reports = sorted({date.fromisoformat(e["date"]) for e in earnings if session <= date.fromisoformat(e["date"]) <= last_expiry})
    if not reports:
        return [], last_expiry, 0
    try:
        listed = sorted(d for d in (date.fromisoformat(x) for x in market.options_expirations(symbol)["expirations"])
                        if session < d <= through)
    except (ProviderError, ValueError):
        return [], last_expiry, 0
    all_reports = sorted({date.fromisoformat(e["date"]) for e in earnings})
    pairs = []
    for day in reports[:EVENT_EXPIRIES_MAX]:
        # An expiry on the report's day counts when the report is before that close (a bmo report), which the
        # engine decides from the release time, so it is read too: the day's expiry and the two after it (Codex S-7).
        after = [d for d in listed if d >= day]
        after = after[:3] if after and after[0] == day else after[:2]
        # another report from the session to after[1], earlier ones included (Codex S-8), spoils every pair the
        # engine could take; one later spoils only some, and the engine checks its own pair
        if len(after) < 2 or any(o != day and session <= o <= after[1] for o in all_reports):
            continue
        pairs.append(tuple(after))
    if not pairs:
        return [], last_expiry, 0
    keep = {d for p in pairs for d in p}
    lo, hi = min(keep) - timedelta(days=1), min(max(keep), through) + timedelta(days=1)
    k_lo, k_hi = math.floor(EVENT_STRIKES[0] * spot), math.ceil(EVENT_STRIKES[1] * spot)
    out, n = [], 0
    for kind in ("call", "put"):
        try:
            w = market.options_window(symbol, kind, lo, hi, k_lo, k_hi)
        except ProviderError:
            continue
        n += w["requests"]
        out += [r for r in w["rows"] if r.get("type") == kind and str(r.get("exp_date"))[:10] in {d.isoformat() for d in keep}]
    return out, max(keep), n
