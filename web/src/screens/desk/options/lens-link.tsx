/**
 * The Options Finder's address, and the Options lens's link into it (Options Finder Build Plan step 6). The Markets
 * tab imports this file, so it carries nothing but the flag and the router: no Desk data layer, no styles.
 */

import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { OPTIONS_FINDER_LISTED, OPTIONS_FINDER_SLUG } from "./flag";

export const FINDER_PATH = `/desk/${OPTIONS_FINDER_SLUG}`;

/** Event Study targets with a listed ETF to express them with. */
export const STUDY_ETF: Readonly<Record<string, string>> = { spx: "SPY" };

/** The Finder's address for a symbol, and any other values to fill in. */
export function finderHref(values: Record<string, string>): string {
  const q = new URLSearchParams(values);
  return `${FINDER_PATH}${q.toString() ? `?${q.toString()}` : ""}`;
}

/** The Options lens's link (screens/markets/SingleName.tsx), the ticker filled in; nothing while unlisted. */
export function LensFinderLink({ symbol, style }: { symbol: string; style?: CSSProperties }) {
  if (!OPTIONS_FINDER_LISTED) return null;
  return (
    <Link to={finderHref({ symbol: symbol.toUpperCase() })} style={style} data-testid="lens-finder-link">
      Find a contract for a view →
    </Link>
  );
}

