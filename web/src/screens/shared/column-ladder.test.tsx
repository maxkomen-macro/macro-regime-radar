/**
 * The shared column ladder (Iteration 2 F2, shared in fix/prelaunch-1 J5).
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { HiddenColumnsNote, fitColumns, hiddenColumnsNote, useMeasuredWidth } from "./column-ladder";

const COLS = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
const MIN = { a: 100, b: 100, c: 100, d: 100 };

describe("fitColumns", () => {
  it("keeps every column until the width is measured, and when they fit", () => {
    expect(fitColumns(COLS, 0, MIN, ["c", "b"]).cols).toEqual(COLS);
    expect(fitColumns(COLS, 400, MIN, ["c", "b"])).toEqual({ cols: COLS, dropped: [] });
  });

  it("drops in the stated order, only as far as it must", () => {
    expect(fitColumns(COLS, 399, MIN, ["c", "b"])).toEqual({ cols: [{ key: "a" }, { key: "b" }, { key: "d" }], dropped: [{ key: "c" }] });
    expect(fitColumns(COLS, 250, MIN, ["c", "b"]).dropped).toEqual([{ key: "c" }, { key: "b" }]);
  });

  it("never drops a column outside the order, even when the rest cannot fit", () => {
    expect(fitColumns(COLS, 50, MIN, ["c", "b"]).cols).toEqual([{ key: "a" }, { key: "d" }]);
  });
});

describe("hiddenColumnsNote", () => {
  it("names one, two or more columns and how to get them back", () => {
    expect(hiddenColumnsNote([])).toBeNull();
    expect(hiddenColumnsNote(["30 Sess"])).toBe("30 Sess is hidden at this width · widen the window to read it");
    expect(hiddenColumnsNote(["Implied EV", "Debt start"])).toBe("Implied EV and Debt start are hidden at this width · widen the window to read them");
    expect(hiddenColumnsNote(["A", "B", "A", "C"])).toBe("A, B and C are hidden at this width · widen the window to read them");
  });

  it("renders nothing when nothing is hidden", () => {
    const { container } = render(<HiddenColumnsNote labels={[]} testId="note" />);
    expect(container.innerHTML).toBe("");
    render(<HiddenColumnsNote labels={["X"]} testId="note" />);
    expect(screen.getByTestId("note").textContent).toBe("X is hidden at this width · widen the window to read it");
  });
});

describe("useMeasuredWidth", () => {
  it("measures an element that appears after mount (the schedule waits for its model run)", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 590 });
    let show: (v: boolean) => void = () => {};
    function Probe() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      const [ref, w] = useMeasuredWidth<HTMLDivElement>();
      return (
        <>
          <output data-testid="w">{w}</output>
          {visible ? <div ref={ref} /> : null}
        </>
      );
    }
    try {
      render(<Probe />);
      expect(screen.getByTestId("w").textContent).toBe("0");
      act(() => show(true));
      expect(screen.getByTestId("w").textContent).toBe("590");
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });
});
