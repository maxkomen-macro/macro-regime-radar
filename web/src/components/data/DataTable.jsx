import React from "react";

/** Dense terminal table. Columns: {key, label, align, mono, width, render}. */
export function DataTable({ columns = [], rows = [], zebra = true, style, ...rest }) {
  return (
    <table
      {...rest}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-body-s)",
        ...style,
      }}
    >
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{
                textAlign: c.align || "left",
                padding: "var(--sp-4) var(--sp-6)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-micro)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--ls-wide)",
                color: "var(--text-muted)",
                borderBottom: "1px solid var(--line-hair)",
                width: c.width,
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id ?? i} style={{ background: zebra && i % 2 ? "rgba(255,255,255,.012)" : "transparent" }}>
            {columns.map((c) => (
              <td
                key={c.key}
                style={{
                  textAlign: c.align || "left",
                  padding: "var(--pad-cell)",
                  borderBottom: "0.5px solid var(--line-hair)",
                  color: "var(--text-2)",
                  fontFamily: c.mono ? "var(--font-mono)" : "var(--font-ui)",
                  fontVariantNumeric: c.mono ? "tabular-nums" : "normal",
                  whiteSpace: "nowrap",
                }}
              >
                {c.render ? c.render(r) : r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
