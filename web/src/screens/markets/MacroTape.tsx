/**
 * Macro tape panel (redesign Phase 5, checklist 05 B.7): the `#watchlist`
 * section as a panel Card. The panel header carries the feed status line
 * (moved verbatim from MarketsScreen) and the Macro / Single names
 * `Segmented`; both views are a compact `DataTable` inside a `ScrollTable`
 * well (nine columns at desk width with the symbol column pinned, five on a
 * phone). Row click, the selected rail and the 600 ms tick flash ride
 * `rowProps`; the ticker button is the keyboard and assistive path and its
 * click bubbles to the row handler, so nothing fires twice.
 *
 * Every figure is served or a formatted served value: `dc` / `dd` are the
 * feed's own day-change fields (never arithmetic; a quote with a price but no
 * day change prints the dash), 1W / 1M / the sparkline come from the stored
 * daily bars, the as-of stamp from the quote or the newest bar's date.
 * `rowOf` and the cell renderers live at module level so the 2 Hz quote
 * snapshots allocate nothing new per row (G17).
 */

import { useCallback, useMemo, type ReactNode } from "react";
import { Card, DataTable, SectionHeader, Segmented, Sparkline } from "../../components";
import type { DailyBar } from "../../api/types";
import { LIVE_WINDOW_MS, useQuotes, useStreamStatus, type LiveQuote } from "../../live/quotes";
import { fmtDate, fmtSignedPct } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import ScrollTable from "../shared/ScrollTable";
import { Caption, metaStyle } from "../shared/screen-ui";
import { CHART_PANEL_ID } from "./chart-panel-id";
import {
  MACRO_TAPE,
  SINGLE_NAMES,
  TAPE_GROUPS,
  asOfCell,
  feedWord,
  fmtDayDollar,
  fmtPrice,
  mono,
  toneColor,
  type TapeDef,
} from "./tape";
import { useTickFlash } from "./useTickFlash";

export type TapeView = "macro" | "single-names";

export interface MacroTapeProps {
  /** The screen's `useQuotes()` snapshot. */
  quotes: ReadonlyMap<string, LiveQuote>;
  /** The screen's `barsBySymbol` memo (stored daily bars per symbol, as served). */
  barsBySymbol: ReadonlyMap<string, DailyBar[]>;
  /** `singlesSorted` from the screen: SINGLE_NAMES sorted by day move, unquoted last. */
  singles: TapeDef[];
  /** Symbol whose chart panel is open, or null. */
  selected: string | null;
  /** Row click and ticker-button click (the screen's `toggleSelect`). */
  onSelect: (symbol: string) => void;
  view: TapeView;
  onViewChange: (view: TapeView) => void;
  /** Ref callback for each ticker button so the screen can return focus after Esc. */
  registerRow: (symbol: string, el: HTMLButtonElement | null) => void;
  /** `usLive`: the sort meta reads "re-sorts live" vs "as data updates". */
  live: boolean;
  /** `marketDailyDate` for the caption's "through {date}". */
  storedThrough: string | null;
}

/* ── feed status line (moved verbatim from MarketsScreen, M29) ─────────── */

export function FeedStatusLine(): JSX.Element {
  const status = useStreamStatus();
  const quotes = useQuotes();
  const liveByFeed = useMemo(() => {
    const now = Date.now();
    const live = { us: false, crypto: false, forex: false };
    for (const def of [...MACRO_TAPE, ...SINGLE_NAMES]) {
      const q = quotes.get(def.symbol);
      if (q?.src === "ws" && q.t != null && now - q.t < LIVE_WINDOW_MS && def.feed !== "vix") {
        live[def.feed as "us" | "crypto" | "forex"] = true;
      }
    }
    return live;
  }, [quotes]);

  const seg = (label: string, s: { text: string; color: string }) => (
    <span key={label}>
      <span style={{ color: "var(--text-muted)" }}>{label} </span>
      <span style={{ color: s.color }}>{s.text}</span>
    </span>
  );
  // The honesty widget must not outlive its transport: with the relay socket
  // down, per-feed states are stale claims — say the stream is down instead
  // (critique P1: a dead API rendered "CONNECTED" forever).
  if (status.socket !== "open") {
    // One honest phrase whether the socket is mid-retry or down: the rows
    // print stored closes with their dates either way.
    return (
      <span style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", color: "var(--warn-hot)" }}>
        stream unavailable · showing stored closes
      </span>
    );
  }
  // flexWrap is the one addition (Phase 5): in the 432px tape column the four
  // feed words share the panel header with the view toggle, so they wrap
  // instead of running past the panel edge.
  return (
    <span style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", display: "inline-flex", gap: 14, flexWrap: "wrap" }}>
      {seg("US", feedWord("us", status.feeds.us, liveByFeed.us))}
      {seg("CRYPTO", feedWord("crypto", status.feeds.crypto, liveByFeed.crypto))}
      {seg("FX", feedWord("forex", status.feeds.forex, liveByFeed.forex))}
      {seg("VIX", feedWord("vix", status.feeds.vix, false))}
    </span>
  );
}

/* ── rows and cells (module level: nothing re-allocated per snapshot) ──── */

interface TapeRowData {
  /** Row identity for DataTable (`r.id`): the symbol. */
  id: string;
  def: TapeDef;
  quote: LiveQuote | undefined;
  bars: DailyBar[] | undefined;
}

interface TapeColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  mono?: boolean;
  width?: string;
  render: (r: TapeRowData) => ReactNode;
  sub?: (r: TapeRowData) => ReactNode;
}

const DASH = "—";

function rowOf(def: TapeDef, quotes: ReadonlyMap<string, LiveQuote>, barsBySymbol: ReadonlyMap<string, DailyBar[]>): TapeRowData {
  return { id: def.symbol, def, quote: quotes.get(def.symbol), bars: barsBySymbol.get(def.symbol) };
}

/** Newest stored bar (bars arrive ascending by date). */
function newestBar(r: TapeRowData): DailyBar | undefined {
  return r.bars?.length ? r.bars[r.bars.length - 1] : undefined;
}

/** Dated beats empty (review 2026-09-05): with no stream quote the row prints
 * the newest stored close and its date instead of "no quote". */
function storedClose(r: TapeRowData): DailyBar | undefined {
  if (r.quote) return undefined;
  const last = newestBar(r);
  return last?.close != null ? last : undefined;
}

const num = (v: number | null | undefined, f: (x: number) => string): string => (v == null ? DASH : f(v));

const lastCell = (r: TapeRowData): ReactNode => {
  if (r.quote) return fmtPrice(r.def, r.quote.p);
  const stored = storedClose(r);
  if (stored) return <span style={{ color: "var(--text-2)" }}>{fmtPrice(r.def, stored.close as number)}</span>;
  return <span style={{ color: "var(--text-3)", fontWeight: 400 }}>no quote</span>;
};

// The feed's own day change, never arithmetic: a quote with a price but a
// null `dc` prints the dash rather than falling back to the stored return.
const dayPctCell = (r: TapeRowData): ReactNode => {
  const v = r.quote ? r.quote.dc : storedClose(r)?.ret_1d;
  return <span style={{ color: toneColor(v) }}>{num(v, (x) => fmtSignedPct(x))}</span>;
};

const dayDollarCell = (r: TapeRowData): ReactNode => {
  const v = r.quote?.dd;
  return <span style={{ color: toneColor(v) }}>{v != null ? fmtDayDollar(r.def, v) : DASH}</span>;
};

const weekCell = (r: TapeRowData): ReactNode => {
  const v = newestBar(r)?.ret_1w;
  return <span style={{ color: toneColor(v) }}>{num(v, (x) => fmtSignedPct(x, 1))}</span>;
};

const monthCell = (r: TapeRowData): ReactNode => {
  const v = newestBar(r)?.ret_1m;
  return <span style={{ color: toneColor(v) }}>{num(v, (x) => fmtSignedPct(x, 1))}</span>;
};

const sparkCell = (r: TapeRowData): ReactNode => {
  const closes = (r.bars ?? [])
    .slice(-30)
    .map((b) => b.close)
    .filter((c): c is number => c != null);
  if (closes.length < 2) return <span style={{ color: "var(--text-3)" }}>{DASH}</span>;
  const color = closes[closes.length - 1] >= closes[0] ? "var(--pos)" : "var(--neg)";
  return (
    <Sparkline
      values={closes}
      width={48}
      height={16}
      strokeWidth={1.3}
      gradient
      color={color}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    />
  );
};

/** "● HH:MM:SS ET" for live rows, the quote stamp ("· 15m" when delayed),
 * "{date} close" for stored rows, "15m delayed" or the dash otherwise. */
const asOfNode = (r: TapeRowData): ReactNode => {
  const asOf = asOfCell(r.quote);
  const stored = storedClose(r);
  const text = r.quote ? asOf.text : stored ? `${fmtDate(stored.date)} close` : asOf.text;
  return (
    <span style={{ fontSize: "var(--fs-meta)", color: asOf.live ? "var(--pos)" : "var(--text-3)", whiteSpace: "nowrap" }}>
      {asOf.live ? "● " : ""}
      {text}
    </span>
  );
};

const LAST: TapeColumn = { key: "last", label: "Last", align: "right", mono: true, render: lastCell };
const DAY_PCT: TapeColumn = { key: "dc", label: "Day %", align: "right", mono: true, render: dayPctCell };
const DAY_DOLLAR: TapeColumn = { key: "dd", label: "Day Δ$", align: "right", mono: true, render: dayDollarCell };
const WEEK: TapeColumn = { key: "w1", label: "1W %", align: "right", mono: true, render: weekCell };
const MONTH: TapeColumn = { key: "m1", label: "1M %", align: "right", mono: true, render: monthCell };
const SPARK: TapeColumn = { key: "spark", label: "30 Sess", align: "right", mono: true, width: "52px", render: sparkCell };
const AS_OF: TapeColumn = { key: "asof", label: "As of", align: "right", mono: true, render: asOfNode };

const TAPE_VIEW_OPTIONS = [
  { id: "macro", label: "Macro" },
  { id: "single-names", label: "Single names" },
];

// Counted from the registry, never typed: the tape holds 19 symbols in eight
// groups (checklist 05 says 18; the caption must not claim a number the table
// does not show).
const MACRO_CAPTION = `Macro tape: ${MACRO_TAPE.length} symbols in ${TAPE_GROUPS.length} groups`;
const SINGLES_CAPTION = `Single names: ${SINGLE_NAMES.length === 12 ? "twelve" : SINGLE_NAMES.length} large-cap names sorted by day move`;

/* ── panel ─────────────────────────────────────────────────────────────── */

export default function MacroTape({
  quotes,
  barsBySymbol,
  singles,
  selected,
  onSelect,
  view,
  onViewChange,
  registerRow,
  live,
  storedThrough,
}: MacroTapeProps): JSX.Element {
  const { isNarrow } = useBreakpoint();
  const flash = useTickFlash(quotes);

  // One stable ref callback per symbol: React re-invokes a ref only when the
  // callback identity changes, so the 2 Hz snapshots never churn the screen's
  // row map.
  const refFor = useMemo(() => {
    const cache = new Map<string, (el: HTMLButtonElement | null) => void>();
    for (const def of [...MACRO_TAPE, ...SINGLE_NAMES]) cache.set(def.symbol, (el) => registerRow(def.symbol, el));
    return (symbol: string) => cache.get(symbol) ?? ((el: HTMLButtonElement | null) => registerRow(symbol, el));
  }, [registerRow]);

  // The ticker button: keyboard and assistive path. No onClick of its own;
  // its click (pointer, Enter or Space) bubbles to the row handler once.
  const symbolColumn = useMemo<TapeColumn>(
    () => ({
      key: "symbol",
      label: "Symbol · name",
      width: "150px",
      render: (r) => (
        <button
          type="button"
          className="mrr-tape-btn"
          aria-expanded={selected === r.id}
          aria-controls={CHART_PANEL_ID}
          title={`Open ${r.id} chart`}
          ref={refFor(r.id)}
          style={{ minWidth: 66, textAlign: "left" }}
        >
          {r.id}
        </button>
      ),
      sub: (r) => r.def.name,
    }),
    [selected, refFor],
  );

  // Nine columns at desk width; the phone set keeps Symbol · name, Last,
  // Day %, 1M % and As of (Δ$, 1W and the sparkline return above 768px).
  const macroColumns = useMemo<TapeColumn[]>(
    () => (isNarrow ? [symbolColumn, LAST, DAY_PCT, MONTH, AS_OF] : [symbolColumn, LAST, DAY_PCT, DAY_DOLLAR, WEEK, MONTH, SPARK, AS_OF]),
    [symbolColumn, isNarrow],
  );
  const singlesColumns = useMemo<TapeColumn[]>(
    () => (isNarrow ? [symbolColumn, LAST, DAY_PCT, AS_OF] : [symbolColumn, LAST, DAY_PCT, DAY_DOLLAR, AS_OF]),
    [symbolColumn, isNarrow],
  );

  const macroGroups = useMemo(
    () =>
      TAPE_GROUPS.map((g) => ({
        key: g.label,
        label: g.label,
        rows: g.defs.map((def) => rowOf(def, quotes, barsBySymbol)),
      })),
    [quotes, barsBySymbol],
  );
  const singleRows = useMemo(() => singles.map((def) => rowOf(def, quotes, barsBySymbol)), [singles, quotes, barsBySymbol]);

  // The whole row is the pointer target; the selected rail and the tick flash
  // are attributes on the same <tr> (app.css .mrr-tape rules, A.13).
  const rowPropsFor = useCallback(
    (r: TapeRowData) => {
      const dir = flash.get(r.id);
      return {
        "data-clickable": "",
        "data-selected": selected === r.id ? "true" : "false",
        onClick: () => onSelect(r.id),
        style: dir ? { animation: `mrr-flash-${dir} var(--tick-flash) var(--ease-out)` } : undefined,
      };
    },
    [flash, selected, onSelect],
  );

  return (
    <Card as="section" variant="panel" id="watchlist" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Macro tape"
        actions={
          <Segmented
            label="Tape view"
            options={TAPE_VIEW_OPTIONS}
            value={view}
            onChange={(id) => onViewChange(id as TapeView)}
          />
        }
      />
      {/* The per-feed honesty line (M29) sits under the header on its own line:
          beside the toggle it squeezed the 432px header (verify 2026-09-15). */}
      <div style={{ ...metaStyle, margin: "-6px 0 10px" }}>
        <FeedStatusLine />
      </div>

      {view === "macro" ? (
        /* The well scrolls the nine columns inside the card instead of
           widening the page; the symbol column pins and a swipe affordance
           appears when it overflows (ScrollTable). */
        <Card padding="0">
          <ScrollTable label="Macro tape" style={{ padding: "8px 12px 2px" }}>
            <DataTable
              compact
              zebra={false}
              className="mrr-tape"
              caption={MACRO_CAPTION}
              columns={macroColumns}
              groups={macroGroups}
              rowProps={rowPropsFor}
            />
          </ScrollTable>
        </Card>
      ) : (
        <div id="single-names">
          <div style={{ ...metaStyle, marginBottom: 8 }}>sorted by day move · re-sorts {live ? "live" : "as data updates"}</div>
          <Card padding="0">
            <ScrollTable label="Single names" style={{ padding: "8px 12px 2px" }}>
              <DataTable
                compact
                zebra={false}
                className="mrr-tape"
                caption={SINGLES_CAPTION}
                columns={singlesColumns}
                rows={singleRows}
                rowProps={rowPropsFor}
              />
            </ScrollTable>
          </Card>
          <Caption>
            Twelve large-cap tech, semis, and crypto-adjacent names as market thermometers;
            biggest day move on top. Off-hours the board holds at the last close until the next
            session opens.
          </Caption>
        </div>
      )}

      <Caption>
        Day moves come straight from the exchange feed&apos;s own day-change figures; never
        recomputed here. 1W / 1M and sparklines come from the stored daily candles
        {storedThrough ? ` through ${fmtDate(storedThrough)}` : ""}; crypto, FX, VIX and
        single names have no stored history yet, so those columns print a dash. A dash under
        Day % means the feed sent a price without a day change (off-hours REST fill); the as-of
        stamp says when.
        {isNarrow ? " Δ$, 1W and the sparkline return above 768px." : ""}
        {/* Cadence + cross-surface reconciliation: the VIX row is a quote off
            this feed, while the Dashboard's VIX spike card reads the monthly
            signals snapshot — two honest levels, two cadences. */}
        <div style={{ marginTop: 2 }}>
          Every row states its own as-of stamp: ● marks a live tick, the rest print the quote time
          with the 15-minute delay noted where it applies, and a dated close means the stream had no
          quote. The dashboard&apos;s VIX spike signal reads the monthly signal print, so it carries a
          different level than the VIX row here.
        </div>
      </Caption>
    </Card>
  );
}
