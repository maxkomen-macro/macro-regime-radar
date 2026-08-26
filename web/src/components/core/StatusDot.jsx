import React from "react";

const COLORS = {
  live: "var(--pos)",
  clear: "var(--pos)",
  watch: "var(--warn)",
  risk: "var(--neg)",
  idle: "var(--text-faint)",
  accent: "var(--accent)",
};

// The dot is decoration and may sit at --text-faint; the label is text a reader
// has to read, so `idle` reads its word at --text-muted (AA) instead of the
// ~2:1 faint token. Every other status colour already clears contrast.
const LABEL_COLORS = {
  idle: "var(--text-muted)",
};

export function StatusDot({ status = "live", label, pulse, size = 6, style, ...rest }) {
  const color = COLORS[status] || COLORS.live;
  const labelColor = LABEL_COLORS[status] || color;
  const animate = pulse === undefined ? status === "live" : pulse;
  return (
    <span
      {...rest}
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--gap-chip)", ...style }}
    >
      <span
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          animation: animate ? "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite" : "none",
        }}
      />
      {label ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
            letterSpacing: "var(--ls-micro)",
            textTransform: "uppercase",
            color: labelColor,
          }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
