/**
 * Model transparency, `<section id="transparency">` (redesign Phase 7,
 * checklist 07 B.6): the feature coefficients as DivergingBars (negative
 * mint to the left of the centre tick, positive red to the right, the
 * strongest filling its half), the macro-vs-markets divergence tile (X11,
 * moved here from the old #model row) and the model card. No "Last refit"
 * row (F4: the model trains in-process on every cold call and stores no
 * refit stamp; `data_as_of` already prints as "Inputs through").
 *
 * Every coefficient, the divergence score and its label, and the training
 * metadata are served fields; the only arithmetic is the marker position on
 * the ±100 track (`50 + score / 2` percent, the server's sign: positive is
 * "Markets ahead of macro", so it sits to the right, G8).
 */

import { Link } from "react-router-dom";
import { Card, DivergingBar, SectionHeader } from "../../components";
import type { RecessionMetrics } from "../../api/types";
import { fmtMonYr, fmtSigned } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, capStyle, eyebrowStyle, mono } from "../shared/screen-ui";
import { BREAKEVEN_LABEL, featureCurrent, featureLabel } from "./recession-copy";
import type { RecessionPanelProps } from "./panel-props";

/** The null-value glyph the tile prints (U+2014), never an em-dash aside. */
const DASH = "—";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function CoefficientsTile({ m }: { m: RecessionMetrics }): JSX.Element {
  const { isMobile } = useBreakpoint();
  // Sorted by magnitude (RecessionScreen.tsx:144-146 before Phase 7), kept.
  const coefs = Object.entries(m.feature_coefficients).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  // The strongest bar fills its half; an empty or all-zero fit falls back to 1.
  const maxAbs = coefs.reduce((acc, [, c]) => Math.max(acc, Math.abs(c)), 0) || 1;
  return (
    <Card variant="tile" padding="14px 18px 10px" style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={eyebrowStyle}>Feature coefficients · log-odds per σ</div>
        <span style={{ ...capStyle, marginTop: 0 }}>
          <span style={{ color: "var(--mint)" }}>lowers odds</span> · <span style={{ color: "var(--neg)" }}>raises odds</span>
        </span>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {coefs.map(([name, coef]) => (
          <div
            key={name}
            data-coefficient={name}
            style={{
              display: "grid",
              // Phone keeps all four columns (label, bar, coefficient, current
              // reading) on tracks narrow enough for the ~326px card interior
              // at 375 (RecessionScreen.tsx:611-613 before Phase 7).
              gridTemplateColumns: isMobile ? "minmax(104px,150px) minmax(40px,1fr) 50px 70px" : "160px minmax(0,1fr) 60px 90px",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)" }}>{featureLabel(name)}</span>
            <DivergingBar value={coef} max={maxAbs} />
            <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, textAlign: "right", color: coef < 0 ? "var(--mint)" : "var(--neg)" }}>
              {fmtSigned(coef, 2)}
            </span>
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-3)", textAlign: "right" }}>{featureCurrent(name, m)}</span>
          </div>
        ))}
      </div>
      {/* RecessionScreen.tsx:642-655 before Phase 7, verbatim except the colour
          words, which follow the DivergingBar tokens (G14). */}
      {/* G4: two sentences visible, the third behind Details on the same tile. */}
      {coefs.length > 0 && (
        <>
          <Caption>
            A one-σ rise in {featureLabel(coefs[0][0])} {coefs[0][1] >= 0 ? "adds" : "subtracts"}{" "}
            {Math.abs(coefs[0][1]).toFixed(2)} {coefs[0][1] >= 0 ? "to" : "from"} the{" "}
            <Jargon term="log-odds">log-odds</Jargon> of recession: the model&apos;s strongest
            input. Red bars raise recession odds as they rise; mint bars lower them.
          </Caption>
          <Disclosure variant="quiet" title="Details">
            <Caption style={{ marginTop: 0 }}>
              Unemployment enters negative because it co-moves with the credit and curve terms; the
              fit assigns it the offsetting sign, so read the five together, not one at a time.
            </Caption>
          </Disclosure>
        </>
      )}
    </Card>
  );
}

function DivergenceTile({ m }: { m: RecessionMetrics }): JSX.Element {
  const { isMobile } = useBreakpoint();
  const score = m.divergence_score;
  const marker = score != null ? clamp(50 + score / 2, 0, 100) : null;
  const markerTitle = score != null ? `${fmtSigned(score, 0)} on ±100` : undefined;
  return (
    <Card
      variant="tile"
      padding="12px 18px"
      style={{ minWidth: 0, display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "150px minmax(0,1fr)", gap: 16, alignItems: "center" }}
    >
      <div>
        <div style={{ ...eyebrowStyle, whiteSpace: "nowrap" }}>Macro vs markets</div>
        <div
          className="num"
          style={{ fontFamily: "var(--font-ui)", fontSize: 30, fontWeight: 500, fontVariantNumeric: "tabular-nums", lineHeight: 1.15, marginTop: 2, color: "var(--text)" }}
        >
          {score != null ? fmtSigned(score, 0) : DASH}
        </div>
        <Caption style={{ marginTop: 2 }}>on a ±100 scale</Caption>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          aria-hidden="true"
          style={{
            position: "relative",
            height: 10,
            borderRadius: 5,
            background: "linear-gradient(90deg, rgba(88,184,230,.35), var(--track) 40%, var(--track) 60%, rgba(245,181,46,.35))",
          }}
        >
          {/* The ±20 materiality band: ticks at 40% and 60% of the track. */}
          <i style={{ position: "absolute", left: "40%", top: 0, width: 1, height: 10, background: "rgba(255,255,255,.3)" }} />
          <i style={{ position: "absolute", left: "60%", top: 0, width: 1, height: 10, background: "rgba(255,255,255,.3)" }} />
          {marker != null ? (
            <i
              data-marker="divergence"
              title={markerTitle}
              style={{ position: "absolute", left: `${marker}%`, top: -4, width: 3, height: 18, borderRadius: 2, background: "#fff" }}
            />
          ) : null}
        </div>
        <div style={{ ...mono, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
          <span>Macro more worried</span>
          <span>±20 material</span>
          <span>Markets more worried</span>
        </div>
        {/* X11 caption (RecessionScreen.tsx:313-318 before Phase 7), verbatim. */}
        <Caption>
          <Jargon term="divergence">{m.divergence_label}</Jargon>: credit-market pricing (HY
          percentile) minus the regime model&apos;s recession odds, on a −100 to +100 scale.
          Beyond ±20 the divergence is material and requires judgment.
        </Caption>
        <Disclosure variant="quiet" title="Details">
          <Caption style={{ marginTop: 0 }}>The number stays neutral; the word carries the verdict.</Caption>
        </Disclosure>
      </div>
    </Card>
  );
}

function ModelCardTile({ m }: { m: RecessionMetrics }): JSX.Element {
  // The six rows (RecessionScreen.tsx:660-679 before Phase 7), verbatim; no "Last refit" (F4).
  const rows: [string, string][] = [
    ["Estimator", "Logistic regression, class-balanced"],
    ["Training target", "NBER USREC months"],
    ["Training samples", `${m.n_training_samples} months`],
    ["Features", m.model_features.map((f) => featureLabel(f)).join(" · ")],
    ["Look-ahead guard", "All features lagged 3 months"],
    ["Inputs through", fmtMonYr(m.data_as_of)],
  ];
  return (
    <Card variant="tile" padding="12px 18px" style={{ minWidth: 0 }}>
      <div style={eyebrowStyle}>Model card</div>
      <dl style={{ display: "grid", gap: 6, margin: "10px 0 0" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <dt style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{k}</dt>
            <dd style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "right", margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {/* Iteration 1 E2: the fifth input is named for what recession.py
          computes (T10YIE − T5YIE), and the series it stands in for. */}
      <Caption>
        The fifth input is the <Jargon term="LEI">{BREAKEVEN_LABEL}</Jargon> (T10YIE − T5YIE),
        standing in for the Conference Board leading index (USSLIND), which stopped publishing in
        February 2020.
      </Caption>
    </Card>
  );
}

export default function TransparencyPanel({ m, status }: RecessionPanelProps): JSX.Element {
  const ready = status === "ready" && m != null;
  return (
    <Card as="section" variant="panel" id="transparency" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Model transparency"
        description="Coefficients and training details"
        right="coefficients · training metadata"
        actions={
          <Link className="mrr-link" to="/app/methodology#models">
            Methodology →
          </Link>
        }
      />
      {ready && m ? (
        <div style={{ display: "grid", gap: "var(--gap-tile)" }}>
          <CoefficientsTile m={m} />
          <DivergenceTile m={m} />
          <ModelCardTile m={m} />
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
