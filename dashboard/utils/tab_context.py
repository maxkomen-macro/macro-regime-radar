"""dashboard/utils/tab_context.py — Per-tab context registration for the AI Analyst.

Phase 12C. Each tab calls `register_tab_context()` at render time with its
headline metrics; the chat agent's `explain_current_view` tool reads this
back so it can answer "explain what I'm looking at" with real numbers.

Defensive: silently no-ops if Streamlit isn't running (so tab modules remain
importable from non-Streamlit contexts).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def register_tab_context(
    tab_name: str,
    metrics: dict[str, Any],
    kind: str = "live",
) -> None:
    """Write the current tab's identity + headline metrics to session state.

    Parameters
    ----------
    tab_name : str
        Display name of the tab (e.g. "Credit", "Recession Risk").
    metrics : dict
        3-6 headline metrics that summarize what the user is currently seeing.
        Values must be JSON-serializable (numbers, strings, bools, None).
    kind : str
        "live" for tabs whose metrics are live data, "reference" for static
        tabs (e.g. Methodology).
    """
    try:
        import streamlit as st
        st.session_state["current_tab_context"] = {
            "tab":           tab_name,
            "kind":          kind,
            "metrics":       metrics,
            "registered_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }
    except Exception:
        pass
