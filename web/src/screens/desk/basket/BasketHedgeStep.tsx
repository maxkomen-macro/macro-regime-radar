/**
 * Step 3 of Basket & Hedge, "Hedge it" (DESK_FRAME3_SPEC §10, §12.15;
 * desk/books). The ETF hedge is /basket/hedge's answer for the saved basket:
 * SMH SOXX QQQ XLK IGV XLU SPY IWM ranked by the R² of the basket's daily
 * returns on each (one year; 60 days beside it), each with its hedge ratio
 * (beta), the dollars to short for the notional, the volatility left after
 * the short and the cut; the top pick highlighted. The stress test is linear
 * in the fitted betas: the basket if QQQ or SPY falls 10%, unhedged and
 * hedged with the short the table recommends for the top pick, held as it is
 * (Codex R-15), and the card says which short that is. Then the slot for the
 * options card, which is not served here: its title and its reason (§1.0.2).
 */

import { useId, type ReactNode } from "react";
import type { BasketHedgeResponse, HedgeEtf } from "../data/types";
import { num, pct, pctPlain } from "../kit/format";
import { Awaiting, NotServedBadge, UnservedLine, cx } from "../kit/ui";
import { excludedWords, hedgeLead, stressLead, stressShortWords, stressWindowWords, usd } from "./trades";

type State = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** §1.0: the option structures have no served envelope, so the slot prints §1.0's reason (§1.0.2). */
export const OPTIONS_UNAVAILABLE = { reason: "Option structures for a basket are not yet defined in the engine.", until: null } as const;

function HedgeCard({ title, sub, lead, state, className, badge, children }: { title: string; sub?: string; lead?: string | null; state: State; className?: string; badge?: ReactNode; children: ReactNode }) {
  const hid = useId();
  return (
    <section className={cx("dk-card", "bh-card", className)} aria-labelledby={hid} aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h3 className="dk-card-title" id={hid}>
          {title}
          {sub ? <span className="dk-card-sub"> {sub}</span> : null}
        </h3>
        {badge ? <div className="dk-card-badge">{badge}</div> : null}
      </div>
      {state === "ready" && lead ? <p className="bh-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

const r2 = (v: number | null) => (fin(v) ? num(v, 2) : "—");

function EtfTable({ rows, top }: { rows: HedgeEtf[]; top: string | null }) {
  return (
    <div className="bh-scroll">
      <table className="bh-mini bh-etf-table">
        <caption className="dk-sr">The hedge ETFs ranked by R² of the basket's daily returns; the top pick is marked</caption>
        <thead>
          <tr>
            <th scope="col">ETF</th>
            <th scope="col">R² 1Y</th>
            <th scope="col">R² 60D</th>
            <th scope="col">Hedge ratio</th>
            <th scope="col">Short</th>
            <th scope="col">Vol left</th>
            <th scope="col">Vol cut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.symbol} data-top={e.symbol === top || undefined} aria-current={e.symbol === top ? "true" : undefined}>
              <th scope="row">
                <span className="bh-etf-sym">{e.symbol}</span>
                <span className="bh-etf-name">{e.label}</span>
                {e.symbol === top ? <span className="bh-top">top pick</span> : null}
              </th>
              <td>{r2(e.r2_1y)}</td>
              <td>{r2(e.r2_60d)}</td>
              <td title={e.reason ?? undefined}>{fin(e.hedge_ratio) ? `${num(e.hedge_ratio, 2)}×` : "—"}</td>
              <td>{fin(e.short_usd) ? usd(e.short_usd, true) : "—"}</td>
              <td>{fin(e.residual_vol) ? pctPlain(e.residual_vol, 0) : "—"}</td>
              <td>{fin(e.vol_reduction) ? pct(-e.vol_reduction, 0) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankCard({ h, state }: { h: BasketHedgeResponse | undefined; state: State }) {
  const rows = h?.etfs ?? [];
  const top = rows.find((e) => e.symbol === h?.top);
  const basisWords = top?.basis === "60d" ? "60 sessions (fewer than 252 daily returns so far)" : "one year";
  return (
    <HedgeCard className="bh-etfs" title="Hedge with an ETF" sub={`ranked by R² of daily returns over ${basisWords}`} lead={h ? hedgeLead(h) : null} state={state}>
      {state === "ready" && rows.length ? <EtfTable rows={rows} top={h?.top ?? null} /> : state === "loading" ? null : <Awaiting />}
      {state === "ready" && rows.length ? (
        <p className="bh-foot-note">
          Hedge ratio: dollars of the ETF to short per dollar of basket (beta). Vol left: the basket's annualized volatility after the short; vol cut: how much of it goes.
          {excludedWords(h?.excluded) ? ` ${excludedWords(h?.excluded)}` : ""}
        </p>
      ) : null}
    </HedgeCard>
  );
}

function StressCard({ h, state }: { h: BasketHedgeResponse | undefined; state: State }) {
  const rows = h?.stress ?? [];
  const hedge = rows.find((s) => s.hedge)?.hedge ?? h?.top ?? null;
  const money = (v: number | null) => (fin(v) ? `${v < 0 ? "−" : v > 0 ? "+" : ""}${usd(Math.abs(Math.round(v)))}` : "—");
  return (
    <HedgeCard className="bh-stress" title="Stress test" sub="linear in the fitted betas" lead={h ? stressLead(h) : null} state={state}>
      {state === "ready" && rows.length ? (
        <div className="bh-scroll">
          <table className="bh-mini bh-stress-table">
            <caption className="dk-sr">The basket's P&amp;L if QQQ or SPY falls 10%, unhedged and hedged with the top pick</caption>
            <thead>
              <tr>
                <th scope="col">If</th>
                <th scope="col">Basket</th>
                <th scope="col">Unhedged</th>
                <th scope="col">{hedge ? `Short ${hedge}` : "Hedge"}</th>
                <th scope="col">Hedged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.shock}>
                  <th scope="row">{`${s.shock} ${fin(s.move) ? pct(s.move, 0) : ""}`}</th>
                  <td>{fin(s.basket_move) ? pct(s.basket_move) : "—"}</td>
                  <td data-tone={fin(s.unhedged_usd) && s.unhedged_usd < 0 ? "down" : undefined}>{money(s.unhedged_usd)}</td>
                  <td>{money(s.hedge_usd)}</td>
                  <td data-tone={fin(s.hedged_usd) && s.hedged_usd < 0 ? "down" : undefined}>{money(s.hedged_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {state === "ready" && rows.length ? (
        <p className="bh-foot-note">
          {h ? stressShortWords(h) : null} The basket moves its beta to the benchmark times the move; the short moves the ETF&apos;s own beta to it (one for the benchmark itself). {h ? stressWindowWords(h) : null}
        </p>
      ) : null}
    </HedgeCard>
  );
}

/**
 * The slot for the options card (desk/prototypes builds it). Until it lands here the slot is plain (Codex
 * R-14): its title, its badge and why it is not served, and no control that cannot act.
 */
function OptionsSlot() {
  return (
    <HedgeCard className="bh-options" title="Hedge with options" sub="priced off the SPY / QQQ surface" state="ready" badge={<NotServedBadge />}>
      <div className="bh-options-slot" data-slot="hedge-options">
        <UnservedLine block={OPTIONS_UNAVAILABLE} />
      </div>
    </HedgeCard>
  );
}

/** Step 3's cards for one saved basket. */
export default function BasketHedgeStep({ h, state }: { h: BasketHedgeResponse | undefined; state: State }) {
  return (
    <div className="bh-hedge-step">
      <RankCard h={h} state={state} />
      <StressCard h={h} state={state} />
      <OptionsSlot />
    </div>
  );
}
