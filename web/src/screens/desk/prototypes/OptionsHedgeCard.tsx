/**
 * Basket & Hedge's "Hedge with options" as a PROTOTYPE card (DESK_FRAME3_SPEC
 * §10, §1.0.3), in the hedge's step-3 slot: three routes to protect the open
 * basket, each as a 1-month put, a 3-month put and a 1-month 95/85 put spread,
 * with its cost in % and $ of notional, its breakeven and its payoff if the
 * basket falls 10%, and a one-line trade-off. The inputs row is the basket
 * engine's, live (./basket-inputs.ts); every output is illustrative,
 * Black-Scholes at the assumed volatilities its Advanced section states
 * (./options.ts).
 */

import type { SavedBasket } from "../basket/weights";
import { PrototypeCard } from "../kit/Prototype";
import { dayShort } from "../kit/format";
import { AdvancedPanel, Signed, Stat, StatRow, useAdvanced } from "../kit/ui";
import { basketInputs, type BasketInputs } from "./basket-inputs";
import { hedge, pct1, pct2, STRUCTURES, usd, usdM, type Hedge, type Route } from "./options";
import { prototype } from "./registry";
import "./prototypes.css";

const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/** The route's heading and the line under it. */
function routeWords(h: Hedge, r: Route): { title: string; sub: string; tradeoff: string } {
  const i = h.inputs;
  if (r.key === "etf" && h.etf)
    return {
      title: `Puts on ${h.etf.symbol}, the top-ranked hedge ETF`,
      sub: `${usdM(h.etf.notional)} of ${h.etf.symbol} against ${usdM(i.notional)} of basket, at the hedge ratio; strikes moved by it, so 95/85 is ${pct1(h.etf.strikes.long)}/${pct1(h.etf.strikes.short)} of ${h.etf.symbol} · basis risk: R² ${i.top.r2.toFixed(2)}`,
      tradeoff: `Listed and liquid, but an R² of ${i.top.r2.toFixed(2)} leaves ${pct0(1 - i.top.r2)} of the basket's variance unhedged: the basket can fall while ${h.etf.symbol} holds.`,
    };
  if (r.key === "names") {
    const rest = i.legs.length - h.names.length;
    return {
      title: "Puts on the three largest names",
      sub: `${h.names.map((n) => n.symbol).join(", ")}, each sized to its weight: ${pct0(r.covered)} of the basket`,
      tradeoff: `Covers only the ${pct0(r.covered)} the three names carry, at single-name volatility; the other ${rest} ${rest === 1 ? "name is" : "names are"} unhedged.`,
    };
  }
  return {
    title: "An OTC basket put from a dealer",
    sub: "an exact hedge of this basket, dealer-priced",
    tradeoff: `Exact, with no basis risk, but dealer-priced (${h.basket?.margin ?? 0} vol points over the fair mark here) and traded under an ISDA; a basket swap instead costs about ${h.swapSpreadBp} bp a year and gives up the upside.`,
  };
}

function RouteBlock({ h, r }: { h: Hedge; r: Route }) {
  const w = routeWords(h, r);
  const fall = Math.round(-h.basketMove * 100);
  return (
    <div className="pr-route">
      <h3 className="pr-route-title">
        <span className="pr-route-letter">({r.letter})</span> {w.title}
      </h3>
      <p className="pr-route-sub">{w.sub}</p>
      <div className="pr-table-wrap" role="region" aria-label={`(${r.letter}) priced`} tabIndex={0}>
        <table className="pr-table">
          <thead>
            <tr>
              <th scope="col">Structure</th>
              <th scope="col">Cost</th>
              <th scope="col">Cost $</th>
              <th scope="col">Breakeven</th>
              <th scope="col">If the basket falls {fall}%</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((p) => (
              <tr key={p.structure.key}>
                <th scope="row">{p.structure.label}</th>
                <td>{pct2(p.cost)}</td>
                <td>{usd(p.costUsd)}</td>
                <td>{Number.isFinite(p.breakeven) ? `basket down ${pct1(p.breakeven)}` : "—"}</td>
                <td>
                  <Signed value={p.payoffUsd}>
                    {usd(p.payoffUsd)} · {pct2(p.payoff)}
                  </Signed>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pr-tradeoff">
        <b>Trade-off:</b> {w.tradeoff}
      </p>
    </div>
  );
}

function Inputs({ inputs }: { inputs: BasketInputs | null }) {
  return (
    <div className="pr-inputs">
      <p className="pr-inputs-label">
        <span className="dk-dot" data-tone="green" aria-hidden="true" /> from your basket · live
      </p>
      <StatRow cols={4}>
        {inputs ? (
          <>
            <Stat label="Notional" value={usdM(inputs.notional)} sub={inputs.name} size="sm" />
            <Stat label="Top hedge ETF" value={inputs.top.symbol} sub={`first of ${inputs.ranked} by R²${inputs.next ? `, ahead of ${inputs.next.symbol} at ${inputs.next.r2.toFixed(2)}` : ""}`} size="sm" />
            <Stat label="Hedge ratio" value={inputs.top.hedge_ratio.toFixed(2)} sub={`beta: $ of ${inputs.top.symbol} per $ of basket`} size="sm" />
            <Stat label="R²" value={inputs.top.r2.toFixed(2)} sub={`${inputs.window.n} sessions to ${dayShort(inputs.window.end)}`} size="sm" />
          </>
        ) : (
          ["Notional", "Top hedge ETF", "Hedge ratio", "R²"].map((l) => <Stat key={l} label={l} awaiting />)
        )}
      </StatRow>
    </div>
  );
}

function Assumptions({ h }: { h: Hedge }) {
  const v = (x: number) => `${x.toFixed(1)}%`;
  const vols = (u: { vol: Record<string, number> }) => `${v(u.vol["1m_95"])} (1M 95), ${v(u.vol["1m_85"])} (1M 85), ${v(u.vol["3m_95"])} (3M 95)`;
  const rows: [string, string][] = [
    ["Priced", `Black-Scholes, European puts held to expiry: ${h.days["1m"]} days (1M) and ${h.days["3m"]} days (3M), a ${pct2(h.rate)} rate; strikes ${STRUCTURES[0].long * 100}% and ${(STRUCTURES[2].short ?? 0) * 100}% of spot`],
  ];
  if (h.etf)
    rows.push([
      `(a) ${h.etf.symbol}`,
      `strikes ${pct1(h.etf.strikes.long)} and ${pct1(h.etf.strikes.short)} of ${h.etf.symbol} (the basket's 95% and 85%, 1 − the distance ÷ ${h.inputs.top.hedge_ratio.toFixed(2)}); vol ${vols(h.etf)}; dividend yield ${pct2(h.etf.q)}; ${usdM(h.etf.notional)} of puts; a ${pct0(-h.basketMove)} basket fall moves ${h.etf.symbol} ${pct1(-h.etf.move)}`,
    ]);
  for (const n of h.names) rows.push([`(b) ${n.symbol}`, `${n.weight}% of the basket; vol ${vols(n)}${n.assumed ? " (no vol assumed for this name: the default)" : ""}; dividend yield ${pct2(n.q)}; falls with the basket`]);
  if (h.basket)
    rows.push([
      "(c) basket",
      `vol = ${h.etf?.symbol}'s at the strike × ${h.inputs.top.hedge_ratio.toFixed(2)} ÷ √${h.inputs.top.r2.toFixed(2)}, plus ${h.basket.margin} points of dealer margin: ${vols(h.basket)}${h.inputs.basketVol != null ? ` (the engine's realized basket vol over the same window: ${pct1(h.inputs.basketVol)})` : ""}; dividend yield ${pct2(h.basket.q)}`,
    ]);
  rows.push(["Breakeven", "the basket's fall by expiry at which the payoff repays the premium"]);
  rows.push(["Basket swap", `short the basket for a financing spread of ${h.swapSpreadBp} bp a year`]);
  return (
    <dl className="pr-assume">
      {rows.map(([k, val]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{val}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OptionsHedgeCard({ basket }: { basket: SavedBasket | null }) {
  const adv = useAdvanced();
  const entry = prototype("options-hedge");
  const inputs = basketInputs(basket);
  const h = inputs ? hedge(inputs) : null;
  return (
    <PrototypeCard
      id={entry.id}
      className="bh-card pr-options"
      title={entry.title}
      sub="three routes to protect the basket, each three ways"
      production={entry.production}
      advanced={
        <AdvancedPanel enabled={!!h} adv={adv} items="assumed volatilities · strikes and expiries · how each payoff is read">
          {h ? <Assumptions h={h} /> : null}
        </AdvancedPanel>
      }
    >
      <Inputs inputs={inputs} />
      {h ? (
        <div className="pr-routes">
          {h.routes.map((r) => (
            <RouteBlock key={r.key} h={h} r={r} />
          ))}
        </div>
      ) : (
        <p className="pr-why">Nothing is priced until the basket's inputs arrive.</p>
      )}
    </PrototypeCard>
  );
}
