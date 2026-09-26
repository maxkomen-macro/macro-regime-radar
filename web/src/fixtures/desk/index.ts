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
import ledger from "./ledger.json" with { type: "json" };
import macro from "./macro.json" with { type: "json" };
import overview from "./overview.json" with { type: "json" };
import pipeline from "./pipeline.json" with { type: "json" };
import { PIPELINE_DDL } from "./pipeline-ddl";
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
 * envelope with §1.0's reason. The shapes Monday's pages still render once served (vol.json,
 * sectors.json) stay for their unit tests; basket, price and hedge have no page that reads them. */
const DEFERRED: Readonly<Record<string, string>> = {
  "/vol": "needs stored SPY option snapshots and a versioned skew method.",
  "/sectors": "sector ETFs, RSP and IWM not ingested.",
  // §9, §12.13: positions are kept in the browser; there is no server position store (v2 D-21).
  "/positions": "positions are kept in this browser; there is no server position store.",
  // §10, §12.13: basket pricing and option structures (v2 D-25–D-28).
  "/basket/price": "basket pricing and option structures not yet defined in the engine.",
  "/hedge": "basket pricing and option structures not yet defined in the engine.",
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
  // §12.0: a removed write answers 405 (`POST /positions`, `POST /basket/price`).
  if ((path === "/positions" || path === "/basket/price") && method.toUpperCase() !== "GET") return json(405, { error: "method not allowed" });
  // §12.13: `GET /basket/:id` is a deferred stub like the others.
  if (method.toUpperCase() === "GET" && path.startsWith("/basket/") && path !== "/basket/price") return json(200, awaitingEnvelope({ reason: DEFERRED["/basket/price"], until: null }, FIXTURE_META));
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
  // §12.11: the Snowflake DDL, as text.
  if (method.toUpperCase() === "GET" && path === "/pipeline/ddl") return { status: 200, contentType: "text/plain", body: PIPELINE_DDL };
  return json(404, { error: `no fixture for ${method.toUpperCase()} /api/desk${path}` });
}
