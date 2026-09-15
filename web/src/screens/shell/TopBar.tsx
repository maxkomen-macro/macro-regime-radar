/**
 * Top bar (redesign Phase 1, spec §2): the transitional regime pill and odds
 * bar in the left cell (checklist row 13, kept until every tab's summary card
 * carries the regime row), the 368 px palette trigger in the centre, and on
 * the right the "Ask the analyst" chip followed by the alerts bell. No avatar
 * (decision 6). The bell and the chip must stay inside this <header>: the
 * e2e harvest finds them by `header button[...]`.
 */

import type { RefObject } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ProbabilityBar, RegimeBadge } from "../../components";
import { useAlerts } from "../../api/queries";
import type { Regime } from "../../api/types";
import { daysSince, fmtDate, fmtMonYr } from "../../lib/format";
import { mono } from "../shared/screen-ui";
import { BellIcon, SearchIcon } from "./nav-icons";
import { regimeProbs, STATUS_COLOR } from "./shell-status";

/** Regime badge with the stored dominant probability and, at desk width, the
 * 4 px four-way odds bar. Rendered by the top bar and by MobileNav's row. */
export function RegimePill({ regime, compact = false }: { regime: UseQueryResult<Regime>; compact?: boolean }) {
  const { probs, dominantProb } = regimeProbs(regime.data);
  if (!regime.data) {
    return (
      <span className="mrr-regime-note" style={{ ...mono, fontSize: "var(--fs-body-s)", color: STATUS_COLOR.text3 }}>
        {regime.isError ? "Regime unavailable: API error" : "Reading regime…"}
      </span>
    );
  }
  return (
    <span className="mrr-regime">
      <span
        title={`Current regime: ${regime.data.label} at ${Math.round((dominantProb ?? 0) * 100)}% model odds · macro data ${fmtMonYr(regime.data.date)}`}
      >
        <RegimeBadge label={regime.data.label} size="sm" confidence={dominantProb} />
      </span>
      {!compact && probs ? <ProbabilityBar probs={probs} height={4} showLegend={false} style={{ width: 160 }} /> : null}
    </span>
  );
}

/** The bell. Its accessible name carries the whole alert sentence; the count
 * badge shows only when there were breaches in the last 7 days; and it never
 * asserts "no alerts" before the feed has answered (2026-09-05 rule). */
export function AlertsTrigger({ onOpen, open = false }: { onOpen: () => void; open?: boolean }) {
  const alerts = useAlerts(200);
  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= 7);
  const worst = recent.some((a) => a.level === "risk")
    ? STATUS_COLOR.neg
    : recent.some((a) => a.level === "watch")
      ? STATUS_COLOR.amber
      : "var(--link)";
  const last = rows[0];
  const pending = alerts.isLoading || alerts.isError;
  const title = pending
    ? alerts.isError
      ? "Alert feed unavailable. Open the alert feed."
      : "Reading the alert feed. Open the alert feed."
    : recent.length
      ? `${recent.length} threshold breach${recent.length === 1 ? "" : "es"} in the last 7 days. Open the alert feed.`
      : last
        ? `No threshold breaches in the last 7 days. Last alert ${fmtDate(last.date)}. Open the alert feed.`
        : "No alerts on file. Open the alert feed.";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mrr-bell"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={title}
      title={title}
      data-state={pending ? (alerts.isError ? "error" : "loading") : recent.length ? "recent" : "clear"}
      style={{ color: alerts.isError ? STATUS_COLOR.hot : pending ? STATUS_COLOR.text3 : undefined }}
    >
      <BellIcon />
      <span className="sr-only">Alerts</span>
      {!pending && recent.length ? (
        <span className="mrr-bell-count" aria-hidden="true" style={{ color: worst }}>
          {recent.length}
        </span>
      ) : null}
    </button>
  );
}

interface TopBarProps {
  regime: UseQueryResult<Regime>;
  /** Below 860 px the pill lives in MobileNav's row, so the left cell is omitted. */
  compact: boolean;
  paletteOpen: boolean;
  onOpenPalette: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  assistantLauncherRef: RefObject<HTMLButtonElement>;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}

export default function TopBar({
  regime,
  compact,
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
      {!compact ? (
        <div className="mrr-top-l">
          <RegimePill regime={regime} />
        </div>
      ) : null}
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
