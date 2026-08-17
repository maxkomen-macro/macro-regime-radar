import React from "react";

const TONES = {
  default: { border: "0.5px solid var(--line-hair)" },
  watch: { border: "0.5px solid rgba(210,153,34,.3)" },
  risk: { border: "0.5px solid rgba(218,54,51,.3)" },
  clear: { border: "0.5px solid rgba(63,185,80,.3)" },
  accent: { border: "0.5px solid var(--accent-line)" },
};

const ACCENTS = {
  default: "var(--accent)",
  watch: "var(--warn)",
  risk: "var(--neg)",
  clear: "var(--pos)",
  accent: "var(--accent)",
};

export function Card({
  tone = "default",
  accentBar = false,
  padding = "var(--pad-card)",
  surface = "var(--surface)",
  style,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.default;
  return (
    <div
      {...rest}
      style={{
        background: surface,
        border: t.border,
        borderLeft: accentBar ? `3px solid ${ACCENTS[tone] || ACCENTS.default}` : t.border,
        borderRadius: "var(--r-md)",
        padding,
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
