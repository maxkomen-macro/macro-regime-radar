/**
 * Overview (DESK_FRAME3_SPEC §2, screens/01-overview.png), read from
 * GET /api/desk/overview (§12.1) only: the since-last-close line, four tiles
 * (regime, recession, S&P trend, VIX), the active signals with their
 * verdicts, and the monitored positions sorted by room left. Every number is
 * a served field, formatted; the words beside them are fixed spellings of
 * served values (a band, a sign, a verdict). Each tile stands on its own:
 * a missing block leaves that tile's label and "Awaiting refresh" (§1.7);
 * while the first answer is on its way the tiles stay quiet.
 */

import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOverview } from "../data/api";
import type { LedgerRow, OverviewResponse, OverviewTiles, PositionCompact, SinceLastClose, Verdict } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { capitalize, dayLong, dayShort, monthShort, monthYear, oneIn, pct, pctPlain, pts, utcTime, year } from "../kit/format";
import { Awaiting, LiveBadge, Signed, VerdictPill } from "../kit/ui";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import MonitoredRows from "../kit/MonitoredRows";
import "./overview.css";

/** The since-last-close items (§2), in the spec's order. A vol change that
 * rounds to 0.0 reads "unchanged". */
export function sinceItems(s: SinceLastClose): { key: string; text: string; tag?: string }[] {
  const out: { key: string; text: string; tag?: string }[] = [];
  for (const f of s.new_fires ?? []) out.push({ key: `new-${f.slug}`, text: f.label, tag: "(new)" });
  for (const f of s.still_firing ?? []) out.push({ key: `still-${f.slug}`, text: `${f.label}, day ${f.day}` });
  const v = s.vol_change_pts;
  if (typeof v === "number") {
    const dir = v >= 0.05 ? "up" : v <= -0.05 ? "down" : "unchanged";
    out.push({ key: "vol", text: `vol ${dir}${dir === "unchanged" ? "" : ` ${Math.abs(v).toFixed(1)} pts`}${s.skew_direction ? `, skew ${s.skew_direction}` : ""}` });
  }
  out.push({ key: "regime", text: s.regime_changed && s.regime_to ? `regime changed → ${s.regime_to}` : "regime unchanged" });
  const at = utcTime(s.refreshed_at_utc);
  if (at) out.push({ key: "refresh", text: `data refreshed ${at}` });
  return out;
}

function SinceLine({ data, failed }: { data: SinceLastClose | undefined; failed: boolean }) {
  return (
    <div className="ov-since" data-testid="ov-since" aria-busy={!data && !failed}>
      <span className="ov-since-label">Since last close</span>
      {data ? (
        sinceItems(data).map((it, i) => (
          <span key={it.key} className="ov-since-item">
            {i > 0 ? (
              <span className="ov-since-sep" aria-hidden="true">
                ·
              </span>
            ) : null}
            {it.text}
            {it.tag ? <span data-tone="up"> {it.tag}</span> : null}
          </span>
        ))
      ) : failed ? (
        <span className="ov-since-item" style={{ color: "var(--dk-t3)" }}>
          Awaiting refresh
        </span>
      ) : null}
    </div>
  );
}

/** §1.3 gives one regime a color: Overheating is amber; the others keep the text color. */
export const REGIME_TONE: Readonly<Record<string, string>> = { Overheating: "amber" };

/** "Above 50 & 200" and its trend word, from the two served flags. */
export function trendWords(t: OverviewTiles["trend"]): { value: string; trend: string } {
  if (t.above_50 && t.above_200) return { value: "Above 50 & 200", trend: "Uptrend" };
  if (!t.above_50 && !t.above_200) return { value: "Below 50 & 200", trend: "Downtrend" };
  return t.above_200 ? { value: "Above 200, below 50", trend: "Mixed trend" } : { value: "Above 50, below 200", trend: "Mixed trend" };
}

const VERDICT_CLAUSE: Record<Verdict, string> = {
  reliable: "that signal is reliable",
  suggestive: "that signal is suggestive",
  no_edge: "that signal has no edge",
  insufficient: "too few events to score that signal",
};

/** The trend tile's sub-line from the served block; any missing part is left out. */
export function trendSub(tr: OverviewTiles["trend"], word: string): string {
  const when = monthYear(tr.since);
  const signal = tr.since_signal ? tr.since_signal.replace(/-/g, " ") : "";
  const since = when ? ` since the ${when}${signal ? ` ${signal}` : ""}` : "";
  const clause = VERDICT_CLAUSE[tr.since_verdict];
  return `${word}${since}${clause ? ` · ${clause}` : ""}`;
}

/** "protection costs about 4 pts more than recent moves justify" from gap_pts. */
export function gapWords(gap: number): string {
  const n = Math.round(Math.abs(gap));
  if (n === 0) return "protection costs about what recent moves justify";
  return `protection costs about ${n} pts ${gap > 0 ? "more" : "less"} than recent moves justify`;
}

/** The recession tile's sub-line: the band, the odds in words where they read true, the input month. */
export function recessionWords(r: OverviewTiles["recession"]): string {
  const odds = oneIn(r.prob) ?? pctPlain(r.prob);
  const through = monthShort(r.inputs_through);
  return `${capitalize(r.band)} · ${odds} over the next year${through ? `, on data through ${through}` : ""}`;
}

type TileState = "ready" | "loading" | "awaiting";

function Tile({ label, state, badge, value, tone, sub }: { label: string; state: TileState; badge?: ReactNode; value?: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <section className="ov-tile" aria-label={label} aria-busy={state === "loading"}>
      <div className="ov-tile-head">
        <span className="ov-tile-label">{label}</span>
        {state === "ready" ? badge : null}
      </div>
      {state === "ready" ? (
        <>
          <p className="ov-tile-value" data-tone={tone}>
            {value}
          </p>
          <p className="ov-tile-sub">{sub}</p>
        </>
      ) : state === "awaiting" ? (
        <Awaiting />
      ) : null}
    </section>
  );
}

function Tiles({ data, failed }: { data: OverviewResponse | undefined; failed: boolean }) {
  const t = data?.tiles;
  const state = (block: unknown): TileState => (block ? "ready" : failed || data ? "awaiting" : "loading");
  const trend = t?.trend ? trendWords(t.trend) : null;
  return (
    <div className="ov-tiles">
      <Tile
        label="Regime"
        state={state(t?.regime)}
        badge={t?.regime ? <LiveBadge parts={[t.regime.print ? `${t.regime.print} print` : null]} /> : null}
        value={t?.regime?.label}
        tone={t?.regime ? REGIME_TONE[t.regime.label] : undefined}
        sub={t?.regime ? `Growth ${t.regime.growth}, inflation ${t.regime.inflation} · rule-based, two-month lag` : null}
      />
      <Tile label="Recession · logistic model" state={state(t?.recession)} badge={<LiveBadge />} value={t?.recession ? pctPlain(t.recession.prob) : null} sub={t?.recession ? recessionWords(t.recession) : null} />
      <Tile
        label="S&P 500 · trend"
        state={state(t?.trend)}
        badge={t?.trend ? <LiveBadge parts={[dayShort(t.trend.date) || null]} /> : null}
        value={trend?.value}
        sub={t?.trend && trend ? trendSub(t.trend, trend.trend) : null}
      />
      <Tile
        label="Vol · VIX"
        state={state(typeof t?.vol?.vix === "number" ? t.vol : null)}
        badge={t?.vol ? <LiveBadge parts={[dayShort(t.vol.date) || null]} /> : null}
        value={typeof t?.vol?.vix === "number" ? t.vol.vix.toFixed(1) : null}
        sub={t?.vol ? [capitalize(t.vol.band), typeof t.vol.gap_pts === "number" ? gapWords(t.vol.gap_pts) : ""].filter(Boolean).join(" · ") : null}
      />
    </div>
  );
}

/** One active signal's sentence (§2). */
export function SignalSentence({ row }: { row: LedgerRow }) {
  const since = year(row.sample_start);
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return (
    <>
      Fired <b>{row.n}×</b>
      {since ? ` since ${since}` : ""}
      {ok(row.up_pct) ? (
        <>
          {" "}
          · S&amp;P up <b>{pctPlain(row.up_pct)}</b> of the time
        </>
      ) : null}
      {ok(row.median) ? (
        <>
          {" "}
          · <span className="dk-nowrap">20-day</span> median{" "}
          <Signed value={row.median} bold>
            {pct(row.median)}
          </Signed>
          {ok(row.vs_normal_pts) ? ` (${pts(row.vs_normal_pts)} vs normal)` : ""}
        </>
      ) : null}
    </>
  );
}

function ActiveSignals({ data, failed, pathTo }: { data: OverviewResponse | undefined; failed: boolean; pathTo: (slug: string) => string }) {
  const rows = data?.active_signals;
  return (
    <section className="dk-card ov-active" aria-labelledby="ov-active-title">
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="ov-active-title">
          Active signals
          <span className="dk-card-sub" data-mono>
            what fired, how it has played out before{data ? ` · engine as of ${dayShort(data.as_of)}` : ""}
          </span>
        </h2>
      </div>
      <div className="dk-card-body" aria-busy={!data && !failed}>
        {rows ? (
          rows.length ? (
            <ul className="ov-signals">
              {rows.map((r) => (
                <li key={r.slug} className="ov-signal" data-firing={r.firing_now || undefined}>
                  <div className="ov-signal-name">
                    <b>{r.label}</b>
                    {dayLong(r.last_fired) ? <span>last fired {dayLong(r.last_fired)}</span> : null}
                  </div>
                  <p className="ov-signal-text">
                    <SignalSentence row={r} />
                  </p>
                  <VerdictPill verdict={r.verdict} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="dk-await">Nothing is firing, and nothing has fired recently.</p>
          )
        ) : failed || data ? (
          <Awaiting />
        ) : null}
      </div>
      <div className="ov-active-foot">
        <VerdictDefinitions />
        <Link className="dk-link ov-ledger-link" to={pathTo("signal-ledger")}>
          Full Signal Ledger →
        </Link>
      </div>
    </section>
  );
}

/** The footer under the monitored rows; separators hold to the word before them. */
export const MONITORED_NOTE = ["Sorted by room left", "same scale for every trade", "size as % of NAV", "click a row for the gate text"].map((p) => p.replace(/ /g, "\u00a0")).join("\u00a0· ");

function Monitored({ rows, failed, pathTo }: { rows: PositionCompact[] | undefined; failed: boolean; pathTo: (slug: string) => string }) {
  const navigate = useNavigate();
  return (
    <section className="dk-card ov-monitored" aria-labelledby="ov-mon-title">
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="ov-mon-title">
          Monitored
          <span className="dk-card-sub" data-mono>
            how far each is from being wrong · live
          </span>
        </h2>
      </div>
      <div className="dk-card-body" aria-busy={!rows && !failed}>
        {rows ? (
          <>
            <MonitoredRows rows={rows} onOpen={(id) => navigate(withParam(pathTo("position-monitor"), "open", id))} />
            <p className="ov-mon-note">{MONITORED_NOTE}</p>
          </>
        ) : failed ? (
          <Awaiting />
        ) : null}
        <div className="ov-mon-act">
          <Link className="dk-btn" data-kind="light" to={pathTo("position-monitor")}>
            Act on this → Position Monitor
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function OverviewPage({ page }: { page: DeskPage }) {
  const { pathTo } = useDeskView();
  const q = useOverview();
  const data = q.data;
  const failed = q.isError;
  return (
    <div className="ov">
      <PageTitle page={page} />
      <SinceLine data={data?.since_last_close} failed={failed || (!!data && !data.since_last_close)} />
      <Tiles data={data} failed={failed} />
      <div className="ov-grid">
        <ActiveSignals data={data} failed={failed} pathTo={pathTo} />
        <Monitored rows={data?.monitored} failed={failed || (!!data && !data.monitored)} pathTo={pathTo} />
      </div>
    </div>
  );
}
