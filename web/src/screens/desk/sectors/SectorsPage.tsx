/**
 * Sectors (DESK_FRAME3_SPEC §7, screens/06-sectors.png), read from
 * GET /api/desk/sectors (§12.7): who is leading (all eleven sector ETFs,
 * three months relative to the S&P) and whether the rally is wide or narrow
 * (sectors above their 50- and 200-day, equal weight against cap weight, small
 * caps against large). Until the sector ETFs are ingested the endpoint
 * answers `{"error":"series not ingested"}` and both cards say Awaiting
 * refresh with their labels kept (§12.7, §1.7).
 */

import type { ReactNode } from "react";
import { unavailableOf, useSectors } from "../data/api";
import type { RelPoint, SectorsResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayShort, endDay, pct } from "../kit/format";
import LineChart from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import RankBars, { relTone } from "../kit/RankBars";
import { AdvancedPanel, Awaiting, DroppedNote, LiveBadge, NotServedBadge, Stat, StatRow, Unserved, useAdvanced } from "../kit/ui";
import { droppedOf } from "../data/schema";
import "./sectors.css";

type State = "loading" | "awaiting" | "ready";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function CardHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="dk-card-head">
      <h2 className="dk-card-title" id={id}>
        {title}
        <span className="dk-card-sub"> {sub}</span>
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

function Leadership({ s, state, why }: { s: SectorsResponse | undefined; state: State; why: string | null }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  // §12.7 serves the eleven sorted, best first: the page keeps that order, so the leader is the first row
  // and the laggard the last, each saying Awaiting refresh when its value is not served (S-4).
  const rows = Array.isArray(s?.leadership) ? s.leadership : [];
  // Codex R-16: with a row lost, the first and last read are not the leader and the laggard.
  const lost = droppedOf(s, "leadership");
  const top = lost ? undefined : rows[0];
  const bottom = lost ? undefined : rows.length > 1 ? rows[rows.length - 1] : undefined;
  const topV = top && fin(top.rel_ret) ? top.rel_ret : null;
  const bottomV = bottom && fin(bottom.rel_ret) ? bottom.rel_ret : null;
  return (
    <section className="dk-card sc-card" aria-labelledby="sc-lead" aria-busy={quiet}>
      <CardHead id="sc-lead" title="Sector leadership" sub={`${windowWord(s)} return relative to the S&P · all eleven`} />
      {quiet ? null : (
        <StatRow cols={3}>
          <Stat label="Leading" awaiting={topV == null} value={top?.name} tone={topV != null ? relTone(topV) : undefined} sub={topV != null ? `${pct(topV)} vs the index` : undefined} />
          <Stat
            label="Lagging"
            awaiting={bottomV == null}
            value={bottom?.name}
            tone={bottomV != null ? relTone(bottomV) : undefined}
            sub={bottomV != null ? <span data-tone={bottomV < 0 ? "red" : undefined}>{pct(bottomV)} vs the index</span> : undefined}
          />
          {/* §12.13's shape serves no pattern word yet: the label stays, the value waits for its rule. */}
          <Stat label="Pattern" awaiting />
        </StatRow>
      )}
      {rows.length ? (
        <>
          <RankBars label="All eleven sector ETFs against the S&P" rows={rows.map((r) => ({ key: r.etf, ticker: r.etf, name: r.name, value: fin(r.rel_ret) ? r.rel_ret : null }))} />
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
        </>
      ) : quiet ? null : (
        <Awaiting>{why ?? "the sector returns"}</Awaiting>
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
      <p className="dk-stat-label">{label}</p>
      {map && cols.length ? (
        <ul className="sc-dots" aria-label={name}>
          {cols.map((o) => {
            const v = map[o.etf];
            const state = v === true ? "on" : v === false ? "off" : "unknown";
            return (
              <li key={o.etf} data-state={state}>
                <i aria-hidden="true" />
                <span>{o.short}</span>
                <span className="dk-sr">{state === "on" ? "above" : state === "off" ? "below" : "not served"}</span>
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
        <p className="dk-stat-label">{label}</p>
        <Awaiting />
      </div>
    );
  // The axis is symmetric around zero at the next 5% above the widest served move (§7: +5 / 0 / −5).
  const lim = Math.max(0.05, Math.ceil((Math.max(...vals.map(Math.abs)) * 100) / 5) * 0.05);
  return (
    <div className="sc-rel">
      <p className="dk-stat-label">{label}</p>
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

const count = (x: { n: number | null; of: number | null } | undefined) => (x && fin(x.n) && fin(x.of) ? `${x.n} of ${x.of}` : undefined);

/** §7's gray note under the breadth read: fixed copy about what breadth is measured from. */
const BREADTH_NOTE = "Measured from sector ETFs; stock-level breadth needs constituent data that is not ingested yet.";

function Breadth({ s, state, why }: { s: SectorsResponse | undefined; state: State; why: string | null }) {
  const adv = useAdvanced();
  const quiet = state === "loading";
  const b = s?.breadth;
  const order = Array.isArray(s?.leadership) ? s.leadership.map((r) => ({ etf: r.etf, short: r.short ?? r.etf })) : [];
  const a50 = b?.above_50;
  const a200 = b?.above_200;
  const eqw = b?.eqw_vs_cap_3m;
  return (
    <section className="dk-card sc-card" aria-labelledby="sc-breadth" aria-busy={quiet}>
      <CardHead id="sc-breadth" title="Breadth" sub="is the rally wide or narrow?" />
      {quiet ? null : (
        <StatRow cols={3}>
          {/* §12.13: breadth serves its comparison date; no month-ago count or engine words are served. */}
          <Stat label="Above 50-day" awaiting={!count(a50)} value={count(a50)} sub={count(a50) ? `sectors${a50 && dayShort(a50.compared_on) ? ` · on ${dayShort(a50.compared_on)}` : ""}` : undefined} />
          <Stat label="Above 200-day" awaiting={!count(a200)} value={count(a200)} sub={count(a200) ? "sectors" : undefined} />
          <Stat
            label={vs("Equal", "cap weight")}
            awaiting={!fin(eqw)}
            value={fin(eqw) ? pct(eqw) : undefined}
            tone={fin(eqw) ? (eqw < 0 ? "down" : eqw > 0 ? "up" : undefined) : undefined}
            sub={fin(eqw) ? "3 months" : undefined}
          />
        </StatRow>
      )}
      {b ? (
        <>
          <RelChart
            label={
              <>
                Average stock <span className="dk-lc">vs</span> the index · one year
              </>
            }
            name="Average stock vs the index · one year"
            points={b.eqw_vs_cap_series}
            bands={["average stock beating the index · broad rally", "index beating the average stock · narrow rally"]}
            height={165}
            pad={{ t: 19, r: 54, b: 40 }}
          />
          <Dots label="Which sectors are above their 50-day" name="Which sectors are above their 50-day" byEtf={a50?.by_etf} order={order} />
          <Dots label="…and their 200-day" name="Which sectors are above their 200-day" byEtf={a200?.by_etf} order={order} />
          <RelChart
            label={
              <>
                Small caps <span className="dk-lc">vs</span> large · Russell 2000 against the S&amp;P · one year
              </>
            }
            name="Small caps vs large · Russell 2000 against the S&P · one year"
            points={b.small_vs_large_series}
            bands={["small caps leading · risk appetite broad", "large caps leading · crowded into the biggest names"]}
            height={98}
            pad={{ t: 19, r: 54, b: 6 }}
            ends={false}
          />
          <p className="sc-note sc-gray">{BREADTH_NOTE}</p>
        </>
      ) : quiet ? null : (
        <Awaiting>{why ?? "the breadth measures"}</Awaiting>
      )}
      <div className="dk-card-foot">
        <AdvancedPanel adv={adv} items="all three measures since 2000 · breadth by regime · small caps vs large" missing="The history since 2000 and breadth by regime are not served yet." />
      </div>
    </section>
  );
}

export default function SectorsPage({ page }: { page: DeskPage }) {
  const q = useSectors();
  const s = q.data;
  // §12.7: until the sector ETFs are ingested the endpoint answers {"error":"series not ingested"} (as an
  // error status or as a 200 body); any other answer is served, and each card judges its own block (S-3).
  const bodyError = s && typeof (s as unknown as { error?: unknown }).error === "string" ? (s as unknown as { error: string }).error : undefined;
  const errorWord = q.error?.body?.error ?? bodyError;
  const ok = !!s && !bodyError;
  const state: State = ok ? "ready" : q.isError || s ? "awaiting" : "loading";
  const why = errorWord === "series not ingested" ? "the sector ETFs are not ingested yet" : null;
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="sc">
      <PageTitle page={page} badge={unserved ? <NotServedBadge boxed block={unserved} /> : ok && s.as_of ? <LiveBadge boxed parts={["Yahoo", dayShort(s.as_of)]} /> : null} />
      <Unserved block={unserved}>
        <div className="sc-grid">
          <Leadership s={ok ? s : undefined} state={state} why={why} />
          <Breadth s={ok ? s : undefined} state={state} why={why} />
        </div>
      </Unserved>
    </div>
  );
}
