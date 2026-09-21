/**
 * Study slugs (spec §5: "Studies addressable by ?study=<slug>"). The preset
 * carries the stable slug EVENT_STUDY_SPEC §7 names; any other query gets a
 * generated slug that round-trips through paramsFor. Pure.
 */

import type { EventStudyParams } from "../../../api/desk";

export const PRESET_SLUG = "gold-2sigma-spx-weak";

/** The first preset: gold ≥ +2σ (20d) while SPX sits below its 50d MA, target SPX. */
export const PRESET: EventStudyParams = { shock: "gold", w: 20, z: 2.0, sign: "+", cond: "spx_below_50dma", regime: "all", target: "spx" };

export const PRESETS: Record<string, EventStudyParams> = { [PRESET_SLUG]: PRESET };

export function sameParams(a: EventStudyParams, b: EventStudyParams): boolean {
  return a.shock === b.shock && a.w === b.w && a.z === b.z && a.sign === b.sign && a.cond === b.cond && a.regime === b.regime && a.target === b.target;
}

/** "gold-2sigma-spx-weak" for the preset, else "gold-20d-2p5s-up-spx_below_50dma-all-spx". */
export function slugFor(p: EventStudyParams): string {
  const preset = Object.entries(PRESETS).find(([, v]) => sameParams(v, p));
  if (preset) return preset[0];
  return `${p.shock}-${p.w}d-${String(p.z).replace(".", "p")}s-${p.sign === "+" ? "up" : "down"}-${p.cond}-${p.regime}-${p.target}`;
}

const GENERIC = /^(\w+)-(\d+)d-(\d+(?:p\d+)?)s-(up|down)-(\w+)-(\w+)-(\w+)$/;

/** The params a slug names; null for an unknown or malformed slug. */
export function paramsFor(slug: string | null | undefined): EventStudyParams | null {
  if (!slug) return null;
  if (PRESETS[slug]) return PRESETS[slug];
  const m = GENERIC.exec(slug);
  if (!m) return null;
  const z = Number(m[3].replace("p", "."));
  const w = Number(m[2]);
  if (!Number.isFinite(z) || !Number.isFinite(w)) return null;
  return { shock: m[1], w, z, sign: m[4] === "up" ? "+" : "-", cond: m[5], regime: m[6], target: m[7] };
}
