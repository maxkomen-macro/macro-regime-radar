/**
 * The walkthrough (DESK_FRAME2_SPEC §6, kept by DESK_FRAME3_SPEC §2): six
 * steps, each a real route with real state, the step carried in the URL as
 * `?tour=N` so any step is a link. Frame-3 moves the steps onto the v2 tabs;
 * the short paths (`/desk/internals`, `/desk/monitor`, `/desk/pipeline`,
 * `/desk/notes`) are aliases DeskShell resolves (desk-sections.ts) with the
 * query kept. Nothing autoplays: a step changes only on Back, Next or an
 * arrow key. Pure, no React.
 */

import { DESK_ALIASES } from "../desk-sections";

export { DESK_ALIASES };

export interface TourStep {
  /** The step's route, query included, without `tour`. */
  route: string;
  /** One line under the step counter. */
  caption: string;
}

export const TOUR_PARAM = "tour";

export const TOUR_STEPS: readonly TourStep[] = [
  { route: "/desk/event-study?preset=gold-2sigma-spx-weak", caption: "The setup you described, on live data since 2000." },
  { route: "/desk/technicals", caption: "The 50/200 cross, scored the same way." },
  // The frame-2 caption said "the gate will not save"; the ban list covers
  // every Desk string, so the sentence says "does not" (FRAME2 report, D17).
  { route: "/desk/position-monitor?from=gold-2sigma-spx-weak", caption: "Promoting a signal: the gate does not save without a falsification level." },
  { route: "/desk/data-pipeline", caption: "Where every number comes from." },
  { route: "/desk/event-study?preset=gold-2sigma-spx-weak&view=client", caption: "The same study, as a client would read it." },
  { route: "/desk/build-notes", caption: "How it was built, and how it could be wrong." },
];

/** The step a query string names, 1-based; null for none or anything out of range. */
export function parseTour(search: string | URLSearchParams): number | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get(TOUR_PARAM);
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= TOUR_STEPS.length ? n : null;
}

/** A Desk path with a short path resolved to its page's slug. */
export function resolvePath(path: string): string {
  const m = /^\/desk\/([^/?#]+)$/.exec(path);
  const alias = m ? DESK_ALIASES[m[1]] : undefined;
  return alias ? `/desk/${alias}` : path;
}

/** The link for step `n`: its route, the short path resolved to the page's
 * slug (so Back and Next never pass through a redirect that would drop focus,
 * verifier R3-01; the short paths still open inbound), with `tour=n` added. */
export function tourHref(n: number): string {
  const step = TOUR_STEPS[Math.min(TOUR_STEPS.length, Math.max(1, n)) - 1];
  const [path, query = ""] = step.route.split("?");
  const params = new URLSearchParams(query);
  params.set(TOUR_PARAM, String(n));
  return `${resolvePath(path)}?${params.toString()}`;
}

/** A query string with the tour removed (closing leaves the page where it is). */
export function withoutTour(search: string | URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  params.delete(TOUR_PARAM);
  return params;
}

/** Whether a key press belongs to the control it came from rather than the
 * tour: fields, selects, editable text, and the arrow-key groups (segmented
 * toggles move focus with the arrows). */
export function keyBelongsToControl(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("input, select, textarea, [role='group'], [role='slider'], [role='tablist'], [role='listbox'], [role='menu']"));
}
