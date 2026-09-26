/**
 * The Client view (DESK_FRAME3_SPEC §11, screens/12-client-view.png): the
 * Desk / Client toggle swaps a tab's body for a client-safe read of one
 * study. On Event Study it is the study in the address; elsewhere the last
 * study this browser saw answered (Data Pipeline's "current study"), else the
 * gold preset. The question and the paragraph are served (§12.2 `client`, at
 * h = 20); the three numbers, the backdrop bars and the source line read
 * §12.2's fields at a month. No verdict pills, no σ, no jargon. The labels
 * stay in every state; a study too thin to read at a month says so in plain
 * words (never the desk's verdict sentence). The header's Export prints this
 * page alone.
 */

import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { DeskApiError, unavailableOf, useStudy } from "../data/api";
import type { StudyResponse } from "../data/types";
import type { DeskPage } from "../desk-sections";
import { dayLong, pctPlain, year } from "../kit/format";
import { Awaiting, Signed, Unserved, useUnserved } from "../kit/ui";
import { apiParams, askFromSearch, atMonth, readLastStudy, targetLabel } from "../event-study/question";
import { isUnit, moveText, scaleOf, tipOf } from "../kit/units";
import "./client.css";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** §11's source line, verbatim, dated by the study's `as_of`. */
export function sourceLine(asOf: string | null | undefined): string {
  const d = dayLong(asOf);
  return ["Radar", "FRED, Yahoo Finance", d ? `as of ${d}` : null, "Past patterns do not guarantee future results."].filter(Boolean).join(" · ");
}

/** "Setup · <day>" while the setup is on (it fired on its last session), else when it was last seen. */
export function setupLabel(s: Pick<StudyResponse, "firing_now" | "last_event" | "stale"> | undefined): string {
  const d = dayLong(s?.last_event);
  if (!s || !d) return "Setup";
  // §11: "Setup · <last_event>" only when firing and not stale.
  return s.firing_now === true && s.stale !== true ? `Setup · ${d}` : `Setup last seen · ${d}`;
}

/** Room right of the drawable track for each bar's value, left of it before the first bar, and before zero when nothing is negative (the PNG's geometry). */
const VALUE_ROOM = 76;
const GUTTER = 8;
const NEG_ROOM = 46;

/** One scale for both signs: zero where the largest drop fits (the PNG's room when
 * nothing is negative), every bar |v| × the same px-per-point, as CSS lengths on the track. */
export function barGeometry(vals: readonly (number | null)[]): {
  zero: string;
  bars: ({ left: string; width: string; label: string } | null)[];
  /** Where a null row's words go: after zero, or, when zero sits right of the middle, ending before it. Both wrap inside the track. */
  none: { left: string; right: string; align: "left" | "right" };
} {
  const ok = vals.filter(fin);
  const pos = Math.max(0, ...ok);
  const neg = Math.max(0, ...ok.map((v) => -v));
  const span = `(100% - ${VALUE_ROOM + GUTTER}px)`;
  const f = (x: number) => x.toFixed(4);
  // Zero, and the length of one unit of |v|, both as calc() terms.
  const zero = neg > 0 ? `calc(${GUTTER}px + ${span} * ${f(neg / (neg + pos))})` : `${NEG_ROOM}px`;
  const unit = (v: number) => (neg > 0 ? `${span} * ${f(Math.abs(v) / (neg + pos))}` : `(100% - ${VALUE_ROOM + NEG_ROOM}px) * ${f(Math.abs(v) / (pos || 1))}`);
  const share = neg > 0 ? neg / (neg + pos) : 0;
  const bare = zero.replace(/^calc/, "");
  const none = share > 0.5 ? { left: `${GUTTER}px`, right: `calc(100% - ${bare} + 9px)`, align: "right" as const } : { left: `calc(${bare} + 9px)`, right: "0px", align: "left" as const };
  return {
    zero,
    none,
    bars: vals.map((v) => {
      if (!fin(v)) return null;
      const width = `calc(${unit(v)})`;
      const left = v >= 0 ? zero : `calc(${zero.replace(/^calc/, "")} - ${unit(v)})`;
      const label = v > 0 ? `calc(${zero.replace(/^calc/, "")} + ${unit(v)} + 9px)` : `calc(${zero.replace(/^calc/, "")} + 9px)`;
      return { left, width, label };
    }),
  };
}

/** A study too thin to read at a month, in client words (§11: no jargon), from the month's served count; null when it is not thin. */
export function thinWords(s: StudyResponse | undefined): string | null {
  if (!s) return null;
  const month = Array.isArray(s.horizons) ? s.horizons.find((h) => h.h === 20) : undefined;
  const served = s.empty_state && (s.empty_state.horizon ?? 20) === 20;
  if (!served && !(month && fin(month.n) && month.n < 10)) return null;
  const n = month && fin(month.n) ? month.n : fin(s.matched_n) ? s.matched_n : null;
  const since = year(s.sample_start);
  return n != null ? `Only ${n} episode${n === 1 ? "" : "s"}${since ? ` since ${since}` : ""}: too few to say what usually happens a month later.` : "Too few episodes to say what usually happens a month later.";
}

function Backdrop({ s, failed }: { s: StudyResponse | undefined; failed: boolean }) {
  // Every move in the study's served unit, its target named by `series[]` (Codex R-02; §12.2).
  const unit = isUnit(s?.question?.target_unit) ? s.question.target_unit : undefined;
  const target = targetLabel(s);
  const rows = s && unit && Array.isArray(s.by_regime) ? s.by_regime : [];
  const g = barGeometry(rows.map((r) => (fin(r.median) ? r.median : null)));
  const thin = thinWords(s);
  return (
    <section className="dk-card cv-card" aria-labelledby="cv-backdrop">
      <h2 className="dk-card-title" id="cv-backdrop">
        A month later, by economic backdrop
      </h2>
      <p className="cv-card-sub">{target ? `Typical ${target} move after the setup` : "Typical move after the setup"}</p>
      {rows.length ? (
        <ul className="cv-bars" style={{ ["--cv-zero" as string]: g.zero }}>
          {rows.map((r, i) => {
            const v = fin(r.median) ? r.median : null;
            const b = g.bars[i];
            return (
              <li key={r.regime} data-none={v == null || undefined}>
                <span className="cv-regime">{r.regime}</span>
                <span className="cv-track">
                  {/* A move that rounds to zero in its unit draws no sliver of a bar. */}
                  {b && v && unit && Math.abs(v * scaleOf(unit)) >= 0.05 ? <span className="cv-bar" aria-hidden="true" data-tone={v < 0 ? "red" : "green"} style={{ left: b.left, width: b.width }} /> : null}
                  {b ? (
                    <span className="cv-val" style={{ left: b.label }} title={tipOf(unit)}>
                      {moveText(v, unit)}
                    </span>
                  ) : (
                    <span className="cv-val cv-none" style={{ left: g.none.left, right: g.none.right, textAlign: g.none.align }}>
                      too few cases to say
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : thin ? (
        <p className="cv-thin">{thin}</p>
      ) : s || failed ? (
        <Awaiting />
      ) : null}
    </section>
  );
}

function StatCard({ label, children, state }: { label: string; children?: ReactNode; state: "value" | "loading" | "awaiting" | string }) {
  // §1.0.2: a study served awaiting keeps the label and prints no number; the reason is printed once above.
  const unserved = useUnserved();
  return (
    <div className="dk-card cv-stat">
      <p className="dk-stat-label">{label}</p>
      {unserved ? (
        <p className="dk-stat-await" aria-hidden="true">
          —
        </p>
      ) : state === "value" ? (
        children
      ) : state === "loading" ? null : state === "awaiting" ? (
        <p className="dk-stat-await">Awaiting refresh</p>
      ) : (
        <p className="cv-stat-thin">{state}</p>
      )}
    </div>
  );
}

export default function ClientView({ page }: { page: DeskPage }) {
  const location = useLocation();
  const ask = page.slug === "event-study" ? askFromSearch(location.search) : askFromSearch(readLastStudy() ?? "");
  // The client view asks the study at h = 20 (v4 B-01): its counts, its sentence and its empty state are
  // the month's, whatever horizon the desk has selected.
  const q = useStudy(apiParams(atMonth(ask)));
  const s = q.isError ? undefined : q.data;
  const failed = q.isError;
  // §4: a question the server refuses (422 `unsupported`) prints the served message; nothing is awaited.
  const refusal = q.error instanceof DeskApiError && q.error.status === 422 && q.error.body?.error === "unsupported" ? q.error.message : null;
  const month = s && Array.isArray(s.horizons) ? s.horizons.find((h) => h.h === 20) : undefined;
  // A study too thin to read at a month answered: a plain sentence stands where the numbers would.
  const thin = thinWords(s);
  // Once, in the backdrop card (and in the summary's place when no client paragraph is served); the month's two stats read like a null regime row.
  const state = (ok: boolean) => (ok ? "value" : (!s && !failed) || refusal ? "loading" : thin ? "too few cases to say" : "awaiting");
  return (
    <div className="cv" aria-busy={(!s && !failed) || undefined}>
      <Unserved block={unavailableOf(q.error)}>
        <div className="cv-grid">
          <div className="cv-main">
            <p className="dk-stat-label">{setupLabel(s)}</p>
            {/* §11: the served client.headline; the catalog label (served on /study) when client is null. */}
            <h1 className="cv-headline">{s?.client?.headline ?? s?.label ?? "What has happened after this setup"}</h1>
            {s?.client?.summary ? (
              // The served summary carries the h = 20 median and baseline (§12.2): a log study's sentence carries the §1.9 tooltip.
              <p className="cv-summary" title={tipOf(s.question?.target_unit)}>
                {s.client.summary}
              </p>
            ) : thin ? <p className="cv-summary">{thin}</p> : refusal ? <p className="cv-summary">{refusal}</p> : s || failed ? <Awaiting className="cv-summary-await" /> : null}
            <div className="cv-stats">
              <StatCard label="Episodes" state={state(!!s && fin(s.matched_n))}>
                <p className="cv-stat-value">{s?.matched_n}</p>
                <p className="cv-stat-sub">{year(s?.sample_start) ? `since ${year(s?.sample_start)}` : ""}</p>
              </StatCard>
              <StatCard label="Higher a month later" state={state(!!month && fin(month.up_pct))}>
                {month && fin(month.up_pct) ? (
                  <>
                    {/* Green when the setup ended up more often than an ordinary month did (§1.3: green means up). */}
                    <p className="cv-stat-value" data-tone={fin(month.baseline_up_pct) && month.up_pct > month.baseline_up_pct ? "green" : undefined}>
                      {pctPlain(month.up_pct)}
                    </p>
                    <p className="cv-stat-sub">{fin(month.baseline_up_pct) ? `vs ${pctPlain(month.baseline_up_pct)} in an ordinary month` : ""}</p>
                  </>
                ) : null}
              </StatCard>
              <StatCard label="Typical move" state={state(!!month && fin(month.median) && !!moveText(month.median, s?.question?.target_unit))}>
                {month && fin(month.median) ? (
                  <>
                    <p className="cv-stat-value">
                      <Signed value={month.median} title={tipOf(s?.question?.target_unit)}>
                        {moveText(month.median, s?.question?.target_unit)}
                      </Signed>
                    </p>
                    <p className="cv-stat-sub">
                      {moveText(month.baseline_median, s?.question?.target_unit) ? (
                        <>
                          vs <span title={tipOf(s?.question?.target_unit)}>{moveText(month.baseline_median, s?.question?.target_unit)}</span> ordinary
                        </>
                      ) : null}
                    </p>
                  </>
                ) : null}
              </StatCard>
            </div>
            <p className="cv-source">{sourceLine(s?.as_of)}</p>
          </div>
          <Backdrop s={s} failed={failed && !refusal} />
        </div>
      </Unserved>
    </div>
  );
}
