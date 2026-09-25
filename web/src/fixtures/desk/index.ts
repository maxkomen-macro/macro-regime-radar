/**
 * Desk v2 fixtures (DESK_FRAME3_SPEC §12, §13): one JSON file per endpoint,
 * each exactly the §12 shape (PROPOSED fields per §12.13 included), carrying
 * the mockup's values. They are never imported by the app: the browser always
 * asks /api/desk/*. Two things answer from them instead of the API:
 *   - the Desk browser tests (e2e/lib/desk-fixtures.ts, page.route), and
 *   - the dev server when started with DESK_FIXTURES=1 (vite.config.ts),
 * both through `deskFixture` below, so the two can never disagree.
 * Unit tests import the JSON directly.
 */

import engineAssets from "../../screens/desk/event-study/__fixtures__/engine-assets.json" with { type: "json" };
import engineStudies from "../../screens/desk/event-study/__fixtures__/engine-studies.json" with { type: "json" };
import basketPrice from "./basket-price.json" with { type: "json" };
import basket from "./basket.json" with { type: "json" };
import hedge from "./hedge.json" with { type: "json" };
import ledger from "./ledger.json" with { type: "json" };
import macro from "./macro.json" with { type: "json" };
import overview from "./overview.json" with { type: "json" };
import pipeline from "./pipeline.json" with { type: "json" };
import { PIPELINE_DDL } from "./pipeline-ddl";
import positions from "./positions.json" with { type: "json" };
import regime from "./regime.json" with { type: "json" };
import studyCatalog from "./study-catalog.json" with { type: "json" };
import studyEvents from "./study-events.json" with { type: "json" };
import study from "./study.json" with { type: "json" };
import technicals from "./technicals.json" with { type: "json" };
import { isQuestion } from "../../screens/desk/event-study/question";
import { isAnswerable, studyFor } from "../../screens/desk/event-study/catalog";
import type { CatalogStudy, Question } from "../../screens/desk/data/types";
import { awaitingEnvelope, onTheWire, routeOf, type EnvelopeMeta } from "../../screens/desk/data/envelope";

/** The envelope's fields for every fixture answer (§12.0); a payload's own `as_of` and `generation_id` win. */
export const FIXTURE_META: EnvelopeMeta = { generation_id: "gen-fixture-2026-09-22", as_of: "2026-09-22", engine_version: "fixture" };

/** A reply as the wire carries it (§12.0): a JSON body on an enveloped route in its envelope. */
export function wireReply(path: string, reply: FixtureReply): FixtureReply {
  if (!/json/.test(reply.contentType)) return reply;
  let body: unknown;
  try {
    body = JSON.parse(reply.body);
  } catch {
    return reply;
  }
  return { ...reply, body: JSON.stringify(onTheWire(routeOf(path), reply.status, body, FIXTURE_META)) };
}

export interface FixtureReply {
  status: number;
  contentType: string;
  body: string;
}

/** GET routes answered with a JSON fixture, by path under /api/desk. */
export const DESK_JSON_FIXTURES: Readonly<Record<string, unknown>> = {
  "/overview": overview,
  "/ledger": ledger,
  "/technicals": technicals,
  "/regime": regime,
  "/macro": macro,
  "/pipeline": pipeline,
  "/study/catalog": studyCatalog,
};

const CATALOG = (studyCatalog as { studies: CatalogStudy[] }).studies;

/** The catalog study a /study request names (§12.2): its preset, or its six slots; the question too, for the horizon check. */
function catalogAsk(u: URL): { study: CatalogStudy | null; question: Question | null } {
  const preset = u.searchParams.get("preset");
  if (preset) return { study: CATALOG.find((s) => s.slug === preset) ?? null, question: null };
  const move = u.searchParams.get("move");
  const cross = move === "cross_above" || move === "cross_below";
  const q = {
    shock: u.searchParams.get("shock"),
    window: cross || !u.searchParams.has("window") ? null : Number(u.searchParams.get("window")),
    move,
    while: u.searchParams.get("while") ?? "none",
    target: u.searchParams.get("target"),
    horizon: u.searchParams.has("horizon") ? Number(u.searchParams.get("horizon")) : 20,
  };
  if (!isQuestion(q)) return { study: null, question: null };
  return { study: studyFor(CATALOG, q), question: q };
}

/** The deferred resources of §12.13 that are GET-only stubs on Monday (§12.0): each answers the awaiting
 * envelope with §1.0's reason. Their deferred shapes (vol.json, sectors.json) stay for the unit tests
 * that render a block once it is served. */
const DEFERRED: Readonly<Record<string, string>> = {
  "/vol": "needs stored SPY option snapshots and a versioned skew method.",
  "/sectors": "sector ETFs, RSP and IWM not ingested.",
};

/** The one study the fixtures carry (§12.2's gold example), by the question it answers. */
const STUDY_Q = (study as { question: Record<string, string | number> }).question;
/** The six slots a question is asked by (the served question also carries its target's unit and label). */
const SLOTS = ["shock", "window", "move", "while", "target", "horizon"] as const;

/** Whether a /study request asks the fixture's question: its preset, or its six slots. */
function asksFixtureStudy(u: URL): boolean {
  const preset = u.searchParams.get("preset");
  if (preset) return preset === (study as { slug: string }).slug;
  return SLOTS.every((k) => u.searchParams.get(k) === String(STUDY_Q[k]));
}

/** Whether a POST body names the study a "signal reverses" level binds to (Codex R-11): a
 * slug, or `question` as exactly the six slots, each one the slots can ask. Anything else,
 * a blank slug, a seventh key, a slot of the wrong kind, names no study. */
function namesStudy(b: Record<string, unknown>): boolean {
  if (typeof b.study_slug === "string" && b.study_slug.trim()) return true;
  const q = b.question;
  if (!q || typeof q !== "object" || Array.isArray(q)) return false;
  const keys = Object.keys(q);
  return keys.length === SLOTS.length && SLOTS.every((k) => keys.includes(k)) && isQuestion(q);
}

// ── /positions (§12.8): the server keeps positions; the fixture keeps the
// ones posted during this dev-server or test session, in memory. ──────────

let posted: Record<string, unknown>[] = [];

/** Forget what was posted (tests call this between cases). */
export function resetDeskFixtureState(): void {
  posted = [];
}

const CERTAINTY = /\b(will|always|never|proves|guaranteed)\b/gi;

function positionsReply(method: string, body: string | undefined): FixtureReply {
  if (method.toUpperCase() === "GET") {
    const base = positions as { positions: Record<string, unknown>[] };
    return json(200, { ...base, positions: [...base.positions, ...posted] });
  }
  if (method.toUpperCase() !== "POST") return json(405, { error: "method not allowed" });
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(body ?? "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "not JSON" });
  }
  const text = `${String(b.variant ?? "")} ${String(b.pre_mortem ?? "")}`;
  const words = [...new Set([...text.matchAll(CERTAINTY)].map((m) => m[0].toLowerCase()))];
  if (words.length) return json(422, { error: "wording", words });
  const wrongIf = b.wrong_if as { label?: string } | undefined;
  const missing = [
    !String(b.instrument ?? "").trim() && "instrument",
    !String(b.variant ?? "").trim() && "variant",
    !String(b.pre_mortem ?? "").trim() && "pre_mortem",
    !String(wrongIf?.label ?? "").trim() && "level",
  ].filter(Boolean);
  if (missing.length) return json(422, { error: "gate", missing });
  // The signal's own reversal is a level only against the study it comes from (Codex R-11).
  if ((b.wrong_if as { id?: unknown } | undefined)?.id === "signal_reverses" && !namesStudy(b)) return json(422, { error: "gate", missing: ["study"] });
  const id = `p${posted.length + 1}`;
  const row = {
    id,
    name: `${b.direction === "short" ? "Short" : "Long"} ${String(b.instrument)}`,
    instrument: String(b.instrument),
    direction: b.direction === "short" ? "short" : "long",
    // The fixture measures nothing: what a real server would compute from market data (room, the
    // distance to the level, the level's value) stays null; the day it opened is today, day 1.
    size_nav: typeof b.size_nav === "number" ? b.size_nav : null,
    room_pct: null,
    to_level: null,
    opened: (positions as { as_of: string }).as_of,
    horizon_days: typeof b.horizon_days === "number" ? b.horizon_days : 20,
    day: 1,
    falsifies_at: { label: String(wrongIf?.label ?? ""), value: null, unit: null },
    now: null,
    dv01: null,
    variant: String(b.variant),
    pre_mortem: String(b.pre_mortem),
    red_team: "",
    study_slug: typeof b.study_slug === "string" ? b.study_slug : null,
  };
  posted = [...posted, row];
  return json(201, row);
}

// ── Basket & Hedge (§12.12): the fixtures carry one basket, its price and
// one hedge (Protect, for that basket, as a basket, as its legs, or as the
// position that holds it), as they carry one study. Other weights, baskets,
// modes and subjects have no fixture: the page shows what the API would on an
// error, Awaiting refresh. ─────────────────────────────────────────────────

const B = basket as { id: string; legs: { symbol: string; weight: number }[] };
const legsKey = (legs: { symbol: string; weight: number }[]) => legs.map((l) => `${l.symbol}:${l.weight}`).join(",");
const BASKET_LEGS = legsKey(B.legs);
/** The position on the fixture's Position Monitor that holds the basket. */
const BASKET_POSITION = "ai-infra-hedged";

function basketPriceReply(body: string | undefined): FixtureReply {
  let legs: { symbol: string; weight: number }[] = [];
  try {
    legs = ((JSON.parse(body ?? "{}") as { legs?: unknown }).legs as typeof legs) ?? [];
  } catch {
    return json(400, { error: "not JSON" });
  }
  if (!Array.isArray(legs) || legsKey(legs) !== BASKET_LEGS) return json(404, { error: "no fixture for these legs" });
  return json(200, basketPrice);
}

function hedgeReply(u: URL): FixtureReply {
  const q = u.searchParams;
  const ours = q.get("basket") === B.id || q.get("position") === BASKET_POSITION || q.get("legs") === BASKET_LEGS;
  if (q.get("mode") !== "protect" || !ours) return json(404, { error: "no fixture for this hedge" });
  return json(200, hedge);
}

/** §12.3's CSV: one row per event, the JSON's columns in order. */
export function eventsCsv(doc: { events: Record<string, unknown>[] }): string {
  const cols = ["date", "regime", "ret_5", "ret_10", "ret_20", "ret_60"];
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...doc.events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\n") + "\n";
}

const json = (status: number, body: unknown): FixtureReply => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The fixture reply for a request, or null when the path is not under /api/desk.
 * An /api/desk path with no fixture answers 404 in the §12 error shape, so a
 * test never falls through to whatever API happens to be running. Every JSON
 * answer on a §12.0 route goes out in its envelope. */
export function deskFixture(method: string, url: string, _body?: string, accept?: string): FixtureReply | null {
  const u = new URL(url, "http://fixture.local");
  const m = /^\/api\/desk(\/.*)$/.exec(u.pathname);
  if (!m) return null;
  const path = m[1].replace(/\/+$/, "");
  const reply = rawReply(method, u, path, _body, accept);
  return wireReply(path, reply);
}

/** The fixture's answer before it is put on the wire: a payload or a `{error}` body. */
function rawReply(method: string, u: URL, path: string, _body?: string, accept?: string): FixtureReply {
  if (path === "/positions") return positionsReply(method, _body);
  if (method.toUpperCase() === "GET" && path in DESK_JSON_FIXTURES) return json(200, DESK_JSON_FIXTURES[path]);
  if (method.toUpperCase() === "GET" && path in DEFERRED) return json(200, awaitingEnvelope({ reason: DEFERRED[path], until: null }, FIXTURE_META));
  if (method.toUpperCase() === "GET" && (path === "/study" || path === "/study/events")) {
    // §12.2: a request must normalize to one catalog study at an allowed horizon, else 422 `unsupported`;
    // a catalog study whose inputs are not stored answers awaiting with its reason (B-07).
    const { study: c, question } = catalogAsk(u);
    if (!c || (question && c.available && !isAnswerable(CATALOG, question))) {
      // §12.0: the refusal names what is not supported.
      const asked = question ? [`shock ${question.shock}`, question.window == null ? "no window" : `window ${question.window}`, `move ${question.move}`, `while ${question.while}`, `target ${question.target}`, `horizon ${question.horizon}`].join(", ") : `preset ${u.searchParams.get("preset") ?? "(none)"}`;
      return json(422, { error: "unsupported", message: `No study in the catalog asks ${asked}.` });
    }
    if (!c.available) return json(200, awaitingEnvelope({ reason: c.unavailable?.reason ?? "not yet served", until: c.unavailable?.until ?? null }, FIXTURE_META));
    // The fixtures carry one study (the gold preset); another catalog study has no fixture.
    if (!asksFixtureStudy(u)) return json(404, { error: "no fixture for this question" });
    if (path === "/study") return json(200, study);
    if (/text\/csv/.test(accept ?? "")) return { status: 200, contentType: "text/csv", body: eventsCsv(studyEvents as { events: Record<string, unknown>[] }) };
    return json(200, studyEvents);
  }
  // The frame-2 engine (the Event Study's Advanced panel) answers from its own
  // saved payloads (screens/desk/event-study/__fixtures__, real engine output).
  if (method.toUpperCase() === "GET" && path === "/event-study/assets") return json(200, engineAssets);
  if (method.toUpperCase() === "GET" && path === "/event-study") {
    const slug = u.searchParams.get("study");
    const answer = slug === "gold-2sigma-spx-weak" ? engineStudies.preset : slug === "spx-golden-cross" ? engineStudies.cross : null;
    return answer ? json(200, answer) : json(404, { error: "no fixture for this engine study" });
  }
  if (method.toUpperCase() === "GET" && path.startsWith("/basket/")) return path === `/basket/${B.id}` ? json(200, basket) : json(404, { error: `no fixture for basket ${path.slice(8)}` });
  if (path === "/basket/price") return method.toUpperCase() === "POST" ? basketPriceReply(_body) : json(405, { error: "method not allowed" });
  if (method.toUpperCase() === "GET" && path === "/hedge") return hedgeReply(u);
  // §12.11: the Snowflake DDL, as text.
  if (method.toUpperCase() === "GET" && path === "/pipeline/ddl") return { status: 200, contentType: "text/plain", body: PIPELINE_DDL };
  return json(404, { error: `no fixture for ${method.toUpperCase()} /api/desk${path}` });
}
