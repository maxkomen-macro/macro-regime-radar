import React from "react";
import { Tag } from "../core/Tag";
import { GaugeBar } from "../data/GaugeBar";
import { Sparkline } from "../data/Sparkline";

/* Status word to badge / meter / sparkline tone. The third state stays the word
   "Triggered" (checklist 02 risk G8); only its tint is `alert`. */
const STATUS_TONE = { Clear: "clear", Watch: "watch", Triggered: "alert" };

const TONE_COLOR = {
  clear: "var(--mint)",
  watch: "var(--amber)",
  alert: "var(--neg)",
  info: "var(--link)",
  reference: "var(--text-3)",
};

function statusFromFill(pct) {
  if (pct < 50) return "Clear";
  if (pct < 75) return "Watch";
  return "Triggered";
}

/* Mockup .mono-note: the "Last alert:" and trigger lines. */
const LINE = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: 1.55,
  color: "var(--text-3)",
  margin: 0,
};

/* The U-CAP caption slot: 13px Plex Sans in --text-3 (screen-ui capStyle). */
const CAPTION = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  lineHeight: 1.5,
  color: "var(--text-3)",
  marginTop: 8,
};

/**
 * A monitored signal tile: name, status badge, value with an optional 118x30
 * sparkline, meter label, 5px meter and mono lines ("Last alert:" first).
 *
 * `status` (optional) overrides the fill-derived label with the server's
 * computed one: the stored triggered flag owns "Triggered", so a signal
 * sitting near its threshold reads Watch, not a false Triggered. Callers
 * without server status keep the fill-derived behavior.
 */
export function SignalCard({
  name,
  value,
  fillPct = 0,
  status,
  lastTriggered = "Never",
  showGauge = true,
  sparkline,
  meterLabel = "Threshold proximity",
  lines,
  badge,
  tone,
  heading = "span",
  as: Comp = "article",
  caption,
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(Number(fillPct)) ? Number(fillPct) : 0));
  const st = status && STATUS_TONE[status] ? status : statusFromFill(pct);
  const t = tone && TONE_COLOR[tone] ? tone : STATUS_TONE[st];
  const color = TONE_COLOR[t];
  const Name = heading === "h3" || heading === "h4" ? heading : "span";
  const hasSparkline = Array.isArray(sparkline) && sparkline.length >= 2;
  const extra = Array.isArray(lines) ? lines.filter((l) => l != null && l !== false) : [];
  const hasLines = lastTriggered !== null || extra.length > 0;

  return (
    <Comp
      {...rest}
      style={{
        borderRadius: "var(--r-tile)",
        border: "1px solid rgba(150,175,200,.10)",
        background: "var(--tile)",
        padding: "14px 16px 14px",
        fontFamily: "var(--font-ui)",
        color: "var(--text)",
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Name
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "14px",
            fontWeight: 500,
            lineHeight: 1.35,
            color: "var(--text)",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </Name>
        <Tag tone={t} style={{ flexShrink: 0 }}>
          {badge ?? st}
        </Tag>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
        <span
          className="num"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "21px",
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-.01em",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {value}
        </span>
        {hasSparkline ? (
          <Sparkline values={sparkline} width={118} height={30} color={color} fill={false} strokeWidth={1.4} style={{ flexShrink: 0 }} />
        ) : null}
      </div>
      {showGauge ? (
        <>
          <div style={{ fontSize: "13px", color: "var(--text-2)", margin: "8px 0 7px" }}>{meterLabel}</div>
          <GaugeBar pct={pct} height={5} color={color} gutter={false} />
        </>
      ) : null}
      {hasLines ? (
        <div style={{ marginTop: 10, display: "grid", gap: 3 }}>
          {lastTriggered !== null ? <p style={LINE}>Last alert: {lastTriggered}</p> : null}
          {extra.map((line, i) => (
            <p key={i} style={LINE}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {/* G4 (Iteration 1 step 5): the caption slot is a tile caption, at most
          two sentences (`data-copy="caption"`, capped by the copy spec). */}
      {caption != null && caption !== false ? (
        <div data-copy="caption" style={CAPTION}>
          {caption}
        </div>
      ) : null}
    </Comp>
  );
}
