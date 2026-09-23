/**
 * Desk / Client view (docs/desk/DESK_FRAME_SPEC.md §4). The view is a URL
 * fact, `?view=client`, so a client link opens as a client page and every
 * Desk link preserves it. Client view hides the working detail (z-scores, N,
 * confidence intervals, bootstrap details, model and method ids, the query
 * builder) and prints the verdicts and the headline numbers as words; the
 * "Export one-pager" control prints the same DOM through the print
 * stylesheet in desk.css. Anything not "client" reads as the desk view.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type DeskView = "desk" | "client";

export const VIEW_PARAM = "view";

/** Pure: the view a query string names. Only the exact word "client" is the
 * client view; anything else, including an empty or misspelt value, is the desk. */
export function parseView(search: string | URLSearchParams): DeskView {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(VIEW_PARAM) === "client" ? "client" : "desk";
}

/** Pure: `path` with the view written into its query (removed for the desk). */
export function withView(path: string, view: DeskView): string {
  const [base, hash = ""] = path.split("#");
  const [pathname, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  if (view === "client") params.set(VIEW_PARAM, "client");
  else params.delete(VIEW_PARAM);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

export interface DeskViewState {
  view: DeskView;
  isClient: boolean;
  setView: (view: DeskView) => void;
  /** A Desk route for a page slug, carrying the current view. */
  pathTo: (slug: string, hash?: string) => string;
}

export function useDeskView(): DeskViewState {
  const [params, setParams] = useSearchParams();
  const view = parseView(params);
  const setView = useCallback(
    (next: DeskView) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "client") p.set(VIEW_PARAM, "client");
          else p.delete(VIEW_PARAM);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const pathTo = useCallback((slug: string, hash?: string) => withView(`/desk/${slug}${hash ? `#${hash}` : ""}`, view), [view]);
  return useMemo(() => ({ view, isClient: view === "client", setView, pathTo }), [view, setView, pathTo]);
}
