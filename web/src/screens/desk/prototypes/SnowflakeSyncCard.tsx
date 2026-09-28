/**
 * Data Pipeline's "Sync to Snowflake" as a PROTOTYPE card (DESK_FRAME3_SPEC
 * §11, §1.0.3): the flow connect → stage → merge → verify, each step with
 * what it does and how long it took, and a table of every table's row
 * counts: staged, merged, in Snowflake after, in the snapshot, and whether
 * they match. It opens on the last run; "Sync to Snowflake" replays the four
 * steps (at once under reduced motion). Nothing connects anywhere: the values
 * are proto-snowflake-sync.json's (./snowflake-sync.ts). The real "Generate
 * Snowflake DDL" and "Export → CSV" stay on the bridge card beside it.
 */

import { useEffect, useRef, useState } from "react";
import { grouped } from "../kit/format";
import { PrototypeCard } from "../kit/Prototype";
import { AdvancedPanel, useAdvanced } from "../kit/ui";
import { prototype } from "./registry";
import { mergedWords, sync } from "./snowflake-sync";
import "./prototypes.css";

const S = sync();
/** Milliseconds a replay spends per second a step took. */
const PACE = 300;

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SnowflakeSyncCard() {
  const adv = useAdvanced();
  const entry = prototype("snowflake-sync");
  // The step running (0–3), or 4 when the run is complete; it opens on the last run.
  const [phase, setPhase] = useState(S.steps.length);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const run = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (reducedMotion()) return setPhase(S.steps.length);
    setPhase(0);
    let at = 0;
    S.steps.forEach((s, i) => {
      at += s.seconds * PACE;
      timers.current.push(window.setTimeout(() => setPhase(i + 1), at));
    });
  };
  const done = phase >= S.steps.length;
  const after = (step: number) => phase > step;
  const wait = <span className="pr-muted">…</span>;
  return (
    <PrototypeCard
      id={entry.id}
      className="pr-sync"
      title={entry.title}
      sub="the snapshot into the proposed schema, one job a day"
      production={entry.production}
      headExtra={
        <button type="button" className="dk-btn pr-sync-btn" data-kind="light" onClick={run} disabled={!done}>
          {done ? "Sync to Snowflake" : "Syncing…"}
        </button>
      }
      advanced={
        <AdvancedPanel enabled adv={adv} items="each step's statement · how a MART table is swapped in · what verify compares">
          <dl className="pr-assume">
            <div>
              <dt>Connect</dt>
              <dd>
                key-pair auth as {S.target.role} on {S.target.warehouse}, database {S.target.database}
              </dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>the rows changed since the last sync, written as Parquet and PUT to {S.target.stage}</dd>
            </div>
            <div>
              <dt>Merge</dt>
              <dd>MERGE INTO each RAW and CUR table on its key (a new key inserted, a changed value updated); each MART table built beside the live one, then swapped in</dd>
            </div>
            <div>
              <dt>Verify</dt>
              <dd>COUNT(*) and HASH_AGG(*) per table against the same query on the SQLite snapshot; a mismatch fails the job and publishes nothing</dd>
            </div>
          </dl>
        </AdvancedPanel>
      }
    >
      <p className="pr-sync-target">
        {S.target.account} · {S.target.database} · warehouse {S.target.warehouse} · role {S.target.role}
      </p>
      <ol className="pr-steps">
        {S.steps.map((s, i) => {
          const state = i < phase ? "done" : i === phase ? "running" : "pending";
          return (
            <li key={s.key} data-state={state}>
              <p className="dk-stat-label">
                <span className="pr-step-mark" aria-hidden="true">
                  {state === "done" ? "✓" : state === "running" ? "●" : "○"}
                </span>{" "}
                {i + 1} · {s.label}
              </p>
              <p className="pr-step-detail">{s.detail}</p>
              <p className="pr-step-time">{state === "done" ? `${s.seconds.toFixed(1)} s` : state === "running" ? "running" : "waiting"}</p>
            </li>
          );
        })}
      </ol>
      <div className="pr-table-wrap" role="region" aria-label="Row counts, table by table" tabIndex={0}>
        <table className="pr-table">
          <thead>
            <tr>
              <th scope="col">Table</th>
              <th scope="col" className="pr-left">
                Key
              </th>
              <th scope="col">Staged</th>
              <th scope="col">Merged</th>
              <th scope="col">Rows in Snowflake</th>
              <th scope="col">Rows in the snapshot</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {S.tables.map((t) => (
              <tr key={t.table}>
                <th scope="row">{t.table}</th>
                <td className="pr-left pr-muted">{t.key}</td>
                <td>{after(1) ? grouped(t.staged) : wait}</td>
                <td>{after(2) ? mergedWords(t) : wait}</td>
                <td>{after(2) ? grouped(t.rowsAfter) : wait}</td>
                <td>{grouped(t.sourceRows)}</td>
                <td>{after(3) ? <span data-tone={t.matches ? "green" : "red"}>{t.matches ? "match" : "differs"}</span> : wait}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pr-sync-status" role="status">
        {done
          ? `Verified: ${S.matched} of ${S.tables.length} tables match the snapshot · ${grouped(S.staged)} rows staged · ${S.seconds.toFixed(1)} s on ${S.target.warehouse}`
          : `Syncing: ${S.steps[phase].label.toLowerCase()}…`}
      </p>
    </PrototypeCard>
  );
}
