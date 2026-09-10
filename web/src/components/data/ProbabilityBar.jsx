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
  // A regime at 0.4% must not print "0%": rounding to zero would assert a
  // certainty the model does not hold, so sub-1% shares read "<1%" and only
  // an exact zero prints 0% (executive pass, 2026-09-05).
  const rows = ORDER.map(([k, name, abbr, color]) => {
    const raw = probs[k] ?? 0;
    const pct = Math.max(0, Math.round(raw * 100));
    return {
      key: k,
      name,
      abbr,
      color,
      pct,
      text: raw > 0 && pct === 0 ? "<1%" : `${pct}%`,
      zero: raw <= 0,
    };
  });
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
            title={`${r.name} ${r.text}`}
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
            <span key={r.key} style={{ color: r.zero ? "var(--text-faint)" : r.pct === 0 ? "var(--text-muted)" : r.color }}>
              {r.abbr} {r.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
