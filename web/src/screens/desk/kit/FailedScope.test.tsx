import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeskApiError } from "../data/api";
import { Awaiting, FailedScope, LoadingLine, Stat, eitherFailed, loadFailed } from "./ui";

const failedQ = (error: unknown, extra: { isFetching?: boolean; refetch?: () => unknown } = {}) => ({ isError: true, error, ...extra });

describe("a card whose request failed (desk/usability item 12, §14.12)", () => {
  it("says Couldn't load · Retry once, keeps its labels with no number, and Retry asks again", () => {
    const refetch = vi.fn();
    render(
      <FailedScope q={failedQ(new DeskApiError(503, "The data service did not answer."), { refetch })}>
        <LoadingLine busy={false} />
        <Stat label="10-year" awaiting />
        <Awaiting>the curve</Awaiting>
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent("Couldn't load · Retry");
    expect(screen.getByText("10-year").closest(".dk-stat")).toHaveTextContent(/^10-year—$/);
    expect(screen.queryByText(/Awaiting refresh/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says Loading live data… while Retry is asking", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(0, "The data service did not answer."), { isFetching: true, refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-loading")).toHaveTextContent("Loading live data…");
    expect(screen.queryByTestId("dk-failed")).toBeNull();
  });

  it("a refusal the Desk does not word (a framework 422) says Couldn't load, with no words of its own and no Retry", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(422, "Unprocessable Entity", { error: "validation", message: "Unprocessable Entity" }), { refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent(/^Couldn't load$/);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a 429 is asked again: Retry is offered", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(429, "busy", { error: "busy" }), { refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent("Couldn't load · Retry");
  });

  it("a refusal the Desk does not word (a framework 422) says Couldn't load, with no words of its own and no Retry", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(422, "Unprocessable Entity", { error: "validation", message: "Unprocessable Entity" }), { refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent(/^Couldn't load$/);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a 429 is asked again: Retry is offered", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(429, "busy", { error: "busy" }), { refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent("Couldn't load · Retry");
  });

  it("prints a refusal's own words and offers no Retry, which could not change it", () => {
    render(
      <FailedScope q={failedQ(new DeskApiError(422, "ZZZZ is not a US-listed stock or ETF.", { error: "unsupported" }), { refetch: () => undefined })}>
        <LoadingLine />
      </FailedScope>,
    );
    expect(screen.getByTestId("dk-failed")).toHaveTextContent("Couldn't load: ZZZZ is not a US-listed stock or ETF.");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("an answer served awaiting is not a failure: its scope prints the reason instead", () => {
    const awaiting = new DeskApiError(200, "awaiting", null, { reason: "Awaiting refresh: sector ETFs are not stored.", until: null });
    expect(loadFailed(failedQ(awaiting))).toBe(false);
    render(
      <FailedScope q={failedQ(awaiting)}>
        <LoadingLine busy={false} />
        <Stat label="Breadth" awaiting />
      </FailedScope>,
    );
    expect(screen.queryByTestId("dk-failed")).toBeNull();
    expect(screen.getByText("Awaiting refresh")).toBeInTheDocument();
  });

  it("a card reading two requests fails with either, and Retry asks only the failed one", () => {
    const a = { isError: false, error: null, refetch: vi.fn() };
    const b = { isError: true, error: new DeskApiError(500, "x"), refetch: vi.fn() };
    expect(loadFailed(eitherFailed(a, a))).toBe(false);
    render(
      <FailedScope q={eitherFailed(a, b)}>
        <LoadingLine />
      </FailedScope>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(b.refetch).toHaveBeenCalledTimes(1);
    expect(a.refetch).not.toHaveBeenCalled();
  });
});
