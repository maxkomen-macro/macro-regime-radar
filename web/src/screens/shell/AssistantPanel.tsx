/**
 * AI Analyst — the floating assistant: launcher, terminal panel, and the SSE
 * client for POST /api/assistant/ask, all in one file (the AlertDrawer /
 * CommandPalette idiom: one overlay surface, one file).
 *
 * The conversation is React state and nothing else — no localStorage, no
 * sessionStorage, no DB. This is a public app shared with strangers; a
 * persisted transcript would show one visitor the previous visitor's
 * questions. Refresh clears it, and the footer says so.
 *
 * Wire contract (fixed, backend built to the same spec):
 *   POST /api/assistant/ask
 *   body   {message, history: [{role, content}], tab_context}
 *   stream text/event-stream —
 *          default event  data: {"delta": "<text>"}   append in order
 *          event: error   data: {"message": "<text>"} terminal, show as the reply
 *          event: done    data: {}                    turn complete
 * fetch + ReadableStream, not EventSource: EventSource cannot POST and the app
 * carries no polyfill.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader } from "../../components";
import { capStyle, mono } from "../shared/screen-ui";
import { fmtDate, fmtMonYr } from "../../lib/format";
import Markdown from "./Markdown";

/** Same resolution rule as api/client.ts — same-origin in prod, Vite proxy in dev. */
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** Cost guard, mirroring the Streamlit assistant: last 20 turns = 40 entries. */
const HISTORY_TURN_LIMIT = 20;
const MAX_HISTORY_ENTRIES = HISTORY_TURN_LIMIT * 2;

const UNREACHABLE = "API unreachable. Is the service running?";

/** Recruiter-facing openers — the exact four the Streamlit assistant shipped. */
const SUGGESTED = [
  "What's driving the current regime?",
  "Explain what I'm looking at on this tab",
  "Should I be worried about recession risk right now?",
  "Top headlines today and why they matter",
];

export interface AssistantTabContext {
  /** Route slug of the tab in view. */
  tab: string;
  label: string;
  /** Section labels on that tab, in page order. */
  sections: string[];
  /** "live" for data tabs, "reference" for Methodology (mirrors the Streamlit
   * register_tab_context kinds). */
  kind?: "live" | "reference";
  /** Full route incl. hash, and the anchored section id when there is one. */
  route?: string;
  active_section?: string | null;
  /** Freshness stamps the shell already holds, so the model can cite them. */
  as_of?: Record<string, string | null>;
  /** The shell's headline numbers (regime, odds, confidence). */
  key_metrics?: Record<string, string | number | null>;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Error turns render in red-on-dark and are never sent back as history. */
  error?: boolean;
}

interface AskPayload {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  tab_context: AssistantTabContext | null;
}

/* ── SSE over fetch ────────────────────────────────────────────────────────
   The stream arrives as arbitrary byte chunks: a frame can be split across
   reads and a multi-byte character can be split across reads. TextDecoder
   with {stream: true} holds partial code points; `buffer` holds partial
   frames until their blank-line terminator shows up. */

/** Index/length of the first frame terminator in the buffer, LF or CRLF. */
function nextFrameBreak(buf: string): { index: number; length: number } | null {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf === -1 || (lf !== -1 && lf < crlf)) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

/** One frame → its event name and its joined data payload (SSE field rules). */
function parseFrame(raw: string): { event: string; data: string } {
  let event = "";
  const data: string[] = [];
  for (const line of raw.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(":")) continue; // blank lines and heartbeat comments
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return { event, data: data.join("\n") };
}

function errorFrameMessage(data: string): string {
  try {
    const parsed = JSON.parse(data) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    /* fall through to the generic line */
  }
  return "The assistant stopped on an error it did not describe.";
}

/** Returns true when the frame ends the turn (done or error). */
function dispatchFrame(
  raw: string,
  onDelta: (text: string) => void,
  onError: (message: string) => void,
): boolean {
  const { event, data } = parseFrame(raw);
  if (event === "done") return true;
  if (event === "error") {
    onError(errorFrameMessage(data));
    return true;
  }
  if (!data) return false;
  try {
    const parsed = JSON.parse(data) as { delta?: unknown };
    if (typeof parsed.delta === "string" && parsed.delta) onDelta(parsed.delta);
  } catch {
    /* a malformed frame is a backend bug — skip it, keep reading the stream */
  }
  return false;
}

/** HTTP failed before the stream opened (503, proxy error, non-JSON body). */
async function httpErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown; message?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    /* non-JSON error body — keep the status line */
  }
  return `Assistant unavailable: ${res.status} ${res.statusText}.`;
}

async function streamAsk(
  payload: AskPayload,
  onDelta: (text: string) => void,
  onError: (message: string) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    if (!signal.aborted) onError(UNREACHABLE);
    return;
  }
  if (!res.ok || !res.body) {
    onError(await httpErrorMessage(res));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      // {stream: true} keeps a code point that straddles two reads intact;
      // the bare decode() at the end flushes whatever bytes are left.
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let brk = nextFrameBreak(buffer);
      while (brk) {
        const frame = buffer.slice(0, brk.index);
        buffer = buffer.slice(brk.index + brk.length);
        if (dispatchFrame(frame, onDelta, onError)) {
          finished = true;
          break;
        }
        brk = nextFrameBreak(buffer);
      }
      if (finished) break;
      if (chunk.done) {
        // A final frame that arrived without its blank-line terminator still counts.
        if (buffer.trim()) dispatchFrame(buffer, onDelta, onError);
        break;
      }
    }
  } catch {
    if (!signal.aborted) onError("The assistant connection dropped mid-answer.");
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/* ── Turn-list helpers ─────────────────────────────────────────────────── */

function appendToLast(prev: Turn[], chunk: string): Turn[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || last.error) return prev;
  const next = prev.slice();
  next[next.length - 1] = { ...last, content: last.content + chunk };
  return next;
}

/** Error text lands in the empty in-progress turn, or as its own turn when the
 * model already streamed prose (partial answers are not thrown away). */
function failLast(prev: Turn[], message: string): Turn[] {
  const last = prev[prev.length - 1];
  const next = prev.slice();
  if (last && last.role === "assistant" && !last.error && last.content === "") {
    next[next.length - 1] = { role: "assistant", content: message, error: true };
    return next;
  }
  next.push({ role: "assistant", content: message, error: true });
  return next;
}

/* ── UI ────────────────────────────────────────────────────────────────── */

const labelStyle: React.CSSProperties = {
  ...mono,
  fontSize: "var(--fs-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-wide)",
  marginBottom: 3,
};

const buttonBase: React.CSSProperties = {
  appearance: "none",
  background: "none",
  border: "0.5px solid var(--line-hair)",
  borderRadius: "var(--r-xs)",
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
};

/**
 * The panel is controlled by the shell (2026-09-05): the launcher is a header
 * chip so it never floats over data, and the shell returns focus to it when
 * the panel closes. The conversation survives close/reopen for the session.
 */
export default function AssistantPanel({
  open,
  onClose,
  tabContext,
}: {
  open: boolean;
  onClose: () => void;
  tabContext: AssistantTabContext | null;
}) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const closePanel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Escape closes even when focus has left the input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  // Focus moves into the panel on open, and back to the input when a stream
  // ends (a disabled input drops focus on the browser's side).
  useEffect(() => {
    if (open && !streaming) inputRef.current?.focus();
  }, [open, streaming]);

  // The log tracks the newest text as it streams.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // An in-flight answer outlives a close (reopen and it is there); it does not
  // outlive the shell.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || streaming) return;

      const history = messages
        .filter((m) => !m.error)
        .slice(-MAX_HISTORY_ENTRIES)
        .map((m) => ({ role: m.role, content: m.content }));

      setDraft("");
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: "" },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAsk(
          { message: question, history, tab_context: tabContext },
          (chunk) => setMessages((prev) => appendToLast(prev, chunk)),
          (msg) => setMessages((prev) => failLast(prev, msg)),
          controller.signal,
        );
      } catch {
        setMessages((prev) => failLast(prev, UNREACHABLE));
      } finally {
        abortRef.current = null;
        setStreaming(false);
        // A turn that ended with no text at all says so rather than showing a blank.
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant" || last.error || last.content !== "") return prev;
          return failLast(prev, "No answer came back: the assistant returned an empty response.");
        });
      }
    },
    [messages, streaming, tabContext],
  );

  return (
    <>
      {open && (
        <div id="assistant-panel" className="assistant-panel" role="dialog" aria-label="AI analyst">
          {/* SectionHeader supplies the house h2 typography; the panel's own
              hairline lives on this row, so the header's rule and block margins
              are overridden rather than duplicated 10px apart. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              borderBottom: "1px solid var(--line-hair)",
            }}
          >
            <SectionHeader
              as="h2"
              title="AI Analyst"
              style={{ margin: 0, paddingBottom: 0, borderBottom: "none", flex: 1 }}
            />
            <button
              onClick={closePanel}
              aria-label="Close AI analyst"
              title="Close · Esc"
              style={{
                ...buttonBase,
                border: "none",
                color: "var(--text-muted)",
                fontSize: 16,
                minWidth: 28,
                minHeight: 28,
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>

          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={streaming}
            style={{ flex: 1, overflowY: "auto", padding: "12px 12px 4px" }}
          >
            {messages.length === 0 ? (
              <>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--fs-body-s)",
                    lineHeight: "var(--lh-body)",
                    color: "var(--text-muted)",
                    marginBottom: 10,
                  }}
                >
                  Ask about the regime, a signal, or the screen you are on. Answers read the same
                  stored data these tabs render.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      disabled={streaming}
                      style={{
                        ...buttonBase,
                        fontFamily: "var(--font-ui)",
                        color: "var(--text-2)",
                        fontSize: "var(--fs-body-s)",
                        lineHeight: 1.35,
                        minHeight: 32,
                        padding: "5px 9px",
                        textAlign: "left",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              messages.map((m, i) => {
                const isAssistant = m.role === "assistant";
                const rail = m.error ? "var(--neg)" : "var(--accent)";
                return (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        ...labelStyle,
                        color: m.error
                          ? "var(--neg-text)"
                          : isAssistant
                            ? "var(--accent)"
                            : "var(--text-muted)",
                      }}
                    >
                      {isAssistant ? (m.error ? "◆ Analyst · error" : "◆ Analyst") : "▸ You"}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--fs-body)",
                        lineHeight: "var(--lh-body)",
                        color: m.error
                          ? "var(--neg-text)"
                          : isAssistant
                            ? "var(--text)"
                            : "var(--text-2)",
                        whiteSpace: isAssistant && !m.error ? "normal" : "pre-wrap",
                        // 3px left rail = generated content (blue for model
                        // output, red when the turn is an error).
                        borderLeft: isAssistant ? `3px solid ${rail}` : "none",
                        paddingLeft: isAssistant ? 8 : 0,
                      }}
                    >
                      {isAssistant && !m.error ? (
                        m.content ? (
                          <Markdown text={m.content} />
                        ) : streaming && i === messages.length - 1 ? (
                          <span style={{ color: "var(--text-muted)" }}>Analyzing the stored data…</span>
                        ) : null
                      ) : (
                        m.content
                      )}
                      {streaming && isAssistant && i === messages.length - 1 ? (
                        <span className="mrr-caret" aria-hidden="true" />
                      ) : null}
                    </div>
                    {isAssistant && !m.error && m.content && !(streaming && i === messages.length - 1) ? (
                      <div
                        style={{
                          ...mono,
                          fontSize: "var(--fs-micro)",
                          letterSpacing: "var(--ls-micro)",
                          color: "var(--text-muted)",
                          marginTop: 4,
                          paddingLeft: 11,
                        }}
                      >
                        Source: stored terminal data
                        {tabContext?.as_of?.macro ? ` · macro ${fmtMonYr(tabContext.as_of.macro)}` : ""}
                        {tabContext?.as_of?.market_daily ? ` · market ${fmtDate(tabContext.as_of.market_daily)}` : ""}
                        {tabContext?.label ? ` · view: ${tabContext.label}` : ""}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            style={{
              display: "flex",
              gap: 6,
              padding: "8px 12px",
              borderTop: "1px solid var(--line-hair)",
            }}
          >
            <input
              ref={inputRef}
              className="assistant-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={streaming}
              placeholder={streaming ? "Answering…" : "Ask the analyst…"}
              aria-label="Ask the analyst"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={streaming || !draft.trim()}
              style={{
                ...buttonBase,
                color: streaming || !draft.trim() ? "var(--text-muted)" : "var(--accent)",
                minHeight: 28,
                fontSize: "var(--fs-meta)",
                letterSpacing: "var(--ls-micro)",
                textTransform: "uppercase",
                padding: "3px 10px",
                cursor: streaming || !draft.trim() ? "default" : "pointer",
              }}
            >
              Send
            </button>
          </form>

          <div style={{ ...capStyle, margin: 0, padding: "0 12px 10px" }}>
            Session-only; refresh clears the conversation. Not investment advice.
          </div>
        </div>
      )}
    </>
  );
}
