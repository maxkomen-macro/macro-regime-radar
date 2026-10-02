/**
 * Technicals' "What protection costs right now" as a PROTOTYPE card
 * (DESK_FRAME3_SPEC §3, §1.0.3), shown for the S&P only, in the vol column's
 * place until /technicals serves its vol block: puts against calls a month
 * out, what options expect against what happened at 1, 3 and 6 months, and
 * where the skew sits in two years. Illustrative values from vol.json and
 * proto-protection.json (./protection.ts); the Advanced section states the
 * assumed volatilities and the rules.
 */

import { PrototypeCard } from "../kit/Prototype";
import { AdvancedPanel, Stat, useAdvanced } from "../kit/ui";
import { capitalize, monthYear, num, ordinal, signed } from "../kit/format";
import { costText, protection, strikeText, TENOR_WORDS, TENORS } from "./protection";
import { prototype } from "./registry";
import "./prototypes.css";

const P = protection();

/** The two-year weekly skew line, today's reading dotted at its end. */
function SkewLine() {
  const w = 262;
  const h = 58;
  const pad = { l: 2, r: 6, t: 6, b: 6 };
  const lo = Math.floor(P.low.pts);
  const hi = Math.ceil(P.high.pts);
  const x = (i: number) => pad.l + (i / (P.history.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (h - pad.t - pad.b);
  const d = P.history.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pts).toFixed(1)}`).join("");
  const last = P.history.length - 1;
  const today = P.history[last].pts;
  return (
    <svg className="pr-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Weekly 25-delta skew over two years, from ${num(P.low.pts)} to ${num(P.high.pts)} points; today ${num(today)}`}>
      <line className="pr-spark-today" x1={pad.l} x2={w - pad.r} y1={y(today)} y2={y(today)} />
      <path className="pr-spark-line" d={d} />
      <circle className="pr-spark-dot" cx={x(last)} cy={y(today)} r={3.5} />
    </svg>
  );
}

/** Implied (blue) against realized (gray) at each tenor, on one scale. */
function ExpectBars() {
  const top = Math.ceil(Math.max(...TENORS.flatMap((t) => [P.implied[t], P.realized[t]])) / 5) * 5;
  return (
    <div className="pr-bars" role="img" aria-label={TENORS.map((t) => `${TENOR_WORDS[t]}: options ${num(P.implied[t])}, realized ${num(P.realized[t])}`).join("; ")}>
      {TENORS.map((t) => (
        <div key={t} className="pr-bar-row">
          <span className="pr-bar-tenor">{t.toUpperCase()}</span>
          <span className="pr-bar-pair" aria-hidden="true">
            <i className="pr-bar-iv" style={{ width: `${(P.implied[t] / top) * 100}%` }} />
            <i className="pr-bar-rv" style={{ width: `${(P.realized[t] / top) * 100}%` }} />
          </span>
          <span className="pr-bar-nums">
            {num(P.implied[t])} <span className="pr-muted">vs</span> {num(P.realized[t])}
          </span>
          <span className="pr-bar-gap" data-tone="amber">
            {signed(P.implied[t] - P.realized[t])}
          </span>
        </div>
      ))}
      <p className="pr-legend" aria-hidden="true">
        <span>
          <i className="pr-bar-iv" /> options expect
        </span>
        <span>
          <i className="pr-bar-rv" /> what happened
        </span>
        <span>gap, vol points</span>
      </p>
    </div>
  );
}

function Assumptions() {
  const rows: [string, string][] = [
    ["Priced", `Black-Scholes on ${P.underlying}, ${P.days["1m"]} days to expiry, a ${(P.rate * 100).toFixed(2)}% rate and a ${(P.dividendYield * 100).toFixed(2)}% dividend yield, both continuous`],
    ["25-delta put", `${num(P.put.iv)}% vol, strike solved at |Δ| = 0.25: ${strikeText(P.put.strike)} of spot, ${costText(P.put.cost)} of spot`],
    ["25-delta call", `${num(P.call.iv)}% vol, strike ${strikeText(P.call.strike)} of spot, ${costText(P.call.cost)} of spot`],
    ["At the money", TENORS.map((t) => `${num(P.implied[t])}% at ${TENOR_WORDS[t]} (${P.days[t]} days)`).join(" · ")],
    ["Skew", "the 25-delta put's vol less the 25-delta call's, 1 month out"],
    ["Realized", `close-to-close log returns, annualized by √252, over ${TENORS.map((t) => P.sessions[t]).join(", ")} sessions`],
    ["Where it sits", `the share of the last ${P.history.length} weekly readings at or below today's: ${P.atOrBelow} of ${P.history.length}`],
  ];
  return (
    <dl className="pr-assume">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProtectionCard() {
  const adv = useAdvanced();
  const entry = prototype("protection");
  const pct = Math.round(P.percentile * 100);
  return (
    <PrototypeCard
      id={entry.id}
      className="te-vol pr-protection"
      title={entry.title}
      production={entry.production}
      advanced={
        <AdvancedPanel enabled adv={adv} items="assumed volatilities · strikes · how realized and the percentile are read">
          <Assumptions />
        </AdvancedPanel>
      }
    >
      <p className="te-vol-sub pr-sub">S&amp;P 500 options on the {P.underlying} chain.</p>
      <div className="te-vol-sec">
        <Stat
          label={
            <>
              PUTS <span className="dk-lc">vs</span> CALLS · 1 MONTH OUT
            </>
          }
          value={`${signed(P.skew)} pts`}
          tone="amber"
          size="xl"
        />
        {/* desk/pdf-polish 3a: "richer", the desk's word ("cheaper" when the skew is below zero). */}
        <p className="te-vol-meaning">
          Puts are {num(Math.abs(P.skew))} vol points {P.skew < 0 ? "cheaper" : "richer"} than calls.
        </p>
        <table className="pr-sides">
          <caption className="dk-sr">The 25-delta put and call, 1 month out</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="dk-sr">Option</span>
              </th>
              <th scope="col">vol</th>
              <th scope="col">strike</th>
              <th scope="col">costs</th>
            </tr>
          </thead>
          <tbody>
            {(["put", "call"] as const).map((k) => (
              <tr key={k}>
                <th scope="row">25Δ {k}</th>
                <td>{num(P[k].iv)}%</td>
                <td>{strikeText(P[k].strike)}</td>
                <td>{costText(P[k].cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="te-vol-context">Strikes and costs as a share of spot, {P.days["1m"]} days out.</p>
      </div>
      <div className="te-vol-sec">
        <Stat
          label={
            <>
              WHAT OPTIONS EXPECT <span className="dk-lc">vs</span> WHAT HAPPENED
            </>
          }
          value={
            <>
              {num(P.implied["1m"])} <span className="te-vs">vs</span> {num(P.realized["1m"])}
            </>
          }
          size="xl"
        />
        <p className="te-vol-meaning">
          Options price {num(P.implied["1m"])}% a year of movement; the last {P.sessions["1m"]} sessions delivered {num(P.realized["1m"])}%.
        </p>
        <div className="dk-stat-label pr-tenors">1 MONTH · 3 MONTHS · 6 MONTHS</div>
        <ExpectBars />
      </div>
      <div className="te-vol-sec pr-where">
        <div className="dk-stat-label">SKEW · WHERE IT SITS</div>
        <p className="te-vol-meaning">
          <b>{ordinal(pct)} percentile</b> of two years
        </p>
        <SkewLine />
        <p className="pr-range">
          <span>
            low {num(P.low.pts)} · {monthYear(P.low.date)}
          </span>
          <span>
            high {num(P.high.pts)} · {monthYear(P.high.date)}
          </span>
        </p>
        <p className="te-vol-context">{capitalize(P.trend)}.</p>
      </div>
    </PrototypeCard>
  );
}
