/**
 * The unavailable state (DESK_FRAME3_SPEC §1.0.2): a card whose block is
 * served awaiting keeps its title, subtitle and stat labels, prints the
 * served reason once (and "Until: …" when served), disables its Advanced
 * control with "not yet served", and wears the "○ Not yet served" badge.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Advanced, Awaiting, Card, LiveBadge, NotServedBadge, Stat, StatRow, Unserved, UnservedCard, isAwaitingRefresh } from "./ui";

const block = { reason: "sector ETFs, RSP and IWM not ingested.", until: null };

function Sample({ awaitingBody = true }: { awaitingBody?: boolean }) {
  return (
    <Card title="Sector leadership" sub="3-month return relative to the S&P" badge={<LiveBadge parts={["Yahoo", "Sep 22"]} />} footer={<Advanced items="1 / 3 / 6 / 12 months" onToggle={() => {}} />}>
      <StatRow cols={3}>
        <Stat label="Leading" awaiting />
        <Stat label="Lagging" awaiting />
        <Stat label="Pattern" value="Cyclical" />
      </StatRow>
      {awaitingBody ? <Awaiting /> : null}
      {awaitingBody ? <Awaiting>the ranked bars</Awaiting> : null}
    </Card>
  );
}

describe("the unavailable state (§1.0.2)", () => {
  it("a card in the scope keeps its labels, prints the reason once, and says Not yet served", () => {
    render(
      <Unserved block={block}>
        <Sample />
      </Unserved>,
    );
    const card = screen.getByRole("region", { name: /Sector leadership/ });
    expect(card).toHaveTextContent("3-month return relative to the S&P");
    for (const l of ["Leading", "Lagging", "Pattern"]) expect(card).toHaveTextContent(l);
    expect(within(card).getAllByText(block.reason)).toHaveLength(1);
    expect(card).not.toHaveTextContent("Awaiting refresh");
    // No number, not even one the card was handed.
    expect(card).not.toHaveTextContent("Cyclical");
    expect(within(card).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(card).not.toHaveTextContent("Yahoo");
    // desk/usability §14.13: an Advanced that would open nothing is not shown.
    expect(within(card).queryByTestId("dk-advanced")).toBeNull();
    expect(card).toHaveAttribute("data-unserved");
  });

  it("prints Until when served", () => {
    render(
      <Unserved block={{ reason: "needs stored SPY option snapshots.", until: "the options store" }}>
        <Sample />
      </Unserved>,
    );
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("needs stored SPY option snapshots. Until: the options store.");
  });

  it("outside a card, Awaiting prints the reason in its place", () => {
    render(
      <Unserved block={block}>
        <section aria-label="bare">
          <Awaiting />
        </section>
      </Unserved>,
    );
    expect(screen.getByRole("region", { name: "bare" })).toHaveTextContent(block.reason);
  });

  it("without a scope nothing changes: Awaiting refresh, the served badge, a live Advanced", () => {
    render(<Sample />);
    const card = screen.getByRole("region", { name: /Sector leadership/ });
    expect(card).toHaveTextContent("Awaiting refresh");
    expect(card).toHaveTextContent("Cyclical");
    expect(within(card).getByTestId("dk-live")).toHaveTextContent("Live · Yahoo · Sep 22");
    expect(within(card).getByTestId("dk-advanced")).toBeEnabled();
    expect(card).not.toHaveAttribute("data-unserved");
  });

  it("a Card's own unavailable prop wins over the scope, and null clears it", () => {
    render(
      <Unserved block={block}>
        <Card title="Served" unavailable={null}>
          <Stat label="Now" value="58" />
        </Card>
      </Unserved>,
    );
    expect(screen.getByRole("region", { name: "Served" })).toHaveTextContent("58");
  });
});

describe("the awaiting badge (§1.7, S-27)", () => {
  const failed = { reason: "Awaiting refresh: this could not be computed from the current data.", until: null };

  it("a block served awaiting whose reason begins 'Awaiting refresh' badges ○ Awaiting refresh, and prints its reason", () => {
    render(
      <Unserved block={failed}>
        <Sample />
      </Unserved>,
    );
    const card = screen.getByRole("region", { name: /Sector leadership/ });
    expect(within(card).getByTestId("dk-live")).toHaveTextContent(/^Awaiting refresh$/);
    expect(card).not.toHaveTextContent("Not yet served");
    expect(within(card).getAllByText(failed.reason)).toHaveLength(1);
  });

  it("every other awaiting block badges ○ Not yet served, and a card unavailable with no served block too", () => {
    render(<UnservedCard title="Vol" block={block} labels={["Skew"]} />);
    expect(within(screen.getByRole("region", { name: "Vol" })).getByTestId("dk-live")).toHaveTextContent(/^Not yet served$/);
    render(<NotServedBadge boxed />);
    expect(screen.getAllByTestId("dk-live").map((b) => b.textContent)).toEqual(["Not yet served", "Not yet served"]);
  });

  it("the rule is the reason's start, nothing else", () => {
    expect([failed, block, { reason: "awaiting refresh soon", until: null }, { reason: "Data is Awaiting refresh", until: null }, null, undefined].map(isAwaitingRefresh)).toEqual([true, false, false, false, false, false]);
    render(<UnservedCard title="Curve" block={failed} labels={["2s10s"]} />);
    expect(within(screen.getByRole("region", { name: "Curve" })).getByTestId("dk-live")).toHaveTextContent(/^Awaiting refresh$/);
  });
});

describe("StatRow", () => {
  it("with cols, the stats fill rows of that many columns: a one-column card stacks its labels, never spills sideways", () => {
    const { container } = render(
      <StatRow cols={1}>
        <Stat label="A" awaiting />
        <Stat label="B" awaiting />
      </StatRow>,
    );
    const row = container.querySelector(".dk-stats") as HTMLElement;
    expect([row.style.gridTemplateColumns, row.style.gridAutoFlow]).toEqual(["repeat(1, minmax(0, 1fr))", "row"]);
  });
});
