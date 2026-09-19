/**
 * Inline renderers for a §5 label (Iteration 1 step 6, A3,
 * docs/redesign-v2/FRESHNESS_CONTRACT.md §5): `FreshText` prints the word or
 * stamp with its muted tail and the server's reason as the title;
 * `StaleNumber` puts the stale mark on the number itself (the contract's
 * "amber-to-red mark on the number, using `stale: true`, not only a
 * freshness word"). Neither judges an age: they print what fresh-state.ts
 * returned for the state the server served.
 */

import type { ReactNode } from "react";
import { toneColor, type FreshLabel } from "./fresh-state";

export function FreshText({ label, color = true }: { label: FreshLabel; color?: boolean }) {
  return (
    <span
      className="mrr-fresh-text"
      data-fresh-tone={label.tone}
      data-stale={label.stale ? "true" : undefined}
      title={label.reason || undefined}
      style={color ? { color: toneColor(label.tone) } : undefined}
    >
      {label.word}
      {label.muted ? <span style={{ color: "var(--text-3)" }}> {label.muted}</span> : null}
    </span>
  );
}

/** The number, marked when its series reads stale; untouched otherwise. */
export function StaleNumber({ label, children }: { label: FreshLabel | null | undefined; children: ReactNode }) {
  if (!label?.stale) return <>{children}</>;
  return (
    <span className="mrr-stale-num" data-stale="true" title={`${label.word}${label.muted ? ` ${label.muted}` : ""}${label.reason ? `. ${label.reason}` : ""}`}>
      {children}
    </span>
  );
}
