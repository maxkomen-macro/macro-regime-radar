/**
 * TabHero: the tab header of the redesign (docs/redesign-v2/UI_SPEC.md
 * section 3, checklist 02-components B.1), built from DeskRead's types and
 * freshness chips. One serif headline states the tab's answer (never the tab
 * name) with the probability pill beside it, then a one-sentence subhead, the
 * lede, the actions (one white primary, the rest ghost) and a footnote row that
 * carries the freshness chips. The right column holds the tab's signature
 * chart, or the gradient placeholder until a licensed image exists (decision
 * 8); with neither, the hero is a single column.
 *
 * Phase 2 mounts it only on /kit. Each screen swaps DeskRead for TabHero (and
 * its ledger for SummaryCard) in Phases 3 to 9, flipping the wordmark off h1 in
 * the same commit, so `as="h1"` is the default here but no route renders it yet
 * (risk G3). Responsive rules live in app.css as token overrides on .mrr-hero
 * (--hero-cols below 1200, --fs-display below 860, --hero-pad below 768) so the
 * inline styles stay authoritative and still stack.
 *
 * Iteration 1 (R1 / M1 / T1): the right column is a chart slot
 * (`data-chart-slot`) that centres its child on both axes; the signature
 * charts draw through HeroChartFrame (./HeroChart.tsx), which fills the slot
 * at every width instead of a fixed 400 px drawing parked at its right edge.
 */

import { Fragment, useId, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Pill } from "../../components";
import { takeSentences } from "../../lib/sentences";
import { FreshnessChip, type FreshnessTag } from "./DeskRead";
import Disclosure from "./Disclosure";

export type TabHeroPillTone = "mint" | "amber" | "gray";

export interface TabHeroAction {
  label: ReactNode;
  /** Router destination: renders a <Link>. */
  to?: string;
  /** Plain destination: renders an <a>. */
  href?: string;
  /** With neither `to` nor `href`: renders a <button type="button">. */
  onClick?: () => void;
  /** The white primary button (carries the arrow). Defaults to the first action. */
  primary?: boolean;
  ariaLabel?: string;
}

export interface TabHeroProps {
  /** Uppercase eyebrow above the headline ("Current regime"). */
  eyebrow: ReactNode;
  /** Pulsing mint dot in place of the ◆ glyph when the read is in cycle. */
  live?: boolean;
  /** The tab's answer, set in the display face. Loading and unavailable
   * sentences are passed pre-styled in the UI face at 23px (the serif is for
   * answers only). */
  headline: ReactNode;
  /** Heading level; the route's single h1 once a screen adopts the hero. */
  as?: "h1" | "h2";
  /** Pill content beside the headline ("64% probability", "14 months in"). */
  pill?: ReactNode;
  pillTone?: TabHeroPillTone;
  /** One sentence under the headline (h2, or a paragraph when as="h2"). */
  subhead?: ReactNode;
  /** The why-it-matters paragraph (G4: at most three sentences, marked
   * `data-copy="lede"`). */
  lede?: ReactNode;
  /** The rest of a longer lede, verbatim, behind a "Details" disclosure right
   * under it (Iteration 1 step 5: nothing is deleted). */
  ledeMore?: ReactNode;
  /** Primary first; the mockup shows two. */
  actions?: TabHeroAction[];
  /** A control that rides in the action row after the buttons (the Markets
   * symbol search, Iteration 1 M3); it wraps onto its own line when the
   * copy column is too narrow for it. */
  actionsAfter?: ReactNode;
  /** Footnote items, joined by an aria-hidden bullet. */
  footnote?: ReactNode[];
  /** Freshness chips rendered in the footnote row: §5 words from
   * fresh-state.ts (Iteration 1 step 6, A3), never a browser-judged age. */
  freshness?: FreshnessTag[];
  /** Extra line under the footnote (the impact sentence). */
  note?: ReactNode;
  /** The hero's source and as-of stamp (Iteration 1, A1): a `<Stamp>`
   * (./Stamp.tsx) on its own line under the footnote. */
  stamp?: ReactNode;
  /** The tab's signature chart (Lightweight Charts or inline SVG). */
  chart?: ReactNode;
  /** Gradient block in the chart slot when no chart is given. */
  placeholder?: boolean;
  /** Glow colour, e.g. "rgba(245,181,46,.05)". */
  glow?: string;
  minHeight?: number;
  id?: string;
  style?: CSSProperties;
}

/** G4: a hero lede shows at most three sentences. */
export const LEDE_SENTENCES = 3;

export const HERO_GLOW_DEFAULT = "rgba(38,220,160,.07)";
export const HERO_PLACEHOLDER_GRADIENT = "linear-gradient(135deg,#0f1a24,#0a131b)";

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  height: 44,
  padding: "0 24px",
  borderRadius: 9,
  borderWidth: 1,
  borderStyle: "solid",
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: 14.5,
  lineHeight: 1,
  whiteSpace: "nowrap",
  textDecoration: "none",
  cursor: "pointer",
  boxSizing: "border-box",
};
const PRIMARY: CSSProperties = { ...BUTTON, background: "#fff", color: "#0b1117", borderColor: "#fff" };
const GHOST: CSSProperties = { ...BUTTON, background: "none", color: "#fff", borderColor: "var(--line-white-30)" };

const SUBHEAD: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-hero-sub)",
  lineHeight: "var(--lh-hero-sub)",
  letterSpacing: "var(--ls-hero-sub)",
  color: "#fff",
  margin: "0 0 10px",
  textWrap: "pretty",
};

/** The flagged primary leads; without a flag the first action is primary. */
export function orderActions(actions?: TabHeroAction[]): TabHeroAction[] {
  if (!actions?.length) return [];
  const i = actions.findIndex((a) => a.primary);
  if (i <= 0) return actions;
  return [actions[i], ...actions.slice(0, i), ...actions.slice(i + 1)];
}

function Action({ action, primary }: { action: TabHeroAction; primary: boolean }) {
  const style = primary ? PRIMARY : GHOST;
  const className = primary ? "mrr-hero-btn mrr-hero-btn-primary" : "mrr-hero-btn mrr-hero-btn-ghost";
  const body = (
    <>
      {action.label}
      {primary ? ARROW : null}
    </>
  );
  if (action.to) {
    return (
      <Link className={className} to={action.to} aria-label={action.ariaLabel} onClick={action.onClick} style={style}>
        {body}
      </Link>
    );
  }
  if (action.href) {
    return (
      <a className={className} href={action.href} aria-label={action.ariaLabel} onClick={action.onClick} style={style}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={className} aria-label={action.ariaLabel} onClick={action.onClick} style={{ ...style, appearance: "none" }}>
      {body}
    </button>
  );
}

export function TabHero({
  eyebrow,
  live = false,
  headline,
  as = "h1",
  pill,
  pillTone = "mint",
  subhead,
  lede,
  ledeMore,
  actions,
  actionsAfter,
  footnote,
  freshness,
  note,
  stamp,
  chart,
  placeholder = false,
  glow = HERO_GLOW_DEFAULT,
  minHeight = 340,
  id,
  style,
}: TabHeroProps) {
  const uid = useId();
  const h1Id = `${uid}-h1`;
  const Heading = as;
  // G4 by construction (Iteration 1 step 5): a plain-string lede shows its
  // first three sentences; the rest, verbatim, leads the Details panel. A
  // composed (ReactNode) lede is capped by its screen and passes `ledeMore`.
  let ledeShown: ReactNode = lede;
  let ledeRest: ReactNode = ledeMore;
  if (typeof lede === "string") {
    const parts = takeSentences(lede, LEDE_SENTENCES);
    if (parts.rest) {
      ledeShown = parts.shown;
      ledeRest =
        ledeMore != null && ledeMore !== "" ? (
          <>
            {parts.rest} {ledeMore}
          </>
        ) : (
          parts.rest
        );
    }
  }
  const hasViz = chart != null || placeholder;
  const ordered = orderActions(actions);
  const items = footnote ?? [];
  const hasFoot = items.length > 0 || (freshness?.length ?? 0) > 0 || note != null;

  const sectionStyle = {
    position: "relative",
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: hasViz ? "var(--hero-cols, minmax(0,540px) minmax(0,1fr))" : "minmax(0,1fr)",
    gap: 24,
    padding: "var(--hero-pad, 26px 30px 22px)",
    minHeight,
    minWidth: 0,
    borderRadius: "var(--r-card)",
    border: "1px solid var(--line)",
    background: "var(--card-grad)",
    color: "var(--text)",
    "--glow": glow,
    ...style,
  } as CSSProperties;

  return (
    <section className="mrr-hero" id={id} aria-labelledby={h1Id} style={sectionStyle}>
      <span
        aria-hidden="true"
        className="mrr-hero-glow"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(520px 320px at 88% 40%, ${glow}, transparent 70%)`,
        }}
      />
      <div className="mrr-hero-copy" style={{ position: "relative", minWidth: 0 }}>
        <div
          className="mrr-hero-eyebrow"
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            fontSize: 11.5,
            letterSpacing: "var(--ls-eyebrow)",
            textTransform: "uppercase",
            color: "var(--text-eyebrow)",
            whiteSpace: "nowrap",
          }}
        >
          {live ? (
            <span
              aria-hidden="true"
              className="mrr-hero-dot"
              style={{
                flex: "none",
                width: 6,
                height: 6,
                borderRadius: "50%",
                marginRight: 8,
                background: "var(--mint)",
                boxShadow: "var(--glow-dot)",
                animation: "mrr-pulse var(--pulse-period) var(--ease-in-out) infinite",
              }}
            />
          ) : (
            <span aria-hidden="true" style={{ color: "var(--text-3)", marginRight: 8 }}>
              ◆
            </span>
          )}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{eyebrow}</span>
        </div>

        <div className="mrr-hero-h1row" style={{ display: "flex", alignItems: "center", gap: 18, margin: "14px 0 14px", flexWrap: "wrap" }}>
          <Heading
            id={h1Id}
            className="mrr-hero-h1"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "var(--fs-display)",
              lineHeight: "var(--lh-display)",
              letterSpacing: "var(--ls-display)",
              fontVariationSettings: '"opsz" var(--opsz-display)',
              color: "#fff",
              margin: 0,
              minWidth: 0,
              textWrap: "balance",
            }}
          >
            {headline}
          </Heading>
          {pill != null ? <Pill tone={pillTone}>{pill}</Pill> : null}
        </div>

        {subhead != null ? (
          as === "h1" ? (
            <h2 className="mrr-hero-sub" style={SUBHEAD}>
              {subhead}
            </h2>
          ) : (
            <p className="mrr-hero-sub" style={SUBHEAD}>
              {subhead}
            </p>
          )
        ) : null}

        {lede != null ? (
          <p
            className="mrr-hero-lede"
            data-copy="lede"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-lede)",
              lineHeight: "var(--lh-lede)",
              color: "var(--text-2)",
              maxWidth: "var(--maxw-lede)",
              margin: 0,
              textWrap: "pretty",
            }}
          >
            {ledeShown}
          </p>
        ) : null}
        {ledeRest != null && ledeRest !== "" ? (
          <Disclosure variant="quiet" title="Details" style={{ maxWidth: "var(--maxw-lede)", marginTop: 2 }}>
            <p
              className="mrr-hero-lede-more"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-caption)",
                lineHeight: 1.6,
                color: "var(--text-2)",
                margin: 0,
                textWrap: "pretty",
              }}
            >
              {ledeRest}
            </p>
          </Disclosure>
        ) : null}

        {ordered.length || actionsAfter != null ? (
          <div className="mrr-hero-actions" style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
            {ordered.map((a, i) => (
              <Action key={i} action={a} primary={i === 0} />
            ))}
            {actionsAfter}
          </div>
        ) : null}

        {hasFoot ? (
          // Inline flow (the mockup .foot): footnote items are bare text joined
          // by aria-hidden bullets, the chips sit inline after them, and the
          // note takes its own line.
          <div
            className="mrr-hero-foot"
            style={{
              marginTop: 16,
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              color: "var(--text-3)",
              lineHeight: 1.5,
              maxWidth: "var(--maxw-prose)",
            }}
          >
            {items.map((item, i) => (
              <Fragment key={i}>
                {i > 0 ? (
                  <span aria-hidden="true" className="mrr-hero-sep" style={{ whiteSpace: "pre" }}>
                    {" • "}
                  </span>
                ) : null}
                {item}
              </Fragment>
            ))}
            {freshness?.length ? (
              <span
                className="mrr-hero-chips"
                style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, verticalAlign: "middle", marginLeft: items.length ? 8 : 0 }}
              >
                {freshness.map((f) => (
                  <FreshnessChip key={f.noun} noun={f.noun} label={f.label} />
                ))}
              </span>
            ) : null}
            {note != null ? (
              <div className="mrr-hero-note" style={{ marginTop: 4 }}>
                {note}
              </div>
            ) : null}
          </div>
        ) : null}
        {stamp != null ? (
          <div className="mrr-hero-stamp" style={{ marginTop: hasFoot ? 6 : 16, maxWidth: "var(--maxw-prose)" }}>
            {stamp}
          </div>
        ) : null}
      </div>

      {hasViz ? (
        // The chart slot (Iteration 1, R1 / M1 / T1): a flex column that
        // centres its child on both axes and stretches with the hero's row.
        // A chart drawn through HeroChartFrame fills it; anything else is
        // centred instead of parked at the right edge.
        <div
          className="mrr-hero-viz"
          data-chart-slot=""
          style={{
            position: "relative",
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          {chart ?? (
            <div
              aria-hidden="true"
              className="mrr-hero-placeholder"
              style={{ flex: "1 1 auto", alignSelf: "stretch", minHeight: 200, borderRadius: "var(--r-tile)", background: HERO_PLACEHOLDER_GRADIENT }}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

export default TabHero;
