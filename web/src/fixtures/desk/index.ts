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
import positions from "./positions.json" with { type: "json" };
import regime from "./regime.json" with { type: "json" };
import sectors from "./sectors.json" with { type: "json" };
import studyEvents from "./study-events.json" with { type: "json" };
import study from "./study.json" with { type: "json" };
import technicals from "./technicals.json" with { type: "json" };
import vol from "./vol.json" with { type: "json" };

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
  "/vol": vol,
  "/sectors": sectors,
  "/regime": regime,
  "/macro": macro,
  "/pipeline": pipeline,
};

/** The one study the fixtures carry (§12.2's gold example), by the question it answers. */
const STUDY_Q = (study as { question: Record<string, string | number> }).question;

/** Whether a /study request asks the fixture's question: its preset, or its six slots. */
function asksFixtureStudy(u: URL): boolean {
  const preset = u.searchParams.get("preset");
  if (preset) return preset === (study as { slug: string }).slug;
  return Object.entries(STUDY_Q).every(([k, v]) => u.searchParams.get(k) === String(v));
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

/** §12.3's CSV: one row per event, the JSON's columns in order. */
export function eventsCsv(doc: { events: Record<string, unknown>[] }): string {
  const cols = ["date", "regime", "ret_5", "ret_10", "ret_20", "ret_60"];
  const cell = (v: unknown) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...doc.events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\n") + "\n";
}

const json = (status: number, body: unknown): FixtureReply => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** The fixture reply for a request, or null when the path is not under /api/desk.
 * An /api/desk path with no fixture answers 404 in the §12 error shape, so a
 * test never falls through to whatever API happens to be running. */
export function deskFixture(method: string, url: string, _body?: string, accept?: string): FixtureReply | null {
  const u = new URL(url, "http://fixture.local");
  const m = /^\/api\/desk(\/.*)$/.exec(u.pathname);
  if (!m) return null;
  const path = m[1].replace(/\/+$/, "");
  if (path === "/positions") return positionsReply(method, _body);
  if (method.toUpperCase() === "GET" && path in DESK_JSON_FIXTURES) return json(200, DESK_JSON_FIXTURES[path]);
  if (method.toUpperCase() === "GET" && (path === "/study" || path === "/study/events")) {
    // The fixtures carry one study; any other question has no fixture (the page
    // shows what the API would: its error state), and `confidence` is served as
    // the fixture states it (0.90), whatever was asked.
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
