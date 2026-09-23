/**
 * The Desk top bar (spec §4): the Desk / Client toggle, persisted in the URL
 * by useDeskView, and the "Export one-pager" control the client view adds.
 * The left cell states the view's effect in words, so the toggle never
 * carries the meaning alone. Export prints the same DOM through the print
 * block in desk.css; there is no second template.
 */

import { Segmented } from "../../components";
import type { DeskView } from "./desk-view";

const VIEW_OPTIONS = [
  { id: "desk", label: "Desk", title: "Working detail: z-scores, N, intervals, method ids, the query builder" },
  { id: "client", label: "Client", title: "Verdicts and headline numbers in words; working detail hidden" },
];

export default function DeskTopBar({ view, onChangeView }: { view: DeskView; onChangeView: (v: DeskView) => void }) {
  const client = view === "client";
  return (
    <header className="mrr-desk-top">
      <p className="mrr-desk-crumb" role="status">
        <span>{client ? "Client view" : "Desk view"}</span>
        <span aria-hidden="true">·</span>
        <span style={{ color: "var(--text-4)" }}>{client ? "working detail hidden" : "working detail shown"}</span>
      </p>
      <div className="mrr-desk-top-r">
        {client ? (
          <button type="button" className="mrr-btn" onClick={() => window.print()} title="Print this page as a one-page client note (the same page, print layout)" data-testid="desk-export">
            Export one-pager
          </button>
        ) : null}
        <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={(id) => onChangeView(id === "client" ? "client" : "desk")} data-testid="desk-view-toggle" />
      </div>
    </header>
  );
}
