/**
 * Build Notes (docs/desk/DESK_FRAME_SPEC.md §5): a Markdown page rendered
 * from web/src/content/desk/BUILD_NOTES.md through the shell's Markdown
 * renderer with its sections at h2 under the page's h1. Max writes the
 * text; the file ships with the five headings and a one-line placeholder
 * each. No data source, so the badge declares Designed (§3).
 */

import { Card } from "../../../components";
import Markdown from "../../shell/Markdown";
import notes from "../../../content/desk/BUILD_NOTES.md?raw";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import type { DeskPage } from "../desk-sections";

export const BUILD_NOTES_SECTIONS = ["What this is", "What is live vs designed", "Architecture", "The pre-mortem of this tool", "First 90 days on the desk"] as const;

export default function BuildNotesPage({ page }: { page: DeskPage }) {
  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} description="Written by the desk's owner; the file is web/src/content/desk/BUILD_NOTES.md." badge={<StatusBadge designed note="Authored text with no data source. The five sections are the spec's; the words are the owner's." />} />
      <Card as="section" variant="panel" className="mrr-desk-notes">
        <Markdown text={notes} headingLevel={2} />
      </Card>
    </div>
  );
}
