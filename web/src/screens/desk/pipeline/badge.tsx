/**
 * Data Pipeline's top-bar badge (DESK_FRAME3_SPEC §11): the last full refresh
 * and whether it validated, in the toggle's place. Its own module so the shell
 * can show it without loading the page.
 */

import { usePipeline } from "../data/api";
import { dayShort, utcTime } from "../kit/format";
import { useMixedGenerations } from "../data/generations";

/** "Sep 22, 00:23 UTC" from the served refresh time. */
export function refreshWords(iso: string | null | undefined): string {
  const t = utcTime(iso);
  const d = typeof iso === "string" ? dayShort(iso.slice(0, 10)) : "";
  return d && t ? `${d}, ${t}` : "";
}

/** The served verdict in the header's words: pass → "passed", fail → "failed", not served → "unknown" (§11). */
export function validationWord(v: unknown): "passed" | "failed" | "unknown" {
  return v === "pass" ? "passed" : v === "fail" ? "failed" : "unknown";
}

/** The top bar's badge (§11): "● Last full refresh <when> · validation <passed|failed>", "unknown" for either part not served. */
export function PipelineBadge({ testId = "pl-badge" }: { testId?: string }) {
  const q = usePipeline();
  const p = q.data;
  // §1.1 (Codex R-22): this is Data Pipeline's page badge, so it says so when the page's answers disagree.
  const mixed = useMixedGenerations();
  if (mixed)
    return (
      <span className="dk-live dk-live-off dk-live-boxed pl-badge" data-testid="dk-gen-mixed">
        <span className="dk-dot dk-dot-off" aria-hidden="true" />
        mixed generations · refreshing
      </span>
    );
  if (!p) return null;
  const when = refreshWords(p.last_refresh_utc) || "unknown";
  const validation = validationWord(p.validation);
  return (
    <span className="dk-live dk-live-boxed pl-badge" data-tone={validation === "passed" ? undefined : "amber"} data-testid={testId}>
      <span className="dk-dot" aria-hidden="true" />
      {`Last full refresh ${when} · validation ${validation}`}
    </span>
  );
}

