/**
 * The Desk shell (docs/desk/DESK_FRAME_SPEC.md §1, §2, §4): a top-level
 * section at /desk, titled "Desk", eyebrow "Analyst Workspace". The same grid
 * as the app shell (.mrr-app: sidebar beside a main column; MobileNav below
 * 860 px), with the Desk's own sidebar, top bar and pages. /desk lands on
 * Today; an unknown page does too. ?view=client is the client view and every
 * Desk link keeps it (desk-view.ts). Each page mounts inside its own
 * ErrorBoundary keyed by route, behind Suspense; document.title names the
 * page; navigation resets scroll unless the URL carries an anchor.
 */

import { Suspense, lazy, useEffect } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useBreakpoint } from "../../lib/useBreakpoint";
import ErrorBoundary from "../shared/ErrorBoundary";
import DeskMobileNav from "./DeskMobileNav";
import DeskSidebar from "./DeskSidebar";
import DeskTopBar from "./DeskTopBar";
import { DESK_HOME, deskPageBySlug } from "./desk-sections";
import { useDeskView, withView } from "./desk-view";
import "../../styles/desk.css";

const TodayPage = lazy(() => import("./today/TodayPage"));
const EventStudyPage = lazy(() => import("./event-study/EventStudyPage"));
const PositionMonitorPage = lazy(() => import("./positions/PositionMonitorPage"));
const DataPipelinePage = lazy(() => import("./pipeline/DataPipelinePage"));
const BuildNotesPage = lazy(() => import("./notes/BuildNotesPage"));
const DesignedShellPage = lazy(() => import("./shells/DesignedShellPage"));

function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: "24px 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
      Loading {label}…
    </div>
  );
}

export default function DeskShell() {
  const { page: slug } = useParams();
  const location = useLocation();
  const { shellCompact } = useBreakpoint();
  const { view, setView, pathTo } = useDeskView();
  const page = deskPageBySlug(slug);

  useEffect(() => {
    document.title = `${page?.label ?? "Desk"} · Desk · Macro Regime Radar`;
  }, [page?.label]);

  useEffect(() => {
    if (!location.hash && (window.scrollY > 0 || window.scrollX > 0)) window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.hash]);

  if (!page) return <Navigate to={withView(`/desk/${DESK_HOME}`, view)} replace />;

  let body;
  switch (page.slug) {
    case "today":
      body = <TodayPage page={page} />;
      break;
    case "event-study":
      body = <EventStudyPage page={page} />;
      break;
    case "position-monitor":
      body = <PositionMonitorPage page={page} />;
      break;
    case "data-pipeline":
      body = <DataPipelinePage page={page} />;
      break;
    case "build-notes":
      body = <BuildNotesPage page={page} />;
      break;
    default:
      body = <DesignedShellPage page={page} />;
  }

  return (
    <div className="mrr-app mrr-desk" data-view={view} data-testid="desk-shell">
      <a href="#main-content" className="mrr-skip">
        Skip to content
      </a>
      {shellCompact ? null : <DeskSidebar activeSlug={page.slug} pathTo={pathTo} />}
      <div className="mrr-main">
        {shellCompact ? <DeskMobileNav activeSlug={page.slug} pathTo={pathTo} /> : null}
        <DeskTopBar view={view} onChangeView={setView} />
        <main id="main-content" tabIndex={-1} style={{ outline: "none" }}>
          <ErrorBoundary key={page.slug} label="This Desk page">
            <Suspense fallback={<PageLoading label={page.label} />}>{body}</Suspense>
          </ErrorBoundary>
          <p className="mrr-desk-print-only">Automated briefing from Macro Regime Radar. Not investment advice.</p>
        </main>
      </div>
    </div>
  );
}
