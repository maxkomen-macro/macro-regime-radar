import React from "react";

const TH = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  padding: "0 10px 8px",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};

/**
 * Dense terminal table on the mockup `.tbl` styling: mono 10.5px uppercase
 * headers, 13px UI-face cells in --text with 1px --line-2 dividers, tabular
 * figures everywhere. `groups` adds spanning group rows (mono 10.5px eyebrow);
 * `compact` tightens the cell padding (tape).
 * Columns: {key, label, align, mono, width, render, sub, subBlock}.
 */
export function DataTable({
  columns = [],
  rows = [],
  zebra = true,
  compact = false,
  groups,
  subBlock = false,
  caption,
  hideHeader = false,
  style,
  ...rest
}) {
  const cellPad = compact ? "6px 8px" : "8px 10px";
  const groupPad = compact ? "11px 0 3px" : "12px 0 5px";
  let band = 0;
  const renderRow = (r, i, keyPrefix) => {
    const striped = zebra && band++ % 2 === 1;
    return (
      <tr key={`${keyPrefix}${r.id ?? i}`} style={{ background: striped ? "rgba(255,255,255,.012)" : "transparent" }}>
        {columns.map((c, ci) => {
          const block = c.subBlock ?? subBlock;
          return (
            <td
              key={c.key}
              // React clears a key whose value is undefined (it assigns ""),
              // which would wipe the padding shorthand: add paddingLeft only
              // on the first column.
              style={{
                textAlign: c.align || "left",
                padding: cellPad,
                ...(ci === 0 ? { paddingLeft: 0 } : null),
                borderBottom: "1px solid var(--line-2)",
                color: "var(--text)",
                fontFamily: c.mono ? "var(--font-mono)" : "var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {c.render ? c.render(r) : r[c.key]}
              {c.sub ? (
                <span
                  className="mrr-nm"
                  style={
                    block
                      ? { display: "block", fontSize: 11.5, color: "var(--text-3)", fontFamily: "var(--font-ui)" }
                      : { fontSize: 11.5, color: "var(--text-3)", marginLeft: 6, fontFamily: "var(--font-ui)" }
                  }
                >
                  {c.sub(r)}
                </span>
              ) : null}
            </td>
          );
        })}
      </tr>
    );
  };
  return (
    <table
      {...rest}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--font-ui)",
        fontSize: 13,
        fontWeight: 400,
        ...style,
      }}
    >
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {hideHeader ? null : (
        <thead>
          <tr>
            {columns.map((c, ci) => (
              <th
                scope="col"
                key={c.key}
                style={{ ...TH, textAlign: c.align || "left", ...(ci === 0 ? { paddingLeft: 0 } : null), ...(c.width ? { width: c.width } : null) }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {groups
          ? groups.map((g, gi) => (
              <React.Fragment key={g.key ?? gi}>
                {/* A real row spanning every column: screen readers read the
                    group name before its rows. */}
                <tr className="mrr-grp">
                  <td
                    colSpan={columns.length}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 400,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: "var(--text-4)",
                      padding: groupPad,
                      borderBottom: 0,
                      textAlign: "left",
                      background: "transparent",
                    }}
                  >
                    {g.label}
                  </td>
                </tr>
                {(g.rows || []).map((r, i) => renderRow(r, i, `g${gi}-`))}
              </React.Fragment>
            ))
          : rows.map((r, i) => renderRow(r, i, ""))}
      </tbody>
    </table>
  );
}
