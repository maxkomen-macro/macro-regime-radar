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
 */

import { Link } from "react-router-dom";
import { useQuotes } from "../../live/quotes";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { MethodologyIcon, MountainMark, NavIcon } from "./nav-icons";
import Watchlist from "./watchlist/Watchlist";
import { footerWords, marketStampLines, newestTickMs, type ShellStatus } from "./shell-status";

/** Injected by vite.config.ts `define` from package.json; guarded for any
 * runtime that does not carry the define (the version is cosmetic). */
const VERSION: string = typeof __MRR_VERSION__ === "string" ? __MRR_VERSION__ : "0.0.0";

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

/** The two-line stamp under the footer word: newest websocket tick, else the
 * stored intraday bar, else the stored close. Its own component so the 2 Hz
 * quote store repaints only this leaf. */
function FooterStamp({ status }: { status: ShellStatus }) {
  const quotes = useQuotes();
  const [line1, line2] = marketStampLines({
    tickMs: newestTickMs(quotes),
    intradayTs: status.f?.market_intraday_ts,
    dailyDate: status.f?.market_daily_date,
  });
  return (
    <div className="mrr-side-stamp">
      {line1}
      {line2 ? (
        <>
          <br />
          {line2}
        </>
      ) : null}
    </div>
  );
}

export default function Sidebar({ activeSlug, status }: { activeSlug: string; status: ShellStatus }) {
  const isMethodology = activeSlug === METHODOLOGY_SLUG;
  const dotTitle = status.streamLive
    ? "Live: EODHD stream is ticking"
    : status.intradayFresh
      ? "Intraday feed is current"
      : "Feeds idle: outside market hours or awaiting refresh";
  return (
    <aside className="mrr-side" aria-label="Sidebar">
      <Wordmark />
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
        <div>
          <span className={status.dotLive ? "mrr-dot mrr-live-dot" : "mrr-dot mrr-dot-idle"} title={dotTitle} />
          {footerWords(status.statusWord, status.liveFeeds)}
        </div>
        <FooterStamp status={status} />
        <div className="ver">v{VERSION}</div>
      </div>
    </aside>
  );
}
