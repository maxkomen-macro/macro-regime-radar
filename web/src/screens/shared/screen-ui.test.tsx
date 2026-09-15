/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/shared/screen-ui.test.tsx`; contracts in section B.12 (SliderRow:
 * kept native range with aria-valuetext and the label, new `baseline` tick,
 * amber `data-changed` state, scale row, typed NumberField, disabled) and
 * B.16 (Caption in the UI face, `mono` note style, the new `metaStyle` and
 * `monoNoteStyle` exports, StateNote copy unchanged).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Caption, SliderRow, StateNote, capStyle, metaStyle, monoNoteStyle } from "./screen-ui";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";

type SliderProps = Partial<Parameters<typeof SliderRow>[0]>;

/** Stateful harness so the changed / unchanged states follow the value. */
function Slider({ initial = 4.8, onChange, ...rest }: SliderProps & { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <SliderRow
      label="Unemployment rate"
      valueText={`${value.toFixed(1)}%`}
      value={value}
      min={3}
      max={7}
      step={0.1}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

describe("SliderRow (checklist 02 B.12)", () => {
  it("renders a range input with aria-valuetext and the label", () => {
    const onChange = vi.fn();
    const { container } = render(<Slider onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Unemployment rate" });
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("aria-valuetext", "4.8%");
    expect(slider).toHaveAttribute("min", "3");
    expect(slider).toHaveAttribute("max", "7");
    expect(slider).toHaveAttribute("step", "0.1");
    expect(slider).toHaveClass("mrr-slider");
    expect(screen.getByLabelText("Unemployment rate")).toBe(slider);
    const label = container.querySelector("label") as HTMLLabelElement;
    expect(label.htmlFor).toBe(slider.id);
    const row = container.querySelector(".mrr-slider-row") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.contains(slider)).toBe(true);
    expect(row.contains(screen.getByText("4.8%"))).toBe(true);
    fireEvent.change(slider, { target: { value: "5.2" } });
    expect(onChange).toHaveBeenCalledWith(5.2);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "5.2%");
    // No baseline, no scale: no tick and no scale row (the 18 current call sites).
    expect(container.querySelector(".mrr-slider-tick")).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
    expect(screen.queryByText("7")).toBeNull();
  });

  it("baseline renders the tick at its percent", () => {
    const { container } = render(<Slider initial={4.3} baseline={4.3} />);
    const tick = container.querySelector(".mrr-slider-tick") as HTMLElement;
    expect(tick).not.toBeNull();
    expect(tick.style.left).toMatch(/%$/);
    expect(parseFloat(tick.style.left)).toBeCloseTo(32.5, 6); // (4.3 - 3) / (7 - 3), float-safe
    expect(tick).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".mrr-slider-fill")?.getAttribute("aria-hidden")).toBe("true");
    const row = container.querySelector(".mrr-slider-row") as HTMLElement;
    expect(row.getAttribute("data-changed")).not.toBe("true");
    expect(screen.getByText("4.3%").style.color).toBe("var(--text)");
    expect(css(container.querySelector(".mrr-slider-fill"))).toMatch(/background(?:-color)?:\s*var\(--link\)/);
    expect(screen.queryByText(/current reading/)).toBeNull();
  });

  it("changed value sets data-changed and the amber colour", () => {
    const { container } = render(<Slider initial={4.8} baseline={4.3} />);
    const row = container.querySelector(".mrr-slider-row") as HTMLElement;
    expect(row).toHaveAttribute("data-changed", "true");
    expect(screen.getByText("4.8%").style.color).toBe("var(--amber)");
    expect(css(container.querySelector(".mrr-slider-fill"))).toMatch(/background(?:-color)?:\s*var\(--amber\)/);
    expect(screen.getByText(/│ current reading/)).toBeInTheDocument();
    // Moving back to the baseline clears the state.
    fireEvent.change(screen.getByRole("slider"), { target: { value: "4.3" } });
    expect(row.getAttribute("data-changed")).not.toBe("true");
    expect(screen.getByText("4.3%").style.color).toBe("var(--text)");
    expect(screen.queryByText(/current reading/)).toBeNull();
    // The explicit override flags a row without a single-number baseline.
    const forced = render(<Slider initial={4.8} changed />).container;
    expect(forced.querySelector(".mrr-slider-row")).toHaveAttribute("data-changed", "true");
    expect(within(forced).getByText("4.8%").style.color).toBe("var(--amber)");
  });

  it("scale row renders min and max labels only when enabled", () => {
    const plain = render(<Slider />).container;
    expect(within(plain).queryByText("3.0%")).toBeNull();
    expect(within(plain).queryByText("7.0%")).toBeNull();

    const formatted = render(<Slider initial={4.8} baseline={4.3} format={(v) => `${v.toFixed(1)}%`} />).container;
    const left = within(formatted).getByText("3.0%");
    const right = within(formatted).getByText("7.0%");
    const scale = left.parentElement as HTMLElement;
    expect(scale.contains(right)).toBe(true);
    expect(scale.style.display).toBe("flex");
    expect(scale.style.justifyContent).toBe("space-between");
    expect(css(scale)).toMatch(/var\(--font-mono\)/);
    expect(within(scale).getByText(/│ current reading/)).toBeInTheDocument();

    const labelled = render(<Slider scale={{ left: "Tight", right: "Loose" }} />).container;
    expect(within(labelled).getByText("Tight")).toBeInTheDocument();
    expect(within(labelled).getByText("Loose")).toBeInTheDocument();

    const suppressed = render(<Slider initial={4.8} baseline={4.3} showScale={false} />).container;
    expect(within(suppressed).queryByText("3")).toBeNull();
    expect(within(suppressed).queryByText(/current reading/)).toBeNull();
    expect(suppressed.querySelector(".mrr-slider-tick")).not.toBeNull();
  });

  it("input renders the NumberField and commits on Enter", () => {
    const onChange = vi.fn();
    render(<SliderRow label="Entry EBITDA" valueText="$120M" value={120} min={10} max={500} step={10} onChange={onChange} input={{ unit: "$M", dp: 0 }} note="Live default from the stored deal." />);
    const field = screen.getByRole("spinbutton", { name: "Entry EBITDA (typed)" });
    expect(field).toHaveClass("mrr-number");
    expect(field).toHaveValue(120);
    expect(screen.getByText("$M")).toBeInTheDocument();
    expect(screen.queryByText("$120M")).toBeNull(); // the field replaces the value span
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "180" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(180);
    // Out of range clamps to the bounds on commit.
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "900" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(500);
    expect(screen.getByText("Live default from the stored deal.")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Entry EBITDA" })).toHaveAttribute("aria-valuetext", "$120M");
  });

  it("disabled propagates", () => {
    render(<SliderRow label="Exit multiple" valueText="10.0×" value={10} min={6} max={14} step={0.5} onChange={() => {}} input={{ unit: "×", dp: 1 }} disabled />);
    expect(screen.getByRole("slider", { name: "Exit multiple" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Exit multiple (typed)" })).toBeDisabled();
    const enabled = render(<Slider />).container;
    expect(within(enabled).getByRole("slider")).toBeEnabled();
  });
});

describe("Caption (checklist 02 B.16)", () => {
  it("Caption renders prose in the UI face", () => {
    const { container, unmount } = render(<Caption>Rolling 10-year percentile of the stored series.</Caption>);
    const cap = container.firstElementChild as HTMLElement;
    expect(cap.tagName).toBe("DIV");
    expect(css(cap)).toMatch(/var\(--font-ui\)/);
    expect(css(cap)).toMatch(/var\(--fs-caption\)/);
    expect(cap.style.color).toBe("var(--text-3)");
    expect(cap.style.maxWidth).toBe("var(--maxw-prose)");
    expect(capStyle.fontFamily).toBe("var(--font-ui)");
    expect(capStyle.color).toBe("var(--text-3)");
    unmount();
    const p = render(<Caption as="p">Paragraph caption.</Caption>).container.firstElementChild as HTMLElement;
    expect(p.tagName).toBe("P");
    const styled = render(<Caption style={{ marginTop: 0 }}>x</Caption>).container.firstElementChild as HTMLElement;
    expect(styled.style.marginTop).toMatch(/^0(?:px)?$/);
  });

  it("mono switches to the mono note style", () => {
    const { container } = render(<Caption mono>Signal print Sep 2026 · stored monthly</Caption>);
    const note = container.firstElementChild as HTMLElement;
    expect(css(note)).toMatch(/var\(--font-mono\)/);
    expect(css(note)).not.toMatch(/var\(--font-ui\)/);
    expect(note.style.color).toBe("var(--text-3)");
    expect(css(note)).toMatch(/font(?:-size)?:[^;]*\b12px\b/);
    expect(monoNoteStyle.fontFamily).toBe("var(--font-mono)");
    expect(monoNoteStyle.color).toBe("var(--text-3)");
    expect(metaStyle.fontFamily).toBe("var(--font-mono)");
    expect(metaStyle.textTransform).toBe("uppercase");
    expect(metaStyle.color).toBe("var(--text-3)");
    expect(metaStyle.letterSpacing).toMatch(/^(?:\.1em|0\.1em|var\(--ls-badge-mono\))$/);
  });

  it("StateNote copy for loading, empty and error is unchanged", () => {
    const loading = render(<StateNote loading />).container;
    expect(loading.textContent).toBe("Reading stored data…");
    const empty = render(<StateNote />).container;
    expect(empty.textContent).toBe("Nothing on file.");
    const error = render(<StateNote error />).container;
    expect(error.textContent).toBe("Unavailable: the data service did not answer.");
    const custom = render(<StateNote loading>Building ~24 years of monthly return history…</StateNote>).container;
    expect(custom.textContent).toBe("Building ~24 years of monthly return history…");
    const span = loading.firstElementChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
    expect(css(span)).toMatch(/var\(--fs-caption\)/);
    expect(span.style.color).toBe("var(--text-3)");
  });
});
