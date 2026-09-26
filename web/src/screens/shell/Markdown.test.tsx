/**
 * The small Markdown renderer: pipe tables and figures only when a page opts
 * in (Desk Build Notes renders a file it owns; the assistant's replies never
 * draw an image or a table), and underscores that emphasize only at a word's
 * edge.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Markdown from "./Markdown";

const TABLE = "| Step | Where |\n|---|:---:|\n| Fetch | `refresh-data.yml` |\n| Serve | **Render** |";

describe("Markdown", () => {
  it("renders a pipe table when asked, its cells through the inline rules, in a region that scrolls on its own", () => {
    render(<Markdown text={`Before.\n${TABLE}\nAfter.`} tables />);
    const region = screen.getByRole("region", { name: "Step, Where" });
    // A tab stop only while it scrolls (jsdom lays nothing out, so it does not).
    expect(region).not.toHaveAttribute("tabindex");
    const rows = within(region).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["StepWhere", "Fetchrefresh-data.yml", "ServeRender"]);
    expect(within(region).getByText("refresh-data.yml").tagName).toBe("CODE");
    expect(within(region).getByText("Render").tagName).toBe("STRONG");
    expect(screen.getByText("Before.")).toBeInTheDocument();
    expect(screen.getByText("After.")).toBeInTheDocument();
  });

  it("shows a figure only when the page resolves its path; else it names it in words", () => {
    const md = "![Pipeline mechanics](screens/pipeline-mechanics.svg)\n\n![Other](screens/other.svg)";
    render(<Markdown text={md} figure={(src) => (src === "screens/pipeline-mechanics.svg" ? "/assets/p.svg" : null)} />);
    expect(screen.getByRole("img", { name: "Pipeline mechanics" })).toHaveAttribute("src", "/assets/p.svg");
    expect(screen.getByText("Figure: Other (not in this build)")).toBeInTheDocument();
  });

  it("a table's region is named by its header's words, the Markdown marks dropped (V13-7)", () => {
    render(<Markdown text={"| **Step** | `Where` | _Notes_ |\n|---|---|---|\n| a | b | c |"} tables />);
    expect(screen.getByRole("region", { name: "Step, Where, Notes" })).toBeInTheDocument();
  });

  it("without the options (the assistant's replies) a table and an image stay plain text", () => {
    const { container } = render(<Markdown text={`${TABLE}\n\n![x](https://example.com/x.png)`} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The image's syntax reads as a link, as before: nothing is loaded.
    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute("href", "https://example.com/x.png");
  });

  it("prints snake_case and FILE_NAMES as written; an underscore at a word's edge still emphasizes", () => {
    const { container } = render(<Markdown text="Read FRAME3_DATA_AUDIT.md and desk_series; _this_ is emphasis." />);
    expect(container.textContent).toBe("Read FRAME3_DATA_AUDIT.md and desk_series; this is emphasis.");
    expect(container.querySelectorAll("em")).toHaveLength(1);
    expect(container.querySelector("em")?.textContent).toBe("this");
  });
});
