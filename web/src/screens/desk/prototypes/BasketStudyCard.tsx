/**
 * Basket & Hedge's "Event study on this basket" as a PROTOTYPE card
 * (DESK_FRAME3_SPEC §10, §1.0.3), styled as an Event Study answer (§4): the
 * question in serif, events, how often the basket was up a month later, the
 * median against a normal month, the verdict, and the horizon chart the Event
 * Study draws. Illustrative values from proto-basket-study.json
 * (./basket-study.ts), drawn for the sample basket alone.
 */

import type { SavedBasket } from "../basket/weights";
import { Bars } from "../event-study/AnswerCard";
import { dayLong, monthYear, pctPlain, year } from "../kit/format";
import { PrototypeCard } from "../kit/Prototype";
import { moveText, tipOf } from "../kit/units";
import { AdvancedPanel, Signed, Stat, StatRow, useAdvanced, VerdictPill } from "../kit/ui";
import { basketStudy, isSampleBasket, SAMPLE_NAME, type BasketStudy } from "./basket-study";
import { prototype } from "./registry";
import "./prototypes.css";

const UNIT = "log_return" as const;
const TIP = tipOf(UNIT);
const move = (v: number | null) => moveText(v, UNIT) ?? "—";

/** §12.2's why, over the month's row. */
function why(st: BasketStudy): string {
  const m = st.month;
  return `${m.n} completed outcomes in ${m.n_blocks} overlap blocks; the 90% interval on the excess median runs ${move(m.ci_lo)} to ${move(m.ci_hi)}; ${(m.adverse_share * 100).toFixed(1)}% of resampled medians are adverse against a 3% bar.`;
}

/** Rule v1 at a month (§1.5), in words from the card's own numbers. */
function verdictWhy(st: BasketStudy): string {
  const m = st.month;
  if (m.n < 10) return `${m.n} outcomes at a month, fewer than ten: Too few.`;
  const excl = m.n_blocks >= 10 && ((m.ci_lo ?? 0) > 0 || (m.ci_hi ?? 0) < 0) && m.adverse_share < 0.03;
  if (excl) return `${m.n} outcomes in ${m.n_blocks} blocks, the interval on one side of zero and under 3% adverse: the engine's 90% exclusion holds, Reliable.`;
  const lean = st.horizons.filter((h) => h.h <= 20).map((h) => (h.median ?? 0) - (h.baseline_median ?? 0));
  const same = lean.every((v) => v > 0) || lean.every((v) => v < 0);
  return `${m.n} outcomes, ten or more; the engine's 90% exclusion does not hold (${(m.ci_lo ?? 0) < 0 && (m.ci_hi ?? 0) > 0 ? "the interval spans zero" : "under 3% adverse is not met"}); the excess medians at a week, two weeks and a month ${same ? `all lean ${lean[0] > 0 ? "up" : "down"}: Suggestive` : "do not lean the same way: No edge"}.`;
}

function Horizons({ st }: { st: BasketStudy }) {
  return (
    <div className="pr-table-wrap" role="region" aria-label="Every horizon" tabIndex={0}>
      <table className="pr-table">
        <thead>
          <tr>
            <th scope="col">Horizon</th>
            <th scope="col">Events</th>
            <th scope="col">Up</th>
            <th scope="col">Median</th>
            <th scope="col">Normal</th>
            <th scope="col">90% interval, excess</th>
          </tr>
        </thead>
        <tbody>
          {st.horizons.map((h) => (
            <tr key={h.h}>
              <th scope="row">{h.label}</th>
              <td>{h.n}</td>
              <td>{pctPlain(h.up_pct ?? NaN)}</td>
              <td title={TIP}>{move(h.median)}</td>
              <td title={TIP}>{move(h.baseline_median)}</td>
              <td title={TIP}>
                {move(h.ci_lo)} to {move(h.ci_hi)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BasketStudyCard({ basket }: { basket: SavedBasket }) {
  const adv = useAdvanced();
  const entry = prototype("basket-study");
  const legs = basket.legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) }));
  const labels = ["Events", "Up a month later", "Median at a month", "Verdict"];
  if (!isSampleBasket(legs))
    return (
      <PrototypeCard id={entry.id} className="bh-card pr-study" title={entry.title} sub="after a 2σ fall over 5 days" production={entry.production}>
        <StatRow cols={4}>
          {labels.map((l) => (
            <Stat key={l} label={l} value="—" size="sm" />
          ))}
        </StatRow>
        <p className="pr-why">Illustrative values are drawn for the {SAMPLE_NAME} sample basket; open it to see this card filled.</p>
      </PrototypeCard>
    );
  const st = basketStudy();
  const m = st.month;
  return (
    <PrototypeCard
      id={entry.id}
      className="bh-card pr-study"
      title={entry.title}
      sub={`after a 2σ fall over ${st.window} days`}
      production={entry.production}
      advanced={
        <AdvancedPanel enabled adv={adv} items="every horizon · the verdict's rule · the index">
          <Horizons st={st} />
          <p className="pr-adv-line">Verdict: {verdictWhy(st)}</p>
          <p className="pr-adv-line">
            The index: {st.indexRule}, from {monthYear(st.indexFrom)}. A shock is the 5-day log return's z over 252 sessions at or below −2; after an event the next {st.cooldown} sessions are skipped.
          </p>
        </AdvancedPanel>
      }
    >
      <p className="es-headline pr-study-q">
        After this basket falls 2σ over {st.window} days, it was higher a month later {pctPlain(m.up_pct ?? NaN)} of the time.
      </p>
      <StatRow cols={4}>
        <Stat label="Events" value={String(st.matchedN)} sub={`${m.n} complete at a month`} size="sm" />
        <Stat label="Up a month later" value={pctPlain(m.up_pct ?? NaN)} tone={(m.up_pct ?? 0) > 0.5 ? "up" : undefined} sub={`${m.up_n} of ${m.n} · ${pctPlain(m.baseline_up_pct)} in a normal month`} size="sm" />
        <Stat
          label="Median at a month"
          value={
            <Signed value={m.median ?? 0} title={TIP}>
              {move(m.median)}
            </Signed>
          }
          sub={
            <>
              vs <span title={TIP}>{move(m.baseline_median)}</span> in a normal month
            </>
          }
          size="sm"
        />
        <Stat label="Verdict" value={<VerdictPill verdict={st.verdict} />} sub="at a month" size="sm" />
      </StatRow>
      <Bars horizons={st.horizons} unit={UNIT} />
      <p className="es-legend" aria-hidden="true">
        <span>
          <i className="pr-key-blue" /> after the event
        </span>
        <span>
          <i className="pr-key-gray" /> a normal stretch
        </span>
        <span>
          <b className="pr-key-whisker">┬</b> range the answer could fall in
        </span>
      </p>
      <p className="pr-study-why">{why(st)}</p>
      <p className="pr-study-prov">
        {st.matchedN} events since {year(st.sampleStart)} · the basket's index from {monthYear(st.indexFrom)} · last event {dayLong(st.lastEvent)}
      </p>
    </PrototypeCard>
  );
}
