/**
 * Technicals (DESK_FRAME3_SPEC §3, screens/02-technicals.png): the S&P 500's
 * trend, momentum and what protection costs, every marker scored by the
 * event-study engine. Reads /technicals (§12.10), /vol (§12.9), /sectors
 * (§12.7) and /ledger (§12.4, the S&P group). Grid: the vol card spans the
 * left column; price and signals on top; sector leadership and RSI below.
 * Every number is a served field, formatted; the interpretive sentences are
 * the API's `reads` (§12.13); the words that judge a level are served too
 * (`move_20d_word`, `rsi_word`, Codex R-13): a stat without its word keeps
 * its number and drops the word.
 * A card stays quiet while its first answer is on its way, and keeps its
 * labels with "Awaiting refresh" when its endpoint fails or its block is
 * missing (§1.7).
 */

import { useState } from "react";
import { useLedger, useSectors, useTechnicals, useVol } from "../data/api";
import type { LedgerResponse, LedgerRow, SectorsResponse, TechnicalsResponse, VolResponse } from "../data/types";
import { nyToday } from "../DeskSidebar";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { capitalize, dayLong, dayShort, grouped, num, ordinal, pct, pctPlain, signed, VERDICT_RANK, year } from "../kit/format";
import Gauge from "../kit/Gauge";
import LineChart, { extentTicks } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import RankBars from "../kit/RankBars";
import { AdvancedPanel, Awaiting, LiveBadge, Signed, Stat, StatRow, VerdictPill, VerdictWord, useAdvanced } from "../kit/ui";
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
  const r = vol?.reads;
  const edges = vol?.skew_band_edges;
  const pctile = fin(vol?.skew_pct_2y) ? Math.round(vol.skew_pct_2y * 100) : null;
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
            <p className="te-vol-context">{[vol.skew_trend ? `${capitalize(vol.skew_trend)}.` : "", r?.skew?.text ?? ""].filter(Boolean).join(" ")}</p>
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
            {r?.iv_rv ? <p className="te-vol-context">{r.iv_rv.text}</p> : null}
          </div>
          <div className="te-vol-sec">
            {vol.term && fin(vol.term["1m"]) && fin(vol.term["3m"]) && fin(vol.term["6m"]) ? (
              <Stat label={VOL_LABELS[2]} value={`${num(vol.term["1m"])} · ${num(vol.term["3m"])} · ${num(vol.term["6m"])}`} size="xl" />
            ) : (
              <Stat label={VOL_LABELS[2]} awaiting />
            )}
            {r?.term_meaning ? <p className="te-vol-meaning">{r.term_meaning.text}</p> : null}
            {r?.term ? <p className="te-vol-context">{r.term.text}</p> : null}
          </div>
          <div className="te-vol-sec te-vol-gauge">
            <div className="dk-stat-label">SKEW · WHERE IT SITS</div>
            {pctile != null && fin(vol.skew_pct_2y) && edges && fin(edges[0]) && fin(edges[1]) ? (
              <Gauge
                thick
                min={0}
                max={1}
                value={vol.skew_pct_2y}
                bands={[
                  { label: "Cheap", to: Math.min(edges[0], edges[1]), tone: "green" },
                  { label: "Typical", to: Math.max(edges[0], edges[1]), tone: "neutral" },
                  { label: "Expensive", to: 1, tone: "amber" },
                ]}
                caption={`${ordinal(pctile)} pct`}
                label={`Skew sits at the ${ordinal(pctile)} percentile of two years: ${vol.skew_pct_2y >= Math.max(edges[0], edges[1]) ? "expensive" : vol.skew_pct_2y < Math.min(edges[0], edges[1]) ? "cheap" : "typical"}`}
              />
            ) : (
              <Awaiting />
            )}
            {r?.gauge ? <p className="te-vol-caption">{r.gauge.text}</p> : null}
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
export function dayMove(chg: number, asOf: string, today = nyToday()): string {
  return `${pct(chg)} ${asOf === today ? "today" : `on ${dayShort(asOf)}`}`;
}

/** "price is 2.1% above" from the served distance to an average. */
export function aboveBelow(frac: number): string {
  const n = Math.abs(frac * 100).toFixed(1);
  return frac >= 0 ? `price is ${n}% above` : `price is ${n}% below`;
}

function PriceCard({ t, state, cross }: { t: TechnicalsResponse | undefined; state: CardState; cross: LedgerRow | undefined }) {
  const [range, setRange] = useState<Range>("1y");
  const pts = (t?.series?.[range] ?? []).filter((p) => fin(p.close));
  const all = pts.flatMap((p) => [p.close, p.ma50, p.ma200]).filter(fin);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const ticks = extentTicks(lo, hi, range === "3y" ? 4 : 3);
  const domain: [number, number] = [ticks[0], ticks[ticks.length - 1]];
  const served = t?.cross ?? null;
  const crossI = served ? pts.findIndex((p) => p.date === served.date) : -1;
  const crossWord = t?.cross?.kind === "death" ? "Death" : "Golden";
  const ready = state === "ready" && !!t;
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
        <Stat label="Price" awaiting={state === "awaiting" || (ready && !fin(t.price))} value={ready && fin(t.price) ? grouped(t.price) : undefined} sub={ready && fin(t.chg_1d) ? <Signed value={t.chg_1d}>{dayMove(t.chg_1d, t.as_of)}</Signed> : undefined} />
        <Stat label="50-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma50))} value={ready && fin(t.ma50) ? grouped(t.ma50) : undefined} tone="green" sub={ready && fin(t.vs_ma50) ? aboveBelow(t.vs_ma50) : undefined} />
        <Stat label="200-day average" awaiting={state === "awaiting" || (ready && !fin(t.ma200))} value={ready && fin(t.ma200) ? grouped(t.ma200) : undefined} tone="gray" sub={ready && fin(t.vs_ma200) ? aboveBelow(t.vs_ma200) : undefined} />
      </StatRow>
      {ready && pts.length > 1 ? (
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
            { key: "close", values: pts.map((p) => p.close), color: DESK_ACCENTS.blue, width: 2.5, label: "S&P 500" },
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

/** The Ledger's order (§12.4): firing first, then Reliable, Suggestive, No
 * edge; §12.4 names no third key, so rows keep their served order within a
 * group (a stable sort), as the Ledger PNG draws them. */
export function ledgerOrder(rows: readonly LedgerRow[]): LedgerRow[] {
  const rank = (r: LedgerRow) => (r.verdict ? VERDICT_RANK[r.verdict] : 9) ?? 9;
  return [...rows].sort((a, b) => Number(b.firing_now) - Number(a.firing_now) || rank(a) - rank(b));
}

/** On the S&P's own card the "S&P " prefix is dropped: "S&P golden cross" → "Golden cross". */
export function spxName(label: string): string {
  return capitalize(label.replace(/^S&P\s+/, ""));
}

/** "above both averages" from the two served distances; null when either is missing. */
export function trendSub(t: Pick<TechnicalsResponse, "vs_ma50" | "vs_ma200">): string | null {
  if (!fin(t.vs_ma50) || !fin(t.vs_ma200)) return null;
  if (t.vs_ma50 >= 0 && t.vs_ma200 >= 0) return "above both averages";
  if (t.vs_ma50 < 0 && t.vs_ma200 < 0) return "below both averages";
  return t.vs_ma200 >= 0 ? "above the 200-day, below the 50-day" : "above the 50-day, below the 200-day";
}

const bySlug = (ledger: LedgerResponse | undefined, slug: string) => (Array.isArray(ledger?.signals) ? ledger.signals.find((r) => r.slug === slug && fin(r.n)) : undefined);

function SignalsCard({ t, tState, ledger, lState }: { t: TechnicalsResponse | undefined; tState: CardState; ledger: LedgerResponse | undefined; lState: CardState }) {
  const rows = Array.isArray(ledger?.signals) ? ledgerOrder(ledger.signals.filter((s) => s.group === "spx" && fin(s.n))) : [];
  const inRegime = t?.cross?.in_regime;
  const ready = tState === "ready" && !!t;
  const aw = tState === "awaiting";
  return (
    <section className="dk-card te-signals" aria-labelledby="te-sig-title" aria-busy={tState === "loading" || lState === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-sig-title">
          Signals<span className="dk-card-sub"> what fired, and what usually follows</span>
        </h2>
      </div>
      <StatRow cols={3}>
        <Stat label="1-year return" awaiting={aw || (ready && !fin(t.ret_1y))} value={ready && fin(t.ret_1y) ? pct(t.ret_1y) : undefined} tone={ready && fin(t.ret_1y) ? (t.ret_1y >= 0 ? "up" : "down") : undefined} sub="S&P 500" />
        <Stat label="Trend" awaiting={aw || (ready && !t.trend)} value={ready && t.trend ? capitalize(t.trend) : undefined} tone={ready ? (t.trend === "up" ? "up" : t.trend === "down" ? "down" : undefined) : undefined} sub={ready ? (trendSub(t) ?? undefined) : undefined} />
        <Stat
          label="Last 20 days"
          awaiting={aw || (ready && !fin(t.move_20d_sigma))}
          value={ready && fin(t.move_20d_sigma) ? `${signed(t.move_20d_sigma)}σ` : undefined}
          sub={ready && typeof t.move_20d_word === "string" && t.move_20d_word ? t.move_20d_word : undefined}
        />
      </StatRow>
      {lState === "ready" ? (
        <ul className="te-sig-list">
          {rows.map((r) => (
            <li key={r.slug}>
              <b>{spxName(r.label)}</b>
              <span>
                {fin(r.n) ? `${r.n}×` : "—"}
                {fin(r.n) && year(r.sample_start) ? ` since ${year(r.sample_start)}` : ""}
                {fin(r.up_pct) ? (
                  <>
                    {" "}
                    · up <b>{pctPlain(r.up_pct)}</b>
                  </>
                ) : null}
                {fin(r.median) ? (
                  <>
                    {" "}
                    · a month later{" "}
                    <Signed value={r.median} bold>
                      {pct(r.median)}
                    </Signed>
                  </>
                ) : null}
              </span>
              <VerdictPill verdict={r.verdict} />
            </li>
          ))}
        </ul>
      ) : lState === "awaiting" ? (
        <Awaiting />
      ) : null}
      {ready && t.cross && ledger && inRegime && fin(inRegime.n) ? (
        <div className="dk-read te-note">
          <b>In this regime ({inRegime.regime}):</b> {t.cross.kind} cross has fired {inRegime.n < 10 ? "only " : ""}
          {inRegime.n} times{inRegime.n < 10 ? " — too few to trust" : ""}.
          {fin(ledger.normal_month) ? (
            <>
              {" "}
              A normal month is <b>{pct(ledger.normal_month)}</b>; &quot;Reliable&quot; means the edge over that survives resampling.
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ── Sector leadership (seven of eleven) ───────────────────────────────────

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
  const toRow = (r: Row) => ({ key: r.etf, ticker: r.etf, name: r.short ?? "", value: fin(r.rel_ret) ? r.rel_ret : null });
  const lo = rows.length ? rows[rows.length - 1].rel_ret : 0;
  const hi = rows.length ? rows[0].rel_ret : 0;
  return (
    <section className="dk-card te-sectors" aria-labelledby="te-sect-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-sect-title">
          Sector leadership · {s && fin(s.window_months) ? `${s.window_months}-month` : "3-month"} relative strength vs S&amp;P
        </h2>
      </div>
      {state === "ready" && rows.length ? (
        <>
          {s?.reads?.leadership_brief ? <p className="te-sect-read">{s.reads.leadership_brief.text}</p> : null}
          <RankBars label="Sector ETFs against the S&P, top three, middle and bottom three" rows={sevenOf(rows).map(toRow)} lo={lo} hi={hi} />
        </>
      ) : state === "loading" ? null : (
        <Awaiting>the sector ETFs are not ingested yet</Awaiting>
      )}
      <div className="te-foot">
        <AdvancedPanel adv={adv} items="all 11 · rotation over time · by regime" missing="Rotation over time and leadership by regime are not served yet.">
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

/** The RSI's word, as served (Codex R-13): oversold, neutral or overbought; null when not served. */
export function rsiWord(t: TechnicalsResponse | undefined): string | null {
  const w = t?.rsi_word;
  return w === "oversold" || w === "neutral" || w === "overbought" ? w : null;
}

function RsiNote({ label, row }: { label: string; row: LedgerRow | undefined }) {
  if (!row) return null;
  return (
    <div className="dk-read te-rsi-note">
      <b>{label}:</b> {fin(row.n) ? `fired ${row.n}×${year(row.sample_start) ? ` since ${year(row.sample_start)}` : ""}` : "times fired awaiting refresh"}
      {fin(row.up_pct) ? `; the S&P was up ${pctPlain(row.up_pct)} of the time a month later` : ""}. <VerdictWord verdict={row.verdict} />.
    </div>
  );
}

function RsiCard({ t, state, ledger }: { t: TechnicalsResponse | undefined; state: CardState; ledger: LedgerResponse | undefined }) {
  const adv = useAdvanced();
  const above = bySlug(ledger, "rsi-above-70");
  const below = bySlug(ledger, "rsi-below-30");
  const word = rsiWord(t);
  const ready = state === "ready" && !!t;
  const aw = state === "awaiting";
  const last = (x: TechnicalsResponse["rsi_last_above_70"] | null | undefined) => (ready && x?.date ? dayInYear(x.date, t.as_of) : "");
  return (
    <section className="dk-card te-rsi" aria-labelledby="te-rsi-title" aria-busy={state === "loading"}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="te-rsi-title">
          Momentum · RSI<span className="dk-card-sub"> is the S&amp;P stretched, either way?</span>
        </h2>
      </div>
      <StatRow cols={3}>
        <Stat label="Now" awaiting={aw || (ready && !fin(t.rsi))} value={ready && fin(t.rsi) ? String(t.rsi) : undefined} sub={ready ? [word, t.rsi_direction].filter(Boolean).join(", ") || undefined : undefined} />
        <Stat
          label="Last above 70"
          size="date"
          awaiting={aw || (ready && !last(t.rsi_last_above_70))}
          tone="amber"
          value={last(t?.rsi_last_above_70) || undefined}
          sub={ready && fin(t.rsi_last_above_70?.spx_1m) ? `S&P ${pct(t.rsi_last_above_70.spx_1m)} a month later` : undefined}
        />
        <Stat
          label="Last below 30"
          size="date"
          awaiting={aw || (ready && !last(t.rsi_last_below_30))}
          tone="green"
          value={last(t?.rsi_last_below_30) || undefined}
          sub={ready && fin(t.rsi_last_below_30?.spx_1m) ? `S&P ${pct(t.rsi_last_below_30.spx_1m)} a month later` : undefined}
        />
      </StatRow>
      <div className="te-rsi-gauge">
        {ready && fin(t.rsi) ? (
          <Gauge
            thick
            min={0}
            max={100}
            value={t.rsi}
            ticks={[0, 30, 70, 100]}
            bands={[
              { label: "Oversold", to: 30, tone: "green" },
              { label: "Neutral", to: 70, tone: "neutral" },
              { label: "Overbought", to: 100, tone: "amber" },
            ]}
            caption={String(t.rsi)}
            label={`RSI ${t.rsi}${word ? `, ${word}` : ""}`}
          />
        ) : aw ? (
          <Awaiting />
        ) : null}
      </div>
      <div className="te-rsi-notes">
        <RsiNote label="Above 70" row={above} />
        <RsiNote label="Below 30" row={below} />
      </div>
      <div className="te-foot">
        <AdvancedPanel adv={adv} items={below && fin(below.n) ? `full RSI line · all ${below.n} oversold events · regime split` : "full RSI line · oversold events · regime split"} missing="The RSI line, the oversold events and the regime split are not served yet." />
      </div>
    </section>
  );
}

export default function TechnicalsPage({ page }: { page: DeskPage }) {
  const tq = useTechnicals();
  const vq = useVol();
  const sq = useSectors();
  const lq = useLedger();
  const t = tq.data;
  const cross = t?.cross ? bySlug(lq.data, t.cross.kind === "death" ? "death-cross" : "golden-cross") : undefined;
  return (
    <div className="te">
      <PageTitle page={page} badge={t ? <LiveBadge boxed parts={["Yahoo/FRED", `as of ${dayLong(t.as_of)}`]} /> : null} />
      <div className="te-grid">
        <VolCard vol={vq.data} state={stateOf(vq)} />
        <PriceCard t={t} state={stateOf(tq)} cross={cross} />
        <SignalsCard t={t} tState={stateOf(tq)} ledger={lq.data} lState={stateOf(lq, Array.isArray(lq.data?.signals))} />
        <SectorCard s={sq.data} state={stateOf(sq, Array.isArray(sq.data?.leadership))} />
        <RsiCard t={t} state={stateOf(tq)} ledger={lq.data} />
      </div>
    </div>
  );
}
