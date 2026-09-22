/**
 * Iteration 1 step 5 (G4, docs/redesign-v2/ITERATION_1.md): the copy markers
 * the copy-iteration e2e sweep caps. `data-copy="lede" | "caption" |
 * "status"` sits only on copy a reader sees with every disclosure closed; a
 * plain-string hero lede shows three sentences by construction with the rest
 * behind Details; a stored narrative with <strong> emphasis is cut on the
 * sentences a reader sees.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { splitSentences } from "../../lib/sentences";
import Disclosure from "./Disclosure";
import { takeMarkedSentences } from "./narrative";
import { Caption } from "./screen-ui";
import { StatusStrip } from "./SummaryCard";
import TabHero from "./TabHero";
import { renderWithProviders } from "../../test/utils";

describe("Caption copy marker", () => {
  it("marks a caption by default, a status line on request, and nothing when told not to", () => {
    render(
      <>
        <Caption>One. Two.</Caption>
        <Caption copy="status">Live · 10:32 ET</Caption>
        <Caption copy={false}>Reference prose.</Caption>
        <Caption copyMax={3}>One. Two. Three.</Caption>
      </>,
    );
    expect(screen.getByText("One. Two.")).toHaveAttribute("data-copy", "caption");
    expect(screen.getByText("Live · 10:32 ET")).toHaveAttribute("data-copy", "status");
    expect(screen.getByText("Reference prose.")).not.toHaveAttribute("data-copy");
    const three = screen.getByText("One. Two. Three.");
    expect(three).toHaveAttribute("data-copy", "caption");
    expect(three).toHaveAttribute("data-copy-max", "3");
  });

  it("leaves the marker off inside an open Disclosure panel (the Details text is not capped)", () => {
    render(
      <Disclosure variant="quiet" title="Details">
        <Caption>Behind the fold. Second. Third.</Caption>
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByText("Behind the fold. Second. Third.")).not.toHaveAttribute("data-copy");
  });
});

describe("TabHero lede cap", () => {
  const LONG = "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";

  it("a plain-string lede shows its first three sentences, marked, and the rest behind Details", () => {
    renderWithProviders(<TabHero eyebrow="Test" headline="Headline" lede={LONG} />);
    const lede = document.querySelector(".mrr-hero-lede") as HTMLElement;
    expect(lede).toHaveAttribute("data-copy", "lede");
    expect(lede.textContent).toBe("First sentence. Second sentence. Third sentence.");
    expect(splitSentences(lede.textContent)).toHaveLength(3);
    const details = screen.getByRole("button", { name: /Details/ });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(document.querySelector(".mrr-hero-lede-more")?.textContent).toBe("Fourth sentence. Fifth sentence.");
  });

  it("a lede within the cap renders verbatim with no Details; `ledeMore` adds one", () => {
    const { unmount } = renderWithProviders(<TabHero eyebrow="Test" headline="Headline" lede="Only one." />);
    expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
    unmount();
    renderWithProviders(<TabHero eyebrow="Test" headline="Headline" lede="Only one." ledeMore="The rest." />);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(within(document.querySelector(".mrr-hero") as HTMLElement).getByText("The rest.")).toBeInTheDocument();
  });
});

describe("StatusStrip status markers", () => {
  it("the title and the detail are each one status line", () => {
    render(<StatusStrip tone="mint" title="Feed on time" detail="Newest headline Sep 16, 16:40 ET" />);
    const marked = [...document.querySelectorAll("[data-copy='status']")].map((el) => el.textContent);
    expect(marked).toEqual(["Feed on time", "Newest headline Sep 16, 16:40 ET"]);
  });
});

describe("takeMarkedSentences", () => {
  it("counts the sentences a reader sees and cuts the marked-up string at the same place", () => {
    const text = "The regime is <strong>Goldilocks.</strong> Credit is calm. The curve is positive. Watch the 10Y.";
    const { shown, rest } = takeMarkedSentences(text, 3);
    expect(shown).toBe("The regime is <strong>Goldilocks.</strong> Credit is calm. The curve is positive.");
    expect(rest).toBe("Watch the 10Y.");
  });

  it("closes an emphasis span the cut divides and reopens it in the rest", () => {
    const { shown, rest } = takeMarkedSentences("One. <strong>Two. Three.</strong>", 2);
    expect(shown).toBe("One. <strong>Two.</strong>");
    expect(rest).toBe("<strong>Three.</strong>");
  });

  it("returns the whole text when it is within the cap, and never splits a decimal", () => {
    expect(takeMarkedSentences("Odds at 11.6% today. Two.", 3)).toEqual({ shown: "Odds at 11.6% today. Two.", rest: "" });
  });
});
