/**
 * Signal Ledger (DESK_FRAME3_SPEC §8, screens/07-signal-ledger.png), read
 * from GET /api/desk/ledger (§12.4): every signal the engine scores on one
 * page. Four counts, five filters, and one table in two groups: firing now
 * (green-tinted rows), then the quiet ones sorted by verdict (Reliable,
 * Suggestive, No edge; §12.4 makes sorting the client's job and names no
 * third key, so a verdict keeps the served order). A row opens its study in
 * Event Study.
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useLedger } from "../data/api";
import type { LedgerRow } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { dayLong, dayShort, pct, pctPlain, pts, VERDICT_LABEL, VERDICT_RANK } from "../kit/format";
import { Awaiting, LiveBadge, Signed, Stat, VerdictPill } from "../kit/ui";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import "./ledger.css";

export type Filter = "all" | "firing" | "reliable" | "spx" | "cross";

export function applyFilter(rows: readonly LedgerRow[], f: Filter): LedgerRow[] {
  if (f === "firing") return rows.filter((r) => r.firing_now);
  if (f === "reliable") return rows.filter((r) => r.verdict === "reliable");
  if (f === "spx") return rows.filter((r) => r.group === "spx");
  if (f === "cross") return rows.filter((r) => r.group === "cross");
  return [...rows];
}

/** The quiet rows by verdict, served order within a verdict (a stable sort). */
export function byVerdict(rows: readonly LedgerRow[]): LedgerRow[] {
  const rank = (r: LedgerRow) => (r.verdict ? VERDICT_RANK[r.verdict] : 9) ?? 9;
  return [...rows].sort((a, b) => rank(a) - rank(b));
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
  const key = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(r.slug);
    }
  };
  return (
    <tr data-firing={r.firing_now === true || undefined} tabIndex={0} onClick={() => onOpen(r.slug)} onKeyDown={key} aria-label={`${titleOf(r)}: open in Event Study`}>
      <th scope="row">{titleOf(r)}</th>
      <td className="lg-mono">{typeof r.last_fired === "string" && dayLong(r.last_fired) ? dayLong(r.last_fired) : "—"}</td>
      <td className="lg-mono">{fin(r.n) ? r.n : "—"}</td>
      <td className="lg-mono">{fin(r.up_pct) ? pctPlain(r.up_pct) : "—"}</td>
      <td className="lg-mono">{fin(r.median) ? <Signed value={r.median}>{pct(r.median)}</Signed> : "—"}</td>
      <td className="lg-mono">{fin(r.vs_normal_pts) ? <Signed value={r.vs_normal_pts}>{pts(r.vs_normal_pts)}</Signed> : "—"}</td>
      <td className="lg-verdict">{knownVerdict(r.verdict) ? <VerdictPill verdict={r.verdict} className="lg-pill" /> : "—"}</td>
      <td className="lg-now" data-tone={r.firing_now === true ? "green" : r.firing_now === false ? "gray" : undefined}>
        {r.firing_now === true ? "● Firing" : r.firing_now === false ? "○ Quiet" : "—"}
      </td>
    </tr>
  );
}

export default function LedgerPage({ page }: { page: DeskPage }) {
  const { pathTo } = useDeskView();
  const navigate = useNavigate();
  const q = useLedger();
  const [scrollRef, scrolls] = useOverflows<HTMLDivElement>();
  const [filter, setFilter] = useState<Filter>("all");
  const l = q.data;
  const rows = Array.isArray(l?.signals) ? l.signals : [];
  const ready = rows.length > 0;
  const state = ready ? "ready" : q.isError || l ? "awaiting" : "loading";
  const firing = rows.filter((r) => r.firing_now === true);
  const reliable = rows.filter((r) => r.verdict === "reliable");
  const noEdge = rows.filter((r) => r.verdict === "no_edge");
  const shown = applyFilter(rows, filter);
  const shownFiring = shown.filter((r) => r.firing_now === true);
  const shownQuiet = byVerdict(shown.filter((r) => r.firing_now !== true));
  const open = (slug: string) => navigate(withParam(pathTo("event-study"), "preset", slug));
  const earliest = rows.map((r) => r.sample_start).filter(Boolean).sort()[0];
  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${rows.length || ""}`.trim() },
    { id: "firing", label: "Firing now" },
    { id: "reliable", label: "Reliable only" },
    { id: "spx", label: "S&P only" },
    { id: "cross", label: "Cross-asset" },
  ];
  return (
    <div className="lg">
      <PageTitle page={page} badge={l && dayShort(l.as_of) ? <LiveBadge boxed parts={[`engine as of ${dayShort(l.as_of)}`]} /> : null} />
      <div className="lg-stats" aria-busy={state === "loading"}>
        <Stat label="Signals scored" awaiting={state === "awaiting"} value={ready ? String(rows.length) : undefined} sub={ready && earliest ? `since ${earliest.slice(0, 4)} where history allows` : undefined} />
        <Stat label="Firing now" awaiting={state === "awaiting"} value={ready ? String(firing.length) : undefined} tone={firing.length ? "green" : undefined} sub={ready ? firing.map(nameOf).filter(Boolean).join(" · ") || "none" : undefined} />
        <Stat label="Reliable" awaiting={state === "awaiting"} value={ready ? String(reliable.length) : undefined} tone={reliable.length ? "green" : undefined} sub={ready ? reliable.map(nameOf).filter(Boolean).join(" · ") || "none" : undefined} />
        <Stat label="No edge" awaiting={state === "awaiting"} value={ready ? String(noEdge.length) : undefined} sub={ready ? "shown so you know they were checked" : undefined} />
      </div>
      <section className="dk-card lg-card" aria-label="Every scored signal" aria-busy={state === "loading"}>
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
              <col style={{ width: 113 }} />
              <col style={{ width: 92 }} />
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
            {shownFiring.length ? (
              <tbody>
                <tr className="lg-group">
                  <th scope="rowgroup" colSpan={8}>
                    Firing now
                  </th>
                </tr>
                {shownFiring.map((r) => (
                  <Row key={r.slug} r={r} onOpen={open} />
                ))}
              </tbody>
            ) : null}
            {shownQuiet.length ? (
              <tbody>
                <tr className="lg-group">
                  <th scope="rowgroup" colSpan={8}>
                    Quiet · sorted by verdict
                  </th>
                </tr>
                {shownQuiet.map((r) => (
                  <Row key={r.slug} r={r} onOpen={open} />
                ))}
              </tbody>
            ) : null}
            {!shownFiring.length && !shownQuiet.length ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="lg-empty">
                    No signal matches this filter.
                  </td>
                </tr>
              </tbody>
            ) : null}
          </table>
          </div>
        ) : state === "awaiting" ? (
          <Awaiting />
        ) : null}
        <div className="lg-foot">
          <VerdictDefinitions />
          <p className="lg-note">
            {/* A line may break after a separator, never before one (R2-2). */}
            {["a month = 20 sessions", l && fin(l.normal_month) ? `normal month\u00a0${pct(l.normal_month)}` : null, l && dayShort(l.as_of) ? `engine as of\u00a0${dayShort(l.as_of)}` : null].filter(Boolean).join("\u00a0· ")}
          </p>
        </div>
      </section>
    </div>
  );
}
