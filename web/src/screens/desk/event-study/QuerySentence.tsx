/**
 * The query as a sentence (DESK_FRAME2_SPEC §2): "When [shock asset] moves
 * [≥ threshold σ] [up/down] over [window] sessions while [co-condition], what
 * did [target] do next in [all regimes]?" Each control is a compact inline
 * select or a segmented toggle with its own accessible name; the helper text
 * the frame printed under each field lives in the jargon tooltips on the
 * sentence's words. Presets sit above the sentence as chips. Run writes the
 * engine's slug into ?study=; "Sample: {start} to {end}" under the sentence
 * comes from the study on screen, and a 422 or a not_stored prints the
 * engine's reason under the query.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Segmented } from "../../../components";
import type { EventStudyAsset, EventStudyAssets, EventStudyParams, EventStudyResponse } from "../../../api/desk";
import Jargon from "../../shared/Jargon";
import { pyFixed } from "../pyformat";
import { listWords } from "../words";
import { historyLine, sampleLine } from "./format";
import { PRESET, slugFor } from "./studies";

export const REGIME_WORD: Record<string, string> = { all: "all regimes", goldilocks: "Goldilocks", overheating: "Overheating", stagflation: "Stagflation", recession_risk: "Recession Risk" };
const SIGN_WORD: Record<EventStudyParams["sign"], string> = { "+": "up", "-": "down", both: "either way" };

function InlineSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; testId?: string }) {
  const known = options.some((o) => o.id === value);
  return (
    <select className="mrr-desk-inline" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {known ? null : <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function assetOptions(xs: EventStudyAsset[]) {
  return xs.map((x) => ({ id: x.id, label: x.status === "awaiting_refresh" ? `${x.label} (awaiting refresh)` : x.label }));
}

export interface QuerySentenceProps {
  assets: EventStudyAssets;
  /** The study the address names. */
  params: EventStudyParams;
  slug: string;
  /** The study on screen, when it has answered: its sample line. */
  study: EventStudyResponse | null;
  /** The engine's reason for refusing the addressed query (422, not_stored). */
  refusal: string | null;
  onRun: (slug: string) => void;
}

export default function QuerySentence({ assets, params, slug, study, refusal, onRun }: QuerySentenceProps) {
  // The sentence composes shock studies; a cross preset leaves it on the first preset's fields.
  const start = params.kind === "cross" ? PRESET : params;
  const [draft, setDraft] = useState<EventStudyParams>(start);
  useEffect(() => setDraft(params.kind === "cross" ? PRESET : params), [params]);
  const set = <K extends keyof EventStudyParams>(k: K) => (v: EventStudyParams[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const draftSlug = slugFor({ ...draft, kind: "shock", cross: null });
  const crossOnScreen = params.kind === "cross";
  const dirty = draftSlug !== (crossOnScreen ? slugFor(PRESET) : slug);
  const signs = assets.signs ?? ["+", "-"];
  const lag = assets.regime_lag_months;
  const conditions = assets.conditions.map((c) => (c.id === "none" ? { id: "none", label: "no condition applies" } : c));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onRun(draftSlug);
  };

  return (
    <form className="mrr-desk-form" onSubmit={submit} aria-label="Event study query">
      {assets.presets?.length ? (
        <div className="mrr-desk-chips" role="group" aria-label="Presets">
          {assets.presets.map((p) => (
            <button key={p.slug} type="button" className="mrr-desk-chip" aria-pressed={slug === p.slug} onClick={() => onRun(p.slug)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mrr-desk-sentence" data-testid="es-sentence">
        When <InlineSelect label="Shock asset" value={draft.shock} options={assetOptions(assets.shock_assets)} onChange={set("shock")} testId="es-shock" />{" "}
        <Jargon term="shock move" def={`The shock is the move over the window: a log return for a price, a change in basis points for a yield or a spread, a log change for VIX, scored as a z-score against its own trailing ${study?.provenance.z_window != null ? `${study.provenance.z_window} sessions` : "year of sessions"}.`}>
          moves
        </Jargon>{" "}
        <InlineSelect label="Threshold" value={String(draft.z)} options={assets.thresholds.map((z) => ({ id: String(z), label: `≥ ${pyFixed(z, 1)}σ` }))} onChange={(v) => set("z")(Number(v))} testId="es-z" />{" "}
        <Segmented label="Direction" options={signs.map((s) => ({ id: s, label: SIGN_WORD[s] }))} value={draft.sign} onChange={(v) => set("sign")(v as EventStudyParams["sign"])} className="mrr-desk-inline-seg" /> over{" "}
        <InlineSelect label="Window in sessions" value={String(draft.w)} options={assets.windows.map((w) => ({ id: String(w), label: String(w) }))} onChange={(v) => set("w")(Number(v))} testId="es-w" />{" "}
        <Jargon term="sessions" def="Trading sessions on the NYSE calendar (XNYS), early closes included; weekends and exchange holidays are not sessions.">
          sessions
        </Jargon>{" "}
        <Jargon term="co-condition" def="Evaluated on the event date with data through that date only. A shock whose condition fails is dropped and still starts the cooldown.">
          while
        </Jargon>{" "}
        <InlineSelect label="Co-condition" value={draft.cond} options={conditions} onChange={set("cond")} testId="es-cond" />, what did{" "}
        <InlineSelect label="Target" value={draft.target} options={assetOptions(assets.targets)} onChange={set("target")} testId="es-target" />{" "}
        <Jargon term="forward moves" def={`Forward moves from the entry close at ${listWords(assets.horizons)} sessions, against every evaluable session under the same rules as the baseline.`}>
          do next
        </Jargon>{" "}
        <Jargon
          term="regime filter"
          def={`The classifier's stored label from ${lag != null ? `${lag} months` : "an earlier month"} before each event, read as stored; events before the first stored label sit in their own Unlabeled row.`}
        >
          in
        </Jargon>{" "}
        <InlineSelect label="Regime filter" value={draft.regime} options={assets.regimes.map((r) => ({ id: r, label: REGIME_WORD[r] ?? r }))} onChange={set("regime")} testId="es-regime" />?
      </div>
      <div className="mrr-desk-actions">
        <button type="submit" className="mrr-btn mrr-btn-primary" data-testid="es-run">
          Run study
        </button>
        <span className="mrr-desk-hint" role="status" data-testid="es-sample">
          {study ? (
            <Jargon term="sample" def={historyLine(study)}>
              {sampleLine(study)}
            </Jargon>
          ) : (
            "The sample prints here once the engine answers."
          )}
          {dirty ? " · The sentence has changed: Run reads it." : crossOnScreen ? " · A cross study is on screen; the sentence composes shock studies." : ""}
        </span>
      </div>
      {refusal ? (
        <p className="mrr-desk-refusal" role="alert" data-testid="es-refusal">
          The engine could not run this query: {refusal}
        </p>
      ) : null}
      {assets.awaiting?.length ? <p className="mrr-desk-hint">{`Awaiting a full refresh: ${assets.awaiting.join(", ")}. A study on them says so until a refresh has stored their daily history.`}</p> : null}
    </form>
  );
}
