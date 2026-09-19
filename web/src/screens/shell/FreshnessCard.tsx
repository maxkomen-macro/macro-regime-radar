/**
 * Freshness card (redesign Phase 1, spec §0.5 / §2): the strip's last card.
 * Two lines, one per data layer, each with a coloured dot, and a "Freshness ›"
 * trigger that opens the per-source breakdown drawer. It replaces the header
 * freshness sentence, which now lives in the drawer verbatim.
 *
 * Honest freshness: "Markets live" prints only when the status word is Live,
 * and names its feeds when the US tape is quiet; the macro line always says
 * "monthly" with the month it is on. Never call monthly data live. Each line
 * is one status line (G4): the long words live in the drawer.
 */

import type { ReactNode } from "react";
import { useQuotes } from "../../live/quotes";
import { fmtMonYr } from "../../lib/format";
import { etClock, freshDotColor, liveFeedsWord, marketStamp, newestTickMs, STATUS_COLOR, type ShellStatus } from "./shell-status";

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
  const { statusWord, f } = status;

  // G4 (Iteration 1 step 5): each card line is one rendered line at every
  // width (the card is ~220px of text at 768). The line keeps the status word,
  // the feeds when the US tape is quiet, and the stamp; the rest of the old
  // line (the session word, a degraded reason, "last …") moves to the line's
  // hover title and stays verbatim in the drawer's status line.
  const suffixWords = status.liveSuffix.replace(/^ · /, "");
  let line1: ReactNode;
  let title1 = status.statusTitle;
  let dot1: string;
  let glow = false;
  switch (statusWord) {
    case "Live":
      line1 = (
        <>
          Markets live · {status.liveFeeds.us ? null : `${liveFeedsWord(status.liveFeeds)} · `}
          <LiveClock />
        </>
      );
      if (suffixWords) title1 = `${suffixWords}. ${status.statusTitle}`;
      dot1 = STATUS_COLOR.mint;
      glow = true;
      break;
    case "Delayed":
    case "Off":
      line1 = `Markets delayed · ${marketStamp(f)}`;
      if (suffixWords) title1 = `${suffixWords}. ${status.statusTitle}`;
      dot1 = STATUS_COLOR.amber;
      break;
    case "Reconnecting":
      line1 = "Markets reconnecting";
      title1 = `Last ${marketStamp(f)}. ${status.statusTitle}`;
      dot1 = STATUS_COLOR.text3;
      break;
    case "Validated snapshot":
      line1 = `Validated snapshot${status.snapshotDate}`;
      dot1 = STATUS_COLOR.amber;
      break;
    default:
      line1 = "Data service unavailable";
      dot1 = STATUS_COLOR.neg;
  }

  // Data on hand wins (the old status line's rule): the error copy shows only
  // when no freshness report exists at all.
  let line2: ReactNode;
  let dot2: string;
  if (f?.regimes_date) {
    line2 = `Macro monthly · latest ${fmtMonYr(f.regimes_date)}`;
    dot2 = freshDotColor(status.macroFresh.state);
  } else if (status.freshnessError) {
    line2 = "Freshness unavailable · retrying";
    dot2 = STATUS_COLOR.neg;
  } else if (status.freshnessLoading || !f) {
    line2 = "Reading freshness…";
    dot2 = STATUS_COLOR.text3;
  } else {
    line2 = "Macro monthly · no stamp on file";
    dot2 = STATUS_COLOR.neg;
  }

  return (
    <div className="mrr-upd">
      {/* G4 (Iteration 1 step 5): each line is one status line
          (`data-copy="status"`), one rendered line at every width; the
          per-source detail is the drawer's. */}
      <div className="mrr-upd-lines">
        <small title={title1} data-copy="status">
          <Dot color={dot1} glow={glow} />
          {line1}
        </small>
        <small className="mrr-upd-macro" data-copy="status">
          <Dot color={dot2} />
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
