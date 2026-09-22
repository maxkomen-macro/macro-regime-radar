/**
 * The schema block's source (spec §5): web/src/content/desk/schema.md, a
 * tracked Markdown file with one `##` heading per tier (RAW, CUR, MART), a
 * description paragraph and a list of "`table` · what it holds" lines. Parsed
 * here into tiers so the Data Pipeline page can lay them out as three columns
 * with an arrow between; the intro paragraph before the first heading is the
 * block's caption. Pure.
 */

export interface SchemaItem {
  table: string;
  description: string;
}

export interface SchemaTier {
  name: string;
  description: string;
  items: SchemaItem[];
}

export interface SchemaDoc {
  intro: string;
  tiers: SchemaTier[];
}

export function parseSchema(md: string): SchemaDoc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const doc: SchemaDoc = { intro: "", tiers: [] };
  const introLines: string[] = [];
  let tier: SchemaTier | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      tier = { name: h[1].trim(), description: "", items: [] };
      doc.tiers.push(tier);
      continue;
    }
    if (!line) continue;
    const item = /^[-*]\s+`([^`]+)`\s*(?:[·:-]\s*)?(.*)$/.exec(line);
    if (tier && item) {
      tier.items.push({ table: item[1], description: item[2].trim() });
      continue;
    }
    if (tier) tier.description = tier.description ? `${tier.description} ${line}` : line;
    else introLines.push(line);
  }
  doc.intro = introLines.join(" ");
  return doc;
}
