import React from "react";

const DIR = {
  up: ["▲", "var(--pos-soft)"],
  down: ["▼", "var(--neg-soft)"],
  flat: ["→", "var(--neutral)"],
};

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
  const fs = size === "lg" ? "var(--fs-metric)" : size === "sm" ? "var(--fs-value)" : "var(--fs-value-lg)";
  return (
    <div {...rest} style={{ minWidth: 0, ...style }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-label)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-micro)",
          color: "var(--text-muted)",
          marginBottom: "var(--sp-3)",
          display: "flex",
          alignItems: "center",
          gap: "var(--gap-chip)",
        }}
      >
        {label}
        {live ? (
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "var(--pos)",
              animation: "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: fs,
          fontWeight: 600,
          letterSpacing: "var(--ls-numeric)",
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
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-body-s)",
            color,
            marginTop: "var(--sp-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {glyph} {delta}
        </div>
      ) : null}
    </div>
  );
}
