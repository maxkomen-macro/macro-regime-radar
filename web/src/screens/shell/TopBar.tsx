/**
 * Top bar (redesign Phase 1, spec §2): the 368 px palette trigger in the
 * centre column and, on the right, the "Ask the analyst" chip followed by the
 * alerts bell. No avatar (decision 6). The transitional regime pill and odds
 * bar that filled the left cell left in Phase 10 (checklist 10 B.8, QUESTIONS
 * 4): every tab's summary card carries the regime row, and the regime's
 * loading and unavailable words live in the hero states. The bell and the
 * chip must stay inside this <header>: the e2e harvest finds them by
 * `header button[...]`.
 */

import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { useAlerts } from "../../api/queries";
import { BellIcon, SearchIcon } from "./nav-icons";
import { alertSummary, STATUS_COLOR } from "./shell-status";

/** The bell. Its accessible name carries the whole alert sentence; the count
 * badge shows only when there were breaches in the last 7 days; and it never
 * asserts "no alerts" before the feed has answered (2026-09-05 rule). The
 * sentence comes from `alertSummary` (shell-status.ts), the same reading the
 * Dashboard's status strip prints, so the two can never disagree. */
export function AlertsTrigger({ onOpen, open = false }: { onOpen: () => void; open?: boolean }) {
  const alerts = useAlerts(200);
  const { state, recent, sentence } = alertSummary(alerts);
  const pending = state === "loading" || state === "error";
  const worst = recent.some((a) => a.level === "risk")
    ? STATUS_COLOR.neg
    : recent.some((a) => a.level === "watch")
      ? STATUS_COLOR.amber
      : "var(--link)";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mrr-bell"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={sentence}
      title={sentence}
      // An empty feed ("none") keeps the "clear" value this attribute always carried.
      data-state={state === "none" ? "clear" : state}
      style={{ color: state === "error" ? STATUS_COLOR.hot : pending ? STATUS_COLOR.text3 : undefined }}
    >
      <BellIcon />
      <span className="sr-only">Alerts</span>
      {state === "recent" ? (
        <span className="mrr-bell-count" aria-hidden="true" style={{ color: worst }}>
          {recent.length}
        </span>
      ) : null}
    </button>
  );
}

interface TopBarProps {
  paletteOpen: boolean;
  onOpenPalette: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  assistantLauncherRef: RefObject<HTMLButtonElement>;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}

export default function TopBar({
  paletteOpen,
  onOpenPalette,
  assistantOpen,
  onToggleAssistant,
  assistantLauncherRef,
  drawerOpen,
  onOpenDrawer,
}: TopBarProps) {
  return (
    <header className="mrr-top">
      {/* The Desk entry (desk/frame §1): an understated text link in the left
          track, never a tab; below 860 the MobileNav list carries it. */}
      <Link to="/desk" className="mrr-desk-entry" title="Open the analyst workspace">
        Analyst Workspace <span className="arrow" aria-hidden="true">→</span>
      </Link>
      <button
        type="button"
        onClick={onOpenPalette}
        className="mrr-search"
        aria-haspopup="dialog"
        aria-expanded={paletteOpen}
        title="Jump to any tab or section · ⌘K (Mac) / Ctrl+K"
      >
        <SearchIcon />
        <span className="mrr-search-text">Jump to a tab or section…</span>{" "}
        <kbd>
          {/* The command glyph lives in the system face: Plex Mono has no ⌘. */}
          <span className="mrr-cmd-glyph">⌘</span> K
        </kbd>
      </button>
      <div className="mrr-top-r">
        <button
          ref={assistantLauncherRef}
          type="button"
          onClick={onToggleAssistant}
          className="mrr-ask"
          aria-expanded={assistantOpen}
          aria-controls="assistant-panel"
          title="Ask the analyst about the data on this screen"
        >
          <span aria-hidden="true" className="mrr-ask-glyph">◆</span> Ask the analyst
        </button>
        <AlertsTrigger onOpen={onOpenDrawer} open={drawerOpen} />
      </div>
    </header>
  );
}
