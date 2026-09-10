/**
 * Shared screen-level furniture for the night-2 tabs — caption + state-note
 * conventions from the Dashboard/Markets screens, a debounce hook, and the
 * house slider row used by every calculator (Recession sensitivity, LBO,
 * scenario builder). Bundle components stay untouched; this is screen code.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type React from "react";

export const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

/* Captions are prose: they read in the UI face, one step under body size.
   Mono inside a caption is opt-in per number via <span style={mono}>. */
export const capStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-muted)",
  lineHeight: 1.55,
  marginTop: 6,
  // Captions under full-frame charts and tables keep a readable measure
  // instead of running the whole 1,500px frame (review 2026-09-05).
  maxWidth: "var(--maxw-prose)",
};

/** One-line desk-note caption under a chart or metric block. */
export function Caption({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...capStyle, ...style }}>{children}</div>;
}

/** Standardized loading / error / empty line in desk voice — never a spinner,
 * never a blank. */
export function StateNote({
  loading,
  error,
  children,
}: {
  loading?: boolean;
  error?: boolean;
  children?: React.ReactNode;
}) {
  // A caller's own loading sentence ("Building ~24 years of monthly return
  // history…") outranks the generic line; it was being dropped (review fix).
  const text = error
    ? "Unavailable: the data service did not answer."
    : loading
      ? (children ?? "Reading stored data…")
      : (children ?? "Nothing on file.");
  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-muted)",
      }}
    >
      {text}
    </span>
  );
}

/** Scroll to the URL hash once the screen's data is on the page (palette
 * section jumps land mid-screen) — the Dashboard's pattern, shared. */
export function useHashScroll(ready?: unknown) {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [location.hash, ready]);
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

/** Mono uppercase micro-eyebrow used for sub-groups inside cards. */
export const eyebrowStyle: React.CSSProperties = {
  ...mono,
  fontSize: "var(--fs-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-wide)",
  color: "var(--text-label)",
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
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

/** Typed numeric input paired with a slider (2026-09-05). Commits on blur or
 * Enter, clamps to [min, max], and flags out-of-range drafts with
 * aria-invalid while the analyst is still typing. */
export function NumberField({ id, value, min, max, step, onChange, unit, ariaLabel, dp, disabled }: NumberFieldProps) {
  const places = dp ?? decimalsOf(step);
  const fmt = (v: number) => v.toFixed(places);
  const [draft, setDraft] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
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
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
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
  /** Preformatted current value, rendered mono right of the label. */
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
}

/** The house slider: label + value line over a native range input with a
 * 28px hit area (app.css .mrr-slider-wrap) and an optional typed field.
 * Keyboard accessible by nature; the whole row rings on focus. */
export function SliderRow({ label, valueText, value, min, max, step, onChange, note, input, name, disabled }: SliderRowProps) {
  const id = useId();
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const ref = useRef<HTMLInputElement>(null);
  const plainName = name ?? (typeof label === "string" ? label : undefined);
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body-s)",
          color: "var(--text-2)",
          marginBottom: 2,
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
            ariaLabel={plainName ? `${plainName} (typed)` : "Typed value"}
          />
        ) : (
          <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--text)" }}>
            {valueText}
          </span>
        )}
      </div>
      <div className="mrr-slider-wrap">
        <div className="mrr-slider-track" aria-hidden="true" />
        <div className="mrr-slider-fill" aria-hidden="true" style={{ width: `${pct}%` }} />
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
      {note ? <div style={{ ...capStyle, marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

/** "$1,234M" — deal sizes in the LBO calculator. */
export function fmtMillions(v: number): string {
  const r = Math.round(v);
  return `$${r.toLocaleString("en-US")}M`;
}
