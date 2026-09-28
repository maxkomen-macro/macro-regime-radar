/**
 * Overview (DESK_FRAME3_SPEC §2, screens/01-overview.png), read from
 * GET /api/desk/overview (§12.1): the since-last-close line, four tiles
 * (regime, recession, S&P trend, VIX) and the active signals with their
 * verdicts; beside them the positions kept in this browser (§9), sorted by
 * room left, their levels read from /technicals and /macro. Every number is
 * a served field, formatted; the words beside them are fixed spellings of
 * served values (a band, a sign, a verdict). Each tile stands on its own:
 * a missing block leaves that tile's label and "Awaiting refresh" (§1.7);
 * while the first answer is on its way the tiles stay quiet.
 */

import type { Unavailable } from "../data/envelope";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { unavailableOf, useOverview } from "../data/api";
import { droppedOf } from "../data/schema";
import type { LedgerRow, OverviewResponse, OverviewTiles, SinceLastClose } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { useDeskView, withParam } from "../desk-view";
import { bandWord, dayLong, dayShort, isFiniteNumber as fin, monthYear, num, pctPlain, rowWords, utcTime, year } from "../kit/format";
import { Awaiting, DroppedNote, LiveBadge, NotServedBadge, Signed, Unserved, UnservedCard, UnservedLine, useBlockUnserved, useUnserved, VerdictPill } from "../kit/ui";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import MonitoredRows from "../kit/MonitoredRows";
import { REGIME_TONE } from "../kit/palette";
import { viewOf } from "../positions/monitor";
import { isOpen } from "../positions/store";
import { useLevels, usePositionStore } from "../positions/usePositionStore";
import { moveText, tipOf, vsNormalText } from "../kit/units";
import "./overview.css";

/** The since-last-close items (§2), in the spec's order. A vol change that
 * rounds to 0.0 reads "unchanged". */
export function sinceItems(s: SinceLastClose): { key: string; text: string; tag?: string }[] {
  const out: { key: string; text: string; tag?: string }[] = [];
  // §2, §12.1: each new fire with (new); each signal still firing with its `firing_day`.
  for (const f of s.new_fires ?? []) out.push({ key: `new-${f.slug}`, text: `${f.short || f.label} fired`, tag: "(new)" });
  for (const f of s.still_firing ?? []) out.push({ key: `still-${f.slug}`, text: `${f.short || f.label} still firing${fin(f.firing_day) ? `, day ${f.firing_day}` : ""}` });
  // Codex R-16: a fire the boundary could not read is said, never left out as if nothing fired.
  const lostFires = droppedOf(s, "new_fires") + droppedOf(s, "still_firing");
  if (lostFires) out.push({ key: "lost", text: `${lostFires} ${lostFires === 1 ? "fire" : "fires"} could not be read` });
  const v = s.vol_change_pts;
  if (fin(v)) {
    const dir = v >= 0.05 ? "up" : v <= -0.05 ? "down" : "unchanged";
    out.push({ key: "vol", text: `vol ${dir}${dir === "unchanged" ? "" : ` ${Math.abs(v).toFixed(1)} pts`}` });
  }
  // Whether the regime changed is said only when it was served (Codex G1-9).
  if (s.regime_changed === true) out.push({ key: "regime", text: s.regime_to ? `regime changed → ${s.regime_to}` : "regime changed" });
  else if (s.regime_changed === false) out.push({ key: "regime", text: "regime unchanged" });
  const at = utcTime(s.refreshed_at_utc);
  if (at) out.push({ key: "refresh", text: `data refreshed ${at}` });
  return out;
}

function SinceLine({ data, failed, unserved }: { data: SinceLastClose | undefined; failed: boolean; unserved: Unavailable | null }) {
  return (
    <div className="ov-since" data-testid="ov-since" aria-busy={!data && !failed && !unserved}>
      {/* §12.1 (B-05): the two sessions compared, named by their served dates (§1.10). */}
      <span className="ov-since-label" title={data?.comparison_session && data.prev_session ? `the ${dayShort(data.comparison_session)} close against ${dayShort(data.prev_session)}` : undefined}>
        Since last close
      </span>
      {unserved ? (
        // §1.0.2: served awaiting, the line keeps its label and prints the reason.
        <span className="ov-since-item dk-unserved-inline">{unserved.reason}</span>
      ) : data ? (
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


/** "Above 50 & 200", from the served state (§2, §12.1); a mixed state reads its two flags. */
type TrendTile = NonNullable<OverviewTiles["trend"]>;
type RecessionTile = NonNullable<OverviewTiles["recession"]>;

export function trendWords(t: TrendTile): string {
  if (t.state === "above_both") return "Above 50 & 200";
  if (t.state === "below_both") return "Below 50 & 200";
  if (t.state === "mixed") return t.above_200 ? "Above 200, below 50" : t.above_50 ? "Above 50, below 200" : "Mixed";
  return "Unavailable";
}

/** The trend tile's sub-line (§2): "since <state_since> · last cross <golden|death>, <date>"; a missing part is left out. */
export function trendSub(tr: TrendTile): string {
  const since = dayLong(tr.state_since);
  const cross = tr.cross && dayLong(tr.cross.date) ? `last cross ${tr.cross.kind}, ${dayLong(tr.cross.date)}` : null;
  return [since ? `since ${since}` : null, cross].filter(Boolean).join(" · ");
}

/** The recession tile's sub-line (§2): "<band> · score for <probability_month> · inputs through <inputs_through>". */
export function recessionWords(r: RecessionTile): string {
  // A month and its year never part across lines.
  const scored = monthYear(r.probability_month).replace(" ", "\u00a0");
  const through = monthYear(r.inputs_through).replace(" ", "\u00a0");
  return [bandWord(r.band) || null, scored ? `score for ${scored}` : null, through ? `inputs through ${through}` : null].filter(Boolean).join(" · ");
}

type TileState = "ready" | "loading" | "awaiting";

function Tile({ label, state, badge, value, tone, sub, unserved }: { label: string; state: TileState; badge?: ReactNode; value?: ReactNode; tone?: string; sub?: ReactNode; unserved?: Unavailable | null }) {
  return (
    <section className="ov-tile" aria-label={label} aria-busy={state === "loading" && !unserved} data-unserved={unserved ? "" : undefined}>
      <div className="ov-tile-head">
        <span className="ov-tile-label">{label}</span>
        {unserved ? <NotServedBadge block={unserved} /> : state === "ready" ? badge : null}
      </div>
      {unserved ? (
        // §1.0.2: the tile keeps its label, prints the served reason, and no number.
        <UnservedLine block={unserved} className="ov-tile-unserved" />
      ) : state === "ready" ? (
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
  // Each tile is its own block (§12.1); the whole answer served awaiting makes every tile unavailable.
  const off = {
    regime: useBlockUnserved(data, "tiles.regime"),
    recession: useBlockUnserved(data, "tiles.recession"),
    trend: useBlockUnserved(data, "tiles.trend"),
    vol: useBlockUnserved(data, "tiles.vol"),
  };
  const state = (block: unknown): TileState => (block ? "ready" : failed || data ? "awaiting" : "loading");
  return (
    <div className="ov-tiles">
      <Tile
        label="Regime"
        unserved={off.regime}
        state={state(t?.regime)}
        badge={t?.regime ? <LiveBadge parts={[rowWords(t.regime.print) || null]} /> : null}
        value={t?.regime?.label}
        // §1.3's exception (v2 D-36): the tile carries its regime's color.
        tone={t?.regime ? REGIME_TONE[t.regime.label] : undefined}
        sub={t?.regime ? [t.regime.growth && t.regime.inflation ? `Growth ${t.regime.growth}, inflation ${t.regime.inflation}` : null, "rule-based, two-month lag"].filter(Boolean).join(" · ") : null}
      />
      <Tile label="Recession · logistic model" unserved={off.recession} state={state(t?.recession && fin(t.recession.score) ? t.recession : null)} badge={<LiveBadge />} value={t?.recession && fin(t.recession.score) ? pctPlain(t.recession.score) : null} sub={t?.recession ? recessionWords(t.recession) : null} />
      <Tile
        label="S&P 500 · trend"
        unserved={off.trend}
        state={state(t?.trend)}
        badge={t?.trend ? <LiveBadge parts={[dayShort(t.trend.date) || null]} /> : null}
        value={t?.trend ? trendWords(t.trend) : null}
        sub={t?.trend ? trendSub(t.trend) || null : null}
      />
      <Tile
        label="Vol · VIX"
        unserved={off.vol}
        state={state(fin(t?.vol?.vix) ? t.vol : null)}
        badge={t?.vol ? <LiveBadge parts={[dayShort(t.vol.date) || null]} /> : null}
        value={t?.vol && fin(t.vol.vix) ? num(t.vol.vix) : null}
        sub={
          t?.vol ? (
            <>
              {/* §2: "VIX <level> · <date> · <band>", then the gap to the S&P's 21-day realized volatility (desk/fill-compute). */}
              {[fin(t.vol.vix) ? `VIX ${num(t.vol.vix)}` : "VIX", dayShort(t.vol.date) || null, t.vol.band ?? null].filter(Boolean).join(" · ")}
              <span className="ov-vol-gap">{gapWords(t.vol)}</span>
            </>
          ) : null
        }
      />
    </div>
  );
}

/** §2: the VIX against the S&P's 21-day realized volatility, in VIX points, dated when its session is not the level's. */
export function gapWords(vol: NonNullable<OverviewTiles["vol"]>): string {
  const g = vol.gap;
  if (!g || !fin(g.gap_pts) || !fin(g.realized_21d)) return "No session has both the VIX and 21 S&P returns stored.";
  const side = g.gap_pts >= 0 ? "above" : "below";
  const on = g.date !== vol.date && dayShort(g.date) ? ` on ${dayShort(g.date)}` : "";
  return `${num(Math.abs(g.gap_pts))} pts ${side} 21-day realized (${num(g.realized_21d)})${on}`;
}

/** One active signal's sentence (§2). */
export function SignalSentence({ row }: { row: LedgerRow }) {
  const since = year(row.sample_start);
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return (
    <>
      {ok(row.n) ? (
        <>
          Fired <b>{row.n}×</b>
          {since ? ` since ${since}` : ""}
        </>
      ) : (
        "Times fired awaiting refresh"
      )}
      {ok(row.up_pct) ? (
        <>
          {" "}
          · S&amp;P up <b>{pctPlain(row.up_pct)}</b> of the time
        </>
      ) : null}
      {ok(row.median) && moveText(row.median, row.target_unit ?? undefined) ? (
        <>
          {" "}
          · <span className="dk-nowrap">20-day</span> median{" "}
          <Signed value={row.median} bold title={tipOf(row.target_unit ?? undefined)}>
            {moveText(row.median, row.target_unit ?? undefined)}
          </Signed>
          {/* The row's own excess over its own baseline (§1.9), never a universal normal month. */}
          {ok(row.vs_normal) && vsNormalText(row.vs_normal, row.target_unit ?? undefined) ? (
            <>
              {" "}(<span title={tipOf(row.target_unit ?? undefined)}>{vsNormalText(row.vs_normal, row.target_unit ?? undefined)}</span> vs normal)
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ActiveSignals({ data, failed, pathTo }: { data: OverviewResponse | undefined; failed: boolean; pathTo: (slug: string) => string }) {
  const rows = data?.active_signals;
  // Codex R-16: "nothing is firing" is said only when every row was read.
  const lost = droppedOf(data, "active_signals");
  const unserved = useUnserved();
  if (unserved) return <UnservedCard headingId="ov-active-title" className="ov-active" title="Active signals" sub="what fired, how it has played out before" block={unserved} />;
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
                <li key={r.slug} className="ov-signal" data-firing={(r.firing_now === true && r.stale === false) || undefined}>
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
          ) : lost ? null : (
            <p className="dk-await">Nothing is firing, and nothing has fired recently.</p>
          )
        ) : failed || data ? (
          <Awaiting />
        ) : null}
        <DroppedNote n={lost} />
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

/** §2: the rows of this browser's position store (§9), their room read from today's served levels. They
 * do not come from /overview, so they stay live when it is awaiting (§1.0). */
function Monitored({ pathTo }: { pathTo: (slug: string) => string }) {
  const navigate = useNavigate();
  const [store] = usePositionStore();
  const levels = useLevels(store);
  const now = new Date();
  const rows = store.positions.filter(isOpen).map((p) => viewOf(p, levels, now));
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
      <div className="dk-card-body">
        <MonitoredRows rows={rows} unreadable={store.unreadable.length} onOpen={(id) => navigate(withParam(pathTo("position-monitor"), "open", id))} />
        {rows.length ? <p className="ov-mon-note">{MONITORED_NOTE}</p> : null}
        {rows.length ? <DroppedNote n={store.unreadable.length} one="kept position" /> : null}
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
  // §12.0: a route served awaiting keeps the page's labels and prints its reason (§1.0.2).
  const unserved = unavailableOf(q.error);
  return (
    <div className="ov">
      <PageTitle page={page} />
      <Unserved block={unserved}>
        <SinceLine data={data?.since_last_close} failed={failed || (!!data && !data.since_last_close)} unserved={unserved ?? data?._blocks?.since_last_close ?? null} />
        <Tiles data={data} failed={failed} />
        <div className="ov-grid">
          <ActiveSignals data={data} failed={failed} pathTo={pathTo} />
          <Monitored pathTo={pathTo} />
        </div>
      </Unserved>
    </div>
  );
}
