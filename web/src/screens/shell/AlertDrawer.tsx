/**
 * Alert drawer — full alert history off /api/alerts, opened from the header
 * trigger. The trigger itself (badge count / all-clear line) is rendered by
 * AppShell; this file owns the panel.
 */

import { useEffect, useRef } from "react";
import { AlertRow, SectionHeader } from "../../components";
import { useAlerts } from "../../api/queries";
import { daysSince, fmtDate } from "../../lib/format";

export default function AlertDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const alerts = useAlerts(200);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.(); // return focus to the alerts trigger
    };
  }, [open, onClose]);

  if (!open) return null;

  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= 7);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="alert-drawer" role="dialog" aria-modal="true" aria-label="Alert feed">
        <div style={{ padding: "16px 16px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-label)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--ls-wide)",
                color: "var(--text-label)",
              }}
            >
              Alert feed
            </span>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close alert feed"
              style={{
                appearance: "none",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 14,
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              color: recent.length ? "var(--text-muted)" : "var(--pos)",
              margin: "10px 0 0",
            }}
          >
            {alerts.isLoading
              ? "Loading alert history —"
              : alerts.isError
                ? "Alert feed unavailable — API error."
                : recent.length
                  ? `${recent.length} alert${recent.length === 1 ? "" : "s"} in the last 7 days`
                  : rows.length
                    ? `✓ All clear — no alerts in 7 days. Last alert ${fmtDate(rows[0].date)}.`
                    : "No alerts on file — the feed starts with the first threshold breach."}
          </div>

          {rows.length > 0 && (
            <>
              <SectionHeader
                title="Full history"
                right={`${rows.length} on file`}
                style={{ marginTop: 20 }}
              />
              <div style={{ display: "grid", gap: 6 }}>
                {rows.map((a) => (
                  <AlertRow
                    key={a.id}
                    level={a.level}
                    name={a.name}
                    message={a.message ?? undefined}
                    date={a.date}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
