/**
 * Regime (DESK_FRAME3_SPEC §5, screens/04-regime.png), read from
 * GET /api/desk/regime (§12.5): where the economy sits (the rule-based label
 * and its last five years, the row governing today beside the latest print),
 * the recession score (the one fitted model, labeled as one), what each regime has meant since 1996, and what would
 * change the label (the next two prints, whose flip thresholds the engine
 * computes, and the last five changes). A symmetric 2×2; no action button.
 * The method boxes ("How it's decided", "What it is") are fixed text about
 * the method; every sentence about live data is the API's `reads`.
 */

import type { ReactNode } from "react";
import { unavailableOf, useRegime } from "../data/api";
import type { Read, RegimeResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { bandWord, capitalize, dayShort, monthLong, monthShort, monthYear, num, ordinalWord, pct, pctPlain, rowWords, year } from "../kit/format";
import Gauge from "../kit/Gauge";
import { AdvancedPanel, Awaiting, LiveBadge, NotServedBadge, ReadBox, Signed, Stat, StatRow, Unserved, UnservedCard, UnservedLine, useAdvanced, useBlockUnserved, useUnserved } from "../kit/ui";
import "./regime.css";

/** §5's key: Goldilocks green, Overheating amber, Stagflation red, Recession Risk gray. */
export const REGIME_KEY: Record<string, "green" | "amber" | "red" | "gray"> = { Goldilocks: "green", Overheating: "amber", Stagflation: "red", "Recession Risk": "gray" };
export const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as const;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Contiguous runs of one regime in a monthly history. */
export function runs(history: readonly { month: string; regime: string }[]): { regime: string; from: string; to: string; months: number }[] {
  const out: { regime: string; from: string; to: string; months: number }[] = [];
  for (const h of history) {
    const last = out[out.length - 1];
    if (last && last.regime === h.regime) {
      last.to = h.month;
      last.months += 1;
    } else out.push({ regime: h.regime, from: h.month, to: h.month, months: 1 });
  }
  return out;
}

function ServedRead({ read }: { read: Read | undefined }) {
  if (!read) return null;
  return (
    <ReadBox label={read.label} warn={read.tone === "warning"}>
      {read.text}
    </ReadBox>
  );
}

type NextPrintBlock = { date: string; flip_threshold_mom: number | null; flips_to: string | null };

function Strip({ history }: { history: NonNullable<RegimeResponse["history"]> }) {
  const total = history.length;
  const segs = runs(history);
  const first = history[0]?.month;
  const last = history[history.length - 1]?.month;
  // One tick per January; the strip's own last year is the one `today` names (§5: 2021…2025, then today).
  const years = history.map((h, i) => ({ i, y: h.month.slice(0, 4), jan: h.month.endsWith("-01") })).filter((x) => x.jan && x.y !== last?.slice(0, 4));
  return (
    <div className="rg-strip-wrap">
      <p className="dk-stat-label">Last five years</p>
      <div className="rg-strip" role="img" aria-label={`Regime by month from ${monthYear(first)} to ${monthYear(last)}: ${segs.map((s) => `${s.regime} ${monthYear(s.from)} to ${monthYear(s.to)}`).join("; ")}`}>
        {segs.map((s) => (
          <span key={s.from} data-tone={REGIME_KEY[s.regime] ?? "gray"} style={{ width: `${(s.months / total) * 100}%` }} title={`${s.regime}, ${monthYear(s.from)} to ${monthYear(s.to)}`} />
        ))}
      </div>
      <div className="rg-strip-years" aria-hidden="true">
        {years.map((y) => (
          <span key={y.y} style={{ left: `${(y.i / total) * 100}%` }}>
            {y.y}
          </span>
        ))}
        <span className="rg-today">today</span>
      </div>
      <p className="rg-key">
        {REGIMES.map((r) => (
          <span key={r}>
            <i data-tone={REGIME_KEY[r]} aria-hidden="true" />
            {r}
          </span>
        ))}
      </p>
    </div>
  );
}

function Card({ id, title, sub, children, footer, busy }: { id: string; title: string; sub: string; children: ReactNode; footer: ReactNode; busy?: boolean }) {
  return (
    <section className="dk-card rg-card" aria-labelledby={id} aria-busy={busy}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id={id}>
          {title}
          <span className="dk-card-sub"> {sub}</span>
        </h2>
      </div>
      <div className="dk-card-body">{children}</div>
      <div className="dk-card-foot">{footer}</div>
    </section>
  );
}

type Trend = "rising" | "falling";
const trend = (x: unknown): Trend | null => (x === "rising" || x === "falling" ? x : null);

/** A trend's color (§1.3): growth rising is green and falling red; inflation rising is amber (caution) and falling green. */
export function trendTone(kind: "growth" | "inflation", t: Trend | null): "green" | "red" | "amber" | undefined {
  if (!t) return undefined;
  if (kind === "growth") return t === "rising" ? "green" : "red";
  return t === "rising" ? "amber" : "green";
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

function WhereWeAre({ r, state }: { r: RegimeResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const c = r?.current;
  const g = trend(c?.growth);
  const i = trend(c?.inflation);
  const history = Array.isArray(r?.history) ? r.history : [];
  const unserved = useBlockUnserved(r, "current");
  if (unserved) return <UnservedCard headingId="rg-where" className="rg-card" title="Where we are" sub="rule-based · two-month lag" labels={["Growth", "Inflation", "In this regime"]} block={unserved} advanced />;
  return (
    <Card
      id="rg-where"
      title="Where we are"
      sub="rule-based · two-month lag"
      busy={quiet}
      footer={<AdvancedPanel adv={adv} items="the two input series · every regime change since 1996 · rule text" missing="The two input series and the full list of regime changes are not served yet; the rule is in the box above." />}
    >
      {c?.label ? (
        <div className="rg-label-line">
          <p className="rg-big" data-tone={REGIME_KEY[c.label] === "amber" ? "amber" : undefined}>
            {c.label}
          </p>
          {/* §5: the newest stored row, shown beside the label and never used to classify it. */}
          {monthYear(c.latest_print) ? <p className="rg-latest">Latest print: {monthYear(c.latest_print)}</p> : null}
        </div>
      ) : c ? (
        <Awaiting>the regime label</Awaiting>
      ) : null}
      {c && g && i ? (
        <p className="rg-lede">
          Growth {g} and inflation {i}.{fin(c.months_in) && c.months_in > 1 ? ` ${capitalize(ordinalWord(c.months_in))} month in a row.` : ""}
        </p>
      ) : null}
      {c ? (
        <StatRow cols={3}>
          <Stat label="Growth" value={g ? capitalize(g) : undefined} awaiting={!g} tone={trendTone("growth", g)} sub="industrial production, 3-mo slope" />
          <Stat label="Inflation" value={i ? capitalize(i) : undefined} awaiting={!i} tone={trendTone("inflation", i)} sub="CPI, 3-mo slope" />
          <Stat label="In this regime" value={fin(c.months_in) ? `${c.months_in} mo` : undefined} awaiting={!fin(c.months_in)} sub={c.since ? `since the ${monthLong(c.since)} row` : undefined} />
        </StatRow>
      ) : (
        <AwaitingStats labels={["Growth", "Inflation", "In this regime"]} quiet={quiet} />
      )}
      {history.length ? (
        <Strip history={history} />
      ) : quiet ? null : (
        <div className="rg-strip-wrap">
          <p className="dk-stat-label">Last five years</p>
          <Awaiting />
        </div>
      )}
      <ReadBox label="How it's decided" className="rg-method">
        two signs — growth rising or falling, inflation rising or falling. Four combinations, four regimes. No model, no fitting.
      </ReadBox>
    </Card>
  );
}

function Recession({ r, state }: { r: RegimeResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const rec = r?.recession;
  const edges = rec?.band_edges;
  const unserved = useBlockUnserved(r, "recession");
  const score = rec && fin(rec.score) ? rec.score : null;
  // §5: the band word, then "score for <probability_month> · inputs through <inputs_through>".
  const band = bandWord(rec?.band);
  const my = (m: string | undefined) => monthYear(m).replace(" ", "\u00a0");
  const scoredFor = [my(rec?.probability_month) ? `score for ${my(rec?.probability_month)}` : null, my(rec?.inputs_through) ? `inputs through ${my(rec?.inputs_through)}` : null].filter(Boolean).join(" · ");
  const trained = rec?.training && monthYear(rec.training.start) && monthYear(rec.training.end) ? `, trained ${monthYear(rec.training.start)} to ${monthYear(rec.training.end)}` : "";
  if (unserved) return <UnservedCard headingId="rg-rec" className="rg-card" title="Recession score" sub="logistic model, five monthly inputs lagged three months" labels={["Inputs through", "A year ago", "Peak since 2015"]} block={unserved} advanced />;
  return (
    <Card
      id="rg-rec"
      title="Recession score"
      sub="logistic model, five monthly inputs lagged three months"
      busy={quiet}
      footer={<AdvancedPanel adv={adv} items="the five inputs · fit and out-of-sample record · every month scored" missing="The logistic model's inputs, its fit record and its monthly history are not served yet." />}
    >
      {rec && score != null ? (
        <>
          <p className="rg-rec-line">
            <span className="rg-big rg-rec-big">{pctPlain(score)}</span>
            {band ? <span className="rg-rec-words">{band}.</span> : null}
          </p>
          {scoredFor ? <p className="rg-rec-for">{scoredFor}</p> : null}
          {edges && fin(edges[0]) && fin(edges[1]) ? (
            <Gauge
              min={0}
              max={1}
              value={score}
              bands={[
                { label: "Low", to: edges[0], tone: "green" },
                { label: "Elevated", to: edges[1], tone: "neutral" },
                { label: `High risk · above ${pctPlain(edges[1])}`, to: 1, tone: "amber" },
              ]}
              label={`Recession score ${pctPlain(score)}${band ? `, ${band.toLowerCase()}` : ""}`}
              under
            />
          ) : (
            <Awaiting>the Low, Elevated and High risk bands</Awaiting>
          )}
        </>
      ) : quiet ? null : (
        <Awaiting>the recession score</Awaiting>
      )}
      {rec ? (
        <StatRow cols={3}>
          <Stat label="Inputs through" value={monthShort(rec.inputs_through)} awaiting={!monthShort(rec.inputs_through)} sub="three-month lag by design" />
          {/* §5: "—" when a year ago's month is absent (served null), never Awaiting refresh. */}
          <Stat label="A year ago" value={rec.year_ago && fin(rec.year_ago.score) ? pctPlain(rec.year_ago.score) : "—"} sub={rec.year_ago ? monthYear(rec.year_ago.probability_month) : undefined} />
          <Stat label="Peak since 2015" tone="amber" value={rec.peak && fin(rec.peak.score) ? pctPlain(rec.peak.score) : undefined} awaiting={!rec.peak || !fin(rec.peak.score)} sub={rec.peak ? monthYear(rec.peak.probability_month) : undefined} />
        </StatRow>
      ) : (
        <AwaitingStats labels={["Inputs through", "A year ago", "Peak since 2015"]} quiet={quiet} />
      )}
      <ReadBox label="What it is" className="rg-method">
        a fitted model — five monthly indicators against NBER recession dates{trained}; historical scores are in-sample. It is the only fitted thing on the site, and it is labeled as one wherever it appears.
      </ReadBox>
    </Card>
  );
}

/** The stock–bond column's color, §5 and §6's reading of the sign: below zero bonds hedge (green), above it they do not (amber). */
export function stockBondTone(x: number): "green" | "amber" | undefined {
  return x < 0 ? "green" : x > 0 ? "amber" : undefined;
}

function Meant({ r, state }: { r: RegimeResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const current = r?.current?.label;
  const stats = Array.isArray(r?.stats) ? r.stats : [];
  const unserved = useBlockUnserved(r, "stats");
  if (unserved) return <UnservedCard headingId="rg-meant" className="rg-card" title="What each regime has meant" sub="since 1996 · why a derivatives desk cares" labels={["Regime", "Months", "S&P / mo", "Up", "VIX avg"]} block={unserved} advanced />;
  return (
    <Card
      id="rg-meant"
      title="What each regime has meant"
      sub="since 1996 · why a derivatives desk cares"
      busy={quiet}
      footer={<AdvancedPanel adv={adv} items="by regime: sector leaders · curve shape · credit spreads · skew (since 2023)" missing="The by-regime sector, curve, credit and skew tables are not served yet." />}
    >
      {stats.length || !quiet ? (
        <table className="rg-table">
          <colgroup>
            <col className="rg-col-regime" />
            <col className="rg-col-months" />
            <col className="rg-col-spx" />
            <col className="rg-col-up" />
            <col className="rg-col-vix" />
            <col className="rg-col-sb" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Regime</th>
              <th scope="col">Months</th>
              <th scope="col">S&amp;P / mo</th>
              <th scope="col">Up</th>
              <th scope="col">VIX avg</th>
              <th scope="col">Stock–bond</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.regime} data-current={s.regime === current || undefined} aria-current={s.regime === current ? "true" : undefined}>
                <th scope="row">
                  <i className="rg-dot" data-tone={REGIME_KEY[s.regime] ?? "gray"} aria-hidden="true" />
                  {s.regime}
                </th>
                <td>{fin(s.months) ? s.months : "—"}</td>
                <td>{fin(s.spx_mo) ? <Signed value={s.spx_mo}>{pct(s.spx_mo)}</Signed> : "—"}</td>
                <td>{fin(s.up_pct) ? pctPlain(s.up_pct) : "—"}</td>
                <td>{fin(s.vix_avg) ? s.vix_avg : "—"}</td>
                <td data-tone={fin(s.stock_bond_corr) ? stockBondTone(s.stock_bond_corr) : undefined}>{fin(s.stock_bond_corr) ? (s.stock_bond_corr > 0 ? `+${num(s.stock_bond_corr)}` : num(s.stock_bond_corr)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {!stats.length && !quiet ? <Awaiting>what each regime has meant</Awaiting> : null}
      <ServedRead read={r?.reads?.stats} />
    </Card>
  );
}

/** A threshold in percent, m/m, to the precision served (0.002 → "0.2", 0.0015 → "0.15", 0.00003 → "0.003"). */
export function mom(x: number): string {
  const v = Math.abs(x) * 100;
  for (let d = 2; d <= 6; d++) if (Number(v.toFixed(d)) !== 0) return String(Number(v.toFixed(d)));
  return "0";
}

/**
 * "a soft print (<0.2% m/m) flips inflation to falling → Goldilocks", from the
 * served threshold and the trend today: a rising trend flips on a print below
 * the threshold, a falling one on a print above it. Null when the threshold or
 * the trend is not served (the stat then says Awaiting refresh).
 */
export function flipWords(kind: "cpi" | "indpro", p: { flip_threshold_mom: number | null; flips_to: string | null }, now: unknown): string | null {
  const t = trend(now);
  if (!t || !fin(p.flip_threshold_mom) || typeof p.flips_to !== "string" || !p.flips_to) return null;
  const x = p.flip_threshold_mom;
  const what = kind === "cpi" ? "inflation" : "growth";
  const sign = x < 0 ? "−" : "";
  const print =
    t === "rising"
      ? x > 0
        ? `a soft print (<${mom(x)}% m/m)`
        : x === 0
          ? "a negative print"
          : `a print below ${sign}${mom(x)}% m/m`
      : x > 0
        ? `a hot print (>${mom(x)}% m/m)`
        : x === 0
          ? "a positive print"
          : `a print above ${sign}${mom(x)}% m/m`;
  return `${print} flips ${what} to ${t === "rising" ? "falling" : "rising"} → ${p.flips_to}`;
}

/** The date's color: the regime it would flip to, with red read as caution (D12: red is for down and negative numbers only). */
export function flipTone(to: string): "green" | "amber" | undefined {
  const k = REGIME_KEY[to];
  return k === "green" ? "green" : k === "amber" || k === "red" ? "amber" : undefined;
}

function NextPrint({ label, kind, p, now }: { label: string; kind: "cpi" | "indpro"; p: NextPrintBlock | null | undefined; now: unknown }) {
  const words = p ? flipWords(kind, p, now) : null;
  const date = p ? dayShort(p.date) : "";
  if (!p || !words || !date || !p.flips_to) return <Stat label={label} awaiting />;
  return <Stat label={label} value={date} tone={flipTone(p.flips_to)} sub={words} />;
}

function WouldChange({ r, state }: { r: RegimeResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const np = r?.next_prints;
  const changes = Array.isArray(r?.changes) ? r.changes : [];
  // Two blocks in one card: the next prints and the last five changes, each served on its own (§12.6).
  const whole = useUnserved();
  const npOff = useBlockUnserved(r, "next_prints");
  const chOff = useBlockUnserved(r, "changes");
  if (whole) return <UnservedCard headingId="rg-change" className="rg-card" title="What would change it" sub="the next two prints, and the last five changes" labels={["Next CPI", "Next INDPRO"]} block={whole} advanced />;
  return (
    <Card
      id="rg-change"
      title="What would change it"
      sub="the next two prints, and the last five changes"
      busy={quiet}
      footer={<AdvancedPanel adv={adv} items="all regime changes since 1996 · S&P at 1 / 3 / 6 months after each" missing="The full list of changes and their 3- and 6-month S&P moves are not served yet." />}
    >
      {quiet ? null : (
        <>
          {npOff ? (
            <Unserved block={npOff}>
              <StatRow cols={2}>
                <Stat label="Next CPI" awaiting />
                <Stat label="Next INDPRO" awaiting />
              </StatRow>
              <UnservedLine block={npOff} />
            </Unserved>
          ) : (
            <StatRow cols={2}>
              <NextPrint label="Next CPI" kind="cpi" p={np?.cpi} now={r?.current?.inflation} />
              <NextPrint label="Next INDPRO" kind="indpro" p={np?.indpro} now={r?.current?.growth} />
            </StatRow>
          )}
          <p className="dk-stat-label rg-changes-h">Last five regime changes · S&amp;P a month later</p>
          {chOff ? (
            <UnservedLine block={chOff} />
          ) : changes.length ? (
            <ul className="rg-changes">
              {changes.map((c) => (
                <li key={c.month}>
                  <span className="rg-month">{`${monthShort(c.month)} ${year(c.month)}`}</span>
                  <span>
                    {c.from} → {c.to}
                  </span>
                  {fin(c.spx_1m) ? <Signed value={c.spx_1m}>{pct(c.spx_1m)}</Signed> : <span>—</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Awaiting />
          )}
        </>
      )}
      <ServedRead read={r?.reads?.changes} />
    </Card>
  );
}

type State = "loading" | "awaiting" | "ready";

export default function RegimePage({ page }: { page: DeskPage }) {
  const q = useRegime();
  const r = q.data;
  const state: State = r ? "ready" : q.isError ? "awaiting" : "loading";
  const print = rowWords(r?.current?.print) || null;
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="rg">
      <PageTitle page={page} badge={unserved ? <NotServedBadge boxed /> : r ? <LiveBadge boxed parts={[print, dayShort(r.as_of)]} /> : null} />
      <Unserved block={unserved}>
        <div className="rg-grid">
          <WhereWeAre r={r} state={state} />
          <Recession r={r} state={state} />
          <Meant r={r} state={state} />
          <WouldChange r={r} state={state} />
        </div>
      </Unserved>
    </div>
  );
}
