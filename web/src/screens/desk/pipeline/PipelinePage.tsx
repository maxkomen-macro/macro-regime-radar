/**
 * Data Pipeline (DESK_FRAME3_SPEC §11, §12.11, screens/10-data-pipeline.png):
 * where every number comes from. The lineage strip (fixed copy: the six
 * steps a number takes), the series inventory read from GET /pipeline (the
 * registry, so a new series lands in its group with no page change),
 * grouped and collapsible, each group's table scrolling inside the group, and
 * a search that jumps to a series and opens its group; and the Snowflake
 * bridge: the three-layer schema as the board draws it, the current study's
 * events as CSV (§12.3) and the Snowflake DDL (GET /pipeline/ddl). Under
 * them, "Sync to Snowflake", a PROTOTYPE card (§1.0.3, ../prototypes/). The
 * last refresh and its validation ride in the top bar (`./badge`).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { deskUrl, unavailableOf, usePipeline } from "../data/api";
import { droppedOf } from "../data/schema";
import type { PipelineGroup } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { Awaiting, DroppedNote, droppedWords, Unserved, LoadingLine, FailedScope } from "../kit/ui";
import { dayLong, monthYear } from "../kit/format";
import { apiParams, askFromSearch, readLastStudy } from "../event-study/question";
import { saveServed } from "../kit/download";
import { SnowflakeSyncCard } from "../prototypes/SnowflakeSyncCard";
import { PipelineBadge } from "./badge";
import "./pipeline.css";

/** The six steps a number takes (§11), fixed copy. */
export const LINEAGE: readonly { step: string; lines: readonly string[] }[] = [
  { step: "Sources", lines: ["FRED API", "Yahoo Finance", "EODHD (live tape)"] },
  // The full refresh runs at 11:17 UTC daily and 00:23 UTC Tuesday to Saturday (the audit's §10 #21).
  { step: "Fetch", lines: ["GitHub Actions", "full refresh daily", "news-only hourly"] },
  { step: "Validate", lines: ["schema + range checks", "as-of ≤ today", "gap detection"] },
  { step: "Transform", lines: ["z-scores, MAs", "regime labels", "forward returns"] },
  { step: "Store", lines: ["SQLite snapshot", "published as release asset", "Snowflake-ready schema"] },
  { step: "Serve", lines: ["FastAPI · /api/desk/*", "one number, one truth", "Desk panels"] },
];

/** The bridge card's schema, as the board draws it (§11: "exactly as on the board"). */
export const SCHEMA_PREVIEW = `-- RAW: exact copy of source, never edited
RAW.PRICES_DAILY   (source, symbol, dt, open, high, low, close, volume, ingested_at)
RAW.FRED_OBS       (series_id, dt, value, realtime_start, ingested_at)

-- CURATED: one row per (series, dt), validated
CUR.SERIES_DAILY   (series_key, dt, value, as_of, quality_flag)
CUR.REGIME_LABEL   (dt, regime, method_version, inputs_hash)

-- MART: what Desk reads. Rebuilt, never patched.
MART.EVENT_STUDY   (study_id, shock, cond, horizon, n, hit, median,
                    baseline_median, ci_lo, ci_hi, sample_start)
MART.INDEX_LEVELS  (basket_id, dt, level, rebalance_flag)

-- Every MART row carries run_at + inputs_hash → reproducible.`;

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The series in a group whose name, id or note matches a search ("VIX", "DGS10", "gold"). */
export function findSeries(groups: readonly PipelineGroup[], text: string): { group: string; id: string } | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const g of groups)
    for (const s of Array.isArray(g.series) ? g.series : [])
      if ([s.label, s.id, s.note].some((x) => typeof x === "string" && x.toLowerCase().includes(t))) return { group: g.name, id: s.id };
  return null;
}

/** A stored observation at its series' own frequency: "Sep 22, 2026" for a daily series, "Aug 2026" for a monthly one. */
export function storedDay(d: string | null | undefined, freq: string | undefined): string {
  return freq === "monthly" ? monthYear(d) : dayLong(d);
}

function Group({ g, open, onToggle, hit }: { g: PipelineGroup; open: boolean; onToggle: () => void; hit: string | null }) {
  const id = useId();
  const rows = Array.isArray(g.series) ? g.series : [];
  // Codex R-16: the served count is the rows read plus the rows the boundary could not read, and the
  // group says so; "no series" only when none was served.
  const lost = droppedOf(g, "series");
  const served = rows.length + lost;
  const hitRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (open && hit) hitRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, hit]);
  const current = g.status === "current";
  return (
    <div className="pl-group" data-open={open || undefined}>
      <button type="button" className="pl-group-head" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <span className="pl-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="pl-group-name">{g.name}</span>
        <span className="pl-group-meta">
          {`${served} series`}
          {/* §12.9: the group's status is the worst of its series. */}
          {g.status ? (
            <>
              {" "}
              <span className="pl-state" data-tone={current ? "green" : "amber"}>
                ● {g.status}
              </span>
            </>
          ) : null}
        </span>
      </button>
      {open && !rows.length ? (
        <p id={id} className="pl-rows-foot">
          {lost ? droppedWords(lost, "series", "series") : "No series in this group yet."}
        </p>
      ) : open ? (
        <div id={id}>
          <div className="pl-rows" role="region" aria-label={`${g.name} series`} tabIndex={0}>
            <table className="pl-table">
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col">ID</th>
                  <th scope="col">From</th>
                  <th scope="col">As of</th>
                  <th scope="col">Feeds</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} ref={s.id === hit ? hitRef : undefined} data-hit={s.id === hit || undefined}>
                    <th scope="row">
                      {s.label || s.id}
                      {/* §11: provider and frequency beside the series. */}
                      {s.provider || s.freq ? <span className="pl-prov"> · {[s.provider, s.freq].filter(Boolean).join(", ")}</span> : null}
                    </th>
                    <td className="pl-id">{s.id}</td>
                    <td>{storedDay(s.first, s.freq) || "—"}</td>
                    <td>{storedDay(s.last, s.freq) || "—"}</td>
                    <td className="pl-feeds">{Array.isArray(s.feeds) && s.feeds.length ? s.feeds.join(", ") : "—"}</td>
                    <td className="pl-status">
                      <span data-tone={s.status === "current" ? "green" : s.status ? "amber" : undefined}>{s.status || "—"}</span>
                      {s.note ? <span className="pl-note"> · {s.note}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pl-rows-foot">
            showing {rows.length} of {served}
            {lost ? ` · ${droppedWords(lost, "series", "series").replace(/\.$/, "")}` : ""} · the list scrolls inside the group; the page does not grow
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Saves a served file (the kit's `saveServed`: type-checked, 15 s at most). */
function download(path: string, params: Record<string, string | number | undefined>, accept: "text/csv" | "text/plain", name: string): Promise<string> {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
  return saveServed(deskUrl(path, clean), accept, name);
}

function Bridge() {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"csv" | "ddl" | null>(null);
  const exportStudy = async () => {
    setBusy("csv");
    setNote("");
    // The current study: the last one Event Study answered in this browser, else its default.
    const ask = askFromSearch(readLastStudy() ?? "");
    const name = `${"preset" in ask ? ask.preset : "event-study"}-events.csv`;
    try {
      setNote(`Saved ${await download("/study/events", apiParams(ask), "text/csv", name)}.`);
    } catch {
      setNote("The study's events did not answer; nothing was saved.");
    } finally {
      setBusy(null);
    }
  };
  const exportDdl = async () => {
    setBusy("ddl");
    setNote("");
    try {
      setNote(`Saved ${await download("/pipeline/ddl", {}, "text/plain", "macro-regime-radar-desk.sql")}.`);
    } catch {
      setNote("The DDL did not answer; nothing was saved.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="dk-card pl-bridge" aria-labelledby="pl-bridge-title">
      <div className="pl-card-head">
        <h2 className="dk-card-title" id="pl-bridge-title">
          {/* §11's exact title. */}
          Proposed export schema (not the current SQLite layout)
        </h2>
        <p className="pl-head-sub">how this lands at a desk</p>
      </div>
      <pre className="pl-schema" tabIndex={0} aria-label="The three-layer schema" data-board-copy>
        {SCHEMA_PREVIEW}
      </pre>
      <p className="pl-mono-note">Same three-layer shape as the SQLite build today · RAW → CUR → MART · idempotent daily job</p>
      <div className="pl-buttons">
        <button type="button" className="dk-btn" data-kind="light" onClick={() => void exportStudy()} disabled={busy !== null}>
          Export current study → CSV
        </button>
        <button type="button" className="dk-btn" onClick={() => void exportDdl()} disabled={busy !== null}>
          Generate Snowflake DDL
        </button>
      </div>
      {note ? (
        <p className="pl-mono-note" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}

export default function PipelinePage({ page }: { page: DeskPage }) {
  const q = usePipeline();
  const p = q.data;
  const groups = useMemo(() => (Array.isArray(p?.groups) ? p.groups : []), [p]);
  const [search, setSearch] = useSearchParams();
  // desk/usability §14.9: the search lives in the address (`?q=`), so a link opens the same series.
  const text = search.get("q") ?? "";
  const [hit, setHit] = useState<{ group: string; id: string } | null>(null);
  // Opened cold on `?q=`, the search is found once the groups arrive, and its group opens.
  useEffect(() => {
    if (!text.trim() || !groups.length) return;
    const found = findSeries(groups, text);
    setHit(found);
    if (found && search.get("group") !== slugOf(found.group))
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("group", slugOf(found.group));
          return next;
        },
        { replace: true },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);
  const opened = search.get("group");
  // A group the boundary could not read has no count of its own, so then no total is claimed (Codex R-16).
  const lostGroups = droppedOf(p, "groups");
  const lostSeries = groups.reduce((n, g) => n + droppedOf(g, "series"), 0);
  // What a search miss adds when rows were lost: "1 series could not be read", "1 group could not be read".
  const lostWords = [droppedWords(lostSeries, "series", "series"), droppedWords(lostGroups, "group")].filter(Boolean).map((w) => w.replace(/\.$/, "")).join("; ");
  const total = lostGroups ? 0 : groups.reduce((a, g) => a + (Array.isArray(g.series) ? g.series.length : 0) + droppedOf(g, "series"), 0);
  const toggle = (name: string) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get("group") === slugOf(name)) next.delete("group");
        else next.set("group", slugOf(name));
        return next;
      },
      { replace: true },
    );
  const onSearch = (v: string) => {
    const found = findSeries(groups, v);
    setHit(found);
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set("q", v);
        else next.delete("q");
        if (found) next.set("group", slugOf(found.group));
        return next;
      },
      { replace: true },
    );
  };
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="pl">
      <PageTitle page={page} />
      <Unserved block={unserved}>
        <div className="pl-badge-inline">
          <PipelineBadge testId="pl-badge-inline" />
        </div>
        <section className="dk-card pl-lineage" aria-labelledby="pl-lineage-title">
          <h2 className="dk-card-title" id="pl-lineage-title">
            Lineage
          </h2>
          <ol className="pl-steps">
            {LINEAGE.map((s, i) => (
              <li key={s.step} data-serve={i === LINEAGE.length - 1 || undefined}>
                <p className="dk-stat-label">
                  {i + 1} · {s.step}
                </p>
                {s.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </li>
            ))}
          </ol>
        </section>
        <div className="pl-grid">
          <FailedScope q={q}>
          <section className="dk-card pl-inventory" aria-labelledby="pl-inv-title" aria-busy={!p && !q.isError}>
            <div className="pl-card-head">
              <h2 className="dk-card-title" id="pl-inv-title">
                Series inventory
              </h2>
              {/* §11: "generated from the registry and its consumers, counts derived". */}
              <p className="pl-head-sub">{total ? `${total} series · grouped · generated from the registry` : "grouped · generated from the registry"}</p>
              <input className="pl-search" type="search" aria-label="Find a series" placeholder="Find a series… (VIX, DGS10, gold)" value={text} onChange={(e) => onSearch(e.target.value)} disabled={!groups.length} />
            </div>
            <LoadingLine busy={!p && !q.isError} />
            {text.trim() && !hit ? (
              <p className="pl-miss" role="status">
                {/* Codex R-16: a series the boundary could not read may be the one asked for. */}
                {lostWords ? `No readable series matches “${text.trim()}”; ${lostWords}.` : <>No series matches &ldquo;{text.trim()}&rdquo;.</>}
              </p>
            ) : null}
            {groups.length ? (
              <div className="pl-groups">
                {groups.map((g) => (
                  <Group key={g.name} g={g} open={opened === slugOf(g.name)} onToggle={() => toggle(g.name)} hit={hit && hit.group === g.name ? hit.id : null} />
                ))}
              </div>
            ) : q.isError || p ? (
              <Awaiting>the registry's inventory</Awaiting>
            ) : null}
            <DroppedNote n={lostGroups} one="group" />
            <p className="pl-mono-note">Click a group to expand · search jumps to a series and opens its group · new series land in a group automatically</p>
          </section>
          </FailedScope>
          <Bridge />
        </div>
        {/* §11, §1.0.3: the sync the bridge card's schema is for, as a PROTOTYPE; the DDL and the CSV above are real. */}
        <SnowflakeSyncCard />
      </Unserved>
    </div>
  );
}
