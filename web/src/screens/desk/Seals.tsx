/**
 * The seals: the Desk's one signature mark. One ring per gate a position
 * passes (variant view, pre-mortem, falsification); a ring fills mint when
 * its gate is met and turns a dashed amber while the language check holds it
 * open. The sidebar's House Discipline card draws all three filled; the
 * Position Monitor draws the live state of the draft. Decorative in the
 * sidebar, an image with a sentence for its name on the form.
 */

export type SealState = "met" | "open" | "flagged";

export function Seals({ states, size, label }: { states: readonly SealState[]; size?: "lg"; label: string }) {
  return (
    <span className="mrr-desk-seals" data-size={size} role="img" aria-label={label}>
      {states.map((s, i) => (
        <i key={i} className="mrr-desk-seal" data-met={s === "met" ? "true" : s === "flagged" ? "flagged" : undefined} />
      ))}
    </span>
  );
}
