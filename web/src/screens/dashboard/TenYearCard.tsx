/**
 * US 10Y Treasury card (redesign Phase 3, checklist 03 B.6): the one served
 * rate history (`UST10Y.history`, 90 daily closes) as a gradient sparkline
 * under the same value and 1W change the strip prints. Direction, not
 * valence: green is up, red is down, for yields too.
 *
 * Iteration 1 (G2): the sparkline takes the height the card has, not a fixed
 * 260 × 80 drawing parked at the bottom of a card its row stretched: it is
 * measured and drawn 1:1 (80 px at the least), so no blank band opens
 * between the value and the chart.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, SectionHeader, Sparkline } from "../../components";
import type { CreditOAS } from "../../api/types";
import { fmtBps, fmtPct } from "../../lib/format";
import { StateNote, monoNoteStyle } from "../shared/screen-ui";
import { Metric, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import { DASH } from "./hero-copy";

export interface TenYearCardProps {
  /** `useCreditOas(90)` from the screen. */
  credit: UseQueryResult<CreditOAS>;
}

/** Narrower than this is a layout in flight (HeroChartFrame's rule). */
const MIN_MEASURED_W = 60;

/** The served history drawn at the box its flex slot gives it. */
function FillSparkline({ values, color }: { values: number[]; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w < MIN_MEASURED_W || h < 20) return; // jsdom: keep the fallback drawing
      setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="mrr-ten-spark" style={{ position: "relative", flex: "1 1 auto", minHeight: 80, minWidth: 0, marginTop: 12 }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <Sparkline
          values={values}
          width={box?.w ?? 260}
          height={box?.h ?? 80}
          color={color}
          gradient
          gradientOpacity={0.22}
          strokeWidth={1.5}
          style={box ? undefined : { width: "100%", height: "auto" }}
        />
      </div>
    </div>
  );
}

export default function TenYearCard({ credit }: TenYearCardProps) {
  const ten = credit.data?.series.find((s) => s.label === "UST10Y");
  const dir = ten?.change_1w_bps != null ? (ten.change_1w_bps >= 0 ? "pos" : "neg") : null;
  const color = dir === "pos" ? "var(--pos)" : dir === "neg" ? "var(--neg)" : "var(--text-3)";
  const report = useFreshReport();

  return (
    <Card as="section" id="us10y" variant="panel" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <SectionHeader
        layout="panel"
        title="US 10Y Treasury"
        actions={
          <Link className="mrr-link" to="/app/credit#financing">
            View rates →
          </Link>
        }
      />
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)" }}>US 10 Year Yield</div>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 10px", marginTop: 6 }}>
        <span
          className="num"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-.01em",
            fontVariantNumeric: "tabular-nums",
            color: "var(--text)",
          }}
        >
          {ten ? (
            <Metric id="ust10y" value={ten.value_pct}>
              {fmtPct(ten.value_pct)}
            </Metric>
          ) : (
            DASH
          )}
        </span>
        {ten?.change_1w_bps != null ? (
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums", color }}>
            {fmtBps(ten.change_1w_bps)}{" "}
            <span className="mrr-tag" data-tone="muted" title="Change over one week">
              1W
            </span>
          </span>
        ) : null}
      </div>
      {ten ? (
        <FillSparkline values={ten.history.map((h) => h.value)} color={color} />
      ) : (
        <div style={{ marginTop: 12, flex: "1 1 auto", minWidth: 0 }}>
          <StateNote loading={credit.isLoading} error={credit.isError} />
        </div>
      )}
      {/* A1: the provenance line is the card's stamp (not a caption): the
          as-of word is the server's DGS10 state from the credit payload's own
          block, never the month-stamped row date (FRESHNESS_CONTRACT §3). */}
      <div style={{ ...monoNoteStyle, marginTop: 8 }}>
        10-year Treasury yield · daily close ·{" "}
        <Stamp source={`${SRC.fred} ${ten?.series_id ?? "DGS10"}`} label={report.series(ten?.series_id ?? "DGS10", credit.data?.freshness)} style={{ fontSize: 12 }} />
      </div>
    </Card>
  );
}
