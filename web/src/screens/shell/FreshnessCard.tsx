/**
 * Freshness card (redesign Phase 1, spec §0.5 / §2): the strip's last card.
 * Two lines, one per data layer, each with a coloured dot, and a "Freshness ›"
 * trigger that opens the per-source breakdown drawer. It replaces the header
 * freshness sentence, which now lives in the drawer verbatim.
 *
 * Honest freshness (Iteration 1 step 6, A3): both lines print the §5 word
 * the server judged (/api/freshness `series[]` through fresh-state.ts). The
 * market line reads `live_quotes` during the session and the stored daily
 * close otherwise ("Markets · Close · Sep 18", or "Markets · Sep 14 · 4
 * sessions behind"); the macro line reads the regime's monthly inputs
 * ("Macro monthly · Aug 2026 print"). Only a live state glows; unknown is
 * grey. A seeded snapshot reads "Snapshot · as of …" with no health dot.
 * Each line is one status line (G4): the reasons live in the titles and
 * the drawer.
 */

import type { ReactNode } from "react";
import { useQuotes } from "../../live/quotes";
import { etClock, labelText, liveFeedsWord, newestTickMs, STATUS_COLOR, toneDotColor, type ShellStatus } from "./shell-status";

/** ET wall clock of the newest websocket tick; its own leaf so the 2 Hz
 * quote store repaints only this text. */
function LiveClock() {
  const quotes = useQuotes();
  const t = newestTickMs(quotes);
  return <>{t != null ? etClock(t) : "now"}</>;
}

function Dot({ color, glow = false }: { color: string; glow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="mrr-upd-dot"
      style={{ background: color, boxShadow: glow ? "var(--glow-dot, 0 0 10px rgba(38,220,160,.7))" : "none" }}
    />
  );
}

interface Props {
  status: ShellStatus;
  open: boolean;
  onOpen: () => void;
}

export default function FreshnessCard({ status, open, onOpen }: Props) {
  const { statusWord, f, marketLabel, macroLabel, seededLabel } = status;

  // G4 (Iteration 1 step 5): each card line is one rendered line at every
  // width. The connection detail (the session word, a degraded reason, the
  // ticking feeds) rides in the line's hover title and stays verbatim in the
  // drawer's status line.
  const suffixWords = status.liveSuffix.replace(/^ · /, "");
  const connection = suffixWords ? `${suffixWords}. ${status.statusTitle}` : status.statusTitle;
  let line1: ReactNode;
  let title1 = connection;
  let dot1: string;
  let glow = false;
  if (statusWord === "Validated snapshot") {
    line1 = `Validated snapshot${status.snapshotDate}`;
    dot1 = STATUS_COLOR.text4; // no health dot on a snapshot (A3)
  } else if (statusWord === "Backend unavailable") {
    line1 = "Data service unavailable";
    dot1 = STATUS_COLOR.neg;
  } else if (f) {
    const live = marketLabel.tone === "live";
    line1 = (
      <>
        Markets · {labelText(marketLabel)}
        {live ? (
          <>
            {" · "}
            {status.liveFeeds.us ? null : `${liveFeedsWord(status.liveFeeds)} · `}
            <LiveClock />
          </>
        ) : null}
      </>
    );
    title1 = marketLabel.reason ? `${marketLabel.reason} ${connection}` : connection;
    dot1 = toneDotColor(marketLabel);
    glow = live;
  } else if (status.freshnessError) {
    line1 = "Markets · As of unknown";
    dot1 = STATUS_COLOR.text4;
  } else {
    line1 = "Markets · reading…";
    dot1 = STATUS_COLOR.text4;
  }

  const noDots = Boolean(seededLabel) || statusWord === "Validated snapshot";

  // Data on hand wins (the old status line's rule): the error copy shows only
  // when no freshness report exists at all.
  let line2: ReactNode;
  let title2: string | undefined;
  let dot2: string;
  if (f && seededLabel) {
    line2 = seededLabel.word;
    title2 = "Every state in a seeded snapshot is unknown until the live freshness report replaces it.";
    dot2 = STATUS_COLOR.text4;
  } else if (f) {
    line2 = `Macro monthly · ${labelText(macroLabel)}`;
    title2 = macroLabel.reason || undefined;
    dot2 = toneDotColor(macroLabel);
  } else if (status.freshnessError) {
    line2 = "Freshness unavailable · retrying";
    dot2 = STATUS_COLOR.neg;
  } else {
    line2 = "Reading freshness…";
    dot2 = STATUS_COLOR.text3;
  }

  return (
    <div className="mrr-upd">
      {/* G4 (Iteration 1 step 5): each line is one status line
          (`data-copy="status"`), one rendered line at every width; the
          per-source detail is the drawer's. */}
      <div className="mrr-upd-lines">
        {/* A seeded snapshot carries no health dot at all (§5): its states
            are unknown until the live report replaces it. */}
        <small title={title1} data-copy="status" data-tone={f && !seededLabel && statusWord !== "Validated snapshot" && statusWord !== "Backend unavailable" ? marketLabel.tone : undefined}>
          {noDots ? null : <Dot color={dot1} glow={glow} />}
          {line1}
        </small>
        <small className="mrr-upd-macro" title={title2} data-copy="status" data-tone={f && !seededLabel ? macroLabel.tone : undefined}>
          {noDots ? null : <Dot color={dot2} />}
          {line2}
        </small>
      </div>
      <button
        type="button"
        className="mrr-fresh-link"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="freshness-drawer"
        title="Per-source freshness: each feed, the regime month and the NYSE session"
      >
        Freshness ›
      </button>
    </div>
  );
}
