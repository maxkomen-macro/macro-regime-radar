/**
 * Position Monitor (DESK_FRAME3_SPEC §9, screens/08-position-monitor.png):
 * promote an idea to a position only through the discipline gate, then watch
 * how far each position is from being wrong. Desk-only (no Client toggle).
 *
 * Left: the Promote form (instrument, direction, size as % of NAV, horizon)
 * carried in from Event Study (`?from=<preset>` names the study, or the six
 * slots spell it; the instrument starts as the study's target and the horizon
 * as its horizon, nothing else is filled), and the gate: three
 * short answers (variant view, pre-mortem, a "wrong if" level suggested from
 * live levels), the WORDING check whose certainty words alone block, and
 * Save, disabled until the gate is complete, naming what is left. Save posts
 * to /api/desk/positions (§12.8), which applies the same rules and answers
 * `{"error":"wording"}` or `{"error":"gate"}`; positions live on the server.
 *
 * Right: the monitored rows (the Overview's format), sorted by room left; a
 * row opens to its gate text, and `?open=<id>` opens one from a link. Under
 * them, the closed positions of the last 90 days.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { DeskApiError, deskPost, usePositions, useStudy, useTechnicals } from "../data/api";
import type { PositionExpanded, PositionsResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { dayShort, grouped, pctPlain, signed } from "../kit/format";
import { MonitoredRow, sortByRoom } from "../kit/MonitoredRows";
import { Awaiting } from "../kit/ui";
import { apiParams, askFromSearch, questionWords, type Ask } from "../event-study/question";
import { suggestions, underlyingName } from "./levels";
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
  /** The picked level's id only: its label is read from the current suggestions, so a change of
   * instrument or direction can never save a label that no longer applies (R2-1). */
  levelId: string | null;
  custom: string;
}

const EMPTY: Draft = { instrument: "", direction: "long", size: "", horizon: 20, variant: "", pre_mortem: "", levelId: null, custom: "" };

/** The size as typed, in % of NAV: "4", "4%", " 0.5 " → a number; "" → null (no size); anything else → NaN. */
export function parseSize(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!t) return null;
  // A plain decimal from 0 to 100 (% of NAV); "0x10", "1e2" or "500" are not sizes.
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  const v = Number(t);
  return v <= 100 ? v : Number.NaN;
}

/** The gate's own words for the fields the server says are missing. */
const MISSING_WORDS: Record<string, string> = { instrument: "the instrument", variant: "the variant view", pre_mortem: "the pre-mortem", level: "a “wrong if” level" };

/** The sentence for a refused or failed save (§12.8's refusals, or no answer at all). */
export function refusalWords(e: unknown): string {
  // deskPost wraps a failed fetch as status 0: the service did not answer (R2-3).
  if (!(e instanceof DeskApiError) || e.status === 0) return "The data service did not answer; nothing was saved.";
  const body = e.body;
  if (body?.error === "wording") {
    const words = Array.isArray(body.words) ? body.words.filter((w) => typeof w === "string") : [];
    return words.length ? `The server refused certainty words: ${words.join(", ")}. Nothing was saved.` : "The server refused the wording. Nothing was saved.";
  }
  if (body?.error === "gate") {
    const missing = Array.isArray(body.missing) ? body.missing.map((m) => MISSING_WORDS[m] ?? m) : [];
    return missing.length ? `The server says the gate is incomplete: ${missing.join(", ")}. Nothing was saved.` : "The server says the gate is incomplete. Nothing was saved.";
  }
  return "The data service did not accept the position; nothing was saved.";
}

/** "$1.4k" from a DV01 in dollars. */
export function dv01Text(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${grouped(v)}`;
}

/** The SIZE · HORIZON line: "2% NAV · DV01 $1.4k · 14 of 20 trading days · opened Sep 2". */
export function sizeLine(p: PositionExpanded): string {
  const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return [
    fin(p.size_nav) ? `${pctPlain(p.size_nav)} NAV` : null,
    fin(p.dv01) ? `DV01 ${dv01Text(p.dv01)}` : null,
    fin(p.day) && fin(p.horizon_days) ? `${p.day} of ${p.horizon_days} trading days` : null,
    p.opened && dayShort(p.opened) ? `opened ${dayShort(p.opened)}` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "—";
}

/** The FALSIFIES AT line: "2s10s below +38 bp · now +41 bp". */
export function falsifiesLine(p: PositionExpanded): string {
  const v = p.now?.value;
  const now = p.now && typeof v === "number" ? ` · now ${signed(v, Number.isInteger(v) ? 0 : 1)}${p.now.unit === "%" ? "%" : ` ${p.now.unit}`}` : "";
  return p.falsifies_at?.label ? `${p.falsifies_at.label}${now}` : "—";
}

function Expanded({ p, pathTo }: { p: PositionExpanded; pathTo: (slug: string) => string }) {
  return (
    <div className="pm-exp">
      <div className="pm-exp-2">
        <div>
          <p className="dk-stat-label">Falsifies at</p>
          <p>{falsifiesLine(p)}</p>
        </div>
        <div>
          <p className="dk-stat-label">Size · horizon</p>
          <p>{sizeLine(p)}</p>
        </div>
      </div>
      <p className="dk-stat-label">Variant view</p>
      <p>{p.variant || "not written"}</p>
      <p className="dk-stat-label">Pre-mortem</p>
      <p>{p.pre_mortem || "not written"}</p>
      <p className="dk-stat-label">Red team · strongest case against</p>
      <p>{p.red_team || "not written"}</p>
      <p className="pm-exp-links">
        {p.study_slug ? (
          <Link className="dk-link" to={withParam(pathTo("event-study"), "preset", p.study_slug)}>
            Open the study behind it →
          </Link>
        ) : null}
        {p.study_slug ? " · " : null}
        <Link className="dk-link" to={withParam(pathTo("basket-hedge"), "position", p.id)}>
          Price a hedge →
        </Link>
      </p>
    </div>
  );
}

function Monitored({ data, failed, openId, onToggle, pathTo }: { data: PositionsResponse | undefined; failed: boolean; openId: string | null; onToggle: (id: string) => void; pathTo: (slug: string) => string }) {
  const rows = Array.isArray(data?.positions) ? sortByRoom(data.positions) : null;
  const uid = useId();
  // The deployed share is a sum of served sizes, printed only when every row has one (P-11).
  const sized = rows && rows.every((r) => typeof r.size_nav === "number" && Number.isFinite(r.size_nav));
  const deployed = rows && sized ? rows.reduce((a, r) => a + (r.size_nav as number), 0) : null;
  return (
    <section className="dk-card pm-mon" aria-labelledby="pm-mon-title" aria-busy={!data && !failed}>
      <h2 className="dk-card-title" id="pm-mon-title">
        Monitored
      </h2>
      <p className="pm-mon-sub">how far each is from being wrong · live</p>
      {rows ? (
        rows.length ? (
          <ul className="dk-mon-list pm-list">
            {rows.map((r) => (
              <MonitoredRow key={r.id} row={r} open={openId === r.id} onClick={() => onToggle(r.id)} controls={`${uid}-${r.id}`}>
                <Expanded p={r} pathTo={pathTo} />
              </MonitoredRow>
            ))}
          </ul>
        ) : (
          <p className="dk-await">No open positions.</p>
        )
      ) : failed || data ? (
        <Awaiting />
      ) : null}
      {rows?.length ? (
        <p className="pm-note">
          Sorted by room left · room = distance to the level as a share of the room at entry, same scale for every trade · size as % of NAV ·{" "}
          {deployed != null ? `${pctPlain(deployed)} deployed, ` : ""}
          {rows.length} position{rows.length === 1 ? "" : "s"} · click a row for the gate text
        </p>
      ) : null}
    </section>
  );
}

function Closed({ data, failed }: { data: PositionsResponse | undefined; failed: boolean }) {
  const c = data?.closed_90d;
  return (
    <section className="dk-card pm-closed" aria-label="Closed in the last 90 days" aria-busy={!data && !failed}>
      <p className="dk-stat-label">Closed · last 90d</p>
      {!data && !failed ? null : !c ? (
        <Awaiting />
      ) : (
      <dl>
        <div>
          <dt>Falsified on level</dt>
          <dd>{typeof c.falsified === "number" ? c.falsified : "—"}</dd>
        </div>
        <div>
          <dt>Expired at horizon</dt>
          <dd>{typeof c.expired === "number" ? c.expired : "—"}</dd>
        </div>
        <div>
          <dt>Pre-mortem was right</dt>
          <dd data-tone="amber">{Array.isArray(c.premortem_right) && c.premortem_right.every((x) => typeof x === "number") ? `${c.premortem_right[0]} of ${c.premortem_right[1]}` : "—"}</dd>
        </div>
      </dl>
      )}
    </section>
  );
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
  const tech = useTechnicals();
  const pos = usePositions();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // The server's answer to a save, with its tone: a refusal is a caution (amber), a save is plain (P-3).
  const [serverNote, setServerNoteState] = useState<{ text: string; tone: "saved" | "refused" } | null>(null);
  const setServerNote = (text: string, tone: "saved" | "refused" = "refused") => setServerNoteState(text ? { text, tone } : null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const [saving, setSaving] = useState(false);
  const openId = search.get("open");
  const uid = useId();

  // The study carried in fills the instrument (its target) and the horizon; the gate stays empty.
  const carried = carriedAsk && study.data ? study.data : null;
  const carriedFailed = !!carriedAsk && study.isError;
  useEffect(() => {
    if (!carried) return;
    const target = carried.series?.find((s) => s.key === carried.question.target)?.label ?? carried.question.target;
    setDraft((d) => (d.instrument ? d : { ...d, instrument: target, horizon: HORIZONS.includes(carried.question.horizon) ? carried.question.horizon : d.horizon }));
  }, [carried]);

  const label = (k: string) => carried?.series?.find((s) => s.key === k)?.label ?? k;
  const signalWords = carried ? `${label(carried.question.shock)} gives back its move` : null;
  const sug = useMemo(() => suggestions(draft.instrument, tech.data, signalWords, draft.direction), [draft.instrument, tech.data, signalWords, draft.direction]);
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
    setServerNote("");
    setDraft((d) => ({ ...d, [k]: v }));
  };
  /** A picked level replaces a typed one, and the other way round (P-13). */
  const pickLevel = (c: { id: string; label: string } | null) => {
    setServerNote("");
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

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setServerNote("");
    try {
      await deskPost("/positions", {
        instrument: draft.instrument.trim(),
        direction: draft.direction,
        size_nav: typeof size === "number" ? size / 100 : null,
        horizon_days: draft.horizon,
        variant: draft.variant.trim(),
        pre_mortem: draft.pre_mortem.trim(),
        wrong_if: picked ? { id: picked.id, label: picked.label } : { id: "custom", label: draft.custom.trim() },
        study_slug: carried?.slug ?? null,
      });
      setDraft({ ...EMPTY });
      setServerNote("Saved. The position is on the monitor.", "saved");
      await client.invalidateQueries({ queryKey: ["desk-v2", "/positions"] });
    } catch (e) {
      setServerNote(refusalWords(e));
    } finally {
      setSaving(false);
      // Save turns off after a save; the status line takes the focus (P-14).
      statusRef.current?.focus();
    }
  };

  const sub = carried
    ? `Carried in from Event Study · ${questionWords(carried.question, label)} · any study can be carried in`
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
              void save();
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
                      setServerNote("");
                      setDraft((d) => ({ ...d, custom: v, levelId: v.trim() ? null : d.levelId }));
                    }}
                  />
                </div>
              </div>
              <WordingBox flags={flagsWithText} onReplace={onReplace} />
            </div>

            <div className="pm-save">
              <button type="button" className="dk-btn pm-save-btn" data-kind={ready ? "light" : undefined} disabled={!ready || saving} onClick={() => void save()} data-testid="pm-save">
                Save position
              </button>
              <p className="pm-left-words" role="status" ref={statusRef} tabIndex={-1} data-tone={serverNote ? (serverNote.tone === "refused" ? "amber" : undefined) : ready ? "green" : "amber"}>
                {serverNote?.text ?? (ready ? "The gate is complete. Save records the position on the server." : gate.left)}
              </p>
            </div>
          </section>
        </div>
        <div className="pm-right">
          <Monitored data={pos.data} failed={pos.isError} openId={openId} onToggle={toggle} pathTo={pathTo} />
          <Closed data={pos.data} failed={pos.isError} />
        </div>
      </div>
    </div>
  );
}
