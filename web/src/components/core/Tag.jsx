import React from "react";

const TONES = {
  neutral: ["var(--surface-raised)", "var(--text-label)", "var(--line-strong)"],
  accent: ["var(--accent-dim)", "var(--accent)", "var(--accent-line)"],
  pos: ["rgba(63,185,80,.12)", "var(--pos)", "rgba(63,185,80,.25)"],
  warn: ["rgba(210,153,34,.12)", "var(--warn)", "rgba(210,153,34,.25)"],
  hot: ["rgba(230,126,34,.12)", "var(--warn-hot)", "rgba(230,126,34,.30)"],
  neg: ["rgba(218,54,51,.12)", "var(--neg-text)", "rgba(218,54,51,.25)"],
  research: ["rgba(124,58,237,.14)", "#a78bfa", "rgba(124,58,237,.35)"],
};

export function Tag({ tone = "neutral", size = "sm", uppercase = true, style, children, ...rest }) {
  const [bg, fg, line] = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--gap-chip)",
        background: bg,
        color: fg,
        border: `0.5px solid ${line}`,
        borderRadius: "var(--r-xs)",
        padding: sm ? "2px 6px" : "4px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: sm ? "var(--fs-micro)" : "var(--fs-label)",
        fontWeight: 600,
        letterSpacing: uppercase ? "var(--ls-micro)" : "0",
        textTransform: uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
