/**
 * The walkthrough (DESK_FRAME2_SPEC §6): six steps, each a real route with
 * real state, the step carried in the URL as `?tour=N` so any step is a link.
 * The routes are the spec's own; the short paths (`/desk/internals`,
 * `/desk/monitor`, `/desk/pipeline`, `/desk/notes`) are aliases DeskShell
 * resolves to the pages' slugs with the query kept. Nothing autoplays: a step
 * changes only on Back, Next or an arrow key. Pure, no React.
 */

export interface TourStep {
  /** The step's route, query included, without `tour`. */
  route: string;
  /** One line under the step counter. */
  caption: string;
}

export const TOUR_PARAM = "tour";

export const TOUR_STEPS: readonly TourStep[] = [
  { route: "/desk/event-study?study=gold-2sigma-spx-weak", caption: "The setup you described, on live data since 2000." },
  { route: "/desk/internals", caption: "The 50/200 cross, scored the same way." },
  // The spec's caption reads "the gate will not save"; §8's ban list covers
  // every Desk string, so the same sentence says "does not" (report, D17).
  { route: "/desk/monitor?from=gold-2sigma-spx-weak", caption: "Promoting a signal: the gate does not save without a falsification level." },
  { route: "/desk/pipeline", caption: "Where every number comes from." },
  { route: "/desk/event-study?study=gold-2sigma-spx-weak&view=client", caption: "The same study, as a client would read it." },
  { route: "/desk/notes", caption: "How it was built, and how it could be wrong." },
];

/** The spec's short paths and the page slugs they open. */
export const DESK_ALIASES: Readonly<Record<string, string>> = {
  internals: "sp-internals",
  monitor: "position-monitor",
  pipeline: "data-pipeline",
  notes: "build-notes",
};

/** The step a query string names, 1-based; null for none or anything out of range. */
export function parseTour(search: string | URLSearchParams): number | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get(TOUR_PARAM);
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= TOUR_STEPS.length ? n : null;
}

/** The link for step `n`: its route with `tour=n` added. */
export function tourHref(n: number): string {
  const step = TOUR_STEPS[Math.min(TOUR_STEPS.length, Math.max(1, n)) - 1];
  const [path, query = ""] = step.route.split("?");
  const params = new URLSearchParams(query);
  params.set(TOUR_PARAM, String(n));
  return `${path}?${params.toString()}`;
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
