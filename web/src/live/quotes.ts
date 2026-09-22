/**
 * Live-quote layer — client side of the api/stream.py relay.
 *
 * One WebSocket to /api/stream/ws (same-origin; Vite proxies it in dev; a
 * split deploy sets VITE_WS_BASE). The server holds the EODHD token and the
 * upstream feeds; this module holds a quote store and notifies React at most
 * twice per second — ticks between paints are coalesced, latest wins (day-1
 * spec). Reconnects with exponential backoff; when the socket is down
 * consumers fall back to their DB polls.
 *
 * 2026-09-06: the relay now reports stale flags and a degraded verdict, and
 * accepts bounded dynamic subscriptions — `watch(symbol)` / `unwatch(symbol)`
 * (reference counted, re-sent on every reconnect) let a single-name panel
 * ask for a symbol outside the fixed tape. `streamWord()` is the one place
 * that turns socket + feed + tick state into the shell's status word.
 *
 * Consumed via useSyncExternalStore hooks: useQuotes() / useStreamStatus().
 */

import { useEffect, useSyncExternalStore } from "react";

export interface LiveQuote {
  s: string;
  p: number;
  /** EODHD's own day-change % / day-change $ — passed through, never recomputed. */
  dc: number | null;
  dd: number | null;
  /** Tick time, ms epoch. */
  t: number | null;
  /** True for 15-min-delayed REST rows (VIX always; others off-hours). */
  delayed: boolean;
  src: "ws" | "rest";
}

export type FeedState = "off" | "connecting" | "open" | "closed" | "auth_failed" | "rest";

export interface StreamStatus {
  /** Relay socket from this browser to the API. */
  socket: "connecting" | "open" | "closed";
  /** Upstream feed states as the relay reports them. */
  feeds: Record<string, FeedState>;
  /** Relay-side stale flags per feed (open but silent during a session). */
  stale: Record<string, boolean>;
  degraded: boolean;
  degradedReasons: string[];
  /** ms epoch of the last quote batch that arrived over the socket. */
  lastBatchAt: number | null;
  /** Consecutive failed connection attempts since the last open socket. */
  attempts: number;
  /** True once a socket has ever opened in this session. */
  everOpened: boolean;
}

const PAINT_INTERVAL_MS = 500; // ≤2 paints/sec, latest tick wins

/** One liveness window for every "is this live?" judgment — the shell dot,
 * the tape's ● rows, and the feed line must never disagree (critique 2026-08-06). */
export const LIVE_WINDOW_MS = 120_000;

type Listener = () => void;

const quotes = new Map<string, LiveQuote>();
let quotesSnapshot: ReadonlyMap<string, LiveQuote> = new Map();
let status: StreamStatus = {
  socket: "closed",
  feeds: {},
  stale: {},
  degraded: false,
  degradedReasons: [],
  lastBatchAt: null,
  attempts: 0,
  everOpened: false,
};

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let flushTimer: number | null = null;
let reconnectTimer: number | null = null;
let backoffMs = 1_000;
let dirty = false;
let statusDirty = false;

/** Reference-counted dynamic watches, re-sent on every (re)connect. */
const watches = new Map<string, number>();

function notify() {
  if (dirty) {
    quotesSnapshot = new Map(quotes);
    dirty = false;
  }
  statusDirty = false;
  listeners.forEach((l) => l());
}

/** Coalesce store writes into ≤2 notifications per second. */
function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    if (dirty || statusDirty) notify();
  }, PAINT_INTERVAL_MS);
}

function setStatus(patch: Partial<StreamStatus>) {
  status = { ...status, ...patch };
  statusDirty = true;
  scheduleFlush();
}

interface RelayMessage {
  type: string;
  items?: LiveQuote[];
  feeds?: Record<string, FeedState>;
  stale?: Record<string, boolean>;
  degraded?: boolean;
  degraded_reasons?: string[];
}

function handleMessage(ev: MessageEvent) {
  let msg: RelayMessage;
  try {
    msg = JSON.parse(String(ev.data));
  } catch {
    return;
  }
  if (msg.type === "snapshot" || msg.type === "quotes") {
    (msg.items ?? []).forEach((q) => {
      if (q && q.s && typeof q.p === "number") quotes.set(q.s, q);
    });
    dirty = true;
    setStatus({
      lastBatchAt: Date.now(),
      ...(msg.type === "snapshot" ? statusPatch(msg) : {}),
    });
  } else if (msg.type === "status") {
    setStatus(statusPatch(msg));
  }
}

function statusPatch(msg: RelayMessage): Partial<StreamStatus> {
  return {
    ...(msg.feeds ? { feeds: msg.feeds } : {}),
    ...(msg.stale ? { stale: msg.stale } : {}),
    ...(typeof msg.degraded === "boolean" ? { degraded: msg.degraded } : {}),
    ...(msg.degraded_reasons ? { degradedReasons: msg.degraded_reasons } : {}),
  };
}

/** Relay URL: VITE_WS_BASE (ws(s)://host) wins; else derive from
 * VITE_API_BASE; else same-origin. */
export function relayUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const wsBase = env.VITE_WS_BASE?.replace(/\/$/, "");
  if (wsBase) return `${wsBase}/api/stream/ws`;
  const apiBase = env.VITE_API_BASE?.replace(/\/$/, "");
  if (apiBase && /^https?:/.test(apiBase)) return `${apiBase.replace(/^http/, "ws")}/api/stream/ws`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/stream/ws`;
}

function send(payload: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function connect() {
  if (ws != null || typeof WebSocket === "undefined") return;
  setStatus({ socket: "connecting" });
  let sock: WebSocket;
  try {
    sock = new WebSocket(relayUrl());
  } catch {
    setStatus({ socket: "closed", attempts: status.attempts + 1 });
    scheduleReconnect();
    return;
  }
  ws = sock;
  sock.onopen = () => {
    backoffMs = 1_000;
    setStatus({ socket: "open", attempts: 0, everOpened: true });
    if (watches.size) send({ action: "watch", symbols: [...watches.keys()] });
  };
  sock.onmessage = handleMessage;
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setStatus({ socket: "closed", attempts: status.attempts + 1 });
    scheduleReconnect();
  };
  sock.onerror = () => sock.close();
}

function scheduleReconnect() {
  if (listeners.size > 0 && reconnectTimer == null) {
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

let heartbeatTimer: number | null = null;
let closeTimer: number | null = null;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (closeTimer != null) {
    // A consumer came back within the grace period: keep the socket.
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  connect();
  // Low-frequency heartbeat so time-derived snapshots (useStreamLive) decay
  // even when no new batches arrive — re-renders fire only if a value flips.
  if (heartbeatTimer == null) {
    heartbeatTimer = window.setInterval(() => listeners.forEach((l) => l()), 15_000);
  }
  return () => {
    listeners.delete(listener);
    // Last consumer gone → close the socket (nothing repaints anyway), after
    // a short grace so a re-mount (route change, StrictMode's double effect)
    // reuses the connection instead of tearing it down mid-handshake.
    if (listeners.size === 0 && closeTimer == null) {
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        if (listeners.size !== 0) return;
        if (reconnectTimer != null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (heartbeatTimer != null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        ws?.close();
        ws = null;
      }, 300);
    }
  };
}

/** Ask the relay to stream one more symbol (bounded server-side). Returns
 * the release function; the subscription ends when the last holder releases. */
export function watch(symbol: string): () => void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return () => {};
  const n = watches.get(sym) ?? 0;
  watches.set(sym, n + 1);
  if (n === 0) send({ action: "watch", symbols: [sym] });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (watches.get(sym) ?? 1) - 1;
    if (left <= 0) {
      watches.delete(sym);
      send({ action: "unwatch", symbols: [sym] });
    } else watches.set(sym, left);
  };
}

/** Component-scoped watch: subscribes on mount, releases on unmount. */
export function useWatch(symbol: string | null) {
  useEffect(() => {
    if (!symbol) return;
    return watch(symbol);
  }, [symbol]);
}

const getQuotes = () => quotesSnapshot;
const getStatus = () => status;

/** Latest quotes by symbol — repaints at most twice per second. */
export function useQuotes(): ReadonlyMap<string, LiveQuote> {
  return useSyncExternalStore(subscribe, getQuotes);
}

/** Relay + upstream feed status, for honest live/idle labelling. */
export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(subscribe, getStatus);
}

const getLive = () => streamIsLive(status, quotes);

/** Primitive live/idle read — subscribers repaint only when the bit flips,
 * so the app shell can gate its dot without 2Hz re-renders. */
export function useStreamLive(): boolean {
  return useSyncExternalStore(subscribe, getLive);
}

/** True when live (non-delayed) websocket data flowed inside LIVE_WINDOW_MS. */
export function streamIsLive(s: StreamStatus, q: ReadonlyMap<string, LiveQuote>): boolean {
  if (s.socket !== "open" || s.lastBatchAt == null) return false;
  if (Date.now() - s.lastBatchAt > LIVE_WINDOW_MS) return false;
  for (const quote of q.values()) {
    if (quote.src === "ws" && quote.t != null && Date.now() - quote.t < LIVE_WINDOW_MS) return true;
  }
  return false;
}

export interface LiveFeeds {
  us: boolean;
  crypto: boolean;
  forex: boolean;
}

const FX_CCY = /^[A-Z]{6}$/;

/** Which feeds carried a live websocket tick inside the window. */
export function liveFeeds(s: StreamStatus, q: ReadonlyMap<string, LiveQuote>): LiveFeeds {
  const out = { us: false, crypto: false, forex: false };
  if (s.socket !== "open") return out;
  const now = Date.now();
  for (const quote of q.values()) {
    if (quote.src !== "ws" || quote.t == null || now - quote.t >= LIVE_WINDOW_MS) continue;
    if (quote.s.endsWith("-USD")) out.crypto = true;
    else if (FX_CCY.test(quote.s)) out.forex = true;
    else out.us = true;
  }
  return out;
}

let liveFeedsSnapshot: LiveFeeds = { us: false, crypto: false, forex: false };
function getLiveFeeds(): LiveFeeds {
  const next = liveFeeds(status, quotes);
  if (next.us !== liveFeedsSnapshot.us || next.crypto !== liveFeedsSnapshot.crypto || next.forex !== liveFeedsSnapshot.forex) liveFeedsSnapshot = next;
  return liveFeedsSnapshot;
}

export function useLiveFeeds(): LiveFeeds {
  return useSyncExternalStore(subscribe, getLiveFeeds);
}

export type StreamWord = "Live" | "Delayed" | "Reconnecting" | "Backend unavailable" | "Off";

/**
 * The status word for the shell, from one function so every surface agrees:
 *   Live                 socket open and live ticks inside the window
 *   Delayed              socket open, quotes are REST/delayed rows or feeds closed
 *   Reconnecting         the socket dropped and the client is retrying
 *   Backend unavailable  never connected after several attempts (host asleep)
 *   Off                  relay has no token: stored closes only
 */
export function streamWord(s: StreamStatus, q: ReadonlyMap<string, LiveQuote>): StreamWord {
  if (s.socket === "open") {
    const feeds = Object.values(s.feeds);
    if (feeds.length && feeds.every((f) => f === "off")) return "Off";
    return streamIsLive(s, q) ? "Live" : "Delayed";
  }
  if (s.everOpened) return "Reconnecting";
  return s.attempts >= 2 ? "Backend unavailable" : "Reconnecting";
}

export function useStreamWord(): StreamWord {
  return useSyncExternalStore(subscribe, () => streamWord(status, quotes));
}
