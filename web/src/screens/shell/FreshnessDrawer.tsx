/**
 * Freshness drawer (redesign Phase 1, spec §0.5): the per-source breakdown
 * behind the strip's "Freshness ›" trigger. A right-side panel on useModal
 * (focus trap, Escape, inert page, focus return), the same contract as the
 * alert drawer, so it is keyboard-reachable and readable at 390 px.
 *
 * The first block is the status chip, one sentence (the blocker, snapshot
 * or stored-close variants) and the §5 words for the macro inputs, the
 * market, the intraday bars and the live quotes (Iteration 1 step 6, A3:
 * every word from /api/freshness `series[]` through fresh-state.ts, never a
 * stamp aged in the browser). Below it: the overall verdict, one row per
 * feed (the SLA verdict columns it always had, its §5 state after the
 * verdict), one row
 * per series, the regime month and its inputs, the NYSE session, the live
 * relay and the data-service bootstrap. The bootstrap's `last_error` is
 * never printed (it could carry a URL).
 */

import { useRef, type ReactNode } from "react";
import type { SlaRow } from "../../api/types";
import { fmtDate, fmtMonYr, fmtUtcStampEt } from "../../lib/format";
import { freshLabel, toneColor, toneGlyph, type FreshLabel } from "../shared/fresh-state";
import ScrollTable from "../shared/ScrollTable";
import { useModal } from "../shared/useModal";
import {
  blockerCause,
  dbSizeMb,
  degradedReason,
  feedLabel,
  feedSeriesId,
  feedStateWord,
  fmtFeedStamp,
  sessionPhaseWord,
  SNAPSHOT_NOTE,
  STATUS_COLOR,
  STATUS_GLYPH,
  type ShellStatus,
} from "./shell-status";

/** "Macro inputs Aug 2026 print": the noun, then the §5 word in its tone
 * (the muted tail after it), the reason as the title. */
export function FreshWord({ label, noun }: { label: FreshLabel; noun: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }} title={label.reason || undefined} data-tone={label.tone} data-stale={label.stale ? "true" : undefined}>
      <span style={{ color: STATUS_COLOR.text3 }}>{noun} </span>
      <span style={{ color: toneColor(label.tone) }}>
        <span aria-hidden="true">{toneGlyph(label.tone)}</span> {label.word}
      </span>
      {label.muted ? <span style={{ color: STATUS_COLOR.text3 }}> {label.muted}</span> : null}
    </span>
  );
}

/** The SLA verdict words (FRESHNESS_CONTRACT §7, unchanged): a feed judged
 * against its SLA. A word outside the four reads "unavailable". */
const VERDICT_GLYPH: Record<string, string> = { current: "●", delayed: "▪", stale: "▾", unavailable: "×" };
const VERDICT_COLOR: Record<string, string> = {
  current: "var(--pos)",
  delayed: "var(--amber)",
  stale: "var(--warn-hot)",
  unavailable: "var(--neg-text)",
};

function Verdict({ state }: { state: string }) {
  const s = state in VERDICT_GLYPH ? state : "unavailable";
  return (
    <span style={{ color: VERDICT_COLOR[s], whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{VERDICT_GLYPH[s]}</span> {s}
    </span>
  );
}

/** One §5 word in a table cell: the word in its tone, the muted tail, the
 * stale mark on the cell itself. */
function StateCell({ label }: { label: FreshLabel }) {
  return (
    <span style={{ color: toneColor(label.tone), whiteSpace: "nowrap" }} data-tone={label.tone} data-stale={label.stale ? "true" : undefined}>
      <span aria-hidden="true">{toneGlyph(label.tone)}</span> {label.word}
      {label.muted ? <span style={{ color: STATUS_COLOR.text3 }}> {label.muted}</span> : null}
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

  const { f, statusWord, macroLabel, marketLabel, dailyLabel, intradayLabel, liveLabel, seededLabel } = status;

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

  // One sentence under the chip, in the §5 words (A3): the snapshot note, the
  // server's blocker note, and the stored-close line when the close is
  // behind the bell; otherwise the macro inputs and the market words.
  const words = `The regime's monthly inputs read ${macroLabel.word}${macroLabel.muted ? ` ${macroLabel.muted}` : ""}; market data reads ${marketLabel.word}${marketLabel.muted ? ` ${marketLabel.muted}` : ""}.`;
  const parts = [
    statusWord === "Validated snapshot" ? SNAPSHOT_NOTE : null,
    seededLabel ? `${seededLabel.word}: every state is unknown until the live freshness report replaces it.` : null,
    status.storedCloseLine,
    status.blockerNote ?? (seededLabel ? null : words),
  ].filter((x): x is string => Boolean(x));
  const baseSentence = parts.join(" ");
  const sentence = suffixRest ? `${suffixRest.charAt(0).toUpperCase()}${suffixRest.slice(1)}. ${baseSentence}` : baseSentence;
  const seriesRows = status.series;

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
                  <FreshWord noun="Macro inputs" label={macroLabel} />
                  <FreshWord noun="Stored close" label={dailyLabel} />
                  <FreshWord noun="Intraday" label={intradayLabel} />
                  <FreshWord noun="Live quotes" label={liveLabel} />
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
                      <th scope="col">State</th>
                      <th scope="col">Latest</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sla.map((row) => {
                      // The §5 word for the series this feed describes;
                      // regime, signals and news carry no per-series state.
                      const id = feedSeriesId(row.feed);
                      const series = id ? seriesRows.find((x) => x.id === id) : undefined;
                      return (
                      <tr key={row.feed}>
                        <td className="feed">{feedLabel(row.feed, regime)}</td>
                        <td>
                          <Verdict state={row.verdict} />
                        </td>
                        <td>{seededLabel ? <StateCell label={seededLabel} /> : id ? <StateCell label={freshLabel(series)} /> : "—"}</td>
                        <td>{fmtFeedStamp(row.feed, row.latest, regime)}</td>
                        <td>{fmtFeedStamp(row.feed, row.expected, regime)}</td>
                        <td className="reason">{row.reason}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            </Block>
          ) : null}

          {seriesRows.length ? (
            <Block title="Series" wide>
              {/* One row per source in /api/freshness series[], the §5 word
                  as the headline and the server's reason beside it. */}
              <ScrollTable label="Series freshness">
                <table className="mrr-fresh-table" data-testid="fresh-series-table">
                  <thead>
                    <tr>
                      <th scope="col">Series</th>
                      <th scope="col">State</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seriesRows.map((row) => (
                      <tr key={row.id} data-series={row.id}>
                        <td className="feed">
                          {row.label}
                          {row.label !== row.id ? <span style={{ color: STATUS_COLOR.text3 }}> · {row.id}</span> : null}
                        </td>
                        <td>
                          <StateCell label={seededLabel ?? freshLabel(row)} />
                        </td>
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
