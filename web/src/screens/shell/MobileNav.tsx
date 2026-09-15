/**
 * MobileNav: every destination, discoverable, on a phone (2026-09-05;
 * restyled for the redesign, Phase 1). Below 860 px the sidebar is not
 * rendered and this row takes its place: the wordmark link, the transitional
 * regime pill and a "Menu" button with aria-expanded that toggles a plain
 * list of the seven tabs plus Methodology; the active route carries
 * aria-current. Not a modal: it is part of the page, closes on navigation,
 * and never hides the alerts trigger or the regime pill behind it. The open
 * list ends with "Jump to a section" (the palette) and a collapsed Watchlist
 * disclosure so the saved watchlist exists at every width (checklist I.18).
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Disclosure from "../shared/Disclosure";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { NavIcon } from "./nav-icons";
import { Wordmark } from "./Sidebar";
import Watchlist from "./watchlist/Watchlist";

/** Saved-symbol count for the disclosure title, read straight from the
 * watchlist's storage key (spec §3.1 shape). Null when storage is empty,
 * blocked or unreadable, in which case the count is simply omitted. */
function readWatchlistCount(): number | null {
  try {
    const raw = window.localStorage.getItem("mrr.watchlist.v1");
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const symbols = (parsed as { version?: unknown; symbols?: unknown }).symbols;
    return Array.isArray(symbols) ? symbols.length : null;
  } catch {
    return null;
  }
}

export default function MobileNav({
  activeSlug,
  onOpenPalette,
  regime,
}: {
  activeSlug: string;
  onOpenPalette?: () => void;
  /** The transitional regime pill (checklist row 13), rendered in the row. */
  regime?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Navigating closes the list; a route change from anywhere else does too.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = [
    ...TABS.map((t) => ({ slug: t.slug, label: t.label })),
    { slug: METHODOLOGY_SLUG, label: "Methodology" },
  ];
  const current = items.find((i) => i.slug === activeSlug)?.label ?? "Dashboard";
  const count = open ? readWatchlistCount() : null;

  return (
    <nav aria-label="Primary" className="mrr-mnav">
      <div className="mrr-mnav-row">
        <Wordmark compact />
        {regime ? <div className="mrr-mnav-regime">{regime}</div> : null}
        <button
          type="button"
          className="mrr-mnav-menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-list"
          aria-label={`Menu · current screen ${current}`}
          title={`Current screen: ${current}`}
        >
          <span aria-hidden="true" className="mrr-mnav-glyph">
            {open ? "▾" : "▸"}
          </span>
          Menu
        </button>
      </div>
      <ul
        id="mobile-nav-list"
        className="mrr-mnav-list"
        // Inline display would beat the UA's [hidden] rule, so the list's
        // visibility is set here rather than through the attribute.
        style={{ display: open ? "grid" : "none" }}
      >
        {items.map((i) => {
          const on = i.slug === activeSlug;
          return (
            <li key={i.slug}>
              <Link to={`/app/${i.slug}`} aria-current={on ? "page" : undefined}>
                <span className="mrr-mnav-label">
                  <NavIcon slug={i.slug} />
                  {i.label}
                </span>
                {i.slug === METHODOLOGY_SLUG ? (
                  <>
                    {" "}
                    <span className="mrr-mnav-hint">Reference</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
        {onOpenPalette ? (
          <li className="mrr-mnav-sep">
            <button
              type="button"
              className="mrr-mnav-btn"
              onClick={() => {
                setOpen(false);
                onOpenPalette();
              }}
            >
              Jump to a section
              {" "}
              <span className="mrr-mnav-hint">Search</span>
            </button>
          </li>
        ) : null}
        <li className="mrr-mnav-sep">
          <Disclosure title={count != null ? `Watchlist (${count})` : "Watchlist"} variant="quiet">
            {/* The Watchlist root carries id="sidebar-watchlist"; only one
                instance exists at any width (the sidebar is not rendered here). */}
            <div className="mrr-mnav-wl">
              <Watchlist compact />
            </div>
          </Disclosure>
        </li>
      </ul>
    </nav>
  );
}
