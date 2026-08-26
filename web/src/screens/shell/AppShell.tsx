/**
 * The terminal shell — locked-IA header spec, wired to real API data:
 * wordmark + live dot (pulses only when intraday data is actually fresh),
 * ticker strip, regime badge + probability bar (/api/regime/latest), 7-tab
 * routing with the active tab in the URL, alerts trigger + drawer
 * (/api/alerts) with the all-clear state, Methodology as a persistent link,
 * Cmd+K palette, and the data-freshness line (/api/freshness).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ProbabilityBar, RegimeBadge, TabBar } from "../../components";
import { useAlerts, useFreshness, useRegimeLatest } from "../../api/queries";
import { daysSince, fmtDate, fmtIntradayTs, fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { METHODOLOGY_SLUG, TABS, tabBySlug } from "./sections";
import AlertDrawer from "./AlertDrawer";
import AssistantPanel, { type AssistantTabContext } from "./AssistantPanel";
import CommandPalette from "./CommandPalette";
import TickerLive from "./TickerLive";
import DashboardScreen from "../dashboard/DashboardScreen";
import MarketsScreen from "../markets/MarketsScreen";
import RegimeLabScreen from "../regimelab/RegimeLabScreen";
import CreditScreen from "../credit/CreditScreen";
import RecessionScreen from "../recession/RecessionScreen";
import NewsScreen from "../news/NewsScreen";
import ToolsScreen from "../tools/ToolsScreen";
import MethodologyScreen from "../methodology/MethodologyScreen";
import { useStreamLive } from "../../live/quotes";

const mono = (size: number | string, color: string): React.CSSProperties => ({
  fontFamily: "var(--font-mono)",
  fontSize: size,
  color,
});

function AlertsTrigger({ onOpen, touch = false }: { onOpen: () => void; touch?: boolean }) {
  const alerts = useAlerts(200);
  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= 7);
  const worst = recent.some((a) => a.level === "risk")
    ? "var(--neg-text)"
    : recent.some((a) => a.level === "watch")
      ? "var(--warn)"
      : "var(--accent)";

  return (
    <button
      onClick={onOpen}
      aria-label="Open alert feed"
      style={{
        appearance: "none",
        background: "none",
        border: "0.5px solid var(--line-hair)",
        borderRadius: "var(--r-xs)",
        cursor: "pointer",
        // Finger-sized on narrow viewports; the desk chip stays 3px/8px.
        padding: touch ? "6px 10px" : "3px 8px",
        ...(touch ? { minHeight: 32 } : null),
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...mono("var(--fs-meta)", recent.length ? worst : "var(--pos)"),
        letterSpacing: "var(--ls-micro)",
      }}
    >
      {recent.length ? (
        <>
          <span aria-hidden="true">●</span> ALERTS {recent.length} · 7D
        </>
      ) : (
        <>
          ✓ all clear
          {rows.length > 0 && (
            <span style={{ color: "var(--text-muted)" }}>— last alert {fmtDate(rows[0].date)}</span>
          )}
        </>
      )}
    </button>
  );
}

export default function AppShell() {
  const { tab: slug } = useParams();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { isMobile, isNarrow } = useBreakpoint();
  const regime = useRegimeLatest();
  const freshness = useFreshness();

  // Cmd+K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const tab = tabBySlug(slug);
  const isMethodology = slug === METHODOLOGY_SLUG;

  // The wordmark dot pulses only when data is genuinely live — the EODHD
  // stream first (ticks under a minute old), else a fresh DB intraday write.
  // Pretending month-old data is live is the app's documented worst habit.
  const streamLive = useStreamLive();
  const intradayFresh = useMemo(() => {
    const ts = freshness.data?.market_intraday_ts;
    if (!ts) return false;
    return daysSince(ts) * 24 * 60 < 20;
  }, [freshness.data?.market_intraday_ts]);
  const dotLive = streamLive || intradayFresh;

  // What the assistant is told the visitor is looking at — the route slug plus
  // the section list from the nav registry, so "explain this tab" has an anchor.
  const tabContext = useMemo<AssistantTabContext>(
    () =>
      isMethodology
        ? { tab: METHODOLOGY_SLUG, label: "Methodology", sections: [] }
        : {
            tab: tab?.slug ?? "dashboard",
            label: tab?.label ?? "Dashboard",
            sections: (tab?.sections ?? []).map((s) => s.label),
          },
    [isMethodology, tab],
  );

  const probs = regime.data
    ? {
        goldilocks: regime.data.prob_goldilocks ?? 0,
        overheating: regime.data.prob_overheating ?? 0,
        stagflation: regime.data.prob_stagflation ?? 0,
        recession: regime.data.prob_recession ?? 0,
      }
    : undefined;
  // Header badge shows the model's stored dominant probability (one number,
  // one truth) — not the separate `confidence` heuristic.
  const dominantProb = probs ? Math.max(...Object.values(probs)) : undefined;

  if (!tab && !isMethodology) return <Navigate to="/app/dashboard" replace />;

  const f = freshness.data;
  // One page gutter, shared by the header and main so their columns line up.
  const gutter = isMobile ? 12 : isNarrow ? 14 : 28;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <header style={{ padding: `18px ${gutter}px 0` }}>
        {/* Below 768 the two header columns stack: wordmark + ticker, then the
            regime block full-width. Above it, the desk row is unchanged. */}
        <div
          style={{
            display: "flex",
            flexDirection: isNarrow ? "column" : "row",
            alignItems: isNarrow ? "stretch" : "flex-start",
            justifyContent: "space-between",
            gap: isNarrow ? 14 : 24,
          }}
        >
          <div>
            <Link
              to="/"
              style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
            >
              <span
                className={dotLive ? "mrr-live-dot" : undefined}
                title={
                  streamLive
                    ? "Live — EODHD stream is ticking"
                    : intradayFresh
                      ? "Intraday feed is current"
                      : "Feeds idle — outside market hours or awaiting refresh"
                }
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: dotLive ? "var(--accent)" : "var(--text-faint)",
                }}
              />
              {/* The wordmark is the page's only <h1> — the app renders no other
                  heading above h2 (SectionHeader emits h2/h3). `margin: 0` pins
                  away the UA h1 margin-block; font-size/weight are already set. */}
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--text)",
                  margin: 0,
                }}
              >
                Macro Regime Radar
              </h1>
            </Link>
            <TickerLive />
          </div>

          <div
            style={
              isNarrow
                ? { textAlign: "left" } // full-width block; the 250px floor would only force overflow
                : { textAlign: "right", minWidth: 250 }
            }
          >
            {regime.data ? (
              <RegimeBadge label={regime.data.label} size="sm" confidence={dominantProb} />
            ) : (
              <span style={mono("var(--fs-body-s)", "var(--text-muted)")}>
                {regime.isError ? "Regime unavailable — API error" : "Regime —"}
              </span>
            )}
            <div style={{ marginTop: 8 }}>
              {probs && <ProbabilityBar probs={probs} height={5} />}
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: isNarrow ? "flex-start" : "flex-end",
                alignItems: "center",
                flexWrap: isNarrow ? "wrap" : "nowrap",
                gap: 12,
              }}
            >
              <AlertsTrigger onOpen={() => setDrawerOpen(true)} touch={isNarrow} />
              <Link
                to={`/app/${METHODOLOGY_SLUG}`}
                style={{
                  ...mono("var(--fs-meta)", "var(--text-muted)"),
                  letterSpacing: "var(--ls-micro)",
                  textTransform: "uppercase",
                }}
              >
                Methodology
              </Link>
              <button
                onClick={() => setPaletteOpen(true)}
                // The accessible name contains the visible "⌘K" — WCAG 2.5.3
                // label-in-name, so a voice user can say what they can see.
                aria-label="⌘K — open command palette"
                title="Jump to any tab or section — ⌘K (Mac) / Ctrl+K"
                style={{
                  appearance: "none",
                  background: "none",
                  border: "0.5px solid var(--line-hair)",
                  borderRadius: "var(--r-xs)",
                  cursor: "pointer",
                  padding: isNarrow ? "6px 10px" : "3px 8px",
                  ...(isNarrow ? { minHeight: 32 } : null),
                  ...mono("var(--fs-meta)", "var(--text-muted)"),
                  letterSpacing: "var(--ls-micro)",
                }}
              >
                ⌘K
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <TabBar
            tabs={TABS.map((t) => ({ id: t.slug, label: t.label }))}
            active={isMethodology ? "" : (tab?.slug ?? "")}
            onChange={(id: string) => navigate(`/app/${id}`)}
            touch={isNarrow}
          />
        </div>
      </header>

      {/* The 90px floor is the assistant launcher's clearance (fixed, bottom:20)
          — it holds at every width, so the last card never sits under it. */}
      <main style={{ padding: `14px ${gutter}px 90px` }}>
        <div
          style={{
            display: "flex",
            flexDirection: isNarrow ? "column" : "row",
            justifyContent: "space-between",
            gap: isNarrow ? 4 : 20,
            marginBottom: 12,
            letterSpacing: ".06em",
            ...mono(10, "var(--text-muted)"),
          }}
        >
          <span>
            {f
              ? `Macro data as of ${f.regimes_date ? fmtMonYr(f.regimes_date) : "—"} · Signals ${
                  f.signals_date ? fmtMonYr(f.signals_date) : "—"
                } · Market data through ${f.market_daily_date ? fmtDate(f.market_daily_date) : "—"}`
              : freshness.isError
                ? "Freshness unavailable — API error"
                : "Freshness —"}
          </span>
          <span style={{ whiteSpace: isNarrow ? "normal" : "nowrap" }}>
            {f?.market_intraday_ts ? `Stored intraday to ${fmtIntradayTs(f.market_intraday_ts)}` : ""}
            {/* The stored stamps lag the live tape by design — say so, or the
                freshness line reads stale next to ticking rows (critique). */}
            {streamLive ? " · live tape ticking via stream" : ""}
          </span>
        </div>

        {isMethodology ? (
          <MethodologyScreen />
        ) : tab?.slug === "dashboard" ? (
          <DashboardScreen />
        ) : tab?.slug === "markets" ? (
          <MarketsScreen />
        ) : tab?.slug === "regime-lab" ? (
          <RegimeLabScreen />
        ) : tab?.slug === "credit" ? (
          <CreditScreen />
        ) : tab?.slug === "recession" ? (
          <RecessionScreen />
        ) : tab?.slug === "news" ? (
          <NewsScreen />
        ) : tab?.slug === "tools" ? (
          <ToolsScreen />
        ) : null}
      </main>

      <AlertDrawer open={drawerOpen} onClose={closeDrawer} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      {/* Floating assistant — app shell only; the landing page stays quiet. */}
      <AssistantPanel tabContext={tabContext} />
    </div>
  );
}
