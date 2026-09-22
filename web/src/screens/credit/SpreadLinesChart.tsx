/**
 * Multi-series spread line chart on Lightweight Charts 5.2.0 (redesign Phase
 * 6, checklist 06 B.1.1 and B.5). Same chrome as CandleChart: transparent
 * ground, hairline grid, Plex Mono 10px axis in #6f7d8a, no last-value
 * badge, the library's layout table marked presentational. Two callers: the
 * hero HY / IG history with three dashed rules (`createPriceLine`) and the
 * NBER bands (a full-height HistogramSeries on a hidden price scale, one
 * column per plotted month, tinted only inside a band), and the quality
 * ladder's BB / B / CCC six-month chart with neither. Scrolling and scaling
 * are off: the caller's range control decides what is plotted. The wrapper is
 * `role="img"` with the caller's label; the canvas is not readable, so the
 * numbers live in the copy around the chart.
 */

import { useEffect, useRef } from "react";
import { CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";

export interface SpreadPoint {
  /** ISO date (YYYY-MM-DD or a longer ISO string; the chart slices to the day). */
  date: string;
  value: number;
}
export interface SpreadSeries {
  label: string;
  /** CSS colour (hex or rgba; CSS variables are resolved by the caller). */
  color: string;
  points: SpreadPoint[];
  /** Library line width, integer 1..4. Default 1. */
  lineWidth?: 1 | 2 | 3 | 4;
}
export interface SpreadRule {
  /** Index into `series` whose price scale the rule sits on. */
  series: number;
  price: number;
  color: string;
  title: string;
}
export interface SpreadBand {
  /** ISO dates, inclusive months. */
  from: string;
  to: string;
  label: string;
}
export interface SpreadLinesChartProps {
  series: SpreadSeries[];
  height: number;
  /** aria-label of the `role="img"` wrapper. */
  ariaLabel: string;
  /** Dashed horizontal rules (hero chart only). */
  rules?: SpreadRule[];
  /** Shaded date bands (hero chart only; the NBER recessions). */
  bands?: SpreadBand[];
}

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#8f9daa";

/** Spec section 3: axis labels are Plex Mono 10px in #6f7d8a. */
const AXIS_TEXT = "#6f7d8a";
/** The band tint (U8): full-height columns behind the lines. */
const BAND_TINT = "rgba(150,175,200,.10)";

const day = (iso: string): string => iso.slice(0, 10);
const ym = (iso: string): string => iso.slice(0, 7);

/** A plotted month is shaded when it falls inside a band, months inclusive. */
function inBand(date: string, bands: SpreadBand[]): boolean {
  const m = ym(date);
  return bands.some((b) => m >= ym(b.from) && m <= ym(b.to));
}

/** Ascending, one point per day (last wins): the library asserts ordering and
 * uniqueness, and a served series must never take the screen down. */
function prepare(points: SpreadPoint[]): { time: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(day(p.date), p.value);
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([time, value]) => ({ time, value }));
}

export default function SpreadLinesChart({ series, height, ariaLabel, rules, bands }: SpreadLinesChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);

  // The chart instance lives for the component's life; autoSize follows the
  // container, so a height change needs no rebuild.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: AXIS_TEXT,
        fontFamily: cssVar("--font-mono"),
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar("--line-2") },
        horzLines: { color: cssVar("--line-2") },
      },
      rightPriceScale: { borderColor: cssVar("--line"), scaleMargins: { top: 0.08, bottom: 0.04 } },
      timeScale: {
        borderColor: cssVar("--line"),
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: false,
      handleScale: false,
      crosshair: {
        // Normal, not magnet: the hidden band histogram must never attract the
        // horizontal line or its label.
        mode: CrosshairMode.Normal,
        vertLine: { color: cssVar("--link-a32"), labelBackgroundColor: cssVar("--track") },
        horzLine: { color: cssVar("--link-a32"), labelBackgroundColor: cssVar("--track") },
      },
    });
    chartRef.current = chart;
    // The library lays itself out with a <table>; it is not data (CandleChart 78).
    el.querySelectorAll("table").forEach((t) => t.setAttribute("role", "presentation"));
    return () => {
      seriesRef.current = [];
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  // Series, rules and bands are rebuilt on the same instance whenever the
  // inputs change (the hero's 10Y / MAX toggle); the first run follows the
  // creation effect above in declaration order.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) chart.removeSeries(s);
    seriesRef.current = [];

    const prepared = series.map((s) => prepare(s.points));

    // Bands first, so the tint paints beneath the lines: one column per plotted
    // month on a hidden 0..1 scale with no margins, so a 1 is the full pane.
    if (bands?.length && prepared[0]?.length) {
      const hist = chart.addSeries(HistogramSeries, {
        priceScaleId: "bands",
        color: BAND_TINT,
        base: 0,
        lastValueVisible: false,
        priceLineVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
      });
      chart.priceScale("bands").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
      hist.setData(prepared[0].map((p) => ({ time: p.time, value: inBand(p.time, bands) ? 1 : 0, color: BAND_TINT })));
      seriesRef.current.push(hist);
    }

    const lines = series.map((s, i) => {
      const line = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: s.lineWidth ?? 1,
        lastValueVisible: false,
        priceLineVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => `${Math.round(v)}`, minMove: 1 },
      });
      line.setData(prepared[i]);
      seriesRef.current.push(line);
      return line;
    });

    rules?.forEach((r) => {
      const line = lines[r.series];
      if (!line) return;
      line.createPriceLine({
        price: r.price,
        color: r.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: r.title,
      });
    });

    chart.timeScale().fitContent();
  }, [series, rules, bands]);

  return (
    <div role="img" aria-label={ariaLabel} className="mrr-spread-chart" style={{ height, minHeight: height, minWidth: 0 }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
