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
import { METHODOLOGY_SLUG, TABS, tabBySlug } from "./sections";
import AlertDrawer from "./AlertDrawer";
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

function AlertsTrigger({ onOpen }: { onOpen: () => void }) {
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
        padding: "3px 8px",
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <header style={{ padding: "18px 28px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
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
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--text)",
                }}
              >
                Macro Regime Radar
              </span>
            </Link>
            <TickerLive />
          </div>

          <div style={{ textAlign: "right", minWidth: 250 }}>
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
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 12,
              }}
            >
              <AlertsTrigger onOpen={() => setDrawerOpen(true)} />
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
                aria-label="Open command palette"
                title="Jump to any tab or section — ⌘K (Mac) / Ctrl+K"
                style={{
                  appearance: "none",
                  background: "none",
                  border: "0.5px solid var(--line-hair)",
                  borderRadius: "var(--r-xs)",
                  cursor: "pointer",
                  padding: "3px 8px",
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
          />
        </div>
      </header>

      <main style={{ padding: "14px 28px 90px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 20,
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
          <span style={{ whiteSpace: "nowrap" }}>
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
    </div>
  );
}
