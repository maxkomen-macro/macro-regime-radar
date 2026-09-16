import React from "react";

/**
 * Underlined tab row — the dashboard's 11-tab primary navigation.
 *
 * `touch` grows each tab's hit area for finger input on narrow viewports; the
 * underline stays welded to the rule because the extra height is padding.
 */
export function TabBar({ tabs = [], active, onChange, touch = false, style, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        gap: "var(--sp-10)",
        borderBottom: "1px solid var(--line)",
        overflowX: "auto",
        ...style,
      }}
    >
      {tabs.map((t) => {
        const id = typeof t === "string" ? t : t.id;
        const label = typeof t === "string" ? t : t.label;
        const on = id === active;
        return (
          <button
            key={id}
            onClick={() => onChange && onChange(id)}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${on ? "var(--link)" : "transparent"}`,
              color: on ? "var(--text)" : "var(--text-muted)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body)",
              fontWeight: on ? 600 : 400,
              padding: touch ? "8px 0 10px" : "0 0 var(--sp-6)",
              ...(touch ? { minHeight: 40 } : null),
              marginBottom: "-1px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color var(--dur-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = "var(--text-2)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
