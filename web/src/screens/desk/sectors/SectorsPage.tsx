/**
 * Sectors (DESK_FRAME3_SPEC §7, screens/06-sectors.png), read from
 * GET /api/desk/sectors (§12.14, desk/fill-etf): who is leading (all eleven
 * sector ETFs, their 60-session log return less SPY's, ranked as served, and
 * the pattern word by its served rule) and whether the rally is wide or
 * narrow (breadth, its own block). Every number is served and dated by the
 * served comparison session; a row the store cannot compute says why ("not
 * available"), never a value. A route or block served awaiting keeps its
 * labels and prints the reason (§1.0.2, §1.7).
 */

import type { ReactNode } from "react";
import { unavailableOf, useSectors } from "../data/api";
import type { AboveAverage, RelPoint, SectorPattern, SectorsResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayShort, endDay, leadershipGaps, pct } from "../kit/format";
import LineChart from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import RankBars, { relTone } from "../kit/RankBars";
import { AdvancedPanel, Awaiting, DroppedNote, LiveBadge, NotServedBadge, Stat, StatRow, Unserved, UnservedCard, useAdvanced, useBlockUnserved, LoadingLine } from "../kit/ui";
import { droppedOf } from "../data/schema";
import "./sectors.css";
import { defineTerms } from "../kit/Term";

type State = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

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

/** The window in words, from the served months ("3-month"). */
const windowWord = (s: SectorsResponse | undefined) => (s && fin(s.window_months) ? `${s.window_months}-month` : "3-month");

/** "Equal vs cap weight" with §7's lowercase "vs" inside an uppercase label. */
const vs = (a: string, b: string) => (
  <>
    {a} <span className="dk-lc">vs</span> {b}
  </>
);

/** §1.9: a log fraction's hover text. */
const LOG_TIP = "log return, ×100";

/** The served pattern word in words, with its sub-line from the served spread (§12.14 `sector-pattern-v1`). */
export function patternWords(p: SectorPattern | undefined): { value: string; sub: string } | null {
  if (!p || !p.word || !fin(p.spread)) return null;
  const by = pct(Math.abs(p.spread));
  if (p.word === "cyclical") return { value: "Cyclical", sub: `cyclical sectors ahead of defensives by ${by.replace(/^\+/, "")}` };
  if (p.word === "defensive") return { value: "Defensive", sub: `defensives ahead of cyclical sectors by ${by.replace(/^\+/, "")}` };
  return { value: "Mixed", sub: `neither group ahead by more than ${pct(p.band ?? 0.01, 0).replace(/^\+/, "")}` };
}

/** "60 sessions to Sep 23 · log return, ×100 · SPY +2.1%": what the bars measure, from the served window. */
export function windowLine(s: SectorsResponse | undefined): string {
  if (!s?.window?.end) return "";
  const spy = s.benchmark && fin(s.benchmark.ret) ? ` · SPY ${pct(s.benchmark.ret)} over the same sessions` : "";
  return `${fin(s.window.n) ? s.window.n : 60} sessions to ${dayShort(s.window.end)} (from ${dayShort(s.window.start)}) · log returns ×100${spy}`;
}

function Leadership({ s, state }: { s: SectorsResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  // §12.14 serves the eleven ranked, best first, a row without a value after every served one: the page keeps
  // that order, so the leader is the first served row and the laggard the last served one (S-4).
  const rows = Array.isArray(s?.leadership) ? s.leadership : [];
  const valued = rows.filter((r) => fin(r.rel_ret));
  // Codex R-16: with a row lost, the first and last read are not the leader and the laggard.
  const lost = droppedOf(s, "leadership");
  const top = lost ? undefined : valued[0];
  const bottom = lost ? undefined : valued.length > 1 ? valued[valued.length - 1] : undefined;
  const topV = top && fin(top.rel_ret) ? top.rel_ret : null;
  const bottomV = bottom && fin(bottom.rel_ret) ? bottom.rel_ret : null;
  const pat = patternWords(s?.pattern);
  // Codex R-01: with a sector's return not available, the ranking is only among the others; it says so and names them.
  const gaps = leadershipGaps(s);
  const among = gaps.among ? ` · ${gaps.among}` : "";
  return (
    <section className="dk-card sc-card" aria-labelledby="sc-lead" aria-busy={quiet}>
      <CardHead
        id="sc-lead"
        title="Sector leadership"
        sub={`${windowWord(s)} return relative to the S&P · ${gaps.missing.length ? `${gaps.ranked} of ${rows.length} with data` : "all eleven"}`}
      />
      <LoadingLine busy={quiet} />
      {quiet ? null : (
        <StatRow cols={3}>
          <Stat label="Leading" awaiting={topV == null} value={top?.name} tone={topV != null ? relTone(topV) : undefined} sub={topV != null ? <span title={LOG_TIP}>{pct(topV)} vs the index{among}</span> : undefined} />
          <Stat
            label="Lagging"
            awaiting={bottomV == null}
            value={bottom?.name}
            tone={bottomV != null ? relTone(bottomV) : undefined}
            sub={bottomV != null ? <span data-tone={bottomV < 0 ? "red" : undefined} title={LOG_TIP}>{pct(bottomV)} vs the index{among}</span> : undefined}
          />
          {/* §12.14: the served word by its named rule; its reason when a group member is not served. */}
          <Stat label="Pattern" awaiting={!pat} value={pat?.value} sub={pat?.sub} why={s?.pattern?.reason ?? undefined} />
        </StatRow>
      )}
      {rows.length ? (
        <>
          <RankBars
            label="All eleven sector ETFs against the S&P"
            rows={rows.map((r) => ({ key: r.etf, ticker: r.etf, name: r.name, value: fin(r.rel_ret) ? r.rel_ret : null, note: r.reason ?? null, title: LOG_TIP }))}
          />
          <p className="sc-key" aria-hidden="true">
            <span>
              <i data-tone="green" /> more than 1% ahead
            </span>
            <span>
              <i data-tone="gray" /> within 1%
            </span>
            <span>
              <i data-tone="red" /> more than 1% behind
            </span>
          </p>
          {gaps.note ? (
            <p className="dk-missing" role="note">
              {gaps.note}
            </p>
          ) : null}
          <p className="sc-window dk-asof">{windowLine(s)}</p>
        </>
      ) : quiet ? null : (
        <Awaiting>the sector returns</Awaiting>
      )}
      <DroppedNote n={lost} one="sector" />
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="1 / 3 / 6 / 12 months · rotation over time · leadership by regime" missing="Other windows, rotation over time and leadership by regime are not served yet." />
      </div>
    </section>
  );
}

function Dots({ label, name, byEtf, order }: { label: ReactNode; name: string; byEtf: Record<string, boolean> | undefined; order: { etf: string; short: string }[] }) {
  const map = byEtf && typeof byEtf === "object" ? byEtf : null;
  // Without the leadership list the dots follow the map's own keys.
  const cols = order.length ? order : map ? Object.keys(map).map((etf) => ({ etf, short: etf })) : [];
  return (
    <div className="sc-dots-wrap">
      <p className="dk-stat-label">{defineTerms(label)}</p>
      {map && cols.length ? (
        <ul className="sc-dots" aria-label={name}>
          {cols.map((o) => {
            const v = map[o.etf];
            const state = v === true ? "on" : v === false ? "off" : "unknown";
            return (
              <li key={o.etf} data-state={state}>
                <i aria-hidden="true" />
                <span>{o.short}</span>
                <span className="dk-sr">{state === "on" ? "above" : state === "off" ? "below" : "not available"}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Awaiting />
      )}
    </div>
  );
}

function RelChart({ label, name, points, bands, height, pad, ends = true }: { label: ReactNode; name: string; points: RelPoint[] | undefined; bands: [string, string]; height: number; pad: { t: number; r: number; b: number }; ends?: boolean }) {
  const pts = Array.isArray(points) ? points : [];
  const vals = pts.map((p) => p.rel).filter(fin);
  const last = [...pts].reverse().find((p) => fin(p.rel));
  if (vals.length < 2 || !last || !fin(last.rel))
    return (
      <div className="sc-rel">
        <p className="dk-stat-label">{defineTerms(label)}</p>
        <Awaiting />
      </div>
    );
  // The axis is symmetric around zero at the next 5% above the widest served move (§7: +5 / 0 / −5).
  const lim = Math.max(0.05, Math.ceil((Math.max(...vals.map(Math.abs)) * 100) / 5) * 0.05);
  return (
    <div className="sc-rel">
      <p className="dk-stat-label">{defineTerms(label)}</p>
      <LineChart
        ariaLabel={`${name}: ${pct(last.rel)}${last.date ? ` on ${dayShort(last.date)}` : ""}`}
        height={height}
        n={pts.length}
        yDomain={[-lim, lim]}
        yTicks={[
          { v: lim, text: `+${Math.round(lim * 100)}%` },
          { v: 0, text: "0" },
          { v: -lim, text: `−${Math.round(lim * 100)}%` },
        ]}
        grid={false}
        zero
        bands={[
          { from: 0, to: lim, fill: "rgba(38, 220, 160, 0.08)", label: bands[0], labelColor: DESK_ACCENTS.green },
          { from: -lim, to: 0, fill: "rgba(232, 180, 71, 0.08)", label: bands[1], labelColor: DESK_ACCENTS.amber, labelAt: "bottom" },
        ]}
        series={[{ key: "rel", values: pts.map((p) => (fin(p.rel) ? p.rel : null)), color: DESK_ACCENTS.blue, width: 2 }]}
        endDot="rel"
        xEnds={ends ? ["a year ago", endDay(last.date)] : undefined}
        pad={{ l: 40, ...pad }}
      />
    </div>
  );
}

/** "7 of 11 sectors": a served count, always naming what it is counted over (the sector ETFs, never stocks). */
export function countWords(x: AboveAverage | undefined): string | undefined {
  return x && fin(x.n) && fin(x.of) ? `${x.n} of ${x.of} sectors` : undefined;
}

/** "on Sep 23 · XLC not available": the count's date, and the sectors it could not be read for. */
export function countSub(x: AboveAverage | undefined): string | undefined {
  if (!x) return undefined;
  const lost = Array.isArray(x.not_available) ? x.not_available.map((r) => r.etf) : [];
  const parts = [x.compared_on ? `on ${dayShort(x.compared_on)}` : "", lost.length ? `${lost.join(", ")} not available` : ""].filter(Boolean);
  return parts.join(" · ") || undefined;
}

/** §7's gray note under breadth: what it is counted over, and what is not (desk/fill-etf). */
export const BREADTH_NOTE =
  "Counted over the 11 sector ETFs, not stocks. Constituent-level breadth, the stocks inside the index, needs constituent data that is not ingested yet.";

function Breadth({ s, state }: { s: SectorsResponse | undefined; state: State }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  // §12.14: breadth is its own block; served awaiting, the card keeps its labels and prints the reason (§1.0.2).
  const off = useBlockUnserved(s, "breadth");
  const b = s?.breadth;
  const order = Array.isArray(s?.leadership) ? s.leadership.map((r) => ({ etf: r.etf, short: r.short ?? r.etf })) : [];
  const a50 = b?.above_50;
  const a200 = b?.above_200;
  const eqw = b?.eqw_vs_cap_3m;
  const total = b && fin(b.of_total) ? b.of_total : 11;
  if (off)
    return (
      <UnservedCard
        headingId="sc-breadth"
        className="sc-card"
        title="Breadth"
        sub={`is the rally wide or narrow? · of ${total} sectors`}
        labels={["Above 50-day", "Above 200-day", vs("Equal", "cap weight")]}
        block={off}
        advanced
      />
    );
  return (
    <section className="dk-card sc-card" aria-labelledby="sc-breadth" aria-busy={quiet}>
      <CardHead id="sc-breadth" title="Breadth" sub={`is the rally wide or narrow? · of ${total} sectors`} />
      <LoadingLine busy={quiet} />
      {quiet ? null : (
        <StatRow cols={3}>
          {/* §12.14: each count says what it is counted over, and when; no month-ago count and no words are served. */}
          <Stat label="Above 50-day" awaiting={!countWords(a50)} value={countWords(a50)} sub={countSub(a50)} />
          <Stat label="Above 200-day" awaiting={!countWords(a200)} value={countWords(a200)} sub={countSub(a200)} />
          <Stat
            label={vs("Equal", "cap weight")}
            awaiting={!fin(eqw)}
            value={fin(eqw) ? <span title={LOG_TIP}>{pct(eqw)}</span> : undefined}
            tone={fin(eqw) ? (eqw < 0 ? "down" : eqw > 0 ? "up" : undefined) : undefined}
            sub={fin(eqw) ? "RSP vs SPY · 60 sessions" : undefined}
            why={b?.eqw_vs_cap_reason ?? undefined}
          />
        </StatRow>
      )}
      {b ? (
        <>
          <RelChart
            label={
              <>
                Equal weight <span className="dk-lc">vs</span> cap weight · RSP against SPY, 60-session difference · one year
              </>
            }
            name="Equal weight vs cap weight · RSP against SPY, 60-session difference · one year"
            points={b.eqw_vs_cap_series}
            bands={["RSP ahead of SPY · equal weight leading", "SPY ahead of RSP · cap weight leading"]}
            height={165}
            pad={{ t: 19, r: 54, b: 40 }}
          />
          <Dots label={`Which of the ${total} sectors are above their 50-day`} name={`Which of the ${total} sectors are above their 50-day`} byEtf={a50?.by_etf} order={order} />
          <Dots label="…and their 200-day" name={`Which of the ${total} sectors are above their 200-day`} byEtf={a200?.by_etf} order={order} />
          <RelChart
            label={
              <>
                Small caps <span className="dk-lc">vs</span> large · IWM against SPY, 60-session difference · one year
              </>
            }
            name="Small caps vs large · IWM against SPY, 60-session difference · one year"
            points={b.small_vs_large_series}
            bands={["IWM ahead of SPY · small caps leading", "SPY ahead of IWM · large caps leading"]}
            height={98}
            pad={{ t: 19, r: 54, b: 6 }}
            ends={false}
          />
          <p className="sc-note sc-gray">{BREADTH_NOTE}</p>
          {b.compared_on ? (
            <p className="dk-asof">
              {`on ${dayShort(b.compared_on)} · averages over 50 and 200 sessions · log returns ×100${Array.isArray(b.providers) && b.providers.length ? ` · ${b.providers.join("/")}` : ""}`}
            </p>
          ) : null}
        </>
      ) : quiet ? null : (
        <Awaiting>the breadth measures</Awaiting>
      )}
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="all three measures since 2000 · breadth by regime · small caps vs large" missing="The history since 2000 and breadth by regime are not served yet." />
      </div>
    </section>
  );
}

/** The badge's source words: the served providers ("Yahoo", "EODHD"), else nothing. */
const sourceWords = (s: SectorsResponse | undefined) => (Array.isArray(s?.providers) && s.providers.length ? s.providers.join("/") : null);

export default function SectorsPage({ page }: { page: DeskPage }) {
  const q = useSectors();
  const s = q.data;
  const state: State = s ? "ready" : q.isError ? "awaiting" : "loading";
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="sc">
      {/* §1.6: the badge dates what the page covers, the served comparison session, never the generation's day. */}
      <PageTitle page={page} badge={unserved ? <NotServedBadge boxed block={unserved} /> : s?.date ? <LiveBadge boxed parts={[sourceWords(s), dayShort(s.date)]} /> : null} />
      <Unserved block={unserved}>
        <div className="sc-grid">
          <Leadership s={s} state={state} />
          <Breadth s={s} state={state} />
        </div>
      </Unserved>
    </div>
  );
}
