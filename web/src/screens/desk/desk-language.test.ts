/**
 * The language ban list (DESK_FRAME2_SPEC §8) over every string the Desk can
 * print: string literals, template text and JSX text in every .ts/.tsx file
 * under a `desk/` directory of web/src (plus api/desk.ts), and the Markdown
 * under content/desk/. Words: will, predicts, proves, guaranteed, always,
 * never, obviously, and model (or models) outside the recession label.
 *
 * Parsed with the TypeScript compiler, so comments never count and every
 * string does. Not scanned: tests and saved engine payloads (they carry the
 * words on purpose, as inputs to the gate or as the engine's own text);
 * BUILD_NOTES.md (the owner's prose, rendered as written: §5 says not to edit
 * it); in gate.ts, the ban list's own entries (a list of the words is the
 * words). "model" passes only inside "(logistic model)", the recession label.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";

const BANNED = /\b(will|predicts|proves|guaranteed|always|never|obviously|models?)\b/gi;
const RECESSION_LABEL = /\(logistic model\)/gi;

// Read through Vite's import.meta.glob (raw, eager), as hook-coverage does, so
// the scan needs no Node types and sees exactly the files the build sees.
const SOURCES = import.meta.glob<string>(["/src/**/desk/**/*.{ts,tsx,md}", "/src/api/desk.ts"], { query: "?raw", import: "default", eager: true });

/** Every file the scan covers, as /src/... paths. */
export function deskFiles(): string[] {
  return Object.keys(SOURCES)
    .filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes("__fixtures__") && !p.endsWith("BUILD_NOTES.md"))
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
  const words = [...s.replace(RECESSION_LABEL, "").matchAll(BANNED)].map((m) => m[0]);
  // gate.ts: the ban list's entries are the words themselves.
  if (file.endsWith("/positions/gate.ts") && /^[a-z]+$/.test(s.trim()) && words.length === 1) return [];
  return words;
}

describe("the Desk's language ban list", () => {
  const files = deskFiles();

  it("covers the Desk's pages, the adapter and the content", () => {
    expect(files).toEqual(expect.arrayContaining(["/src/api/desk.ts", "/src/screens/desk/event-study/EventStudyPage.tsx", "/src/screens/desk/today/TodayPage.tsx", "/src/content/desk/schema.md"]));
    expect(files.length).toBeGreaterThan(25);
  });

  it("no printable string uses a banned word", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = SOURCES[f];
      for (const s of stringsOf(f, text)) {
        const bad = offending(f, s);
        if (bad.length) hits.push(`${f}: [${bad.join(", ")}] ${s.trim().slice(0, 120)}`);
      }
    }
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
    expect(offending("x.tsx", "the recession model")).toEqual(["model"]);
  });
});
