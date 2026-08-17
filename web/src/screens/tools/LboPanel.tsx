/**
 * LBO Calculator — nine deal inputs on the left, results on the right:
 * returns banner (IRR / MOIC / equity gain, confusion #10 captions), annual
 * debt schedule, and the 5×5 entry-vs-exit IRR sensitivity grid.
 *
 * All deal math runs server-side in src/analytics/lbo.py via POST /api/lbo/run
 * (~120ms debounce). The financing rate defaults to the live all-in cost
 * (Fed Funds + HY OAS) whose sole owner is Credit → Financing conditions.
 */

import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable } from "../../components";
import { useLboDefaults, useLboRun } from "../../api/queries";
import type { LboRequest } from "../../api/types";
import Jargon from "../shared/Jargon";
import { fmtDate } from "../../lib/format";
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

export default function LboPanel() {
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

  const manualRate =
    inputs != null && clampedLive != null && Math.abs(inputs.interest_rate - clampedLive) > 0.1;

  const set = (patch: Partial<LboRequest>) => setOverrides((o) => ({ ...o, ...patch }));

  if (!inputs) {
    return (
      <Card>
        <StateNote loading={defaults.isLoading} error={defaults.isError} />
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 12, alignItems: "start" }}>
      {/* ── Inputs ────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 12 }}>
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
          <div style={{ ...eyebrowStyle, marginBottom: 10 }}>Deal inputs</div>
          <SliderRow
            label="Entry EBITDA"
            valueText={fmtMillions(inputs.ebitda)}
            value={Math.min(inputs.ebitda, 1000)}
            min={10}
            max={1000}
            step={10}
            onChange={(v) => set({ ebitda: v })}
          />
          <SliderRow
            label="EBITDA growth"
            valueText={`${inputs.ebitda_growth_rate.toFixed(1)}%/yr`}
            value={inputs.ebitda_growth_rate}
            min={-10}
            max={30}
            step={0.5}
            onChange={(v) => set({ ebitda_growth_rate: v })}
          />
          <SliderRow
            label={<Jargon term="EV/EBITDA">Entry multiple</Jargon>}
            valueText={`${inputs.entry_multiple.toFixed(2)}×`}
            value={inputs.entry_multiple}
            min={3}
            max={20}
            step={0.25}
            onChange={(v) => set({ entry_multiple: v })}
          />
          <SliderRow
            label={<Jargon term="EV/EBITDA">Exit multiple</Jargon>}
            valueText={`${inputs.exit_multiple.toFixed(2)}×`}
            value={inputs.exit_multiple}
            min={3}
            max={20}
            step={0.25}
            onChange={(v) => set({ exit_multiple: v })}
          />
          <SliderRow
            label="Hold period"
            valueText={`${inputs.hold_period} yr`}
            value={inputs.hold_period}
            min={1}
            max={10}
            step={1}
            onChange={(v) => set({ hold_period: v })}
          />
          <SliderRow
            label={<Jargon term="leverage">Leverage · Debt/EBITDA</Jargon>}
            valueText={`${inputs.leverage_ratio.toFixed(2)}×`}
            value={inputs.leverage_ratio}
            min={0.5}
            max={8}
            step={0.25}
            onChange={(v) => set({ leverage_ratio: v })}
          />
          <SliderRow
            label="Interest rate (all-in)"
            valueText={`${inputs.interest_rate.toFixed(2)}%`}
            value={inputs.interest_rate}
            min={3}
            max={20}
            step={0.25}
            onChange={(v) => set({ interest_rate: v })}
            note={
              manualRate ? (
                <>
                  manual rate —{" "}
                  <button
                    onClick={() => set({ interest_rate: clampedLive ?? 8.5 })}
                    style={{
                      appearance: "none",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      ...mono,
                      fontSize: 10,
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
                "live rate unavailable — stated 8.50% default in use"
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
            onChange={(v) => set({ amortization_rate: v })}
          />
          <SliderRow
            label="Transaction fees"
            valueText={`${inputs.mgmt_fee_pct.toFixed(2)}% of EV`}
            value={inputs.mgmt_fee_pct}
            min={0}
            max={5}
            step={0.25}
            onChange={(v) => set({ mgmt_fee_pct: v })}
          />
        </Card>
      </div>

      {/* ── Results ───────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 12 }}>
        <Card tone={res && !res.viable ? "risk" : "default"}>
          {res ? (
            res.viable ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
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
                  Fees add to the check, so raising them costs returns — as they should.
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
            <StateNote loading={run.isLoading} error={run.isError} />
          )}
        </Card>

        {res?.viable && res.schedule.length > 0 && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Annual schedule · $M</div>
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
            <Caption>
              Interest accrues on the declining balance; amortization retires{" "}
              {inputs.amortization_rate.toFixed(0)}% of the original debt each year. EBITDA
              compounds at {inputs.ebitda_growth_rate.toFixed(1)}% while the multiple re-rates at
              exit.
            </Caption>
          </Card>
        )}

        {sens && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>
              IRR sensitivity · entry × exit multiple
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `110px repeat(${sens.exit_multiples.length}, 1fr)`,
                gap: 2,
              }}
            >
              <span style={{ ...mono, fontSize: 9, letterSpacing: "var(--ls-wide)", textTransform: "uppercase", color: "var(--text-muted)", alignSelf: "end", whiteSpace: "nowrap" }}>
                entry \ exit
              </span>
              {sens.exit_multiples.map((xm) => (
                <span key={xm} style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", textAlign: "right", padding: "0 8px" }}>
                  {xm.toFixed(1)}×
                </span>
              ))}
              {sens.entry_multiples.map((em, ri) => (
                <Fragment key={em}>
                  <span key={`r-${em}`} style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
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
                </Fragment>
              ))}
            </div>
            <Caption>
              Every cell reruns the full model at that entry/exit pair, everything else held. Green
              cells clear 20% IRR — the classic PE bar; amber clears 15%; n/a means the deal goes
              underwater. The outlined cell is the current scenario.
            </Caption>
          </Card>
        )}

        {res?.viable && (
          <Caption>
            One check on the market: this deal borrows at {inputs.interest_rate.toFixed(2)}%
            {defaults.data && !manualRate ? " — today's live all-in cost" : ""}. Pre-GFC deals
            financed near ~7%; if the rate slider has to fall below reality to make the returns
            work, the market is telling you the price is wrong.
          </Caption>
        )}
      </div>
    </div>
  );
}
