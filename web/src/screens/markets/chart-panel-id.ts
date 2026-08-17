/** Shared between the lazy ChartPanel and the rows that aria-controls it —
 * lives outside ChartPanel.tsx so importing it doesn't pull lightweight-charts
 * into the main chunk. */
export const CHART_PANEL_ID = "markets-chart-panel";
