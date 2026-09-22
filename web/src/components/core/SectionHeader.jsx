import React from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";

/**
 * Default element per level. The document outline is h1 (the wordmark, owned by
 * AppShell / LandingPage, or the tab hero) then h2 per section then h3 per
 * subsection.
 */
const LEVEL_ELEMENT = { section: "h2", sub: "h3" };

/* Mockup .eyebrow: 12px Plex Sans 500, .24em, uppercase, --text-eyebrow. Every UA
   heading style that would diverge from a div is pinned (font-size, font-weight,
   margins) so `as` changes semantics only. Consumer `style` still spreads last. */
const EYEBROW = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-eyebrow)",
  fontWeight: 500,
  letterSpacing: "var(--ls-eyebrow)",
  textTransform: "uppercase",
  color: "var(--text-eyebrow)",
  lineHeight: 1.35,
  padding: 0,
  marginLeft: 0,
  marginRight: 0,
};

/* Mockup .meta: the mono 11px uppercase string beside a heading. Set explicitly
   (not inherited) so the slot reads the same in both layouts. */
const META = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "var(--ls-badge-mono)",
  textTransform: "uppercase",
  color: "var(--text-3)",
  whiteSpace: "normal",
  textAlign: "right",
  minWidth: 0,
};

/**
 * Labels a module. `layout="inline"` (default) keeps today's DOM: one heading
 * containing the title span and, when set, the `right` span, so the label
 * harvest reads the concatenated text unchanged (checklist 02 risk G1).
 * `layout="panel"` is the mockup `.sec-head`: heading, description and a
 * right-hand block (meta then actions) as siblings inside a flex wrapper.
 */
export function SectionHeader({
  title,
  level = "section",
  as,
  right,
  layout = "inline",
  description,
  actions,
  className,
  style,
  ...rest
}) {
  const Comp = as || LEVEL_ELEMENT[level] || "h2";
  // The eyebrow never wraps at desk width (mockup); below 768px it may, so a
  // long title cannot push past a phone-width panel.
  const { isNarrow } = useBreakpoint();
  const nowrap = isNarrow ? "normal" : "nowrap";

  if (level === "sub") {
    return (
      <Comp
        {...rest}
        className={className}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-eyebrow-sm)",
          fontWeight: 500,
          letterSpacing: "var(--ls-eyebrow-sm)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          lineHeight: 1.35,
          margin: "12px 0 6px",
          padding: 0,
          ...style,
        }}
      >
        {title}
      </Comp>
    );
  }

  if (layout === "panel") {
    const hasSide = Boolean(right) || Boolean(actions);
    return (
      <div
        {...rest}
        className={["mrr-sec-head", className].filter(Boolean).join(" ")}
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 18,
          marginBottom: 14,
          minHeight: 22,
          ...style,
        }}
      >
        <Comp style={{ ...EYEBROW, marginTop: 0, marginBottom: 0, whiteSpace: nowrap }}>{title}</Comp>
        {description != null && description !== false ? (
          <span className="mrr-sec-desc" style={{ fontSize: "13px", color: "var(--text-2)", minWidth: 0 }}>
            {description}
          </span>
        ) : null}
        {hasSide ? (
          <div className="mrr-sec-sp" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 26 }}>
            {right ? <span style={{ ...META, textAlign: "left" }}>{right}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Comp
      {...rest}
      className={className}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 18,
        ...EYEBROW,
        marginTop: 16,
        marginBottom: 14,
        minHeight: 22,
        whiteSpace: nowrap,
        ...style,
      }}
    >
      <span style={{ minWidth: 0 }}>{title}</span>
      {right ? <span style={META}>{right}</span> : null}
    </Comp>
  );
}
