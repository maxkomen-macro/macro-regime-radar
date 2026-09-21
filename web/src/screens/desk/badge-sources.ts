/**
 * What each live Desk panel reads, for its status badge (spec §3): a source
 * name in reader words and the /api/freshness series ids whose weakest state
 * dates the badge. The ids reuse the groups fresh-state.ts already defines
 * for the app's own chips, so a Desk badge and a Dashboard chip agree.
 */

import type { SeriesState } from "../../api/types";
import { CREDIT_OAS_IDS, RECESSION_INPUT_IDS, REGIME_INPUT_IDS, SIGNAL_INPUT_IDS } from "../shared/fresh-state";

export interface BadgeSource {
  /** "FRED monthly", "stored closes", "pipeline". */
  label: string;
  /** Series ids in /api/freshness series[]; the group's weakest member dates the badge. */
  ids?: readonly string[];
  /** A payload's own freshness block, filling ids the report does not carry. */
  block?: Record<string, SeriesState> | null;
  /** For a feed the report does not judge: the payload's own stamp. */
  asOf?: string | null;
  reason?: string;
}

export const SOURCES = {
  regime: { label: "FRED monthly", ids: REGIME_INPUT_IDS },
  recession: { label: "FRED", ids: RECESSION_INPUT_IDS },
  signals: { label: "FRED", ids: SIGNAL_INPUT_IDS },
  credit: { label: "FRED", ids: CREDIT_OAS_IDS },
  closes: { label: "stored closes", ids: ["market_daily"] },
  positions: { label: "FRED + stored closes", ids: ["market_daily", "DGS10", "DGS2", "BAMLH0A0HYM2", "VIXCLS"] },
} as const satisfies Record<string, BadgeSource>;

/** The ids a saved position's falsification series can be tied to: the
 * FRED series the API serves under /series/{id}/latest, and the stored
 * symbols with daily bars. Market symbols read the `market_daily` state. */
export function sourceForSeries(seriesId: string, isMarket: boolean): BadgeSource {
  return isMarket ? { label: "stored closes", ids: ["market_daily"] } : { label: "FRED", ids: [seriesId] };
}
