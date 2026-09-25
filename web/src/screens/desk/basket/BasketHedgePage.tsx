/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10, screens/09-basket-hedge.png): build
 * the exposure, then price the cheapest way to own it. Two columns.
 *
 * Basket: a basket the server keeps (`?basket=`, GET /basket/:id) or one
 * saved in this browser, its legs as typed weights (Equal-weight, Normalize
 * to 100%, × to drop, a ticker to add), priced by POST /basket/price while
 * the weights differ from the served ones; the stats row, the residual chart
 * (basket minus beta × its benchmark, the dashed line where the position
 * comes off) and the served reads. Save basket keeps the weights in this
 * browser (a served basket keeps its name; Revert forgets the weights), and
 * the hedge on the right re-prices from them. Export / Import JSON move the
 * saved baskets, as Event Study moves its saved questions (§1.8).
 *
 * Hedge: three modes (`?mode=`), the three structures GET /hedge serves for
 * the subject (the saved basket, a position from Position Monitor with
 * `?position=`, or for "Express the S&P lean" the study carried in from
 * Event Study, else the last one it answered, else the gold preset); the
 * picked structure's ratio, carry and roll, its month of scenarios, and the
 * served reads. Nothing is priced on the page: every number is served, and
 * "Awaiting refresh" is only ever an answer that did not come (§1.7).
 */

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { DeskApiError, useBasket, useBasketPrice, useHedge, type Params } from "../data/api";
import type { BasketPriced, BasketResponse, HedgeMode, HedgeOption, HedgeResponse } from "../data/types";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { apiParams, askFromSearch, readLastStudy, type Ask } from "../event-study/question";
import { dayShort, endDay, num, pct, pctPlain } from "../kit/format";
import LineChart, { useWidth } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import { AdvancedPanel, Awaiting, Card, LiveBadge, ReadBox, Signed, Stat, StatRow, cx, useAdvanced } from "../kit/ui";
import {
  DEFAULT_BASKET,
  apiLegs,
  equalWeight,
  exportSaved,
  importSaved,
  legsKey,
  newBasketId,
  normalize,
  parseTicker,
  parseWeight,
  readSaved,
  removeSaved,
  toWork,
  sumsToHundred,
  totalText,
  writeAllSaved,
  writeSaved,
  type SaveResult,
  type SavedBasket,
  type WorkLeg,
} from "./weights";
import "./basket.css";

export const MODES: { id: HedgeMode; label: string }[] = [
  { id: "protect", label: "Protect the basket" },
  { id: "express", label: "Express the S&P lean" },
  { id: "neutralize", label: "Neutralize NDX beta" },
];

const CHART_H = 165;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** A total of typed weights: "100%", "96.5%". */
/** A total as printed: its exact digits ("100%", "96.5%", "99.97%", "99.99999%"), so the words never
 * say 100% of weights that do not add to it (Codex R-14). */
const totalWords = (t: string) => `${t}%`;
/** A served basket or price we can read: legs as a list of legs, each a ticker and a finite weight. */
const readable = <T extends { legs?: unknown }>(d: T | undefined): T | undefined =>
  d && Array.isArray(d.legs) && d.legs.every((l) => !!l && typeof (l as { symbol?: unknown }).symbol === "string" && fin((l as { weight?: unknown }).weight)) ? d : undefined;
/** Why a save did not happen, in the reader's words. */
const STORAGE_WORDS: Record<Exclude<SaveResult, "ok">, string> = {
  off: "This browser does not keep baskets (storage is off); nothing was saved.",
  full: "This browser's storage is full; nothing was saved.",
};

/** A value that settles `ms` after its last change. */
function useSettled<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The chart's question and the residual over the served window (§10). */
function ResidualChart({ p, short }: { p: BasketPriced; short: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const s = Array.isArray(p.series) ? p.series.filter((x): x is { date: string; value: number } => !!x && fin(x.value)) : [];
  const f = fin(p.falsifies_at) ? p.falsifies_at * 100 : null;
  const bench = p.benchmark?.label ?? "the benchmark";
  if (!s.length) return <Awaiting>the residual's recent sessions</Awaiting>;
  const vals = s.map((x) => x.value * 100);
  const top = Math.max(4, Math.ceil(Math.max(...vals, 0)));
  const hi = top + 0.4;
  // The falsification band runs 1.45 points under the line, the PNG's depth, so its label sits inside it.
  const lo = Math.min(f ?? 0, Math.floor(Math.min(...vals))) - 1.45;
  const last = vals[vals.length - 1];
  const ticks = [top, 0, ...(f != null ? [f] : [])].map((v) => ({ v, text: v === 0 ? "0" : pct(v / 100, 0) }));
  // A narrow chart takes the short labels, one line each.
  const narrow = width < 520;
  const beta = fin(p.beta) ? `${num(p.beta)} × ` : "";
  return (
    <div ref={ref} className="bh-chart">
      <LineChart
        ariaLabel={`${short} basket minus ${beta}${bench}, the last ${s.length} sessions, now ${pct(last / 100)}${f != null ? `; the position comes off at ${pct(f / 100, 0)}` : ""}`}
        height={CHART_H}
        n={s.length}
        yDomain={[lo, hi]}
        yTicks={ticks}
        grid={false}
        zero
        pad={{ l: 52, r: 24, t: 8, b: 24 }}
        bands={[
          { from: 0, to: hi, fill: "rgba(38, 220, 160, 0.08)", label: narrow ? `above the line · paying beyond ${bench} beta` : `above the line · the bet is paying beyond ${bench} beta`, labelColor: DESK_ACCENTS.green },
          ...(f != null ? [{ from: lo, to: f, fill: "rgba(232, 180, 71, 0.10)", label: narrow ? `the position comes off · ${pct(f / 100, 0)}` : `at the dashed line the position comes off · ${pct(f / 100, 0)}`, labelColor: DESK_ACCENTS.amber }] : []),
        ]}
        series={[
          ...(f != null ? [{ key: "line", values: s.map(() => f), color: DESK_ACCENTS.amber, width: 1.5, dash: "6 5" }] : []),
          { key: "res", values: vals, color: DESK_ACCENTS.blue, width: 2 },
        ]}
        endDot="res"
        pointLabels={[{ i: s.length - 1, v: last, text: pct(last / 100), anchor: "end", avoid: true }]}
        xEnds={[`${s.length} sessions ago`, endDay(s[s.length - 1].date)]}
      />
    </div>
  );
}

type Show = "value" | "quiet" | "awaiting";

function BasketStats({ p, show }: { p: BasketPriced | undefined; show: Show }) {
  const b = p?.benchmark?.symbol ?? "NDX";
  const labels = ["3-month", `vs ${b} · residual`, "Basket vol"];
  // Quiet: the labels alone, while an answer is on its way or the weights cannot be priced yet.
  if (show !== "value" || !p)
    return (
      <StatRow cols={3}>
        {labels.map((l) => (
          <Stat key={l} label={l} awaiting={show === "awaiting"} />
        ))}
      </StatRow>
    );
  return (
    <StatRow cols={3}>
      {fin(p.ret_3m) ? <Stat label={labels[0]} value={<Signed value={p.ret_3m}>{pct(p.ret_3m)}</Signed>} sub={fin(p.bench_ret_3m) ? `vs ${b} ${pct(p.bench_ret_3m)}` : undefined} size="sm" /> : <Stat label={labels[0]} awaiting />}
      {fin(p.residual) ? (
        <Stat
          label={labels[1]}
          value={<Signed value={p.residual}>{pct(p.residual)}</Signed>}
          sub={[fin(p.residual_window) ? `last ${p.residual_window} sessions` : null, fin(p.falsifies_at) ? `falsifies at ${pct(p.falsifies_at, 0)}` : null].filter(Boolean).join(" · ") || undefined}
          size="sm"
        />
      ) : (
        <Stat label={labels[1]} awaiting />
      )}
      {fin(p.vol) ? (
        <Stat label={labels[2]} value={pctPlain(p.vol)} sub={[fin(p.bench_vol) ? `vs ${b} ${pctPlain(p.bench_vol)}` : null, fin(p.vol_ratio) ? `${num(p.vol_ratio)}× as jumpy` : null].filter(Boolean).join(" · ") || undefined} size="sm" />
      ) : (
        <Stat label={labels[2]} awaiting />
      )}
    </StatRow>
  );
}

function Legs({ legs, onChange, empty }: { legs: WorkLeg[] | null; onChange: (legs: WorkLeg[]) => void; empty: ReactNode }) {
  const uid = useId();
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const tot = legs ? totalText(legs) : null;
  const add = () => {
    const t = parseTicker(ticker);
    if (!legs) return;
    if (!t) return setNote(ticker.trim() ? `“${ticker.trim()}” is not a ticker.` : "");
    if (legs.some((l) => l.symbol === t)) return setNote(`${t} is already in the basket.`);
    onChange([...legs, { symbol: t, name: null, weight: "0" }]);
    setTicker("");
    setNote(`${t} added at 0%: type its weight.`);
  };
  return (
    <div className="bh-legs">
      <div className="bh-legs-head">
        <p>
          <span className="dk-stat-label">Legs</span> <span className="bh-hint">type a weight, or × to drop a name</span>
        </p>
        <div className="bh-legs-tools">
          <button type="button" className="dk-btn" disabled={!legs?.length} onClick={() => legs && onChange(equalWeight(legs))}>
            Equal-weight
          </button>
          <button type="button" className="dk-btn" disabled={!legs?.length} onClick={() => legs && onChange(normalize(legs))}>
            Normalize to 100%
          </button>
        </div>
      </div>
      {legs ? (
        <table className="bh-table">
          <caption className="dk-sr">The basket's legs and their weights</caption>
          <thead className="dk-sr">
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col">Name</th>
              <th scope="col">Weight</th>
              <th scope="col">Drop</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l, i) => {
              const bad = parseWeight(l.weight) == null;
              return (
                <tr key={l.symbol}>
                  <td className="bh-sym">{l.symbol}</td>
                  <td className="bh-name">{l.name ?? "—"}</td>
                  <td className="bh-w">
                    <input
                      className="bh-input"
                      inputMode="decimal"
                      aria-label={`Weight of ${l.symbol}, percent`}
                      aria-invalid={bad || undefined}
                      value={l.weight}
                      onChange={(e) => onChange(legs.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                    />
                    <span aria-hidden="true">%</span>
                  </td>
                  <td className="bh-x">
                    <button type="button" className="bh-drop" aria-label={`Drop ${l.symbol}`} onClick={() => onChange(legs.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        empty
      )}
      <div className="bh-add-row">
        <form
          className="bh-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label htmlFor={`${uid}-t`} className="bh-add-plus" aria-hidden="true">
            +
          </label>
          <input id={`${uid}-t`} className="bh-add-input" placeholder="Add a ticker…" aria-label="Add a ticker" value={ticker} disabled={!legs} onChange={(e) => setTicker(e.target.value)} autoComplete="off" />
          <span className="bh-add-hint">any US-listed name · price history pulled on add</span>
        </form>
        <p className="bh-total">
          total <b data-off={tot !== "100" || undefined}>{tot == null ? "—" : totalWords(tot)}</b>
        </p>
      </div>
      <p className="bh-note" role="status">
        {note}
      </p>
    </div>
  );
}

/** Why a set of weights has no price, from the pricing answer. */
function priceWords(err: unknown): string {
  if (err instanceof DeskApiError && !err.unreadable) return err.status >= 400 && err.status < 500 ? "The pricing service has no price for these weights." : "The pricing service did not answer for these weights.";
  // An answer that arrived but was not the shape (or not JSON at all).
  return "The pricing service's answer could not be read.";
}

function BasketCard({ basketId, onSelect, onSaved }: { basketId: string; onSelect: (id: string) => void; onSaved: () => void }) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [saved, setSaved] = useState<SavedBasket[]>(() => readSaved());
  // A save in another window of this browser reaches this card too.
  useEffect(() => {
    const onStorage = () => setSaved(readSaved());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const servedId = !basketId.startsWith("local-");
  // The server's baskets for the selector come with the default basket, whichever basket is open.
  const list = useBasket(DEFAULT_BASKET);
  const local = saved.find((b) => b.id === basketId) ?? null;
  const served = useBasket(basketId, { enabled: servedId });
  const sb: BasketResponse | undefined = served.isError ? undefined : readable(served.data);
  const servedBad = servedId && (served.isError || (served.isSuccess && !sb));
  const base = useMemo(() => (local ? toWork(local.legs) : sb ? toWork(sb.legs) : null), [local, sb]);
  const [work, setWork] = useState<WorkLeg[] | null>(null);
  const [status, setStatus] = useState("");
  // Another basket starts from its own saved (or served) legs, with nothing said yet.
  useEffect(() => {
    setWork(null);
    setStatus("");
  }, [basketId]);
  const legs = work ?? base;
  const key = legs ? legsKey(apiLegs(legs)) : "";
  const baseKey = base ? legsKey(apiLegs(base)) : "";
  const servedKey = sb ? legsKey(sb.legs) : null;
  const tot = legs ? totalText(legs) : null;
  const priceable = !!legs?.length && tot === "100";
  // The served numbers answer the served weights; any other weights are priced by POST /basket/price.
  const needPrice = !!legs && key !== servedKey;
  const settled = useSettled(needPrice && priceable ? key : null);
  const asking = !!legs && settled === key && needPrice && priceable;
  const priced = useBasketPrice(asking && legs ? apiLegs(legs) : null);
  const pricedOk = priced.isError ? undefined : readable(priced.data);
  const pricedBad = asking && (priced.isError || (priced.isSuccess && !pricedOk));
  const p: BasketPriced | undefined = !legs ? undefined : !needPrice ? sb : asking ? pricedOk : undefined;
  const show: Show = p ? "value" : servedBad && !local ? "awaiting" : pricedBad ? "awaiting" : "quiet";
  // Names the price answer resolved fill the rows that have none (a ticker just added).
  useEffect(() => {
    if (!pricedOk || !work) return;
    const names = new Map(pricedOk.legs.map((l) => [l.symbol, typeof l.name === "string" ? l.name : null]));
    if (work.some((l) => l.name == null && names.get(l.symbol))) setWork(work.map((l) => (l.name == null ? { ...l, name: names.get(l.symbol) ?? null } : l)));
  }, [pricedOk, work]);
  const dirty = !!work && key !== baseKey;
  // A served basket keeps the server's name, short name and rebalance rule, whatever weights this browser keeps for it.
  const name = sb?.name ?? local?.name ?? null;
  const short = sb?.short ?? local?.name ?? null;
  const override = servedId && !!local;
  const listed = [sb?.baskets, list.data?.baskets].find((x) => Array.isArray(x)) ?? [];
  const servedList = listed.filter((x) => x && typeof x.id === "string" && typeof x.name === "string");
  const options = [...servedList, ...saved.filter((b) => !servedList.some((x) => x.id === b.id)).map((b) => ({ id: b.id, name: b.name }))];
  if (!options.some((o) => o.id === basketId)) options.unshift({ id: basketId, name: name ?? (servedId && served.isLoading ? "Loading…" : "Unnamed basket") });
  const adv = useAdvanced();
  const refresh = () => {
    setSaved(readSaved());
    onSaved();
  };
  const save = () => {
    if (!legs) return;
    if (!legs.length) return setStatus("Add a ticker to save the basket.");
    if (!priceable) return setStatus(tot == null ? "A weight is not a number; fix it to save." : `The weights add to ${totalWords(tot)}; normalize them to 100% to save.`);
    const b: SavedBasket = { id: basketId, name: name ?? "Unnamed basket", legs: apiLegs(legs).map((l) => ({ ...l, name: legs.find((x) => x.symbol === l.symbol)?.name ?? null })), saved_at: new Date().toISOString() };
    const r = writeSaved(b);
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    refresh();
    setWork(null);
    setStatus("Saved in this browser. The hedge on the right now prices these weights.");
  };
  const revert = () => {
    const r = removeSaved(basketId);
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    refresh();
    setWork(null);
    setStatus("Back to the served weights.");
  };
  const remove = () => {
    const r = removeSaved(basketId);
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    refresh();
    onSelect(DEFAULT_BASKET);
  };
  const newBasket = () => {
    // Typed weights are the analyst's work: starting another basket never drops them unseen.
    if (dirty) return setStatus("This basket has unsaved weights: save them, or put them back, before starting another.");
    // An empty basket already waiting (this one, or another) is reused, so the list does not fill with empties.
    const empty = saved.find((b) => b.id.startsWith("local-") && !b.legs.length && !(b.id === basketId && legs?.length));
    if (empty) {
      if (empty.id === basketId) setStatus("This basket is empty: add a ticker to start it.");
      return onSelect(empty.id);
    }
    const id = newBasketId(saved);
    const r = writeSaved({ id, name: `New basket ${id.slice(6)}`, legs: [], saved_at: new Date().toISOString() });
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    refresh();
    onSelect(id);
  };
  const download = () => {
    const blob = new Blob([exportSaved(saved)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "desk-saved-baskets.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = importSaved(saved, await f.text(), servedList.map((x) => x.id).concat(DEFAULT_BASKET));
    const w = writeAllSaved(r.list);
    if (w !== "ok") return setStatus(STORAGE_WORDS[w]);
    refresh();
    setStatus(
      `Imported ${r.added} basket${r.added === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} already here` : ""}${r.renumbered ? `; ${r.renumbered} given a new number, so no basket here was replaced` : ""}${r.rejected ? `; ${r.rejected} not readable` : ""}.`,
    );
  };
  const empty = servedBad && !local ? <Awaiting>the basket's legs</Awaiting> : !servedId && !local ? <p className="bh-why">This basket is not saved in this browser; pick another above or start a new one.</p> : null;
  return (
    <Card
      className="bh-card bh-basket"
      title="Basket"
      headExtra={
        <div className="bh-head-extra">
          <label className="dk-sr" htmlFor={`${uid}-sel`}>
            Basket
          </label>
          <span className="dk-select bh-select">
            <select id={`${uid}-sel`} value={basketId} onChange={(e) => onSelect(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </span>
          <span className="bh-meta">{[legs ? `${legs.length} names` : null, sb?.rebalance ? `rebalanced ${sb.rebalance}` : null, override ? "your weights, saved in this browser" : !servedId && local ? "saved in this browser" : null].filter(Boolean).join(" · ")}</span>
          <button type="button" className="dk-link bh-new" onClick={newBasket}>
            + New basket
          </button>
        </div>
      }
      footer={
        <div className="bh-foot">
          <div className="bh-save">
            <button type="button" className="dk-btn" data-kind="light" onClick={save} disabled={!legs}>
              Save basket
            </button>
            <span className="bh-save-hint">{dirty ? "unsaved weights · saving re-prices the hedge on the right" : "changes re-price the hedge on the right"}</span>
          </div>
          <AdvancedPanel adv={adv} items="rebalance rule · index since inception · export" missing="The API serves the basket's legs, its recent sessions against its benchmark and the stats above; the rebalance rule and the index since inception are not served yet.">
            <p className="bh-adv-row">
              <button type="button" className="dk-link" onClick={download} disabled={!saved.length}>
                Export saved baskets (JSON)
              </button>
              {" · "}
              <button type="button" className="dk-link" onClick={() => fileRef.current?.click()}>
                Import JSON
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} aria-label="Import saved baskets" />
              {override ? (
                <>
                  {" · "}
                  <button type="button" className="dk-link" onClick={revert}>
                    Revert to the served weights
                  </button>
                </>
              ) : null}
              {!servedId && local ? (
                <>
                  {" · "}
                  <button type="button" className="dk-link" onClick={remove}>
                    Delete this basket
                  </button>
                </>
              ) : null}
            </p>
          </AdvancedPanel>
        </div>
      }
    >
      <div aria-busy={(show === "quiet" && !!legs && needPrice && priceable) || undefined}>
        <BasketStats p={p} show={show} />
        {legs && !legs.length ? <p className="bh-why">Add a ticker to price the basket.</p> : null}
        {needPrice && !priceable && legs?.length ? <p className="bh-why">{tot == null ? "A weight is not a number: fix it to price the basket." : `The weights add to ${totalWords(tot)}: normalize to 100% to price them.`}</p> : null}
        {pricedBad ? <p className="bh-why">{priceWords(priced.isError ? priced.error : "unreadable")}</p> : null}
      </div>
      <Legs key={basketId} legs={legs} onChange={(l) => setWork(l)} empty={empty} />
      <p className="bh-chart-title">
        {`Is the ${short ? `${short} ` : ""}bet working?`}
        {p && fin(p.beta) ? ` · basket minus ${num(p.beta)} × ${p.benchmark?.label ?? "its benchmark"}${fin(p.residual_window) ? `, last ${p.residual_window} sessions` : ""}` : ""}
      </p>
      {p ? <ResidualChart p={p} short={short ?? "The"} /> : show === "awaiting" ? <Awaiting>the residual against its benchmark</Awaiting> : <div className="bh-chart-quiet" style={{ height: CHART_H }} aria-hidden="true" />}
      {p?.reads?.chart?.text ? <p className="bh-sentence">{p.reads.chart.text}</p> : null}
      {p?.reads?.beta?.text ? (
        <ReadBox className="bh-beta" label={p.reads.beta.label} warn={p.reads.beta.tone === "warning"}>
          {p.reads.beta.text}
        </ReadBox>
      ) : null}
      <p className="bh-status" role="status">
        {status}
      </p>
    </Card>
  );
}

/** The structure's worst outcome over its own range, per $100 of basket (§12.13, Codex R-06),
 * with the range and what bounds it: "max loss $14.0 per $100 of basket, NDX −5% to −10%
 * (its strikes)"; a structure with no sold put is bounded by the table's lowest move. A loss
 * without its range, or its basis, says nothing it cannot back. */
export function maxLossWords(o: Pick<HedgeOption, "max_loss" | "protected_range">): string | null {
  const r = o.protected_range;
  if (!fin(o.max_loss)) return null;
  if (!r || !fin(r.ndx_from) || !fin(r.ndx_to) || !r.basis) return "max loss awaiting refresh";
  const range = `NDX ${pct(r.ndx_from, 0)} to ${pct(r.ndx_to, 0)} (${r.basis === "strikes" ? "its strikes" : "table floor"})`;
  return o.max_loss < 0 ? `max loss $${num(-o.max_loss * 100, 1)} per $100 of basket, ${range}` : `no loss from ${range}`;
}

function OptionRow({ o, picked, name, onPick }: { o: HedgeOption; picked: boolean; name: string; onPick: () => void }) {
  const noteId = useId();
  const cost = fin(o.cost_pct) ? `costs ${pctPlain(o.cost_pct, 1)}${picked ? " of basket" : ""}` : null;
  const sub = [fin(o.breakeven) ? `breaks even at basket ${pct(o.breakeven)}` : null, maxLossWords(o)].filter(Boolean).join(" · ");
  return (
    <label className={cx("bh-opt", picked && "bh-opt-on")}>
      <input type="radio" className="dk-sr" name={name} checked={picked} onChange={onPick} aria-label={o.label} aria-describedby={noteId} />
      <span className="bh-opt-head">
        <b>{o.label}</b>
        {cost ? <span className="bh-opt-cost">{cost}</span> : null}
      </span>
      <span id={noteId}>
        {sub ? <span className="bh-opt-sub">{sub}</span> : null}
        {o.note ? <span className="bh-opt-note">{o.note}</span> : null}
      </span>
    </label>
  );
}

function Scenarios({ o }: { o: HedgeOption }) {
  type Row = { ndx: number; basket: number; hedged: number };
  const rows = Array.isArray(o.scenarios) ? o.scenarios.filter((r): r is Row => !!r && fin(r.ndx) && fin(r.basket) && fin(r.hedged)) : [];
  // Whole points print whole (−32%), others to a tenth (−1.1%).
  const cell = (v: number) => (v === 0 ? <span className="dk-signed" data-tone="flat">0%</span> : <Signed value={v}>{pct(v, Number.isInteger(Math.round(v * 1000) / 10) ? 0 : 1)}</Signed>);
  if (!rows.length) return null;
  return (
    <table className="bh-scen" aria-label="If NDX moves · over the month">
      <thead>
        <tr>
          <th scope="col">If NDX moves · over the month</th>
          <th scope="col">Basket</th>
          <th scope="col">+ Hedge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ndx}>
            <th scope="row">{r.ndx === 0 ? "flat" : pct(r.ndx, 0)}</th>
            <td>{cell(r.basket)}</td>
            <td>{cell(r.hedged)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HedgeStats({ o, h, show }: { o: HedgeOption | undefined; h: HedgeResponse | undefined; show: Show }) {
  const labels = ["Hedge ratio", "Cost of waiting", "Roll"];
  if (show !== "value" || !o || !h)
    return (
      <StatRow cols={3}>
        {labels.map((l) => (
          <Stat key={l} label={l} awaiting={show === "awaiting"} />
        ))}
      </StatRow>
    );
  const ratioSub = [o.underlying ? `${o.underlying} notional` : null, fin(h.beta) && fin(o.delta) ? `beta-adjusted, ${num(h.beta)} × ${num(o.delta, 2)} delta` : null].filter(Boolean).join(" · ") || undefined;
  return (
    <StatRow cols={3}>
      {fin(o.hedge_per_100) ? <Stat label={labels[0]} value={`$${num(o.hedge_per_100, Number.isInteger(o.hedge_per_100) ? 0 : 1)} per $100`} sub={ratioSub} size="sm" /> : <Stat label={labels[0]} awaiting />}
      {fin(o.theta_pct_week) ? <Stat label={labels[1]} value={<Signed value={o.theta_pct_week}>{`${pct(o.theta_pct_week, 2)} / wk`}</Signed>} sub="theta if nothing moves" size="sm" /> : <Stat label={labels[1]} awaiting />}
      {o.roll?.date && dayShort(o.roll.date) ? <Stat label={labels[2]} value={dayShort(o.roll.date)} sub={fin(o.roll.days) && fin(o.roll.at_dte) ? `${o.roll.days} days · roll at ${o.roll.at_dte} DTE` : undefined} size="sm" /> : <Stat label={labels[2]} awaiting />}
    </StatRow>
  );
}

function HedgeCard({
  mode,
  params,
  q,
  onMode,
  failed,
  reason,
  what,
}: {
  mode: HedgeMode;
  params: Params | null;
  q: UseQueryResult<HedgeResponse, DeskApiError>;
  onMode: (m: HedgeMode) => void;
  /** The subject itself did not arrive (a basket that failed). */
  failed: boolean;
  /** Why there is nothing to price yet, when that is the analyst's to fix. */
  reason: string | null;
  what: string;
}) {
  const uid = useId();
  const h: HedgeResponse | undefined = q.isError || !params ? undefined : q.data;
  const opts = h && Array.isArray(h.options) ? h.options.filter((o) => o && typeof o.id === "string" && typeof o.label === "string") : [];
  const [pick, setPick] = useState<string | null>(null);
  const chosen = opts.find((o) => o.id === pick) ?? opts.find((o) => o.id === h?.recommended) ?? opts[0];
  const adv = useAdvanced();
  const key = params ? JSON.stringify(params) : "";
  const prev = useRef(key);
  // A new subject or mode starts from the served recommendation.
  useEffect(() => {
    if (key !== prev.current) setPick(null);
    prev.current = key;
  }, [key]);
  const show: Show = h && opts.length ? "value" : failed || (params && (q.isError || (q.isSuccess && !opts.length))) ? "awaiting" : "quiet";
  return (
    <Card
      className="bh-card bh-hedge"
      title="Hedge · express or protect"
      sub={h?.surface ? `priced off the live ${h.surface} surface` : undefined}
      footer={<AdvancedPanel adv={adv} items="full chain · greeks · roll dates · what the hedge does under −10% / −20%" missing="The API serves the three structures above, each with its cost, carry, roll and a month of scenarios; the full chain and the greeks are not served yet." />}
    >
      <div className="bh-modes" role="group" aria-label="Hedge mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => onMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {h?.subject?.label ? (
        <p className="bh-subject">
          <span className="dk-stat-label">Priced for</span> {h.subject.label}
        </p>
      ) : null}
      <div className="bh-hedge-body" aria-busy={(!!params && q.isFetching) || undefined}>
        {show === "value" ? (
          <div className="bh-opts" role="radiogroup" aria-label="Structure">
            {opts.map((o) => (
              <OptionRow key={o.id} o={o} picked={o === chosen} name={`${uid}-opt`} onPick={() => setPick(o.id)} />
            ))}
          </div>
        ) : null}
        <HedgeStats o={chosen} h={h} show={show} />
        {show === "value" && chosen ? (
          <>
            <Scenarios o={chosen} />
            {chosen.scenario_note ? <p className="bh-scen-note">{chosen.scenario_note}</p> : null}
          </>
        ) : null}
        {show === "awaiting" ? <Awaiting>the structures priced for {what}</Awaiting> : reason && !params ? <p className="bh-why">{reason}</p> : null}
        {show === "value" && h?.reads?.why_index?.text ? (
          <ReadBox className="bh-why-box" label={h.reads.why_index.label} warn={h.reads.why_index.tone === "warning"}>
            {h.reads.why_index.text}
          </ReadBox>
        ) : null}
        {show === "value" && h?.reads?.recommendation?.text ? (
          <ReadBox className="bh-rec" label={h.reads.recommendation.label} warn={h.reads.recommendation.tone === "warning"}>
            {h.reads.recommendation.text}
          </ReadBox>
        ) : null}
      </div>
    </Card>
  );
}

/** The study "Express the S&P lean" prices: the one carried in (`?study=` or the six slots), else the last one Event Study answered, else the gold preset. */
function expressAsk(search: URLSearchParams): Ask {
  const study = search.get("study");
  if (study) return { preset: study };
  if (search.get("shock")) return askFromSearch(search);
  return askFromSearch(readLastStudy() ?? "");
}

export default function BasketHedgePage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  const basketId = search.get("basket") || DEFAULT_BASKET;
  const position = search.get("position");
  const m = search.get("mode");
  // An address without a mode opens Express when it carries a study (Event Study's "price it"), else Protect; a mode once picked is always written.
  const mode: HedgeMode = m === "express" || m === "neutralize" || m === "protect" ? m : search.get("study") || search.get("shock") ? "express" : "protect";
  const set = (changes: Record<string, string | null>) =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v == null) q.delete(k);
          else q.set(k, v);
        }
        return q;
      },
      { replace: true },
    );
  // The hedge prices the saved basket (the server's, or this browser's), a position, or a study.
  const served = useBasket(basketId, { enabled: !basketId.startsWith("local-") });
  const [savedTick, setSavedTick] = useState(0);
  const local = useMemo(() => readSaved().find((b) => b.id === basketId) ?? null, [basketId, savedTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A basket saved in another window of this browser.
    const onStorage = () => setSavedTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const sb = served.isError ? undefined : readable(served.data);
  const savedLegs = local?.legs ?? sb?.legs ?? null;
  const basketFailed = !local && !basketId.startsWith("local-") && (served.isError || (served.isSuccess && !sb));
  let params: Params | null = null;
  let reason: string | null = null;
  if (mode === "express") params = { mode, ...apiParams(expressAsk(search)) };
  else if (position) params = { mode, position };
  else if (savedLegs && savedLegs.length && sumsToHundred(savedLegs)) {
    const servedKey = sb ? legsKey(sb.legs) : null;
    params = local && legsKey(local.legs) !== servedKey ? { mode, legs: legsKey(local.legs) } : { mode, basket: basketId };
  } else if (savedLegs || (basketId.startsWith("local-") && !local)) reason = "The hedge prices the basket's saved weights once they add to 100%; save a basket to price it.";
  const hedge = useHedge(params ?? {}, { enabled: !!params });
  const hd = hedge.isError || !params ? undefined : hedge.data;
  const liveParts = [sb?.prices_as_of ? `prices ${dayShort(sb.prices_as_of)}` : null, hd?.provider ? `options via ${hd.provider}` : null];
  return (
    <div className="bh">
      <PageTitle page={page} badge={sb?.prices_as_of || hd?.provider ? <LiveBadge parts={liveParts} boxed /> : null} />
      <div className="bh-grid">
        <BasketCard
          basketId={basketId}
          onSelect={(id) => {
            // Picking a basket makes it the hedge's subject: a position carried in no longer is.
            set({ basket: id === DEFAULT_BASKET ? null : id, position: null });
            setSavedTick((t) => t + 1);
          }}
          onSaved={() => setSavedTick((t) => t + 1)}
        />
        <HedgeCard mode={mode} params={params} q={hedge} onMode={(v) => set({ mode: v })} failed={basketFailed && !params && mode !== "express" && !position} reason={reason} what={mode === "express" ? "this study" : position ? "this position" : "these weights"} />
      </div>
    </div>
  );
}
