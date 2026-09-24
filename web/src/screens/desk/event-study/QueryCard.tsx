/**
 * Row 1 of the Event Study (DESK_FRAME3_SPEC §4): pick a question, then the
 * question spelled out in six slots. A three-way switch (Common questions /
 * My saved questions · N / Build your own), the nine preset chips or the
 * saved ones under "Yours" (with Export / Import JSON, §1.8), and six labeled
 * dropdowns that always show exactly what is asked. Changing a slot makes the
 * question your own; Run asks it; Save keeps it in this browser.
 */

import { useId, useRef, useState, type ChangeEvent } from "react";
import type { Move, Question } from "../data/types";
import { HORIZONS, MOVES, PRESET_CHIPS, WHILES, WINDOWS, exportSaved, importSaved, type SavedQuestion } from "./question";

export type Mode = "common" | "saved" | "build";

function Slot({ label, tip, value, options, onChange, disabled, awaiting }: { label: string; tip?: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; awaiting?: boolean }) {
  const id = useId();
  const tipId = useId();
  const known = options.some((o) => o.id === value);
  return (
    <div className="es-slot">
      <div className="es-slot-label">
        <label htmlFor={id}>{label}</label>
        {tip ? (
          <button type="button" className="es-tip" aria-label={`${label}: ${tip}`} data-tip={tip}>
            i
          </button>
        ) : null}
      </div>
      {tip ? (
        <span id={tipId} className="dk-sr">
          {tip}
        </span>
      ) : null}
      {awaiting ? <span className="dk-sr">The series list is awaiting refresh.</span> : null}
      <div className="es-select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-describedby={tip ? tipId : undefined}>
          {known ? null : <option value={value}>{value}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function QueryCard({
  mode,
  onMode,
  activePreset,
  onPreset,
  saved,
  onSavedChange,
  onPickSaved,
  draft,
  onDraft,
  series,
  seriesFailed = false,
  onRun,
  onSave,
  running,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  activePreset: string | null;
  onPreset: (slug: string) => void;
  saved: SavedQuestion[];
  onSavedChange: (list: SavedQuestion[], note: string) => void;
  onPickSaved: (s: SavedQuestion) => void;
  draft: Question | null;
  onDraft: (q: Question) => void;
  /** The 12 series the slots list; null until served (§12.13 PROPOSED `series`). */
  series: { key: string; label: string }[] | null;
  seriesFailed?: boolean;
  onRun: () => void;
  onSave: () => void;
  running: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState("");
  const set = <K extends keyof Question>(k: K) => (v: string) => {
    if (!draft) return;
    const val = k === "window" || k === "horizon" ? Number(v) : v;
    onDraft({ ...draft, [k]: val } as Question);
  };
  const seriesOptions = (series ?? []).map((s) => ({ id: s.key, label: s.label }));
  const download = () => {
    const blob = new Blob([exportSaved(saved)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "desk-saved-questions.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = importSaved(saved, await f.text());
    const msg = `Imported ${r.added} question${r.added === 1 ? "" : "s"}${r.rejected ? `; ${r.rejected} not readable` : ""}.`;
    setNote(msg);
    onSavedChange(r.list, msg);
  };
  const tabs: { id: Mode; label: string }[] = [
    { id: "common", label: "Common questions" },
    { id: "saved", label: `My saved questions · ${saved.length}` },
    { id: "build", label: "Build your own" },
  ];
  return (
    <section className="dk-card es-query" aria-label="The question">
      <div className="es-query-top">
        <div className="dk-seg es-modes" role="group" aria-label="Pick a question">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-pressed={mode === t.id} onClick={() => onMode(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="es-hint">pick one below, or build your own in the slots — either way the slots show exactly what is being asked</p>
      </div>
      {mode === "common" ? (
        <div className="es-chips" role="group" aria-label="Common questions">
          {PRESET_CHIPS.map((p) => (
            <button key={p.slug} type="button" className="es-chip" aria-pressed={activePreset === p.slug} onClick={() => onPreset(p.slug)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : mode === "saved" ? (
        <div className="es-chips" role="group" aria-label="My saved questions">
          <span className="es-yours">Yours</span>
          {saved.length ? (
            saved.map((s) => (
              <button key={s.id} type="button" className="es-chip" onClick={() => onPickSaved(s)} title={s.name}>
                {s.name}
              </button>
            ))
          ) : (
            <span className="es-hint">Nothing saved in this browser yet. Save keeps the question in the slots.</span>
          )}
          <span className="es-io">
            <button type="button" className="dk-link" onClick={download} disabled={!saved.length}>
              Export JSON
            </button>
            <button type="button" className="dk-link" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} aria-label="Import saved questions" />
          </span>
          {note ? (
            <span className="es-hint" role="status">
              {note}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="es-chips">
          <span className="es-hint">Change any slot below, then Run. Save keeps it under My saved questions.</span>
        </div>
      )}
      <p className="es-spelled">
        <span className="dk-stat-label">The question, spelled out</span>
        <span className="es-hint">change any slot and it becomes your own · {series ? `every slot lists the same ${series.length} series` : seriesFailed ? "the series list is awaiting refresh" : "every slot lists the same series"}</span>
      </p>
      <div className="es-slots">
        <Slot label="Shock" value={draft?.shock ?? ""} options={seriesOptions} onChange={set("shock")} disabled={!draft || !series} awaiting={seriesFailed} />
        <Slot label="Window" value={String(draft?.window ?? "")} options={WINDOWS.map((w) => ({ id: String(w), label: `${w} days` }))} onChange={set("window")} disabled={!draft} />
        <Slot label="Move" tip="σ measured over the last 252 sessions" value={draft?.move ?? ""} options={MOVES.map((m) => ({ id: m.id as Move, label: m.label }))} onChange={set("move")} disabled={!draft} />
        <Slot label="While" tip="condition checked on the shock day, entry next session" value={draft?.while ?? ""} options={[...WHILES]} onChange={set("while")} disabled={!draft} />
        <Slot label="What happens to" value={draft?.target ?? ""} options={seriesOptions} onChange={set("target")} disabled={!draft || !series} awaiting={seriesFailed} />
        <Slot label="Over the next" value={String(draft?.horizon ?? "")} options={HORIZONS.map((h) => ({ id: String(h.h), label: h.label }))} onChange={set("horizon")} disabled={!draft} />
        <button type="button" className="dk-btn es-run" data-kind="primary" onClick={onRun} disabled={!draft || running} data-testid="es-run">
          Run
        </button>
        <button type="button" className="dk-btn es-save" onClick={onSave} disabled={!draft} data-testid="es-save">
          Save
        </button>
      </div>
    </section>
  );
}
