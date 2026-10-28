/**
 * The Finder's response boundary against its renderer (independent review finding 3, Codex S-20): every nested
 * field of a served answer, removed or replaced by a value of the wrong kind, either passes the boundary as
 * something the page can render or is not read (the row is dropped and counted, the block is removed). The page
 * never throws on what the boundary lets through.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/utils";
import finder from "../../../fixtures/desk/options-finder.json";
import { checkAnswer, schemaFor } from "../data/schema";
import { finderRows } from "../data/finder-rows";
import type { OptionsFinderResponse } from "../data/types";
import { Answer } from "./OptionsFinderPage";

type J = Record<string, unknown>;
const ANSWERS = (finder as { answers: Record<string, J> }).answers;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const BAD: [string, unknown][] = [
  ["removed", undefined],
  ["null", null],
  ["an object", { bad: 1 }],
  ["a list", [{ bad: 1 }]],
  ["a string", "bad"],
  ["a number", 7],
];

/** Every path inside `v` (object keys and the first item of each list). */
function paths(v: unknown, at: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  if (Array.isArray(v)) {
    if (v.length) {
      out.push([...at, 0]);
      paths(v[0], [...at, 0], out);
    }
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push([...at, k]);
      paths(x, [...at, k], out);
    }
  }
  return out;
}

function set(root: J, path: (string | number)[], value: unknown) {
  let o = root as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (value === undefined && !Array.isArray(o)) delete o[last];
  else o[last] = value;
}

function renders(answer: J): void {
  const checked = checkAnswer(answer, schemaFor("/options/finder")!);
  if (!checked) return; // the whole answer is unreadable: the page says so (a separate state)
  const d = finderRows(checked as unknown as OptionsFinderResponse);
  const { unmount } = renderWithProviders(<Answer d={d} />, { route: "/desk/options-finder" });
  const all = screen.queryByTestId("of-all");
  if (all) fireEvent.click(all);
  unmount();
}

for (const key of Object.keys(ANSWERS)) {
  const base = ANSWERS[key];
  const picks = Object.values(base.picks as Record<string, string | null>).filter(Boolean);
  // One row: the first pick's, moved to the front so its card, the chart and the table's first page all read it.
  const top = (base.rows as J[]).find((r) => r.contract === picks[0]) as J;
  const rest = (base.rows as J[]).filter((r) => r.contract === picks[1] || r.contract === picks[2]);
  const one = { ...clone(base), rows: [clone(top), ...clone(rest)] };
  const cases = paths(one).filter((p) => !(p[0] === "rows" && p[1] !== 0) && p[0] !== "as_of");
  describe(`the Finder's boundary and renderer agree: ${key.split("&").slice(0, 2).join(" ")}`, () => {
    it(`no field of the answer, removed or of the wrong kind, makes the page throw (${cases.length} fields × ${BAD.length})`, () => {
      const thrown: string[] = [];
      for (const p of cases)
        for (const [label, value] of BAD) {
          const a = clone(one) as J;
          set(a, p, value);
          try {
            renders(a);
          } catch (err) {
            thrown.push(`${p.join(".")} ${label}: ${(err as Error).message.split("\n")[0]}`);
          }
        }
      expect(thrown).toEqual([]);
    });
  });
}
