/**
 * Data Pipeline's top-bar badge (DESK_FRAME3_SPEC §11): the last full refresh
 * and whether it validated, in the toggle's place. Its own module so the shell
 * can show it without loading the page.
 */

import { usePipeline } from "../data/api";
import { dayShort, utcTime } from "../kit/format";

/** "Sep 22, 00:23 UTC" from the served refresh time. */
export function refreshWords(iso: string | null | undefined): string {
  const t = utcTime(iso);
  const d = typeof iso === "string" ? dayShort(iso.slice(0, 10)) : "";
  return d && t ? `${d}, ${t}` : "";
}

/** The top bar's badge (§11): the last full refresh and whether it validated. */
export function PipelineBadge({ testId = "pl-badge" }: { testId?: string }) {
  const q = usePipeline();
  const p = q.data;
  const when = refreshWords(p?.last_refresh_utc);
  const validation = typeof p?.validation === "string" && p.validation ? p.validation : null;
  // Nothing to say without either; a failed validation shows even when the refresh time is missing (D-2).
  if (!p || (!when && !validation)) return null;
  const passed = validation === "passed";
  return (
    <span className="dk-live dk-live-boxed pl-badge" data-tone={passed ? undefined : "amber"} data-testid={testId}>
      <span className="dk-dot" aria-hidden="true" />
      {[`Last full refresh ${when || "—"}`, validation ? `validation ${validation}` : null].filter(Boolean).join(" · ")}
    </span>
  );
}

