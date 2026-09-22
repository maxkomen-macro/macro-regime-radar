import type { CreditMetrics } from "../../api/types";

/** Props every Credit panel takes (checklist 06 B.3 to B.7): the served metrics (null until they arrive) and the query status. */
export interface CreditPanelProps {
  m: CreditMetrics | null;
  status: "ready" | "loading" | "error";
}
