/**
 * Scenarios sub-tab (redesign Phase 4, checklist 04 B.8): the scenario
 * builder moved from RegimeLabScreen.tsx ScenariosSection. Preset chips are a
 * mono Segmented (the scenario colour glyph stays inside each label), the
 * four shock sliders carry `baseline={0}` so a moved slider reads amber with
 * the "│ current reading" tick, and the result tile keeps every element:
 * severity Tag, "echoes …", the shock summary, stored-vs-stressed odds bars,
 * the pp chips, "most likely", positioning, OW / UW, typical duration and the
 * stress-rule caption.
 *
 * The debounced POST is unchanged: `useScenarioRun(effectiveKey, custom ?
 * debouncedShocks : null)` with a 150 ms settle, `keepPreviousData` so a
 * settled slider step never blanks the panel. Everything quantitative is
 * served; the client renders and captions.
 */

import { useState, type CSSProperties } from "react";
import { Card, ProbabilityBar, SectionHeader, Segmented, Tag } from "../../components";
import { useRegimeLatest, useScenarioDefs, useScenarioRun } from "../../api/queries";
import type { ScenarioShocks } from "../../api/types";
import { tidyProse } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Caption, SliderRow, StateNote, eyebrowStyle, mono, monoNoteStyle, useDebounced } from "../shared/screen-ui";
import { REGIME_HUE } from "./regime-history";

export const SHOCK_DEFAULTS: ScenarioShocks = {
  hy_spread_delta_bps: 0,
  yield_10y_delta_bps: 0,
  vix_delta: 0,
  spx_delta_pct: 0,
};

const CUSTOM_ID = "custom";

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v}`;

/** Severity → surface and badge tone: severe / extreme risk, moderate watch,
 * positive clear, anything else the neutral reference tint. */
function severityTone(severity: string): { card: "risk" | "watch" | "default"; tag: "alert" | "watch" | "clear" | "reference" } {
  if (severity === "severe" || severity === "extreme") return { card: "risk", tag: "alert" };
  if (severity === "moderate") return { card: "watch", tag: "watch" };
  if (severity === "positive") return { card: "default", tag: "clear" };
  return { card: "default", tag: "reference" };
}

/** The served 0-100 keys as the 0-1 shape ProbabilityBar reads. */
const toBar = (p: Record<string, number>) => ({
  goldilocks: (p.goldilocks ?? 0) / 100,
  overheating: (p.overheating ?? 0) / 100,
  stagflation: (p.stagflation ?? 0) / 100,
  recession: (p.recession_risk ?? 0) / 100,
});

/** "HY +300bps · 10Y −100bps · VIX +40 · SPX −25%" or "no shocks set". */
function shockSummary(shocks: ScenarioShocks): string {
  return (
    Object.entries(shocks)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) =>
        k === "hy_spread_delta_bps"
          ? `HY ${signed(v)}bps`
          : k === "yield_10y_delta_bps"
            ? `10Y ${signed(v)}bps`
            : k === "vix_delta"
              ? `VIX ${signed(v)}`
              : `SPX ${signed(v)}%`,
      )
      .join(" · ") || "no shocks set"
  );
}

const bulletStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  lineHeight: 1.55,
  color: "var(--text-3)",
};

const sectorLine: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.55,
};

export default function ScenariosTab() {
  const defs = useScenarioDefs();
  const regimeNow = useRegimeLatest();
  const { isMobile, isNarrow } = useBreakpoint();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [shocks, setShocks] = useState<ScenarioShocks>(SHOCK_DEFAULTS);
  const debouncedShocks = useDebounced(shocks, 150);
  // The tab's flagship interaction shows numbers on first paint: the first
  // preset is pressed until the analyst picks another or builds custom shocks.
  const effectiveKey = custom ? null : (selectedKey ?? defs.data?.[0]?.key ?? null);
  const run = useScenarioRun(effectiveKey, custom ? debouncedShocks : null);
  const r = run.data;
  const tones = r ? severityTone(r.severity) : null;

  const options = [
    ...(defs.data ?? []).map((d) => ({
      id: d.key,
      label: (
        <>
          <span aria-hidden="true" style={{ color: d.color }}>
            ●{" "}
          </span>
          {d.name}
        </>
      ),
      title: d.description,
    })),
    { id: CUSTOM_ID, label: "Custom shocks" },
  ];

  const setShock = (key: keyof ScenarioShocks) => (v: number) => setShocks((s) => ({ ...s, [key]: v }));

  return (
    <Card as="section" variant="panel" id="scenarios" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Scenario builder"
        right="Scenario analysis · stress rule over stored odds, not a classifier rerun"
        actions={
          <Segmented
            mono
            label="Scenario"
            value={custom ? CUSTOM_ID : (effectiveKey ?? "")}
            onChange={(id) => {
              if (id === CUSTOM_ID) {
                setCustom(true);
              } else {
                setSelectedKey(id);
                setCustom(false);
              }
            }}
            options={options}
          />
        }
      />

      {/* Below 768 the custom split collapses too: sliders above their
          result, which is also the order you read them in. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : custom ? "minmax(0,1fr) minmax(0,1.6fr)" : "minmax(0,1fr)",
          gap: "var(--gap-tile)",
        }}
      >
        {custom && (
          <Card variant="tile" style={{ minWidth: 0 }}>
            <SectionHeader level="sub" as="h3" title="Shock inputs" style={{ marginTop: 0 }} />
            <SliderRow
              label="HY spread shock"
              valueText={`${signed(shocks.hy_spread_delta_bps)} bps`}
              value={shocks.hy_spread_delta_bps}
              min={-200}
              max={500}
              step={10}
              input={{ unit: "bps", dp: 0 }}
              baseline={0}
              format={(v) => `${signed(v)} bps`}
              onChange={setShock("hy_spread_delta_bps")}
            />
            <SliderRow
              label="10Y yield shock"
              valueText={`${signed(shocks.yield_10y_delta_bps)} bps`}
              value={shocks.yield_10y_delta_bps}
              min={-150}
              max={200}
              step={5}
              input={{ unit: "bps", dp: 0 }}
              baseline={0}
              format={(v) => `${signed(v)} bps`}
              onChange={setShock("yield_10y_delta_bps")}
            />
            <SliderRow
              label="VIX shock"
              valueText={`${signed(shocks.vix_delta)} pts`}
              value={shocks.vix_delta}
              min={-10}
              max={50}
              step={1}
              input={{ unit: "pts", dp: 0 }}
              baseline={0}
              format={(v) => `${signed(v)} pts`}
              onChange={setShock("vix_delta")}
            />
            <SliderRow
              label="S&P 500 shock"
              valueText={`${signed(shocks.spx_delta_pct)}%`}
              value={shocks.spx_delta_pct}
              min={-40}
              max={20}
              step={1}
              input={{ unit: "%", dp: 0 }}
              baseline={0}
              format={(v) => `${signed(v)}%`}
              onChange={setShock("spx_delta_pct")}
            />
            <div style={{ marginTop: 6 }}>
              <button type="button" className="mrr-btn" data-touch={isNarrow ? "true" : "false"} onClick={() => setShocks(SHOCK_DEFAULTS)}>
                Reset shocks to zero
              </button>
            </div>
          </Card>
        )}

        {r && tones ? (
          <Card variant="tile" tone={tones.card} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: r.color }}>{r.scenario_name}</span>
              <Tag tone={tones.tag} size="sm">
                {r.severity}
              </Tag>
              {r.historical_reference && <span style={monoNoteStyle}>echoes {r.historical_reference}</span>}
              <span style={{ ...monoNoteStyle, marginLeft: "auto" }}>{shockSummary(r.input_shocks)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 16, marginTop: 12 }}>
              <div data-odds="stored">
                <div style={{ ...eyebrowStyle, marginBottom: 4 }}>stored odds today</div>
                {/* The classifier's own stored odds, not the stress rule's
                    renormalised copy: one number, one truth. */}
                <ProbabilityBar
                  probs={
                    regimeNow.data
                      ? {
                          goldilocks: regimeNow.data.prob_goldilocks ?? 0,
                          overheating: regimeNow.data.prob_overheating ?? 0,
                          stagflation: regimeNow.data.prob_stagflation ?? 0,
                          recession: regimeNow.data.prob_recession ?? 0,
                        }
                      : toBar(r.current_regime_probs)
                  }
                  height={6}
                />
              </div>
              <div data-odds="stressed">
                <div style={{ ...eyebrowStyle, marginBottom: 4 }}>stressed odds</div>
                <ProbabilityBar probs={toBar(r.stressed_regime_probs)} height={6} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              {/* v === 0 is a real data label ("no change"), not decoration:
                  it reads in --text-3 like the negatives. */}
              {Object.entries(r.prob_changes).map(([k, v]) => (
                <span key={k} style={{ ...monoNoteStyle, color: v > 0 ? "var(--amber)" : "var(--text-3)" }}>
                  {k.replace("_", " ")} {signed(Math.round(v))}pp
                </span>
              ))}
              <span style={{ ...monoNoteStyle, color: "var(--text)", marginLeft: "auto" }}>
                most likely: <b style={{ color: REGIME_HUE[r.most_likely_regime] ?? "var(--text)" }}>{r.most_likely_regime}</b> at{" "}
                {Math.round(r.most_likely_prob)}%
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,1.4fr) minmax(0,1fr)",
                gap: 16,
                marginTop: 12,
                borderTop: "1px solid var(--line-2)",
                paddingTop: 10,
              }}
            >
              <div>
                <div style={{ ...eyebrowStyle, color: "var(--link)" }}>positioning</div>
                {r.positioning_implications.slice(0, 4).map((p) => (
                  <div key={p} style={bulletStyle}>
                    · {tidyProse(p)}
                  </div>
                ))}
              </div>
              <div>
                <div style={eyebrowStyle}>sectors</div>
                <div style={sectorLine}>
                  <span style={{ color: "var(--pos)" }}>OW</span> <span style={{ color: "var(--text-3)" }}>{r.sector_implications.overweight.join(", ")}</span>
                </div>
                <div style={sectorLine}>
                  <span style={{ color: "var(--neg)" }}>UW</span> <span style={{ color: "var(--text-3)" }}>{r.sector_implications.underweight.join(", ")}</span>
                </div>
                {r.duration_estimate && <div style={{ ...monoNoteStyle, marginTop: 6 }}>typical duration: {r.duration_estimate}</div>}
              </div>
            </div>
            <Caption>
              A transparent stress rule (documented in the source) shifts the stored odds by the shock mix and renormalizes; it is a
              sketch of direction and rough size, not the classifier rerun. {r.what_happened_then}
            </Caption>
          </Card>
        ) : (
          <Card variant="tile">
            {run.isLoading ? (
              <StateNote loading />
            ) : run.isError ? (
              <StateNote error />
            ) : (
              <StateNote>
                Pick a prebuilt scenario or build custom shocks. The five presets replay COVID, a rate shock, a soft landing, a
                stagflation scare and a credit crisis against today&apos;s stored odds.
              </StateNote>
            )}
          </Card>
        )}
      </div>
    </Card>
  );
}
