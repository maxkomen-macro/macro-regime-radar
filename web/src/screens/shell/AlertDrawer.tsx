/**
 * Alert drawer — full alert history off /api/alerts, opened from the header
 * trigger. The trigger itself (badge count / all-clear line) is rendered by
 * AppShell; this file owns the panel.
 *
 * 2026-09-05: every row is composed by alert-copy.ts into institutional
 * language (what tripped, why it matters, when, whether it is still active,
 * the threshold and margin, a severity word); the raw pipeline string never
 * renders. Modal behaviour (focus trap, inert page, Escape, focus return)
 * comes from useModal.
 */

import { useMemo, useRef } from "react";
import { SectionHeader } from "../../components";
import { useAlerts, useSignalsLatest } from "../../api/queries";
import { daysSince, fmtDate, fmtMonYr } from "../../lib/format";
import { useModal } from "../shared/useModal";
import { mono } from "../shared/screen-ui";
import { describeAlert } from "./alert-copy";
import type { Alert } from "../../api/types";

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--link)",
  watch: "var(--amber)",
  risk: "var(--neg-text)",
};

function AlertItem({ alert, latest }: { alert: Alert; latest: ReturnType<typeof describeAlert> }) {
  const color = LEVEL_COLOR[alert.level] ?? "var(--link)";
  return (
    <li
      style={{
        listStyle: "none",
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderLeft: `3px solid ${color}`,
        borderRadius: "var(--r-xs)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--text)" }}>
          {latest.title}
        </span>
        <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {latest.when}
        </span>
      </div>
      {/* The row's status line (G4: one rendered line): severity and state. */}
      <div data-copy="status" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap", lineHeight: 1.5 }}>
        <span
          style={{
            ...mono,
            fontSize: "var(--fs-micro)",
            fontWeight: 600,
            letterSpacing: "var(--ls-micro)",
            textTransform: "uppercase",
            color,
          }}
        >
          {latest.severity}
        </span>
        <span
          style={{
            ...mono,
            fontSize: "var(--fs-micro)",
            letterSpacing: "var(--ls-micro)",
            textTransform: "uppercase",
            color: latest.active ? "var(--neg-text)" : "var(--text-muted)",
          }}
        >
          {latest.active == null ? "Status unknown" : latest.active ? "● Still active" : "Cleared"}
        </span>
      </div>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          lineHeight: 1.55,
          color: "var(--text-2)",
          margin: "6px 0 0",
          textWrap: "pretty",
        }}
      >
        {latest.trigger} {latest.status}
      </p>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-caption)",
          lineHeight: 1.55,
          color: "var(--text-muted)",
          margin: "4px 0 0",
          textWrap: "pretty",
        }}
      >
        {latest.why}
      </p>
    </li>
  );
}

export default function AlertDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const alerts = useAlerts(200);
  const signals = useSignalsLatest();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModal(open, panelRef, { onClose, initialFocus: closeRef });

  const latestBySignal = useMemo(
    () => new Map((signals.data?.signals ?? []).map((s) => [s.signal_name, s])),
    [signals.data],
  );

  if (!open) return null;

  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= 7);
  const newest = rows[0];
  const quietDays = newest ? Math.floor(daysSince(newest.date)) : null;
  // G4 (Iteration 1 step 5): the status line is one rendered line at every
  // width; how long the feed has been quiet, and what fired last, is the
  // sentence under it, unchanged.
  const statusNote = alerts.isLoading
    ? null
    : alerts.isError
      ? "The data service did not answer."
      : recent.length
        ? null
        : newest
          ? `The feed has been quiet for ${quietDays} days; the last alert was ${describeAlert(newest, latestBySignal.get(newest.name)).title} in ${fmtMonYr(newest.date)}.`
          : "The feed starts with the first threshold breach.";

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className="alert-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-drawer-title"
        aria-describedby={statusNote ? "alert-drawer-status alert-drawer-note" : "alert-drawer-status"}
        tabIndex={-1}
      >
        <div style={{ padding: "16px 16px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2
              id="alert-drawer-title"
              style={{
                ...mono,
                fontSize: "var(--fs-label)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "var(--ls-label)",
                color: "var(--text-label)",
                margin: 0,
              }}
            >
              Alert feed
            </h2>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close alert feed"
              title="Close · Esc"
              className="mrr-chip-btn"
              style={{ border: "none", color: "var(--text-muted)", fontSize: 16, minWidth: 32, justifyContent: "center" }}
            >
              ×
            </button>
          </div>

          <p
            id="alert-drawer-status"
            data-copy="status"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body-s)",
              lineHeight: 1.55,
              color: recent.length ? "var(--text)" : "var(--text-2)",
              margin: "10px 0 0",
              textWrap: "pretty",
            }}
          >
            {alerts.isLoading
              ? "Loading alert history…"
              : alerts.isError
                ? "Alert feed unavailable."
                : recent.length
                  ? `${recent.length} threshold breach${recent.length === 1 ? "" : "es"} in the last 7 days.`
                  : newest
                    ? "No threshold breaches in the last 7 days."
                    : "No alerts on file."}
          </p>
          {statusNote ? (
            <p
              id="alert-drawer-note"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                lineHeight: 1.55,
                color: "var(--text-2)",
                margin: "4px 0 0",
                textWrap: "pretty",
              }}
            >
              {statusNote}
            </p>
          ) : null}
          {!alerts.isLoading && !alerts.isError ? (
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                lineHeight: 1.5,
                color: "var(--text-muted)",
                margin: "6px 0 0",
              }}
            >
              Alerts fire when a monitored signal crosses its trigger in the monthly signal print. Each
              entry states the print, the trigger, and whether the condition still holds today.
            </p>
          ) : null}

          {rows.length > 0 && (
            <>
              <SectionHeader
                title="Full history"
                right={`${rows.length} on file · latest ${fmtDate(rows[0].date)}`}
                style={{ marginTop: 20 }}
              />
              <ul style={{ display: "grid", gap: 6, margin: 0, padding: 0 }}>
                {rows.map((a) => (
                  <AlertItem key={a.id} alert={a} latest={describeAlert(a, latestBySignal.get(a.name))} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
