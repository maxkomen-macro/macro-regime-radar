/**
 * Macro tape panel (redesign Phase 5, checklist 05 B.7): the `#watchlist`
 * section as a panel Card. The panel header carries the feed status line
 * (moved verbatim from MarketsScreen); the macro tape and the single names
 * are compact `DataTable`s inside `ScrollTable` wells (nine columns at desk
 * width with the symbol column pinned, five on a phone). Row click, the
 * selected rail and the 600 ms tick flash ride `rowProps`; the ticker button
 * is the keyboard and assistive path and its click bubbles to the row
 * handler, so nothing fires twice.
 *
 * Iteration 1: the single names render under the macro tape as their own
 * block (`#single-names`), no longer behind a Macro / Single names toggle
 * (M3b); the two provenance paragraphs moved behind "Details" and the visible
 * line says whether the tape is live or holding the last close, with its
 * as-of stamp (M2, `tapeStatusLine`).
 *
 * Every figure is served or a formatted served value: `dc` / `dd` are the
 * feed's own day-change fields (never arithmetic; a quote with a price but no
 * day change prints the dash), 1W / 1M / the sparkline come from the stored
 * daily bars, the as-of stamp from the quote or the newest bar's date.
 * `rowOf` and the cell renderers live at module level so the 2 Hz quote
 * snapshots allocate nothing new per row (G17).
 */

import { useCallback, useMemo, type ReactNode } from "react";
import { Card, DataTable, SectionHeader, Sparkline } from "../../components";
import type { DailyBar } from "../../api/types";
import {
  LIVE_WINDOW_MS,
  useQuotes,
  useStreamStatus,
  type LiveQuote,
} from "../../live/quotes";
import { fmtDate, fmtSignedPct } from "../../lib/format";
import Disclosure from "../shared/Disclosure";
import ScrollTable from "../shared/ScrollTable";
import { HiddenColumnsNote, fitColumns, hiddenColumnsNote, useMeasuredWidth } from "../shared/column-ladder";
import { Caption, MISSING, StateNote, metaStyle } from "../shared/screen-ui";
import { SRC, Stamp, metricAttrs } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import { CHART_PANEL_ID } from "./chart-panel-id";
import {
  MACRO_TAPE,
  SINGLE_NAMES,
  TAPE_GROUPS,
  asOfCell,
  feedWord,
  fmtDayDollar,
  fmtEtStamp,
  fmtPrice,
  mono,
  nyseSessionOpen,
  toneColor,
  type TapeDef,
} from "./tape";
import { useTickFlash } from "./useTickFlash";

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
  /** Ref callback for each ticker button so the screen can return focus after Esc. */
  registerRow: (symbol: string, el: HTMLButtonElement | null) => void;
  /** `usLive`: the sort meta reads "re-sorts live" vs "as data updates". */
  live: boolean;
  /** `marketDailyDate` for the caption's "through {date}". */
  storedThrough: string | null;
  /** The stored-close request failed with nothing on hand (CP4): the tape
   * then says which prices are missing and why. */
  storedError?: boolean;
}

/* ── the visible provenance line (M2) ──────────────────────────────────── */

const US_DEFS = [...MACRO_TAPE, ...SINGLE_NAMES].filter((d) => d.feed === "us");
const TICKING_DEFS = MACRO_TAPE.filter(
  (d) => d.feed === "crypto" || d.feed === "forex",
);

/**
 * At most two sentences under the tape (Iteration 1, M2): whether the US rows
 * are live, delayed or holding the last close, stamped with the newest US
 * quote's own time (`fmtEtStamp`, the stamp the As of column prints), then
 * the stored-close date the 1W / 1M columns read. The session word is the
 * tape's own NYSE-hours check; nothing here is a new figure.
 */
export function tapeStatusLine(args: {
  socketOpen: boolean;
  usLive: boolean;
  quotes: ReadonlyMap<string, LiveQuote>;
  storedThrough: string | null;
  sessionOpen?: boolean;
}): string {
  const { socketOpen, usLive, quotes, storedThrough } = args;
  const sessionOpen = args.sessionOpen ?? nyseSessionOpen();
  const now = Date.now();
  let usT: number | null = null;
  let usDelayed = false;
  for (const d of US_DEFS) {
    const q = quotes.get(d.symbol);
    if (q?.t != null && (usT == null || q.t > usT)) {
      usT = q.t;
      usDelayed = q.delayed;
    }
  }
  const othersLive = TICKING_DEFS.some((d) => {
    const q = quotes.get(d.symbol);
    return q?.src === "ws" && q.t != null && now - q.t < LIVE_WINDOW_MS;
  });
  const stored = storedThrough
    ? ` 1W, 1M and the sparklines read stored closes through ${fmtDate(storedThrough)}.`
    : "";

  if (usLive && usT != null)
    return `Live: US rows tick from the exchange feed, newest at ${fmtEtStamp(usT)}.${stored}`;
  if (!socketOpen) {
    return storedThrough
      ? `Showing the last close: the stream is not connected, so rows print stored closes through ${fmtDate(storedThrough)}.`
      : "Showing the last close: the stream is not connected and no stored close is on file yet.";
  }
  if (usT == null) {
    return storedThrough
      ? `Showing the last close: no US quote has arrived, so US rows print stored closes through ${fmtDate(storedThrough)}.`
      : "No US quote or stored close on file yet.";
  }
  if (sessionOpen) {
    return `Delayed: the US feed is not ticking, so US rows print their newest quote, ${fmtEtStamp(usT)}${usDelayed ? " (15 minutes delayed)" : ""}.${stored}`;
  }
  return `Showing the last close: US rows hold their final quote from ${fmtEtStamp(usT)}${othersLive ? ", while crypto and FX tick live" : ""}.${stored}`;
}

/**
 * The tape's one-line status (Iteration 1 step 5, G4: one rendered line at
 * every width, 390 px included): live, delayed or the last close, with the
 * stamp. `full` is `tapeStatusLine`'s sentence, verbatim, which moves behind
 * the panel's Details disclosure; nothing is dropped.
 */
export function tapeStatus(args: Parameters<typeof tapeStatusLine>[0]): {
  line: string;
  full: string;
} {
  const full = tapeStatusLine(args);
  const { socketOpen, usLive, quotes, storedThrough } = args;
  const sessionOpen = args.sessionOpen ?? nyseSessionOpen();
  let usT: number | null = null;
  let usDelayed = false;
  for (const d of US_DEFS) {
    const q = quotes.get(d.symbol);
    if (q?.t != null && (usT == null || q.t > usT)) {
      usT = q.t;
      usDelayed = q.delayed;
    }
  }
  const through = storedThrough
    ? `Last close · stored through ${fmtDate(storedThrough)}`
    : null;
  let line: string;
  if (usLive && usT != null) line = `Live · newest US tick ${fmtEtStamp(usT)}`;
  else if (!socketOpen)
    line = through ?? "Stream not connected · no close stored yet";
  else if (usT == null)
    line = through ?? "No US quote or stored close on file yet.";
  else if (sessionOpen)
    line = `Delayed${usDelayed ? " 15 min" : ""} · US quote ${fmtEtStamp(usT)}`;
  else line = `Last close · US final quote ${fmtEtStamp(usT)}`;
  return { line, full };
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
      if (
        q?.src === "ws" &&
        q.t != null &&
        now - q.t < LIVE_WINDOW_MS &&
        def.feed !== "vix"
      ) {
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
      <span
        style={{
          ...mono,
          fontSize: "var(--fs-meta)",
          letterSpacing: "var(--ls-micro)",
          color: "var(--warn-hot)",
        }}
      >
        stream unavailable · showing stored closes
      </span>
    );
  }
  // flexWrap is the one addition (Phase 5): in the 432px tape column the four
  // feed words share the panel header with the view toggle, so they wrap
  // instead of running past the panel edge.
  return (
    <span
      style={{
        ...mono,
        fontSize: "var(--fs-meta)",
        letterSpacing: "var(--ls-micro)",
        display: "inline-flex",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      {seg("US", feedWord("us", status.feeds.us, liveByFeed.us))}
      {seg(
        "CRYPTO",
        feedWord("crypto", status.feeds.crypto, liveByFeed.crypto),
      )}
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

function rowOf(
  def: TapeDef,
  quotes: ReadonlyMap<string, LiveQuote>,
  barsBySymbol: ReadonlyMap<string, DailyBar[]>,
): TapeRowData {
  return {
    id: def.symbol,
    def,
    quote: quotes.get(def.symbol),
    bars: barsBySymbol.get(def.symbol),
  };
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

const num = (v: number | null | undefined, f: (x: number) => string): string =>
  v == null ? DASH : f(v);

const lastCell = (r: TapeRowData): ReactNode => {
  // A2: the VIX row is the relay's delayed CBOE poll (vix_delayed), not the
  // FRED VIXCLS close the Dashboard reads ("vix"): it is "vix-live", and its
  // As of cell and the tape header's stamp say it is delayed.
  if (r.quote)
    return r.def.symbol === "VIX" ? (
      <span {...metricAttrs("vix-live", r.quote.p)}>
        {fmtPrice(r.def, r.quote.p)}
      </span>
    ) : (
      fmtPrice(r.def, r.quote.p)
    );
  const stored = storedClose(r);
  if (stored)
    return (
      <span style={{ color: "var(--text-2)" }}>
        {fmtPrice(r.def, stored.close as number)}
      </span>
    );
  return (
    <span style={{ color: "var(--text-3)", fontWeight: 400 }}>no quote</span>
  );
};

// The feed's own day change, never arithmetic: a quote with a price but a
// null `dc` prints the dash rather than falling back to the stored return.
const dayPctCell = (r: TapeRowData): ReactNode => {
  const v = r.quote ? r.quote.dc : storedClose(r)?.ret_1d;
  return (
    <span style={{ color: toneColor(v) }}>
      {num(v, (x) => fmtSignedPct(x))}
    </span>
  );
};

const dayDollarCell = (r: TapeRowData): ReactNode => {
  const v = r.quote?.dd;
  return (
    <span style={{ color: toneColor(v) }}>
      {v != null ? fmtDayDollar(r.def, v) : DASH}
    </span>
  );
};

const weekCell = (r: TapeRowData): ReactNode => {
  const v = newestBar(r)?.ret_1w;
  return (
    <span style={{ color: toneColor(v) }}>
      {num(v, (x) => fmtSignedPct(x, 1))}
    </span>
  );
};

const monthCell = (r: TapeRowData): ReactNode => {
  const v = newestBar(r)?.ret_1m;
  return (
    <span style={{ color: toneColor(v) }}>
      {num(v, (x) => fmtSignedPct(x, 1))}
    </span>
  );
};

const sparkCell = (r: TapeRowData): ReactNode => {
  const closes = (r.bars ?? [])
    .slice(-30)
    .map((b) => b.close)
    .filter((c): c is number => c != null);
  if (closes.length < 2)
    return <span style={{ color: "var(--text-3)" }}>{DASH}</span>;
  const color =
    closes[closes.length - 1] >= closes[0] ? "var(--pos)" : "var(--neg)";
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
  const text = r.quote
    ? asOf.text
    : stored
      ? `${fmtDate(stored.date)} close`
      : asOf.text;
  return (
    <span
      style={{
        fontSize: "var(--fs-meta)",
        color: asOf.live ? "var(--pos)" : "var(--text-3)",
        whiteSpace: "nowrap",
      }}
    >
      {asOf.live ? "● " : ""}
      {text}
    </span>
  );
};

const LAST: TapeColumn = {
  key: "last",
  label: "Last",
  align: "right",
  mono: true,
  render: lastCell,
};
const DAY_PCT: TapeColumn = {
  key: "dc",
  label: "Day %",
  align: "right",
  mono: true,
  render: dayPctCell,
};
const DAY_DOLLAR: TapeColumn = {
  key: "dd",
  label: "Day Δ$",
  align: "right",
  mono: true,
  render: dayDollarCell,
};
const WEEK: TapeColumn = {
  key: "w1",
  label: "1W %",
  align: "right",
  mono: true,
  render: weekCell,
};
const MONTH: TapeColumn = {
  key: "m1",
  label: "1M %",
  align: "right",
  mono: true,
  render: monthCell,
};
const SPARK: TapeColumn = {
  key: "spark",
  label: "30 Sess",
  align: "right",
  mono: true,
  width: "52px",
  render: sparkCell,
};
const AS_OF: TapeColumn = {
  key: "asof",
  label: "As of",
  align: "right",
  mono: true,
  render: asOfNode,
};

// Counted from the registry, never typed: the tape holds 19 symbols in eight
// groups (checklist 05 says 18; the caption must not claim a number the table
// does not show).
const MACRO_CAPTION = `Macro tape: ${MACRO_TAPE.length} symbols in ${TAPE_GROUPS.length} groups`;
const SINGLES_CAPTION = `Single names: ${SINGLE_NAMES.length === 12 ? "twelve" : SINGLE_NAMES.length} large-cap names sorted by day move`;

/* ── panel ─────────────────────────────────────────────────────────────── */

/**
 * Iteration 2, F2: how many columns the tape may show at a measured width.
 *
 * The tape used to live in the 432px summary rail, so its eight desk columns
 * were laid into a 368px well: five of them sat outside it and the reader saw
 * "+4" where a day change belonged. It now takes the page's full width, which
 * fits all eight from 1280px up. Narrower than that it drops columns from the
 * least important end rather than half-rendering a number, and says which
 * ones it dropped.
 *
 * `MIN_W` is each column's settled width once the table is compressed as far
 * as its content allows (measured on the acceptance database at 1024px). The
 * ladder uses fixed minima instead of re-measuring after each drop so the
 * choice cannot oscillate under a ResizeObserver.
 */
const MIN_W: Record<string, number> = {
  symbol: 173,
  last: 94,
  dc: 63,
  dd: 71,
  w1: 55,
  m1: 63,
  spark: 71,
  asof: 174,
};
/** ScrollTable's own gutters (8px 12px 2px), which the table cannot use. */
const WELL_PAD = 24;
/** Least important first: the sparkline is decorative, then the week, then
 * the dollar change (the percent beside it carries the same move). */
const DROP_ORDER = ["spark", "w1", "dd"];

/** The tape's rung of the shared column ladder (screens/shared/column-ladder). */
export function fitTapeColumns(
  cols: TapeColumn[],
  width: number,
): { cols: TapeColumn[]; dropped: TapeColumn[] } {
  return fitColumns(cols, width, MIN_W, DROP_ORDER);
}

export default function MacroTape({
  quotes,
  barsBySymbol,
  singles,
  selected,
  onSelect,
  registerRow,
  live,
  storedThrough,
  storedError = false,
}: MacroTapeProps): JSX.Element {
  const flash = useTickFlash(quotes);
  const status = useStreamStatus();
  const report = useFreshReport();
  const statusLine = tapeStatus({
    socketOpen: status.socket === "open",
    usLive: live,
    quotes,
    storedThrough,
  });
  // CP4: with the stored closes unanswered the tape names what is missing
  // (closes alone while the stream is up, every price when it is not); the
  // single names read the stream alone, so they name the live quotes.
  const socketOpen = status.socket === "open";
  const storedGone = storedError && storedThrough == null;
  const singlesUnquoted =
    !socketOpen && singles.every((d) => quotes.get(d.symbol)?.p == null);
  const statusText =
    storedGone && !socketOpen ? "Stream not connected" : statusLine.line;

  // One stable ref callback per symbol: React re-invokes a ref only when the
  // callback identity changes, so the 2 Hz snapshots never churn the screen's
  // row map.
  const refFor = useMemo(() => {
    const cache = new Map<string, (el: HTMLButtonElement | null) => void>();
    for (const def of [...MACRO_TAPE, ...SINGLE_NAMES])
      cache.set(def.symbol, (el) => registerRow(def.symbol, el));
    return (symbol: string) =>
      cache.get(symbol) ??
      ((el: HTMLButtonElement | null) => registerRow(symbol, el));
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

  // Eight desk columns, reduced to what the measured panel can show whole
  // (F2). At 1280px and up every one fits; below that the ladder drops the
  // sparkline, then the week, then the dollar change, and the panel names
  // what it dropped. The phone lands on the same five columns it always had
  // (Symbol · name, Last, Day %, 1M %, As of), now by measurement rather
  // than by a hardcoded 768px branch.
  const [tapeRef, tapeBoxW] = useMeasuredWidth<HTMLDivElement>();
  const tapeW = tapeBoxW ? Math.max(0, tapeBoxW - WELL_PAD) : 0;
  const macroFit = useMemo(
    () =>
      fitTapeColumns(
        [symbolColumn, LAST, DAY_PCT, DAY_DOLLAR, WEEK, MONTH, SPARK, AS_OF],
        tapeW,
      ),
    [symbolColumn, tapeW],
  );
  const singlesFit = useMemo(
    () =>
      fitTapeColumns([symbolColumn, LAST, DAY_PCT, DAY_DOLLAR, AS_OF], tapeW),
    [symbolColumn, tapeW],
  );
  const macroColumns = macroFit.cols;
  const singlesColumns = singlesFit.cols;
  /** The visible affordance F2 asks for: which columns this width cannot show. */
  const droppedLabels = useMemo(
    () => [...macroFit.dropped, ...singlesFit.dropped].map((c) => c.label),
    [macroFit.dropped, singlesFit.dropped],
  );
  const droppedLabel = hiddenColumnsNote(droppedLabels);

  const macroGroups = useMemo(
    () =>
      TAPE_GROUPS.map((g) => ({
        key: g.label,
        label: g.label,
        rows: g.defs.map((def) => rowOf(def, quotes, barsBySymbol)),
      })),
    [quotes, barsBySymbol],
  );
  const singleRows = useMemo(
    () => singles.map((def) => rowOf(def, quotes, barsBySymbol)),
    [singles, quotes, barsBySymbol],
  );

  // The whole row is the pointer target; the selected rail and the tick flash
  // are attributes on the same <tr> (app.css .mrr-tape rules, A.13).
  const rowPropsFor = useCallback(
    (r: TapeRowData) => {
      const dir = flash.get(r.id);
      return {
        "data-clickable": "",
        "data-selected": selected === r.id ? "true" : "false",
        onClick: () => onSelect(r.id),
        style: dir
          ? { animation: `mrr-flash-${dir} var(--tick-flash) var(--ease-out)` }
          : undefined,
      };
    },
    [flash, selected, onSelect],
  );

  return (
    <Card as="section" variant="panel" id="watchlist" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Macro tape"
        right={
          // A1: the tape's two sources and their §5 words (the per-row "As of"
          // column carries each row's own stamp).
          <span
            style={{ display: "inline-flex", flexWrap: "wrap", columnGap: 12 }}
          >
            <Stamp source={SRC.eodhd} label={report.series("live_quotes")} />
            <Stamp source="EODHD VIX" label={report.series("vix_delayed")} />
            <Stamp source={SRC.closes} label={report.series("market_daily")} />
          </span>
        }
      />
      {/* The per-feed honesty line (M29) sits under the header on its own line. */}
      <div style={{ ...metaStyle, margin: "-6px 0 10px" }}>
        <FeedStatusLine />
      </div>

      {/* Iteration 2 (F2) supersedes the old note here ("the well scrolls the
          nine columns inside the card"): at the page's full width the eight
          desk columns render whole from 1280px up with no scroll inside the
          panel. Narrower, the column ladder drops the least important ones
          and `droppedLabel` says so; the symbol column still pins and
          ScrollTable's swipe affordance still catches the phone, where even
          the reduced set is wider than the well. */}
      <HiddenColumnsNote labels={droppedLabels} testId="tape-dropped-columns" />
      <div ref={tapeRef}>
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
      </div>
      {storedGone ? (
        <div style={{ marginTop: 8 }}>
          <StateNote
            error
            missing={socketOpen ? MISSING.closes : MISSING.market}
          />
        </div>
      ) : null}

      {/* The single names sit under the macro tape, always on screen (M3b);
          `#single-names` is the palette and hash target. */}
      <div id="single-names" style={{ marginTop: 18 }}>
        <SectionHeader
          level="sub"
          as="h3"
          title="Single names"
          style={{ margin: "0 0 4px" }}
        />
        <div style={{ ...metaStyle, marginBottom: 8 }}>
          sorted by day move · re-sorts {live ? "live" : "as data updates"}
        </div>
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
        {singlesUnquoted ? (
          <div style={{ marginTop: 8 }}>
            <StateNote error missing={MISSING.quotes} />
          </div>
        ) : null}
        <Caption>
          Twelve large-cap tech, semis, and crypto-adjacent names as market
          thermometers; biggest day move on top. Off-hours the board holds at
          the last close until the next session opens.
        </Caption>
      </div>

      {/* M2: one visible line saying live or last close, with its stamp; the
          full provenance sits one click down on the same panel. G4 (step 5):
          the line is one rendered line at every width; its full sentence
          leads the Details panel. */}
      <Caption copy="status" style={{ marginTop: 14, color: "var(--text-2)" }}>
        {statusText}
      </Caption>
      <Disclosure variant="quiet" title="Details" style={{ marginTop: 2 }}>
        <Caption
          style={{ marginTop: 0, marginBottom: 4, color: "var(--text-2)" }}
        >
          {statusLine.full}
        </Caption>
        <Caption style={{ marginTop: 0 }}>
          Day moves come straight from the exchange feed&apos;s own day-change
          figures; never recomputed here. 1W / 1M and sparklines come from the
          stored daily candles
          {storedThrough ? ` through ${fmtDate(storedThrough)}` : ""}; crypto,
          FX, VIX and single names have no stored history yet, so those columns
          print a dash. A dash under Day % means the feed sent a price without a
          day change (off-hours REST fill); the as-of stamp says when.
          {droppedLabel ? " Columns this width cannot show whole are named above the board; they return as the window widens." : ""}
          {/* Cadence + cross-surface reconciliation: the VIX row is a quote off
              this feed, while the Dashboard's VIX spike card reads the monthly
              signals snapshot: two honest levels, two cadences. */}
          <div style={{ marginTop: 2 }}>
            Every row states its own as-of stamp: ● marks a live tick, the rest
            print the quote time with the 15-minute delay noted where it
            applies, and a dated close means the stream had no quote. The
            dashboard&apos;s VIX spike signal reads the monthly signal print, so
            it carries a different level than the VIX row here.
          </div>
        </Caption>
      </Disclosure>
    </Card>
  );
}
