/**
 * The six designed shells (docs/desk/DESK_FRAME_SPEC.md §6): Launchpad,
 * Pitch Evaluation, Red Team, Macro / Regime, Basket Builder, Hedge
 * Simulator (S&P Internals went live in desk/frame-2, internals/). Real UI, labelled Designed: each has its layout, its
 * controls (reachable, holding local state, never inert to the keyboard) and
 * its empty states, plus one line naming what it reads once live. No fake
 * numbers anywhere: a result slot says what it is waiting for. Red Team and
 * Hedge Simulator list the positions saved on this device as their subject
 * (real data); everything downstream of the missing engine stays empty.
 */

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Segmented, Tag } from "../../../components";
import { Caption } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import { DESK_GROUPS, type DeskPage } from "../desk-sections";
import { EmptyState, Panel, ReadsNote } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { MARKET_SERIES } from "../positions/series";
import { usePositions } from "../positions/store";

const DESIGNED = <StatusBadge designed />;

/** A form whose Run does one honest thing: it records that a run was asked for. */
function useAttempt(): [boolean, (e: FormEvent) => void, () => void] {
  const [attempted, setAttempted] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
  };
  return [attempted, submit, () => setAttempted(false)];
}

function Waiting({ attempted, what, reads }: { attempted: boolean; what: string; reads: string }) {
  return <EmptyState title={attempted ? `Not run: ${what} has no data source yet.` : `Nothing to show yet.`}>{reads}</EmptyState>;
}

function PositionSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const { positions } = usePositions();
  return (
    <div className="mrr-desk-field">
      <label className="mrr-desk-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="mrr-desk-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{positions.length ? "Choose a saved position…" : "No positions saved on this device"}</option>
        {positions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.instrument} · {p.direction}
          </option>
        ))}
      </select>
      <p className="mrr-desk-hint">
        {positions.length ? "Positions saved on this device through the discipline gate." : (
          <>
            Promote one in <Link to="/desk/position-monitor">Position Monitor</Link> first.
          </>
        )}
      </p>
    </div>
  );
}

/* ── Launchpad ───────────────────────────────────────────────────────────── */
function Launchpad({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const [attempted, submit] = useAttempt();
  const live = DESK_GROUPS.flatMap((g) => g.pages).filter((p) => p.status === "live" && !p.href);
  return (
    <>
      <div className="mrr-desk-3">
        <Panel id="read-first" title="Read first" description="The desk's live pages, in the order the morning goes." badge={DESIGNED}>
          <ol className="mrr-desk-rows" style={{ paddingLeft: 0 }}>
            {live.map((p) => (
              <li key={p.slug} className="mrr-desk-row">
                <div>
                  <div className="mrr-desk-row-title">
                    <Link to={`/desk/${p.slug}`}>{p.label}</Link>
                  </div>
                  <div className="mrr-desk-row-sub">{p.blurb}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel id="rerun" title="Rerun today" description="Saved studies whose inputs moved since their last run." badge={DESIGNED}>
          <Waiting attempted={attempted} what="the rerun list" reads="Once live: the saved studies, each with the as-of of its inputs against the freshness report." />
        </Panel>
        <Panel id="fresh" title="Fresh since yesterday" description="Which sources advanced overnight." badge={DESIGNED}>
          <Waiting attempted={attempted} what="the overnight diff" reads="Once live: the watermark table's advanced_at stamps against the previous session." />
        </Panel>
      </div>
      {!isClient ? (
        <form className="mrr-desk-actions" onSubmit={submit}>
          <button type="submit" className="mrr-btn mrr-btn-primary">
            Start the morning route
          </button>
          <span className="mrr-desk-hint">Opens each live page in turn once the route is wired; for now it marks the panels above.</span>
        </form>
      ) : null}
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

/* ── Pitch Evaluation ────────────────────────────────────────────────────── */
const RUBRIC = [
  { id: "variant", label: "Variant view", hint: "Is the view different from consensus, and is the difference stated?" },
  { id: "base", label: "Base rate", hint: "Does the pitch name the historical odds of this kind of call?" },
  { id: "falsify", label: "Falsifiability", hint: "Is there a level or date at which the pitch is wrong?" },
  { id: "calibration", label: "Calibration", hint: "Are the claims sized to the evidence, without certainty words?" },
];

function PitchEvaluation({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const uid = useId();
  const [scores, setScores] = useState<Record<string, string>>({});
  const [attempted, submit] = useAttempt();
  return (
    <>
      {!isClient ? (
        <Panel id="pitch" title="The pitch" description="Instrument, direction and the thesis in the pitcher's words." badge={DESIGNED}>
          <form className="mrr-desk-form" onSubmit={submit}>
            <div className="mrr-desk-fields">
              <div className="mrr-desk-field">
                <label className="mrr-desk-label" htmlFor={`${uid}-i`}>
                  Instrument
                </label>
                <input id={`${uid}-i`} className="mrr-desk-input" placeholder="e.g. long 2s10s steepener" autoComplete="off" />
              </div>
              <div className="mrr-desk-field">
                <label className="mrr-desk-label" htmlFor={`${uid}-h`}>
                  Horizon
                </label>
                <select id={`${uid}-h`} className="mrr-desk-input" defaultValue="3 months">
                  {["1 month", "3 months", "6 months", "12 months"].map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div className="mrr-desk-field" data-span="2">
                <label className="mrr-desk-label" htmlFor={`${uid}-t`}>
                  Thesis
                </label>
                <textarea id={`${uid}-t`} className="mrr-desk-input" placeholder="The pitch as it was made." />
              </div>
            </div>
            <div className="mrr-desk-rows" role="group" aria-label="Rubric">
              {RUBRIC.map((r) => (
                <div key={r.id} className="mrr-desk-row">
                  <div>
                    <div className="mrr-desk-row-title" id={`${uid}-${r.id}`}>
                      {r.label}
                    </div>
                    <div className="mrr-desk-row-sub">{r.hint}</div>
                  </div>
                  <Segmented label={`${r.label} score`} mono options={["0", "1", "2", "3"].map((s) => ({ id: s, label: s }))} value={scores[r.id] ?? ""} onChange={(v) => setScores((s) => ({ ...s, [r.id]: v }))} aria-describedby={`${uid}-${r.id}`} />
                </div>
              ))}
            </div>
            <div className="mrr-desk-actions">
              <button type="submit" className="mrr-btn mrr-btn-primary">
                Score the pitch
              </button>
              <span className="mrr-desk-hint">Scores are 0 to 3 per criterion; the weights and the base rates arrive with the engine.</span>
            </div>
          </form>
        </Panel>
      ) : null}
      <Panel id="pitch-result" title="Evaluation" badge={DESIGNED}>
        <Waiting attempted={attempted} what="the evaluation" reads="Once live: the weighted score, the base rate for this kind of call from the event-study engine, and the language check's flags." />
      </Panel>
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

/* ── Red Team ─────────────────────────────────────────────────────────────── */
function RedTeam({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const uid = useId();
  const [pos, setPos] = useState("");
  const [attempted, submit] = useAttempt();
  return (
    <>
      {!isClient ? (
        <Panel id="subject" title="Subject" description="The position to argue against, from the ones saved on this device." badge={DESIGNED}>
          <form className="mrr-desk-form" onSubmit={submit}>
            <div className="mrr-desk-fields">
              <PositionSelect id={`${uid}-p`} label="Position" value={pos} onChange={setPos} />
            </div>
            <div className="mrr-desk-actions">
              <button type="submit" className="mrr-btn mrr-btn-primary" disabled={!pos} aria-disabled={!pos}>
                Argue against it
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
      <div className="mrr-desk-2">
        <Panel id="counter" title="Strongest counter-case" description="The best argument the other side has, from the same data." badge={DESIGNED}>
          <Waiting attempted={attempted} what="the counter-case" reads="Once live: the regime odds against the thesis, the analogue set's contrary episodes and the pre-mortem's own reasons, composed in calibrated words." />
        </Panel>
        <Panel id="would-change" title="What would change the call" description="The readings that would move the position from wrong to right." badge={DESIGNED}>
          <Waiting attempted={attempted} what="the change list" reads="Once live: the falsification series and the regime inputs, each with its current distance." />
        </Panel>
      </div>
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

/* ── Macro / Regime ──────────────────────────────────────────────────────── */
function MacroRegime({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const [horizon, setHorizon] = useState("3");
  return (
    <>
      <div className="mrr-desk-2">
        <Panel id="odds" title="Regime odds" description="The classifier's four probabilities and the month they describe." badge={DESIGNED}>
          <EmptyState title="Nothing to show yet.">Once live: the stored odds from /api/regime/latest as the house stacked bar, one number one truth; the Dashboard prints them today.</EmptyState>
        </Panel>
        <Panel
          id="transitions"
          title="Transition outlook"
          badge={DESIGNED}
          actions={!isClient ? <Segmented label="Horizon (months)" mono options={["1", "3", "6"].map((h) => ({ id: h, label: `${h}m` }))} value={horizon} onChange={setHorizon} /> : null}
        >
          <EmptyState title="Nothing to show yet.">Once live: /api/regime/transitions at the chosen horizon, counted from the stored monthly history.</EmptyState>
        </Panel>
      </div>
      <Panel id="inputs" title="Inputs and release calendar" description="The three monthly inputs, their newest print and the rule that dates the next one." badge={DESIGNED}>
        <ul className="mrr-desk-rows">
          {[
            ["Industrial production", "INDPRO", "G.17, mid-month"],
            ["CPI (all items)", "CPIAUCSL", "BLS, around the 10th to 15th"],
            ["Unemployment rate", "UNRATE", "Employment Situation, first Friday"],
          ].map(([label, id, rule]) => (
            <li key={id} className="mrr-desk-row">
              <div>
                <div className="mrr-desk-row-title">{label}</div>
                <div className="mrr-desk-row-sub">
                  {id} · {rule}
                </div>
              </div>
              <div className="mrr-desk-row-sub">newest print: once live, from the regime freshness block</div>
            </li>
          ))}
        </ul>
      </Panel>
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

/* ── Basket Builder ──────────────────────────────────────────────────────── */
function BasketBuilder({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const uid = useId();
  const [members, setMembers] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [weighting, setWeighting] = useState("equal");
  const [attempted, submit, reset] = useAttempt();
  const add = () => {
    if (pick && !members.includes(pick)) setMembers((m) => [...m, pick]);
    setPick("");
    reset();
  };
  return (
    <>
      {!isClient ? (
        <Panel id="compose" title="Compose" description="Members from the stored universe; a weighting rule; Build." badge={DESIGNED}>
          <form className="mrr-desk-form" onSubmit={submit}>
            <div className="mrr-desk-fields">
              <div className="mrr-desk-field">
                <label className="mrr-desk-label" htmlFor={`${uid}-s`}>
                  Add a member
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select id={`${uid}-s`} className="mrr-desk-input" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Stored symbols…</option>
                    {MARKET_SERIES.filter((s) => !members.includes(s.id)).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="mrr-btn" onClick={add} disabled={!pick} aria-disabled={!pick}>
                    Add
                  </button>
                </div>
              </div>
              <div className="mrr-desk-field">
                <span className="mrr-desk-label" id={`${uid}-w`}>
                  Weighting
                </span>
                <Segmented label="Weighting" options={[{ id: "equal", label: "Equal" }, { id: "invvol", label: "Inverse volatility" }]} value={weighting} onChange={setWeighting} aria-describedby={`${uid}-w`} />
              </div>
            </div>
            <div className="mrr-desk-actions" aria-live="polite">
              {members.length ? (
                members.map((m) => (
                  <Tag key={m} tone="reference" uppercase={false}>
                    {m}
                    <button type="button" className="mrr-desk-flag-x" onClick={() => setMembers((xs) => xs.filter((x) => x !== m))} aria-label={`Remove ${m}`} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", marginLeft: 6, padding: 0 }}>
                      ×
                    </button>
                  </Tag>
                ))
              ) : (
                <span className="mrr-desk-hint">No members yet.</span>
              )}
            </div>
            <div className="mrr-desk-actions">
              <button type="submit" className="mrr-btn mrr-btn-primary" disabled={members.length < 2} aria-disabled={members.length < 2}>
                Build basket
              </button>
              <span className="mrr-desk-hint">Two members or more.</span>
            </div>
          </form>
        </Panel>
      ) : null}
      <Panel id="basket-history" title="Basket history by regime" description="The basket's monthly return in each regime, against the S&P 500." badge={DESIGNED}>
        <Waiting attempted={attempted} what="the basket history" reads="Once live: stored daily bars for the members, resampled monthly and joined to the regime history." />
      </Panel>
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

/* ── Hedge Simulator ─────────────────────────────────────────────────────── */
function HedgeSimulator({ page, isClient }: { page: DeskPage; isClient: boolean }) {
  const uid = useId();
  const [pos, setPos] = useState("");
  const [hedge, setHedge] = useState("");
  const [ratio, setRatio] = useState("1.0");
  const [attempted, submit] = useAttempt();
  const ready = Boolean(pos && hedge && Number.isFinite(Number(ratio)));
  return (
    <>
      {!isClient ? (
        <Panel id="hedge" title="Hedge" description="A saved position, an instrument to hedge it with, and the ratio." badge={DESIGNED}>
          <form className="mrr-desk-form" onSubmit={submit}>
            <div className="mrr-desk-fields">
              <PositionSelect id={`${uid}-p`} label="Position" value={pos} onChange={setPos} />
              <div className="mrr-desk-field">
                <label className="mrr-desk-label" htmlFor={`${uid}-h`}>
                  Hedge instrument
                </label>
                <select id={`${uid}-h`} className="mrr-desk-input" value={hedge} onChange={(e) => setHedge(e.target.value)}>
                  <option value="">Stored symbols…</option>
                  {MARKET_SERIES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mrr-desk-field">
                <label className="mrr-desk-label" htmlFor={`${uid}-r`}>
                  Hedge ratio
                </label>
                <input id={`${uid}-r`} className="mrr-desk-input" data-mono="true" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} aria-invalid={!Number.isFinite(Number(ratio)) ? true : undefined} />
                <p className="mrr-desk-hint">Units of hedge per unit of position.</p>
              </div>
            </div>
            <div className="mrr-desk-actions">
              <button type="submit" className="mrr-btn mrr-btn-primary" disabled={!ready} aria-disabled={!ready}>
                Simulate
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
      <div className="mrr-desk-2">
        <Panel id="residual" title="Residual by regime" description="What is left of the position's monthly moves after the hedge, in each regime." badge={DESIGNED}>
          <Waiting attempted={attempted} what="the residual" reads="Once live: stored bars for both legs joined to the regime history; the transition odds weight the forward view." />
        </Panel>
        <Panel id="carry" title="Cost of carry" description="What the hedge costs to hold over the position's horizon." badge={DESIGNED}>
          <Waiting attempted={attempted} what="carry" reads="Once live: the funding rate from FEDFUNDS or SOFR and the hedge's own yield." />
        </Panel>
      </div>
      <ReadsNote>{page.reads}</ReadsNote>
    </>
  );
}

export default function DesignedShellPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  let body: ReactNode;
  switch (page.slug) {
    case "launchpad":
      body = <Launchpad page={page} isClient={isClient} />;
      break;
    case "pitch-evaluation":
      body = <PitchEvaluation page={page} isClient={isClient} />;
      break;
    case "red-team":
      body = <RedTeam page={page} isClient={isClient} />;
      break;
    case "macro-regime":
      body = <MacroRegime page={page} isClient={isClient} />;
      break;
    case "basket-builder":
      body = <BasketBuilder page={page} isClient={isClient} />;
      break;
    case "hedge-simulator":
      body = <HedgeSimulator page={page} isClient={isClient} />;
      break;
    default:
      body = (
        <Panel title={page.label} badge={DESIGNED}>
          <EmptyState title="Nothing to show yet.">{page.reads}</EmptyState>
        </Panel>
      );
  }
  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} description={page.blurb} badge={<StatusBadge designed note={page.reads} />} />
      {body}
      {!isClient ? <Caption as="p">Designed shell: layout, controls and empty states are real; no number on this page is data.</Caption> : null}
    </div>
  );
}
