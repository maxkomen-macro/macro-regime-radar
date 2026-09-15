/**
 * Parity guarantee #4 (docs/redesign-v2/PARITY_MANIFEST.md): a news card with
 * a `url` renders an external link with target="_blank" rel="noreferrer", and
 * an item with Perplexity research renders its cited sources as links.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewsCard } from "../index";

const SOURCES = ["https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm", "https://www.bls.gov/news.release/cpi.nr0.htm"];

describe("news card links", () => {
  it("links the headline and the read-at-source line to the article in a new tab", () => {
    render(<NewsCard source="FINNHUB" time="09:30" headline="CPI cools to 2.9%" href="https://example.com/cpi" summary="Wire summary." />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) {
      expect(a).toHaveAttribute("href", "https://example.com/cpi");
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
    }
    expect(screen.getByText(/Read at FINNHUB/)).toBeInTheDocument();
  });

  it("renders every cited source as an external link once the regime read is opened", () => {
    render(
      <NewsCard
        source="NEWSAPI"
        time="08:00"
        headline="Fed holds rates"
        href="https://example.com/fed"
        interpretation="Holds the Goldilocks read; watch inflation pressure."
        sources={SOURCES}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Regime read · 2 sources/ }));
    for (const s of SOURCES) {
      const a = screen.getByRole("link", { name: s });
      expect(a).toHaveAttribute("href", s);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "").toContain("noreferrer");
    }
    expect(screen.getByText(/REGIME INTERPRETATION/)).toBeInTheDocument();
  });

  it("renders no external link when the item has no url", () => {
    render(<NewsCard source="RSS" time="07:00" headline="No link here" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
