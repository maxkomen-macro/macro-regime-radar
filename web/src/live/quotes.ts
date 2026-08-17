/**
 * Live-quote layer — client side of the api/stream.py relay.
 *
 * One WebSocket to /api/stream/ws (same-origin; Vite proxies it in dev). The
 * server holds the EODHD token and the upstream feeds; this module holds a
 * quote store and notifies React at most twice per second — ticks between
 * paints are coalesced, latest wins (day-1 spec). Reconnects with exponential
 * backoff; when the socket is down consumers fall back to their DB polls.
 *
 * Consumed via useSyncExternalStore hooks: useQuotes() / useFeedStatus().
 */

import { useSyncExternalStore } from "react";

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
  /** ms epoch of the last quote batch that arrived over the socket. */
  lastBatchAt: number | null;
}

const PAINT_INTERVAL_MS = 500; // ≤2 paints/sec, latest tick wins

/** One liveness window for every "is this live?" judgment — the shell dot,
 * the tape's ● rows, and the feed line must never disagree (critique 2026-08-06). */
export const LIVE_WINDOW_MS = 120_000;

type Listener = () => void;

const quotes = new Map<string, LiveQuote>();
let quotesSnapshot: ReadonlyMap<string, LiveQuote> = new Map();
let status: StreamStatus = { socket: "closed", feeds: {}, lastBatchAt: null };

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let flushTimer: number | null = null;
let reconnectTimer: number | null = null;
let backoffMs = 1_000;
let dirty = false;
let statusDirty = false;

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

function handleMessage(ev: MessageEvent) {
  let msg: { type: string; items?: LiveQuote[]; feeds?: Record<string, FeedState> };
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
      ...(msg.type === "snapshot" && msg.feeds ? { feeds: msg.feeds } : {}),
    });
  } else if (msg.type === "status" && msg.feeds) {
    setStatus({ feeds: msg.feeds });
  }
}

function connect() {
  if (ws != null || typeof WebSocket === "undefined") return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  setStatus({ socket: "connecting" });
  const sock = new WebSocket(`${proto}://${window.location.host}/api/stream/ws`);
  ws = sock;
  sock.onopen = () => {
    backoffMs = 1_000;
    setStatus({ socket: "open" });
  };
  sock.onmessage = handleMessage;
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setStatus({ socket: "closed" });
    if (listeners.size > 0 && reconnectTimer == null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  };
  sock.onerror = () => sock.close();
}

let heartbeatTimer: number | null = null;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  // Low-frequency heartbeat so time-derived snapshots (useStreamLive) decay
  // even when no new batches arrive — re-renders fire only if a value flips.
  if (heartbeatTimer == null) {
    heartbeatTimer = window.setInterval(() => listeners.forEach((l) => l()), 15_000);
  }
  return () => {
    listeners.delete(listener);
    // Last consumer gone → close the socket (nothing repaints anyway).
    if (listeners.size === 0) {
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
    }
  };
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
