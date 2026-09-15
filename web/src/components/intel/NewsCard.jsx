import React from "react";
import { Tag } from "../core/Tag";

/* Significance bands. The pipeline scores 1–5 (score_significance; ≥4.5
   critical / ≥3.5 high / ≥2.5 notable). sigScale=5 aligns the colour bands to
   that ladder; the default 10 keeps the legacy thresholds (contract extension
   2026-08-06). Redesign Phase 8 (checklist 08 A.5): --warn → --amber and
   --text-muted → --text-3; --neg and --warn-hot stay. */
function sigColor(s, scale) {
  if (scale === 5) {
    if (s >= 4.5) return "var(--neg)";
    if (s >= 3.5) return "var(--warn-hot)";
    if (s >= 2.5) return "var(--amber)";
    return "var(--text-3)";
  }
  if (s >= 7) return "var(--neg)";
  if (s >= 5) return "var(--warn-hot)";
  if (s >= 4) return "var(--amber)";
  return "var(--text-3)";
}

/* Dots lit for a 1–5 score: round-half-down (2.5 → 2, 2.6 → 3), clamped to
   0..5. Kept identical to filledDots in screens/news/news-copy.ts. */
function filledDots(x) {
  if (x == null || Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(5, Math.ceil(x - 0.5)));
}

/* Local copies of the screen-ui text styles (screens/shared/screen-ui.tsx
   metaStyle / monoNoteStyle / eyebrowStyle; mockup .meta, .mono-note and
   .eyebrow-sm). The component layer does not import from screens; keep the
   values in step with that file. */
const META = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 400,
  fontSize: 11,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};
const MONO_NOTE = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 400,
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--text-3)",
};
const EYEBROW_SM = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-eyebrow-sm)",
  letterSpacing: "var(--ls-eyebrow-sm)",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

/* The two paragraph labels (mockup lead card row 3 and the opened row block). */
const AI_LABEL = { ...EYEBROW_SM, color: "var(--mint)", letterSpacing: ".14em" };
const WIRE_LABEL = { ...EYEBROW_SM, letterSpacing: ".14em" };
/* Body paragraph under either label (mockup .desc at line-height 1.5). */
const PARA = {
  margin: "3px 0 0",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-2)",
  textWrap: "pretty",
};
/* Attribution glyph lines: ◆ CLAUDE in mint (the AI colour), ◆ PERPLEXITY in
   the research purple. Both stay: they signal which model produced which text. */
const ATTR = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  marginTop: 6,
};
const ATTR_CLAUDE = { ...ATTR, color: "var(--mint)" };
const ATTR_PPLX = { ...ATTR, color: "#a78bfa" };

/* The 11px external-link mark after every headline and source link (mockup). */
function ExtIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      style={{ verticalAlign: 0, flex: "none" }}
    >
      <path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6" />
    </svg>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* "Sig 4.4 / 5" plus five dots. The "Sig " prefix is screen-reader only: the
   visible readout is the number, its colour the significance band, the dots
   the mockup's filled count; innerText (uppercase transform) reads
   "SIG 4.4 / 5", the harvested baseline label. The wrapper carries the filled
   count and every dot its own state, so neither depends on colour alone. */
function Score({ value, scale, style }) {
  const filled = filledDots(value);
  return (
    <span data-score="true" style={{ ...META, color: sigColor(value, scale), whiteSpace: "nowrap", ...style }}>
      <span className="sr-only">Sig </span>
      {value.toFixed(1)}
      {scale === 5 ? " / 5" : ""}
      {scale === 5 ? (
        <span aria-hidden="true" data-filled={String(filled)} style={{ marginLeft: 3 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <i
              key={i}
              data-filled={i < filled ? "true" : "false"}
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                marginLeft: 3,
                background: i < filled ? "var(--mint)" : "var(--track)",
              }}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/* The quiet trigger (checklist 02 B.14): a real button with aria-expanded and
   aria-controls, the ▸ / ▾ glyph decoration only. Base focus ring. */
function Toggle({ open, onClick, controls, style, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      style={{
        appearance: "none",
        background: "none",
        border: 0,
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 28,
        whiteSpace: "nowrap",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontFamily: "var(--font-mono)" }}>
        {open ? "▾" : "▸"}
      </span>
      {children}
    </button>
  );
}

/* Cited sources as "[i] hostname" rows. The full URL is the accessible name
   (aria-label) and the tooltip, so a link is still found by its URL. */
function SourceLinks({ sources }) {
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
      {sources.map((s, i) => (
        <a
          key={`${i}-${s}`}
          href={s}
          target="_blank"
          rel="noreferrer"
          title={s}
          aria-label={s}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--link)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--text-4)" }}>
            [{i + 1}]
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hostOf(s)}</span>
          <ExtIcon />
        </a>
      ))}
    </div>
  );
}

function ReadAt({ href, source }) {
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, letterSpacing: ".02em", color: "var(--link)", whiteSpace: "nowrap" }}
    >
      Read at {source || "source"} →
    </a>
  ) : (
    <span style={{ ...MONO_NOTE, whiteSpace: "nowrap" }}>No source link stored</span>
  );
}

/* "{source} · {time}[ · stored · stale]": the source in its own uppercase span
   (a harvested eyebrow), the clock in the mono note style. */
function SourceMeta({ source, time, stale }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={META}>{source}</span>
      {time || stale ? (
        <span style={MONO_NOTE}>
          {time ? ` · ${time}` : ""}
          {stale ? (
            <>
              {" · "}
              <span style={{ color: "var(--warn-hot)" }}>stored · stale</span>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/* ── variant="row": the More-headlines list row (checklist 08 B.4) ───────────
   Five grid cells (clock, badge, headline + meta, detail, score) laid out by
   app.css .mrr-news-row, then the opt-in block spanning columns 3 to 5. */
function RowCard({
  source,
  time,
  headline,
  href,
  summary,
  significance,
  sigScale,
  interpretation,
  research,
  sources,
  expandable,
  style,
  category,
  categoryTone,
  chip,
  chipTitle,
  clock,
  stale,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const enriched = Boolean(interpretation || research || sources.length);
  const hasSummary = Boolean(summary);
  const canOpen = enriched || hasSummary;
  const showBlock = canOpen && (open || !expandable);
  const paragraph = interpretation || research || null;
  // A research body that is not already the paragraph prints under its own line.
  const extraResearch = interpretation && research ? research : null;
  const readLabel = `Regime read${sources.length ? ` · ${sources.length} sources` : ""}`;

  let detail;
  if (enriched) {
    detail = expandable ? (
      <Toggle open={open} onClick={() => setOpen((v) => !v)} controls={panelId} style={{ fontSize: 11.5, color: "var(--mint)" }}>
        {readLabel}
      </Toggle>
    ) : (
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, color: "var(--mint)", whiteSpace: "nowrap" }}>{readLabel}</span>
    );
  } else if (hasSummary) {
    detail = expandable ? (
      <Toggle
        open={open}
        onClick={() => setOpen((v) => !v)}
        controls={panelId}
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-4)" }}
      >
        Wire summary
      </Toggle>
    ) : (
      <span style={{ ...MONO_NOTE, fontSize: 10.5, color: "var(--text-4)", whiteSpace: "nowrap" }}>Wire summary</span>
    );
  } else {
    detail = <span style={{ ...MONO_NOTE, fontSize: 10.5, color: "var(--text-4)", whiteSpace: "nowrap" }}>Headline only</span>;
  }

  return (
    <div {...rest} className="mrr-news-row" data-stale={stale ? "true" : undefined} style={style}>
      <span style={{ ...MONO_NOTE, whiteSpace: "nowrap" }}>{clock ?? ""}</span>
      <span style={{ justifySelf: "start" }}>
        {category ? (
          <Tag size="sm" tone={categoryTone || "reference"}>
            {category}
          </Tag>
        ) : null}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, color: "var(--text)" }}>
          {href ? (
            <>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13.5,
                  color: "var(--text)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {headline}
              </a>
              <span aria-hidden="true" style={{ color: "var(--text-3)", display: "inline-flex" }}>
                <ExtIcon />
              </span>
            </>
          ) : (
            <span
              style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
            >
              {headline}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 10px", marginTop: 2, minWidth: 0 }}>
          <SourceMeta source={source} time={time} stale={stale} />
          {chip ? (
            <Tag size="xs" tone="reference" title={chipTitle}>
              {chip}
            </Tag>
          ) : null}
          <ReadAt href={href} source={source} />
        </div>
      </div>
      <span style={{ textAlign: "right" }}>{detail}</span>
      <span style={{ textAlign: "right" }}>{significance != null ? <Score value={significance} scale={sigScale} /> : null}</span>
      {canOpen ? (
        <div id={panelId} hidden={!showBlock} style={{ gridColumn: "3 / 6", padding: "2px 0 12px", minWidth: 0 }}>
          {showBlock ? (
            enriched ? (
              <>
                {paragraph ? (
                  <>
                    <span style={AI_LABEL}>◆ Why it matters · AI</span>
                    <p style={PARA}>{paragraph}</p>
                    <div style={interpretation ? ATTR_CLAUDE : ATTR_PPLX}>
                      {interpretation ? "◆ CLAUDE · REGIME INTERPRETATION" : "◆ PERPLEXITY RESEARCH"}
                    </div>
                  </>
                ) : null}
                {extraResearch ? (
                  <>
                    <div style={ATTR_PPLX}>◆ PERPLEXITY RESEARCH</div>
                    <p style={PARA}>{extraResearch}</p>
                  </>
                ) : null}
                {sources.length ? (
                  <>
                    <div style={ATTR_PPLX}>◆ PERPLEXITY SOURCES</div>
                    <SourceLinks sources={sources} />
                  </>
                ) : null}
                {summary ? (
                  <div style={{ marginTop: 8 }}>
                    <span style={WIRE_LABEL}>Wire summary</span>
                    <p style={PARA}>{summary}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ ...PARA, margin: 0 }}>{summary}</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── variant="lead": the Priority-headlines tile (checklist 08 B.3) ─────────── */
function LeadCard({
  source,
  time,
  headline,
  href,
  summary,
  significance,
  sigScale,
  interpretation,
  research,
  sources,
  expandable,
  style,
  category,
  categoryTone,
  chip,
  chipTitle,
  dims,
  stale,
  ...rest
}) {
  const [readOpen, setReadOpen] = React.useState(false);
  const [dimsOpen, setDimsOpen] = React.useState(false);
  const readId = React.useId();
  const dimsId = React.useId();

  // Row 3: the AI read when one exists, else the wire summary, else nothing.
  const paragraph = interpretation
    ? { ai: true, body: interpretation, title: "Claude regime interpretation" }
    : research
      ? { ai: true, body: research, title: "Perplexity research" }
      : summary
        ? { ai: false, body: summary, title: undefined }
        : null;
  // A research body that row 3 did not already print goes into the regime read.
  const extraResearch = interpretation && research ? research : null;
  const hasRead = sources.length > 0 || Boolean(extraResearch);
  const showRead = hasRead && (readOpen || !expandable);
  const hasDims = Array.isArray(dims) && dims.length > 0;
  const showDims = hasDims && (dimsOpen || !expandable);
  const readLabel = `Regime read${sources.length ? ` · ${sources.length} sources` : ""}`;

  return (
    <article
      {...rest}
      data-stale={stale ? "true" : undefined}
      style={{
        borderRadius: "var(--r-tile)",
        border: "1px solid rgba(150,175,200,.10)",
        background: "var(--tile)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {category ? (
          <Tag size="sm" tone={categoryTone || "reference"}>
            {category}
          </Tag>
        ) : null}
        {chip ? (
          <Tag size="xs" tone="reference" title={chipTitle}>
            {chip}
          </Tag>
        ) : null}
        {significance != null ? <Score value={significance} scale={sigScale} style={{ marginLeft: "auto" }} /> : null}
      </div>
      <h3 style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: 16, fontWeight: 500, lineHeight: 1.35, color: "var(--text)", textWrap: "pretty" }}>
        {href ? (
          <>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--text)", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,.18)", textUnderlineOffset: 4 }}
            >
              {headline}
            </a>{" "}
            <span aria-hidden="true" style={{ color: "var(--text-3)" }}>
              <ExtIcon />
            </span>
          </>
        ) : (
          headline
        )}
      </h3>
      {paragraph ? (
        <div>
          <span style={paragraph.ai ? AI_LABEL : WIRE_LABEL} title={paragraph.title}>
            {paragraph.ai ? "◆ Why it matters · AI" : "Wire summary"}
          </span>
          <p style={PARA}>{paragraph.body}</p>
        </div>
      ) : null}
      {hasDims ? (
        <div>
          {expandable ? (
            <Toggle open={dimsOpen} onClick={() => setDimsOpen((v) => !v)} controls={dimsId} style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Score breakdown
            </Toggle>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Score breakdown</span>
          )}
          <div id={dimsId} hidden={!showDims}>
            {showDims ? (
              <div
                style={{
                  display: "flex",
                  gap: "4px 14px",
                  flexWrap: "wrap",
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 12,
                  color: "var(--text-3)",
                  marginTop: 4,
                }}
              >
                {dims.map(([k, v]) => (
                  <span key={k} style={{ whiteSpace: "nowrap" }}>
                    {k} <span style={{ color: v != null && v >= 4 ? "var(--amber)" : "var(--text-2)" }}>{v != null ? `${v.toFixed(0)} / 5` : "—"}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasRead ? (
        <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 8 }}>
          {expandable ? (
            <Toggle open={readOpen} onClick={() => setReadOpen((v) => !v)} controls={readId} style={{ fontSize: 12.5, color: "var(--text-2)" }}>
              {readLabel}
            </Toggle>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{readLabel}</span>
          )}
          <div id={readId} hidden={!showRead}>
            {showRead ? (
              <>
                {extraResearch ? (
                  <>
                    <div style={ATTR_PPLX}>◆ PERPLEXITY RESEARCH</div>
                    <p style={PARA}>{extraResearch}</p>
                  </>
                ) : null}
                {sources.length ? (
                  <>
                    <div style={ATTR_PPLX}>◆ PERPLEXITY SOURCES</div>
                    <SourceLinks sources={sources} />
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <ReadAt href={href} source={source} />
        <SourceMeta source={source} time={time} stale={stale} />
      </div>
    </article>
  );
}

/**
 * News item from the Events & Intelligence reader: headline, significance score,
 * optional Claude regime interpretation and Perplexity cited sources.
 *
 * Redesign Phase 8 (checklist 08 A.5, B.3, B.4): one component, two variants.
 * `variant="row"` (default, today's contract) is the list row; `variant="lead"`
 * is the priority tile. Both keep the link contract (headline and "Read at
 * {source} →" open the article in a new tab with rel="noreferrer"; every cited
 * source is a link named by its URL) and the ◆ CLAUDE / ◆ PERPLEXITY
 * attribution lines.
 */
export function NewsCard({ variant = "row", sources = [], sigScale = 10, expandable = true, ticker, chip, chipTitle, ...props }) {
  // `ticker` (the pre-Phase-8 prop) still renders, as the chip, when no chip is passed.
  const chipText = chip ?? ticker;
  const chipName = chipTitle ?? (chip == null && ticker ? "Ticker" : undefined);
  const shared = { ...props, sources, sigScale, expandable, chip: chipText, chipTitle: chipName };
  return variant === "lead" ? <LeadCard {...shared} /> : <RowCard {...shared} />;
}
