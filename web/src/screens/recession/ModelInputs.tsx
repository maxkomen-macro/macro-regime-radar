/**
 * Model inputs, `<section id="model">` (redesign Phase 7, checklist 07 B.3):
 * five SignalCards, one per served feature in `model_features` order, with
 * no meter, no sparkline and no "Trips" line (F1, F7, F8: the API serves no
 * push-on-odds figure, per-input history, state word or alert rule for them,
 * and the UI never invents a threshold).
 *
 * Every figure is a served field of `/api/recession/probability`: the value
 * strings are `featureCurrent` (the pre-Phase-7 FEATURE_LABELS.current
 * strings), the curve badge is the served `is_inverted`, the second mono
 * line is the served coefficient (X21, the same number the transparency
 * rows print) and the one served `data_as_of` prints on every card (F6).
 * The 2s10s caption (X10) survives on the curve card.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader, SignalCard } from "../../components";
import type { RecessionMetrics } from "../../api/types";
import { fmtMonYr, fmtSigned, ordinal } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { StateNote } from "../shared/screen-ui";
import { featureCurrent, featureLabel } from "./recession-copy";
import type { RecessionPanelProps } from "./panel-props";

/** The null-value glyph the captions print (U+2014), never an em-dash aside. */
const DASH = "—";

type Reader = (m: RecessionMetrics) => number | null | undefined;

/** The served input behind each feature (`current_inputs` keys per
 * recession_cache.py:46-52; the curve reads `yield_curve_spread`). A null
 * read, or a feature with no reader, is the "Not stored" card. */
const INPUT_READ: Partial<Record<string, Reader>> = {
  yield_curve: (m) => m.yield_curve_spread,
  unemployment: (m) => m.current_inputs.unrate,
  hy_spread: (m) => m.current_inputs.hy_oas,
  indpro_yoy: (m) => m.current_inputs.indpro_yoy,
  lei_proxy: (m) => m.current_inputs.lei,
};

/** The X10 caption (RecessionScreen.tsx:297-306 before Phase 7), verbatim. */
function CurveCaption({ m }: { m: RecessionMetrics }): JSX.Element {
  const spreadBps = m.yield_curve_spread;
  return (
    <>
      The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at{" "}
      {spreadBps != null ? `${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps (${(spreadBps / 100).toFixed(2)}%)` : DASH}
      {m.is_inverted && m.inversion_duration_months
        ? `; inverted for ${m.inversion_duration_months} months.`
        : m.yield_curve_pct_rank != null
          ? `, the ${ordinal(m.yield_curve_pct_rank)} percentile of 30 years.`
          : "."}{" "}
      An inverted curve has preceded most US recessions.
    </>
  );
}

function InputCard({ m, feature }: { m: RecessionMetrics; feature: string }): JSX.Element {
  const read = INPUT_READ[feature];
  const missing = read == null || read(m) == null;
  const isCurve = feature === "yield_curve";
  const through = `Inputs through ${fmtMonYr(m.data_as_of)}`;
  // The caption slot belongs to the curve card only (B.3); it is null-safe.
  const caption = isCurve ? <CurveCaption m={m} /> : undefined;
  if (missing) {
    // The 02 B.3 unavailable state: no value to print, reference tint, one line.
    return (
      <SignalCard
        as="article"
        heading="h3"
        data-feature={feature}
        name={featureLabel(feature)}
        value="Not stored"
        badge="Unavailable"
        tone="reference"
        showGauge={false}
        lastTriggered={null}
        lines={[through]}
        caption={caption}
      />
    );
  }
  const coef = m.feature_coefficients[feature];
  const lines: ReactNode[] = [through];
  // The served fit (X21): what the model does with the input as it rises.
  if (coef != null) lines.push(`${fmtSigned(coef, 2)} log-odds per σ · ${coef > 0 ? "raises" : "lowers"} odds as it rises`);
  return (
    <SignalCard
      as="article"
      heading="h3"
      data-feature={feature}
      name={featureLabel(feature)}
      value={featureCurrent(feature, m)}
      // Badge and tone are both passed: without them the component derives a
      // false "Clear" from a zero fill (SignalCard.jsx:69-72). The curve's
      // state is the served is_inverted; no served field carries a state for
      // the other four, so they read the neutral word in the reference tint.
      badge={isCurve ? (m.is_inverted ? "Inverted" : "Upward") : "Model input"}
      tone={isCurve && m.is_inverted ? "watch" : "reference"}
      showGauge={false}
      lastTriggered={null}
      lines={lines}
      caption={caption}
    />
  );
}

export default function ModelInputs({ m, status }: RecessionPanelProps): JSX.Element {
  const ready = status === "ready" && m != null;
  return (
    <Card as="section" variant="panel" id="model" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Model inputs"
        description="The five series the model scores each month"
        right={ready && m ? `${m.model_features.length} inputs · latest ${fmtMonYr(m.data_as_of)}` : undefined}
        actions={
          <Link className="mrr-link" to="/app/methodology#models">
            Series notes →
          </Link>
        }
      />
      {ready && m ? (
        <div className="mrr-rec-inputs">
          {m.model_features.map((f) => (
            <InputCard key={f} m={m} feature={f} />
          ))}
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
