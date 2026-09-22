/**
 * Card stamps (Iteration 1, A1) and cross-tab metric markers (A2).
 *
 * A1 · every displayed number carries a source and an as-of stamp. A stamp is
 * one short mono meta line, `[data-stamp]`, reading "<source> · <as-of>":
 *
 *   FRED · Sep 17                 a FRED daily series (freshLabel word)
 *   FRED · Aug 2026 print         a monthly print
 *   ICE BofA via FRED · As of unknown   no watermark yet: the honest word
 *   Stored closes · Close · Sep 18
 *   Classifier · Jul 2026         a model output dated by its payload
 *
 * The as-of word for a stored or live series is always a fresh-state.ts
 * label (FRESHNESS_CONTRACT.md §5) over the state the server judged, read
 * through useFreshReport (the endpoint's own `freshness` block when it
 * carries one, else `/api/freshness` series[]; a seeded snapshot reads
 * "Snapshot · as of"). A model output is dated by the date its payload
 * serves (the regime month, the recession model's input month, a backtest's
 * computed date), passed as `asOf`. Nothing here judges freshness itself.
 *
 * A stamp is NOT a caption: it carries no `data-copy` marker, so the G4
 * sentence caps never count it. A card inherits the stamp of its nearest
 * enclosing section when the whole section shares one source and date (the
 * stamp then sits in the section header).
 *
 * A2 · the same metric reads the same everywhere. `metricAttrs` marks each
 * place a shared metric is displayed with `data-metric="<id>"` and
 * `data-metric-value="<the served number, before formatting>"`, so a sweep
 * can compare tabs without parsing the formatted text. The VIX is two
 * measurements: `vix` is the stored FRED VIXCLS daily close (Dashboard), and
 * `vix-live` the relay's delayed CBOE poll (Markets), which is always
 * labelled as the delayed quote where it shows, never under a bare "VIX".
 */

import type { CSSProperties, ReactNode } from "react";
import type { Regime } from "../../api/types";
import type { QuoteCardProps, QuoteVia } from "../shell/QuoteCard";
import { freshLabel, type FreshLabel, type FreshTone } from "./fresh-state";
import type { FreshReport } from "./useFreshReport";

/* ── Sources ────────────────────────────────────────────────────────────── */

/** The source names a stamp prints: one vocabulary across every tab. */
export const SRC = {
  fred: "FRED",
  baml: "ICE BofA via FRED",
  closes: "Stored closes",
  intraday: "Stored intraday bars",
  eodhd: "EODHD",
  classifier: "Classifier",
  classifierHistory: "Classifier history",
  recession: "Recession model",
  model: "Model",
  lbo: "LBO model",
  allocation: "Allocation engine",
  backtests: "Backtests",
  derived: "FRED via weekly pipeline",
  surprises: "Weekly derived series",
  news: "Finnhub · NewsAPI · RSS",
  calendar: "Hand-maintained calendar",
  reference: "Reference",
} as const;

/* ── Stamp ───────────────────────────────────────────────────────────────── */

export interface StampProps {
  /** Where the number comes from ("FRED", "Stored closes", "Classifier"). */
  source: string;
  /** The §5 label for the value's series (useFreshReport().series or
   * .group, fresh-state.ts referenceLabel / stampLabel). Absent and no
   * `asOf`: "As of unknown". */
  label?: FreshLabel | null;
  /** A served date for a model output dated by its payload ("Jul 2026");
   * wins over `label`. */
  asOf?: string | null;
  /** A block-level line (under a tile) rather than an inline span. */
  block?: boolean;
  style?: CSSProperties;
  className?: string;
}

type StampTone = FreshTone | "dated";

/** The stamp's words as plain text: "<source> · <word>" plus the muted tail. */
export function stampText({ source, label, asOf }: Pick<StampProps, "source" | "label" | "asOf">): {
  text: string;
  muted: string | null;
  tone: StampTone;
  reason: string;
} {
  if (asOf) return { text: `${source} · ${asOf}`, muted: null, tone: "dated", reason: "" };
  const l = label ?? freshLabel(null);
  return { text: `${source} · ${l.word}`, muted: l.muted, tone: l.tone, reason: l.reason };
}

const TONE_INK: Partial<Record<StampTone, string>> = {
  stale: "var(--warn-hot, var(--amber))",
  live: "var(--mint)",
  delayed: "var(--amber)",
};

/** Mono meta line (the redesign's `.mono-note` ramp): never uppercase, so the
 * source and date read as served and the label harvester never takes a
 * stamp for an eyebrow. */
export const stampStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 400,
  fontSize: 11,
  lineHeight: 1.5,
  letterSpacing: ".02em",
  textTransform: "none",
  color: "var(--text-3)",
  whiteSpace: "normal",
};

/** "<source> · <as-of>", marked `data-stamp`. */
export function Stamp({ source, label, asOf, block = false, style, className }: StampProps) {
  const s = stampText({ source, label, asOf });
  const Tag = block ? "div" : "span";
  return (
    <Tag
      data-stamp=""
      data-stamp-source={source}
      data-stamp-tone={s.tone}
      className={["mrr-stamp", className].filter(Boolean).join(" ")}
      title={s.reason || undefined}
      style={{ ...stampStyle, ...(block ? { marginTop: 8 } : null), ...style }}
    >
      <span style={TONE_INK[s.tone] ? { color: TONE_INK[s.tone] } : undefined}>{s.text}</span>
      {s.muted ? <span style={{ color: "var(--text-4, var(--text-3))" }}> {s.muted}</span> : null}
    </Tag>
  );
}

/** The series whose state words a ladder rung's price reads (§5): a stream
 * quote `live_quotes` (the VIX REST poll `vix_delayed`), a stored intraday
 * bar `market_intraday`, a stored close `market_daily`. */
export function rungSeries(via: QuoteVia | undefined, liveId = "live_quotes"): string | null {
  if (via === "stream") return liveId;
  if (via === "intraday") return "market_intraday";
  if (via === "close") return "market_daily";
  return null;
}

/** The stamp for a price from the quote ladder (shell/quote-ladder.ts): the
 * rung names the source and the series whose state word it prints; the date
 * is the quote's own (`servedAt`: its tick, its bar), never the feed-wide
 * as_of, which is the newest observation of any symbol (Acceptance F1). No
 * rung (no price): no stamp. */
export function quoteStamp(card: Pick<QuoteCardProps, "via" | "servedAt">, report: FreshReport, liveId = "live_quotes"): ReactNode {
  const id = rungSeries(card.via, liveId);
  if (!id) return null;
  const source = card.via === "stream" ? SRC.eodhd : card.via === "intraday" ? SRC.intraday : SRC.closes;
  return <Stamp source={source} label={report.at(id, card.servedAt)} />;
}

/** A section header's meta slot with a stamp after it. The existing meta
 * keeps its own span, so the uppercase label it carries is harvested exactly
 * as before; the stamp follows it in its own case. */
export function MetaWithStamp({ meta, stamp }: { meta?: ReactNode; stamp: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 }}>
      {meta != null && meta !== "" ? <span>{meta}</span> : null}
      {stamp}
    </span>
  );
}

/* ── A2: metric markers ─────────────────────────────────────────────────── */

export type MetricId =
  | "regime"
  | "odds-goldilocks"
  | "odds-overheating"
  | "odds-stagflation"
  | "odds-recession-risk"
  | "recession-prob"
  | "lbo-all-in"
  | "ust10y"
  | "vix"
  | "vix-live"
  | "hy-oas";

/** The classifier's probability keys to their metric ids. */
export const ODDS_METRIC = {
  goldilocks: "odds-goldilocks",
  overheating: "odds-overheating",
  stagflation: "odds-stagflation",
  recession: "odds-recession-risk",
} as const satisfies Record<string, MetricId>;

export type OddsKey = keyof typeof ODDS_METRIC;

/** The classifier's four served probabilities, keyed like ProbabilityBar's
 * `probs`, null where the row serves none (for its `metrics` prop). */
export function servedOdds(r: Regime | null | undefined): Record<OddsKey, number | null> {
  return {
    goldilocks: r?.prob_goldilocks ?? null,
    overheating: r?.prob_overheating ?? null,
    stagflation: r?.prob_stagflation ?? null,
    recession: r?.prob_recession ?? null,
  };
}

/** `data-metric` / `data-metric-value` for one displayed metric: the value is
 * the served number exactly as received (String of the JSON number), before
 * any formatting. Nothing is marked when nothing was served. */
export function metricAttrs(id: MetricId, served: number | string | null | undefined): Record<string, string> {
  if (served == null) return {};
  if (typeof served === "number" && !Number.isFinite(served)) return {};
  return { "data-metric": id, "data-metric-value": String(served) };
}

/** A span carrying the markers around a displayed value. */
export function Metric({ id, value, children, style, title }: { id: MetricId; value: number | string | null | undefined; children: ReactNode; style?: CSSProperties; title?: string }) {
  return (
    <span {...metricAttrs(id, value)} title={title} style={style}>
      {children}
    </span>
  );
}
