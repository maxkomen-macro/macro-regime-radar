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
 *
 * Deprecated (redesign Phase 2, 2026-09-15): TabHero (./TabHero.tsx) plus SummaryCard (./SummaryCard.tsx) replace this strip screen by screen in Phases 3 to 9; keep it untouched until then.
 */

import type React from "react";
import type { Freshness, SeriesState } from "../../api/types";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { REGIME_INPUT_IDS, SIGNAL_INPUT_IDS, groupLabel, lookupFrom, marketSeries, freshLabel, seededLabel, toneColor, toneGlyph, type FreshLabel } from "./fresh-state";
import { mono } from "./screen-ui";

export interface LedgerItem {
  label: string;
  value: React.ReactNode;
  /** Optional colour for the value (directional / status tokens only). */
  tone?: string;
  /** Mono for figures (default); sans for sentences. */
  prose?: boolean;
}

/** A freshness chip (Iteration 1 step 6, A3): the noun it names and the §5
 * label from fresh-state.ts. Nothing here judges an age. */
export interface FreshnessTag {
  noun: string;
  label: FreshLabel;
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

/** "Macro inputs: Jul 2026 · 1 release behind. Industrial production: …" */
export function chipTitle(noun: string, label: FreshLabel): string {
  return `${noun}: ${label.word}${label.muted ? ` ${label.muted}` : ""}${label.reason ? `. ${label.reason}` : ""}`;
}

/**
 * The chip prints the noun, then the §5 word or stamp (FRESHNESS_CONTRACT
 * §5, word for word), then the muted tail a FRED daily close carries. Only
 * a live state is mint; unknown is grey and never a health mark; a stale
 * state marks the word itself (`data-stale`). The server's reason sentence
 * is the tooltip.
 */
export function FreshnessChip({ noun, label }: FreshnessTag) {
  const color = toneColor(label.tone);
  return (
    <span
      className="mrr-fresh-chip"
      data-tone={label.tone}
      data-stale={label.stale ? "true" : undefined}
      title={chipTitle(noun, label)}
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
        {toneGlyph(label.tone)}
      </span>
      <span style={{ color: "var(--text-muted)" }}>{noun}</span>
      <span className="mrr-fresh-word" style={{ color, fontWeight: 600 }}>
        {label.word}
      </span>
      {label.muted ? <span style={{ color: "var(--text-muted)" }}>{label.muted}</span> : null}
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
        borderLeft: "3px solid var(--link)",
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
                background: live ? "var(--pos)" : "var(--text-4)",
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
                  <FreshnessChip key={f.noun} noun={f.noun} label={f.label} />
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

/**
 * The common three-chip set, read from /api/freshness `series[]` (A3): the
 * macro chip is the regime's monthly inputs (INDPRO, CPIAUCSL, UNRATE, the
 * weakest one's word), the signals chip the signals payload's own block when
 * served, and the market chip `live_quotes` during the session or the stored
 * daily close otherwise. A seeded report reads "Snapshot · as of …" on all
 * three; a series the report does not carry reads "As of unknown".
 */
export function shellFreshness(
  f: Freshness | undefined,
  opts: { seeded?: boolean; signalsBlock?: Record<string, SeriesState> | null } = {},
): FreshnessTag[] {
  if (!f) return [];
  if (opts.seeded) {
    const snap = seededLabel(f.generated_at);
    return [
      { noun: "Macro", label: snap },
      { noun: "Signals", label: snap },
      { noun: "Market", label: snap },
    ];
  }
  const inputs = f.regime?.inputs?.length ? f.regime.inputs.map((i) => i.series) : REGIME_INPUT_IDS;
  return [
    { noun: "Macro", label: groupLabel(lookupFrom(f), inputs) },
    { noun: "Signals", label: groupLabel(lookupFrom(f, opts.signalsBlock), SIGNAL_INPUT_IDS) },
    { noun: "Market", label: freshLabel(marketSeries(f)) },
  ];
}
