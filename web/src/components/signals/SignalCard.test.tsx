/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/signals/SignalCard.test.tsx`; contract in section B.3 (mockup
 * anatomy: name, status badge, 21 px value, 118x30 sparkline, meter label,
 * 5 px meter, mono lines; kept status derivation; `lastTriggered={null}`
 * omits the last-alert line; `heading` opt-in keeps the outline valid).
 *
 * "none on file" is the Dashboard's own lastTriggered copy
 * (DashboardScreen.tsx: `lastTriggered={... : "none on file"}`), passed here
 * as the consumer passes it; B.3 keeps the "Never" default.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SignalCard } from "./SignalCard";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const badgeOf = (word: string) => screen.getByText(word, { selector: "span" });

describe("SignalCard (checklist 02 B.3)", () => {
  it("derives Clear/Watch/Triggered from fillPct when status is absent", () => {
    const cases: [number, string][] = [
      [34, "Clear"],
      [49.9, "Clear"],
      [50, "Watch"],
      [68, "Watch"],
      [75, "Triggered"],
      [96, "Triggered"],
    ];
    for (const [pct, word] of cases) {
      const { unmount } = render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={pct} />);
      expect(badgeOf(word), String(pct)).toBeInTheDocument();
      unmount();
    }
  });

  it("server status wins over fill", () => {
    render(<SignalCard name="VIX spike" value="18.92" fillPct={96} status="Watch" />);
    expect(badgeOf("Watch")).toBeInTheDocument();
    expect(screen.queryByText("Triggered")).toBeNull();
    // The meter still reflects the fill, in the status colour.
    const fill = document.querySelector<HTMLElement>("[style*='scaleX']");
    expect(fill?.style.transform).toBe("scaleX(0.96)");
    expect(css(fill)).toMatch(/background(?:-color)?:\s*var\(--amber\)/);
  });

  it("renders the badge word matching the status", () => {
    const { container, unmount } = render(<SignalCard name="VIX spike" value="18.92" fillPct={96} status="Triggered" lastTriggered="Apr 2026" />);
    const badge = badgeOf("Triggered");
    // Uppercase by CSS only: the DOM keeps the state word as authored.
    expect(badge.textContent).toBe("Triggered");
    expect(badge.style.textTransform).toBe("uppercase");
    expect(badge.style.color).toBe("var(--neg)");
    expect(badge.style.height).toBe("24px");
    // The root is an article tile; the status no longer tints its border.
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("ARTICLE");
    expect(root.style.background).toBe("var(--tile)");
    expect(root.style.borderRadius).toBe("var(--r-tile)");
    expect(css(root)).not.toMatch(/var\(--neg\)/);
    expect(root.style.padding).toMatch(/^14px 16px(?: 14px)?$/); // jsdom collapses the three-value shorthand
    // Value in the UI face at 21 px; the sparkline is not rendered without data.
    const value = screen.getByText("18.92");
    expect(css(value)).toMatch(/var\(--font-ui\)/);
    expect(css(value)).toMatch(/font(?:-size)?:[^;]*\b21px\b/);
    expect(container.querySelector("svg")).toBeNull();
    // Default meter label, badge override and tone override.
    expect(screen.getByText("Threshold proximity")).toBeInTheDocument();
    unmount();
    render(<SignalCard name="High yield" value="2.91%" fillPct={7} badge="Normal" tone="clear" meterLabel="20-year percentile" />);
    const normal = badgeOf("Normal");
    expect(normal.style.color).toBe("var(--mint)");
    expect(screen.getByText("20-year percentile")).toBeInTheDocument();
    expect(screen.queryByText("Threshold proximity")).toBeNull();
    const unavailable = render(<SignalCard name="Curve" value="n/a" badge="Unavailable" tone="reference" showGauge={false} lastTriggered={null} />).container;
    expect(within(unavailable).getByText("Unavailable").style.color).toBe("var(--text-2)");
    expect(unavailable.querySelector("[style*='scaleX']")).toBeNull();
    expect(within(unavailable).queryByText("Threshold proximity")).toBeNull();
  });

  it('renders "Last alert: none on file" and omits the line when lastTriggered is null', () => {
    const { unmount } = render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={34} lastTriggered="none on file" />);
    const line = screen.getByText("Last alert: none on file");
    expect(line.tagName).toBe("P");
    expect(css(line)).toMatch(/var\(--font-mono\)/);
    expect(line.style.color).toBe("var(--text-3)");
    unmount();
    const def = render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={34} />).container;
    expect(def.textContent).toContain("Last alert: Never");
    const none = render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={34} lastTriggered={null} />).container;
    expect(none.textContent).not.toMatch(/Last alert/);
  });

  it("renders every lines entry in order after the last-alert line", () => {
    render(
      <SignalCard
        name="Inflation pressure"
        value="3.54% YoY"
        fillPct={68}
        status="Watch"
        lastTriggered="Mar 2026"
        lines={["Trips when core CPI prints above 3.50% YoY.", "Signal print Jul 2026 · next monthly print pending"]}
      />,
    );
    const last = screen.getByText("Last alert: Mar 2026");
    const block = last.parentElement as HTMLElement;
    expect([...block.children].map((c) => c.textContent)).toEqual([
      "Last alert: Mar 2026",
      "Trips when core CPI prints above 3.50% YoY.",
      "Signal print Jul 2026 · next monthly print pending",
    ]);
    for (const p of block.children) {
      expect(p.tagName).toBe("P");
      expect(css(p)).toMatch(/var\(--font-mono\)/);
    }
    expect(block.style.display).toBe("grid");
    // The caption slot renders under the lines.
    const captioned = render(<SignalCard name="Curve" value="0.41%" fillPct={34} caption="Monthly print; next due Oct 2026." />).container;
    const caption = within(captioned).getByText("Monthly print; next due Oct 2026.");
    expect(caption.style.color).toBe("var(--text-3)");
    expect(within(captioned).getByText("Last alert: Never").compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the sparkline only with two or more points", () => {
    const two = render(<SignalCard name="Curve" value="0.41%" fillPct={34} sparkline={[0.5, 0.4, 0.41]} />).container;
    const svg = two.querySelector("svg") as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "118");
    expect(svg).toHaveAttribute("height", "30");
    const paths = [...svg.querySelectorAll("path")];
    expect(paths).toHaveLength(1); // fill={false}
    expect(paths[0]).toHaveAttribute("stroke", "var(--mint)");
    expect(Number(paths[0].getAttribute("stroke-width"))).toBeCloseTo(1.4, 5);
    const one = render(<SignalCard name="Curve" value="0.41%" fillPct={34} sparkline={[0.41]} />).container;
    expect(one.querySelector("svg")).toBeNull();
    const none = render(<SignalCard name="Curve" value="0.41%" fillPct={34} />).container;
    expect(none.querySelector("svg")).toBeNull();
    const amber = render(<SignalCard name="Curve" value="0.41%" fillPct={68} sparkline={[1, 2]} />).container;
    expect(amber.querySelector("path")).toHaveAttribute("stroke", "var(--amber)");
  });

  it('heading="h4" renders an h4 and the default renders no heading', () => {
    const { unmount } = render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={34} heading="h4" />);
    const h4 = screen.getByRole("heading", { level: 4, name: "Curve inversion risk" });
    expect(h4.tagName).toBe("H4");
    expect(css(h4)).toMatch(/var\(--font-ui\)/);
    expect(h4.style.whiteSpace).toBe("nowrap");
    unmount();
    render(<SignalCard name="Curve inversion risk" value="0.41%" fillPct={34} />);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getByText("Curve inversion risk").tagName).toBe("SPAN");
    const asDiv = render(<SignalCard name="Curve" value="0.41%" fillPct={34} as="div" heading="h3" />).container;
    expect((asDiv.firstElementChild as HTMLElement).tagName).toBe("DIV");
    expect(within(asDiv).getByRole("heading", { level: 3 })).toHaveTextContent("Curve");
  });
});
