/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/shared/TabHero.test.tsx`; contract in section B.1 (the tab hero:
 * `section.mrr-hero[aria-labelledby]`, serif h1 headline, Pill, actions as
 * `<a>` / router `<Link>` / `<button>`, footnote with aria-hidden separators,
 * live dot vs the diamond glyph, gradient placeholder when no chart).
 *
 * Rendered through renderWithProviders: the `to` actions are router Links.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import TabHero from "./TabHero";
import { assessFreshness } from "./freshness";
import { renderWithProviders } from "../../test/utils";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const section = () => document.querySelector("section.mrr-hero") as HTMLElement;

const FRESHNESS = [
  { noun: "Macro", info: assessFreshness("2026-07-01", "monthly") },
  { noun: "Market", info: assessFreshness("2026-09-08", "daily") },
];

describe("TabHero (checklist 02 B.1)", () => {
  it("renders the headline as h1 with the display face and links the section to it", () => {
    renderWithProviders(<TabHero eyebrow="Current regime" headline="Goldilocks" subhead="A clear lead over Overheating at 25%." lede="Growth is steady and inflation is easing." id="takeaway" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Goldilocks" });
    expect(h1.tagName).toBe("H1");
    expect(h1.id).toBeTruthy();
    const hero = section();
    expect(hero).not.toBeNull();
    expect(hero).toHaveAttribute("aria-labelledby", h1.id);
    expect(hero).toHaveAttribute("id", "takeaway");
    expect(hero.contains(h1)).toBe(true);
    expect(css(h1)).toMatch(/var\(--font-display\)/);
    expect(css(h1)).toMatch(/var\(--fs-display\)/);
    expect(css(h1)).toMatch(/font-variation-settings:\s*"opsz" var\(--opsz-display\)/);
    expect(css(h1)).toMatch(/color:\s*(?:#fff|rgb\(255, ?255, ?255\))/);
    // One subhead h2 and the lede paragraph; the eyebrow text renders.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("A clear lead over Overheating at 25%.");
    expect(screen.getByText("Growth is steady and inflation is easing.").tagName).toBe("P");
    expect(screen.getByText("Current regime")).toBeInTheDocument();
    expect(hero.style.background).toBe("var(--card-grad)");
    expect(hero.style.minHeight).toBe("340px");
    expect(hero.style.overflow).toBe("hidden");
    // The glow layer is decorative.
    const glow = hero.querySelector("[aria-hidden='true'][style*='radial-gradient']");
    if (glow) expect(glow).toHaveAttribute("aria-hidden", "true");
  });

  it('as="h2" renders no h1', () => {
    renderWithProviders(<TabHero as="h2" eyebrow="Recession risk" headline="35%" subhead="Elevated but off the spring peak." minHeight={300} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    const h2 = screen.getByRole("heading", { level: 2, name: "35%" });
    expect(h2.tagName).toBe("H2");
    expect(section()).toHaveAttribute("aria-labelledby", h2.id);
    // The subhead demotes to a paragraph so the outline never has two h2 for one hero.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    const sub = screen.getByText("Elevated but off the spring peak.");
    expect(sub.tagName).toBe("P");
    expect(sub).toHaveClass("mrr-hero-sub");
    expect(section().style.minHeight).toBe("300px");
  });

  it("pill renders with the requested tone", () => {
    const { unmount } = renderWithProviders(<TabHero as="h2" eyebrow="Recession risk" headline="35%" pill="Elevated" pillTone="amber" />);
    const pill = screen.getByText("Elevated").closest("[data-tone]") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill).toHaveAttribute("data-tone", "amber");
    expect(pill).toHaveClass("mrr-pill");
    // The pill sits in the h1row beside the heading.
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.parentElement?.contains(pill)).toBe(true);
    unmount();
    renderWithProviders(<TabHero eyebrow="Current regime" headline="Goldilocks" pill="64% probability" />);
    expect(screen.getByText("64% probability").closest("[data-tone]")).toHaveAttribute("data-tone", "mint");
    const bare = renderWithProviders(<TabHero as="h2" eyebrow="Current regime" headline="Reading the latest regime…" />).container;
    expect(bare.querySelector("[data-tone]")).toBeNull();
  });

  it("actions render as link, router link and button with the primary first", () => {
    const onClick = vi.fn();
    const { unmount } = renderWithProviders(
      <TabHero
        eyebrow="Current regime"
        headline="Goldilocks"
        actions={[
          { label: "Explore the regime", to: "/app/regime-lab", primary: true },
          { label: "Source data", href: "https://fred.stlouisfed.org/", ariaLabel: "Source data at FRED" },
        ]}
      />,
    );
    const primary = screen.getByRole("link", { name: /Explore the regime/ });
    const external = screen.getByRole("link", { name: "Source data at FRED" });
    expect(primary).toHaveAttribute("href", "/app/regime-lab");
    expect(external).toHaveAttribute("href", "https://fred.stlouisfed.org/");
    expect(primary.compareDocumentPosition(external) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(css(primary)).toMatch(/background(?:-color)?:\s*(?:#fff|rgb\(255, ?255, ?255\))/);
    expect(css(primary)).toMatch(/color:\s*(?:#0b1117|rgb\(11, ?17, ?23\))/);
    expect(primary.style.height).toBe("44px");
    expect(primary.querySelector("svg[aria-hidden='true'] path")).toHaveAttribute("d", "M5 12h14M13 6l6 6-6 6");
    expect(css(external)).toMatch(/border(?:-color)?:[^;]*var\(--line-white-30\)/);
    expect(external.querySelector("svg")).toBeNull();
    unmount();

    renderWithProviders(
      <TabHero
        as="h2"
        eyebrow="Recession risk"
        headline="35%"
        actions={[
          { label: "View model details", to: "/app/methodology" },
          { label: "Reset inputs", onClick },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "Reset inputs" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /View model details/ })).toHaveAttribute("href", "/app/methodology");
  });

  it("footnote items are joined with an aria-hidden separator", () => {
    renderWithProviders(
      <TabHero eyebrow="Current regime" headline="Goldilocks" footnote={["Macro regime for Jul 2026 (2 months old)", "Model confidence: Medium (50%)", "Updated Sep 09, 2026"]} freshness={FRESHNESS} note="Prices are context, not the tape." />,
    );
    const hero = section();
    expect(hero.textContent).toMatch(/Macro regime for Jul 2026 \(2 months old\)\s*•\s*Model confidence: Medium \(50%\)\s*•\s*Updated Sep 09, 2026/);
    const separators = [...hero.querySelectorAll("[aria-hidden='true']")].filter((s) => s.textContent?.trim() === "•");
    expect(separators).toHaveLength(2);
    // Freshness chips follow (DeskRead's FreshnessChip carries a "Noun: Word" title), then the note.
    expect(hero.querySelectorAll("[title^='Macro:']")).toHaveLength(1);
    expect(hero.querySelectorAll("[title^='Market:']")).toHaveLength(1);
    const words = within(hero).getAllByText(/^(?:Stale|Current|Delayed)$/);
    expect(words.length).toBeGreaterThanOrEqual(2);
    expect(within(hero).getByText("Prices are context, not the tape.")).toBeInTheDocument();
  });

  it("live renders the pulsing dot and hides the glyph", () => {
    const { unmount } = renderWithProviders(<TabHero eyebrow="Current regime" headline="Goldilocks" live />);
    const dot = section().querySelector<HTMLElement>("[style*='mrr-pulse']");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot?.style.width).toBe("6px");
    expect(dot?.style.borderRadius).toBe("50%");
    expect(css(dot)).toMatch(/background(?:-color)?:\s*var\(--mint\)/);
    expect(section().textContent).not.toContain("◆");
    unmount();
    renderWithProviders(<TabHero eyebrow="Current regime" headline="Goldilocks" />);
    expect(section().querySelector("[style*='mrr-pulse']")).toBeNull();
    const glyph = [...section().querySelectorAll("[aria-hidden='true']")].find((s) => s.textContent?.trim() === "◆");
    expect(glyph).toBeDefined();
  });

  it("placeholder renders the gradient block only when no chart is given", () => {
    const { unmount } = renderWithProviders(<TabHero as="h2" eyebrow="Dashboard" headline="Goldilocks" placeholder minHeight={300} />);
    const block = section().querySelector<HTMLElement>("[aria-hidden='true'][style*='135deg']");
    expect(block).not.toBeNull();
    expect(css(block)).toMatch(/linear-gradient\(135deg, ?#0f1a24, ?#0a131b\)/);
    expect(section().querySelector(".mrr-hero-viz")?.contains(block as HTMLElement)).toBe(true);
    unmount();

    renderWithProviders(<TabHero as="h2" eyebrow="Dashboard" headline="Goldilocks" placeholder chart={<svg data-testid="hero-chart" width="400" height="330" />} />);
    expect(screen.getByTestId("hero-chart")).toBeInTheDocument();
    expect(section().querySelector("[style*='135deg']")).toBeNull();
    expect(section().querySelector(".mrr-hero-viz")?.contains(screen.getByTestId("hero-chart"))).toBe(true);

    const single = renderWithProviders(<TabHero as="h2" eyebrow="Dashboard" headline="Goldilocks" />).container;
    expect(single.querySelector(".mrr-hero-viz")).toBeNull();
    expect(single.querySelector("[style*='135deg']")).toBeNull();
  });
});
