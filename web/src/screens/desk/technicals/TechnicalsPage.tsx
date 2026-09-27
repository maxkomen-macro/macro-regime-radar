/**
 * Technicals (DESK_FRAME3_SPEC §3, screens/02-technicals.png): the S&P 500's
 * trend, momentum and what protection costs, every marker scored by the
 * event-study engine. Reads /technicals (§12.7: its vol block awaiting, its
 * sectors block the sector leadership /sectors serves, §12.14) and /ledger
 * (§12.5, the rows in `signals_allowlist` order). Grid:
 * the vol card spans the left column; price and signals on top; sector
 * leadership and RSI below. Every number is a served field, formatted, and
 * dated by its own served dates; the trend's words spell the served
 * `trend.state` (§3).
 * A card stays quiet while its first answer is on its way, and keeps its
 * labels with "Awaiting refresh" when its endpoint fails or its block is
 * missing (§1.7).
 */

import { useState } from "react";
import { unavailableOf, useLedger, useTechnicals } from "../data/api";
import { droppedOf } from "../data/schema";
import type { LedgerResponse, LedgerRow, SectorsResponse, TechnicalsResponse, VolResponse } from "../data/types";
import { nyToday } from "../DeskSidebar";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { capitalize, dayLong, dayShort, grouped, num, ordinal, pct, pctPlain, signed, year } from "../kit/format";
import { moveText, tipOf } from "../kit/units";
import LineChart, { extentTicks } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import RankBars from "../kit/RankBars";
import { AdvancedPanel, Awaiting, DroppedNote, LiveBadge, NotServedBadge, Signed, Stat, StatRow, Unserved, UnservedCard, useAdvanced, useUnserved, VerdictPill, VerdictWord } from "../kit/ui";
import "./technicals.css";

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
            <div className="dk-stat-label">SKEW · WHERE IT SITS</div>
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

// ── Price and its two trend lines ─────────────────────────────────────────

type Range = "6m" | "1y" | "3y";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Up to three x labels ("Oct 25", "Apr 26", "Sep 26"): the first new month, a middle one, the last; never the same month twice. */
export function monthTicks(dates: readonly string[]): { i: number; text: string }[] {
  if (dates.length < 2) return [];
  const label = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
  const firstNew = dates.findIndex((d, i) => i > 0 && d.slice(0, 7) !== dates[i - 1].slice(0, 7));
  const a = firstNew > 0 ? firstNew : 0;
  const last = dates.length - 1;
  const mid = Math.round((a + last) / 2);
  const midMonth = dates.findIndex((d, i) => i >= mid && i > 0 && d.slice(0, 7) !== dates[i - 1].slice(0, 7));
  const m = midMonth > 0 ? midMonth : mid;
  const out: { i: number; text: string }[] = [];
  for (const i of [a, m, last]) if (!out.some((t) => t.text === label(dates[i]))) out.push({ i, text: label(dates[i]) });
  return out;
}

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

function PriceCard({ t, state, cross }: { t: TechnicalsResponse | undefined; state: CardState; cross: LedgerRow | undefined }) {
  const [range, setRange] = useState<Range>("1y");
  // §12.7: a missing close is a point with close null; the line breaks there, never bridging the slot (Codex R-25).
  const pts = (t?.series?.[range] ?? []).filter((p) => typeof p?.date === "string");
  const all = pts.flatMap((p) => [p.close, p.ma50, p.ma200]).filter(fin);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const ticks = extentTicks(lo, hi, range === "3y" ? 4 : 3);
  const domain: [number, number] = [ticks[0], ticks[ticks.length - 1]];
  const served = t?.cross ?? null;
  const crossI = served ? pts.findIndex((p) => p.date === served.date) : -1;
  const crossWord = t?.cross?.kind === "death" ? "Death" : "Golden";
  const ready = state === "ready" && !!t;
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-price-title" className="te-price" title="S&P 500" sub="price and its two trend lines" labels={["Price", "50-day average", "200-day average"]} block={unserved} />;
  return (
    <section className="dk-card te-price" aria-labelledby="te-price-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-price-title">
          S&amp;P 500<span className="dk-card-sub"> price and its two trend lines</span>
        </h2>
        <div className="te-range" role="group" aria-label="Range">
          {(["6m", "1y", "3y"] as Range[]).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <StatRow cols={3}>
        <Stat label="Price" awaiting={state === "awaiting" || (ready && !fin(t.price))} value={ready && fin(t.price) ? grouped(t.price) : undefined} sub={ready && fin(t.chg_1d) && t.chg_1d_dates ? <Signed value={t.chg_1d}>{dayMove(t.chg_1d, t.chg_1d_dates.to)}</Signed> : undefined} />
        <Stat label="50-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma50))} value={ready && fin(t.ma50) ? grouped(t.ma50) : undefined} tone="green" sub={ready && fin(t.vs_ma50) ? aboveBelow(t.vs_ma50) : undefined} />
        <Stat label="200-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma200))} value={ready && fin(t.ma200) ? grouped(t.ma200) : undefined} tone="gray" sub={ready && fin(t.vs_ma200) ? aboveBelow(t.vs_ma200) : undefined} />
      </StatRow>
      {ready && pts.filter((p) => fin(p.close)).length > 1 ? (
        <LineChart
          ariaLabel={`S&P 500 with its 50-day and 200-day averages, ${range.toUpperCase()}${crossI >= 0 && t.cross ? `; ${crossWord.toLowerCase()} cross on ${dayLong(t.cross.date)}` : ""}`}
          height={230}
          n={pts.length}
          yDomain={domain}
          yTicks={ticks.map((v) => ({ v, text: grouped(v) }))}
          xTicks={monthTicks(pts.map((p) => p.date))}
          series={[
            { key: "ma200", values: pts.map((p) => (fin(p.ma200) ? p.ma200 : null)), color: DESK_ACCENTS.gray, dash: "4 4", width: 2, label: "200-day" },
            { key: "ma50", values: pts.map((p) => (fin(p.ma50) ? p.ma50 : null)), color: DESK_ACCENTS.green, dash: "4 4", width: 2, label: "50-day" },
            { key: "close", values: pts.map((p) => (fin(p.close) ? p.close : null)), color: DESK_ACCENTS.blue, width: 2.5, label: "S&P 500" },
          ]}
          endDot="close"
          markers={crossI >= 0 && fin(pts[crossI].ma50) ? [{ i: crossI, v: pts[crossI].ma50, color: crossWord === "Death" ? DESK_ACCENTS.red : DESK_ACCENTS.green, r: 5 }] : []}
          pad={{ l: 46, r: 70, t: 12, b: 26 }}
        />
      ) : state === "loading" ? null : (
        <Awaiting />
      )}
      {ready && t.cross && cross ? (
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
  // §3: the Ledger rows in `signals_allowlist` order; the RSI rows are omitted while unavailable.
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

/** "Technology and Industrials leading; Staples and Utilities lagging": the served ranking's two ends, named. */
export function endsLine(rows: readonly { name: string }[]): string {
  if (rows.length < 4) return "";
  const two = (a: { name: string }, b: { name: string }) => `${a.name} and ${b.name}`;
  return `${two(rows[0], rows[1])} leading; ${two(rows[rows.length - 2], rows[rows.length - 1])} lagging`;
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
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="te-sect-title" className="te-sectors" title="Sector leadership · 3-month relative strength vs S&P" block={unserved} advanced />;
  return (
    <section className="dk-card te-sectors" aria-labelledby="te-sect-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-sect-title">
          Sector leadership · {s && fin(s.window_months) ? `${s.window_months}-month` : "3-month"} relative strength vs S&amp;P
        </h2>
      </div>
      {state === "ready" && endsLine(rows) ? <p className="te-sect-read">{endsLine(rows)}</p> : null}
      {state === "ready" && rows.length ? (
        <>
          <RankBars label="Sector ETFs against the S&P, top three, middle and bottom three" rows={sevenOf(rows).map(toRow)} lo={lo} hi={hi} />
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
        {/* All eleven come from the sectors block once served; until then the control is disabled (§1.4). */}
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

/** §1.0: RSI is not computed, and the card has no served envelope, so it prints the RSI rows' served reason (§1.0.2, §12.3). */
export const RSI_UNAVAILABLE = { reason: "RSI is not computed yet.", until: null } as const;

function RsiCard() {
  return <UnservedCard headingId="te-rsi-title" className="te-rsi" title="Momentum · RSI" sub="is the S&P stretched, either way?" labels={["Now", "Last above 70", "Last below 30"]} block={RSI_UNAVAILABLE} advanced />;
}

export default function TechnicalsPage({ page }: { page: DeskPage }) {
  const tq = useTechnicals();
  const lq = useLedger();
  const t = tq.data;
  // §3, §12.7: the vol column and the sector bars are `/technicals` blocks, served awaiting on Monday.
  const routeOff = unavailableOf(tq.error);
  const volOff = routeOff ?? t?._blocks?.vol ?? null;
  const sectorsOff = routeOff ?? t?._blocks?.sectors ?? null;
  const cross = t?.cross ? bySlug(lq.data, t.cross.kind === "death" ? "death-cross" : "golden-cross") : undefined;
  return (
    <div className="te">
      {/* §3: `● Live · <date>` from `/technicals` `date`. */}
      <PageTitle page={page} badge={unavailableOf(tq.error) ? <NotServedBadge boxed block={unavailableOf(tq.error)} /> : t ? <LiveBadge boxed parts={[dayShort(t.date) || null]} /> : null} />
      <div className="te-grid">
        {/* §12.0: a card whose answer is served awaiting keeps its labels and prints the reason (§1.0.2). */}
        <Unserved block={volOff}>
          <VolCard vol={t?.vol} state={stateOf(tq, !!t?.vol)} />
        </Unserved>
        <Unserved block={unavailableOf(tq.error)}>
          <PriceCard t={t} state={stateOf(tq)} cross={cross} />
          <SignalsCard t={t} tState={stateOf(tq)} ledger={lq.data} lState={stateOf(lq, Array.isArray(lq.data?.signals))} />
        </Unserved>
        <Unserved block={sectorsOff}>
          <SectorCard s={t?.sectors} state={stateOf(tq, Array.isArray(t?.sectors?.leadership))} />
        </Unserved>
        <RsiCard />
      </div>
    </div>
  );
}
