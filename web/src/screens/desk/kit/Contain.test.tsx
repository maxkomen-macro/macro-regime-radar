/** A render error kept to one part of the Desk (Codex G1-8): the part prints its fallback, the rest renders. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Contain from "./Contain";

function Boom(): never {
  throw new Error("bad value");
}

describe("Contain", () => {
  it("a part that throws prints its fallback, and its neighbours still render", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <Contain label="The TODAY card" fallback={<p>Awaiting refresh</p>}>
          <Boom />
        </Contain>
        <p>House discipline</p>
      </div>,
    );
    expect(screen.getByText("Awaiting refresh")).toBeInTheDocument();
    expect(screen.getByText("House discipline")).toBeInTheDocument();
    err.mockRestore();
  });
});
