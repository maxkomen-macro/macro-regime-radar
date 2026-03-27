"""
LBO Calculator tab — Phase 8B.
Interactive deal model with declining balance interest, sensitivity table,
and live all-in financing cost from FEDFUNDS + HY OAS.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import streamlit as st
import streamlit.components.v1 as components

from src.analytics.lbo import get_lbo_defaults, run_lbo_model

# ---------------------------------------------------------------------------
# Constants — dark theme
# ---------------------------------------------------------------------------
_BG        = "#0d1117"
_BG2       = "#161b22"
_BORDER    = "#30363d"
_TEXT      = "#e6edf3"
_MUTED     = "#8b949e"
_BLUE      = "#4a9eff"
_GREEN     = "#2ecc71"
_ORANGE    = "#e67e22"
_RED       = "#e74c3c"

_BASE_CSS = f"""
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: {_BG}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       color: {_TEXT}; font-size: 13px; }}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _irr_color(irr: float | None, viable: bool = True) -> str:
    if not viable:
        return _RED
    if irr is None:
        return _MUTED
    if irr >= 20:
        return _GREEN
    if irr >= 15:
        return _BLUE
    return _ORANGE


def _fmt_m(v: float | None, decimals: int = 0) -> str:
    """Format as $XXXm."""
    if v is None:
        return "—"
    return f"${v:,.{decimals}f}M"


def _section_header(title: str, color: str = _BLUE) -> None:
    st.markdown(
        f"""<div style="border-left:3px solid {color};border-radius:0;
        padding:4px 10px;margin:16px 0 10px 0;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;
        color:{_MUTED};font-weight:600;">{title}</span></div>""",
        unsafe_allow_html=True,
    )


def _round_to_half(x: float) -> float:
    return round(x * 2) / 2


# ---------------------------------------------------------------------------
# Live rate banner (left panel)
# ---------------------------------------------------------------------------

def _render_live_rate_banner(defaults: dict, live_rate: float) -> None:
    ff   = defaults["fedfunds"]
    hy   = defaults["hy_oas_pct"]
    rate = defaults["lbo_all_in_rate"]
    asof = defaults["data_as_of"]

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.banner {{
  background: {_BG2};
  border: 0.5px solid {_BORDER};
  border-left: 3px solid {_BLUE};
  border-radius: 0 6px 6px 0;
  padding: 10px 14px;
  margin-bottom: 4px;
}}
.label {{ font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
         color: {_MUTED}; margin-bottom: 6px; }}
.formula {{ display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
.pill {{ background: {_BG}; border: 0.5px solid {_BORDER}; border-radius: 4px;
        padding: 3px 8px; font-size: 12px; }}
.plus {{ color: {_MUTED}; font-size: 14px; }}
.result {{ color: {_BLUE}; font-weight: 700; font-size: 16px; }}
.asof {{ font-size: 10px; color: {_MUTED}; margin-top: 5px; }}
</style></head><body>
<div class="banner">
  <div class="label">Live Financing Rate</div>
  <div class="formula">
    <span class="pill">Fed Funds <strong>{ff:.2f}%</strong></span>
    <span class="plus">+</span>
    <span class="pill">HY Spread <strong>{hy:.2f}%</strong></span>
    <span class="plus">=</span>
    <span class="result">{rate:.2f}%</span>
  </div>
  <div class="asof">As of {asof}</div>
</div>
</body></html>""",
        height=100,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Deal structure summary card (left panel, below sliders)
# ---------------------------------------------------------------------------

def _render_deal_summary(res: dict) -> None:
    if not res["viable"]:
        return
    ev   = res["entry_ev"]
    debt = res["entry_debt"]
    eq   = res["entry_equity"]
    de   = round(debt / eq, 2) if eq and eq > 0 else 0

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.card {{
  background: {_BG2}; border: 0.5px solid {_BORDER};
  border-left: 3px solid {_MUTED}; border-radius: 0 6px 6px 0;
  padding: 10px 14px; margin-top: 4px;
}}
.label {{ font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
         color: {_MUTED}; margin-bottom: 6px; }}
.grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }}
.row {{ display: flex; justify-content: space-between; }}
.key {{ color: {_MUTED}; font-size: 12px; }}
.val {{ color: {_TEXT}; font-size: 12px; font-weight: 600; }}
</style></head><body>
<div class="card">
  <div class="label">Deal Structure</div>
  <div class="grid">
    <div class="row"><span class="key">Entry EV</span><span class="val">{_fmt_m(ev)}</span></div>
    <div class="row"><span class="key">Entry Equity</span><span class="val">{_fmt_m(eq)}</span></div>
    <div class="row"><span class="key">Entry Debt</span><span class="val">{_fmt_m(debt)}</span></div>
    <div class="row"><span class="key">D/E Ratio</span><span class="val">{de:.1f}x</span></div>
  </div>
</div>
</body></html>""",
        height=110,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Returns banner (right panel)
# ---------------------------------------------------------------------------

def _render_returns_banner(res: dict) -> None:
    irr    = res["irr"]
    moic   = res["moic"]
    gain   = res["equity_gain"]
    color  = _irr_color(irr)

    irr_str  = f"{irr:.1f}%" if irr is not None else "N/A"
    moic_str = f"{moic:.2f}x" if moic is not None else "—"
    gain_str = f"+{_fmt_m(gain)}" if gain and gain >= 0 else _fmt_m(gain)
    gain_col = _GREEN if gain and gain > 0 else _RED

    # IRR tooltip via title attribute
    irr_title = "" if irr is not None else ' title="IRR could not be computed for this scenario."'

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.row {{ display: flex; gap: 10px; }}
.card {{
  flex: 1; background: {_BG2}; border: 0.5px solid {_BORDER};
  border-top: 3px solid {color}; border-radius: 0 0 6px 6px;
  padding: 14px; text-align: center;
}}
.label {{ font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
         color: {_MUTED}; margin-bottom: 8px; }}
.val {{ font-size: 28px; font-weight: 700; }}
</style></head><body>
<div class="row">
  <div class="card">
    <div class="label">IRR</div>
    <div class="val" style="color:{color}"{irr_title}>{irr_str}</div>
  </div>
  <div class="card">
    <div class="label">MOIC</div>
    <div class="val" style="color:{color};">{moic_str}</div>
  </div>
  <div class="card">
    <div class="label">Equity Gain</div>
    <div class="val" style="color:{gain_col};">{gain_str}</div>
  </div>
</div>
</body></html>""",
        height=110,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Annual schedule table
# ---------------------------------------------------------------------------

def _render_schedule_table(res: dict) -> None:
    schedule = res["schedule"]
    irr      = res["irr"]
    color    = _irr_color(irr)
    n        = len(schedule)

    rows_html = ""
    for i, yr in enumerate(schedule):
        is_exit = (i == n - 1)
        weight  = "700" if is_exit else "400"
        bg      = f"rgba(74,158,255,0.07)" if is_exit else "transparent"
        label   = f'Year {yr["year"]} <span style="font-size:9px;color:{color};font-weight:700;">EXIT</span>' if is_exit else f'Year {yr["year"]}'
        rows_html += f"""
        <tr style="background:{bg};">
          <td style="font-weight:{weight};padding:5px 8px;">{label}</td>
          <td style="text-align:right;padding:5px 8px;">{yr["ebitda"]:.1f}</td>
          <td style="text-align:right;padding:5px 8px;">{yr["implied_ev"]:.1f}</td>
          <td style="text-align:right;padding:5px 8px;">{yr["debt_start"]:.1f}</td>
          <td style="text-align:right;padding:5px 8px;">{yr["debt_end"]:.1f}</td>
          <td style="text-align:right;padding:5px 8px;">{yr["interest"]:.1f}</td>
        </tr>"""

    height = 60 + n * 32

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.card {{
  background: {_BG2}; border: 0.5px solid {_BORDER};
  border-radius: 6px; overflow: hidden;
}}
table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
thead tr {{ background: {_BG}; }}
th {{
  padding: 6px 8px; text-align: right; font-size: 10px;
  text-transform: uppercase; letter-spacing: .06em; color: {_MUTED};
  border-bottom: 1px solid {_BORDER};
}}
th:first-child {{ text-align: left; }}
td {{ color: {_TEXT}; border-bottom: 0.5px solid {_BORDER}22; font-size: 11px; }}
td:first-child {{ text-align: left; }}
</style></head><body>
<div class="card">
<table>
  <thead>
    <tr>
      <th>Year</th>
      <th>EBITDA ($M)</th>
      <th>Implied EV ($M)</th>
      <th>Debt Start ($M)</th>
      <th>Debt End ($M)</th>
      <th>Interest ($M)</th>
    </tr>
  </thead>
  <tbody>{rows_html}</tbody>
</table>
</div>
</body></html>""",
        height=height,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Sensitivity table (5×5 entry vs exit multiple grid)
# ---------------------------------------------------------------------------

def _render_sensitivity_table(
    base_result: dict,
    ebitda: float,
    ebitda_growth: float,
    hold_period: int,
    leverage_ratio: float,
    interest_rate: float,
    amortization: float,
    mgmt_fee: float,
    entry_multiple: float,
    exit_multiple: float,
) -> None:
    entry_center = _round_to_half(entry_multiple)
    exit_center  = _round_to_half(exit_multiple)

    entry_range = [entry_center + d for d in [-1.0, -0.5, 0.0, 0.5, 1.0]]
    exit_range  = [exit_center  + d for d in [-1.0, -0.5, 0.0, 0.5, 1.0]]
    entry_range = [x for x in entry_range if x >= 3.0]
    exit_range  = [x for x in exit_range  if x >= 3.0]

    # Compute IRR for each cell
    def _cell_irr(em, xm):
        r = run_lbo_model(ebitda, ebitda_growth, em, xm, hold_period,
                          leverage_ratio, interest_rate, amortization, mgmt_fee)
        return r["irr"] if r["viable"] else None

    def _cell_bg(irr: float | None) -> str:
        if irr is None:
            return "rgba(139,148,158,0.10)"
        if irr >= 20:
            return "rgba(46,204,113,0.15)"
        if irr >= 15:
            return "rgba(74,158,255,0.10)"
        return "rgba(230,126,34,0.10)"

    def _cell_color(irr: float | None) -> str:
        return _irr_color(irr)

    # Build header row
    header_cells = "<th></th>" + "".join(
        f'<th>{x:.1f}x</th>' for x in exit_range
    )

    rows_html = ""
    for em in entry_range:
        row = f'<td style="color:{_MUTED};font-size:11px;padding:5px 8px;">{em:.1f}x</td>'
        for xm in exit_range:
            irr   = _cell_irr(em, xm)
            bg    = _cell_bg(irr)
            col   = _cell_color(irr)
            val   = f"{irr:.1f}%" if irr is not None else "N/A"
            # Bold border on current scenario cell
            is_current = (abs(em - entry_center) < 0.01 and abs(xm - exit_center) < 0.01)
            extra = f"border: 1.5px solid {col}; font-weight: 700;" if is_current else ""
            row += f'<td style="background:{bg};color:{col};text-align:center;{extra}padding:5px 8px;font-size:11px;">{val}</td>'
        rows_html += f"<tr>{row}</tr>"

    height = 60 + len(entry_range) * 34

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.wrap {{ margin-bottom: 4px; }}
.label {{ font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
         color: {_MUTED}; margin-bottom: 6px; }}
.axes {{ display: flex; justify-content: space-between; font-size: 10px;
        color: {_MUTED}; margin-bottom: 2px; }}
.card {{ background: {_BG2}; border: 0.5px solid {_BORDER}; border-radius: 6px; overflow: hidden; }}
table {{ width: 100%; border-collapse: collapse; font-size: 11px; }}
thead tr {{ background: {_BG}; }}
th {{
  padding: 5px 8px; text-align: center; font-size: 10px;
  text-transform: uppercase; letter-spacing: .05em; color: {_MUTED};
  border-bottom: 1px solid {_BORDER};
}}
td {{ border-bottom: 0.5px solid {_BORDER}22; }}
</style></head><body>
<div class="wrap">
  <div class="axes">
    <span>Entry Multiple →</span>
    <span>← Exit Multiple</span>
  </div>
  <div class="card">
    <table>
      <thead><tr>{header_cells}</tr></thead>
      <tbody>{rows_html}</tbody>
    </table>
  </div>
</div>
</body></html>""",
        height=height,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Market context card
# ---------------------------------------------------------------------------

def _render_market_context() -> None:
    try:
        from src.analytics.credit import get_credit_metrics
        m = get_credit_metrics()
    except Exception:
        m = {}

    hy_oas      = m.get("hy_oas")       # bps
    lbo_cost    = m.get("lbo_all_in_cost")   # "X.XX%"
    label       = m.get("credit_label", "No data")
    label_color = m.get("credit_label_color", _MUTED)
    data_as_of  = m.get("data_as_of", "")
    hy_pct_rank = m.get("hy_pct_rank")

    hy_str   = f"{hy_oas:.0f} bps" if hy_oas is not None else "—"
    cost_str = lbo_cost or "—"
    rank_str = f" ({hy_pct_rank}th pct vs 30yr history)" if hy_pct_rank is not None else ""

    # Read-through sentence
    if lbo_cost:
        try:
            rate_val = float(lbo_cost.replace("%", ""))
            if rate_val >= 9.0:
                rt = f"All-in cost of {cost_str} is above the pre-GFC ~7% benchmark — higher rates compress equity returns and shrink viable deal structures."
            elif rate_val >= 7.0:
                rt = f"All-in cost of {cost_str} is near the pre-GFC ~7% benchmark — LBO math is workable but leaves limited margin of safety."
            else:
                rt = f"All-in cost of {cost_str} is below the pre-GFC ~7% rough benchmark — relatively accommodative financing conditions support deal activity."
        except Exception:
            rt = ""
    else:
        rt = ""

    components.html(
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{_BASE_CSS}
.card {{
  background: {_BG2}; border: 0.5px solid {_BORDER};
  border-left: 3px solid {label_color}; border-radius: 0 6px 6px 0;
  padding: 10px 14px; margin-top: 8px;
}}
.label {{ font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
         color: {_MUTED}; margin-bottom: 8px; }}
.row {{ display: flex; justify-content: space-between; margin-bottom: 4px;
       font-size: 12px; }}
.key {{ color: {_MUTED}; }}
.val {{ color: {_TEXT}; font-weight: 600; }}
.badge {{ display: inline-block; background: {label_color}22; color: {label_color};
         font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }}
.rt {{ font-size: 11px; color: {_MUTED}; margin-top: 8px; line-height: 1.5; }}
</style></head><body>
<div class="card">
  <div class="label">Current Market Context</div>
  <div class="row">
    <span class="key">Live HY OAS</span>
    <span class="val">{hy_str}{rank_str}</span>
  </div>
  <div class="row">
    <span class="key">All-in financing cost</span>
    <span class="val">{cost_str} <span style="color:{_MUTED};font-size:10px;">(vs ~7% pre-GFC avg*)</span></span>
  </div>
  <div class="row">
    <span class="key">Credit conditions</span>
    <span class="val"><span class="badge">{label}</span></span>
  </div>
  <div class="rt">{rt}</div>
  <div style="font-size:9px;color:{_MUTED};margin-top:8px;">
    *Pre-GFC ~7% is a rough benchmark (Fed Funds ~5% + HY spreads ~200–250 bps, 2004–07).
  </div>
</div>
</body></html>""",
        height=175,
        scrolling=False,
    )


# ---------------------------------------------------------------------------
# Main render function
# ---------------------------------------------------------------------------

def render() -> None:
    # Load live defaults once
    defaults = get_lbo_defaults()
    live_rate = defaults["lbo_all_in_rate"]

    # --- Session state for interest rate ---
    if "lbo_interest_rate" not in st.session_state:
        st.session_state["lbo_interest_rate"] = None  # None = use live rate

    current_rate = live_rate if st.session_state["lbo_interest_rate"] is None \
                   else st.session_state["lbo_interest_rate"]

    left, right = st.columns([2, 3])

    # ================================================================
    # LEFT PANEL — inputs
    # ================================================================
    with left:
        _section_header("DEAL PARAMETERS", _BLUE)
        _render_live_rate_banner(defaults, live_rate)

        # "Use live rate" button — only visible if user deviated
        if st.session_state["lbo_interest_rate"] is not None:
            if st.button("↻ Use live rate", key="reset_rate"):
                st.session_state["lbo_interest_rate"] = None
                st.rerun()

        ebitda = st.slider("Entry EBITDA ($M)", 10.0, 2000.0,
                           value=100.0, step=10.0)
        ebitda_growth = st.slider("EBITDA growth rate (% / yr)", -10.0, 30.0,
                                  value=5.0, step=0.5)
        entry_multiple = st.slider("Entry multiple (EV/EBITDA)", 3.0, 20.0,
                                   value=8.0, step=0.25)
        exit_multiple = st.slider("Exit multiple (EV/EBITDA)", 3.0, 20.0,
                                  value=9.0, step=0.25)
        hold_period = st.slider("Hold period (years)", 1, 10,
                                value=5, step=1)
        leverage_ratio = st.slider("Leverage (Debt/EBITDA)", 0.5, 8.0,
                                   value=4.5, step=0.25)

        interest_rate = st.slider(
            "Interest rate (%)", 3.0, 20.0,
            value=round(current_rate * 4) / 4,  # snap to nearest 0.25
            step=0.25, key="interest_slider",
        )

        # Track manual override
        if abs(interest_rate - live_rate) > 0.001:
            st.session_state["lbo_interest_rate"] = interest_rate
        else:
            st.session_state["lbo_interest_rate"] = None

        amortization = st.slider("Annual debt amortization (%)", 0.0, 20.0,
                                 value=5.0, step=1.0)
        mgmt_fee = st.slider("Transaction fees (% of EV)", 0.0, 5.0,
                             value=1.5, step=0.25)

        # Run model (needed for deal summary card below sliders)
        result = run_lbo_model(
            ebitda=ebitda,
            ebitda_growth_rate=ebitda_growth,
            entry_multiple=entry_multiple,
            exit_multiple=exit_multiple,
            hold_period=hold_period,
            leverage_ratio=leverage_ratio,
            interest_rate=interest_rate,
            amortization_rate=amortization,
            mgmt_fee_pct=mgmt_fee,
        )

        _render_deal_summary(result)

    # ================================================================
    # RIGHT PANEL — results
    # ================================================================
    with right:
        irr_col = _irr_color(result["irr"], result["viable"])
        _section_header("DEAL RETURNS", irr_col)

        if not result["viable"]:
            st.error(result["error_msg"])
            return

        _render_returns_banner(result)

        st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)
        _section_header("ANNUAL SCHEDULE", _MUTED)
        _render_schedule_table(result)

        st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)
        _section_header("IRR SENSITIVITY — Entry vs Exit Multiple", _MUTED)
        _render_sensitivity_table(
            result, ebitda, ebitda_growth, hold_period,
            leverage_ratio, interest_rate, amortization, mgmt_fee,
            entry_multiple, exit_multiple,
        )

        _render_market_context()
