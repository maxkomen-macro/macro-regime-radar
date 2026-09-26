/**
 * Event Study (DESK_FRAME3_SPEC §4, screens/03-event-study.png): ask what the
 * market did after a defined shock and get a scored answer. The address is
 * the question (`?preset=<slug>` or the six slots), and the
 * page asks GET /api/desk/study with the same parameters (§12.2). Row 1 picks
 * and spells out the question; the answer card and the rail read the one
 * response; Advanced opens the full detail under the grid; Export downloads
 * the events as CSV (§12.3). The page never scores anything itself.
 *
 * The slots show exactly what is asked: the served question once it answers,
 * the address's own question while it is on its way or when it fails, and
 * your edits until you run them. While a new
 * answer is on its way the previous one stays, dimmed and marked busy.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DeskApiError, deskUrl, unavailableOf, useOverview, useStudy, useStudyCatalog } from "../data/api";
import type { Question, StudyResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayShort, grouped, isFiniteNumber as fin, verdictRuleWords, year } from "../kit/format";
import AnswerCard from "./AnswerCard";
import EngineDetail from "./EngineDetail";
import QueryCard, { type Mode } from "./QueryCard";
import StudyRail, { RailPlaceholder } from "./StudyRail";
import { WINDOWS, apiParams, askFromSearch, presetHorizon, loadSaved, questionFromEngine, questionWords, sameQuestion, searchFor, slotsOf, unreadableSaved, withSaved, withdrawnIn, writeLastStudy, writeSaved, type Ask, type SavedQuestion } from "./question";
import { saveServed } from "../kit/download";
import { DroppedNote, Unserved } from "../kit/ui";
import { droppedOf } from "../data/schema";
import "./study.css";

/** The provenance line under the grid (§4): "Engine as of <as_of> · <method> <draws> · entry <rule> · cooldown <n | none> ·
 * <series> history from <data_start> · verdict rule v1 at 90% · slug <slug>"; a part not served is left out. */
export function provenanceLine(
  s: Pick<StudyResponse, "as_of" | "slug" | "provenance" | "verdict_rule" | "verdict_confidence" | "horizons" | "selected_horizon" | "data_start">,
  label: (k: string) => string,
): string {
  const p = s.provenance;
  const h = (Array.isArray(s.horizons) ? s.horizons : []).find((x) => x.h === s.selected_horizon);
  const method = h?.method === "monte_carlo" ? "Monte Carlo" : h?.method === "enumeration" ? "enumeration" : null;
  const resampling = method ? [method, fin(h?.draws) ? grouped(h.draws) : null].filter(Boolean).join(" ") : null;
  // The series whose history starts last sets `data_start`.
  const latest = Object.entries(p?.series_start ?? {}).find(([, v]) => v === s.data_start)?.[0];
  const history = latest && year(s.data_start) ? `${label(latest)} history from ${year(s.data_start)}` : null;
  const cooldown = p ? `cooldown ${fin(p.cooldown) ? p.cooldown : "none"}` : null;
  return [dayShort(s.as_of) ? `Engine as of ${dayShort(s.as_of)}` : null, resampling, p?.entry_rule ? `entry ${p.entry_rule}` : null, cooldown, history, verdictRuleWords(s), s.slug ? `slug ${s.slug}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** A fix from the empty state (§1.7) applied to the question; null when it changes nothing. */
export function applyFix(q: Question, fix: string): Question | null {
  if (fix === "drop_condition") return q.while === "none" ? null : { ...q, while: "none" };
  if (fix === "widen_window") {
    if (q.window == null) return null;
    const w = WINDOWS.find((x) => x > (q.window as number));
    return w ? { ...q, window: w } : null;
  }
  return null;
}

/** The ask's identity: the address's question. */
const askKey = (a: Ask) => searchFor(a);

export default function EventStudyPage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  const ask: Ask = useMemo(() => askFromSearch(search), [search]);
  const key = askKey(ask);
  const q = useStudy(apiParams(ask));
  const ov = useOverview();
  const cq = useStudyCatalog();
  // Codex R-16: a catalog that lost rows at the boundary gates no slot option (a missing row would disable
  // one that leads to a study), while the rows it read still label and gate their own chips (§4).
  const catalogLost = droppedOf(cq.data, "studies");
  const catalog = Array.isArray(cq.data?.studies) ? cq.data.studies : null;
  // §4: a request the server refuses (422 `unsupported`) prints the served message.
  const refusal = q.error instanceof DeskApiError && q.error.status === 422 && q.error.body?.error === "unsupported" ? q.error.message : null;
  const placeholder = q.isPlaceholderData;
  const study = q.isError ? undefined : q.data;
  const [saved, setSaved] = useState<SavedQuestion[]>(() => loadSaved());
  const [unreadable] = useState(() => unreadableSaved().length);
  const [draft, setDraft] = useState<Question | null>("question" in ask ? ask.question : null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("preset" in ask ? "common" : "build");
  const [adv, setAdv] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const advId = useId();

  // The served question fills the slots once it answers, unless you are editing.
  // Only the six slots: the served unit and name are the answer's, so they are never saved with a question.
  const served = !placeholder && study ? slotsOf(study.question) : null;
  const servedKey = served ? searchFor({ question: served }) : null;
  // A new question in the address: the slots show it (or its answer, when that
  // is already here) and the edits are done with.
  useEffect(() => {
    setDirty(false);
    setDraft("question" in ask ? ask.question : served);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A preset with no answer (awaiting, or refused) still spells out its question: the catalog carries it (§12.3).
  const catalogQ = "preset" in ask ? catalog?.find((c) => c.slug === ask.preset)?.question : null;
  useEffect(() => {
    // The slots show the horizon the link asks when it is one of theirs (Codex R-23), else §12.2's default.
    const ph = presetHorizon(ask);
    if (!draft && !served && catalogQ) setDraft({ ...catalogQ, horizon: ph != null && [5, 10, 20, 60].includes(ph) ? ph : 20 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, catalogQ, served]);
  useEffect(() => {
    if (served && !dirty) setDraft(served);
    // The study this browser last saw answered is Data Pipeline's "current study".
    if (served) writeLastStudy(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servedKey]);

  const seriesList = Array.isArray(study?.series) ? study.series : null;
  const label = (k: string) => seriesList?.find((s) => s.key === k)?.label ?? k;
  const go = (next: Ask) => {
    const nextSearch = searchFor(next, search);
    if (nextSearch === search.toString()) return void q.refetch();
    setSearch(new URLSearchParams(nextSearch), { replace: false });
  };

  const onPreset = (slug: string) => {
    setMode("common");
    if ("preset" in ask && ask.preset === slug) {
      setDirty(false);
      if (study?.question) setDraft(slotsOf(study.question));
      return;
    }
    go({ preset: slug });
  };
  const onRun = () => {
    if (!draft) return;
    if ("preset" in ask && study && sameQuestion(draft, study.question)) {
      setDirty(false);
      return void q.refetch();
    }
    go({ question: draft });
  };
  const onSave = () => {
    if (!draft) return;
    const next = withSaved(saved, draft, questionWords(draft, label));
    setSaved(next);
    writeSaved(next);
    setMode("saved");
  };
  const onPickSaved = (s: SavedQuestion) => go({ question: s.question });
  const onFix = (fix: string) => {
    const base = study?.question ?? draft;
    const next = base ? applyFix(base, fix) : null;
    if (next) go({ question: next });
  };
  const onExport = async () => {
    setExporting(true);
    setExportNote("");
    try {
      const params = Object.fromEntries(Object.entries(apiParams(ask)).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
      await saveServed(deskUrl("/study/events", params), "text/csv", `${study?.slug ?? "event-study"}-events.csv`);
    } catch {
      setExportNote("The event list did not answer; nothing was downloaded.");
    } finally {
      setExporting(false);
    }
  };

  const activePreset = "preset" in ask && !dirty ? ask.preset : null;
  // A frame-2 link the six slots cannot ask opens the default question, and says so.
  const oldLink = search.get("study");
  const unreadLink = oldLink && !search.get("preset") && !questionFromEngine(oldLink) ? oldLink : null;
  // §12.0: never a silent parameter drop. An address asking what §12.2 no longer serves opens the default question, and says so.
  const withdrawn = !search.get("preset") && !oldLink ? withdrawnIn(search) : null;
  // A served study is scored at its selected horizon, Too few included (v4 B-02): the rail reads it either way.
  // A preset asks the horizon its address names, else §12.2's default of 20 sessions (Codex R-23); a question asks its own (R-18).
  const askedHorizon = "question" in ask ? ask.question.horizon : (study?.selected_horizon ?? presetHorizon(ask) ?? study?.question?.horizon ?? 20);

  return (
    <div className="es">
      <PageTitle page={page} />
      <QueryCard
        mode={mode}
        onMode={setMode}
        activePreset={activePreset}
        onPreset={onPreset}
        saved={saved}
        unreadable={unreadable}
        onSavedChange={(list) => {
          setSaved(list);
          writeSaved(list);
        }}
        onPickSaved={onPickSaved}
        draft={draft}
        catalog={catalog}
        gateSlots={!catalogLost}
        seriesLost={droppedOf(study, "series")}
        onDraft={(d) => {
          setDraft(d);
          setDirty(true);
          setMode("build");
        }}
        series={seriesList}
        seriesFailed={!!study && !seriesList}
        onRun={onRun}
        onSave={onSave}
        running={q.isFetching}
      />
      <DroppedNote n={catalogLost} one="catalog study" many="catalog studies" />
      {unreadLink ? (
        <p className="es-note" role="status">
          The link asked for the engine study {unreadLink}, which the six slots cannot ask; this is the default question instead.
        </p>
      ) : null}
      {withdrawn ? (
        <p className="es-note" role="status">
          The link asked for {withdrawn}, which the Event Study no longer asks; this is the default question instead.
        </p>
      ) : null}
      {/* §12.0: a study served awaiting (an input not stored) keeps the labels and prints its reason (§1.0.2). */}
      <Unserved block={unavailableOf(q.error)}>
        <div className="es-grid" data-busy={placeholder || undefined}>
          <AnswerCard study={study} failed={q.isError} refusal={refusal} busy={placeholder} onFix={onFix} horizon={askedHorizon} />
          <aside className="dk-card es-rail" aria-label="Verdict and detail" aria-busy={(!study && !q.isError) || placeholder}>
            {study ? (
              <StudyRail
                study={study}
                todayRegime={ov.data?.tiles?.regime?.label ?? null}
                advOpen={adv}
                onAdvanced={() => setAdv((o) => !o)}
                advId={advId}
                onExport={onExport}
                exporting={exporting}
                busy={placeholder}
              />
            ) : q.isError && !refusal ? (
              <RailPlaceholder />
            ) : null}
          </aside>
        </div>
      </Unserved>
      {exportNote ? (
        <p className="es-note" role="status">
          {exportNote}
        </p>
      ) : null}
      {study ? <p className="es-provenance">{provenanceLine(study, label)}</p> : null}
      {study && adv ? <EngineDetail id={advId} study={study} ask={ask} /> : null}
    </div>
  );
}
