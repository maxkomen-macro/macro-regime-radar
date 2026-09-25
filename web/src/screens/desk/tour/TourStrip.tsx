/**
 * The walkthrough strip (DESK_FRAME2_SPEC §6): fixed at the bottom of the
 * Desk while `?tour=N` is in the URL. Step counter, the step's one-line
 * caption, Back and Next; nothing autoplays. Back and Next navigate to the
 * step's own route (tour.ts). The arrow keys move steps unless the key
 * belongs to a control (a field, a select, a segmented toggle); Escape closes
 * unless a jargon tooltip is open (Escape closes that first). Closing clears
 * `tour` from the URL and leaves the page where it is. Hidden in print.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TOUR_STEPS, keyBelongsToControl, tourHref, withoutTour } from "./tour";

export const TOUR_STRIP_ID = "mrr-desk-tour";
/** The header control that opens the walkthrough; focus returns to it on close. */
export const TOUR_BUTTON_ID = "desk-walkthrough";

export default function TourStrip({ step, onClosed }: { step: number; onClosed?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const total = TOUR_STEPS.length;
  const current = TOUR_STEPS[step - 1];
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  const go = (n: number) => {
    if (n < 1 || n > total) return;
    // A button about to be disabled hands focus on first (never to the page).
    if (n === total && document.activeElement === nextRef.current) closeRef.current?.focus();
    if (n === 1 && document.activeElement === backRef.current) nextRef.current?.focus();
    navigate(tourHref(n));
  };
  const close = () => {
    const qs = withoutTour(location.search).toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "", hash: location.hash }, { replace: true });
    document.getElementById(TOUR_BUTTON_ID)?.focus();
    onClosed?.();
  };

  // Focus: opened from the header control, the strip takes it on Next.
  useEffect(() => {
    if (document.activeElement?.id === TOUR_BUTTON_ID) nextRef.current?.focus();
  }, []);

  // The latest handlers for the one document listener.
  const handlers = useRef({ go, close, step });
  handlers.current = { go, close, step };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const h = handlers.current;
      if (e.key === "Escape") {
        // A jargon tooltip open on the page takes Escape first.
        if (document.querySelector(".jargon[aria-expanded='true']")) return;
        e.preventDefault();
        h.close();
        return;
      }
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (keyBelongsToControl(e.target)) return;
      e.preventDefault();
      h.go(h.step + (e.key === "ArrowRight" ? 1 : -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!current) return null;
  return (
    <section id={TOUR_STRIP_ID} className="mrr-desk-tour" aria-label="Walkthrough" data-print-hide="true" data-testid="desk-tour">
      <p className="mrr-desk-tour-count">
        Walkthrough <span aria-hidden="true">·</span> Step {step} of {total}
      </p>
      <p className="mrr-desk-tour-caption" aria-live="polite">
        {current.caption}
      </p>
      <div className="mrr-desk-tour-actions">
        <button type="button" className="mrr-btn" ref={backRef} onClick={() => go(step - 1)} disabled={step <= 1} aria-keyshortcuts="ArrowLeft">
          Back
        </button>
        <button type="button" className="mrr-btn mrr-btn-primary" ref={nextRef} onClick={() => go(step + 1)} disabled={step >= total} aria-keyshortcuts="ArrowRight">
          Next
        </button>
        <button type="button" className="mrr-btn" ref={closeRef} onClick={close} aria-keyshortcuts="Escape" aria-label="Close the walkthrough">
          Close
        </button>
      </div>
    </section>
  );
}
