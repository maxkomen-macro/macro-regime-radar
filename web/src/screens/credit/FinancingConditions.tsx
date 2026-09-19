/**
 * Financing conditions, `<section id="financing">` (redesign Phase 6,
 * checklist 06 B.7): the LBO all-in cost tile (sole owner of the figure;
 * Tools · LBO links here) with the Fed funds + HY OAS stacked bar from
 * `/api/lbo/defaults`, and the classification ladder with the rules listed
 * top-down in check order and today's rule highlighted.
 *
 * Two all-in figures exist (G11): the tile's big number is the credit-metrics
 * string (the resampled monthly read, C20); the bar prints its own components
 * so a difference is visible, never averaged away. Iteration 1 E1: the rate
 * is Fed funds (a monthly average) plus the daily HY spread, never "today's"
 * or "live"; each component carries its own as-of word from the payload's
 * freshness block (fresh-state.ts). The module's stated defaults
 * (`is_fallback` / `status: "fallback"`) are not data: they render no bar.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader, StatTile, Tag } from "../../components";
import type { TagTone } from "../../components/core/Tag";
import { useLboDefaults } from "../../api/queries";
import type { CreditMetrics } from "../../api/types";
import type { FreshLabel } from "../shared/fresh-state";
import { componentAsOf, isStatedDefault } from "../tools/lbo-copy";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, capStyle, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import type { CreditPanelProps } from "./panel-props";

/** The null-value glyph the ledger prints (U+2014), never an em-dash aside. */
const DASH = "—";

/** The ladder top-down in check order (credit.py: Crisis, then Stressed,
 * then Tight, else Normal) with the state colour as an rgb triplet for the
 * current row's wash and outline (mockup credit.html:217). */
const LADDER: { state: string; tone: TagTone; rgb: string; rule: (m: CreditMetrics) => string }[] = [
  { state: "Crisis", tone: "alert", rgb: "240,80,63", rule: () => "HY spread above 700 bps" },
  { state: "Stressed", tone: "watch", rgb: "245,181,46", rule: () => "HY spread above 400 bps" },
  { state: "Tight", tone: "info", rgb: "88,184,230", rule: () => "IG spread above 150 bps" },
  {
    state: "Normal",
    tone: "clear",
    rgb: "38,220,160",
    rule: (m) => {
      const parts = [m.hy_oas != null ? `HY ${Math.round(m.hy_oas)}` : null, m.ig_oas != null ? `IG ${Math.round(m.ig_oas)}` : null].filter(Boolean);
      return `None of the above${parts.length ? ` · ${parts.join(", ")}` : ""}`;
    },
  },
];

function AsOf({ f }: { f: FreshLabel }) {
  return (
    <span data-fresh={f.tone} title={f.reason || undefined} style={{ color: f.stale ? "var(--warn-hot)" : "var(--text-3)" }}>
      {f.word}
      {f.muted ? <span> {f.muted}</span> : null}
    </span>
  );
}

function AllInTile({ m }: { m: CreditMetrics }) {
  const defaults = useLboDefaults();
  const d = defaults.data;
  let bar: ReactNode;
  if (d) {
    if (isStatedDefault(d)) {
      // lbo.py's stated defaults (5.33 / 3.27 / 8.60), not data (G11): the
      // grey "Stated default" badge (FRESHNESS_CONTRACT §5) and no bar.
      bar = (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Tag tone="reference" size="sm">
            Stated default
          </Tag>
          <span style={{ ...monoNoteStyle, marginTop: 0 }}>Rate components unavailable; the all-in figure above is the stored monthly read.</span>
        </div>
      );
    } else {
      const fed = Math.max(0, d.fedfunds);
      const hy = Math.max(0, d.hy_oas_pct);
      const { fed: fedAsOf, hy: hyAsOf } = componentAsOf(d);
      bar = (
        <>
          <div aria-hidden="true" style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 2, margin: "14px 0 8px" }}>
            <i style={{ flex: fed, background: "#b8c6d4" }} />
            <i style={{ flex: hy, background: "var(--amber)" }} />
          </div>
          <div style={{ ...capStyle, marginTop: 0, maxWidth: "none", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>Fed funds {d.fedfunds.toFixed(2)}%</span>
            <span style={{ color: "var(--amber)" }}>HY OAS {d.hy_oas_pct.toFixed(2)}%</span>
          </div>
          {/* E1: each component's own as-of, from the freshness block. */}
          <div data-role="component-as-of" style={{ ...monoNoteStyle, marginTop: 2, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>
              Monthly average · <AsOf f={fedAsOf} />
            </span>
            <span style={{ textAlign: "right" }}>
              Daily · <AsOf f={hyAsOf} />
            </span>
          </div>
          <div style={{ ...monoNoteStyle, marginTop: 6 }}>Fed funds + HY OAS = {d.lbo_all_in_rate.toFixed(2)}%</div>
        </>
      );
    }
  } else {
    bar = (
      <div style={{ marginTop: 14 }}>
        <StateNote loading={defaults.isLoading} error={defaults.isError} />
      </div>
    );
  }
  return (
    <Card variant="tile" padding="14px 18px 10px" style={{ minWidth: 0 }}>
      <StatTile label="LBO all-in cost" value={m.lbo_all_in_cost ?? DASH} size="xl" />
      {bar}
      <Caption>
        Fed Funds plus the high-yield spread: the rough rate a leveraged buyout pays on its debt. Pre-GFC deals borrowed near ~7.2%; the
        2022 peak touched ~11.4%.
      </Caption>
    </Card>
  );
}

function LadderTile({ m }: { m: CreditMetrics }) {
  return (
    <Card variant="tile" padding="12px 14px" style={{ minWidth: 0 }}>
      <div style={{ ...eyebrowStyle, margin: "2px 0 8px 2px" }}>Classification ladder</div>
      {LADDER.map((row, i) => {
        const current = row.state === m.credit_label;
        const last = i === LADDER.length - 1;
        return (
          <div
            key={row.state}
            data-current={current ? "true" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: "96px minmax(0,1fr) auto",
              gap: 12,
              alignItems: "center",
              padding: "9px 12px",
              borderRadius: 8,
              borderBottom: current || last ? undefined : "1px solid var(--line-2)",
              background: current ? `rgba(${row.rgb},.08)` : undefined,
              outline: current ? `1px solid rgba(${row.rgb},.35)` : undefined,
            }}
          >
            <Tag tone={row.tone} style={{ justifySelf: "start" }}>
              {row.state === "Tight" ? <Jargon term="Tight">Tight</Jargon> : row.state}
            </Tag>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)", minWidth: 0 }}>{row.rule(m)}</span>
            <span style={{ ...monoNoteStyle, whiteSpace: "nowrap" }}>{current ? "← today" : ""}</span>
          </div>
        );
      })}
      <Caption>Checked top-down; the first rule that matches names the state.</Caption>
    </Card>
  );
}

export default function FinancingConditions({ m, status }: CreditPanelProps): JSX.Element {
  const ready = status === "ready" && m != null;
  return (
    <Card as="section" variant="panel" id="financing" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Financing conditions"
        description="What a leveraged borrower pays: Fed funds plus the HY spread"
        right="Fed funds (monthly) + HY OAS (daily)"
        actions={
          <Link className="mrr-link" to="/app/tools#lbo">
            Open LBO calculator →
          </Link>
        }
      />
      {ready && m ? (
        <div className="mrr-credit-fin">
          <AllInTile m={m} />
          <LadderTile m={m} />
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
