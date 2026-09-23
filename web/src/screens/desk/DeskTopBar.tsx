/**
 * The Desk top bar (spec §4): the Desk / Client toggle, persisted in the URL
 * by useDeskView, the "Export one-pager" control the client view adds, and
 * the Walkthrough control (frame-2 §6), which opens step 1 of the tour.
 * The left cell states the view's effect in words, so the toggle never
 * carries the meaning alone. Export prints the same DOM through the print
 * block in desk.css; there is no second template.
 */

import { useLocation, useNavigate } from "react-router-dom";
import { Segmented } from "../../components";
import type { DeskView } from "./desk-view";
import { TOUR_BUTTON_ID, TOUR_STRIP_ID } from "./tour/TourStrip";
import { parseTour, tourHref } from "./tour/tour";

const VIEW_OPTIONS = [
  { id: "desk", label: "Desk", title: "Working detail: z-scores, N, intervals, method ids, the query builder" },
  { id: "client", label: "Client", title: "Verdicts and headline numbers in words; working detail hidden" },
];

export default function DeskTopBar({ view, onChangeView }: { view: DeskView; onChangeView: (v: DeskView) => void }) {
  const client = view === "client";
  const navigate = useNavigate();
  const touring = parseTour(useLocation().search) != null;
  return (
    <header className="mrr-desk-top">
      <p className="mrr-desk-crumb" role="status">
        <span>{client ? "Client view" : "Desk view"}</span>
        <span aria-hidden="true">·</span>
        <span style={{ color: "var(--text-4)" }}>{client ? "working detail hidden" : "working detail shown"}</span>
      </p>
      <div className="mrr-desk-top-r">
        <button
          type="button"
          id={TOUR_BUTTON_ID}
          className="mrr-btn"
          aria-pressed={touring}
          aria-controls={touring ? TOUR_STRIP_ID : undefined}
          onClick={() => navigate(tourHref(1))}
          title="Six steps through the Desk, each a real page; Back and Next, nothing plays by itself"
          data-print-hide="true"
          data-testid="desk-walkthrough"
        >
          Walkthrough
        </button>
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
