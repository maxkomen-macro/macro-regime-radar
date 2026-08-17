import React from "react";

const ORDER = [
  ["goldilocks", "Goldilocks", "GL", "var(--regime-goldilocks)"],
  ["overheating", "Overheating", "OV", "var(--regime-overheating)"],
  ["stagflation", "Stagflation", "ST", "var(--regime-stagflation)"],
  ["recession", "Recession Risk", "RR", "var(--regime-recession)"],
];

/**
 * The four softmax regime probabilities as one stacked bar plus a legend —
 * the shape of `regimes.prob_*` in the database.
 */
export function ProbabilityBar({ probs = {}, showLegend = true, height = 8, style, ...rest }) {
  const rows = ORDER.map(([k, name, abbr, color]) => ({
    key: k,
    name,
    abbr,
    color,
    pct: Math.max(0, Math.round((probs[k] ?? 0) * 100)),
  }));
  // Segments animate via transform, not width (owner ruling 2026-08-06). A
  // flex row can't scaleX per segment (transforms don't reflow neighbours), so
  // each regime paints as a full-width layer scaled to its CUMULATIVE share,
  // stacked earliest-on-top: the visible slice of layer i is exactly its own
  // share, hover titles still land on the right regime (hit-testing follows
  // the transform), and every refill runs on the compositor.
  let cum = 0;
  const layers = rows.map((r) => {
    cum += r.pct;
    return { ...r, cum: Math.min(cum, 100) };
  });
  return (
    <div {...rest} style={style}>
      <div
        style={{
          position: "relative",
          height,
          width: "100%",
          borderRadius: "var(--r-xs)",
          overflow: "hidden",
          background: "var(--surface-raised)",
        }}
      >
        {layers.map((r, i) => (
          <div
            key={r.key}
            title={`${r.name} ${r.pct}%`}
            style={{
              position: "absolute",
              inset: 0,
              background: r.color,
              transform: `scaleX(${r.cum / 100})`,
              transformOrigin: "left",
              zIndex: layers.length - i,
              transition: "transform var(--dur-slow) var(--ease-out)",
            }}
          />
        ))}
      </div>
      {showLegend ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--sp-6)",
            marginTop: "var(--sp-4)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            letterSpacing: "var(--ls-micro)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {rows.map((r) => (
            <span key={r.key} style={{ color: r.pct === 0 ? "var(--text-faint)" : r.color }}>
              {r.abbr} {r.pct}%
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
