"""api/stream.py — process-level EODHD market-data relay.

One upstream EODHD WebSocket client per feed (us / crypto / forex) plus a
60-second delayed-quote REST poll for the VIX index and a 5-minute REST seed
sweep for every symbol (so the tape is populated off-hours and survives a
downed socket). Everything rebroadcasts to browsers over a single FastAPI
WebSocket endpoint — the EODHD token stays server-side, never reaching the
client.

Reconnect/backoff runs on both legs: upstream sockets retry with exponential
backoff (1s → 30s cap, slower after auth failures); browsers reconnect
themselves (client-side backoff in web/src/live/quotes.ts).

Hardened 2026-09-06: per-feed last-frame timestamps with stale-tick
detection, a degraded verdict for /api/stream/debug, and bounded dynamic
subscriptions — a browser may ask the relay to watch up to
MAX_DYNAMIC_SYMBOLS extra symbols; the relay subscribes upstream on the
right feed, seeds a delayed REST quote immediately, and unsubscribes once no
client has watched the symbol for DYNAMIC_IDLE_SECONDS.

Message protocol to browsers (JSON):
  {"type": "snapshot", "items": [Quote...], "feeds": {...}, "stale": {...}}  on connect
  {"type": "quotes",   "items": [Quote...]}                   coalesced ticks
  {"type": "status",   "feeds": {feed: state}, "stale": {...}, "degraded": bool}
Browser → relay: {"action": "watch"|"unwatch", "symbols": ["AMZN", ...]}
Quote: {"s", "p", "dc", "dd", "t", "delayed", "src"} — dc/dd are EODHD's own
day-change % / day-change $ fields, passed through, not recomputed.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import WebSocket, WebSocketDisconnect

from api import calendar as cal
from api.providers import eodhd as _eod
from api.providers.cache import TokenBucket

log = logging.getLogger("mrr.stream")

# ── Symbol universes (day-1 Markets spec) ─────────────────────────────────────

MACRO_TAPE_US = [
    "SPY", "QQQ", "IWM", "TLT", "IEF", "HYG", "LQD",
    "UUP", "GLD", "SLV", "USO", "CPER", "EEM", "EFA",
]
SINGLE_NAMES_US = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META",
    "TSLA", "AVGO", "TSM", "MU", "AMD", "COIN",
]
US_SYMBOLS = MACRO_TAPE_US + SINGLE_NAMES_US
CRYPTO_SYMBOLS = ["BTC-USD", "ETH-USD"]
FOREX_SYMBOLS = ["EURUSD", "USDJPY"]
VIX_SYMBOL = "VIX"  # index — not streamable; 60s delayed REST poll

FEED_SYMBOLS = {"us": US_SYMBOLS, "crypto": CRYPTO_SYMBOLS, "forex": FOREX_SYMBOLS}

# REST real-time endpoint ticker suffixes per feed.
_REST_SUFFIX = {"us": ".US", "crypto": ".CC", "forex": ".FOREX"}

_WS_URL = "wss://ws.eodhistoricaldata.com/ws/{feed}?api_token={token}"
_REST_URL = "https://eodhd.com/api/real-time/{ticker}"

_BROADCAST_INTERVAL = 0.25  # coalesce upstream ticks; browsers paint ≤2×/s on top
_VIX_POLL_SECONDS = 60
_SEED_POLL_SECONDS = 300
_STATUS_INTERVAL = 30  # periodic status frame (stale flags) to browsers

MAX_DYNAMIC_SYMBOLS = 20
DYNAMIC_IDLE_SECONDS = 600
# Per browser connection (review P1-3): messages per minute, and how many
# NEW symbols one socket may add per hour — a watch/unwatch loop cannot turn
# into a stream of paid REST seeds.
WS_MESSAGES_PER_MIN = 30
WS_NEW_SYMBOLS_PER_HOUR = 40
STALE_AFTER_SECONDS = {"us": 90.0, "crypto": 120.0, "forex": 120.0}
_SYMBOL_OK = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")


def _load_token() -> str | None:
    """EODHD_API_TOKEN from the environment, else the repo-root .env file.
    The value is never logged and never leaves this process."""
    tok = os.environ.get("EODHD_API_TOKEN")
    if tok:
        return tok.strip() or None
    env_path = Path(__file__).resolve().parent.parent / ".env"
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("EODHD_API_TOKEN=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip("\"'") or None
    except OSError:
        pass
    return None


def _f(x: Any) -> float | None:
    """EODHD sends numbers as strings in some feeds — parse defensively."""
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None


def feed_for_symbol(sym: str) -> str | None:
    """Which upstream feed streams a house-canonical symbol, or None when the
    relay cannot stream it (indices, non-US listings)."""
    s = sym.upper()
    if any(ch not in _SYMBOL_OK for ch in s) or not (1 <= len(s) <= 12):
        return None
    if s.endswith("-USD") and s[:-4].isalpha() and 2 <= len(s) - 4 <= 6:
        return "crypto"
    if len(s) == 6 and s.isalpha() and s[:3] != s[3:] and s[:3] in _FX_CCY and s[3:] in _FX_CCY:
        return "forex"
    if "." in s:
        base, _, exch = s.partition(".")
        return "us" if exch in ("US", "") or (len(exch) == 1 and base.isalpha()) else None
    return "us" if s.replace("-", "").isalnum() else None


_FX_CCY = {"USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD", "CNY", "CNH", "SEK", "NOK", "MXN", "ZAR", "HKD", "SGD", "KRW", "INR", "BRL"}


def _ws_symbol(sym: str, feed: str) -> str:
    s = sym.upper()
    if feed == "us":
        base, _, _exch = s.partition(".")
        return base  # EODHD US feed takes bare tickers; share classes use "-"
    return s


class QuoteHub:
    """Holds the latest quote per symbol, the browser fanout set, and the
    upstream tasks. One instance per process, started from the app lifespan."""

    def __init__(self) -> None:
        self.token = _load_token()
        self.quotes: dict[str, dict] = {}
        self.feeds: dict[str, str] = {
            "us": "off", "crypto": "off", "forex": "off", "vix": "off",
        }
        self._clients: set[WebSocket] = set()
        self._dirty: set[str] = set()
        self._tasks: list[asyncio.Task] = []
        self._started = False
        self._ws: dict[str, Any] = {}  # live upstream socket per feed
        self._backoff: dict[str, float] = {"us": 1.0, "crypto": 1.0, "forex": 1.0}
        # Dynamic subscriptions: symbol → {"feed", "watchers": set[ws], "last_seen": monotonic}
        self._dynamic: dict[str, dict] = {}
        self._watch_lock = asyncio.Lock()
        # Ops counters for /api/stream/debug — how many raw frames each feed
        # delivered, how often it (re)connected, and what got stored/flushed.
        self.stats: dict[str, Any] = {
            "feed_frames": {"us": 0, "crypto": 0, "forex": 0},
            "feed_connects": {"us": 0, "crypto": 0, "forex": 0},
            "feed_last_error": {"us": None, "crypto": None, "forex": None, "vix": None},
            "feed_last_frame_at": {"us": None, "crypto": None, "forex": None, "vix": None},
            "feed_last_change_at": {"us": None, "crypto": None, "forex": None, "vix": None},
            "ticks_stored": 0,
            "flushes_sent": 0,
            "dynamic_subscribes": 0,
            "dynamic_unsubscribes": 0,
            "dynamic_rejected": 0,
        }
        self._last_frame_mono: dict[str, float | None] = {"us": None, "crypto": None, "forex": None, "vix": None}

    # ── lifecycle ────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        if not self.token:
            log.warning("EODHD_API_TOKEN not set — live stream disabled, feeds stay off")
            return
        for feed in ("us", "crypto", "forex"):
            self._tasks.append(asyncio.create_task(self._run_feed(feed)))
        self._tasks.append(asyncio.create_task(self._vix_loop()))
        self._tasks.append(asyncio.create_task(self._seed_loop()))
        self._tasks.append(asyncio.create_task(self._flush_loop()))
        self._tasks.append(asyncio.create_task(self._status_loop()))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        self._tasks.clear()
        self._started = False

    def _redact(self, text: str) -> str:
        return text.replace(self.token, "***") if self.token else text

    # ── stale / degraded verdicts ────────────────────────────────────────────

    def _session_open(self, feed: str, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        if feed == "crypto":
            return True
        if feed == "forex":
            ny = now.astimezone(cal.NY)
            # FX trades Sunday 17:00 ET → Friday 17:00 ET.
            wd, hr = ny.weekday(), ny.hour
            return not (wd == 5 or (wd == 6 and hr < 17) or (wd == 4 and hr >= 17))
        return cal.session_state(now)["is_open"]

    def stale_flags(self) -> dict[str, bool]:
        """A feed is stale when it claims to be open, its market is trading,
        and no frame has arrived within the feed's allowance."""
        out: dict[str, bool] = {}
        mono = time.monotonic()
        for feed in ("us", "crypto", "forex"):
            state = self.feeds.get(feed)
            last = self._last_frame_mono.get(feed)
            stale = False
            if state == "open" and self._session_open(feed):
                stale = last is None or (mono - last) > STALE_AFTER_SECONDS[feed]
            out[feed] = stale
        vix_last = self._last_frame_mono.get("vix")
        out["vix"] = self.feeds.get("vix") == "rest" and (vix_last is None or (mono - vix_last) > 3 * _VIX_POLL_SECONDS)
        return out

    def degraded(self) -> tuple[bool, list[str]]:
        reasons: list[str] = []
        if not self.token:
            reasons.append("EODHD_API_TOKEN not configured — relay off; quotes are stored closes")
            return True, reasons
        stale = self.stale_flags()
        for feed in ("us", "crypto", "forex"):
            state = self.feeds.get(feed)
            if state == "auth_failed":
                reasons.append(f"{feed} feed: EODHD rejected the token")
            elif state in ("closed", "connecting") and self._session_open(feed):
                reasons.append(f"{feed} feed is {state} during its trading session")
            elif stale.get(feed):
                reasons.append(f"{feed} feed is open but silent for over {int(STALE_AFTER_SECONDS[feed])} s during its session")
        if self.feeds.get("vix") == "closed":
            reasons.append("VIX delayed poll failing")
        return bool(reasons), reasons

    def debug(self) -> dict:
        """Ops view for /api/stream/debug — symbols and counts only, never a token."""
        is_degraded, reasons = self.degraded()
        dyn_syms = sorted(self._dynamic)
        return {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "token_configured": bool(self.token),
            "feeds": dict(self.feeds),
            "feed_stale": self.stale_flags(),
            "degraded": is_degraded,
            "degraded_reasons": reasons,
            "clients": len(self._clients),
            "symbols_stored": len(self.quotes),
            "reconnect_backoff_s": dict(self._backoff),
            "subscriptions": {
                "fixed": {feed: len(syms) for feed, syms in FEED_SYMBOLS.items()},
                "dynamic": len(dyn_syms),
                "dynamic_max": MAX_DYNAMIC_SYMBOLS,
                "dynamic_symbols": dyn_syms,
                "active_total": sum(len(s) for s in FEED_SYMBOLS.values()) + len(dyn_syms),
            },
            "session": cal.session_state(datetime.now(timezone.utc)),
            **self.stats,
        }

    # ── browser fanout ───────────────────────────────────────────────────────

    def _status_payload(self) -> dict:
        is_degraded, reasons = self.degraded()
        return {"type": "status", "feeds": self.feeds, "stale": self.stale_flags(), "degraded": is_degraded, "degraded_reasons": reasons}

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        try:
            is_degraded, reasons = self.degraded()
            await ws.send_text(json.dumps({
                "type": "snapshot",
                "items": list(self.quotes.values()),
                "feeds": self.feeds,
                "stale": self.stale_flags(),
                "degraded": is_degraded,
                "degraded_reasons": reasons,
                "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }))
            budget = {"msgs": TokenBucket(rate=WS_MESSAGES_PER_MIN / 60.0, burst=WS_MESSAGES_PER_MIN), "syms": TokenBucket(rate=WS_NEW_SYMBOLS_PER_HOUR / 3600.0, burst=10)}
            while True:
                raw = await ws.receive_text()
                if len(raw) > 2048 or not budget["msgs"].take():
                    continue  # never parse an oversized frame; drop a chatty client's extras
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    await self._handle_client_message(ws, msg, budget["syms"])
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001 — any transport error just drops the client
            pass
        finally:
            self._clients.discard(ws)
            await self._drop_watcher(ws)

    async def _handle_client_message(self, ws: WebSocket, msg: dict, sym_budget: TokenBucket | None = None) -> None:
        action = msg.get("action")
        syms = msg.get("symbols")
        if action not in ("watch", "unwatch") or not isinstance(syms, list):
            return
        syms = [str(s).upper() for s in syms[:MAX_DYNAMIC_SYMBOLS] if isinstance(s, str)]
        if action == "watch":
            for s in syms:
                if not self._is_fixed(s) and s not in self._dynamic and sym_budget is not None and not sym_budget.take():
                    self.stats["dynamic_rejected"] += 1
                    continue
                await self.watch(s, ws)
        else:
            for s in syms:
                await self.unwatch(s, ws)

    async def _send_all(self, payload: dict) -> None:
        if not self._clients:
            return
        text = json.dumps(payload)
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    async def _set_feed(self, feed: str, state: str) -> None:
        if self.feeds.get(feed) != state:
            self.feeds[feed] = state
            self.stats["feed_last_change_at"][feed] = _iso(time.time())
            log.info("feed %s → %s", feed, state)
            await self._send_all(self._status_payload())

    def _mark_frame(self, feed: str) -> None:
        self._last_frame_mono[feed] = time.monotonic()
        self.stats["feed_last_frame_at"][feed] = _iso(time.time())

    def _update(self, sym: str, quote: dict) -> None:
        self.quotes[sym] = quote
        self._dirty.add(sym)
        self.stats["ticks_stored"] += 1

    async def _flush_loop(self) -> None:
        """Coalesced fanout — at most one batch every 250ms."""
        while True:
            await asyncio.sleep(_BROADCAST_INTERVAL)
            if not self._dirty:
                continue
            items = [self.quotes[s] for s in self._dirty if s in self.quotes]
            self._dirty.clear()
            self.stats["flushes_sent"] += 1
            await self._send_all({"type": "quotes", "items": items})

    async def _status_loop(self) -> None:
        """Periodic status (stale flags change without a feed transition) and
        the idle sweep for dynamic subscriptions."""
        last_stale: dict[str, bool] = {}
        while True:
            await asyncio.sleep(_STATUS_INTERVAL)
            try:
                stale = self.stale_flags()
                if stale != last_stale:
                    last_stale = stale
                    await self._send_all(self._status_payload())
                await self._expire_dynamic()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("status loop: %s", self._redact(repr(exc)))

    # ── dynamic subscriptions (bounded) ──────────────────────────────────────

    def _is_fixed(self, sym: str) -> bool:
        return any(sym in syms for syms in FEED_SYMBOLS.values()) or sym == VIX_SYMBOL

    async def watch(self, sym: str, ws: WebSocket | None) -> bool:
        """Ask the relay to stream one more symbol. Returns False when the
        symbol cannot be streamed or the dynamic budget is spent."""
        sym = sym.upper()
        if self._is_fixed(sym):
            return True
        feed = feed_for_symbol(sym)
        if feed is None:
            self.stats["dynamic_rejected"] += 1
            return False
        async with self._watch_lock:
            entry = self._dynamic.get(sym)
            if entry is None:
                if len(self._dynamic) >= MAX_DYNAMIC_SYMBOLS:
                    # Evict the longest-idle unwatched symbol, else refuse.
                    idle = [(e["last_seen"], s) for s, e in self._dynamic.items() if not e["watchers"]]
                    if not idle:
                        self.stats["dynamic_rejected"] += 1
                        return False
                    _, victim = min(idle)
                    await self._unsubscribe_upstream(victim)
                entry = {"feed": feed, "watchers": set(), "last_seen": time.monotonic()}
                self._dynamic[sym] = entry
                await self._subscribe_upstream(sym, feed)
                # The delayed REST seed is a paid call: it shares the provider
                # layer's global bucket, so a burst of new symbols cannot
                # multiply upstream requests.
                if _eod._bucket.take():
                    asyncio.create_task(self._seed_symbols([sym]))
            entry["last_seen"] = time.monotonic()
            if ws is not None:
                entry["watchers"].add(ws)
        return True

    async def unwatch(self, sym: str, ws: WebSocket | None) -> None:
        sym = sym.upper()
        async with self._watch_lock:
            entry = self._dynamic.get(sym)
            if entry is None:
                return
            if ws is not None:
                entry["watchers"].discard(ws)
            entry["last_seen"] = time.monotonic()

    async def _drop_watcher(self, ws: WebSocket) -> None:
        async with self._watch_lock:
            for entry in self._dynamic.values():
                if ws in entry["watchers"]:
                    entry["watchers"].discard(ws)
                    entry["last_seen"] = time.monotonic()

    async def _expire_dynamic(self) -> None:
        now = time.monotonic()
        async with self._watch_lock:
            for sym in [s for s, e in self._dynamic.items() if not e["watchers"] and now - e["last_seen"] > DYNAMIC_IDLE_SECONDS]:
                await self._unsubscribe_upstream(sym)

    async def _subscribe_upstream(self, sym: str, feed: str) -> None:
        ws = self._ws.get(feed)
        if ws is None or self.feeds.get(feed) != "open":
            return  # the feed task re-sends every active symbol on (re)connect
        try:
            await ws.send(json.dumps({"action": "subscribe", "symbols": _ws_symbol(sym, feed)}))
            self.stats["dynamic_subscribes"] += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("dynamic subscribe %s failed: %s", sym, self._redact(repr(exc)))

    async def _unsubscribe_upstream(self, sym: str) -> None:
        entry = self._dynamic.pop(sym, None)
        if entry is None:
            return
        ws = self._ws.get(entry["feed"])
        if ws is not None and self.feeds.get(entry["feed"]) == "open":
            try:
                await ws.send(json.dumps({"action": "unsubscribe", "symbols": _ws_symbol(sym, entry["feed"])}))
                self.stats["dynamic_unsubscribes"] += 1
            except Exception as exc:  # noqa: BLE001
                log.warning("dynamic unsubscribe %s failed: %s", sym, self._redact(repr(exc)))

    def _active_symbols(self, feed: str) -> list[str]:
        fixed = [_ws_symbol(s, feed) for s in FEED_SYMBOLS[feed]]
        dyn = [_ws_symbol(s, feed) for s, e in self._dynamic.items() if e["feed"] == feed]
        return fixed + dyn

    # ── upstream: EODHD WebSocket feeds ──────────────────────────────────────

    async def _run_feed(self, feed: str) -> None:
        url = _WS_URL.format(feed=feed, token=self.token)
        backoff = 1.0
        while True:
            try:
                await self._set_feed(feed, "connecting")
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    self._ws[feed] = ws
                    self.stats["feed_connects"][feed] += 1
                    await ws.send(json.dumps({"action": "subscribe", "symbols": ",".join(self._active_symbols(feed))}))
                    await self._set_feed(feed, "open")
                    async for raw in ws:
                        self.stats["feed_frames"][feed] += 1
                        self._mark_frame(feed)
                        msg = json.loads(raw)
                        if not self._is_auth_error(msg) and backoff != 1.0:
                            # Reset only once EODHD has accepted the subscription
                            # (the 200 ack or a tick). Resetting on socket open let a
                            # refused subscribe (422 symbols limit) reconnect every
                            # second forever.
                            backoff = 1.0
                            self._backoff[feed] = backoff
                        if self._is_auth_error(msg):
                            # EODHD answers the subscribe with a status frame. A
                            # 401/403 is the token; anything else (a per-token
                            # connection limit after a restart, a transient
                            # refusal) is a normal drop that heals on its own.
                            code = msg.get("status_code")
                            note = self._redact(str(msg.get("message", "")))[:120]
                            self.stats["feed_last_error"][feed] = f"status {code}: {note}"
                            if code in (401, 403):
                                await self._set_feed(feed, "auth_failed")
                                log.error("feed %s: EODHD rejected the token (status %s)", feed, code)
                                backoff = 300.0  # retry slowly — a bad token won't heal fast
                            else:
                                log.warning("feed %s: EODHD refused the subscription (status %s: %s)", feed, code, note)
                            break
                        self._handle_tick(feed, msg)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — network errors retry forever
                self.stats["feed_last_error"][feed] = self._redact(repr(exc))
                log.warning("feed %s dropped: %s", feed, self._redact(str(exc)))
            finally:
                self._ws.pop(feed, None)
            if self.feeds.get(feed) != "auth_failed":
                await self._set_feed(feed, "closed")
            self._backoff[feed] = backoff
            await asyncio.sleep(backoff + random.random())
            backoff = min(backoff * 2, 30.0) if backoff < 300 else 300.0

    @staticmethod
    def _is_auth_error(msg: dict) -> bool:
        # EODHD acks the subscription with {"status_code": 200, "message": "Authorized"}.
        code = msg.get("status_code")
        return code is not None and code != 200

    def _handle_tick(self, feed: str, msg: dict) -> None:
        sym = msg.get("s")
        if not sym:
            return  # ack / heartbeat frames carry no symbol
        price = _f(msg.get("p"))
        if price is None and feed == "forex":
            # Forex frames carry ask/bid, no trade price — use the midpoint.
            a, b = _f(msg.get("a")), _f(msg.get("b"))
            if a is not None and b is not None:
                price = (a + b) / 2.0
            else:
                price = a if a is not None else b
        if price is None:
            return
        self._update(sym, {
            "s": sym,
            "p": price,
            "dc": _f(msg.get("dc")),
            "dd": _f(msg.get("dd")),
            "t": _f(msg.get("t")),
            "delayed": False,
            "src": "ws",
        })

    # ── upstream: REST delayed quotes (VIX + off-hours seed) ─────────────────

    async def _fetch_rest(self, client: httpx.AsyncClient, tickers: list[str]) -> list[dict]:
        """EODHD delayed real-time endpoint; batches via the s= parameter."""
        first, rest = tickers[0], tickers[1:]
        params = {"api_token": self.token, "fmt": "json"}
        if rest:
            params["s"] = ",".join(rest)
        r = await client.get(_REST_URL.format(ticker=first), params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else [data]

    def _store_rest_quote(self, row: dict, *, delayed: bool) -> None:
        code = str(row.get("code", ""))
        sym = code.rsplit(".", 1)[0] if "." in code else code
        if not sym:
            return
        price = _f(row.get("close"))
        if price is None:
            return
        ts = _f(row.get("timestamp"))
        live = self.quotes.get(sym)
        # Never let a 15-min-delayed REST row clobber a fresher WS tick.
        if live and live.get("src") == "ws" and ts is not None and live.get("t"):
            if live["t"] >= ts * 1000.0:
                return
        self._update(sym, {
            "s": sym,
            "p": price,
            "dc": _f(row.get("change_p")),
            "dd": _f(row.get("change")),
            "t": ts * 1000.0 if ts is not None else None,
            "delayed": delayed,
            "src": "rest",
        })

    async def _vix_loop(self) -> None:
        async with httpx.AsyncClient() as client:
            while True:
                try:
                    rows = await self._fetch_rest(client, [f"{VIX_SYMBOL}.INDX"])
                    for row in rows:
                        self._store_rest_quote(row, delayed=True)
                    self._mark_frame("vix")
                    await self._set_feed("vix", "rest")
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    self.stats["feed_last_error"]["vix"] = self._redact(repr(exc))
                    log.warning("VIX poll failed: %s", self._redact(str(exc)))
                    await self._set_feed("vix", "closed")
                await asyncio.sleep(_VIX_POLL_SECONDS)

    def _rest_tickers(self, symbols: list[str]) -> list[str]:
        out = []
        for s in symbols:
            feed = "us" if s in US_SYMBOLS else "crypto" if s in CRYPTO_SYMBOLS else "forex" if s in FOREX_SYMBOLS else (self._dynamic.get(s) or {}).get("feed") or feed_for_symbol(s)
            if feed is None:
                continue
            base = s if "." in s and feed != "us" else s.partition(".")[0]
            out.append(base + _REST_SUFFIX[feed])
        return out

    async def _seed_symbols(self, symbols: list[str]) -> None:
        tickers = self._rest_tickers(symbols)
        if not tickers or not self.token:
            return
        try:
            async with httpx.AsyncClient() as client:
                for i in range(0, len(tickers), 15):
                    for row in await self._fetch_rest(client, tickers[i : i + 15]):
                        self._store_rest_quote(row, delayed=True)
        except Exception as exc:  # noqa: BLE001
            log.warning("REST seed for %s failed: %s", symbols[:3], self._redact(str(exc)))

    async def _seed_loop(self) -> None:
        """Populate every symbol from the delayed REST endpoint at startup and
        every 5 minutes — the tape shows last-close rows off-hours and keeps
        moving (delayed) if a WS feed is down. WS ticks always win (see
        _store_rest_quote)."""
        while True:
            await self._seed_symbols(US_SYMBOLS + CRYPTO_SYMBOLS + FOREX_SYMBOLS + list(self._dynamic))
            await asyncio.sleep(_SEED_POLL_SECONDS)


hub = QuoteHub()
