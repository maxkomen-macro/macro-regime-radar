# IA Proposals — Macro Regime Radar

Constraints honored in both options: **Methodology leaves the tab bar** (persistent footer/header link opening a reference page, with per-widget popovers absorbing its legends), and the **"Intelligence" / "Events & Intelligence" name collision is resolved** (neither option keeps both names; today they share zero data yet sound like siblings).

---

## Option A — 7 tabs, consolidated

| # | Tab | Contents (one line) |
|---|---|---|
| 1 | **Dashboard** | Regime hero (badge + probability bars + read-through), Signal Monitor **with the alert feed folded beneath it** (absorbs Signals & Alerts), KPI strip, What's Priced (single home); macro charts collapse into a "Macro charts" section with sub-tabs; downloads demoted to footer links. |
| 2 | **Regime Lab** *(renamed Intelligence)* | Playbook, duration/cycle, transition outlook, historical analogues, scenario builder — plus the Regime History Gantt (demoted from Dashboard) and **backtests + factor attribution absorbed from Historical Analysis** ("how did regimes/signals actually pay?"). |
| 3 | **Markets** | Rates bar, risk gauge, GARCH vol, ticker grid, sector heatmap, Top Surprises (full 10-row version; Dashboard keeps none or 3-row teaser); TradingView section **cut**. |
| 4 | **Credit** | Unchanged content; absorbs sole ownership of the financing-cost card (LBO tab links to it). |
| 5 | **Recession** | Model gauge, curve monitor, sensitivity sliders (collapsed by default), model transparency. |
| 6 | **News & Calendar** *(renamed Events & Intelligence)* | Headline feed with significance scoring + AI enrichment, macro-events calendar — with a latest-available fallback so a stalled pipeline shows dated headlines instead of zeros. |
| 7 | **Tools** | LBO Calculator and Asset Allocation as two sub-tabs — both are interactive calculators, not monitors. |

**Merged:** Signals & Alerts → Dashboard; Historical Analysis → Regime Lab.
**Cut:** TradingView embeds (second data source that contradicts adjacent DB prices); duplicate What's Priced/Top Surprises/recession-strip renderings (each keeps one home + cross-links).
**Demoted:** Methodology → footer link; Dashboard's 4 macro charts → collapsed section; Prophet forecasts → Regime Lab appendix or cut until stable; downloads → footer.

**Hero path:** Land on Dashboard — regime hero answers "what's the market weather?" in one screen. Click 1: "See full regime analysis →" on the intelligence card → Regime Lab (playbook says what to own). Click 2: a scenario card ("COVID Replay") → probability deltas + positioning. Two clicks from landing to the app's most impressive interactive artifact.

---

## Option B — 9 tabs, granularity preserved

| # | Group | Tab | Contents (one line) |
|---|---|---|---|
| 1 | Monitor | **Dashboard** | Regime hero, signal strip, KPIs — trimmed to ≤2.5 viewports; everything else cross-links. |
| 2 | Monitor | **Markets** | Full snapshot as today minus TradingView. |
| 3 | Monitor | **News & Events** *(renamed Events & Intelligence)* | Feed + calendar with latest-available fallback. |
| 4 | Analyze | **Regime** *(renamed Intelligence)* | Playbook, cycle, transitions, analogues, scenarios. |
| 5 | Analyze | **Credit** | As today. |
| 6 | Analyze | **Recession** | As today, sensitivity collapsed. |
| 7 | Analyze | **Backtests** *(renamed Historical Analysis)* | Signal/regime forward returns + factor attribution, with visible computed-at stamp. |
| 8 | Tools | **Allocation** | Overview/Optimization/Risk Analysis (Risk Analysis paginated). |
| 9 | Tools | **LBO** | Calculator as today. |

**Absorbed:** Signals & Alerts dissolves — signal gauges live on Dashboard, the alert feed becomes a bell-icon drawer in the header (1 stale alert doesn't earn a tab).

**Navigation pattern (required):** **Grouped tabs with hairline dividers — `Monitor · Analyze · Tools`** — as the primary pattern, plus a **Cmd+K command palette** as a secondary layer for the owner (jump to any tab/section/ticker). Considered and rejected as primary: "5 primary tabs + More ▾" hides exactly the tabs a recruiter should stumble into (Backtests, Allocation are the résumé pieces; an overflow menu is where content goes to die). The divider pattern keeps all 9 destinations visible with information scent ("Analyze" tells a non-finance visitor these are deep dives, safely skippable), costs no clicks, and the palette serves the power user without burdening first-timers. **Pick: dividers + Cmd+K.**

**Hero path:** Land on Dashboard (now ≤2.5 viewports, hero above the fold). Click 1: "Regime" in the Analyze group (adjacency + name makes it the obvious next step) → playbook. Click 2: scenario selector → stressed probabilities. Same two-click destination as A, but the visitor chose from 9 doors instead of 7.

---

## Comparison by audience

| Audience | Option A (7) | Option B (9 + groups) | Winner |
|---|---|---|---|
| Recruiter (10-second LinkedIn click) | Fewer, bolder destinations; no dead-end tabs; hero path is guided | 9 tabs still scannable thanks to groups, but two of them (Backtests, LBO) read as niche before clicking | **A** — the first impression is the whole game; every tab in A demos well |
| Non-finance visitor | 7 choices, each self-describing ("News & Calendar", "Tools") | Group labels help, but Credit/Recession/Backtests as peers is still a jargon wall | **A** — consolidation also consolidates the jargon into fewer rooms |
| Owner (learning macro daily) | Merges bury the backtests one level deep | Everything one click away; Cmd+K; granular tabs match how he actually studies (one topic per session) | **B** |

Net: **A** optimizes for the two audiences the redesign brief says must be won (recruiter, civilian); **B** optimizes for the owner's daily loop. If A is chosen, the owner's loss is one extra click into Regime Lab's backtest section — a cheap price. If B is chosen, the Dashboard trim to ≤2.5 viewports is mandatory or the 10-second impression stays broken.
