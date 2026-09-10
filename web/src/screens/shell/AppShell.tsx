/**
 * The terminal shell — locked-IA header spec, wired to real API data:
 * wordmark + live dot (pulses only when intraday data is actually fresh),
 * ticker strip, regime badge + probability bar (/api/regime/latest), 7-tab
 * routing with the active tab in the URL, alerts trigger + drawer
 * (/api/alerts) with the all-clear state, Methodology as a persistent link,
 * Cmd+K palette, and the data-freshness line (/api/freshness).
 *
 * 2026-09-05 (executive pass): the header is three rows with one job each —
 * identity + regime + actions (alerts, analyst, ⌘K), then primary navigation
 * (links carrying aria-current, Methodology among them), then one freshness
 * sentence that reconciles the monthly macro read with the daily market
 * overlay. Content sits in a centered 1520px frame; the page behind an open
 * overlay is inert; top-level navigation resets scroll unless the URL carries
 * an anchor. Below 1024 the header stacks; below 768 the navigation collapses
 * to a disclosure list of every destination. The analyst launcher lives in
 * the header so it never covers data, sliders or buttons.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ProbabilityBar, RegimeBadge } from "../../components";
import { useAlerts, useFreshness, useRegimeLatest } from "../../api/queries";
import { daysSince, fmtDate, fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { METHODOLOGY_SLUG, TABS, tabBySlug } from "./sections";
import AlertDrawer from "./AlertDrawer";
import AssistantPanel, { type AssistantTabContext } from "./AssistantPanel";
import CommandPalette from "./CommandPalette";
import MobileNav from "./MobileNav";
import TickerLive from "./TickerLive";
import ErrorBoundary from "../shared/ErrorBoundary";
import { useLiveFeeds, useStreamLive, useStreamStatus, useStreamWord } from "../../live/quotes";
import { useSnapshotMeta } from "../../api/snapshot";
import { assessFreshness, freshColor, impactSentence, type FreshInfo } from "../shared/freshness";
import { SHELL_CONTENT_ID } from "../shared/useModal";
import { mono } from "../shared/screen-ui";

// Route-level code splitting (2026-09-06): each screen is its own chunk, so
// the shell paints first and a screen's libraries load only when it opens.
const DashboardScreen = lazy(() => import("../dashboard/DashboardScreen"));
const MarketsScreen = lazy(() => import("../markets/MarketsScreen"));
const RegimeLabScreen = lazy(() => import("../regimelab/RegimeLabScreen"));
const CreditScreen = lazy(() => import("../credit/CreditScreen"));
const RecessionScreen = lazy(() => import("../recession/RecessionScreen"));
const NewsScreen = lazy(() => import("../news/NewsScreen"));
const ToolsScreen = lazy(() => import("../tools/ToolsScreen"));
const MethodologyScreen = lazy(() => import("../methodology/MethodologyScreen"));

/** Relay degradation in reader words; the raw reasons stay in /api/stream/debug. */
function degradedReason(reasons: string[]): string | null {
  const text = reasons.join(" ").toLowerCase();
  if (!text) return null;
  if (text.includes("rejected the token")) return "US equity feed rejected by the provider";
  if (text.includes("not configured")) return "live feeds off";
  if (text.includes("silent")) return "US equity feed silent";
  if (text.includes("closed during") || text.includes("connecting during")) return "US equity feed reconnecting";
  if (text.includes("vix")) return "VIX poll failing";
  return "a feed is degraded";
}

/** "a", "a and b", "a, b and c". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ScreenLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: "24px 0", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
      Loading {label}…
    </div>
  );
}

const STATUS_GLYPH: Record<string, string> = { Live: "●", Delayed: "▪", Reconnecting: "↻", "Backend unavailable": "×", Off: "▪", "Validated snapshot": "◆" };

function AlertsTrigger({ onOpen, open = false, touch = false, compact = false }: { onOpen: () => void; open?: boolean; touch?: boolean; compact?: boolean }) {
  const alerts = useAlerts(200);
  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= 7);
  const worst = recent.some((a) => a.level === "risk")
    ? "var(--neg-text)"
    : recent.some((a) => a.level === "watch")
      ? "var(--warn)"
      : "var(--accent)";
  const last = rows[0];
  const title = recent.length
    ? `${recent.length} threshold breach${recent.length === 1 ? "" : "es"} in the last 7 days. Open the alert feed.`
    : last
      ? `No threshold breaches in the last 7 days. Last alert ${fmtDate(last.date)}. Open the alert feed.`
      : "No alerts on file. Open the alert feed.";

  if (alerts.isLoading || alerts.isError) {
    // Never assert "no alerts" before the feed has answered (2026-09-05).
    const word = alerts.isError ? "unavailable" : "reading…";
    return (
      <button
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={alerts.isError ? "Alert feed unavailable. Open the alert feed." : "Reading the alert feed. Open the alert feed."}
        className="mrr-chip-btn"
        data-touch={touch ? "true" : "false"}
        style={{ color: alerts.isError ? "var(--warn-hot)" : "var(--text-muted)" }}
      >
        Alerts · {word}
      </button>
    );
  }
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={title}
      title={title}
      className="mrr-chip-btn"
      data-touch={touch ? "true" : "false"}
      style={{ color: recent.length ? worst : "var(--pos)" }}
    >
      {recent.length ? (
        <>
          <span aria-hidden="true">●</span> {recent.length} alert{recent.length === 1 ? "" : "s"}
          {compact ? "" : " · 7d"}
        </>
      ) : (
        <>
          <span aria-hidden="true">✓</span> {compact ? "Alerts" : "No alerts · 7d"}
          {!compact && !touch && last ? (
            <span style={{ color: "var(--text-muted)" }}>· last {fmtDate(last.date)}</span>
          ) : null}
        </>
      )}
    </button>
  );
}

function PaletteTrigger({ onOpen, open = false, touch = false }: { onOpen: () => void; open?: boolean; touch?: boolean }) {
  return (
    <button
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      // The accessible name contains the visible "⌘K" — WCAG 2.5.3
      // label-in-name, so a voice user can say what they can see.
      aria-label="⌘K · jump to any tab or section"
      title="Jump to any tab or section · ⌘K (Mac) / Ctrl+K"
      className="mrr-chip-btn"
      data-touch={touch ? "true" : "false"}
      style={{ color: "var(--text-muted)" }}
    >
      {/* The command glyph lives in the system face: Plex Mono has no ⌘. */}
      <span style={{ fontFamily: "system-ui, -apple-system, sans-serif" }} aria-hidden="true">
        ⌘
      </span>
      K
    </button>
  );
}

function FreshWord({ info, noun }: { info: FreshInfo; noun: string }) {
  const color = freshColor(info.state);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--text-muted)" }}>{noun} </span>
      <span style={{ color: "var(--text-2)" }}>{info.stamp || "—"}</span>{" "}
      <span style={{ color }}>
        {info.state === "current" ? "current" : info.state === "unavailable" ? "unavailable" : `${info.age} old`}
      </span>
    </span>
  );
}

export default function AppShell() {
  const { tab: slug } = useParams();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantLauncherRef = useRef<HTMLButtonElement>(null);

  const { isMobile, isNarrow, bp } = useBreakpoint();
  const isWide = bp === "wide";
  const isCompact = !isWide; // <1024: header stacks into rows
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

  // Top-level navigation starts at the top of the new screen; an explicit
  // anchor (#section) is honoured by the screens' own hash-scroll effect.
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.hash]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    assistantLauncherRef.current?.focus();
  }, []);

  const tab = tabBySlug(slug);
  const isMethodology = slug === METHODOLOGY_SLUG;
  const activeSlug = isMethodology ? METHODOLOGY_SLUG : (tab?.slug ?? "dashboard");

  // The wordmark dot pulses only when data is genuinely live — the EODHD
  // stream first (ticks under a minute old), else a fresh DB intraday write.
  // Pretending month-old data is live is the app's documented worst habit.
  const streamLive = useStreamLive();
  const streamWord = useStreamWord();
  const liveFeeds = useLiveFeeds();
  const stream = useStreamStatus();
  const snapshot = useSnapshotMeta();

  // Tabs, history and screen readers get the screen's name (review P3-8).
  useEffect(() => {
    const label = isMethodology ? "Methodology" : (tab?.label ?? "Dashboard");
    document.title = `${label} · Macro Regime Radar`;
  }, [isMethodology, tab?.label]);
  const intradayFresh = useMemo(() => {
    const ts = freshness.data?.market_intraday_ts;
    if (!ts) return false;
    return daysSince(ts) * 24 * 60 < 20;
  }, [freshness.data?.market_intraday_ts]);
  const dotLive = streamLive || intradayFresh;

  const f = freshness.data;
  // The one status word (2026-09-06). The API answering is the primary
  // signal; the relay socket refines it. When the API is silent and the
  // page runs on the validated snapshot, say exactly that.
  const backendDown = freshness.isError && regime.isError;
  const statusWord: string = backendDown
    ? snapshot
      ? "Validated snapshot"
      : "Backend unavailable"
    : streamWord === "Backend unavailable" && f
      ? "Delayed"
      : streamWord === "Off"
        ? "Delayed"
        : streamWord;
  const statusColor =
    statusWord === "Live" ? "var(--pos)" : statusWord === "Delayed" || statusWord === "Validated snapshot" ? "var(--warn)" : statusWord === "Reconnecting" ? "var(--text-2)" : "var(--neg-text)";
  const statusTitle =
    statusWord === "Live"
      ? "EODHD stream is ticking on the tape"
      : statusWord === "Delayed"
        ? "Quotes are delayed REST rows or the last close; stored data is current"
        : statusWord === "Reconnecting"
          ? "The live relay dropped; the browser is retrying with backoff"
          : statusWord === "Validated snapshot"
            ? `The data service is not answering; every number on screen comes from the validated snapshot built ${snapshot?.generated_at ?? ""}`
            : "The data service is not answering";
  const macroFresh = assessFreshness(f?.regimes_date, "monthly");
  const signalsFresh = assessFreshness(f?.signals_date, "monthly");
  const marketFresh = assessFreshness(f?.market_daily_date, "daily");
  const intradayFreshInfo = assessFreshness(f?.market_intraday_ts, "intraday");

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

  // What the assistant is told the visitor is looking at — the route, the
  // section list from the nav registry, and the shell's own headline numbers,
  // so "explain this screen" is grounded in what is actually on screen.
  const tabContext = useMemo<AssistantTabContext>(() => {
    const base = isMethodology
      ? { tab: METHODOLOGY_SLUG, label: "Methodology", sections: [] as string[], kind: "reference" as const }
      : {
          tab: tab?.slug ?? "dashboard",
          label: tab?.label ?? "Dashboard",
          sections: (tab?.sections ?? []).map((s) => s.label),
          kind: "live" as const,
        };
    return {
      ...base,
      route: `${location.pathname}${location.hash}`,
      active_section: location.hash ? location.hash.slice(1) : null,
      as_of: {
        macro: f?.regimes_date ?? null,
        signals: f?.signals_date ?? null,
        market_daily: f?.market_daily_date ?? null,
        market_intraday: f?.market_intraday_ts ?? null,
      },
      key_metrics: (regime.data
        ? {
            regime: regime.data.label,
            dominant_probability: dominantProb ?? null,
            confidence: regime.data.confidence,
            regime_date: regime.data.date,
          }
        : {}) as Record<string, string | number | null>,
    };
  }, [isMethodology, tab, location.pathname, location.hash, f, regime.data, dominantProb]);

  if (!tab && !isMethodology) return <Navigate to="/app/dashboard" replace />;

  // One page gutter, shared by the header and main so their columns line up.
  const gutter = isMobile ? 12 : isNarrow ? 16 : 28;

  // "Live" names its feeds when the US tape is quiet: crypto and FX tick
  // through the weekend, and a reader must never take that for US equities.
  // A degraded relay says why in reader words (review P2-3), never a
  // machine state.
  const degradedWord = stream.degraded ? degradedReason(stream.degradedReasons) : null;
  const liveSuffix =
    statusWord === "Live" && !liveFeeds.us
      ? ` · ${[liveFeeds.crypto ? "crypto" : null, liveFeeds.forex ? "FX" : null].filter(Boolean).join("/")} only${
          degradedWord ? ` · ${degradedWord}` : f?.session && !f.session.is_open ? " · US session closed" : ""
        }`
      : (statusWord === "Live" || statusWord === "Delayed") && degradedWord
        ? ` · ${degradedWord}`
        : "";
  const statusChip = (
    <span title={statusTitle} style={{ color: statusColor, whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{STATUS_GLYPH[statusWord] ?? "▪"}</span> {statusWord}
      {liveSuffix}
      {statusWord === "Validated snapshot" && snapshot?.generated_at ? ` · ${fmtDate(snapshot.generated_at)}` : ""}
    </span>
  );
  // Blockers from the server-side freshness report replace the generic
  // "one cycle late" phrasing when they exist: the reader learns which
  // input holds the regime month back and why.
  const blockerNote = f?.regime?.blockers?.length
    ? `Regime month ${f.regime.latest_month ? fmtMonYr(f.regime.latest_month) : "—"} waits on ${listWords(
        f.regime.blockers.map((b) => `${b.label} (${b.cause === "publication calendar" ? "not yet published" : "published, not yet stored"})`),
      )}.`
    : null;
  // Signals ride the same monthly stamp as the regime; print them only when
  // they differ, so the line never says the same date twice.
  const signalsDiffer = f?.signals_date && f?.regimes_date && f.signals_date.slice(0, 7) !== f.regimes_date.slice(0, 7);

  // The snapshot explanation travels to every width: a visitor on a phone
  // must not meet "Validated snapshot" with no sentence (review P3-15).
  const snapshotNote =
    statusWord === "Validated snapshot" ? (
      <span style={{ color: "var(--text-2)", flexBasis: "100%" }}>
        The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own.
      </span>
    ) : null;

  const statusLine = f ? (
    isMobile ? (
      <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
        {statusChip}
        <FreshWord noun="Macro" info={macroFresh} />
        <FreshWord noun="Market" info={marketFresh} />
        {snapshotNote}
      </span>
    ) : isCompact ? (
      // Tablet: the dated words carry the whole message; the sentence
      // returns at desk width where it has a line of its own.
      <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {statusChip}
        <FreshWord noun="Macro" info={macroFresh} />
        {signalsDiffer ? <FreshWord noun="Signals" info={signalsFresh} /> : null}
        <FreshWord noun="Market" info={marketFresh} />
        {snapshotNote}
      </span>
    ) : (
      <>
        <span style={{ color: "var(--text-2)" }}>
          {statusWord === "Validated snapshot"
            ? `The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own. ${impactSentence(macroFresh, marketFresh, false)}`
            : blockerNote ?? impactSentence(macroFresh, marketFresh, streamLive)}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", justifyContent: isWide ? "flex-end" : "flex-start" }}>
          {statusChip}
          <FreshWord noun="Macro" info={macroFresh} />
          {signalsDiffer ? <FreshWord noun="Signals" info={signalsFresh} /> : null}
          <FreshWord noun="Market" info={marketFresh} />
          {f.market_intraday_ts ? <FreshWord noun="Intraday" info={intradayFreshInfo} /> : null}
        </span>
      </>
    )
  ) : (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
      {freshness.isError ? statusChip : null}
      <span>{freshness.isError ? "The data service did not answer; stored screens stay readable and this line retries." : "Reading freshness…"}</span>
    </span>
  );

  const analystChip = (
    <button
      ref={assistantLauncherRef}
      onClick={() => (assistantOpen ? closeAssistant() : setAssistantOpen(true))}
      aria-expanded={assistantOpen}
      aria-controls="assistant-panel"
      title="Ask the analyst about the data on this screen"
      className="mrr-chip-btn"
      data-touch={isNarrow ? "true" : "false"}
      style={{ color: assistantOpen ? "var(--text)" : "var(--text-2)", borderColor: assistantOpen ? "var(--accent-line)" : undefined }}
    >
      <span aria-hidden="true" style={{ color: "var(--accent)" }}>
        ◆
      </span>
      {isMobile ? "AI" : "AI Analyst"}
    </button>
  );

  const regimeChip = regime.data ? (
    <span
      title={`Current regime: ${regime.data.label} at ${Math.round((dominantProb ?? 0) * 100)}% model odds · macro data ${fmtMonYr(regime.data.date)}`}
    >
      <RegimeBadge label={regime.data.label} size="sm" confidence={dominantProb} />
    </span>
  ) : (
    <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}>
      {regime.isError ? "Regime unavailable: API error" : "Reading regime…"}
    </span>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <a href="#main-content" className="mrr-skip">
        Skip to content
      </a>
      <div id={SHELL_CONTENT_ID}>
        <header style={{ borderBottom: "0.5px solid var(--line-hair)" }}>
          <div className="mrr-frame" style={{ padding: `${isMobile ? 10 : 14}px ${gutter}px 0` }}>
            {/* Row 1: identity on the left, regime + actions on the right. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Link
                to="/"
                title="Macro Regime Radar · landing page"
                style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", minHeight: isNarrow ? 40 : 28 }}
              >
                <span
                  className={dotLive ? "mrr-live-dot" : undefined}
                  title={
                    streamLive
                      ? "Live: EODHD stream is ticking"
                      : intradayFresh
                        ? "Intraday feed is current"
                        : "Feeds idle: outside market hours or awaiting refresh"
                  }
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotLive ? "var(--accent)" : "var(--text-faint)",
                    flexShrink: 0,
                  }}
                />
                {/* The wordmark is the page's only <h1> — the app renders no other
                    heading above h2 (SectionHeader emits h2/h3). */}
                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: isMobile ? 14 : 18,
                    fontWeight: 700,
                    letterSpacing: isMobile ? ".11em" : ".14em",
                    textTransform: "uppercase",
                    color: "var(--text)",
                    margin: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  Macro Regime Radar
                </h1>
              </Link>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {!isMobile ? regimeChip : null}
                <AlertsTrigger onOpen={() => setDrawerOpen(true)} open={drawerOpen} touch={isNarrow} compact={isMobile} />
                {analystChip}
                {!isMobile ? <PaletteTrigger onOpen={openPalette} open={paletteOpen} touch={isNarrow} /> : null}
              </div>
            </div>

            {/* Row 2 (compact only): the tape and the regime block get their own
                line so neither squeezes the other. At desk width the tape sits
                under the wordmark and the bar under the chips. */}
            {isWide ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
                <TickerLive />
                {probs ? (
                  <div style={{ width: 320, minWidth: 0, marginTop: 8 }}>
                    <ProbabilityBar probs={probs} height={5} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {isMobile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>{regimeChip}</div>
                ) : null}
                {!isMobile ? (
                  // Tablet and small laptop: tape and bar share one row so the
                  // header stays under a fifth of the first viewport.
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: isNarrow ? "wrap" : "nowrap" }}>
                    <TickerLive />
                    {probs ? (
                      <div style={{ width: isNarrow ? "100%" : 260, minWidth: 0, marginBottom: 2 }}>
                        <ProbabilityBar probs={probs} height={5} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            {/* Row 3: primary navigation. Links carry aria-current; Methodology is a
                route like the others and sits right, marked as reference. */}
            <div style={{ marginTop: isNarrow ? 10 : 10, paddingBottom: isNarrow ? 10 : 0 }}>
              {isNarrow ? (
                <MobileNav activeSlug={activeSlug} onOpenPalette={openPalette} />
              ) : (
                <nav className="mrr-nav" aria-label="Primary" data-compact={isCompact ? "true" : "false"}>
                  {TABS.map((t) => (
                    <Link key={t.slug} to={`/app/${t.slug}`} aria-current={t.slug === activeSlug ? "page" : undefined}>
                      {t.label}
                    </Link>
                  ))}
                  <Link
                    to={`/app/${METHODOLOGY_SLUG}`}
                    className="mrr-nav-ref"
                    aria-current={isMethodology ? "page" : undefined}
                    title="How the model, signals and data work"
                  >
                    Methodology
                  </Link>
                </nav>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} style={{ outline: "none" }}>
          <div className="mrr-frame" style={{ padding: `${isNarrow ? 8 : 10}px ${gutter}px ${isNarrow ? 56 : 64}px` }}>
            {/* Row 4: one freshness sentence, colour-coded words, dates in every
                stamp. It reconciles the monthly macro read with the daily overlay. */}
            <div
              role="status"
              aria-label="Data freshness"
              style={{
                display: "flex",
                flexDirection: isWide ? "row" : "column",
                justifyContent: "space-between",
                alignItems: isWide ? "baseline" : "flex-start",
                gap: isWide ? 20 : 4,
                marginBottom: 12,
                ...mono,
                fontSize: "var(--fs-meta)",
                lineHeight: 1.5,
                color: "var(--text-muted)",
              }}
            >
              {statusLine}
            </div>

            {/* The key is load-bearing: it re-mounts the boundary on every tab
                change, so a tab that crashed once is retried when the visitor
                navigates away and back rather than staying stuck on the note. */}
            <ErrorBoundary key={activeSlug} label="This tab">
              <Suspense fallback={<ScreenLoading label={isMethodology ? "Methodology" : (tab?.label ?? "the screen")} />}>
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
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        {/* Floating analyst panel — app shell only; the landing page stays quiet.
            It sits inside the inert wrapper so an open drawer or palette covers it. */}
        <ErrorBoundary label="The AI analyst panel">
          <AssistantPanel open={assistantOpen} onClose={closeAssistant} tabContext={tabContext} />
        </ErrorBoundary>
      </div>

      <AlertDrawer open={drawerOpen} onClose={closeDrawer} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
