/**
 * Technicals (DESK_FRAME3_SPEC §3, screens/02-technicals.png): the S&P 500's
 * trend, momentum and what protection costs, every marker scored by the
 * event-study engine. Reads /technicals (§12.7: its vol block awaiting, its
 * sectors block the sector leadership /sectors serves, §12.14) and /ledger
 * (§12.5, the rows in `signals_allowlist` order). Grid:
 * the vol card spans the left column; price and signals on top; sector
 * leadership and RSI below; MACD and seasonality in a third row (desk/fill-compute). The vol column is a
 * PROTOTYPE card (§1.0.3, ../prototypes/ProtectionCard) while a ready /technicals serves its vol
 * block awaiting as not yet served, and the LIVE card in every other state. Every number is a served field, formatted, and
 * dated by its own served dates; the trend's words spell the served
 * `trend.state` (§3).
 * A card stays quiet while its first answer is on its way, and keeps its
 * labels with "Awaiting refresh" when its endpoint fails or its block is
 * missing (§1.7).
 *
 * desk/usability §14.2: `?symbol=XYZ` shows any US-listed stock or ETF on the
 * same shared figures (price and averages, RSI, MACD, seasonality), with its
 * drawdown and realized volatility, and its strength against the S&P 500; its
 * crosses are shown, never scored, and the S&P-only cards (the scored
 * signals, the options, the sector bars) stay on the S&P's page, which one
 * line links to. The range is the address's (`range=`).
 */

import { Link, useSearchParams } from "react-router-dom";
import { unavailableOf, useLedger, useTechnicals } from "../data/api";
import type { Unavailable } from "../data/envelope";
import { droppedOf } from "../data/schema";
import type { LedgerResponse, LedgerRow, SectorsResponse, TechnicalsResponse, VolResponse } from "../data/types";
import { nyToday } from "../DeskSidebar";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { capitalize, dayLong, dayShort, leadershipGaps, monthYear, num, ordinal, pct, pctPlain, priceText, signed, tickText, year } from "../kit/format";
import { moveText, tipOf } from "../kit/units";
import LineChart, { extentTicks } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import Gauge from "../kit/Gauge";
import TrendChart, { drawable, monthTicks, RangeChips } from "../kit/TrendChart";
import RankBars from "../kit/RankBars";
import { AdvancedPanel, Awaiting, DroppedNote, isAwaitingRefresh, LiveBadge, NotServedBadge, Signed, Stat, StatRow, Unserved, UnservedCard, useAdvanced, useUnserved, VerdictPill, VerdictWord, LoadingLine, FailedScope, eitherFailed } from "../kit/ui";
import { ProtectionCard } from "../prototypes/ProtectionCard";
import { SPX_SYMBOLS, symbolOf } from "./symbol";
import "./technicals.css";
import { defineTerms } from "../kit/Term";

type CardState = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A query's card state: quiet while loading, awaiting on an error or when
 * `hasBlock` says the answer lacks what the card reads (verifier T-2). */
function stateOf(q: { data?: unknown; isError: boolean }, hasBlock = true): CardState {
  if (q.data && hasBlock) return "ready";
  return q.isError || q.data ? "awaiting" : "loading";
}

// ── Vol ──────────────────────────────────────────────────────────────────

/** "2023-10" → "Q4 2023"; "" when the stamp has no month. */
export function quarterOf(iso: string | null | undefined): string {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  return m ? `Q${Math.floor((Number(m[2]) - 1) / 3) + 1} ${m[1]}` : "";
}

const VOL_LABELS = [
  <>
    PUTS <span className="dk-lc">vs</span> CALLS · 1 MONTH OUT
  </>,
  <>
    WHAT OPTIONS EXPECT <span className="dk-lc">vs</span> WHAT HAPPENED
  </>,
  "1 MONTH · 3 MONTHS · 6 MONTHS",
];

function VolCard({ vol, state }: { vol: VolResponse | undefined; state: CardState }) {
  const adv = useAdvanced();
  const items = "put IV vs call IV · which side moved · full 2-year skew line · chain provenance";
  const pctile = fin(vol?.skew_pct_2y) ? Math.round(vol.skew_pct_2y * 100) : null;
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-vol-title" className="te-vol" title="What protection costs right now" sub="S&P 500 options, read from the SPY chain at last close." labels={[...VOL_LABELS, "Skew · where it sits"]} cols={1} block={unserved} advanced />;
  return (
    <section className="dk-card te-vol" aria-labelledby="te-vol-title" aria-busy={state === "loading"}>
      <div className="te-vol-head">
        <h2 className="dk-card-title" id="te-vol-title">
          What protection costs right now
        </h2>
        <p className="te-vol-sub">S&amp;P 500 options, read from the SPY chain at last close.</p>
      </div>
      <LoadingLine busy={state === "loading"} />
      {state !== "ready" || !vol ? (
        <>
          {[...VOL_LABELS, "SKEW · WHERE IT SITS"].map((l, i) => (
            <div key={i} className="te-vol-sec">
              {state === "awaiting" ? <Stat label={l} awaiting /> : <div className="dk-stat-label">{l}</div>}
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="te-vol-sec">
            <Stat label={VOL_LABELS[0]} value={fin(vol.skew_25d_1m_pts) ? `${signed(vol.skew_25d_1m_pts)} pts` : undefined} awaiting={!fin(vol.skew_25d_1m_pts)} tone={fin(vol.skew_25d_1m_pts) && vol.skew_25d_1m_pts > 0 ? "amber" : undefined} size="xl" />
            {fin(vol.skew_25d_1m_pts) ? (
              <p className="te-vol-meaning">
                {vol.skew_25d_1m_pts >= 0
                  ? `Puts are ${num(Math.abs(vol.skew_25d_1m_pts))} vol points more expensive than calls.`
                  : `Calls are ${num(Math.abs(vol.skew_25d_1m_pts))} vol points more expensive than puts.`}
              </p>
            ) : null}
            {vol.skew_trend ? <p className="te-vol-context">{`${capitalize(vol.skew_trend)}.`}</p> : null}
          </div>
          <div className="te-vol-sec">
            {fin(vol.atm_iv_1m) && fin(vol.realized_20d) ? (
              <>
                <Stat
                  label={VOL_LABELS[1]}
                  value={
                    <>
                      {num(vol.atm_iv_1m)} <span className="te-vs">vs</span> {num(vol.realized_20d)}
                    </>
                  }
                  size="xl"
                />
                <p className="te-vol-meaning">
                  Options price {num(vol.atm_iv_1m)}% annual movement; the last 20 days delivered {num(vol.realized_20d)}%.
                </p>
              </>
            ) : (
              <Stat label={VOL_LABELS[1]} awaiting />
            )}
          </div>
          <div className="te-vol-sec">
            {vol.term && fin(vol.term["1m"]) && fin(vol.term["3m"]) && fin(vol.term["6m"]) ? (
              <Stat label={VOL_LABELS[2]} value={`${num(vol.term["1m"])} · ${num(vol.term["3m"])} · ${num(vol.term["6m"])}`} size="xl" />
            ) : (
              <Stat label={VOL_LABELS[2]} awaiting />
            )}
          </div>
          <div className="te-vol-sec te-vol-gauge">
            <div className="dk-stat-label">{defineTerms("SKEW · WHERE IT SITS")}</div>
            {/* §12.13 serves the percentile without band edges (the bands are specified when the card is built). */}
            {pctile != null ? <p className="te-vol-meaning">{`${ordinal(pctile)} percentile of two years`}</p> : <Awaiting />}
          </div>
        </>
      )}
      <div className="te-vol-foot">
        <AdvancedPanel adv={adv} items={items} missing="The API serves no put and call IV split, skew history or chain provenance for this card yet." />
        {vol?.source ? (
          <p className="te-source">
            Source: {vol.source.toUpperCase()} options, one pull per close · live read, not scored{quarterOf(vol.history_from) ? ` (history from ${quarterOf(vol.history_from)})` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** §12.7: every field of /technicals describes the S&P (`spx`); an answer naming another instrument is not the S&P's. */
export function isSpx(t: TechnicalsResponse | undefined): boolean {
  // desk/usability §14.2: the answer names its symbol (a stock's page is never the S&P's).
  const inst = (t as { instrument?: unknown } | undefined)?.instrument ?? t?.symbol;
  return inst == null || inst === "spx" || inst === "^GSPC";
}

/**
 * §3, §1.0.3 (Codex R-03): the vol column is the PROTOTYPE card ("What protection costs right now") only when
 * /technicals answered ready, for the S&P, and served its vol block awaiting as not yet served. Everything else
 * keeps the LIVE card in its own state: loading (quiet), the route awaiting (its reason) or failed (Awaiting
 * refresh), an answer without the block (Awaiting refresh), the block ready, or awaiting a refresh of what is
 * live. An awaiting or failed answer never falls back to the illustrative figures.
 */
export function volIsPrototype(t: TechnicalsResponse | undefined, routeOff: Unavailable | null, failed: boolean): boolean {
  if (!t || routeOff || failed || !isSpx(t)) return false;
  const block = t._blocks?.vol;
  return !t.vol && !!block && !isAwaitingRefresh(block);
}

// ── Price and its two trend lines ─────────────────────────────────────────

type Range = "6m" | "1y" | "3y";
const RANGES: readonly Range[] = ["6m", "1y", "3y"];

/** §14.2: the chart ranges the answer serves (a stock's two years of bars carry 6M and 1Y). */
export function servedRanges(t: TechnicalsResponse | undefined): Range[] {
  const s = t?.series;
  return RANGES.filter((r) => Array.isArray(s?.[r]));
}

/** The address's range when the answer serves it, else 1Y (§3's default), else the longest served. */
export function rangeOf(asked: string | null, served: readonly Range[]): Range {
  const want = (asked ?? "").toLowerCase() as Range;
  if (served.includes(want)) return want;
  if (!served.length || served.includes("1y")) return "1y";
  return served[served.length - 1];
}

/** The month ticks the charts read live in the kit (desk/books: Basket & Hedge draws the same price chart);
 * the MACD chart (desk/fill-compute) reads them too. */
export { monthTicks };

/** "+0.4% today", or the session's own day when it is not New York's today (D13). */
/** "+0.4% on Sep 22" (§3: `chg_1d` "on <chg_1d_dates.to>"), "today" for today's session. */
export function dayMove(chg: number, to: string, today = nyToday()): string {
  return `${pct(chg)} ${to === today ? "today" : `on ${dayShort(to)}`}`;
}

/** "price is 2.1% above" from the served distance to an average. */
export function aboveBelow(frac: number): string {
  const n = Math.abs(frac * 100).toFixed(1);
  return frac >= 0 ? `price is ${n}% above` : `price is ${n}% below`;
}

function PriceCard({ t, state, cross, range, onRange, scored }: { t: TechnicalsResponse | undefined; state: CardState; cross: LedgerRow | undefined; range: Range; onRange: (r: Range) => void; scored: boolean }) {
  const served = servedRanges(t);
  const chips = served.length ? served : RANGES;
  const name = scored ? "S&P 500" : (t?.symbol ?? "");
  const title = scored ? "S&P 500" : [t?.symbol, t?.name && t.name !== t.symbol ? t.name : null].filter(Boolean).join(" · ");
  // §12.7: a missing close is a point with close null; the line breaks there, never bridging the slot (Codex R-25).
  const pts = (t?.series?.[range] ?? []).filter((p) => typeof p?.date === "string");
  const ready = state === "ready" && !!t;
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-price-title" className="te-price" title={title || "S&P 500"} sub="price and its two trend lines" labels={["Price", "50-day average", "200-day average"]} block={unserved} />;
  return (
    <section className="dk-card te-price" aria-labelledby="te-price-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-price-title">
          {title || (scored ? "S&P 500" : "Price")}
          <span className="dk-card-sub"> price and its two trend lines</span>
        </h2>
        <RangeChips className="te-range" ranges={chips} value={range} onChange={onRange} />
      </div>
      <LoadingLine busy={state === "loading"} />
      <StatRow cols={3}>
        <Stat label="Price" awaiting={state === "awaiting" || (ready && !fin(t.price))} value={ready && fin(t.price) ? priceText(t.price, scored) : undefined} sub={ready && fin(t.chg_1d) && t.chg_1d_dates ? <Signed value={t.chg_1d}>{dayMove(t.chg_1d, t.chg_1d_dates.to)}</Signed> : undefined} />
        <Stat label="50-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma50))} value={ready && fin(t.ma50) ? priceText(t.ma50, scored) : undefined} tone="green" sub={ready && fin(t.vs_ma50) ? aboveBelow(t.vs_ma50) : undefined} />
        <Stat label="200-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma200))} value={ready && fin(t.ma200) ? priceText(t.ma200, scored) : undefined} tone="gray" sub={ready && fin(t.vs_ma200) ? aboveBelow(t.vs_ma200) : undefined} />
      </StatRow>
      {ready && drawable(pts) ? (
        <TrendChart
          ariaLabel={`${name || "The price"} with its 50-day and 200-day averages, ${range.toUpperCase()}`}
          mainLabel={name || "Price"}
          points={pts}
          crosses={t.cross ? [t.cross] : []}
          ticks={range === "3y" ? 4 : 3}
          tickText={tickText}
        />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {/* §14.2: a stock's crosses are shown and labelled not scored; the engine scores the S&P 500's. */}
      {ready && !scored && t.cross ? (
        <div className="te-callout" data-unscored="">
          <b>
            {dayLong(t.cross.date)} — the 50-day crossed {t.cross.kind === "golden" ? "above" : "below"} the 200-day.
          </b>{" "}
          Not scored: the engine scores crosses of the S&amp;P 500 only.
        </div>
      ) : ready && !scored && !t.cross ? (
        <p className="te-nocross">No 50-day and 200-day cross in the history served.</p>
      ) : null}
      {ready && scored && t.cross && cross ? (
        <div className="te-callout" data-verdict={cross.verdict}>
          <b>
            <span className="dk-dot" aria-hidden="true" /> {dayLong(t.cross.date)} — the 50-day crossed {t.cross.kind === "golden" ? "above" : "below"} the 200-day.
          </b>{" "}
          {fin(cross.n) ? `This has happened ${cross.n} times before` : "How often this has happened is awaiting refresh"}
          {fin(cross.up_pct) ? `; the S&P was higher a month later ${pctPlain(cross.up_pct)} of the time` : ""}. <VerdictWord verdict={cross.verdict} />.
        </div>
      ) : null}
    </section>
  );
}

// ── Signals ──────────────────────────────────────────────────────────────

/** §3: the Ledger rows named by `signals_allowlist`, in its order; a slug the Ledger does not serve is left out. */
export function allowlistRows(ledger: LedgerResponse | undefined, allow: readonly string[] | undefined): LedgerRow[] {
  const rows = Array.isArray(ledger?.signals) ? ledger.signals : [];
  return (allow ?? []).map((slug) => rows.find((r) => r.slug === slug)).filter((r): r is LedgerRow => !!r && r.available !== false && fin(r.n));
}

/** §3: `trend.state` in words, "Above both" / "Below both" / "Mixed" ("Unavailable" when an average is null). */
export function trendWord(state: string | undefined): string | null {
  return ({ above_both: "Above both", below_both: "Below both", mixed: "Mixed", unavailable: "Unavailable" } as Record<string, string>)[state ?? ""] ?? null;
}

const bySlug = (ledger: LedgerResponse | undefined, slug: string) => (Array.isArray(ledger?.signals) ? ledger.signals.find((r) => r.slug === slug && fin(r.n)) : undefined);

function SignalsCard({ t, tState, ledger, lState }: { t: TechnicalsResponse | undefined; tState: CardState; ledger: LedgerResponse | undefined; lState: CardState }) {
  // §3: the Ledger rows in `signals_allowlist` order, the two RSI rows among them.
  const rows = allowlistRows(ledger, t?.signals_allowlist);
  const ready = tState === "ready" && !!t;
  const aw = tState === "awaiting";
  // Codex R-26: the list is drawn from a served allowlist only; an absent one is Awaiting refresh, an empty one an empty panel.
  const listed = ready && Array.isArray(t.signals_allowlist) && lState === "ready";
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-sig-title" className="te-signals" title="Signals" sub="what fired, and what usually follows" labels={["1-year return", "Trend", "Last 20 days"]} block={unserved} />;
  return (
    <section className="dk-card te-signals" aria-labelledby="te-sig-title" aria-busy={tState === "loading" || lState === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-sig-title">
          Signals<span className="dk-card-sub"> what fired, and what usually follows</span>
        </h2>
      </div>
      <LoadingLine busy={tState === "loading" || lState === "loading"} />
      <StatRow cols={3}>
        {/* §3: 1-YEAR RETURN dated by `ret_1y_dates`; TREND the served state since `state_since`; LAST 20 DAYS in σ. */}
        <Stat label="1-year return" awaiting={aw || (ready && !fin(t.ret_1y))} value={ready && fin(t.ret_1y) ? pct(t.ret_1y) : undefined} tone={ready && fin(t.ret_1y) ? (t.ret_1y >= 0 ? "up" : "down") : undefined} sub={ready && t.ret_1y_dates && dayLong(t.ret_1y_dates.from) ? `since ${dayLong(t.ret_1y_dates.from)}` : undefined} />
        {/* §3's words ("Above both") are wider than a number: the small size keeps them in their column. */}
        <Stat label="Trend" size="sm" awaiting={aw || (ready && !trendWord(t.trend?.state))} value={ready ? (trendWord(t.trend?.state) ?? undefined) : undefined} tone={ready ? (t.trend?.state === "above_both" ? "up" : t.trend?.state === "below_both" ? "down" : undefined) : undefined} sub={ready && dayLong(t.trend?.state_since) ? `since ${dayLong(t.trend?.state_since)}` : undefined} />
        <Stat
          label="Last 20 days"
          awaiting={aw || (ready && !fin(t.move_20d_sigma))}
          value={ready && fin(t.move_20d_sigma) ? `${signed(t.move_20d_sigma)}σ` : undefined}
          sub={ready && dayShort(t.move_20d_date) ? `on ${dayShort(t.move_20d_date)}` : undefined}
        />
      </StatRow>
      {listed ? (
        <ul className="te-sig-list">
          {rows.map((r) => (
            <li key={r.slug}>
              {/* §12.3: one canonical label per slug, reused by every tab (v2 §19). */}
              <b>{r.label}</b>
              <span className="te-sig-text">
                {fin(r.n) ? `${r.n}×` : "—"}
                {fin(r.n) && year(r.sample_start) ? ` since ${year(r.sample_start)}` : ""}
                {fin(r.up_pct) ? (
                  <>
                    {" "}
                    · up <b>{pctPlain(r.up_pct)}</b>
                  </>
                ) : null}
                {fin(r.median) && moveText(r.median, r.target_unit ?? undefined) ? (
                  <>
                    {" "}
                    · a month later{" "}
                    <Signed value={r.median} bold title={tipOf(r.target_unit ?? undefined)}>
                      {moveText(r.median, r.target_unit ?? undefined)}
                    </Signed>
                  </>
                ) : null}
              </span>
              <VerdictPill verdict={r.verdict} />
            </li>
          ))}
        </ul>
      ) : lState === "awaiting" || aw || (ready && lState === "ready") ? (
        <Awaiting />
      ) : null}
      {/* §3's note box: there is no universal normal month (§1.5). */}
      {/* Codex R-16: a row the allowlist or the Ledger lost at the boundary is said, never silently left out. */}
      <DroppedNote n={droppedOf(t, "signals_allowlist") + droppedOf(ledger, "signals")} one="signal row" />
      {listed ? <div className="dk-read te-note">vs normal compares each study to its own baseline over its own sample.</div> : null}
    </section>
  );
}

// ── Sector leadership (seven of eleven; §12.14, desk/fill-etf) ────────────

/** "Technology and Industrials leading; Staples and Utilities lagging": the served ranking's two ends, named;
 * with `among` ("among the 10 sectors with data") when some sectors have no return (Codex R-01). */
export function endsLine(rows: readonly { name: string }[], among = ""): string {
  if (rows.length < 4) return "";
  const two = (a: { name: string }, b: { name: string }) => `${a.name} and ${b.name}`;
  return `${two(rows[0], rows[1])} leading; ${two(rows[rows.length - 2], rows[rows.length - 1])} lagging${among ? `, ${among}` : ""}`;
}

/** The seven the card shows (§3): the top three, the middle one, the bottom three. */
export function sevenOf<T>(sorted: readonly T[]): T[] {
  if (sorted.length <= 7) return [...sorted];
  const mid = Math.floor((sorted.length - 1) / 2);
  return [...sorted.slice(0, 3), sorted[mid], ...sorted.slice(-3)];
}

function SectorCard({ s, state }: { s: SectorsResponse | undefined; state: CardState }) {
  const adv = useAdvanced();
  const served = Array.isArray(s?.leadership) ? s.leadership : [];
  type Row = NonNullable<SectorsResponse["leadership"]>[number];
  type Valued = Row & { rel_ret: number };
  const rows = served.filter((r): r is Valued => fin(r.rel_ret)).sort((a, b) => b.rel_ret - a.rel_ret);
  const toRow = (r: Row) => ({ key: r.etf, ticker: r.etf, name: r.short ?? "", value: fin(r.rel_ret) ? r.rel_ret : null, note: r.reason ?? null, title: "log return, ×100" });
  const lo = rows.length ? rows[rows.length - 1].rel_ret : 0;
  const hi = rows.length ? rows[0].rel_ret : 0;
  // Codex R-01: a sector without a return is never hidden: its row follows the seven, with why, and the
  // ranking says it is only among the sectors with data.
  const gaps = leadershipGaps(s);
  const without = served.filter((r) => !fin(r.rel_ret));
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-sect-title" className="te-sectors" title="Sector leadership · 3-month relative strength vs S&P" block={unserved} advanced />;
  return (
    <section className="dk-card te-sectors" aria-labelledby="te-sect-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-sect-title">
          {defineTerms(`Sector leadership · ${s && fin(s.window_months) ? `${s.window_months}-month` : "3-month"} relative strength vs S&P`)}
        </h2>
      </div>
      <LoadingLine busy={state === "loading"} />
      {state === "ready" && endsLine(rows) ? <p className="te-sect-read">{endsLine(rows, gaps.among)}</p> : null}
      {state === "ready" && rows.length ? (
        <>
          <RankBars
            label={`Sector ETFs against the S&P, top three, middle and bottom three${without.length ? ", then the sectors without data" : ""}`}
            rows={[...sevenOf(rows), ...without].map(toRow)}
            lo={lo}
            hi={hi}
          />
          {gaps.note ? (
            <p className="dk-missing" role="note">
              {gaps.note}
            </p>
          ) : null}
          {s?.window?.end ? (
            <p className="dk-asof">
              {`${fin(s.window.n) ? s.window.n : 60} sessions to ${dayShort(s.window.end)} · log returns ×100 · ${(s.providers ?? []).join("/") || "asset_prices"}`}
            </p>
          ) : null}
        </>
      ) : state === "loading" ? null : (
        <Awaiting>the sector ETFs are not ingested yet</Awaiting>
      )}
      <DroppedNote n={droppedOf(s, "leadership")} one="sector" />
      <div className="te-foot">
        {/* All eleven come from the sectors block once served; until then the control is not shown (§1.4, §14.13). */}
        <AdvancedPanel enabled={rows.length > 0} adv={adv} items="all 11 · rotation over time · by regime" missing="Rotation over time and leadership by regime are not served yet.">
          {rows.length ? <RankBars label="All eleven sector ETFs against the S&P" rows={served.map(toRow)} lo={lo} hi={hi} /> : null}
        </AdvancedPanel>
      </div>
    </section>
  );
}

// ── Momentum · RSI ───────────────────────────────────────────────────────

/** A served day in the as-of year prints without its year ("Jun 12"), otherwise with it ("Apr 8, 2025"). */
export function dayInYear(iso: string | null | undefined, asOf: string): string {
  if (!iso) return "";
  return iso.slice(0, 4) === asOf.slice(0, 4) ? dayShort(iso) : dayLong(iso);
}

/** §3: the zone a served RSI sits in, by the two levels the RSI studies cross: strictly above 70
 * overbought, strictly below 30 oversold, neutral between. */
export function rsiZone(x: number): "overbought" | "oversold" | "neutral" {
  return x > 70 ? "overbought" : x < 30 ? "oversold" : "neutral";
}

/** §12.13: "rising" and "falling" come only from the two served numbers, the RSI and the one before it; null without both. */
export function rsiDirection(now: number | null | undefined, prev: number | null | undefined): "rising" | "falling" | "flat" | null {
  if (!fin(now) || !fin(prev)) return null;
  return now > prev ? "rising" : now < prev ? "falling" : "flat";
}

/** "the S&P" on the S&P's page (§3's words), a stock's ticker on its own ("is NVDA stretched"). */
const theOf = (short: string) => (short === "S&P" ? "the S&P" : short);

/** A zone's last session: its day, and the instrument's simple return over the next 20 sessions once they have passed
 * (the S&P's on its own page; desk/usability: a stock's on its);
 * Codex R-08: a window not complete yet and a close not stored each say their own reason. */
export function visitSub(v: TechnicalsResponse["rsi_last_above_70"], short = "S&P") {
  if (!v) return undefined;
  if (fin(v.after_20d) && (v.after_20d_status ?? "complete") === "complete")
    return (
      <>
        {short} <Signed value={v.after_20d}>{pct(v.after_20d)}</Signed> 20 sessions later
      </>
    );
  if (v.after_20d_status === "missing") return `the close 20 sessions later${dayShort(v.after_20d_to) ? ` (${dayShort(v.after_20d_to)})` : ""} is not stored`;
  return "20 sessions have not passed yet";
}

function RsiCard({ t, state, short = "S&P" }: { t: TechnicalsResponse | undefined; state: CardState; short?: string }) {
  const adv = useAdvanced();
  const ready = state === "ready" && !!t;
  const aw = state === "awaiting";
  const r = ready && fin(t.rsi) ? t.rsi : null;
  const zone = r != null ? rsiZone(r) : null;
  const words = r != null ? [zone, rsiDirection(t?.rsi, t?.rsi_prev)].filter(Boolean).join(", ") : "";
  const day = (v: TechnicalsResponse["rsi_last_above_70"]) => (ready && v?.date ? dayInYear(v.date, t.as_of) : "");
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-rsi-title" className="te-rsi" title="Momentum · RSI" sub={`is ${theOf(short)} stretched, either way?`} labels={["Now", "Last above 70", "Last below 30"]} block={unserved} advanced />;
  return (
    <section className="dk-card te-rsi" aria-labelledby="te-rsi-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-rsi-title">
          {defineTerms("Momentum · RSI")}<span className="dk-card-sub"> is {theOf(short)} stretched, either way?</span>
        </h2>
        {/* §1.6: the RSI is dated by its own session, which a gap in the closes can hold before the price's. */}
        {r != null && dayShort(t?.rsi_date) ? <LiveBadge parts={[dayShort(t?.rsi_date)]} /> : null}
      </div>
      <LoadingLine busy={state === "loading"} />
      <StatRow cols={3}>
        <Stat label="Now" awaiting={aw || (ready && r == null)} value={r != null ? num(r) : undefined} sub={words || undefined} />
        <Stat label="Last above 70" size="date" tone="amber" awaiting={aw || (ready && !day(t.rsi_last_above_70))} value={day(t?.rsi_last_above_70) || undefined} sub={ready ? visitSub(t.rsi_last_above_70, short) : undefined} />
        <Stat label="Last below 30" size="date" tone="green" awaiting={aw || (ready && !day(t.rsi_last_below_30))} value={day(t?.rsi_last_below_30) || undefined} sub={ready ? visitSub(t.rsi_last_below_30, short) : undefined} />
      </StatRow>
      <div className="te-rsi-gauge">
        {r != null ? (
          <Gauge
            thick
            min={0}
            max={100}
            value={r}
            ticks={[0, 30, 70, 100]}
            bands={[
              { label: "Oversold", to: 30, tone: "green" },
              { label: "Neutral", to: 70, tone: "neutral" },
              { label: "Overbought", to: 100, tone: "amber" },
            ]}
            caption={num(r)}
            label={`RSI ${num(r)}, ${zone}`}
          />
        ) : aw || ready ? (
          <Awaiting />
        ) : null}
      </div>
      <div className="te-foot">
        <AdvancedPanel adv={adv} items="full RSI line · every crossing · regime split" missing="The full RSI line is not served yet." />
      </div>
    </section>
  );
}

// ── Momentum · MACD ──────────────────────────────────────────────────────

/** §3: the histogram's side in words, from the served `hist` only. */
export function macdSide(hist: number | null | undefined): string | null {
  if (!fin(hist)) return null;
  return hist > 0 ? "MACD above its signal" : hist < 0 ? "MACD below its signal" : "MACD on its signal";
}

/** §3: the last crossover in words, from its served kind. */
export function macdCrossWords(kind: string | undefined): string | null {
  return kind === "above" ? "MACD crossed above its signal" : kind === "below" ? "MACD crossed below its signal" : null;
}

/** One decimal, signed ("+8.1", "−10.4"): the MACD's three values are index points either side of zero. */
const pts1 = (x: number) => signed(x, 1);

function MacdCard({ t, state, short = "S&P" }: { t: TechnicalsResponse | undefined; state: CardState; short?: string }) {
  const ready = state === "ready" && !!t;
  const aw = state === "awaiting";
  const m = ready ? (t.macd ?? null) : null;
  const pts = (m?.series ?? []).filter((p) => typeof p?.date === "string");
  const all = pts.flatMap((p) => [p.macd, p.signal, p.hist]).filter(fin);
  const ticks = extentTicks(all.length ? Math.min(0, ...all) : -1, all.length ? Math.max(0, ...all) : 1, 5);
  const domain: [number, number] = [ticks[0], ticks[ticks.length - 1]];
  const lc = m?.last_cross ?? null;
  const crossI = lc ? pts.findIndex((p) => p.date === lc.date) : -1;
  const day = (iso: string | undefined) => (ready && iso ? dayInYear(iso, t.as_of) : "");
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-macd-title" className="te-macd" title="Momentum · MACD" sub={`12, 26, 9 on ${theOf(short)}'s closes`} labels={["MACD", "Signal", "Histogram", "Last crossover"]} block={unserved} />;
  return (
    <section className="dk-card te-macd" aria-labelledby="te-macd-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-macd-title">
          Momentum · MACD<span className="dk-card-sub"> 12, 26, 9 on {theOf(short)}&apos;s closes</span>
        </h2>
        {/* §1.6: the MACD is dated by its own session, which a gap in the closes can hold before the price's. */}
        {m && dayShort(m.date) ? <LiveBadge parts={[dayShort(m.date)]} /> : null}
      </div>
      <LoadingLine busy={state === "loading"} />
      <StatRow cols={4}>
        <Stat label="MACD" awaiting={aw || (ready && !fin(m?.macd))} value={m && fin(m.macd) ? pts1(m.macd) : undefined} tone="blue" />
        <Stat label="Signal" awaiting={aw || (ready && !fin(m?.signal))} value={m && fin(m.signal) ? pts1(m.signal) : undefined} tone="gray" />
        <Stat
          label="Histogram"
          awaiting={aw || (ready && !fin(m?.hist))}
          value={m && fin(m.hist) ? pts1(m.hist) : undefined}
          tone={m && fin(m.hist) ? (m.hist > 0 ? "up" : m.hist < 0 ? "down" : undefined) : undefined}
          sub={m ? (macdSide(m.hist) ?? undefined) : undefined}
        />
        <Stat label="Last crossover" size="date" awaiting={aw || (ready && !day(lc?.date))} value={day(lc?.date) || undefined} sub={macdCrossWords(lc?.kind) ?? undefined} />
      </StatRow>
      {m && pts.filter((p) => fin(p.macd)).length > 1 ? (
        <LineChart
          ariaLabel={`MACD, its signal line and the histogram, 6M${crossI >= 0 && lc ? `; last crossover on ${dayLong(lc.date)}` : ""}`}
          height={220}
          n={pts.length}
          yDomain={domain}
          yTicks={ticks.map((v) => ({ v, text: num(v, 0) }))}
          xTicks={monthTicks(pts.map((p) => p.date))}
          zero
          bars={{ values: pts.map((p) => (fin(p.hist) ? p.hist : null)), up: DESK_ACCENTS.green, down: DESK_ACCENTS.red }}
          series={[
            { key: "signal", values: pts.map((p) => (fin(p.signal) ? p.signal : null)), color: DESK_ACCENTS.gray, dash: "4 4", width: 2, label: "Signal" },
            { key: "macd", values: pts.map((p) => (fin(p.macd) ? p.macd : null)), color: DESK_ACCENTS.blue, width: 2.5, label: "MACD" },
          ]}
          endDot="macd"
          markers={crossI >= 0 && fin(pts[crossI].macd) ? [{ i: crossI, v: pts[crossI].macd as number, color: lc?.kind === "below" ? DESK_ACCENTS.red : DESK_ACCENTS.green, r: 5 }] : []}
          pad={{ l: 40, r: 64, t: 10, b: 26 }}
        />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
    </section>
  );
}

// ── Seasonality ─────────────────────────────────────────────────────────

/** A served month ("1990-02") as "Feb 1990". */
const monthOf = (ym: string | undefined) => (typeof ym === "string" ? monthYear(`${ym}-01`) : "");

/** §3: the years line under the table, from the served counts ("36–37 years a month"; one number when they agree). */
export function yearsLine(rows: readonly { n: number | null }[]): string | null {
  const ns = rows.map((r) => r.n).filter(fin);
  if (!ns.length) return null;
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  return `${lo === hi ? lo : `${lo}–${hi}`} years a month · a month counts once it is complete`;
}

const SEASON_LABELS = ["Average", "Up", "Years"];

function SeasonalityCard({ t, state, name = "S&P 500" }: { t: TechnicalsResponse | undefined; state: CardState; name?: string }) {
  const ready = state === "ready" && !!t;
  const s = ready ? (t.seasonality ?? null) : null;
  const rows = Array.isArray(s?.rows) ? s.rows : [];
  // §3: each bar's length is |avg| over the largest |avg| of the twelve.
  const big = Math.max(0, ...rows.map((r) => (fin(r.avg) ? Math.abs(r.avg) : 0)));
  const w = s?.window;
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-season-title" className="te-season" title={`Seasonality · ${name} by calendar month`} labels={SEASON_LABELS} cols={3} block={unserved} />;
  return (
    <section className="dk-card te-season" aria-labelledby="te-season-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-season-title">
          Seasonality · {name} by calendar month
        </h2>
      </div>
      <LoadingLine busy={state === "loading"} />
      {s && rows.length ? (
        <>
          {w && monthOf(w.start) && monthOf(w.end) ? (
            <p className="te-season-sub">
              Average monthly return and share of years up, {monthOf(w.start)} to {monthOf(w.end)}.
            </p>
          ) : null}
          <div className="te-season-wrap" role="region" aria-label="Seasonality by calendar month" tabIndex={0}>
            <table className="te-season-table">
              <colgroup>
                <col className="te-season-col-month" />
                <col className="te-season-col-avg" />
                <col />
                <col className="te-season-col-up" />
                <col className="te-season-col-n" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Average</th>
                  <td aria-hidden="true" />
                  <th scope="col">Up</th>
                  <th scope="col">Years</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.label}-${i}`}>
                    <th scope="row">{r.label}</th>
                    <td>{fin(r.avg) ? <Signed value={r.avg}>{pct(r.avg)}</Signed> : "—"}</td>
                    <td className="te-season-barcell" aria-hidden="true">
                      {fin(r.avg) && big > 0 ? <span className="te-season-bar" data-sign={r.avg >= 0 ? "up" : "down"} style={{ width: `${(Math.abs(r.avg) / big) * 50}%` }} /> : null}
                    </td>
                    <td>{fin(r.pct_up) ? pctPlain(r.pct_up) : "—"}</td>
                    <td title={fin(r.first_year) && fin(r.last_year) ? `${r.first_year}–${r.last_year}` : undefined}>{fin(r.n) ? r.n : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="te-foot">
            {yearsLine(rows) ? <p className="te-season-note">{yearsLine(rows)}</p> : null}
            {s.source ? <p className="te-source">Source: {s.source}, monthly</p> : null}
          </div>
        </>
      ) : state === "loading" ? null : (
        <StatRow cols={3}>
          {SEASON_LABELS.map((l) => (
            <Stat key={l} label={l} awaiting />
          ))}
        </StatRow>
      )}
    </section>
  );
}

/** §14.2: the drawdown from the one-year high, 21-day realized volatility (the shared `realized_vol`, as a
 * fraction), and for a stock its one-year return (the S&P's is on its Signals card). Every figure is the
 * served one; a figure served null says why (§1.7). Main's RSI card carries the RSI. */
function RiskCard({ t, state, scored }: { t: TechnicalsResponse | undefined; state: CardState; scored: boolean }) {
  const ready = state === "ready" && !!t;
  const aw = state === "awaiting";
  const asOf = t?.date ?? "";
  const dd = ready ? t.drawdown : null;
  const rv = ready ? t.realized_vol : null;
  // Codex R-01: a year is 252 valid closes; with fewer the figure is partial history, and says how many it read.
  const partial = !!dd && dd.complete !== true;
  const ddN = dd?.window && fin(dd.window.n) ? dd.window.n : null;
  const unserved = useUnserved();
  const labels = ["From 1-year high", "21-day realized vol", ...(scored ? [] : ["1-year return"])];
  if (unserved) return <UnservedCard headingId="te-risk-title" className="te-risk" title="Risk · drawdown and volatility" sub="how far from its high, and how much it moves" labels={labels} cols={3} block={unserved} />;
  return (
    <section className="dk-card te-risk" aria-labelledby="te-risk-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-risk-title">
          Risk · drawdown and volatility<span className="dk-card-sub"> how far from its high, and how much it moves</span>
        </h2>
      </div>
      <LoadingLine busy={state === "loading"} />
      <StatRow cols={3}>
        <Stat
          label={partial ? "From high" : "From 1-year high"}
          awaiting={aw || (ready && !fin(dd?.value))}
          value={ready && fin(dd?.value) ? pct(dd.value) : undefined}
          tone={ready && fin(dd?.value) && dd.value < 0 ? "down" : undefined}
          sub={
            ready && dd?.peak && fin(dd.peak.close)
              ? [partial ? `partial history: ${ddN ?? "fewer than 252"} of 252 sessions` : null, `high ${priceText(dd.peak.close, scored)} on ${dayInYear(dd.peak.date, asOf)}`].filter(Boolean).join(" · ")
              : undefined
          }
        />
        <Stat label="21-day realized vol" awaiting={aw || (ready && !fin(rv?.value))} value={ready && fin(rv?.value) ? pctPlain(rv.value, 1) : undefined} sub={ready && fin(rv?.value) ? "annualized" : undefined} />
        {scored ? null : (
          <Stat label="1-year return" awaiting={aw || (ready && !fin(t.ret_1y))} value={ready && fin(t.ret_1y) ? pct(t.ret_1y) : undefined} tone={ready && fin(t.ret_1y) ? (t.ret_1y >= 0 ? "up" : "down") : undefined} sub={ready && t.ret_1y_dates && dayLong(t.ret_1y_dates.from) ? `since ${dayLong(t.ret_1y_dates.from)}` : undefined} />
        )}
      </StatRow>
      {ready && !fin(rv?.value) ? <p className="te-note-line">Realized vol needs the last 22 closes; one is missing.</p> : null}
    </section>
  );
}

// ── Relative strength vs the S&P 500 ─────────────────────────────────────

function RelativeCard({ t, state, range }: { t: TechnicalsResponse | undefined; state: CardState; range: Range }) {
  const ready = state === "ready" && !!t;
  const aw = state === "awaiting";
  const rs = ready ? t.rs : null;
  const pts = (rs?.series?.[range] ?? []).filter((p) => typeof p?.date === "string");
  const all = pts.flatMap((p) => [p.rs, p.rs_ma50]).filter(fin);
  const ticks = all.length ? extentTicks(Math.min(...all), Math.max(...all), 3) : [0, 1];
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-rs-title" className="te-rs" title="Relative strength vs the S&P 500" labels={["Against its 50-day", "3-month change", "As of"]} block={unserved} />;
  return (
    <section className="dk-card te-rs" aria-labelledby="te-rs-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-rs-title">
          {defineTerms("Relative strength vs the S&P 500")}<span className="dk-card-sub"> its price divided by the index, rebased to 100</span>
        </h2>
      </div>
      <LoadingLine busy={state === "loading"} />
      <StatRow cols={3}>
        <Stat label="Against its 50-day" awaiting={aw || (ready && !fin(rs?.vs_ma50))} value={ready && fin(rs?.vs_ma50) ? pct(rs.vs_ma50) : undefined} tone={ready && fin(rs?.vs_ma50) ? (rs.vs_ma50 >= 0 ? "up" : "down") : undefined} sub={ready && fin(rs?.vs_ma50) ? (rs.vs_ma50 >= 0 ? "leading the S&P" : "lagging the S&P") : undefined} />
        <Stat label="3-month change" awaiting={aw || (ready && !fin(rs?.chg_3m))} value={ready && fin(rs?.chg_3m) ? pct(rs.chg_3m) : undefined} tone={ready && fin(rs?.chg_3m) ? (rs.chg_3m >= 0 ? "up" : "down") : undefined} sub={ready && rs?.chg_3m_dates ? `since ${dayLong(rs.chg_3m_dates.from)}` : undefined} />
        <Stat label="As of" size="date" awaiting={aw || (ready && !rs?.date)} value={ready && rs?.date ? dayLong(rs.date) : undefined} sub={ready && rs?.date ? "last session both closed" : undefined} />
      </StatRow>
      {ready && pts.filter((p) => fin(p.rs)).length > 1 ? (
        <LineChart
          ariaLabel={`${t.symbol ?? "The stock"} against the S&P 500, rebased to 100, with its 50-day average, ${range.toUpperCase()}`}
          height={170}
          n={pts.length}
          yDomain={[ticks[0], ticks[ticks.length - 1]]}
          yTicks={ticks.map((v) => ({ v, text: num(v, 0) }))}
          xTicks={monthTicks(pts.map((p) => p.date))}
          series={[
            { key: "rs_ma50", values: pts.map((p) => (fin(p.rs_ma50) ? p.rs_ma50 : null)), color: DESK_ACCENTS.green, dash: "4 4", width: 2, label: "50-day" },
            { key: "rs", values: pts.map((p) => (fin(p.rs) ? p.rs : null)), color: DESK_ACCENTS.blue, width: 2.5, label: "vs S&P" },
          ]}
          endDot="rs"
          pad={{ l: 40, r: 64, t: 10, b: 26 }}
        />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {ready && rs && !fin(rs.ma50) ? <p className="te-note-line">The 50-day average needs 50 sessions where both closed; one is missing.</p> : null}
    </section>
  );
}

export default function TechnicalsPage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  const { pathTo } = useDeskView();
  const symbol = symbolOf(search);
  const scored = symbol === null;
  const tq = useTechnicals({ symbol });
  const lq = useLedger();
  const t = tq.data;
  const range = rangeOf(search.get("range"), servedRanges(t));
  const onRange = (r: Range) =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        if (r === "1y") q.delete("range");
        else q.set("range", r);
        return q;
      },
      { replace: true },
    );
  // §3, §12.7: the vol column and the sector bars are `/technicals` blocks, served awaiting on Monday.
  const routeOff = unavailableOf(tq.error);
  const volOff = routeOff ?? t?._blocks?.vol ?? null;
  const sectorsOff = routeOff ?? t?._blocks?.sectors ?? null;
  const cross = scored && t?.cross ? bySlug(lq.data, t.cross.kind === "death" ? "death-cross" : "golden-cross") : undefined;
  // §14.6: one plain line under the title, 15 words at most; the stock's name is on its price card.
  const shown = scored ? page : { ...page, blurb: `Trend, momentum and risk for ${symbol}; its crosses are shown, not scored.` };
  const short = symbol ?? "S&P";
  return (
    <div className="te" data-symbol={symbol ?? "^GSPC"}>
      {/* §3: `● Live · <date>` from `/technicals` `date`. */}
      <PageTitle page={shown} badge={unavailableOf(tq.error) ? <NotServedBadge boxed block={unavailableOf(tq.error)} /> : t ? <LiveBadge boxed parts={[dayShort(t.date) || null]} /> : null} />
      {/* §14.2: the second action (the header's is Open as position). The index itself is not a basket leg: its ETF is. */}
      <p className="te-actions">
        <Link className="dk-link" to={withParam(pathTo("basket-hedge"), "add", symbol ?? "SPY")} data-testid="te-add-basket">
          {symbol ? "Add to basket →" : "Add SPY to basket →"}
        </Link>
      </p>
      {/* §14.12: every card reads /technicals; the Signals card reads the Ledger too, and fails with either. */}
      {scored ? (
        <FailedScope q={tq}>
        <div className="te-grid">
          {/* §12.0: a card whose answer is served awaiting keeps its labels and prints the reason (§1.0.2). */}
          {/* §1.0.3 (desk/prototypes): the PROTOTYPE stands in the vol column until the vol block is served; a
              served block's card keeps its labels and prints its reason when awaiting (§1.0.2). */}
          {volIsPrototype(t, routeOff, tq.isError) ? (
            <ProtectionCard />
          ) : (
            <Unserved block={volOff}>
              <VolCard vol={t?.vol} state={stateOf(tq, !!t?.vol)} />
            </Unserved>
          )}
          <Unserved block={unavailableOf(tq.error)}>
            <PriceCard t={t} state={stateOf(tq)} cross={cross} range={range} onRange={onRange} scored />
            <FailedScope q={eitherFailed(tq, lq)}>
              <SignalsCard t={t} tState={stateOf(tq)} ledger={lq.data} lState={stateOf(lq, Array.isArray(lq.data?.signals))} />
            </FailedScope>
          </Unserved>
          <Unserved block={sectorsOff}>
            <SectorCard s={t?.sectors} state={stateOf(tq, Array.isArray(t?.sectors?.leadership))} />
          </Unserved>
          <Unserved block={unavailableOf(tq.error)}>
            <RsiCard t={t} state={stateOf(tq)} />
            <MacdCard t={t} state={stateOf(tq)} />
            <SeasonalityCard t={t} state={stateOf(tq)} />
            <RiskCard t={t} state={stateOf(tq)} scored />
          </Unserved>
        </div>
        </FailedScope>
      ) : (
        <>
          <p className="te-scored-line">
            Signals are scored on the S&amp;P 500 <Link to={pathTo("technicals")}>→ view</Link>
          </p>
          <FailedScope q={tq}>
          <div className="te-grid te-grid-stock">
            <Unserved block={unavailableOf(tq.error)}>
              <PriceCard t={t} state={stateOf(tq)} cross={undefined} range={range} onRange={onRange} scored={false} />
              <RsiCard t={t} state={stateOf(tq)} short={short} />
              <RiskCard t={t} state={stateOf(tq)} scored={false} />
              <RelativeCard t={t} state={stateOf(tq)} range={range} />
              <MacdCard t={t} state={stateOf(tq)} short={short} />
              <SeasonalityCard t={t} state={stateOf(tq)} name={symbol ?? "S&P 500"} />
            </Unserved>
          </div>
          </FailedScope>
        </>
      )}
    </div>
  );
}

/** Technicals for a symbol (§14.2), the view kept; the S&P 500 is the page's default. */
export function technicalsFor(pathTo: (slug: string) => string, symbol: string | null): string {
  return symbol && !SPX_SYMBOLS.includes(symbol.toUpperCase()) ? withParam(pathTo("technicals"), "symbol", symbol.toUpperCase()) : pathTo("technicals");
}
