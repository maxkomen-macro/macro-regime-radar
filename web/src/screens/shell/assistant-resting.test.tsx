/**
 * launch-1, item 1: the assistant is open to the public under a hard daily
 * budget. When the day is spent the visitor gets a plain resting state, not an
 * error: the chip says the analyst is resting, and a question answered while
 * resting reads as a sentence rather than a red failure.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import AssistantPanel from "./AssistantPanel";
import TopBar from "./TopBar";
import { renderWithProviders, stubFetch } from "../../test/utils";

const RESTING_FRAME =
  'event: resting\ndata: {"message": "The AI analyst is resting until tomorrow: it has used today\'s budget. ' +
  'Every other screen works as usual, and it wakes up at midnight UTC.", "resets_at": "2026-09-22T00:00:00Z"}\n\n' +
  "event: done\ndata: {}\n\n";

function stubStream(body: string) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof URL ? input : typeof input === "string" ? input : input.url);
    if (url.includes("/api/assistant/status")) {
      return new Response(JSON.stringify({ resting: true, spent_usd: 1, cap_usd: 1, reserve_usd: 0.09, resets_at: "2026-09-22T00:00:00Z", ledger: "ok", reason: null }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("the analyst's resting state", () => {
  it("reads as a plain sentence, not an error", async () => {
    stubStream(RESTING_FRAME);
    renderWithProviders(<AssistantPanel open onClose={() => {}} tabContext={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what is the regime?" } });
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);

    await waitFor(() => expect(document.body.textContent).toMatch(/resting until tomorrow/i));
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/◆ Analyst · resting/);
    expect(text).not.toMatch(/◆ Analyst · error/);
    expect(text).toMatch(/midnight UTC/);
  });

  it("says so on the chip before anyone asks", async () => {
    stubStream(RESTING_FRAME);
    renderWithProviders(
      <TopBar
        paletteOpen={false}
        onOpenPalette={() => {}}
        assistantOpen={false}
        onToggleAssistant={() => {}}
        assistantLauncherRef={createRef<HTMLButtonElement>()}
        drawerOpen={false}
        onOpenDrawer={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Analyst resting/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Analyst resting/i })).toHaveAttribute(
      "title",
      expect.stringContaining("midnight UTC"),
    );
  });

  it("keeps the usual label while the analyst is awake", async () => {
    stubFetch({
      "/api/assistant/status": () => ({ resting: false, spent_usd: 0.12, cap_usd: 1, reserve_usd: 0.09, resets_at: "2026-09-22T00:00:00Z", ledger: "ok", reason: null }),
      "/api/alerts": () => [],
    });
    renderWithProviders(
      <TopBar
        paletteOpen={false}
        onOpenPalette={() => {}}
        assistantOpen={false}
        onToggleAssistant={() => {}}
        assistantLauncherRef={createRef<HTMLButtonElement>()}
        drawerOpen={false}
        onOpenDrawer={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Ask the analyst/i })).toBeInTheDocument());
  });
});
