import React from "react";

/**
 * Long-form model output — the "Current read-through" panel. Prose on a raised
 * surface with a 3px accent rail and an optional bias footer.
 */
export function ReadThrough({ label = "Current read-through", paragraphs = [], footerLabel, footer, style, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        padding: "var(--pad-card-lg)",
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-label)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "var(--ls-wide)",
          color: "var(--text-label)",
          marginBottom: "var(--sp-6)",
        }}
      >
        {label}
      </div>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          style={{
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            lineHeight: "var(--lh-body)",
            margin: i ? "var(--sp-6) 0 0" : 0,
            textWrap: "pretty",
          }}
        >
          {p}
        </p>
      ))}
      {footer ? (
        <div style={{ marginTop: "var(--sp-7)", paddingTop: "var(--sp-6)", borderTop: "0.5px solid var(--line-hair)", display: "flex", gap: "var(--sp-6)", alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-label)", fontWeight: 700, color: "var(--text-label)", whiteSpace: "nowrap" }}>
            {footerLabel}
          </span>
          <span style={{ fontSize: "var(--fs-body-s)", color: "var(--text-2)", textWrap: "pretty" }}>{footer}</span>
        </div>
      ) : null}
    </div>
  );
}
