/**
 * Event Study (docs/desk/DESK_FRAME_SPEC.md §5): the query builder (shock
 * asset, window, threshold, sign, co-condition, regime filter, target, Run),
 * the distribution chart, the horizon table, the regime split, the last ten
 * events and the verdict card. Assets come from /api/desk/event-study/assets
 * with history_from shown; the study from /api/desk/event-study. Until Stream
 * A lands the engine, both answer 404 and the page shows the fixture for the
 * preset only, labelled as a fixture on the badge, the tables and the
 * verdict; any other query prints what is missing instead of inventing
 * numbers. Studies are addressable by ?study=<slug> (studies.ts). Client view
 * hides the builder, N, intervals, the bootstrap details and method ids, and
 * prints the headline numbers as words.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable, Segmented, Tag } from "../../../components";
import { isEngineAbsent, useEventStudy, useEventStudyAssets, type EventStudyAsset, type EventStudyHorizon, type EventStudyParams, type EventStudyResponse, type ShockUnit } from "../../../api/desk";
import { fmtDate, fmtWholePct } from "../../../lib/format";
import Jargon from "../../shared/Jargon";
import ScrollTable from "../../shared/ScrollTable";
import { Caption, StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { moveInWords, sessionsInWords, timesInTen } from "../words";
import DistributionChart from "./DistributionChart";
import { FIXTURE_ASSETS, FIXTURE_STUDY } from "./fixture";
import { PRESET, PRESET_SLUG, paramsFor, sameParams, slugFor } from "./studies";

const REGIME_LABEL: Record<string, string> = { all: "All regimes", goldilocks: "Goldilocks", overheating: "Overheating", stagflation: "Stagflation", recession_risk: "Recession Risk" };

function unitWord(u: ShockUnit): "%" | "bp" {
  return u === "bp" ? "bp" : "%";
}

function fmtMove(x: number | null | undefined, unit: "%" | "bp"): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const dp = unit === "%" ? 1 : 0;
  return `${x > 0 ? "+" : ""}${x.toFixed(dp)}${unit === "%" ? "%" : " bp"}`;
}

function yearOf(iso: string): string {
  return iso.slice(0, 4);
}

function AssetSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: EventStudyAsset[]; onChange: (v: string) => void }) {
  const chosen = options.find((o) => o.id === value);
  return (
    <div className="mrr-desk-field">
      <label className="mrr-desk-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="mrr-desk-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} · from {yearOf(o.history_from)}
          </option>
        ))}
      </select>
      <p className="mrr-desk-hint">
        {chosen ? (chosen.warn ? `Short history: from ${fmtDate(chosen.history_from)}. Reads before that date are not possible.` : `History from ${fmtDate(chosen.history_from)}.`) : "Choose an asset."}
      </p>
    </div>
  );
}

function QueryBuilder({ assets, params, onRun }: { assets: typeof FIXTURE_ASSETS; params: EventStudyParams; onRun: (p: EventStudyParams) => void }) {
  const [draft, setDraft] = useState<EventStudyParams>(params);
  useEffect(() => setDraft(params), [params]);
  const set = <K extends keyof EventStudyParams>(k: K) => (v: EventStudyParams[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <form
      className="mrr-desk-form"
      onSubmit={(e) => {
        e.preventDefault();
        onRun(draft);
      }}
    >
      <div className="mrr-desk-fields">
        <AssetSelect id="es-shock" label="Shock asset" value={draft.shock} options={assets.shock_assets} onChange={set("shock")} />
        <div className="mrr-desk-field">
          <span className="mrr-desk-label" id="es-window">
            Window (sessions)
          </span>
          <Segmented label="Window" mono options={assets.windows.map((w) => ({ id: String(w), label: `${w}d` }))} value={String(draft.w)} onChange={(id) => set("w")(Number(id))} aria-describedby="es-window" />
        </div>
        <div className="mrr-desk-field">
          <span className="mrr-desk-label" id="es-z">
            Threshold (σ)
          </span>
          <Segmented label="Threshold" mono options={assets.thresholds.map((z) => ({ id: String(z), label: `${z.toFixed(1)}σ` }))} value={String(draft.z)} onChange={(id) => set("z")(Number(id))} aria-describedby="es-z" />
        </div>
        <div className="mrr-desk-field">
          <span className="mrr-desk-label" id="es-sign">
            Sign
          </span>
          <Segmented label="Sign" mono options={[{ id: "+", label: "Up" }, { id: "-", label: "Down" }]} value={draft.sign} onChange={(id) => set("sign")(id === "-" ? "-" : "+")} aria-describedby="es-sign" />
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor="es-cond">
            Co-condition
          </label>
          <select id="es-cond" className="mrr-desk-input" value={draft.cond} onChange={(e) => set("cond")(e.target.value)}>
            {assets.conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mrr-desk-hint">Evaluated on the event date with data through that date only.</p>
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor="es-regime">
            Regime filter
          </label>
          <select id="es-regime" className="mrr-desk-input" value={draft.regime} onChange={(e) => set("regime")(e.target.value)}>
            {assets.regimes.map((r) => (
              <option key={r} value={r}>
                {REGIME_LABEL[r] ?? r}
              </option>
            ))}
          </select>
          <p className="mrr-desk-hint">The classifier's stored label at the event date; never recomputed here.</p>
        </div>
        <AssetSelect id="es-target" label="Target" value={draft.target} options={assets.targets} onChange={set("target")} />
      </div>
      <div className="mrr-desk-actions">
        <button type="submit" className="mrr-btn mrr-btn-primary" data-testid="es-run">
          Run study
        </button>
        <span className="mrr-desk-hint" style={{ fontFamily: "var(--font-mono)" }}>
          ?study={slugFor(draft)}
        </span>
      </div>
    </form>
  );
}

function HorizonTable({ study, unit, isClient }: { study: EventStudyResponse; unit: "%" | "bp"; isClient: boolean }) {
  const rows = study.horizons.map((h) => ({ ...h, id: String(h.h) }));
  const columns = isClient
    ? [
        { key: "h", label: "Horizon", render: (r: EventStudyHorizon) => sessionsInWords(r.h) },
        { key: "hit_rate", label: "Finished higher", render: (r: EventStudyHorizon) => timesInTen(r.hit_rate) },
        { key: "median", label: "Typical move", render: (r: EventStudyHorizon) => moveInWords(r.median, unit) },
        { key: "delta", label: "Against baseline", render: (r: EventStudyHorizon) => (Math.abs(r.delta) < (unit === "%" ? 0.4 : 3) ? "in line with baseline" : `${r.delta > 0 ? "above" : "below"} baseline by about ${Math.abs(r.delta).toFixed(unit === "%" ? 1 : 0)}${unit === "%" ? "%" : " bp"}`) },
      ]
    : [
        { key: "h", label: "h", mono: true, render: (r: EventStudyHorizon) => `${r.h}d` },
        { key: "n", label: "N", mono: true, align: "right" as const },
        { key: "hit_rate", label: <Jargon term="hit rate">Hit rate</Jargon>, mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtWholePct(r.hit_rate) },
        { key: "median", label: "Median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.median, unit) },
        { key: "mean", label: "Mean", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.mean, unit) },
        { key: "iqr", label: "p25 · p75", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => `${fmtMove(r.p25, unit)} · ${fmtMove(r.p75, unit)}` },
        { key: "baseline_median", label: "Base median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.baseline_median, unit) },
        { key: "baseline_hit_rate", label: "Base hit", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtWholePct(r.baseline_hit_rate) },
        { key: "delta", label: "Δ median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.delta, unit) },
        { key: "ci90", label: "90% CI on Δ", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => `${fmtMove(r.ci90[0], unit)} to ${fmtMove(r.ci90[1], unit)}` },
      ];
  return (
    <ScrollTable label="Forward moves by horizon">
      <DataTable caption="Forward moves by horizon" columns={columns} rows={rows} zebra={false} />
    </ScrollTable>
  );
}

function RegimeSplit({ study, unit, isClient }: { study: EventStudyResponse; unit: "%" | "bp"; isClient: boolean }) {
  const hs = study.horizons.map((h) => h.h);
  type Row = EventStudyResponse["regime_split"][number] & { id: string };
  const rows: Row[] = study.regime_split.map((r) => ({ ...r, id: r.regime }));
  const cell = (r: Row, h: number) => {
    const v = r.by_horizon[String(h)];
    if (r.suppressed || !v || v.hit_rate == null || v.median == null) return <span style={{ color: "var(--text-3)" }}>{isClient ? "too few events to read" : "n<10"}</span>;
    return isClient ? `${timesInTen(v.hit_rate)}, ${moveInWords(v.median, unit)}` : `${fmtWholePct(v.hit_rate)} · ${fmtMove(v.median, unit)}`;
  };
  const columns = [
    { key: "regime", label: "Regime", render: (r: Row) => r.regime },
    ...(isClient ? [] : [{ key: "n", label: "N", mono: true, align: "right" as const }]),
    ...hs.map((h) => ({ key: `h${h}`, label: isClient ? sessionsInWords(h) : `${h}d hit · median`, mono: !isClient, align: "right" as const, render: (r: Row) => cell(r, h) })),
  ];
  return (
    <ScrollTable label="Regime split">
      <DataTable caption="Forward moves by regime at the event date" columns={columns} rows={rows} zebra={false} />
    </ScrollTable>
  );
}

function RecentEvents({ study, unit, isClient }: { study: EventStudyResponse; unit: "%" | "bp"; isClient: boolean }) {
  const hs = study.horizons.map((h) => h.h);
  type Ev = EventStudyResponse["recent_events"][number] & { id: string };
  const rows: Ev[] = study.recent_events.map((e) => ({ ...e, id: e.date }));
  const columns = [
    { key: "date", label: "Event date", mono: true, render: (e: Ev) => fmtDate(e.date) },
    { key: "regime", label: "Regime" },
    ...(isClient ? [] : [{ key: "z", label: <Jargon term="z-score">z</Jargon>, mono: true, align: "right" as const, render: (e: Ev) => e.z.toFixed(2) }]),
    ...hs.map((h) => ({ key: `f${h}`, label: `+${h}d`, mono: true, align: "right" as const, render: (e: Ev) => (e.forward[String(h)] == null ? <span style={{ color: "var(--text-3)" }}>window open</span> : fmtMove(e.forward[String(h)], unit)) })),
  ];
  return (
    <ScrollTable label="Recent events">
      <DataTable caption="The last ten events with their forward moves" columns={columns} rows={rows} zebra={false} compact />
    </ScrollTable>
  );
}

export default function EventStudyPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const [searchParams, setSearchParams] = useSearchParams();
  const slugParam = searchParams.get("study");
  const params = useMemo(() => paramsFor(slugParam) ?? PRESET, [slugParam]);
  // A slug the address carries but nothing recognises: the preset shows, and the page says so.
  const unknownSlug = slugParam != null && paramsFor(slugParam) == null ? slugParam : null;
  const assetsQ = useEventStudyAssets();
  const studyQ = useEventStudy(params);

  const engineAbsent = (assetsQ.isError && isEngineAbsent(assetsQ.error)) || (studyQ.isError && isEngineAbsent(studyQ.error));
  const assets = assetsQ.data ?? (assetsQ.isError ? FIXTURE_ASSETS : undefined);
  const isPreset = sameParams(params, PRESET);
  const fixture = !studyQ.data && studyQ.isError && isPreset;
  const study: EventStudyResponse | undefined = studyQ.data ?? (fixture ? FIXTURE_STUDY : undefined);
  const unit = study ? unitWord(study.target.unit) : "%";

  const run = (p: EventStudyParams) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("study", slugFor(p));
        return next;
      },
      { replace: false },
    );
  };

  const badge = studyQ.data ? (
    <StatusBadge source={{ label: "event-study engine", asOf: fmtDate(studyQ.data.provenance.as_of), reason: `Sample ${studyQ.data.provenance.sample_start} to ${studyQ.data.provenance.sample_end}; ${studyQ.data.provenance.n_events} events.` }} />
  ) : (
    <StatusBadge designed note={engineAbsent ? "Fixture: illustrative numbers for the preset until the event-study engine lands (Stream A, docs/desk/EVENT_STUDY_SPEC.md)." : studyQ.isLoading ? "Requesting the study…" : "The engine did not answer; the preset's fixture stands in."} />
  );

  const twenty = study?.horizons.find((h) => h.h === 20) ?? study?.horizons[0];
  const conditionLabel = study?.condition?.label ?? assets?.conditions.find((c) => c.id === params.cond)?.label ?? params.cond;

  return (
    <div className="mrr-desk-page">
      <DeskPageHead
        page={page}
        title={
          study
            ? isClient
              ? `${study.shock.label} after an unusually large ${params.w}-session ${params.sign === "+" ? "rise" : "fall"}${study.condition ? `, while ${study.condition.label}` : ""}`
              : `${study.shock.label} ${params.sign === "+" ? "≥ +" : "≤ −"}${params.z.toFixed(1)}σ (${params.w}d)${study.condition ? ` while ${study.condition.label}` : ""}`
            : page.label
        }
        description={study ? `What the ${study.target.label} did over the next ${study.horizons.map((h) => h.h).join(", ")} sessions, against every session as the baseline, split by the regime at the event date.` : page.blurb}
        badge={badge}
        actions={fixture ? <Tag tone="watch" title="Illustrative numbers; the engine has not landed">Fixture</Tag> : null}
      />

      {unknownSlug ? (
        <StateNote live>{`The study "${unknownSlug}" in the address is not one this page knows; the preset is shown. Run a query to write a slug the page can read back.`}</StateNote>
      ) : null}

      {!isClient && assets ? (
        <Panel id="query" title="Query" description="Shock, window, threshold and sign define the event; the co-condition and regime filter narrow it; Run rewrites ?study=." badge={assetsQ.data ? badge : <StatusBadge designed note="Fixture asset lists until the engine lands; history_from per series follows EVENT_STUDY_SPEC §3." />}>
          <QueryBuilder assets={assets} params={params} onRun={run} />
        </Panel>
      ) : null}

      {!study ? (
        <Panel id="results" title="Results" badge={badge}>
          {studyQ.isLoading ? (
            <EmptyState title="Requesting the study…">The engine computes every horizon and the bootstrap interval; the first answer can take a few seconds.</EmptyState>
          ) : (
            <EmptyState title={engineAbsent ? "The event-study engine has not landed." : "The engine did not answer."}>
              {isPreset ? "The preset's fixture should stand in here; reload the page." : `The fixture covers the preset only (${PRESET_SLUG}). `}
              {!isPreset ? (
                <button type="button" className="mrr-btn" style={{ marginTop: 10 }} onClick={() => run(PRESET)}>
                  Load the preset
                </button>
              ) : null}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <div className="mrr-desk-2">
            <Panel id="verdict" title="Verdict" description={fixture ? "Illustrative text from the fixture; the engine writes its verdict from rules, in calibrated words." : "Written by the engine from rules; calibrated vocabulary only."} badge={badge}>
              <p className="mrr-desk-verdict">{study.verdict.text}</p>
              {isClient && twenty ? (
                <Caption as="p" style={{ marginTop: 10 }}>
                  Over {sessionsInWords(twenty.h)} the {study.target.label} finished higher {timesInTen(twenty.hit_rate)}, against {timesInTen(twenty.baseline_hit_rate)} at baseline; the typical move was {moveInWords(twenty.median, unit)}.
                </Caption>
              ) : (
                <ul className="mrr-desk-verdict-list">
                  {study.verdict.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel
              id="distribution"
              title="Distribution"
              description={study.distribution ? `${study.distribution.h}-session forward moves, conditional against baseline.` : "Forward moves, conditional against baseline."}
              badge={badge}
              meta={study.distribution ? `${study.distribution.h}d bins` : undefined}
            >
              {study.distribution ? (
                <DistributionChart d={study.distribution} unit={unit} nEvents={isClient ? null : study.provenance.n_events} />
              ) : (
                <EmptyState title="Distribution bins are not served for this study.">The engine's response carries the horizon statistics; the histogram needs its bins.</EmptyState>
              )}
              <Caption>{isClient ? "Shares of events against shares of sessions; the dashed line is zero." : `Shares, not counts: ${study.provenance.n_events} conditional events against every session in the sample. The dashed line is zero.`}</Caption>
            </Panel>
          </div>

          <Panel id="horizons" title="By horizon" description={isClient ? "How often the target finished higher and its typical move, in words." : `N, hit rate, median, mean, quartiles, the baseline and the bootstrap interval on Δ, in ${unit}.`} badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
            <HorizonTable study={study} unit={unit} isClient={isClient} />
            {!isClient ? <Caption>Hit rate is the share of forward moves above zero; the engine never flips signs for a short read. Events without a full window are excluded, not truncated.</Caption> : null}
          </Panel>

          <div className="mrr-desk-2">
            <Panel id="regimes" title="By regime" description="The classifier's stored label at each event date." badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
              <RegimeSplit study={study} unit={unit} isClient={isClient} />
              <Caption>{isClient ? "A regime with too few events to read is left blank rather than guessed." : "Reads with fewer than ten events are suppressed and print n<10."}</Caption>
            </Panel>
            <Panel id="events" title="Recent events" description={`The last ten triggers${study.condition ? ` while ${conditionLabel}` : ""}.`} badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
              <RecentEvents study={study} unit={unit} isClient={isClient} />
            </Panel>
          </div>

          {!isClient ? (
            <Caption mono>
              {`as of ${study.provenance.as_of} · sample ${study.provenance.sample_start} to ${study.provenance.sample_end} · ${study.provenance.n_events} events after a ${study.provenance.cooldown}-session cooldown · bootstrap 2,000 resamples, seed ${study.provenance.seed} · inputs ${study.provenance.inputs_hash} · slug ${study.slug}`}
            </Caption>
          ) : null}
        </>
      )}
    </div>
  );
}
