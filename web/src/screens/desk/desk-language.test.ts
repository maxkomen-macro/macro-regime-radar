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
 * string does. Build Notes is scanned as the page prints it: the words of
 * docs/desk/BUILD_NOTES.md after the page's holds (./notes/notes.ts), under
 * the same list and the same recession allowance (review R-10, verifier B-5).
 * Not scanned: tests and saved engine payloads (they carry the words on
 * purpose, as inputs to the gate or as the engine's own text); in gate.ts,
 * the ban list's own entries (a list of the words is the words). "model"
 * passes only in a sentence about the recession regression: one that names
 * the recession probability, a logistic regression or the logistic model.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readNotes } from "./notes/notes";

const BANNED = /\b(will|predicts|proves|guaranteed|always|never|obviously|models?|established|significant)\b/gi;
/** Frame-3's two words (§1.5). */
const FRAME3 = /^(established|significant)$/i;
/** Frame-2 files that v2 has not rebuilt or retired yet: they keep the frame-2
 * list; frame-3's two words are checked on them when their tab lands
 * (FRAME3_REPORT.md tracks this list until it is empty). */
export const LEGACY_FRAME2 = ["/src/screens/desk/pyformat"];
const legacy = (file: string) => LEGACY_FRAME2.some((p) => file.startsWith(p));
/** A sentence about the recession regression, the one thing the Desk calls a model. */
const RECESSION_SENTENCE = /recession probability|logistic regression|logistic model/i;
/** The two Regime boxes, verbatim from DESK_FRAME3_SPEC §5: the one that says
 * the regime rule is not a model, and the one that says the recession
 * probability is the site's one fitted model. */
const SPEC_MODEL_SENTENCES = [/^No model, no fitting\.$/, /^a fitted model — five monthly indicators against NBER recession dates since 1970\.$/];
/** The Snowflake bridge's schema, "exactly as on the board" (DESK_FRAME3_SPEC §11): its two
 * lines about the layers ("never edited", "never patched") describe the data, not a forecast. */
const BOARD_LINES = [/^-- RAW: exact copy of source, never edited$/, /^-- MART: what Desk reads\. Rebuilt, never patched\.$/];
const BOARD_FILES = ["/src/screens/desk/pipeline/PipelinePage.tsx", "/src/fixtures/desk/pipeline-ddl.ts"];

// Read through Vite's import.meta.glob (raw, eager), as hook-coverage does, so
// the scan needs no Node types and sees exactly the files the build sees.
const SOURCES = import.meta.glob<string>(["/src/**/desk/**/*.{ts,tsx,md}", "/src/api/desk.ts"], { query: "?raw", import: "default", eager: true });
const FIXTURES = import.meta.glob<unknown>("/src/fixtures/desk/*.json", { import: "default", eager: true });
const NOTES = import.meta.glob<string>("../../../../docs/desk/BUILD_NOTES.md", { query: "?raw", import: "default", eager: true });

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
    // Data keys, never printed: a literal type, a case label, an operand of
    // === / !==, an object key or an index (the engine's "established" value
    // is compared and mapped, then printed in §1.5's words).
    if (ts.isLiteralTypeNode(n)) return;
    if (ts.isCaseClause(n)) return void n.statements.forEach(visit);
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
      // Only a literal operand is a data key; anything else is still scanned (verifier E-11).
      for (const side of [n.left, n.right]) if (!ts.isStringLiteral(side) && !ts.isNoSubstitutionTemplateLiteral(side)) visit(side);
      return;
    }
    if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name)) return visit(n.initializer);
    if (ts.isElementAccessExpression(n)) return visit(n.expression);
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
    .flatMap((sentence) =>
      [...sentence.matchAll(BANNED)].map((m) => m[0]).filter((w) => !(/^models?$/i.test(w) && (RECESSION_SENTENCE.test(sentence) || (file.endsWith("/regime/RegimePage.tsx") && SPEC_MODEL_SENTENCES.some((r) => r.test(sentence.trim())))))),
    );
  // wording.ts: the certainty list's entries are the words themselves (§9).
  if (file.endsWith("/positions/wording.ts") && /^[a-z]+$/.test(s.trim()) && words.length === 1) return [];
  // The board's schema lines, in the two files that quote them: "never" there and nowhere else.
  if (BOARD_FILES.some((f) => file === f)) {
    const lines = s.split("\n").map((l) => l.trim()).filter((l) => /\bnever\b/i.test(l));
    if (lines.every((l) => BOARD_LINES.some((r) => r.test(l)))) return words.filter((w) => !/^never$/i.test(w));
  }
  return words;
}

describe("the Desk's language ban list", () => {
  const files = deskFiles();

  it("covers the Desk's pages, the adapter and the content", () => {
    expect(files).toEqual(expect.arrayContaining(["/src/api/desk.ts", "/src/screens/desk/overview/OverviewPage.tsx", "/src/screens/desk/kit/ui.tsx", "/src/screens/desk/pipeline/PipelinePage.tsx"]));
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

  it("Build Notes prints no banned word: the file as the page renders it", () => {
    const md = Object.values(NOTES)[0];
    expect(md, "docs/desk/BUILD_NOTES.md").toBeTruthy();
    const n = readNotes(md);
    const hits = [n.title ?? "", n.lead, ...n.sections.flatMap((x) => [x.title, x.body])]
      .flatMap((t) => t.split(/\n\s*\n/))
      .map((para) => para.replace(/\s*\n\s*/g, " "))
      .filter((para) => offending("/docs/desk/BUILD_NOTES.md", para).length)
      .map((para) => `[${offending("/docs/desk/BUILD_NOTES.md", para).join(", ")}] ${para.slice(0, 120)}`);
    expect(hits).toEqual([]);
  });

  it("the scanner skips data keys: literal types, case labels, comparisons, object keys", () => {
    const src = `type E = "established"; if (e === "established") x(); if (t("always") === k) y(); switch (e) { case "significant": say("never"); break; } const m = { "established": "Reliable" }; const v = m["established"];`;
    const got = stringsOf("x.ts", src);
    expect(got).toEqual(["always", "never", "Reliable"]);
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
