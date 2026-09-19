/**
 * Credit state odds, `<section id="credit-state-odds">` (redesign Phase 6,
 * checklist 06 B.6): the 4x4 credit-state transition matrix on HeatMatrix
 * behind a 3 months / 6 months Segmented (both matrices stay in the payload
 * and swap on the toggle, UI_SPEC 0.5), three stat tiles that are direct
 * reads of one cell each, and the C19 caption with the Tight caveat.
 * Iteration 1: the panel spans the page beside nothing (the ladder row is
 * one column), the matrix tile sits beside the stat tiles and the caption,
 * a from-state with no served months reads "No history" in every cell, the
 * served month counts print under the matrix, and the caption keeps two
 * sentences visible with the rest behind "Details".
 *
 * The client does not rank credit states or sum a "deterioration"
 * probability; that ordinality belongs to src/analytics/credit.py (audit).
 * The matrices speak for themselves; every figure here is a direct read of
 * a served cell. The horizon is local state: no hash, no query string.
 */

import { useState } from "react";
import { Card, HeatMatrix, SectionHeader, Segmented, StatTile } from "../../components";
import type { HeatCell } from "../../components/data/HeatMatrix";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Jargon from "../shared/Jargon";
import ScrollTable from "../shared/ScrollTable";
import Disclosure from "../shared/Disclosure";
import { Caption, StateNote, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import { fmtProb } from "../../lib/format";
import { CREDIT_OAS_IDS } from "../shared/fresh-state";
import { SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import type { CreditPanelProps } from "./panel-props";

/** The four served credit states in matrix order (CreditScreen.tsx:33 before Phase 6, kept). */
export const CREDIT_STATES = ["Normal", "Tight", "Stressed", "Crisis"] as const;

/** The null-value glyph the matrices print (U+2014), never an em-dash aside. */
const DASH = "—";

type Horizon = "3m" | "6m";
type Matrix = Record<string, Record<string, number>>;

const HORIZONS = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
];

/** One cell as a whole percent, or null when the cell is not served. */
function cellPct(matrix: Matrix | null | undefined, from: string, to: string): number | null {
  const p = matrix?.[from]?.[to];
  return p != null ? Math.round(p * 100) : null;
}

/** A4: a transition odd is a probability; outside 0–100 it prints the dash. */
const pctText = (v: number | null) => (v != null ? fmtProb(v, "percent") : DASH);

export default function CreditStateOdds({ m, status }: CreditPanelProps): JSX.Element {
  const [horizon, setHorizon] = useState<Horizon>("3m");
  const { isNarrow } = useBreakpoint();
  const ready = status === "ready" && m != null;
  const report = useFreshReport();

  let body: React.ReactNode;
  if (ready && m) {
    const label = m.credit_label;
    const matrix = horizon === "3m" ? m.transition_3m : m.transition_6m;
    const obs = (horizon === "3m" ? m.transition_obs_3m : m.transition_obs_6m) ?? null;
    const empty = !matrix || Object.keys(matrix).length === 0;
    const ariaLabel = `Credit-state transition matrix ${horizon === "3m" ? "3M" : "6M"}`;
    // Stay odds are a direct read of the diagonal (CreditScreen.tsx:253-256, kept).
    const stay3 = cellPct(m.transition_3m, label, label);
    const stay6 = cellPct(m.transition_6m, label, label);
    // A fixed column choice, not a ranking: the next rung down, or Crisis from Stressed.
    const to = label === "Stressed" ? "Crisis" : "Stressed";
    const otherStay = horizon === "3m" ? stay6 : stay3;
    // Iteration 1: a row with no months behind it reads "No history", never a
    // measured 0% (the served month counts; the Tight count when they are absent).
    const noHistory = (state: string): boolean => (obs ? obs[state] === 0 : state === "Tight" && m.tight_count === 0);
    const cells: HeatCell[][] = CREDIT_STATES.map((from) =>
      CREDIT_STATES.map((col) => {
        if (noHistory(from)) return { value: null, text: <span style={{ fontSize: 11, color: "var(--text-3)" }}>No history</span> };
        const p = matrix?.[from]?.[col] ?? 0;
        return { value: p, text: fmtProb(p) };
      }),
    );
    const counted = obs ? CREDIT_STATES.filter((st) => obs[st] != null) : [];
    body = (
      <div className="mrr-credit-odds-body">
        <Card variant="tile" padding="16px 18px" style={{ minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 10 }}>{horizon === "3m" ? "3-month transition odds" : "6-month transition odds"}</div>
          {empty ? (
            <StateNote>Not enough monthly history for transition odds (needs 60 months).</StateNote>
          ) : (
            /* The label column plus four state columns need ~360px before the
               "→ Stressed" headers start wrapping; below 768 the matrix claims
               that width and scrolls inside its own well (02 B.13). */
            <ScrollTable stickyFirst={false} label={ariaLabel}>
              <HeatMatrix
                preset="transition"
                corner="From ↓ to →"
                ariaLabel={ariaLabel}
                rows={CREDIT_STATES.map((st) => ({
                  key: st,
                  label: st === "Tight" ? <Jargon term="Tight">Tight</Jargon> : st,
                  current: st === label,
                }))}
                cols={CREDIT_STATES.map((st) => ({ key: st, label: `→ ${st}` }))}
                cells={cells}
                style={{ minWidth: isNarrow ? 360 : undefined }}
              />
            </ScrollTable>
          )}
          {!empty && counted.length ? (
            <div data-role="months-counted" style={{ ...monoNoteStyle, marginTop: 10 }}>
              Months counted · {counted.map((st) => `${st} ${obs?.[st]}`).join(" · ")}
            </div>
          ) : null}
        </Card>
        <div style={{ display: "grid", gap: "var(--gap-tile)", alignContent: "start", minWidth: 0 }}>
          {empty ? null : (
            <Card variant="tile" padding="12px 18px" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
              <StatTile size="sm" label={`Stays ${label} · 3m`} value={pctText(stay3)} />
              <StatTile size="sm" label={`To ${to} · 3m`} value={pctText(cellPct(m.transition_3m, label, to))} />
              <StatTile size="sm" label={`To ${to} · 6m`} value={pctText(cellPct(m.transition_6m, label, to))} />
            </Card>
          )}
          {/* G4: two sentences visible, the rest behind Details on the same panel. */}
          <div>
            <Caption style={{ marginTop: 0 }}>
              A <Jargon term="transition matrix">transition matrix</Jargon> counted from monthly credit states since 1996.
              {stay3 != null && (
                <>
                  {" "}
                  From today&apos;s {label} state, spreads stayed {label} three months later {pctText(stay3)} of the time.
                </>
              )}
            </Caption>
            <Disclosure variant="quiet" title="Details">
              <Caption style={{ marginTop: 0 }}>
                {empty ? null : "The outlined row is today's state."}
                {!empty && otherStay != null ? ` ${horizon === "3m" ? "6-month" : "3-month"} view: ${label} stays ${pctText(otherStay)}.` : null}
                {m.tight_count < 5 && (
                  <>
                    {" "}
                    {m.tight_count === 0
                      ? "The Tight state has never occurred since 1996; its row reads No history, not zero risk."
                      : `Tight-state rows rest on only ${m.tight_count} historical months; treat those odds as anecdote.`}
                  </>
                )}
              </Caption>
            </Disclosure>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <Card variant="tile">
        <StateNote loading={status === "loading"} error={status === "error"} />
      </Card>
    );
  }

  return (
    <Card as="section" variant="panel" id="credit-state-odds" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Credit state odds"
        description="Past monthly moves between states"
        right={<Stamp source={SRC.baml} label={report.group(CREDIT_OAS_IDS, m?.freshness)} />}
        actions={<Segmented label="Transition horizon" value={horizon} onChange={(id) => setHorizon(id as Horizon)} options={HORIZONS} />}
      />
      {body}
    </Card>
  );
}
