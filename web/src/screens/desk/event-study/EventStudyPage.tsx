/**
 * Event Study (DESK_FRAME3_SPEC §4, screens/03-event-study.png): ask what the
 * market did after a defined shock and get a scored answer. The address is
 * the question (`?preset=<slug>` or the six slots, plus `confidence`), and the
 * page asks GET /api/desk/study with the same parameters (§12.2). Row 1 picks
 * and spells out the question; the answer card and the rail read the one
 * response; Advanced opens the full detail under the grid; Export downloads
 * the events as CSV (§12.3). The page never scores anything itself.
 *
 * The slots show exactly what is asked: the served question once it answers,
 * the address's own question while it is on its way or when it fails, and
 * your edits until you run them (a confidence change keeps them). While a new
 * answer is on its way the previous one stays, dimmed and marked busy.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { deskUrl, useOverview, useStudy } from "../data/api";
import type { Question, StudyResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { dayShort, grouped, isFiniteNumber as fin, year } from "../kit/format";
import AnswerCard from "./AnswerCard";
import EngineDetail from "./EngineDetail";
import QueryCard, { type Mode } from "./QueryCard";
import StudyRail, { RailPlaceholder } from "./StudyRail";
import { WINDOWS, apiParams, askFromSearch, askParams, engineSlugFor, loadSaved, questionFromEngine, questionWords, sameQuestion, searchFor, withSaved, writeLastStudy, writeSaved, type Ask, type SavedQuestion } from "./question";
import { saveServed } from "../kit/download";
import "./study.css";

/** The provenance line under the grid (§4). */
export function provenanceLine(s: Pick<StudyResponse, "as_of" | "slug" | "provenance">, label: (k: string) => string): string {
  const p = s.provenance;
  const hist = Object.entries(p?.series_start ?? {}).map(([k, v]) => `${label(k)} history from ${year(v)}`);
  return [dayShort(s.as_of) ? `Engine as of ${dayShort(s.as_of)}` : null, fin(p?.bootstrap) ? `cluster bootstrap ${grouped(p.bootstrap)}` : null, p?.entry ? `entry ${p.entry}` : null, fin(p?.cooldown) ? `cooldown ${p.cooldown}` : null, ...hist, s.slug ? `slug ${s.slug}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** A fix from the empty state (§1.7) applied to the question; null when it changes nothing. */
export function applyFix(q: Question, fix: string): Question | null {
  if (fix === "drop_condition") return q.while === "none" ? null : { ...q, while: "none" };
  if (fix === "widen_window") {
    const w = WINDOWS.find((x) => x > q.window);
    return w ? { ...q, window: w } : null;
  }
  return null;
}

/** The ask's identity without its confidence: a confidence change keeps the question. */
const askKey = (a: Ask) => searchFor({ ...a, confidence: undefined });

export default function EventStudyPage({ page }: { page: DeskPage }) {
  const { pathTo } = useDeskView();
  const [search, setSearch] = useSearchParams();
  const ask: Ask = useMemo(() => askFromSearch(search), [search]);
  const key = askKey(ask);
  const q = useStudy(apiParams(ask));
  const ov = useOverview();
  const placeholder = q.isPlaceholderData;
  const study = q.isError ? undefined : q.data;
  const [saved, setSaved] = useState<SavedQuestion[]>(() => loadSaved());
  const [draft, setDraft] = useState<Question | null>("question" in ask ? ask.question : null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<Mode>("preset" in ask ? "common" : "build");
  const [adv, setAdv] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const advId = useId();

  // The served question fills the slots once it answers, unless you are editing.
  const served = !placeholder && study ? study.question : null;
  const servedKey = served ? searchFor({ question: served }) : null;
  // A new question in the address: the slots show it (or its answer, when that
  // is already here) and the edits are done with.
  useEffect(() => {
    setDirty(false);
    setDraft("question" in ask ? ask.question : served);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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
      if (study?.question) setDraft(study.question);
      return;
    }
    go({ preset: slug, confidence: ask.confidence });
  };
  const onRun = () => {
    if (!draft) return;
    if ("preset" in ask && study && sameQuestion(draft, study.question)) {
      setDirty(false);
      return void q.refetch();
    }
    go({ question: draft, confidence: ask.confidence });
  };
  const onSave = () => {
    if (!draft) return;
    const next = withSaved(saved, draft, questionWords(draft, label));
    setSaved(next);
    writeSaved(next);
    setMode("saved");
  };
  const onPickSaved = (s: SavedQuestion) => go({ question: s.question, confidence: ask.confidence });
  const onFix = (fix: string) => {
    const base = study?.question ?? draft;
    const next = base ? applyFix(base, fix) : null;
    if (next) go({ question: next, confidence: ask.confidence });
  };
  const onConfidence = (c: number) => go({ ...ask, confidence: c });
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
  const engineSlug = study?.question ? engineSlugFor(study.question) : null;
  const priceHref = askParams(ask).reduce((href, [k, v]) => withParam(href, k === "preset" ? "study" : k, v), withParam(pathTo("basket-hedge"), "mode", "express"));
  const scored = !!study && study.verdict !== "insufficient" && !(fin(study.n_events) && study.n_events < 10);
  const askedHorizon = "question" in ask ? ask.question.horizon : study?.question?.horizon;

  return (
    <div className="es">
      <PageTitle page={page} />
      <QueryCard
        mode={mode}
        onMode={setMode}
        activePreset={activePreset}
        onPreset={onPreset}
        saved={saved}
        onSavedChange={(list) => {
          setSaved(list);
          writeSaved(list);
        }}
        onPickSaved={onPickSaved}
        draft={draft}
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
      {unreadLink ? (
        <p className="es-note" role="status">
          The link asked for the engine study {unreadLink}, which the six slots cannot ask; this is the default question instead.
        </p>
      ) : null}
      <div className="es-grid" data-busy={placeholder || undefined}>
        <AnswerCard study={study} failed={q.isError} busy={placeholder} label={label} onFix={onFix} horizon={askedHorizon} />
        <aside className="dk-card es-rail" aria-label="Verdict and detail" aria-busy={(!study && !q.isError) || placeholder}>
          {scored && study ? (
            <StudyRail
              study={study}
              todayRegime={ov.data?.tiles?.regime?.label ?? null}
              confidence={study.confidence}
              onConfidence={onConfidence}
              priceHref={priceHref}
              advOpen={adv}
              onAdvanced={() => setAdv((o) => !o)}
              advId={advId}
              onExport={onExport}
              exporting={exporting}
              busy={placeholder}
            />
          ) : q.isError ? (
            <RailPlaceholder reason="awaiting" />
          ) : study ? (
            <RailPlaceholder reason="too-few" />
          ) : null}
        </aside>
      </div>
      {exportNote ? (
        <p className="es-note" role="status">
          {exportNote}
        </p>
      ) : null}
      {study ? <p className="es-provenance">{provenanceLine(study, label)}</p> : null}
      {study && scored && adv ? <EngineDetail id={advId} study={study} ask={ask} engineSlug={engineSlug} label={label} /> : null}
    </div>
  );
}
