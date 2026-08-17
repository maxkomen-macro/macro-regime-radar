import React from "react";

function sigColor(s, scale) {
  // The pipeline scores 1–5 (score_significance; ≥4.5 critical / ≥3.5 high /
  // ≥2.5 notable). sigScale=5 aligns the color bands to that scale; the
  // default 10 keeps the legacy thresholds. Contract extension 2026-08-06,
  // logged for ratification — default preserves legacy behavior.
  if (scale === 5) {
    if (s >= 4.5) return "var(--neg)";
    if (s >= 3.5) return "var(--warn-hot)";
    if (s >= 2.5) return "var(--warn)";
    return "var(--text-muted)";
  }
  if (s >= 7) return "var(--neg)";
  if (s >= 5) return "var(--warn-hot)";
  if (s >= 4) return "var(--warn)";
  return "var(--text-muted)";
}

/**
 * News item from the Events & Intelligence reader: headline, significance score,
 * optional Claude regime interpretation and Perplexity cited sources.
 */
export function NewsCard({
  source,
  time,
  ticker,
  headline,
  summary,
  significance,
  sigScale = 10,
  interpretation,
  sources = [],
  expandable = true,
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  const hasDetail = Boolean(interpretation || sources.length);
  return (
    <div
      {...rest}
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderRadius: "var(--r-md)",
        padding: "var(--pad-card)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--gap-inline)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-micro)",
          letterSpacing: "var(--ls-wide)",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: "var(--sp-4)",
        }}
      >
        <span style={{ color: "var(--text-label)" }}>{source}</span>
        <span>{time}</span>
        {ticker ? <span style={{ color: "var(--accent)" }}>{ticker}</span> : null}
        {significance != null ? (
          <span style={{ marginLeft: "auto", color: sigColor(significance, sigScale), fontWeight: 700, letterSpacing: "var(--ls-micro)" }}>
            SIG {significance.toFixed(1)}
            {sigScale === 5 ? " / 5" : ""}
          </span>
        ) : null}
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text)", lineHeight: 1.4, textWrap: "pretty" }}>
        {headline}
      </div>
      {summary ? (
        <div style={{ fontSize: "var(--fs-body-s)", color: "var(--text-muted)", lineHeight: "var(--lh-loose)", marginTop: "var(--sp-4)", textWrap: "pretty" }}>
          {summary}
        </div>
      ) : null}
      {hasDetail && expandable ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            appearance: "none",
            background: "none",
            border: "none",
            padding: 0,
            marginTop: "var(--sp-6)",
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
            letterSpacing: "var(--ls-micro)",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {open ? "▾" : "▸"} Regime read {sources.length ? `· ${sources.length} sources` : ""}
        </button>
      ) : null}
      {hasDetail && (open || !expandable) ? (
        <div style={{ marginTop: "var(--sp-6)", paddingTop: "var(--sp-6)", borderTop: "0.5px solid var(--line-hair)" }}>
          {interpretation ? (
            <>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", color: "var(--accent)", marginBottom: "var(--sp-3)" }}>
                ◆ CLAUDE · REGIME INTERPRETATION
              </div>
              <div style={{ fontSize: "var(--fs-body-s)", color: "var(--text-2)", lineHeight: "var(--lh-body)", textWrap: "pretty" }}>{interpretation}</div>
            </>
          ) : null}
          {sources.length ? (
            <div style={{ marginTop: "var(--sp-6)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "var(--ls-micro)", color: "#a78bfa", marginBottom: "var(--sp-3)" }}>
                ◆ PERPLEXITY SOURCES
              </div>
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {sources.map((s) => (
                  <li key={s} style={{ marginBottom: 3 }}>
                    <a href={s} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: "var(--fs-label)", wordBreak: "break-all" }}>
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
