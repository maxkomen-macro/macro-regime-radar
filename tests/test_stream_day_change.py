"""US day change on the relay (fix/freshness 1, decision D1).

EODHD's US trade frames carry {s, p, c, v, dp, ms, t} and no dc/dd, so every
US tick used to null the day change the REST seed had put on the board. The
relay now keeps each US symbol's previous regular-session close from its REST
rows (previousClose; a row from an earlier session is itself that close) and
computes dd = p − prev_close, dc = dd / prev_close × 100 for a US tick without
dc. A tick flagged ms "extended-hours" (or "closed") leaves the stored quote
alone. No previous close for the tick's session → dc stays null.

The frames below are the shapes EODHD documents for each stream ("Real-Time
Data API via WebSockets", modified 2026-09-09; "Live (Delayed) OHLCV Stock
Prices API", modified 2026-08-25), replayed through the real handler and,
once, through the real socket loop.
"""

from __future__ import annotations

import asyncio
import json
import types
from datetime import datetime, timezone

import pytest

from api import calendar as cal
from api import stream


def _hub() -> stream.QuoteHub:
    h = stream.QuoteHub()
    h.token = "sekrit-token-value"
    return h


def _utc(y, m, d, hh, mm=0, ss=0) -> datetime:
    return datetime(y, m, d, hh, mm, ss, tzinfo=timezone.utc)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


# Sep 30 2026 (Wed) closed SPY 762.44 on 764.20; QQQ 739.70 on 737.93; AAPL 255.10 on 252.00.
SEP30_CLOSE_UTC = _utc(2026, 9, 30, 20)  # 16:00 ET (EDT)
CLOSES = {"SPY": (762.44, 764.20), "QQQ": (739.70, 737.93), "AAPL": (255.10, 252.00)}


def _rest_row(sym: str, close: float, prev: float, at: datetime) -> dict:
    """An EODHD /real-time row as the relay receives it (numbers, not strings)."""
    return {
        "code": f"{sym}.US",
        "timestamp": int(at.timestamp()),
        "gmtoffset": 0,
        "open": prev,
        "high": max(close, prev),
        "low": min(close, prev),
        "close": close,
        "volume": 1000,
        "previousClose": prev,
        "change": round(close - prev, 4),
        "change_p": round((close - prev) / prev * 100, 4),
    }


def _us_frame(sym: str, p: float, at: datetime, ms: str = "open") -> dict:
    return {"s": sym, "p": p, "c": [], "v": 100, "dp": False, "ms": ms, "t": _ms(at)}


def _seed_after_sep30_close(h: stream.QuoteHub, now: datetime) -> None:
    """The REST seed as it reads overnight or pre-open: each row is Sep 30's close."""
    for sym, (close, prev) in CLOSES.items():
        h._store_rest_quote(_rest_row(sym, close, prev, SEP30_CLOSE_UTC), delayed=True, now=now)


def _pct(p: float, prev: float) -> float:
    return round((p - prev) / prev * 100, 4)


def test_pre_open_the_board_holds_the_last_close_and_a_premarket_print_changes_nothing():
    h = _hub()
    pre = _utc(2026, 10, 1, 12)  # 08:00 ET Oct 1
    _seed_after_sep30_close(h, now=pre)
    before = dict(h.quotes["SPY"])
    assert before["p"] == 762.44 and before["src"] == "rest"
    assert before["dc"] == pytest.approx(_pct(762.44, 764.20))  # EODHD's change_p, Sep 30's own day
    h._handle_tick("us", _us_frame("SPY", 765.10, pre, ms="extended-hours"))
    assert h.quotes["SPY"] == before
    assert h.stats["us_ticks_held"] == 1
    # Sep 30's close is kept as the previous close for Oct 1's session.
    assert h._prev_close["SPY"] == (762.44, datetime(2026, 10, 1).date())


def test_in_session_a_us_trade_frame_gets_its_day_change_against_the_previous_close():
    h = _hub()
    _seed_after_sep30_close(h, now=_utc(2026, 10, 1, 13, 25))  # the seed just before the bell
    at = _utc(2026, 10, 1, 14)  # 10:00 ET
    for sym, p in (("SPY", 770.00), ("QQQ", 735.00), ("AAPL", 258.65)):
        h._handle_tick("us", _us_frame(sym, p, at))
        q = h.quotes[sym]
        prev = CLOSES[sym][0]
        assert q["src"] == "ws" and q["delayed"] is False and q["p"] == p
        assert q["dd"] == pytest.approx(round(p - prev, 4))
        assert q["dc"] == pytest.approx(_pct(p, prev))
    assert h.quotes["QQQ"]["dc"] < 0 < h.quotes["SPY"]["dc"]


def test_an_in_session_rest_row_keeps_previous_close_from_its_previousClose_field():
    h = _hub()
    now = _utc(2026, 10, 1, 14, 30)  # 10:30 ET
    # The delayed row is from today's session: its previousClose is Sep 30's close.
    h._store_rest_quote(_rest_row("SPY", 768.00, 762.44, _utc(2026, 10, 1, 14, 15)), delayed=True, now=now)
    assert h._prev_close["SPY"] == (762.44, datetime(2026, 10, 1).date())
    h._handle_tick("us", _us_frame("SPY", 769.00, now))
    assert h.quotes["SPY"]["dc"] == pytest.approx(_pct(769.00, 762.44))


def test_after_the_close_extended_hours_prints_leave_the_last_regular_quote():
    h = _hub()
    _seed_after_sep30_close(h, now=_utc(2026, 10, 1, 13, 25))
    last_regular = _utc(2026, 10, 1, 19, 59, 59)  # 15:59:59 ET
    h._handle_tick("us", _us_frame("SPY", 771.20, last_regular))
    standing = dict(h.quotes["SPY"])
    for minute in (5, 30, 59):
        h._handle_tick("us", _us_frame("SPY", 760.00, _utc(2026, 10, 1, 20, minute), ms="extended-hours"))
    h._handle_tick("us", _us_frame("SPY", 759.00, _utc(2026, 10, 2, 0, 10), ms="closed"))
    assert h.quotes["SPY"] == standing
    assert standing["dc"] == pytest.approx(_pct(771.20, 762.44))
    assert h.stats["us_ticks_held"] == 4
    # The feed's last print stays the regular one (freshness reads this stamp).
    assert h.debug()["feed_last_tick_at"]["us"] == "2026-10-01T19:59:59Z"


def test_a_holiday_keeps_the_last_session_close_and_the_next_session_reads_against_it():
    thanksgiving = datetime(2026, 11, 26).date()
    assert cal.is_holiday(thanksgiving) and cal.is_trading_day(datetime(2026, 11, 27).date())
    h = _hub()
    nov25_close = _utc(2026, 11, 25, 21)  # 16:00 ET (EST)
    h._store_rest_quote(_rest_row("SPY", 790.00, 785.00, nov25_close), delayed=True, now=_utc(2026, 11, 26, 15))
    h._handle_tick("us", _us_frame("SPY", 791.00, _utc(2026, 11, 26, 15), ms="closed"))
    assert h.quotes["SPY"]["p"] == 790.00  # the holiday print is held
    # Friday's pre-open seed still sees Wednesday's row: its close is Friday's previous close.
    h._store_rest_quote(_rest_row("SPY", 790.00, 785.00, nov25_close), delayed=True, now=_utc(2026, 11, 27, 14))
    h._handle_tick("us", _us_frame("SPY", 794.00, _utc(2026, 11, 27, 14, 31)))  # 09:31 ET
    assert h.quotes["SPY"]["dc"] == pytest.approx(_pct(794.00, 790.00))
    assert h.quotes["SPY"]["dd"] == pytest.approx(4.0)


def test_without_a_previous_close_for_the_ticks_session_the_day_change_stays_null():
    h = _hub()
    at = _utc(2026, 10, 1, 14)
    h._handle_tick("us", _us_frame("AAPL", 258.65, at))  # never seeded
    assert h.quotes["AAPL"]["p"] == 258.65
    assert h.quotes["AAPL"]["dc"] is None and h.quotes["AAPL"]["dd"] is None
    # A previous close kept for Sep 30's session never prices an Oct 1 print.
    h._store_rest_quote(_rest_row("SPY", 762.44, 764.20, _utc(2026, 9, 30, 19)), delayed=True, now=_utc(2026, 9, 30, 19, 15))
    assert h._prev_close["SPY"] == (764.20, datetime(2026, 9, 30).date())
    h._handle_tick("us", _us_frame("SPY", 770.00, at))
    assert h.quotes["SPY"]["dc"] is None and h.quotes["SPY"]["dd"] is None


def test_forex_and_crypto_keep_eodhds_own_day_change_and_vix_keeps_no_previous_close():
    h = _hub()
    at = _utc(2026, 10, 1, 14)
    h._handle_tick("forex", {"s": "EURUSD", "a": 1.1419, "b": 1.1416, "dc": "0.3005", "dd": "0.0034", "ppms": False, "t": _ms(at)})
    h._handle_tick("crypto", {"s": "BTC-USD", "p": "64000.5", "q": "0.01", "dc": "-1.2", "dd": "-777.0", "t": _ms(at)})
    assert h.quotes["EURUSD"]["dc"] == pytest.approx(0.3005) and h.quotes["EURUSD"]["dd"] == pytest.approx(0.0034)
    assert h.quotes["BTC-USD"]["dc"] == pytest.approx(-1.2)
    h._store_rest_quote({"code": "VIX.INDX", "close": 16.0, "previousClose": 16.4, "change": -0.4, "change_p": -2.44, "timestamp": int(at.timestamp())}, delayed=True, now=at)
    assert "VIX" not in h._prev_close
    assert h.quotes["VIX"]["dc"] == pytest.approx(-2.44)


def test_recorded_frames_through_the_real_socket_loop(monkeypatch):
    """The US socket as EODHD sends it: the ack, then raw trade frames (one
    pre-market, three in session). The browser-bound quotes carry a day change."""
    h = _hub()
    _seed_after_sep30_close(h, now=_utc(2026, 10, 1, 13, 25))
    frames = [
        {"status_code": 200, "message": "Authorized"},
        _us_frame("SPY", 766.00, _utc(2026, 10, 1, 13, 0), ms="extended-hours"),
        _us_frame("SPY", 770.00, _utc(2026, 10, 1, 14)),
        _us_frame("QQQ", 735.00, _utc(2026, 10, 1, 14)),
        _us_frame("AAPL", 258.65, _utc(2026, 10, 1, 14)),
    ]

    class _WS:
        def __init__(self, raw):
            self._raw = list(raw)

        async def send(self, _text):
            return None

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._raw:
                raise StopAsyncIteration
            return self._raw.pop(0)

    class _Connect:
        def __init__(self, ws):
            self._ws = ws

        async def __aenter__(self):
            return self._ws

        async def __aexit__(self, *exc):
            return False

    sent = {"n": 0}

    def fake_connect(url, **kwargs):
        sent["n"] += 1
        return _Connect(_WS([json.dumps(f) for f in frames] if sent["n"] == 1 else []))

    async def fake_sleep(_delay):
        raise asyncio.CancelledError

    patched = types.SimpleNamespace(**vars(asyncio))
    patched.sleep = fake_sleep
    monkeypatch.setattr(stream, "asyncio", patched)
    monkeypatch.setattr(stream.websockets, "connect", fake_connect)
    monkeypatch.setattr(stream.random, "random", lambda: 0.0)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(h._run_feed("us"))

    for sym, p in (("SPY", 770.00), ("QQQ", 735.00), ("AAPL", 258.65)):
        assert h.quotes[sym]["p"] == p
        assert h.quotes[sym]["dc"] == pytest.approx(_pct(p, CLOSES[sym][0]))
    assert h.stats["us_ticks_held"] == 1


# ── Codex round 1 (R-01, R-02, R-03): which rows may set the anchor ─────────
# Sep 30 2026 is a Wednesday, Oct 1 a Thursday, Oct 2 a Friday; EDT is UTC−4.

FRI_NOON = _utc(2026, 10, 2, 16)  # 12:00 ET Friday Oct 2
WED_CLOSE = _utc(2026, 9, 30, 20)  # 16:00 ET Wednesday
THU_LAST_REGULAR = _utc(2026, 10, 1, 19, 59, 30)  # 15:59:30 ET Thursday
THU_AFTER_HOURS = _utc(2026, 10, 1, 20, 15)  # 16:15 ET Thursday


def _row_at(sym: str, close: float, at: datetime, prev: float | None = None) -> dict:
    return _rest_row(sym, close, prev if prev is not None else close, at)


@pytest.mark.parametrize("order", ["wednesday_first", "thursday_first"])
def test_r01_an_older_sessions_close_never_anchors_fridays_session(order):
    """Codex R-01: Wednesday's close 90 must not price Friday against Thursday's 100."""
    h = _hub()
    rows = [_row_at("SPY", 90.0, WED_CLOSE), _row_at("SPY", 100.0, THU_LAST_REGULAR)]
    for row in rows if order == "wednesday_first" else rows[::-1]:
        h._store_rest_quote(row, delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.0, datetime(2026, 10, 2).date())
    h._handle_tick("us", _us_frame("SPY", 102.0, FRI_NOON))
    assert h.quotes["SPY"]["dc"] == pytest.approx(2.0)  # not +13.3333
    assert h.quotes["SPY"]["dd"] == pytest.approx(2.0)


def test_r01_a_row_after_the_previous_sessions_close_sets_no_anchor_and_overwrites_none():
    h = _hub()
    h._store_rest_quote(_row_at("SPY", 110.0, THU_AFTER_HOURS), delayed=True, now=FRI_NOON)
    assert "SPY" not in h._prev_close  # Thursday 16:15 ET is not Thursday's regular close
    h._handle_tick("us", _us_frame("SPY", 102.0, FRI_NOON))
    assert h.quotes["SPY"]["dc"] is None and h.quotes["SPY"]["dd"] is None  # not −7.2727
    # Thursday's regular close arrives; a later after-hours row never replaces it.
    h._store_rest_quote(_row_at("SPY", 100.0, THU_LAST_REGULAR), delayed=True, now=FRI_NOON)
    h._store_rest_quote(_row_at("SPY", 110.0, THU_AFTER_HOURS), delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.0, datetime(2026, 10, 2).date())


def test_r01_a_row_dated_the_target_session_supersedes_the_previous_sessions_close():
    h = _hub()
    friday = datetime(2026, 10, 2).date()
    h._store_rest_quote(_row_at("SPY", 100.0, THU_LAST_REGULAR), delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.0, friday)
    # Friday's own row: its previousClose is the official Thursday close.
    h._store_rest_quote(_rest_row("SPY", 101.0, 100.25, _utc(2026, 10, 2, 15, 45)), delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.25, friday)
    # A (b) row arriving later never takes the anchor back.
    h._store_rest_quote(_row_at("SPY", 100.0, _utc(2026, 10, 1, 19, 59, 59)), delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.25, friday)
    # A row dated after the target session is a clock fault: nothing changes.
    h._store_rest_quote(_rest_row("SPY", 99.0, 50.0, _utc(2026, 10, 5, 15)), delayed=True, now=FRI_NOON)
    assert h._prev_close["SPY"] == (100.25, friday)


def test_r01_on_a_weekend_the_anchor_is_for_mondays_session():
    h = _hub()
    saturday = _utc(2026, 10, 3, 15)
    fri_last_regular = _utc(2026, 10, 2, 19, 59, 50)
    h._store_rest_quote(_row_at("SPY", 103.0, fri_last_regular), delayed=True, now=saturday)
    assert h._prev_close["SPY"] == (103.0, datetime(2026, 10, 5).date())
    h._handle_tick("us", _us_frame("SPY", 104.03, _utc(2026, 10, 5, 13, 31)))  # 09:31 ET Monday
    assert h.quotes["SPY"]["dc"] == pytest.approx(1.0)


def test_r01_an_early_close_day_bounds_its_regular_close_at_1300():
    """Fri Nov 27 2026 closes at 13:00 ET (EST, UTC−5): a 12:59 row anchors
    Monday Nov 30; a 13:20 row is after that day's close and is refused."""
    assert datetime(2026, 11, 27).date() in cal.EARLY_CLOSES[2026]
    h = _hub()
    monday_pre = _utc(2026, 11, 30, 13)  # 08:00 ET Monday
    h._store_rest_quote(_row_at("SPY", 805.0, _utc(2026, 11, 27, 18, 20)), delayed=True, now=monday_pre)
    assert "SPY" not in h._prev_close
    h._store_rest_quote(_row_at("SPY", 800.0, _utc(2026, 11, 27, 17, 59, 30)), delayed=True, now=monday_pre)
    assert h._prev_close["SPY"] == (800.0, datetime(2026, 11, 30).date())
    h._store_rest_quote(_row_at("SPY", 805.0, _utc(2026, 11, 27, 18, 20)), delayed=True, now=monday_pre)
    assert h._prev_close["SPY"] == (800.0, datetime(2026, 11, 30).date())
    h._handle_tick("us", _us_frame("SPY", 808.0, _utc(2026, 11, 30, 15)))  # 10:00 ET
    assert h.quotes["SPY"]["dc"] == pytest.approx(1.0)


def test_r02_learning_the_anchor_reprices_the_retained_ws_quote():
    """Codex R-02: a noon WS tick at 102 with no anchor, then an 11:45 REST row
    with previousClose 100: the retained quote gets +2% at once, keeping its
    own price and timestamp, and is sent again."""
    h = _hub()
    noon = _utc(2026, 10, 1, 16)
    h._handle_tick("us", _us_frame("SPY", 102.0, noon))
    assert h.quotes["SPY"]["dc"] is None
    h._dirty.clear()
    h._store_rest_quote(_rest_row("SPY", 101.5, 100.0, _utc(2026, 10, 1, 15, 45)), delayed=True, now=noon)
    q = h.quotes["SPY"]
    assert q["src"] == "ws" and q["p"] == 102.0 and q["t"] == _ms(noon)  # the older REST row did not replace it
    assert q["dc"] == pytest.approx(2.0) and q["dd"] == pytest.approx(2.0)
    assert "SPY" in h._dirty
    # A changed anchor (a later row of the same kind) re-prices it again.
    h._store_rest_quote(_rest_row("SPY", 101.6, 101.0, _utc(2026, 10, 1, 15, 50)), delayed=True, now=noon)
    assert h.quotes["SPY"]["dc"] == pytest.approx(round(1.0 / 101.0 * 100, 4))


def test_r02_restart_mid_session_with_a_quiet_name():
    """The relay restarts at 11:00 ET. AAPL has not traded today: its REST row
    is Wednesday's last regular trade (anchor b). MSFT's row is an after-hours
    print (no anchor) until a row dated today arrives, which re-prices the WS
    quote already on the board."""
    h = _hub()
    restart = _utc(2026, 10, 1, 15)  # 11:00 ET Thursday
    h._store_rest_quote(_row_at("AAPL", 255.10, _utc(2026, 9, 30, 19, 59, 58), prev=252.0), delayed=True, now=restart)
    h._store_rest_quote(_row_at("MSFT", 500.0, _utc(2026, 9, 30, 21, 30), prev=498.0), delayed=True, now=restart)
    assert h._prev_close["AAPL"] == (255.10, datetime(2026, 10, 1).date())
    assert "MSFT" not in h._prev_close
    h._handle_tick("us", _us_frame("AAPL", 257.65, _utc(2026, 10, 1, 15, 30)))
    assert h.quotes["AAPL"]["dc"] == pytest.approx(_pct(257.65, 255.10))
    h._handle_tick("us", _us_frame("MSFT", 505.0, _utc(2026, 10, 1, 15, 31)))
    assert h.quotes["MSFT"]["dc"] is None
    h._store_rest_quote(_rest_row("MSFT", 504.0, 499.0, _utc(2026, 10, 1, 15, 16)), delayed=True, now=_utc(2026, 10, 1, 15, 35))
    assert h.quotes["MSFT"]["p"] == 505.0 and h.quotes["MSFT"]["dc"] == pytest.approx(_pct(505.0, 499.0))


def test_r03_non_finite_numbers_set_no_anchor_and_never_reach_the_wire():
    h = _hub()
    noon = _utc(2026, 10, 1, 16)
    row = _rest_row("SPY", 101.0, 100.0, _utc(2026, 10, 1, 15, 45))
    row["previousClose"] = "Infinity"
    h._store_rest_quote(row, delayed=True, now=noon)
    assert "SPY" not in h._prev_close
    h._handle_tick("us", _us_frame("SPY", 102.0, noon))
    assert h.quotes["SPY"]["dc"] is None and h.quotes["SPY"]["dd"] is None
    # A non-finite price, change or anchor of any kind is dropped before it is stored.
    h._store_rest_quote({"code": "QQQ.US", "close": "NaN", "timestamp": int(noon.timestamp())}, delayed=True, now=noon)
    assert "QQQ" not in h.quotes
    h._store_rest_quote({"code": "IWM.US", "close": 200.0, "change_p": "Infinity", "change": "-Infinity", "previousClose": "-Infinity", "timestamp": int(noon.timestamp())}, delayed=True, now=noon)
    assert h.quotes["IWM"]["dc"] is None and h.quotes["IWM"]["dd"] is None and "IWM" not in h._prev_close
    h._handle_tick("us", {"s": "DIA", "p": "Infinity", "ms": "open", "t": _ms(noon)})
    assert "DIA" not in h.quotes
    # Everything stored serializes as strict JSON (what the browser's JSON.parse accepts).
    json.dumps({"type": "quotes", "items": list(h.quotes.values())}, allow_nan=False)
