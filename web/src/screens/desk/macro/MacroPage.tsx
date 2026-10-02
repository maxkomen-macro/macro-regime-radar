/**
 * Macro & Correlations (DESK_FRAME3_SPEC §6, screens/05-macro-correlations.png),
 * read from GET /api/desk/macro (§12.8): the yield curve today against a
 * month ago, whether bonds still hedge stocks (SPY against TLT, the 60-day
 * correlation over a year), credit (the high-yield spread against three
 * years), and what moves with the S&P (each served asset's 60-day
 * correlation with SPY), and under them every pair of twelve assets (the matrix, desk/matrix). A 2×2 and one
 * full-width card, no action button. Every number is
 * served; every sentence and every call about it (the stock–bond words and
 * whether bonds hedge, the credit words, the reads) is the API's. Each block,
 * and each value inside it, keeps its label and says "Awaiting refresh" when
 * it is not served (§1.7); nothing prints a number that was not served.
 */

import { unavailableOf, useMacro } from "../data/api";
import type { CorrelationRow, MacroResponse, MatrixBlock, Read } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayLong, dayShort, endDay, monthYear, num, ordinal } from "../kit/format";
import Gauge from "../kit/Gauge";
import LineChart from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import { AdvancedPanel, Awaiting, DroppedNote, LiveBadge, NotServedBadge, ReadBox, Stat, StatRow, Unserved, UnservedCard, useAdvanced, useBlockUnserved, LoadingLine, FailedScope } from "../kit/ui";
import { droppedOf } from "../data/schema";
import { matrixProblem } from "./matrix";
import { GLOSSARY } from "../kit/glossary";
import "./macro.css";
import { Term, defineTerms } from "../kit/Term";

type State = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const TENORS = ["3m", "2y", "5y", "10y", "30y"] as const;

function ServedRead({ read }: { read: Read | undefined }) {
  if (!read) return null;
  return (
    <ReadBox label={read.label} warn={read.tone === "warning"}>
      {read.text}
    </ReadBox>
  );
}

/** Labels that stay, each saying "Awaiting refresh" (§1.7), while nothing is loading. */
function AwaitingStats({ labels, quiet }: { labels: string[]; quiet: boolean }) {
  if (quiet) return null;
  return (
    <StatRow cols={labels.length}>
      {labels.map((l) => (
        <Stat key={l} label={l} awaiting />
      ))}
    </StatRow>
  );
}

function CardHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="dk-card-head">
      <h2 className="dk-card-title" id={id}>
        {defineTerms(title)}
        <span className="dk-card-sub"> {defineTerms(sub)}</span>
      </h2>
    </div>
  );
}

/** A signed correlation: "+0.31", "−0.24", "0.00". */
export function corrText(x: number): string {
  return x > 0 ? `+${num(x, 2)}` : num(x, 2);
}

/** Basis points as served, signed: "+41 bp", "−6 bp", "0 bp", "+5.5 bp". */
export function bpText(x: number): string {
  if (x === 0) return "0 bp";
  return `${x > 0 ? "+" : "−"}${num(Math.abs(x), Number.isInteger(x) ? 0 : 1)} bp`;
}

/**
 * Y ticks that cover [lo, hi] on a 1 / 2 / 5 × 10^k step, at most `max` of
 * them, with the decimals the step needs so every label is its gridline's
 * value (verifier M-1: a 0.25 step printed at one decimal mislabelled three
 * gridlines).
 */
export function coverTicks(lo: number, hi: number, max: number): { v: number; text: string }[] {
  if (hi - lo <= Math.abs(hi) * 1e-6) {
    // A flat series: one round unit either side of it (3.12 → 2 / 3 / 4).
    const unit = 10 ** Math.floor(Math.log10(Math.abs(hi) || 1));
    lo -= unit / 2;
    hi += unit / 2;
  }
  const span = Math.max(hi - lo, 1e-9);
  const p0 = 10 ** Math.floor(Math.log10(span / max));
  for (const p of [p0, p0 * 10, p0 * 100]) {
    for (const m of [1, 2, 5]) {
      const step = Number((m * p).toPrecision(6));
      const a = Math.floor(lo / step + 1e-9) * step;
      const b = Math.ceil(hi / step - 1e-9) * step;
      const n = Math.round((b - a) / step) + 1;
      if (n <= max) {
        const d = Math.min(4, (String(step).split(".")[1] ?? "").length);
        return Array.from({ length: n }, (_, i) => {
          const v = Number((a + i * step).toFixed(10));
          return { v, text: num(v, d) };
        });
      }
    }
  }
  return [lo, hi].map((v) => ({ v, text: num(v, 2) }));
}

/** "Today: 2y Sep 22 · 10y Sep 21": today's tenors dated apart, listed under the chart (§6, §12.8: S-30); a tenor not
 * stored is dated null and left out (S-24). */
export function tenorDates(dates: Record<string, string | null>): string {
  return `Today: ${TENORS.flatMap((t) => (dates[t] ? [`${t} ${dayShort(dates[t])}`] : [])).join(" · ")}`;
}

/** "A month ago: 2y Aug 21 · 10y Aug 20": each tenor's month-ago date, always disclosed under the chart (§6, S-30). */
export function monthAgoDates(dates: Record<string, string | null>): string {
  const parts = TENORS.flatMap((t) => (dates[t] ? [`${t} ${dayShort(dates[t])}`] : []));
  return parts.length ? `A month ago: ${parts.join(" · ")}` : "";
}

/** "3m, 5y and 30y not served": the curve's tenors without a value today (§6), or "" when all are served. */
export function unservedTenors(today: Partial<Record<(typeof TENORS)[number], number | null>>): string {
  const off = TENORS.filter((t) => !fin(today[t]));
  if (!off.length) return "";
  const list = off.length === 1 ? off[0] : `${off.slice(0, -1).join(", ")} and ${off[off.length - 1]}`;
  return `${list} not served`;
}

function Curve({ m, state }: { m: MacroResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const unserved = useBlockUnserved(m, "curve");
  const c = m?.curve;
  const today = c?.today;
  const ago = c?.month_ago;
  const vals = [...TENORS.map((t) => today?.[t]), ...TENORS.map((t) => ago?.[t])].filter(fin);
  const ticks = vals.length ? coverTicks(Math.min(...vals), Math.max(...vals), 6) : [];
  const ten = today?.["10y"];
  const front = today?.["3m"];
  const chg10 = c?.["10y_chg_bp"];
  const s = c?.["2s10s_bp"];
  const sc = c?.["2s10s_chg_bp"];
  const drawn = TENORS.filter((t) => fin(today?.[t])).length > 1;
  const agoDrawn = TENORS.filter((t) => fin(ago?.[t])).length > 1;
  // §6 (S-30): each snapshot is checked on its own date; one without a common date is drawn as labelled points, never joined by a line.
  const todayJoined = !!today?.date;
  const agoJoined = !!ago?.date;
  const agoNote = ago?.dates ? monthAgoDates(ago.dates) : "";
  // S-30: each unjoined point is labelled with its tenor and date; the last also names the snapshot, whose end label goes with its line.
  const lastOf = (snap: typeof today) => [...TENORS].reverse().find((t) => fin(snap?.[t]) && snap?.dates?.[t]);
  const todayLast = lastOf(today);
  const agoLast = lastOf(ago);
  // §1.0.2: the block, or the whole answer, served awaiting.
  if (unserved) return <UnservedCard headingId="mc-curve" className="mc-card" title="Yield curve" sub="today against a month ago" labels={["10-year", "2s10s", "Front end"]} block={unserved} advanced />;
  return (
    <section className="dk-card mc-card" aria-labelledby="mc-curve" aria-busy={quiet}>
      <CardHead id="mc-curve" title="Yield curve" sub="today against a month ago" />
      <LoadingLine busy={quiet} />
      {c ? (
        <>
          <StatRow cols={3}>
            <Stat label="10-year" value={fin(ten) ? `${num(ten, 2)}%` : undefined} awaiting={!fin(ten)} sub={fin(chg10) ? (chg10 === 0 ? "unchanged on the month" : `${bpText(chg10)} on the month`) : undefined} />
            {/* The color is the month's move (§1.3 up / down): steepening up, flattening down. */}
            <Stat label="2s10s" value={fin(s) ? bpText(s) : undefined} awaiting={!fin(s)} tone={fin(s) && fin(sc) ? (sc > 0 ? "up" : sc < 0 ? "down" : undefined) : undefined} sub={fin(sc) ? `${sc > 0 ? "steepening" : sc < 0 ? "flattening" : "unchanged"} · ${bpText(sc)}` : undefined} />
            <Stat label="Front end" value={fin(front) ? `3m ${num(front, 2)}%` : undefined} awaiting={!fin(front)} sub={m?.reads?.front_end?.text} />
          </StatRow>
          {drawn && today ? (
            <LineChart
              ariaLabel={`Treasury yields by tenor${today.date ? ` on ${dayShort(today.date)}` : ", today each tenor on its own date"}${agoDrawn ? `, against a month ago${ago?.date ? ` (${dayShort(ago.date)})` : ", each tenor on its own date"}` : ""}`}
              height={148}
              n={TENORS.length}
              yDomain={[ticks[0].v, ticks[ticks.length - 1].v]}
              yTicks={ticks.map((t) => ({ v: t.v, text: `${t.text}%` }))}
              // §6: a tenor not served leaves its point out; the line under the chart names it (per-tick
              // words collide below 1280px, verifier V12-2).
              xTicks={TENORS.map((t, i) => ({ i, text: t }))}
              series={[
                // §6: today blue solid, a month ago gray dashed, each joining its served tenors; a month ago
                // dated apart is left unjoined (S-30).
                ...(agoJoined ? [{ key: "ago", values: TENORS.map((t) => (fin(ago?.[t]) ? (ago?.[t] as number) : null)), color: DESK_ACCENTS.gray, dash: "4 4", width: 1.5, label: "a month ago", connect: true }] : []),
                ...(todayJoined ? [{ key: "today", values: TENORS.map((t) => (fin(today[t]) ? (today[t] as number) : null)), color: DESK_ACCENTS.blue, width: 2.5, label: "today", connect: true }] : []),
              ]}
              // Both dates' points are marked, so a curve with tenors left out still shows each served point.
              markers={[
                ...TENORS.map((t, i) => ({ i, v: ago?.[t] as number, color: DESK_ACCENTS.gray, r: 3 })),
                ...TENORS.map((t, i) => ({ i, v: today[t] as number, color: DESK_ACCENTS.blue, r: 3.5 })),
              ].filter((p) => fin(p.v))}
              // Each value's label keeps clear of both lines (the kit places it); the first starts at its
              // point, clear of the y labels, and the last ends at it, clear of the two end labels.
              pointLabels={[
                // Today's values on its one curve; with no common date, each point's tenor and date (S-30).
                ...TENORS.map((t, i) => ({
                  i,
                  v: today[t] as number,
                  text: !fin(today[t]) ? "" : todayJoined ? num(today[t] as number, 2) : today.dates?.[t] ? `${t === todayLast ? "today · " : ""}${t} ${dayShort(today.dates[t])}` : "",
                  color: todayJoined ? "#c9cdd3" : DESK_ACCENTS.blue,
                  anchor: i === 0 ? ("start" as const) : i === TENORS.length - 1 ? ("end" as const) : undefined,
                  avoid: true,
                })),
                // S-30: each unjoined month-ago point carries its tenor and date.
                ...(agoJoined
                  ? []
                  : TENORS.map((t, i) => ({
                      i,
                      v: ago?.[t] as number,
                      text: ago?.dates?.[t] ? `${t === agoLast ? "a month ago · " : ""}${t} ${dayShort(ago.dates[t])}` : "",
                      color: DESK_ACCENTS.gray,
                      anchor: i === 0 ? ("start" as const) : i === TENORS.length - 1 ? ("end" as const) : undefined,
                      avoid: true,
                    }))),
              ].filter((p) => fin(p.v) && p.text)}
              pad={{ l: 46, r: 84, t: 18, b: 24 }}
              grid
            />
          ) : (
            <Awaiting>the curve</Awaiting>
          )}
          {/* §6: the tenors not served, and tenors dated apart, say so. */}
          {today && drawn && unservedTenors(today) ? <p className="mc-note">{unservedTenors(today)}</p> : null}
          {today && !today.date && today.dates ? <p className="mc-note">{tenorDates(today.dates)}</p> : null}
          {/* §6 (S-30): a month ago's dates, always. */}
          {agoNote ? <p className="mc-note">{agoNote}</p> : null}
          <ServedRead read={m?.reads?.curve} />
        </>
      ) : (
        <AwaitingStats labels={["10-year", "2s10s", "Front end"]} quiet={quiet} />
      )}
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="2y · 5y · 10y · 30y history · real yields · breakevens · curve by regime" missing="Tenor histories, real yields, breakevens and the curve by regime are not served yet." />
      </div>
    </section>
  );
}

type StockBondBlock = NonNullable<MacroResponse["stock_bond"]>;

/** desk/pdf-polish 5: the line under "Do bonds still hedge stocks?". */
export const TLT_NOTE = "TLT is a long-term Treasury bond ETF; its price falls when yields rise.";

/** "SPY vs TLT": the served pair. */
const pair = (sb: StockBondBlock) => `${sb.stock?.etf ?? "SPY"} vs ${sb.bond?.etf ?? "TLT"}`;

/** "60 daily log returns to Sep 23 · SPY vs TLT, adjusted closes · Yahoo": what the correlation reads, from the served window. */
export function sbStamp(sb: StockBondBlock): string {
  if (!sb.window?.end) return "";
  const prov = Array.isArray(sb.providers) && sb.providers.length ? ` · ${sb.providers.join("/")}` : "";
  // Codex R-02: the count is the served one; none is assumed.
  return `${fin(sb.window.n) ? `${sb.window.n} ` : ""}daily log returns to ${dayShort(sb.window.end)} · ${pair(sb)}, adjusted closes${prov}`;
}

function StockBond({ m, state }: { m: MacroResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const unserved = useBlockUnserved(m, "stock_bond");
  const sb = m?.stock_bond;
  const series = Array.isArray(sb?.series) ? sb.series : [];
  const drawn = series.filter((p) => fin(p.corr)).length > 1;
  // `flipped: null` is served as "no change of sign within the year"; an absent key is not served (§12.13).
  const flipServed = !!sb && "flipped" in sb && (sb.flipped === null || (typeof sb.flipped === "string" && /^\d{4}-\d{2}$/.test(sb.flipped)));
  // §1.0.2: the block, or the whole answer, served awaiting.
  if (unserved) return <UnservedCard headingId="mc-sb" className="mc-card" title="Do bonds still hedge stocks?" sub="60-day correlation of daily returns, one year" labels={["Today", "A year ago", "Flipped"]} block={unserved} advanced />;
  return (
    <section className="dk-card mc-card" aria-labelledby="mc-sb" aria-busy={quiet}>
      <CardHead id="mc-sb" title="Do bonds still hedge stocks?" sub="60-day correlation of daily returns, one year" />
      {/* desk/pdf-polish 5: what the bond side is, under the title, the owner's words. */}
      <p className="mc-sb-note">{TLT_NOTE}</p>
      <LoadingLine busy={quiet} />
      {sb ? (
        <>
          <StatRow cols={3}>
            {/* §12.8: the three numbers, each dated by its served session; no words and no hedging call are served. */}
            <Stat
              label="Today"
              value={fin(sb.today) ? corrText(sb.today) : undefined}
              awaiting={!fin(sb.today)}
              sub={fin(sb.today) && sb.today_date ? `${pair(sb)} · ${dayShort(sb.today_date)}` : undefined}
              why={sb.today_reason ?? undefined}
            />
            <Stat label="A year ago" value={fin(sb.year_ago) ? corrText(sb.year_ago) : undefined} awaiting={!fin(sb.year_ago)} sub={fin(sb.year_ago) && sb.year_ago_date ? dayLong(sb.year_ago_date) : undefined} />
            <Stat
              label="Flipped"
              value={flipServed ? (sb.flipped ? monthYear(sb.flipped) : "None") : undefined}
              awaiting={!flipServed}
              sub={flipServed && sb.flipped && sb.flipped_on && sb.flipped_to ? `to ${sb.flipped_to} on ${dayLong(sb.flipped_on)}` : undefined}
            />
          </StatRow>
          {drawn ? (
            <LineChart
              ariaLabel="60-day correlation of daily S&P and Treasury returns over the last year"
              height={132}
              n={series.length}
              yDomain={[-1, 1]}
              yTicks={[
                { v: 1, text: "+1" },
                { v: 0, text: "0" },
                { v: -1, text: "−1" },
              ]}
              grid={false}
              zero
              bands={[
                { from: 0, to: 1, fill: "rgba(232, 180, 71, 0.10)", label: "bonds move WITH stocks · no hedge", labelColor: DESK_ACCENTS.amber },
                { from: -1, to: 0, fill: "rgba(38, 220, 160, 0.08)", label: "bonds move AGAINST stocks · hedge works", labelColor: DESK_ACCENTS.green, labelAt: "bottom" },
              ]}
              series={[{ key: "corr", values: series.map((p) => (fin(p.corr) ? p.corr : null)), color: DESK_ACCENTS.blue, width: 2 }]}
              endDot="corr"
              xEnds={["a year ago", endDay([...series].reverse().find((p) => fin(p.corr))?.date)]}
              pad={{ l: 34, r: 16, t: 6, b: 22 }}
            />
          ) : (
            <Awaiting>the year of correlations</Awaiting>
          )}
          {sb.window?.end ? <p className="dk-asof">{sbStamp(sb)}</p> : null}
          <ServedRead read={m?.reads?.stock_bond} />
        </>
      ) : (
        <AwaitingStats labels={["Today", "A year ago", "Flipped"]} quiet={quiet} />
      )}
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="20 / 60 / 250-day · since 1990 · correlation by regime" missing="Other windows, the history since 1990 and the correlation by regime are not served yet." />
      </div>
    </section>
  );
}

function Credit({ m, state }: { m: MacroResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const unserved = useBlockUnserved(m, "credit");
  const c = m?.credit;
  const series = Array.isArray(c?.series) ? c.series : [];
  const vals = series.map((p) => p.hy).filter(fin);
  const ticks = vals.length ? coverTicks(Math.min(...vals), Math.max(...vals), 3) : [];
  const peak = c?.peak_12m && fin(c.peak_12m.hy) && c.peak_12m.date ? { date: c.peak_12m.date, hy: c.peak_12m.hy } : null;
  const peakI = peak ? series.findIndex((p) => p.date === peak.date) : -1;
  const edges = c?.band_edges;
  const range = c?.hy_range_3y;
  const lo = Array.isArray(range) ? range[0] : null;
  const hi = Array.isArray(range) ? range[1] : null;
  const pctile = c?.hy_pct_3y;
  // §1.0.2: the block, or the whole answer, served awaiting.
  if (unserved) return <UnservedCard headingId="mc-credit" className="mc-card" title="Credit" sub="high-yield spread over Treasuries" labels={["HY spread", "3-year range", "Investment grade"]} block={unserved} advanced />;
  return (
    <section className="dk-card mc-card" aria-labelledby="mc-credit" aria-busy={quiet}>
      <CardHead id="mc-credit" title="Credit" sub="high-yield spread over Treasuries" />
      <LoadingLine busy={quiet} />
      {c ? (
        <>
          <StatRow cols={3}>
            {/* §6: HY and IG dated; the 3-year range, or the served reason when it is null. */}
            <Stat label="HY spread" value={fin(c.hy?.value) ? `${num(c.hy.value, 2)}%` : undefined} awaiting={!fin(c.hy?.value)} sub={c.hy && fin(c.hy.value) ? [c.band ?? null, dayShort(c.hy.date) || null].filter(Boolean).join(" · ") || undefined : undefined} />
            {fin(lo) && fin(hi) ? (
              <Stat label="3-year range" value={`${num(lo)} – ${num(hi)}%`} sub={c.rank_window && dayShort(c.rank_window.start) ? `since ${dayLong(c.rank_window.start)}` : undefined} />
            ) : typeof c.reason === "string" && c.reason ? (
              <Stat label="3-year range" value="—" sub={c.reason} />
            ) : (
              <Stat label="3-year range" awaiting />
            )}
            <Stat label="Investment grade" value={fin(c.ig?.value) ? `${num(c.ig.value, 2)}%` : undefined} awaiting={!fin(c.ig?.value)} sub={c.ig && fin(c.ig.value) ? dayShort(c.ig.date) || undefined : undefined} />
          </StatRow>
          {fin(pctile) && edges && fin(edges[0]) && fin(edges[1]) ? (
            <Gauge
              min={0}
              max={1}
              value={pctile}
              under
              bands={[
                { label: "Tight", to: edges[0], tone: "green" },
                { label: "Normal", to: edges[1], tone: "neutral" },
                { label: "Wide", to: 1, tone: "amber" },
              ]}
              caption={`${ordinal(Math.round(pctile * 100))} pct`}
              label={`High-yield spread at the ${ordinal(Math.round(pctile * 100))} percentile of three years${c.band ? `, ${c.band}` : ""}`}
            />
          ) : (
            <Awaiting>the three-year percentile</Awaiting>
          )}
          <p className="dk-stat-label mc-sub-h">Last 12 months</p>
          {vals.length > 1 ? (
            <LineChart
              ariaLabel={`High-yield spread over the last year${peak && peakI >= 0 ? `; peak ${num(peak.hy)}% on ${dayShort(peak.date)}` : ""}`}
              height={100}
              n={series.length}
              yDomain={[ticks[0].v, ticks[ticks.length - 1].v]}
              yTicks={ticks.map((t) => ({ v: t.v, text: `${t.text}%` }))}
              series={[{ key: "hy", values: series.map((p) => (fin(p.hy) ? p.hy : null)), color: DESK_ACCENTS.blue, width: 2 }]}
              endDot="hy"
              xEnds={["a year ago", endDay([...series].reverse().find((p) => fin(p.hy))?.date)]}
              pointLabels={peak && peakI >= 0 ? [{ i: peakI, v: peak.hy, text: `${monthYear(peak.date).split(" ")[0]} peak · ${num(peak.hy)}%`, color: DESK_ACCENTS.gray, dy: -7 }] : []}
              pad={{ l: 34, r: 16, t: 14, b: 20 }}
            />
          ) : (
            <Awaiting />
          )}
          <ServedRead read={m?.reads?.credit} />
        </>
      ) : (
        <AwaitingStats labels={["HY spread", "3-year range", "Investment grade"]} quiet={quiet} />
      )}
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="IG · BB · B · CCC · spread history · widening as an event" missing="The rating buckets, their history and the widening study are not served on this tab yet." />
      </div>
    </section>
  );
}

/** "60 daily returns to Sep 23 · VIX to Sep 22": the rows' served dates, the most common first, any other named. */
export function corrStamp(rows: readonly CorrelationRow[]): string {
  const dated = rows.filter((r) => fin(r.corr) && r.date);
  if (!dated.length) return "";
  const counts = new Map<string, number>();
  for (const r of dated) counts.set(r.date as string, (counts.get(r.date as string) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0];
  const n = dated.find((r) => r.date === main)?.window?.n;
  const others = dated.filter((r) => r.date !== main).map((r) => `${r.symbol ?? r.asset} to ${dayShort(r.date)}`);
  // Codex R-02: the count is the served one; none is assumed.
  return [`${fin(n) ? `${n} ` : ""}daily returns to ${dayShort(main)}`, ...others, "each against SPY"].join(" · ");
}

function Correlations({ m, state }: { m: MacroResponse | undefined; state: State }) {
  const quiet = state === "loading";
  const unserved = useBlockUnserved(m, "correlations");
  const rows = Array.isArray(m?.correlations) ? m.correlations : [];
  // §1.0.2: the block, or the whole answer, served awaiting.
  if (unserved) return <UnservedCard headingId="mc-corr" className="mc-card" title="What moves with the S&P" sub="60-day correlation · each asset against the index" labels={[]} block={unserved} />;
  return (
    <section className="dk-card mc-card" aria-labelledby="mc-corr" aria-busy={quiet}>
      <CardHead id="mc-corr" title="What moves with the S&P" sub="60-day correlation · each asset against the index" />
      <LoadingLine busy={quiet} />
      {rows.length ? (
        <>
          <p className="mc-axis" aria-hidden="true">
            <span data-tone="green">← moves against · a hedge</span>
            <span data-tone="amber">moves with · same bet →</span>
          </p>
          <ul className="mc-corr" aria-label="Correlation with the S&P">
            {rows.map((r) => (
              <li key={r.asset}>
                <span className="mc-asset">{r.asset}</span>
                {fin(r.corr) ? (
                  <>
                    <span className="mc-bar" aria-hidden="true">
                      <span data-tone={r.corr < 0 ? "green" : "amber"} style={r.corr < 0 ? { right: "50%", width: `${Math.min(1, -r.corr) * 50}%` } : { left: "50%", width: `${Math.min(1, r.corr) * 50}%` }} />
                    </span>
                    <span className="mc-val" data-tone={r.corr < 0 ? "green" : r.corr > 0 ? "amber" : undefined}>
                      {corrText(r.corr)}
                    </span>
                    {/* §12.13: each asset declares what is correlated: its symbol, quantity and transform. */}
                    <span className="mc-meaning" title={[r.quantity, r.transform].filter(Boolean).join(", ") || undefined}>
                      {r.symbol ?? ""}
                    </span>
                  </>
                ) : r.reason && !r.reason.startsWith("Awaiting refresh") ? (
                  <span className="mc-row-await dk-stat-await" title={r.reason}>
                    not available · {r.reason}
                  </span>
                ) : (
                  <span className="mc-row-await dk-stat-await" title={r.reason ?? undefined}>
                    Awaiting refresh
                  </span>
                )}
              </li>
            ))}
          </ul>
          {corrStamp(rows) ? <p className="dk-asof">{corrStamp(rows)}</p> : null}
          {rows.some((r) => fin(r.corr)) ? <ServedRead read={m?.reads?.correlations} /> : null}
        </>
      ) : quiet ? null : (
        <Awaiting>the correlations</Awaiting>
      )}
      <DroppedNote n={droppedOf(m, "correlations")} one="asset" />
      {/* desk/matrix: no Advanced control. The full matrix is its own card below; rolling windows and the
          correlations by regime are not served, and Build Notes lists them under what comes next. */}
    </section>
  );
}

/**
 * A cell's tint on the Desk's palette (§1.3): green for a negative
 * correlation (moves against), amber for a positive one (moves with), the
 * alpha rising with |r| from 0.06 at zero to 0.5 at ±1, as the "What moves"
 * bars read; gray on the diagonal. Nothing for a cell without a value.
 */
export function matrixTint(r: number | null, diagonal = false): string | undefined {
  if (!fin(r)) return undefined;
  if (diagonal) return "rgba(139, 146, 158, 0.14)";
  const a = (0.06 + 0.44 * Math.min(1, Math.abs(r))).toFixed(3);
  if (r === 0) return `rgba(139, 146, 158, ${a})`;
  return r < 0 ? `rgba(38, 220, 160, ${a})` : `rgba(232, 180, 71, ${a})`;
}

/**
 * The window as served (Codex R-02): "60 daily returns · Jun 30 to Sep 23, 2026 · the same window for every pair"
 * when the window holds the whole horizon; otherwise the coverage it holds, "Only 29 daily returns to Sep 25,
 * 2026, from Aug 14; each pair needs 60". No count is assumed: without a served count and horizon, nothing.
 */
export function matrixStamp(mx: MatrixBlock): string {
  const w = mx.window;
  const h = mx.horizon;
  if (!w?.start || !w.end || !fin(w.n) || !fin(h)) return "";
  const prov = mx.providers?.length ? [mx.providers.join("/")] : [];
  if (w.n === h) return [`${w.n} daily returns · ${dayShort(w.start)} to ${dayLong(w.end)}`, "the same window for every pair", ...prov].join(" · ");
  const span = w.n > 0 ? `Only ${w.n} daily returns to ${dayLong(w.end)}, from ${dayShort(w.start)}` : `No daily return to ${dayLong(w.end)}`;
  return [`${span}; each pair needs ${h}`, ...prov].join(" · ");
}

function Matrix({ m, state }: { m: MacroResponse | undefined; state: State }) {
  const quiet = state === "loading";
  const unserved = useBlockUnserved(m, "matrix");
  const mx = m?.matrix;
  const title = "Correlation matrix";
  const sub = "60-day correlation of daily returns · every pair of 12 assets";
  if (unserved) return <UnservedCard headingId="mc-mx" className="mc-card mc-mx-card" title={title} sub={sub} labels={[]} block={unserved} />;
  // Codex R-01: the grid is read as one fact. A served matrix that fails any check (the assets and their order,
  // 12×12, symmetry, the unit diagonal, the no-data list, the lead against the cells) is not drawn at all.
  const problem = mx ? matrixProblem(mx) : null;
  if (problem) {
    const block = { reason: `Awaiting refresh: the matrix as served could not be read (${problem}).`, until: null };
    return <UnservedCard headingId="mc-mx" className="mc-card mc-mx-card" title={title} sub={sub} labels={[]} block={block} />;
  }
  const grid = mx ?? null;
  const noData = new Map((grid?.no_data ?? []).map((n) => [n.symbol, n.reason ?? ""]));
  const name = (i: number) => grid?.labels?.[i] ?? "";
  const end = grid?.window?.end;
  return (
    <section className="dk-card mc-card mc-mx-card" aria-labelledby="mc-mx" aria-busy={quiet}>
      <CardHead id="mc-mx" title={title} sub={sub} />
      {/* desk/usability §14.10, §14.12: loading, or Couldn't load · Retry, as the 2×2's cards say it. */}
      <LoadingLine busy={quiet} />
      {grid ? (
        <>
          {/* matrix-lead-v1: the served sentence, every number in it a served cell. */}
          {grid.lead?.text ? <p className="mc-lead">{grid.lead.text}</p> : null}
          <div className="mc-matrix-wrap" data-scrollable="true" tabIndex={0} role="region" aria-label="The 60-day correlation matrix, every pair">
            <table className="mc-matrix">
              <caption className="dk-asof">{matrixStamp(grid)}</caption>
              <thead>
                <tr>
                  <td />
                  {/* desk/pdf-polish 7: each asset's column head carries its definition (the served name stays its title
                      only where no definition is written). */}
                  {grid.assets.map((a, j) => (
                    <th key={a} scope="col" title={GLOSSARY[`mx-${a}`] ? undefined : name(j) || undefined} data-nodata={noData.has(a) || undefined}>
                      <Term ids={[`mx-${a}`]}>{a}</Term>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.assets.map((a, i) => (
                  <tr key={a}>
                    <th scope="row" data-nodata={noData.has(a) || undefined}>
                      <span className="mc-mx-sym">{a}</span>
                      <span className="mc-mx-name">{noData.has(a) ? "no data" : name(i)}</span>
                    </th>
                    {grid.assets.map((b, j) => {
                      const v = grid.values[i]?.[j] ?? null;
                      const why = noData.get(a) ?? noData.get(b);
                      const tip = fin(v) ? `${a} and ${b}: ${corrText(v)}${end && fin(grid.window?.n) ? `, ${grid.window?.n} daily returns to ${dayShort(end)}` : ""}` : `${a} and ${b}: no data${why ? `, ${why}` : ""}`;
                      return (
                        <td key={b} title={tip} data-diag={i === j || undefined} data-nodata={!fin(v) || undefined} style={{ background: matrixTint(v, i === j) }}>
                          {fin(v) ? (i === j ? num(v, 2) : corrText(v)) : "no data"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mc-mx-legend" aria-hidden="true">
            <span>−1 moves against</span>
            {[-1, -0.5, 0, 0.5, 1].map((r) => (
              <span key={r} className="mc-mx-swatch" style={{ background: matrixTint(r) }} />
            ))}
            <span>+1 moves with</span>
          </div>
          {noData.size ? (
            <ul className="mc-mx-nodata">
              {[...noData].map(([sym, why]) => (
                <li key={sym}>
                  <span className="mc-mx-sym">{sym}</span> no data{why ? ` · ${why}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : quiet ? null : (
        <Awaiting>the matrix</Awaiting>
      )}
    </section>
  );
}

/** "FRED", or "FRED/Yahoo" when a served ETF block names its provider. */
export function sources(m: MacroResponse): string {
  const prov = new Set<string>(m.stock_bond?.providers ?? []);
  return ["FRED", ...prov].join("/");
}

export default function MacroPage({ page }: { page: DeskPage }) {
  const q = useMacro();
  const m = q.data;
  const state: State = m ? "ready" : q.isError ? "awaiting" : "loading";
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="mc">
      {/* §6: `● Live · FRED · <date>`, the curve's own date (the HY date when the tenors are dated apart); the ETF blocks'
          provider joins the source once one is served (desk/fill-etf). */}
      <PageTitle page={page} badge={unserved ? <NotServedBadge boxed block={unserved} /> : m ? <LiveBadge boxed parts={[sources(m), dayShort(m.curve?.today?.date ?? m.credit?.hy?.date) || null]} /> : null} />
      <Unserved block={unserved}>
        <FailedScope q={q}>
          <div className="mc-grid">
            <Curve m={m} state={state} />
            <StockBond m={m} state={state} />
            <Credit m={m} state={state} />
            <Correlations m={m} state={state} />
          </div>
          <Matrix m={m} state={state} />
        </FailedScope>
      </Unserved>
    </div>
  );
}
