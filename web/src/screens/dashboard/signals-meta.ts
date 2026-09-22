/**
 * Signal PRESENTATION metadata only — display names (mirroring
 * shared_styles.py::SIGNAL_DISPLAY_NAMES), value formats, trigger prose
 * templates, and cadence words.
 *
 * The numeric truth (threshold, direction, distance-to-trigger, status) comes
 * from /api/signals/latest since 2026-08-06 — the client-side threshold
 * mirror of src/config.py is deleted, and trigger prose takes the server's
 * threshold as input so a config change can never make these sentences lie.
 */

export interface SignalMeta {
  name: string;
  display: string;
  /** Formats the stored numeric value the way the Streamlit card does (2dp + unit). */
  format: (v: number) => string;
  /** One-line desk-note trigger sentence, composed from the server threshold. */
  trigger: (threshold: number | null) => string;
  /**
   * Cadence of the UNDERLYING series, not of the card. Currently unrendered:
   * the dashboard's carried-forward caption used to interpolate this and read
   * "monthly signal print · X · daily pending" for the daily series, so that
   * suffix is now cadence-neutral. Kept as reference metadata.
   */
  cadence: "monthly print" | "daily";
  /** The FRED series the signal reads (Iteration 1, A1): its card stamp is
   * their state from the signals payload's `freshness` block. */
  series: readonly string[];
}

const num = (t: number | null, dp = 2) => (t != null ? t.toFixed(dp) : null);

export const SIGNALS_META: Record<string, SignalMeta> = {
  yield_curve_inversion: {
    name: "yield_curve_inversion",
    display: "Curve inversion risk",
    format: (v) => `${v.toFixed(2)}%`,
    trigger: (t) => (num(t) ? `Trips when the 10Y–2Y spread closes below ${num(t)}%.` : "Trips when the 10Y–2Y spread closes below its stored trigger."),
    cadence: "daily",
    series: ["DGS10", "DGS2"],
  },
  unemployment_spike: {
    name: "unemployment_spike",
    display: "Unemployment spike",
    format: (v) => `${v.toFixed(2)} pp / 3m`,
    trigger: (t) => (num(t) ? `Trips when unemployment rises ${num(t)} pp or more over 3 months.` : "Trips when the 3-month rise in unemployment reaches its stored trigger."),
    cadence: "monthly print",
    series: ["UNRATE"],
  },
  cpi_hot: {
    name: "cpi_hot",
    display: "Inflation pressure",
    format: (v) => `${v.toFixed(2)}% YoY`,
    trigger: (t) => (num(t) ? `Trips when CPI runs above ${num(t)}% YoY.` : "Trips when CPI runs above its stored trigger."),
    cadence: "monthly print",
    series: ["CPIAUCSL"],
  },
  cpi_cold: {
    name: "cpi_cold",
    display: "Disinflation signal",
    format: (v) => `${v.toFixed(2)}% YoY`,
    trigger: (t) => (num(t) ? `Trips when CPI falls below ${num(t)}% YoY.` : "Trips when CPI falls below its stored trigger."),
    cadence: "monthly print",
    series: ["CPIAUCSL"],
  },
  vix_spike: {
    name: "vix_spike",
    display: "VIX spike",
    format: (v) => v.toFixed(2),
    trigger: (t) => (num(t) ? `Trips when the VIX closes above ${num(t)}.` : "Trips when the VIX closes above its stored trigger."),
    cadence: "daily",
    series: ["VIXCLS"],
  },
};

export const SIGNAL_ORDER = [
  "yield_curve_inversion",
  "cpi_hot",
  "cpi_cold",
  "vix_spike",
  "unemployment_spike",
];
