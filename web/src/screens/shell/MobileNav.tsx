/**
 * MobileNav — every destination, discoverable, on a phone (2026-09-05). A
 * "Menu" button with aria-expanded toggles a plain list of the seven tabs
 * plus Methodology; the active route carries aria-current. Not a modal: it
 * is part of the page, closes on navigation, and never hides the alerts
 * trigger or the regime chip behind it.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { METHODOLOGY_SLUG, TABS } from "./sections";

export default function MobileNav({ activeSlug, onOpenPalette }: { activeSlug: string; onOpenPalette?: () => void }) {
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

  return (
    <nav aria-label="Primary" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-list"
        style={{
          appearance: "none",
          width: "100%",
          background: "var(--surface)",
          border: "0.5px solid var(--line)",
          borderRadius: "var(--r-sm)",
          color: "var(--text)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body)",
          fontWeight: 600,
          minHeight: 44,
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-micro)",
              textTransform: "uppercase",
              letterSpacing: "var(--ls-micro)",
              color: "var(--text-muted)",
              marginRight: 10,
            }}
          >
            Screen
          </span>
          {current}
        </span>
        <span aria-hidden="true" style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {open ? "▾" : "▸"} Menu
        </span>
      </button>
      <ul
        id="mobile-nav-list"
        style={{
          listStyle: "none",
          margin: "6px 0 0",
          padding: 4,
          background: "var(--surface)",
          border: "0.5px solid var(--line)",
          borderRadius: "var(--r-sm)",
          // Inline display would beat the UA's [hidden] rule, so the list's
          // visibility is set here rather than through the attribute.
          display: open ? "grid" : "none",
        }}
      >
        {items.map((i) => {
          const on = i.slug === activeSlug;
          return (
            <li key={i.slug}>
              <Link
                to={`/app/${i.slug}`}
                aria-current={on ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 44,
                  padding: "6px 10px",
                  borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  color: on ? "var(--text)" : "var(--text-2)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body)",
                  fontWeight: on ? 600 : 400,
                  textDecoration: "none",
                }}
              >
                {i.label}
                {i.slug === METHODOLOGY_SLUG ? (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-micro)",
                      textTransform: "uppercase",
                      letterSpacing: "var(--ls-micro)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Reference
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {onOpenPalette ? (
          <li style={{ borderTop: "0.5px solid var(--line-hair)", marginTop: 4, paddingTop: 4 }}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenPalette();
              }}
              style={{
                appearance: "none",
                background: "none",
                border: "none",
                width: "100%",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: 44,
                padding: "6px 10px",
                color: "var(--text-2)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                cursor: "pointer",
              }}
            >
              Jump to a section
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-micro)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--ls-micro)",
                  color: "var(--text-muted)",
                }}
              >
                Search
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
