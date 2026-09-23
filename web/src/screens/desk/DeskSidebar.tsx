/**
 * The Desk sidebar (docs/desk/DESK_FRAME_SPEC.md §2): the wordmark linking
 * back to the dashboard (§1), the "Analyst Workspace · Desk" title, three
 * groups in the spec's order (SURVEY, ACT, TOOLS) as 36px link rows, and the
 * House Discipline card pinned at the foot. The same `.mrr-side` column as
 * the app shell; the groups, the marks and the card are the Desk's own
 * classes in desk.css. A designed shell carries a ◇ in its right gutter and
 * the external Dashboard entry an arrow, so the list states which pages are
 * wired without a legend.
 */

import { Link } from "react-router-dom";
import { Wordmark } from "../shell/Sidebar";
import { DESK_GROUPS, GATES, HOUSE_DISCIPLINE, type DeskPage } from "./desk-sections";
import { Seals } from "./Seals";

const VERSION: string = typeof __MRR_VERSION__ === "string" ? __MRR_VERSION__ : "0.0.0";

export const DESK_SIDEBAR_ID = "mrr-desk-sidebar";

export function DeskTitle() {
  return (
    <div className="mrr-desk-title">
      <p className="mrr-desk-eyebrow">Analyst Workspace</p>
      <strong>Desk</strong>
    </div>
  );
}

/** The mark in a row's right gutter: what the row is, in one glyph. */
export function NavMark({ page }: { page: DeskPage }) {
  if (page.href) {
    return (
      <span className="mrr-desk-nav-mark" aria-hidden="true">
        →
      </span>
    );
  }
  if (page.status === "designed") {
    return (
      <span className="mrr-desk-nav-mark" title="Designed shell: real layout, no data source yet" aria-label="designed shell">
        ◇
      </span>
    );
  }
  return null;
}

/** The footer card: "House Discipline · Enforced", the seals, the four rules. */
export function HouseDiscipline({ version = VERSION }: { version?: string }) {
  return (
    <div className="mrr-desk-house" data-testid="desk-house">
      <p className="mrr-desk-house-title">
        <span>
          House Discipline <span aria-hidden="true">·</span> <b>Enforced</b>
        </span>
        <Seals states={GATES.map(() => "met")} label="Every position passes three gates: variant view, pre-mortem, falsification." />
      </p>
      <ul>
        {HOUSE_DISCIPLINE.map((rule) => (
          <li key={rule}>
            <span aria-hidden="true">▸</span>
            <span>{rule}</span>
          </li>
        ))}
      </ul>
      <div className="ver">v{version}</div>
    </div>
  );
}

export default function DeskSidebar({ activeSlug, pathTo }: { activeSlug: string; pathTo: (slug: string) => string }) {
  return (
    <aside id={DESK_SIDEBAR_ID} className="mrr-side" aria-label="Sidebar">
      <div className="mrr-desk-side-head">
        <Wordmark to="/app/dashboard" title="Macro Regime Radar · back to the dashboard" />
        <DeskTitle />
      </div>
      <nav className="mrr-desk-nav" aria-label="Primary">
        {DESK_GROUPS.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`desk-group-${g.id}`} style={{ display: "contents" }}>
            <p id={`desk-group-${g.id}`} className="mrr-desk-group mrr-desk-eyebrow" data-size="sm">
              {g.label}
            </p>
            {g.pages.map((p) =>
              p.href ? (
                <Link key={p.slug} to={p.href} title="Back to the main terminal">
                  <span>{p.label}</span>
                  <NavMark page={p} />
                </Link>
              ) : (
                <Link key={p.slug} to={pathTo(p.slug)} aria-current={p.slug === activeSlug ? "page" : undefined}>
                  <span>{p.label}</span>
                  <NavMark page={p} />
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>
      <HouseDiscipline />
    </aside>
  );
}
