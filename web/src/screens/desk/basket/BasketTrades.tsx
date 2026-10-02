/**
 * Step 2 of Basket & Hedge, "How the basket trades" (DESK_FRAME3_SPEC §10,
 * §12.15; desk/books). Everything is /basket/price's answer for the saved
 * basket: the index with its 50- and 200-day averages and crosses (the
 * Technicals chart, kit/TrendChart), RSI, drawdown and realized volatility;
 * the index against the Nasdaq 100 (QQQ) and the S&P 500 (SPY), rebased, with
 * the relative-strength lines and their 50-day averages, beta and
 * correlation; contribution to return; concentration; liquidity. Each card
 * leads with one sentence stating its answer with its numbers (./trades.ts).
 * desk/cap-weight: every number is the served basket's at the weights chosen;
 * a cap-weighted basket says so in the index card's subtitle and footnote
 * (its label) and in the contribution and liquidity cards' columns.
 * While the answer is on its way the cards stay quiet; an answer that did not
 * come keeps the labels and says "Awaiting refresh" (§1.7).
 */

import { useId, type ReactNode } from "react";
import type { BasketBenchmark, BasketLegPriced, BasketPoint, BasketPriceResponse, ComparePoint } from "../data/types";
import { dayLong, dayShort, grouped, num, pct, pctPlain } from "../kit/format";
import LineChart, { extentTicks } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import TrendChart, { drawable, monthTicks, RangeChips } from "../kit/TrendChart";
import { Awaiting, LoadingLine, Signed, Stat, StatRow } from "../kit/ui";
import { Term, defineTerms } from "../kit/Term";
import { excludedWords, byContribution, capLabelOf, compareLead, concentrationLead, contributionLead, dayChange, daysText, indexLead, liquidityLead, methodSentence, momentumLead, rsLead, startSentence, usd, vsAverage } from "./trades";

export type BasketRange = "6m" | "1y";
export const BASKET_RANGES: readonly BasketRange[] = ["6m", "1y"];
type State = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A card of step 2: title and subtitle on one line, the lead sentence, the body. */
function TradeCard({ title, sub, lead, className, state, extra, children }: { title: string; sub?: string; lead: string | null; className?: string; state: State; extra?: ReactNode; children: ReactNode }) {
  const hid = useId();
  return (
    <section className={`dk-card bh-card ${className ?? ""}`} aria-labelledby={hid} aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h3 className="dk-card-title" id={hid}>
          {defineTerms(title)}
          {sub ? <span className="dk-card-sub"> {defineTerms(sub)}</span> : null}
        </h3>
        {extra}
      </div>
      {state === "ready" && lead ? <p className="bh-lead">{lead}</p> : null}
      {/* §14.10: while the API answers, the card says so (a cold start can take a minute). */}
      <LoadingLine busy={state === "loading"} />
      {children}
    </section>
  );
}

function IndexCard({ p, state, range, setRange }: { p: BasketPriceResponse | undefined; state: State; range: BasketRange; setRange: (r: BasketRange) => void }) {
  const ix = p?.index;
  const ready = state === "ready" && !!ix;
  const pts = ix?.series?.[range] ?? [];
  const aw = state === "awaiting" || (state === "ready" && !ix);
  return (
    <TradeCard
      className="bh-index"
      title="Basket index"
      sub={p?.start ? `base 100 on ${dayShort(p.start)} · ${p.weighting === "cap" ? "cap-weighted · " : ""}${p.method === "monthly" ? "rebalanced monthly" : "buy-and-hold"}` : "base 100"}
      lead={p ? indexLead(p) : null}
      state={state}
      extra={<RangeChips className="bh-range" ranges={BASKET_RANGES} value={range} onChange={setRange} />}
    >
      <StatRow cols={3}>
        <Stat label="Index" awaiting={aw || (ready && !fin(ix.price))} value={ready && fin(ix.price) ? num(ix.price, 1) : undefined} sub={ready && fin(ix.chg_1d) && ix.chg_1d_dates ? <Signed value={ix.chg_1d}>{dayChange(ix.chg_1d, ix.chg_1d_dates.to)}</Signed> : undefined} />
        <Stat label="50-day average" awaiting={aw || (ready && !fin(ix.ma50))} value={ready && fin(ix.ma50) ? num(ix.ma50, 1) : undefined} tone="green" sub={ready && fin(ix.vs_ma50) ? vsAverage(ix.vs_ma50) : undefined} />
        <Stat label="200-day average" awaiting={aw} value={ready ? (fin(ix.ma200) ? num(ix.ma200, 1) : "—") : undefined} tone="gray" sub={ready ? (fin(ix.vs_ma200) ? vsAverage(ix.vs_ma200) : "needs 200 sessions of the index") : undefined} />
      </StatRow>
      {ready && drawable(pts) ? (
        <TrendChart ariaLabel={`The basket index with its 50-day and 200-day averages, ${range.toUpperCase()}`} mainLabel="Basket" points={pts} crosses={ix.crosses ?? []} height={330} ticks={4} />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {ready && p ? (
        <p className="bh-foot-note">
          {[startSentence(p), capLabelOf(p) ? `${capLabelOf(p)}.` : null, methodSentence(p.method, p.weighting), excludedWords(p.excluded)].filter(Boolean).join(" ")}
        </p>
      ) : null}
    </TradeCard>
  );
}

/** RSI and drawdown over the range, from the served series (§12.15): RSI with its 30 and 70 lines, drawdown below zero. */
function MomentumCharts({ pts, range }: { pts: readonly BasketPoint[]; range: BasketRange }) {
  const rsi = pts.map((q) => (fin(q.rsi) ? q.rsi : null));
  const dd = pts.map((q) => (fin(q.drawdown) ? q.drawdown * 100 : null));
  const ddLo = Math.min(0, ...dd.filter(fin));
  const ddTicks = extentTicks(ddLo, 0, 3);
  const xt = monthTicks(pts.map((q) => q.date));
  return (
    <div className="bh-mom-charts">
      {rsi.some(fin) ? (
        <div>
          <p className="dk-stat-label">RSI (14) · 30 and 70 marked</p>
          <LineChart
            ariaLabel={`The index's 14-day RSI, ${range.toUpperCase()}, with the 30 and 70 lines`}
            height={118}
            n={pts.length}
            yDomain={[0, 100]}
            yTicks={[30, 70].map((v) => ({ v, text: String(v) }))}
            xTicks={xt}
            bands={[
              { from: 70, to: 100, fill: "rgba(139, 146, 158, 0.08)" },
              { from: 0, to: 30, fill: "rgba(139, 146, 158, 0.08)" },
            ]}
            series={[{ key: "rsi", values: rsi, color: DESK_ACCENTS.blue, width: 2, label: "RSI" }]}
            endDot="rsi"
            pad={{ l: 34, r: 44, t: 8, b: 24 }}
          />
        </div>
      ) : null}
      {dd.some(fin) ? (
        <div>
          <p className="dk-stat-label">Drawdown from peak, %</p>
          <LineChart
            ariaLabel={`The index's drawdown from its running peak, ${range.toUpperCase()}`}
            height={118}
            n={pts.length}
            yDomain={[ddTicks[0], 0]}
            yTicks={ddTicks.map((v) => ({ v, text: v === 0 ? "0" : num(v, 0) }))}
            xTicks={xt}
            series={[{ key: "dd", values: dd, color: DESK_ACCENTS.blue, width: 2, label: "From peak" }]}
            endDot="dd"
            pad={{ l: 34, r: 72, t: 8, b: 24 }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MomentumCard({ p, state, range }: { p: BasketPriceResponse | undefined; state: State; range: BasketRange }) {
  const ix = p?.index;
  const ready = state === "ready" && !!ix;
  const aw = state === "awaiting" || (state === "ready" && !ix);
  const dd = ix?.drawdown;
  return (
    <TradeCard className="bh-momentum" title="Momentum and risk" sub="the index's own technicals" lead={momentumLead(ix)} state={state}>
      <StatRow cols={2}>
        {/* A basket younger than 252 sessions has no one-year return: a dash and why, not "Awaiting refresh". */}
        <Stat
          label="1-year return"
          awaiting={aw}
          value={ready ? (fin(ix.ret_1y) ? pct(ix.ret_1y) : "—") : undefined}
          tone={ready && fin(ix.ret_1y) ? (ix.ret_1y >= 0 ? "up" : "down") : undefined}
          sub={ready ? (fin(ix.ret_1y) && ix.ret_1y_dates ? `since ${dayLong(ix.ret_1y_dates.from)}` : `needs 252 sessions of the index; it has ${p?.sessions ?? "fewer"}`) : undefined}
        />
        <Stat label="RSI (14)" awaiting={aw || (ready && !fin(ix.rsi))} value={ready && fin(ix.rsi) ? num(ix.rsi, 0) : undefined} sub={ready && ix.rsi_date ? `Wilder, on ${dayShort(ix.rsi_date)}` : undefined} />
        <Stat
          label="From peak"
          awaiting={aw || (ready && !fin(dd?.now))}
          value={ready && dd && fin(dd.now) ? pct(dd.now) : undefined}
          tone={ready && dd && fin(dd.now) && dd.now < 0 ? "down" : undefined}
          sub={ready && dd ? `peak ${dayShort(dd.peak_date)}${fin(dd.max) ? ` · deepest ${pct(dd.max)} on ${dayShort(dd.max_date)}` : ""}` : undefined}
        />
        <Stat label="21-day realized vol" awaiting={aw || (ready && !fin(ix.realized_vol_21d))} value={ready && fin(ix.realized_vol_21d) ? pctPlain(ix.realized_vol_21d, 1) : undefined} sub={ready && ix.realized_vol_window ? `annualized, ${dayShort(ix.realized_vol_window.start)} to ${dayShort(ix.realized_vol_window.end)}` : undefined} />
      </StatRow>
      {ready && ix.series?.[range]?.length ? <MomentumCharts pts={ix.series[range] ?? []} range={range} /> : null}
    </TradeCard>
  );
}

/** A beta or correlation cell: the number, or "—" with the served reason as its title. */
function Cell({ v, why }: { v: number | null | undefined; why?: string | null }) {
  return fin(v) ? <td>{num(v, 2)}</td> : <td title={why ?? undefined}>—</td>;
}

function BetaTable({ b }: { b: { qqq?: BasketBenchmark; spy?: BasketBenchmark } | undefined }) {
  const rows = [b?.qqq, b?.spy].filter((x): x is BasketBenchmark => !!x);
  if (!rows.length) return <Awaiting />;
  return (
    <table className="bh-mini">
      <caption className="dk-sr">Beta and correlation of the basket's daily returns to QQQ and SPY</caption>
      <thead>
        <tr>
          {/* desk/pdf-polish 7: each head its own window's definition (252 or 60 daily returns), not the generic beta's. */}
          <th scope="col">
            <Term ids={["col-against"]}>Against</Term>
          </th>
          <th scope="col">
            <Term ids={["col-beta1y"]}>Beta 1Y</Term>
          </th>
          <th scope="col">
            <Term ids={["col-corr1y"]}>Corr 1Y</Term>
          </th>
          <th scope="col">
            <Term ids={["col-beta60d"]}>Beta 60D</Term>
          </th>
          <th scope="col">
            <Term ids={["col-corr60d"]}>Corr 60D</Term>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.symbol}>
            <th scope="row">{r.symbol}</th>
            <Cell v={r.beta_1y} why={r.reason_1y} />
            <Cell v={r.corr_1y} why={r.reason_1y} />
            <Cell v={r.beta_60d} why={r.reason_60d} />
            <Cell v={r.corr_60d} why={r.reason_60d} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A small line chart of served points: y ticks round, month ticks, each line labelled at its end. */
function Lines({ pts, series, label, height = 190 }: { pts: readonly ComparePoint[]; series: { key: keyof ComparePoint; color: string; dash?: string; label: string; width?: number }[]; label: string; height?: number }) {
  const vals = pts.flatMap((p) => series.map((s) => p[s.key])).filter(fin);
  if (vals.length < 2) return <Awaiting />;
  const ticks = extentTicks(Math.min(...vals), Math.max(...vals), 3);
  return (
    <LineChart
      ariaLabel={label}
      height={height}
      n={pts.length}
      yDomain={[ticks[0], ticks[ticks.length - 1]]}
      yTicks={ticks.map((v) => ({ v, text: grouped(v) }))}
      xTicks={monthTicks(pts.map((p) => p.date))}
      series={series.map((s) => ({ key: String(s.key), values: pts.map((p) => (fin(p[s.key]) ? (p[s.key] as number) : null)), color: s.color, dash: s.dash, width: s.width ?? 2, label: s.label }))}
      endDot={String(series[0].key)}
      pad={{ l: 40, r: 62, t: 12, b: 26 }}
    />
  );
}

function CompareCard({ p, state, range }: { p: BasketPriceResponse | undefined; state: State; range: BasketRange }) {
  const c = p?.compare?.[range];
  const pts = c?.points ?? [];
  const ready = state === "ready" && !!c;
  return (
    <TradeCard className="bh-compare" title="Against the Nasdaq and the S&P" sub={c?.base_date ? `rebased to 100 on ${dayShort(c.base_date)}` : "rebased to 100"} lead={ready && p ? compareLead(p, range) : null} state={state}>
      {ready ? (
        <Lines
          pts={pts}
          label={`The basket, QQQ and SPY rebased to 100, ${range.toUpperCase()}`}
          series={[
            { key: "basket", color: DESK_ACCENTS.blue, label: "Basket", width: 2.5 },
            { key: "qqq", color: DESK_ACCENTS.gray, label: "QQQ" },
            { key: "spy", color: DESK_ACCENTS.gray, dash: "4 4", label: "SPY" },
          ]}
        />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {state === "ready" ? <BetaTable b={p?.benchmarks} /> : null}
      <p className="bh-foot-note">Beta and correlation of daily returns over the last 252 and 60 sessions both traded; a window with fewer is not served.</p>
    </TradeCard>
  );
}

function RelativeCard({ p, state, range }: { p: BasketPriceResponse | undefined; state: State; range: BasketRange }) {
  const c = p?.compare?.[range];
  const pts = c?.points ?? [];
  const ready = state === "ready" && !!c;
  return (
    <TradeCard className="bh-relative" title="Relative strength" sub="basket ÷ benchmark, with its 50-day average" lead={ready ? rsLead(pts, c.base_date) : null} state={state}>
      {ready ? (
        <div className="bh-rs">
          {(["qqq", "spy"] as const).map((k) => (
            <div key={k}>
              <p className="dk-stat-label">Basket ÷ {k.toUpperCase()}</p>
              <Lines
                pts={pts}
                height={128}
                label={`The basket divided by ${k.toUpperCase()}, 100 on ${dayLong(c.base_date)}, with its 50-day average`}
                series={[
                  { key: `rs_${k}`, color: DESK_ACCENTS.blue, label: "Ratio", width: 2.5 },
                  { key: `rs_${k}_ma50`, color: DESK_ACCENTS.green, dash: "4 4", label: "50-day" },
                ]}
              />
            </div>
          ))}
        </div>
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
    </TradeCard>
  );
}

/** Each name's contribution as a bar from zero: right and green when it added, left and red when it took away (§1.3). */
function ContribRows({ rows, names, cap }: { rows: (BasketLegPriced & { contribution: number })[]; names: Record<string, string | null>; cap: boolean }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-12);
  const signed = rows.some((r) => r.contribution < 0);
  const w = (x: number | null) => (fin(x) ? pctPlain(x, 0) : "—");
  return (
    <ul className="bh-contrib-rows" aria-label="Each name's contribution to the basket's return, largest first">
      {rows.map((r) => {
        const len = (Math.abs(r.contribution) / max) * (signed ? 50 : 100);
        const left = signed ? (r.contribution < 0 ? 50 - len : 50) : 0;
        return (
          <li key={r.symbol}>
            <span className="bh-c-sym">{r.symbol}</span>
            <span className="bh-c-name">{names[r.symbol] ?? ""}</span>
            <span className="bh-c-w" title={cap ? "cap weight at the start → weight at the last close" : "target weight → weight at the last close"}>
              {w(r.target_weight)} → {w(r.weight_now)}
            </span>
            <span className="bh-c-track" aria-hidden="true">
              <span data-tone={r.contribution < 0 ? "red" : "green"} style={{ left: `${left}%`, width: `${len}%` }} />
            </span>
            <span className="bh-c-val" data-tone={r.contribution < 0 ? "red" : "green"}>
              {`${r.contribution < 0 ? "−" : "+"}${num(Math.abs(r.contribution) * 100, 1)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ContributionCard({ p, state, names }: { p: BasketPriceResponse | undefined; state: State; names: Record<string, string | null> }) {
  const rows = byContribution(p?.legs);
  const ready = state === "ready" && rows.length > 0;
  return (
    <TradeCard className="bh-contrib" title="Contribution to return" sub={p?.start ? `points of the index's return since ${dayShort(p.start)}` : "points of the index's return"} lead={p ? contributionLead(p) : null} state={state}>
      {ready ? <ContribRows rows={rows} names={names} cap={p?.weighting === "cap"} /> : state === "loading" ? null : <Awaiting />}
      {ready ? <p className="bh-foot-note">{p?.weighting === "cap" ? "Weights: cap weight at the start → at the last close." : "Weights: target → at the last close."} The names add up to the index's return.</p> : null}
    </TradeCard>
  );
}

function ConcentrationCard({ p, state }: { p: BasketPriceResponse | undefined; state: State }) {
  const c = p?.concentration;
  const ready = state === "ready" && !!c;
  const aw = state === "awaiting" || (state === "ready" && !c);
  return (
    <TradeCard className="bh-conc" title="Concentration" sub="at the last close" lead={concentrationLead(c)} state={state}>
      <StatRow cols={3}>
        <Stat label="Top-3 weight" awaiting={aw || (ready && !fin(c.top3_share))} value={ready && fin(c.top3_share) ? pctPlain(c.top3_share, 0) : undefined} sub={ready ? c.top3.join(" · ") : undefined} />
        <Stat label="Effective names" awaiting={aw || (ready && !fin(c.effective_n))} value={ready && fin(c.effective_n) ? num(c.effective_n, 1) : undefined} sub={ready && p?.legs ? `of ${p.legs.length} · 1 ÷ Σw²` : undefined} />
        <Stat
          label="Avg correlation"
          awaiting={aw || (ready && !fin(c.avg_pairwise_corr))}
          value={ready && fin(c.avg_pairwise_corr) ? num(c.avg_pairwise_corr, 2) : undefined}
          sub={ready && c.corr_window ? `pairwise, ${c.corr_window.n} sessions` : undefined}
        />
      </StatRow>
    </TradeCard>
  );
}

function LiquidityCard({ p, state }: { p: BasketPriceResponse | undefined; state: State }) {
  const legs = p?.legs ?? [];
  const ready = state === "ready" && legs.length > 0;
  const worst = p?.liquidity?.binding;
  return (
    <TradeCard className="bh-liq" title="Liquidity" sub={p && fin(p.notional) ? `days to trade ${usd(p.notional)} at 20% of volume` : "days to trade at 20% of volume"} lead={p ? liquidityLead(p) : null} state={state}>
      {/* Codex R-04: a name without its 20 sessions of dollar volume leaves the basket's figure unserved, and says why. */}
      {state === "ready" && p?.liquidity?.reason ? <p className="bh-lead">{`The basket's days to trade are not served: ${p.liquidity.reason}.`}</p> : null}
      {ready ? (
        <table className="bh-mini bh-liq-table">
          <caption className="dk-sr">Days to trade each name at 20% of its 20-day average dollar volume</caption>
          <thead>
            <tr>
              <th scope="col">
                <Term ids={["col-liq-name"]}>Name</Term>
              </th>
              <th scope="col">
                <Term ids={["col-adv"]}>20-day avg $ volume</Term>
              </th>
              {/* desk/cap-weight: a cap-weighted basket bought today, at the last close's market values */}
              <th scope="col">
                <Term ids={[p?.weighting === "cap" ? "col-at-cap-weight" : "col-at-target"]}>{p?.weighting === "cap" ? "At cap weight" : "At target"}</Term>
              </th>
              <th scope="col">
                <Term ids={["col-days20"]}>Days at 20%</Term>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...legs]
              .sort((a, b) => (fin(b.days_to_trade) ? b.days_to_trade : -1) - (fin(a.days_to_trade) ? a.days_to_trade : -1))
              .map((l) => (
                <tr key={l.symbol} data-binding={l.symbol === worst || undefined}>
                  <th scope="row">{l.symbol}</th>
                  <td title={fin(l.adv_usd) ? undefined : `${l.adv_missing ?? "some"} of the 20 sessions have no dollar volume`}>{fin(l.adv_usd) ? usd(l.adv_usd, true) : "—"}</td>
                  <td>{fin(l.dollars) ? usd(l.dollars, true) : "—"}</td>
                  <td>{fin(l.days_to_trade) ? daysText(l.days_to_trade) : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
    </TradeCard>
  );
}

/** Step 2's cards for one priced basket. `names` are the saved legs' names, by ticker. */
export default function BasketTrades({ p, state, range, setRange, names }: { p: BasketPriceResponse | undefined; state: State; range: BasketRange; setRange: (r: BasketRange) => void; names: Record<string, string | null> }) {
  return (
    <div className="bh-trades">
      <IndexCard p={p} state={state} range={range} setRange={setRange} />
      <MomentumCard p={p} state={state} range={range} />
      <CompareCard p={p} state={state} range={range} />
      <RelativeCard p={p} state={state} range={range} />
      <ContributionCard p={p} state={state} names={names} />
      <div className="bh-stack">
        <ConcentrationCard p={p} state={state} />
        <LiquidityCard p={p} state={state} />
      </div>
    </div>
  );
}
