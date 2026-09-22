import React from "react";

const DIR = {
  up: ["▲", "var(--pos)"],
  down: ["▼", "var(--neg)"],
  flat: ["→", "var(--neutral)"],
};

// Value ramp, UI face at 500 (spec section 1: big numbers are Plex Sans).
const SIZE = { xs: 14, sm: 20, md: 24, lg: 30, xl: 40 };

export function StatTile({
  label,
  value,
  delta,
  direction = "flat",
  size = "md",
  live = false,
  style,
  ...rest
}) {
  const [glyph, color] = DIR[direction] || DIR.flat;
  const fs = SIZE[size] ?? SIZE.md;
  return (
    <div {...rest} style={{ minWidth: 0, ...style }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: ".1em",
          color: "var(--text-3)",
          marginBottom: "var(--sp-3)",
          display: "flex",
          alignItems: "center",
          gap: "var(--gap-chip)",
        }}
      >
        {label}
        {live ? (
          <span
            data-live="true"
            aria-hidden="true"
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "var(--mint)",
              animation: "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: fs,
          fontWeight: 500,
          letterSpacing: "-.01em",
          fontVariantNumeric: "tabular-nums",
          color: "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {delta != null ? (
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 400,
            color,
            marginTop: 2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {glyph} {delta}
        </div>
      ) : null}
    </div>
  );
}
