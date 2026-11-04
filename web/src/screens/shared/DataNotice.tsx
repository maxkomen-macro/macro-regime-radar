/**
 * Data notices and source credits (text only).
 *
 * The FRED® API Terms of Use require an application built on the API to
 * "Place the following notice prominently on your application: 'This product
 * uses the FRED® API but is not endorsed or certified by the Federal Reserve
 * Bank of St. Louis.'" (Requirements (a)) and, for an application used by
 * others, to "display to the users of your application the link to these
 * Terms of Use" and state that users agree to be bound by them (Requirements
 * (d)). FRED also asks every user to "keep any copyright notices that appear
 * with the data". The wording below is copied from those pages as read on
 * 2026-11-04; change it only against the source pages.
 *
 * A credit is not a licence: these lines do not grant any right to display
 * or redistribute a third party's data.
 */

import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

/** FRED API Terms of Use, Requirements (a): the notice, verbatim. */
export const FRED_API_NOTICE =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";

/** FRED API Terms of Use, Requirements (d): the statement users are shown. */
export const FRED_API_TERMS_STATEMENT = "By using this site you agree to be bound by the FRED® API Terms of Use.";

/** The FRED API Terms of Use (the "Additional Terms of Use for the FRED® API"). */
export const FRED_API_TERMS_URL = "https://fred.stlouisfed.org/legal/#api";

/** Where the full list of credits lives: Methodology › Data and sources. */
export const NOTICES_PATH = "/app/methodology#notices";

/** The ICE BofA OAS series' source line and copyright notice, as FRED shows them. */
export const ICE_CREDIT = "Source: ICE Data Indices, LLC via FRED®. Copyright, 2023, ICE Data Indices.";

/** The VIX series' source line and copyright notice, as FRED shows them. */
export const CBOE_CREDIT = "Source: Chicago Board Options Exchange via FRED®. Copyright, 2016, Chicago Board Options Exchange, Inc.";

/** Original publishers of the FRED series the site reads, for the credits list. */
export const FRED_SOURCE_CREDITS: readonly (readonly [string, string])[] = [
  ["Board of Governors of the Federal Reserve System", "Treasury yields (DGS3MO, DGS2, DGS5, DGS10, DGS30), real yields (DFII5, DFII10), the effective federal funds rate (FEDFUNDS) and industrial production (INDPRO)"],
  ["U.S. Bureau of Labor Statistics", "consumer prices (CPIAUCSL) and the unemployment rate (UNRATE)"],
  ["Federal Reserve Bank of St. Louis", "breakeven inflation (T5YIE, T10YIE), the 10-year less 2-year spread (T10Y2Y) and the NBER-based recession indicator (USREC)"],
  ["Federal Reserve Bank of New York", "the Secured Overnight Financing Rate (SOFR)"],
  ["Federal Reserve Bank of Philadelphia", "the leading index for the US (USSLIND), discontinued"],
  ["U.S. Energy Information Administration", "WTI crude oil (DCOILWTICO)"],
  ["ICE Data Indices, LLC", "the ICE BofA option-adjusted spread indices (BAMLH0A0HYM2, BAMLC0A0CM, BAMLH0A1HYBB, BAMLH0A2HYB, BAMLH0A3HYC)"],
  ["Chicago Board Options Exchange", "the VIX close (VIXCLS)"],
];

const lineStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  lineHeight: 1.6,
  letterSpacing: ".03em",
  color: "var(--text-3)",
};

/** The site-wide line under every app and Desk page: the FRED API notice, the
 * link to the FRED API Terms of Use, and a link to the full credits. */
export function DataNoticeFooter({ style }: { style?: CSSProperties }) {
  return (
    <footer className="mrr-data-notice" data-testid="data-notice" style={{ padding: "16px 0 24px", ...style }}>
      <p style={lineStyle}>
        {FRED_API_NOTICE} {FRED_API_TERMS_STATEMENT}{" "}
        <a href={FRED_API_TERMS_URL} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          FRED® API Terms of Use ↗
        </a>{" "}
        · <Link to={NOTICES_PATH} style={{ color: "inherit" }}>Data sources and copyright notices</Link>
      </p>
    </footer>
  );
}
