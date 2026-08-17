import React from "react";
import { GaugeBar, rampColor } from "../data/GaugeBar";

const STATUS = {
  Clear: "var(--pos)",
  Watch: "var(--warn)",
  Triggered: "var(--neg)",
};

function statusFromFill(pct) {
  if (pct < 50) return "Clear";
  if (pct < 75) return "Watch";
  return "Triggered";
}

const BORDER = {
  Clear: "0.5px solid var(--line-hair)",
  Watch: "0.5px solid rgba(210,153,34,.3)",
  Triggered: "0.5px solid rgba(218,54,51,.3)",
};

/** Compact signal card — name + status dot, value, threshold gauge, last alert.
 *
 * `status` (optional) overrides the fill-derived label with the server's
 * computed one — the stored triggered flag owns "Triggered", so a signal
 * sitting near its threshold reads Watch, not a false Triggered. Callers
 * without server status keep the legacy fill-derived behavior. */
export function SignalCard({ name, value, fillPct = 0, status, lastTriggered = "Never", showGauge = true, style, ...rest }) {
  const pct = Math.max(0, Math.min(100, fillPct));
  const st = status && STATUS[status] ? status : statusFromFill(pct);
  const color = STATUS[st];
  return (
    <div
      {...rest}
      style={{
        background: "var(--surface)",
        border: BORDER[st],
        borderRadius: "var(--r-md)",
        padding: "var(--pad-card)",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-4)" }}>
        <span
          style={{
            fontSize: "var(--fs-body-s)",
            fontWeight: 500,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "65%",
          }}
        >
          {name}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--gap-chip)", flexShrink: 0 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: color,
              animation: st === "Triggered" ? "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite" : "none",
            }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", color }}>{st}</span>
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-value)",
          fontWeight: 600,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--ls-numeric)",
          marginBottom: "var(--sp-1)",
        }}
      >
        {value}
      </div>
      {showGauge ? <GaugeBar pct={pct} caption="Threshold proximity" color={rampColor(pct)} /> : null}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
        Last alert: {lastTriggered}
      </div>
    </div>
  );
}
