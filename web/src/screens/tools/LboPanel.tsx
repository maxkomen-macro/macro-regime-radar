/**
 * LBO Calculator body (redesign Phase 9, checklist 09 B.4 to B.8): the
 * `400px | 1fr` grid under the hero row. Left, `#lbo-assumptions`: the live
 * financing-rate tile with its switch, the nine sliders in three groups and
 * the assumption warnings. Right, the results stack: `#lbo-outputs` (four
 * tiles), `#lbo-schedule` | `#lbo-sensitivity` side by side, then the
 * market-check caption. The hero, summary and disclosure line above and
 * below this body are the screen's (LboHeroRow, ToolsScreen).
 *
 * All deal math runs server-side in src/analytics/lbo.py via POST /api/lbo/run
 * (300 ms debounce, in `useLboDeal`). Every number here is served or the
 * display arithmetic the checklist names on served rows (the schedule's
 * Paydown and Leverage columns, the debt-at-exit ratio); IRR is never
 * re-derived. The financing rate defaults to the live all-in cost (Fed Funds +
 * HY OAS) whose sole owner is Credit → Financing conditions.
 */

import { Link } from "react-router-dom";
import { Card, DataTable, HeatMatrix, SectionHeader, StatTile, Tag } from "../../components";
import type { DataTableColumn } from "../../components/data/DataTable";
import type { HeatCell } from "../../components/data/HeatMatrix";
import ScrollTable from "../shared/ScrollTable";
import type { LboRequest, LboSensitivity } from "../../api/types";
import { ApiError } from "../../api/client";
import Jargon from "../shared/Jargon";
import { fmtDate, tidyProse } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Caption, SliderRow, StateNote, capStyle, eyebrowStyle, fmtMillions } from "../shared/screen-ui";
import { FALLBACK_RATE, SLIDERS, useLboDeal, type LboDeal, type SliderGroup } from "./lbo-deal";

/** The null-value glyph the tiles and the schedule print (U+2014), never an em-dash aside. */
const DASH = "—";

// Meaning ramp, not brand: green ≥20% · amber 15–20% · orange below (the
// LboPanel.tsx:38-43 bands, ported to the Phase 1 tokens). The accent must
// never grade good/bad (One Accent Rule; critique).
function irrColor(irr: number | null, viable: boolean): string {
  if (!viable || irr == null) return "var(--neg)";
  if (irr >= 20) return "var(--pos)";
  if (irr >= 15) return "var(--amber)";
  return "var(--warn-hot)";
}

/** Result-column state before or instead of a result (2026-09-06). A cold
 * load is "calculating", never "nothing on file": the query is pending until
 * the debounced inputs settle and the first run answers. Errors say which
 * kind — the calculator engine missing on the server, the service asleep,
 * or a rejected request. */
export function LboRunState({ pending, fetching, error }: { pending: boolean; fetching: boolean; error: unknown }) {
  if (error) {
    const e = error instanceof ApiError ? error : null;
    const text =
      e?.status === 503
        ? "The deal model is unavailable on this server (calculator engine not installed)."
        : e?.status === 422
          ? `The service rejected these inputs: ${e.message}`
          : e?.status === 0
            ? "The data service did not answer; the deal model will rerun when it returns."
            : "Unavailable: the data service did not answer.";
    return (
      <div role="status" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn-hot)" }}>
        {text}
      </div>
    );
  }
  if (pending || fetching) {
    return (
      <div role="status" aria-live="polite" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
        Calculating the deal model…
      </div>
    );
  }
  return <StateNote>Awaiting inputs.</StateNote>;
}

const GROUPS: SliderGroup[] = ["Business", "Entry & exit", "Financing"];

/** The schedule's eight columns (B.6): the six served ones keep today's labels
 * and order; Paydown and Leverage are display arithmetic on the served row. */
const SCHEDULE_COLUMNS: DataTableColumn[] = [
  { key: "year", label: "Year", mono: true },
  { key: "ebitda", label: "EBITDA", align: "right", mono: true },
  { key: "implied_ev", label: "Implied EV", align: "right", mono: true },
  { key: "debt_start", label: "Debt start", align: "right", mono: true },
  { key: "interest", label: "Interest", align: "right", mono: true },
  { key: "paydown", label: "Paydown", align: "right", mono: true },
  { key: "debt_end", label: "Debt end", align: "right", mono: true },
  { key: "leverage", label: "Leverage", align: "right", mono: true },
];

const swatchStyle = (background: string): React.CSSProperties => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: 2,
  marginRight: 6,
  verticalAlign: -1,
  background,
});

/** The mockup legend row (tools.html:216), rendered under the IRR grid. */
const IRR_LEGEND = (
  <>
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <i aria-hidden="true" style={swatchStyle("rgba(38,220,160,.35)")} />
      20% or more
    </span>
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <i aria-hidden="true" style={swatchStyle("rgba(240,80,63,.25)")} />
      Below 15%
    </span>
    <span style={{ marginLeft: "auto" }}>Exit multiple →</span>
  </>
);

/** Index of the served centre in a multiples axis, matched within 1e-9 (the
 * audit rule: never re-round client-side, Python rounds halves to even). */
function centerIndex(axis: number[], center: number): number {
  return axis.findIndex((v) => Math.abs(v - center) < 1e-9);
}

function irrCells(sens: LboSensitivity): HeatCell[][] {
  return sens.entry_multiples.map((_, ri) =>
    sens.exit_multiples.map((_, ci) => {
      const irr = sens.irr_grid[ri]?.[ci] ?? null;
      return { value: irr, text: irr == null ? "n/a" : `${irr.toFixed(1)}%` };
    }),
  );
}

/** `deal` (Phase 9 seam): the screen's deal object; absent → the panel owns its own (the existing test mounts it prop-less). */
export default function LboPanel({ deal }: { deal?: LboDeal } = {}) {
  const own = useLboDeal(deal == null);
  const d = deal ?? own;
  const { isNarrow } = useBreakpoint();
  const { defaults, liveRate, clampedLive, inputs, modified, manualRate, run, res, baseRes, sens, warnings } = d;

  if (defaults.isLoading || inputs == null) {
    return (
      <Card>
        <StateNote loading={defaults.isLoading} error={defaults.isError} />
      </Card>
    );
  }

  // The default deal at the live rate: every row's baseline (its tick and its
  // changed state) reads from here; the rate row's is the clamped live rate,
  // or the stated 8.50% fallback when no live rate is on file.
  const baseInputs: LboRequest = d.baseInputs;
  const backToLive = () => d.set({ interest_rate: clampedLive ?? FALLBACK_RATE });
  const storedThrough =
    defaults.data?.data_as_of && defaults.data.data_as_of !== "unavailable" ? fmtDate(defaults.data.data_as_of) : DASH;

  const rateNote = manualRate ? (
    <>
      manual rate ·{" "}
      <button
        type="button"
        className="mrr-link"
        onClick={backToLive}
        style={{
          appearance: "none",
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: "var(--fs-meta)",
          whiteSpace: "normal",
          gap: 4,
        }}
      >
        ↻ back to live {clampedLive?.toFixed(2)}%
        {liveRate != null && clampedLive != null && Math.abs(liveRate - clampedLive) > 0.01
          ? ` (true rate ${liveRate.toFixed(2)}% exceeds the model range)`
          : ""}
      </button>
    </>
  ) : clampedLive != null ? (
    "tracking the live all-in cost"
  ) : (
    "live rate unavailable: stated 8.50% default in use"
  );

  const resetButton = (
    <button
      type="button"
      className="mrr-btn"
      data-touch={isNarrow ? "true" : "false"}
      onClick={d.reset}
      disabled={!modified}
      title={modified ? "Return every assumption to the default deal at the live rate" : "Assumptions already match the defaults"}
    >
      Reset to defaults
    </button>
  );

  // Outputs header meta (B.5): the base case beside a modified, viable deal.
  const baseMeta =
    modified && baseRes?.viable ? (
      <>
        base case: IRR {baseRes.irr != null ? `${baseRes.irr.toFixed(1)}%` : "n/a"} · MOIC{" "}
        {baseRes.moic != null ? `${baseRes.moic.toFixed(2)}×` : DASH}
        {res?.viable && res.irr != null && baseRes.irr != null
          ? ` · Δ IRR ${res.irr - baseRes.irr >= 0 ? "+" : ""}${(res.irr - baseRes.irr).toFixed(1)} pp`
          : ""}
      </>
    ) : undefined;

  const lastYear = res?.viable && res.schedule.length > 0 ? res.schedule[res.schedule.length - 1] : null;
  const exitDebt = res?.exit_debt ?? null;
  const exitLeverage = exitDebt != null && lastYear != null && lastYear.ebitda > 0 ? exitDebt / lastYear.ebitda : null;

  const ri = sens ? centerIndex(sens.entry_multiples, sens.entry_center) : -1;
  const ci = sens ? centerIndex(sens.exit_multiples, sens.exit_center) : -1;
  const currentCell: [number, number] | undefined = ri >= 0 && ci >= 0 ? [ri, ci] : undefined;

  return (
    <div className="mrr-tools-lbo">
      {/* ── Assumptions ─────────────────────────────────────────────────── */}
      <Card as="section" id="lbo-assumptions" variant="panel" style={{ minWidth: 0 }}>
        <SectionHeader layout="panel" title="Assumptions" actions={resetButton} />

        <Card
          variant="tile"
          padding="12px 16px"
          style={{
            borderColor: "var(--mint-a32)",
            background: "linear-gradient(90deg, rgba(38,220,160,.08), rgba(38,220,160,.02))",
            display: "flex",
            alignItems: "center",
            gap: 14,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={eyebrowStyle}>Live financing rate</div>
            <div className="num" style={{ fontFamily: "var(--font-ui)", fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums", lineHeight: 1.15, marginTop: 2 }}>
              {defaults.data ? `${defaults.data.lbo_all_in_rate.toFixed(2)}%` : DASH}
            </div>
          </div>
          <div style={{ ...capStyle, marginTop: 0, maxWidth: "none", marginLeft: "auto", textAlign: "right", whiteSpace: "nowrap" }}>
            Fed funds {defaults.data ? `${defaults.data.fedfunds.toFixed(2)}%` : DASH}
            <br />+ HY OAS {defaults.data ? `${defaults.data.hy_oas_pct.toFixed(2)}%` : DASH}
          </div>
          {/* Checked = the deal's rate equals the clamped live rate (G9): a rate
              moved away reads unchecked, and the click is the T11 "back to
              live" action; clicking while checked changes nothing. */}
          <button
            type="button"
            role="switch"
            className="mrr-switch"
            aria-checked={clampedLive != null && !manualRate}
            aria-label="Track the live financing rate"
            disabled={clampedLive == null}
            onClick={() => {
              if (manualRate && clampedLive != null) backToLive();
            }}
          >
            <i aria-hidden="true" />
          </button>
        </Card>
        <Caption>
          Fed Funds {defaults.data ? defaults.data.fedfunds.toFixed(2) : DASH}% + HY spread{" "}
          {defaults.data ? defaults.data.hy_oas_pct.toFixed(2) : DASH}pp, stored through {storedThrough} ·{" "}
          <Link to="/app/credit#financing" className="mrr-link">
            full financing picture lives in Credit
          </Link>
        </Caption>

        {GROUPS.map((group, gi) => (
          <div key={group}>
            <div style={{ ...eyebrowStyle, fontSize: "var(--fs-micro)", color: "var(--text-3)", margin: gi === 0 ? "12px 0 6px" : "8px 0 6px" }}>{group}</div>
            {SLIDERS.filter((s) => s.group === group).map((s) => (
              <SliderRow
                key={s.key}
                label={s.jargon ? <Jargon term={s.jargon}>{s.label}</Jargon> : s.label}
                name={s.jargon ? s.label : undefined}
                valueText={s.valueText(inputs[s.key])}
                // The range tops out at $1,000M; a larger typed EBITDA keeps its
                // value in the field and the thumb pinned to the right end.
                value={s.key === "ebitda" ? Math.min(inputs.ebitda, s.max) : inputs[s.key]}
                min={s.min}
                max={s.max}
                step={s.step}
                input={{ unit: s.unit, dp: s.dp }}
                onChange={(v) => d.set({ [s.key]: v } as Partial<LboRequest>)}
                baseline={baseInputs[s.key]}
                format={s.format}
                note={s.key === "interest_rate" ? rateNote : undefined}
              />
            ))}
          </div>
        ))}

        {warnings.length ? (
          <div role="status" aria-live="polite" style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {warnings.map((w) => (
              <div key={w} style={{ ...capStyle, marginTop: 0, color: "var(--amber)" }}>
                ▪ {w}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {/* minWidth:0 — the stack is a grid item; without it the schedule's
          min-content would propagate up and drag the page sideways. */}
      <div style={{ display: "grid", gap: "var(--gap-panel)", minWidth: 0 }}>
        <Card as="section" id="lbo-outputs" variant="panel" style={{ minWidth: 0 }}>
          <SectionHeader
            layout="panel"
            title="Outputs"
            description={modified ? "Modified deal" : "Default deal at the live rate"}
            right={baseMeta}
            actions={
              <Tag tone={modified ? "watch" : "clear"} size="sm">
                {modified ? "Modified" : "Default"}
              </Tag>
            }
          />
          {res ? (
            res.viable ? (
              <>
                <div className="mrr-tools-outputs">
                  <Card variant="tile" style={{ minWidth: 0 }}>
                    <StatTile
                      size="lg"
                      label="IRR"
                      value={<span style={{ color: irrColor(res.irr, true) }}>{res.irr != null ? `${res.irr.toFixed(1)}%` : "n/a"}</span>}
                    />
                    <Caption>Annualized, {inputs.hold_period} years</Caption>
                  </Card>
                  <Card variant="tile" style={{ minWidth: 0 }}>
                    <StatTile size="lg" label="MOIC" value={res.moic != null ? `${res.moic.toFixed(2)}×` : DASH} />
                    <Caption>Exit equity ÷ entry equity</Caption>
                  </Card>
                  <Card variant="tile" style={{ minWidth: 0 }}>
                    <StatTile
                      size="md"
                      label="Equity gain"
                      value={
                        res.equity_gain != null ? (
                          <span style={{ color: res.equity_gain >= 0 ? "var(--pos)" : "var(--neg)" }}>
                            {res.equity_gain >= 0 ? "+" : "−"}
                            {fmtMillions(Math.abs(res.equity_gain))}
                          </span>
                        ) : (
                          DASH
                        )
                      }
                    />
                    <Caption>On {fmtMillions(res.entry_equity)} invested</Caption>
                  </Card>
                  <Card variant="tile" style={{ minWidth: 0 }}>
                    <StatTile size="md" label="Debt at exit" value={exitDebt != null ? fmtMillions(exitDebt) : DASH} />
                    <Caption>
                      {exitLeverage != null ? `${exitLeverage.toFixed(1)}× EBITDA, from ${inputs.leverage_ratio.toFixed(1)}×` : `From ${inputs.leverage_ratio.toFixed(1)}× at entry`}
                    </Caption>
                  </Card>
                </div>
                <Caption>
                  The deal returns {res.irr?.toFixed(1)}% a year (<Jargon term="IRR">IRR</Jargon>)
                  and {res.moic?.toFixed(2)}× invested equity (<Jargon term="MOIC">MOIC</Jargon>).
                  Sources cover uses: {fmtMillions(res.entry_ev)} purchase price plus{" "}
                  {fmtMillions(Math.max(res.entry_equity + res.entry_debt - res.entry_ev, 0))} of
                  fees, less {fmtMillions(res.entry_debt)} of debt, is{" "}
                  {fmtMillions(res.entry_equity)} of equity in;{" "}
                  {fmtMillions(res.exit_equity ?? 0)} comes out after {inputs.hold_period} years.
                  Fees add to the check, so raising them costs returns, as they should.
                </Caption>
              </>
            ) : (
              <Card variant="tile" tone="risk" style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--neg)" }}>
                  Deal not viable: {tidyProse(res.error_msg)}
                </div>
                <Caption>
                  Entry EV {fmtMillions(res.entry_ev)} against {fmtMillions(res.entry_debt)} of debt
                  leaves {fmtMillions(res.entry_equity)} of equity. Ease leverage or the entry
                  multiple until the equity check turns positive.
                </Caption>
              </Card>
            )
          ) : (
            <LboRunState pending={run.isPending} fetching={run.isFetching} error={run.error} />
          )}
        </Card>

        {lastYear || sens ? (
          <div className="mrr-tools-pair">
            {res?.viable && res.schedule.length > 0 && (
              /* The pair is itself a grid, so its track would still be floored
                 by this card's min-content (the wide table) — the card has to
                 be allowed to shrink too, or the scroll well never engages. */
              <Card as="section" id="lbo-schedule" variant="panel" style={{ minWidth: 0 }}>
                <SectionHeader layout="panel" title="Annual debt schedule" description="$ millions" />
                {/* Eight nowrap numeric columns can't compress into a half-width
                    panel — the schedule scrolls inside its own well rather than
                    dragging the page sideways. */}
                <ScrollTable label="Annual debt schedule">
                  <DataTable
                    compact
                    zebra={false}
                    caption="Annual debt schedule in $ millions"
                    columns={SCHEDULE_COLUMNS}
                    rows={[
                      // Year 0 (the mockup's "Close" row): the request's EBITDA,
                      // the served entry debt and the request's leverage; the
                      // flow columns have nothing to print yet.
                      {
                        id: "close",
                        year: "Close",
                        ebitda: inputs.ebitda.toFixed(1),
                        implied_ev: DASH,
                        debt_start: DASH,
                        interest: DASH,
                        paydown: DASH,
                        debt_end: res.entry_debt.toFixed(1),
                        leverage: `${inputs.leverage_ratio.toFixed(1)}×`,
                      },
                      ...res.schedule.map((y) => ({
                        id: String(y.year),
                        year: y.year === res.schedule.length ? `${y.year} · exit` : String(y.year),
                        ebitda: y.ebitda.toFixed(1),
                        implied_ev: y.implied_ev.toFixed(1),
                        debt_start: y.debt_start.toFixed(1),
                        interest: y.interest.toFixed(1),
                        // Principal repaid this year: the amortization floor plus the cash sweep (lbo.py run_lbo_model, B1); negative when unpaid interest is added to the debt.
                        paydown: (y.debt_start - y.debt_end).toFixed(1),
                        debt_end: y.debt_end.toFixed(1),
                        leverage: y.ebitda > 0 ? `${(y.debt_end / y.ebitda).toFixed(1)}×` : DASH,
                      })),
                    ]}
                  />
                </ScrollTable>
                <Caption>
                  Cash for debt service is 60% of EBITDA. It pays interest first; scheduled amortization
                  of {inputs.amortization_rate.toFixed(0)}% of the original debt a year is a floor, and the
                  remainder sweeps to debt, so a higher rate leaves more debt at exit. EBITDA compounds
                  at {inputs.ebitda_growth_rate.toFixed(1)}% while the multiple re-rates at exit.
                </Caption>
              </Card>
            )}

            {sens && (
              <Card as="section" id="lbo-sensitivity" variant="panel" style={{ minWidth: 0 }}>
                <SectionHeader layout="panel" title="IRR sensitivity" right="entry × exit multiple" />
                {/* A 6-track numeric grid can't compress to a phone card; it
                    scrolls in its own well. */}
                <ScrollTable stickyFirst={false} label="IRR sensitivity grid">
                  <HeatMatrix
                    preset="irr"
                    ariaLabel="IRR sensitivity: entry vs exit multiple"
                    corner="Entry ↓"
                    rows={sens.entry_multiples.map((em) => ({ key: String(em), label: `${em.toFixed(1)}×` }))}
                    cols={sens.exit_multiples.map((xm) => ({ key: String(xm), label: `${xm.toFixed(1)}×` }))}
                    cells={irrCells(sens)}
                    currentCell={currentCell}
                    legend={IRR_LEGEND}
                    style={{ minWidth: isNarrow ? 380 : undefined }}
                  />
                </ScrollTable>
                <Caption>
                  Every cell reruns the full model at that entry/exit pair, everything else held. Green
                  cells clear 20% IRR (the classic PE bar); amber clears 15%; n/a means the deal goes
                  underwater. The outlined cell is the current scenario.
                </Caption>
              </Card>
            )}
          </div>
        ) : null}

        {res?.viable && (
          <Caption>
            One check on the market: this deal borrows at {inputs.interest_rate.toFixed(2)}%
            {defaults.data && !manualRate ? ", today's live all-in cost" : ""}. Pre-GFC deals
            financed near ~7%; if the rate slider has to fall below reality to make the returns
            work, the market is telling you the price is wrong.
          </Caption>
        )}
      </div>
    </div>
  );
}
