import { describe, expect, it } from "vitest";
import type { Alert } from "../../api/types";
import { describeAlert } from "./alert-copy";

const alert = (over: Partial<Alert>): Alert => ({
  id: 1,
  date: "2026-10-16",
  alert_type: "market",
  name: "VIX_daily_jump",
  level: "watch",
  value: 2.4,
  threshold: 2,
  direction: "above",
  message: null,
  created_at: null,
  ...over,
});

describe("describeAlert: the VIX move alerts", () => {
  it("dates a one-day jump by its session, in σ, never by month", () => {
    const copy = describeAlert(alert({}));
    expect(copy.title).toBe("VIX one-day jump");
    expect(copy.when).toBe("Oct 16, 2026");
    expect(copy.trigger).toBe("The VIX's one-day change was 2.4σ on Oct 16, 2026, above the 2σ watch line.");
    expect(copy.status).toContain("recomputed with every daily refresh");
    expect(copy.trigger).not.toMatch(/pp|Oct 2026\b/);
  });

  it("dates a weekly shock by the last session its week read, with no persistence claim", () => {
    // raised on Monday Oct 19: the alert carries that session, not the coming Friday's bucket
    const copy = describeAlert(alert({ name: "VIX_shock", date: "2026-10-19", value: 3.2, threshold: 3, level: "risk" }));
    expect(copy.title).toBe("VIX weekly shock");
    expect(copy.when).toBe("Oct 19, 2026");
    expect(copy.trigger).toBe(
      "The VIX's change from the previous week's last close was 3.2σ in the week to Oct 19, 2026, above the 3σ risk line.",
    );
    expect(copy.trigger).not.toContain("week ending");
    expect(copy.why).not.toMatch(/lasted|beyond a single session/);
  });
});

describe("describeAlert: the SPY weekly drop", () => {
  it("states the weekly return from the previous week's last close, dated by its close, never as 5 days", () => {
    // raised on Tuesday Nov 3 from SPY_weekly_ret (a week still under way), value and threshold as fractions
    const copy = describeAlert(alert({ name: "SPY_drawdown", date: "2026-11-03", value: -0.035, threshold: -0.03, direction: "below" }));
    expect(copy.title).toBe("SPY weekly drop");
    expect(copy.when).toBe("Nov 03, 2026");
    expect(copy.severity).toBe("Watch");
    expect(copy.trigger).toBe("SPY's change from the previous week's last close was -3.50% in the week to Nov 03, 2026, below the -3% watch line.");
    expect(copy.status).toContain("a week still under way counts only its sessions so far");
    expect(`${copy.trigger} ${copy.status}`).not.toMatch(/5d|5-day|five|pp|Nov 2026\b/);
  });

  it("names the risk line for a risk alert", () => {
    const copy = describeAlert(alert({ name: "SPY_drawdown", date: "2026-04-02", value: -0.08, threshold: -0.07, level: "risk", direction: "below" }));
    expect(copy.severity).toBe("Risk");
    expect(copy.trigger).toBe("SPY's change from the previous week's last close was -8.00% in the week to Apr 02, 2026, below the -7% risk line.");
  });
});
