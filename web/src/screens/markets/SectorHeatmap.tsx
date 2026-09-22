/**
 * Sector heatmap panel (redesign Phase 5, checklist 05 B.5): four stored
 * sector ETFs as tiles, one-day move from the newest stored close with the
 * served one-week figure under it. The tint rule is the app's three-step rule
 * (plain below 1%, one rung from 1%, two from 2%) on the new hues; the label
 * wrapper's innerText stays "XLF · Financials" (label parity, C.3). No hooks:
 * the screen passes its bars and the stored-close date.
 */

import type { CSSProperties } from "react";
import { Card, SectionHeader } from "../../components";
import type { DailyBar } from "../../api/types";
import { fmtSignedPct } from "../../lib/format";
import { Caption, MISSING, StateNote, monoNoteStyle } from "../shared/screen-ui";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import { SECTORS } from "./tape";

interface Props {
  barsBySymbol: ReadonlyMap<string, DailyBar[]>;
  marketDailyDate: string | null;
  /** The stored-close request's state (CP4): with no sector close on hand
   * the panel says whether the closes failed to load or none are stored. */
  status?: "ready" | "loading" | "error";
}

const POS = "40,209,124";
const NEG = "240,80,63";

/** Tint by magnitude: mag 1 the light rung, mag 2 the strong rung, 0 plain. */
function tint(ret: number | null): CSSProperties | undefined {
  if (ret == null) return undefined;
  const mag = Math.abs(ret) >= 2 ? 2 : Math.abs(ret) >= 1 ? 1 : 0;
  if (!mag) return undefined;
  const base = ret >= 0 ? POS : NEG;
  return mag === 2
    ? { background: `linear-gradient(180deg, rgba(${base},.20), rgba(${base},.11))`, borderColor: `rgba(${base},.32)` }
    : { background: `linear-gradient(180deg, rgba(${base},.10), rgba(${base},.055))`, borderColor: `rgba(${base},.22)` };
}

// `marketDailyDate` stays on Props for callers; the header's as-of is the
// stamp's market_daily state (A1), not the newest stored row date.
export default function SectorHeatmap({ barsBySymbol, status = "ready" }: Props) {
  const anyClose = SECTORS.some(({ symbol }) => (barsBySymbol.get(symbol)?.length ?? 0) > 0);
  const report = useFreshReport();
  return (
    <Card as="section" variant="panel" id="sector-heatmap" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Sector heatmap"
        description="One-day moves from stored closes"
        right={<MetaWithStamp meta="daily closes" stamp={<Stamp source={SRC.closes} label={report.series("market_daily")} />} />}
      />
      {/* Four homogeneous tiles: auto-fit reflows them (2-up at 375) with no
          width conditional at all. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: "var(--gap-tile)" }}>
        {SECTORS.map(({ symbol, name }) => {
          const bars = barsBySymbol.get(symbol);
          const last = bars?.length ? bars[bars.length - 1] : undefined;
          const ret = last?.ret_1d ?? null;
          const week = last?.ret_1w ?? null;
          return (
            <Card key={symbol} variant="tile" padding="14px 16px" style={{ minWidth: 0, ...tint(ret) }}>
              {/* One uppercase-styled line (the harvester keys on the transform);
                  the parts read in their own case. Inline children keep the
                  wrapper's innerText at "XLF · Financials". */}
              <div style={{ textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <b style={{ font: "500 15px var(--font-ui)", color: "var(--text)", textTransform: "none" }}>{symbol}</b>
                <span className="desc" style={{ fontSize: 13, color: "var(--text-2)", textTransform: "none" }}>
                  {" "}· {name}
                </span>
              </div>
              <div
                style={{
                  font: "500 26px var(--font-ui)",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-.01em",
                  lineHeight: 1.1,
                  marginTop: 10,
                  color: ret == null ? "var(--text-3)" : ret >= 0 ? "var(--pos)" : "var(--neg)",
                }}
              >
                {ret == null ? "—" : fmtSignedPct(ret)}
              </div>
              {week != null ? <div style={{ ...monoNoteStyle, marginTop: 2 }}>1W {fmtSignedPct(week, 1)}</div> : null}
            </Card>
          );
        })}
      </div>
      {!anyClose && status !== "loading" ? (
        <div style={{ marginTop: 10 }}>
          {status === "error" ? <StateNote error missing={MISSING.closes} /> : <StateNote>No stored sector closes on file yet.</StateNote>}
        </div>
      ) : null}
      <Caption>
        One-day sector moves from stored closes; tint steps at ±1% and ±2%. Sector ETFs are not on the live stream; this
        block moves once a day.
      </Caption>
    </Card>
  );
}
