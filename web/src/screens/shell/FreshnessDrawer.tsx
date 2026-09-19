/**
 * Freshness drawer (redesign Phase 1, spec §0.5): the per-source breakdown
 * behind the strip's "Freshness ›" trigger. A right-side panel on useModal
 * (focus trap, Escape, inert page, focus return), the same contract as the
 * alert drawer, so it is keyboard-reachable and readable at 390 px.
 *
 * The first block is the old header freshness sentence, verbatim: the status
 * chip, the impact sentence (or the blocker / snapshot variants) and the
 * dated Macro / Signals / Market / Intraday words. Below it: the overall
 * verdict, one row per feed from /api/freshness, the regime month and its
 * inputs, the NYSE session, the live relay and the data-service bootstrap.
 * The bootstrap's `last_error` is never printed (it could carry a URL).
 */

import { useRef, type ReactNode } from "react";
import type { SlaRow } from "../../api/types";
import { fmtDate, fmtMonYr, fmtUtcStampEt } from "../../lib/format";
import ScrollTable from "../shared/ScrollTable";
import { freshColor, freshGlyph, impactSentence, type FreshInfo, type FreshState } from "../shared/freshness";
import { useModal } from "../shared/useModal";
import {
  blockerCause,
  dbSizeMb,
  degradedReason,
  feedLabel,
  feedStateWord,
  fmtFeedStamp,
  sessionPhaseWord,
  SNAPSHOT_NOTE,
  STATUS_COLOR,
  STATUS_GLYPH,
  type ShellStatus,
} from "./shell-status";

/** Coloured "Macro Jul 2026 current" word, unchanged from the old header. */
export function FreshWord({ info, noun }: { info: FreshInfo; noun: string }) {
  const color = freshColor(info.state);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: STATUS_COLOR.text3 }}>{noun} </span>
      <span style={{ color: "var(--text-2)" }}>{info.stamp || "—"}</span>{" "}
      <span style={{ color }}>
        {info.state === "current" ? "current" : info.state === "unavailable" ? "unavailable" : `${info.age} old`}
      </span>
    </span>
  );
}

function Verdict({ state }: { state: FreshState | string }) {
  const s = (["current", "delayed", "stale", "unavailable", "reference"].includes(state) ? state : "unavailable") as FreshState;
  return (
    <span style={{ color: freshColor(s), whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{freshGlyph(s)}</span> {s}
    </span>
  );
}

/** One titled block. `wide` spans both columns once the drawer is wide enough
 * to set the key-value blocks two-up (M4); the others take one column. */
function Block({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? "mrr-fresh-block mrr-fresh-block-wide" : "mrr-fresh-block"}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mrr-fresh-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function yesNo(v: boolean | null | undefined): string {
  return v == null ? "—" : v ? "yes" : "no";
}

function stampOrDash(v: string | null | undefined): string {
  return v ? fmtUtcStampEt(v) : "—";
}

interface Props {
  open: boolean;
  onClose: () => void;
  status: ShellStatus;
}

export default function FreshnessDrawer({ open, onClose, status }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModal(open, panelRef, { onClose, initialFocus: closeRef });

  if (!open) return null;

  const { f, statusWord, macroFresh, marketFresh, signalsFresh, intradayFreshInfo, signalsDiffer, streamLive } = status;

  // G4 (Iteration 1 step 5): the summary line is one rendered line at 390 px.
  // It keeps the status word and the ticking feeds ("crypto/FX only"); the
  // rest of the old suffix (the session word or a degraded reason) opens the
  // sentence under it, verbatim.
  const suffixWords = status.liveSuffix.replace(/^ · /, "").split(" · ").filter(Boolean);
  const chipSuffix = suffixWords[0]?.endsWith(" only") ? ` · ${suffixWords[0]}` : "";
  const suffixRest = (chipSuffix ? suffixWords.slice(1) : suffixWords).join(" · ");
  const statusChip = (
    <span title={status.statusTitle} style={{ color: status.statusColor, whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{STATUS_GLYPH[statusWord] ?? "▪"}</span> {statusWord}
      {chipSuffix}
      {status.snapshotDate}
    </span>
  );

  const baseSentence =
    statusWord === "Validated snapshot"
      ? `${SNAPSHOT_NOTE} ${impactSentence(macroFresh, marketFresh, false)}`
      : (status.blockerNote ?? impactSentence(macroFresh, marketFresh, streamLive));
  const sentence = suffixRest ? `${suffixRest.charAt(0).toUpperCase()}${suffixRest.slice(1)}. ${baseSentence}` : baseSentence;

  const sla: SlaRow[] = f?.sla ?? [];
  const relay = f?.relay ?? null;
  const session = f?.session ?? null;
  const regime = f?.regime ?? null;
  const bootstrap = f?.bootstrap ?? null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        ref={panelRef}
        id="freshness-drawer"
        className="mrr-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="freshness-drawer-title"
        tabIndex={-1}
      >
        <div className="mrr-drawer-body">
          <div className="mrr-drawer-head">
            <h2 id="freshness-drawer-title" className="mrr-drawer-title">
              Data freshness
            </h2>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close data freshness"
              title="Close · Esc"
              className="mrr-chip-btn"
              style={{ border: "none", color: STATUS_COLOR.text3, fontSize: 16, minWidth: 32, justifyContent: "center" }}
            >
              ×
            </button>
          </div>

          {/* The old header freshness sentence, verbatim. */}
          <div role="status" aria-label="Data freshness" className="mrr-fresh-status">
            {f ? (
              <>
                {/* The drawer's summary line (G4: one rendered line). */}
                <div data-copy="status">{statusChip}</div>
                <p style={{ margin: 0, color: "var(--text-2)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", lineHeight: 1.55, textWrap: "pretty" }}>
                  {sentence}
                </p>
                <div className="mrr-fresh-words">
                  <FreshWord noun="Macro" info={macroFresh} />
                  {signalsDiffer ? <FreshWord noun="Signals" info={signalsFresh} /> : null}
                  <FreshWord noun="Market" info={marketFresh} />
                  {f.market_intraday_ts ? <FreshWord noun="Intraday" info={intradayFreshInfo} /> : null}
                </div>
              </>
            ) : (
              <div className="mrr-fresh-words">
                {status.freshnessError ? statusChip : null}
                <span>
                  {status.freshnessError
                    ? "The data service did not answer; stored screens stay readable and this line retries."
                    : "Reading freshness…"}
                </span>
              </div>
            )}
          </div>

          {f?.overall ? (
            <Block title="Overall" wide>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                <Verdict state={f.overall} />
                <span style={{ color: STATUS_COLOR.text3 }}> · worst verdict across the model's feeds</span>
              </div>
            </Block>
          ) : null}

          {sla.length ? (
            <Block title="Feeds" wide>
              <ScrollTable label="Feed freshness">
                <table className="mrr-fresh-table">
                  <thead>
                    <tr>
                      <th scope="col">Feed</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">Latest</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sla.map((row) => (
                      <tr key={row.feed}>
                        <td className="feed">{feedLabel(row.feed, regime)}</td>
                        <td>
                          <Verdict state={row.verdict} />
                        </td>
                        <td>{fmtFeedStamp(row.feed, row.latest, regime)}</td>
                        <td>{fmtFeedStamp(row.feed, row.expected, regime)}</td>
                        <td className="reason">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            </Block>
          ) : null}

          {regime ? (
            <Block title="Regime month">
              <KV
                rows={[
                  ["Latest month", regime.latest_month ? fmtMonYr(regime.latest_month) : "—"],
                  ["Expected month", regime.expected_month ? fmtMonYr(regime.expected_month) : "—"],
                  ["Common feature month", regime.common_feature_month ? fmtMonYr(regime.common_feature_month) : "—"],
                ]}
              />
              {regime.inputs?.length ? (
                <ul className="mrr-fresh-list" aria-label="Regime inputs">
                  {regime.inputs.map((i) => (
                    <li key={i.series}>
                      {i.label} · latest {i.latest_month ? fmtMonYr(i.latest_month) : "—"} · expected {fmtMonYr(i.expected_month)} ·{" "}
                      <Verdict state={i.verdict} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {regime.blockers?.length ? (
                <ul className="mrr-fresh-list" aria-label="Regime blockers" style={{ marginTop: 8 }}>
                  {regime.blockers.map((b) => (
                    <li key={b.series}>
                      {b.label} ({blockerCause(b.cause)})
                    </li>
                  ))}
                </ul>
              ) : null}
            </Block>
          ) : null}

          {session ? (
            <Block title="NYSE session">
              <KV
                rows={[
                  ["Exchange", session.exchange],
                  ["Phase", sessionPhaseWord(session.phase)],
                  ["Market", session.is_open ? "Open" : "Closed"],
                  ["Today", session.today_is_trading_day ? (session.early_close ? "trading day · early close" : "trading day") : "not a trading day"],
                  ["Last completed session", session.last_completed_session ? fmtDate(session.last_completed_session) : "—"],
                  ["Next open", session.next_open_utc ? fmtUtcStampEt(session.next_open_utc) : "—"],
                  ["Calendar", session.calendar_known ? "known" : "trading calendar unknown"],
                  ["Local time", session.local_time || "—"],
                ]}
              />
            </Block>
          ) : null}

          {relay ? (
            <Block title="Live relay">
              <KV
                rows={[
                  ...(["us", "crypto", "forex", "vix"] as const)
                    .filter((k) => relay.feeds[k] != null)
                    .map<[string, ReactNode]>((k) => [
                      k === "us" ? "US equities" : k === "forex" ? "FX" : k === "vix" ? "VIX" : "Crypto",
                      `${feedStateWord(relay.feeds[k])}${relay.feed_stale?.[k] ? " · silent" : ""}`,
                    ]),
                  ["Degraded", relay.degraded ? (degradedReason(relay.degraded_reasons) ?? "a feed is degraded") : "no"],
                  ...(relay.token_configured ? [] : [["Token", "EODHD token not configured on the server; quotes are stored closes"] as [string, ReactNode]]),
                ]}
              />
            </Block>
          ) : null}

          {bootstrap ? (
            <Block title="Data service">
              <KV
                rows={[
                  ["Token configured", yesNo(bootstrap.token_configured)],
                  ["Last result", bootstrap.last_result ?? "—"],
                  ["Last download", stampOrDash(bootstrap.last_downloaded_at)],
                  ["Asset updated", stampOrDash(bootstrap.asset_updated_at)],
                  ["Database written", stampOrDash(bootstrap.db_mtime)],
                  ["Database size", dbSizeMb(bootstrap.db_size)],
                ]}
              />
            </Block>
          ) : null}

          {f?.generated_at ? <div className="mrr-drawer-foot">Report generated {fmtUtcStampEt(f.generated_at)}</div> : null}
        </div>
      </div>
    </>
  );
}
