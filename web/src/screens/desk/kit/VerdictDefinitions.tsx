/**
 * The three verdict definitions side by side (DESK_FRAME3_SPEC §1.5), the
 * footer of the Overview's Active signals card and of the Signal Ledger.
 * Fixed copy: the verdict rules, not data.
 */

export const VERDICT_DEFINITIONS = [
  { verdict: "reliable", name: "Reliable", text: "the edge survives resampling: 10+ independent episodes and fewer than 3% of resamples go the other way" },
  { verdict: "suggestive", name: "Suggestive", text: "leans one way, but too few episodes or the range still crosses zero; don't size on it" },
  { verdict: "no_edge", name: "No edge", text: "about the same as any month; shown so you know it was checked" },
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
