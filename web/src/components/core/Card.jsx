import React from "react";

/* Variant surfaces (mockup .panel, .tile, .card). Borders are the three longhands
   rather than the `border` shorthand so a tone changes only border-color; the
   tile border literal has no section-B token (checklist 02 risk G13). */
const VARIANTS = {
  panel: {
    background: "var(--panel)",
    borderColor: "var(--line)",
    borderRadius: "var(--r-card)",
    padding: "var(--pad-panel)",
  },
  tile: {
    background: "var(--tile)",
    borderColor: "rgba(150,175,200,.10)",
    borderRadius: "var(--r-tile)",
    padding: "var(--pad-tile)",
  },
  card: {
    background: "var(--card-grad)",
    borderColor: "var(--line)",
    borderRadius: "var(--r-card)",
    padding: "var(--pad-panel)",
  },
};

/* Tone borders: 1px at the badge alphas (the Tag tints). `default` keeps the
   variant border. */
const TONE_BORDER = {
  watch: "var(--amber-a36)",
  risk: "rgba(240,80,63,.38)",
  clear: "var(--mint-a32)",
  accent: "var(--link-a32)",
};

/* Callout rail colour and the 8% wash behind it (mockup "Quality ladder
   tension"). `default` and `accent` share the link blue. */
const CALLOUT = {
  default: ["var(--link)", "rgba(88,184,230,.08)"],
  accent: ["var(--link)", "rgba(88,184,230,.08)"],
  watch: ["var(--amber)", "rgba(245,181,46,.08)"],
  risk: ["var(--neg)", "rgba(240,80,63,.08)"],
  clear: ["var(--mint)", "rgba(38,220,160,.08)"],
};

/**
 * Panel / tile / card surface. `accentBar` turns the box into the mockup
 * callout: a 3px rail in the tone colour, a 0 8 8 0 radius and a horizontal
 * wash, with no outer border. Consumer `padding`, `surface` and `style` win.
 */
export function Card({
  tone = "default",
  accentBar = false,
  variant = "panel",
  as: Comp = "div",
  padding,
  surface,
  style,
  children,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.panel;
  const base = { color: "var(--text)", fontFamily: "var(--font-ui)" };
  let s;
  if (accentBar) {
    const [rail, wash] = CALLOUT[tone] || CALLOUT.default;
    s = {
      ...base,
      background: surface ?? `linear-gradient(90deg, ${wash}, transparent)`,
      borderLeft: `3px solid ${rail}`,
      borderRadius: "0 8px 8px 0",
      padding: padding ?? "10px 14px",
    };
  } else {
    s = {
      ...base,
      background: surface ?? v.background,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: TONE_BORDER[tone] || v.borderColor,
      borderRadius: v.borderRadius,
      padding: padding ?? v.padding,
    };
  }
  return (
    <Comp {...rest} style={{ ...s, ...style }}>
      {children}
    </Comp>
  );
}
