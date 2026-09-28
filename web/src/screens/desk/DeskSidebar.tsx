/**
 * The Desk v2 sidebar (DESK_FRAME3_SPEC §1.1), the only navigation: the
 * `← MACRO REGIME RADAR` link back to the Radar, `Desk` over `ANALYST
 * WORKSPACE`, the groups (desk/usability §14.5: MARKET · RESEARCH · TRADE,
 * then the small ABOUT THIS BUILD line), the current page marked, and two stacked cards
 * at the foot: TODAY (the regime from /overview, the S&P's day from
 * /technicals, the data word from /overview) and HOUSE DISCIPLINE, whose
 * click opens the gate text the Promote form enforces (§9).
 */

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { unavailableOf, useOverview, useTechnicals } from "./data/api";
import type { DataStatus } from "./data/types";
import { droppedOf } from "./data/schema";
import { droppedWords, isAwaitingRefresh } from "./kit/ui";
import { DESK_GROUPS, GATES } from "./desk-sections";
import { dayShort, isFiniteNumber as fin, nyToday, pct, rowWords, toneOf } from "./kit/format";
import Contain from "./kit/Contain";

export const DESK_SIDEBAR_ID = "dk-sidebar";

export { nyToday };

/** "S&P today" only when the served session is today in New York; otherwise
 * the session's own day ("S&P Sep 22"), so a weekend never reads as today. */
export function spxDayLabel(asOf: string, today = nyToday()): string {
  return asOf === today ? "S&P today" : `S&P ${dayShort(asOf)}`;
}

/** The contributors that are not current, one per line: "DGS10 stale: <reason>". */
export function statusTitle(d: DataStatus): string {
  const rows = Array.isArray(d.contributors) ? d.contributors : [];
  // Codex R-16: a contributor the boundary could not read is said.
  return [...rows.filter((c) => c.state !== "current").map((c) => `${c.series} ${c.state}: ${c.reason}`), droppedWords(droppedOf(d, "contributors"), "series", "series")]
    .filter(Boolean)
    .join("\n");
}

function TodayCard() {
  const ov = useOverview();
  const tech = useTechnicals();
  const regime = ov.data?.tiles?.regime;
  // §1.0.2, §1.7: a block (or the whole answer) served awaiting reads "not yet served", or "awaiting
  // refresh" when its reason begins "Awaiting refresh" (a live block the server could not compute).
  const ovOff = unavailableOf(ov.error);
  const regimeOff = ovOff ?? ov.data?._blocks?.["tiles.regime"] ?? null;
  const statusOff = ovOff ?? ov.data?._blocks?.data_status ?? null;
  const techOff = unavailableOf(tech.error);
  const idle = (q: { isError: boolean; data: unknown }) => (q.isError ? "Awaiting" : "");
  return (
    <section className="dk-side-card" aria-label="Today" data-testid="dk-today">
      <p className="dk-eyebrow">Today</p>
      {regime ? (
        <>
          <p className="dk-today-regime" data-regime={regime.label}>
            {regime.label}
          </p>
          {/* §1.1: the K−2 row governing today ("Overheating · regime · July data"). */}
          <p className="dk-today-sub">{rowWords(regime.print) ? `regime · ${rowWords(regime.print)}` : "regime"}</p>
        </>
      ) : regimeOff ? (
        <p className="dk-today-sub" style={{ marginTop: 8 }}>
          {isAwaitingRefresh(regimeOff) ? "Regime awaiting refresh" : "Regime not yet served"}
        </p>
      ) : ov.isError || ov.data ? (
        <p className="dk-today-sub" style={{ marginTop: 8 }}>
          Regime awaiting refresh
        </p>
      ) : (
        <p className="dk-today-sub" style={{ marginTop: 8 }} aria-busy="true" />
      )}
      <p className="dk-today-kv">
        {/* §12.7: the change is dated by its own sessions, never by the answer's calculation date. */}
        <span>{tech.data ? spxDayLabel(tech.data.chg_1d_dates?.to ?? tech.data.date ?? tech.data.as_of) : "S&P today"}</span>
        {tech.data && fin(tech.data.chg_1d) ? (
          <span data-tone={toneOf(tech.data.chg_1d)}>{pct(tech.data.chg_1d)}</span>
        ) : techOff ? (
          <span>{isAwaitingRefresh(techOff) ? "Awaiting refresh" : "not yet served"}</span>
        ) : tech.data ? (
          <span>Awaiting refresh</span>
        ) : (
          <span>{idle(tech)}</span>
        )}
      </p>
      <p className="dk-today-kv">
        <span>Data</span>
        {ov.data?.data_status ? (
          <span
            data-tone={ov.data.data_status.state === "current" ? "up" : "amber"}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            // §12.1 (B-06): the worst contributor names the state; the tooltip lists any that are not current.
            title={statusTitle(ov.data.data_status) || undefined}
          >
            <span className="dk-dot" aria-hidden="true" />
            {ov.data.data_status.state}
          </span>
        ) : statusOff ? (
          <span>{isAwaitingRefresh(statusOff) ? "Awaiting refresh" : "not yet served"}</span>
        ) : (
          <span>{ov.data ? "Awaiting" : idle(ov)}</span>
        )}
      </p>
    </section>
  );
}

/** HOUSE DISCIPLINE ▸ / Gate ● on. The click opens the gate text. */
function HouseDiscipline() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <>
      <button type="button" ref={btn} className="dk-house" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-testid="dk-house">
        <span className="dk-eyebrow">House discipline {open ? "▾" : "▸"}</span>
        <span className="dk-today-kv">
          <span>Gate</span>
          <span className="dk-on" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="dk-dot" aria-hidden="true" />
            on
          </span>
        </span>
      </button>
      {open ? (
        <div className="dk-house-pop" id={id} ref={pop} role="dialog" aria-label="The discipline gate">
          <p>
            <b>The gate is on.</b> A position saves only after three short answers, and certainty words block until they are rewritten.
          </p>
          <ol>
            {GATES.map((g) => (
              <li key={g.id}>
                <b>{g.label}.</b> {g.prompt}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

export default function DeskSidebar({ activeSlug, pathTo, onNavigate }: { activeSlug: string; pathTo: (slug: string) => string; onNavigate?: () => void }) {
  return (
    <aside id={DESK_SIDEBAR_ID} className="dk-side" aria-label="Sidebar">
      <Link to="/app/dashboard" className="dk-back" title="Back to Macro Regime Radar">
        ← Macro Regime Radar
      </Link>
      <div className="dk-brand">
        <strong>Desk</strong>
        <span>Analyst workspace</span>
      </div>
      <nav className="dk-nav" aria-label="Primary">
        {DESK_GROUPS.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`dk-group-${g.id}`} className={g.small ? "dk-nav-small" : undefined} data-group={g.id}>
            <p id={`dk-group-${g.id}`} className="dk-nav-group">
              {g.label}
            </p>
            {g.small ? (
              // §14.5: one small line, "Data Pipeline · Build Notes".
              <p className="dk-nav-small-links">
                {g.pages.map((p, i) => (
                  <span key={p.slug}>
                    {i ? (
                      <span className="dk-nav-sep" aria-hidden="true">
                        {" · "}
                      </span>
                    ) : null}
                    <Link to={pathTo(p.slug)} aria-current={p.slug === activeSlug ? "page" : undefined} onClick={onNavigate}>
                      {p.label}
                    </Link>
                  </span>
                ))}
              </p>
            ) : (
              g.pages.map((p) => (
                <Link key={p.slug} to={pathTo(p.slug)} aria-current={p.slug === activeSlug ? "page" : undefined} onClick={onNavigate}>
                  {p.label}
                </Link>
              ))
            )}
          </div>
        ))}
      </nav>
      <div className="dk-side-foot">
        <Contain
          label="The TODAY card"
          fallback={
            <section className="dk-side-card" aria-label="Today" data-testid="dk-today">
              <p className="dk-eyebrow">Today</p>
              <p className="dk-today-sub" style={{ marginTop: 8 }}>
                Awaiting refresh
              </p>
            </section>
          }
        >
          <TodayCard />
        </Contain>
        <HouseDiscipline />
      </div>
    </aside>
  );
}
