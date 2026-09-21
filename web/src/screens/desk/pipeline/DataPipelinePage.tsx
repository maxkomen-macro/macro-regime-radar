/**
 * Data Pipeline (docs/desk/DESK_FRAME_SPEC.md §5): the lineage diagram, the
 * series inventory generated from the pipeline config through
 * /api/desk/pipeline/inventory (series, source id, cadence, as-of, feeds,
 * status), and the RAW → CUR → MART schema block rendered from
 * web/src/content/desk/schema.md. Every as-of word and status word is the
 * server's state through fresh-state.ts; the page prints, it never judges.
 */

import { useMemo } from "react";
import { DataTable } from "../../../components";
import { useDeskInventory, type InventoryRow } from "../../../api/desk";
import { fmtUtcStampEt } from "../../../lib/format";
import ScrollTable from "../../shared/ScrollTable";
import { freshLabel, labelText, normalizeState, toneColor, toneGlyph } from "../../shared/fresh-state";
import { Caption, StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel } from "../desk-ui";
import { useDeskView } from "../desk-view";
import schemaMd from "../../../content/desk/schema.md?raw";
import Lineage from "./Lineage";
import { parseSchema } from "./schema-parse";

const STATUS_WORD: Record<string, string> = { live: "Live", delayed: "Delayed", close: "Current", stale: "Stale", fallback: "Stated default", unknown: "Unknown" };

function groupOf(r: InventoryRow): string {
  if (r.kind === "fred") return r.cadence === "monthly" ? "FRED · monthly prints" : "FRED · daily series";
  if (r.kind === "market") return "Stored market data";
  if (r.kind === "live") return "Live relay";
  return "Derived";
}

const GROUP_ORDER = ["FRED · daily series", "FRED · monthly prints", "Stored market data", "Live relay", "Derived"];

export default function DataPipelinePage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const inv = useDeskInventory();
  const schema = useMemo(() => parseSchema(schemaMd), []);

  const groups = useMemo(() => {
    const by = new Map<string, InventoryRow[]>();
    for (const r of inv.data?.series ?? []) {
      const g = groupOf(r);
      by.set(g, [...(by.get(g) ?? []), r]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ key: g, label: g, rows: by.get(g)! }));
  }, [inv.data]);

  const stamp = inv.data?.generated_at ? fmtUtcStampEt(inv.data.generated_at) : null;
  const badge = <StatusBadge source={{ label: "pipeline", asOf: stamp, reason: inv.data ? `Inventory generated from the freshness report; overall verdict ${inv.data.overall ?? "unknown"}.` : "The inventory has not answered yet." }} />;

  const columns = [
    { key: "label", label: "Series", render: (r: InventoryRow) => r.label, sub: (r: InventoryRow) => (r.kind === "fred" ? undefined : r.id), subBlock: true },
    { key: "source", label: "Source ID", mono: true, render: (r: InventoryRow) => r.source_id ?? "—", sub: (r: InventoryRow) => r.source, subBlock: true },
    { key: "cadence", label: "Cadence", mono: true },
    {
      key: "as_of",
      label: "As of",
      mono: true,
      render: (r: InventoryRow) => {
        const l = freshLabel(r);
        return (
          <span title={r.reason} data-stale={l.stale ? "true" : undefined} style={{ color: l.tone === "unknown" ? "var(--text-3)" : undefined }}>
            {labelText(l)}
          </span>
        );
      },
    },
    {
      key: "state",
      label: "Status",
      mono: true,
      render: (r: InventoryRow) => {
        const st = normalizeState(r.state);
        const l = freshLabel(r);
        return (
          <span title={r.reason} style={{ color: toneColor(l.tone), display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span aria-hidden="true" style={{ fontSize: 9 }}>
              {toneGlyph(l.tone)}
            </span>
            {STATUS_WORD[st]}
          </span>
        );
      },
    },
    {
      key: "feeds",
      label: "Feeds",
      render: (r: InventoryRow) =>
        r.feeds.length ? <span style={{ whiteSpace: "normal", display: "inline-block", minWidth: 220, maxWidth: 340, lineHeight: 1.45 }}>{r.feeds.join(" · ")}</span> : <span style={{ color: "var(--text-3)" }}>no reader recorded</span>,
    },
  ].filter((c) => !isClient || !["cadence", "source"].includes(c.key));

  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} description={page.blurb} badge={badge} />

      <Panel id="lineage" title="Lineage" description="The route a number takes before it reaches a page. The arrows are the order; nothing skips a step." badge={badge}>
        <Lineage />
      </Panel>

      <Panel id="inventory" title="Series inventory" description={isClient ? "Every source, how fresh it is and who reads it." : "Generated from the pipeline config through /api/desk/pipeline/inventory; the as-of and status words are the server's freshness states."} badge={badge} meta={inv.data ? `${inv.data.series.length} series · overall ${inv.data.overall ?? "unknown"}` : undefined}>
        {inv.data ? (
          groups.length ? (
            <ScrollTable label="Series inventory">
              <DataTable caption="Series inventory" columns={columns} groups={groups} zebra={false} />
            </ScrollTable>
          ) : (
            <EmptyState title="The inventory answered with no series.">The freshness report carried no series states; the database may predate the watermark table.</EmptyState>
          )
        ) : (
          <StateNote loading={inv.isLoading} error={inv.isError} live>
            Reading the series inventory…
          </StateNote>
        )}
        {!isClient ? (
          <Caption>
            Unknown means the true observation date is not recorded for this database yet (FRED daily rows are month-stamped; the watermark table supplies the date). Stale counts publications behind the newest one due. Nothing here is judged in the browser.
          </Caption>
        ) : null}
      </Panel>

      <Panel id="schema" title="Store schema" description="RAW → CUR → MART, from web/src/content/desk/schema.md." badge={<StatusBadge designed note="Reference content from a tracked Markdown file; no data source." />}>
        {schema.intro ? <Caption as="p" style={{ marginTop: 0, marginBottom: 12 }}>{schema.intro}</Caption> : null}
        <div className="mrr-desk-schema">
          {schema.tiers.map((t, i) => (
            <div key={t.name} className="mrr-desk-tier">
              <h3>
                {i > 0 ? (
                  <span aria-hidden="true" style={{ color: "var(--text-4)", marginRight: 8 }}>
                    →
                  </span>
                ) : null}
                {t.name}
              </h3>
              {t.description ? <p>{t.description}</p> : null}
              <ul>
                {t.items.map((it) => (
                  <li key={it.table}>
                    <code>{it.table}</code>
                    <span>{it.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
