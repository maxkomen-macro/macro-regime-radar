/**
 * The app shell (redesign Phase 1, spec §2): a 196 px sidebar (wordmark,
 * seven tabs with aria-current, Methodology, the saved watchlist, a footer
 * that says in words whether market data is live) beside a main column that
 * holds the top bar (⌘K palette trigger, "Ask the analyst", the alerts
 * bell), the ticker strip with its freshness card, and
 * the routed screen. Below 860 px the sidebar gives way to MobileNav.
 *
 * Every behaviour of the 2026-09-05 shell survives the rebuild: Cmd+K /
 * Ctrl+K toggles the palette; top-level navigation resets scroll unless the
 * URL carries an anchor; document.title names the screen; the assistant is
 * told what the visitor is looking at; each screen mounts inside its own
 * ErrorBoundary keyed by route, behind Suspense; the page behind an open
 * overlay is inert (#shell-content); #main-content is the skip-link target;
 * the alert drawer, the palette, the assistant panel and the new freshness
 * drawer all mount here. The status vocabulary (Live / Delayed /
 * Reconnecting / Backend unavailable / Validated snapshot) is composed once
 * in shell-status.ts and shared by the strip card, the drawer and the footer.
 *
 * Iteration 1: at 860 px and up the sidebar collapses to a 56 px rail (S3):
 * the toggle beside the wordmark, Ctrl+\ or ⌘+\ (wired beside ⌘K below) and
 * a palette action all flip one stored preference (sidebar-state.ts), and
 * focus follows to the new toggle. The strip is not rendered on Recession
 * and Methodology (S4); the sidebar's freshness entry (the rail's, and the
 * MobileNav list's below 860) opens the same drawer on every route.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useFreshness, useRegimeLatest } from "../../api/queries";
import { useSnapshotMeta } from "../../api/snapshot";
import { useLiveFeeds, useStreamLive, useStreamStatus, useStreamWord } from "../../live/quotes";
import { useBreakpoint } from "../../lib/useBreakpoint";
import ErrorBoundary from "../shared/ErrorBoundary";
import { SHELL_CONTENT_ID } from "../shared/useModal";
import AlertDrawer from "./AlertDrawer";
import AssistantPanel, { type AssistantTabContext } from "./AssistantPanel";
import CommandPalette from "./CommandPalette";
import FreshnessDrawer from "./FreshnessDrawer";
import MobileNav from "./MobileNav";
import Sidebar, { SidebarRail } from "./Sidebar";
import TickerLive from "./TickerLive";
import TopBar from "./TopBar";
import { ShellActionsContext, type ShellActions } from "./shell-actions";
import { METHODOLOGY_SLUG, tabBySlug, type PaletteAction } from "./sections";
import { composeShellStatus, regimeProbs, STATUS_COLOR } from "./shell-status";
import { isEditableTarget, isSidebarShortcut, sidebarShortcutLabel, useSidebarCollapsed } from "./sidebar-state";

/** Reference routes without the ticker strip (S4): the sidebar's freshness
 * entry is their way into the drawer. */
const NO_STRIP_SLUGS: ReadonlySet<string> = new Set(["recession", METHODOLOGY_SLUG]);

// Route-level code splitting (2026-09-06): each screen is its own chunk, so
// the shell paints first and a screen's libraries load only when it opens.
const DashboardScreen = lazy(() => import("../dashboard/DashboardScreen"));
const MarketsScreen = lazy(() => import("../markets/MarketsScreen"));
const RegimeLabScreen = lazy(() => import("../regimelab/RegimeLabScreen"));
const CreditScreen = lazy(() => import("../credit/CreditScreen"));
const RecessionScreen = lazy(() => import("../recession/RecessionScreen"));
const NewsScreen = lazy(() => import("../news/NewsScreen"));
const ToolsScreen = lazy(() => import("../tools/ToolsScreen"));
const MethodologyScreen = lazy(() => import("../methodology/MethodologyScreen"));

function ScreenLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: "24px 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: STATUS_COLOR.text3 }}>
      Loading {label}…
    </div>
  );
}

export default function AppShell() {
  const { tab: slug } = useParams();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [freshnessOpen, setFreshnessOpen] = useState(false);
  const assistantLauncherRef = useRef<HTMLButtonElement>(null);

  const { shellCompact } = useBreakpoint();
  const regime = useRegimeLatest();
  const freshness = useFreshness();

  // Collapsible sidebar (S3). Every toggle hands focus to the toggle that
  // replaces the one just used (sidebar ↔ rail), once the swap has rendered.
  const [sidebarCollapsed, toggleSidebarState] = useSidebarCollapsed();
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const focusToggleNext = useRef(false);
  const toggleSidebar = useCallback(() => {
    focusToggleNext.current = true;
    toggleSidebarState();
  }, [toggleSidebarState]);
  useEffect(() => {
    if (!focusToggleNext.current) return;
    focusToggleNext.current = false;
    sidebarToggleRef.current?.focus();
  }, [sidebarCollapsed]);
  const shellCompactRef = useRef(shellCompact);
  shellCompactRef.current = shellCompact;

  // Cmd+K / Ctrl+K; Cmd+\ / Ctrl+\ toggles the sidebar at desk width, never
  // while the visitor is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (isSidebarShortcut(e)) {
        if (shellCompactRef.current || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  // Top-level navigation starts at the top of the new screen; an explicit
  // anchor (#section) is honoured by the screens' own hash-scroll effect.
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.hash]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closeFreshness = useCallback(() => setFreshnessOpen(false), []);
  const openFreshness = useCallback(() => setFreshnessOpen(true), []);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    assistantLauncherRef.current?.focus();
  }, []);
  const toggleAssistant = useCallback(() => {
    if (assistantOpen) closeAssistant();
    else setAssistantOpen(true);
  }, [assistantOpen, closeAssistant]);

  // The overlay openers a screen reaches through useShellActions() (Phase 3:
  // the Dashboard's status strip opens the alert drawer). One memoised value,
  // so a quote tick repainting the shell does not re-render every consumer.
  const shellActions = useMemo<ShellActions>(
    () => ({ openAlerts: openDrawer, openFreshness, openPalette, openAssistant: () => setAssistantOpen(true) }),
    [openDrawer, openFreshness, openPalette],
  );

  const tab = tabBySlug(slug);
  const isMethodology = slug === METHODOLOGY_SLUG;
  const activeSlug = isMethodology ? METHODOLOGY_SLUG : (tab?.slug ?? "dashboard");
  const showStrip = !NO_STRIP_SLUGS.has(activeSlug);

  // The palette's one action entry (S3), desk width only.
  const paletteActions = useMemo<PaletteAction[]>(
    () =>
      shellCompact
        ? []
        : [
            {
              kind: "action",
              id: "toggle-sidebar",
              label: sidebarCollapsed ? "Show navigation" : "Hide navigation",
              hint: sidebarShortcutLabel(),
              run: toggleSidebar,
            },
          ],
    [shellCompact, sidebarCollapsed, toggleSidebar],
  );

  // The footer dot pulses only when data is genuinely live: the EODHD stream
  // first (ticks under two minutes old), else a fresh DB intraday write.
  // Pretending month-old data is live is the app's documented worst habit.
  const streamLive = useStreamLive();
  const streamWord = useStreamWord();
  const liveFeeds = useLiveFeeds();
  const stream = useStreamStatus();
  const snapshot = useSnapshotMeta();

  // Tabs, history and screen readers get the screen's name (review P3-8).
  useEffect(() => {
    const label = isMethodology ? "Methodology" : (tab?.label ?? "Dashboard");
    document.title = `${label} · Macro Regime Radar`;
  }, [isMethodology, tab?.label]);

  // One status composition for the strip card, the freshness drawer and the
  // sidebar footer, so the three never disagree.
  const f = freshness.data;
  const status = useMemo(
    () =>
      composeShellStatus({
        freshness: f,
        freshnessError: freshness.isError,
        freshnessLoading: freshness.isLoading,
        regimeError: regime.isError,
        streamWord,
        streamLive,
        liveFeeds,
        degraded: stream.degraded,
        degradedReasons: stream.degradedReasons,
        snapshot,
      }),
    [f, freshness.isError, freshness.isLoading, regime.isError, streamWord, streamLive, liveFeeds, stream.degraded, stream.degradedReasons, snapshot],
  );

  // The assistant context carries the model's stored dominant probability
  // (one number, one truth), never the separate `confidence` heuristic. The
  // regime query itself stays here for the shell's status word and this
  // context; its top-bar pill left in Phase 10 (checklist 10 B.8).
  const { dominantProb } = regimeProbs(regime.data);

  // What the assistant is told the visitor is looking at: the route, the
  // section list from the nav registry, and the shell's own headline numbers,
  // so "explain this screen" is grounded in what is actually on screen.
  const tabContext = useMemo<AssistantTabContext>(() => {
    const base = isMethodology
      ? { tab: METHODOLOGY_SLUG, label: "Methodology", sections: [] as string[], kind: "reference" as const }
      : {
          tab: tab?.slug ?? "dashboard",
          label: tab?.label ?? "Dashboard",
          sections: (tab?.sections ?? []).map((s) => s.label),
          kind: "live" as const,
        };
    return {
      ...base,
      route: `${location.pathname}${location.hash}`,
      active_section: location.hash ? location.hash.slice(1) : null,
      as_of: {
        macro: f?.regimes_date ?? null,
        signals: f?.signals_date ?? null,
        market_daily: f?.market_daily_date ?? null,
        market_intraday: f?.market_intraday_ts ?? null,
      },
      key_metrics: (regime.data
        ? {
            regime: regime.data.label,
            dominant_probability: dominantProb ?? null,
            confidence: regime.data.confidence,
            regime_date: regime.data.date,
          }
        : {}) as Record<string, string | number | null>,
    };
  }, [isMethodology, tab, location.pathname, location.hash, f, regime.data, dominantProb]);

  if (!tab && !isMethodology) return <Navigate to="/app/dashboard" replace />;

  return (
    <div className="mrr-app" data-sidebar={shellCompact ? undefined : sidebarCollapsed ? "collapsed" : "expanded"}>
      <ShellActionsContext.Provider value={shellActions}>
        <a href="#main-content" className="mrr-skip">
          Skip to content
        </a>
        {/* The inert wrapper (useModal) spans the sidebar, the main column and the
            assistant panel; `display: contents` keeps aside and main as direct
            grid items. The three modal overlays sit outside it. */}
        <div id={SHELL_CONTENT_ID} className="mrr-app-content">
          {shellCompact ? null : sidebarCollapsed ? (
            <SidebarRail
              status={status}
              onToggle={toggleSidebar}
              toggleRef={sidebarToggleRef}
              freshnessOpen={freshnessOpen}
              onOpenFreshness={openFreshness}
            />
          ) : (
            <Sidebar
              activeSlug={activeSlug}
              status={status}
              onToggle={toggleSidebar}
              toggleRef={sidebarToggleRef}
              freshnessOpen={freshnessOpen}
              onOpenFreshness={openFreshness}
            />
          )}
          <div className="mrr-main">
            {shellCompact ? (
              <MobileNav
                activeSlug={activeSlug}
                onOpenPalette={openPalette}
                status={status}
                freshnessOpen={freshnessOpen}
                onOpenFreshness={openFreshness}
              />
            ) : null}
            <TopBar
              paletteOpen={paletteOpen}
              onOpenPalette={openPalette}
              assistantOpen={assistantOpen}
              onToggleAssistant={toggleAssistant}
              assistantLauncherRef={assistantLauncherRef}
              drawerOpen={drawerOpen}
              onOpenDrawer={openDrawer}
            />
            {showStrip ? <TickerLive status={status} freshnessOpen={freshnessOpen} onOpenFreshness={openFreshness} /> : null}

            <main id="main-content" tabIndex={-1} style={{ outline: "none" }}>
              {/* The key is load-bearing: it re-mounts the boundary on every tab
                  change, so a tab that crashed once is retried when the visitor
                  navigates away and back rather than staying stuck on the note. */}
              <ErrorBoundary key={activeSlug} label="This tab">
                <Suspense fallback={<ScreenLoading label={isMethodology ? "Methodology" : (tab?.label ?? "the screen")} />}>
                  {isMethodology ? (
                    <MethodologyScreen />
                  ) : tab?.slug === "dashboard" ? (
                    <DashboardScreen />
                  ) : tab?.slug === "markets" ? (
                    <MarketsScreen />
                  ) : tab?.slug === "regime-lab" ? (
                    <RegimeLabScreen />
                  ) : tab?.slug === "credit" ? (
                    <CreditScreen />
                  ) : tab?.slug === "recession" ? (
                    <RecessionScreen />
                  ) : tab?.slug === "news" ? (
                    <NewsScreen />
                  ) : tab?.slug === "tools" ? (
                    <ToolsScreen />
                  ) : null}
                </Suspense>
              </ErrorBoundary>
            </main>
          </div>

          {/* Floating analyst panel: app shell only; the landing page stays quiet.
              It sits inside the inert wrapper so an open drawer or palette covers it. */}
          <ErrorBoundary label="The AI analyst panel">
            <AssistantPanel open={assistantOpen} onClose={closeAssistant} tabContext={tabContext} />
          </ErrorBoundary>
        </div>

        <AlertDrawer open={drawerOpen} onClose={closeDrawer} />
        <CommandPalette open={paletteOpen} onClose={closePalette} actions={paletteActions} />
        <FreshnessDrawer open={freshnessOpen} onClose={closeFreshness} status={status} />
      </ShellActionsContext.Provider>
    </div>
  );
}
