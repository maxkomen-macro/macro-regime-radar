/**
 * DeskRead — the executive decision strip that opens every major route
 * (2026-09-05). One surface answers, in order: what is happening (the
 * conclusion), why it matters, and a ledger of what changed / what to watch /
 * what would invalidate the call, with the evidence's freshness stated in
 * words. It replaces stacked banners that repeated one conclusion three ways.
 *
 * Layout: at desk width the conclusion and the ledger sit side by side; on a
 * phone the ledger stacks under the sentence. The 3px accent rail is the house
 * mark for model-composed output and appears here once per screen.
 */

import type React from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { assessFreshness, freshColor, freshGlyph, type FreshInfo } from "./freshness";
import { mono } from "./screen-ui";

export interface LedgerItem {
  label: string;
  value: React.ReactNode;
  /** Optional colour for the value (directional / status tokens only). */
  tone?: string;
  /** Mono for figures (default); sans for sentences. */
  prose?: boolean;
}

export interface FreshnessTag {
  noun: string;
  info: FreshInfo;
}

interface Props {
  /** Small mono eyebrow, e.g. "Desk read · Dashboard". */
  eyebrow: string;
  /** Pulses only when the underlying read is genuinely new / in cycle. */
  live?: boolean;
  /** Right-aligned chip text beside the eyebrow (conviction, regime tag…). */
  badge?: React.ReactNode;
  /** The one-sentence conclusion. IBM Plex Sans, 20px (TabHero replaces it in Phase 2). */
  conclusion: React.ReactNode;
  /** One or two sentences: why it matters / positioning implication. */
  why?: React.ReactNode;
  ledger?: LedgerItem[];
  freshness?: FreshnessTag[];
  /** Extra line under the chips (e.g. the impact sentence). */
  note?: React.ReactNode;
  id?: string;
}

export function FreshnessChip({ noun, info }: FreshnessTag) {
  const color = freshColor(info.state);
  // The state word is printed once (the coloured word); reference and
  // unavailable chips carry only the noun after it (review P3-1).
  const text =
    info.state === "reference" || info.state === "unavailable"
      ? noun
      : `${noun} · ${info.stamp}${info.state === "current" ? "" : ` · ${info.age} old`}`;
  return (
    <span
      title={`${noun}: ${info.word}${info.stamp ? ` · ${info.stamp}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...mono,
        fontSize: "var(--fs-meta)",
        color: "var(--text-2)",
        border: "0.5px solid var(--line)",
        borderRadius: "var(--r-xs)",
        padding: "3px 8px",
        maxWidth: "100%",
        flexWrap: "wrap",
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden="true" style={{ color, fontSize: 9 }}>
        {freshGlyph(info.state)}
      </span>
      <span style={{ color, fontWeight: 600 }}>{info.word}</span>
      <span style={{ color: "var(--text-muted)" }}>{text}</span>
    </span>
  );
}

export function Ledger({ items, compact = false }: { items: LedgerItem[]; compact?: boolean }) {
  return (
    <dl
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: compact ? "minmax(0,1fr)" : "auto minmax(0,1fr)",
        columnGap: 14,
        rowGap: 0,
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          style={{
            display: "contents",
          }}
        >
          <dt
            style={{
              ...mono,
              fontSize: "var(--fs-label)",
              textTransform: "uppercase",
              letterSpacing: "var(--ls-label)",
              color: "var(--text-label)",
              padding: compact ? "8px 0 0" : "7px 0",
              borderTop: i && !compact ? "0.5px solid var(--line-hair)" : "none",
              alignSelf: "baseline",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </dt>
          <dd
            style={{
              margin: 0,
              padding: compact ? "2px 0 8px" : "7px 0",
              borderTop: i && !compact ? "0.5px solid var(--line-hair)" : "none",
              borderBottom: compact && i < items.length - 1 ? "0.5px solid var(--line-hair)" : "none",
              fontFamily: it.prose ? "var(--font-ui)" : "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "var(--fs-body-s)",
              lineHeight: 1.5,
              color: it.tone ?? "var(--text)",
              minWidth: 0,
              textWrap: "pretty",
            }}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DeskRead({
  eyebrow,
  live = false,
  badge,
  conclusion,
  why,
  ledger,
  freshness,
  note,
  id,
}: Props) {
  const { isNarrow, bp } = useBreakpoint();
  const twoCol = bp === "wide" && (ledger?.length ?? 0) > 0;
  return (
    <section
      id={id}
      aria-label="Desk read"
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        padding: isNarrow ? "14px 14px 12px" : "18px 22px 16px",
        display: "grid",
        gridTemplateColumns: twoCol ? "minmax(0, 1.55fr) minmax(300px, 1fr)" : "minmax(0,1fr)",
        columnGap: 32,
        rowGap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: live ? "var(--pos)" : "var(--text-faint)",
                animation: live ? "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite" : "none",
              }}
            />
            <span
              style={{
                ...mono,
                fontSize: "var(--fs-label)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--ls-label)",
                color: "var(--text-label)",
              }}
            >
              {eyebrow}
            </span>
          </span>
          {badge ? <span style={{ flexShrink: 0 }}>{badge}</span> : null}
        </div>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: isNarrow ? "var(--fs-value)" : "var(--fs-lead)",
            fontWeight: 500,
            lineHeight: 1.35,
            color: "var(--text)",
            margin: 0,
            maxWidth: "36ch",
            letterSpacing: "-0.005em",
            textWrap: "pretty",
          }}
        >
          {conclusion}
        </h2>
        {why ? (
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body)",
              lineHeight: "var(--lh-body)",
              color: "var(--text-2)",
              margin: "10px 0 0",
              maxWidth: "var(--maxw-prose)",
              textWrap: "pretty",
            }}
          >
            {why}
          </p>
        ) : null}
        {(freshness?.length || note) && (
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {freshness?.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {freshness.map((f) => (
                  <FreshnessChip key={f.noun} noun={f.noun} info={f.info} />
                ))}
              </div>
            ) : null}
            {note ? (
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                  maxWidth: "var(--maxw-prose)",
                }}
              >
                {note}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {ledger?.length ? (
        <div
          style={{
            minWidth: 0,
            borderTop: twoCol ? "none" : "0.5px solid var(--line-hair)",
            borderLeft: twoCol ? "0.5px solid var(--line-hair)" : "none",
            paddingLeft: twoCol ? 24 : 0,
            paddingTop: twoCol ? 0 : 8,
          }}
        >
          <Ledger items={ledger} compact={isNarrow} />
        </div>
      ) : null}
    </section>
  );
}

/** Convenience for the common four-chip set built from /api/freshness. */
export function shellFreshness(f: {
  regimes_date?: string | null;
  signals_date?: string | null;
  market_daily_date?: string | null;
  market_intraday_ts?: string | null;
} | undefined): FreshnessTag[] {
  if (!f) return [];
  return [
    { noun: "Macro", info: assessFreshness(f.regimes_date, "monthly") },
    { noun: "Signals", info: assessFreshness(f.signals_date, "monthly") },
    { noun: "Market", info: assessFreshness(f.market_daily_date, "daily") },
  ];
}
