/** desk/usability §14.10: a pending card says "Loading live data…"; an answered one says nothing more. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingLine } from "./ui";

describe("LoadingLine", () => {
  it("says Loading live data… while busy, as a polite status", () => {
    render(<LoadingLine busy />);
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Loading live data…");
    expect(line).toHaveAttribute("aria-live", "polite");
  });

  it("draws nothing once the answer is in", () => {
    const { container } = render(<LoadingLine busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
