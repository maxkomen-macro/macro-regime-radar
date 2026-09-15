import React from "react";

const NEUTRAL = "rgba(150,175,200,.07)";
const DASH = "\u2014"; // the dash glyph the current matrices print

// Alpha to four decimals with float noise and trailing zeros dropped
// (0.55 x 0.88 prints 0.484, not 0.48400000000000004).
const alphaText = (a) => String(Number(a.toFixed(4)));

/**
 * Transition-odds tint (credit.html, derived): alpha = 0.55 × p; mint on the
 * diagonal (stay), amber off it (move). p is 0..1.
 */
export function transitionTint(p, onDiagonal) {
  const v = Number(p);
  if (p == null || !Number.isFinite(v)) return "transparent";
  const alpha = Math.max(0, Math.min(1, v)) * 0.55;
  return `rgba(${onDiagonal ? "38,220,160" : "245,181,46"},${alphaText(alpha)})`;
}

/**
 * IRR tint (tools.html, derived): 20%+ mint from .12 rising .03 per point
 * (cap .40); 15 to 20 the neutral tile tint; below 15 red from .10 rising .036
 * per point (cap .30); null the neutral tint.
 */
export function irrTint(irr) {
  const v = Number(irr);
  if (irr == null || !Number.isFinite(v)) return NEUTRAL;
  if (v >= 20) return `rgba(38,220,160,${alphaText(Math.min(0.4, 0.12 + 0.03 * (v - 20)))})`;
  if (v >= 15) return NEUTRAL;
  return `rgba(240,80,63,${alphaText(Math.min(0.3, 0.1 + 0.036 * (15 - v)))})`;
}

const META = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

const PRESETS = {
  transition: {
    rowHeaderWidth: 84,
    gap: 4,
    cellHeight: 30,
    cellRadius: 5,
    cellFont: 12.5,
    colFont: 10,
    cornerFont: 9.5,
    outline: "row",
    rowHeader: { fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-2)" },
    cellColor: (cell) => (cell.value != null && cell.value >= 0.2 ? "#fff" : "var(--text-2)"),
    tint: (cell, onDiagonal) => transitionTint(cell.value, onDiagonal),
  },
  irr: {
    rowHeaderWidth: 54,
    gap: 5,
    cellHeight: 34,
    cellRadius: 6,
    cellFont: 13,
    colFont: 10.5,
    cornerFont: 9.5,
    outline: "cell",
    rowHeader: { fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 400, color: "var(--text-2)" },
    cellColor: () => "var(--text)",
    tint: (cell) => irrTint(cell.value),
  },
};

// No preset: transition metrics, no tint unless the cell (or `tint`) says so.
const PLAIN = {
  ...PRESETS.transition,
  outline: undefined,
  cellColor: () => "var(--text)",
  tint: (cell) => cell.tint ?? "transparent",
};

const isDash = (cell) => cell == null || (cell.value == null && (cell.text === DASH || cell.text === "-"));

/**
 * Heat grid with row and column headers: the credit transition-odds matrix
 * and the Tools IRR sensitivity grid. Cells are precomputed by the consumer
 * (one number, one truth: nothing is re-derived here); the preset supplies
 * the metrics and tint scale, `current` / `currentCell` outline today's
 * row or cell.
 */
export function HeatMatrix({
  rows = [],
  cols = [],
  cells = [],
  tint,
  preset,
  corner,
  currentCell,
  outline,
  legend,
  ariaLabel,
  rowHeaderWidth,
  cellHeight,
  gap,
  className,
  style,
  ...rest
}) {
  const cfg = (preset && PRESETS[preset]) || PLAIN;
  const rhw = rowHeaderWidth ?? cfg.rowHeaderWidth;
  const ch = cellHeight ?? cfg.cellHeight;
  const gp = gap ?? cfg.gap;
  const mode = outline ?? cfg.outline ?? (currentCell ? "cell" : "row");
  const paint = (cell, ri, ci) => {
    if (tint) return tint(cell, ri, ci);
    const onDiagonal = rows[ri]?.key != null && rows[ri].key === cols[ci]?.key;
    return cfg.tint(cell, onDiagonal);
  };
  const grid = (
      <div
        {...rest}
        role="table"
        aria-label={ariaLabel}
        className={["mrr-heat", className].filter(Boolean).join(" ")}
        style={{
          display: "grid",
          gridTemplateColumns: `${rhw}px repeat(${cols.length}, minmax(0,1fr))`,
          gap: gp,
          alignItems: "center",
          ...style,
        }}
      >
        {/* display:contents keeps the ARIA rows out of the layout; the cells
            stay direct participants of this one grid. */}
        <div role="row" style={{ display: "contents" }}>
          <span role="columnheader" style={{ ...META, fontSize: cfg.cornerFont }}>
            {corner}
          </span>
          {cols.map((c) => (
            <span key={c.key} role="columnheader" style={{ ...META, fontSize: cfg.colFont, textAlign: "center" }}>
              {c.label}
            </span>
          ))}
        </div>
        {cells.length
          ? rows.map((row, ri) => {
              const rowCells = cells[ri];
              const emptyRow = row.empty || !rowCells || rowCells.length === 0;
              const currentRow = mode === "row" && !!row.current;
              return (
                <div key={row.key} role="row" style={{ display: "contents" }}>
                  <span
                    role="rowheader"
                    aria-current={row.current ? "true" : undefined}
                    style={{
                      ...cfg.rowHeader,
                      ...(currentRow ? { color: "#fff", fontWeight: 500 } : null),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.label}
                    {currentRow ? <span aria-hidden="true"> ●</span> : null}
                  </span>
                  {cols.map((col, ci) => {
                    const cell = emptyRow ? null : rowCells[ci];
                    const dash = isDash(cell);
                    const missing = !dash && cell.value == null;
                    const currentOne =
                      mode === "cell" && !!currentCell && currentCell[0] === ri && currentCell[1] === ci;
                    const strong = currentOne || !!cell?.strong;
                    return (
                      <span
                        key={col.key}
                        role="cell"
                        style={{
                          height: ch,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: cfg.cellRadius,
                          fontFamily: "var(--font-ui)",
                          fontSize: cfg.cellFont,
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: strong ? 600 : 400,
                          background: dash ? "transparent" : paint(cell, ri, ci),
                          color: dash ? "var(--text-3)" : missing ? "var(--text-4)" : cfg.cellColor(cell),
                          outline: currentRow
                            ? "1px solid rgba(255,255,255,.28)"
                            : currentOne
                              ? "1.5px solid #fff"
                              : undefined,
                        }}
                      >
                        {dash ? DASH : cell.text ?? (missing ? "n/a" : String(cell.value))}
                      </span>
                    );
                  })}
                </div>
              );
            })
          : null}
      </div>
  );
  if (!legend) return grid;
  // The legend is a sibling under the grid, never a child of the table role.
  return (
    <div>
      {grid}
      {legend ? (
        <div
          className="mrr-heat-legend"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            marginTop: 12,
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--text-3)",
          }}
        >
          {legend}
        </div>
      ) : null}
    </div>
  );
}
