/**
 * Tools — locked IA: two interactive calculators as sub-tabs, LBO and Asset
 * Allocation. The sub-tab lives in the URL hash (#lbo / #allocation) so the
 * command palette and cross-tab links land on the right panel.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { TabBar } from "../../components";
import LboPanel from "./LboPanel";
import AllocationPanel from "./AllocationPanel";

const SUBTABS = [
  { id: "lbo", label: "LBO Calculator" },
  { id: "allocation", label: "Asset Allocation" },
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
    <div>
      <div style={{ marginBottom: 14 }}>
        <TabBar
          tabs={SUBTABS}
          active={active}
          onChange={(id: string) => {
            setActive(id);
            history.replaceState(null, "", `#${id}`);
          }}
        />
      </div>
      {active === "lbo" ? (
        <section id="lbo">
          <LboPanel />
        </section>
      ) : (
        <section id="allocation">
          <AllocationPanel />
        </section>
      )}
    </div>
  );
}
