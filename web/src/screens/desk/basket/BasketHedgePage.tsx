/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10, screens/09-basket-hedge.png):
 * UNAVAILABLE (§1.0): basket pricing and option structures are not yet
 * defined in the engine (v2 D-25–D-28). What stays is the analyst's own
 * work, kept in this browser (§1.8): the baskets, their legs as typed
 * weights (Equal-weight, Normalize to 100%, × to drop, a ticker to add),
 * Save basket and Export / Import JSON. The stats, the residual chart, the
 * beta read and the whole hedge keep their titles and labels and print
 * §1.0's reason (§1.0.2); nothing is priced and nothing is asked of the
 * server. Send to Position Monitor carries the basket as a manual subject
 * (§9).
 */

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PageTitle } from "../DeskTopBar";
import type { DeskPage } from "../desk-sections";
import { AdvancedPanel, Card, NotServedBadge, Stat, StatRow, Unserved, UnservedLine, useAdvanced } from "../kit/ui";
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

/** §1.0: the block has no served envelope for a basket kept in the browser, so the page prints §1.0's reason (§1.0.2). */
export const BASKET_UNAVAILABLE = { reason: "Basket pricing and option structures are not yet defined in the engine.", until: null } as const;

/** The hedge's three modes (§10: the labels are kept). */
export const MODES = ["Protect the basket", "Express the S&P lean", "Neutralize NDX beta"] as const;

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
  const adv = useAdvanced();
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
          {/* §1.4: what Advanced promises (the rebalance rule, the index since inception) is not served: disabled. */}
          <AdvancedPanel adv={adv} items="rebalance rule · index since inception" />
        </div>
      }
    >
      {/* §10: the stats keep their labels with no number, and the reason is printed (§1.0.2). */}
      <Unserved block={BASKET_UNAVAILABLE}>
        <StatRow cols={3}>
          {["3-month", "vs NDX · residual", "Basket vol"].map((l) => (
            <Stat key={l} label={l} />
          ))}
        </StatRow>
      </Unserved>
      <UnservedLine block={BASKET_UNAVAILABLE} className="bh-unserved" />
      <Legs key={basketId ?? ""} legs={legs} onChange={(l) => setWork(l)} empty={empty} />
      {/* §10: the chart's title kept for an open basket; its reason is the one printed above (§1.0.2: one sentence). */}
      {local ? <p className="bh-chart-title">{`Is the ${local.name} bet working?`}</p> : null}
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

/** The hedge (§10): title, subtitle and the three mode labels kept; the reason printed; no structures, no ratio, no scenarios. */
function HedgeCard() {
  const adv = useAdvanced();
  return (
    <Card className="bh-card bh-hedge" title="Hedge · express or protect" sub="priced off the SPY / QQQ surface" unavailable={BASKET_UNAVAILABLE} footer={<AdvancedPanel adv={adv} items="full chain · greeks · roll dates · what the hedge does under −10% / −20%" />}>
      <div className="bh-modes" role="group" aria-label="Hedge mode">
        {MODES.map((m) => (
          <button key={m} type="button" disabled>
            {m}
          </button>
        ))}
      </div>
      <StatRow cols={3}>
        {["Hedge ratio", "Cost of waiting", "Roll"].map((l) => (
          <Stat key={l} label={l} />
        ))}
      </StatRow>
    </Card>
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
  return (
    <div className="bh">
      <PageTitle page={page} badge={<NotServedBadge boxed />} />
      <div className="bh-grid">
        <BasketCard basketId={basketId} saved={saved} unreadable={unreadable} onSelect={select} onSaved={refresh} />
        <HedgeCard />
      </div>
    </div>
  );
}
