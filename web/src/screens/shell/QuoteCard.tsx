/**
 * Quote card (redesign Phase 1, spec §2): one 54 px strip card with the
 * symbol, the price, the 1D change and an 80×26 sparkline. A delayed or
 * stored read carries a small mono tag (15M, CLOSE, 1W) so the reader is
 * never told a stored close is the tape. The card flashes for 600 ms when the
 * price ticks (the TickerStrip idiom), silenced under reduced motion by the
 * `[style*="mrr-flash"]` rule in app.css.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkline } from "../../components";

export interface QuoteTag {
  text: string;
  title?: string;
  /** amber for delayed or stored reads, muted for timeframe notes. */
  tone?: "amber" | "muted";
}

export interface QuoteCardProps {
  /** Rendered uppercase; the harvester records it as an eyebrow. */
  symbol: string;
  /** Formatted price, or "—" only when no price exists anywhere. */
  price: string;
  /** Numeric price for the tick flash. */
  raw?: number;
  change?: string;
  /** Direction, not valence: green is up, red is down, for yields too. */
  changeTone?: "pos" | "neg";
  tag?: QuoteTag;
  /** Oldest to newest; fewer than two points renders an empty box. */
  series?: number[];
  title?: string;
}

const TONE_COLOR = {
  pos: "var(--pos, #28d17c)",
  neg: "var(--neg, #f0503f)",
  flat: "var(--text-3, var(--text-muted))",
} as const;

export default function QuoteCard({ symbol, price, raw, change, changeTone, tag, series, title }: QuoteCardProps) {
  const prev = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = raw;
    if (before === undefined || raw === undefined || before === raw) return;
    setFlash(raw > before ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [raw]);

  const color = changeTone ? TONE_COLOR[changeTone] : TONE_COLOR.flat;
  return (
    <div
      className="mrr-quote"
      data-symbol={symbol}
      title={title}
      style={flash ? { animation: `mrr-flash-${flash} var(--tick-flash) var(--ease-out)` } : undefined}
    >
      {/* The inner span is load-bearing: the label-parity harvester reads
          uppercase eyebrows from span/div/p/small/dd/td, never from <b>, and
          text-transform inherits, so the span is what keeps SPY / QQQ / US 10Y
          in the baseline set. */}
      <b>
        <span>{symbol}</span>
      </b>
      <span className="v">{price}</span>
      <span className="c" style={change ? { color } : undefined}>
        {change ?? ""}
      </span>
      {tag ? (
        <span className="mrr-tag" data-tone={tag.tone ?? "amber"} title={tag.title}>
          {tag.text}
        </span>
      ) : null}
      <Sparkline values={series ?? []} width={80} height={26} color={color} />
    </div>
  );
}
