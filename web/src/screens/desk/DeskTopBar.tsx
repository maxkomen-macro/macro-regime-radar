/**
 * The Desk v2 page header (DESK_FRAME3_SPEC §1.1): the breadcrumb
 * `Radar › Desk › <Tab>` on the left; on the right the Desk / Client toggle
 * (Desk by default; absent on Position Monitor and Data Pipeline) and at most
 * one action button, per tab: Walkthrough on Overview, `Act on this →
 * Position Monitor` on Technicals and Event Study, `Send to Position Monitor
 * →` on Basket & Hedge. Data Pipeline's header carries its refresh badge in
 * the toggle's place (its PNG). Below 900px a Menu button opens the sidebar,
 * which stays the only navigation.
 *
 * desk/usability item 1: between the breadcrumb and the toggle, the stock
 * search (InstrumentSearch) on every page; a pick opens Technicals for that
 * stock, the S&P 500 itself on the page's default.
 */

import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { DeskPage } from "./desk-sections";
import { withParam, type DeskView } from "./desk-view";
import { DESK_SIDEBAR_ID } from "./DeskSidebar";
import { TOUR_BUTTON_ID, TOUR_STRIP_ID } from "./tour/TourStrip";
import { parseTour, tourHref } from "./tour/tour";
import { askFromSearch, askParams } from "./event-study/question";
import { useMixedGenerations } from "./data/generations";
import { InstrumentSearch } from "./kit/InstrumentSearch";
import { symbolOf } from "./technicals/symbol";

/** Technicals for a picked stock (item 2: `?symbol=`); the S&P 500 is the page's default, so it takes none. */
export function technicalsHref(pathTo: (slug: string) => string, symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  return sym === "^GSPC" || sym === "GSPC" || sym === "SPX" || !sym ? pathTo("technicals") : withParam(pathTo("technicals"), "symbol", sym);
}

/** The header's stock search: a pick opens Technicals for it. */
function HeaderSearch({ pathTo }: { pathTo: (slug: string) => string }) {
  const navigate = useNavigate();
  return (
    <div className="dk-top-search" role="search" aria-label="Stocks">
      <InstrumentSearch dense ariaLabel="Search a stock" onSelect={(hit) => navigate(technicalsHref(pathTo, hit.symbol))} />
    </div>
  );
}

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
  // desk/usability §14.4: the Position Monitor opens on the saved positions; its action opens the form.
  if (page.slug === "position-monitor") {
    const q = new URLSearchParams(location.search);
    const open = q.get("new") === "1" || ["from", "basket", "instrument", "shock"].some((k) => q.get(k));
    return open ? null : (
      <Link className="dk-btn" data-kind="light" to={withParam(pathTo("position-monitor"), "new", "1")} data-testid="dk-act">
        + New position
      </Link>
    );
  }
  // desk/usability §14.2: Technicals opens the instrument on screen as a position (the S&P 500 by default).
  if (page.slug === "technicals") {
    const sym = symbolOf(location.search);
    return (
      <Link className="dk-btn" data-kind="light" to={withParam(withParam(pathTo("position-monitor"), "new", "1"), "instrument", sym ?? "S&P 500")} data-testid="dk-act">
        Open as position →
      </Link>
    );
  }
  if (page.action === "act")
    return (
      <Link className="dk-btn" data-kind="light" to={monitor} data-testid="dk-act">
        Act on this → Position Monitor
      </Link>
    );
  // §10: a basket kept in this browser is the subject sent; the page writes the open one in the address.
  const basket = new URLSearchParams(location.search).get("basket");
  if (page.action === "send")
    return (
      <Link className="dk-btn" data-kind="light" to={basket ? withParam(pathTo("position-monitor"), "basket", basket) : pathTo("position-monitor")} data-testid="dk-act">
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
      <HeaderSearch pathTo={pathTo} />
      <div className="dk-top-r">
        {right ?? (page.toggle === false ? null : <ViewToggle view={view} onChange={onChangeView} />)}
        {/* In the client view the tab's own action gives way to the one-pager (§11, the PNG). */}
        {view === "client" && page.toggle !== false ? (
          <button type="button" className="dk-btn" data-strong data-print-hide onClick={() => window.print()}>
            Export one-pager (PDF)
          </button>
        ) : (
          <Action page={page} pathTo={pathTo} />
        )}
      </div>
    </header>
  );
}

/** The page title row: h1 (serif), the gray one-liner, and the page's badge right. */
export function PageTitle({ page, badge, title }: { page: DeskPage; badge?: ReactNode; title?: ReactNode }) {
  // §1.1 (Codex R-22): answers from two generations on one page: the badge says so while the page refetches.
  // Data Pipeline's page badge is its header badge (§11), which says it there.
  const mixed = useMixedGenerations() && page.slug !== "data-pipeline";
  const shown = mixed ? (
    <span className="dk-live dk-live-off dk-live-boxed" data-testid="dk-gen-mixed">
      <span className="dk-dot dk-dot-off" aria-hidden="true" />
      mixed generations · refreshing
    </span>
  ) : (
    badge
  );
  return (
    <div className="dk-title">
      <h1>{title ?? page.title ?? page.label}</h1>
      {page.blurb ? <p className="dk-title-sub">{page.blurb}</p> : null}
      {shown ? <div className="dk-title-badge">{shown}</div> : null}
    </div>
  );
}
