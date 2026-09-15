/**
 * Viewport tiers: the app's one width-conditional mechanism.
 *
 * Every responsive decision in this codebase reads this hook; nothing else
 * measures the window. Four tiers, matching the review viewports:
 *
 *   mobile   <480px    phone portrait          (375 is the reference width)
 *   tablet   480–767   phone landscape / small tablet portrait
 *   desktop  768–1023  tablet landscape / small laptop
 *   wide     ≥1024     the layout everything was designed at (1440 included)
 *
 * `isNarrow` (mobile || tablet, i.e. <768) is the switch that matters: below
 * 768 the desk layout stops working, at and above it the app must render
 * byte-identical to the pre-responsive build. Design intent: three consumers,
 * and only three:
 *
 *   1. conditional `gridTemplateColumns` (multi-column grids collapse to one),
 *   2. conditional stacking (flex rows become columns),
 *   3. conditional padding (28px page gutter tightens to 14, 12 on mobile).
 *
 * Anything else (font sizes, colours, which data is shown) stays width-agnostic;
 * a phone visitor sees the same numbers, just stacked.
 *
 * `shellCompact` (<860px, redesign Phase 1) is a fifth, independent flag for
 * the one DOM swap the shell makes: the sidebar gives way to MobileNav. It
 * matches the CSS media query in app.css (`max-width: 859.98px`) so the grid
 * collapses and the sidebar unmounts at the same pixel. The four tiers are
 * untouched: every screen keeps reading them.
 *
 * Implementation: `window.matchMedia` listeners read through
 * `useSyncExternalStore`, the same idiom as the live-quote store in
 * web/src/live/quotes.ts. Snapshots are eight frozen singletons (tier ×
 * shellCompact) so the store returns a stable identity and React never loops.
 * SSR / no-matchMedia environments default to "wide", the design's home tier.
 */

import { useSyncExternalStore } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop" | "wide";

export interface BreakpointState {
  bp: Breakpoint;
  /** <480px. */
  isMobile: boolean;
  /** 480–767px. */
  isTablet: boolean;
  /** <768px, the stack-everything switch. */
  isNarrow: boolean;
  /** <860px, the sidebar hides and MobileNav renders (spec §2). */
  shellCompact: boolean;
}

/* Fractional upper bounds so no width falls between two tiers on fractional
   device-pixel-ratio / browser-zoom viewport widths. */
const QUERIES: { bp: Breakpoint; query: string }[] = [
  { bp: "mobile", query: "(max-width: 479.98px)" },
  { bp: "tablet", query: "(min-width: 480px) and (max-width: 767.98px)" },
  { bp: "desktop", query: "(min-width: 768px) and (max-width: 1023.98px)" },
  { bp: "wide", query: "(min-width: 1024px)" },
];

/** Same bound as `@media (max-width: 859.98px)` in app.css. */
export const SHELL_COMPACT_QUERY = "(max-width: 859.98px)";

function state(bp: Breakpoint, shellCompact: boolean): BreakpointState {
  return Object.freeze({
    bp,
    isMobile: bp === "mobile",
    isTablet: bp === "tablet",
    isNarrow: bp === "mobile" || bp === "tablet",
    shellCompact,
  });
}

/** Two frozen objects per tier (shellCompact false / true): `getSnapshot`
 * must be referentially stable. */
const STATES: Record<Breakpoint, [BreakpointState, BreakpointState]> = {
  mobile: [state("mobile", false), state("mobile", true)],
  tablet: [state("tablet", false), state("tablet", true)],
  desktop: [state("desktop", false), state("desktop", true)],
  wide: [state("wide", false), state("wide", true)],
};

type Entry = { bp: Breakpoint | null; mql: MediaQueryList };

let entries: Entry[] | null = null;

function lists(): Entry[] {
  if (entries) return entries;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return [];
  entries = [
    ...QUERIES.map(({ bp, query }) => ({ bp, mql: window.matchMedia(query) })),
    // bp: null marks the shellCompact query; it never names a tier.
    { bp: null, mql: window.matchMedia(SHELL_COMPACT_QUERY) },
  ];
  return entries;
}

function measure(): BreakpointState {
  let bp: Breakpoint = "wide";
  let compact = false;
  let tierFound = false;
  for (const entry of lists()) {
    if (entry.bp === null) compact = entry.mql.matches;
    else if (!tierFound && entry.mql.matches) {
      bp = entry.bp;
      tierFound = true;
    }
  }
  return STATES[bp][compact ? 1 : 0];
}

const listeners = new Set<() => void>();
const onChange = () => listeners.forEach((l) => l());

/** Listeners attach with the first consumer and detach with the last. */
function subscribe(listener: () => void): () => void {
  const attached = lists();
  if (listeners.size === 0) attached.forEach(({ mql }) => mql.addEventListener("change", onChange));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0)
      attached.forEach(({ mql }) => mql.removeEventListener("change", onChange));
  };
}

/* Read straight from matchMedia rather than a cached variable: the value is
   correct on the very first render, before any change event has fired, and the
   STATES lookup keeps the returned object identity stable. */
const getSnapshot = (): BreakpointState => measure();
const getServerSnapshot = (): BreakpointState => STATES.wide[0];

/** Current viewport tier. Re-renders only when the tier (or shellCompact) changes. */
export function useBreakpoint(): BreakpointState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
