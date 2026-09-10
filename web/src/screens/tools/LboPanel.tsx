/**
 * LBO Calculator — nine deal inputs on the left, results on the right:
 * returns banner (IRR / MOIC / equity gain, confusion #10 captions), annual
 * debt schedule, and the 5×5 entry-vs-exit IRR sensitivity grid.
 *
 * All deal math runs server-side in src/analytics/lbo.py via POST /api/lbo/run
 * (~120ms debounce). The financing rate defaults to the live all-in cost
 * (Fed Funds + HY OAS) whose sole owner is Credit → Financing conditions.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable } from "../../components";
import ScrollTable from "../shared/ScrollTable";
import DeskRead, { type LedgerItem } from "../shared/DeskRead";
import { assessFreshness } from "../shared/freshness";
import { useLboDefaults, useLboRun } from "../../api/queries";
import type { LboRequest } from "../../api/types";
import { ApiError } from "../../api/client";
import Jargon from "../shared/Jargon";
import { fmtDate } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Caption, SliderRow, StateNote, eyebrowStyle, fmtMillions, mono, useDebounced } from "../shared/screen-ui";

const BASE_INPUTS: Omit<LboRequest, "interest_rate"> = {
  ebitda: 100,
  ebitda_growth_rate: 5,
  entry_multiple: 8,
  exit_multiple: 9,
  hold_period: 5,
  leverage_ratio: 4.5,
  amortization_rate: 5,
  mgmt_fee_pct: 1.5,
};

// Meaning ramp, not brand: green ≥20% · amber 15–20% · orange below. The
// accent must never grade good/bad (One Accent Rule; critique).
function irrColor(irr: number | null, viable: boolean): string {
  if (!viable || irr == null) return "var(--neg-text)";
  if (irr >= 20) return "var(--pos)";
  if (irr >= 15) return "var(--warn)";
  return "var(--warn-hot)";
}

function cellBg(irr: number | null): string {
  if (irr == null) return "rgba(139,148,158,.10)";
  if (irr >= 20) return "rgba(46,204,113,.15)";
  if (irr >= 15) return "rgba(210,153,34,.12)";
  return "rgba(230,126,34,.10)";
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

export default function LboPanel() {
  const { isMobile, isNarrow } = useBreakpoint();
  const defaults = useLboDefaults();
  const liveRate = defaults.data?.lbo_all_in_rate ?? null;
  // Compare against the value the slider can actually hold — a live rate
  // outside [3,20] would otherwise leave "manual mode" stuck on (audit).
  const clampedLive = liveRate != null ? Math.min(20, Math.max(3, liveRate)) : null;

  const [overrides, setOverrides] = useState<Partial<LboRequest>>({});
  const inputs = useMemo<LboRequest | null>(() => {
    if (defaults.isLoading) return null; // brief; then live rate or stated fallback
    return {
      ...BASE_INPUTS,
      // The calculator must not be stranded by a failed rate lookup — fall
      // back to a stated default and say so under the slider (audit).
      interest_rate: clampedLive ?? 8.5,
      ...overrides,
    };
  }, [defaults.isLoading, clampedLive, overrides]);

  const debounced = useDebounced(inputs, 300);
  const run = useLboRun(debounced);
  const res = run.data?.result;
  const sens = run.data?.sensitivity;

  // Base case: the same defaults with the live rate, run once so a modified
  // deal can be read against it (executive pass, 2026-09-05).
  const baseInputs = useMemo<LboRequest | null>(
    () => (defaults.isLoading ? null : { ...BASE_INPUTS, interest_rate: clampedLive ?? 8.5 }),
    [defaults.isLoading, clampedLive],
  );
  const modified = Object.keys(overrides).length > 0;
  const base = useLboRun(modified ? baseInputs : null);
  const baseRes = base.data?.result;

  const manualRate =
    inputs != null && clampedLive != null && Math.abs(inputs.interest_rate - clampedLive) > 0.1;

  const set = (patch: Partial<LboRequest>) => setOverrides((o) => ({ ...o, ...patch }));

  // Client-side sanity checks on assumption combinations; the server still
  // decides viability, these just say why a result will not clear.
  const warnings: string[] = [];
  if (inputs) {
    if (inputs.leverage_ratio >= inputs.entry_multiple)
      warnings.push(
        `Leverage ${inputs.leverage_ratio.toFixed(2)}× meets or exceeds the ${inputs.entry_multiple.toFixed(2)}× entry multiple: debt covers the whole purchase price and the equity check goes to zero or below.`,
      );
    if (inputs.amortization_rate * inputs.hold_period > 100)
      warnings.push(
        `Amortizing ${inputs.amortization_rate.toFixed(0)}%/yr over ${inputs.hold_period} years retires more than 100% of the original debt; the schedule floors at zero.`,
      );
    if (inputs.exit_multiple > inputs.entry_multiple + 4)
      warnings.push(
        `Exit multiple sits ${(inputs.exit_multiple - inputs.entry_multiple).toFixed(2)}× above entry: most of the return is multiple expansion, not operating performance.`,
      );
  }

  if (!inputs) {
    return (
      <Card>
        <StateNote loading={defaults.isLoading} error={defaults.isError} />
      </Card>
    );
  }

  const lboLedger: LedgerItem[] = [
    { label: "Financing", value: `${inputs.interest_rate.toFixed(2)}% all-in${manualRate ? " (manual)" : clampedLive != null ? " (live: Fed Funds + HY spread)" : " (stated default)"}` },
    { label: "Structure", value: `${inputs.entry_multiple.toFixed(2)}× entry · ${inputs.exit_multiple.toFixed(2)}× exit · ${inputs.leverage_ratio.toFixed(2)}× debt · ${inputs.hold_period} yr hold` },
    ...(res?.viable
      ? [{ label: "Equity check", value: `${fmtMillions(res.entry_equity)} in · ${fmtMillions(res.exit_equity ?? 0)} out` }]
      : []),
    ...(modified && baseRes?.viable && res?.viable && res.irr != null && baseRes.irr != null
      ? [{ label: "Vs base case", value: `${res.irr - baseRes.irr >= 0 ? "+" : ""}${(res.irr - baseRes.irr).toFixed(1)} pp IRR against ${baseRes.irr.toFixed(1)}%`, tone: res.irr >= baseRes.irr ? "var(--pos)" : "var(--neg-text)" }]
      : []),
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
    <DeskRead
      eyebrow="Desk read · LBO calculator"
      badge={
        res?.viable && res.irr != null ? (
          <span style={{ ...mono, fontSize: "var(--fs-meta)", color: irrColor(res.irr, true) }}>
            {res.irr >= 20 ? "Clears the 20% PE bar" : res.irr >= 15 ? "Below the 20% bar · above 15%" : "Below 15%"}
          </span>
        ) : null
      }
      conclusion={
        res
          ? res.viable
            ? `At ${inputs.interest_rate.toFixed(2)}% all-in, ${modified ? "this deal" : "the default deal"} returns ${
                res.irr != null ? `${res.irr.toFixed(1)}% IRR` : "no IRR"
              } and ${res.moic != null ? `${res.moic.toFixed(2)}× MOIC` : "—"} over ${inputs.hold_period} years.`
            : `At ${inputs.leverage_ratio.toFixed(2)}× leverage on an ${inputs.entry_multiple.toFixed(2)}× entry the equity check turns negative: the deal is not viable.`
          : "Running the deal model…"
      }
      why="Every assumption can be typed exactly or dragged; the schedule and the entry × exit sensitivity grid rerun on each change. The classic private-equity hurdle is 20% IRR; green cells in the grid clear it."
      ledger={lboLedger}
      freshness={[
        { noun: "Financing rate", info: assessFreshness(defaults.data?.data_as_of && defaults.data.data_as_of !== "unavailable" ? defaults.data.data_as_of : null, "monthly") },
      ]}
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,2fr) minmax(0,3fr)",
        gap: 12,
        alignItems: "start",
      }}
    >
      {/* ── Inputs ────────────────────────────────────────────────────── */}
      {/* minWidth:0 — Tools' sections are plain blocks, so the global
          `main section { min-width: 0 }` rule never reaches these columns.
          Without it a grid item keeps its content-based automatic minimum and
          overflows its own track. No-op wherever the track is already wider. */}
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <Card accentBar>
          <div style={eyebrowStyle}>Live financing rate</div>
          <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, marginTop: 6 }}>
            {defaults.data ? `${defaults.data.lbo_all_in_rate.toFixed(2)}%` : "—"}
          </div>
          <Caption>
            Fed Funds {defaults.data?.fedfunds.toFixed(2)}% + HY spread{" "}
            {defaults.data?.hy_oas_pct.toFixed(2)}pp, stored through{" "}
            {defaults.data?.data_as_of && defaults.data.data_as_of !== "unavailable"
              ? fmtDate(defaults.data.data_as_of)
              : "—"}{" "}
            ·{" "}
            <Link to="/app/credit" style={{ color: "var(--accent)" }}>
              full financing picture lives in Credit
            </Link>
          </Caption>
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <div style={eyebrowStyle}>Assumptions</div>
            <button
              type="button"
              className="mrr-btn"
              data-touch={isNarrow ? "true" : "false"}
              onClick={() => setOverrides({})}
              disabled={!modified}
              title={modified ? "Return every assumption to the default deal at the live rate" : "Assumptions already match the defaults"}
            >
              ↻ Reset to defaults
            </button>
          </div>

          <div style={{ ...eyebrowStyle, fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginBottom: 6 }}>Business</div>
          <SliderRow
            label="Entry EBITDA"
            valueText={fmtMillions(inputs.ebitda)}
            value={Math.min(inputs.ebitda, 1000)}
            min={10}
            max={1000}
            step={10}
            input={{ unit: "$M", dp: 0 }}
            onChange={(v) => set({ ebitda: v })}
          />
          <SliderRow
            label="EBITDA growth"
            valueText={`${inputs.ebitda_growth_rate.toFixed(1)}%/yr`}
            value={inputs.ebitda_growth_rate}
            min={-10}
            max={30}
            step={0.5}
            input={{ unit: "%/yr", dp: 1 }}
            onChange={(v) => set({ ebitda_growth_rate: v })}
          />

          <div style={{ ...eyebrowStyle, fontSize: "var(--fs-micro)", color: "var(--text-muted)", margin: "8px 0 6px" }}>Entry & exit</div>
          <SliderRow
            label={<Jargon term="EV/EBITDA">Entry multiple</Jargon>}
            name="Entry multiple"
            valueText={`${inputs.entry_multiple.toFixed(2)}×`}
            value={inputs.entry_multiple}
            min={3}
            max={20}
            step={0.25}
            input={{ unit: "×", dp: 2 }}
            onChange={(v) => set({ entry_multiple: v })}
          />
          <SliderRow
            label={<Jargon term="EV/EBITDA">Exit multiple</Jargon>}
            name="Exit multiple"
            valueText={`${inputs.exit_multiple.toFixed(2)}×`}
            value={inputs.exit_multiple}
            min={3}
            max={20}
            step={0.25}
            input={{ unit: "×", dp: 2 }}
            onChange={(v) => set({ exit_multiple: v })}
          />
          <SliderRow
            label="Hold period"
            valueText={`${inputs.hold_period} yr`}
            value={inputs.hold_period}
            min={1}
            max={10}
            step={1}
            input={{ unit: "yr", dp: 0 }}
            onChange={(v) => set({ hold_period: v })}
          />
          <SliderRow
            label="Transaction fees"
            valueText={`${inputs.mgmt_fee_pct.toFixed(2)}% of EV`}
            value={inputs.mgmt_fee_pct}
            min={0}
            max={5}
            step={0.25}
            input={{ unit: "% EV", dp: 2 }}
            onChange={(v) => set({ mgmt_fee_pct: v })}
          />

          <div style={{ ...eyebrowStyle, fontSize: "var(--fs-micro)", color: "var(--text-muted)", margin: "8px 0 6px" }}>Financing</div>
          <SliderRow
            label={<Jargon term="leverage">Leverage · Debt/EBITDA</Jargon>}
            name="Leverage · Debt/EBITDA"
            valueText={`${inputs.leverage_ratio.toFixed(2)}×`}
            value={inputs.leverage_ratio}
            min={0.5}
            max={8}
            step={0.25}
            input={{ unit: "×", dp: 2 }}
            onChange={(v) => set({ leverage_ratio: v })}
          />
          <SliderRow
            label="Interest rate (all-in)"
            valueText={`${inputs.interest_rate.toFixed(2)}%`}
            value={inputs.interest_rate}
            min={3}
            max={20}
            step={0.25}
            input={{ unit: "%", dp: 2 }}
            onChange={(v) => set({ interest_rate: v })}
            note={
              manualRate ? (
                <>
                  manual rate ·{" "}
                  <button
                    onClick={() => set({ interest_rate: clampedLive ?? 8.5 })}
                    style={{
                      appearance: "none",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      ...mono,
                      fontSize: "var(--fs-meta)",
                      color: "var(--accent)",
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
              )
            }
          />
          <SliderRow
            label="Debt amortization"
            valueText={`${inputs.amortization_rate.toFixed(0)}%/yr`}
            value={inputs.amortization_rate}
            min={0}
            max={20}
            step={1}
            input={{ unit: "%/yr", dp: 0 }}
            onChange={(v) => set({ amortization_rate: v })}
          />
          {warnings.length ? (
            <div role="status" style={{ marginTop: 8, display: "grid", gap: 4 }}>
              {warnings.map((w) => (
                <div key={w} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn)", lineHeight: 1.5 }}>
                  ▪ {w}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      {/* ── Results ───────────────────────────────────────────────────── */}
      {/* Same lever, and this is the column that measured 497px at 375: the
          schedule table's min-content was propagating up through the banner
          Card and dragging the page sideways. */}
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <Card tone={res && !res.viable ? "risk" : "default"}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8, flexWrap: "wrap" }}>
            <div style={eyebrowStyle}>Outputs · {modified ? "modified deal" : "default deal at the live rate"}</div>
            {modified && baseRes?.viable ? (
              <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                base case: IRR {baseRes.irr != null ? `${baseRes.irr.toFixed(1)}%` : "n/a"} · MOIC{" "}
                {baseRes.moic != null ? `${baseRes.moic.toFixed(2)}×` : "—"}
                {res?.viable && res.irr != null && baseRes.irr != null
                  ? ` · Δ IRR ${res.irr - baseRes.irr >= 0 ? "+" : ""}${(res.irr - baseRes.irr).toFixed(1)} pp`
                  : ""}
              </span>
            ) : null}
          </div>
          {res ? (
            res.viable ? (
              <>
                {/* 30px numerals need ~145px each once equity gain runs to
                    "+$4,470M" — three tracks only clear that from ~620px up,
                    so mobile stacks and the tablet band fits what it can. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "minmax(0,1fr)"
                      : isNarrow
                        ? "repeat(auto-fit, minmax(150px, 1fr))"
                        : "repeat(3,minmax(0,1fr))",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={eyebrowStyle}>IRR</div>
                    <div style={{ ...mono, fontSize: 30, fontWeight: 700, color: irrColor(res.irr, true), marginTop: 4 }}>
                      {res.irr != null ? `${res.irr.toFixed(1)}%` : "n/a"}
                    </div>
                  </div>
                  <div>
                    <div style={eyebrowStyle}>MOIC</div>
                    <div style={{ ...mono, fontSize: 30, fontWeight: 700, marginTop: 4 }}>
                      {res.moic != null ? `${res.moic.toFixed(2)}×` : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={eyebrowStyle}>Equity gain</div>
                    <div style={{ ...mono, fontSize: 30, fontWeight: 700, color: (res.equity_gain ?? 0) >= 0 ? "var(--pos)" : "var(--neg-text)", marginTop: 4 }}>
                      {res.equity_gain != null ? `${res.equity_gain >= 0 ? "+" : "−"}${fmtMillions(Math.abs(res.equity_gain))}` : "—"}
                    </div>
                  </div>
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
              <>
                <div style={{ ...mono, fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--neg-text)" }}>
                  Deal not viable — {res.error_msg}
                </div>
                <Caption>
                  Entry EV {fmtMillions(res.entry_ev)} against {fmtMillions(res.entry_debt)} of debt
                  leaves {fmtMillions(res.entry_equity)} of equity. Ease leverage or the entry
                  multiple until the equity check turns positive.
                </Caption>
              </>
            )
          ) : (
            <LboRunState pending={run.isPending} fetching={run.isFetching} error={run.error} />
          )}
        </Card>

        {res?.viable && res.schedule.length > 0 && (
          /* The column above is itself a grid, so its auto track would still be
             floored by this card's min-content (the wide table) — the card has
             to be allowed to shrink too, or the scroll well never engages. */
          <Card style={{ minWidth: 0 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Annual schedule · $M</div>
            {/* Six nowrap numeric columns can't compress below ~450px — the
                schedule scrolls inside its own well rather than dragging the
                page sideways on a phone. */}
            <ScrollTable label="Annual debt schedule">
              <DataTable
                columns={[
                  { key: "year", label: "Year", mono: true },
                  { key: "ebitda", label: "EBITDA", align: "right", mono: true },
                  { key: "implied_ev", label: "Implied EV", align: "right", mono: true },
                  { key: "debt_start", label: "Debt start", align: "right", mono: true },
                  { key: "debt_end", label: "Debt end", align: "right", mono: true },
                  { key: "interest", label: "Interest", align: "right", mono: true },
                ]}
                rows={res.schedule.map((y) => ({
                  year: y.year === res.schedule.length ? `${y.year} · exit` : String(y.year),
                  ebitda: y.ebitda.toFixed(1),
                  implied_ev: y.implied_ev.toFixed(1),
                  debt_start: y.debt_start.toFixed(1),
                  debt_end: y.debt_end.toFixed(1),
                  interest: y.interest.toFixed(1),
                }))}
              />
            </ScrollTable>
            <Caption>
              Interest accrues on the declining balance; amortization retires{" "}
              {inputs.amortization_rate.toFixed(0)}% of the original debt each year. EBITDA
              compounds at {inputs.ebitda_growth_rate.toFixed(1)}% while the multiple re-rates at
              exit.
            </Caption>
          </Card>
        )}

        {sens && (
          <Card style={{ minWidth: 0 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>
              IRR sensitivity · entry × exit multiple
            </div>
            {/* A 6-track numeric grid can't compress to a phone card; it
                scrolls in its own well. `display: contents` on each row keeps
                the single-grid layout byte-identical while giving assistive
                tech the row/cell structure the visual grid implies. */}
            <ScrollTable stickyFirst={false} label="IRR sensitivity grid">
              <div
                role="table"
                aria-label="IRR sensitivity: entry vs exit multiple"
                style={{
                  display: "grid",
                  gridTemplateColumns: `110px repeat(${sens.exit_multiples.length}, 1fr)`,
                  gap: 2,
                  // 380, not 460: the results column is only ~396px at 768,
                  // and a floor above that would hang a scrollbar on a laptop
                  // where the grid already fits.
                  minWidth: 380,
                }}
              >
                <div role="row" style={{ display: "contents" }}>
                  <span role="columnheader" style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-wide)", textTransform: "uppercase", color: "var(--text-muted)", alignSelf: "end", whiteSpace: "nowrap" }}>
                    entry \ exit
                  </span>
                  {sens.exit_multiples.map((xm) => (
                    <span role="columnheader" key={xm} style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", textAlign: "right", padding: "0 8px" }}>
                      {xm.toFixed(1)}×
                    </span>
                  ))}
                </div>
                {sens.entry_multiples.map((em, ri) => (
                  <div role="row" style={{ display: "contents" }} key={em}>
                    <span role="rowheader" key={`r-${em}`} style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                      {em.toFixed(1)}×
                    </span>
                    {sens.exit_multiples.map((xm, ci) => {
                      const irr = sens.irr_grid[ri]?.[ci] ?? null;
                      // Outline the server's own center — Python and JS round
                      // .25 halves differently (audit).
                      const isCurrent =
                        Math.abs(em - sens.entry_center) < 1e-9 &&
                        Math.abs(xm - sens.exit_center) < 1e-9;
                      return (
                        <span
                          role="cell"
                          key={`${em}-${xm}`}
                          style={{
                            ...mono,
                            fontSize: "var(--fs-meta)",
                            textAlign: "right",
                            padding: "6px 8px",
                            borderRadius: "var(--r-xs)",
                            background: cellBg(irr),
                            border: isCurrent ? "1px solid var(--accent)" : "1px solid transparent",
                            fontWeight: isCurrent ? 700 : 400,
                            color: irr == null ? "var(--text-muted)" : "var(--text)",
                          }}
                        >
                          {irr == null ? "n/a" : `${irr.toFixed(1)}%`}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </ScrollTable>
            <Caption>
              Every cell reruns the full model at that entry/exit pair, everything else held. Green
              cells clear 20% IRR (the classic PE bar); amber clears 15%; n/a means the deal goes
              underwater. The outlined cell is the current scenario.
            </Caption>
          </Card>
        )}

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
    </div>
  );
}
