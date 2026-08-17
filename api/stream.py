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

Message protocol to browsers (JSON):
  {"type": "snapshot", "items": [Quote...], "feeds": {...}}   on connect
  {"type": "quotes",   "items": [Quote...]}                   coalesced ticks
  {"type": "status",   "feeds": {feed: state}}                on transitions
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
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import WebSocket, WebSocketDisconnect

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
        # Ops counters for /api/stream/debug — how many raw frames each feed
        # delivered, how often it (re)connected, and what got stored/flushed.
        self.stats: dict[str, Any] = {
            "feed_frames": {"us": 0, "crypto": 0, "forex": 0},
            "feed_connects": {"us": 0, "crypto": 0, "forex": 0},
            "feed_last_error": {"us": None, "crypto": None, "forex": None},
            "ticks_stored": 0,
            "flushes_sent": 0,
        }

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

    # ── browser fanout ───────────────────────────────────────────────────────

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        try:
            await ws.send_text(json.dumps({
                "type": "snapshot",
                "items": list(self.quotes.values()),
                "feeds": self.feeds,
            }))
            # Hold the socket open; we ignore anything the browser sends.
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001 — any transport error just drops the client
            pass
        finally:
            self._clients.discard(ws)

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
            log.info("feed %s → %s", feed, state)
            await self._send_all({"type": "status", "feeds": self.feeds})

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

    # ── upstream: EODHD WebSocket feeds ──────────────────────────────────────

    async def _run_feed(self, feed: str) -> None:
        symbols = ",".join(FEED_SYMBOLS[feed])
        url = _WS_URL.format(feed=feed, token=self.token)
        backoff = 1.0
        while True:
            try:
                await self._set_feed(feed, "connecting")
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    self.stats["feed_connects"][feed] += 1
                    await ws.send(json.dumps({"action": "subscribe", "symbols": symbols}))
                    await self._set_feed(feed, "open")
                    backoff = 1.0
                    async for raw in ws:
                        self.stats["feed_frames"][feed] += 1
                        msg = json.loads(raw)
                        if self._is_auth_error(msg):
                            await self._set_feed(feed, "auth_failed")
                            log.error("feed %s: EODHD rejected the token", feed)
                            backoff = 300.0  # retry slowly — a bad token won't heal fast
                            break
                        self._handle_tick(feed, msg)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — network errors retry forever
                self.stats["feed_last_error"][feed] = self._redact(repr(exc))
                log.warning("feed %s dropped: %s", feed, self._redact(str(exc)))
            if self.feeds.get(feed) != "auth_failed":
                await self._set_feed(feed, "closed")
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
                    await self._set_feed("vix", "rest")
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    log.warning("VIX poll failed: %s", self._redact(str(exc)))
                    await self._set_feed("vix", "closed")
                await asyncio.sleep(_VIX_POLL_SECONDS)

    async def _seed_loop(self) -> None:
        """Populate every symbol from the delayed REST endpoint at startup and
        every 5 minutes — the tape shows last-close rows off-hours and keeps
        moving (delayed) if a WS feed is down. WS ticks always win (see
        _store_rest_quote)."""
        tickers = (
            [s + _REST_SUFFIX["us"] for s in US_SYMBOLS]
            + [s + _REST_SUFFIX["crypto"] for s in CRYPTO_SYMBOLS]
            + [s + _REST_SUFFIX["forex"] for s in FOREX_SYMBOLS]
        )
        chunks = [tickers[i : i + 15] for i in range(0, len(tickers), 15)]
        async with httpx.AsyncClient() as client:
            while True:
                try:
                    for chunk in chunks:
                        for row in await self._fetch_rest(client, chunk):
                            self._store_rest_quote(row, delayed=True)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    log.warning("REST seed sweep failed: %s", self._redact(str(exc)))
                await asyncio.sleep(_SEED_POLL_SECONDS)


hub = QuoteHub()
