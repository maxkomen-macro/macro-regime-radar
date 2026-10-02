/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10, screens/09-basket-hedge.png). The
 * analyst's own work is kept in this browser (§1.8): the baskets, their legs
 * as typed weights (Equal-weight, Normalize to 100%, × to drop, a ticker to
 * add), Save basket and Export / Import JSON. A saved basket whose weights add
 * to exactly 100% is priced by /basket/price (§12.15, desk/books) from
 * EODHD's daily bars: step 2, how the basket trades (./BasketTrades.tsx).
 * The hedge's option structures are not yet defined in the engine (v2
 * D-25–D-28): step 3 ranks the ETF hedge (/basket/hedge, §12.16), then, in
 * the options slot, the PROTOTYPE cards of §1.0.3 (../prototypes/, mounted
 * by ./BasketHedgeStep.tsx): "Hedge with options", priced in the browser
 * from the basket engine's inputs and assumed volatilities; below the slot,
 * "Positioning", per name, and "Event study on this basket", as an Event
 * Study answer.
 * Send to Position Monitor carries the basket as a manual subject (§9).
 *
 * desk/cap-weight: Cap-weight, beside Equal-weight, weights the basket by
 * each name's market value at its start (§12.15 `weighting=cap`) from the
 * share counts the full refresh stores (§12.18, `useBasketShares`); the preset
 * is cap-weighted by default. The weights column then shows the resulting
 * weights, read only. A basket with a name that has no stored count, or a
 * database without counts, shows the control unavailable with the reason, and
 * a saved cap-weighted basket is then priced at its typed weights (equal).
 */

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useBasketHedge, useBasketPrice, useBasketShares } from "../data/api";
import type { BasketParams } from "./weights";
import { useSearchParams } from "react-router-dom";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { dayShort, pct, pctPlain } from "../kit/format";
import type { BasketPriceResponse } from "../data/types";
import { asOfMismatch, basketLead, capLabel } from "./trades";
import { Card, LiveBadge, NotServedBadge } from "../kit/ui";
import { InstrumentSearch } from "../kit/InstrumentSearch";
import { defineTerms } from "../kit/Term";
import BasketHedgeStep from "./BasketHedgeStep";
import BasketTrades, { type BasketRange } from "./BasketTrades";
import { checkTicker } from "./check";
import { PositioningCard } from "../prototypes/PositioningCard";
import { BasketStudyCard } from "../prototypes/BasketStudyCard";
import {
  DEFAULT_METHOD,
  DEFAULT_NOTIONAL,
  METHOD_WORDS,
  addLeg,
  capAvailability,
  methodOf,
  notionalOf,
  notionalText,
  parseNotional,
  seedPreset,
  saveRefusal,
  savedLegs,
  shareCountsOf,
  equalWeight,
  exportSaved,
  importSaved,
  heldBasket,
  isEqualWeight,
  legsKey,
  newBasketId,
  normalize,
  parseTicker,
  parseWeight,
  priceParams,
  readSaved,
  removeSaved,
  sumsToHundred,
  toWork,
  totalText,
  unreadableSaved,
  updateSaved,
  weightingOf,
  writeAllSaved,
  writeSaved,
  type CapAvailability,
  type CapSnapshot,
  type Method,
  type SaveResult,
  type SavedBasket,
  type ShareCounts,
  type Weighting,
  type WorkLeg,
} from "./weights";
import "./basket.css";

/** Whether two lists of legs name the same tickers in the same order. */
const sameNames = (a: readonly { symbol: string }[], b: readonly { symbol: string }[]) => a.length === b.length && a.every((l, i) => l.symbol === b[i].symbol);

/** A cap-weighted answer's start weights by ticker, when it answers for exactly these names in this order (§12.15). */
function servedCapWeights(p: BasketPriceResponse | undefined, symbols: readonly string[] | undefined): Record<string, number> | null {
  if (!p || p.weighting !== "cap" || !p.legs || !symbols || p.legs.length !== symbols.length || p.legs.some((l, i) => l.symbol !== symbols[i])) return null;
  return Object.fromEntries(p.legs.filter((l) => finite(l.target_weight)).map((l) => [l.symbol, l.target_weight as number]));
}

/** A total as printed: its exact digits ("100%", "96.5%", "99.97%"), so the words never say 100% of
 * weights that do not add to it (Codex R-14). */
const totalWords = (t: string) => `${t}%`;
/** Why a save did not happen, in the reader's words. */
const STORAGE_WORDS: Record<Exclude<SaveResult, "ok">, string> = {
  off: "This browser does not keep baskets (storage is off); nothing was saved.",
  full: "This browser's storage is full; nothing was saved.",
};

/** The priced legs by ticker: weight at the last close and return since the start (§12.15). */
type Live = Record<string, { weight_now: number | null; ret: number | null }>;
function liveOf(p: BasketPriceResponse | undefined): Live | null {
  if (!p?.legs?.length) return null;
  return Object.fromEntries(p.legs.map((l) => [l.symbol, { weight_now: l.weight_now, ret: l.return }]));
}
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function Legs({
  legs,
  onChange,
  onAdd,
  empty,
  live,
  weighting,
  cap,
  onCap,
  onEqual,
  served,
}: {
  legs: WorkLeg[] | null;
  onChange: (legs: WorkLeg[]) => void;
  onAdd: (symbol: string) => Promise<string>;
  empty: ReactNode;
  live: Live | null;
  /** desk/cap-weight: how the legs are weighted, whether these names can be cap-weighted, the two tools, and the
   * served weights at the start for a cap-weighted basket (null until its answer is for these names). */
  weighting: Weighting;
  cap: CapAvailability;
  onCap: () => void;
  onEqual: () => void;
  served: Record<string, number> | null;
}) {
  const uid = useId();
  const capped = weighting === "cap";
  const [ticker, setTicker] = useState("");
  const [note, setNote] = useState("");
  const [checking, setChecking] = useState(false);
  const tot = legs ? totalText(legs) : null;
  // The typed text on Enter, or a suggestion's ticker when one is picked (desk/usability: the Desk's stock search).
  const add = async (raw: string) => {
    const t = parseTicker(raw);
    if (!legs || checking) return;
    if (!t) return setNote(raw.trim() ? `“${raw.trim()}” is not a ticker.` : "");
    if (legs.some((l) => l.symbol === t)) return setNote(`${t} is already in the basket.`);
    setChecking(true);
    setNote(`Checking ${t}…`);
    const words = await onAdd(t);
    setChecking(false);
    setNote(words);
    if (!words.includes("not added")) setTicker("");
  };
  return (
    <div className="bh-legs">
      <div className="bh-legs-head">
        <p>
          <span className="dk-stat-label">Legs</span> <span className="bh-hint">{capped ? "weights are market values at the start; × to drop a name" : "type a weight, or × to drop a name"}</span>
        </p>
        {/* §14.13: a tool with no legs to act on is not shown. */}
        {legs?.length ? (
          <div className="bh-legs-tools">
            {/* desk/cap-weight: unavailable, the control is disabled inside its reason's scope (§1.0.2, [data-unserved]). */}
            {cap.state === "unavailable" ? (
              <span className="bh-cap-off" data-unserved="cap-weight">
                <button type="button" className="dk-btn" disabled aria-pressed={false} aria-describedby={`${uid}-capwhy`}>
                  Cap-weight
                </button>
              </span>
            ) : (
              <button type="button" className="dk-btn" aria-pressed={capped} onClick={onCap}>
                Cap-weight
              </button>
            )}
            <button type="button" className="dk-btn" onClick={onEqual}>
              Equal-weight
            </button>
            {/* §14.13: cap weights are not typed, so there is nothing to normalize. */}
            {capped ? null : (
              <button type="button" className="dk-btn" onClick={() => onChange(normalize(legs))}>
                Normalize to 100%
              </button>
            )}
          </div>
        ) : null}
      </div>
      {legs ? (
        <table className="bh-table">
          <caption className="dk-sr">The basket's legs and their weights</caption>
          <thead className={live ? "bh-legs-thead" : "dk-sr"}>
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col">Name</th>
              {live ? (
                <>
                  <th scope="col" className="bh-live">
                    Now
                  </th>
                  <th scope="col" className="bh-live">
                    Since start
                  </th>
                </>
              ) : null}
              <th scope="col" className="bh-w-h">
                {capped ? "At start" : "Weight"}
              </th>
              <th scope="col">
                <span className="dk-sr">Drop</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l, i) => {
              const bad = parseWeight(l.weight) == null;
              return (
                <tr key={l.symbol}>
                  <td className="bh-sym">{l.symbol}</td>
                  <td className="bh-name">{l.name ?? "—"}</td>
                  {live ? (
                    <>
                      <td className="bh-live" title="weight at the last close">
                        {finite(live[l.symbol]?.weight_now) ? pctPlain(live[l.symbol].weight_now as number, 1) : "—"}
                      </td>
                      <td className="bh-live" data-tone={finite(live[l.symbol]?.ret) ? ((live[l.symbol].ret as number) < 0 ? "down" : "up") : undefined}>
                        {finite(live[l.symbol]?.ret) ? pct(live[l.symbol].ret as number) : "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="bh-w">
                    {capped ? (
                      // desk/cap-weight: the resulting weight at the start, served; "—" until the answer is for these names.
                      <span className="bh-capw" data-testid="bh-capw" aria-label={`Cap weight of ${l.symbol} at the start`} title="market value at the start over the basket's">
                        {served && finite(served[l.symbol]) ? pctPlain(served[l.symbol], 1) : "—"}
                      </span>
                    ) : (
                      <>
                        <input
                          className="bh-input"
                          inputMode="decimal"
                          aria-label={`Weight of ${l.symbol}, percent`}
                          aria-invalid={bad || undefined}
                          value={l.weight}
                          onChange={(e) => onChange(legs.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                        />
                        <span aria-hidden="true">%</span>
                      </>
                    )}
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
      {/* §14.13: with no basket open there is nothing to add to; + New basket starts one. */}
      {legs ? (
        <div className="bh-add-row">
          <form
            className="bh-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add(ticker);
            }}
          >
            <label htmlFor={`${uid}-t`} className="bh-add-plus" aria-hidden="true">
              +
            </label>
            {/* The Desk's stock search (US-listed stocks and ETFs, suggestions from the first keystroke); Enter with
                no suggestion adds the typed ticker, as before. */}
            <InstrumentSearch
              className="bh-isearch"
              inputId={`${uid}-t`}
              ariaLabel="Add a ticker"
              placeholder="Add a ticker…"
              value={ticker}
              onTextChange={setTicker}
              onSelect={(hit) => {
                setTicker(hit.symbol);
                void add(hit.symbol);
              }}
              dense
            />
            <span className="bh-add-hint">any US-listed name</span>
          </form>
          {capped && cap.state === "ok" ? (
            <p className="bh-total bh-cap-label">{capLabel(cap.provider, cap.as_of)}</p>
          ) : (
            <p className="bh-total">
              total <b data-off={(tot != null && tot !== "100") || undefined}>{tot == null ? "—" : totalWords(tot)}</b>
            </p>
          )}
        </div>
      ) : null}
      {legs?.length && cap.state === "unavailable" ? (
        <p className="bh-why bh-cap-why" id={`${uid}-capwhy`} data-unserved="cap-weight">
          {cap.reason}
        </p>
      ) : null}
      {capped && cap.state === "ok" && legs?.length && !served ? <p className="bh-hint bh-cap-hint">Save computes the cap weights from each name&apos;s market value at the start.</p> : null}
      <p className="bh-note" role="status">
        {note}
      </p>
    </div>
  );
}

/** A name's short form for the header's inline forms. */
const MAX_NAME = 60;

function BasketCard({
  basketId,
  saved,
  unreadable,
  onSelect,
  onSaved,
  pendingAdd,
  onAddDone,
  priced,
  counts,
}: {
  basketId: string | null;
  saved: SavedBasket[];
  unreadable: number;
  onSelect: (id: string) => void;
  onSaved: () => void;
  /** A ticker the address asks to add (`?add=XYZ`, from Technicals). */
  pendingAdd: string | null;
  onAddDone: () => void;
  /** The saved basket's price answer, for the lead and the legs' live columns. */
  priced?: BasketPriceResponse;
  /** desk/cap-weight: the stored share counts (§12.18), for whether a basket can be cap-weighted. */
  counts: ShareCounts;
}) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const local = saved.find((b) => b.id === basketId) ?? null;
  const base = local ? toWork(local.legs) : null;
  const [work, setWork] = useState<WorkLeg[] | null>(null);
  const [methodWork, setMethodWork] = useState<Method | null>(null);
  const [notionalWork, setNotionalWork] = useState<string | null>(null);
  const [weightingWork, setWeightingWork] = useState<Weighting | null>(null);
  const [status, setStatus] = useState("");
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Another basket starts from its own saved legs, with nothing said yet.
  useEffect(() => {
    setWork(null);
    setMethodWork(null);
    setNotionalWork(null);
    setWeightingWork(null);
    setStatus("");
    setNaming(null);
    setConfirmDelete(false);
  }, [basketId]);
  const legs = work ?? base;
  const legsRef = useRef<WorkLeg[] | null>(legs);
  legsRef.current = legs;
  const method = methodWork ?? methodOf(local);
  const notionalTyped = notionalWork ?? notionalText(notionalOf(local));
  const notional = parseNotional(notionalTyped);
  // desk/cap-weight: how the legs are weighted, and whether these names can be cap-weighted (every one with a count).
  const weighting = weightingWork ?? weightingOf(local);
  const cap = capAvailability((legs ?? []).map((l) => l.symbol), counts);
  // How the legs are shown and priced: cap-weighted only while every name has a stored count; otherwise the typed
  // weights the basket is priced at (the choice itself is kept, so the counts' arrival makes it cap-weighted again).
  const shown: Weighting = weighting === "cap" && cap.state !== "unavailable" ? "cap" : "target";
  const weightingRef = useRef<Weighting>(weighting);
  weightingRef.current = weighting;
  const countsRef = useRef<ShareCounts>(counts);
  countsRef.current = counts;
  const served = shown === "cap" ? servedCapWeights(priced, legs?.map((l) => l.symbol)) : null;
  const tot = legs ? totalText(legs) : null;
  const dirty =
    !!local && ((!!work && !!base && legsKey(work) !== legsKey(base)) || method !== methodOf(local) || notional !== notionalOf(local) || weighting !== weightingOf(local));
  /** desk/cap-weight: weights from market value at the start; the typed weights go to equal weight, the fallback. */
  const toCap = () => {
    if (!legs) return;
    setWeightingWork("cap");
    if (!isEqualWeight(legs)) setWork(equalWeight(legs));
    setStatus(weightingOf(local) === "cap" ? "" : "Cap-weighted: each name at its market value at the start. Save to price it.");
  };
  const toEqual = () => {
    if (!legs) return;
    setWeightingWork("target");
    setWork(equalWeight(legs));
    setStatus("");
  };
  const save = () => {
    if (!legs || !local) return;
    if (!legs.length) return setStatus("Add a ticker to save the basket.");
    // A cap-weighted basket's typed weights are its equal-weight fallback; the market values weight it (desk/cap-weight).
    if (weighting !== "cap" && tot !== "100") return setStatus(tot == null ? "A weight is not a number; fix it to save." : `The weights add to ${totalWords(tot)}; normalize them to 100% to save.`);
    // Codex R-10: the API prices only positive weights (and at most 25 names); Save refuses what it would refuse.
    const refused = saveRefusal(legs);
    if (refused) return setStatus(refused);
    if (notional == null) return setStatus("The notional is not a dollar amount above $0; fix it to save.");
    // Each weight saved as the exact decimal typed, so the basket adds to exactly 100% when read back (Codex R-20).
    // A cap-weighted basket keeps the cap weights last served for it while its names are unchanged (desk/cap-weight).
    const legsSaved = savedLegs(weighting === "cap" ? (isEqualWeight(legs) ? legs : equalWeight(legs)) : legs);
    const snapshot = weighting === "cap" && local.cap_weights && sameNames(legsSaved, local.legs) ? local.cap_weights : undefined;
    const r = writeSaved({
      id: local.id,
      name: local.name,
      legs: legsSaved,
      saved_at: new Date().toISOString(),
      method,
      notional,
      ...(weighting === "cap" ? { weighting: "cap" as const } : {}),
      ...(snapshot ? { cap_weights: snapshot } : {}),
    });
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    onSaved();
    setWork(null);
    setMethodWork(null);
    setNotionalWork(null);
    setWeightingWork(null);
    setStatus("Saved in this browser; priced below.");
  };
  const remove = () => {
    if (!local) return;
    if (!confirmDelete) return setConfirmDelete(true);
    const r = removeSaved(local.id);
    setConfirmDelete(false);
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    onSaved();
  };
  const startNaming = (kind: "new" | "rename") => {
    // Typed weights are the analyst's work: starting another basket never drops them unseen.
    if (kind === "new" && dirty) return setStatus("This basket has unsaved changes: save them, or put them back, before starting another.");
    setDraft(kind === "rename" && local ? local.name : "");
    setNaming(kind);
    setStatus("");
  };
  const submitName = () => {
    const name = draft.trim().slice(0, MAX_NAME);
    if (!name) return setStatus("Name the basket first.");
    if (saved.some((b) => b.name === name && b.id !== (naming === "rename" ? local?.id : undefined))) return setStatus(`A basket named “${name}” is already saved here.`);
    if (naming === "rename" && local) {
      const r = writeSaved({ ...local, name });
      if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
      onSaved();
      setNaming(null);
      return setStatus(`Renamed ${name}.`);
    }
    const id = newBasketId(saved);
    const r = writeSaved({ id, name, legs: [], saved_at: new Date().toISOString(), method: DEFAULT_METHOD, notional: DEFAULT_NOTIONAL });
    if (r !== "ok") return setStatus(STORAGE_WORDS[r]);
    setNaming(null);
    onSaved();
    onSelect(id);
  };
  // Codex R-12: a ticker check is bound to the basket it started on.
  const basketRef = useRef(basketId);
  basketRef.current = basketId;
  /** A ticker checked against the price endpoint, then added with the weights re-spread to equal; the words for the note.
   * The check answers for the basket it was asked on: when another basket is open by then, nothing is added. */
  const addTicker = async (symbol: string): Promise<string> => {
    const origin = basketRef.current;
    const check = await checkTicker(symbol);
    if (basketRef.current !== origin) return `${symbol} was not added: another basket was opened while it was checked.`;
    const said = (w: string) => w.replace(/\.+$/, "");
    if (check.state === "unlisted") return `${symbol} was not added: ${said(check.words)}.`;
    // The legs as they stand once the check has answered (typing may have gone on meanwhile).
    const current = legsRef.current ?? [];
    if (current.some((l) => l.symbol === symbol)) return `${symbol} is already in the basket.`;
    const next = addLeg(current, symbol);
    setWork(next.legs);
    // desk/cap-weight: a cap-weighted basket stays so when the new name has a stored count; otherwise it returns to
    // equal weight, and the note says why.
    const wasCap = weightingRef.current === "cap";
    const staysCap = wasCap && capAvailability(next.legs.map((l) => l.symbol), countsRef.current).state !== "unavailable";
    if (wasCap && !staysCap) setWeightingWork("target");
    const off = !wasCap || staysCap ? "" : countsRef.current.state === "ready" ? ` ${symbol} has no stored share count, so cap weight is off for this basket.` : " Share counts are not available here, so cap weight is off for this basket.";
    const words = staysCap ? `${symbol} added; the basket stays cap-weighted.` : `${symbol} added; the ${next.legs.length} names are at equal weight.${off}`;
    const unchecked = check.state === "unchecked" ? ` Not checked (${said(check.words)}); the price says whether it is listed.` : "";
    return `${words}${unchecked} Save to price it.`;
  };
  // `?add=XYZ` (Technicals' link): the ticker joins the open basket as unsaved work; with no basket, a new one holds it.
  const adding = useRef(false);
  useEffect(() => {
    // desk/cap-weight: whether the name keeps a cap-weighted basket so needs the stored counts, so the add waits for them.
    if (!pendingAdd || adding.current || counts.state === "loading") return;
    const t = parseTicker(pendingAdd);
    if (!t) {
      onAddDone();
      return setStatus(`“${pendingAdd}” is not a ticker; nothing was added.`);
    }
    if (!local) {
      if (saved.length) return; // the address's basket opens first
      const id = newBasketId(saved);
      const r = writeSaved({ id, name: `${t} basket`, legs: [], saved_at: new Date().toISOString(), method: DEFAULT_METHOD, notional: DEFAULT_NOTIONAL });
      if (r !== "ok") {
        onAddDone();
        return setStatus(STORAGE_WORDS[r]);
      }
      onSaved();
      return onSelect(id);
    }
    adding.current = true;
    void addTicker(t).then((words) => {
      adding.current = false;
      setStatus(words);
      onAddDone();
    });
    // addTicker reads the basket's own state; the effect runs once per asked ticker.
  }, [pendingAdd, local?.id, saved.length, counts.state]);
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
  const nameForm = naming ? (
    <form
      className="bh-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        submitName();
      }}
    >
      <input className="bh-name-input" aria-label={naming === "new" ? "Name of the new basket" : "Basket name"} placeholder={naming === "new" ? "Name the basket…" : undefined} value={draft} maxLength={MAX_NAME} onChange={(e) => setDraft(e.target.value)} autoFocus />
      <button type="submit" className="dk-btn">
        {naming === "new" ? "Create" : "Save name"}
      </button>
      <button type="button" className="dk-link" onClick={() => setNaming(null)}>
        Cancel
      </button>
    </form>
  ) : null;
  return (
    <Card
      className="bh-card bh-basket"
      title="Basket"
      headExtra={
        <div className="bh-head-extra">
          {naming === "rename" ? (
            nameForm
          ) : saved.length ? (
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
                    if (dirty) return setStatus("This basket has unsaved changes: save them, or put them back, before opening another.");
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
          <span className="bh-head-actions">
            {local && naming !== "rename" ? (
              <button type="button" className="dk-link" onClick={() => startNaming("rename")}>
                Rename
              </button>
            ) : null}
            {naming === "new" ? (
              nameForm
            ) : (
              <button type="button" className="dk-link bh-new" onClick={() => startNaming("new")}>
                + New basket
              </button>
            )}
          </span>
        </div>
      }
      footer={
        <div className="bh-foot">
          {/* §14.6: the page's one primary action is the header's Send; saving is secondary. §14.13: shown with a basket open. */}
          {legs ? (
            <div className="bh-save">
                          <button type="button" className="dk-btn" onClick={save}>
                Save basket
              </button>
              <span className="bh-save-hint">{dirty ? "unsaved changes" : "Save computes everything below · kept in this browser only"}</span>
            </div>
          ) : null}
          {/* §1.8, §10: the basket's local controls sit with Save; they need no endpoint. */}
          <p className="bh-adv-row bh-local">
            {/* §14.13: nothing saved, nothing to export: the control is not shown. */}
            {saved.length ? (
              <>
                <button type="button" className="dk-link" onClick={download}>
                  Export saved baskets (JSON)
                </button>
                {" · "}
              </>
            ) : null}
            <button type="button" className="dk-link" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} aria-label="Import saved baskets" />
            {local ? (
              <>
                {" · "}
                <button type="button" className="dk-link" onClick={remove}>
                  {confirmDelete ? `Delete “${local.name}” from this browser` : "Delete this basket"}
                </button>
                {confirmDelete ? (
                  <>
                    {" · "}
                    <button type="button" className="dk-link" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
      }
    >
      {local ? <p className="bh-lead">{basketLead(local, methodOf(local), notionalOf(local), priced, weightingOf(local))}</p> : null}
      {local ? (
        <div className="bh-settings">
          <label className="bh-field">
            <span className="dk-stat-label">{defineTerms("Notional")}</span>
            <span className="bh-money">
              <span aria-hidden="true">$</span>
              <input className="bh-input bh-notional" inputMode="decimal" aria-label="Notional, dollars" aria-invalid={notional == null || undefined} value={notionalTyped} onChange={(e) => setNotionalWork(e.target.value)} />
            </span>
          </label>
          <label className="bh-field">
            <span className="dk-stat-label">Method</span>
            <span className="dk-select bh-select">
              <select aria-label="Method" value={method} onChange={(e) => setMethodWork(e.target.value === "monthly" ? "monthly" : "hold")}>
                {(["hold", "monthly"] as const).map((m) => (
                  <option key={m} value={m}>
                    {METHOD_WORDS[m]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <p className="bh-settings-hint">
            {shown === "cap"
              ? method === "monthly"
                ? "reset to cap weights on each month's first session; with one set of share counts, the same as held"
                : "bought at each company's market value at the start; held, it stays cap-weighted"
              : method === "monthly"
                ? "back to the target weights at each month's last session"
                : "share counts fixed at the start; weights drift with price"}
          </p>
        </div>
      ) : null}
      <Legs
        key={basketId ?? ""}
        legs={legs}
        // A cap-weighted basket's typed weights stay at equal weight when a name is dropped (desk/cap-weight); typing
        // weights where cap weight is unavailable makes the basket one of typed weights.
        onChange={(l) => {
          if (shown === "cap") return setWork(equalWeight(l));
          if (weighting === "cap") setWeightingWork("target");
          setWork(l);
        }}
        onAdd={addTicker}
        empty={empty}
        live={liveOf(priced)}
        weighting={shown}
        cap={cap}
        onCap={toCap}
        onEqual={toEqual}
        served={served}
      />
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

/** Step 1 (§10): build the basket. */
function StepOne({ children }: { children: ReactNode }) {
  const hid = useId();
  return (
    <section className="bh-step bh-step-1" aria-labelledby={hid}>
      <h2 className="bh-step-title" id={hid}>
        <span className="bh-step-n" aria-hidden="true">
          1
        </span>
        Build the basket <span className="bh-step-sub">name it, add names, weight them; Save computes everything below</span>
      </h2>
      {children}
    </section>
  );
}

/** Step 2 (§10): how the saved basket trades, or why it is not priced yet. */
function StepTwo({ local, params, q, state, range, setRange, names }: { local: SavedBasket | null; params: BasketParams | null; q: ReturnType<typeof useBasketPrice>; state: "loading" | "awaiting" | "ready"; range: BasketRange; setRange: (r: BasketRange) => void; names: Record<string, string | null> }) {
  const hid = useId();
  // desk/cap-weight: a cap-weighted basket waits for the stored share counts before it is asked.
  const why = !local
    ? "Open or start a basket to price it."
    : !local.legs.length
      ? "Add a ticker and save the basket to price it."
      : params
        ? null
        : weightingOf(local) === "cap" && sumsToHundred(local.legs)
          ? "Reading the stored share counts…"
          : "Save the basket with its weights at exactly 100% to price it.";
  return (
    <section className="bh-step" aria-labelledby={hid}>
      <div className="bh-step-head">
        <h2 className="bh-step-title" id={hid}>
          <span className="bh-step-n" aria-hidden="true">
            2
          </span>
          How the basket trades <span className="bh-step-sub">technicals against the Nasdaq and the S&amp;P, contribution, concentration, liquidity</span>
        </h2>
        {/* Codex R-08: each step carries its own answer's date. */}
        {q.data ? <LiveBadge className="bh-step-badge" parts={[q.data.provider ?? null, q.data.prices_as_of ? `prices ${dayShort(q.data.prices_as_of)}` : null]} /> : null}
      </div>
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
function StepThree({ local, params, q, priceAsOf, optionsBasket }: { local: SavedBasket | null; params: BasketParams | null; q: ReturnType<typeof useBasketHedge>; priceAsOf: string | null | undefined; optionsBasket: SavedBasket | null }) {
  const hid = useId();
  const priced = !!params;
  const state = q.data ? "ready" : q.isError || !priced ? "awaiting" : "loading";
  return (
    <section className="bh-step" aria-labelledby={hid}>
      <div className="bh-step-head">
        <h2 className="bh-step-title" id={hid}>
          <span className="bh-step-n" aria-hidden="true">
            3
          </span>
          Hedge it <span className="bh-step-sub">the closest ETF and what it does in a 10% fall, then options</span>
        </h2>
        {q.data ? <LiveBadge className="bh-step-badge" parts={[q.data.provider ?? null, q.data.prices_as_of ? `prices ${dayShort(q.data.prices_as_of)}` : null]} /> : null}
      </div>
      {!priced ? <p className="bh-why">A saved basket at exactly 100% is hedged here.</p> : null}
      {asOfMismatch(priceAsOf, q.data?.prices_as_of) ? (
        <p className="bh-why bh-mismatch" role="status">
          {asOfMismatch(priceAsOf, q.data?.prices_as_of)}
        </p>
      ) : null}
      {q.isError ? (
        <p className="bh-why" role="status">
          {`The hedge could not be computed: ${q.error.message}`}{" "}
          <button type="button" className="dk-link" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      <BasketHedgeStep h={q.data} state={state} basket={optionsBasket} />
      {/* §10, §1.0.3: Positioning and the event study, PROTOTYPE cards for the saved basket (none when none is open). */}
      {local?.legs.length ? (
        <div className="pr-below">
          <PositioningCard basket={local} held={optionsBasket ?? local} />
          <BasketStudyCard basket={local} />
        </div>
      ) : null}
    </section>
  );
}

export default function BasketHedgePage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  // A browser with no basket store at all starts with the preset (desk/books).
  const [saved, setSaved] = useState<SavedBasket[]>(() => {
    seedPreset();
    return readSaved();
  });
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
  const pendingAdd = search.get("add");
  const addDone = () =>
    setSearch(
      (prev) => {
        const q = new URLSearchParams(prev);
        q.delete("add");
        return q;
      },
      { replace: true },
    );
  const local = saved.find((b) => b.id === basketId) ?? null;
  // desk/cap-weight: the stored share counts decide whether the saved basket is asked cap-weighted (§12.18).
  const counts = shareCountsOf(useBasketShares());
  const params = priceParams(local, local ? capAvailability(local.legs.map((l) => l.symbol), counts) : undefined);
  const pq = useBasketPrice(params);
  const hq = useBasketHedge(params);
  const [range, setRange] = useState<BasketRange>("1y");
  const priced = pq.data;
  const state = pq.data ? "ready" : pq.isError ? "awaiting" : "loading";
  const names = Object.fromEntries((local?.legs ?? []).map((l) => [l.symbol, l.name]));
  // Send to Position Monitor records a cap-weighted basket at the cap weights last served for it (§9, §10): each
  // name's weight at the last close, kept on the saved basket when an answer for exactly its names arrives.
  useEffect(() => {
    if (!local || weightingOf(local) !== "cap" || priced?.weighting !== "cap" || !priced.legs || !priced.cap_weights || !priced.prices_as_of) return;
    if (!sameNames(priced.legs, local.legs) || !priced.legs.every((l) => finite(l.weight_now))) return;
    const snap: CapSnapshot = { as_of: priced.cap_weights.as_of, prices_as_of: priced.prices_as_of, weights: Object.fromEntries(priced.legs.map((l) => [l.symbol, l.weight_now as number])) };
    const was = local.cap_weights;
    if (was && was.as_of === snap.as_of && was.prices_as_of === snap.prices_as_of && local.legs.every((l) => was.weights[l.symbol] === snap.weights[l.symbol])) return;
    if (updateSaved({ ...local, cap_weights: snap }) === "ok") refresh();
    // refresh reads the store again; the effect runs once per answer and basket.
  }, [local, priced]);
  // The options PROTOTYPE sizes its single-name puts by the weights the basket holds: for a cap-weighted basket, the
  // served weights at the last close (§1.0.3; its outputs stay illustrative).
  const optionsBasket = local ? heldBasket(local, priced) : null;
  return (
    <div className="bh">
      <PageTitle page={page} badge={priced ? <LiveBadge boxed parts={[priced.provider ?? null, dayShort(priced.prices_as_of) || null]} /> : <NotServedBadge boxed />} />
      <StepOne>
        <BasketCard basketId={basketId} saved={saved} unreadable={unreadable} onSelect={select} onSaved={refresh} pendingAdd={pendingAdd} onAddDone={addDone} priced={pq.data} counts={counts} />
      </StepOne>
      <StepTwo local={local} params={params} q={pq} state={state} range={range} setRange={setRange} names={names} />
      <StepThree local={local} params={params} q={hq} priceAsOf={pq.data?.prices_as_of} optionsBasket={optionsBasket} />
    </div>
  );
}
