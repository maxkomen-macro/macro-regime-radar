/**
 * InstrumentSearch (desk/usability, item 1): the Desk's stock search. It is
 * the main dashboard's SymbolSearch over the same /api/market/search, asked
 * for US-listed equities and ETFs only (`scope=us`, primary listings first),
 * in the Desk's colors. Suggestions come on the first keystroke with the
 * ticker and the name; the arrow keys and Enter, or a click, pick one. When
 * the search does not answer, it offers the instruments this store prices
 * from its own closes (GET /api/desk/instruments), matched on the ticker or
 * the name.
 *
 * Two uses: uncontrolled in the Desk header (a pick opens Technicals for
 * that stock), and controlled as the Position Monitor's instrument field,
 * where the box keeps what is typed or picked. Branch desk/books adopts it
 * on the basket page.
 */

import { useState } from "react";
import SymbolSearch from "../../markets/SymbolSearch";
import type { SearchHit } from "../../../api/types";
import { useInstruments } from "../data/api";
import type { Instrument } from "../data/types";
import { cx } from "./ui";

/** The stored instruments that match the text: tickers that start with it, then names with a word that does. */
export function storedMatches(list: readonly Instrument[], text: string): SearchHit[] {
  const t = text.trim().toUpperCase();
  if (!t) return [];
  const ticker = (i: Instrument) => i.symbol.toUpperCase().startsWith(t) || i.symbol.replace(/^\^/, "").toUpperCase().startsWith(t);
  const named = (i: Instrument) => i.name.toUpperCase().startsWith(t) || i.name.toUpperCase().split(/[\s/-]+/).some((w) => w.startsWith(t));
  return [...list.filter(ticker), ...list.filter((i) => !ticker(i) && named(i))].map((i) => ({ symbol: i.symbol, name: i.name, exchange: "US", type: i.kind === "index" ? "Index" : "ETF", sector: null, primary: true }));
}

export function InstrumentSearch({
  onSelect,
  value,
  onTextChange,
  inputId,
  ariaLabel,
  placeholder = "Search a US stock or ETF…",
  dense = false,
  className,
  autoFocus = false,
}: {
  onSelect: (hit: SearchHit) => void;
  /** Controlled text (the Position Monitor's instrument field). */
  value?: string;
  onTextChange?: (text: string) => void;
  inputId?: string;
  ariaLabel?: string;
  placeholder?: string;
  dense?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  // The stored list is asked for once something is typed: a page that never searches never asks.
  const [typed, setTyped] = useState(false);
  const stored = useInstruments({ enabled: typed || !!value });
  const list = Array.isArray(stored.data?.instruments) ? stored.data.instruments : [];
  return (
    <SymbolSearch
      className={cx("dk-isearch", className)}
      scope="us"
      fallback={(text) => storedMatches(list, text)}
      fallbackNote="Search did not answer · series this store prices"
      onSelect={onSelect}
      value={value}
      onTextChange={(text) => {
        if (text.trim()) setTyped(true);
        onTextChange?.(text);
      }}
      inputId={inputId}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      dense={dense}
      autoFocus={autoFocus}
      maxWidth="none"
    />
  );
}

export default InstrumentSearch;
