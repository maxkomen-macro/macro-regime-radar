/**
 * Key levels (redesign Phase 3, checklist 03 B.4): the seven tiles under
 * Monitored signals. Every tile is a StatTile with its desk-note caption
 * kept verbatim (U-CAP); the 2s10s and recession tiles keep their band tone as
 * a tile border tint, with the number and the band word carrying the meaning.
 *
 * Iteration 1 (G2): columns come from `.mrr-dash-levels` in app.css, read
 * from the dashboard's width. The five level tiles (one-line captions) share
 * a row and the two model-reading tiles (`.mrr-level-wide`, three-line
 * captions) share the next at half width each, so tiles of one row carry
 * captions of one length; the old single row of seven stretched the short
 * tiles to the long captions' height (60 to 99 px tails).
 */

import type { UseQueryResult } from "@tanstack/react-query";
import { Card, SectionHeader, StatTile } from "../../components";
import type { CreditOAS, RecessionMetrics, Regime } from "../../api/types";
import { fmtBps, fmtDate, fmtMonYr, fmtPct, fmtSigned, ordinal } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, MISSING, missingNote, useSnapshotMode } from "../shared/screen-ui";
import { DASH } from "./hero-copy";

export interface SeriesLatest {
  series_id: string;
  date: string;
  value: number;
}

export interface KeyLevelsProps {
  regime: UseQueryResult<Regime>;
  recession: UseQueryResult<RecessionMetrics>;
  credit: UseQueryResult<CreditOAS>;
  fedFunds: UseQueryResult<SeriesLatest>;
  vix: UseQueryResult<SeriesLatest>;
}

type Tone = "default" | "watch" | "risk" | "clear";

function recessionTone(label: string | undefined): Tone {
  if (!label) return "default";
  if (label.includes("High")) return "risk";
  if (label.includes("Elevated")) return "watch";
  return "clear";
}

export default function KeyLevels({ regime, recession, credit, fedFunds, vix }: KeyLevelsProps) {
  const r = regime.data;
  const rec = recession.data;
  const ten = credit.data?.series.find((s) => s.label === "UST10Y");
  const snapshot = useSnapshotMode();

  return (
    <Card as="section" id="key-levels" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Key levels" right={credit.data?.as_of ? `FRED · latest ${fmtDate(credit.data.as_of)}` : "FRED"} />
      <div className="mrr-dash-levels">
        <Card variant="tile">
          <StatTile label="Fed funds" value={fedFunds.data ? fmtPct(fedFunds.data.value) : DASH} size="sm" />
          <Caption>
            Overnight policy rate · monthly average
            {fedFunds.data ? ` · ${fmtMonYr(fedFunds.data.date)}` : ""}.
          </Caption>
        </Card>

        <Card variant="tile">
          <StatTile
            label="Growth trend"
            value={r?.growth_trend != null ? fmtSigned(r.growth_trend) : DASH}
            direction={r?.growth_trend != null && r.growth_trend >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>
            3-month slope of the industrial-production <Jargon term="z-score">z-score</Jargon>; feeds the regime call.
          </Caption>
        </Card>

        <Card variant="tile">
          <StatTile
            label="Inflation trend"
            value={r?.inflation_trend != null ? fmtSigned(r.inflation_trend) : DASH}
            direction={r?.inflation_trend != null && r.inflation_trend >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>
            3-month slope of the CPI <Jargon term="z-score">z-score</Jargon>; feeds the regime call.
          </Caption>
        </Card>

        <Card variant="tile">
          <StatTile
            label="10Y Treasury"
            value={ten ? fmtPct(ten.value_pct) : DASH}
            delta={ten?.change_1w_bps != null ? `${fmtBps(ten.change_1w_bps)} 1w` : undefined}
            direction={ten?.change_1w_bps != null && ten.change_1w_bps >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>Benchmark long rate · daily close.</Caption>
        </Card>

        <Card variant="tile">
          <StatTile label="VIX" value={vix.data ? vix.data.value.toFixed(2) : DASH} size="sm" />
          <Caption>
            <Jargon term="VIX">VIX</Jargon> · daily close
            {vix.data ? ` · ${fmtDate(vix.data.date)}` : ""}.
          </Caption>
        </Card>

        <Card variant="tile" className="mrr-level-wide" tone={rec ? (rec.is_inverted ? "risk" : "clear") : "default"}>
          <StatTile label="Yield curve 2s10s" value={rec?.yield_curve_spread != null ? fmtBps(rec.yield_curve_spread) : DASH} size="sm" />
          <Caption>
            {rec?.yield_curve_spread != null ? (
              <>
                The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at {fmtBps(rec.yield_curve_spread)} ({fmtPct(rec.yield_curve_spread / 100)})
                {rec.yield_curve_pct_rank != null ? `, the ${ordinal(rec.yield_curve_pct_rank)} percentile of the model's monthly history` : ""}. Below 0
                is an inversion, the classic pre-recession shape.
              </>
            ) : recession.isError ? (
              missingNote(MISSING.curve, snapshot)
            ) : (
              "Curve data arrives with the recession model response."
            )}
          </Caption>
        </Card>

        <Card variant="tile" className="mrr-level-wide" tone={recessionTone(rec?.recession_label)}>
          <StatTile
            label="Recession model · 12m"
            value={rec?.recession_prob != null ? `${rec.recession_prob.toFixed(1)}%` : recession.isError ? DASH : "…"}
            size="sm"
          />
          <Caption>
            {rec?.recession_prob != null ? (
              <>
                {rec.recession_prob.toFixed(1)}% sits in the {rec.recession_label} band (Elevated starts at 20%, High at 40%). The{" "}
                <Jargon term="recession model">model</Jargon> trains on <Jargon term="NBER">NBER</Jargon> dates; inputs through{" "}
                {fmtMonYr(rec.data_as_of)}.
              </>
            ) : recession.isError ? (
              missingNote(MISSING.recession, snapshot)
            ) : (
              "Training the recession model; the first call takes about a second."
            )}
          </Caption>
        </Card>
      </div>
    </Card>
  );
}
