/**
 * Basket & Hedge's "Event study on this basket" (DESK_FRAME3_SPEC §10, §12.19; desk P1a), styled as an Event Study
 * answer (§4): the question in serif, events, how often the basket was up a month later, the median against a
 * normal month, the engine's verdict, and the horizon chart the Event Study draws. Every number is `/basket/study`'s:
 * the existing engine run on the saved basket's own index (the page's rule, over EODHD's closes since 1995). The index
 * line states the basket as the page defines it (names, weighting, rebalancing, start); the caveats say what the
 * history cannot claim (the basket is chosen today; the regime labels are revised history). A basket whose index is
 * too short for the question prints the route's reason and no number.
 */

import { useId } from "react";
import type { BasketParams, SavedBasket } from "./weights";
import { unavailableOf, useBasketStudy } from "../data/api";
import type { BasketStudyResponse, StudyHorizon } from "../data/types";
import { Bars, horizonPhrase, normalStretch } from "../event-study/AnswerCard";
import { dayLong, pctPlain, year } from "../kit/format";
import { moveText, tipOf } from "../kit/units";
import { AdvancedPanel, FailedLine, FailedScope, Signed, Stat, StatRow, UnservedLine, useAdvanced, VerdictPill } from "../kit/ui";
import { indexLine, questionLine, selectedRow, studyParams } from "./study";

const TITLE = "Event study on this basket";
const UNIT = "log_return" as const;
const TIP = tipOf(UNIT);
const move = (v: number | null | undefined) => moveText(v ?? null, UNIT) ?? "—";
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? pctPlain(v) : "—");

function Horizons({ rows }: { rows: StudyHorizon[] }) {
  return (
    <div className="bs-table-wrap" role="region" aria-label="Every horizon" tabIndex={0}>
      <table className="bs-table">
        <thead>
          <tr>
            <th scope="col">Horizon</th>
            <th scope="col">Events</th>
            <th scope="col">Up</th>
            <th scope="col">Median</th>
            <th scope="col">Normal</th>
            <th scope="col">90% interval, excess</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.h}>
              <th scope="row">{h.label}</th>
              <td>{h.n ?? "—"}</td>
              <td>{pct(h.up_pct)}</td>
              <td title={TIP}>{move(h.median)}</td>
              <td title={TIP}>{move(h.baseline_median)}</td>
              <td title={TIP}>{h.ci_lo == null || h.ci_hi == null ? (h.reason ?? "—") : `${move(h.ci_lo)} to ${move(h.ci_hi)}`}</td>
              <td>
                <VerdictPill verdict={h.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The by-regime rows, labelled as the revised regime history they read (P-1). */
function ByRegime({ a }: { a: BasketStudyResponse }) {
  const s = a.study!;
  return (
    <div className="bs-table-wrap" role="region" aria-label="By regime, revised regime history" tabIndex={0}>
      <table className="bs-table">
        <caption className="bs-adv-line">By regime at a month · Revised regime history: each label is the regimes table as revised today, not what was knowable then.</caption>
        <thead>
          <tr>
            <th scope="col">Regime</th>
            <th scope="col">Events</th>
            <th scope="col">Up</th>
            <th scope="col">Median</th>
          </tr>
        </thead>
        <tbody>
          {s.by_regime.map((r) => (
            <tr key={r.regime}>
              <th scope="row">{r.regime}</th>
              <td>{r.n ?? "—"}</td>
              <td>{pct(r.up_pct)}</td>
              <td title={TIP}>{move(r.median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the index is and what it left out, in counts, for the Advanced panel. */
function IndexDetail({ a }: { a: BasketStudyResponse }) {
  const ix = a.index;
  const off = Object.entries(ix.off_session).filter(([, n]) => (n ?? 0) > 0);
  const lines = [
    `Sessions: ${ix.sessions ?? "—"} from ${dayLong(ix.start)} to ${dayLong(ix.end)}; ${ix.missing_sessions ?? "—"} inside the span without every name's close, left out, never filled.`,
    `Closes asked from ${dayLong(ix.requested_from)} through ${dayLong(ix.session)}; each name's first close: ${Object.entries(ix.first_close).map(([s, d]) => `${s} ${dayLong(d)}`).join(", ")}.`,
    off.length ? `Bars dated off the NYSE calendar, left out: ${off.map(([s, n]) => `${s} ${n}`).join(", ")}.` : null,
    ix.excluded.length ? `Closes without an adjusted value, left out: ${ix.excluded.map((e) => `${e.symbol} ${e.n ?? "—"}`).join(", ")}.` : null,
    ix.moved_rebalances.length ? `Monthly rebalances held before a month-end some name had no close on: ${ix.moved_rebalances.map(dayLong).join(", ")}.` : null,
    a.study ? `Engine: ${a.study.provenance.calendar}; entry ${a.study.provenance.entry_rule}; cooldown ${a.study.provenance.cooldown ?? "—"} sessions; seed ${a.study.provenance.seed ?? "—"}; inputs ${a.study.inputs_hash}.` : null,
    ...(a.study?.warnings ?? []),
  ].filter((l): l is string => !!l);
  return (
    <>
      {lines.map((l) => (
        <p key={l} className="bs-adv-line">
          {l}
        </p>
      ))}
    </>
  );
}

function Caveats({ a }: { a: BasketStudyResponse }) {
  return (
    <ul className="bs-caveats" aria-label="What this history cannot claim">
      {a.caveats.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}

function Answer({ basket, a }: { basket: SavedBasket; a: BasketStudyResponse }) {
  const adv = useAdvanced();
  const s = a.study;
  if (!s)
    return (
      <>
        <p className="bs-why" role="status">
          {a.not_run ?? "The study was not run."}
        </p>
        <p className="bs-prov">{indexLine(a)}</p>
        <Caveats a={a} />
      </>
    );
  const row = selectedRow(a);
  const h = row?.h ?? s.selected_horizon ?? a.question.horizon;
  return (
    <>
      <p className="es-headline bs-q">{questionLine(basket.name, a, pctPlain)}</p>
      <StatRow cols={4}>
        <Stat label="Events" value={String(s.matched_n ?? "—")} sub={`${row?.n ?? "—"} complete at ${horizonPhrase(h)}`} size="sm" />
        <Stat
          label={`Up ${horizonPhrase(h)} later`}
          value={pct(row?.up_pct)}
          tone={(row?.up_pct ?? 0) > 0.5 ? "up" : undefined}
          sub={`${row?.up_n ?? "—"} of ${row?.n ?? "—"} · ${pct(row?.baseline_up_pct)} ${normalStretch(h)}`}
          size="sm"
        />
        <Stat
          label={`Median at ${horizonPhrase(h)}`}
          value={
            <Signed value={row?.median ?? 0} title={TIP}>
              {move(row?.median)}
            </Signed>
          }
          sub={
            <>
              vs <span title={TIP}>{move(row?.baseline_median)}</span> {normalStretch(h)}
            </>
          }
          size="sm"
        />
        <Stat label="Verdict" value={<VerdictPill verdict={s.verdict} />} sub={`at ${horizonPhrase(h)}`} size="sm" />
      </StatRow>
      {s.empty_state ? (
        <p className="bs-why">{s.empty_state.sentence}</p>
      ) : (
        <>
          <Bars horizons={s.horizons} unit={UNIT} />
          <p className="es-legend" aria-hidden="true">
            <span>
              <i className="bs-key-blue" /> after the event
            </span>
            <span>
              <i className="bs-key-gray" /> a normal stretch
            </span>
            <span>
              <b className="bs-key-whisker">┬</b> range the answer could fall in
            </span>
          </p>
        </>
      )}
      <p className="bs-study-why">{s.why}</p>
      <p className="bs-prov">
        {s.matched_n ?? "—"} events since {year(s.sample_start)} · last event {dayLong(s.last_event)}
      </p>
      <p className="bs-prov">{indexLine(a)}</p>
      <Caveats a={a} />
      <div className="dk-card-foot">
        <AdvancedPanel enabled adv={adv} items="every horizon · by regime · the index">
          <Horizons rows={s.horizons} />
          <p className="bs-adv-line">Verdict: {s.headline} (rule {s.verdict_rule} at {Math.round((s.verdict_confidence ?? 0.9) * 100)}%, the engine's).</p>
          <ByRegime a={a} />
          {s.unlabeled_n ? <p className="bs-adv-line">{s.unlabeled_n} events have no regime label yet and are counted in none.</p> : null}
          <IndexDetail a={a} />
        </AdvancedPanel>
      </div>
    </>
  );
}

export function BasketStudyCard({ basket, params }: { basket: SavedBasket; params: BasketParams | null }) {
  const hid = useId();
  const q = useBasketStudy(studyParams(params));
  const block = unavailableOf(q.error);
  const a = q.data;
  const sub = a ? `after a 2σ ${a.question.move === "up2s" ? "rise" : "fall"} over ${a.question.window ?? 5} days` : "after a 2σ fall over 5 days";
  let body;
  if (!params) body = <p className="bs-why">A saved basket at exactly 100% is studied here.</p>;
  else if (block) body = <UnservedLine block={block} />;
  else if (q.isError) body = <FailedLine />;
  else if (!a)
    body = (
      <p className="dk-loading" role="status" aria-live="polite">
        Computing the study on the basket's index…
      </p>
    );
  else body = <Answer basket={basket} a={a} />;
  return (
    <section className="dk-card bh-card bs-study" aria-labelledby={hid} aria-busy={!!params && !a && !q.isError} data-basket-study={a ? (a.study ? "ready" : "not-run") : undefined}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id={hid}>
          {TITLE}
          <span className="dk-card-sub"> {sub}</span>
        </h2>
      </div>
      <FailedScope q={q}>
        <div className="dk-card-body">{body}</div>
      </FailedScope>
    </section>
  );
}
