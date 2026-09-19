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
 * the freshness drawer, the entry point on the routes without the strip (S4).
 */

import type { MouseEvent, RefObject } from "react";
import { Link } from "react-router-dom";
import { useQuotes } from "../../live/quotes";
import { freshLabel, seriesById } from "../shared/fresh-state";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { MethodologyIcon, MountainMark, NavIcon } from "./nav-icons";
import Watchlist from "./watchlist/Watchlist";
import { footerWords, marketStampLines, newestTickMs, type ShellStatus } from "./shell-status";
import { sidebarShortcutLabel } from "./sidebar-state";

/** Injected by vite.config.ts `define` from package.json; guarded for any
 * runtime that does not carry the define (the version is cosmetic). */
const VERSION: string = typeof __MRR_VERSION__ === "string" ? __MRR_VERSION__ : "0.0.0";

/** The id both toggle buttons name in aria-controls. */
export const SIDEBAR_ID = "mrr-sidebar";

/** Mountain mark over "MACRO / REGIME RADAR", linking to the landing page.
 * `compact` is the one-line variant MobileNav renders below 860 px. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className={compact ? "mrr-logo mrr-logo-compact" : "mrr-logo"} title="Macro Regime Radar · landing page">
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

/** The two-line stamp under the footer word: newest websocket tick, else the
 * stored intraday bar, else the stored close. Its own component so the 2 Hz
 * quote store repaints only this leaf. Spans, not divs: it sits in a button. */
function FooterStamp({ status }: { status: ShellStatus }) {
  const quotes = useQuotes();
  const [line1, line2] = marketStampLines({
    tickMs: newestTickMs(quotes),
    intradayTs: status.f?.market_intraday_ts,
    dailyDate: status.f?.market_daily_date,
  });
  return (
    <span className="mrr-side-stamp">
      {line1}
      {line2 ? (
        <>
          <br />
          {line2}
        </>
      ) : null}
    </span>
  );
}

/**
 * The footer dot. When the report carries per-series states, the colour is
 * the live_quotes state's tone (fresh-state.ts: only "live" glows and
 * pulses); otherwise the 2026-09 rule: it pulses only when the stream ticks or
 * a fresh intraday bar is stored.
 */
function StatusDot({ status }: { status: ShellStatus }) {
  const series = seriesById(status.f, "live_quotes");
  if (series) {
    const l = freshLabel(series);
    return (
      <span
        className={l.tone === "live" ? "mrr-dot mrr-live-dot" : "mrr-dot"}
        data-tone={l.tone}
        title={l.reason ? `Live quotes: ${l.word} · ${l.reason}` : `Live quotes: ${l.word}`}
      />
    );
  }
  const dotTitle = status.streamLive
    ? "Live: EODHD stream is ticking"
    : status.intradayFresh
      ? "Intraday feed is current"
      : "Feeds idle: outside market hours or awaiting refresh";
  return <span className={status.dotLive ? "mrr-dot mrr-live-dot" : "mrr-dot mrr-dot-idle"} title={dotTitle} />;
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

/** The footer's status line and stamp as one button (S4): the freshness
 * drawer is reachable from every route, the strip-less ones included. */
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
      title="Per-source freshness: each feed, the regime month and the NYSE session"
    >
      <span className="sr-only">Data freshness: </span>
      <span className="mrr-side-status">
        <StatusDot status={status} />
        {footerWords(status.statusWord, status.liveFeeds)}
      </span>
      <FooterStamp status={status} />
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
 * freshness entry, reduced to its status dot, at the bottom. */
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
        aria-label={`Data freshness: ${footerWords(status.statusWord, status.liveFeeds)}`}
        title={`Data freshness: ${footerWords(status.statusWord, status.liveFeeds)}`}
      >
        <StatusDot status={status} />
      </button>
    </aside>
  );
}
