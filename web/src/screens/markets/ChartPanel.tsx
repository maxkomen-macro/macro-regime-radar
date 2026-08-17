/**
 * Row-click chart panel — Lightweight Charts themed entirely from the token
 * layer (colors resolved from CSS variables at mount; the library needs
 * concrete values). Daily candles come from /api/market/daily; the intraday
 * line exists only where the DB stores it (SPY/QQQ), per the day-1 spec.
 * Symbols outside the stored 23-ETF universe (crypto, FX, single names, VIX)
 * state that honestly instead of faking a history.
 *
 * Critique fixes (2026-08-06, one pass):
 * - No last-value badge / price line on either series — a red "769.79" chip
 *   over a row saying "$768.56 · close" was the old tab's condemned
 *   two-current-prices bug reborn. The stored history's date lives in the
 *   header text; the tape row owns the current quote.
 * - The chart is created once per mode and DATA is applied through a series
 *   ref — the 30s intraday poll no longer tears down and rebuilds the chart.
 * - Opening the panel scrolls it into view and moves focus to it (clicking a
 *   Single-Names row 1,400px below now has visible, announced feedback);
 *   Escape closes it; mode toggles carry aria-pressed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useMarketDaily, useMarketIntraday } from "../../api/queries";
import { fmtDate } from "../../lib/format";

import { CHART_PANEL_ID } from "./chart-panel-id";

const INTRADAY_SYMBOLS = new Set(["SPY", "QQQ"]);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "2026-08-05 15:55:00" (pipeline-stamped ET) → chart timestamp. Lightweight
 * Charts renders its time axis in UTC, so the standard fixed-timezone practice
 * is to feed the ET wall time AS IF it were UTC — the axis then reads
 * 09:30–15:55, matching every other ET label in the app. The instants are
 * display-shifted, which only this axis consumes. */
function etWallToChartTime(ts: string): number {
  return new Date(ts.replace(" ", "T") + "Z").getTime() / 1000;
}

type Mode = "daily" | "intraday";

interface Props {
  symbol: string;
  name: string;
  /** Whether /api/market/daily stores candles for this symbol. */
  hasHistory: boolean;
  onClose: () => void;
}

export default function ChartPanel({ symbol, name, hasHistory, onClose }: Props) {
  // ?mode=intraday pairs with ?chart= for reproducible evidence captures.
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get("mode") === "intraday" ? "intraday" : "daily",
  );
  const canIntraday = INTRADAY_SYMBOLS.has(symbol);
  // Empty symbol lists disable the underlying queries (no-history panels must
  // not poll the API for nothing).
  const daily = useMarketDaily(hasHistory ? [symbol] : [], 365);
  const intraday = useMarketIntraday(canIntraday ? [symbol] : [], 48);

  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);

  const dailyBars = useMemo(
    () =>
      (daily.data ?? [])
        .filter((b) => b.symbol === symbol && b.open != null && b.close != null)
        .map((b) => ({
          time: b.date as unknown as UTCTimestamp, // business-day string is valid
          open: b.open as number,
          high: (b.high ?? Math.max(b.open as number, b.close as number)) as number,
          low: (b.low ?? Math.min(b.open as number, b.close as number)) as number,
          close: b.close as number,
        })),
    [daily.data, symbol],
  );

  const intradayPoints = useMemo(
    () =>
      (intraday.data ?? [])
        .filter((p) => p.symbol === symbol && p.close != null)
        .map((p) => ({ time: etWallToChartTime(p.ts) as UTCTimestamp, value: p.close as number })),
    [intraday.data, symbol],
  );

  const activeMode: Mode = mode === "intraday" && canIntraday ? "intraday" : "daily";

  // Opening feedback: bring the panel into view and move focus to it — the
  // trigger row can sit 1,400px below where the panel mounts.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest" });
    panelRef.current?.focus({ preventScroll: true });
  }, [symbol]);

  // Escape closes the panel from anywhere inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Chart lifecycle: create once per mode/symbol-history combination…
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasHistory) return;
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
      timeScale: { borderColor: cssVar("--line"), timeVisible: activeMode === "intraday" },
      crosshair: {
        vertLine: { color: cssVar("--accent-line"), labelBackgroundColor: cssVar("--surface-raised") },
        horzLine: { color: cssVar("--accent-line"), labelBackgroundColor: cssVar("--surface-raised") },
      },
    });
    chartRef.current = chart;
    // One current price per screen: the tape row owns the live quote, so the
    // series shows no last-value badge and no price line (critique P1 — the
    // old tab was condemned for exactly this contradiction).
    if (activeMode === "daily") {
      candleRef.current = chart.addSeries(CandlestickSeries, {
        upColor: cssVar("--pos"),
        downColor: cssVar("--neg"),
        wickUpColor: cssVar("--pos"),
        wickDownColor: cssVar("--neg"),
        borderVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    } else {
      lineRef.current = chart.addSeries(LineSeries, {
        color: cssVar("--accent"),
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    return () => {
      candleRef.current = null;
      lineRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [hasHistory, activeMode, symbol]);

  // …and apply data through the series refs, so a 30s poll updates in place
  // instead of rebuilding the chart.
  useEffect(() => {
    if (activeMode === "daily" && candleRef.current) {
      candleRef.current.setData(dailyBars);
      chartRef.current?.timeScale().fitContent();
    }
  }, [activeMode, dailyBars]);
  useEffect(() => {
    if (activeMode === "intraday" && lineRef.current) {
      lineRef.current.setData(intradayPoints);
      chartRef.current?.timeScale().fitContent();
    }
  }, [activeMode, intradayPoints]);

  const modeBtn = (m: Mode, label: string, enabled: boolean) => (
    <button
      key={m}
      onClick={() => enabled && setMode(m)}
      disabled={!enabled}
      aria-pressed={activeMode === m}
      title={enabled ? undefined : "Intraday bars are stored for SPY and QQQ only"}
      style={{
        appearance: "none",
        background: activeMode === m ? "var(--accent-dim)" : "none",
        border: `0.5px solid ${activeMode === m ? "var(--accent-line)" : "var(--line-hair)"}`,
        borderRadius: "var(--r-xs)",
        color: enabled ? (activeMode === m ? "var(--accent)" : "var(--text-muted)") : "var(--text-faint)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-meta)",
        letterSpacing: "var(--ls-micro)",
        textTransform: "uppercase",
        padding: "3px 8px",
        cursor: enabled ? "pointer" : "not-allowed",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      id={CHART_PANEL_ID}
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={`${symbol} chart panel`}
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        padding: "var(--pad-card)",
        marginBottom: 12,
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body-s)", color: "var(--text)" }}>
          <b>{symbol}</b>
          <span style={{ color: "var(--text-muted)" }}> · {name}</span>
          {hasHistory && (
            <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "var(--fs-meta)" }}>
              {activeMode === "daily"
                ? `daily candles · ${dailyBars.length} sessions${dailyBars.length ? ` · through ${fmtDate(String(dailyBars[dailyBars.length - 1].time))}` : ""}`
                : `5-minute bars · last two sessions stored`}
            </span>
          )}
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {hasHistory && modeBtn("daily", "Daily", true)}
          {hasHistory && modeBtn("intraday", "Intraday", canIntraday)}
          <button
            onClick={onClose}
            aria-label="Close chart"
            title="Close — Esc"
            style={{
              appearance: "none",
              background: "none",
              border: "0.5px solid var(--line-hair)",
              borderRadius: "var(--r-xs)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              padding: "3px 8px",
              cursor: "pointer",
            }}
          >
            × close
          </button>
        </span>
      </div>
      {hasHistory ? (
        <>
          <div ref={containerRef} style={{ height: 320, width: "100%" }} />
          {activeMode === "intraday" && !intraday.isLoading && intradayPoints.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-meta)",
                color: "var(--text-muted)",
                marginTop: 6,
              }}
            >
              No stored 5-minute bars inside the last 48 hours — the store keeps the last two
              sessions for SPY and QQQ.
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            lineHeight: 1.6,
            padding: "24px 0",
          }}
        >
          No stored history for {symbol} — the candle store covers the 23-ETF market universe.
          This row trades on the live tape above; its stream quote is the whole story we hold.
        </div>
      )}
    </div>
  );
}
