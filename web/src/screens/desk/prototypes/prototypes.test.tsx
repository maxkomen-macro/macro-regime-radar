/**
 * The PROTOTYPE state (DESK_FRAME3_SPEC §1.0.3), held three ways:
 *   1. every PROTOTYPE card renders the footnote as its last line, and no badge;
 *   2. no LIVE module imports a prototype fixture: only modules under
 *      screens/desk/prototypes/ read `proto-*.json` or `vol.json`, and a module
 *      outside it imports nothing from it but the cards a page places;
 *   3. no prototype value is printed outside a PROTOTYPE card: each card's
 *      markers (./markers.ts) appear inside its `[data-prototype]` element and
 *      nowhere else on its page. e2e/desk.spec.ts holds the same on every Desk
 *      page in a browser, on the fixture dev server and on a preview of the
 *      production build.
 */
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import sample from "../../../fixtures/desk/baskets.json";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { SAVED_BASKETS_KEY } from "../basket/weights";
import { PrototypeCard, PrototypeFootnote, PROTOTYPE_LEAD } from "../kit/Prototype";
import { AdvancedPanel, Unserved, useAdvanced } from "../kit/ui";
import { isPrototypeFixture, prototype, PROTOTYPE_CARD_EXPORTS, PROTOTYPES } from "./registry";
import { PROTOTYPE_MARKERS } from "./markers";

const PROTO_DIR = "/src/screens/desk/prototypes/";

// Every app module, read as the build reads it (raw, through Vite), tests and test helpers left out.
const SOURCES = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const APP = Object.keys(SOURCES)
  .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith("/src/test/") && !f.includes("__fixtures__"))
  .sort();

/** "/src/a/b/c.ts" + "../d.json" → "/src/a/d.json"; a package name → null. The query (`?raw`) is dropped. */
export function resolveSpec(file: string, spec: string): string | null {
  const bare = spec.split("?")[0];
  if (!bare.startsWith(".") && !bare.startsWith("/")) return null;
  const parts = (bare.startsWith("/") ? bare : `${file.slice(0, file.lastIndexOf("/"))}/${bare}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return `/${out.join("/")}`;
}

interface Imported {
  target: string;
  names: string[] | "*";
}

/** Every module a file imports (static, re-export, dynamic, import.meta.glob), with the names it takes. */
export function importsOf(file: string, text: string): Imported[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Imported[] = [];
  const add = (spec: string, names: string[] | "*") => {
    const target = resolveSpec(file, spec);
    if (target) out.push({ target, names });
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      // A default import is the name "default"; a namespace import takes everything.
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      const names: string[] | "*" = !c ? [] : c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? "*" : [...(c.name ? ["default"] : []), ...named];
      add(n.moduleSpecifier.text, names);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      add(n.moduleSpecifier.text, n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : "*");
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || callee === "import.meta.glob")
        for (const a of n.arguments) {
          const lits = ts.isStringLiteral(a) ? [a.text] : ts.isArrayLiteralExpression(a) ? a.elements.filter(ts.isStringLiteral).map((e) => e.text) : [];
          for (const l of lits) add(l, "*");
        }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Whether an import (a path, or a glob pattern) can reach a prototype fixture. */
function reachesPrototypeFixture(target: string): boolean {
  if (isPrototypeFixture(target)) return true;
  // A glob over the Desk fixtures that could match proto-*.json or vol.json.
  return /\/fixtures\/desk\/[^/]*[*{]/.test(target) && /\/fixtures\/desk\/(\*|\{|proto|vol)/.test(target);
}

describe("§1.0.3: the PROTOTYPE card and its footnote", () => {
  function Sample() {
    const adv = useAdvanced();
    return (
      <PrototypeCard id="sample" title="A card" sub="drawn finished" production="one line on how it would be built." advanced={<AdvancedPanel enabled adv={adv} items="assumptions" />}>
        <p>body</p>
      </PrototypeCard>
    );
  }

  it("ends with the footnote, in the as-of stamp's style, and carries no badge", () => {
    const { container } = render(<Sample />);
    const card = container.querySelector("[data-prototype]")!;
    expect(card.getAttribute("data-prototype")).toBe("sample");
    const last = card.querySelectorAll("*")[card.querySelectorAll("*").length - 1].closest("[data-prototype-foot]");
    expect(last?.textContent).toBe("Illustrative values · In production: one line on how it would be built.");
    expect(last?.className).toBe("dk-proto-foot");
    expect(card.querySelector('[data-testid="dk-live"]')).toBeNull();
    expect(card.textContent).not.toMatch(/mockup|not yet served|awaiting/i);
  });

  it("is drawn finished inside a page's unavailable scope: its Advanced opens, no reason is printed", () => {
    render(
      <Unserved block={{ reason: "a served block's reason.", until: null }}>
        <Sample />
      </Unserved>,
    );
    expect(screen.getByTestId("dk-advanced")).toBeEnabled();
    expect(screen.queryByText("a served block's reason.")).toBeNull();
  });

  it("the footnote's words: the fixed opening, then the one line", () => {
    const { container } = render(<PrototypeFootnote production="stored and versioned." />);
    expect(container.textContent).toBe(`${PROTOTYPE_LEAD}stored and versioned.`);
  });

  it("every registry row names one line, and one card per id", () => {
    expect(new Set(PROTOTYPES.map((p) => p.id)).size).toBe(PROTOTYPES.length);
    for (const p of PROTOTYPES) {
      expect(p.production, p.id).toMatch(/^[^\n]+\.$/);
      expect(prototype(p.id)).toBe(p);
      expect(PROTOTYPE_MARKERS[p.id]?.length, `${p.id} markers`).toBeGreaterThan(0);
    }
    expect(() => prototype("no-such-card")).toThrow();
  });
});

describe("§1.0.3 rule 4: no LIVE module imports a prototype fixture", () => {
  it("scans every app module", () => {
    expect(APP).toEqual(expect.arrayContaining(["/src/screens/desk/technicals/TechnicalsPage.tsx", "/src/fixtures/desk/index.ts", "/src/screens/desk/kit/Prototype.tsx"]));
    expect(APP.length).toBeGreaterThan(100);
  });

  it("only modules under prototypes/ read proto-*.json or vol.json", () => {
    const bad = APP.filter((f) => !f.startsWith(PROTO_DIR)).flatMap((f) => importsOf(f, SOURCES[f]).filter((i) => reachesPrototypeFixture(i.target)).map((i) => `${f} → ${i.target}`));
    expect(bad).toEqual([]);
  });

  it("a module outside prototypes/ takes nothing from it but the cards", () => {
    const bad = APP.filter((f) => !f.startsWith(PROTO_DIR)).flatMap((f) =>
      importsOf(f, SOURCES[f])
        .filter((i) => i.target.startsWith(PROTO_DIR))
        .filter((i) => i.names === "*" || i.names.some((n) => !PROTOTYPE_CARD_EXPORTS.includes(n)))
        .map((i) => `${f} → ${i.target} {${i.names === "*" ? "*" : i.names.join(", ")}}`),
    );
    expect(bad).toEqual([]);
  });

  it("the scanner resolves paths and reads every import form", () => {
    expect(resolveSpec("/src/screens/desk/x/A.tsx", "../../../fixtures/desk/vol.json")).toBe("/src/fixtures/desk/vol.json");
    expect(resolveSpec("/src/a.ts", "react")).toBeNull();
    const src = `import a from "../../fixtures/desk/proto-x.json" with { type: "json" };\nimport { B, C as D } from "./prototypes/Card";\nexport { E } from "./e";\nconst f = import("./f");\nconst g = import.meta.glob("/src/fixtures/desk/*.json");`;
    const got = importsOf("/src/screens/desk/Page.tsx", src);
    expect(got.map((i) => i.target)).toEqual(["/src/fixtures/desk/proto-x.json", "/src/screens/desk/prototypes/Card", "/src/screens/desk/e", "/src/screens/desk/f", "/src/fixtures/desk/*.json"]);
    expect(got[0].names).toEqual(["default"]);
    expect(got[1].names).toEqual(["B", "C"]);
    expect(reachesPrototypeFixture("/src/fixtures/desk/*.json")).toBe(true);
    expect(reachesPrototypeFixture("/src/fixtures/desk/proto-options.json")).toBe(true);
    expect(reachesPrototypeFixture("/src/fixtures/desk/vol.json")).toBe(true);
    expect(reachesPrototypeFixture("/src/fixtures/desk/technicals.json")).toBe(false);
  });
});

describe("§1.0.3: every PROTOTYPE card on its page, and no prototype value outside one", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    stubDesk();
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify((sample as { baskets: unknown[] }).baskets));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.removeItem(SAVED_BASKETS_KEY);
  });

  // The pages that carry PROTOTYPE cards, and any page the registry adds.
  const pages = [...new Set(["technicals", "basket-hedge", "data-pipeline", ...PROTOTYPES.map((p) => p.page)])];
  const allMarkers = Object.values(PROTOTYPE_MARKERS).flat();

  for (const page of pages)
    it(`${page}: each card ends with its footnote, carries no badge and holds its values`, async () => {
      const { container } = renderWithProviders(
        <Routes>
          <Route path="/desk/:page?" element={<DeskShell />} />
        </Routes>,
        { route: `/desk/${page}` },
      );
      const here = PROTOTYPES.filter((p) => p.page === page);
      await screen.findByRole("heading", { level: 1 });
      await waitFor(() => expect(container.querySelectorAll("[data-prototype]")).toHaveLength(here.length), { timeout: 4000 });
      for (const p of here) {
        const card = container.querySelector(`[data-prototype="${p.id}"]`)!;
        expect(card, p.id).not.toBeNull();
        const foots = card.querySelectorAll("[data-prototype-foot]");
        expect(foots, p.id).toHaveLength(1);
        // The footnote is the card's last line: nothing follows it in document order.
        const all = card.querySelectorAll("*");
        expect(foots[0].contains(all[all.length - 1]), `${p.id}: footnote last`).toBe(true);
        expect(foots[0].textContent).toBe(`${PROTOTYPE_LEAD}${p.production}`);
        expect(card.querySelector('[data-testid="dk-live"]'), `${p.id}: no badge`).toBeNull();
        await waitFor(() => {
          for (const m of PROTOTYPE_MARKERS[p.id]) expect(card.textContent, `${p.id} prints ${m}`).toContain(m);
        });
      }
      const outside = container.cloneNode(true) as HTMLElement;
      outside.querySelectorAll("[data-prototype]").forEach((n) => n.remove());
      const text = outside.textContent ?? "";
      expect(allMarkers.filter((m) => text.includes(m))).toEqual([]);
    });
});
