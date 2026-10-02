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
import { bandWord, capitalize, dayLong, dayShort, etTime, isFiniteNumber as fin, monthLong, monthYear, num, numberWord, pctPlain, rowWords, year } from "../kit/format";
import { Awaiting, DroppedNote, LiveBadge, NotServedBadge, Signed, StampBadge, Unserved, UnservedCard, UnservedLine, useBlockUnserved, useUnserved, VerdictPill, LoadingLine, FailedLine, FailedScope, useLoadFailed } from "../kit/ui";
import { useQuotes } from "../../../live/quotes";
import { vixShown, type VixShown } from "../../shared/vix-shown";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import MonitoredRows from "../kit/MonitoredRows";
import { REGIME_TONE } from "../kit/palette";
import { viewOf } from "../positions/monitor";
import { isOpen } from "../positions/store";
import { useLevels, usePositionStore } from "../positions/usePositionStore";
import { moveText, tipOf, vsNormalText } from "../kit/units";
import "./overview.css";
import { Term, defineTerms } from "../kit/Term";

/** The since-last-close items (§2), in the spec's order, each a phrase of its own that starts with a capital
 * (desk/pdf-polish item 2b). A vol change that rounds to 0.0 reads "unchanged". The regime and the refresh are
 * one item, the owner's: "Regime changed → <label> (Data refreshed <h:mm AM/PM> ET)", "Regime unchanged (Data
 * refreshed …)"; either part not served is left out, and the refresh stands alone without the regime. */
export function sinceItems(s: SinceLastClose): { key: string; text: string; tag?: string }[] {
  const out: { key: string; text: string; tag?: string }[] = [];
  // §2, §12.1: each new fire with (new); each signal still firing with its `firing_day`.
  for (const f of s.new_fires ?? []) out.push({ key: `new-${f.slug}`, text: capitalize(`${f.short || f.label} fired`), tag: "(new)" });
  for (const f of s.still_firing ?? []) out.push({ key: `still-${f.slug}`, text: capitalize(`${f.short || f.label} still firing${fin(f.firing_day) ? `, day ${f.firing_day}` : ""}`) });
  // Codex R-16: a fire the boundary could not read is said, never left out as if nothing fired.
  const lostFires = droppedOf(s, "new_fires") + droppedOf(s, "still_firing");
  if (lostFires) out.push({ key: "lost", text: `${lostFires} ${lostFires === 1 ? "fire" : "fires"} could not be read` });
  const v = s.vol_change_pts;
  if (fin(v)) {
    const dir = v >= 0.05 ? "up" : v <= -0.05 ? "down" : "unchanged";
    out.push({ key: "vol", text: `Vol ${dir}${dir === "unchanged" ? "" : ` ${Math.abs(v).toFixed(1)} pts`}` });
  }
  // Whether the regime changed is said only when it was served (Codex G1-9); every Desk time is New York's.
  const regime = s.regime_changed === true ? (s.regime_to ? `Regime changed → ${s.regime_to}` : "Regime changed") : s.regime_changed === false ? "Regime unchanged" : null;
  const at = etTime(s.refreshed_at_utc);
  if (regime) out.push({ key: "regime", text: at ? `${regime} (Data refreshed ${at})` : regime });
  else if (at) out.push({ key: "refresh", text: `Data refreshed ${at}` });
  // fix/freshness 3d: the refresh time is the last run's; a series that run left behind is named on its own.
  const b = s.oldest_behind;
  if (b && b.series) out.push({ key: "behind", text: b.observation_date && dayShort(b.observation_date) ? `${b.series} behind, through ${dayShort(b.observation_date)}` : `${b.series} not stored` });
  return out;
}

function SinceLine({ data, failed, unserved }: { data: SinceLastClose | undefined; failed: boolean; unserved: Unavailable | null }) {
  const loadFailed = useLoadFailed();
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
      ) : loadFailed ? (
        // §14.12: the request failed; the line says so, with Retry.
        <FailedLine inline className="ov-since-item" />
      ) : !data && !failed ? (
        // §14.10: a pending answer says so.
        <span className="ov-since-item dk-loading" role="status" data-testid="dk-loading">
          Loading live data…
        </span>
      ) : failed ? (
        <span className="ov-since-item" style={{ color: "var(--dk-t3)" }}>
          Awaiting refresh
        </span>
      ) : null}
    </div>
  );
}


/** The regime tile's sub-line: the two directions only, "Growth rising, inflation rising" (desk/pdf-polish item 2c:
 * no odds, no "rule-based"); nothing when either is not served. */
export function regimeSub(r: NonNullable<OverviewTiles["regime"]>): string {
  return r.growth && r.inflation ? `Growth ${r.growth}, inflation ${r.inflation}` : "";
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

/** "2026-06" and "2026-09" → 3: the calendar months from the first to the second; null unless both are months. */
export function monthsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = typeof from === "string" ? /^(\d{4})-(\d{2})/.exec(from) : null;
  const b = typeof to === "string" ? /^(\d{4})-(\d{2})/.exec(to) : null;
  if (!a || !b) return null;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/** "based on Jun 2026 data": the month the scored inputs come from, as the Recession tab's chip names it
 * ("Inputs through Jun 2026"); "" when it is not served. A month and its year never part across lines. */
function basedOn(r: RecessionTile): string {
  const through = monthYear(r.inputs_through).replace(" ", "\u00a0");
  return through ? `based on ${through} data` : "";
}

/** The recession tile's sub-line (desk/pdf-polish item 2d): "<band> · based on <inputs_through> data". */
export function recessionWords(r: RecessionTile): string {
  return [bandWord(r.band) || null, basedOn(r) || null].filter(Boolean).join(" · ");
}

/** The hover on "based on <month> data" (item 2d), both months and the gap read from the served answer, never
 * typed: "The recession model reads data from three months earlier, so September's score uses June's readings."
 * The recession tab says the same: "scored from inputs three months old". Null unless both months are served
 * and the inputs come first. */
export function recessionLag(r: RecessionTile): string | null {
  const gap = monthsBetween(r.inputs_through, r.probability_month);
  const scored = monthLong(r.probability_month);
  const inputs = monthLong(r.inputs_through);
  if (gap == null || gap < 1 || !scored || !inputs) return null;
  return `The recession model reads data from ${numberWord(gap)} month${gap === 1 ? "" : "s"} earlier, so ${scored}'s score uses ${inputs}'s readings.`;
}

/** The recession tile's sub-line, its month carrying the hover (item 2d). */
function RecessionSub({ r }: { r: RecessionTile }) {
  const band = bandWord(r.band);
  const based = basedOn(r);
  const lag = recessionLag(r);
  return (
    <>
      {band}
      {band && based ? " · " : null}
      {based ? lag ? <Term def={lag}>{based}</Term> : based : null}
    </>
  );
}

type TileState = "ready" | "loading" | "awaiting";

function Tile({ label, state, badge, value, tone, sub, unserved }: { label: string; state: TileState; badge?: ReactNode; value?: ReactNode; tone?: string; sub?: ReactNode; unserved?: Unavailable | null }) {
  return (
    <section className="ov-tile" aria-label={label} aria-busy={state === "loading" && !unserved} data-unserved={unserved ? "" : undefined}>
      <div className="ov-tile-head">
        <span className="ov-tile-label">{defineTerms(label)}</span>
        {unserved ? <NotServedBadge block={unserved} /> : state === "ready" ? badge : null}
      </div>
      <LoadingLine busy={state === "loading" && !unserved} />
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
  // fix/freshness 3c: the VIX the Markets tape shows (one quote store), else the stored close (^VIX, served);
  // shared/vix-shown.ts, the same code the Dashboard's VIX card runs (item 7).
  const quotes = useQuotes();
  const vix = vixShown(t?.vol, quotes.get("VIX"));
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
        // fix/freshness 3a (D2): the newest stored row, the label and month the Dashboard shows; desk/pdf-polish 2c:
        // under it only the two directions.
        sub={t?.regime ? regimeSub(t.regime) || null : null}
      />
      <Tile label="Recession · logistic model" unserved={off.recession} state={state(t?.recession && fin(t.recession.score) ? t.recession : null)} badge={<LiveBadge />} value={t?.recession && fin(t.recession.score) ? pctPlain(t.recession.score, 1) : null} sub={t?.recession ? <RecessionSub r={t.recession} /> : null} />
      <Tile
        label="S&P 500 · trend"
        unserved={off.trend}
        state={state(t?.trend)}
        // fix/freshness 3c: the trend reads daily closes, so its badge is the close's date, never Live.
        badge={t?.trend ? <StampBadge text={`Close · ${dayShort(t.trend.date)}`} /> : null}
        value={t?.trend ? trendWords(t.trend) : null}
        sub={t?.trend ? trendSub(t.trend) || null : null}
      />
      <Tile
        label="Vol · VIX"
        // A live quote stands on its own when /overview's vol block is not served; the close needs the block.
        unserved={vix?.source === "quote" ? null : off.vol}
        state={state(vix)}
        badge={vix ? vix.live ? <LiveBadge parts={[vix.stamp]} /> : <StampBadge text={vix.stamp} /> : null}
        value={vix ? vix.text : null}
        sub={
          vix ? (
            <>
              {/* §2: "VIX <level> · <stamp>" (desk/pdf-polish 2e: no band word), then the gap to the S&P's 21-day
                  realized volatility, against the VIX shown. */}
              {[`VIX ${vix.text}`, vix.source === "quote" ? null : dayShort(vix.date) || null].filter(Boolean).join(" · ")}
              <span className="ov-vol-gap">{gapWords(vix)}</span>
            </>
          ) : null
        }
      />
    </div>
  );
}

/** §2: the VIX shown against the S&P's 21-day realized volatility, in VIX points (fix/freshness 3c: recomputed against
 * the VIX on the tile); the realized figure's session is named when it is not the VIX's. */
export function gapWords(v: Pick<VixShown, "gapPts" | "realized" | "realizedDate" | "date">): string {
  if (!fin(v.gapPts) || !fin(v.realized)) return "No session has both the VIX and 21 S&P returns stored.";
  const side = v.gapPts >= 0 ? "above" : "below";
  const on = v.realizedDate && v.realizedDate !== v.date && dayShort(v.realizedDate) ? `, realized to ${dayShort(v.realizedDate)}` : "";
  return `${num(Math.abs(v.gapPts))} pts ${side} 21-day realized (${num(v.realized)})${on}`;
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
              {" "}(<span title={tipOf(row.target_unit ?? undefined)}>{vsNormalText(row.vs_normal, row.target_unit ?? undefined)}</span> <Term ids={["baseline"]}>vs normal</Term>)
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
  if (unserved) return <UnservedCard headingId="ov-active-title" className="ov-active" title="Active signals" block={unserved} />;
  // desk/pdf-polish 2f: the small text is the engine's date; each row keeps its own start year.
  const through = data ? dayShort(data.as_of) : "";
  return (
    <section className="dk-card ov-active" aria-labelledby="ov-active-title">
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="ov-active-title">
          Active signals
          {through ? (
            <span className="dk-card-sub" data-mono>
              backtested through {through}
            </span>
          ) : null}
        </h2>
      </div>
      <div className="dk-card-body" aria-busy={!data && !failed}>
        <LoadingLine busy={!data && !failed} />
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
  // fix/freshness 6: with nothing kept (and nothing unreadable) the card is one compact line with its link, not a
  // tall empty panel stretched to the signals' height.
  if (!rows.length && !store.unreadable.length) {
    return (
      <section className="dk-card ov-monitored ov-monitored-empty" aria-labelledby="ov-mon-title" data-empty="">
        <h2 className="dk-card-title" id="ov-mon-title">
          Monitored
        </h2>
        <p className="ov-mon-empty">
          No positions are monitored in this browser.{" "}
          <Link className="dk-link" to={pathTo("position-monitor")}>
            Add one in Position Monitor →
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className="dk-card ov-monitored" aria-labelledby="ov-mon-title">
      <div className="dk-card-head">
        <h2 className="dk-card-title" id="ov-mon-title">
          Monitored
          <span className="dk-card-sub" data-mono>
            your positions vs. their exit levels
          </span>
        </h2>
      </div>
      <div className="dk-card-body">
        <MonitoredRows rows={rows} unreadable={store.unreadable.length} onOpen={(id) => navigate(withParam(pathTo("position-monitor"), "open", id))} />
        {rows.length ? <p className="ov-mon-note">{MONITORED_NOTE}</p> : null}
        {rows.length ? <DroppedNote n={store.unreadable.length} one="kept position" /> : null}
        <div className="ov-mon-act">
          {/* §14.6: the page's one primary action is the header's; this one is secondary. */}
          <Link className="dk-btn" to={pathTo("position-monitor")}>
            Act on this → Position Monitor
          </Link>
        </div>
      </div>
    </section>
  );
}

/** desk/usability §14.7: the order to walk the Desk in, one short phrase a step. */
export const START_HERE: readonly { slug: string; label: string; phrase: string }[] = [
  { slug: "overview", label: "Overview", phrase: "read the market" },
  { slug: "basket-hedge", label: "Basket & Hedge", phrase: "build the exposure" },
  { slug: "technicals", label: "Technicals", phrase: "check the trend" },
  { slug: "event-study", label: "Event Study", phrase: "test the idea" },
];

/** §14.7: "Start here", four numbered links in the order to walk the Desk. */
function StartHere({ pathTo }: { pathTo: (slug: string) => string }) {
  return (
    <nav className="ov-start" aria-label="Start here" data-testid="ov-start">
      <span className="ov-start-label">Start here</span>
      <ol>
        {START_HERE.map((s, i) => (
          <li key={s.slug}>
            <Link to={pathTo(s.slug)} aria-current={s.slug === "overview" ? "page" : undefined}>
              <b className="ov-start-n">{i + 1}</b> {s.label}
              <span className="ov-start-phrase"> · {s.phrase}</span>
            </Link>
            {i < START_HERE.length - 1 ? (
              <span className="ov-start-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
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
      {/* desk/pdf-polish 2a: no line under the title on Overview (the page keeps its purpose line for the
          sidebar's data; it is not printed here). */}
      <PageTitle page={{ ...page, blurb: "" }} />
      <StartHere pathTo={pathTo} />
      <Unserved block={unserved}>
        {/* §14.12: the line, the tiles and the active signals read /overview; the monitored rows read this browser's store. */}
        <FailedScope q={q}>
          <SinceLine data={data?.since_last_close} failed={failed || (!!data && !data.since_last_close)} unserved={unserved ?? data?._blocks?.since_last_close ?? null} />
          <Tiles data={data} failed={failed} />
        </FailedScope>
        <div className="ov-grid">
          <FailedScope q={q}>
            <ActiveSignals data={data} failed={failed} pathTo={pathTo} />
          </FailedScope>
          <Monitored pathTo={pathTo} />
        </div>
      </Unserved>
    </div>
  );
}
