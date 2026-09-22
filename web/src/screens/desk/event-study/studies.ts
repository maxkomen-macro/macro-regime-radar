/**
 * Study slugs (spec §5: "Studies addressable by ?study=<slug>"). Since
 * desk/integration the page's ?study= is the engine's own address
 * (src/desk/event_study.slug_for / parse_slug), so a permalink, the API call
 * and the provenance caption name one study one way. Ported here for the
 * query builder and pinned to the engine through the shared fixture
 * __fixtures__/slugs.json: tests/test_event_study.py checks the file against
 * the engine, studies.test.ts checks this port against the file.
 *
 * Grammar: a preset keeps its name; a cross is `{target}-{golden|death}-cross`;
 * any other study is `{shock}-w{w}-z{z}-{up|down|abs}-{cond[=value]|none}-{target}`;
 * both take `-{regime}` when a regime filter is set. Numbers are written as
 * Python's repr writes the builder's values: the shortest decimal with at
 * least one decimal place (2 → "2.0"). The page keeps a condition with its
 * value as one id, `vix_above=20.0`, exactly the slug's segment. Pure.
 */

import type { EventStudyParams } from "../../../api/desk";

export const PRESET_SLUG = "gold-2sigma-spx-weak";

/** The first preset: gold ≥ +2σ (20d) while SPX sits below its 50d MA, target SPX. */
export const PRESET: EventStudyParams = { kind: "shock", cross: null, shock: "gold", w: 20, z: 2, sign: "+", cond: "spx_below_50dma", regime: "all", target: "spx" };

function cross(which: "golden" | "death"): EventStudyParams {
  // The engine fixes a cross study's shock fields (validate): S&P 500, w 20, z 2, sign +, no condition.
  return { kind: "cross", cross: which, shock: "spx", w: 20, z: 2, sign: "+", cond: "none", regime: "all", target: "spx" };
}

/** The engine's three presets, in its order (event_study.PRESETS). */
export const PRESETS: Record<string, EventStudyParams> = { [PRESET_SLUG]: PRESET, "spx-golden-cross": cross("golden"), "spx-death-cross": cross("death") };

const SIGN_WORD = { "+": "up", "-": "down", both: "abs" } as const;
const WORD_SIGN = { up: "+", down: "-", abs: "both" } as const;
const REGIMES = "goldilocks|overheating|stagflation|recession_risk";

/** Python's repr for the builder's numbers: 2 → "2.0", 1.5 → "1.5". */
export function numSlug(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

export function sameParams(a: EventStudyParams, b: EventStudyParams): boolean {
  if (a.kind !== b.kind || a.target !== b.target || a.regime !== b.regime) return false;
  if (a.kind === "cross") return a.cross === b.cross;
  return a.shock === b.shock && a.w === b.w && a.z === b.z && a.sign === b.sign && a.cond === b.cond;
}

/** The engine's slug for a study. */
export function slugFor(p: EventStudyParams): string {
  const preset = Object.entries(PRESETS).find(([, v]) => sameParams(v, p));
  if (preset) return preset[0];
  const regime = p.regime === "all" ? "" : `-${p.regime}`;
  if (p.kind === "cross") return `${p.target}-${p.cross}-cross${regime}`;
  return `${p.shock}-w${p.w}-z${numSlug(p.z)}-${SIGN_WORD[p.sign]}-${p.cond}-${p.target}${regime}`;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const SLUG_RE = new RegExp(String.raw`^([a-z0-9_]+)-w(\d+)-z(${NUM})-(up|down|abs)-([a-z0-9_]+)(?:=(${NUM}|[a-z_]+))?-([a-z0-9_]+)(?:-(${REGIMES}))?$`);
const CROSS_RE = new RegExp(String.raw`^([a-z0-9_]+)-(golden|death)-cross(?:-(${REGIMES}))?$`);

/** The study a slug names; null for anything the engine would not parse as an address. */
export function paramsFor(slug: string | null | undefined): EventStudyParams | null {
  if (!slug) return null;
  if (PRESETS[slug]) return PRESETS[slug];
  const c = CROSS_RE.exec(slug);
  if (c) return { ...cross(c[2] as "golden" | "death"), target: c[1], regime: c[3] ?? "all" };
  const m = SLUG_RE.exec(slug);
  if (!m) return null;
  const w = Number(m[2]);
  const z = Number(m[3]);
  if (!Number.isFinite(w) || !Number.isFinite(z)) return null;
  const cond = m[6] == null ? m[5] : `${m[5]}=${m[5] === "regime" ? m[6] : numSlug(Number(m[6]))}`;
  return { kind: "shock", cross: null, shock: m[1], w, z, sign: WORD_SIGN[m[4] as keyof typeof WORD_SIGN], cond, regime: m[8] ?? "all", target: m[7] };
}
