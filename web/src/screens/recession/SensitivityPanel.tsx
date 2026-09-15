/**
 * Sensitivity, a `<Card as="section">` whose body is the `#sensitivity`
 * Disclosure (redesign Phase 7, checklist 07 B.5), collapsed by default per
 * the locked IA: five SliderRows seeded from the live readings (each with
 * the current-reading tick through `baseline`), the reset button, and the
 * scenario result in the display face beside its served badge. No "Where the
 * change came from" block (F3: no per-input attribution is served).
 *
 * The screen owns the open flag and the analyst's inputs; this panel owns
 * `liveDefaults`, `effective`, the 120 ms debounce and the POST
 * (`useRecessionScenario(open ? debounced : null)`), so nothing posts until
 * the row is opened. Every probability, label and delta is the server's; the
 * result colour follows the served label word, never the number.
 */

import { useMemo, type ReactNode } from "react";
import { Card, SectionHeader, Tag } from "../../components";
import { useRecessionScenario } from "../../api/queries";
import type { RecessionScenarioRequest } from "../../api/types";
import { fmtSigned } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import Jargon from "../shared/Jargon";
import { Caption, SliderRow, StateNote, eyebrowStyle, mono, useDebounced } from "../shared/screen-ui";
import { labelTone, toneColor } from "./recession-copy";
import type { SensitivityPanelProps } from "./panel-props";

/** The null-value glyph the result line prints (U+2014), never an em-dash aside. */
const DASH = "—";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function SensitivityPanel({ m, status, open, onToggle, inputs, onInputsChange }: SensitivityPanelProps): JSX.Element {
  const { isNarrow } = useBreakpoint();

  // liveDefaults (RecessionScreen.tsx:105-124 before Phase 7), verbatim: the
  // seed rounded to each slider's step so the unchanged state is exact.
  const liveDefaults = useMemo<RecessionScenarioRequest | null>(() => {
    if (!m) return null;
    const c = m.current_inputs;
    if (
      m.yield_curve_spread == null ||
      c.unrate == null ||
      c.hy_oas == null ||
      c.indpro_yoy == null ||
      c.lei == null
    )
      return null;
    return {
      yield_curve_bps: clamp(Math.round(m.yield_curve_spread / 5) * 5, -200, 300),
      unemployment: clamp(Math.round(c.unrate * 10) / 10, 2, 15),
      hy_oas_bps: clamp(Math.round(c.hy_oas / 10) * 10, 100, 2000),
      indpro_yoy: clamp(Math.round(c.indpro_yoy * 2) / 2, -20, 10),
      lei: clamp(Math.round(c.lei * 10) / 10, -5, 5),
    };
  }, [m]);
  const effective = inputs ?? liveDefaults;
  const debounced = useDebounced(effective, 120);
  const scenario = useRecessionScenario(open ? debounced : null);

  const ready = status === "ready" && m != null;
  const prob = m?.recession_prob ?? null;

  // One entry point for every slider and typed field. A typed field commits on
  // blur even when its value is unchanged (NumberField), so merely tabbing
  // through the panel must not flip the eyebrows to "modified by you": the
  // analyst's inputs stay null while every field equals the seed, and return
  // to null when a move is undone by hand, so the eyebrows and the reset
  // button read "modified" exactly when a row is changed.
  const update = (patch: Partial<RecessionScenarioRequest>) => {
    if (!effective) return;
    const next = { ...effective, ...patch };
    const seeded = liveDefaults != null && (Object.keys(next) as (keyof RecessionScenarioRequest)[]).every((k) => next[k] === liveDefaults[k]);
    onInputsChange(seeded ? null : next);
  };

  let body: ReactNode;
  if (!ready || !m) {
    // B.8: the header plus a state note in place of the row until data arrives.
    body = (
      <Card variant="tile">
        <StateNote loading={status === "loading"} error={status === "error"} />
      </Card>
    );
  } else {
    const title =
      prob != null
        ? `Move the model's five inputs and watch ${prob.toFixed(1)}% respond`
        : "Move the model's five inputs and watch the model respond";
    // The collapsed input summary (RecessionScreen.tsx:448-457 before Phase 7),
    // shown only while collapsed.
    const summary =
      open || !effective
        ? undefined
        : `· 2s10s ${effective.yield_curve_bps >= 0 ? "+" : ""}${effective.yield_curve_bps} bps · U-3 ${effective.unemployment.toFixed(1)}% · HY ${effective.hy_oas_bps} bps · IP ${effective.indpro_yoy.toFixed(1)}% · LEI ${effective.lei.toFixed(1)}pp`;
    body = (
      <Disclosure variant="row" id="sensitivity" defaultOpen={open} onToggle={onToggle} title={title} description={summary} right={open ? "collapse" : "expand"}>
        {!effective ? (
          <div style={{ marginTop: 6 }}>
            <StateNote>
              The model&apos;s current inputs are incomplete in this snapshot; nothing honest to
              seed the sliders with.
            </StateNote>
          </div>
        ) : (
          <div className="mrr-rec-sens">
            <Card variant="tile" padding="6px 18px 8px" style={{ minWidth: 0 }}>
              <div style={{ ...eyebrowStyle, margin: "8px 0 4px" }}>
                Model inputs · {inputs ? "modified by you" : "seeded from current readings"}
              </div>
              <SliderRow
                label="Yield curve 2s10s"
                valueText={`${effective.yield_curve_bps >= 0 ? "+" : ""}${effective.yield_curve_bps} bps`}
                value={effective.yield_curve_bps}
                min={-200}
                max={300}
                step={5}
                input={{ unit: "bps", dp: 0 }}
                onChange={(v) => update({ yield_curve_bps: v })}
                baseline={liveDefaults?.yield_curve_bps}
                format={(v) => `${v} bps`}
              />
              <SliderRow
                label="Unemployment rate"
                valueText={`${effective.unemployment.toFixed(1)}%`}
                value={effective.unemployment}
                min={2}
                max={15}
                step={0.1}
                input={{ unit: "%", dp: 1 }}
                onChange={(v) => update({ unemployment: v })}
                baseline={liveDefaults?.unemployment}
                format={(v) => `${v}%`}
              />
              <SliderRow
                label="HY credit spread"
                valueText={`${effective.hy_oas_bps} bps`}
                value={effective.hy_oas_bps}
                min={100}
                max={2000}
                step={10}
                input={{ unit: "bps", dp: 0 }}
                onChange={(v) => update({ hy_oas_bps: v })}
                baseline={liveDefaults?.hy_oas_bps}
                format={(v) => `${v} bps`}
              />
              <SliderRow
                label="Industrial production YoY"
                valueText={`${effective.indpro_yoy.toFixed(1)}%`}
                value={effective.indpro_yoy}
                min={-20}
                max={10}
                step={0.5}
                input={{ unit: "%", dp: 1 }}
                onChange={(v) => update({ indpro_yoy: v })}
                baseline={liveDefaults?.indpro_yoy}
                format={(v) => `${v}%`}
              />
              <SliderRow
                label={<Jargon term="LEI">Leading-indicator proxy</Jargon>}
                name="Leading-indicator proxy"
                valueText={`${effective.lei.toFixed(1)}pp`}
                value={effective.lei}
                min={-5}
                max={5}
                step={0.1}
                input={{ unit: "pp", dp: 1 }}
                onChange={(v) => update({ lei: v })}
                baseline={liveDefaults?.lei}
                format={(v) => `${v}pp`}
              />
              <div style={{ paddingTop: 10 }}>
                <button
                  type="button"
                  className="mrr-btn"
                  data-touch={isNarrow ? "true" : "false"}
                  onClick={() => onInputsChange(null)}
                  disabled={!inputs}
                  title={inputs ? "Return every input to the model's current reading" : "Inputs already match the current readings"}
                >
                  ↻ Reset to current readings
                </button>
              </div>
            </Card>
            <Card variant="tile" padding="16px 18px" style={{ minWidth: 0 }}>
              <div style={eyebrowStyle}>
                {inputs ? "Your adjusted probability" : "Live model estimate · inputs unchanged"}
              </div>
              {scenario.data ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 8 }}>
                    {/* The display face's one use outside the h1 (spec section 1); the
                        colour follows the served label word through the same labelTone
                        that paints the hero pill and the summary row, never the number. */}
                    <span
                      className="num"
                      style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 52, lineHeight: 1, color: toneColor(labelTone(scenario.data.label)) ?? "var(--text)" }}
                    >
                      {scenario.data.probability.toFixed(1)}%
                    </span>
                    <Tag tone={labelTone(scenario.data.label)} size="sm">
                      {scenario.data.label}
                    </Tag>
                  </div>
                  {scenario.data.delta_pp != null && (
                    <div style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-3)", marginTop: 6 }}>
                      {fmtSigned(scenario.data.delta_pp, 1)}pp vs the model&apos;s headline{" "}
                      {scenario.data.baseline_prob != null ? scenario.data.baseline_prob.toFixed(1) : DASH}%
                    </div>
                  )}
                  {/* X19 caption (RecessionScreen.tsx:573-578 before Phase 7), verbatim. */}
                  <Caption>
                    The headline scores 3-month-lagged inputs (the model never peeks); these
                    sliders score the readings as if they were today&apos;s features, so the
                    starting position sits near, not on, the headline. Same fitted coefficients,
                    same scaler.
                  </Caption>
                </>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {/* isPending covers the first fetch and the 120 ms debounce
                      window alike, so the slot never flashes "Nothing on file." */}
                  <StateNote loading={scenario.isPending} error={scenario.isError} />
                </div>
              )}
            </Card>
          </div>
        )}
      </Disclosure>
    );
  }

  return (
    <Card as="section" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Sensitivity"
        description="Move an input and the fitted model rescores live"
        right="five inputs · the fitted model rescored live"
      />
      {body}
    </Card>
  );
}
