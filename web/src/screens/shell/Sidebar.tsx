/**
 * Sidebar (redesign Phase 1, spec §2): the wordmark linking to the landing
 * page, the seven tabs with hand-drawn icons and aria-current on the active
 * route, Methodology as the smaller secondary item, a divider, the saved
 * watchlist (spec §3.1, built in ./watchlist) and a footer that states in
 * words whether market data is live, the newest stamp and the build version.
 *
 * The wordmark was the page's only <h1> in Phase 1 (checklist I.2); since
 * Phase 3 it is a <p> and the route's only h1 is the TabHero headline. The
 * source text is uppercase (no text-transform) so the parity harvester still
 * reads the link as "macro regime radar".
 *
 * Iteration 1: the watchlist takes the height between the nav and a pinned
 * footer and scrolls inside it (S1, app.css); a control beside the wordmark
 * collapses the sidebar to `SidebarRail` (S3; state in sidebar-state.ts,
 * Ctrl/⌘+\ in AppShell); and the footer's status line is a button that opens
 * the Data status drawer, the entry point on every route (S4).
 * Step 6 (A3): the footer's stamp and dot read the §5 words from
 * /api/freshness, never a stamp aged in the browser.
 *
 * fix/freshness 8: the strip's status card is gone; the footer reads
 * "● Data status", its dot the worst of the card's two lines
 * (shell-status.ts dataStatusTone), with the markets as-of under it.
 */

import type { MouseEvent, RefObject } from "react";
import { Link } from "react-router-dom";
import { useQuotes } from "../../live/quotes";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { MethodologyIcon, MountainMark, NavIcon } from "./nav-icons";
import Watchlist from "./watchlist/Watchlist";
import { dataStatusTone, etClock, marketsAsOfWords, marketsLineTone, newestTickMs, type ShellStatus } from "./shell-status";
import { sidebarShortcutLabel } from "./sidebar-state";

/** Injected by vite.config.ts `define` from package.json; guarded for any
 * runtime that does not carry the define (the version is cosmetic). */
const VERSION: string = typeof __MRR_VERSION__ === "string" ? __MRR_VERSION__ : "0.0.0";

/** The id both toggle buttons name in aria-controls. */
export const SIDEBAR_ID = "mrr-sidebar";

/** Mountain mark over "MACRO / REGIME RADAR", linking to the landing page.
 * `compact` is the one-line variant MobileNav renders below 860 px. The Desk
 * shell (desk/frame §1) points it at the dashboard instead through `to`. */
export function Wordmark({ compact = false, to = "/", title = "Macro Regime Radar · landing page" }: { compact?: boolean; to?: string; title?: string }) {
  return (
    <Link to={to} className={compact ? "mrr-logo mrr-logo-compact" : "mrr-logo"} title={title}>
      <MountainMark {...(compact ? { width: 30, height: 16 } : {})} />
      <p>
        <span>MACRO</span>
        <span>REGIME RADAR</span>
      </p>
    </Link>
  );
}

/** Hand-drawn panel glyph: the frame, the sidebar edge, and a chevron that
 * points the way the sidebar will move. */
function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M5.5 2.5v11" />
      <path d={collapsed ? "M8.75 6l2 2-2 2" : "M10.75 6l-2 2 2 2"} />
    </svg>
  );
}

/** The collapse control. The same data-testid in the sidebar and the rail, so
 * the button a visitor pressed is found again after the swap. */
export function SidebarToggle({
  collapsed,
  onToggle,
  toggleRef,
}: {
  collapsed: boolean;
  onToggle: () => void;
  toggleRef?: RefObject<HTMLButtonElement>;
}) {
  const label = collapsed ? "Show navigation" : "Hide navigation";
  return (
    <button
      ref={toggleRef}
      type="button"
      data-testid="sidebar-toggle"
      className="mrr-side-toggle"
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls={SIDEBAR_ID}
      title={`${label} · ${sidebarShortcutLabel()}`}
      onClick={onToggle}
    >
      <PanelIcon collapsed={collapsed} />
    </button>
  );
}

/** The line under "Data status" (fix/freshness 8): the markets as-of the
 * strip's status card showed ("Markets · Close · Sep 30"), with the newest
 * tick's ET clock only while live_quotes reads live. Its own component so the
 * 2 Hz quote store repaints only this leaf. A span: it sits in a button. */
function MarketsAsOf({ status }: { status: ShellStatus }) {
  const quotes = useQuotes();
  const l = status.seededLabel ?? status.marketLabel;
  const tick = status.f && !status.seededLabel && l.tone === "live" ? newestTickMs(quotes) : null;
  return (
    <span
      className="mrr-side-stamp"
      data-tone={l.tone}
      data-stale={l.stale ? "true" : undefined}
      data-behind={marketsLineTone(status) === "behind" ? "true" : undefined}
    >
      {marketsAsOfWords(status)}
      {tick != null ? ` · ${etClock(tick)}` : null}
    </span>
  );
}

/**
 * The "Data status" dot (fix/freshness 8): the worst of the strip card's two
 * lines (markets, the macro monthly inputs); only a live feed glows; a
 * snapshot has no health dot, the rail keeping a neutral mark so its button
 * is never empty.
 */
export function StatusDot({ status }: { status: ShellStatus }) {
  const tone = dataStatusTone(status);
  if (tone === "snapshot") return <span className="mrr-side-snapmark" aria-hidden="true">◇</span>;
  return (
    <span
      className={tone === "live" && !status.seeded ? "mrr-dot mrr-live-dot" : "mrr-dot"}
      data-tone={tone}
      aria-hidden="true"
    />
  );
}

interface FreshnessEntryProps {
  status: ShellStatus;
  open: boolean;
  onOpen: () => void;
}

/** Focus the button before opening, so the drawer's focus return lands on it
 * even where a click does not focus a button (Safari). */
function openFrom(e: MouseEvent<HTMLButtonElement>, onOpen: () => void) {
  e.currentTarget.focus();
  onOpen();
}

/** The footer's "● Data status" line and the markets as-of as one button
 * (S4; fix/freshness 8): the Data status drawer is reachable from every
 * route. */
function SidebarFreshness({ status, open, onOpen }: FreshnessEntryProps) {
  return (
    <button
      type="button"
      data-testid="sidebar-freshness"
      className="mrr-side-fresh"
      onClick={(e) => openFrom(e, onOpen)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="freshness-drawer"
      title="Data status: each feed, the regime month and the NYSE session"
    >
      <span className="mrr-side-status">
        <StatusDot status={status} />
        Data status
      </span>
      <MarketsAsOf status={status} />
    </button>
  );
}

interface SidebarProps {
  activeSlug: string;
  status: ShellStatus;
  onToggle: () => void;
  toggleRef?: RefObject<HTMLButtonElement>;
  freshnessOpen: boolean;
  onOpenFreshness: () => void;
}

export default function Sidebar({ activeSlug, status, onToggle, toggleRef, freshnessOpen, onOpenFreshness }: SidebarProps) {
  const isMethodology = activeSlug === METHODOLOGY_SLUG;
  return (
    <aside id={SIDEBAR_ID} className="mrr-side" aria-label="Sidebar">
      <div className="mrr-side-head">
        <Wordmark />
        <SidebarToggle collapsed={false} onToggle={onToggle} toggleRef={toggleRef} />
      </div>
      <nav className="mrr-nav" aria-label="Primary">
        {TABS.map((t) => (
          <Link key={t.slug} to={`/app/${t.slug}`} aria-current={t.slug === activeSlug ? "page" : undefined}>
            <NavIcon slug={t.slug} />
            <span>{t.label}</span>
          </Link>
        ))}
        <Link
          to={`/app/${METHODOLOGY_SLUG}`}
          className="mrr-nav-sub"
          aria-current={isMethodology ? "page" : undefined}
          title="How the model, signals and data work"
        >
          <MethodologyIcon />
          <span>Methodology</span>
        </Link>
      </nav>
      <hr className="mrr-side-hr" />
      {/* The Watchlist root carries id="sidebar-watchlist" itself (never
          "watchlist": that id belongs to the Markets tape in sections.ts). */}
      <div className="mrr-side-wl">
        <Watchlist />
      </div>
      <div className="mrr-side-foot">
        <SidebarFreshness status={status} open={freshnessOpen} onOpen={onOpenFreshness} />
        <div className="ver">v{VERSION}</div>
      </div>
    </aside>
  );
}

/** The collapsed sidebar (S3): a 56px rail with the toggle on top and the
 * Data status entry, reduced to its dot, at the bottom. */
export function SidebarRail({
  status,
  onToggle,
  toggleRef,
  freshnessOpen,
  onOpenFreshness,
}: Omit<SidebarProps, "activeSlug">) {
  return (
    <aside className="mrr-rail" data-testid="sidebar-rail" aria-label="Navigation rail">
      <SidebarToggle collapsed onToggle={onToggle} toggleRef={toggleRef} />
      <button
        type="button"
        data-testid="sidebar-freshness"
        className="mrr-rail-fresh"
        onClick={(e) => openFrom(e, onOpenFreshness)}
        aria-haspopup="dialog"
        aria-expanded={freshnessOpen}
        aria-controls="freshness-drawer"
        aria-label={`Data status: ${marketsAsOfWords(status)}`}
        title={`Data status: ${marketsAsOfWords(status)}`}
      >
        <StatusDot status={status} />
      </button>
    </aside>
  );
}
