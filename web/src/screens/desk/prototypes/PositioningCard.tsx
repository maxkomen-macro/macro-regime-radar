/**
 * Basket & Hedge's "Positioning" as a PROTOTYPE card (DESK_FRAME3_SPEC §10,
 * §1.0.3): per name in the open basket, short interest as a share of float,
 * days to cover, the put/call open-interest ratio and a crowding flag, and the
 * basket's weighted figures above them. Illustrative values from
 * proto-positioning.json (./positioning.ts); the Advanced section states the
 * flag's rule and each name's 13F share.
 */

import type { SavedBasket } from "../basket/weights";
import { PrototypeCard } from "../kit/Prototype";
import { AdvancedPanel, Stat, StatRow, useAdvanced } from "../kit/ui";
import { CROWDING_WORDS, positioning, type Positioning } from "./positioning";
import { prototype } from "./registry";
import "./prototypes.css";

const legsOf = (b: SavedBasket) => b.legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) }));
const one = (x: number) => x.toFixed(1);

function Rules({ p }: { p: Positioning }) {
  return (
    <>
      <dl className="pr-assume">
        <div>
          <dt>Crowded short</dt>
          <dd>short interest at or above {p.rules.shortSi}% of float</dd>
        </div>
        <div>
          <dt>Crowded long</dt>
          <dd>otherwise, when at least {p.rules.longTop10}% of the funds a 13F sample tracks hold the name in their top ten</dd>
        </div>
        <div>
          <dt>Short interest</dt>
          <dd>the exchanges' mid-month short position over the float; days to cover divides it by 20-day average volume</dd>
        </div>
        <div>
          <dt>Put/call</dt>
          <dd>open interest in puts over calls, every listed expiry</dd>
        </div>
        <div>
          <dt>Basket</dt>
          <dd>each name with data weighted by its share of the basket; a name without data is listed, not counted</dd>
        </div>
      </dl>
      <p className="pr-adv-line">
        13F top-ten share: {p.rows.map((r) => `${r.symbol} ${r.top10}%`).join(" · ")}
      </p>
    </>
  );
}

/** A weight in percent as the basket holds it: "50%", "52.5%". */
const pctText = (x: number) => `${Number.isInteger(x) ? x : Number(x.toFixed(1))}%`;

/** What the weighted figures cover (Codex R-01): all the names, or the weight and the names with data. */
export function coverageWords(p: Positioning): string {
  const n = p.rows.length + p.missing.length;
  if (!p.rows.length) return "no name with data";
  if (!(Number.isFinite(p.coveredWeight) && p.coveredWeight > 0)) return `the names with data carry ${pctText(Number.isFinite(p.coveredWeight) ? p.coveredWeight : 0)} of the basket`;
  if (!p.missing.length) return `weighted over all ${n} names`;
  return `weighted over ${pctText(p.coveredWeight)} of the basket (${p.rows.length} of ${n} names)`;
}

export function PositioningCard({ basket }: { basket: SavedBasket }) {
  const adv = useAdvanced();
  const entry = prototype("positioning");
  const p = positioning(legsOf(basket));
  const covered = coverageWords(p);
  const weighted = p.weightedSi != null;
  return (
    <PrototypeCard
      id={entry.id}
      className="bh-card pr-positioning"
      title={entry.title}
      sub="who is short, and who is crowded in"
      production={entry.production}
      advanced={
        <AdvancedPanel enabled={p.rows.length > 0} adv={adv} items="the crowding rule · each name's 13F share · what the figures cover">
          <Rules p={p} />
        </AdvancedPanel>
      }
    >
      <StatRow cols={3}>
        <Stat label="Short interest" value={weighted && p.weightedSi != null ? `${one(p.weightedSi)}%` : "—"} sub={weighted ? `of float, ${covered}` : covered} size="sm" />
        <Stat label="Days to cover" value={p.weightedDtc != null ? one(p.weightedDtc) : "—"} sub={covered} size="sm" />
        {/* Crowding is per name: counted among the names with data only, never with a name that has none. */}
        <Stat label="Crowded" value={p.rows.length ? `${p.flagged} of ${p.rows.length}` : "—"} sub={p.rows.length ? `names with data${p.missing.length ? `; ${p.missing.length} without` : ""}` : "no name with data"} size="sm" />
      </StatRow>
      <div className="pr-table-wrap" role="region" aria-label="Each name, its short interest and open interest" tabIndex={0}>
        <table className="pr-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Weight</th>
              <th scope="col">
                Short int. <span className="pr-th-note">(illustrative)</span>
              </th>
              <th scope="col">
                Days to cover <span className="pr-th-note">(illustrative)</span>
              </th>
              <th scope="col">
                Put/call OI <span className="pr-th-note">(illustrative)</span>
              </th>
              <th scope="col">Crowding</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.symbol}>
                <th scope="row">
                  {r.symbol}
                  {r.name ? <span className="pr-muted pr-name"> {r.name}</span> : null}
                </th>
                <td>{r.weight}%</td>
                <td>{one(r.si)}%</td>
                <td>{one(r.dtc)}</td>
                <td>{r.putCall.toFixed(2)}</td>
                <td>{r.flag ? <span className="pr-flag">{CROWDING_WORDS[r.flag]}</span> : <span className="pr-muted">none</span>}</td>
              </tr>
            ))}
            {p.missing.map((l) => (
              <tr key={l.symbol}>
                <th scope="row">{l.symbol}</th>
                <td>{l.weight}%</td>
                <td colSpan={4} className="pr-muted pr-left">
                  no data
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PrototypeCard>
  );
}
