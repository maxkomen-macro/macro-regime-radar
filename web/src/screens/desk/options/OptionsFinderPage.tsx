/**
 * The Options Finder (Options Finder Build Plan step 5; engine finder-2): one view on one stock (it rises or falls
 * to a target by a date, with a budget) against one end-of-day options chain, priced on request by
 * /api/desk/options/finder. The page shows the summary with every screen's drop count, the three lens cards, the
 * payoff chart drawn from the served curve, the events in the way, the sortable table and the disclosure footer.
 *
 * Every number on the page is a served number, spelled (kit/format); the browser only sorts the served rows. The
 * thesis lives in the address (?symbol=…&view=…&target=…&by=…&budget=…), so a run can be linked, and the page asks
 * only for a complete thesis. Quotes are a session's close, so the badge names that session and never says Live.
 *
 * Unlisted (./flag.ts): with the flag off the page is marked Preview and noindex, and nothing links to it.
 */

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useOptionsFinder, type DeskApiError } from "../data/api";
import type { OptionRow, OptionsFinderParams, OptionsFinderResponse, ScenarioPnl } from "../data/types";
import type { DeskPage } from "../desk-sections";
import { PageTitle } from "../DeskTopBar";
import { Card, StampBadge } from "../kit/ui";
import { DESK_ACCENTS } from "../kit/palette";
import { useWidth } from "../kit/LineChart";
import { MINUS, NOT_SERVED, dayLong, dayShort, grouped, isFiniteNumber, num, pctPlain, priceText, signed } from "../kit/format";
import { OPTIONS_FINDER_LISTED } from "./flag";
import { FRAMING, LENSES, MARKET_IMPLIED, NOT_DEPLOYED, OCC_URL, PRICER_WORDS, SCREEN_WORDS, TIMING_WORDS, kindWord, viewWord } from "./finder-copy";
import "./options.css";

// ── The thesis in the address ─────────────────────────────────────────────

/** The address's keys. The direction is `direction` there, because `view` is the Desk / Client toggle's key on every
 * Desk page (desk-view.ts); the request names it `view`, as the route does. */
export const REQUIRED_KEYS = ["symbol", "direction", "target", "by", "budget"] as const;
export const OPTIONAL_KEYS = ["min_oi", "max_spread", "fill", "scan_months", "commission"] as const;
const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
const API_KEY: Readonly<Record<string, string>> = { direction: "view" };

/** The request the address names, or null until every required value is there. Values go as typed: the server
 * judges them and says what is wrong. */
export function paramsOf(search: URLSearchParams): OptionsFinderParams | null {
  const out: Record<string, string> = {};
  for (const k of ALL_KEYS) {
    const v = search.get(k);
    if (v !== null && v.trim() !== "") out[API_KEY[k] ?? k] = v.trim();
  }
  if (REQUIRED_KEYS.some((k) => !out[API_KEY[k] ?? k])) return null;
  return out as OptionsFinderParams;
}

type Draft = Record<(typeof ALL_KEYS)[number], string>;

function draftOf(search: URLSearchParams): Draft {
  const d = Object.fromEntries(ALL_KEYS.map((k) => [k, search.get(k) ?? ""])) as Draft;
  if (!d.direction) d.direction = "up";
  return d;
}

/** The address for a thesis: the values as typed, the symbol in capitals, empty optional values left out, and the
 * Desk / Client key kept. */
export function searchOf(draft: Draft, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const deskView = prev.get("view");
  if (deskView) next.set("view", deskView);
  for (const k of ALL_KEYS) {
    const v = (draft[k] ?? "").trim();
    if (v) next.set(k, k === "symbol" ? v.toUpperCase() : v);
  }
  return next;
}

// ── Spelling served numbers ───────────────────────────────────────────────

/** Dollars, two decimals, grouped: 4985.75 → "$4,985.75"; signed for a P&L: "+$36,228.50", "−$4,985.75". */
export function money(x: number | null | undefined, withSign = false): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const body = `$${grouped(Math.abs(x), 2)}`;
  if (Number(Math.abs(x).toFixed(2)) === 0) return body;
  return x < 0 ? `${MINUS}${body}` : withSign ? `+${body}` : body;
}

const price = (x: number | null | undefined) => (isFiniteNumber(x) ? `$${priceText(x)}` : NOT_SERVED);

/** An option's price per share: cents, or the decimals the served price carries, up to four ($0.90, $0.875). */
export function premium(x: number | null | undefined): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const d = [2, 3, 4].find((k) => Number(x.toFixed(k)) === x) ?? 4;
  return grouped(x, d);
}
const frac = (x: number | null | undefined, digits = 1) => (isFiniteNumber(x) ? pctPlain(x, digits) : NOT_SERVED);

/** "Dec 18" when the expiry falls in the thesis date's year, else "Mar 19, 2027". */
function expiryText(exp: string, by: string | undefined): string {
  return by && exp.slice(0, 4) === by.slice(0, 4) ? dayShort(exp) : dayLong(exp);
}

function contractText(r: OptionRow, by: string | undefined): string {
  return `${expiryText(r.exp, by)} ${price(r.strike)} ${kindWord(r.type)}`;
}

function lifeText(r: OptionRow): string {
  return r.days_past_date === 0 ? "expires on your date" : `${r.days_past_date} days past your date`;
}

/** How the value on the date was priced, in words; each scenario's own when they differ. */
function onDateWords(r: OptionRow): string {
  const on = r.model.on_date;
  if (typeof on === "string") return PRICER_WORDS[on] ?? on;
  return [...new Set(Object.values(on).map((m) => (m ? (PRICER_WORDS[m] ?? m) : "")))].filter(Boolean).join("; ");
}

// ── The answer's states ───────────────────────────────────────────────────

export type FinderState = "idle" | "loading" | "answered" | "empty" | "not-entitled" | "not-deployed" | "awaiting" | "refused" | "failed";

/** What a failed request means for the page: the route not deployed yet (a bare 404 from an API without it), options
 * outside the data plan (403), not served on this generation (awaiting), a refusal with its words, or no answer. */
export function failureOf(err: DeskApiError): {
  state: FinderState;
  words: string;
} {
  if (err.status === 404 && err.body === null) return { state: "not-deployed", words: NOT_DEPLOYED };
  if (err.awaiting) return { state: "awaiting", words: err.message };
  if (err.status === 403 || err.body?.error === "unauthorized")
    return {
      state: "not-entitled",
      words: `Options quotes are not in the data plan on this server, so the Finder cannot price this view. ${err.message}`,
    };
  if (err.status === 0 || err.status >= 500 || err.status === 429) return { state: "failed", words: err.message };
  return { state: "refused", words: err.message };
}

// ── The form ──────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="of-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint ? <span className="of-hint">{hint}</span> : null}
    </div>
  );
}

function ThesisForm({ search, onRun }: { search: URLSearchParams; onRun: (d: Draft) => void }) {
  const key = search.toString();
  const [draft, setDraft] = useState<Draft>(() => draftOf(search));
  const [advanced, setAdvanced] = useState(() => OPTIONAL_KEYS.some((k) => search.get(k)));
  useEffect(() => setDraft(draftOf(new URLSearchParams(key))), [key]);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onRun(draft);
  };
  const input =
    (k: keyof Draft, props: Record<string, unknown> = {}) =>
    (id: string) => <input id={id} className="of-input" value={draft[k]} onChange={set(k)} {...props} />;
  return (
    <Card title="Your view" className="of-card" as="section">
      <form className="of-form" onSubmit={submit} aria-label="Your view">
        <div className="of-row">
          <Field label="Stock or ETF">
            {input("symbol", {
              autoComplete: "off",
              spellCheck: false,
              placeholder: "SPY",
            })}
          </Field>
          <Field label="Direction">
            {(id) => (
              <div className="dk-select">
                <select id={id} value={draft.direction} onChange={set("direction")}>
                  <option value="up">Rises to the target (calls)</option>
                  <option value="down">Falls to the target (puts)</option>
                </select>
              </div>
            )}
          </Field>
          <Field label="Target price, dollars">{input("target", { inputMode: "decimal" })}</Field>
          <Field label="By">{input("by", { type: "date" })}</Field>
          <Field label="Budget, dollars">{input("budget", { inputMode: "decimal" })}</Field>
          <div className="of-actions">
            <button type="submit" className="dk-btn" data-kind="primary" data-testid="of-run">
              Price the chain
            </button>
          </div>
        </div>
        <button type="button" className="dk-link of-adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          Screens and costs {advanced ? "▾" : "▸"}
        </button>
        {advanced ? (
          <div className="of-row of-adv" data-testid="of-advanced">
            <Field label="Least open interest" hint="contracts; the server's default when empty">
              {input("min_oi", { inputMode: "numeric" })}
            </Field>
            <Field label="Widest spread" hint="a share of the mid: 0.1 is 10%">
              {input("max_spread", { inputMode: "decimal" })}
            </Field>
            <Field label="Fill">
              {(id) => (
                <div className="dk-select">
                  <select id={id} value={draft.fill} onChange={set("fill")}>
                    <option value="">The ask (default)</option>
                    <option value="ask">The ask</option>
                    <option value="mid">The mid</option>
                  </select>
                </div>
              )}
            </Field>
            <Field label="Months of expiries" hint="past your date">
              {input("scan_months", { inputMode: "numeric" })}
            </Field>
            <Field label="Commission" hint="dollars a contract">
              {input("commission", { inputMode: "decimal" })}
            </Field>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────

function Dropped({ d }: { d: OptionsFinderResponse }) {
  const dropped = Object.entries(d.universe?.dropped ?? {}).filter(([, n]) => isFiniteNumber(n) && n > 0) as [string, number][];
  const total = dropped.reduce((s, [, n]) => s + n, 0);
  if (!dropped.length) return null;
  return (
    <details className="of-dropped" data-testid="of-dropped">
      <summary>Why {total} were dropped</summary>
      <ul>
        {dropped
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => (
            <li key={k} data-screen={k}>
              {n} {SCREEN_WORDS[k] ?? k}
            </li>
          ))}
      </ul>
    </details>
  );
}

function Summary({ d }: { d: OptionsFinderResponse }) {
  const i = d.inputs;
  const u = d.universe;
  const m = d.market_as_of;
  const kinds = kindWord(i?.type, true);
  return (
    <Card className="of-card of-summary" as="section" title="What was priced">
      <p data-testid="of-thesis">
        Your view: {d.symbol} {viewWord(i?.view)} {price(i?.target)} by {dayLong(i?.by)}
        {isFiniteNumber(i?.implied_move_pct) ? ` (${signed(i.implied_move_pct, 1)}% from the close)` : ""}, with {money(i?.budget)} to spend.
      </p>
      <p data-testid="of-summary">
        {u?.passed ?? NOT_SERVED} of {u?.seen ?? NOT_SERVED} {kinds} passed the screens. Priced from the {dayShort(m?.chain_session)} close ({d.symbol} {price(m?.underlying_close)}), costed at the{" "}
        {i?.fill === "mid" ? "mid" : "ask"}
        {isFiniteNumber(i?.commission) && i.commission > 0 ? `, plus ${money(i.commission)} a contract in commission` : ""}.
      </p>
      <Dropped d={d} />
      {u?.ranked_out_words ? <p className="of-note">{u.ranked_out_words}</p> : null}
      {d.scan?.truncated ? (
        <p className="of-note" data-testid="of-truncated">
          The provider's list for this window was longer than the Finder reads; it was read completely through {dayLong(d.scan.complete_through)}, and expiries after that were not compared.
        </p>
      ) : null}
      {d.stale ? (
        <p className="of-warn" data-testid="of-stale">
          {d.stale}
        </p>
      ) : null}
    </Card>
  );
}

// ── The lens cards ────────────────────────────────────────────────────────

function Scenario({ label, value, star }: { label: string; value: number | null; star: boolean }) {
  return (
    <div className="of-kv">
      <span>
        {label}
        {star ? "*" : ""}
      </span>
      <span className="of-num" data-tone={isFiniteNumber(value) ? (value > 0 ? "up" : value < 0 ? "down" : undefined) : undefined}>
        {money(value, true)}
      </span>
    </div>
  );
}

function Sensitivity({ label, p }: { label: string; p: ScenarioPnl | null }) {
  if (!p) return null;
  return (
    <>
      {label}: at the target {money(p.target, true)}, halfway {money(p.half, true)}, unchanged {money(p.flat, true)}.{" "}
    </>
  );
}

function PickCard({ lens, row, d, reason }: { lens: (typeof LENSES)[number]; row: OptionRow | undefined; d: OptionsFinderResponse; reason: string | null | undefined }) {
  const i = d.inputs;
  const by = i?.by;
  const star = !!row?.modelled;
  return (
    <Card className="of-card of-pick" as="article" title={lens.title} sub={lens.question}>
      {!row ? (
        <p className="of-note" data-testid={`of-pick-${lens.id}-none`}>
          {reason ?? "No contract that passed the screens sorts first here."}
        </p>
      ) : (
        <div data-testid={`of-pick-${lens.id}`} data-contract={row.contract}>
          <p className="of-pick-name">
            {row.n} × {contractText(row, by)}
          </p>
          <p className="of-pick-sub">
            {i?.fill === "mid" ? "mid" : "ask"} ${premium(row.fill)} · IV {frac(row.iv)} · OI {isFiniteNumber(row.oi) ? grouped(row.oi) : NOT_SERVED} · spread {frac(row.spread_pct)} · {lifeText(row)}
          </p>
          <div className="of-kvs">
            <div className="of-kv">
              <span>Cost{row.cost === row.max_loss ? " (max loss)" : ""}</span>
              <span className="of-num">{money(row.cost)}</span>
            </div>
            {row.cost !== row.max_loss ? (
              <div className="of-kv">
                <span>Max loss</span>
                <span className="of-num">{money(row.max_loss)}</span>
              </div>
            ) : null}
            <div className="of-kv">
              <span>Breakeven at expiry</span>
              <span className="of-num">{price(row.breakeven_expiry)}</span>
            </div>
            {row.modelled ? (
              <div className="of-kv">
                <span>Breakeven on your date*</span>
                <span className="of-num">{price(row.breakeven_on_date)}</span>
              </div>
            ) : null}
            <Scenario label={`At ${price(i?.target)} on ${dayShort(by)}`} value={row.pnl.target} star={star} />
            <Scenario label={`Halfway (${price(i?.half_price)})`} value={row.pnl.half} star={star} />
            <Scenario label={`Unchanged (${price(d.market_as_of?.underlying_close)})`} value={row.pnl.flat} star={star} />
          </div>
          {row.breakeven_on_date_note ? <p className="of-note">{row.breakeven_on_date_note}</p> : null}
          <p className="of-note">
            Chance of finishing past the breakeven at expiry: {frac(row.rn_prob_breakeven)}, {MARKET_IMPLIED}.
          </p>
          {row.modelled ? (
            <p className="of-note" data-testid={`of-modelled-${lens.id}`}>
              * Modelled on your date: {onDateWords(row)}, the contract's volatility held at {frac(row.model_inputs.sigma)}
              {isFiniteNumber(row.model_inputs.rate_on_date) ? `, rate ${frac(row.model_inputs.rate_on_date, 2)}` : ""}. <Sensitivity label="With volatility 10 points lower" p={row.iv_minus_10} />
              <Sensitivity label="10 points higher" p={row.iv_plus_10} />
            </p>
          ) : null}
          {row.flags.length ? (
            <ul className="of-flags">
              {row.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );
}

// ── The payoff chart (the served curve) ───────────────────────────────────

const PICK_COLORS = [DESK_ACCENTS.blue, DESK_ACCENTS.green, DESK_ACCENTS.amber];

function PayoffChart({ d, rowsBy }: { d: OptionsFinderResponse; rowsBy: Map<string, OptionRow> }) {
  const [ref, w] = useWidth<HTMLDivElement>(720);
  const curve = d.curve;
  const contracts = [...new Set(LENSES.map((l) => d.picks?.[l.id]).filter((c): c is string => !!c && !!curve?.pnl[c]))];
  if (!curve || !curve.prices.length || !contracts.length) return null;
  const H = 260;
  const pad = { l: 78, r: 16, t: 16, b: 40 };
  const xs = curve.prices;
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const values = contracts.flatMap((c) => curve.pnl[c].filter(isFiniteNumber));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const X = (p: number) => pad.l + ((p - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((hi - v) / span) * (H - pad.t - pad.b);
  const path = (vals: (number | null)[]) => {
    let s = "";
    let pen = false;
    vals.forEach((v, k) => {
      if (!isFiniteNumber(v)) return void (pen = false);
      s += `${pen ? "L" : "M"}${X(xs[k]).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return s;
  };
  const marks = [
    {
      key: "close",
      text: `Close ${price(curve.marks.close)}`,
      v: curve.marks.close,
    },
    {
      key: "half",
      text: `Halfway ${price(curve.marks.half)}`,
      v: curve.marks.half,
    },
    {
      key: "target",
      text: `Target ${price(curve.marks.target)}`,
      v: curve.marks.target,
    },
  ].filter((m) => isFiniteNumber(m.v));
  const lensesOf = (c: string) => LENSES.filter((l) => d.picks?.[l.id] === c).map((l) => l.title);
  const label = `Profit or loss in dollars on ${dayLong(d.inputs?.by)} against ${d.symbol}'s price that day, one line for each lens's contract; the close, halfway and the target marked.`;
  return (
    <Card className="of-card of-chart-card" as="section" title="Payoff on your date" sub={`against ${d.symbol}'s price that day`}>
      <div ref={ref} className="of-chart">
        <svg role="img" aria-label={label} width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
          {[hi, 0, lo]
            // a label within a line's height of the zero line gives way to it
            .filter((v, k, a) => a.indexOf(v) === k && (v === 0 || Math.abs(Y(v) - Y(0)) >= 14))
            .map((v) => (
              <g key={`y${v}`}>
                <line className={v === 0 ? "dk-chart-zero" : "dk-chart-grid"} x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} />
                <text className="dk-chart-axis" x={pad.l - 6} y={Y(v) + 4} textAnchor="end">
                  {money(v, true)}
                </text>
              </g>
            ))}
          {marks.map((m) => (
            <g key={m.key}>
              <line className="of-mark" x1={X(m.v as number)} x2={X(m.v as number)} y1={pad.t} y2={H - pad.b} />
            </g>
          ))}
          {contracts.map((c, k) => {
            const r = rowsBy.get(c);
            return <path key={c} d={path(curve.pnl[c])} fill="none" stroke={PICK_COLORS[k % PICK_COLORS.length]} strokeWidth={2.25} strokeDasharray={r?.modelled ? "5 4" : undefined} />;
          })}
          <text className="dk-chart-axis" x={pad.l} y={H - 8} textAnchor="start">
            {price(x0)}
          </text>
          <text className="dk-chart-axis" x={w - pad.r} y={H - 8} textAnchor="end">
            {price(x1)}
          </text>
        </svg>
      </div>
      <ul className="of-marks">
        {marks.map((m) => (
          <li key={m.key}>{m.text}</li>
        ))}
      </ul>
      <ul className="of-legend">
        {contracts.map((c, k) => {
          const r = rowsBy.get(c);
          return (
            <li key={c}>
              <span className="of-swatch" style={{ background: PICK_COLORS[k % PICK_COLORS.length] }} aria-hidden="true" />
              {r ? `${r.n} × ${contractText(r, d.inputs?.by)}` : c}
              {r?.modelled ? " (modelled)" : ""} · {lensesOf(c).join(", ")}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Events in the way ─────────────────────────────────────────────────────

function Events({ d }: { d: OptionsFinderResponse }) {
  const events = d.events ?? [];
  const moves = d.earnings_moves ?? [];
  if (!events.length && !(d.coverage ?? []).length) return null;
  return (
    <Card className="of-card" as="section" title="Events before expiry" sub="what the flat-volatility values do not price">
      {events.length ? (
        <ul className="of-events" data-testid="of-events">
          {events.map((e) => (
            <li key={e.id} data-kind={e.kind}>
              <span className="of-ev-date">{dayLong(e.date)}</span> {e.name}
              {e.kind === "dividend" && isFiniteNumber(e.amount) ? ` $${premium(e.amount)} a share (${e.label ?? ""})` : ""}
              {TIMING_WORDS[e.timing] ? `, ${TIMING_WORDS[e.timing]}` : ""} · {e.placement} · {e.source}
            </li>
          ))}
        </ul>
      ) : (
        <p className="of-note">No events are listed before the last expiry.</p>
      )}
      {moves.map((m) =>
        isFiniteNumber(m.move_sd_pct) ? (
          <p key={m.event_id} className="of-note">
            The options price a move of about {num(m.move_sd_pct, 1)}% (one standard deviation) for the report on {dayLong(m.date)}, {MARKET_IMPLIED}
            {m.expiries?.length ? `, from the ${m.expiries.map((e) => dayLong(e)).join(" and ")} expiries` : ""}.
          </p>
        ) : m.reason ? (
          <p key={m.event_id} className="of-note">
            {m.reason}
          </p>
        ) : null,
      )}
      {(d.coverage ?? []).length ? (
        <ul className="of-coverage">
          {(d.coverage ?? []).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

// ── The table ─────────────────────────────────────────────────────────────

type SortKey = "served" | "exp" | "strike" | "oi" | "iv" | "cost" | "target" | "half" | "flat";
const COLUMNS: { key: SortKey | null; label: string; num?: boolean }[] = [
  { key: "exp", label: "Contract" },
  { key: null, label: "Bid / ask", num: true },
  { key: "oi", label: "OI", num: true },
  { key: "iv", label: "IV", num: true },
  { key: null, label: "Δ", num: true },
  { key: "cost", label: "Cost", num: true },
  { key: null, label: "Breakeven", num: true },
  { key: "target", label: "At target", num: true },
  { key: "half", label: "Halfway", num: true },
  { key: "flat", label: "Unchanged", num: true },
];

function sortValue(r: OptionRow, k: SortKey): number | string | null {
  if (k === "exp") return `${r.exp} ${String(r.strike).padStart(12, "0")}`;
  if (k === "strike") return r.strike;
  if (k === "oi") return r.oi;
  if (k === "iv") return r.iv;
  if (k === "cost") return r.cost;
  if (k === "target" || k === "half" || k === "flat") return r.pnl[k];
  return null;
}

/** The served rows in another order (stable on the served order; a value not served sorts last). */
export function sortRows(rows: readonly OptionRow[], key: SortKey, dir: "asc" | "desc"): OptionRow[] {
  if (key === "served") return [...rows];
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, k) => ({ r, k, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.k - b.k;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      return c ? c * sign : a.k - b.k;
    })
    .map((x) => x.r);
}

const FIRST_ROWS = 50;

function RowsTable({ d }: { d: OptionsFinderResponse }) {
  const rows = d.rows ?? [];
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "served",
    dir: "desc",
  });
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const shown = all ? sorted : sorted.slice(0, FIRST_ROWS);
  const by = d.inputs?.by;
  const click = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "exp" ? "asc" : "desc" }));
  return (
    <Card className="of-card" as="section" title={`Every contract that passed (${rows.length})`} sub="ordered by the payoff if right; any column sorts">
      <div className="of-table-wrap">
        <table className="of-table" data-testid="of-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" data-num={c.num || undefined} aria-sort={c.key && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.key ? (
                    <button type="button" className="of-sort" onClick={() => click(c.key as SortKey)}>
                      {c.label}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.contract} data-contract={r.contract}>
                <th scope="row">
                  {r.n} × {contractText(r, by)}
                  {r.flags.length ? (
                    <span className="of-flag-dot" title={r.flags.join(" ")}>
                      {" "}
                      ⚑<span className="dk-sr"> {r.flags.join(" ")}</span>
                    </span>
                  ) : null}
                </th>
                <td data-num="">
                  {premium(r.bid)} / {premium(r.ask)}
                </td>
                <td data-num="">{isFiniteNumber(r.oi) ? grouped(r.oi) : NOT_SERVED}</td>
                <td data-num="">{frac(r.iv)}</td>
                <td data-num="">{isFiniteNumber(r.delta) ? num(r.delta, 2) : NOT_SERVED}</td>
                <td data-num="">{money(r.cost)}</td>
                <td data-num="">{price(r.modelled ? r.breakeven_on_date : r.breakeven_expiry)}</td>
                {(["target", "half", "flat"] as const).map((k) => (
                  <td key={k} data-num="" data-tone={isFiniteNumber(r.pnl[k]) ? ((r.pnl[k] as number) > 0 ? "up" : (r.pnl[k] as number) < 0 ? "down" : undefined) : undefined}>
                    {money(r.pnl[k], true)}
                    {r.modelled ? "*" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="of-note">* Modelled on your date, volatility held flat; the breakeven shown is on your date. Otherwise the value on your date is intrinsic and the breakeven is at expiry.</p>
      {!all && rows.length > FIRST_ROWS ? (
        <button type="button" className="dk-btn" onClick={() => setAll(true)} data-testid="of-all">
          Show all {rows.length}
        </button>
      ) : null}
    </Card>
  );
}

// ── How it was priced ─────────────────────────────────────────────────────

function Method({ d }: { d: OptionsFinderResponse }) {
  return (
    <details className="of-method" data-testid="of-method">
      <summary>How it was priced</summary>
      {d.rates ? (
        <>
          <p>{d.rates.rule}</p>
          <ul>
            {d.rates.points.map((p) => (
              <li key={p.series}>
                {p.series} on {dayLong(p.date)}: {isFiniteNumber(p.yield_pct) ? `${num(p.yield_pct, 2)}%` : NOT_SERVED}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {(d.carry ?? []).length ? (
        <ul>
          {(d.carry ?? []).map((c) => (
            <li key={c.exp}>
              {dayLong(c.exp)}: {c.words}
              {isFiniteNumber(c.forward) ? `; forward ${price(c.forward)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {d.method ? (
        <p>
          Engine {d.method.version}
          {d.work && isFiniteNumber(d.work.used) && isFiniteNumber(d.work.limit) ? `; ${grouped(d.work.used)} of ${grouped(d.work.limit)} lattice steps used` : ""}.
        </p>
      ) : null}
      {(d.method?.notes ?? []).map((n) => (
        <p key={n}>{n}</p>
      ))}
    </details>
  );
}

// ── The page ──────────────────────────────────────────────────────────────

function Footer({ d }: { d?: OptionsFinderResponse }) {
  return (
    <footer className="of-footer" data-testid="of-footer">
      Scenario calculator over end-of-day quotes, not a recommendation. Max loss is the whole premium and commissions. Modelled values hold volatility flat.
      {d?.sources?.length ? ` Sources: ${d.sources.join(" · ")}.` : ""}{" "}
      <a className="dk-link" href={OCC_URL} target="_blank" rel="noreferrer">
        Options risk disclosure (OCC) ↗
      </a>
    </footer>
  );
}

function Answer({ d }: { d: OptionsFinderResponse }) {
  const rows = d.rows ?? [];
  const rowsBy = useMemo(() => new Map(rows.map((r) => [r.contract, r])), [rows]);
  if (d.empty || !rows.length) {
    return (
      <>
        <Summary d={d} />
        <Card className="of-card" as="section" title="Nothing to compare">
          <p data-testid="of-empty">{d.empty ?? "No contract passed the screens."}</p>
        </Card>
        <Events d={d} />
      </>
    );
  }
  return (
    <>
      <Summary d={d} />
      <div className="of-picks">
        {LENSES.map((l) => (
          <PickCard key={l.id} lens={l} row={d.picks?.[l.id] ? rowsBy.get(d.picks[l.id] as string) : undefined} d={d} reason={l.id === "time" ? d.lens_reasons?.time : null} />
        ))}
      </div>
      <PayoffChart d={d} rowsBy={rowsBy} />
      <Events d={d} />
      <RowsTable d={d} />
      <Method d={d} />
    </>
  );
}

function useNoindex() {
  useEffect(() => {
    if (OPTIONS_FINDER_LISTED) return;
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    m.setAttribute("data-options-finder", "");
    document.head.appendChild(m);
    return () => m.remove();
  }, []);
}

export default function OptionsFinderPage({ page }: { page: DeskPage }) {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => paramsOf(search), [search]);
  const q = useOptionsFinder(params);
  useNoindex();

  const run = (draft: Draft) => setSearch(searchOf(draft, search));

  const d = q.data;
  let state: FinderState = "idle";
  let words = "";
  if (!params) state = "idle";
  else if (d) state = d.empty || !(d.rows ?? []).length ? "empty" : "answered";
  else if (q.isError && q.error) ({ state, words } = failureOf(q.error));
  else state = "loading";

  const session = d?.market_as_of?.chain_session;
  const badge = (
    <span className="of-badges">
      {!OPTIONS_FINDER_LISTED ? (
        <span className="of-preview" data-testid="of-preview">
          Preview
        </span>
      ) : null}
      {session ? <StampBadge text={`Close · ${dayShort(session)}`} /> : null}
    </span>
  );

  return (
    <div className="of" data-state={state} data-testid="of-page">
      <PageTitle page={page} badge={badge} />
      <p className="of-framing">{FRAMING}</p>
      <ThesisForm search={search} onRun={run} />
      <div role="status" aria-live="polite" className="of-status" data-testid="of-status">
        {state === "idle" ? <p className="dk-await">Name a stock or ETF, the price you expect, the date and the budget, then price the chain.</p> : null}
        {state === "loading" ? <p className="dk-await">Pricing every contract in the window against the last close… a full scan can take up to a minute.</p> : null}
        {["not-deployed", "not-entitled", "awaiting", "refused", "failed"].includes(state) ? (
          <div className="of-refusal" data-testid="of-refusal">
            <p>{words}</p>
            {state === "failed" ? (
              <button type="button" className="dk-btn" onClick={() => void q.refetch()}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {d ? (
        <div className="of" data-testid="of-answer">
          <Answer d={d} />
        </div>
      ) : null}
      <Footer d={d} />
    </div>
  );
}
