/**
 * Tools — locked IA: two interactive calculators as sub-tabs, LBO and Asset
 * Allocation. The sub-tab lives in the URL hash (#lbo / #allocation) so the
 * command palette and cross-tab links land on the right panel. Local tabs
 * carry tablist semantics via SubTabs (2026-09-05).
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import SubTabs from "../shared/SubTabs";
import LboPanel from "./LboPanel";
import AllocationPanel from "./AllocationPanel";

const SUBTABS = [
  { id: "lbo", label: "LBO calculator", hint: "live financing rate" },
  { id: "allocation", label: "Asset allocation", hint: "regime matrix" },
];

function subtabFromHash(hash: string): string {
  const h = hash.replace("#", "");
  return SUBTABS.some((t) => t.id === h) ? h : "lbo";
}

export default function ToolsScreen() {
  // Router hash, not window.hashchange — palette navigate() pushes state
  // without firing hashchange, which made deep-links a no-op when Tools was
  // already mounted (audit).
  const location = useLocation();
  const [active, setActive] = useState<string>(() => subtabFromHash(location.hash));

  useEffect(() => {
    setActive(subtabFromHash(location.hash));
  }, [location.hash]);

  return (
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
          <LboPanel />
        </section>
      ) : (
        <section id="allocation">
          <AllocationPanel />
        </section>
      )}
    </SubTabs>
  );
}
