import React from "react";

// Fixed classifier order (src/regime.py): the bar's shape stays comparable
// across screens. Legend abbreviations: two-letter (default) or single-letter.
const ORDER = [
  ["goldilocks", "Goldilocks", "GL", "G", "var(--r-goldilocks)"],
  ["overheating", "Overheating", "OV", "O", "var(--r-overheating)"],
  ["stagflation", "Stagflation", "ST", "S", "var(--r-stagflation)"],
  ["recession", "Recession Risk", "RR", "R", "var(--r-recession)"],
];

/**
 * The four softmax regime probabilities as one stacked bar plus a legend,
 * the shape of `regimes.prob_*` in the database. Segments are flex items with
 * 2px gaps and no transition (checklist 02 risk G4: flex widths cannot animate
 * on the compositor, and the odds change once a month).
 */
export function ProbabilityBar({
  probs = {},
  showLegend = true,
  height = 8,
  gap = 2,
  legend = "abbr",
  order = "fixed",
  style,
  ...rest
}) {
  // A regime at 0.4% must not print "0%": rounding to zero would assert a
  // certainty the model does not hold, so sub-1% shares read "<1%" and only
  // an exact zero prints 0% (executive pass, 2026-09-05).
  const rows = ORDER.map(([key, name, abbr, letter, color]) => {
    const raw = Number(probs[key]) || 0;
    const share = Math.max(0, raw) * 100;
    const pct = Math.round(share);
    return {
      key,
      name,
      abbr: legend === "letter" ? letter : abbr,
      color,
      pct,
      // Flex share: the printed percent, or the true sliver for a sub-1% regime.
      grow: pct > 0 ? pct : Math.round(share * 10) / 10,
      text: raw > 0 && pct === 0 ? "<1%" : `${pct}%`,
      zero: raw <= 0,
    };
  });
  const ordered = order === "desc" ? [...rows].sort((a, b) => b.grow - a.grow) : rows;
  const segments = ordered.filter((r) => !r.zero);
  return (
    <div {...rest} style={style}>
      <div
        className="mrr-odds"
        style={{
          display: "flex",
          gap,
          height,
          width: "100%",
          borderRadius: 4,
          overflow: "hidden",
          // Gaps would show a track through them, so the bar is transparent
          // unless every share is 0 (then the empty track reads as "no odds").
          background: segments.length ? "transparent" : "var(--track)",
        }}
      >
        {segments.map((r) => (
          <i
            key={r.key}
            title={`${r.name} ${r.text}`}
            style={{ display: "block", flex: `${r.grow} 1 0`, minWidth: 0, height: "100%", background: r.color }}
          />
        ))}
      </div>
      {showLegend ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0 6px",
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: ".02em",
            color: "var(--text-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {ordered.map((r, i) => (
            <React.Fragment key={r.key}>
              {i ? <span aria-hidden="true"> · </span> : null}
              {/* A zero regime's entry stays, faint, so the set is always complete. */}
              <span style={r.zero ? { color: "var(--text-4)" } : undefined}>
                {r.abbr} {r.text}
              </span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
