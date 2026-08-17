import React from "react";

const CONVICTION = {
  High: "var(--pos)",
  Medium: "var(--accent)",
  Low: "var(--warn)",
};

/**
 * Market Intelligence banner — the accent-railed panel at the top of the
 * Dashboard tab. Eyebrow + status dot, one-sentence read, footer meta row.
 *
 * `live` gates the dot's pulse (owner ruling 2026-08-06): pulse only when the
 * content is new since the visitor's last look or under the caller's age
 * threshold; otherwise the dot sits static-faint. Default true preserves the
 * original bundle behavior for callers that don't gate.
 */
export function IntelBanner({
  eyebrow = "Market Intelligence",
  conviction,
  headline,
  meta = [],
  action,
  onAction,
  live = true,
  style,
  ...rest
}) {
  const cColor = CONVICTION[conviction] || "var(--accent)";
  return (
    <div
      {...rest}
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderLeft: "3px solid var(--pos)",
        borderRadius: "var(--r-md)",
        padding: "var(--pad-card-lg)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-8)", marginBottom: "var(--sp-6)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--gap-inline)" }}>
          <span
            title={live ? "This read is current or new since your last visit" : "No change since your last visit — dates in the meta row"}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: live ? "var(--pos)" : "var(--text-faint)",
              animation: live ? "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite" : "none",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-label)",
              textTransform: "uppercase",
              letterSpacing: "var(--ls-wide)",
              color: "var(--text-label)",
            }}
          >
            {eyebrow}
          </span>
        </span>
        {conviction ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-label)",
              fontWeight: 700,
              letterSpacing: "var(--ls-micro)",
              textTransform: "uppercase",
              color: cColor,
              border: `0.5px solid ${cColor}`,
              borderRadius: "var(--r-sm)",
              padding: "4px 10px",
            }}
          >
            {conviction} conviction
          </span>
        ) : null}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "var(--fs-value)", color: "var(--text)", lineHeight: 1.45, textWrap: "pretty" }}>{headline}</div>
      {meta.length || action ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-8)",
            marginTop: "var(--sp-7)",
            paddingTop: "var(--sp-6)",
            borderTop: "0.5px solid var(--line-hair)",
          }}
        >
          <div style={{ display: "flex", gap: "var(--sp-9)", fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}>
            {meta.map((m) => (
              <span key={m.label}>
                {m.label}:{" "}
                <b style={{ fontFamily: "var(--font-mono)", color: m.color || "var(--text)", fontWeight: 700 }}>{m.value}</b>
              </span>
            ))}
          </div>
          {action ? (
            <button
              onClick={onAction}
              style={{
                appearance: "none",
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body-s)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              → {action}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
