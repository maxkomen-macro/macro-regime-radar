/**
 * Candle chart for the single-name deep dive — lightweight-charts v5, same
 * house chrome as ChartPanel (transparent ground, hairline grid, mono axis,
 * no last-value badge: the header owns the current quote). Volume rides as a
 * muted histogram in the bottom fifth. Lazy-loaded with ChartPanel's split so
 * the library stays out of the main bundle.
 */

import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, createChart } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { CandleBar, CandleRange } from "../../api/types";
import { isIntraday, prepareCandles, prepareVolumes } from "./candle-data";

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#8b949e";

interface Props {
  bars: CandleBar[];
  /** The range the BARS belong to (pass the payload's own `range`, never the
   * requested one, so placeholder bars keep their encoding while a coarser
   * range loads — review P0-1). */
  range: CandleRange;
  /** The payload's interval, when known; it decides the time encoding. */
  interval?: string;
  height?: number;
}

export default function CandleChart({ bars, range, interval, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const intraday = isIntraday(interval, range);

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
    return () => {
      candleRef.current = null;
      volRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [intraday]);

  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;
    // De-duplicated and ascending by construction (candle-data.ts), so the
    // library's ordering assertion cannot take the screen down.
    const candles = prepareCandles(bars, intraday).map((c) => ({ ...c, time: c.time as Time }));
    const vols = prepareVolumes(bars, intraday).map((v) => ({ ...v, time: v.time as Time }));
    candleRef.current.setData(candles);
    volRef.current.setData(vols);
    chartRef.current?.timeScale().fitContent();
  }, [bars, intraday]);

  return <div ref={containerRef} style={{ height, minHeight: height }} />;
}
