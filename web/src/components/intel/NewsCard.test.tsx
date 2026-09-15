/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.1,
 * `components/intel/NewsCard.test.tsx`: the two NewsCard variants (B.3 lead
 * card, B.4 list row). The Phase 0 contract in news-links.test.tsx is never
 * edited; this file adds the Phase 8 anatomy: the clock cell, the category
 * badge and its tone, the ticker / deal-size chip with its title, the toggle
 * wording (Regime read · N sources / Regime read / Wire summary / the static
 * Headline only), the opened block's labels and source links (aria-label =
 * the URL, hostname as the visible text), the lead card's article root, the
 * "SIG x / 5" score span with its five dots and band colour, the h3 link
 * contract, the Score breakdown disclosure, the footer and the stored · stale
 * flag. Rendered bare: the component is pure.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NewsCard } from "../index";

/* ── fixtures ────────────────────────────────────────────────────────────── */

const SRC_FED = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm";
const SRC_BLS = "https://www.bls.gov/news.release/cpi.nr0.htm";
const SOURCES = [SRC_FED, SRC_BLS];
const HEADLINE = "Fed holds rates, signals one more cut";
const ARTICLE = "https://example.com/fed";
const INTERP = "Holds the Goldilocks read; watch inflation pressure.";
const RESEARCH = "Futures priced one cut by December after the statement.";
const SUMMARY = "The FOMC left the target range unchanged and flagged a cut.";
const TIME = "Sep 14, 2026 · 3h ago";
const DIMS: Array<[string, number | null]> = [
  ["Market impact", 4],
  ["Regime relevance", 3],
  ["Sector reach", null],
  ["Timeliness at ingest", 5],
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Text with `hidden` subtrees removed, whitespace collapsed; sr-only spans stay (CSS-hidden, not `hidden`). */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const e = n as Element;
    if (e.hasAttribute("hidden")) return "";
    return [...e.childNodes].map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
}
/** Every inline style attribute in a subtree (and the element's parent), joined. */
function styleTree(el: Element | null): string {
  if (!el) return "";
  return [el.parentElement, el, ...el.querySelectorAll("*")].map((e) => e?.getAttribute("style") ?? "").join(" ");
}
const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const score = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-score]");
const dots = (container: HTMLElement) => container.querySelectorAll("[data-score] i, [data-score] ~ * i, i");
const link = (name: string) => screen.getByRole("link", { name });
const noLink = (name: string) => screen.queryByRole("link", { name });
/** The deepest element whose visible text starts with `label` and carries a value after it. */
function readout(container: HTMLElement, label: string): HTMLElement {
  const all = [...container.querySelectorAll<HTMLElement>("*")].filter((e) => {
    const t = text(e);
    return t.startsWith(label) && t.length > label.length + 1;
  });
  const leaves = all.filter((e) => !all.some((o) => o !== e && e.contains(o)));
  if (leaves.length !== 1) throw new Error(`expected one readout for ${label}, found ${leaves.length}: ${leaves.map(text).join(" | ")}`);
  return leaves[0];
}
const hasReadout = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLElement>("*")].some((e) => {
    const t = text(e);
    return t.startsWith(label) && t.length > label.length + 1;
  });

/* ── row variant (B.4) ───────────────────────────────────────────────────── */

describe("NewsCard row variant (checklist 08 B.4)", () => {
  it("renders the clock cell, the category badge with its tone and the ticker chip with its title", () => {
    render(<NewsCard clock="15:41 ET" category="MACRO" categoryTone="info" chip="NVDA" chipTitle="Ticker" source="CNBC" time={TIME} headline={HEADLINE} href={ARTICLE} />);
    expect(screen.getByText("15:41 ET")).toBeInTheDocument();
    const badge = screen.getByText("MACRO");
    expect(badge).toHaveAttribute("data-tone", "info");
    const chip = screen.getByText("NVDA");
    expect(chip).toHaveAttribute("title", "Ticker");
    expect(chip).toHaveAttribute("data-tone", "reference");
  });

  it("the badge tone follows the caller: watch for GEO, reference for M&A; no badge without a category", () => {
    const geo = render(<NewsCard category="GEO" categoryTone="watch" headline={HEADLINE} />);
    expect(within(geo.container).getByText("GEO")).toHaveAttribute("data-tone", "watch");
    geo.unmount();
    const ma = render(<NewsCard category="M&A" categoryTone="reference" headline={HEADLINE} />);
    expect(within(ma.container).getByText("M&A")).toHaveAttribute("data-tone", "reference");
    ma.unmount();
    const none = render(<NewsCard headline={HEADLINE} />);
    expect(none.container.querySelector("[data-tone]")).toBeNull();
  });

  it("the deal-size bucket rides in the chip slot with the M&A title", () => {
    render(<NewsCard category="M&A" categoryTone="reference" chip="$10–50B" chipTitle="M&A deal size" headline="Oracle to buy Snowflake for $48B" href="https://example.com/orcl" />);
    const chip = screen.getByText("$10–50B");
    expect(chip).toHaveAttribute("title", "M&A deal size");
  });

  it("the toggle reads Regime read · 2 sources with sources, closed", () => {
    render(<NewsCard source="NEWSAPI" time={TIME} headline={HEADLINE} href={ARTICLE} interpretation={INTERP} sources={SOURCES} />);
    const button = screen.getByRole("button", { name: /Regime read · 2 sources/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Wire summary/ })).toBeNull();
  });

  it("the toggle reads Regime read alone with a body and no sources", () => {
    render(<NewsCard source="NEWSAPI" time={TIME} headline={HEADLINE} href={ARTICLE} interpretation={INTERP} />);
    const button = screen.getByRole("button", { name: /Regime read/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(text(button)).not.toMatch(/sources/);
  });

  it("the toggle reads Wire summary with a summary only, and is a real button with aria-expanded", () => {
    render(<NewsCard source="RSS" time={TIME} headline={HEADLINE} href={ARTICLE} summary={SUMMARY} />);
    const button = screen.getByRole("button", { name: /Wire summary/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Regime read/ })).toBeNull();
  });

  it("a row with nothing behind the headline prints the static Headline only note and no button", () => {
    const { container } = render(<NewsCard source="RSS" time="07:00" headline="No link here" />);
    expect(screen.getByText("Headline only")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(text(container)).not.toMatch(/Regime read|Wire summary/);
  });

  it("opening an enriched row shows the AI label, the paragraph, the CLAUDE attribution and the PERPLEXITY SOURCES links named by their URLs", () => {
    const { container } = render(<NewsCard source="NEWSAPI" time={TIME} headline={HEADLINE} href={ARTICLE} interpretation={INTERP} sources={SOURCES} />);
    expect(text(container)).not.toContain("◆ Why it matters · AI");
    expect(text(container)).not.toContain(INTERP);
    for (const s of SOURCES) expect(noLink(s)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Regime read · 2 sources/ }));
    expect(screen.getByRole("button", { name: /Regime read · 2 sources/ })).toHaveAttribute("aria-expanded", "true");
    expect(text(container)).toContain("◆ Why it matters · AI");
    expect(text(container)).toContain(INTERP);
    expect(text(container)).toContain("◆ CLAUDE · REGIME INTERPRETATION");
    expect(text(container)).toContain("◆ PERPLEXITY SOURCES");
    expect(text(container)).not.toContain("◆ PERPLEXITY RESEARCH");
    SOURCES.forEach((s, i) => {
      const a = link(s);
      expect(a).toHaveAttribute("href", s);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
      expect(a).toHaveAttribute("aria-label", s);
      expect(a.textContent ?? "").toContain(new URL(s).hostname);
      expect(text(container)).toContain(`[${i + 1}]`);
    });
  });

  it("a research-only row opens to the AI label over the research body with the PERPLEXITY RESEARCH attribution", () => {
    const { container } = render(<NewsCard source="NEWSAPI" time={TIME} headline={HEADLINE} href={ARTICLE} research={RESEARCH} sources={[SRC_FED]} />);
    fireEvent.click(screen.getByRole("button", { name: /Regime read · 1 sources/ }));
    expect(text(container)).toContain("◆ Why it matters · AI");
    expect(text(container)).toContain(RESEARCH);
    expect(text(container)).toContain("◆ PERPLEXITY RESEARCH");
    expect(text(container)).not.toContain("CLAUDE · REGIME INTERPRETATION");
    expect(link(SRC_FED)).toHaveAttribute("href", SRC_FED);
  });

  it("opening a summary-only row shows the summary", () => {
    const { container } = render(<NewsCard source="RSS" time={TIME} headline={HEADLINE} href={ARTICLE} summary={SUMMARY} />);
    expect(text(container)).not.toContain(SUMMARY);
    const button = screen.getByRole("button", { name: /Wire summary/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(text(container)).toContain(SUMMARY);
    expect(text(container)).not.toContain("Why it matters");
  });

  it("the row score span reads SIG x / 5 with its filled count and five dots", () => {
    const { container } = render(<NewsCard source="CNBC" time={TIME} headline={HEADLINE} href={ARTICLE} significance={3.8} sigScale={5} />);
    const span = score(container);
    expect(span).not.toBeNull();
    expect(text(span)).toMatch(/^sig 3\.8 \/ 5$/i);
    expect((span as HTMLElement).getAttribute("style") ?? "").toMatch(/text-transform:\s*uppercase/);
    expect(container.querySelector("[data-score] [data-filled], [data-filled]")).toHaveAttribute("data-filled", "4");
    expect(dots(container)).toHaveLength(5);
  });

  it("the meta line carries the source span, the time and the Read at link; stored · stale only on the fallback", () => {
    const { container } = render(<NewsCard source="CNBC" time={TIME} headline={HEADLINE} href={ARTICLE} stale />);
    expect(text(container)).toContain(`CNBC · ${TIME} · stored · stale`);
    expect(link("Read at CNBC →")).toHaveAttribute("href", ARTICLE);
    const fresh = render(<NewsCard source="CNBC" time={TIME} headline={HEADLINE} href={ARTICLE} />);
    expect(text(fresh.container)).toContain(`CNBC · ${TIME}`);
    expect(text(fresh.container)).not.toContain("stored · stale");
  });
});

/* ── lead variant (B.3) ──────────────────────────────────────────────────── */

describe("NewsCard lead variant (checklist 08 B.3)", () => {
  const lead = (over: Record<string, unknown> = {}) =>
    render(<NewsCard variant="lead" category="MACRO" categoryTone="info" source="CNBC" time={TIME} headline={HEADLINE} href={ARTICLE} significance={4.4} sigScale={5} {...over} />);

  it("renders an article root that flags stale coverage", () => {
    const { container } = lead();
    expect(root(container).tagName).toBe("ARTICLE");
    expect(root(container).hasAttribute("data-stale")).toBe(false);
    const stale = lead({ stale: true });
    expect(root(stale.container).tagName).toBe("ARTICLE");
    expect(root(stale.container).hasAttribute("data-stale")).toBe(true);
  });

  it("the score span reads SIG 4.4 / 5 with data-filled 4 and five dots, the category badge and the chip beside it", () => {
    const { container } = lead({ chip: "NVDA", chipTitle: "Ticker" });
    const span = score(container);
    expect(span).not.toBeNull();
    expect(text(span)).toMatch(/^sig 4\.4 \/ 5$/i);
    expect(span?.querySelector(".sr-only")?.textContent).toMatch(/^Sig\s?$/);
    expect(container.querySelector("[data-score] [data-filled], [data-filled]")).toHaveAttribute("data-filled", "4");
    expect(dots(container)).toHaveLength(5);
    expect(within(container).getByText("MACRO")).toHaveAttribute("data-tone", "info");
    expect(within(container).getByText("NVDA")).toHaveAttribute("title", "Ticker");
  });

  it("colours the score number by band: 4.6 red, 3.6 hot, 2.6 amber, 1.6 muted", () => {
    const cases: [number, RegExp][] = [
      [4.6, /var\(--neg\)/],
      [3.6, /var\(--warn-hot\)/],
      [2.6, /var\(--amber\)/],
    ];
    for (const [sig, token] of cases) {
      const { container, unmount } = lead({ significance: sig });
      expect(styleTree(score(container)), `significance ${sig}`).toMatch(token);
      unmount();
    }
    const { container } = lead({ significance: 1.6 });
    const muted = styleTree(score(container));
    expect(muted).toMatch(/var\(--text-3\)/);
    expect(muted).not.toMatch(/var\(--neg\)|var\(--warn-hot\)|var\(--amber\)/);
  });

  it("the headline is an h3 link to the article in a new tab; plain text without an href", () => {
    const { container } = lead();
    const a = container.querySelector("h3 a") as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a).toHaveAttribute("href", ARTICLE);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
    expect(text(a)).toBe(HEADLINE);
    const plain = lead({ href: undefined });
    expect(plain.container.querySelector("h3")).not.toBeNull();
    expect(plain.container.querySelector("h3 a")).toBeNull();
    expect(text(plain.container.querySelector("h3"))).toBe(HEADLINE);
    expect(within(plain.container).queryAllByRole("link")).toHaveLength(0);
  });

  it("labels a stored interpretation Why it matters · AI, a research body the same, a wire summary Wire summary, and prints no row when nothing is passed", () => {
    const ai = lead({ interpretation: INTERP });
    expect(text(ai.container)).toContain("◆ Why it matters · AI");
    expect(text(ai.container)).toContain(INTERP);
    expect(text(ai.container)).not.toContain("Wire summary");
    ai.unmount();
    const research = lead({ research: RESEARCH });
    expect(text(research.container)).toContain("◆ Why it matters · AI");
    expect(text(research.container)).toContain(RESEARCH);
    research.unmount();
    const wire = lead({ summary: SUMMARY });
    expect(text(wire.container)).toContain("Wire summary");
    expect(text(wire.container)).toContain(SUMMARY);
    expect(text(wire.container)).not.toContain("Why it matters");
    wire.unmount();
    const none = lead();
    expect(text(none.container)).not.toMatch(/Why it matters|Wire summary/);
  });

  it("Score breakdown is closed by default and opens to four readouts, amber at 4 and above, a dash for null", () => {
    const { container } = lead({ dims: DIMS });
    const button = within(container).getByRole("button", { name: /Score breakdown/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    for (const [label] of DIMS) expect(hasReadout(container, label), `${label} hidden while closed`).toBe(false);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const market = readout(container, "Market impact");
    expect(text(market)).toBe("Market impact 4 / 5");
    expect(styleTree(market)).toMatch(/var\(--amber\)/);
    const regime = readout(container, "Regime relevance");
    expect(text(regime)).toBe("Regime relevance 3 / 5");
    expect(styleTree(regime)).not.toMatch(/var\(--amber\)/);
    const sector = readout(container, "Sector reach");
    expect(text(sector)).not.toMatch(/\/ 5/);
    expect(text(sector)).not.toMatch(/\d/);
    expect(text(sector).length).toBeGreaterThan("Sector reach".length);
    const timeliness = readout(container, "Timeliness at ingest");
    expect(text(timeliness)).toBe("Timeliness at ingest 5 / 5");
    expect(styleTree(timeliness)).toMatch(/var\(--amber\)/);
    expect([...container.querySelectorAll("*")].filter((e) => /\/ 5$/.test(text(e)) && !text(e).startsWith("Sig") && !/^sig/i.test(text(e))).length).toBeGreaterThanOrEqual(3);
  });

  it("Regime read · N sources opens the cited sources as hostname links named by their URLs under the PERPLEXITY line", () => {
    const { container } = lead({ interpretation: INTERP, sources: SOURCES });
    const button = within(container).getByRole("button", { name: /Regime read · 2 sources/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    for (const s of SOURCES) expect(noLink(s)).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(text(container)).toContain("◆ PERPLEXITY SOURCES");
    for (const s of SOURCES) {
      const a = link(s);
      expect(a).toHaveAttribute("href", s);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
      expect(a.textContent ?? "").toContain(new URL(s).hostname);
    }
  });

  it("the footer links Read at {source} → to the article, or prints No source link stored", () => {
    const { container } = lead();
    expect(link("Read at CNBC →")).toHaveAttribute("href", ARTICLE);
    expect(link("Read at CNBC →").getAttribute("rel") ?? "").toContain("noreferrer");
    expect(text(container)).not.toContain("No source link stored");
    const none = lead({ href: undefined });
    expect(text(none.container)).toContain("No source link stored");
    expect(within(none.container).queryByRole("link", { name: /Read at/ })).toBeNull();
  });

  it("the footer carries the source in its own uppercase span, the time, and stored · stale only when stale", () => {
    const { container } = lead({ stale: true });
    const sourceSpan = [...container.querySelectorAll("span")].find((s) => text(s) === "CNBC" && /text-transform:\s*uppercase/.test(s.getAttribute("style") ?? ""));
    expect(sourceSpan, "uppercase source span").toBeDefined();
    expect(text(container)).toContain(`CNBC · ${TIME} · stored · stale`);
    const staleFlag = [...container.querySelectorAll("*")].find((e) => text(e) === "stored · stale");
    expect(staleFlag).toBeDefined();
    expect(styleTree(staleFlag as Element)).toMatch(/var\(--warn-hot\)/);
    const fresh = lead();
    expect(text(fresh.container)).toContain(`CNBC · ${TIME}`);
    expect(text(fresh.container)).not.toContain("stored · stale");
  });

  it("expandable={false} prints the regime read open with no toggle", () => {
    const { container } = lead({ interpretation: INTERP, sources: SOURCES, expandable: false });
    expect(within(container).queryByRole("button", { name: /Regime read/ })).toBeNull();
    expect(text(container)).toContain("◆ PERPLEXITY SOURCES");
    for (const s of SOURCES) expect(link(s)).toHaveAttribute("href", s);
    expect(text(container)).toContain("◆ Why it matters · AI");
    expect(text(container)).toContain(INTERP);
  });
});
