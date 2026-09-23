/**
 * Event Study (DESK_FRAME2_SPEC §1 to §3). The panel reads the engine only:
 * /api/desk/event-study/assets for the sentence's lists and
 * /api/desk/event-study?study=<slug> for the study, adapted in api/desk.ts.
 * No fixture: every number on screen is a served field, formatted.
 *
 * The address names the study (?study=<the engine's slug>; the gold preset
 * when absent). Presets sit above the query as chips; Run writes the
 * sentence's slug. Every state the API answers has its own words: 202
 * computing is a quiet status line while the page asks again at the engine's
 * Retry-After; 429 is a plain "busy, try again" line; 422 and a not_stored
 * 503 print the engine's reason under the query; "awaiting the first full
 * refresh" is a sentence, never an empty chart; a server without the engine
 * (404) says so.
 *
 * Results: the horizon chart beside the verdict, then the by-regime table
 * and the recent events (results.tsx). One badge per card, the study's Live
 * badge. Client view: the verdict in the client register, the chart in its
 * simple form and a source line; the query and the working detail are hidden.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../../api/client";
import { isEngineAbsent, useEventStudy, useEventStudyAssets, type EventStudyResponse } from "../../../api/desk";
import { fmtDate } from "../../../lib/format";
import { Caption, StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { listWords } from "../words";
import QuerySentence from "./QuerySentence";
import StudyBadge, { type StudyWait } from "./StudyBadge";
import { EventsCard, HorizonCard, RegimeCard, VerdictCard } from "./results";
import { PRESET, PRESET_SLUG, paramsFor } from "./studies";

export function titleFor(study: EventStudyResponse, isClient: boolean): string {
  const p = study.params;
  if (p.kind === "cross") {
    const across = p.cross === "death" ? "below" : "above";
    return isClient ? `What the ${study.target.label} did after its 50-day average crossed ${across} the 200-day` : `${study.target.label} ${p.cross === "death" ? "death" : "golden"} cross (50-day ${across} 200-day)`;
  }
  const move = p.sign === "+" ? "rise" : p.sign === "-" ? "fall" : "move";
  return `What the ${study.target.label} did after an unusually large ${p.w}-session ${move} in ${study.shock.label}${study.condition ? `, with ${study.condition.label}` : ""}`;
}

/** The source line the client view and the one-pager print (§5). */
export function sourceLine(study: EventStudyResponse): string {
  const p = study.provenance;
  const inputs = p.inputs.map((i) => i.label).join(" and ");
  return `Source: Macro Regime Radar event-study engine${inputs ? `, reading ${inputs} daily closes` : ""}; as of ${fmtDate(p.as_of)}; sample ${p.sample_start} to ${p.sample_end}.`;
}

/** The results area when there is no study to print: one sentence per state. */
export function StudyState({
  slug,
  loading,
  computing,
  busy,
  awaiting,
  refusal,
  absent,
  error,
  onPreset,
  onRetry,
}: {
  slug: string;
  loading: boolean;
  computing: string | null;
  busy: string | null;
  awaiting: string | null;
  refusal: string | null;
  absent: boolean;
  error: string | null;
  /** Offered as a way back to the gold preset; absent where no preset applies. */
  onPreset?: (slug: string) => void;
  onRetry: () => void;
}) {
  const presetButton =
    onPreset && slug !== PRESET_SLUG ? (
      <button type="button" className="mrr-btn" style={{ marginTop: 10 }} onClick={() => onPreset(PRESET_SLUG)}>
        Load the gold preset
      </button>
    ) : null;
  if (busy)
    return (
      <p className="mrr-desk-quiet" role="status" data-state="busy">
        The engine is busy with other studies; try again in a few seconds.{" "}
        <button type="button" className="mrr-btn" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  if (computing)
    return (
      <p className="mrr-desk-quiet" role="status" data-state="computing">
        <span className="mrr-desk-quiet-dot" aria-hidden="true" /> Computing this study; the page asks again in a few seconds.
      </p>
    );
  if (loading)
    return (
      <p className="mrr-desk-quiet" role="status" data-state="loading">
        Requesting the study…
      </p>
    );
  if (awaiting)
    return (
      <EmptyState title="Awaiting the first full refresh.">
        {awaiting}
        {presetButton}
      </EmptyState>
    );
  if (refusal)
    return (
      <EmptyState title="No study to show for this query.">
        The engine's reason is printed under the query.
        {presetButton}
      </EmptyState>
    );
  if (absent)
    return (
      <EmptyState title="This server does not run the event-study engine.">
        The Desk reads studies only from the engine; nothing is shown in their place.
      </EmptyState>
    );
  return (
    <EmptyState title="The engine did not answer.">
      {error ?? "No reply."} Reload the page to ask again.
      {presetButton}
    </EmptyState>
  );
}

export default function EventStudyPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const [searchParams, setSearchParams] = useSearchParams();
  const slugParam = searchParams.get("study");
  // A slug the address carries but the engine's grammar does not read: the preset shows, and the page says so.
  const unknownSlug = slugParam != null && paramsFor(slugParam) == null ? slugParam : null;
  const slug = slugParam != null && !unknownSlug ? slugParam : PRESET_SLUG;
  const params = useMemo(() => paramsFor(slug) ?? PRESET, [slug]);
  const assetsQ = useEventStudyAssets();
  const studyQ = useEventStudy(slug);

  const result = studyQ.data;
  const study = result?.state === "ready" ? result.study : null;
  const err = studyQ.error instanceof ApiError ? studyQ.error : null;
  const failure = studyQ.failureReason instanceof ApiError ? studyQ.failureReason : null;
  const absent = (studyQ.isError && isEngineAbsent(studyQ.error)) || (assetsQ.isError && isEngineAbsent(assetsQ.error));
  const refusal = err && (err.status === 422 || (err.status === 503 && err.kind === "not_stored")) ? err.message : null;
  const busy = !study && failure?.status === 429 ? failure.message : null;

  const go = (next: string) => {
    setSearchParams(
      (prev) => {
        const q = new URLSearchParams(prev);
        q.set("study", next);
        return q;
      },
      { replace: false },
    );
  };

  const pending = result?.state === "computing" ? "The engine is computing this study." : result?.state === "awaiting_refresh" ? result.detail : "The study has not answered yet.";
  const wait: StudyWait = study
    ? "waiting"
    : absent
      ? "not on this server"
      : busy
        ? "busy"
        : result?.state === "computing"
          ? "computing"
          : result?.state === "awaiting_refresh"
            ? "awaiting refresh"
            : refusal
              ? "refused"
              : studyQ.isError
                ? "no answer"
                : "waiting";
  const badge = <StudyBadge study={study} pending={pending} wait={wait} />;

  return (
    <div className="mrr-desk-page">
      <DeskPageHead
        page={page}
        title={isClient && study ? titleFor(study, true) : page.label}
        description={study ? (isClient ? `How the ${study.target.label} moved over the next ${listWords(study.horizons.map((h) => h.h))} sessions, against an ordinary stretch of the same length.` : study.label) : page.blurb}
        badge={badge}
      />

      {unknownSlug ? <StateNote live>{`The study "${unknownSlug}" in the address is not one the engine can read; the gold preset is shown. Run a query to write an address the page can read back.`}</StateNote> : null}

      {!isClient ? (
        <Panel id="query" title="Query" badge={badge}>
          {assetsQ.data ? (
            <QuerySentence assets={assetsQ.data} params={params} slug={slug} study={study} refusal={refusal} onRun={go} />
          ) : assetsQ.isError ? (
            <EmptyState title="The engine's asset lists did not load.">{`${assetsQ.error instanceof Error ? assetsQ.error.message : "No reply."} The query returns when they do; reload to ask again.`}</EmptyState>
          ) : (
            <p className="mrr-desk-quiet" role="status" data-reserve="query">
              Reading the engine's asset lists…
            </p>
          )}
        </Panel>
      ) : null}

      {!study ? (
        <Panel id="results" title="Results" badge={badge} className={studyQ.isLoading || result?.state === "computing" ? "mrr-desk-reserve-results" : undefined}>
          <StudyState
            slug={slug}
            loading={studyQ.isLoading}
            computing={result?.state === "computing" ? result.detail : null}
            busy={busy}
            awaiting={result?.state === "awaiting_refresh" ? result.detail : null}
            refusal={refusal}
            absent={absent}
            error={err?.message ?? null}
            onPreset={go}
            onRetry={() => void studyQ.refetch()}
          />
        </Panel>
      ) : isClient ? (
        <>
          <VerdictCard study={study} isClient />
          <HorizonCard study={study} isClient title="After these events" />
          <p className="mrr-desk-source" data-testid="es-source">
            {sourceLine(study)}
          </p>
        </>
      ) : (
        <>
          <div className="mrr-desk-main-side mrr-desk-results">
            <HorizonCard study={study} isClient={false} />
            <VerdictCard study={study} isClient={false} />
          </div>
          <div className="mrr-desk-2">
            <RegimeCard study={study} />
            <EventsCard study={study} />
          </div>
          <Caption mono>
            {`as of ${study.provenance.as_of} · ${study.provenance.cooldown_rule ?? "cooldown not stated"} · ${study.provenance.bootstrap ? "cluster bootstrap" : "no bootstrap"}${study.provenance.n_boot ? `, ${study.provenance.n_boot.toLocaleString("en-US")} draws` : ""}, seed ${study.provenance.seed} · inputs ${study.provenance.inputs_hash} · slug ${study.slug}${study.provenance.warnings.length ? ` · ${study.provenance.warnings.join(" ")}` : ""}`}
          </Caption>
        </>
      )}
    </div>
  );
}
