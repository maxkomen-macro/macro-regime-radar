import type { RecessionMetrics, RecessionScenarioRequest } from "../../api/types";

/** Props every Recession panel takes (checklist 07 B.3 to B.6): the served metrics (null until they arrive) and the query status. */
export interface RecessionPanelProps {
  m: RecessionMetrics | null;
  status: "ready" | "loading" | "error";
}

export type CurveWindow = "5y" | "10y" | "30y";

/** The curve monitor's window lives in the screen (it gates useHashScroll, B.0). */
export interface CurveMonitorProps extends RecessionPanelProps {
  range: CurveWindow;
  onRangeChange: (range: CurveWindow) => void;
}

/** The analyst's inputs live in the screen (B.0); the panel owns liveDefaults /
 * effective / debounce / useRecessionScenario. The sliders render on load
 * (Iteration 1 X3), so there is no open state. */
export interface SensitivityPanelProps extends RecessionPanelProps {
  inputs: RecessionScenarioRequest | null;
  onInputsChange: (inputs: RecessionScenarioRequest | null) => void;
}
