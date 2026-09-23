import { describe, expect, it } from "vitest";
import schemaMd from "../../../content/desk/schema.md?raw";
import { parseSchema } from "./schema-parse";

describe("schema.md", () => {
  it("parses into the three tiers, in order, each with tables", () => {
    const doc = parseSchema(schemaMd);
    expect(doc.tiers.map((t) => t.name)).toEqual(["RAW", "CUR", "MART"]);
    expect(doc.intro).toMatch(/macro_radar\.db/);
    for (const t of doc.tiers) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.items.length, t.name).toBeGreaterThan(2);
      for (const it of t.items) expect(it.table).toMatch(/^[a-z_]+$/);
    }
    expect(doc.tiers[2].items.map((i) => i.table)).toContain("regimes");
  });
});
