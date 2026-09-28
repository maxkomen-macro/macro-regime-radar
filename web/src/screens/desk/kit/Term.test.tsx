import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSSARY, splitTerms } from "./glossary";
import { TermTip, defineTerms, termsIn } from "./Term";
import { Stat } from "./ui";

describe("hover definitions (desk/usability item 11, §14.11)", () => {
  it("defines every term the brief names", () => {
    for (const printed of ["σ", "OAS", "2s10s", "RSI", "skew", "implied volatility", "realized vol", "beta", "R²", "bp", "basis points", "notional"])
      expect(termsIn(`a ${printed} b`), printed).toHaveLength(1);
  });

  it("each definition is one plain sentence", () => {
    for (const [id, t] of Object.entries(GLOSSARY)) {
      expect(t.text.endsWith("."), id).toBe(true);
      // One sentence: no full stop before the last one ends a sentence ("0.25" and "BBB−" are not stops).
      expect(t.text.slice(0, -1).match(/[.!?](\s|$)/), id).toBeNull();
      expect(t.text.split(/\s+/).length, id).toBeLessThanOrEqual(32);
    }
  });

  it("matches whole words, the longest form first, each term once per text", () => {
    expect(termsIn("DIVIDEND")).toEqual([]);
    expect(termsIn("IV rank")).toEqual(["implied"]);
    expect(termsIn("HY spread")).toEqual(["oas"]);
    expect(termsIn("HY spreads +2σ, 20 days")).toEqual(["hy", "sigma"]);
    expect(termsIn("2s10s +2σ steepening")).toEqual(["curve", "sigma", "steep"]);
    expect(termsIn("S&P 5-day move over 2σ, then 3σ")).toEqual(["sigma"]);
    expect(splitTerms("RSI (14)")).toEqual([{ text: "RSI", term: "rsi" }, { text: " (14)" }]);
  });

  it("wraps a printed label whole, so it keeps one text node", () => {
    render(<Stat label="RSI (14)" value="55" />);
    const el = screen.getByText("RSI (14)");
    expect(el.tagName).toBe("ABBR");
    expect(el).toHaveClass("dk-term");
    expect(el.getAttribute("data-def")).toBe(GLOSSARY.rsi.text);
    expect(el.getAttribute("aria-describedby")).toBe("dk-def-rsi");
    // A label without a term is printed as it is.
    expect(defineTerms("Last close")).toBe("Last close");
  });

  it("shows the sentence on hover and on focus, and Escape hides it", () => {
    render(
      <>
        <Stat label="2s10s" value="+52 bp" />
        <TermTip />
      </>,
    );
    const term = screen.getByText("2s10s");
    // The hidden list the terms describe themselves by.
    expect(document.getElementById("dk-def-curve")?.textContent).toBe(GLOSSARY.curve.text);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.pointerOver(term);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.focusIn(term);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    act(() => {
      fireEvent.pointerOut(term, { relatedTarget: document.body });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
