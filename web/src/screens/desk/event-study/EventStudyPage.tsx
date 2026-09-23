/**
 * Event Study (docs/desk/DESK_FRAME_SPEC.md §5): the query builder (shock
 * asset, window, threshold, sign, co-condition, regime filter, target, Run),
 * the distribution chart, the horizon table, the regime split, the last ten
 * events and the verdict card. Assets come from /api/desk/event-study/assets
 * with history_from shown; the study from /api/desk/event-study, adapted to
 * the page's types in api/desk.ts (desk/integration: the engine's real
 * contract, EVENT_STUDY_REPORT.md §5). Studies are addressable by the
 * engine's own ?study=<slug> (studies.ts), the three presets included. The
 * engine can answer a study as ready, computing (this page asks again every
 * three seconds), or awaiting the first full refresh (a database that
 * predates the series' store); 422, 429 and 503 print the engine's reason. A
 * server without the engine answers 404 and the page shows the fixture for
 * the first preset only, labelled as a fixture on the badge, the tables and
 * the verdict. Client view hides the builder, N, intervals, the bootstrap
 * details and method ids, and prints the headline numbers as words.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../../api/client";
import { DataTable, Segmented, Tag } from "../../../components";
import { isEngineAbsent, useEventStudy, useEventStudyAssets, type EventStudyAsset, type EventStudyAssets, type EventStudyHorizon, type EventStudyParams, type EventStudyResponse, type ShockUnit } from "../../../api/desk";
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
import { PRESET, PRESET_SLUG, paramsFor, slugFor } from "./studies";

const REGIME_LABEL: Record<string, string> = { all: "All regimes", goldilocks: "Goldilocks", overheating: "Overheating", stagflation: "Stagflation", recession_risk: "Recession Risk" };
const SIGN_LABEL: Record<EventStudyParams["sign"], string> = { "+": "Up", "-": "Down", both: "Either" };

function unitWord(u: ShockUnit): "%" | "bp" {
  return u === "bp" ? "bp" : "%";
}

function fmtMove(x: number | null | undefined, unit: "%" | "bp"): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const dp = unit === "%" ? 1 : 0;
  return `${x > 0 ? "+" : ""}${x.toFixed(dp)}${unit === "%" ? "%" : " bp"}`;
}

function fmtShare(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : fmtWholePct(x);
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
        {chosen ? null : <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} · from {yearOf(o.history_from)}
            {o.status === "awaiting_refresh" ? " · awaiting refresh" : ""}
          </option>
        ))}
      </select>
      <p className="mrr-desk-hint">
        {chosen
          ? chosen.status === "awaiting_refresh"
            ? `Awaiting a full refresh: this database does not store ${chosen.label} yet.`
            : chosen.warn
              ? `Short history: from ${fmtDate(chosen.history_from)}. Reads before that date are not possible.`
              : `History from ${fmtDate(chosen.history_from)}.`
          : "Not in the stored lists: choose an asset."}
      </p>
    </div>
  );
}

function QueryBuilder({ assets, params, onRun, onPreset }: { assets: EventStudyAssets; params: EventStudyParams; onRun: (p: EventStudyParams) => void; onPreset: (slug: string) => void }) {
  // The builder composes shock studies; a cross preset leaves it on the first preset's fields.
  const start = params.kind === "cross" ? PRESET : params;
  const [draft, setDraft] = useState<EventStudyParams>(start);
  useEffect(() => setDraft(params.kind === "cross" ? PRESET : params), [params]);
  const set = <K extends keyof EventStudyParams>(k: K) => (v: EventStudyParams[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const signs = assets.signs ?? ["+", "-"];
  const conditions = assets.conditions.some((c) => c.id === draft.cond) ? assets.conditions : [...assets.conditions, { id: draft.cond, label: draft.cond }];
  return (
    <form
      className="mrr-desk-form"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({ ...draft, kind: "shock", cross: null });
      }}
    >
      {assets.presets?.length ? (
        <div className="mrr-desk-field" style={{ marginBottom: 12 }}>
          <span className="mrr-desk-label" id="es-presets">
            Presets
          </span>
          <div role="group" aria-labelledby="es-presets" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {assets.presets.map((p) => (
              <button key={p.slug} type="button" className="mrr-btn" aria-pressed={slugFor(params) === p.slug} onClick={() => onPreset(p.slug)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
          <Segmented label="Sign" mono options={signs.map((s) => ({ id: s, label: SIGN_LABEL[s] }))} value={draft.sign} onChange={(id) => set("sign")(id as EventStudyParams["sign"])} aria-describedby="es-sign" />
        </div>
        <div className="mrr-desk-field">
          <label className="mrr-desk-label" htmlFor="es-cond">
            Co-condition
          </label>
          <select id="es-cond" className="mrr-desk-input" value={draft.cond} onChange={(e) => set("cond")(e.target.value)}>
            {conditions.map((c) => (
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
          <p className="mrr-desk-hint">The classifier's stored label two months before the event; never recomputed here.</p>
        </div>
        <AssetSelect id="es-target" label="Target" value={draft.target} options={assets.targets} onChange={set("target")} />
      </div>
      <div className="mrr-desk-actions">
        <button type="submit" className="mrr-btn mrr-btn-primary" data-testid="es-run">
          Run study
        </button>
        <span className="mrr-desk-hint" style={{ fontFamily: "var(--font-mono)" }}>
          ?study={slugFor({ ...draft, kind: "shock", cross: null })}
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
        {
          key: "delta",
          label: "Against baseline",
          render: (r: EventStudyHorizon) =>
            r.delta == null ? "no reading" : Math.abs(r.delta) < (unit === "%" ? 0.4 : 3) ? "in line with baseline" : `${r.delta > 0 ? "above" : "below"} baseline by about ${Math.abs(r.delta).toFixed(unit === "%" ? 1 : 0)}${unit === "%" ? "%" : " bp"}`,
        },
      ]
    : [
        { key: "h", label: "h", mono: true, render: (r: EventStudyHorizon) => `${r.h}d` },
        { key: "n", label: "N", mono: true, align: "right" as const },
        { key: "hit_rate", label: <Jargon term="hit rate">Hit rate</Jargon>, mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtShare(r.hit_rate) },
        { key: "median", label: "Median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.median, unit) },
        { key: "mean", label: "Mean", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.mean, unit) },
        { key: "iqr", label: "p25 · p75", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => `${fmtMove(r.p25, unit)} · ${fmtMove(r.p75, unit)}` },
        { key: "baseline_median", label: "Base median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.baseline_median, unit) },
        { key: "baseline_hit_rate", label: "Base hit", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtShare(r.baseline_hit_rate) },
        { key: "delta", label: "Δ median", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => fmtMove(r.delta, unit) },
        {
          key: "ci90",
          label: "90% CI on Δ",
          mono: true,
          align: "right" as const,
          render: (r: EventStudyHorizon) =>
            r.ci90 ? `${fmtMove(r.ci90[0], unit)} to ${fmtMove(r.ci90[1], unit)}` : <span style={{ color: "var(--text-3)" }}>{r.note ?? "too few blocks"}</span>,
        },
        { key: "n_blocks", label: "Blocks", mono: true, align: "right" as const, render: (r: EventStudyHorizon) => (r.n_blocks == null ? "—" : String(r.n_blocks)) },
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
    ...(isClient || study.kind === "cross" ? [] : [{ key: "z", label: <Jargon term="z-score">z</Jargon>, mono: true, align: "right" as const, render: (e: Ev) => (e.z == null ? "—" : e.z.toFixed(2)) }]),
    ...hs.map((h) => ({ key: `f${h}`, label: `+${h}d`, mono: true, align: "right" as const, render: (e: Ev) => (e.forward[String(h)] == null ? <span style={{ color: "var(--text-3)" }}>window open</span> : fmtMove(e.forward[String(h)], unit)) })),
  ];
  return (
    <ScrollTable label="Recent events">
      <DataTable caption="The last ten events with their forward moves" columns={columns} rows={rows} zebra={false} compact />
    </ScrollTable>
  );
}

function titleFor(study: EventStudyResponse, isClient: boolean): string {
  const p = study.params;
  if (p.kind === "cross") {
    const which = p.cross === "death" ? "death" : "golden";
    const across = p.cross === "death" ? "below" : "above";
    return isClient ? `What the ${study.target.label} did after its 50-day average crossed ${across} the 200-day` : `${study.target.label} ${which} cross (50-day ${across} 200-day)`;
  }
  const move = p.sign === "+" ? "rise" : p.sign === "-" ? "fall" : "move";
  const word = p.sign === "+" ? "≥ +" : p.sign === "-" ? "≤ −" : "|z| ≥ ";
  const cond = study.condition ? ` while ${study.condition.label}` : "";
  return isClient ? `${study.shock.label} after an unusually large ${p.w}-session ${move}${study.condition ? `, while ${study.condition.label}` : ""}` : `${study.shock.label} ${word}${p.z.toFixed(1)}σ (${p.w}d)${cond}`;
}

export default function EventStudyPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const [searchParams, setSearchParams] = useSearchParams();
  const slugParam = searchParams.get("study");
  // A slug the address carries but the engine's grammar does not read: the preset shows, and the page says so.
  const unknownSlug = slugParam != null && paramsFor(slugParam) == null ? slugParam : null;
  const slug = slugParam != null && !unknownSlug ? slugParam : PRESET_SLUG;
  const addressed = useMemo(() => paramsFor(slug) ?? PRESET, [slug]);
  const assetsQ = useEventStudyAssets();
  const studyQ = useEventStudy(slug);

  const engineAbsent = (assetsQ.isError && isEngineAbsent(assetsQ.error)) || (studyQ.isError && isEngineAbsent(studyQ.error));
  const assets = assetsQ.data ?? (engineAbsent ? FIXTURE_ASSETS : undefined);
  const result = studyQ.data;
  const fixture = engineAbsent && slug === PRESET_SLUG;
  const study: EventStudyResponse | undefined = result?.state === "ready" ? result.study : fixture ? FIXTURE_STUDY : undefined;
  const params = study?.params ?? addressed;
  const unit = study ? unitWord(study.target.unit) : "%";
  const engineError = studyQ.isError && !engineAbsent && studyQ.error instanceof ApiError ? studyQ.error : null;

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

  const badge =
    result?.state === "ready" ? (
      <StatusBadge source={{ label: "event-study engine", asOf: fmtDate(result.study.provenance.as_of), reason: `Sample ${result.study.provenance.sample_start} to ${result.study.provenance.sample_end}; ${result.study.provenance.n_events} events.` }} />
    ) : result?.state === "awaiting_refresh" ? (
      <StatusBadge source={{ label: "event-study engine", asOf: null, reason: result.detail }} />
    ) : (
      <StatusBadge
        designed
        note={
          engineAbsent
            ? "Fixture: illustrative numbers for the preset; this server does not run the event-study engine."
            : result?.state === "computing"
              ? "The engine is computing this study; the page asks again every few seconds."
              : studyQ.isLoading
                ? "Requesting the study…"
                : "The engine did not return this study."
        }
      />
    );

  const twenty = study?.horizons.find((h) => h.h === 20) ?? study?.horizons[0];
  const conditionLabel = study?.condition?.label ?? assets?.conditions.find((c) => c.id === params.cond)?.label ?? params.cond;

  return (
    <div className="mrr-desk-page">
      <DeskPageHead
        page={page}
        title={study ? titleFor(study, isClient) : page.label}
        description={study ? `What the ${study.target.label} did over the next ${study.horizons.map((h) => h.h).join(", ")} sessions, against every evaluable session as the baseline, split by the regime at the event date.` : page.blurb}
        badge={badge}
        actions={fixture ? <Tag tone="watch" title="Illustrative numbers; this server does not run the engine">Fixture</Tag> : null}
      />

      {unknownSlug ? (
        <StateNote live>{`The study "${unknownSlug}" in the address is not one the engine can read; the preset is shown. Run a query to write an address the page can read back.`}</StateNote>
      ) : null}

      {!isClient && !assets && assetsQ.isError ? (
        <StateNote live>{`The engine's asset lists did not load (${assetsQ.error instanceof Error ? assetsQ.error.message : "no answer"}); the query builder returns when they do. Reload to ask again.`}</StateNote>
      ) : null}

      {!isClient && assets ? (
        <Panel id="query" title="Query" description="Shock, window, threshold and sign define the event; the co-condition and regime filter narrow it; Run rewrites ?study=." badge={assetsQ.data ? badge : <StatusBadge designed note="Fixture asset lists; this server does not run the event-study engine." />}>
          <QueryBuilder assets={assets} params={params} onRun={(p) => go(slugFor(p))} onPreset={go} />
          {assets.awaiting?.length ? (
            <Caption as="p" style={{ marginTop: 10 }}>
              {`Awaiting a full refresh: ${assets.awaiting.join(", ")}. A study on them says so until a refresh has stored their daily history.`}
            </Caption>
          ) : null}
        </Panel>
      ) : null}

      {!study ? (
        <Panel id="results" title="Results" badge={badge}>
          {studyQ.isLoading ? (
            <EmptyState title="Requesting the study…">The engine computes every horizon and the bootstrap interval; the first answer can take a few seconds.</EmptyState>
          ) : result?.state === "computing" ? (
            <EmptyState title="Computing the study…">The engine computes every horizon and the bootstrap interval; this page asks again every few seconds.</EmptyState>
          ) : result?.state === "awaiting_refresh" ? (
            <EmptyState title="Awaiting a full refresh">
              {result.detail} The presets read the stored index and gold histories, not the Desk's daily series.
              {slug !== PRESET_SLUG ? (
                <button type="button" className="mrr-btn" style={{ marginTop: 10 }} onClick={() => go(PRESET_SLUG)}>
                  Load the first preset
                </button>
              ) : null}
            </EmptyState>
          ) : engineError ? (
            <EmptyState title={engineError.status === 429 ? "The engine is busy." : "The engine could not run this study."}>
              {engineError.message}
              {slug !== PRESET_SLUG ? (
                <button type="button" className="mrr-btn" style={{ marginTop: 10 }} onClick={() => go(PRESET_SLUG)}>
                  Load the first preset
                </button>
              ) : null}
            </EmptyState>
          ) : (
            <EmptyState title={engineAbsent ? "This server does not run the event-study engine." : "The engine did not answer."}>
              {engineAbsent ? `The fixture covers the first preset only (${PRESET_SLUG}). ` : "Reload the page to ask again. "}
              {slug !== PRESET_SLUG ? (
                <button type="button" className="mrr-btn" style={{ marginTop: 10 }} onClick={() => go(PRESET_SLUG)}>
                  Load the first preset
                </button>
              ) : null}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <div className="mrr-desk-2">
            <Panel id="verdict" title="Verdict" description={fixture ? "Illustrative text from the fixture; the engine writes its verdict from rules, in calibrated words." : "Written by the engine from rules; calibrated vocabulary only."} badge={badge}>
              {/* The engine's text is its sentences joined: the desk view lists
                  them, the client view reads the paragraph (desk/integration). */}
              {isClient || !study.verdict.points.length || fixture ? <p className="mrr-desk-verdict">{study.verdict.text}</p> : null}
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
                <EmptyState title="Distribution bins are not served for this study.">The engine's response carries the horizon statistics and the quartiles; the histogram needs its bins.</EmptyState>
              )}
              <Caption>{isClient ? "Shares of events against shares of sessions; the dashed line is zero." : `Shares, not counts: ${study.provenance.n_events} conditional events against every evaluable session in the sample. The dashed line is zero.`}</Caption>
            </Panel>
          </div>

          <Panel id="horizons" title="By horizon" description={isClient ? "How often the target finished higher and its typical move, in words." : `N, hit rate, median, mean, quartiles, the baseline and the bootstrap interval on Δ, in ${unit}.`} badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
            <HorizonTable study={study} unit={unit} isClient={isClient} />
            {!isClient ? <Caption>Hit rate is the share of forward moves above zero; the engine never flips signs for a short read. Events without a full window are excluded, not truncated. An interval needs five independent blocks of overlapping windows.</Caption> : null}
          </Panel>

          <div className="mrr-desk-2">
            <Panel id="regimes" title="By regime" description="The classifier's stored label two months before each event date." badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
              <RegimeSplit study={study} unit={unit} isClient={isClient} />
              <Caption>{isClient ? "A regime with too few events to read is left blank rather than guessed." : "Reads with fewer than ten events are suppressed and print n<10. Events before the first stored label sit outside the totals."}</Caption>
            </Panel>
            <Panel id="events" title="Recent events" description={`The last ten triggers${study.condition ? ` while ${conditionLabel}` : ""}.`} badge={badge} actions={fixture ? <Tag tone="watch">Fixture</Tag> : null}>
              <RecentEvents study={study} unit={unit} isClient={isClient} />
            </Panel>
          </div>

          {!isClient ? (
            <Caption mono>
              {`as of ${study.provenance.as_of} · sample ${study.provenance.sample_start} to ${study.provenance.sample_end} · ${study.provenance.n_events} events ${study.provenance.cooldown == null ? "with no cooldown (a cross cannot recur before the opposite cross)" : `after a ${study.provenance.cooldown}-session cooldown`} · ${study.provenance.n_boot ? `cluster bootstrap, ${study.provenance.n_boot.toLocaleString("en-US")} draws (every draw enumerated up to seven blocks)` : "fixture bootstrap"}, seed ${study.provenance.seed} · inputs ${study.provenance.inputs_hash} · slug ${study.slug}`}
            </Caption>
          ) : null}
        </>
      )}
    </div>
  );
}
