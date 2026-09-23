import { useEffect, useId, useRef, useState } from "react";
/**
 * Dotted-underline jargon affordance — definitions from the confusion index,
 * shown on hover/focus via the .jargon CSS (app.css). Keyboard-reachable.
 */

const DEFS: Record<string, string> = {
  regime:
    "One of four market weather patterns the classifier can call: Goldilocks (growth up, inflation calm), Overheating (growth and inflation both hot), Stagflation (inflation hot, growth stalling), Recession Risk (growth rolling over).",
  "model odds":
    "The classifier's probability for each regime; the four odds always sum to 100%.",
  conviction:
    "How firmly the model holds its top call — separate from the odds themselves. Low conviction with close odds means the read could flip on one data print.",
  "2s10s":
    "The 10-year Treasury yield minus the 2-year. Below zero (\"inverted\") has preceded most US recessions.",
  bps: "Basis points — hundredths of a percent. 100 bps = 1.00%.",
  VIX: "The market's 1-month expectation of S&P 500 volatility, from option prices. Under ~15 is calm; over 30 is stress.",
  OAS: "Option-adjusted spread — the extra yield corporate bonds pay over Treasuries. Wider spreads mean lenders see more risk.",
  "high-yield":
    "Bonds rated below investment grade (BB and lower). Their spread over Treasuries is a fast gauge of credit stress.",
  "z-score":
    "How unusual a reading is versus its own recent range, in standard deviations. ±2 is notable, ±3 is rare.",
  divergence:
    "Whether the recession model and market risk pricing agree. Aligned = they tell one story; a material divergence requires judgment about which read to weight.",
  NBER: "The National Bureau of Economic Research — the committee that dates official US recessions; the model trains on its dates.",
  "recession model":
    "A logistic regression on the yield curve, unemployment, the high-yield spread, industrial production and the 10Y − 5Y breakeven spread, trained on NBER recession dates, reading the odds of recession within 12 months.",
  breakeven:
    "The inflation rate at which nominal Treasuries and inflation-protected TIPS pay the same — the market's own inflation forecast for that horizon.",
  TIPS: "Treasury Inflation-Protected Securities — their yield is the real (after-inflation) interest rate the market charges.",
  "risk sentiment":
    "A composite of equity, credit, gold and dollar z-scores — positive reads risk-on, negative risk-off.",
  // night-2 tabs (Regime Lab, Credit, Recession, News, Tools)
  IRR: "Internal rate of return — the annualized return that makes the deal's cash flows break even. 20%+ is the classic private-equity bar.",
  MOIC: "Multiple on invested capital — exit equity divided by entry equity. 2.0× doubles the money; says nothing about how long it took (that's IRR's job).",
  "EV/EBITDA":
    "Enterprise value as a multiple of EBITDA — the price tag on the whole business per dollar of operating profit.",
  leverage:
    "Debt at entry, measured in turns of EBITDA. More leverage juices equity returns but raises the interest bill and the odds of a wipeout.",
  Sharpe:
    "Return earned above cash, per unit of volatility. Below ~0.5 the risk isn't being paid for; above 1.0 is strong. Negative means cash would have beaten it.",
  CVaR: "Conditional value-at-risk (expected shortfall) — the average loss in the worst 5% of months, not just the threshold into them.",
  percentile:
    "Where a reading sits versus its own history: the 98th percentile means it has been lower 98% of the time.",
  "hit rate":
    "Share of samples that finished positive. With small sample counts, treat it as anecdote, not law.",
  "log-odds":
    "The regression's native unit: each coefficient shifts the log of the odds of recession per one standard deviation of that input.",
  LEI: "10Y − 5Y breakeven spread: the 10-year minus the 5-year inflation breakeven (T10YIE − T5YIE). The recession model reads it in place of the Conference Board leading index (USSLIND), which stopped publishing in February 2020.",
  significance:
    "Editorial 1–5 score blending market impact, deal size, sector reach, timeliness and regime fit. 4+ is high impact.",
  cohort:
    "A bucket of historical months sharing one condition — a signal being triggered, or the market sitting in one regime.",
  tenor: "A maturity point on the yield curve — the 2Y and 10Y are the stored tenors.",
  IG: "Investment grade: bonds rated BBB− or better. Their spread is the calm end of the credit market.",
  Tight:
    "IG spreads above 150 bps: financing strain. The name means tight financing conditions, not tight spreads; it is a worse state than Normal, with high yield still at or under 400 bps.",
  drawdown:
    "Peak-to-trough loss. A −50% drawdown needs a +100% recovery to get back to even.",
  "efficient frontier":
    "The curve of portfolios offering the highest expected return at each level of risk; anything below the curve is leaving return on the table.",
  "transition matrix":
    "Historical odds of moving from one state to another over a fixed horizon, counted from the stored monthly history.",
  "risk parity":
    "Weights sized so each asset contributes equal risk; bonds get more capital than stocks because they move less.",
  "Black-Litterman":
    "Starts from market-cap weights as the neutral view, then tilts toward the regime's historical returns.",
  distress:
    "CCC-rated spreads at 1,000 bps or wider: the market pricing meaningful default risk in the weakest credits.",
  HRP: "Hierarchical risk parity: clusters assets by how they move together, then budgets risk down the tree. No return forecasts involved.",
  HERC: "Hierarchical equal risk contribution: HRP's cousin, equalizing risk within and across the clusters.",
  "R²": "Share of the portfolio's monthly variation the factors explain. 0.3 means 30%; the rest is asset-specific.",
  alpha: "Annualized return left over after the factor exposures are paid: the part the factors can't explain.",
};

/** `def` supplies a definition the table does not carry (the Desk's query
 * sentence moves its helper text here); without it the table decides. */
export default function Jargon({ term, children, def: own }: { term: keyof typeof DEFS | string; children?: React.ReactNode; def?: string }) {
  const def = own ?? DEFS[term];
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // Escape dismisses without moving focus (WCAG 1.4.13: dismissible).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!def) return <>{children ?? term}</>;

  const show = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  // A short grace lets the pointer travel onto the tooltip (hoverable) —
  // the definition stays while the pointer is on either element (persistent).
  const hide = () => {
    if (pinned) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <span className="jargon-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <span
        className="jargon"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={() => {
          setPinned(false);
          hide();
        }}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const next = !pinned;
            setPinned(next);
            setOpen(next);
          }
        }}
      >
        {children ?? term}
      </span>
      <span id={id} role="tooltip" className="jargon-tip" hidden={!open} onMouseEnter={show} onMouseLeave={hide}>
        {def}
      </span>
    </span>
  );
}
