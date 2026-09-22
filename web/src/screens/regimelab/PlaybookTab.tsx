/**
 * Playbook sub-tab (redesign Phase 4, checklist 04 B.7): the regime playbook
 * from the literature, rebuilt on Phase 2 components. Moved from
 * RegimeLabScreen.tsx PlaybookSection: the regime selector is a mono
 * Segmented with " ← now" on the classifier's current call, the sector tilts
 * are MeterRows under overweight / underweight group labels, the asset
 * performance list is a DataTable, and every caption keeps its copy except
 * the two "below" references that now point at other sub-tabs (C.2).
 *
 * Static reference content: nothing here is live data, and the header says
 * so. The tab owns its hooks; React Query dedupes `useRegimeLatest` with the
 * screen's own call.
 */

import { useState, type CSSProperties } from "react";
import { Card, DataTable, MeterRow, SectionHeader, Segmented } from "../../components";
import { useRegimeLatest, useRegimePlaybooks } from "../../api/queries";
import type { AssetPerf, RegimePlaybook } from "../../api/types";
import { tidyProse } from "../../lib/format";
import { Caption, StateNote, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import { referenceLabel } from "../shared/fresh-state";
import { MetaWithStamp, Stamp } from "../shared/Stamp";
import { REGIMES } from "./regime-history";

/** Playbook prose: 13px Plex Sans in --text-2 (the tile body voice). */
const proseStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--text-2)",
};

/** One "· item" line in a risk group. */
const itemStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-3)",
};

/** The first sub-eyebrow in a tile sits flush with the tile padding. */
const firstSub: CSSProperties = { marginTop: 0 };

interface AssetRow extends AssetPerf {
  id: string;
  asset: string;
}

/** Asset / Avg return / Hit rate: the same strings as the old two-column
 * list, now tabular. Colour by sign lives in `render`, never in the data. */
const ASSET_COLUMNS = [
  { key: "asset", label: "Asset" },
  {
    key: "avg_return",
    label: "Avg return",
    align: "right" as const,
    mono: true,
    render: (r: AssetRow) => (
      <span style={{ color: r.avg_return >= 0 ? "var(--pos)" : "var(--neg)" }}>
        {r.avg_return >= 0 ? "+" : ""}
        {r.avg_return.toFixed(1)}%/yr
      </span>
    ),
  },
  {
    key: "hit_rate",
    label: "Hit rate",
    align: "right" as const,
    mono: true,
    render: (r: AssetRow) => `${r.hit_rate.toFixed(0)}% hit`,
  },
];

/** The four risk groups, three items each (today's rendered content), with
 * the same colours as before (`--accent` is now `--link`). */
const RISK_GROUPS: readonly [string, keyof Pick<RegimePlaybook, "key_risks" | "warning_signs" | "typical_catalysts" | "opportunities">, string][] = [
  ["Key risks", "key_risks", "var(--neg)"],
  ["Warning signs", "warning_signs", "var(--amber)"],
  ["Typical catalysts", "typical_catalysts", "var(--link)"],
  ["Opportunities", "opportunities", "var(--pos)"],
];

export default function PlaybookTab() {
  const q = useRegimePlaybooks();
  const regime = useRegimeLatest();
  const currentRegime = regime.data?.label;
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? currentRegime ?? "Goldilocks";
  const pb = q.data?.[active];

  return (
    <Card as="section" variant="panel" id="playbook" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Playbook"
        right={
          <MetaWithStamp
            meta="Static reference · regime literature, not live data"
            stamp={<Stamp source="Regime literature" label={referenceLabel("The playbooks are reference content with no publication cadence.")} />}
          />
        }
        actions={
          <Segmented
            mono
            label="Playbook regime"
            value={active}
            onChange={(id) => setSelected(id)}
            options={REGIMES.map((r) => ({ id: r, label: r === currentRegime ? `${r} ← now` : r }))}
          />
        }
      />
      {pb ? (
        /* .mrr-lab-playbook (app.css, A.11): 1.3fr / 1fr / 1fr, one column below 768. */
        <div className="mrr-lab-playbook">
          <Card variant="tile" style={{ minWidth: 0 }}>
            <div style={proseStyle}>{tidyProse(pb.description)}</div>
            <div style={{ ...monoNoteStyle, marginTop: 8 }}>
              ~{pb.historical_frequency.toFixed(0)}% of months in the literature · literature avg spell{" "}
              {pb.avg_duration_months.toFixed(1)}mo; the measured number lives in Cycle position on the Overview
            </div>
            <div style={{ marginTop: 10 }}>
              <DataTable
                compact
                zebra={false}
                caption="Asset performance in this regime"
                columns={ASSET_COLUMNS}
                rows={Object.entries(pb.asset_performance).map(([asset, p]): AssetRow => ({ id: asset, asset, ...p }))}
              />
            </div>
            <Caption>
              Typical tape: curve {pb.typical_indicators.yield_curve?.toLowerCase()}, spreads{" "}
              {pb.typical_indicators.credit_spreads?.toLowerCase()}, VIX {pb.typical_indicators.vix_regime?.toLowerCase()}.
              Reference numbers from the regime literature; the Empirical evidence view is what this app measured itself.
            </Caption>
          </Card>

          <Card variant="tile" style={{ minWidth: 0 }}>
            <SectionHeader level="sub" as="h3" title="Sector tilts · strength 0–100" style={firstSub} />
            {(["overweight", "underweight"] as const).map((side, i) => (
              <div key={side} style={{ marginTop: i === 0 ? 0 : 10 }}>
                <div style={{ ...eyebrowStyle, color: side === "overweight" ? "var(--pos)" : "var(--neg)", marginBottom: 2 }}>{side}</div>
                {pb.sector_tilts[side].map((t) => (
                  <MeterRow
                    key={t.sector}
                    label={t.sector}
                    pct={Math.min(t.strength, 100)}
                    tone={side === "overweight" ? "pos" : "neg"}
                    value={t.strength}
                    valueSize="sm"
                    valueWidth={34}
                    labelWidth={150}
                  />
                ))}
              </div>
            ))}
            <Caption>Tilt strength runs 0–100: conviction of the tilt in this playbook, not a return forecast.</Caption>
          </Card>

          <Card variant="tile" style={{ minWidth: 0 }}>
            <SectionHeader level="sub" as="h3" title="Risks & catalysts" style={firstSub} />
            <div style={{ display: "grid", gap: 8 }}>
              {RISK_GROUPS.map(([label, field, color]) => (
                <div key={label}>
                  <div style={{ ...eyebrowStyle, color }}>{label}</div>
                  {pb[field].slice(0, 3).map((it) => (
                    <div key={it} style={itemStyle}>
                      · {it}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
    </Card>
  );
}
