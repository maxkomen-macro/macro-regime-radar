/**
 * Risk analysis, `Card as="section" id="allocation-risk"` (redesign Phase 9,
 * checklist 09 B.12): one lens at a time behind a mono Segmented (four
 * primary lenses, four more behind "More lenses ▸"), every lens keeping its
 * data, its StateNote and its caption from the pre-redesign panel, restyled
 * onto MeterRow, DataTable and HeatMatrix. The Style and Correlation pickers
 * default to the current regime; the picked regime and pair survive a lens
 * switch because the state lives here, not in the lens.
 *
 * Every read of the payload is null-safe against the legacy fixture keys
 * (`portfolio_factors`, `style_performance`, `currency_impact` absent;
 * `real_nominal` null): a missing block renders its sentence, never a blank.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, DataTable, HeatMatrix, MeterRow, SectionHeader, Segmented } from "../../components";
import type { DataTableColumn } from "../../components/data/DataTable";
import type { HeatCell } from "../../components/data/HeatMatrix";
import type { AllocationData } from "../../api/types";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Jargon from "../shared/Jargon";
import ScrollTable from "../shared/ScrollTable";
import { Caption, StateNote, eyebrowStyle, metaStyle, monoNoteStyle } from "../shared/screen-ui";
import {
  DASH,
  METHODS,
  REGIME_HUE,
  RISK_BLOCKS,
  corrTint,
  frameCell,
  isFallback,
  optimizationsOf,
  pct,
  regimesOf,
  spct,
  type RiskBlockId,
} from "./AllocationPanel";

/** The pressed regime option wears its hue; the others keep the control's own text colour. */
function regimeOptions(regimes: string[], pressed: string) {
  return regimes.map((r) => ({
    id: r,
    label: r === pressed ? <span style={{ color: REGIME_HUE[r] ?? "var(--text)" }}>{r}</span> : r,
  }));
}

const pickerRow: React.CSSProperties = { display: "flex", gap: 10, marginBottom: 8, alignItems: "center", flexWrap: "wrap" };

export default function RiskLenses({ a }: { a: AllocationData }) {
  const { isNarrow } = useBreakpoint();
  const [riskBlock, setRiskBlock] = useState<RiskBlockId>("tail");
  const [moreLenses, setMoreLenses] = useState(false);
  const [corrRegime, setCorrRegime] = useState<string | null>(null);
  const [styleRegime, setStyleRegime] = useState<string | null>(null);
  const [transPair, setTransPair] = useState<string | null>(null);

  const regimes = regimesOf(a);
  const curRegime = a.current_regime;
  const effCorrRegime = corrRegime ?? curRegime;
  const effStyleRegime = styleRegime ?? curRegime;

  let lens: React.ReactNode;
  switch (riskBlock) {
    case "tail":
      lens = <TailLens a={a} isNarrow={isNarrow} />;
      break;
    case "drawdowns":
      lens = <DrawdownLens a={a} />;
      break;
    case "correlation":
      lens = <CorrelationLens a={a} regimes={regimes} regime={effCorrRegime} onRegime={setCorrRegime} />;
      break;
    case "factors":
      lens = <FactorsLens a={a} />;
      break;
    case "style":
      lens = <StyleLens a={a} regimes={regimes} regime={effStyleRegime} onRegime={setStyleRegime} />;
      break;
    case "transitions":
      lens = <TransitionLens a={a} pair={transPair} onPair={setTransPair} isNarrow={isNarrow} />;
      break;
    case "currency":
      lens = <CurrencyLens a={a} regimes={regimes} />;
      break;
    case "real":
      lens = <RealLens a={a} />;
      break;
  }

  return (
    <Card as="section" id="allocation-risk" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Risk analysis" right="one lens at a time · four primary, four more on request" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Segmented
          mono
          label="Risk lens"
          value={riskBlock}
          onChange={(id) => setRiskBlock(id as RiskBlockId)}
          options={RISK_BLOCKS.filter((b) => b.primary || moreLenses || b.id === riskBlock).map((b) => ({ id: b.id, label: b.label }))}
        />
        {!moreLenses ? (
          <button
            type="button"
            className="mrr-btn"
            data-touch={isNarrow ? "true" : "false"}
            onClick={() => setMoreLenses(true)}
            aria-expanded={false}
          >
            More lenses ▸
          </button>
        ) : null}
      </div>
      {lens}
    </Card>
  );
}

/* ── Tail risk ─────────────────────────────────────────────────────────── */

/** MeterRow label column: 150px at desk; 100px below 768 so a phone-width
 * tile (about 280px of content) still leaves the meter track room to draw
 * (long asset names ellipsize inside MeterRow's label cell). */
const meterLabelWidth = (isNarrow: boolean) => (isNarrow ? 100 : 150);

function TailLens({ a, isNarrow }: { a: AllocationData; isNarrow: boolean }) {
  const opt = optimizationsOf(a);
  const curRegime = a.current_regime;
  const labelWidth = meterLabelWidth(isNarrow);
  const valueWidth = isNarrow ? 60 : 70;
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,1.4fr) minmax(0,1fr)", gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Asset tail risk · monthly, 95%</div>
          {/* The header row mirrors MeterRow's four tracks (label · meter ·
              value · delta) so CVaR sits over the value and VaR over the delta. */}
          <div style={{ display: "grid", gridTemplateColumns: `${labelWidth}px minmax(0,1fr) ${valueWidth}px 58px`, gap: 10, marginBottom: 2 }}>
            <span />
            <span />
            <span style={{ ...metaStyle, textAlign: "right" }}>CVaR</span>
            <span style={{ ...metaStyle, textAlign: "right" }}>VaR</span>
          </div>
          {Object.entries(a.cvar_95?.asset_cvar ?? {}).map(([asset, c]) => (
            <MeterRow
              key={asset}
              label={asset}
              pct={Math.min((Math.abs(c.cvar) / 0.2) * 100, 100)}
              tone="neg"
              value={<span style={{ color: "var(--neg)" }}>{spct(c.cvar)}</span>}
              delta={spct(c.var)}
              deltaTone="neutral"
              labelWidth={labelWidth}
              valueWidth={valueWidth}
            />
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Portfolio CVaR by method</div>
          <div style={{ display: "grid", gap: 6 }}>
            {METHODS.map((m) => {
              const o = opt?.[m.key];
              const pc = o?.cvar_95?.cvar ?? null;
              // With weights on file, a method with no portfolio CVaR is
              // dropped as before; with no weights at all every method
              // keeps its row and prints the house dash.
              if (opt && pc == null) return null;
              return (
                <div key={m.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)" }}>
                    {m.label}
                    {isFallback(o) ? " (fallback)" : ""}
                  </span>
                  <span style={{ ...monoNoteStyle, color: pc != null ? "var(--neg)" : "var(--text-3)" }}>
                    {pc != null ? spct(pc) : DASH}
                  </span>
                </div>
              );
            })}
          </div>
          {!opt && (
            <Caption>
              Portfolio CVaR weights the assets by an optimizer solution; there is none for{" "}
              {curRegime} this session, so every method reads —.
            </Caption>
          )}
        </div>
      </div>
      <Caption>
        <Jargon term="CVaR">CVaR</Jargon> is the average loss in the worst 5% of months, deeper
        than VaR, which is only the doorway into them. Bars scale to a −20% monthly loss.
      </Caption>
    </Card>
  );
}

/* ── Drawdowns ─────────────────────────────────────────────────────────── */

type DrawdownRow = { id: string; asset: string; overall: number | null } & Record<string, unknown>;

function drawdownColor(v: number | null): string {
  if (v == null) return "var(--text-3)";
  if (v < -0.3) return "var(--neg)";
  if (v < -0.15) return "var(--warn-hot)";
  return "var(--text-3)";
}

function DrawdownLens({ a }: { a: AllocationData }) {
  const frame = a.drawdowns?.by_regime;
  if (!frame?.columns) {
    return (
      <Card variant="tile" style={{ minWidth: 0 }}>
        <StateNote>Drawdown history unavailable in this payload.</StateNote>
      </Card>
    );
  }
  const columns: DataTableColumn[] = [
    { key: "asset", label: "Asset" },
    ...frame.columns.map((c) => ({
      key: `r:${c}`,
      label: c,
      align: "right" as const,
      mono: true,
      render: (row: DrawdownRow) => {
        const v = row[`r:${c}`] as number | null;
        return <span style={{ color: drawdownColor(v) }}>{v != null ? spct(v) : DASH}</span>;
      },
    })),
    {
      key: "overall",
      label: "Overall",
      align: "right",
      mono: true,
      render: (row: DrawdownRow) => (
        <span style={{ fontWeight: 600, color: (row.overall ?? 0) < -0.3 ? "var(--neg)" : "var(--text)" }}>
          {row.overall != null ? spct(row.overall) : DASH}
        </span>
      ),
    },
  ];
  const rows: DrawdownRow[] = frame.index.map((asset, ri) => {
    const name = String(asset);
    const row: DrawdownRow = { id: name, asset: name, overall: a.drawdowns.overall?.[name] ?? null };
    for (const c of frame.columns) row[`r:${c}`] = frameCell(frame, ri, c);
    return row;
  });
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Maximum drawdown · by regime and overall</div>
      <ScrollTable label="Maximum drawdown by regime and overall">
        <DataTable compact zebra={false} caption="Maximum drawdown by regime and overall" columns={columns} rows={rows} style={{ minWidth: 560 }} />
      </ScrollTable>
      <Caption>
        Worst peak-to-trough loss per asset, split by the regime it happened in. A −50%{" "}
        <Jargon term="drawdown">drawdown</Jargon> needs +100% to recover; the asymmetry is
        the whole argument for risk budgeting.
      </Caption>
    </Card>
  );
}

/* ── Correlation ───────────────────────────────────────────────────────── */

function CorrelationLens({
  a,
  regimes,
  regime,
  onRegime,
}: {
  a: AllocationData;
  regimes: string[];
  regime: string;
  onRegime: (r: string) => void;
}) {
  const frame = a.regime_correlations?.[regime];
  // The diagonal is an identity, not a measured correlation: it rides
  // HeatMatrix's missing-value path (null value, "1.00" text) so the cell
  // itself reads faint (--text-4) with no tint, as B.12 asks.
  const cells: HeatCell[][] = frame
    ? frame.index.map((_, ri) =>
        frame.columns.map((_, ci) => {
          const v = frame.data[ri]?.[ci] ?? null;
          if (v == null) return { value: null, text: DASH };
          return ri === ci ? { value: null, text: v.toFixed(2) } : { value: v, text: v.toFixed(2) };
        }),
      )
    : [];
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={pickerRow}>
        <span style={eyebrowStyle}>Correlations in</span>
        <Segmented mono label="Correlation regime" value={regime} onChange={onRegime} options={regimeOptions(regimes, regime)} />
      </div>
      {frame ? (
        /* Ten asset columns at 700px scroll inside their own well on anything
           narrower; the headers clip with an ellipsis (title carries the name). */
        <ScrollTable label={`Asset correlations in ${regime}`}>
          <HeatMatrix
            ariaLabel={`Asset correlations in ${regime}`}
            rowHeaderWidth={130}
            cellHeight={26}
            gap={1}
            rows={frame.index.map((n) => ({ key: String(n), label: String(n) }))}
            cols={frame.columns.map((c) => ({
              key: c,
              label: (
                <span title={c} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.replace("US ", "")}
                </span>
              ),
            }))}
            cells={cells}
            tint={(c, ri, ci) => (ri === ci ? "transparent" : corrTint(c.value))}
            style={{ minWidth: 700 }}
          />
        </ScrollTable>
      ) : (
        <StateNote>Not enough months in this regime for a stable matrix.</StateNote>
      )}
      <Caption>
        Red cells cluster together in stress: diversification that exists on paper
        (Goldilocks) and disappears when needed is the point of checking per regime. Blue
        cells are the true diversifiers.
      </Caption>
    </Card>
  );
}

/* ── Factors ───────────────────────────────────────────────────────────── */

function FactorsLens({ a }: { a: AllocationData }) {
  const opt = optimizationsOf(a);
  const curRegime = a.current_regime;
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      {/* The factor × regime table's single home is Regime Lab →
          Backtests (it appeared verbatim in both places — critique);
          this lens keeps the portfolio-level betas. */}
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Portfolio factor exposures · OLS betas</div>
      <div style={{ display: "grid", gap: 6 }}>
        {METHODS.filter((m) => a.portfolio_factors?.[m.key]).map((m) => {
          const pf = a.portfolio_factors?.[m.key];
          if (!pf) return null;
          const fb = isFallback(opt?.[m.key]);
          return (
            <div key={m.key} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)", minWidth: 130 }}>
                {m.label}
                {fb ? <span style={{ color: "var(--text-3)" }}> (fallback)</span> : ""}
              </span>
              {Object.entries(pf.exposures).map(([f, b]) => (
                <span key={f} style={monoNoteStyle}>
                  {f} <span style={{ color: b >= 0 ? "var(--text)" : "var(--neg)" }}>{b >= 0 ? "+" : ""}{b.toFixed(2)}</span>
                </span>
              ))}
              <span style={{ ...monoNoteStyle, marginLeft: "auto" }}>
                <Jargon term="R²">R²</Jargon> {pf.r_squared.toFixed(2)} ·{" "}
                <Jargon term="alpha">α</Jargon> {spct(pf.alpha)}/yr
              </span>
            </div>
          );
        })}
      </div>
      {!opt && (
        /* Betas are regressed on optimizer weights upstream, so this grid
           ships empty alongside a null optimization block — say it rather
           than leave the lens blank. */
        <StateNote>
          Portfolio betas are regressed on the optimizer weights; with none for {curRegime}{" "}
          this session there are no portfolio rows to show.
        </StateNote>
      )}
      <Caption>
        Factors are long/short ETF proxies (Value IWD−IWF, Momentum MTUM−SPY, Quality
        QUAL−SPY, Size IWM−SPY, Low Vol USMV−SPY): the Fama-French idea without their data
        files, labeled as such. Betas come from OLS on monthly overlaps. The factor × regime
        return table lives on{" "}
        <Link to="/app/regime-lab#backtests" className="mrr-link">
          Regime Lab → Backtests
        </Link>
        .
      </Caption>
    </Card>
  );
}

/* ── Style ─────────────────────────────────────────────────────────────── */

type StyleRow = { id: string; style: string; return: number | null; volatility: number | null; sharpe: number | null; hit_rate: number | null };

/* The two long-short spread rows carry only a return in the source payload,
   so their vol, Sharpe and hit-rate cells read the house dash by design, not
   for missing data. */
const STYLE_COLUMNS: DataTableColumn[] = [
  { key: "style", label: "Style" },
  {
    key: "return",
    label: "Return",
    align: "right",
    mono: true,
    render: (r: StyleRow) =>
      r.return != null ? <span style={{ color: r.return < 0 ? "var(--neg)" : "var(--text)" }}>{spct(r.return)}</span> : DASH,
  },
  {
    key: "volatility",
    label: "Vol",
    align: "right",
    mono: true,
    render: (r: StyleRow) => (r.volatility != null ? <span style={{ color: "var(--text-3)" }}>{pct(r.volatility)}</span> : DASH),
  },
  { key: "sharpe", label: "Sharpe", align: "right", mono: true, render: (r: StyleRow) => (r.sharpe != null ? r.sharpe.toFixed(2) : DASH) },
  {
    key: "hit_rate",
    label: "Hit rate",
    align: "right",
    mono: true,
    render: (r: StyleRow) => (r.hit_rate != null ? <span style={{ color: "var(--text-3)" }}>{pct(r.hit_rate, 0)}</span> : DASH),
  },
];

function StyleLens({
  a,
  regimes,
  regime,
  onRegime,
}: {
  a: AllocationData;
  regimes: string[];
  regime: string;
  onRegime: (r: string) => void;
}) {
  const block = a.style_performance?.[regime];
  const rows: StyleRow[] = block
    ? Object.entries(block)
        .sort((x, y) => (y[1].sharpe ?? 0) - (x[1].sharpe ?? 0))
        .map(([style, s]) => ({
          id: style,
          style,
          return: s.return ?? null,
          volatility: s.volatility ?? null,
          sharpe: s.sharpe ?? null,
          hit_rate: s.hit_rate ?? null,
        }))
    : [];
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={pickerRow}>
        <span style={eyebrowStyle}>Style performance in</span>
        <Segmented mono label="Style regime" value={regime} onChange={onRegime} options={regimeOptions(regimes, regime)} />
      </div>
      {block ? (
        <ScrollTable label="Style performance by regime">
          <DataTable compact zebra={false} caption="Style performance by regime" columns={STYLE_COLUMNS} rows={rows} style={{ minWidth: 440 }} />
        </ScrollTable>
      ) : (
        <StateNote>Style history unavailable for this regime (needs ≥6 months).</StateNote>
      )}
      <Caption>
        Annualized style returns inside {regime} months only.{" "}
        <Jargon term="hit rate">Hit rate</Jargon> is the share of those months that finished
        positive; read it against the month count, not as gospel.
      </Caption>
    </Card>
  );
}

/* ── Transition P&L ────────────────────────────────────────────────────── */

function TransitionLens({
  a,
  pair,
  onPair,
  isNarrow,
}: {
  a: AllocationData;
  pair: string | null;
  onPair: (p: string) => void;
  isNarrow: boolean;
}) {
  const pnl = a.transition_pnl ?? {};
  const transPairs = Object.entries(pnl)
    .filter(([, v]) => v.count >= 2)
    .map(([k]) => k);
  const effPair = pair ?? transPairs[0] ?? null;
  const block = effPair ? pnl[effPair] : undefined;
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={pickerRow}>
        <span style={eyebrowStyle}>Forward 3M returns after</span>
        {transPairs.length ? (
          <Segmented
            mono
            label="Regime switch"
            value={effPair ?? ""}
            onChange={onPair}
            options={transPairs.map((p) => ({ id: p, label: `${p} · n=${pnl[p].count}` }))}
          />
        ) : null}
      </div>
      {effPair && block ? (
        <div>
          {Object.entries(block.avg_return).map(([asset, r]) => (
            <MeterRow
              key={asset}
              label={asset}
              pct={Math.min((Math.abs(r) / 0.15) * 100, 100)}
              tone={r >= 0 ? "pos" : "neg"}
              value={<span style={{ color: r >= 0 ? "var(--pos)" : "var(--neg)" }}>{spct(r)}</span>}
              labelWidth={meterLabelWidth(isNarrow)}
              valueWidth={80}
            />
          ))}
        </div>
      ) : (
        <StateNote>No regime switch has repeated often enough to average (needs n ≥ 2).</StateNote>
      )}
      <Caption>
        Average asset return in the three months after each historical regime switch. Sample
        counts are tiny by nature: this is a map of what happened, not a forecast.
      </Caption>
    </Card>
  );
}

/* ── Currency ──────────────────────────────────────────────────────────── */

type CurrencyCell = { return: number; volatility: number } | null;
type CurrencyRow = { id: string; pair: string } & Record<string, unknown>;

function CurrencyLens({ a, regimes }: { a: AllocationData; regimes: string[] }) {
  const ci = a.currency_impact;
  const has = !!ci && Object.keys(ci).length > 0;
  const pairs = has ? [...new Set(Object.values(ci).flatMap((byPair) => Object.keys(byPair)))] : [];
  const columns: DataTableColumn[] = [
    { key: "pair", label: "Pair" },
    ...regimes.map((r) => ({
      key: `r:${r}`,
      label: r,
      align: "right" as const,
      mono: true,
      render: (row: CurrencyRow) => {
        const c = row[`r:${r}`] as CurrencyCell;
        return c ? (
          <>
            <span style={{ color: c.return < 0 ? "var(--neg)" : "var(--text)" }}>{spct(c.return)}</span>
            <span style={{ color: "var(--text-3)" }}> · σ{pct(c.volatility, 0)}</span>
          </>
        ) : (
          DASH
        );
      },
    })),
  ];
  const rows: CurrencyRow[] = pairs.map((pair) => {
    const row: CurrencyRow = { id: pair, pair };
    for (const r of regimes) row[`r:${r}`] = ci?.[r]?.[pair] ?? null;
    return row;
  });
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Currency moves by regime · annualized</div>
      {has ? (
        <ScrollTable label="Currency moves by regime">
          <DataTable compact zebra={false} caption="Currency moves by regime" columns={columns} rows={rows} style={{ minWidth: 520 }} />
        </ScrollTable>
      ) : (
        <StateNote>Currency history unavailable from the vendor this session.</StateNote>
      )}
      <Caption>
        Dollar strength is a regime variable: EM FX and the majors swing sign across regimes,
        which is what an unhedged international sleeve actually feels.
      </Caption>
    </Card>
  );
}

/* ── Real vs nominal ───────────────────────────────────────────────────── */

type RealRow = { id: string; asset: string; eroded: boolean; nominal: number | null; real: number | null; drag: number };

const REAL_COLUMNS: DataTableColumn[] = [
  {
    key: "asset",
    label: "Asset",
    render: (r: RealRow) => (
      <>
        {r.asset}
        {r.eroded ? <span style={{ color: "var(--amber)" }}> ▪ eroded</span> : ""}
      </>
    ),
  },
  { key: "nominal", label: "Nominal", align: "right", mono: true, render: (r: RealRow) => (r.nominal != null ? spct(r.nominal) : DASH) },
  {
    key: "real",
    label: "Real",
    align: "right",
    mono: true,
    render: (r: RealRow) => (r.real != null ? <span style={{ color: r.real < 0 ? "var(--neg)" : "var(--text)" }}>{spct(r.real)}</span> : DASH),
  },
  { key: "drag", label: "Inflation drag", align: "right", mono: true, render: (r: RealRow) => <span style={{ color: "var(--text-3)" }}>{spct(r.drag)}</span> },
];

function RealLens({ a }: { a: AllocationData }) {
  const curRegime = a.current_regime;
  // The source leaves real_nominal null outright when CPI is missing or the
  // deflation step raises, so every read here goes through the block, not
  // just through the regime key.
  const rn = a.real_nominal?.[curRegime];
  const rows: RealRow[] = rn
    ? Object.keys(rn.nominal ?? {}).map((asset) => {
        const nom = rn.nominal[asset] ?? null;
        const real = rn.real[asset] ?? null;
        return {
          id: asset,
          asset,
          eroded: nom != null && real != null && nom > 0 && real < 0,
          nominal: nom,
          real,
          drag: rn.inflation_drag?.[asset] ?? 0,
        };
      })
    : [];
  return (
    <Card variant="tile" style={{ minWidth: 0 }}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>
        Real vs nominal · {curRegime} months (n={rn?.n_months ?? DASH})
      </div>
      {rn ? (
        <ScrollTable label="Real vs nominal returns by asset">
          <DataTable compact zebra={false} caption="Real vs nominal returns by asset" columns={REAL_COLUMNS} rows={rows} style={{ minWidth: 420 }} />
        </ScrollTable>
      ) : (
        <StateNote>
          {a.real_nominal
            ? "No inflation-adjusted view for this regime."
            : "Real-vs-nominal splits unavailable: the source could not compute them this session."}
        </StateNote>
      )}
      <Caption>
        CPI-deflated returns inside the current regime. ▪ eroded marks assets whose nominal
        gain turns into a real loss: the quiet failure mode of inflationary regimes.
      </Caption>
    </Card>
  );
}
