/**
 * US 10Y Treasury card (redesign Phase 3, checklist 03 B.6): the one served
 * rate history (`UST10Y.history`, 90 daily closes) as a gradient sparkline
 * under the same value and 1W change the strip prints. Direction, not
 * valence: green is up, red is down, for yields too.
 */

import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, SectionHeader, Sparkline } from "../../components";
import type { CreditOAS } from "../../api/types";
import { fmtBps, fmtDate, fmtPct } from "../../lib/format";
import { Caption, StateNote } from "../shared/screen-ui";
import { DASH } from "./hero-copy";

export interface TenYearCardProps {
  /** `useCreditOas(90)` from the screen. */
  credit: UseQueryResult<CreditOAS>;
}

export default function TenYearCard({ credit }: TenYearCardProps) {
  const ten = credit.data?.series.find((s) => s.label === "UST10Y");
  const dir = ten?.change_1w_bps != null ? (ten.change_1w_bps >= 0 ? "pos" : "neg") : null;
  const color = dir === "pos" ? "var(--pos)" : dir === "neg" ? "var(--neg)" : "var(--text-3)";

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
          {ten ? fmtPct(ten.value_pct) : DASH}
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
      <div style={{ marginTop: 12, flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "flex-end", minWidth: 0 }}>
        {ten ? (
          <Sparkline
            values={ten.history.map((h) => h.value)}
            width={260}
            height={80}
            color={color}
            gradient
            gradientOpacity={0.22}
            strokeWidth={1.5}
            style={{ width: "100%", height: "auto" }}
          />
        ) : (
          <StateNote loading={credit.isLoading} error={credit.isError} />
        )}
      </div>
      <Caption mono style={{ marginTop: 8 }}>
        {ten ? `10-year Treasury yield · FRED ${ten.series_id} · daily close · ${fmtDate(ten.date)}` : "10-year Treasury yield · FRED DGS10 · daily close"}
      </Caption>
    </Card>
  );
}
