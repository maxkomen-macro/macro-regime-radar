/**
 * EquityBridge: the LBO hero's signature visual (redesign Phase 9, checklist
 * 09 B.1.1), an inline SVG waterfall on the mockup's geometry
 * (tools.html:177). Six bars from `bridgeSteps`, every one a served
 * `LboResult` field or the display arithmetic on one: the two absolute bars
 * (entry equity, exit equity) stand on the baseline, the four deltas stack on
 * the running total with dashed connectors between them. Rounded $M values
 * sit above each bar, two-line labels below, the mono caption top left, and a
 * zero step draws the mockup's 2 px stub. The y axis spans 0 to the larger of
 * the exit equity and the running maximum. Static: nothing animates, so there
 * is nothing to silence under reduced motion.
 *
 * Iteration 1 (T1): drawn through HeroChartFrame at the hero column's own
 * size, 1:1, so the bridge fills and centres in its column at every width.
 * The mockup geometry (400×270: 14.6 px left margin, 66 px pitch, 44.9 px
 * bars, 10.5 px right margin, baseline 42 px above the bottom, 59.2 px of
 * headroom over the tallest bar; label lines at 242 / 256) is the fallback;
 * wider, the pitch grows with the width and the bars stop at 64 px; the
 * height follows the width (0.675 of it, 250 to 320 px) and may grow to 0.9×
 * the width, 380 px at most.
 */

import { HeroChartFrame, clampPx } from "../shared/HeroChart";
import type { BridgeStep } from "./lbo-deal";

const X0 = 14.6;
const RIGHT = 10.5;
/** Bar width over pitch (44.9 / 66). */
const BAR_RATIO = 0.68;
const BAR_MAX = 64;
/** Baseline to the bottom edge (270 − 228): room for the two label lines. */
const FOOT = 42;
/** Bottom edge to the two label lines, 14 px apart so the boxes of the
 * 10.5 px lines never touch (the mockup's 243 / 255 overlapped by 2 px, G1). */
const LABEL_UP = [28, 14] as const;
/** Top edge to the tallest bar (228 − 168.8): the caption and its value label. */
const HEAD = 59.2;
const STUB_H = 2;
const FALLBACK = { w: 400, h: 270 };
const minHeight = (w: number) => clampPx(w * 0.675, 250, 320);
const maxHeight = (w: number) => clampPx(w * 0.9, 250, 380);

const ENTRY_FILL = "#b8c6d4";
const VALUE_FILL = "#dfe6ec";
const CAPTION_FILL = "#7d8b98";

/** "362" for an absolute bar; "+221" / "−12" / "0" for a delta. */
export function bridgeValueText(step: BridgeStep): string {
  const r = Math.round(step.value);
  if (step.kind === "absolute") return String(r === 0 ? 0 : r);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${Math.abs(r)}`;
  return "0";
}

const f1 = (v: number): string => v.toFixed(1);

interface BarGeom {
  x: number;
  cx: number;
  top: number;
  height: number;
  fill: string;
  opacity: number;
  /** The running total after this step (the connector's level). */
  level: number;
  stub: boolean;
}

export default function EquityBridge({ steps }: { steps: BridgeStep[] }) {
  return (
    <HeroChartFrame fallback={FALLBACK} minHeight={minHeight} maxHeight={maxHeight}>
      {({ w, h }) => <Bridge steps={steps} w={w} h={h} />}
    </HeroChartFrame>
  );
}

function Bridge({ steps, w, h }: { steps: BridgeStep[]; w: number; h: number }) {
  const n = Math.max(1, steps.length);
  // n pitches less the trailing gap span the width between the margins.
  const pitch = (w - X0 - RIGHT) / (n - 1 + BAR_RATIO);
  const barW = Math.min(BAR_MAX, pitch * BAR_RATIO);
  // A capped bar stays centred in its pitch column.
  const inset = (pitch * BAR_RATIO - barW) / 2;
  const baseY = h - FOOT;
  const plotH = baseY - HEAD;
  const labelY = [h - LABEL_UP[0], h - LABEL_UP[1]] as const;
  // Running totals: an absolute bar resets the total to its own value.
  let total = 0;
  const levels = steps.map((s) => {
    const from = total;
    total = s.kind === "absolute" ? s.value : total + s.value;
    return { from, to: total };
  });
  const maxValue = Math.max(0, ...levels.map((l) => l.to));
  const scale = maxValue > 0 ? plotH / maxValue : 0;
  const y = (v: number): number => baseY - v * scale;

  const last = steps.length - 1;
  const bars: BarGeom[] = steps.map((s, i) => {
    const x = X0 + i * pitch + inset;
    const cx = x + barW / 2;
    const { from, to } = levels[i];
    if (s.kind === "absolute") {
      const stub = to <= 0;
      return {
        x,
        cx,
        top: stub ? y(0) : y(to),
        height: stub ? STUB_H : to * scale,
        fill: i === 0 ? ENTRY_FILL : "var(--mint)",
        opacity: 0.9,
        level: to,
        stub,
      };
    }
    const stub = s.value === 0;
    const hi = Math.max(from, to);
    const lo = Math.min(from, to);
    return {
      x,
      cx,
      top: stub ? y(from) : y(hi),
      height: stub ? STUB_H : (hi - lo) * scale,
      fill: stub ? "var(--text-4)" : s.value > 0 ? "var(--pos)" : "var(--neg)",
      opacity: 0.75,
      level: to,
      stub,
    };
  });

  return (
    <svg
      data-chart=""
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label="Equity value bridge from entry to exit"
      style={{ display: "block", maxWidth: "100%" }}
    >
      <text data-role="caption" x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill={CAPTION_FILL} style={{ fontFamily: "var(--font-mono)" }}>
        EQUITY VALUE BRIDGE · $M
      </text>
      <line data-role="baseline" x1={f1(X0 - 4)} x2={f1((bars[last]?.x ?? X0) + barW + 4)} y1={baseY} y2={baseY} stroke="rgba(255,255,255,.18)" />
      {bars.map((b, i) => (
        <g key={i} data-role="step">
          <rect data-role="bar" x={f1(b.x)} y={f1(b.top)} width={f1(barW)} height={f1(b.height)} rx="3" fill={b.fill} fillOpacity={b.opacity} />
          <text
            data-role="value"
            x={f1(b.cx)}
            y={f1(b.top - 6)}
            textAnchor="middle"
            fontSize="10.5"
            fill={VALUE_FILL}
            style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
          >
            {bridgeValueText(steps[i])}
          </text>
          {steps[i].label.map((line, li) =>
            line ? (
              <text key={li} data-role="label" x={f1(b.cx)} y={labelY[li]} textAnchor="middle" fontSize="10.5" fill="var(--text-3)" style={{ fontFamily: "var(--font-ui)" }}>
                {line}
              </text>
            ) : null,
          )}
          {i < last ? (
            <line
              data-role="connector"
              x1={f1(b.x + barW)}
              x2={f1(bars[i + 1].x)}
              y1={f1(y(b.level))}
              y2={f1(y(b.level))}
              stroke="rgba(255,255,255,.25)"
              strokeDasharray="2 2"
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}
