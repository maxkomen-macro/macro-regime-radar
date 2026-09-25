/**
 * Build Notes (DESK_FRAME2_SPEC §5): web/src/content/desk/BUILD_NOTES.md,
 * the owner's text copied byte for byte from docs/desk/BUILD_NOTES.md and
 * rendered as is through the shell's Markdown renderer. The file's own `#`
 * title is the page's h1 (the Desk head owns the route's one h1) and its `##`
 * sections render at h2 under it; nothing in the prose is edited. No data
 * source, so the badge declares Designed.
 */

import { Card } from "../../../components";
import Markdown from "../../shell/Markdown";
import notes from "../../../content/desk/BUILD_NOTES.md?raw";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import type { DeskPage } from "../desk-sections";

/** Pure: a Markdown file split into its leading `# ` title and the rest. */
export function splitTitle(text: string): { title: string | null; body: string } {
  const m = /^#[ \t]+(.+?)[ \t]*\r?\n/.exec(text);
  return m ? { title: m[1], body: text.slice(m[0].length) } : { title: null, body: text };
}

export default function BuildNotesPage({ page }: { page: DeskPage }) {
  const { title, body } = splitTitle(notes);
  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} title={title ?? page.label} badge={<StatusBadge designed note="Authored text with no data source; the words are the owner's, rendered as written." />} />
      <Card as="section" variant="panel" className="mrr-desk-notes" aria-label="Build notes">
        <Markdown text={body} headingLevel={2} />
      </Card>
    </div>
  );
}
