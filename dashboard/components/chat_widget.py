"""dashboard/components/chat_widget.py — Floating AI Analyst widget.

Phase 12B. Renders a bottom-right FAB on every tab. Clicking opens an
@st.dialog modal with suggested prompts (when empty) and a chat surface.
Session-only history — no DB persistence, recruiters never see prior
visitors' conversations.
"""

from __future__ import annotations

import streamlit as st

from src.analytics.chat import AgentError, MacroRadarAgent
from src.config import get_secret

SUGGESTED_PROMPTS = [
    "What's driving the current regime?",
    "Explain what I'm looking at on this tab",
    "Should I be worried about recession risk right now?",
    "Top headlines today and why they matter",
]


# ── Cached agent ─────────────────────────────────────────────────────────────

@st.cache_resource
def _get_agent() -> MacroRadarAgent:
    return MacroRadarAgent()


# ── Session state init ────────────────────────────────────────────────────────

def _ensure_state() -> None:
    st.session_state.setdefault("chat_messages", [])      # list of {"role","content"}
    st.session_state.setdefault("chat_tool_log", [])
    st.session_state.setdefault("chat_token_log", {"input": 0, "output": 0})
    st.session_state.setdefault("chat_pending_prompt", None)


# ── Dialog ────────────────────────────────────────────────────────────────────

@st.dialog("Macro Regime Radar — AI Analyst", width="large")
def _chat_dialog() -> None:
    _ensure_state()

    st.caption("Powered by Claude Sonnet 4.5 · session-only · tool-using over the live DB")

    # Suggested prompts (only when history is empty)
    if not st.session_state.chat_messages:
        st.markdown(
            "<div style='font-size:11px;color:#8899aa;text-transform:uppercase;"
            "letter-spacing:0.5px;margin:8px 0 6px;'>Try asking</div>",
            unsafe_allow_html=True,
        )
        cols = st.columns(2)
        for i, prompt in enumerate(SUGGESTED_PROMPTS):
            if cols[i % 2].button(prompt, key=f"chat_sugg_{i}", use_container_width=True):
                st.session_state.chat_pending_prompt = prompt
                st.rerun()

    # Render history
    for msg in st.session_state.chat_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # Drain pending prompt (from suggested-button click) before chat_input
    pending = st.session_state.chat_pending_prompt
    st.session_state.chat_pending_prompt = None

    typed = st.chat_input("Ask about the data...")
    user_input = pending or typed

    if user_input:
        st.session_state.chat_messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)

        with st.chat_message("assistant"):
            try:
                agent = _get_agent()
                # Build history in the Anthropic message format (text-only).
                history = [
                    {"role": m["role"], "content": m["content"]}
                    for m in st.session_state.chat_messages[:-1]
                ]
                stream = agent.ask_streaming(user_input, history=history)
                full = st.write_stream(stream)
            except AgentError as exc:
                full = f"_AI assistant error: {exc}_"
                st.markdown(full)
            except Exception:  # noqa: BLE001 — last-resort guard for UX
                full = "_AI service temporarily unavailable. Please try again._"
                st.markdown(full)

        st.session_state.chat_messages.append({"role": "assistant", "content": full})
        st.rerun()

    # Footer: token counter + clear link
    tok = st.session_state.chat_token_log
    total = tok["input"] + tok["output"]
    cols = st.columns([3, 1])
    cols[0].markdown(
        f"<div style='font-size:10px;color:#484f58;margin-top:6px;'>"
        f"Tokens this session: {total:,} · in {tok['input']:,} / out {tok['output']:,}"
        f"</div>",
        unsafe_allow_html=True,
    )
    if cols[1].button("Clear", key="chat_clear", use_container_width=True):
        st.session_state.chat_messages = []
        st.session_state.chat_tool_log = []
        st.session_state.chat_token_log = {"input": 0, "output": 0}
        st.rerun()


# ── FAB launcher ──────────────────────────────────────────────────────────────

_FAB_CSS = """
<style>
/* Macro Regime Radar — Chat FAB positioning */
.element-container:has(> div > div > #macro-chat-fab-mark),
div[data-testid="stElementContainer"]:has(> div > #macro-chat-fab-mark) {
    display: none !important;
}
.element-container:has(> div > div > #macro-chat-fab-mark) + .element-container,
div[data-testid="stElementContainer"]:has(> div > #macro-chat-fab-mark) + div[data-testid="stElementContainer"] {
    position: fixed !important;
    bottom: 24px !important;
    right: 24px !important;
    z-index: 9999 !important;
    width: auto !important;
    margin: 0 !important;
}
.element-container:has(> div > div > #macro-chat-fab-mark) + .element-container button,
div[data-testid="stElementContainer"]:has(> div > #macro-chat-fab-mark) + div[data-testid="stElementContainer"] button {
    background: #161b22 !important;
    color: #e6edf3 !important;
    border: 1px solid #4a9eff !important;
    border-radius: 999px !important;
    padding: 10px 18px !important;
    font-weight: 600 !important;
    font-size: 12px !important;
    letter-spacing: 0.4px !important;
    box-shadow: 0 4px 14px rgba(74,158,255,0.25), 0 0 0 1px rgba(74,158,255,0.15) !important;
    transition: transform 0.15s ease, box-shadow 0.15s ease !important;
}
.element-container:has(> div > div > #macro-chat-fab-mark) + .element-container button:hover,
div[data-testid="stElementContainer"]:has(> div > #macro-chat-fab-mark) + div[data-testid="stElementContainer"] button:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 18px rgba(74,158,255,0.40), 0 0 0 1px rgba(74,158,255,0.30) !important;
}
</style>
"""


def render_chat_launcher() -> None:
    """Render the floating bottom-right AI Analyst FAB and wire its click to the dialog.

    Silently no-ops if `ANTHROPIC_API_KEY` is missing.
    """
    if not get_secret("ANTHROPIC_API_KEY"):
        st.markdown(
            "<div style='position:fixed;bottom:24px;right:24px;z-index:9999;"
            "font-size:10px;color:#8899aa;background:#161b22;border:0.5px solid #21262d;"
            "border-radius:6px;padding:6px 10px;'>"
            "AI Assistant unavailable — API key not configured</div>",
            unsafe_allow_html=True,
        )
        return

    _ensure_state()
    st.markdown(_FAB_CSS, unsafe_allow_html=True)
    # Marker: positioning CSS targets this element's next sibling.
    st.markdown("<div id='macro-chat-fab-mark'></div>", unsafe_allow_html=True)
    if st.button("💬 AI Analyst", key="__macro_chat_fab__"):
        _chat_dialog()
