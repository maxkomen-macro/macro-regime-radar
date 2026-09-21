/**
 * The Desk below 860 px (spec §1: "Mobile nav below 860 px carries Desk"):
 * the compact wordmark linking back to the dashboard, a Menu button, and the
 * three groups as one plain list with the active page marked. The app's
 * MobileNav classes and behaviour (closes on navigation and on Escape, never
 * a modal) are reused; only the items differ.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Wordmark } from "../shell/Sidebar";
import { DESK_GROUPS, deskPageBySlug } from "./desk-sections";

export default function DeskMobileNav({ activeSlug, pathTo }: { activeSlug: string; pathTo: (slug: string) => string }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const current = deskPageBySlug(activeSlug)?.label ?? "Today";
  return (
    <nav aria-label="Primary" className="mrr-mnav">
      <div className="mrr-mnav-row">
        <Wordmark compact to="/app/dashboard" title="Macro Regime Radar · back to the dashboard" />
        <span className="mrr-desk-eyebrow" data-size="sm">
          Desk
        </span>
        <button
          type="button"
          className="mrr-mnav-menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="desk-mobile-nav-list"
          aria-label={`Menu · current page ${current}`}
          title={`Current page: ${current}`}
        >
          <span aria-hidden="true" className="mrr-mnav-glyph">
            {open ? "▾" : "▸"}
          </span>
          Menu
        </button>
      </div>
      <ul id="desk-mobile-nav-list" className="mrr-mnav-list" style={{ display: open ? "grid" : "none" }}>
        {DESK_GROUPS.map((g, gi) => (
          <li key={g.id} className={gi > 0 ? "mrr-mnav-sep" : undefined}>
            <span className="mrr-desk-eyebrow" data-size="sm" style={{ display: "block", padding: "8px 10px 4px" }}>
              {g.label}
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <Link to={p.href ?? pathTo(p.slug)} aria-current={!p.href && p.slug === activeSlug ? "page" : undefined}>
                    <span className="mrr-mnav-label">{p.label}</span>
                    {p.href ? (
                      <span className="mrr-mnav-hint">Main app</span>
                    ) : p.status === "designed" ? (
                      <span className="mrr-mnav-hint">Designed</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
