/**
 * The four verdict definitions (DESK_FRAME3_SPEC §1.5, v4 B-13), the footer
 * of the Overview's Active signals card and of the Signal Ledger, word for
 * word. Fixed copy: rule v1's definitions, not data.
 */

export const VERDICT_DEFINITIONS = [
  { verdict: "reliable", name: "Reliable", text: "at least ten overlap blocks, with the engine's 90% interval and adverse-share requirements met; zero counts as adverse." },
  { verdict: "suggestive", name: "Suggestive", text: "10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all Reliable criteria are met." },
  { verdict: "no_edge", name: "No edge", text: "at least ten completed outcomes at this horizon, without Reliable evidence or a consistent nonzero excess-median sign across 5, 10 and 20 sessions." },
  { verdict: "insufficient", name: "Too few", text: "fewer than ten completed outcomes at this horizon." },
] as const;

export default function VerdictDefinitions() {
  return (
    <dl className="dk-defs">
      {VERDICT_DEFINITIONS.map((d) => (
        <div key={d.verdict}>
          <dt className="dk-verdict-word" data-verdict={d.verdict}>
            {d.name}
          </dt>
          <dd>— {d.text}</dd>
        </div>
      ))}
    </dl>
  );
}
