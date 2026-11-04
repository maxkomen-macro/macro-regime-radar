import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CBOE_CREDIT, DataNoticeFooter, FRED_API_NOTICE, FRED_API_TERMS_URL, ICE_CREDIT } from "./DataNotice";

describe("DataNotice", () => {
  it("keeps the FRED API notice word for word (API Terms of Use, Requirements (a))", () => {
    expect(FRED_API_NOTICE).toBe("This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.");
  });

  it("keeps the copyright notices FRED shows with the ICE and Cboe series", () => {
    expect(ICE_CREDIT).toContain("Copyright, 2023, ICE Data Indices.");
    expect(CBOE_CREDIT).toContain("Copyright, 2016, Chicago Board Options Exchange, Inc.");
  });

  it("renders only the notice, the API terms link and the credits link", () => {
    render(
      <MemoryRouter>
        <DataNoticeFooter />
      </MemoryRouter>,
    );
    const footer = screen.getByTestId("data-notice");
    expect(footer.textContent).toContain(FRED_API_NOTICE);
    expect(footer.textContent).not.toContain("agree to be bound");
    expect(screen.getByRole("link", { name: /FRED® API Terms of Use/ }).getAttribute("href")).toBe(FRED_API_TERMS_URL);
    expect(screen.getByRole("link", { name: "Sources" }).getAttribute("href")).toBe("/app/methodology#notices");
  });
});
