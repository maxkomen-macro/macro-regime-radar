/**
 * The stored-close notice (Iteration 1 step 6, A3; FRESHNESS_CONTRACT §5
 * "Stored close behind the bell"): when /api/freshness says `market_daily`
 * is stale, every route says so in plain words, once, under the top bar:
 *
 *   "The newest stored close is Sep 14; the Sep 18 close is not stored yet."
 *
 * Both dates come from the server (`market_daily.as_of` and the session's
 * last completed day); nothing is aged here. The line is a status line (G4,
 * `data-copy="status"`): one rendered line at every width. Below 768 px the
 * phone form ("Stored close Sep 14; Sep 18 not stored yet.") is the visible
 * line and the full sentence stays for screen readers; the server's reason
 * is the title, and the drawer carries the rest. A seeded snapshot prints
 * nothing here (its states are unknown until the live report arrives).
 */

import type { ShellStatus } from "./shell-status";

export default function StoredCloseNotice({ status }: { status: ShellStatus }) {
  const full = status.storedCloseLine;
  if (!full) return null;
  const short = status.storedCloseShort ?? full;
  return (
    <div
      className="mrr-close-notice"
      role="status"
      data-copy="status"
      data-testid="stored-close-notice"
      data-stale="true"
      title={status.dailyLabel.reason || undefined}
    >
      <span aria-hidden="true" className="mrr-close-glyph">
        ▾
      </span>
      <span className="mrr-close-full">{full}</span>
      <span className="mrr-close-short" aria-hidden="true">
        {short}
      </span>
    </div>
  );
}
