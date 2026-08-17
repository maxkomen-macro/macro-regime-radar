import React from "react";

/** Threshold-proximity ramp — mirrors signal_card_html() in shared_styles.py. */
export function rampColor(pct) {
  if (pct < 50) return "var(--gauge-0)";
  if (pct < 75) return "var(--gauge-50)";
  if (pct < 95) return "var(--gauge-75)";
  return "var(--gauge-95)";
}

export function GaugeBar({ pct = 0, caption, color, height = 4, style, ...rest }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div {...rest} style={style}>
      {caption ? (
        <div
          style={{
            fontSize: "var(--fs-micro)",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            marginTop: "var(--sp-5)",
            marginBottom: "var(--sp-2)",
            letterSpacing: "var(--ls-micro)",
          }}
        >
          {caption}
        </div>
      ) : null}
      <div
        style={{
          background: "var(--surface-raised)",
          borderRadius: "var(--r-xs)",
          height,
          width: "100%",
          overflow: "hidden",
          marginBottom: "var(--sp-5)",
        }}
      >
        {/* Fill animates via transform, not width (owner ruling 2026-08-06):
            scaleX runs on the compositor, so refills never trigger layout. */}
        <div
          style={{
            background: color || rampColor(p),
            height: "100%",
            width: "100%",
            transform: `scaleX(${p / 100})`,
            transformOrigin: "left",
            borderRadius: "var(--r-xs)",
            transition: "transform var(--dur-slow) var(--ease-out)",
          }}
        />
      </div>
    </div>
  );
}
