/**
 * Candle chart for the single-name deep dive: lightweight-charts v5, same
 * house chrome as ChartPanel (transparent ground, hairline grid, mono axis,
 * no last-value badge: the header owns the current quote). Volume rides as a
 * muted histogram in the bottom fifth. Lazy-loaded with ChartPanel's split so
 * the library stays out of the main bundle.
 *
 * 2026-09-15 (redesign Phase 5, checklist 05 B.4): an optional `average`
 * window draws a simple moving average over daily candles as a `--link` line,
 * computed by `movingAverage` in candle-data.ts. Intraday payloads never get
 * it: a 20-bar mean over 5-minute bars is not a 20-day average, and the
 * legend in SingleName hides with it.
 */

import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineWidth, Time } from "lightweight-charts";
import type { CandleBar, CandleRange } from "../../api/types";
import { isIntraday, movingAverage, prepareCandles, prepareVolumes } from "./candle-data";

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#8f9daa";

/* The library types `lineWidth` as 1 | 2 | 3 | 4, but its line renderer draws
   `lineWidth * devicePixelRatio` unfloored (PaneRendererLineBase), so the
   spec's 1.4px hairline for the average renders as written. */
const AVERAGE_LINE_WIDTH = 1.4 as number as LineWidth;

interface Props {
  bars: CandleBar[];
  /** The range the BARS belong to (pass the payload's own `range`, never the
   * requested one, so placeholder bars keep their encoding while a coarser
   * range loads (review P0-1). */
  range: CandleRange;
  /** The payload's interval, when known; it decides the time encoding. */
  interval?: string;
  height?: number;
  /** Window of the simple moving average drawn over the candles (a `--link`
   * line, no last-value label, no price line). Honoured only when the payload
   * interval is daily ("1d"); ignored on intraday, weekly and monthly bars. */
  average?: number;
}

export default function CandleChart({ bars, range, interval, height = 320, average }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const avgRef = useRef<ISeriesApi<"Line"> | null>(null);
  const intraday = isIntraday(interval, range);
  const showAverage = average != null && average >= 1 && interval === "1d";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: cssVar("--text-muted"),
        fontFamily: cssVar("--font-mono"),
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar("--line-hair") },
        horzLines: { color: cssVar("--line-hair") },
      },
      rightPriceScale: { borderColor: cssVar("--line") },
      timeScale: { borderColor: cssVar("--line"), timeVisible: intraday },
      crosshair: {
        vertLine: { color: cssVar("--accent-line"), labelBackgroundColor: cssVar("--surface-raised") },
        horzLine: { color: cssVar("--accent-line"), labelBackgroundColor: cssVar("--surface-raised") },
      },
    });
    chartRef.current = chart;
    // The library lays itself out with a <table>; it is not data (review P3-15).
    el.querySelectorAll("table").forEach((t) => t.setAttribute("role", "presentation"));
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--pos"),
      downColor: cssVar("--neg"),
      wickUpColor: cssVar("--pos"),
      wickDownColor: cssVar("--neg"),
      borderVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      color: cssVar("--line-strong"),
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    // Added last so the average draws over the candles; it shares their price
    // scale and, like them, carries no badge, no price line and no hover dot.
    avgRef.current = showAverage
      ? chart.addSeries(LineSeries, {
          color: cssVar("--link"),
          lineWidth: AVERAGE_LINE_WIDTH,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
      : null;
    return () => {
      candleRef.current = null;
      volRef.current = null;
      avgRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [intraday, showAverage]);

  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;
    // De-duplicated and ascending by construction (candle-data.ts), so the
    // library's ordering assertion cannot take the screen down.
    const prepared = prepareCandles(bars, intraday);
    const candles = prepared.map((c) => ({ ...c, time: c.time as Time }));
    const vols = prepareVolumes(bars, intraday).map((v) => ({ ...v, time: v.time as Time }));
    candleRef.current.setData(candles);
    volRef.current.setData(vols);
    if (avgRef.current) {
      const points = showAverage && average != null ? movingAverage(prepared, average) : [];
      avgRef.current.setData(points.map((p) => ({ ...p, time: p.time as Time })));
    }
    chartRef.current?.timeScale().fitContent();
  }, [bars, intraday, average, showAverage]);

  return <div ref={containerRef} style={{ height, minHeight: height }} />;
}
