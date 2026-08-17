import React from "react";

const COLORS = {
  live: "var(--pos)",
  clear: "var(--pos)",
  watch: "var(--warn)",
  risk: "var(--neg)",
  idle: "var(--text-faint)",
  accent: "var(--accent)",
};

export function StatusDot({ status = "live", label, pulse, size = 6, style, ...rest }) {
  const color = COLORS[status] || COLORS.live;
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
            color,
          }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
