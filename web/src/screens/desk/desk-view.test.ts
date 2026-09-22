import { describe, expect, it } from "vitest";
import { parseView, withView } from "./desk-view";

describe("desk view in the URL", () => {
  it("reads only the exact word client as the client view", () => {
    expect(parseView("?view=client")).toBe("client");
    expect(parseView("?view=CLIENT")).toBe("desk");
    expect(parseView("?view=")).toBe("desk");
    expect(parseView("")).toBe("desk");
    expect(parseView(new URLSearchParams("study=x&view=client"))).toBe("client");
  });
  it("writes the view into a path and keeps the other params and the hash", () => {
    expect(withView("/desk/today", "client")).toBe("/desk/today?view=client");
    expect(withView("/desk/today", "desk")).toBe("/desk/today");
    expect(withView("/desk/event-study?study=a&view=client#verdict", "desk")).toBe("/desk/event-study?study=a#verdict");
    expect(withView("/desk/event-study?study=a#verdict", "client")).toBe("/desk/event-study?study=a&view=client#verdict");
  });
});
