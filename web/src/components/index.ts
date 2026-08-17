/**
 * Barrel for the 17 design-system components ported verbatim from the bundle
 * (components/**). Import from here; read the sibling .prompt.md before
 * changing any component's API.
 */

// core
export { Card } from "./core/Card";
export { SectionHeader } from "./core/SectionHeader";
export { StatusDot } from "./core/StatusDot";
export { Tag } from "./core/Tag";

// data
export { DataTable } from "./data/DataTable";
export { GaugeBar, rampColor } from "./data/GaugeBar";
export { ProbabilityBar } from "./data/ProbabilityBar";
export { Sparkline } from "./data/Sparkline";
export { StatTile } from "./data/StatTile";

// signals
export { AlertRow } from "./signals/AlertRow";
export { RegimeBadge } from "./signals/RegimeBadge";
export { SignalCard } from "./signals/SignalCard";

// nav
export { TabBar } from "./nav/TabBar";
export { TickerStrip } from "./nav/TickerStrip";

// intel
export { IntelBanner } from "./intel/IntelBanner";
export { NewsCard } from "./intel/NewsCard";
export { ReadThrough } from "./intel/ReadThrough";
