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
 */

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStudy, useTechnicals } from "../data/api";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView } from "../desk-view";
import { MonitoredRow, sortByRoom } from "../kit/MonitoredRows";
import { apiParams, askFromSearch, questionWords, searchFor, slotsOf, type Ask } from "../event-study/question";
import { readSaved } from "../basket/weights";
import { planFor, planRefusal, seriesOf, suggestions, underlyingName } from "./levels";
import { falsifiesLine, sizeLine, viewOf, type PositionView } from "./monitor";
import { nyDate } from "./sessions";
import { closed90d, exportPositions, importPositions, isOpen, newPositionId, whyUnreadable, withClose, type CloseType, type PositionRecord, type PositionStore, type Subject } from "./store";
import { saveWords, useLevels, usePositionStore } from "./usePositionStore";
import { CERTAINTY_WORDS, REPLACEMENTS, context, gateState, replaceFlag, type Flag } from "./wording";
import "./positions.css";

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
        <button type="button" className="dk-btn" data-kind={type ? "light" : undefined} disabled={!type} onClick={() => type && onClose(type, judged)}>
          Close position
        </button>
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

function Monitored({ views, openId, onToggle, pathTo, onClose }: { views: PositionView[]; openId: string | null; onToggle: (id: string) => void; pathTo: (slug: string) => string; onClose: (id: string, type: CloseType, premortemRight: boolean | null) => void }) {
  const uid = useId();
  // The deployed share is a sum of sizes, printed only when every row has one (P-11).
  const sized = views.every((r) => typeof r.size_nav === "number" && Number.isFinite(r.size_nav));
  const deployed = sized ? views.reduce((a, r) => a + (r.size_nav as number), 0) : null;
  return (
    <section className="dk-card pm-mon" aria-labelledby="pm-mon-title">
      <h2 className="dk-card-title" id="pm-mon-title">
        Monitored
      </h2>
      <p className="pm-mon-sub">how far each is from being wrong · live</p>
      {views.length ? (
        <ul className="dk-mon-list pm-list">
          {views.map((r) => (
            <MonitoredRow key={r.id} row={r} open={openId === r.id} onClick={() => onToggle(r.id)} controls={`${uid}-${r.id}`}>
              <Expanded v={r} pathTo={pathTo} onClose={(type, judged) => onClose(r.id, type, judged)} />
            </MonitoredRow>
          ))}
        </ul>
      ) : (
        <p className="dk-await">No open positions in this browser.</p>
      )}
      {views.length ? (
        <p className="pm-note">
          Sorted by room left · room = distance to the level as a share of the room at entry, same scale for every trade · size as % of NAV ·{" "}
          {deployed != null ? `${Math.round(deployed * 1000) / 10}% deployed, ` : ""}
          {views.length} position{views.length === 1 ? "" : "s"} · click a row for the gate text
        </p>
      ) : null}
    </section>
  );
}

function Closed({ store }: { store: PositionStore }) {
  const c = closed90d(store, new Date());
  return (
    <section className="dk-card pm-closed" aria-label="Closed in the last 90 days">
      <p className="dk-stat-label">Closed · last 90d</p>
      <dl>
        <div>
          <dt>Falsified on level</dt>
          <dd>{c.falsified}</dd>
        </div>
        <div>
          <dt>Expired at horizon</dt>
          <dd>{c.expired}</dd>
        </div>
        <div>
          <dt>Pre-mortem was right</dt>
          <dd data-tone="amber">{`${c.premortem_right[0]} of ${c.premortem_right[1]}`}</dd>
        </div>
      </dl>
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
        <button type="button" className="dk-link" onClick={download} disabled={!count}>
          Export JSON
        </button>
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
  // A study carried in: `?from=<preset>`, or the six slots Event Study's own address uses.
  const from = search.get("from");
  const carriedAsk: Ask | null = from ? { preset: from } : search.get("shock") ? askFromSearch(search) : null;
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
    // The instrument is the study's served target name (Codex R-03); without it the field is left for the analyst.
    const target = carried.question.target_label;
    setDraft((d) => (d.instrument ? d : { ...d, instrument: typeof target === "string" ? target : "", horizon: HORIZONS.includes(carried.question.horizon) ? carried.question.horizon : d.horizon }));
  }, [carried]);

  useEffect(() => {
    if (!sent || carriedAsk) return;
    // A basket saved without a name fills nothing (Codex G1-8).
    const words = sent.instrument;
    if (typeof words !== "string" || !words.trim()) return;
    setDraft((d) => (d.instrument ? d : { ...d, instrument: words }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent?.instrument]);

  // The target is named by the study's served target_label (Codex R-03); other series by the served list.
  // Without a served target_label the target goes unnamed here as on every tab, never named from a list.
  const label = (k: string) => (carried && k === carried.question.target ? (carried.question.target_label || "the study's target") : ((Array.isArray(carried?.series) ? carried.series : []).find((s) => s.key === k)?.label ?? k));
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
    if (sent && !carriedAsk && Array.isArray(sent.legs) && sent.legs.length) return { kind: "basket", legs: sent.legs.map((l) => ({ symbol: l.symbol, weight: l.weight })), benchmark: null };
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
    const failed = saveWords(r);
    if (failed) setSaveNote(failed);
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
          : "Any study can be carried in from Event Study; the gate is the same for every position.";

  return (
    <div className="pm">
      <div className="pm-grid">
        <div className="pm-left">
          <div className="pm-head">
            <PageTitle page={{ ...page, blurb: "" }} title="Promote to position" />
            <p className="pm-sub">{sub}</p>
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
              <input id={`${uid}-inst`} className="pm-input" value={draft.instrument} onChange={(e) => set("instrument", e.target.value)} autoComplete="off" />
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
        <div className="pm-right">
          <Monitored views={views} openId={openId} onToggle={toggle} pathTo={pathTo} onClose={closeOne} />
          <Closed store={store} />
          <StoreCard store={store} onImport={onImport} />
        </div>
      </div>
    </div>
  );
}
