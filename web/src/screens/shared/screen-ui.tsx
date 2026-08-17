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

export const capStyle: React.CSSProperties = {
  ...mono,
  fontSize: 10,
  letterSpacing: ".04em",
  color: "var(--text-muted)",
  lineHeight: 1.5,
  marginTop: 6,
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
  const text = error
    ? "Unavailable — the data service did not answer."
    : loading
      ? "Reading stored data —"
      : (children ?? "Nothing on file.");
  return <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>{text}</span>;
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
}

/** The house slider — mono label/value line over a native range input themed
 * by .mrr-slider (app.css). Keyboard accessible by nature. */
export function SliderRow({ label, valueText, value, min, max, step, onChange, note }: SliderRowProps) {
  const id = useId();
  // Track fill: paint the accent up to the thumb, raised track beyond it.
  const pct = ((value - min) / (max - min)) * 100;
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ marginBottom: 10 }}>
      <label
        htmlFor={id}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body-s)",
          color: "var(--text-2)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--text)" }}>
          {valueText}
        </span>
      </label>
      <input
        ref={ref}
        id={id}
        className="mrr-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--surface-raised) ${pct}%)`,
        }}
      />
      {note ? <div style={{ ...capStyle, marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

/** "$1,234M" — deal sizes in the LBO calculator. */
export function fmtMillions(v: number): string {
  const r = Math.round(v);
  return `$${r.toLocaleString("en-US")}M`;
}
