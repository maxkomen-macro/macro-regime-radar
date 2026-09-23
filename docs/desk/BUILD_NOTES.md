# Build Notes

## What this is

John sent a mock of an analyst workspace and asked how I'd approach building it. The mock ran on synthetic data. I decided the interesting version wasn't a copy of the screens; it was making the two questions he raised in our conversation answerable on live data, inside the macro dashboard I already run, and building the rest of the workspace around that. So Desk is a section of Macro Regime Radar, not a separate app. It shares the same data pipeline, the same regime classifier, and the same design system, and every panel says where its numbers come from.

The two questions were: what happens to equities after gold moves two standard deviations while stocks are already weak, and whether the S&P's 50/200-day cross carries a signal worth acting on. The event study engine answers the first and generalizes it; the same machinery scores the second.

The other thing I took seriously was the House Discipline box in his mock. Variant view first, pre-mortem before defense, falsification required, calibrated language only. Instead of printing it in a corner, Desk enforces it: a position can't be saved without a variant view, a pre-mortem, and a numeric level that would prove the idea wrong, and the language check blocks words the data hasn't earned.

## What is live and what is designed

Live, on pipeline data, as of the date shown on each panel: the conditional event study and its presets, the 50/200 cross study, the S&P Internals page built on it, the Position Monitor and its discipline gate, the Data Pipeline page, the Today strip, and the Desk/Client toggle.

Designed, with real layouts and no numbers: Basket Builder, Hedge Simulator, Red Team, Pitch Evaluation, Launchpad, and the breadth and sector-rotation panels inside Internals. Each says what it will read once it's wired.

What the engine says about John's setup: gold up two sigma over 20 sessions with the S&P below its 50-day has happened 18 times since 2000. A month later the S&P's median move was about 1.8 points better than baseline, so it leans positive, but the 90% interval includes zero at every horizon. Suggestive, not established. The cross study is the more interesting result: the golden cross at 20 sessions and the death cross at 60 both clear the bar the engine sets for an established read. The live page carries the numbers; I don't repeat them here because they refresh nightly.

How the numbers were checked: the engine's own verifier, then three independent review rounds by a second model that had not seen the code. Twenty-four findings, every one pinned by a test. The gold read did not change through any of it. The findings that would have embarrassed me in a room are in the report: rows counted as sessions, a baseline that entered on a different day than the events, intervals that overstated independence when forward windows overlapped.

Honest caveats on the live data. Gold history runs from August 2000, because the free LBMA fixing series was withdrawn from FRED and the futures series is what's available. High-yield spreads run from September 2023, because FRED now serves only a rolling three-year window for the ICE BofA indices. Any study on those series says so in its verdict. The regime labels start in 1996; events before that are reported as unlabeled rather than dropped.

## Architecture

React and TypeScript on the front end, FastAPI and SQLite behind it. Daily and monthly series come from FRED, Yahoo Finance, and EODHD through a GitHub Actions refresh that runs overnight; the server process never calls a market data vendor itself. Every read goes through one pinned data generation, so a number on screen is never recomputed in the browser.

The regime label is a rules-based classifier, not a trained model. It takes the three-month trend in industrial production and CPI and maps the sign pair into four states: Goldilocks, Overheating, Stagflation, Recession Risk. It's monthly and the inputs publish with a lag, so anything daily that conditions on it uses the label from two months earlier to avoid look-ahead, and historical labels reflect revised data.

The recession probability is a model: a logistic regression on five monthly indicators lagged three months, fit against NBER recession dates. It's the only number in Desk I call a model.

The event study engine reads the daily store, computes shocks in the right unit for each asset (log returns for prices, basis points for yields and spreads), applies a cooldown so overlapping events aren't double-counted, and scores forward returns against an unconditional baseline with a bootstrapped interval. Presets are precomputed by the worker; free-form queries run on request behind the existing compute limit.

## Pre-mortem of this tool

If someone used Desk for a month and it led them wrong, the most likely reasons, in order:

1. Small samples read as signal. Forty events since 2000 is enough to see a tilt, not enough to trust a hit rate to the percentage point. The intervals are on screen for a reason; the verdict text is written from them, not from the medians.
2. The regime split flatters the past. Labels are rebuilt from revised data on every run, so a 1998 event carries a 2026 view of 1998. The lag fixes look-ahead; it doesn't fix hindsight.
3. Data gaps that look like history. Gold from 2000 and HY from 2023 are stated, but a reader who skips the caveat will compare them to series that run from 1990.
4. It's one desk's data. No intraday, no options surfaces, no positioning. A hedge simulator built on this would be a sketch until it has a vol surface behind it.

## First 90 days on the desk

The co-op's work is cleaning price and index-construction data into Snowflake. Building this taught me what that pipeline actually needs: a raw layer that's never edited, a curated layer with one row per series and date and an as-of stamp on every value, and a mart that's rebuilt rather than patched so every number is reproducible. The Data Pipeline page in Desk is that shape on SQLite. The first 90 days would be moving the index-construction inputs through that same three-layer pattern, with the freshness and gap checks I had to write for this build, so the desk gets numbers with provenance attached instead of spreadsheets with a date in the filename.
