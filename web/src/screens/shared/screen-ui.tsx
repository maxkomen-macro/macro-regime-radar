/**
 * Shared screen-level furniture for the night-2 tabs — caption + state-note
 * conventions from the Dashboard/Markets screens, a debounce hook, and the
 * house slider row used by every calculator (Recession sensitivity, LBO,
 * scenario builder). Bundle components stay untouched; this is screen code.
 *
 * 2026-09-15 (redesign Phase 2, checklist B.12 and B.16): captions restyled to
 * the mockup `.cap`, a mono caption variant (`.mono-note`), `metaStyle`
 * (`.meta`) and the sub-eyebrow moved to Plex Sans (`.eyebrow-sm`); the slider
 * gains the current-reading tick and the amber changed state. Every prior
 * export keeps its name and shape.
 */

import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type React from "react";
import { InDetailsContext } from "./Disclosure";
import { useSnapshotMeta } from "../../api/snapshot";

export const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

/* Captions are prose: they read in the UI face, one step under body size
   (mockup .cap; 13px keeps the DESIGN.md sans floor, risk G6). Mono inside a
   caption is opt-in per number via <span style={mono}>, or whole-line via
   <Caption mono>. */
export const capStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 400,
  fontSize: "var(--fs-caption)",
  lineHeight: 1.5,
  color: "var(--text-3)",
  marginTop: 6,
  // Captions under full-frame charts and tables keep a readable measure
  // instead of running the whole 1,500px frame (review 2026-09-05).
  maxWidth: "var(--maxw-prose)",
};

/** Mono provenance line under a tile or chart (mockup .mono-note). */
export const monoNoteStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 400,
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--text-3)",
};

/** Mono uppercase meta string: "Live model output", "5 inputs · latest Aug 2026" (mockup .meta). */
export const metaStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 400,
  fontSize: 11,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

/** The G4 copy classes (docs/redesign-v2/ITERATION_1.md, Iteration 1 step
 * 5): `data-copy` marks the copy a reader sees with every disclosure closed,
 * and the copy-iteration e2e spec caps it: a hero lede at most three
 * sentences, a caption at most two, a status line one rendered line. */
export type CopyKind = "lede" | "caption" | "status";

/** The marker attributes for one element; none inside an open Disclosure
 * panel (the text behind "Details" is not capped). `max` is the rare third
 * caption sentence a number would be misread without; the call site says why. */
export function useCopyMarker(kind: CopyKind | false | undefined, max?: 3): Record<string, string> {
  const inDetails = useContext(InDetailsContext);
  if (!kind || inDetails) return {};
  return max ? { "data-copy": kind, "data-copy-max": String(max) } : { "data-copy": kind };
}

/** One-line desk-note caption under a chart or metric block. Marked
 * `data-copy="caption"` (G4: at most two sentences); `copy="status"` marks a
 * one-line status instead, `copy={false}` leaves it unmarked. */
export function Caption({
  children,
  style,
  mono: isMono = false,
  as = "div",
  copy = "caption",
  copyMax,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Whole-line mono for provenance strings and the signal-card lines. */
  mono?: boolean;
  as?: "div" | "p";
  /** The G4 copy class this caption is capped by (default "caption"). */
  copy?: CopyKind | false;
  /** 3 only where a number would be misread without the third sentence. */
  copyMax?: 3;
}) {
  const Tag = as;
  const marker = useCopyMarker(copy, copyMax);
  const base = isMono ? { ...capStyle, ...monoNoteStyle } : capStyle;
  return (
    <Tag {...marker} style={{ ...base, ...(as === "p" ? { marginBottom: 0 } : null), ...style }}>
      {children}
    </Tag>
  );
}

/* ── CP4: a block with nothing to show names what is missing ─────────────
 * Iteration 1, CP4: any block with no data for the current selection says
 * what is missing and why; it never renders blank. The validated snapshot
 * (api/snapshot.ts) carries the stored tables only, so every block fed by a
 * server computation or a market provider has nothing to show on a static
 * deploy: there it says the block is not in this snapshot and why; with no
 * snapshot it says what failed. One sentence, built here once. */

/** What a block reads, named once: `what` leads the failed-call sentence
 * ("Recession model unavailable: the data service did not answer."),
 * `snapshot` is the whole sentence a snapshot session prints. */
export interface MissingSource {
  what: string;
  snapshot: string;
}

/** The sources the validated snapshot does not carry
 * (docs/redesign-v2/BACKEND_FIXES_REPORT.md, "Snapshot mode", Not covered). */
export const MISSING = {
  recession: {
    what: "Recession model",
    snapshot: "The recession model is computed live on the server and is not in this snapshot.",
  },
  curve: {
    what: "Yield curve",
    snapshot: "The 2s10s reading comes with the recession model, which is not in this snapshot.",
  },
  recessionScenario: {
    what: "Recession model rescoring",
    snapshot: "The recession model rescores on the server; it is not available in this snapshot.",
  },
  takeaway: {
    what: "Takeaway",
    snapshot: "The market takeaway is composed live on the server and is not in this snapshot.",
  },
  cycle: {
    what: "Cycle position",
    snapshot: "Cycle position and spell duration are computed live on the server and are not in this snapshot.",
  },
  transitions: {
    what: "Transition odds",
    snapshot: "Transition odds are computed live on the server and are not in this snapshot.",
  },
  scenarios: {
    what: "Scenario builder",
    snapshot: "The scenario builder runs on the server; it is not available in this snapshot.",
  },
  analogues: {
    what: "Historical analogues",
    snapshot: "Historical analogues are matched live on the server and are not in this snapshot.",
  },
  lbo: {
    what: "LBO calculator",
    snapshot: "The LBO calculator runs on the server; it is not available in this snapshot.",
  },
  lboRate: {
    what: "LBO financing rate",
    snapshot: "The LBO financing rate is read on the server and is not in this snapshot.",
  },
  allocation: {
    what: "Allocation engine",
    snapshot: "The asset allocation engine runs on the server; it is not available in this snapshot.",
  },
  market: {
    what: "Market prices",
    snapshot: "Live and stored market prices are not in this snapshot.",
  },
  closes: {
    what: "Stored closes",
    snapshot: "Stored market closes are not in this snapshot.",
  },
  intraday: {
    what: "Stored intraday bars",
    snapshot: "Stored intraday bars are not in this snapshot.",
  },
  quotes: {
    what: "Live quotes",
    snapshot: "Live market quotes are not in this snapshot.",
  },
} as const satisfies Record<string, MissingSource>;

/** The short form for a summary row whose label names the block, under a
 * card that leads with the full sentence. */
export const MISSING_ROW = "row" as const;

/** The failed-call sentence with no snapshot on hand. */
export const DID_NOT_ANSWER = "Unavailable: the data service did not answer.";

/** CP4's one sentence: in a snapshot session the snapshot sentence, else what
 * failed. `"row"` is the short form for a labelled summary row. */
export function missingNote(what: MissingSource | typeof MISSING_ROW, snapshot: boolean): string {
  if (what === MISSING_ROW) return snapshot ? "Not in this snapshot." : DID_NOT_ANSWER;
  return snapshot ? what.snapshot : `${what.what} unavailable: the data service did not answer.`;
}

/** True when a validated snapshot seeded this session (the static deploy, or
 * a sleeping backend): a failed block then says it is not in the snapshot. */
export function useSnapshotMode(): boolean {
  return useSnapshotMeta() != null;
}

/** Standardized loading / error / empty line in desk voice — never a spinner,
 * never a blank. With `missing`, the error line names the block and why
 * (CP4, `missingNote`). */
export function StateNote({
  loading,
  error,
  live,
  missing,
  children,
}: {
  loading?: boolean;
  error?: boolean;
  /** role="status" on the span, for result lines and tab-level state lines a
   * screen reader should hear when they change (redesign Phase 10, U6-022).
   * Off by default; never put it on a heading. The words never change. */
  live?: boolean;
  /** The block's source (a `MISSING` entry) or `"row"`: the error line then
   * reads `missingNote(missing, snapshot)` instead of the generic line. */
  missing?: MissingSource | typeof MISSING_ROW;
  children?: React.ReactNode;
}) {
  const snapshot = useSnapshotMode();
  // A caller's own loading sentence ("Building ~24 years of monthly return
  // history…") outranks the generic line; it was being dropped (review fix).
  const text = error
    ? missing
      ? missingNote(missing, snapshot)
      : DID_NOT_ANSWER
    : loading
      ? (children ?? "Reading stored data…")
      : (children ?? "Nothing on file.");
  return (
    <span
      role={live ? "status" : undefined}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-3)",
      }}
    >
      {text}
    </span>
  );
}

/** Scroll to the URL hash once the screen's data is on the page (palette
 * section jumps land mid-screen) — the Dashboard's pattern, shared.
 *
 * Returns `release`: a screen whose local view switch (SubTabs) re-keys
 * `ready` calls it when the reader picks a view, so the hash the reader
 * arrived with is not scrolled to again on that switch (Iteration 1, R2: the
 * router keeps the arrival hash while SubTabs rewrites the address bar with
 * replaceState). The next navigation (a link, the palette, Back) scrolls as
 * before. The landing holds while late content grows the page (a few
 * seconds, until the reader scrolls, clicks or types). */
export function useHashScroll(ready?: unknown): () => void {
  const location = useLocation();
  // The router's location object identifies one navigation: a fragment
  // navigation (a same-page goto, Back) can reuse the "default" key of the
  // first load, but always brings a new object.
  const released = useRef<object | null>(null);
  const current = useRef<object>(location);
  current.current = location;
  useEffect(() => {
    if (!location.hash || released.current === current.current) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    // Content that lands after the jump (a panel's data above the target, or
    // a page still too short to scroll that far, which clamps the jump) would
    // leave the target off its mark: keep it landed while the page grows, for
    // a few seconds and only until the reader scrolls, clicks or types
    // (Iteration 1, R2: a hash on a sub-tab's lower section).
    if (typeof ResizeObserver === "undefined") return;
    const INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    let done = false;
    const ro = new ResizeObserver(() => {
      if (!done) document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    const stop = () => {
      if (done) return;
      done = true;
      ro.disconnect();
      window.clearTimeout(timer);
      INPUT.forEach((type) => window.removeEventListener(type, stop));
    };
    const timer = window.setTimeout(stop, 4000);
    INPUT.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    ro.observe(document.body);
    return stop;
  }, [location.hash, ready]);
  return useCallback(() => {
    released.current = current.current;
  }, []);
}

/** Debounce a fast-changing value (slider drags) before it reaches a query key. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Sub-eyebrow for groups inside panels and tiles: Plex Sans 11px 500, .2em,
 * uppercase (mockup .eyebrow-sm). The uppercase transform is load-bearing:
 * the label-parity harvester keys on it. */
export const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-eyebrow-sm)",
  letterSpacing: "var(--ls-eyebrow-sm)",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

interface NumberFieldProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Unit suffix printed after the field ("%", "×", "$M", "yr"). */
  unit?: string;
  ariaLabel?: string;
  /** Decimal places to display; defaults from `step`. */
  dp?: number;
  disabled?: boolean;
  /** Amber text while the value differs from the row's baseline. */
  changed?: boolean;
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

/** Typed numeric input paired with a slider (2026-09-05). Commits on blur or
 * Enter, clamps to [min, max], and flags out-of-range drafts with
 * aria-invalid while the analyst is still typing. */
export function NumberField({ id, value, min, max, step, onChange, unit, ariaLabel, dp, disabled, changed }: NumberFieldProps) {
  const places = dp ?? decimalsOf(step);
  const fmt = (v: number) => v.toFixed(places);
  const [draft, setDraft] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  // Escape reverts: the blur it triggers must not commit the stale draft
  // (Phase 10 a11y pass, B.4 #4).
  const reverting = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, places]);
  const parsed = Number(draft);
  const invalid = draft.trim() === "" || Number.isNaN(parsed) || parsed < min || parsed > max;
  const commit = () => {
    setEditing(false);
    if (Number.isNaN(parsed) || draft.trim() === "") {
      setDraft(fmt(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(Number(clamped.toFixed(places)));
    setDraft(fmt(clamped));
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <input
        id={id}
        className="mrr-number"
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={editing && invalid ? true : undefined}
        title={`Enter a value from ${fmt(min)} to ${fmt(max)}`}
        style={changed ? { color: "var(--amber)" } : undefined}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (reverting.current) {
            reverting.current = false;
            setEditing(false);
            setDraft(fmt(value));
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            reverting.current = true;
            setDraft(fmt(value));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit ? (
        <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}>{unit}</span>
      ) : null}
    </span>
  );
}

interface SliderRowProps {
  label: React.ReactNode;
  /** Preformatted current value, rendered right of the label. */
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Optional note under the row (e.g. live-default provenance). */
  note?: React.ReactNode;
  /** Render a typed field beside the value so precise assumptions never
   * depend on the slider alone. */
  input?: { unit?: string; dp?: number };
  /** Plain-text name for assistive tech when `label` is an element. */
  name?: string;
  disabled?: boolean;
  /** The current reading: draws the tick, and the row reads as changed while
   * `value` differs from it. */
  baseline?: number;
  /** Scale-row labels; `left` / `right` default to `format(min)` / `format(max)`,
   * `mid` to "│ current reading" on a changed row with a baseline. */
  scale?: { left?: React.ReactNode; right?: React.ReactNode; mid?: React.ReactNode };
  /** Default: true when `scale` or `baseline` is given, so existing call sites
   * render no scale row until their phase adds one. */
  showScale?: boolean;
  /** Formats the default scale labels (default `String`). */
  format?: (v: number) => string;
  /** Explicit changed flag (the LBO "modified deal" case with no single baseline). */
  changed?: boolean;
}

/** Position on the track, clamped and rounded to 0.001% so a baseline such as
 * 4.3 on a 3 to 7 scale prints "32.5%" rather than a floating-point tail. */
function pctOf(v: number, min: number, max: number): number {
  if (max === min) return 0;
  const raw = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return Math.round(raw * 1000) / 1000;
}

/** The house slider: label + value line over a native range input with a
 * 28px hit area (app.css .mrr-slider-wrap) and an optional typed field.
 * Keyboard accessible by nature; the whole row rings on focus. A changed value
 * (vs `baseline`) is amber in the value, the fill and the thumb ring, and the
 * scale row prints "│ current reading" under the tick, so the state never rides
 * on colour alone. */
export function SliderRow({
  label,
  valueText,
  value,
  min,
  max,
  step,
  onChange,
  note,
  input,
  name,
  disabled,
  baseline,
  scale,
  showScale,
  format = String,
  changed: changedProp,
}: SliderRowProps) {
  const id = useId();
  const pct = pctOf(value, min, max);
  const ref = useRef<HTMLInputElement>(null);
  const plainName = name ?? (typeof label === "string" ? label : undefined);
  const hasBaseline = baseline != null;
  const changed = changedProp ?? (hasBaseline && value !== baseline);
  const scaleOn = showScale ?? (scale != null || hasBaseline);
  const mid = scale?.mid ?? (hasBaseline && changed ? "│ current reading" : null);
  return (
    <div className="mrr-slider-row" data-changed={changed ? "true" : "false"} style={{ padding: "8px 0 10px", margin: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "var(--text-2)",
        }}
      >
        <label htmlFor={id}>{label}</label>
        {input ? (
          <NumberField
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            unit={input.unit}
            dp={input.dp}
            disabled={disabled}
            changed={changed}
            ariaLabel={plainName ? `${plainName} (typed)` : "Typed value"}
          />
        ) : (
          <span
            className="mrr-slider-value"
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              fontSize: 14,
              fontVariantNumeric: "tabular-nums",
              color: changed ? "var(--amber)" : "var(--text)",
            }}
          >
            {valueText}
          </span>
        )}
      </div>
      <div className="mrr-slider-wrap">
        <div className="mrr-slider-track" aria-hidden="true" />
        <div className="mrr-slider-fill" aria-hidden="true" style={{ width: `${pct}%`, background: changed ? "var(--amber)" : "var(--link)" }} />
        {hasBaseline ? <div className="mrr-slider-tick" aria-hidden="true" style={{ left: `${pctOf(baseline, min, max)}%` }} /> : null}
        <input
          ref={ref}
          id={id}
          className="mrr-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={typeof label === "string" ? undefined : plainName}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {scaleOn ? (
        <div
          className="mrr-slider-scale"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 400,
            fontSize: 10,
            color: "var(--text-3)",
            marginTop: 2,
          }}
        >
          <span>{scale?.left ?? format(min)}</span>
          <span>{mid}</span>
          <span>{scale?.right ?? format(max)}</span>
        </div>
      ) : null}
      {note ? <div style={{ ...capStyle, marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

/** "$1,234M" — deal sizes in the LBO calculator. */
export function fmtMillions(v: number): string {
  const r = Math.round(v);
  return `$${r.toLocaleString("en-US")}M`;
}
