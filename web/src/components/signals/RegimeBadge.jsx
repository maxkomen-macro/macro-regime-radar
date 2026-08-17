import React from "react";

const STYLES = {
  Goldilocks: ["var(--badge-goldilocks-bg)", "var(--badge-goldilocks-fg)", "var(--badge-goldilocks-line)"],
  Overheating: ["var(--badge-overheating-bg)", "var(--badge-overheating-fg)", "var(--badge-overheating-line)"],
  Stagflation: ["var(--badge-stagflation-bg)", "var(--badge-stagflation-fg)", "var(--badge-stagflation-line)"],
  "Recession Risk": ["var(--badge-recession-bg)", "var(--badge-recession-fg)", "var(--badge-recession-line)"],
};

const SIZES = {
  sm: { padding: "3px 10px", fontSize: "var(--fs-body-s)" },
  md: { padding: "8px 20px", fontSize: "var(--fs-value)" },
};

export function RegimeBadge({ label = "Goldilocks", size = "md", confidence, style, ...rest }) {
  const [bg, fg, line] = STYLES[label] || ["var(--surface-raised)", "var(--text-label)", "var(--line-strong)"];
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--gap-inline)",
        background: bg,
        color: fg,
        border: `0.5px solid ${line}`,
        borderRadius: "var(--r-md)",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        letterSpacing: "var(--ls-badge)",
        ...s,
        ...style,
      }}
    >
      {label}
      {confidence != null ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body-s)", opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(confidence * 100)}%
        </span>
      ) : null}
    </span>
  );
}
