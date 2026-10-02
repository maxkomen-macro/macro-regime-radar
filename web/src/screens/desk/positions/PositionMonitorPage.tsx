/**
 * Position Monitor (DESK_FRAME3_SPEC §9, screens/08-position-monitor.png):
 * promote an idea to a position only through the discipline gate, then watch
 * how far each position is from being wrong. Desk-only (no Client toggle).
 * Positions live in this browser (§1.8, v3 §16, v4 B-10): nothing is posted.
 *
 * Left: the Promote form (instrument, direction, size as % of NAV, horizon)
 * carried in from Event Study (`?from=<preset>` names the study, or the six
 * slots spell it; the instrument starts as the study's target and the horizon
 * as its horizon, nothing else is filled), and the gate: three short answers
 * (variant view, pre-mortem, a "wrong if" level) and an optional red team,
 * the WORDING check whose certainty words alone block, and Save, disabled
 * until the gate is complete, naming what is left. Save applies §9's rule
 * and keeps the position in this browser: automatic room for the S&P against
 * its 50-day and for 2s10s against a bp level, manual for everything else.
 *
 * Right: the monitored rows (the Overview's format), sorted by room left; a
 * row opens to its gate text and Close…, and `?open=<id>` opens one from a
 * link. Under them, the closes of the last 90 days, Export / Import JSON of
 * the store, and any record the store cannot read, kept and listed.
 *
 * desk/usability §14.4: the saved positions come first. The page opens on
 * the monitored rows (wide), the closes and the store; the Promote form and
 * the gate are behind "+ New position" (`?new=1`), and open at once when
 * something is carried in (a study, a basket, an instrument from
 * Technicals). The gate itself is unchanged.
 */

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStudy, useTechnicals } from "../data/api";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { MonitoredRow, sortByRoom } from "../kit/MonitoredRows";
import { apiParams, askFromSearch, questionWords, searchFor, slotsOf, targetLabel, type Ask } from "../event-study/question";
import { readSaved } from "../basket/weights";
import { planFor, planRefusal, seriesOf, suggestions, underlyingName } from "./levels";
import { falsifiesLine, sizeLine, viewOf, type PositionView } from "./monitor";
import { nyDate } from "./sessions";
import { closed90d, exportPositions, importPositions, isOpen, newPositionId, whyUnreadable, withClose, type CloseType, type PositionRecord, type PositionStore, type Subject } from "./store";
import { saveWords, useLevels, usePositionStore } from "./usePositionStore";
import { CERTAINTY_WORDS, REPLACEMENTS, context, gateState, replaceFlag, type Flag } from "./wording";
import "./positions.css";
import { DroppedNote, FailedScope, LoadingLine, droppedWords, type QueryLike } from "../kit/ui";
import { InstrumentSearch } from "../kit/InstrumentSearch";
import { Term } from "../kit/Term";

const HORIZONS = [5, 10, 20, 60];

interface Draft {
  instrument: string;
  direction: "long" | "short";
  size: string;
  horizon: number;
  variant: string;
  pre_mortem: string;
  red_team: string;
  /** The picked level's id only: its label is read from the current suggestions, so a change of
   * instrument or direction can never save a label that no longer applies (R2-1). */
  levelId: string | null;
  custom: string;
}

const EMPTY: Draft = { instrument: "", direction: "long", size: "", horizon: 20, variant: "", pre_mortem: "", red_team: "", levelId: null, custom: "" };

/** The size as typed, in % of NAV: "4", "4%", " 0.5 " → a number; "" → null (no size); anything else → NaN. */
export function parseSize(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!t) return null;
  // A plain decimal from 0 to 100 (% of NAV); "0x10", "1e2" or "500" are not sizes.
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  const v = Number(t);
  return v <= 100 ? v : Number.NaN;
}

const CLOSE_CHOICES: { id: CloseType; label: string }[] = [
  { id: "falsified", label: "Falsified on level" },
  { id: "expired", label: "Expired at horizon" },
  { id: "closed", label: "Closed" },
];

const JUDGED: { id: string; label: string; value: boolean | null }[] = [
  { id: "yes", label: "Yes", value: true },
  { id: "no", label: "No", value: false },
  { id: "unjudged", label: "Not judged", value: null },
];

/** Close…: an explicit close, its kind and the pre-mortem judged yes or no (§9: nothing closes on its own). */
function CloseForm({ onClose, onCancel }: { onClose: (type: CloseType, premortemRight: boolean | null) => void; onCancel: () => void }) {
  const [type, setType] = useState<CloseType | null>(null);
  const [judged, setJudged] = useState<boolean | null>(null);
  const uid = useId();
  return (
    <div className="pm-close" role="group" aria-labelledby={`${uid}-as`}>
      <p className="dk-stat-label" id={`${uid}-as`}>
        Close as
      </p>
      <div className="pm-chips">
        {CLOSE_CHOICES.map((c) => (
          <button key={c.id} type="button" className="dk-chip pm-chip" aria-pressed={type === c.id} onClick={() => setType(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="dk-stat-label">Was the pre-mortem right?</p>
      <div className="pm-chips">
        {JUDGED.map((j) => (
          <button key={j.id} type="button" className="dk-chip pm-chip" aria-pressed={judged === j.value} onClick={() => setJudged(j.value)}>
            {j.label}
          </button>
        ))}
      </div>
      <p className="pm-close-actions">
        {/* §14.13: no control that does nothing. Close position shows once a close type is picked, never disabled. */}
        {type ? (
          <button type="button" className="dk-btn" data-kind="light" onClick={() => onClose(type, judged)}>
            Close position
          </button>
        ) : (
          <span className="pm-close-hint">Pick how it closed to close it.</span>
        )}
        <button type="button" className="dk-link" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  );
}

function Expanded({ v, pathTo, onClose }: { v: PositionView; pathTo: (slug: string) => string; onClose: (type: CloseType, premortemRight: boolean | null) => void }) {
  const [closing, setClosing] = useState(false);
  const p = v.record;
  const study = p.subject.kind === "study" ? p.subject.question : null;
  return (
    <div className="pm-exp">
      <div className="pm-exp-2">
        <div>
          <p className="dk-stat-label">Falsifies at</p>
          <p>{falsifiesLine(v)}</p>
          {p.monitoring === "manual" ? <p className="pm-manual">Monitored by hand: close it when the level is reached.</p> : null}
        </div>
        <div>
          <p className="dk-stat-label">Size · horizon</p>
          <p>{sizeLine(v)}</p>
        </div>
      </div>
      <p className="dk-stat-label">Variant view</p>
      <p>{p.variant}</p>
      <p className="dk-stat-label">Pre-mortem</p>
      <p>{p.pre_mortem}</p>
      <p className="dk-stat-label">Red team · strongest case against</p>
      <p>{p.red_team || "not written"}</p>
      {closing ? (
        <CloseForm onClose={onClose} onCancel={() => setClosing(false)} />
      ) : (
        <p className="pm-exp-links">
          {study ? (
            <>
              <Link className="dk-link" to={`${pathTo("event-study")}?${searchFor({ question: study })}`}>
                Open the study behind it →
              </Link>
              {" · "}
            </>
          ) : null}
          <button type="button" className="dk-link" onClick={() => setClosing(true)}>
            Close…
          </button>
        </p>
      )}
    </div>
  );
}

const IDLE: QueryLike = { isError: false, error: null };

function Monitored({ views, unreadable = 0, openId, onToggle, pathTo, onClose, loading = false, reads = IDLE, note = null }: { views: PositionView[]; unreadable?: number; openId: string | null; onToggle: (id: string) => void; pathTo: (slug: string) => string; onClose: (id: string, type: CloseType, premortemRight: boolean | null) => void; loading?: boolean; reads?: QueryLike; note?: string | null }) {
  const uid = useId();
  // The deployed share is a sum of sizes, printed only when every row has one (P-11) and every kept
  // position could be read: an unreadable one may be open, so no total is claimed (Codex R-16).
  const sized = views.every((r) => typeof r.size_nav === "number" && Number.isFinite(r.size_nav));
  const deployed = sized && !unreadable ? views.reduce((a, r) => a + (r.size_nav as number), 0) : null;
  // §14.10, §14.12: an automatic row's level is the API's; while it is asked the card says so, and when the
  // request failed it says Couldn't load · Retry (a row would read "now not served" either way).
  const live = views.some((r) => r.monitoring === "automatic");
  return (
    <FailedScope q={live ? reads : IDLE}>
      <section className="dk-card pm-mon" aria-labelledby="pm-mon-title">
        <h2 className="dk-card-title" id="pm-mon-title">
          Monitored
        </h2>
        <p className="pm-mon-sub">how far each is from being wrong · live</p>
        <LoadingLine busy={live && loading} />
        {note ? (
          <p className="pm-close-note" role="status" data-testid="pm-close-note">
            {note}
          </p>
        ) : null}
        {views.length ? (
          <ul className="dk-mon-list pm-list">
            {views.map((r) => (
              <MonitoredRow key={r.id} row={r} open={openId === r.id} onClick={() => onToggle(r.id)} controls={`${uid}-${r.id}`}>
                <Expanded v={r} pathTo={pathTo} onClose={(type, judged) => onClose(r.id, type, judged)} />
              </MonitoredRow>
            ))}
          </ul>
        ) : unreadable ? (
          <p className="dk-await">{`No readable open position; ${droppedWords(unreadable, "kept position").replace(/\.$/, "")}.`}</p>
        ) : (
          <p className="dk-await">
            No open positions in this browser.{" "}
            <Link className="dk-link" to={withParam(pathTo("position-monitor"), "new", "1")}>
              + New position
            </Link>
          </p>
        )}
        {views.length ? (
          <p className="pm-note">
            Sorted by room left · room = distance to the level as a share of the room at entry, same scale for every trade · size as % of NAV ·{" "}
            {deployed != null ? `${Math.round(deployed * 1000) / 10}% deployed, ` : ""}
            {unreadable ? (
              <>{`${views.length} readable position${views.length === 1 ? "" : "s"}`} · click a row for the gate text</>
            ) : (
              <>
                {views.length} position{views.length === 1 ? "" : "s"} · click a row for the gate text
              </>
            )}
          </p>
        ) : null}
        {views.length ? <DroppedNote n={unreadable} one="kept position" /> : null}
      </section>
    </FailedScope>
  );
}

function Closed({ store }: { store: PositionStore }) {
  const c = closed90d(store, new Date());
  // A kept record this browser cannot read may hold close events, so no count is claimed (Codex R-16).
  const lost = store.unreadable.length;
  return (
    <section className="dk-card pm-closed" aria-label="Closed in the last 90 days">
      <p className="dk-stat-label">Closed · last 90d</p>
      {/* desk/pdf-polish 7: each row head carries its definition. */}
      <dl>
        <div>
          <dt>
            <Term ids={["col-falsified"]}>Falsified on level</Term>
          </dt>
          <dd>{lost ? "—" : c.falsified}</dd>
        </div>
        <div>
          <dt>
            <Term ids={["col-expired"]}>Expired at horizon</Term>
          </dt>
          <dd>{lost ? "—" : c.expired}</dd>
        </div>
        <div>
          <dt>
            <Term ids={["col-premortem"]}>Pre-mortem was right</Term>
          </dt>
          <dd data-tone={lost ? undefined : "amber"}>{lost ? "—" : `${c.premortem_right[0]} of ${c.premortem_right[1]}`}</dd>
        </div>
      </dl>
      <DroppedNote n={lost} one="kept position" />
    </section>
  );
}

/** Export / Import JSON of the store (§1.8), and the records it cannot read, kept and listed (§9). */
function StoreCard({ store, onImport }: { store: PositionStore; onImport: (text: string) => string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportPositions(store)], { type: "application/json" }));
    a.download = "desk-positions.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) setNote(onImport(await f.text()));
  };
  const count = store.positions.length + store.unreadable.length;
  return (
    <section className="dk-card pm-store" aria-label="Positions kept in this browser">
      <p className="pm-io">
        <span className="pm-io-words">Kept in this browser only.</span>
        {/* §14.4: nothing kept, nothing to export: the control is not shown. */}
        {count ? (
          <button type="button" className="dk-link" onClick={download}>
            Export JSON
          </button>
        ) : null}
        <button type="button" className="dk-link" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} aria-label="Import positions" />
      </p>
      {note ? (
        <p className="pm-io-note" role="status">
          {note}
        </p>
      ) : null}
      {store.unreadable.length ? (
        <div className="pm-unreadable" data-testid="pm-unreadable">
          <p className="dk-stat-label" data-tone="amber">
            Unreadable · {store.unreadable.length} kept, not monitored
          </p>
          <ul>
            {store.unreadable.map((u, i) => {
              const r = u.raw as { id?: unknown; instrument?: unknown } | null;
              const name = r && typeof r === "object" ? [typeof r.id === "string" ? r.id : null, typeof r.instrument === "string" ? r.instrument : null].filter(Boolean).join(" · ") : "";
              return (
                <li key={i}>
                  {name ? <span className="pm-unreadable-id">{name}</span> : null}
                  {name ? ": " : null}
                  {u.why}
                </li>
              );
            })}
          </ul>
          <p className="pm-io-note">Export keeps them as they are, so a corrected file can be imported again.</p>
        </div>
      ) : null}
    </section>
  );
}

function importWords(r: { added: number; unreadable: number; skipped: number } | null): string {
  if (!r) return "That file is not a list of positions; nothing was imported.";
  const parts = [`Imported ${r.added} position${r.added === 1 ? "" : "s"}`];
  if (r.unreadable) parts.push(`${r.unreadable} unreadable, kept below`);
  if (r.skipped) parts.push(`${r.skipped} already here`);
  return `${parts.join("; ")}.`;
}

function WordingBox({ flags, onReplace }: { flags: (Flag & { text: string })[]; onReplace: (f: Flag, r: string) => void }) {
  const first = flags[0];
  return (
    <div className="pm-wording" data-flagged={flags.length ? true : undefined} role="group" aria-label="Wording">
      <p className="pm-step-label" data-tone={flags.length ? "amber" : "green"}>
        Wording · {flags.length ? `${flags.length} to fix, one click` : "nothing to fix"}
      </p>
      {first ? <WordingLine flag={first} onReplace={onReplace} /> : null}
      <p className="pm-wording-note" data-gate-words>
        Only certainty words block ({CERTAINTY_WORDS.join(", ")}). Everything else is yours.
      </p>
    </div>
  );
}

function WordingLine({ flag, onReplace }: { flag: Flag & { text: string }; onReplace: (f: Flag, r: string) => void }) {
  const ctx = context(flag.text, flag);
  const [a, b] = REPLACEMENTS[flag.word];
  return (
    <div className="pm-wording-line">
      <span className="pm-quote">
        &ldquo;{ctx.before ? `${ctx.before} ` : ""}
        <s data-tone="amber">{ctx.word}</s>
        {ctx.after ? (/^[.,;:!?)]/.test(ctx.after) ? ctx.after : ` ${ctx.after}`) : ""}&rdquo;
      </span>
      <button type="button" className="pm-fix" data-kind="primary" onClick={() => onReplace(flag, a)}>
        Use &ldquo;{a}&rdquo;
      </button>
      <button type="button" className="pm-fix" onClick={() => onReplace(flag, b)}>
        Use &ldquo;{b}&rdquo;
      </button>
    </div>
  );
}

export default function PositionMonitorPage({ page }: { page: DeskPage }) {
  const { pathTo } = useDeskView();
  const [search, setSearch] = useSearchParams();
  // A study carried in: `?from=<preset>` with the horizon its link keeps (Codex R-23), or the six slots Event Study's own address uses.
  const from = search.get("from");
  const fromHorizon = search.get("horizon");
  const carriedAsk: Ask | null = from ? (fromHorizon === null ? { preset: from } : { preset: from, horizon: fromHorizon }) : search.get("shock") ? askFromSearch(search) : null;
  const study = useStudy(carriedAsk ? apiParams(carriedAsk) : {}, { enabled: !!carriedAsk });
  // A basket sent from Basket & Hedge (`?basket=`): one saved in this browser (§10: no basket is served).
  const basketId = search.get("basket");
  const localBasket = basketId ? (readSaved().find((b) => b.id === basketId) ?? null) : null;
  const sent = localBasket ? { name: localBasket.name, instrument: `${localBasket.name} basket`, legs: localBasket.legs } : null;
  const tech = useTechnicals();
  const [store, change] = usePositionStore();
  const levels = useLevels(store, true);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // The answer to a save, with its tone: a refusal is a caution (amber), a save is plain (P-3).
  const [saveNote, setSaveNoteState] = useState<{ text: string; tone: "saved" | "refused" } | null>(null);
  const [closeNote, setCloseNote] = useState<string | null>(null);
  const setSaveNote = (text: string, tone: "saved" | "refused" = "refused") => setSaveNoteState(text ? { text, tone } : null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const openId = search.get("open");
  const uid = useId();

  // The study carried in fills the instrument (its target) and the horizon; the gate stays empty.
  // Never the previous study's answer while the next one loads: a save would bind to the wrong study.
  const carried = carriedAsk && study.data && !study.isPlaceholderData ? study.data : null;
  const carriedFailed = !!carriedAsk && study.isError;
  useEffect(() => {
    if (!carried) return;
    // The instrument is the study's target as `series[]` names it (§12.2); without it the field is left for the analyst.
    const target = targetLabel(carried);
    setDraft((d) => (d.instrument ? d : { ...d, instrument: typeof target === "string" ? target : "", horizon: HORIZONS.includes(carried.question.horizon) ? carried.question.horizon : d.horizon }));
  }, [carried]);

  // desk/usability §14.2: Technicals' "Open as position" names the instrument (`?instrument=`); it fills an empty field.
  const instrumentAsked = search.get("instrument");
  // §14.4: the form opens from "+ New position" (`?new=1`) or when something is carried in.
  const formOpen = search.get("new") === "1" || !!carriedAsk || !!basketId || !!(instrumentAsked && instrumentAsked.trim());
  const closeForm = () =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        for (const k of ["new", "from", "horizon", "basket", "instrument", "shock", "window", "move", "while", "target"]) q.delete(k);
        return q;
      },
      { replace: false },
    );
  useEffect(() => {
    if (!instrumentAsked || !instrumentAsked.trim() || carriedAsk || sent) return;
    setDraft((d) => (d.instrument ? d : { ...d, instrument: instrumentAsked.trim() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentAsked]);

  useEffect(() => {
    if (!sent || carriedAsk) return;
    // A basket saved without a name fills nothing (Codex G1-8).
    const words = sent.instrument;
    if (typeof words !== "string" || !words.trim()) return;
    setDraft((d) => (d.instrument ? d : { ...d, instrument: words }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent?.instrument]);

  // Every series, the target included, is named by the study's served `series[]` (§12.2); a target it does
  // not list goes unnamed ("the study's target"), never guessed from its key.
  const label = (k: string) => (carried && k === carried.question.target ? (targetLabel(carried) ?? "the study's target") : ((Array.isArray(carried?.series) ? carried.series : []).find((s) => s.key === k)?.label ?? k));
  // The six slots the study was asked by: the study subject a position records (§9).
  const canonical = carried ? slotsOf(carried.question) : null;
  // "The signal reverses" is offered only for a study subject with its full question (§9).
  const signalWords = carried && canonical ? `${label(carried.question.shock)} gives back its move` : null;
  const sug = useMemo(() => suggestions(draft.instrument, tech.data, signalWords, draft.direction, levels), [draft.instrument, tech.data, signalWords, draft.direction, levels]);
  // A picked level counts only while the current suggestions still offer it.
  const picked = [...sug.top, ...sug.more].find((c) => c.id === draft.levelId) ?? null;
  // A level the suggestions no longer offer is dropped, so it cannot come back unseen.
  useEffect(() => {
    if (draft.levelId && !picked) setDraft((d) => ({ ...d, levelId: null }));
  }, [draft.levelId, picked]);
  const level = picked?.label ?? (draft.custom.trim() || null);
  const size = parseSize(draft.size);
  const sizeBad = typeof size === "number" && Number.isNaN(size);
  const gate = gateState({ instrument: draft.instrument, variant: draft.variant, pre_mortem: draft.pre_mortem, level, sizeOk: !sizeBad });
  const ready = gate.ok;
  const flagsWithText = gate.flags.map((f) => ({ ...f, text: f.field === "variant" ? draft.variant : draft.pre_mortem }));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaveNote("");
    setDraft((d) => ({ ...d, [k]: v }));
  };
  /** A picked level replaces a typed one, and the other way round (P-13). */
  const pickLevel = (c: { id: string; label: string } | null) => {
    setSaveNote("");
    setDraft((d) => ({ ...d, levelId: c?.id ?? null, custom: c ? "" : d.custom }));
  };
  const onReplace = (f: Flag, r: string) => {
    const field = f.field === "variant" ? "variant" : "pre_mortem";
    set(field, replaceFlag(draft[field], f, r));
  };
  const toggle = (id: string) =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        if (q.get("open") === id) q.delete("open");
        else q.set("open", id);
        return q;
      },
      { replace: true },
    );

  const subject = (): Subject => {
    if (carried && canonical) return { kind: "study", question: canonical };
    // A position records a basket's weights as numbers (§9); a saved basket keeps its exact digits (Codex R-20).
    if (sent && !carriedAsk && Array.isArray(sent.legs) && sent.legs.length) return { kind: "basket", legs: sent.legs.map((l) => ({ symbol: l.symbol, weight: Number(l.weight) })), benchmark: null };
    return { kind: "instrument", id: seriesOf(draft.instrument) ?? draft.instrument.trim() };
  };

  const save = () => {
    if (!ready) return;
    const finish = (text: string, tone: "saved" | "refused") => {
      setSaveNote(text, tone);
      // The status line takes the focus (P-14).
      statusRef.current?.focus();
    };
    const subj = subject();
    // §9: automatic only when the subject's monitored quantity is the served series; a basket never is.
    const plan = planFor(picked?.id ?? null, draft.instrument, levels, subj.kind);
    const refused = planRefusal(plan);
    if (refused) return finish(refused, "refused");
    const now = new Date();
    const auto = plan.kind === "automatic" ? plan : null;
    let saved: PositionRecord | null = null;
    let why: string | null = null;
    const r = change((current) => {
      const record: PositionRecord = {
        id: newPositionId(current, now),
        instrument: draft.instrument.trim(),
        direction: draft.direction,
        size_nav: typeof size === "number" ? size / 100 : null,
        horizon_days: draft.horizon,
        variant: draft.variant.trim(),
        pre_mortem: draft.pre_mortem.trim(),
        red_team: draft.red_team.trim() || null,
        wrong_if: picked ? { id: picked.id, label: picked.label } : { id: "custom", label: draft.custom.trim() },
        subject: subj,
        monitoring: auto ? "automatic" : "manual",
        entry_ts: now.toISOString(),
        entry_date: nyDate(now),
        entry_value: auto ? auto.entry_value : null,
        trigger: auto ? { series: auto.series, operator: auto.operator, threshold: auto.threshold, policy: "frozen", observed_on: auto.observed_on } : null,
        original_room: auto ? auto.original_room : null,
        evaluation: "close",
        closes: [],
      };
      // §9: the rule runs on Save; a record that fails it is refused here, and the form keeps every word.
      why = whyUnreadable(record);
      if (why) return current;
      saved = record;
      return { ...current, positions: [...current.positions, record] };
    });
    if (why) return finish(`This position cannot be saved: ${why}. Nothing was saved.`, "refused");
    const failed = saveWords(r);
    if (failed || !saved) return finish(failed ?? "Nothing was saved.", "refused");
    setDraft({ ...EMPTY });
    finish(auto ? "Saved in this browser. The position is on the monitor, its room read from the served level." : "Saved in this browser. The position is on the monitor, monitored by hand.", "saved");
  };

  const now = new Date();
  const views = sortByRoom(store.positions.filter(isOpen).map((p) => viewOf(p, levels, now)));
  const closeOne = (id: string, type: CloseType, premortemRight: boolean | null) => {
    const r = change((current) => withClose(current, id, type, premortemRight, new Date()));
    // Codex merge review: a close the browser did not keep says so on the Monitored card itself, where the
    // Close… form is; the page's own note sits in the New position form, closed by default (§14.4).
    setCloseNote(saveWords(r));
  };
  const onImport = (text: string) => {
    let out: ReturnType<typeof importPositions> = null;
    const r = change((current) => {
      out = importPositions(current, text);
      return out ? out.store : current;
    });
    return saveWords(r) ?? importWords(out);
  };

  const sub = carried
    ? `Carried in from Event Study · ${questionWords(carried.question, label)} · any study can be carried in`
    : sent && !carriedAsk
      ? `Sent from Basket & Hedge · ${sent.name} · the gate is the same for every position.`
      : basketId && !carriedAsk && !localBasket
        ? `The basket sent from Basket & Hedge (${basketId}) is not saved in this browser; the gate is the same for every position.`
        : carriedFailed
          ? `The study carried in from Event Study (${from ?? "the question in the address"}) is awaiting refresh; the gate is the same for every position.`
          : instrumentAsked && instrumentAsked.trim()
            ? `Opened from Technicals · ${instrumentAsked.trim()} · the gate is the same for every position.`
            : "Any study can be carried in from Event Study; the gate is the same for every position.";

  const monitor = (
    <>
      <Monitored views={views} unreadable={store.unreadable.length} openId={openId} onToggle={toggle} pathTo={pathTo} onClose={closeOne} loading={levels.loading} reads={levels.reads} note={closeNote} />
      <Closed store={store} />
      <StoreCard store={store} onImport={onImport} />
    </>
  );
  if (!formOpen)
    return (
      <div className="pm" data-form="closed">
        <div className="pm-head">
          <PageTitle page={page} title="Position Monitor" />
        </div>
        <div className="pm-saved">
          <div className="pm-saved-main">
            <Monitored views={views} unreadable={store.unreadable.length} openId={openId} onToggle={toggle} pathTo={pathTo} onClose={closeOne} loading={levels.loading} reads={levels.reads} note={closeNote} />
          </div>
          <div className="pm-right">
            <Closed store={store} />
            <StoreCard store={store} onImport={onImport} />
          </div>
        </div>
      </div>
    );

  return (
    <div className="pm" data-form="open">
      <div className="pm-grid">
        <div className="pm-left">
          <div className="pm-head">
            <PageTitle page={{ ...page, blurb: "" }} title="Promote to position" />
            <p className="pm-sub">
              {sub}{" "}
              <button type="button" className="dk-link pm-close-form" onClick={closeForm}>
                Back to the monitor
              </button>
            </p>
          </div>
          <form
            className="dk-card pm-fields"
            aria-label="Promote to position"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="pm-field">
              <label htmlFor={`${uid}-inst`} className="dk-stat-label">
                Instrument
              </label>
              {/* desk/usability item 1: the Desk's stock search; what is typed stays, a pick fills the ticker. */}
              <InstrumentSearch inputId={`${uid}-inst`} className="pm-isearch" value={draft.instrument} onTextChange={(t) => set("instrument", t)} onSelect={(hit) => set("instrument", hit.symbol)} placeholder="Ticker or name" dense />
            </div>
            <div className="pm-field">
              <label htmlFor={`${uid}-dir`} className="dk-stat-label">
                Direction
              </label>
              <div className="dk-select">
                <select id={`${uid}-dir`} value={draft.direction} onChange={(e) => set("direction", e.target.value === "short" ? "short" : "long")}>
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
            </div>
            <div className="pm-field">
              <label htmlFor={`${uid}-size`} className="dk-stat-label">
                Size · % NAV
              </label>
              <input id={`${uid}-size`} className="pm-input pm-mono" inputMode="decimal" value={draft.size} onChange={(e) => set("size", e.target.value)} autoComplete="off" />
            </div>
            <div className="pm-field">
              <label htmlFor={`${uid}-hz`} className="dk-stat-label">
                Horizon
              </label>
              <div className="dk-select">
                <select id={`${uid}-hz`} value={draft.horizon} onChange={(e) => set("horizon", Number(e.target.value))}>
                  {HORIZONS.map((h) => (
                    <option key={h} value={h}>
                      {h} trading days
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" hidden disabled={!ready} aria-hidden="true" tabIndex={-1} />
          </form>

          <section className="dk-card pm-gate" aria-labelledby={`${uid}-gate`}>
            <div className="pm-gate-head">
              <h2 className="dk-card-title" id={`${uid}-gate`}>
                Discipline gate<span className="dk-card-sub" data-mono> three short answers, then Save turns on</span>
              </h2>
              <p className="pm-progress">
                <span data-tone={gate.variant ? "green" : "amber"}>{gate.variant ? "✓" : "○"} variant</span> · <span data-tone={gate.premortem ? "green" : "amber"}>{gate.premortem ? "✓" : "○"} pre-mortem</span> ·{" "}
                <span data-tone={gate.level ? "green" : "amber"}>{gate.level ? "✓" : "○"} level</span>
              </p>
            </div>

            <label className="pm-step-label" htmlFor={`${uid}-variant`} data-tone={gate.variant ? "green" : "amber"}>
              1 · Variant view <span className="pm-step-hint">· finish the sentence: &ldquo;The market thinks ___, I think ___, because ___.&rdquo;</span>
            </label>
            <textarea id={`${uid}-variant`} className="pm-text" data-done={gate.variant || undefined} rows={2} value={draft.variant} onChange={(e) => set("variant", e.target.value)} />

            <label className="pm-step-label" htmlFor={`${uid}-pm`} data-tone={gate.premortem ? "green" : "amber"}>
              2 · Pre-mortem <span className="pm-step-hint">· finish the sentence: &ldquo;It lost money because ___.&rdquo;</span>
            </label>
            <textarea id={`${uid}-pm`} className="pm-text" data-done={gate.premortem || undefined} rows={2} value={draft.pre_mortem} onChange={(e) => set("pre_mortem", e.target.value)} />

            <div className="pm-row3">
              <div className="pm-wrong" role="group" aria-labelledby={`${uid}-wrong`}>
                <p className="pm-step-label" id={`${uid}-wrong`} data-tone={gate.level ? "green" : "amber"}>
                  3 · Wrong if <span className="pm-step-hint">· suggested for {underlyingName(draft.instrument)} · changes with the instrument</span>
                </p>
                <div className="pm-chips">
                  {sug.top.map((c) => (
                    <button key={c.id} type="button" className="dk-chip pm-chip" aria-pressed={picked?.id === c.id} onClick={() => pickLevel(picked?.id === c.id ? null : c)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="pm-more">
                  <div className="dk-select">
                    <select
                      aria-label={`More levels for ${underlyingName(draft.instrument)}`}
                      value={picked && sug.more.some((m) => m.id === picked.id) ? picked.id : ""}
                      onChange={(e) => {
                        const c = sug.more.find((m) => m.id === e.target.value);
                        pickLevel(c ?? null);
                      }}
                    >
                      <option value="">More levels for {underlyingName(draft.instrument)}…</option>
                      {sug.more.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className="pm-input pm-own"
                    aria-label="Or type your own level"
                    placeholder="or type your own: series, level"
                    value={draft.custom}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSaveNote("");
                      setDraft((d) => ({ ...d, custom: v, levelId: v.trim() ? null : d.levelId }));
                    }}
                  />
                </div>
              </div>
              <WordingBox flags={flagsWithText} onReplace={onReplace} />
            </div>

            <label className="pm-step-label" htmlFor={`${uid}-red`}>
              4 · Red team <span className="pm-step-hint">· optional · the strongest case against, in your words.</span>
            </label>
            <textarea id={`${uid}-red`} className="pm-text" rows={2} value={draft.red_team} onChange={(e) => set("red_team", e.target.value)} />

            <div className="pm-save">
              <button type="button" className="dk-btn pm-save-btn" data-kind={ready ? "light" : undefined} disabled={!ready} onClick={save} data-testid="pm-save">
                Save position
              </button>
              <p className="pm-left-words" role="status" ref={statusRef} tabIndex={-1} data-tone={saveNote ? (saveNote.tone === "refused" ? "amber" : undefined) : ready ? "green" : "amber"}>
                {saveNote?.text ?? (ready ? "The gate is complete. Save keeps the position in this browser." : gate.left)}
              </p>
            </div>
          </section>
        </div>
        <div className="pm-right">{monitor}</div>
      </div>
    </div>
  );
}
