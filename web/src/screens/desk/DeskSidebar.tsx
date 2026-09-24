/**
 * The Desk v2 sidebar (DESK_FRAME3_SPEC §1.1), the only navigation: the
 * `← MACRO REGIME RADAR` link back to the Radar, `Desk` over `ANALYST
 * WORKSPACE`, the three groups (SURVEY · ACT · TOOLS), and two stacked cards
 * at the foot: TODAY (the regime from /overview, the S&P's day from
 * /technicals, the data word from /overview) and HOUSE DISCIPLINE, whose
 * click opens the gate text the Promote form enforces (§9).
 */

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useOverview, useTechnicals } from "./data/api";
import { DESK_GROUPS, GATES } from "./desk-sections";
import { dayShort, nyToday, pct } from "./kit/format";

export const DESK_SIDEBAR_ID = "dk-sidebar";

export { nyToday };

/** "S&P today" only when the served session is today in New York; otherwise
 * the session's own day ("S&P Sep 22"), so a weekend never reads as today. */
export function spxDayLabel(asOf: string, today = nyToday()): string {
  return asOf === today ? "S&P today" : `S&P ${dayShort(asOf)}`;
}

function TodayCard() {
  const ov = useOverview();
  const tech = useTechnicals();
  const regime = ov.data?.tiles?.regime;
  const idle = (q: { isError: boolean; data: unknown }) => (q.isError ? "Awaiting" : "");
  return (
    <section className="dk-side-card" aria-label="Today" data-testid="dk-today">
      <p className="dk-eyebrow">Today</p>
      {regime ? (
        <>
          <p className="dk-today-regime" data-regime={regime.label}>
            {regime.label}
          </p>
          <p className="dk-today-sub">regime · {regime.print} print</p>
        </>
      ) : ov.isError || ov.data ? (
        <p className="dk-today-sub" style={{ marginTop: 8 }}>
          Regime awaiting refresh
        </p>
      ) : (
        <p className="dk-today-sub" style={{ marginTop: 8 }} aria-busy="true" />
      )}
      <p className="dk-today-kv">
        <span>{tech.data ? spxDayLabel(tech.data.as_of) : "S&P today"}</span>
        {tech.data ? <span data-tone={tech.data.chg_1d > 0 ? "up" : tech.data.chg_1d < 0 ? "down" : "flat"}>{pct(tech.data.chg_1d)}</span> : <span>{idle(tech)}</span>}
      </p>
      <p className="dk-today-kv">
        <span>Data</span>
        {ov.data?.data_status ? (
          <span data-tone={ov.data.data_status === "current" ? "up" : "amber"} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="dk-dot" aria-hidden="true" />
            {ov.data.data_status}
          </span>
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
          <div key={g.id} role="group" aria-labelledby={`dk-group-${g.id}`}>
            <p id={`dk-group-${g.id}`} className="dk-nav-group">
              {g.label}
            </p>
            {g.pages.map((p) => (
              <Link key={p.slug} to={pathTo(p.slug)} aria-current={p.slug === activeSlug ? "page" : undefined} onClick={onNavigate}>
                {p.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="dk-side-foot">
        <TodayCard />
        <HouseDiscipline />
      </div>
    </aside>
  );
}
