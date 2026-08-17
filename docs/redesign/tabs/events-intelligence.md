# Events & Intelligence

Screenshot: [events-intelligence.png](../screenshots/events-intelligence.png) · `events_tab.py::render_events_tab()` (wired `app.py:1464-1469`).

## Elements (top → bottom)
1. Intelligence Summary Bar (iframe, 90px) — 5 stat cards: HEADLINES / HIGH IMPACT / M&A DEALS / MACRO-FED / GEOPOLITICAL, all **0** in the capture (counts of the *filtered* `news_feed` df, `events_tab.py:514-543`)
2. Filter bar — category pills ALL/MACRO/M&A/EARN/GEO/SECTOR + time pills 24H/48H/7D + ↻ refresh (native buttons)
3. Two-column feed (`@st.fragment`; headline clicks rerun fragment-only) — left: 600px headline list with significance number, category badge, tier-colored source, LIVE pulse when <1h fresh; right: detail card with significance /5.0 + 5 per-dimension score iframes (MARKET/DEAL SIZE/SECTOR/TIMELINESS/REGIME dots), optional REGIME READ (`regime_interpretation`) and ◆ PERPLEXITY RESEARCH (`perplexity_research`, uncapped length) (`news_feed`)
   - **Captured state: `_empty_state()` — "No headlines loaded yet / Run the Refresh News Feed step…"**
4. UPCOMING MACRO EVENTS · next 30 days (iframe) — date/countdown, event, priority dot, source (`event_calendar` via `get_upcoming_events`)
   - **Captured state: "No upcoming events in the next 30 days"**

## Unlabeled
- Headline-row significance number ("3.8") floats bare; only the detail card reveals it's /5.0.
- "DEAL SIZE 3/5" renders for non-M&A headlines with no explanation (field doubles as $-bucket for M&A only).
- Source-credibility tiers exist only as font-weight/color differences — no legend.
- Priority dot colors (high/med/low) — no legend. Dots duplicate the numeric scores above them.
- Summary-bar counts are silently scoped to the active filter/time window, not table totals.

## Text walls
Static copy is fine; the risk is unbounded AI text — `regime_interpretation` and `perplexity_research` render with **no truncation or scroll cap**, so a verbose enrichment produces the tallest column in the app.

## Stale
- **The defining failure**: `load_news()` filters `published_at >= now − 24/48/168h` (`events_tab.py:346-353`). `news_feed` stops at **2026-07-08** (stale-pipeline), so every window is empty and the whole tab renders zeros + empty states. A month of 3,715 stored articles is invisible. Same on the live app until ingest resumes — recency filters with no "show latest anyway" fallback turn pipeline lag into an apparently dead product.
- Calendar empty: `event_calendar` max 2026-06-18 (stale-pipeline, manual CSV source).
- DB-open failure and genuinely-empty table render identically (both swallowed to empty df).

## Scroll
1085px ÷ 900px = 1.2× — OK (only because it's empty; a populated feed + uncapped research text grows well past this).

## Overlap
Name collides with the "Intelligence" tab, which shares zero data (this tab = `news_feed`+`event_calendar`; that one = regime analytics). Upcoming-events also on Dashboard (7-day window). Headlines resurface via the chat FAB's `get_recent_headlines`.

## Verdict
**Keep the feed, rename the tab, fix the empty-state trap**: this is Phase 11's flagship feature and currently the single worst recruiter impression in the app (five zeros and two apology cards); it needs a latest-available fallback and a name that doesn't collide with Intelligence.
