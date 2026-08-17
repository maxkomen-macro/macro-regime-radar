import React from "react";

export function SectionHeader({ title, level = "section", right, style, ...rest }) {
  if (level === "sub") {
    return (
      <div
        {...rest}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body-s)",
          fontWeight: 500,
          color: "var(--text-2)",
          marginTop: "var(--sp-7)",
          marginBottom: "var(--sp-4)",
          ...style,
        }}
      >
        {title}
      </div>
    );
  }
  return (
    <div
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
        ...style,
      }}
    >
      <span>{title}</span>
      {right ? <span style={{ color: "var(--text-muted)", letterSpacing: "var(--ls-micro)" }}>{right}</span> : null}
    </div>
  );
}
