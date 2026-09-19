/**
 * Optimization, `Card as="section" id="allocation-optimization"` (redesign
 * Phase 9, checklist 09 B.11). With a served optimizer block: the method
 * Segmented over the seven methods, the selected method's tile beside the
 * "How to read the methods" tile, the efficient frontier (the selection ringed)
 * and the weights-by-method HeatMatrix (the selected column faintly lit, the
 * 30%+ concentration cells in link blue). Without one (a thin live regime):
 * the T27 disclosure, byte-identical, stating the exact sample gate.
 *
 * Weights, the frontier and portfolio CVaR all read the same regime
 * covariance block — when the source can't build it, none of the three
 * exist. The regime matrix above is the primary output; the optimizer is an
 * enhancement that states its exact requirement and stays collapsed
 * (executive pass, 2026-09-05).
 */

import { useState } from "react";
import { Card, HeatMatrix, SectionHeader, Segmented, Tag } from "../../components";
import type { HeatCell } from "../../components/data/HeatMatrix";
import type { AllocationData } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import Jargon from "../shared/Jargon";
import ScrollTable from "../shared/ScrollTable";
import { Caption, StateNote, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import FrontierChart, { type FrontierMarker } from "./FrontierChart";
import { optimizerStatus } from "./allocation-copy";
import {
  DASH,
  METHODS,
  assetNames,
  fmtMonthRange,
  isFallback,
  numberWord,
  optimizationsOf,
  pct,
  spct,
} from "./AllocationPanel";

export default function AllocationOptimization({ a }: { a: AllocationData }) {
  const { isNarrow } = useBreakpoint();
  const [method, setMethod] = useState("mvo");

  const opt = optimizationsOf(a);
  const names = assetNames(a);
  const curRegime = a.current_regime;
  const sample = a.optimizations_skipped ?? a.optimization_sample ?? null;

  return (
    <Card as="section" id="allocation-optimization" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Optimization"
        right={
          <MetaWithStamp
            meta={opt ? "max 40% per asset · long-only" : "optional enhancement · unavailable this session"}
            stamp={<Stamp source={SRC.allocation} asOf={`returns through ${fmtMonYr(`${a.data_end}-01`)}`} />}
          />
        }
      />
      {!opt ? (
        <>
        {/* The T27 row: title, meta and paragraph byte-identical to the
            pre-redesign panel (the button text is an asserted baseline label). */}
        <Disclosure
          title="Optimizer status: no output this session"
          right={
            sample
              ? `${sample.complete_months} of ${sample.total_regime_months} ${curRegime} months complete · ${sample.required_cov_months} required`
              : `needs 24 complete ${curRegime} months · ${a.regime_stats[curRegime]?.n_months ?? 0} on file, fewer than 24 complete`
          }
        >
          <Card variant="tile">
            <p className="mrr-prose" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>
              The seven optimizers (Mean-Variance, Min Variance, Risk Parity, Black-Litterman, HRP, Min CVaR, HERC)
              build a covariance matrix from the current regime&apos;s months inside the{" "}
              {fmtMonYr(`${a.data_start}-01`)} → {fmtMonYr(`${a.data_end}-01`)} return window and need{" "}
              {sample?.required_cov_months ?? 24} {curRegime} months in which all {numberWord(sample?.assets_total ?? names.length)}{" "}
              asset classes have a return (a complete row).{" "}
              {sample ? (
                <>
                  {sample.sentence} {sample.excluded_months} month{sample.excluded_months === 1 ? " is" : "s are"} excluded
                  {sample.excluded_range ? ` (${fmtMonthRange(sample.excluded_range)})` : ""}
                  {sample.assets_responsible.length
                    ? ` because ${sample.assets_responsible
                        .map((r) => `${r.asset} has no return in ${r.missing_months} of them`)
                        .join(", ")}`
                    : ""}
                  ; the complete rows run {sample.complete_range ? fmtMonthRange(sample.complete_range) : "—"}.
                </>
              ) : (
                <>
                  The store holds {a.regime_stats[curRegime]?.n_months ?? 0} {curRegime} months, but fewer than 24 of them
                  are complete across every asset.
                </>
              )}{" "}
              So no weights, no efficient frontier and no portfolio-level CVaR are produced this session. They return
              automatically once enough complete {curRegime} months accumulate or the regime changes to one with a long
              enough history.
            </p>
            <Caption>
              The regime-conditional matrix above and the per-asset risk lenses below never depended on the
              optimizer and stand as stored empirical analysis.
            </Caption>
          </Card>
        </Disclosure>
        {/* The served sample sentence stays visible while the row is closed (the
            pre-redesign panel printed it in the DeskRead ledger); it lives under
            the row, not in the button text, which is an asserted baseline label. */}
        {sample?.sentence ? <Caption>{sample.sentence}</Caption> : null}
        </>
      ) : (
        <Solved a={a} opt={opt} names={names} method={method} onMethod={setMethod} isNarrow={isNarrow} />
      )}
    </Card>
  );
}

function Solved({
  a,
  opt,
  names,
  method,
  onMethod,
  isNarrow,
}: {
  a: AllocationData;
  opt: NonNullable<AllocationData["optimizations"]>;
  names: string[];
  method: string;
  onMethod: (id: string) => void;
  isNarrow: boolean;
}) {
  const served = METHODS.filter((m) => opt[m.key]);
  // A method the state names but the payload does not serve falls back to the
  // first served one, so the pressed option always matches the tile.
  const effMethod = served.some((m) => m.key === method) ? method : served[0]?.key;
  const m = served.find((x) => x.key === effMethod);
  const o = m ? opt[m.key] : undefined;
  const selectedIdx = METHODS.findIndex((x) => x.key === effMethod);

  const status = optimizerStatus(a);
  const fallbacks = status.fallbacks;

  // Plain derivation, deliberately NOT a hook (the old panel's rule): the
  // non-fallback methods with both coordinates, coloured by the token map.
  const frontierMarkers: FrontierMarker[] = METHODS.filter(
    (x) =>
      opt[x.key] &&
      !isFallback(opt[x.key]) &&
      opt[x.key].volatility != null &&
      opt[x.key].expected_return != null,
  ).map((x) => ({
    label: x.label,
    vol: opt[x.key].volatility,
    ret: opt[x.key].expected_return,
    color: x.color,
  }));

  const weightCells: HeatCell[][] = names.map((_, ai) =>
    METHODS.map((x) => {
      const w = opt[x.key]?.weights?.[ai] ?? null;
      return {
        value: w,
        text:
          w != null ? (
            <span style={{ color: w > 0.005 ? "var(--text)" : "var(--text-3)" }}>{Math.round(w * 100)}</span>
          ) : (
            DASH
          ),
      };
    }),
  );

  return (
    <>
      {served.length ? (
        <div style={{ marginBottom: 12 }}>
          <Segmented
            label="Optimization method"
            value={effMethod ?? ""}
            onChange={onMethod}
            options={served.map((x) => ({ id: x.key, label: x.label }))}
          />
        </div>
      ) : null}

      {/* Selected method | how to read: one column below 768. */}
      <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <Card variant="tile" style={{ minWidth: 0 }}>
          {m && o ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={eyebrowStyle}>{m.label}</span>
                <Tag tone={isFallback(o) ? "watch" : "reference"} size="sm">
                  {isFallback(o) ? "fallback" : m.badge}
                </Tag>
              </div>
              <div
                className="num"
                style={{ fontFamily: "var(--font-ui)", fontSize: 30, fontWeight: 500, letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums", lineHeight: 1.1, marginTop: 6 }}
              >
                {o.expected_return != null ? spct(o.expected_return) : DASH}
              </div>
              <div style={{ ...monoNoteStyle, marginTop: 4 }}>
                {/* Fallback paths report sharpe_ratio=0.0 unconditionally —
                    printing it beside +10.5%/8.7% vol is an arithmetic lie
                    (critique P0). A method that ships without the number
                    at all reads the house dash, same as the style box. */}
                vol {o.volatility != null ? pct(o.volatility) : DASH} · SR{" "}
                {isFallback(o) || o.sharpe_ratio == null ? DASH : o.sharpe_ratio.toFixed(2)}
              </div>
              {isFallback(o) && (
                <div style={{ ...monoNoteStyle, fontSize: "var(--fs-micro)", marginTop: 2 }}>
                  equal weight · Sharpe not computed
                </div>
              )}
            </>
          ) : (
            <StateNote />
          )}
        </Card>
        <Card variant="tile" style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>How to read the methods</div>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.6, marginTop: 6 }}>
            Return-seekers (<Jargon term="efficient frontier">Mean-Variance</Jargon>,{" "}
            <Jargon term="Black-Litterman">Black-Litterman</Jargon>) chase the regime&apos;s
            historical returns; risk shops (Min Variance,{" "}
            <Jargon term="risk parity">Risk Parity</Jargon>, <Jargon term="HRP">HRP</Jargon>)
            ignore returns and budget risk; tail methods (<Jargon term="CVaR">Min CVaR</Jargon>,{" "}
            <Jargon term="HERC">HERC</Jargon>) target the worst months.
          </div>
        </Card>
      </div>
      <Caption>
        Seven ways to slice the same {names.length} assets: different questions, not
        better/worse answers.
        {fallbacks.length === 0
          ? " All seven converged this session."
          : ` ${fallbacks.join(" and ")} ${fallbacks.length === 1 ? "is" : "are"} unavailable this session and shown at equal weight, tagged fallback.`}
      </Caption>

      {/* Frontier | weights (3fr / 2fr): one column below 768. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,3fr) minmax(0,2fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        <Card variant="tile" style={{ minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Efficient frontier · annualized risk vs return</div>
          <FrontierChart frontier={opt.frontier} markers={frontierMarkers} selected={m?.label} />
          <Caption>
            The <Jargon term="efficient frontier">frontier</Jargon> is the best return available
            at each volatility under the 40% cap; the marked portfolios are where each method
            lands.
            {fallbacks.length ? ` Equal-weight fallbacks (${fallbacks.join(", ")}) are omitted from the plane.` : ""}
          </Caption>
        </Card>
        <Card variant="tile" style={{ minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Weights by method · %</div>
          {/* Seven method columns plus the asset labels need ~480px; the table
              scrolls inside its own well on a phone. */}
          <ScrollTable label="Weights by method">
            <HeatMatrix
              ariaLabel="Weights by method"
              rowHeaderWidth={130}
              cellHeight={26}
              gap={2}
              rows={names.map((asset) => ({ key: asset, label: asset }))}
              cols={METHODS.map((x) => ({ key: x.key, label: x.key === "black_litterman" ? "B-L" : x.label }))}
              cells={weightCells}
              tint={(c, _ri, ci) =>
                c.value != null && c.value >= 0.3
                  ? "var(--link-a10)"
                  : ci === selectedIdx
                    ? "rgba(38,220,160,.06)"
                    : "transparent"
              }
              style={{ minWidth: 480 }}
            />
          </ScrollTable>
          <Caption>Cells at the 30%+ concentration edge tint blue; zeros sit faint.</Caption>
        </Card>
      </div>
    </>
  );
}
