/**
 * The result cards an event study prints (DESK_FRAME2_SPEC §3), shared by the
 * Event Study page and S&P Internals (§4): the horizon chart with its
 * Distribution toggle and the horizon cells under it, the verdict card (the
 * engine's paragraph and one facts line), the by-regime table one horizon at
 * a time, and the recent events. A horizon cell or a by-regime row expands to
 * the events behind it that the response carries (the engine serves the last
 * ten; the list says how many of the cell's events that is). One badge per
 * card, the study's Live badge; nothing else sits in the badge slot. Client
 * view: the verdict in words and the simple chart; the rest is working detail.
 */

import { useId, useState, type ReactNode } from "react";
import { DataTable, Segmented } from "../../../components";
import type { EventStudyEvent, EventStudyHorizon, EventStudyRegimeRow, EventStudyResponse } from "../../../api/desk";
import { fmtDate } from "../../../lib/format";
import Jargon from "../../shared/Jargon";
import ScrollTable from "../../shared/ScrollTable";
import { Caption } from "../../shared/screen-ui";
import { EmptyState, Panel } from "../desk-ui";
import { clientVerdict } from "../words";
import HorizonChart from "./HorizonChart";
import QuartileChart from "./QuartileChart";
import StudyBadge from "./StudyBadge";
import { eventsBehind, exclusionWord, factsLine, fmtInterval, fmtMove, fmtShare, fmtZ, missingForwardWord, unitWord, type MoveUnit } from "./format";

export const REGIME_HORIZON_DEFAULT = 20;

/** An open cell: the study it belongs to, its horizon, and its regime row.
 * Its count is read from the current response at render, never stored, and a
 * selection from another study is not open (review R-01). */
interface Behind {
  slug: string;
  h: number;
  regime?: string;
}

/** The cell's own n from the response on screen; null when the cell is not in it. */
export function behindCount(study: EventStudyResponse, b: Pick<Behind, "h" | "regime">): number | null {
  if (b.regime == null) return study.horizons.find((x) => x.h === b.h)?.n ?? null;
  const row = study.regime_split.find((r) => r.regime === b.regime);
  return row ? (row.by_horizon[String(b.h)]?.n ?? row.n) : null;
}

/** Resets a card's selection the moment its study changes (review R-01): the
 * selection is cleared during that render, so switching back later does not
 * bring an old selection back. */
function useResetOnStudy<T>(slug: string, reset: (v: T | null) => void): void {
  const [seen, setSeen] = useState(slug);
  if (seen !== slug) {
    setSeen(slug);
    reset(null);
  }
}

/** The selection, only while it belongs to the study on screen and names a cell in it. */
function current(study: EventStudyResponse, b: Behind | null): (Behind & { n: number }) | null {
  if (!b || b.slug !== study.slug) return null;
  const n = behindCount(study, b);
  return n == null ? null : { ...b, n };
}

function Missing({ e, h }: { e: EventStudyEvent; h: number }) {
  return <span style={{ color: "var(--text-3)" }}>{missingForwardWord(e, h)}</span>;
}

/** The events the response carries behind one cell, with the count stated. */
export function EventsBehind({ study, behind, unit, onClose, id }: { study: EventStudyResponse; behind: Behind & { n: number }; unit: MoveUnit; onClose: () => void; id: string }) {
  const rows = eventsBehind(study.recent_events, behind.h, behind.regime).map((e) => ({ ...e, id: e.date }));
  const what = behind.regime ? `${behind.regime} at ${behind.h} sessions` : `${behind.h} sessions`;
  const carried = study.recent_events.length;
  const count =
    rows.length === behind.n
      ? `All ${behind.n} of this cell's events are listed.`
      : `The response carries the last ${carried} of ${study.provenance.n_events} events; ${rows.length} of the ${behind.n} behind this cell are among them.`;
  const hs = study.horizons.map((h) => h.h);
  type Ev = EventStudyEvent & { id: string };
  const columns = [
    { key: "date", label: "Event date", mono: true, render: (e: Ev) => fmtDate(e.date) },
    { key: "regime", label: "Regime" },
    { key: "entry", label: "Entry", mono: true, render: (e: Ev) => (e.entry_date ? (e.same_session ? "same session" : fmtDate(e.entry_date)) : "—") },
    ...hs.map((h) => ({
      key: `f${h}`,
      label: h === behind.h ? `▸ +${h}d` : `+${h}d`,
      mono: true,
      align: "right" as const,
      render: (e: Ev) => (e.forward[String(h)] == null ? <Missing e={e} h={h} /> : fmtMove(e.forward[String(h)], unit)),
    })),
  ];
  return (
    <div className="mrr-desk-behind" id={id} role="region" aria-label={`Events behind ${what}`}>
      <div className="mrr-desk-behind-head">
        <strong>Events behind {what}</strong>
        <button type="button" className="mrr-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <Caption as="p" style={{ margin: "0 0 8px" }}>
        {count}
      </Caption>
      {rows.length ? (
        <ScrollTable label={`Events behind ${what}`}>
          <DataTable caption={`Events behind ${what}`} columns={columns} rows={rows} zebra={false} compact />
        </ScrollTable>
      ) : (
        <EmptyState title="None of this cell's events is in the response.">The engine serves the last ten events of a study; this cell's events are older.</EmptyState>
      )}
    </div>
  );
}

function HorizonCells({ study, unit, open, onToggle, controls }: { study: EventStudyResponse; unit: MoveUnit; open: number | null; onToggle: (h: EventStudyHorizon) => void; controls: string }) {
  return (
    <div className="mrr-desk-hcells" role="group" aria-label="Horizons: open one to list its events">
      {study.horizons.map((h) => (
        <button key={h.h} type="button" className="mrr-desk-hcell" aria-expanded={open === h.h} aria-controls={open === h.h ? controls : undefined} data-exclusion={h.exclusion ?? "none"} onClick={() => onToggle(h)}>
          <span className="mrr-desk-hcell-h">
            {h.h}d <span className="mrr-desk-hcell-n">n {h.n}</span>
          </span>
          <span className="mrr-desk-hcell-v">
            {fmtMove(h.median, unit)} <span className="mrr-desk-hcell-base">vs {fmtMove(h.baseline_median, unit)}</span>
          </span>
          <span className="mrr-desk-hcell-ci">Δ {fmtMove(h.delta, unit)} · 90% {fmtInterval(h.ci90, unit) ?? (h.note ?? "no interval")}</span>
          <span className="mrr-desk-hcell-x">{exclusionWord(h)}</span>
        </button>
      ))}
    </div>
  );
}

/** The horizon chart card: medians or the distribution, then the cells. */
export function HorizonCard({ study, isClient, id = "horizons", title = "By horizon" }: { study: EventStudyResponse; isClient: boolean; id?: string; title?: ReactNode }) {
  const unit = unitWord(study.target.unit);
  const [view, setView] = useState<"medians" | "distribution">("medians");
  const [picked, setOpen] = useState<Behind | null>(null);
  useResetOnStudy<Behind>(study.slug, setOpen);
  const open = current(study, picked);
  const behindId = useId();
  const toggle = (h: EventStudyHorizon) => setOpen((o) => (o && o.slug === study.slug && o.h === h.h ? null : { slug: study.slug, h: h.h }));
  return (
    <Panel
      id={id}
      title={title}
      description={
        isClient
          ? `How the ${study.target.label} moved after these events, against an ordinary stretch of the same length.`
          : view === "medians"
            ? `Median ${study.target.label} move after the event beside the baseline median, the engine's 90% interval on the difference, and its verdict on zero, in ${unit}.`
            : `The middle half of the moves on each side, from the quartiles the engine serves, in ${unit}.`
      }
      badge={<StudyBadge study={study} />}
    >
      {!isClient ? (
        <div className="mrr-desk-toolbar">
          <Segmented
            label="Chart"
            options={[
              { id: "medians", label: "Medians" },
              { id: "distribution", label: "Distribution" },
            ]}
            value={view}
            onChange={(v) => setView(v === "distribution" ? "distribution" : "medians")}
          />
        </div>
      ) : null}
      {view === "distribution" && !isClient ? (
        <QuartileChart horizons={study.horizons} unit={unit} targetLabel={study.target.label} />
      ) : (
        <HorizonChart horizons={study.horizons} unit={unit} targetLabel={study.target.label} simple={isClient} selected={open?.regime == null ? (open?.h ?? null) : null} onSelect={isClient ? undefined : (h) => toggle(study.horizons.find((x) => x.h === h)!)} />
      )}
      {!isClient ? (
        <>
          <HorizonCells study={study} unit={unit} open={open?.regime == null ? (open?.h ?? null) : null} onToggle={toggle} controls={behindId} />
          {open ? <EventsBehind study={study} behind={open} unit={unit} onClose={() => setOpen(null)} id={behindId} /> : null}
          {view === "distribution" ? <Caption>The engine serves quartiles, not histogram bins; each box spans the 25th to the 75th percentile and the line is the median.</Caption> : null}
        </>
      ) : null}
    </Panel>
  );
}

/** The verdict card: the engine's paragraph and one facts line (desk), or the
 * same claims in the client register. */
export function VerdictCard({ study, isClient, id = "verdict", title = "Verdict" }: { study: EventStudyResponse; isClient: boolean; id?: string; title?: ReactNode }) {
  const unit = unitWord(study.target.unit);
  return (
    <Panel id={id} title={title} description={isClient ? undefined : "Written by the engine from its rules; calibrated vocabulary only."} badge={<StudyBadge study={study} />}>
      {isClient ? (
        <p className="mrr-desk-verdict" data-register="client">
          {clientVerdict(study, unit).join(" ")}
        </p>
      ) : (
        <>
          <p className="mrr-desk-verdict">{study.verdict.text}</p>
          <p className="mrr-desk-facts" title={study.provenance.entry_rule ?? undefined}>
            {factsLine(study)}
          </p>
        </>
      )}
    </Panel>
  );
}

/** By regime, one horizon at a time (5/10/20/60, default 20). */
export function RegimeCard({ study, id = "regimes", title = "By regime" }: { study: EventStudyResponse; id?: string; title?: ReactNode }) {
  const unit = unitWord(study.target.unit);
  const hs = study.horizons.map((h) => h.h);
  const [h, setH] = useState<number>(hs.includes(REGIME_HORIZON_DEFAULT) ? REGIME_HORIZON_DEFAULT : (hs[0] ?? REGIME_HORIZON_DEFAULT));
  // The open row belongs to one study; another study on screen closes it (R-01).
  const [picked, setOpen] = useState<{ slug: string; regime: string } | null>(null);
  useResetOnStudy<{ slug: string; regime: string }>(study.slug, setOpen);
  const open = picked && picked.slug === study.slug ? picked.regime : null;
  const behindId = useId();
  type Row = EventStudyRegimeRow & { id: string };
  const rows: Row[] = study.regime_split.map((r) => ({ ...r, id: r.regime }));
  const cellOf = (r: Row) => r.by_horizon[String(h)];
  const dim = (text: string) => <span style={{ color: "var(--text-3)" }}>{text}</span>;
  const read = (r: Row, v: (c: NonNullable<ReturnType<typeof cellOf>>) => string) => {
    const c = cellOf(r);
    if (!c || c.median == null) return dim(c?.note ?? "n<10");
    return v(c);
  };
  const toggle = (r: Row) => setOpen((o) => (o && o.slug === study.slug && o.regime === r.regime ? null : { slug: study.slug, regime: r.regime }));
  const columns = [
    {
      key: "regime",
      label: "Regime",
      render: (r: Row) => (
        <button type="button" className="mrr-desk-rowbtn" aria-expanded={open === r.regime} aria-controls={open === r.regime ? behindId : undefined} onClick={(e) => (e.stopPropagation(), toggle(r))}>
          <span aria-hidden="true">{open === r.regime ? "▾" : "▸"}</span> {r.regime}
          {r.excluded_from_totals ? <span className="mrr-desk-flagword"> outside the totals</span> : null}
        </button>
      ),
    },
    { key: "n", label: "n", mono: true, align: "right" as const, render: (r: Row) => String(cellOf(r)?.n ?? r.n) },
    { key: "hit", label: <Jargon term="hit rate">Hit rate</Jargon>, mono: true, align: "right" as const, render: (r: Row) => read(r, (c) => fmtShare(c.hit_rate)) },
    { key: "median", label: "Median", mono: true, align: "right" as const, render: (r: Row) => read(r, (c) => fmtMove(c.median, unit)) },
    { key: "base", label: "Regime baseline", mono: true, align: "right" as const, render: (r: Row) => fmtMove(cellOf(r)?.baseline_median, unit) },
  ];
  const openRow = rows.find((r) => r.regime === open);
  return (
    <Panel
      id={id}
      title={title}
      description={`The classifier's stored label${study.provenance.regime_lag_months != null ? ` ${study.provenance.regime_lag_months} months` : ""} before each event; reads under ten events print n<10.`}
      badge={<StudyBadge study={study} />}
    >
      <div className="mrr-desk-toolbar">
        <span className="mrr-desk-toolbar-label" id={`${behindId}-h`}>
          Horizon
        </span>
        <Segmented label="Horizon" mono options={hs.map((x) => ({ id: String(x), label: `${x}d` }))} value={String(h)} onChange={(v) => setH(Number(v))} aria-describedby={`${behindId}-h`} />
      </div>
      <ScrollTable label="By regime">
        <DataTable caption={`Forward moves by regime at ${h} sessions`} columns={columns} rows={rows} zebra={false} rowProps={(r: Row) => ({ onClick: () => toggle(r), style: { cursor: "pointer" }, "data-regime": r.regime })} />
      </ScrollTable>
      {openRow ? <EventsBehind study={study} behind={{ slug: study.slug, h, regime: openRow.regime, n: behindCount(study, { h, regime: openRow.regime }) ?? openRow.n }} unit={unit} onClose={() => setOpen(null)} id={behindId} /> : null}
      <Caption>{study.provenance.regime_rule ?? "Events before the first stored label sit in the Unlabeled row, outside the totals."}</Caption>
    </Panel>
  );
}

/** The last ten events with their forward moves (unchanged from the frame). */
export function EventsCard({ study, id = "events", title = "Recent events" }: { study: EventStudyResponse; id?: string; title?: ReactNode }) {
  const unit = unitWord(study.target.unit);
  const hs = study.horizons.map((h) => h.h);
  type Ev = EventStudyEvent & { id: string };
  const rows: Ev[] = study.recent_events.map((e) => ({ ...e, id: e.date }));
  const columns = [
    { key: "date", label: "Event date", mono: true, render: (e: Ev) => fmtDate(e.date) },
    { key: "regime", label: "Regime" },
    ...(study.kind === "cross" ? [] : [{ key: "z", label: <Jargon term="z-score">z</Jargon>, mono: true, align: "right" as const, render: (e: Ev) => fmtZ(e.z) }]),
    ...hs.map((h) => ({ key: `f${h}`, label: `+${h}d`, mono: true, align: "right" as const, render: (e: Ev) => (e.forward[String(h)] == null ? <Missing e={e} h={h} /> : fmtMove(e.forward[String(h)], unit)) })),
  ];
  return (
    <Panel id={id} title={title} description={`The last ${rows.length} of ${study.provenance.n_events} events, newest first${study.condition ? `, while ${study.condition.label}` : ""}.`} badge={<StudyBadge study={study} />}>
      <ScrollTable label={typeof title === "string" ? title : "Recent events"}>
        <DataTable caption="The last ten events with their forward moves" columns={columns} rows={rows} zebra={false} compact />
      </ScrollTable>
      {study.recent_events.some((e) => Object.values(e.forward).some((v) => v == null)) ? (
        <Caption>A missing return reads "no observation". The engine does not yet say which windows are still open, so on a recent event a longer window may not have elapsed.</Caption>
      ) : null}
    </Panel>
  );
}
