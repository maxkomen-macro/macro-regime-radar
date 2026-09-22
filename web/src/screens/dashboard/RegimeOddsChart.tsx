/**
 * RegimeOddsChart: the Dashboard hero's signature chart (Iteration 2, F1).
 * The classifier's four stored monthly probabilities over the last 24 stored
 * months, drawn as four lines on a shared 0-100% scale.
 *
 * Iteration 1 drew them as stacked bands. Four saturated fills touched each
 * other, the end labels collided in the right margin, and a reader could not
 * follow one regime or answer "is the call getting stronger?" - the only
 * question the chart exists to answer. F1 replaced the bands with lines; the
 * band implementation is gone rather than kept alongside.
 *
 * How it reads:
 *   - gridlines and labels at 0, 25, 50, 75 and 100%, so a line's height is
 *     its probability and no running sum has to be undone by eye;
 *   - the called regime draws in its hue at full weight, the rest at 1.2px
 *     and 45% opacity, so the call is obvious without reading the legend;
 *   - the legend sits inline above the plot (swatch, name, latest value,
 *     sorted high to low). Nothing sits in the right margin any more;
 *   - the current month carries a dot on the called line, labelled with its
 *     value, beside the dashed current-month rule (`data-current-month`);
 *   - hover or focus moves a crosshair, and the legend becomes its readout:
 *     the same four rows print that month's values under that month's name.
 *     Merging the two is what keeps the Done-when's "no two text elements
 *     overlap" true at every width - a floating tooltip is one more box to
 *     collide, a fixed row is not. The rows keep their resting order (by the
 *     latest value) while scrubbing, so nothing jumps under the cursor.
 *
 * Honest data: every point is the served `prob_*` field of that month, drawn
 * as stored (never renormalised, a null reads as 0); nothing is re-derived.
 * The called regime is always `row.label` as served - never a hardcoded name,
 * which is why a database calling Overheating draws Overheating heavy.
 *
 * Below 1024px (`useBreakpoint`, the app's one width-conditional mechanism)
 * four lines crowd a narrow column, so the plot keeps the called regime and
 * its strongest challenger and the other two move to a muted footnote line
 * under the plot. G4's rule applies: the two values are moved, never cut, so
 * all four remain on screen and readable. This is the one place the hook
 * decides which marks are drawn rather than how they stack; F1 asks for it in
 * those words, and the numbers stay served either way.
 *
 * Keyboard: the plot is a tab stop. Its label names the current month and all
 * four values, so focus alone answers the chart's question; Left and Right
 * walk the months and a live region announces each one.
 *
 * Drawn through HeroChartFrame at the hero column's own size, 1:1, so the
 * words keep their set size at every width. The frame's floor follows the
 * width (0.4 of it, 220 to 280px). A 24-month series reads across, so the
 * plot is never taller than 0.8 of its width (the floor still wins on a
 * narrow column, so the words stay legible); a slot stretched taller than
 * that centres the chart in it. At 1620px and wider, where the Dashboard's
 * hero sits beside the summary card and the row's height is the summary's,
 * the hero stacks the chart under its copy (app.css), so the chart takes the
 * hero's full width and the row's height lands on a landscape plot instead
 * of an interior blank.
 */

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Regime } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { HeroChartFrame, clampPx } from "../shared/HeroChart";
import {
  REGIMES,
  REGIME_HUE,
  type RegimeName,
} from "../regimelab/regime-history";

export interface RegimeOddsChartProps {
  /** Ascending stored monthly rows; the last `months` are drawn. */
  rows: Regime[];
  months?: number;
}

const KEYS: Record<RegimeName, keyof Regime> = {
  Goldilocks: "prob_goldilocks",
  Overheating: "prob_overheating",
  Stagflation: "prob_stagflation",
  "Recession Risk": "prob_recession",
};

/** The legend row above the plot, and the caption line under it (boxes, margins included). */
const LEGEND_H = 26;
const CAP_H = 22;
/** The muted footnote line below 1024px, carrying the two lines the plot drops. */
const FOOT_H = 20;
const PAD_L = 34;
/** Room for the current-month dot and its value label. */
const PAD_R = 44;
const PAD_T = 10;
const PAD_B = 22;
const FALLBACK = { w: 400, h: 300 };
/** The plot's height at most this share of its width (landscape: 24 months read across). */
const MAX_ASPECT = 0.8;
const floorPlot = (w: number) => clampPx(w * 0.4, 220, 280);

const AXIS: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".04em",
};
/** #7d8b98 clears 4.5:1 on the hero card (the quadrant's axis ink). */
const AXIS_FILL = "#7d8b98";
const STAMP: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: ".04em",
};
/** Name ink per regime: the hue, except Stagflation, whose #e74c3c falls to
 * about 4:1 under the hero's mint glow; it takes the design system's
 * stagflation text rung (DESIGN.md colors, regime-stagflation-text), 6:1. */
const NAME_FILL: Record<string, string> = {
  ...REGIME_HUE,
  Stagflation: "#f08785",
};

/** Legend metrics, the same estimate idiom the band build used for its end
 * labels: UI names at 11.5px run about 6.2px a glyph, mono values at 11px
 * about 6.6px, plus the swatch, its gap and the space between name and
 * value. Generous by a pixel or two, because the cost of guessing low is a
 * clipped key and the cost of guessing high is one key moved to the
 * footnote. */
const KEY_SWATCH = 13;
const KEY_GAP = 14;
/** The month stamp pinned to the legend's right end ("Sep 2026"). */
const STAMP_W = 64;
export const keyWidth = (name: string, value: string) =>
  Math.ceil(KEY_SWATCH + name.length * 6.2 + 3.5 + value.length * 6.6);

/**
 * How many legend keys fit one row at a measured width. The hero's chart
 * column is narrowest at 1280px (418px measured, narrower than the 390px
 * phone's 316px column relative to its content), so the tier alone cannot
 * answer this: four keys overflowed there while fitting at 1024 and 1440.
 * Keys that do not fit move to the footnote line, the same "moved, never
 * cut" treatment the narrow-column reduction already uses.
 */
export function fitKeys(
  entries: { name: string; value: string }[],
  w: number,
): number {
  let used = STAMP_W;
  let n = 0;
  for (const e of entries) {
    const next = used + (n ? KEY_GAP : 0) + keyWidth(e.name, e.value);
    if (n && next > w) break;
    used = next;
    n += 1;
  }
  return Math.max(1, n);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
/** "2026-07-01" -> 2026 x 12 + 6: whole calendar months, zone-free. */
const monthIndex = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return y * 12 + ((m ?? 1) - 1);
};
const prob = (r: Regime, name: RegimeName) => {
  const v = r[KEYS[name]] as number | null | undefined;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
};
/** Stored probabilities print as whole percent, the hero pill's rounding. */
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The four rows of the legend, in resting order: highest latest value first. */
export function legendOrder(rows: Regime[]): RegimeName[] {
  const last = rows[rows.length - 1];
  if (!last) return [...REGIMES];
  return [...REGIMES].sort((a, b) => prob(last, b) - prob(last, a));
}

/**
 * Which regimes the plot draws heavy, and which it drops to the footnote.
 * Wide: every regime is drawn, the called one heavy. Narrow: the called
 * regime and its strongest challenger are drawn heavy, the other two move to
 * the footnote line (F1) - moved, never cut.
 */
export function seriesPlan(
  rows: Regime[],
  wide: boolean,
): { drawn: RegimeName[]; heavy: RegimeName[]; footnote: RegimeName[] } {
  const last = rows[rows.length - 1];
  const called = (REGIMES as readonly string[]).includes(last?.label ?? "")
    ? (last.label as RegimeName)
    : legendOrder(rows)[0];
  if (wide) return { drawn: [...REGIMES], heavy: [called], footnote: [] };
  const challenger = legendOrder(rows).find((r) => r !== called) ?? called;
  const kept = [called, challenger];
  return {
    drawn: kept,
    heavy: kept,
    footnote: REGIMES.filter((r) => !kept.includes(r)),
  };
}

export function RegimeOddsChart({
  rows: all,
  months = 24,
}: RegimeOddsChartProps) {
  const { bp } = useBreakpoint();
  const wide = bp === "wide";
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const liveId = useId();

  const rows = useMemo(() => all.slice(-months), [all, months]);
  const n = rows.length;
  const last = rows[n - 1];
  const first = rows[0];

  const plan = useMemo(
    () => (n >= 2 && last ? seriesPlan(rows, wide) : null),
    [rows, wide, n, last],
  );
  const order = useMemo(
    () => (n >= 2 && last ? legendOrder(rows) : []),
    [rows, n, last],
  );

  /** Nearest month to a pointer x, in the plot's own coordinates. */
  const pickMonth = useCallback(
    (clientX: number) => {
      const el = svgRef.current;
      if (!el || n < 2 || !first || !last) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const vb = el.viewBox.baseVal;
      const x = ((clientX - r.left) / r.width) * (vb?.width || r.width);
      const x0 = PAD_L;
      const x1 = Math.max(x0 + 40, (vb?.width || r.width) - PAD_R);
      const m0 = monthIndex(first.date);
      const span = Math.max(1, monthIndex(last.date) - m0);
      const want = m0 + ((x - x0) / Math.max(1, x1 - x0)) * span;
      let best = 0;
      let bestD = Infinity;
      rows.forEach((row, i) => {
        const d = Math.abs(monthIndex(row.date) - want);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setActive(best);
    },
    [rows, n, first, last],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setActive((cur) => {
        const from = cur ?? n - 1;
        return Math.min(
          n - 1,
          Math.max(0, from + (e.key === "ArrowRight" ? 1 : -1)),
        );
      });
    },
    [n],
  );

  if (n < 2 || !last || !first || !plan) return null;

  const called = plan.heavy[0];
  /** The month the legend prints: the crosshair's, or the current month at rest. */
  const readRow = rows[active ?? n - 1];
  const readValues = order
    .map((name) => `${name} ${pct(prob(readRow, name))}`)
    .join(", ");
  const ariaLabel =
    `Regime odds by month, one line per regime, ${fmtMonYr(first.date)} to ${fmtMonYr(last.date)}. ` +
    `${fmtMonYr(last.date)} is the current month, called ${last.label}: ${order.map((name) => `${name} ${pct(prob(last, name))}`).join(", ")}. ` +
    `Left and right arrow keys read earlier months.`;

  const draw = (w: number, h: number) => {
    const x0 = PAD_L;
    const x1 = Math.max(x0 + 40, w - PAD_R);
    const y0 = PAD_T;
    const y1 = h - PAD_B;
    // Calendar months, not row indices: a month missing from the store
    // shows as a wider step, never as a squeezed-out gap.
    const m0 = monthIndex(first.date);
    const span = Math.max(1, monthIndex(last.date) - m0);
    const X = (i: number) =>
      round1(x0 + ((monthIndex(rows[i].date) - m0) / span) * (x1 - x0));
    const Y = (v: number) => round1(y1 - v * (y1 - y0));

    const lines = plan.drawn.map((name) => ({
      name,
      heavy: plan.heavy.includes(name),
      d: `M${rows.map((_, i) => `${X(i)},${Y(prob(rows[i], name))}`).join("L")}`,
    }));

    // Captured so TypeScript narrows it inside the crosshair branch below.
    const ai = active;
    const ax = ai != null ? X(ai) : null;
    const showFirst = x1 - x0 >= 150 && (ax == null || ax - x0 > 46);
    const calledY = Y(prob(last, called));

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={liveId}
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => pickMonth(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="mrr-odds-plot"
        style={{ display: "block", maxWidth: "100%", outlineOffset: 2 }}
      >
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <g key={v}>
            <line
              x1={x0}
              x2={x1}
              y1={Y(v)}
              y2={Y(v)}
              stroke="rgba(150,175,200,.12)"
            />
            <text
              x={x0 - 6}
              y={Y(v) + 3.5}
              textAnchor="end"
              fill={AXIS_FILL}
              style={AXIS}
            >
              {v * 100}%
            </text>
          </g>
        ))}
        {/* The current month's rule sits under the lines so it never cuts one. */}
        <g
          className="mrr-odds-current"
          data-current-month={last.date.slice(0, 10)}
        >
          <line
            x1={x1}
            x2={x1}
            y1={y0 - 2}
            y2={y1 + 4}
            stroke="#fff"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        </g>
        {ax != null && ai != null ? (
          <g
            className="mrr-odds-crosshair"
            data-crosshair-month={rows[ai].date.slice(0, 10)}
          >
            <line
              x1={ax}
              x2={ax}
              y1={y0 - 2}
              y2={y1 + 4}
              stroke="#dff7ee"
              strokeOpacity={0.55}
            />
            {plan.drawn.map((name) => (
              <circle
                key={name}
                cx={ax}
                cy={Y(prob(rows[ai], name))}
                r={3}
                style={{ fill: REGIME_HUE[name] }}
                stroke="#031a12"
                strokeWidth={1.25}
              />
            ))}
          </g>
        ) : null}
        {lines.map((l) => (
          <path
            key={l.name}
            className="mrr-odds-line"
            data-regime={l.name}
            // The D1 sweep groups a chart's series by `data-series` when it is
            // tagged and falls back to grouping filled paths by colour. A line
            // has no fill, so tagging is what names the four series now.
            data-series={l.name}
            data-weight={l.heavy ? "heavy" : "muted"}
            d={l.d}
            fill="none"
            style={{ stroke: REGIME_HUE[l.name] }}
            strokeWidth={l.heavy ? 2.25 : 1.2}
            strokeOpacity={l.heavy ? 1 : 0.45}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* The current month's dot rides the called line, labelled with its value. */}
        <g className="mrr-odds-marker">
          <circle
            cx={x1}
            cy={calledY}
            r={4.5}
            style={{ fill: REGIME_HUE[called] }}
            stroke="#031a12"
            strokeWidth={1.5}
          />
          <text
            x={x1 + 7}
            y={round1(calledY + 3.5)}
            fill={NAME_FILL[called]}
            style={STAMP}
          >
            {pct(prob(last, called))}
          </text>
        </g>
        {showFirst ? (
          <text x={x0} y={h - 7} fill={AXIS_FILL} style={AXIS}>
            {fmtMonYr(first.date)}
          </text>
        ) : null}
        <text x={x1} y={h - 7} textAnchor="end" fill="#dff7ee" style={STAMP}>
          {fmtMonYr(last.date)}
        </text>
      </svg>
    );
  };

  const legendValue = (name: RegimeName) => pct(prob(readRow, name));
  /** Legend entries in resting order, each carrying the month being read. */
  const entries = order.map((name) => ({ name, value: legendValue(name) }));
  /** The legend names what the plot draws and what fits one row; everything
   * else prints in full on the footnote line, hue-coloured so the reader can
   * still tie a name to its line. Four keys squeezed 88px of text into 37px
   * at 390px and pushed "Recession Risk" outside the figure at 1280px. */
  /** The legend, the caption and, when the split makes one, the footnote. */
  const chromeH = (w: number) =>
    LEGEND_H + CAP_H + (splitAt(w).foot.length ? FOOT_H : 0);
  const splitAt = (w: number) => {
    const drawable = entries.filter((e) => plan.drawn.includes(e.name));
    const keep = drawable.slice(0, fitKeys(drawable, w)).map((e) => e.name);
    return { keys: keep, foot: entries.filter((e) => !keep.includes(e.name)) };
  };

  return (
    <HeroChartFrame
      fallback={FALLBACK}
      minHeight={(w) => floorPlot(w) + chromeH(w)}
      maxHeight={(w) =>
        Math.max(floorPlot(w), Math.round(w * MAX_ASPECT)) + chromeH(w)
      }
    >
      {({ w, h }) => {
        const { keys: legendKeys, foot: footEntries } = splitAt(w);
        return (
          <figure
            data-chart=""
            className="mrr-odds-chart"
            style={{ width: w, maxWidth: "100%", minWidth: 0, margin: 0 }}
          >
            {/* Inline legend, and the crosshair's readout: one row, so no
              floating box can overlap the plot's own text (F1 Done-when). */}
            <div
              className="mrr-odds-legend"
              style={{
                height: LEGEND_H,
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "nowrap",
                overflow: "hidden",
                fontFamily: "var(--font-ui)",
                fontSize: 11.5,
              }}
            >
              {legendKeys.map((name) => (
                <span
                  key={name}
                  className="mrr-odds-key"
                  data-regime={name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    flex: "0 0 auto",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      flex: "0 0 auto",
                      background: REGIME_HUE[name],
                    }}
                  />
                  {/* Name and value share one flex item with a real space
                    between them, so the accessible name reads "Goldilocks
                    58%" rather than running the two together. */}
                  <span style={{ whiteSpace: "nowrap" }}>
                    <span
                      style={{
                        color: NAME_FILL[name],
                        fontWeight: name === called ? 600 : 500,
                      }}
                    >
                      {name}
                    </span>{" "}
                    <span
                      className="mrr-odds-key-v"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-2)",
                      }}
                    >
                      {legendValue(name)}
                    </span>
                  </span>
                </span>
              ))}
              <span
                style={{
                  marginLeft: "auto",
                  flex: "0 0 auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtMonYr(readRow.date)}
              </span>
            </div>
            {draw(w, h - chromeH(w))}
            {footEntries.length ? (
              <div
                className="mrr-odds-foot"
                style={{
                  height: FOOT_H,
                  lineHeight: `${FOOT_H}px`,
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {footEntries.map((e, i) => (
                  <span
                    key={e.name}
                    className="mrr-odds-foot-key"
                    data-regime={e.name}
                  >
                    {i ? " · " : ""}
                    <span style={{ color: NAME_FILL[e.name] }}>
                      {e.name}
                    </span>{" "}
                    {e.value}
                  </span>
                ))}
              </div>
            ) : null}
            <figcaption
              className="mrr-odds-cap"
              data-copy="caption"
              style={{
                marginTop: 6,
                height: CAP_H - 6,
                lineHeight: `${CAP_H - 6}px`,
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                color: "var(--text-3)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span
                className="mrr-odds-cap-k"
                style={{
                  fontWeight: 500,
                  fontSize: 11,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--text-eyebrow)",
                }}
              >
                Regime odds · {n} months
              </span>{" "}
              · heaviest line is the call
            </figcaption>
            <span id={liveId} aria-live="polite" className="sr-only">
              {fmtMonYr(readRow.date)}: {readValues}
            </span>
          </figure>
        );
      }}
    </HeroChartFrame>
  );
}

export default RegimeOddsChart;
