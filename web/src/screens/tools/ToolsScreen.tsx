/**
 * Tools, rebuilt on TabHero + SummaryCard per tool (redesign Phase 9,
 * docs/redesign-v2/checklists/09-tools.md B.0). Locked IA: two interactive
 * calculators as sub-tabs, LBO and Asset Allocation. The sub-tab lives in the
 * URL hash (#lbo / #allocation) so the command palette and cross-tab links
 * land on the right panel; a `#lbo-*` or `#allocation-*` hash selects its
 * tool by prefix (D) so the hero buttons and the deep links into the new
 * section ids land too. Local tabs carry tablist semantics via SubTabs.
 *
 * Order of <main> children, all inside `.mrr-tools`: the hero row of the
 * active tool (LboHeroRow: `#lbo-hero` | `#lbo-summary`; AllocationHeroRow:
 * `#allocation-hero` | `#allocation-summary`), swapped with the sub-tab and
 * sitting above the tablist as on every other tab → SubTabs, whose panel is
 * `<section id="lbo">` with the LboPanel body or `<section id="allocation">`
 * with the AllocationPanel → the tool's DisclosureLine. The screen owns the
 * one `useLboDeal` (its runs disabled while Asset allocation is showing) and
 * passes it to the hero row and the panel, so no request is duplicated.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAllocation } from "../../api/queries";
import { fmtDate } from "../../lib/format";
import { DisclosureLine } from "../shared/Disclosure";
import { useHashScroll } from "../shared/screen-ui";
import SubTabs from "../shared/SubTabs";
import AllocationHeroRow from "./AllocationHeroRow";
import AllocationPanel from "./AllocationPanel";
import LboHeroRow from "./LboHeroRow";
import LboPanel from "./LboPanel";
import { stampOf } from "./lbo-copy";
import { useLboDeal } from "./lbo-deal";

export const SUBTABS = [
  { id: "lbo", label: "LBO calculator", hint: "live financing rate" },
  { id: "allocation", label: "Asset allocation", hint: "regime matrix" },
];

/** The sub-tab a hash selects: its own id, or any `{id}-*` section id
 * (`#allocation-risk` opens Asset allocation, `#lbo-sensitivity` the LBO
 * calculator); anything else, the LBO calculator. */
export function subtabFromHash(hash: string): string {
  const h = hash.replace("#", "");
  return SUBTABS.find((t) => h === t.id || h.startsWith(`${t.id}-`))?.id ?? "lbo";
}

const LBO_DISCLOSURE =
  "An illustrative model for teaching and screening, not a transaction model. Taxes, capex and working capital are simplified into one assumption: cash for debt service is 60% of EBITDA. It pays interest first, scheduled amortization is a floor and the remainder sweeps to debt, so a higher rate lowers the IRR. The live rate is Fed funds plus the ICE BofA HY OAS (BAMLH0A0HYM2) from FRED";

const ALLOCATION_DISCLOSURE =
  "Monthly total returns for 10 asset classes, index-spliced before ETF inceptions · computed by the same allocation engine each session · regimes from the stored classifier history.";

export default function ToolsScreen() {
  // Router hash, not window.hashchange: palette navigate() pushes state
  // without firing hashchange, which made deep-links a no-op when Tools was
  // already mounted (audit).
  const location = useLocation();
  const [active, setActive] = useState<string>(() => subtabFromHash(location.hash));

  useEffect(() => {
    setActive(subtabFromHash(location.hash));
  }, [location.hash]);

  const deal = useLboDeal(active === "lbo");
  const alloc = useAllocation();
  // A settled boolean, not the payload: with keepPreviousData every rerun of
  // the deal would otherwise re-scroll a `#lbo-*` hash while the analyst
  // drags a slider. The hash lands once the tool's data is on the page.
  const ready = active === "lbo" ? deal.run.data != null : alloc.data != null;
  // Keyed on the active tool as well: a hash that swaps the sub-tab mounts its
  // section one commit after the hash changes, so the landing must re-run
  // then (Phase 10; SubTabs no longer scrolls the page on selection).
  useHashScroll(`${active}:${ready}`);

  const stamp = stampOf(deal.defaults.data);

  return (
    <div className="mrr-tools">
      {active === "lbo" ? <LboHeroRow deal={deal} /> : <AllocationHeroRow />}

      <SubTabs
        tabs={SUBTABS}
        active={active}
        label="Tools"
        onChange={(id) => {
          setActive(id);
          history.replaceState(null, "", `#${id}`);
        }}
      >
        {active === "lbo" ? (
          <section id="lbo">
            <LboPanel deal={deal} />
          </section>
        ) : (
          <section id="allocation">
            <AllocationPanel />
          </section>
        )}
      </SubTabs>

      {active === "lbo" ? (
        <DisclosureLine>
          {LBO_DISCLOSURE}
          {stamp ? `, stored through ${fmtDate(stamp)}.` : "; no stored date is on file."}
        </DisclosureLine>
      ) : (
        <DisclosureLine>{ALLOCATION_DISCLOSURE}</DisclosureLine>
      )}
    </div>
  );
}
