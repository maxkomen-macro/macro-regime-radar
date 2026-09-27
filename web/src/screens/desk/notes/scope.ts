/**
 * DESK_FRAME3_SPEC §1.0.1, word for word: the section Build Notes prints
 * besides the notes file (§11: "the section 'Live / Designed, not yet
 * served': §1.0.1's two lists, word for word"). The page's one hardcoded
 * text after the byline; BuildNotesPage.test.tsx holds it to the spec's own lines.
 */

export const SCOPE_TITLE = "Live / Designed, not yet served";

export const SCOPE_LISTS: readonly { title: string; items: readonly string[] }[] = [
  {
    title: "Live",
    items: [
      "Overview: since the last close, the regime, the recession score, the S&P trend, the VIX level, active signals, data status.",
      "Technicals: the S&P price, the day's change, the 1-year return, the last 20 days in σ, its 50- and 200-day averages, trend, the latest cross, the chart, the scored signals, sector leadership.",
      "Event Study: every catalog study whose inputs are stored, at 5, 10, 20 and 60 sessions, at the engine's 90% interval.",
      "Regime: the label, the five-year strip, the recession score, the next CPI and industrial-production prints.",
      "Macro & Correlations: the yield curve and the credit spreads.",
      "Sectors: the eleven sector ETFs against SPY over 60 sessions, ranked, and the pattern by its rule; breadth of the 11 sectors, equal weight against cap weight, small caps against large.",
      "Signal Ledger: the twelve fixed signals, each scored when its study completes.",
      "Position Monitor: positions kept in this browser, with room for the S&P against its 50-day and for 2s10s.",
      "Data Pipeline: the series inventory, generated from the registry.",
      "Client view: the current study in plain words, a month out.",
    ],
  },
  {
    title: "Designed, not yet served",
    items: [
      "The VIX gap to realized volatility and the vol band word.",
      "What protection costs: options skew, implied against realized volatility, the term structure.",
      "Constituent-level breadth: the stocks inside the index, not the 11 sector ETFs.",
      "RSI, and the two RSI signals.",
      "Confidence levels other than 90%.",
      "The comparison with the study's condition dropped.",
      "What each regime has meant, and the S&P after each regime change.",
      "Stock–bond correlation, what moves with the S&P, the 12-asset matrix.",
      "Positions kept on a server, and DV01.",
      "Basket pricing, the residual chart and the hedge structures.",
    ],
  },
];
