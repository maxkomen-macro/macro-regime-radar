/**
 * Parity guarantee #3 (PARITY_MANIFEST.md): every baseline label (normalized)
 * still exists on its screen, or is mapped in the reviewed
 * docs/redesign-v2/renames.json. Baseline = docs/redesign-v2/baseline/labels.json
 * (captured on react-rebuild @ cb7c4d8 by e2e/baseline-capture.spec.ts).
 *
 * Asserted: tabs, controls, table headers, ledger terms, eyebrows, buttons,
 * links and short headings. Not asserted (recorded only): jargon affordances,
 * data-composed headings (digits or > 60 chars), labels carrying a date or a
 * bare number, and anything matched by an `ignore` rule in renames.json.
 * A miss report is written to test-results/label-parity-report.json.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { normalizeLabel, type LabelRec } from "./lib/labels";
import { harvestLabels, harvestShellOverlays } from "./lib/harvest";
import { settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const BASELINE_PATH = process.env.BASELINE_LABELS ?? path.join(DOCS, "baseline", "labels.json");
const RENAMES_PATH = process.env.RENAMES ?? path.join(DOCS, "renames.json");
const REPORT_PATH = path.resolve(process.cwd(), "test-results", "label-parity-report.json");

interface Baseline {
  base_sha?: string;
  screens: Record<string, { route: string; labels: LabelRec[] }>;
}
interface IgnoreRule {
  screen?: string;
  kind?: string;
  scope?: string;
  pattern?: string;
  reason: string;
}
interface Renames {
  renames?: Record<string, Record<string, string | string[]>>;
  ignore?: IgnoreRule[];
}

const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
// Norms are recomputed from the stored raw text so a normalizer refinement applies to both sides.
for (const s of Object.values(baseline.screens)) for (const l of s.labels) l.norm = normalizeLabel(l.text);
const renames: Renames = fs.existsSync(RENAMES_PATH) ? JSON.parse(fs.readFileSync(RENAMES_PATH, "utf8")) : {};

const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
const NOT_ASSERTED_KINDS = new Set(["jargon", "h5", "h6"]);

function volatile(l: LabelRec): boolean {
  if (NOT_ASSERTED_KINDS.has(l.kind)) return true;
  const hasDigit = /\d/.test(l.text);
  if (["h2", "h3", "h4"].includes(l.kind) && (l.text.length > 60 || hasDigit)) return true;
  if (hasDigit && MONTH.test(l.text)) return true; // dated meta strings
  if (/^[+\-−▲▼]?\$?\d/.test(l.text.trim())) return true; // bare numbers / prices
  if (l.kind === "link" && /^https?:/i.test(l.text)) return true;
  return false;
}

function ignored(screen: string, l: LabelRec): boolean {
  for (const r of renames.ignore ?? []) {
    if (r.screen && r.screen !== screen && r.screen !== "*") continue;
    if (r.kind && r.kind !== l.kind) continue;
    if (r.scope && r.scope !== (l.scope ?? "")) continue;
    if (r.pattern && !new RegExp(r.pattern, "i").test(l.norm)) continue;
    return true;
  }
  return false;
}

// Rename keys are normalized with the same function as the labels, so a
// normalizer refinement never orphans a reviewed mapping.
const renameIndex: Record<string, Record<string, string[]>> = {};
for (const [scope, map] of Object.entries(renames.renames ?? {})) {
  renameIndex[scope] = {};
  for (const [from, to] of Object.entries(map)) {
    renameIndex[scope][normalizeLabel(from)] = (Array.isArray(to) ? to : [to]).map(normalizeLabel);
  }
}

function renamedTargets(screen: string, norm: string): string[] {
  const out: string[] = [];
  for (const key of [screen, "*"]) {
    const t = renameIndex[key]?.[norm];
    if (t) out.push(...t);
  }
  return out;
}

const report: Record<string, { checked: number; missing: { text: string; kind: string; scope: string | null }[] }> = {};
function record(screen: string, checked: number, missing: LabelRec[]) {
  report[screen] = { checked, missing: missing.map((m) => ({ text: m.text, kind: m.kind, scope: m.scope })) };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ baseline_sha: baseline.base_sha, generated_at: new Date().toISOString(), screens: report }, null, 2));
}

function compare(screen: string, current: LabelRec[]): { checked: number; missing: LabelRec[] } {
  const present = new Set(current.map((l) => l.norm));
  const seen = new Set<string>();
  const missing: LabelRec[] = [];
  let checked = 0;
  for (const l of baseline.screens[screen]?.labels ?? []) {
    if (seen.has(l.norm)) continue;
    seen.add(l.norm);
    if (volatile(l) || ignored(screen, l)) continue;
    checked++;
    if (present.has(l.norm)) continue;
    if (renamedTargets(screen, l.norm).some((t) => present.has(t))) continue;
    missing.push(l);
  }
  return { checked, missing };
}

const SCREENS = Object.entries(baseline.screens).filter(([name]) => name !== "kit" && name !== "shell");

for (const [name, s] of SCREENS) {
  test(`label parity: ${name}`, async ({ page }) => {
    await page.goto(s.route, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    const current = await harvestLabels(page);
    const { checked, missing } = compare(name, current);
    record(name, checked, missing);
    expect(
      missing.map((m) => `${m.kind}: ${m.text}${m.scope ? ` (#${m.scope})` : ""}`),
      `${missing.length} of ${checked} baseline labels missing on ${name}; map them in docs/redesign-v2/renames.json if renamed`,
    ).toEqual([]);
  });
}

if (baseline.screens.shell) {
  test("label parity: shell overlays", async ({ page }) => {
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    const current = [...(await harvestLabels(page)), ...(await harvestShellOverlays(page))];
    const { checked, missing } = compare("shell", current);
    record("shell", checked, missing);
    expect(
      missing.map((m) => `${m.kind}: ${m.text}${m.scope ? ` (#${m.scope})` : ""}`),
      `${missing.length} of ${checked} baseline shell labels missing`,
    ).toEqual([]);
  });
}
