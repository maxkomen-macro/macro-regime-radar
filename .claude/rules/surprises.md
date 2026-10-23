# Surprise metrics (src/analytics/surprise.py)

- The VIX, DGS10, DGS2 and SPREAD weekly rows and the three daily moves are built from daily stores (^VIX in `asset_prices`, DGS10/DGS2 in `desk_series`), never from month-stamped `raw_series`.
- A daily-sourced observation is kept only with a canonical `YYYY-MM-DD` date inside `SUPPORTED_DATES` (`src/analytics/surprise_dates.py`) on a session of its calendar: NYSE for the VIX, the bond calendar plus `TREASURY_EXTRA_SESSIONS` for the yields (pinned against the stored series by `tests/test_surprise_provenance.py`). A one-day move spans exactly one session; a weekly change compares consecutive W-FRI weeks; the spread uses dates both legs have.
- The computation writes the date each row read: `<raw metric>_obs` beside every weekly row (ETF returns included) and `<SERIES>_daily_newest`. `api/db` serves `as_of` from these and never re-derives it from the stores; a daily row ranks only when it is the newest session's move.
- `z_interpretation` (`src/utils/format.py`) takes the direction word from the raw move, never from z alone; every reader (API, dashboard, weekly memo) passes the raw value at the z row's own date.
- VIX alerts need a positive raw move at the z row's date; `VIX_shock` is dated by `VIX_weekly_chg_obs`, never by the W-FRI bucket.
- `CPI_yoy` compares each monthly print with the same month a year earlier (`cpi_yoy_weekly`) and carries it through the weeks; never `pct_change(periods=52)` of the weekly level, which compared different months at month boundaries (Codex S-09).
- `CPI_yoy_newest` marks the week carrying the newest CPI print; the API, the weekly memo, the Streamlit surprise panels and the playbook skip a CPI row dated earlier (an older print's YoY when the newest has no year-earlier month, Codex S-12).
- The playbook's z-score sentences name the reading's week ("in the latest reading (week of <date>, z=…)"), never "today" (Codex S-14).
