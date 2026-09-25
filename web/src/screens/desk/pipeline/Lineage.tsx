/**
 * The lineage diagram (spec §5): Sources → Fetch → Validate → Transform →
 * Store → Serve. Six steps in reading order with a hand-drawn arrow between
 * each; the order is the real sequence a number travels, so the connectors
 * carry information rather than decoration. HTML, not one wide SVG, so the
 * row wraps to two and then one column on a phone and every word stays
 * legible and selectable.
 */

const STEPS: { title: string; lines: string[] }[] = [
  { title: "Sources", lines: ["FRED (macro, yields, spreads)", "yfinance (stored bars)", "EODHD (relay, on-demand)", "Finnhub · NewsAPI · RSS"] },
  { title: "Fetch", lines: ["fetch_data.py: FRED + watermarks", "fetch_market.py: completed bars", "news.py: headlines, scoring", "GitHub Actions on schedule"] },
  { title: "Validate", lines: ["scripts/validate_db.py", "integrity, counts, max-date", "freshness verdicts by mode", "upload only on pass"] },
  { title: "Transform", lines: ["4-way regime classifier", "five monitored signals", "recession probability (logistic model)", "surprises, AI reads"] },
  { title: "Store", lines: ["SQLite macro_radar.db", "data-latest release asset", "generations in the API worker", "read-only from here on"] },
  { title: "Serve", lines: ["FastAPI api/ (/api/*, freshness)", "React web/ and this Desk", "every number carries its as-of"] },
];

function Arrow() {
  return (
    <svg className="mrr-desk-lineage-arrow" width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 7h18" />
      <path d="M14.5 2.5L20 7l-5.5 4.5" />
    </svg>
  );
}

export default function Lineage() {
  return (
    <ol className="mrr-desk-lineage" aria-label="Data lineage, from sources to the served page">
      {STEPS.map((s, i) => (
        <li key={s.title} className="mrr-desk-lineage-step">
          <div className="mrr-desk-lineage-node">
            <h3>{s.title}</h3>
            <ul>
              {s.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          {i < STEPS.length - 1 ? <Arrow /> : null}
        </li>
      ))}
    </ol>
  );
}
