/**
 * Basket & Hedge's "Positioning" (DESK_FRAME3_SPEC §10, §12.20; Desk P4, D7): two lagged public disclosures, served.
 *
 * - Futures: the CFTC's weekly Commitments of Traders for five macro markets, each market's speculative category
 *   (leveraged funds, managed money): net contracts, their share of open interest, the change from the report a
 *   week earlier, and where the share sits among the market's own reports of three years; each row dated by its
 *   positions date and its release.
 * - Holders: SEC Form 13F holder concentration for the basket's names, dated by the quarter the holdings are as of.
 *
 * Both say they are lagged disclosures, not live positioning. No crowding verdict is drawn: the card reports
 * positions and where they sit in their own history. Each block prints its own reason when it is not served.
 */

import { useId } from "react";
import { usePositioning, unavailableOf } from "../data/api";
import type { CotMarket, PositioningFutures, PositioningHoldings } from "../data/types";
import { dayLong, grouped, pctPlain } from "../kit/format";
import { AdvancedPanel, Awaiting, FailedLine, FailedScope, Signed, UnservedLine, useAdvanced } from "../kit/ui";
import { changeText, contracts, datesLine, historyLine, holdingsFor, percentileText, rangeLine, shareOfOi, sideWord } from "./positioning";
import type { SavedBasket } from "./weights";

const TITLE = "Positioning";
const SUB = "from public filings, lagged";

function FuturesTable({ f }: { f: PositioningFutures }) {
  return (
    <div className="pz-table-wrap" role="region" aria-label="Futures positioning, CFTC" tabIndex={0}>
      <table className="pz-table">
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Speculators</th>
            <th scope="col">Net, contracts</th>
            <th scope="col">Of open interest</th>
            <th scope="col">1-week change</th>
            <th scope="col">3-year percentile</th>
            <th scope="col">Report</th>
          </tr>
        </thead>
        <tbody>
          {f.markets.map((m) => (
            <tr key={m.key} data-market={m.key}>
              <th scope="row">{m.label}</th>
              <td className="pz-words">{m.category_label}</td>
              <td>
                <Signed value={m.net}>{contracts(m.net)}</Signed>
              </td>
              <td title={sideWord(m.net)}>{shareOfOi(m.net_pct_oi)}</td>
              <td title={m.change_1w ? `against the report of ${dayLong(m.change_1w.from)}` : (m.change_reason ?? undefined)}>{changeText(m)}</td>
              <td title={m.range_3y ? `of ${m.range_3y.n} weekly reports, ${dayLong(m.range_3y.from)} to ${dayLong(m.range_3y.to)}` : (m.range_reason ?? undefined)}>{percentileText(m)}</td>
              <td className="pz-words">{datesLine(m)}</td>
            </tr>
          ))}
          {f.missing.map((x) => (
            <tr key={x.key} data-market={x.key}>
              <th scope="row">{x.label}</th>
              <td colSpan={6} className="pz-words pz-muted">
                {x.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Categories({ m }: { m: CotMarket }) {
  return (
    <div className="pz-table-wrap" role="region" aria-label={`${m.label}, every category`} tabIndex={0}>
      <table className="pz-table">
        <caption className="pz-adv-line">
          {m.label} · every category, positions {dayLong(m.as_of)} · open interest {grouped(m.open_interest)} contracts
        </caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Long</th>
            <th scope="col">Short</th>
            <th scope="col">Spreading</th>
            <th scope="col">Net</th>
            <th scope="col">Of open interest</th>
          </tr>
        </thead>
        <tbody>
          {m.categories.map((c) => (
            <tr key={c.category}>
              <th scope="row">{c.label}</th>
              <td>{grouped(c.long)}</td>
              <td>{grouped(c.short)}</td>
              <td>{c.spread == null ? "—" : grouped(c.spread)}</td>
              <td>{contracts(c.net)}</td>
              <td>{shareOfOi(c.net_pct_oi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FuturesAdvanced({ f }: { f: PositioningFutures }) {
  return (
    <>
      <p className="pz-adv-line">
        Net is the category's long minus its short contracts, futures only. Its share of open interest is 100 × net ÷ open
        interest; spreading counts on both sides of open interest and in neither side of net. The percentile is the share of
        the market's weekly reports in the three years to this one whose share is at or below it (at least {f.range_min_reports} reports).
        The 1-week change is against the CFTC's previous weekly report, 6 to 8 days earlier.
      </p>
      {f.markets.map((m) => (
        <p key={`r-${m.key}`} className="pz-adv-line">
          {rangeLine(m)}
        </p>
      ))}
      {f.markets.map((m) => (
        <Categories key={`c-${m.key}`} m={m} />
      ))}
      {f.markets.map((m) => (
        <p key={`h-${m.key}`} className="pz-adv-line">
          {historyLine(m)}
        </p>
      ))}
      <p className="pz-adv-line">
        {f.revisions_stored ? `${grouped(f.revisions_stored)} corrected report rows kept with their earlier numbers.` : "No corrected report stored."} Source: {f.source}.
      </p>
    </>
  );
}

function Holdings({ h, symbols }: { h: PositioningHoldings; symbols: readonly string[] }) {
  const { rows, missing } = holdingsFor(h, symbols);
  return (
    <>
      <div className="pz-table-wrap" role="region" aria-label="13F holders of the basket's names" tabIndex={0}>
        <table className="pz-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">13F holders</th>
              <th scope="col">Change</th>
              <th scope="col">Top 10 hold</th>
              <th scope="col">In large filers' top 10</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <th scope="row">{r.symbol}</th>
                <td>{grouped(r.holders)}</td>
                <td>{r.holders_change == null ? "—" : contracts(r.holders_change)}</td>
                <td>{r.top10_share == null ? "—" : pctPlain(r.top10_share, 1)}</td>
                <td>
                  {r.large_filers_top10} of {h.large_filers_n}
                </td>
              </tr>
            ))}
            {missing.map((x) => (
              <tr key={x.symbol}>
                <th scope="row">{x.symbol}</th>
                <td colSpan={4} className="pz-words pz-muted">
                  {x.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pz-note">
        Holdings as of {dayLong(h.period)} · filed by {dayLong(h.deadline)}, filings read through {dayLong(h.filings_through)} · {h.lag_note}
      </p>
      <p className="pz-credit">{h.credit}</p>
    </>
  );
}

export function PositioningCard({ basket }: { basket: SavedBasket | null }) {
  const hid = useId();
  const adv = useAdvanced();
  const q = usePositioning();
  const scope = unavailableOf(q.error);
  const d = q.data;
  const futures = d?.futures ?? null;
  const holdings = d?.holdings ?? null;
  const futuresWhy = d?._blocks?.futures ?? null;
  const holdingsWhy = d?._blocks?.holdings ?? null;
  const symbols = basket?.legs.map((l) => l.symbol) ?? [];
  let futuresBody;
  if (scope) futuresBody = <UnservedLine block={scope} />;
  else if (q.isError) futuresBody = <FailedLine />;
  else if (!d)
    futuresBody = (
      <p className="dk-loading" role="status" aria-live="polite">
        Loading the stored reports…
      </p>
    );
  else if (futuresWhy) futuresBody = <UnservedLine block={futuresWhy} />;
  else if (!futures) futuresBody = <Awaiting />;
  else
    futuresBody = (
      <>
        <FuturesTable f={futures} />
        <p className="pz-note">{futures.lag_note}</p>
        <p className="pz-credit">{futures.credit}</p>
      </>
    );
  let holdingsBody = null;
  if (d && !scope) {
    if (holdingsWhy) holdingsBody = <UnservedLine block={holdingsWhy} />;
    else if (!holdings) holdingsBody = <Awaiting />;
    else if (!symbols.length) holdingsBody = <p className="pz-note">A saved basket's names are looked up here.</p>;
    else holdingsBody = <Holdings h={holdings} symbols={symbols} />;
  }
  return (
    <section className="dk-card bh-card pz-card" aria-labelledby={hid} aria-busy={!d && !q.isError} data-positioning={d ? "ready" : undefined}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id={hid}>
          {TITLE}
          <span className="dk-card-sub"> {SUB}</span>
        </h2>
      </div>
      <FailedScope q={q}>
        <div className="dk-card-body">
          <h3 className="pz-h">Macro futures · CFTC Commitments of Traders, weekly</h3>
          {futuresBody}
          {holdingsBody ? (
            <>
              <h3 className="pz-h">The basket's names · SEC Form 13F holders, quarterly</h3>
              {holdingsBody}
            </>
          ) : null}
        </div>
        {futures && !futuresWhy && !scope ? (
          <div className="dk-card-foot">
            <AdvancedPanel enabled adv={adv} items="how each figure is computed · each market's range and every category · what was read">
              <FuturesAdvanced f={futures} />
            </AdvancedPanel>
          </div>
        ) : null}
      </FailedScope>
    </section>
  );
}
