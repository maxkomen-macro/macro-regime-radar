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
import { bpsToPct, fmtBps, fmtMonYr, fmtPct, fmtProb, fmtSigned, ordinal } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, MISSING, missingNote, useSnapshotMode } from "../shared/screen-ui";
import { Metric, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import { rateChange } from "../shared/rate-change";
import type { VixShown } from "../shared/vix-shown";
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
  /** fix/freshness 7: the VIX the card shows (shared/vix-shown.ts): the tape's quote and stamp, else the stored
   * close by its true date. Null while neither is on hand. */
  vixRead?: VixShown | null;
}

type Tone = "default" | "watch" | "risk" | "clear";

function recessionTone(label: string | undefined): Tone {
  if (!label) return "default";
  if (label.includes("High")) return "risk";
  if (label.includes("Elevated")) return "watch";
  return "clear";
}

export default function KeyLevels({ regime, recession, credit, fedFunds, vixRead = null }: KeyLevelsProps) {
  const r = regime.data;
  const rec = recession.data;
  const ten = credit.data?.series.find((s) => s.label === "UST10Y");
  const tenChange = rateChange(ten);
  const snapshot = useSnapshotMode();
  // A1: each tile names its own source and as-of; the FRED dates are the
  // server's per-series states (the credit and recession payloads' own
  // blocks first), never the month-stamped row date.
  const report = useFreshReport();
  const classifierStamp = <Stamp block source={SRC.classifier} asOf={r ? fmtMonYr(r.date) : null} />;

  return (
    <Card as="section" id="key-levels" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Key levels" right={vixRead?.source === "quote" ? "FRED · EODHD" : "FRED"} />
      <div className="mrr-dash-levels">
        <Card variant="tile">
          <StatTile label="Fed funds" value={fedFunds.data ? fmtPct(fedFunds.data.value) : DASH} size="sm" />
          <Caption>
            Overnight policy rate · monthly average
            {fedFunds.data ? ` · ${fmtMonYr(fedFunds.data.date)}` : ""}.
          </Caption>
          <Stamp block source={SRC.fred} label={report.series("FEDFUNDS")} />
        </Card>

        <Card variant="tile">
          <StatTile
            label="Growth trend"
            value={r?.growth_trend != null ? fmtSigned(r.growth_trend) : DASH}
            direction={r?.growth_trend != null && r.growth_trend >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>
            Slope of the industrial-production level over the last three monthly readings; its sign feeds the regime call, and the odds use it{" "}
            <Jargon term="z-score">z-scored</Jargon> against its history.
          </Caption>
          {classifierStamp}
        </Card>

        <Card variant="tile">
          <StatTile
            label="Inflation trend"
            value={r?.inflation_trend != null ? fmtSigned(r.inflation_trend) : DASH}
            direction={r?.inflation_trend != null && r.inflation_trend >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>
            Slope of the CPI level over the last three monthly readings; its sign feeds the regime call, and the odds use it{" "}
            <Jargon term="z-score">z-scored</Jargon> against its history.
          </Caption>
          {classifierStamp}
        </Card>

        <Card variant="tile">
          <StatTile
            label="10Y Treasury"
            value={
              ten ? (
                <Metric id="ust10y" value={ten.value_pct}>
                  {fmtPct(ten.value_pct)}
                </Metric>
              ) : (
                DASH
              )
            }
            delta={tenChange ? `${fmtBps(tenChange.bps)} ${tenChange.basis === "1w" ? "1w" : tenChange.tag}` : undefined}
            direction={tenChange != null && tenChange.bps >= 0 ? "up" : "down"}
            size="sm"
          />
          <Caption>Benchmark long rate · daily close.</Caption>
          <Stamp block source={SRC.fred} label={report.series("DGS10", credit.data?.freshness)} />
        </Card>

        <Card variant="tile">
          <StatTile
            label="VIX"
            value={
              vixRead ? (
                // The tape's metric id for a quote (vix-live), the stored close's otherwise (vix).
                <Metric id={vixRead.source === "quote" ? "vix-live" : "vix"} value={vixRead.value}>
                  {vixRead.text}
                </Metric>
              ) : (
                DASH
              )
            }
            size="sm"
          />
          {/* fix/freshness 7: the tape's delayed quote with the tape's own stamp; without one, the FRED close
              labeled "Close · <date>" by its true observation date (never the month stamp), keeping the
              server's freshness state for that series. */}
          <Caption>
            <Jargon term="VIX">VIX</Jargon> · Cboe volatility index · {vixRead?.source === "quote" ? "delayed quote" : "daily close"}.
          </Caption>
          {vixRead?.source === "quote" ? (
            <Stamp block source="EODHD VIX" asOf={vixRead.stamp} />
          ) : (
            <Stamp block source={SRC.fred} label={vixRead ? { ...report.series("VIXCLS"), word: vixRead.stamp } : report.series("VIXCLS")} />
          )}
        </Card>

        <Card variant="tile" className="mrr-level-wide" tone={rec ? (rec.is_inverted ? "risk" : "clear") : "default"}>
          <StatTile label="Yield curve 2s10s" value={rec?.yield_curve_spread != null ? fmtBps(rec.yield_curve_spread) : DASH} size="sm" />
          <Caption>
            {rec?.yield_curve_spread != null ? (
              <>
                The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at {fmtBps(rec.yield_curve_spread)} ({fmtPct(bpsToPct(rec.yield_curve_spread))})
                {rec.yield_curve_pct_rank != null ? `, the ${ordinal(rec.yield_curve_pct_rank)} percentile of the model's monthly history` : ""}. Below 0
                is an inversion, the classic pre-recession shape.
              </>
            ) : recession.isError ? (
              missingNote(MISSING.curve, snapshot)
            ) : (
              "Curve data arrives with the recession model response."
            )}
          </Caption>
          <Stamp block source={SRC.fred} label={report.group(["DGS10", "DGS2"], rec?.freshness)} />
        </Card>

        <Card variant="tile" className="mrr-level-wide" tone={recessionTone(rec?.recession_label)}>
          <StatTile
            label="Recession odds · this month"
            value={
              rec?.recession_prob != null ? (
                <Metric id="recession-prob" value={rec.recession_prob}>
                  {fmtProb(rec.recession_prob, "percent", 1)}
                </Metric>
              ) : recession.isError ? (
                DASH
              ) : (
                "…"
              )
            }
            size="sm"
          />
          <Caption>
            {rec?.recession_prob != null ? (
              <>
                {fmtProb(rec.recession_prob, "percent", 1)} sits in the {rec.recession_label} band (Elevated starts at 20%, High at 40%). The{" "}
                <Jargon term="recession model">model</Jargon> scores this month from inputs three months old, trained on{" "}
                <Jargon term="NBER">NBER</Jargon> dates; inputs through {rec.inputs_through ? fmtMonYr(`${rec.inputs_through}-01`) : fmtMonYr(rec.data_as_of)}.
              </>
            ) : recession.isError ? (
              missingNote(MISSING.recession, snapshot)
            ) : (
              "Training the recession model; the first call takes about a second."
            )}
          </Caption>
          <Stamp block source={SRC.recession} asOf={rec ? fmtMonYr(rec.data_as_of) : null} />
        </Card>
      </div>
    </Card>
  );
}
