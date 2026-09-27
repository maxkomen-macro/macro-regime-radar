/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10, screens/09-basket-hedge.png). The
 * analyst's own work is kept in this browser (§1.8): the baskets, their legs
 * as typed weights (Equal-weight, Normalize to 100%, × to drop, a ticker to
 * add), Save basket and Export / Import JSON. A saved basket whose weights add
 * to exactly 100% is priced by /basket/price (§12.14, desk/books) from
 * EODHD's daily bars: step 2, how the basket trades (./BasketTrades.tsx).
 * The hedge's option structures are not yet defined in the engine (v2
 * D-25–D-28): step 3 ranks the ETF hedge (/basket/hedge, §12.15) and keeps
 * the options card's slot, which prints §1.0's reason (§1.0.2).
 * Send to Position Monitor carries the basket as a manual subject (§9).
 */

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useBasketHedge, useBasketPrice } from "../data/api";
import { useSearchParams } from "react-router-dom";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayShort } from "../kit/format";
import { Card, LiveBadge, NotServedBadge } from "../kit/ui";
import BasketHedgeStep from "./BasketHedgeStep";
import BasketTrades, { type BasketRange } from "./BasketTrades";
import {
  savedLegs,
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
  sumsToHundred,
  toWork,
  totalText,
  unreadableSaved,
  writeAllSaved,
  writeSaved,
  type SaveResult,
  type SavedBasket,
  type WorkLeg,
} from "./weights";
import "./basket.css";

/** What /basket/price is asked for a saved basket (§12.14): its legs as saved, the method, the notional;
 * null until the basket has legs whose weights add to exactly 100%. */
export function priceParams(b: SavedBasket | null): { legs: string; method: string; notional: string } | null {
  if (!b || !b.legs.length || !sumsToHundred(b.legs)) return null;
  return { legs: legsKey(b.legs), method: "hold", notional: "1000000" };
}

/** A total as printed: its exact digits ("100%", "96.5%", "99.97%"), so the words never say 100% of
 * weights that do not add to it (Codex R-14). */
const totalWords = (t: string) => `${t}%`;
/** Why a save did not happen, in the reader's words. */
const STORAGE_WORDS: Record<Exclude<SaveResult, "ok">, string> = {
  off: "This browser does not keep baskets (storage is off); nothing was saved.",
  full: "This browser's storage is full; nothing was saved.",
};

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
          <span className="bh-add-hint">any US-listed name</span>
        </form>
        <p className="bh-total">
          total <b data-off={(tot != null && tot !== "100") || undefined}>{tot == null ? "—" : totalWords(tot)}</b>
        </p>
      </div>
      <p className="bh-note" role="status">
        {note}
      </p>
    </div>
  );
}

function BasketCard({ basketId, saved, unreadable, onSelect, onSaved }: { basketId: string | null; saved: SavedBasket[]; unreadable: number; onSelect: (id: string) => void; onSaved: () => void }) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const local = saved.find((b) => b.id === basketId) ?? null;
  const base = local ? toWork(local.legs) : null;
  const [work, setWork] = useState<WorkLeg[] | null>(null);
  const [status, setStatus] = useState("");
  // Another basket starts from its own saved legs, with nothing said yet.
  useEffect(() => {
    setWork(null);
    setStatus("");
  }, [basketId]);
  const legs = work ?? base;
  const tot = legs ? totalText(legs) : null;
  const dirty = !!work && !!base && legsKey(work) !== legsKey(base);
  const save = () => {
    if (!legs || !local) return;
    if (!legs.length) return setStatus("Add a ticker to save the basket.");
    if (tot !== "100") return setStatus(tot == null ? "A weight is not a number; fix it to save." : `The weights add to ${totalWords(tot)}; normalize them to 100% to save.`);
    // Each weight saved as the exact decimal typed, so the basket adds to exactly 100% when read back (Codex R-20).
    const r = writeSaved({ id: local.id, name: local.name, legs: savedLegs(legs), saved_at: new Date().toISOString() });
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    onSaved();
    setWork(null);
    setStatus("Saved in this browser.");
  };
  const remove = () => {
    if (!local) return;
    const r = removeSaved(local.id);
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    onSaved();
  };
  const newBasket = () => {
    // Typed weights are the analyst's work: starting another basket never drops them unseen.
    if (dirty) return setStatus("This basket has unsaved weights: save them, or put them back, before starting another.");
    // An empty basket already waiting (this one, or another) is reused, so the list does not fill with empties.
    const empty = saved.find((b) => !b.legs.length && !(b.id === basketId && legs?.length));
    if (empty) {
      if (empty.id === basketId) setStatus("This basket is empty: add a ticker to start it.");
      return onSelect(empty.id);
    }
    const id = newBasketId(saved);
    const r = writeSaved({ id, name: `New basket ${id.slice(6)}`, legs: [], saved_at: new Date().toISOString() });
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    onSaved();
    onSelect(id);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportSaved(saved)], { type: "application/json" }));
    a.download = "desk-saved-baskets.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = importSaved(saved, await f.text());
    const w = writeAllSaved(r.list);
    if (w !== "ok") return setStatus(STORAGE_WORDS[w]);
    onSaved();
    if (!basketId && r.list[0]) onSelect(r.list[0].id);
    setStatus(
      `Imported ${r.added} basket${r.added === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} already here` : ""}${r.renumbered ? `; ${r.renumbered} given a new number, so no basket here was replaced` : ""}${r.rejected ? `; ${r.rejected} not readable` : ""}.`,
    );
  };
  const empty = !saved.length ? (
    <p className="bh-why">{unreadable ? "No basket saved in this browser can be read: start one with + New basket, or import a file." : "No basket is saved in this browser yet: start one with + New basket, or import a file."}</p>
  ) : !local ? (
    <p className="bh-why">This basket is not saved in this browser; pick another above or start a new one.</p>
  ) : null;
  return (
    <Card
      className="bh-card bh-basket"
      title="Basket"
      headExtra={
        <div className="bh-head-extra">
          {saved.length ? (
            <>
              <label className="dk-sr" htmlFor={`${uid}-sel`}>
                Basket
              </label>
              <span className="dk-select bh-select">
                <select
                  id={`${uid}-sel`}
                  value={local ? local.id : ""}
                  onChange={(e) => {
                    // Typed weights are the analyst's work: another basket never drops them unseen.
                    if (dirty) return setStatus("This basket has unsaved weights: save them, or put them back, before opening another.");
                    onSelect(e.target.value);
                  }}
                >
                  {!local ? <option value="">Pick a basket…</option> : null}
                  {saved.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </span>
            </>
          ) : null}
          <span className="bh-meta">{[legs ? `${legs.length} names` : null, local ? "saved in this browser" : null].filter(Boolean).join(" · ")}</span>
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
            <span className="bh-save-hint">{dirty ? "unsaved weights" : "kept in this browser only"}</span>
          </div>
          {/* §1.8, §10: the basket's local controls sit with Save; they need no endpoint. */}
          <p className="bh-adv-row bh-local">
            <button type="button" className="dk-link" onClick={download} disabled={!saved.length}>
              Export saved baskets (JSON)
            </button>
            {" · "}
            <button type="button" className="dk-link" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} aria-label="Import saved baskets" />
            {local ? (
              <>
                {" · "}
                <button type="button" className="dk-link" onClick={remove}>
                  Delete this basket
                </button>
              </>
            ) : null}
          </p>

        </div>
      }
    >
      <Legs key={basketId ?? ""} legs={legs} onChange={(l) => setWork(l)} empty={empty} />
      {unreadable ? (
        <p className="bh-why">
          {unreadable === 1 ? "1 saved basket" : `${unreadable} saved baskets`} could not be read; kept in this browser, and in an export, not shown.
        </p>
      ) : null}
      <p className="bh-status" role="status">
        {status}
      </p>
    </Card>
  );
}

/** Step 2 (§10): how the saved basket trades, or why it is not priced yet. */
function StepTwo({ local, q, state, range, setRange, names }: { local: SavedBasket | null; q: ReturnType<typeof useBasketPrice>; state: "loading" | "awaiting" | "ready"; range: BasketRange; setRange: (r: BasketRange) => void; names: Record<string, string | null> }) {
  const hid = useId();
  const why = !local ? "Open or start a basket to price it." : !local.legs.length ? "Add a ticker and save the basket to price it." : !sumsToHundred(local.legs) ? "Save the basket with its weights at exactly 100% to price it." : null;
  return (
    <section className="bh-step" aria-labelledby={hid}>
      <h2 className="bh-step-title" id={hid}>
        <span className="bh-step-n" aria-hidden="true">
          2
        </span>
        How the basket trades <span className="bh-step-sub">technicals against the Nasdaq and the S&amp;P, contribution, concentration, liquidity</span>
      </h2>
      {why ? (
        <p className="bh-why">{why}</p>
      ) : (
        <>
          {q.isError ? (
            <p className="bh-why" role="status">
              {`This basket could not be priced: ${q.error.message}`}{" "}
              <button type="button" className="dk-link" onClick={() => void q.refetch()}>
                Try again
              </button>
            </p>
          ) : null}
          <BasketTrades p={q.data} state={state} range={range} setRange={setRange} names={names} />
        </>
      )}
    </section>
  );
}

/** Step 3 (§10): hedge it; the ETF hedge and the stress test for the saved basket, then the options slot. */
function StepThree({ local, q }: { local: SavedBasket | null; q: ReturnType<typeof useBasketHedge> }) {
  const hid = useId();
  const priced = !!priceParams(local);
  const state = q.data ? "ready" : q.isError || !priced ? "awaiting" : "loading";
  return (
    <section className="bh-step" aria-labelledby={hid}>
      <h2 className="bh-step-title" id={hid}>
        <span className="bh-step-n" aria-hidden="true">
          3
        </span>
        Hedge it <span className="bh-step-sub">the closest ETF and what it does in a 10% fall, then options</span>
      </h2>
      {!priced ? <p className="bh-why">A saved basket at exactly 100% is hedged here.</p> : null}
      {q.isError ? (
        <p className="bh-why" role="status">
          {`The hedge could not be computed: ${q.error.message}`}{" "}
          <button type="button" className="dk-link" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      <BasketHedgeStep h={q.data} state={state} />
    </section>
  );
}

export default function BasketHedgePage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  const [saved, setSaved] = useState<SavedBasket[]>(() => readSaved());
  const [unreadable, setUnreadable] = useState(() => unreadableSaved().length);
  // A save in another window of this browser reaches this page too.
  useEffect(() => {
    const onStorage = () => {
      setSaved(readSaved());
      setUnreadable(unreadableSaved().length);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const asked = search.get("basket");
  // No basket in the address opens this browser's first, and says so in the address, so Send to
  // Position Monitor carries it.
  const basketId = asked ?? saved[0]?.id ?? null;
  useEffect(() => {
    if (!asked && saved[0])
      setSearch(
        (prev) => {
          const q = new URLSearchParams(prev);
          q.set("basket", saved[0].id);
          return q;
        },
        { replace: true },
      );
  }, [asked, saved, setSearch]);
  const select = (id: string) =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        q.set("basket", id);
        return q;
      },
      { replace: true },
    );
  const refresh = () => {
    const list = readSaved();
    setSaved(list);
    setUnreadable(unreadableSaved().length);
    // A deleted basket gives way to the next one saved here.
    if (basketId && !list.some((b) => b.id === basketId))
      setSearch(
        (prev) => {
          const q = new URLSearchParams(prev);
          if (list[0]) q.set("basket", list[0].id);
          else q.delete("basket");
          return q;
        },
        { replace: true },
      );
  };
  const local = saved.find((b) => b.id === basketId) ?? null;
  const pq = useBasketPrice(priceParams(local));
  const hq = useBasketHedge(priceParams(local));
  const [range, setRange] = useState<BasketRange>("1y");
  const priced = pq.data;
  const state = pq.data ? "ready" : pq.isError ? "awaiting" : "loading";
  const names = Object.fromEntries((local?.legs ?? []).map((l) => [l.symbol, l.name]));
  return (
    <div className="bh">
      <PageTitle page={page} badge={priced ? <LiveBadge boxed parts={[priced.provider ?? null, dayShort(priced.prices_as_of) || null]} /> : <NotServedBadge boxed />} />
      <div className="bh-grid">
        <BasketCard basketId={basketId} saved={saved} unreadable={unreadable} onSelect={select} onSaved={refresh} />
      </div>
      <StepTwo local={local} q={pq} state={state} range={range} setRange={setRange} names={names} />
      <StepThree local={local} q={hq} />
    </div>
  );
}
