import React from "react";
import { Pill } from "../core/Pill";

/* Regime to pill tint (src/regime.py order). Goldilocks is mint (decision 1);
   an unknown label renders gray. */
const REGIME_TONE = {
  Goldilocks: "mint",
  Overheating: "overheating",
  Stagflation: "stagflation",
  "Recession Risk": "gray",
};

/** The current macro regime as the probability pill: label plus, when
 * `confidence` is set, a trailing `.pct` percentage. */
export function RegimeBadge({ label = "Goldilocks", size = "md", confidence, tone = "regime", style, ...rest }) {
  const t = tone && tone !== "regime" ? tone : REGIME_TONE[label] || "gray";
  return (
    <Pill {...rest} tone={t} size={size === "sm" ? "sm" : "md"} style={{ gap: "var(--gap-inline)", ...style }}>
      {label}
      {confidence != null ? (
        <span className="pct" style={{ color: "inherit", opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(confidence * 100)}%
        </span>
      ) : null}
    </Pill>
  );
}
