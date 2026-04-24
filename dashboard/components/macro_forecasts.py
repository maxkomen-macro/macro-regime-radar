"""
dashboard/components/macro_forecasts.py — Phase 12C

Six-month forward forecasts for three key macro series (DGS10, CPI YoY, UNRATE)
via Facebook Prophet. Refit once per day (cache TTL = 86400s). Charts overlay
historical + forecast + 80% interval on a single Plotly line; a one-line
regime-conditional interpretation is rendered below each.
"""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from components.shared_styles import subsection_header

# ── Standalone DB access (no src.config import — avoids FRED_API_KEY requirement) ─
_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ── Series configuration ─────────────────────────────────────────────────────
#   transform: identity → level forecast; yoy → level → YoY (%) before fitting.
#   freq: prophet frequency for the future dataframe.
_SERIES_CFG = {
    "DGS10": {
        "label":     "10Y Treasury Yield",
        "unit":      "%",
        "transform": "identity",
        "freq":      "D",
        "horizon":   180,
    },
    "CPIAUCSL": {
        "label":     "CPI YoY",
        "unit":      "%",
        "transform": "yoy",
        "freq":      "MS",
        "horizon":   6,
    },
    "UNRATE": {
        "label":     "Unemployment Rate",
        "unit":      "%",
        "transform": "identity",
        "freq":      "MS",
        "horizon":   6,
    },
}


def _load_series(series_id: str) -> pd.Series:
    with _get_conn() as conn:
        df = pd.read_sql(
            "SELECT date, value FROM raw_series WHERE series_id = ? ORDER BY date",
            conn,
            params=(series_id,),
        )
    if df.empty:
        return pd.Series(dtype=float)
    df = df.assign(date=pd.to_datetime(df["date"]))
    return df.set_index("date")["value"].astype(float)


def _current_regime() -> str:
    try:
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT label FROM regimes ORDER BY date DESC LIMIT 1"
            ).fetchone()
            return str(row[0]) if row else "Unknown"
    except Exception:
        return "Unknown"


@st.cache_data(ttl=86400, show_spinner=False)
def _fit_forecast(series_id: str) -> tuple[pd.DataFrame, pd.Timestamp, str]:
    """
    Fit Prophet on a single FRED series and return (forecast_df, fit_time, error).

    forecast_df columns: ds, y_hist (historical, NaN on forecast rows), yhat, yhat_lower, yhat_upper
    """
    cfg = _SERIES_CFG[series_id]
    s   = _load_series(series_id)
    if s.empty or len(s) < 24:
        return pd.DataFrame(), pd.Timestamp.now(), f"No data for {series_id}"

    # Transform to the unit we're forecasting
    if cfg["transform"] == "yoy":
        y_series = (s.pct_change(12) * 100.0).dropna()
    else:
        y_series = s.dropna()

    if len(y_series) < 24:
        return pd.DataFrame(), pd.Timestamp.now(), f"Not enough history for {series_id}"

    from prophet import Prophet

    # Prophet logs noisily — suppress its stan chatter.
    import logging
    for noisy in ("prophet", "cmdstanpy"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    df_train = pd.DataFrame({"ds": y_series.index, "y": y_series.values})

    try:
        model = Prophet(interval_width=0.80, daily_seasonality=False,
                        weekly_seasonality=False, yearly_seasonality=True)
        model.fit(df_train)
    except Exception as exc:
        return pd.DataFrame(), pd.Timestamp.now(), f"Prophet fit failed: {exc}"

    future  = model.make_future_dataframe(periods=cfg["horizon"], freq=cfg["freq"])
    fcst    = model.predict(future)

    hist_map = dict(zip(df_train["ds"], df_train["y"]))
    fcst["y_hist"] = fcst["ds"].map(hist_map)

    return (
        fcst[["ds", "y_hist", "yhat", "yhat_lower", "yhat_upper"]],
        pd.Timestamp.now(),
        "",
    )


def _interpret(series_id: str, forecast: pd.DataFrame, regime: str) -> str:
    """One-sentence regime-conditional interpretation."""
    cfg = _SERIES_CFG[series_id]
    if forecast.empty or forecast["y_hist"].dropna().empty:
        return ""

    last_hist_val    = float(forecast["y_hist"].dropna().iloc[-1])
    last_forecast    = float(forecast["yhat"].iloc[-1])
    delta            = last_forecast - last_hist_val
    direction        = "higher" if delta > 0.05 else ("lower" if delta < -0.05 else "roughly flat")

    label = cfg["label"]
    unit  = cfg["unit"]

    base = (f"<strong>{label}</strong> forecast points to "
            f"<strong>{last_forecast:.2f}{unit}</strong> in ~6 months "
            f"({direction} vs. {last_hist_val:.2f}{unit} today).")

    # Small regime-conditional flavor
    regime_note = {
        "Goldilocks":     "Consistent with a benign-growth regime.",
        "Overheating":    "Hot growth + hot inflation typically keep yields supported.",
        "Stagflation":    "Stagflation pressures usually bias yields higher and unemployment up.",
        "Recession Risk": "Recession risk typically pulls yields down and unemployment up.",
    }.get(regime, "")

    return base + (f" <em>{regime_note}</em>" if regime_note else "")


def _render_forecast_chart(series_id: str, forecast: pd.DataFrame) -> None:
    cfg = _SERIES_CFG[series_id]

    # Keep the last ~10 years of history for readability
    hist_cutoff = pd.Timestamp.now() - pd.DateOffset(years=10)
    hist = forecast[forecast["y_hist"].notna()]
    hist = hist[hist["ds"] >= hist_cutoff]
    fcst_only = forecast[forecast["y_hist"].isna()]

    # Prepend the final historical point to the forecast traces so the lines
    # join visually with the history. Use the actual observed value as the
    # forecast's anchor point and clamp the interval band to zero width there.
    if not hist.empty and not fcst_only.empty:
        anchor_row = hist.iloc[[-1]].copy()
        anchor_val = float(anchor_row["y_hist"].iloc[0])
        anchor_row["yhat"]       = anchor_val
        anchor_row["yhat_lower"] = anchor_val
        anchor_row["yhat_upper"] = anchor_val
        fcst = pd.concat([anchor_row, fcst_only], ignore_index=True)
    else:
        fcst = fcst_only

    fig = go.Figure()

    # 80% interval band (forecast portion only, anchored to last history point)
    if not fcst.empty:
        fig.add_trace(go.Scatter(
            x=list(fcst["ds"]) + list(fcst["ds"])[::-1],
            y=list(fcst["yhat_upper"]) + list(fcst["yhat_lower"])[::-1],
            fill="toself", fillcolor="rgba(74,158,255,0.18)",
            line=dict(width=0), hoverinfo="skip",
            name="80% Interval", showlegend=True,
        ))
        fig.add_trace(go.Scatter(
            x=fcst["ds"], y=fcst["yhat"],
            mode="lines", name="Forecast",
            line=dict(color="#4a9eff", width=2, dash="dash"),
        ))

    # Historical line (solid)
    fig.add_trace(go.Scatter(
        x=hist["ds"], y=hist["y_hist"],
        mode="lines", name="History",
        line=dict(color="#e6edf3", width=2),
    ))

    fig.update_layout(
        height=320,
        margin=dict(l=20, r=20, t=24, b=30),
        template="plotly_dark",
        paper_bgcolor="#0d1117",
        plot_bgcolor="#0d1117",
        legend=dict(orientation="h", y=1.1, x=0, font=dict(size=10)),
        xaxis=dict(title=None, gridcolor="#21262d"),
        yaxis=dict(title=cfg["unit"], gridcolor="#21262d"),
        title=dict(text=cfg["label"], font=dict(size=14, color="#e6edf3"), x=0.01),
    )
    st.plotly_chart(fig, use_container_width=True)


def render_macro_forecasts() -> None:
    """Entry point — called from dashboard/app.py inside the Dashboard tab."""
    st.caption(
        "Prophet-based 6-month forward forecasts with 80% confidence bands. "
        "Models refit once per day."
    )

    regime = _current_regime()
    cols   = st.columns(3)

    for idx, series_id in enumerate(_SERIES_CFG.keys()):
        cfg = _SERIES_CFG[series_id]
        with cols[idx]:
            subsection_header(cfg["label"])
            try:
                forecast, fit_time, err = _fit_forecast(series_id)
            except Exception as exc:
                st.warning(f"Forecast temporarily unavailable for {cfg['label']}: {exc}")
                continue

            if err or forecast.empty:
                st.warning(f"Forecast temporarily unavailable for {cfg['label']}"
                           + (f" — {err}" if err else ""))
                continue

            _render_forecast_chart(series_id, forecast)
            st.markdown(
                f"<div style='font-size:12px;color:#c9d1d9;margin-top:-4px;'>"
                f"{_interpret(series_id, forecast, regime)}</div>",
                unsafe_allow_html=True,
            )
            st.caption(f"Last updated: {fit_time.strftime('%Y-%m-%d %H:%M')}")
