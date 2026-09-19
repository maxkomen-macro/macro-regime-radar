/**
 * History & analogues sub-tab (redesign Phase 4, checklist 04 B.9): the
 * analogue tiles moved from RegimeLabScreen.tsx AnaloguesSection, then the
 * full-size regime history ribbon (`#regime-history`) on the shared
 * RegimeRibbon with the header meta (calls, span, switches in the last 12
 * months) from the pure regime-history helpers.
 *
 * The API serves the four closest of the seven-period corpus; the caption
 * prints the served count honestly (F3). Colours are house regime hues and
 * badge tones, never the served `similarity_color` hexes (F5).
 */

import type { CSSProperties } from "react";
import { Card, SectionHeader, Tag } from "../../components";
import { useAnalogues, useRegimeHistory } from "../../api/queries";
import { fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import { Caption, MISSING, StateNote, eyebrowStyle, mono, monoNoteStyle } from "../shared/screen-ui";
import RegimeRibbon from "./RegimeRibbon";
import { switchesInLast12 } from "./regime-history";

const proseStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--text-2)",
};

const lessonStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-3)",
  marginTop: 3,
};

/** "Four" when the served set is the four the API returns; the served count otherwise. */
function countWord(n: number): string {
  return n === 4 ? "Four" : String(n);
}

function AnaloguesSection() {
  const q = useAnalogues();
  const { isNarrow } = useBreakpoint();
  return (
    <Card as="section" variant="panel" id="analogues" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Historical analogues" right="Historical analogy · 7-period reference corpus" />
      {q.data?.length ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: "var(--gap-tile)" }}>
            {q.data.map((an) => (
              <Card key={an.period} variant="tile" style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{an.period}</span>
                  <Tag tone="reference" size="sm">
                    {an.regime}
                  </Tag>
                  <span style={{ ...mono, fontSize: 13, fontWeight: 700, marginLeft: "auto", color: "var(--text)" }}>{an.similarity_score}/100 match</span>
                </div>
                <div style={{ ...proseStyle, marginTop: 6 }}>{an.what_happened}</div>
                <div style={{ ...monoNoteStyle, marginTop: 6 }}>
                  resolved → {an.next_regime} after {an.time_to_change}
                </div>
                <div style={{ marginTop: 8, borderTop: "1px solid var(--line-2)", paddingTop: 8 }}>
                  <div style={{ ...eyebrowStyle, color: "var(--link)" }}>lesson for today</div>
                  <div style={lessonStyle}>{an.lessons_for_today}</div>
                </div>
              </Card>
            ))}
          </div>
          <Caption>
            Similarity scores regime match (40), HY-spread percentile proximity (25), recession-odds proximity (20) and VIX proximity
            (15) against today&apos;s stored readings. {countWord(q.data.length)} closest of seven studied periods: a study aid, not a
            prediction.
          </Caption>
        </>
      ) : (
        <Card variant="tile">
          {q.data ? (
            <StateNote>No historical analogues on file for today&apos;s readings.</StateNote>
          ) : (
            <StateNote loading={q.isLoading} error={q.isError} missing={MISSING.analogues} />
          )}
        </Card>
      )}
    </Card>
  );
}

function RegimeHistorySection() {
  const q = useRegimeHistory();
  const rows = q.data ?? [];
  if (!rows.length) {
    return (
      <Card as="section" variant="panel" id="regime-history" style={{ minWidth: 0 }}>
        <SectionHeader layout="panel" title="Regime history" right="Live model output · the classifier's full record" />
        <Card variant="tile">
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      </Card>
    );
  }
  const last = rows[rows.length - 1];
  const k = switchesInLast12(rows);
  const switches = `${k} switch${k === 1 ? "" : "es"}`;
  return (
    <Card as="section" variant="panel" id="regime-history" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Regime history"
        right={`${rows.length} monthly calls · ${fmtMonYr(rows[0].date)} → ${fmtMonYr(last.date)} · ${switches} in the last 12mo`}
      />
      <Card variant="tile" style={{ minWidth: 0 }}>
        <RegimeRibbon
          rows={rows}
          variant="full"
          ariaLabel="Regime history Gantt: one lane per regime, colored spans mark the months the classifier called it"
        />
        {/* G4 (Iteration 1 step 5): two visible sentences; the switch count
            (also in the header meta) sits behind Details. */}
        <Caption>
          Every monthly call the classifier has made, one lane per regime; hover a span for its dates. Long unbroken bands are stable
          macro; rapid lane-hopping marks the turns.
        </Caption>
        <Disclosure variant="quiet" title="Details" style={{ marginTop: 2 }}>
          <Caption style={{ marginTop: 0 }}>
            The last 12 months saw {k} regime switch{k === 1 ? "" : "es"}.
          </Caption>
        </Disclosure>
      </Card>
    </Card>
  );
}

export default function HistoryTab() {
  return (
    <div style={{ display: "grid", gap: "var(--gap-panel)", minWidth: 0 }}>
      <AnaloguesSection />
      <RegimeHistorySection />
    </div>
  );
}
