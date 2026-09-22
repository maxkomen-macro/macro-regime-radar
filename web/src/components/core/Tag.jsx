import React from "react";

/* Pre-redesign tone names alias to the mockup badge tints (checklist 02 B.5). */
const ALIAS = { neutral: "reference", accent: "info", pos: "clear", warn: "watch", neg: "alert" };

/* [text, fill, border] per tone (mockup .badge .b-clear / .b-watch / .b-alert /
   .b-info / .b-ref; hot and research kept from the old set at the same alphas). */
const TONES = {
  clear: ["var(--mint)", "var(--mint-a07)", "var(--mint-a32)"],
  watch: ["var(--amber)", "var(--amber-a07)", "var(--amber-a36)"],
  alert: ["var(--neg)", "rgba(240,80,63,.08)", "rgba(240,80,63,.38)"],
  info: ["var(--link)", "var(--link-a07)", "var(--link-a32)"],
  reference: ["var(--text-2)", "rgba(255,255,255,.03)", "var(--line-white-14)"],
  hot: ["var(--warn-hot)", "rgba(230,126,34,.07)", "rgba(230,126,34,.36)"],
  research: ["#a78bfa", "rgba(124,58,237,.07)", "rgba(124,58,237,.35)"],
};

/* sm is the mockup standard badge; xs the compact chip (ticker, Beat / Miss);
   md carries sentence-case conviction badges. */
const SIZES = {
  xs: { height: 20, padding: "0 7px", fontSize: "10px" },
  sm: { height: 24, padding: "0 11px", fontSize: "var(--fs-badge)" },
  md: { height: 28, padding: "0 13px", fontSize: "12.5px" },
};

export function Tag({ tone = "reference", size = "sm", uppercase = true, style, children, ...rest }) {
  const key = ALIAS[tone] || (TONES[tone] ? tone : "reference");
  const [fg, bg, line] = TONES[key];
  const s = SIZES[size] || SIZES.sm;
  return (
    <span
      data-tone={key}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--gap-chip)",
        boxSizing: "border-box",
        height: s.height,
        padding: s.padding,
        borderRadius: "var(--r-badge)",
        background: bg,
        color: fg,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: line,
        fontFamily: "var(--font-mono)",
        fontSize: s.fontSize,
        fontWeight: 500,
        letterSpacing: uppercase ? "var(--ls-badge-mono)" : "0",
        textTransform: uppercase ? "uppercase" : "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
