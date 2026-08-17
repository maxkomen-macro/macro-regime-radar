import React from "react";

const LEVEL = {
  info: ["INFO", "var(--accent)"],
  watch: ["WATCH", "var(--warn)"],
  risk: ["RISK", "var(--neg)"],
};

/** One row of the alert feed. Level drives the rail colour and the label. */
export function AlertRow({ level = "info", name, message, date, style, ...rest }) {
  const [label, color] = LEVEL[level] || LEVEL.info;
  return (
    <div
      {...rest}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "baseline",
        gap: "var(--sp-6)",
        padding: "var(--sp-6) var(--sp-7)",
        background: "var(--surface)",
        borderLeft: `3px solid ${color}`,
        border: "0.5px solid var(--line-hair)",
        borderLeftWidth: "3px",
        borderLeftColor: color,
        borderRadius: "var(--r-xs)",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-micro)",
          fontWeight: 700,
          letterSpacing: "var(--ls-wide)",
          color,
          minWidth: 44,
        }}
      >
        {label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body-s)", color: "var(--text)" }}>{name}</span>
        {message ? (
          <span style={{ fontSize: "var(--fs-body-s)", color: "var(--text-muted)", marginLeft: "var(--sp-5)" }}>{message}</span>
        ) : null}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {date}
      </span>
    </div>
  );
}
