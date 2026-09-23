/**
 * The Data Pipeline inventory's groups (desk/frame; moved here from
 * DataPipelinePage.tsx in desk/integration). The freshness report's rows
 * group by provider and cadence; the Desk's daily history rows
 * (`desk:<series_id>`, one per desk_series series, the event-study report's
 * §10 follow-up) keep their own group whatever their provider, because they
 * are a separate store with a separate reader. Pure.
 */

import type { InventoryRow } from "../../../api/desk";

export const DESK_HISTORY_GROUP = "Desk · daily history";

export function groupOf(r: InventoryRow): string {
  if (r.id.startsWith("desk:")) return DESK_HISTORY_GROUP;
  if (r.kind === "fred") return r.cadence === "monthly" ? "FRED · monthly prints" : "FRED · daily series";
  if (r.kind === "market") return "Stored market data";
  if (r.kind === "live") return "Live relay";
  return "Derived";
}

export const GROUP_ORDER = ["FRED · daily series", "FRED · monthly prints", "Stored market data", "Live relay", "Derived", DESK_HISTORY_GROUP];
