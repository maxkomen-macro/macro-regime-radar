/**
 * S&P Internals (DESK_FRAME2_SPEC §4, Act › S&P Internals), built on the
 * engine's cross study: the golden and the death cross of the S&P 500's
 * 50-day and 200-day averages, each read through the same machinery as any
 * event study (the engine's presets spx-golden-cross and spx-death-cross).
 *
 * The page opens by stating which of the two reads the engine establishes
 * and at which horizons, from each horizon's served exclusion verdict, and
 * quotes the engine's own sentences on them. Then, per cross: the verdict,
 * the horizon chart, the regime split and the event list (results.tsx).
 * Breadth and sector rotation are Designed shells naming what they read once
 * the Desk's daily store carries it; the series the engine registers but
 * does not store are listed from the assets endpoint. No fake numbers.
 */

import type { ReactNode } from "react";
import { ApiError } from "../../../api/client";
import { useEventStudy, useEventStudyAssets, type EventStudyResponse, type Exclusion } from "../../../api/desk";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel, ReadsNote } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { listWords } from "../words";
import { StudyState } from "../event-study/EventStudyPage";
import StudyBadge from "../event-study/StudyBadge";
import { EXCLUSION_CLIENT } from "../event-study/format";
import { EventsCard, HorizonCard, RegimeCard, VerdictCard } from "../event-study/results";

export const CROSSES = [
  { slug: "spx-golden-cross", name: "Golden cross", line: "50-day average crosses above the 200-day" },
  { slug: "spx-death-cross", name: "Death cross", line: "50-day average crosses below the 200-day" },
] as const;

/** The engine's sentences about its reads: the interval, the effect, the
 * horizons it cannot tell from baseline or cannot judge. Quoted, never edited. */
const READ_SENTENCE = /interval on Δ|not distinguishable|No interval at|Insufficient data at|The effect is/;

export function engineReadSentences(study: EventStudyResponse): string[] {
  return study.verdict.points.filter((s) => READ_SENTENCE.test(s));
}

/** Pure: which horizons carry which of the engine's exclusion verdicts. */
export function horizonsBy(study: EventStudyResponse): Record<Exclusion | "unjudged", number[]> {
  const out: Record<Exclusion | "unjudged", number[]> = { established: [], "not established": [], included: [], unjudged: [] };
  for (const h of study.horizons) out[h.exclusion ?? "unjudged"].push(h.h);
  return out;
}

/** Pure: the plain statement for one cross, in the engine's vocabulary. */
export function plainRead(name: string, study: EventStudyResponse): string {
  const by = horizonsBy(study);
  const parts: string[] = [];
  parts.push(by.established.length ? `established at ${listWords(by.established)} sessions` : "established at no horizon");
  if (by["not established"].length) parts.push(`not established at ${listWords(by["not established"])} sessions`);
  if (by.included.length) parts.push(`the 90% interval on Δ includes zero at ${listWords(by.included)} sessions`);
  if (by.unjudged.length) parts.push(`not judged at ${listWords(by.unjudged)} sessions`);
  return `${name}: ${parts.join("; ")}.`;
}

/** Pure: the same statement in the client register (the engine's categories in words). */
export function plainReadClient(name: string, study: EventStudyResponse): string {
  const by = horizonsBy(study);
  const parts: string[] = [];
  parts.push(by.established.length ? `${EXCLUSION_CLIENT.established} at ${listWords(by.established)} sessions` : `${EXCLUSION_CLIENT.established} at no horizon`);
  if (by["not established"].length) parts.push(`${EXCLUSION_CLIENT["not established"]} at ${listWords(by["not established"])} sessions`);
  if (by.included.length) parts.push(`${EXCLUSION_CLIENT.included} at ${listWords(by.included)} sessions`);
  if (by.unjudged.length) parts.push(`too few episodes to judge at ${listWords(by.unjudged)} sessions`);
  return `${name}: ${parts.join("; ")}.`;
}

function CrossColumn({ name, line, slug, isClient }: { name: string; line: string; slug: string; isClient: boolean }) {
  const q = useEventStudy(slug);
  const r = q.data;
  const study = r?.state === "ready" ? r.study : null;
  const err = q.error instanceof ApiError ? q.error : null;
  const failure = q.failureReason instanceof ApiError ? q.failureReason : null;
  if (!study) {
    return (
      <Panel id={slug} title={name} description={line} badge={
          <StudyBadge
            study={null}
            pending={r?.state === "awaiting_refresh" ? r.detail : undefined}
            wait={err?.status === 404 ? "not on this server" : failure?.status === 429 ? "busy" : r?.state === "computing" ? "computing" : r?.state === "awaiting_refresh" ? "awaiting refresh" : q.isError ? "no answer" : "waiting"}
          />
        } className={q.isLoading || r?.state === "computing" ? "mrr-desk-reserve-col" : undefined}>
        <StudyState
          slug={slug}
          loading={q.isLoading}
          computing={r?.state === "computing" ? r.detail : null}
          busy={failure?.status === 429 ? failure.message : null}
          awaiting={r?.state === "awaiting_refresh" ? r.detail : null}
          refusal={err && err.status === 422 ? err.message : null}
          absent={err?.status === 404}
          error={err?.message ?? null}
          onRetry={() => void q.refetch()}
        />
      </Panel>
    );
  }
  return (
    <div className="mrr-desk-col" data-cross={slug}>
      <VerdictCard study={study} isClient={isClient} id={`${slug}-verdict`} title={`${name} · verdict`} />
      <HorizonCard study={study} isClient={isClient} id={`${slug}-horizons`} title={`${name} · by horizon`} />
      {!isClient ? (
        <>
          <RegimeCard study={study} id={`${slug}-regimes`} title={`${name} · by regime`} />
          <EventsCard study={study} id={`${slug}-events`} title={`${name} · events`} />
        </>
      ) : null}
    </div>
  );
}

function ReadsCard({ golden, death, isClient }: { golden: EventStudyResponse | null; death: EventStudyResponse | null; isClient: boolean }) {
  const rows: { name: string; study: EventStudyResponse | null }[] = [
    { name: CROSSES[0].name, study: golden },
    { name: CROSSES[1].name, study: death },
  ];
  const any = golden ?? death;
  let body: ReactNode;
  if (!any) {
    body = (
      <p className="mrr-desk-quiet" role="status" data-reserve="reads">
        Waiting for the engine's two cross studies.
      </p>
    );
  } else {
    body = (
      <ul className="mrr-desk-reads">
        {rows.map(({ name, study }) => (
          <li key={name} data-testid="internals-read">
            {study ? (
              <>
                <p className="mrr-desk-reads-plain">{isClient ? plainReadClient(name, study) : plainRead(name, study)}</p>
                {!isClient ? (
                  <blockquote className="mrr-desk-reads-quote" cite={`/api/desk/event-study?study=${study.slug}`}>
                    {engineReadSentences(study).join(" ")}
                  </blockquote>
                ) : null}
              </>
            ) : (
              <p className="mrr-desk-reads-plain">{name}: the engine has not answered yet.</p>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel id="reads" title="What the engine establishes" description={isClient ? "The two crosses, in plain words." : "Per cross, the horizons whose 90% interval on Δ excludes zero under the engine's rules, then the engine's own sentences."} badge={<StudyBadge study={any} />}>
      {body}
    </Panel>
  );
}

export default function InternalsPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const golden = useEventStudy(CROSSES[0].slug);
  const death = useEventStudy(CROSSES[1].slug);
  const assets = useEventStudyAssets();
  const g = golden.data?.state === "ready" ? golden.data.study : null;
  const d = death.data?.state === "ready" ? death.data.study : null;
  const sectors = (assets.data?.registered ?? []).filter((x) => /sector ETF/i.test(x.label));

  return (
    <div className="mrr-desk-page">
      <DeskPageHead
        page={page}
        title={isClient ? "The S&P 500's 50-day and 200-day crosses" : page.label}
        description={isClient ? "What the S&P 500 did after its 50-day average crossed its 200-day, in either direction." : page.blurb}
        badge={<StudyBadge study={g ?? d} />}
      />
      <ReadsCard golden={g} death={d} isClient={isClient} />
      <div className="mrr-desk-2 mrr-desk-cols">
        {CROSSES.map((c) => (
          <CrossColumn key={c.slug} name={c.name} line={c.line} slug={c.slug} isClient={isClient} />
        ))}
      </div>
      {!isClient ? (
        <div className="mrr-desk-2">
          <Panel id="breadth" title="Breadth" description="Share of S&P 500 constituents above their 50-day and 200-day averages." badge={<StatusBadge designed note="No constituent series is in the Desk's daily store." />}>
            <EmptyState title="Nothing to show yet.">No constituent series is registered in the engine or stored in the Desk's daily store.</EmptyState>
            <ReadsNote>Reads each S&P 500 constituent's daily close once the Desk's daily store carries them.</ReadsNote>
          </Panel>
          <Panel id="sector-rotation" title="Sector rotation" description="The sector ETFs' relative moves around each cross." badge={<StatusBadge designed note="The sector ETFs are registered in the engine and deferred; none is in the Desk's daily store." />}>
            <EmptyState title="Nothing to show yet.">
              {sectors.length ? `Registered in the engine, not yet stored: ${sectors.map((x) => x.label.replace(/ sector ETF \((\w+)\)$/, " ($1)")).join(", ")}.` : "The engine's asset list has not loaded."}
            </EmptyState>
            <ReadsNote>Reads the sector ETFs' daily closes once the Desk's daily store carries them.</ReadsNote>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
