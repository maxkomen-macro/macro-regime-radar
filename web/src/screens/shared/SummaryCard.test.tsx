/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/shared/SummaryCard.test.tsx`; contract in section B.2 (the summary
 * card: `section.mrr-summary[aria-labelledby]` with an eyebrow heading, a
 * real `dl > div.mrr-kv-row > dt + dd` ledger, and the `StatusStrip` as a
 * router Link / `<a>` / `<button>`, never a div with onClick).
 *
 * Rendered through renderWithProviders: the `to` strip is a router Link.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import SummaryCard, { StatusStrip } from "./SummaryCard";
import Jargon from "./Jargon";
import { renderWithProviders } from "../../test/utils";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const ROWS = [
  { label: "Model regime", value: "Goldilocks" },
  { label: "Model probability", value: "64%" },
  { label: "Model confidence", value: "Medium (50%)" },
  { label: "Next 3 months", value: "Goldilocks holds at 88%" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SummaryCard (checklist 02 B.2)", () => {
  it("renders rows as dl/dt/dd in order", () => {
    renderWithProviders(<SummaryCard title="Model & market summary" rows={ROWS} id="summary" />);
    const heading = screen.getByRole("heading", { level: 3, name: "Model & market summary" });
    const card = document.querySelector("section.mrr-summary") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute("id", "summary");
    expect(card).toHaveAttribute("aria-labelledby", heading.id);
    expect(heading.style.textTransform).toBe("uppercase");
    expect(heading.style.color).toBe("var(--text-eyebrow)");
    const dl = card.querySelector("dl") as HTMLElement;
    expect(dl).not.toBeNull();
    expect(dl).toHaveClass("mrr-kv");
    const dts = [...dl.querySelectorAll("dt")].map((d) => d.textContent);
    const dds = [...dl.querySelectorAll("dd")].map((d) => d.textContent);
    expect(dts).toEqual(ROWS.map((r) => r.label));
    expect(dds).toEqual(ROWS.map((r) => r.value));
    // Each row pairs one dt with one dd, sentence case (no uppercase transform on dt).
    const rows = [...dl.querySelectorAll(".mrr-kv-row")];
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.querySelector("dt")).not.toBeNull();
      expect(r.querySelector("dd")).not.toBeNull();
      expect((r as HTMLElement).style.gridTemplateColumns).toMatch(/^150px minmax\(0, ?1fr\)$/);
    }
    const dt = dl.querySelector("dt") as HTMLElement;
    expect(dt.style.textTransform).not.toBe("uppercase");
    expect(dt.style.color).toBe("var(--text-2)");
    const dd = dl.querySelector("dd") as HTMLElement;
    expect(css(dd)).toMatch(/var\(--font-ui\)/);
    expect(dd.style.fontVariantNumeric).toBe("tabular-nums");
    // as="h2" changes the heading level.
    const h2 = renderWithProviders(<SummaryCard as="h2" title="Credit summary" rows={ROWS.slice(0, 1)} />).container;
    expect(within(h2).getByRole("heading", { level: 2 })).toHaveTextContent("Credit summary");
  });

  it("status renders a link when to is given and a button when onClick is given", () => {
    const onClick = vi.fn();
    const { unmount } = renderWithProviders(
      <SummaryCard title="Credit summary" rows={ROWS} status={{ tone: "amber", title: "Watch · CCC widening", detail: "+41 bp in a month while BB and B held flat", to: "/app/credit#quality-ladder" }} />,
    );
    const link = screen.getByRole("link", { name: /Watch · CCC widening/ });
    expect(link).toHaveAttribute("href", "/app/credit#quality-ladder");
    expect(link).toHaveClass("mrr-status");
    expect(link).toHaveTextContent("+41 bp in a month while BB and B held flat");
    expect(link.querySelector("b")).toHaveTextContent("Watch · CCC widening");
    expect(link.querySelector("small")).toHaveTextContent("+41 bp in a month while BB and B held flat");
    // Bars icon + chevron, both decorative (aria-hidden on the svg or on its wrapping span).
    const icons = [...link.querySelectorAll("svg")];
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    renderWithProviders(<SummaryCard title="Model & market summary" rows={ROWS} status={{ title: "No alerts · 7 days", detail: "Last alert May 01, 2026", onClick, ariaHasPopup: "dialog" }} />);
    const button = screen.getByRole("button", { name: /No alerts · 7 days/ });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveClass("mrr-status");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).toBeNull();

    // A plain href renders an anchor; the standalone export works too.
    const anchor = renderWithProviders(<StatusStrip title="Open the memo" href="https://example.com/memo" ariaLabel="Open the daily memo" />).container;
    const a = within(anchor).getByRole("link", { name: "Open the daily memo" });
    expect(a).toHaveAttribute("href", "https://example.com/memo");
  });

  it("amber tone paints the amber border", () => {
    const { unmount } = renderWithProviders(<SummaryCard title="Credit summary" rows={ROWS} status={{ tone: "amber", title: "Watch", to: "/app/credit#quality-ladder" }} />);
    const amber = screen.getByRole("link", { name: /Watch/ });
    expect(css(amber)).toMatch(/border(?:-color)?:[^;]*var\(--amber-a36\)/);
    expect(css(amber)).toMatch(/linear-gradient\(90deg, ?rgba\(245, ?181, ?46, ?0?\.12\), ?rgba\(245, ?181, ?46, ?0?\.04\)\)/);
    expect((amber.querySelector("b > span") as HTMLElement).style.color).toBe("var(--amber)");
    unmount();

    renderWithProviders(<SummaryCard title="Model & market summary" rows={ROWS} status={{ title: "No alerts", to: "/app/dashboard#alerts" }} />);
    const mint = screen.getByRole("link", { name: /No alerts/ });
    expect(css(mint)).toMatch(/border(?:-color)?:[^;]*rgba\(38, ?220, ?160, ?0?\.34\)/);
    expect(css(mint)).toMatch(/linear-gradient\(90deg, ?rgba\(18, ?190, ?130, ?0?\.12\), ?rgba\(18, ?190, ?130, ?0?\.05\)\)/);
    expect((mint.querySelector("b > span") as HTMLElement).style.color).toBe("var(--mint)");

    const gray = renderWithProviders(<SummaryCard title="Desk summary" rows={ROWS} status={{ tone: "gray", title: "Reading alert feed…", to: "/app/news" }} />).container;
    const grayLink = within(gray).getByRole("link", { name: /Reading alert feed/ });
    expect(css(grayLink)).toMatch(/border(?:-color)?:[^;]*rgba\(200, ?210, ?220, ?0?\.25\)/);
    expect((grayLink.querySelector("b > span") as HTMLElement).style.color).toBe("var(--text-2)");
  });

  it("no strip renders when status is omitted", () => {
    renderWithProviders(
      <SummaryCard title="Model summary" rows={ROWS}>
        <div data-testid="thresholds">Reference thresholds</div>
      </SummaryCard>,
    );
    const card = document.querySelector("section.mrr-summary") as HTMLElement;
    expect(card.querySelector(".mrr-status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // Children still render after the ledger.
    const child = screen.getByTestId("thresholds");
    expect(card.contains(child)).toBe(true);
    expect((card.querySelector("dl") as HTMLElement).compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("ReactNode labels get a stable key from id", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <SummaryCard
        title="Credit summary"
        rows={[
          { id: "oas", label: <Jargon term="OAS">OAS</Jargon>, value: "81 bp" },
          { id: "hy", label: <span>High yield</span>, value: "2.91%", tone: "var(--amber)" },
          { label: "IG", value: "0.81%" },
        ]}
      />,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "OAS" })).toBeInTheDocument();
    expect(screen.getByText("High yield")).toBeInTheDocument();
    const amber = screen.getByText("2.91%");
    expect(amber.tagName).toBe("DD");
    expect(amber.style.color).toBe("var(--amber)");
    expect(screen.getByText("81 bp").tagName).toBe("DD");
  });
});
