/**
 * The Desk's hover definitions (desk/usability item 11, DESK_FRAME3_SPEC §14.11):
 * one plain sentence per term of art, shown on hover or focus wherever a label,
 * a card head or a column head prints the term (kit/Term.tsx). The sentences
 * follow the Desk's ban list (desk-language.test.ts reads this file) and state
 * the Desk's own windows (RSI 14, realized volatility 21 sessions, σ over 252).
 */
export interface GlossaryTerm {
  /** How the term is printed on a page; the longest matching form wins. */
  forms: readonly string[];
  /** One plain sentence. */
  text: string;
}

export const GLOSSARY: Readonly<Record<string, GlossaryTerm>> = {
  sigma: { forms: ["σ"], text: "σ (sigma) is one standard deviation: a move's size against this series' usual moves of the same length over the last 252 sessions." },
  oas: { forms: ["HY spread", "high-yield spread", "High-yield spread", "OAS"], text: "The high-yield spread (an option-adjusted spread, OAS) is the extra yield bonds rated below investment grade pay over Treasuries of the same maturity." },
  ig: { forms: ["Investment grade", "investment grade"], text: "Investment grade is corporate credit rated BBB− or better; the figure is its extra yield over Treasuries." },
  hy: { forms: ["HY"], text: "HY is high-yield credit: corporate bonds rated below investment grade." },
  curve: { forms: ["2s10s"], text: "2s10s is the 10-year Treasury yield minus the 2-year; above zero the curve slopes up, below zero it is inverted." },
  steep: { forms: ["steepening", "flattening"], text: "Steepening means the 10-year yield is rising against the 2-year, so 2s10s widens; flattening is the reverse." },
  front: { forms: ["Front end"], text: "The front end is the short end of the Treasury curve; here, the 3-month bill yield." },
  bp: { forms: ["basis points", "bp"], text: "A basis point (bp) is one hundredth of a percentage point: 25 bp is 0.25 percentage points." },
  rsi: { forms: ["RSI"], text: "The relative strength index weighs Wilder-smoothed average gains against average losses with a 14-session period, from 0 to 100; above 70 reads as stretched up, below 30 as stretched down." },
  realized: { forms: ["realized volatility", "Realized volatility", "realized vol", "Realized vol"], text: "Realized volatility is how much the price actually moved: the standard deviation of the last 21 daily log returns, annualized." },
  implied: { forms: ["implied volatility", "Implied volatility", "implied vol", "Implied vol", "IV"], text: "Implied volatility is the size of move option prices assume over their life, annualized; set against realized volatility it shows whether options are rich or cheap." },
  skew: { forms: ["skew", "Skew", "SKEW"], text: "Skew is how much more the market pays for puts than for calls the same distance from the price: the price of crash protection." },
  vix: { forms: ["VIX"], text: "The VIX is the 30-day volatility the S&P 500's option prices imply, in annual percentage points." },
  drawdown: { forms: ["From 1-year high", "drawdown", "Drawdown"], text: "The drawdown is how far the price sits below its highest close of the last 252 sessions." },
  ma: { forms: ["50-day average", "200-day average", "50-day", "200-day"], text: "A moving average is the mean of the last 50 or 200 daily closes; a price above both is in an uptrend." },
  cross: { forms: ["golden cross", "Golden cross", "death cross", "Death cross"], text: "A golden cross is the 50-day average rising above the 200-day; a death cross is the 50-day falling below it." },
  rs: { forms: ["Relative strength", "relative strength"], text: "Relative strength is the price divided by a benchmark's, the S&P 500's unless the card names another; a rising line means it is beating the benchmark." },
  logret: { forms: ["log returns", "log return"], text: "A log return is the natural log of the price ratio; for moves this size it is close to the percent change." },
  corr: { forms: ["60-day correlation", "Correlation", "correlation", "Corr"], text: "Correlation runs from −1 to +1: how closely two assets' daily returns move together, here over the last 60 sessions." },
  breadth: { forms: ["Breadth", "breadth"], text: "Breadth is how much of the market joins a move; here, how many sector ETFs sit above their 50-day and 200-day averages, and the average stock against the index." },
  baseline: { forms: ["a normal stretch"], text: "Normal is the study's baseline: the same horizon's move over every evaluable session of its sample, not only after events." },
  // Codex R-05: the served excess median (api/desk_v2.py vs_normal: 100 × (median − baseline_median) of log moves, bp as served).
  vsnormal: { forms: ["Vs normal", "vs normal"], text: "Vs normal is the difference between the events' median log return and the same horizon's median from every evaluable session, times 100, or in basis points for a yield or spread." },
  blocks: { forms: ["overlap blocks"], text: "Events whose outcome windows overlap form one block and are resampled together, so one market episode counts once." },
  interval: { forms: ["90% interval"], text: "The range the median's excess over normal falls in on 90% of resampled histories." },
  odds: { forms: ["odds", "Odds"], text: "Regime odds are a strength score from the two trends, how far each slope sits from its own history, not a fitted probability." },
  lag: { forms: ["K−2"], text: "K−2 is the regime row stamped two months before the month in question, so a label uses only data already published by then." },
  nav: { forms: ["% NAV", "NAV"], text: "NAV is net asset value, the size of the whole book: a 4% NAV position is 4% of it." },
  dv01: { forms: ["DV01"], text: "DV01 is the money a position gains or loses when yields move one basis point." },
  beta: { forms: ["betas", "beta", "Beta"], text: "Beta is how far a position tends to move for a 1% move in its benchmark." },
  r2: { forms: ["R²"], text: "R² is the share of a position's daily moves its benchmark explains, from 0 to 1." },
  notional: { forms: ["notional", "Notional"], text: "Notional is the face value a position controls, not the cash it costs." },
  // The terms of the cards desk/fill-compute and desk/books added (the rebase onto main).
  macd: { forms: ["MACD", "Signal", "Histogram", "histogram", "signal line"], text: "MACD (12, 26, 9) is the 12-day exponential average of the closes minus the 26-day; the signal line is MACD's own 9-day average, and the histogram is MACD minus the signal line." },
  seasonality: { forms: ["Seasonality", "seasonality"], text: "Seasonality is each calendar month's average return over every complete month stored, with how often that month rose." },
  effn: { forms: ["Effective names"], text: "Effective names is 1 divided by the sum of the squared weights: how many equal positions the basket's concentration amounts to." },
  peak: { forms: ["From peak"], text: "From peak is how far the basket index sits below its highest close since the basket's history starts." },
  adv: { forms: ["days to trade", "Days to trade", "Days at 20%", "Liquidity", "20-day avg $ volume", "ADV"], text: "Liquidity is read as days to trade: how many sessions buying or selling the position takes at 20% of each name's average daily dollar volume (ADV) over the last 20 sessions." },
  // Codex R-08: src/desk/basket.py hedge_rows fits on the last 252 paired daily returns (WINDOWS "1y"), else the last 60.
  hedgeratio: { forms: ["Hedge ratio", "hedge ratio"], text: "The hedge ratio is the dollars of ETF to short per dollar of basket: the basket's beta to the ETF over the last 252 daily returns both have, else the last 60." },
  conc: { forms: ["Concentration", "concentration"], text: "Concentration is how much of the basket rides on a few names: the top three weights, and the effective number of equal positions it amounts to." },

  // ── Column heads (desk/pdf-polish item 7) ──────────────────────────────
  // One sentence per column of every Desk table, read from the code that computes the column (the report cites
  // each file and line). No forms: a column head names its definition by id, so a word such as "Up" or "Now"
  // never takes a definition meant for another table.
  // Basket & Hedge · the basket's legs (src/desk/basket.py).
  "col-ticker": { forms: [], text: "Ticker is the symbol the stock or ETF trades under." },
  "col-name": { forms: [], text: "Name is the company or fund the ticker belongs to." },
  "col-now": { forms: [], text: "Now is each name's weight at the last close: its shares times its price, over the basket's value, so it drifts as prices move." },
  "col-since": { forms: [], text: "Since start is each name's own price change from the basket's start to the last close, on adjusted closes." },
  // desk/cap-weight, round 4: one definition, true whether the basket is weighted as typed or by market cap (the head
  // reads "Weight" or "At start"; src/desk/basket.py target weights or shares_outstanding).
  "col-weight": { forms: [], text: "Each name's weight at the start: the share you type, which must add up to 100%, or, cap-weighted, its stored share count times its close that day, over the basket's sum." },
  // Basket & Hedge · against the Nasdaq and the S&P (api/desk_basket.py, src/desk/basket.py regression).
  "col-against": { forms: [], text: "Against names the benchmark ETF the basket is measured with: QQQ for the Nasdaq 100, SPY for the S&P 500." },
  "col-beta1y": { forms: [], text: "Beta 1Y is how much the basket's daily return moves for a 1% move in the benchmark's, fitted on the last 252 daily returns both have." },
  "col-corr1y": { forms: [], text: "Corr 1Y is the correlation of the basket's and the benchmark's daily returns over the last 252 returns both have, from −1 to +1." },
  "col-beta60d": { forms: [], text: "Beta 60D is how much the basket's daily return moves for a 1% move in the benchmark's, fitted on the last 60 daily returns both have." },
  "col-corr60d": { forms: [], text: "Corr 60D is the correlation of the basket's and the benchmark's daily returns over the last 60 returns both have, from −1 to +1." },
  // Basket & Hedge · liquidity.
  "col-liq-name": { forms: [], text: "Each name in the basket, by its ticker." },
  "col-adv": { forms: [], text: "The name's average daily dollar volume, its unadjusted close times the shares traded, over the last 20 sessions." },
  // desk/cap-weight, round 4: one definition under both weightings (the head reads "At target" or "At cap weight"): a
  // cap-weighted basket is bought at the last close's market values (src/desk/basket.py `buy`).
  "col-at-target": { forms: [], text: "The dollars the name holds in the basket bought at the last close: the notional times its weight, the target you set or, cap-weighted, its share of the basket's market value there." },
  "col-days20": { forms: [], text: "How many sessions trading those dollars takes at 20% of the name's 20-day average dollar volume." },
  // Basket & Hedge · hedge with an ETF, and the stress test.
  "col-etf": { forms: [], text: "The ETF tested as the basket's hedge: SMH, SOXX, QQQ, XLK, IGV, XLU, SPY or IWM." },
  "col-r2-1y": { forms: [], text: "R² 1Y is the share of the basket's daily-return variance the ETF's daily returns explain over the last 252 returns both have, from 0 to 1." },
  "col-r2-60d": { forms: [], text: "R² 60D is the share of the basket's daily-return variance the ETF's daily returns explain over the last 60 returns both have, from 0 to 1." },
  "col-short": { forms: [], text: "Short is the dollars of the ETF to sell short: the hedge ratio times the basket's notional." },
  "col-fit": { forms: [], text: "Fit is the window the row's hedge ratio, short and volatilities come from: 1Y, the last 252 daily returns both have, or 60D, the last 60 when 1Y has no fit." },
  "col-vol-left": { forms: [], text: "Vol left is the basket's annualized volatility after the short, over the row's Fit window: the standard deviation of its daily return less the hedge ratio times the ETF's, times √252." },
  "col-vol-cut": { forms: [], text: "Vol cut is the change the short makes to the basket's annualized volatility, as a share of it: vol left over the basket's own volatility, minus one, so −44% means 44% less." },
  "col-if": { forms: [], text: "If is the move tested: QQQ or SPY falling 10%." },
  "col-st-basket": { forms: [], text: "Basket is the basket's move in that case: its beta to the benchmark times the benchmark's move." },
  "col-unhedged": { forms: [], text: "Unhedged is the basket's profit or loss without the short: its notional times its beta to the benchmark times the move." },
  "col-short-pnl": { forms: [], text: "The short's profit or loss: its dollars times the ETF's beta to the benchmark times the move, with the sign turned, as it is a short." },
  "col-hedged": { forms: [], text: "Hedged is the unhedged figure plus the short's: what the hedged basket makes or loses." },
  // Technicals · the Signals card (src/desk/technicals.py, api/desk_v2.py move_20d).
  "col-ret-1y": { forms: [], text: "1-year return is the S&P's price change from its close 252 sessions before the last one to the last close." },
  "col-trend": { forms: [], text: "Trend is where the last close sits against the 50-day and 200-day averages: above both, below both, or between them." },
  "col-last-20": { forms: [], text: "Last 20 days is the S&P's 20-session move in σ, against its 20-session moves over the last 252 sessions." },
  // Technicals · seasonality (src/analytics/technicals.py monthly_seasonality).
  "col-month": { forms: [], text: "The calendar month." },
  "col-season-avg": { forms: [], text: "Average is the mean return of that calendar month over every complete month stored." },
  "col-season-up": { forms: [], text: "Up is the share of those years in which the month's return was above zero." },
  "col-season-years": { forms: [], text: "Years is how many complete months of that calendar month are stored." },
  // Sectors (api/desk_items_etf.py).
  // Codex R-07: ranked only among the sectors with a return (api/desk_items_etf.py leadership: log_ret needs both closes).
  "col-leading": { forms: [], text: "Leading is the sector ETF with the highest 60-session log return relative to SPY's, among the sectors with a usable return, a close stored at both ends of the window." },
  "col-lagging": { forms: [], text: "Lagging is the sector ETF with the lowest 60-session log return relative to SPY's, among the sectors with a usable return, a close stored at both ends of the window." },
  "col-pattern": { forms: [], text: "Pattern says whether the six cyclical sector ETFs lead the three defensive ones over 60 sessions, or the reverse, by more than 1%." },
  "col-above-50": { forms: [], text: "How many of the 11 sector ETFs closed above their 50-day average, the mean of their last 50 closes." },
  "col-above-200": { forms: [], text: "How many of the 11 sector ETFs closed above their 200-day average, the mean of their last 200 closes." },
  "col-eqw": { forms: [], text: "RSP, the equal-weight S&P 500 ETF, against SPY: its 60-session log return less SPY's, above zero when the average stock leads." },
  // Event Study (api/desk_v2.py study answer; src/desk/event_study.py).
  "col-es-regime": { forms: [], text: "Regime is the label known when each event happened: the stored regime of the month two months before the event's month." },
  "col-es-n": { forms: [], text: "N is how many of the events fell in that regime and have a complete 20-session outcome from their entry." },
  "col-es-up": { forms: [], text: "Up is the share of those events whose target was higher 20 sessions after entry." },
  "col-es-median": { forms: [], text: "Median is the middle move of the target over the 20 sessions from each event's entry." },
  "col-es-event": { forms: [], text: "Event is the session the shock fired on." },
  "col-es-h5": { forms: [], text: "1 week is the target's move over the 5 sessions from each event's entry." },
  "col-es-h10": { forms: [], text: "2 weeks is the target's move over the 10 sessions from each event's entry." },
  "col-es-h20": { forms: [], text: "1 month is the target's move over the 20 sessions from each event's entry." },
  "col-es-h60": { forms: [], text: "3 months is the target's move over the 60 sessions from each event's entry." },
  // Codex R-04: every outcome counts from the event's entry (src/desk/event_study.py entry_delay_vec, :579-599;
  // each series' fixed and known times and gold's defer_as_target in src/desk/series.py SERIES).
  entry: { forms: [], text: "Entry is the session outcomes count from: the first whose target value is fixed no earlier than every input is known, and for a gold target the next at the earliest." },
  "entry-rule": { forms: [], text: "For an S&P target, a signal on S&P closes enters on its own session, one on FRED, VIX, dollar or gold data the next, and one on weekly WTI the eighth." },
  // Signal Ledger (api/desk_v2.py ledger rows).
  "col-signal": { forms: [], text: "Signal is the event the engine scores, by its catalog name." },
  "col-last-fired": { forms: [], text: "Last fired is the last session the signal fired on." },
  "col-times": { forms: [], text: "Times is how often the signal fired in its sample with a complete 20-session outcome from its entry." },
  "col-up-month": { forms: [], text: "Up a month later is the share of those times the target was higher 20 sessions after entry." },
  "col-median": { forms: [], text: "Median is the middle move of the target over the 20 sessions from each firing's entry." },
  "col-vs-normal": { forms: [], text: "Vs normal is that median less the median 20-session move over every evaluable session of the sample, in log returns times 100, or basis points for a yield or spread." },
  "col-verdict": { forms: [], text: "Verdict is the 20-session result by the scoring rule: Reliable, Suggestive, No edge or Too few." },
  "col-now-firing": { forms: [], text: "Now says whether the signal is firing on the last session and for how many days, is quiet, or is stale because an input is behind." },
  // Position Monitor (positions/monitor.ts, positions/store.ts).
  "col-room": { forms: [], text: "Room is how far the series is from the exit level now, as a share of that distance at entry: 100% at entry, zero at the level." },
  "col-to-level": { forms: [], text: "To level is the distance left to the exit level: a percent of the price for the S&P, basis points for 2s10s." },
  "col-falsified": { forms: [], text: "Closes in the last 90 days marked falsified, the level you named as wrong reached." },
  "col-expired": { forms: [], text: "Closes in the last 90 days marked expired, the position's horizon over." },
  "col-premortem": { forms: [], text: "Of the closes in the last 90 days whose pre-mortem you judged, how many you marked right." },
  // Macro · the correlation matrix's assets (api/desk_items_etf.py MATRIX_ASSETS; src/desk/series.py labels).
  "mx-SPY": { forms: [], text: "SPY is the S&P 500 ETF: large US companies weighted by market value." },
  "mx-QQQ": { forms: [], text: "QQQ is the Nasdaq 100 ETF: large companies listed on the Nasdaq exchange." },
  "mx-IWM": { forms: [], text: "IWM is the Russell 2000 ETF: small US companies." },
  "mx-SMH": { forms: [], text: "SMH is a semiconductor ETF: chip makers." },
  "mx-XLE": { forms: [], text: "XLE is the S&P 500's energy sector ETF." },
  "mx-TLT": { forms: [], text: "TLT is a 20+ year Treasury ETF; its price falls when long-term yields rise." },
  "mx-IEF": { forms: [], text: "IEF is a 7–10 year Treasury ETF; its price falls when those yields rise." },
  "mx-HYG": { forms: [], text: "HYG is a high-yield corporate bond ETF: bonds rated below investment grade." },
  "mx-LQD": { forms: [], text: "LQD is an investment-grade corporate bond ETF." },
  "mx-GLD": { forms: [], text: "GLD is a gold ETF; its price follows gold's." },
  "mx-UUP": { forms: [], text: "UUP is a US dollar index ETF; it rises when the dollar strengthens against major currencies." },
  "mx-^VIX": { forms: [], text: "The VIX is the 30-day volatility S&P 500 option prices imply; the matrix reads its daily log change." },
  // Regime · what each regime has meant (api/desk_items_macro.py regime_stats).
  "col-rg-regime": { forms: [], text: "Regime is the classifier's label, each one counted for the month it governed, two months after its own." },
  "col-rg-months": { forms: [], text: "Months is how many stored monthly labels the regime has." },
  "col-rg-n": { forms: [], text: "S&P n is how many of the months those labels governed have a complete S&P monthly return." },
  "col-rg-median": { forms: [], text: "S&P median is the middle S&P monthly price return over those months." },
  "col-rg-mean": { forms: [], text: "S&P mean is the average S&P monthly price return over those months." },
  "col-rg-up": { forms: [], text: "Up is the share of those months the S&P rose." },
  "col-rg-vix": { forms: [], text: "VIX avg is the average VIX close over the sessions of those months." },
  "col-rg-vix-days": { forms: [], text: "VIX days is how many sessions of those months have a stored VIX close; the cell's title gives the sessions due." },
  // Data Pipeline · the series inventory (api/desk_pipeline.py).
  "col-pl-series": { forms: [], text: "The series by name, with its provider and how often it is observed." },
  "col-pl-id": { forms: [], text: "ID is the series' code at its source: a FRED series ID or a ticker." },
  "col-pl-from": { forms: [], text: "From is the first observation stored." },
  "col-pl-asof": { forms: [], text: "As of is the newest observation stored." },
  "col-pl-feeds": { forms: [], text: "Feeds are the Desk tabs whose served values read this series." },
  "col-pl-status": { forms: [], text: "Status is current when the newest stored observation is within the series' allowed publication lag, stale when further behind, and missing when nothing is stored or its date is unknown." },
  // Codex R-06: each store's lag rule (api/desk_pipeline.py statuses; api/freshness.py assess's asset_prices verdict with
  // its 06:00 UTC grace, desk_series_states and fred_series_state with DAILY_TOLERANCE 3, DESK_SLOW_PUBLICATION's WTI 8,
  // _expected_month_for's release days in SERIES_REGISTRY).
  "col-pl-lag-close": { forms: [], text: "The newest S&P 500, Russell 2000, VIX, gold or ETF close is current if it is the last completed session's, or the one before until 2 AM ET (1 AM in winter)." },
  "col-pl-lag-daily": { forms: [], text: "Every other daily series is current within three business days of the previous business day's print, on the bond calendar for rates and spreads; weekly WTI within eight." },
  "col-pl-lag-monthly": { forms: [], text: "A monthly series is current when it holds the newest month whose usual release day has passed, such as the 15th for CPI and the first Friday for unemployment." },
};

interface Form {
  form: string;
  id: string;
}

const FORMS: readonly Form[] = Object.entries(GLOSSARY)
  .flatMap(([id, t]) => t.forms.map((form) => ({ form, id })))
  .sort((a, b) => b.form.length - a.form.length);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A form that starts or ends with a letter or digit matches only as a whole word ("IV" is not in "DIVIDEND"). */
const bounded = (f: string) => `${/^[A-Za-z0-9]/.test(f) ? "(?<![A-Za-z0-9])" : ""}${escape(f)}${/[A-Za-z0-9²]$/.test(f) ? "(?![A-Za-z0-9])" : ""}`;
const PATTERN = new RegExp(FORMS.map((f) => bounded(f.form)).join("|"), "g");
const BY_FORM = new Map(FORMS.map((f) => [f.form, f.id]));

export interface Segment {
  text: string;
  /** The glossary id when the segment is a term. */
  term?: string;
}

/**
 * A text cut at the terms it prints. Each term is marked once per text, at its
 * first occurrence: the second "σ" in one label adds nothing a reader needs.
 */
export function splitTerms(text: string, seen: Set<string> = new Set()): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const id = BY_FORM.get(m[0]);
    if (!id || seen.has(id) || m.index === undefined) continue;
    seen.add(id);
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], term: id });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function definition(id: string): string | undefined {
  return GLOSSARY[id]?.text;
}
