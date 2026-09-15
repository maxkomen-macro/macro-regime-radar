import React from "react";

/** Threshold-proximity ramp; mirrors signal_card_html() in shared_styles.py. */
export function rampColor(pct) {
  if (pct < 50) return "var(--gauge-0)";
  if (pct < 75) return "var(--gauge-50)";
  if (pct < 95) return "var(--gauge-75)";
  return "var(--gauge-95)";
}

/** Status tones (checklist 02 B.9). Each carries its literal rgb triplet so the
 * gradient variant can start at 40% alpha (mockup cycle meter:
 * linear-gradient(90deg, rgba(38,220,160,.4), #26dca0)) without color-mix(). */
const TONES = {
  clear: ["var(--mint)", "38,220,160"],
  watch: ["var(--amber)", "245,181,46"],
  alert: ["var(--neg)", "240,80,63"],
  info: ["var(--link)", "88,184,230"],
  neutral: ["var(--text-3)", "143,157,170"],
  pos: ["var(--pos)", "40,209,124"],
  neg: ["var(--neg)", "240,80,63"],
};

function clamp01to100(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** Fill paint: `color` wins, then `tone`, then the legacy ramp (kept so the
 * KitScreen ramp specimen and every legacy caller keep the four-step ramp). */
function fillPaint(p, tone, color, gradient) {
  const t = !color && tone ? TONES[tone] : null;
  const solid = color || (t ? t[0] : rampColor(p));
  if (!gradient) return solid;
  const start = t ? `rgba(${t[1]},.4)` : `color-mix(in srgb, ${solid} 40%, transparent)`;
  return `linear-gradient(90deg, ${start}, ${solid})`;
}

/**
 * Meter: a 5px track on --track with a 3px radius, filled in the status colour.
 * Anatomy (order unchanged): root; optional caption above; the track
 * `.mrr-meter` with its fill; optional tick and scale row after the track.
 */
export function GaugeBar({
  pct = 0,
  caption,
  color,
  height = 5,
  tone,
  gradient = false,
  tick,
  tickLabel,
  scale,
  ariaLabel,
  gutter = true,
  style,
  ...rest
}) {
  // NaN renders 0 and no tick; out-of-range clamps.
  const clamped = clamp01to100(pct);
  const p = clamped ?? 0;
  const tickAt = clamped == null || tick == null ? null : clamp01to100(tick);
  const scaleRow =
    scale || tickLabel != null
      ? { left: scale?.left, mid: scale?.mid ?? tickLabel, right: scale?.right }
      : null;
  // The 8px gutter under the track is kept for legacy callers; a scale row
  // carries the block's bottom instead, and MeterRow centres the bare track.
  const gutterBelow = gutter && !scaleRow ? "var(--sp-5)" : 0;
  const track = (
    <div
      className="mrr-meter"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel || undefined}
      style={{
        background: "var(--track)",
        borderRadius: 3,
        height,
        width: "100%",
        overflow: "hidden",
        marginBottom: tickAt == null ? gutterBelow : 0,
      }}
    >
      {/* Fill animates via transform, not width (owner ruling 2026-08-06):
          scaleX runs on the compositor, so refills never trigger layout. */}
      <div
        style={{
          background: fillPaint(p, tone, color, gradient),
          height: "100%",
          width: "100%",
          transform: `scaleX(${p / 100})`,
          transformOrigin: "left",
          borderRadius: 3,
          transition: "transform var(--dur-slow) var(--ease-out)",
        }}
      />
    </div>
  );
  return (
    <div {...rest} style={style}>
      {caption ? (
        <div style={{ fontSize: 13, color: "var(--text-2)", margin: "8px 0 7px", fontFamily: "var(--font-ui)" }}>
          {caption}
        </div>
      ) : null}
      {tickAt == null ? (
        track
      ) : (
        /* The wrapper lets the tick overshoot the track while the clip stays
           on the track itself. */
        <div style={{ position: "relative", overflow: "visible", marginBottom: gutterBelow }}>
          {track}
          <i
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${tickAt}%`,
              top: -4,
              width: 1,
              height: height + 11,
              background: "rgba(255,255,255,.45)",
            }}
          />
        </div>
      )}
      {scaleRow ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 400,
            color: "var(--text-4)",
            marginTop: 6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{scaleRow.left}</span>
          <span style={{ color: "var(--text-2)" }}>{scaleRow.mid}</span>
          <span>{scaleRow.right}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One labelled meter row: [swatch] label · meter · value · [delta]. The
 * transition tiles (regime-lab) and late-cycle / "where the change came from"
 * rows (recession) are stacks of these.
 */
export function MeterRow({
  label,
  pct,
  tone,
  color,
  gradient,
  value,
  delta,
  deltaTone,
  swatch,
  valueSize = "md",
  labelWidth = 112,
  valueWidth = 44,
  height = 30,
  className,
  style,
  ...rest
}) {
  const hasDelta = delta != null;
  // The swatch sits inside the label cell, so the grid is the same three or
  // four tracks with or without it.
  const columns = [`${labelWidth}px`, "minmax(0,1fr)", `${valueWidth}px`, hasDelta ? "58px" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      {...rest}
      className={["mrr-meter-row", className].filter(Boolean).join(" ")}
      style={{
        display: "grid",
        gridTemplateColumns: columns,
        gap: hasDelta ? 10 : 12,
        alignItems: "center",
        height,
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "var(--text-2)",
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {swatch ? (
          <i aria-hidden="true" style={{ flex: "none", display: "block", width: 8, height: 8, borderRadius: 2, background: swatch }} />
        ) : null}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </span>
      <GaugeBar pct={pct} tone={tone} color={color} gradient={gradient} gutter={false} />
      <span
        className="num"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: valueSize === "sm" ? 13 : 14,
          fontWeight: 500,
          textAlign: "right",
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      {hasDelta ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: deltaTone === "watch" ? "var(--amber)" : "var(--text-4)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {delta}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Signed bar around a centre tick: negative values extend left of centre,
 * positive right. Coefficient bars (recession) and surprise bars (markets).
 * The caller decides which sign gets which colour; the defaults read
 * "raises odds" red and "lowers odds" mint.
 */
export function DivergingBar({
  value = 0,
  max,
  positiveColor = "var(--neg)",
  negativeColor = "var(--mint)",
  width,
  style,
  ...rest
}) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const m = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : Math.abs(v) || 1;
  const share = Math.round(Math.min(1, Math.abs(v) / m) * 5000) / 100;
  const negative = v < 0;
  return (
    <div {...rest} style={{ position: "relative", height: 10, width: width ?? "100%", ...style }}>
      <i
        aria-hidden="true"
        style={{ position: "absolute", left: "50%", top: -4, width: 1, height: 18, background: "rgba(255,255,255,.2)" }}
      />
      <i
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 1,
          height: 8,
          borderRadius: 2,
          background: negative ? negativeColor : positiveColor,
          ...(negative ? { right: "50%" } : { left: "50%" }),
          width: `${share}%`,
        }}
      />
    </div>
  );
}
