import React from "react";

/**
 * Header ticker strip. Items tick with a directional flash when `value` changes,
 * mirroring the 30-second st.fragment refresh on the Markets tab.
 */
export function TickerStrip({ items = [], style, ...rest }) {
  const prev = React.useRef({});
  const [flash, setFlash] = React.useState({});

  React.useEffect(() => {
    const next = {};
    items.forEach((it) => {
      const before = prev.current[it.label];
      if (before !== undefined && before !== it.raw) next[it.label] = it.raw > before ? "up" : "down";
      prev.current[it.label] = it.raw;
    });
    if (Object.keys(next).length) {
      setFlash(next);
      const t = setTimeout(() => setFlash({}), 600);
      return () => clearTimeout(t);
    }
  }, [items]);

  return (
    <div
      {...rest}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-11)",
        fontFamily: "var(--font-mono)",
        ...style,
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            padding: "var(--sp-2) var(--sp-4)",
            borderRadius: "var(--r-xs)",
            animation: flash[it.label] ? `mrr-flash-${flash[it.label]} var(--tick-flash) var(--ease-out)` : "none",
          }}
        >
          <div
            style={{
              fontSize: "var(--fs-label)",
              textTransform: "uppercase",
              letterSpacing: "var(--ls-micro)",
              color: "var(--text-muted)",
              marginBottom: "var(--sp-2)",
            }}
          >
            {it.label}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--gap-chip)", fontVariantNumeric: "tabular-nums" }}>
            <span
              style={{
                fontSize: "var(--fs-body)",
                fontWeight: 700,
                color: it.tone === "pos" ? "var(--pos)" : it.tone === "neg" ? "var(--neg-text)" : "var(--text)",
              }}
            >
              {it.value}
            </span>
            {it.change ? (
              <span style={{ fontSize: "var(--fs-body-s)", color: it.changeTone === "pos" ? "var(--pos)" : it.changeTone === "neg" ? "var(--neg-text)" : "var(--text-muted)" }}>
                ({it.change})
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
