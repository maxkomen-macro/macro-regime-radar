import React from "react";

/**
 * Default element per level. The document outline is h1 (the wordmark, owned by
 * AppShell / LandingPage) → h2 per section → h3 per subsection.
 */
const LEVEL_ELEMENT = { section: "h2", sub: "h3" };

/**
 * Every UA heading style that would diverge from the previous <div> rendering is
 * pinned below: font-size (UA boosts h2 to 1.5em / h3 to 1.17em), font-weight
 * (UA bold), margin-block-start/end and margin-inline-start/end (UA sets
 * margin-block in em and margin-inline to 0; a div has no UA margin at all).
 * Consumer `style` still spreads last, so `style={{ marginTop: 0 }}` keeps working.
 */
export function SectionHeader({ title, level = "section", as, right, style, ...rest }) {
  const Comp = as || LEVEL_ELEMENT[level] || "h2";

  if (level === "sub") {
    return (
      <Comp
        {...rest}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body-s)",
          fontWeight: 500,
          color: "var(--text-2)",
          marginTop: "var(--sp-7)",
          marginBottom: "var(--sp-4)",
          marginLeft: 0,
          marginRight: 0,
          ...style,
        }}
      >
        {title}
      </Comp>
    );
  }
  return (
    <Comp
      {...rest}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--sp-5)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-label)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "var(--ls-label)",
        color: "var(--text-label)",
        paddingBottom: "var(--sp-4)",
        borderBottom: "1px solid var(--line-hair)",
        marginBottom: "var(--sp-6)",
        marginTop: "var(--sp-8)",
        marginLeft: 0,
        marginRight: 0,
        ...style,
      }}
    >
      <span>{title}</span>
      {right ? <span style={{ color: "var(--text-muted)", letterSpacing: "var(--ls-micro)" }}>{right}</span> : null}
    </Comp>
  );
}
