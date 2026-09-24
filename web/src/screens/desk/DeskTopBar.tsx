/**
 * The Desk v2 page header (DESK_FRAME3_SPEC §1.1): the breadcrumb
 * `Radar › Desk › <Tab>` on the left; on the right the Desk / Client toggle
 * (Desk by default; absent on Position Monitor and Data Pipeline) and at most
 * one action button, per tab: Walkthrough on Overview, `Act on this →
 * Position Monitor` on Technicals and Event Study, `Send to Position Monitor
 * →` on Basket & Hedge. Data Pipeline's header carries its refresh badge in
 * the toggle's place (its PNG). Below 900px a Menu button opens the sidebar,
 * which stays the only navigation.
 */

import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { DeskPage } from "./desk-sections";
import { withParam, type DeskView } from "./desk-view";
import { DESK_SIDEBAR_ID } from "./DeskSidebar";
import { TOUR_BUTTON_ID, TOUR_STRIP_ID } from "./tour/TourStrip";
import { parseTour, tourHref } from "./tour/tour";
import { askFromSearch, askParams } from "./event-study/question";

export function ViewToggle({ view, onChange, labels = ["Desk", "Client"] }: { view: DeskView; onChange: (v: DeskView) => void; labels?: [string, string] }) {
  return (
    <div className="dk-seg" role="group" aria-label="View" data-testid="dk-view-toggle">
      <button type="button" aria-pressed={view === "desk"} onClick={() => onChange("desk")}>
        {labels[0]}
      </button>
      <button type="button" aria-pressed={view === "client"} onClick={() => onChange("client")}>
        {labels[1]}
      </button>
    </div>
  );
}

function Action({ page, pathTo }: { page: DeskPage; pathTo: (slug: string) => string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const touring = parseTour(location.search) != null;
  // From Event Study the action carries the question on screen, preset or six
  // slots (§9: "Carried in from Event Study · any study can be carried in").
  const monitor = page.slug === "event-study" ? askParams(askFromSearch(location.search)).reduce((href, [k, v]) => withParam(href, k === "preset" ? "from" : k, v), pathTo("position-monitor")) : pathTo("position-monitor");
  if (page.action === "walkthrough")
    return (
      <button type="button" id={TOUR_BUTTON_ID} className="dk-btn" aria-controls={touring ? TOUR_STRIP_ID : undefined} onClick={() => navigate(tourHref(1))} data-testid="dk-walkthrough">
        Walkthrough
      </button>
    );
  if (page.action === "act")
    return (
      <Link className="dk-btn" data-kind="light" to={monitor} data-testid="dk-act">
        Act on this → Position Monitor
      </Link>
    );
  if (page.action === "send")
    return (
      <Link className="dk-btn" data-kind="light" to={pathTo("position-monitor")} data-testid="dk-act">
        Send to Position Monitor →
      </Link>
    );
  return null;
}

export default function DeskTopBar({
  page,
  view,
  onChangeView,
  pathTo,
  onMenu,
  menuOpen,
  right,
}: {
  page: DeskPage;
  view: DeskView;
  onChangeView: (v: DeskView) => void;
  pathTo: (slug: string) => string;
  onMenu: () => void;
  menuOpen: boolean;
  /** Replaces the toggle (Data Pipeline's refresh badge). */
  right?: ReactNode;
}) {
  return (
    <header className="dk-top">
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <button type="button" className="dk-btn dk-menu-btn" aria-controls={DESK_SIDEBAR_ID} aria-expanded={menuOpen} onClick={onMenu}>
          Menu
        </button>
        <nav aria-label="Breadcrumb" className="dk-crumb">
          <Link to="/app/dashboard">Radar</Link>
          <span className="dk-crumb-sep" aria-hidden="true">
            ›
          </span>
          <Link to={pathTo("overview")}>Desk</Link>
          <span className="dk-crumb-sep" aria-hidden="true">
            ›
          </span>
          <span aria-current="page">{page.label}</span>
        </nav>
      </div>
      <div className="dk-top-r">
        {right ?? (page.toggle === false ? null : <ViewToggle view={view} onChange={onChangeView} />)}
        <Action page={page} pathTo={pathTo} />
      </div>
    </header>
  );
}

/** The page title row: h1 (serif), the gray one-liner, and the page's badge right. */
export function PageTitle({ page, badge, title }: { page: DeskPage; badge?: ReactNode; title?: ReactNode }) {
  return (
    <div className="dk-title">
      <h1>{title ?? page.title ?? page.label}</h1>
      {page.blurb ? <p className="dk-title-sub">{page.blurb}</p> : null}
      {badge ? <div className="dk-title-badge">{badge}</div> : null}
    </div>
  );
}
