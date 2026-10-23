---
paths:
  - "dashboard/**"
  - ".streamlit/**"
  - "requirements.txt"
---

> Moved verbatim from `CLAUDE.md` on 2026-10-22 (path-scoped so it loads only when a session touches matching files). Verify a claim against the code before relying on it.

These rules are for the legacy Streamlit app only (11 tabs; names live in `dashboard/app.py`, around line 893). The React app's design contract is `web/DESIGN.md` (different tokens and fonts).

## Bloomberg Design System

Dark theme only. No alternative palettes.

| Token | Value |
|---|---|
| Background | `#0d1117` |
| Card background | `#161b22` |
| Borders | `#30363d` |
| Accent blue | `#4a9eff` |

- Use `streamlit.components.v1.html()` for all styled cards (see Streamlit Constraints for why).
- Sparklines on numeric metric cards where time series supports it.
- Monospace for numeric values; small uppercase labels above large values.

## Streamlit Constraints (Hard-Won)

1. **HTML sanitizer strips CSS from `st.markdown` even with `unsafe_allow_html=True`.** For any styled card, use `streamlit.components.v1.html(html_string, height=...)`. Reserve `st.markdown` for plain markdown only.
2. **Caching:** `@st.cache_resource` for scikit-learn estimators, fitted pipelines, and other model objects. `@st.cache_data` for DataFrames, arrays, dicts. Mixing these causes pickling errors or silently stale models.
3. **DataFrames:** pass `width="stretch"` (the new syntax replacing deprecated `use_container_width=True`).
4. **Pandas:** use `df.loc[mask, col] = value`. Never use chained indexing `df[col][mask] = value` — raises `ChainedAssignmentError` in modern pandas.
5. **Fragments:** scope `st.fragment(run_every=N)` narrowly. Wrapping a whole tab in a fragment causes session state issues. Example: the Events & Intelligence two-column feed (`_render_feed` in `events_tab.py`) is a fragment, and headline clicks call `st.rerun(scope="fragment")` so selecting an article re-renders only the feed — not the summary-bar / calendar `components.html` iframes. That full-tab rerun was the source of click latency.

### Streamlit-only items from the old "What NOT to Do" list

- Do not use `st.markdown()` for styled HTML cards — use `streamlit.components.v1.html()`.
- Do not change the Bloomberg dark aesthetic.
- Do not use `@st.cache_data` on scikit-learn model objects — use `@st.cache_resource`.
