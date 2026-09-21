/**
 * Position Monitor (docs/desk/DESK_FRAME_SPEC.md §5). Left: the promote-to-
 * position form (instrument, direction, size, horizon) and the discipline
 * gate (variant view, pre-mortem, a numeric falsification level tied to a
 * series), with the language check flagging uncalibrated words and offering
 * a rewrite. Save stays disabled until the gate passes, the form's submit
 * runs the gate again, and the store runs it a third time, so neither the
 * keyboard nor the URL can get round it (gate.ts, store.ts). Right: the
 * monitored list, "saved on this device", each position with its distance to
 * falsification from the live series (series.ts). Client view hides the form
 * and prints the distances in words.
 */

import { useId, useMemo, useState, type FormEvent } from "react";
import { Segmented, Tag } from "../../../components";
import { fmtDate } from "../../../lib/format";
import { Caption } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import { Seals } from "../Seals";
import StatusBadge from "../StatusBadge";
import { SOURCES } from "../badge-sources";
import type { DeskPage } from "../desk-sections";
import { GATES } from "../desk-sections";
import { EmptyState, Panel } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { EMPTY_DRAFT, applyRewrite, gateStatus, type Draft, type Flag, type ThesisField } from "./gate";
import { FRED_SERIES, MARKET_SERIES, distanceInWords, distanceSentence, fmtValue, seriesRef, useReading, useReadings, type ReadingState } from "./series";
import { usePositions, type Position } from "./store";

const HORIZONS = ["1 week", "1 month", "3 months", "6 months", "12 months"];

function FlagList({ flags, onReplace }: { flags: Flag[]; onReplace: (f: Flag) => void }) {
  if (!flags.length) return null;
  return (
    <ul className="mrr-desk-flags" aria-label="Flagged words">
      {flags.map((f) => (
        <li key={`${f.field}-${f.index}`} className="mrr-desk-flag">
          <b>{f.word}</b>
          <span>
            try <q>{f.suggestion}</q>
          </span>
          <button type="button" onClick={() => onReplace(f)}>
            Replace
          </button>
        </li>
      ))}
    </ul>
  );
}

function ThesisField({
  id,
  field,
  label,
  hint,
  value,
  flags,
  onChange,
}: {
  id: string;
  field: ThesisField;
  label: string;
  hint: string;
  value: string;
  flags: Flag[];
  onChange: (v: string) => void;
}) {
  const own = flags.filter((f) => f.field === field);
  return (
    <div className="mrr-desk-field" data-span="2">
      <label className="mrr-desk-label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="mrr-desk-input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={own.length ? true : undefined} aria-describedby={`${id}-hint`} placeholder={hint} />
      <p id={`${id}-hint`} className="mrr-desk-hint">
        {hint}
      </p>
      <FlagList flags={own} onReplace={(f) => onChange(applyRewrite(value, f))} />
    </div>
  );
}

function PromoteForm({ onSaved }: { onSaved: (p: Position, persisted: boolean) => void }) {
  const uid = useId();
  const { add } = usePositions();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string>("");
  const gate = useMemo(() => gateStatus(draft), [draft]);
  const ref = seriesRef(draft.falsification_series);
  const reading = useReading(draft.falsification_series || null);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The gate runs here again and once more inside the store: a submit from
    // Enter in a field, or any script, meets the same refusal as the button.
    const status = gateStatus(draft);
    if (!status.ok) {
      setNotice("Nothing saved. The gate row above says what is still missing.");
      return;
    }
    const result = add(draft);
    if (!result.ok) {
      setNotice(`Nothing saved. ${result.reason}`);
      return;
    }
    setDraft(EMPTY_DRAFT);
    setNotice(result.persisted ? `Saved ${result.position.instrument} on this device.` : `Saved ${result.position.instrument} for this session only: this browser refused storage.`);
    onSaved(result.position, result.persisted);
  };

  const sealStates = [gate.variant, gate.premortem, gate.falsification] as const;
  const sealLabel = `Gate: variant view ${gate.variant}, pre-mortem ${gate.premortem}, falsification ${gate.falsification}.`;

  return (
    <form className="mrr-desk-form" onSubmit={submit} noValidate aria-describedby={`${uid}-gate`}>
      <div className="mrr-desk-fields">
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor={`${uid}-instrument`}>
            Instrument
          </label>
          <input id={`${uid}-instrument`} className="mrr-desk-input" value={draft.instrument} onChange={(e) => set("instrument")(e.target.value)} placeholder="e.g. TLT, 2s10s steepener, XLE vs SPY" autoComplete="off" />
        </div>
        <div className="mrr-desk-field">
          <span className="mrr-desk-label" id={`${uid}-direction`}>
            Direction
          </span>
          <Segmented label="Direction" options={[{ id: "long", label: "Long" }, { id: "short", label: "Short" }]} value={draft.direction} onChange={(id) => set("direction")(id === "short" ? "short" : "long")} aria-describedby={`${uid}-direction`} />
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor={`${uid}-size`}>
            Size
          </label>
          <input id={`${uid}-size`} className="mrr-desk-input" value={draft.size} onChange={(e) => set("size")(e.target.value)} placeholder="e.g. 2% of NAV, 50 bp of risk" autoComplete="off" />
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor={`${uid}-horizon`}>
            Horizon
          </label>
          <select id={`${uid}-horizon`} className="mrr-desk-input" value={draft.horizon} onChange={(e) => set("horizon")(e.target.value)}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <ThesisField id={`${uid}-variant`} field="variant_view" label="Variant view" hint="What you believe that the market does not, and why the market is wrong. Calibrated language only." value={draft.variant_view} flags={gate.flags} onChange={set("variant_view")} />
        <ThesisField id={`${uid}-premortem`} field="pre_mortem" label="Pre-mortem" hint="It is the horizon date and the position lost. Write the most likely reason before defending the idea." value={draft.pre_mortem} flags={gate.flags} onChange={set("pre_mortem")} />
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor={`${uid}-series`}>
            Falsification series
          </label>
          <select id={`${uid}-series`} className="mrr-desk-input" value={draft.falsification_series} onChange={(e) => set("falsification_series")(e.target.value)}>
            <option value="">Choose a series…</option>
            <optgroup label="FRED">
              {FRED_SERIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.id})
                </option>
              ))}
            </optgroup>
            <optgroup label="Stored closes">
              {MARKET_SERIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="mrr-desk-hint" role="status">
            {!ref ? "The level is judged against this series' live reading." : reading.data ? `Now ${fmtValue(ref, reading.data.value)} (${fmtDate(reading.data.date)}).` : reading.isError ? "The live reading did not answer." : "Reading the series…"}
          </p>
        </div>
        <div className="mrr-desk-field">
          <span className="mrr-desk-label" id={`${uid}-fdir`}>
            Wrong when the series is
          </span>
          <Segmented label="Falsification direction" options={[{ id: "below", label: "Below" }, { id: "above", label: "Above" }]} value={draft.falsification_direction} onChange={(id) => set("falsification_direction")(id === "above" ? "above" : "below")} aria-describedby={`${uid}-fdir`} />
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor={`${uid}-level`}>
            Falsification level{ref?.unit ? ` (${ref.unit === "$" ? "USD" : ref.unit})` : ""}
          </label>
          <input id={`${uid}-level`} className="mrr-desk-input" data-mono="true" inputMode="decimal" value={draft.falsification_level} onChange={(e) => set("falsification_level")(e.target.value)} placeholder="a number" autoComplete="off" aria-invalid={draft.falsification_level.trim() !== "" && gate.level == null ? true : undefined} />
        </div>
      </div>

      <div className="mrr-desk-gate" id={`${uid}-gate`}>
        <Seals states={sealStates} size="lg" label={sealLabel} />
        {GATES.map((g, i) => (
          <span key={g.id} className="mrr-desk-gate-item" data-met={sealStates[i] === "met" ? "true" : undefined}>
            {g.label}
            <span aria-hidden="true" style={{ color: "var(--text-4)" }}>
              {sealStates[i] === "met" ? "✓" : sealStates[i] === "flagged" ? "▪" : "·"}
            </span>
          </span>
        ))}
        <span role="status" style={{ flex: "1 1 240px", fontFamily: "var(--font-ui)", fontSize: 12.5, color: gate.ok ? "var(--mint)" : "var(--text-3)" }}>
          {gate.ok ? "Gate passed. Save records the position on this device." : gate.reason}
        </span>
      </div>

      <div className="mrr-desk-actions">
        <button type="submit" className="mrr-btn mrr-btn-primary" disabled={!gate.ok} aria-disabled={!gate.ok} data-testid="desk-save-position">
          Save position
        </button>
        <button type="button" className="mrr-btn" onClick={() => setDraft(EMPTY_DRAFT)}>
          Clear
        </button>
        {notice ? (
          <span role="status" style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-2)" }}>
            {notice}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function MonitoredRow({ p, reading, isClient, onRemove }: { p: Position; reading: ReadingState; isClient: boolean; onRemove?: (id: string) => void }) {
  const ref = seriesRef(p.falsification.series);
  const s = reading.data ? distanceSentence(ref, reading.data, p.falsification) : null;
  return (
    <li className="mrr-desk-row" data-testid="desk-position">
      <div style={{ minWidth: 0 }}>
        <div className="mrr-desk-row-title">
          {p.instrument} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· {p.direction}</span>
          {p.size ? <span style={{ color: "var(--text-3)", fontWeight: 400 }}> · {p.size}</span> : null}
        </div>
        <div className="mrr-desk-row-sub">
          {ref?.label ?? p.falsification.series}: {isClient ? `wrong ${p.falsification.direction} ${fmtValue(ref, p.falsification.level)}` : s ? `${s.now} · ${s.rule}` : `falsified ${p.falsification.direction} ${fmtValue(ref, p.falsification.level)}`}
          {" · "}
          {p.horizon} horizon · saved {fmtDate(p.created_at.slice(0, 10))}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        {reading.data ? (
          <>
            <div className="mrr-desk-row-num" style={{ color: s?.falsified ? "var(--neg)" : undefined }}>
              {isClient ? distanceInWords(reading.data, p.falsification) : s?.distance}
            </div>
            <div className="mrr-desk-row-meta">{s?.falsified ? "FALSIFIED" : "DISTANCE TO FALSIFICATION"}</div>
          </>
        ) : (
          <div className="mrr-desk-row-sub" role="status">
            {reading.isError ? "Live reading unavailable." : "Reading the series…"}
          </div>
        )}
      </div>
      {!isClient ? (
        <div className="mrr-desk-row-sub" style={{ gridColumn: "1 / -1" }}>
          <strong style={{ color: "var(--text-2)", fontWeight: 500 }}>Variant view.</strong> {p.variant_view} <strong style={{ color: "var(--text-2)", fontWeight: 500 }}>Pre-mortem.</strong> {p.pre_mortem}
        </div>
      ) : null}
      {onRemove ? (
        <div className="mrr-desk-row-actions" data-print-hide="true">
          <button type="button" className="mrr-btn" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.instrument}`}>
            Remove
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default function PositionMonitorPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const { positions, remove, storageAvailable } = usePositions();
  const readings = useReadings(positions);
  const [lastSaved, setLastSaved] = useState<string>("");
  const falsified = positions.filter((p) => {
    const r = readings[p.id]?.data;
    return r ? distanceSentence(seriesRef(p.falsification.series), r, p.falsification).falsified : false;
  }).length;

  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} description={page.blurb} badge={<StatusBadge source={SOURCES.positions} />} />
      <div className={isClient ? undefined : "mrr-desk-main-side"}>
        {!isClient ? (
          <Panel id="promote" title="Promote to position" description="Four facts, then the three gates. Nothing saves until every gate is met." badge={<Tag tone="reference">Saved on this device</Tag>}>
            <PromoteForm onSaved={(p) => setLastSaved(p.id)} />
          </Panel>
        ) : null}
        <Panel
          id="monitored"
          title="Monitored positions"
          description={isClient ? "Each position and how far it sits from the level that would prove it wrong." : "Distance to falsification from the live series; the newest reading dates each line."}
          meta={positions.length ? `${positions.length} saved · ${falsified} falsified` : "none saved"}
          badge={<Tag tone="reference">Saved on this device</Tag>}
        >
          {positions.length ? (
            <ul className="mrr-desk-rows" aria-label="Monitored positions">
              {positions.map((p) => (
                <MonitoredRow key={p.id} p={p} reading={readings[p.id] ?? { isLoading: true, isError: false }} isClient={isClient} onRemove={isClient ? undefined : remove} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No positions saved on this device.">{isClient ? "Positions are promoted through the discipline gate in the desk view." : "Promote one through the gate on the left. Nothing is seeded, and nothing leaves this browser."}</EmptyState>
          )}
          <Caption style={{ marginTop: 12 }}>
            {storageAvailable ? "Positions are stored in this browser only: no account, no server, no sync between devices." : "This browser refused storage: positions last for this session only."}
            {lastSaved ? " Newest save is listed above." : ""}
          </Caption>
        </Panel>
      </div>
    </div>
  );
}
