---
paths:
  - "web/src/fixtures/**"
  - "tests/fixtures/**"
  - "docs/desk/shots/**"
  - "web/e2e/**"
  - "scripts/*fixture*"
---

**New committed test data uses invented prices, never real third-party market data** (owner decision, 2026-11-04). The repo is public, and committing real Yahoo, EODHD, Polygon/Massive or ICE values (or news text) republishes data whose terms bar redistribution; git history keeps it forever. Build new fixtures, captured answers and screenshots' JSON from a synthetic series with the shape you need, as the Options Finder fixture does (an invented $100 stock, `SYN`, "Not market data"). Tests that read the downloaded database at run time are fine: nothing real is committed. Existing real-price fixtures stay as they are until the owner decides otherwise; don't add to them.
