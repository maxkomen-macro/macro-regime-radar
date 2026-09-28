/**
 * Signal Ledger (DESK_FRAME3_SPEC §8, screens/07-signal-ledger.png), read
 * from GET /api/desk/ledger (§12.4): every signal the engine scores on one
 * page. Four counts, five filters, and one table: the twelve rows in the
 * served fixed order (§8, v3 §2), a firing row green-tinted. A row opens its
 * study in Event Study.
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { unavailableOf, useLedger } from "../data/api";
import { droppedOf } from "../data/schema";
import type { LedgerRow } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { dayLong, dayShort, pctPlain, VERDICT_LABEL } from "../kit/format";
import { moveText, tipOf, vsNormalText } from "../kit/units";
import { Awaiting, DroppedNote, LiveBadge, NotServedBadge, Signed, Stat, Unserved, VerdictPill, LoadingLine } from "../kit/ui";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import "./ledger.css";

export type Filter = "all" | "firing" | "reliable" | "spx" | "cross";
const FILTER_IDS: readonly Filter[] = ["all", "firing", "reliable", "spx", "cross"];

/** A row whose study can run (§12.5 `available`); an unavailable row is left out of every count but the header's. */
export const isAvailable = (r: LedgerRow) => r.available !== false;
/** Firing today: firing on the comparison session; a stale row is never called firing today (v3 §3). */
// A firing claim needs the state and its freshness served: stale not served claims nothing (§12.5; verifier V14-5).
export const firingToday = (r: LedgerRow) => isAvailable(r) && r.firing_now === true && r.stale === false;

/**
 * Codex R-21, R-30: which of the header's counts the rows can give. A count is read from the rows only when
 * every row carries the fields it counts (`available` for all; a boolean `firing_now` and `stale` for Firing
 * now, so a null firing state on any available row is not a "no"; `verdict` for Reliable and No edge, an
 * unavailable row needing none); otherwise it says Awaiting refresh.
 */
export function countable(rows: readonly LedgerRow[]): { rows: boolean; firing: boolean; verdicts: boolean } {
  const avail = rows.every((r) => typeof r.available === "boolean");
  const live = rows.filter((r) => r.available !== false);
  return {
    rows: avail,
    firing: avail && live.every((r) => typeof r.firing_now === "boolean" && typeof r.stale === "boolean"),
    verdicts: avail && live.every((r) => typeof r.verdict === "string"),
  };
}

export function applyFilter(rows: readonly LedgerRow[], f: Filter): LedgerRow[] {
  if (f === "firing") return rows.filter(firingToday);
  if (f === "reliable") return rows.filter((r) => isAvailable(r) && r.verdict === "reliable");
  if (f === "spx") return rows.filter((r) => r.group === "spx");
  if (f === "cross") return rows.filter((r) => r.group === "cross");
  return [...rows];
}

/** Whether a box scrolls sideways: the table's region is a Tab stop only then (R2-4). */
function useOverflows<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setOver(el.scrollWidth > el.clientWidth + 1);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return [ref, over] as const;
}

const knownVerdict = (v: unknown): v is keyof typeof VERDICT_LABEL => typeof v === "string" && Object.prototype.hasOwnProperty.call(VERDICT_LABEL, v);

/** The row's name in lists and in its accessible name; the slug when nothing else is served. */
const nameOf = (r: LedgerRow) => r.short || r.label || r.slug;
const titleOf = (r: LedgerRow) => r.label || r.short || r.slug;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function Row({ r, onOpen }: { r: LedgerRow; onOpen: (slug: string) => void }) {
  // §8: an unavailable row keeps its label and prints its reason across the value columns, with no pill;
  // its study cannot run, so it opens nothing.
  if (!isAvailable(r))
    return (
      <tr data-unavailable>
        <th scope="row">{titleOf(r)}</th>
        <td colSpan={7} className="lg-unavailable">
          {r.unavailable?.reason ?? "not yet served"}
        </td>
      </tr>
    );
  const key = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(r.slug);
    }
  };
  return (
    <tr data-firing={firingToday(r) || undefined} tabIndex={0} onClick={() => onOpen(r.slug)} onKeyDown={key} aria-label={`${titleOf(r)}: open in Event Study`}>
      <th scope="row">{titleOf(r)}</th>
      <td className="lg-mono">{typeof r.last_fired === "string" && dayLong(r.last_fired) ? dayLong(r.last_fired) : "—"}</td>
      <td className="lg-mono">{fin(r.n) ? r.n : "—"}</td>
      <td className="lg-mono">{fin(r.up_pct) ? pctPlain(r.up_pct) : "—"}</td>
      {/* The median in the row's own served unit (§1.9): a yield target in bp, a price in log percent with its tooltip. */}
      <td className="lg-mono">
        {fin(r.median) && moveText(r.median, r.target_unit ?? undefined) ? (
          <Signed value={r.median} title={tipOf(r.target_unit ?? undefined)}>
            {moveText(r.median, r.target_unit ?? undefined)}
          </Signed>
        ) : (
          "—"
        )}
      </td>
      {/* The row's own excess over its own baseline (§1.9, §4.1), in its own unit. */}
      <td className="lg-mono">
        {fin(r.vs_normal) && vsNormalText(r.vs_normal, r.target_unit ?? undefined) ? (
          <Signed value={r.vs_normal} title={tipOf(r.target_unit ?? undefined)}>
            {vsNormalText(r.vs_normal, r.target_unit ?? undefined)}
          </Signed>
        ) : (
          "—"
        )}
      </td>
      <td className="lg-verdict">{knownVerdict(r.verdict) ? <VerdictPill verdict={r.verdict} className="lg-pill" /> : "—"}</td>
      {/* §8: "● Firing · day <n>", "○ Quiet", or "○ Stale · <evaluated_on>" (v3 §3), "—" when the state is not served; the tooltip names the session the row was evaluated on. */}
      <td
        className="lg-now"
        title={r.evaluated_on ? `evaluated on ${dayLong(r.evaluated_on)}` : undefined}
        data-tone={r.firing_now == null || r.stale == null ? undefined : r.stale ? "gray" : r.firing_now ? "green" : "gray"}
      >
        {r.firing_now == null || r.stale == null ? "—" : r.stale ? `○ Stale · ${dayShort(r.evaluated_on) || "—"}` : r.firing_now ? `● Firing${fin(r.firing_day) ? ` · day ${r.firing_day}` : ""}` : "○ Quiet"}
      </td>
    </tr>
  );
}

export default function LedgerPage({ page }: { page: DeskPage }) {
  const { pathTo } = useDeskView();
  const navigate = useNavigate();
  const q = useLedger();
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  const [scrollRef, scrolls] = useOverflows<HTMLDivElement>();
  // desk/usability §14.9: the filter lives in the address (`?filter=`), so a link opens the same rows.
  const [search, setSearch] = useSearchParams();
  const filter: Filter = (FILTER_IDS as readonly string[]).includes(search.get("filter") ?? "") ? (search.get("filter") as Filter) : "all";
  const setFilter = (f: Filter) =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        if (f === "all") q.delete("filter");
        else q.set("filter", f);
        return q;
      },
      { replace: true },
    );
  const l = q.data;
  const rows = Array.isArray(l?.signals) ? l.signals : [];
  // Codex R-16: rows the boundary could not read are said, and no count is read from the rest.
  const lost = droppedOf(l, "signals");
  const ready = rows.length > 0;
  const state = ready ? "ready" : q.isError || l ? "awaiting" : "loading";
  // §8, v4 B-02: unavailable rows are left out of every count but the header's.
  const firing = rows.filter(firingToday);
  const reliable = rows.filter((r) => isAvailable(r) && r.verdict === "reliable");
  const noEdge = rows.filter((r) => isAvailable(r) && r.verdict === "no_edge");
  const known = countable(rows);
  const scored = fin(l?.scored_n) ? l.scored_n : lost || !known.rows ? null : rows.filter(isAvailable).length;
  const off = fin(l?.unavailable_n) ? l.unavailable_n : lost || scored == null ? null : rows.length - scored;
  const counted = ready && !lost;
  const firingCounted = counted && known.firing;
  const verdictsCounted = counted && known.verdicts;
  // §8: the rows in exactly the served order, whatever their state (v3 §2's fixed order).
  const shown = applyFilter(rows, filter);
  const open = (slug: string) => navigate(withParam(pathTo("event-study"), "preset", slug));
  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counted ? rows.length : ""}`.trim() },
    { id: "firing", label: "Firing now" },
    { id: "reliable", label: "Reliable only" },
    { id: "spx", label: "S&P only" },
    { id: "cross", label: "Cross-asset" },
  ];
  return (
    <div className="lg">
      <PageTitle page={page} badge={unserved ? <NotServedBadge boxed block={unserved} /> : l && dayShort(l.as_of) ? <LiveBadge boxed parts={[`engine as of ${dayShort(l.as_of)}`]} /> : null} />
      <Unserved block={unserved}>
        <div className="lg-stats" aria-busy={state === "loading"}>
          <Stat
            label="Signals scored"
            awaiting={state === "awaiting" || (ready && scored == null)}
            value={ready && scored != null ? String(scored) : undefined}
            sub={ready && scored != null ? (off != null ? `${scored} scored · ${off} not yet served` : `${scored} scored`) : undefined}
          />
          {/* Counted from the rows, so only when every row was read and carries what is counted (Codex R-16, R-21). */}
          <Stat label="Firing now" awaiting={state === "awaiting" || (ready && !firingCounted)} value={firingCounted ? String(firing.length) : undefined} tone={firingCounted && firing.length ? "green" : undefined} sub={firingCounted ? firing.map(nameOf).filter(Boolean).join(" · ") || "none" : undefined} />
          <Stat label="Reliable" awaiting={state === "awaiting" || (ready && !verdictsCounted)} value={verdictsCounted ? String(reliable.length) : undefined} tone={verdictsCounted && reliable.length ? "green" : undefined} sub={verdictsCounted ? reliable.map(nameOf).filter(Boolean).join(" · ") || "none" : undefined} />
          <Stat label="No edge" awaiting={state === "awaiting" || (ready && !verdictsCounted)} value={verdictsCounted ? String(noEdge.length) : undefined} />
        </div>
        <section className="dk-card lg-card" aria-label="Every scored signal" aria-busy={state === "loading"}>
          <LoadingLine busy={state === "loading"} />
          <div className="lg-chips" role="group" aria-label="Filter">
            {chips.map((c) => (
              <button key={c.id} type="button" className="dk-chip" aria-pressed={filter === c.id} disabled={!ready} onClick={() => setFilter(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          {ready ? (
            // The table keeps its columns at every width; narrower than that, it scrolls inside this region (L-1, L-11).
            <div className="lg-scroll" ref={scrollRef} tabIndex={scrolls ? 0 : undefined} role="region" aria-label="The signals table">
            <table className="lg-table">
              <colgroup>
                <col />
                <col style={{ width: 128 }} />
                <col style={{ width: 82 }} />
                <col style={{ width: 102 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 101 }} />
                <col style={{ width: 101 }} />
                {/* NOW holds "● Firing · day 10" and "○ Stale · Sep 19" whole (§8), with air before it: 12px taken from VERDICT's 92px pill column, no other column moved. */}
                <col style={{ width: 148 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">Last fired</th>
                  <th scope="col">Times</th>
                  <th scope="col">Up a month later</th>
                  <th scope="col">Median</th>
                  <th scope="col">Vs normal</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Now</th>
                </tr>
              </thead>
              {shown.length ? (
                <tbody>
                  {shown.map((r) => (
                    <Row key={r.slug} r={r} onOpen={open} />
                  ))}
                </tbody>
              ) : null}
              {!shown.length ? (
                <tbody>
                  <tr>
                    <td colSpan={8} className="lg-empty">
                      {lost ? "No readable signal matches this filter." : "No signal matches this filter."}
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
            </div>
          ) : state === "awaiting" ? (
            <Awaiting />
          ) : null}
          <DroppedNote n={lost} />
          <div className="lg-foot">
            <VerdictDefinitions />
            <p className="lg-note">
              {/* §8: there is no universal normal month; a line may break after a separator, never before one (R2-2). */}
              <span className="lg-note-read">vs normal compares each study to its own baseline over its own sample.</span>{" "}
              {["a month = 20 sessions".replace(/ /g, "\u00a0"), l && dayShort(l.as_of) ? `engine as of ${dayShort(l.as_of)}`.replace(/ /g, "\u00a0") : null].filter(Boolean).join("\u00a0· ")}
            </p>
          </div>
        </section>
      </Unserved>
    </div>
  );
}
