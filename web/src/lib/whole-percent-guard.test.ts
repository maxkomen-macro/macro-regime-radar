/**
 * fix/site-audit D-e: the web's probability formatters print a whole percent
 * only through roundHalfUp (lib/format.ts). Math.round(p * 100) rounds the
 * double (0.285 * 100 is 28.4999…, so 28), and (p * 100).toFixed(0) does the
 * same; the Python guard (tests/test_whole_percent.py) holds the same rule for
 * the Python printers. The guard reads the TypeScript syntax tree, so a comment
 * or a string that only mentions the pattern never trips it, and extra
 * parentheses or 100 * p never hide one. A print of something that is not a
 * probability says so on its line: `// not a probability`.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** The modules that print a probability (the regime odds, the classifier's confidence, a verdict's confidence level). */
const PROBABILITY_FORMATTERS = [
  "src/lib/format.ts",
  "src/screens/desk/kit/format.ts",
  "src/components/data/ProbabilityBar.jsx",
  "src/components/signals/RegimeBadge.jsx",
  "src/screens/dashboard/RegimeOddsChart.tsx",
  "src/screens/credit/CreditStateOdds.tsx",
  "src/screens/desk/regime/RegimePage.tsx",
  "src/screens/regimelab/ScenariosTab.tsx",
  "src/screens/desk/event-study/StudyRail.tsx",
];
const PRAGMA = "// not a probability";
// Read raw, like KitScreen.test.tsx (the app's tsconfig carries no Node types).
const SOURCES = import.meta.glob<string>(
  [
    "/src/lib/format.ts",
    "/src/screens/desk/kit/format.ts",
    "/src/components/data/ProbabilityBar.jsx",
    "/src/components/signals/RegimeBadge.jsx",
    "/src/screens/dashboard/RegimeOddsChart.tsx",
    "/src/screens/credit/CreditStateOdds.tsx",
    "/src/screens/desk/regime/RegimePage.tsx",
    "/src/screens/regimelab/ScenariosTab.tsx",
    "/src/screens/desk/event-study/StudyRail.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

function times100(node: ts.Node): boolean {
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const is100 = (e: ts.Expression) => ts.isNumericLiteral(e) && Number(e.text) === 100;
      if (is100(n.left) || is100(n.right)) hit = true;
    }
    if (!hit) ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

export function wholePercentOffences(source: string, fileName = "snippet.tsx"): string[] {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : fileName.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split("\n");
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const callee = n.expression;
      const mathRound = ts.isIdentifier(callee.expression) && callee.expression.text === "Math" && callee.name.text === "round";
      const toFixed0 = callee.name.text === "toFixed" && (n.arguments.length === 0 || (ts.isNumericLiteral(n.arguments[0]) && Number(n.arguments[0].text) === 0));
      const hit = (mathRound && n.arguments.length > 0 && times100(n.arguments[0])) || (toFixed0 && times100(callee.expression));
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      if (hit && !lines[line].includes(PRAGMA)) out.push(`${line + 1}: ${n.getText(sf)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("whole percents in the web's probability formatters (fix/site-audit D-e)", () => {
  it("reads every formatter it names", () => {
    expect(Object.keys(SOURCES).sort()).toEqual(PROBABILITY_FORMATTERS.map((p) => `/${p}`).sort());
  });

  it.each(PROBABILITY_FORMATTERS)("%s prints a whole percent only through roundHalfUp", (path) => {
    expect(wholePercentOffences(SOURCES[`/${path}`], path)).toEqual([]);
  });

  it.each([
    "const a = Math.round(p * 100);",
    "const a = Math.round(100 * p);",
    "const a = Math.round(((p) * 100));",
    "const a = `${Math.round(s.verdict_confidence * 100)}% range`;",
    "const a = (p * 100).toFixed(0);",
    "const a = (100 * p).toFixed();",
  ])("catches %s", (src) => {
    expect(wholePercentOffences(src)).not.toEqual([]);
  });

  it.each([
    "// const a = Math.round(p * 100);",
    "/* Math.round(0.285 * 100) sees the double */ const a = 1;",
    'const a = "Math.round(p * 100)";',
    "const a = roundHalfUp(p, 2);",
    "const a = Math.round(w * 1000) / 10;",
    "const a = (p * 100).toFixed(1);",
    "const a = Math.round(share * 10) / 10;",
    "const a = Math.round(w * 100); // not a probability: a portfolio weight",
  ])("leaves %s", (src) => {
    expect(wholePercentOffences(src)).toEqual([]);
  });
});
