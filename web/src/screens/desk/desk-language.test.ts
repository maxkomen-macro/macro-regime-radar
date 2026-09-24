/**
 * The language ban list (DESK_FRAME2_SPEC §8, DESK_FRAME3_SPEC §1.5) over
 * every string the Desk can print: string literals, template text and JSX
 * text in every .ts/.tsx file under a `desk/` directory of web/src (plus
 * api/desk.ts), the Markdown under content/desk/, and every string value in
 * the Desk v2 fixtures (src/fixtures/desk/*.json), which stand in for what
 * the API prints. Words: will, predicts, proves, guaranteed, always, never,
 * obviously, and model (or models) outside the recession label; frame-3 adds
 * "established" and "significant", which never appear anywhere (§1.5).
 *
 * Parsed with the TypeScript compiler, so comments never count and every
 * string does. Build Notes is scanned like every other file (review R-10).
 * Not scanned: tests and saved engine payloads (they carry the words on
 * purpose, as inputs to the gate or as the engine's own text); in gate.ts,
 * the ban list's own entries (a list of the words is the words). "model"
 * passes only in a sentence about the recession regression: one that names
 * the recession probability, a logistic regression or the logistic model.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";

const BANNED = /\b(will|predicts|proves|guaranteed|always|never|obviously|models?|established|significant)\b/gi;
/** Frame-3's two words (§1.5). */
const FRAME3 = /^(established|significant)$/i;
/** Frame-2 files that v2 has not rebuilt or retired yet: they keep the frame-2
 * list; frame-3's two words are checked on them when their tab lands
 * (FRAME3_REPORT.md tracks this list until it is empty). */
export const LEGACY_FRAME2 = ["/src/api/desk.ts", "/src/screens/desk/event-study/", "/src/screens/desk/words.ts", "/src/screens/desk/positions/", "/src/screens/desk/pipeline/", "/src/screens/desk/StatusBadge", "/src/screens/desk/badge-sources", "/src/screens/desk/DeskPageHead", "/src/screens/desk/desk-ui", "/src/screens/desk/Seals", "/src/screens/desk/pyformat"];
const legacy = (file: string) => LEGACY_FRAME2.some((p) => file.startsWith(p));
/** A sentence about the recession regression, the one thing the Desk calls a model. */
const RECESSION_SENTENCE = /recession probability|logistic regression|logistic model/i;

// Read through Vite's import.meta.glob (raw, eager), as hook-coverage does, so
// the scan needs no Node types and sees exactly the files the build sees.
const SOURCES = import.meta.glob<string>(["/src/**/desk/**/*.{ts,tsx,md}", "/src/api/desk.ts"], { query: "?raw", import: "default", eager: true });
const FIXTURES = import.meta.glob<unknown>("/src/fixtures/desk/*.json", { import: "default", eager: true });

/** Every string value in a JSON document, keys excluded. */
export function jsonStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(jsonStrings);
  return [];
}

/** Every file the scan covers, as /src/... paths. */
export function deskFiles(): string[] {
  return Object.keys(SOURCES)
    .filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes("__fixtures__"))
    .sort();
}

/** Every printable string in a source file: literals, template text, JSX text. */
export function stringsOf(file: string, text: string): string[] {
  if (file.endsWith(".md")) return text.split("\n");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function offending(file: string, s: string): string[] {
  const words = s
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) => [...sentence.matchAll(BANNED)].map((m) => m[0]).filter((w) => !(/^models?$/i.test(w) && RECESSION_SENTENCE.test(sentence))));
  // gate.ts: the ban list's entries are the words themselves.
  if (file.endsWith("/positions/gate.ts") && /^[a-z]+$/.test(s.trim()) && words.length === 1) return [];
  return words;
}

describe("the Desk's language ban list", () => {
  const files = deskFiles();

  it("covers the Desk's pages, the adapter and the content", () => {
    expect(files).toEqual(expect.arrayContaining(["/src/api/desk.ts", "/src/screens/desk/overview/OverviewPage.tsx", "/src/screens/desk/kit/ui.tsx", "/src/content/desk/schema.md"]));
    expect(files.length).toBeGreaterThan(25);
    expect(Object.keys(FIXTURES)).toEqual(expect.arrayContaining(["/src/fixtures/desk/overview.json", "/src/fixtures/desk/ledger.json"]));
  });

  it("no printable string uses a banned word", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = SOURCES[f];
      for (const s of stringsOf(f, text)) {
        const bad = offending(f, s).filter((w) => !(legacy(f) && FRAME3.test(w)));
        if (bad.length) hits.push(`${f}: [${bad.join(", ")}] ${s.trim().slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no string a fixture serves uses a banned word", () => {
    const hits: string[] = [];
    for (const [f, doc] of Object.entries(FIXTURES)) for (const str of jsonStrings(doc)) if (offending(f, str).length) hits.push(`${f}: ${str.slice(0, 120)}`);
    expect(hits).toEqual([]);
  });

  it("the scanner sees strings and JSX text, never comments", () => {
    const src = `// will never\nconst a = "it will";\nconst b = <p>always {x} obviously</p>;\nconst c = \`t \${y} proves\`;`;
    const got = stringsOf("x.tsx", src).join("|");
    expect(got).toContain("it will");
    expect(got).toContain("always");
    expect(got).toContain("proves");
    expect(got).not.toContain("will never");
    expect(offending("x.tsx", "Recession probability (logistic model)")).toEqual([]);
    expect(offending("x.md", "The recession probability is a model: a logistic regression. The regime label is a trained model.")).toEqual(["model"]);
    expect(offending("x.tsx", "the regime model")).toEqual(["model"]);
    expect(offending("x.md", "It never fails.")).toEqual(["never"]);
  });
});
