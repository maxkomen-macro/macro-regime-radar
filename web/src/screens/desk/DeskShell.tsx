/**
 * The Desk v2 shell (docs/desk/DESK_FRAME3_SPEC.md §1): the sidebar (the only
 * navigation) beside the page, the header with the breadcrumb, the Desk /
 * Client toggle and the tab's one action, and the tab itself. /desk lands on
 * Overview; an unknown page does too; an old frame-1/frame-2 slug redirects
 * to the tab that replaced it with its query kept. ?view=client is carried
 * by every Desk link (desk-view.ts). Each tab mounts inside its own
 * ErrorBoundary keyed by route, behind Suspense; document.title names the
 * tab; navigation resets scroll unless the URL carries an anchor.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import ErrorBoundary from "../shared/ErrorBoundary";
import DeskSidebar from "./DeskSidebar";
import DeskTopBar, { PageTitle } from "./DeskTopBar";
import { DESK_ALIASES, DESK_HOME, deskPageBySlug, type DeskPage } from "./desk-sections";
import { useDeskView, withView } from "./desk-view";
import TourStrip from "./tour/TourStrip";
import { parseTour } from "./tour/tour";
import "../../styles/desk.css";
import "../../styles/desk2.css";

const OverviewPage = lazy(() => import("./overview/OverviewPage"));
const TechnicalsPage = lazy(() => import("./technicals/TechnicalsPage"));
const EventStudyPage = lazy(() => import("./event-study/EventStudyPage"));
const RegimePage = lazy(() => import("./regime/RegimePage"));

function PageLoading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="dk-await">
      Loading {label}…
    </p>
  );
}

/** A tab frame-3 has not built yet: its title row and one line, nothing else. */
function NotBuilt({ page }: { page: DeskPage }) {
  return (
    <>
      <PageTitle page={page} />
      <p className="dk-await" role="status">
        This tab is being rebuilt for Desk v2.
      </p>
    </>
  );
}

function ClientPending({ page }: { page: DeskPage }) {
  return (
    <>
      <PageTitle page={page} />
      <p className="dk-await" role="status">
        The client view is being rebuilt for Desk v2. Switch back to Desk to read this tab.
      </p>
    </>
  );
}

export default function DeskShell() {
  const { page: slug } = useParams();
  const location = useLocation();
  const { view, setView, pathTo } = useDeskView();
  const [menu, setMenu] = useState(false);
  const page = deskPageBySlug(slug);
  const tour = parseTour(location.search);

  useEffect(() => {
    document.title = `${page?.label ?? "Desk"} · Desk · Macro Regime Radar`;
  }, [page?.label]);

  useEffect(() => {
    if (!location.hash && (window.scrollY > 0 || window.scrollX > 0)) window.scrollTo({ top: 0, left: 0 });
    setMenu(false);
  }, [location.pathname, location.hash]);

  const alias = slug ? DESK_ALIASES[slug] : undefined;
  if (alias) return <Navigate to={{ pathname: `/desk/${alias}`, search: location.search, hash: location.hash }} replace />;
  if (!page) return <Navigate to={withView(`/desk/${DESK_HOME}`, view)} replace />;

  const client = view === "client" && page.toggle !== false;
  let body;
  if (client) body = <ClientPending page={page} />;
  else if (page.slug === "overview") body = <OverviewPage page={page} />;
  else if (page.slug === "technicals") body = <TechnicalsPage page={page} />;
  else if (page.slug === "event-study") body = <EventStudyPage page={page} />;
  else if (page.slug === "regime") body = <RegimePage page={page} />;
  else body = <NotBuilt page={page} />;

  return (
    <div className="dk" data-view={view} data-menu={menu ? "open" : undefined} data-tour={tour ?? undefined} data-testid="desk-shell">
      <a href="#main-content" className="mrr-skip">
        Skip to content
      </a>
      <DeskSidebar activeSlug={page.slug} pathTo={pathTo} onNavigate={() => setMenu(false)} />
      <div className="dk-main">
        <DeskTopBar page={page} view={view} onChangeView={setView} pathTo={pathTo} onMenu={() => setMenu((m) => !m)} menuOpen={menu} />
        <main id="main-content" className="dk-page" tabIndex={-1} style={{ outline: "none" }} data-slug={page.slug}>
          <ErrorBoundary key={page.slug} label="This Desk tab">
            <Suspense fallback={<PageLoading label={page.label} />}>{body}</Suspense>
          </ErrorBoundary>
        </main>
        {tour ? <TourStrip step={tour} /> : null}
      </div>
    </div>
  );
}
