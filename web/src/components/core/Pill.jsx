import React from "react";

/* Mockup .pill, .pill.amber, .pill.gray; the regime tints are derived by analogy
   with amber (checklist 02 B.6, values marked derived: the design lead may
   retune them without an API change). */
const TONES = {
  mint: { color: "#2fe6a4", background: "var(--mint-a11)", borderColor: "var(--mint-a50)", boxShadow: "var(--glow-pill)" },
  amber: { color: "#f7c14a", background: "var(--amber-a10)", borderColor: "rgba(245,181,46,.5)", boxShadow: "var(--glow-pill-amber)" },
  gray: { color: "#c9d2da", background: "rgba(200,210,220,.07)", borderColor: "rgba(200,210,220,.35)", boxShadow: "none" },
  overheating: {
    color: "var(--r-overheating)",
    background: "rgba(230,126,34,.11)",
    borderColor: "rgba(230,126,34,.5)",
    boxShadow: "0 0 22px rgba(230,126,34,.14), inset 0 0 12px rgba(230,126,34,.07)",
  },
  stagflation: {
    color: "var(--r-stagflation)",
    background: "rgba(231,76,60,.11)",
    borderColor: "rgba(231,76,60,.5)",
    boxShadow: "0 0 22px rgba(231,76,60,.14), inset 0 0 12px rgba(231,76,60,.07)",
  },
};

const SIZES = {
  md: { height: 40, padding: "0 18px", fontSize: "var(--fs-pill)", letterSpacing: "var(--ls-pill)" },
  sm: { height: 28, padding: "0 12px", fontSize: "11.5px", letterSpacing: ".1em" },
};

/** The probability pill: mono uppercase on a 999px capsule with the soft glow
 * (the one shadow spec section 0 allows besides the hero). */
export function Pill({ tone = "mint", size = "md", className, style, children, ...rest }) {
  const key = TONES[tone] ? tone : "mint";
  const t = TONES[key];
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      data-tone={key}
      {...rest}
      className={["mrr-pill", className].filter(Boolean).join(" ")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        boxSizing: "border-box",
        height: s.height,
        padding: s.padding,
        borderRadius: "var(--r-pill)",
        fontFamily: "var(--font-mono)",
        fontSize: s.fontSize,
        fontWeight: 400,
        letterSpacing: s.letterSpacing,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        borderWidth: 1,
        borderStyle: "solid",
        ...t,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
