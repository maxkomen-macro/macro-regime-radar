"""
src/analytics/recession.py
Standalone recession risk analytics module.
NO imports from src.config — defines own DB_PATH to avoid FRED_API_KEY requirement.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

# ── NBER recession periods (fallback if USREC not in DB) ─────────────────────
NBER_RECESSIONS = [
    ("1990-07-01", "1991-03-01"),
    ("2001-03-01", "2001-11-01"),
    ("2007-12-01", "2009-06-01"),
    ("2020-02-01", "2020-04-01"),
]

# ── Feature names (must match column order throughout) ───────────────────────
FEATURE_NAMES = ["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"]


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _load_raw(series_id: str, conn: sqlite3.Connection, scale: float = 1.0) -> pd.Series:
    """Load a series from raw_series, return as pd.Series with DatetimeIndex."""
    rows = conn.execute(
        "SELECT date, value FROM raw_series WHERE series_id = ? ORDER BY date",
        (series_id,),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.assign(date=pd.to_datetime(df["date"]))
    df = df.set_index("date")["value"].astype(float) * scale
    return df


def _to_monthly(s: pd.Series) -> pd.Series:
    """Resample a daily series to month-end."""
    if s.empty:
        return s
    return s.resample("ME").last().dropna()


def _pct_rank(series: pd.Series, current_val: float) -> int:
    """Return 0–100 percentile rank of current_val within series."""
    if series.empty or current_val is None:
        return 50
    arr = series.dropna()
    if len(arr) == 0:
        return 50
    rank = int((arr < current_val).sum() / len(arr) * 100)
    return max(0, min(100, rank))


def _build_usrec_from_nber(index: pd.DatetimeIndex) -> pd.Series:
    """Build a monthly 0/1 series from hardcoded NBER recession date ranges."""
    s = pd.Series(0, index=index, dtype=float)
    for start_str, end_str in NBER_RECESSIONS:
        start = pd.Timestamp(start_str)
        end   = pd.Timestamp(end_str)
        s.loc[(s.index >= start) & (s.index <= end)] = 1.0
    return s


def _build_feature_frame(conn: sqlite3.Connection) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """
    Build the aligned feature DataFrame and USREC target series.
    Returns (features_df, usrec_series, yield_curve_daily).
    features_df columns: yield_curve, unemployment, hy_spread, indpro_yoy, lei_proxy
    """
    # Load raw series
    dgs10  = _to_monthly(_load_raw("DGS10",         conn))
    dgs2   = _to_monthly(_load_raw("DGS2",          conn))
    unrate = _load_raw("UNRATE",                    conn)  # already monthly
    hy_oas = _to_monthly(_load_raw("BAMLH0A0HYM2",  conn, scale=100.0))
    indpro = _load_raw("INDPRO",                    conn)  # already monthly
    usslind= _load_raw("USSLIND",                   conn)  # LEI, monthly

    # Daily yield curve for chart
    dgs10_d = _load_raw("DGS10", conn)
    dgs2_d  = _load_raw("DGS2",  conn)
    yield_curve_daily = (dgs10_d - dgs2_d).dropna()

    # LEI proxy fallback — also fall back when USSLIND is stale (discontinued Feb 2020)
    _usslind_fresh = usslind.dropna()
    _usslind_stale = (
        usslind.empty
        or len(_usslind_fresh) < 12
        or _usslind_fresh.index[-1] < pd.Timestamp.today() - pd.DateOffset(years=2)
    )
    if _usslind_stale:
        t10y  = _to_monthly(_load_raw("T10YIE", conn))
        t5y   = _to_monthly(_load_raw("T5YIE",  conn))
        lei_proxy = (t10y - t5y).dropna()
    else:
        lei_proxy = usslind

    # Monthly USSLIND resample (already monthly but ensure ME freq)
    if not usslind.empty:
        usslind = usslind.resample("ME").last()

    # Monthly resample for LEI proxy if needed
    lei_proxy = lei_proxy.resample("ME").last().dropna()

    # Compute derived features (monthly)
    yield_curve  = (dgs10 - dgs2).dropna()
    indpro_m     = indpro.resample("ME").last()
    indpro_yoy   = indpro_m.pct_change(12) * 100
    unrate_m     = unrate.resample("ME").last()

    # USREC
    usrec_raw = _load_raw("USREC", conn)
    if not usrec_raw.empty:
        usrec = usrec_raw.resample("ME").last().dropna()
    else:
        usrec = None  # trigger fallback later

    # Align all monthly series
    df = pd.DataFrame({
        "yield_curve":  yield_curve,
        "unemployment": unrate_m,
        "hy_spread":    hy_oas,
        "indpro_yoy":   indpro_yoy,
        "lei_proxy":    lei_proxy,
    }).dropna(how="all")

    # Build USREC on same index
    if usrec is not None and not usrec.empty:
        usrec_aligned = usrec.reindex(df.index, method="ffill")
    else:
        usrec_aligned = _build_usrec_from_nber(df.index)

    return df, usrec_aligned, yield_curve_daily


# ── Public: train model (for cache_resource) ─────────────────────────────────

def train_recession_model() -> tuple:
    """
    Train logistic regression on all available history.
    Returns (model, scaler, feature_names) — sklearn objects only.
    Called once via @st.cache_resource.
    """
    try:
        conn = _get_conn()
        features_df, usrec, _ = _build_feature_frame(conn)
        conn.close()
    except Exception:
        return None, None, FEATURE_NAMES

    # Lag features 3 months to prevent look-ahead bias
    X = features_df[FEATURE_NAMES].shift(3)
    y = usrec

    # Align and drop NaN rows
    combined = pd.concat([X, y.rename("usrec")], axis=1).dropna()
    if len(combined) < 30:
        return None, None, FEATURE_NAMES

    X_train = combined[FEATURE_NAMES].values
    y_train = combined["usrec"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_train)

    model = LogisticRegression(
        C=1.0,
        class_weight="balanced",
        max_iter=1000,
        random_state=42,
    )
    model.fit(X_scaled, y_train)

    return model, scaler, FEATURE_NAMES


def _load_curve_shape() -> dict:
    """Load most-recent yield for each Treasury tenor available in raw_series."""
    TENORS = [
        ("DGS1MO", "1M"), ("DGS3MO", "3M"), ("DGS6MO", "6M"), ("DGS1", "1Y"),
        ("DGS2", "2Y"), ("DGS5", "5Y"), ("DGS10", "10Y"), ("DGS30", "30Y"),
    ]
    result: dict = {}
    try:
        conn = _get_conn()
        for sid, label in TENORS:
            row = conn.execute(
                "SELECT value FROM raw_series WHERE series_id = ? AND value IS NOT NULL "
                "ORDER BY date DESC LIMIT 1",
                (sid,),
            ).fetchone()
            result[label] = float(row["value"]) if row else None
        conn.close()
    except Exception:
        pass
    return result


# ── Public: get metrics (for cache_data — serializable only) ─────────────────

def get_recession_metrics() -> dict:
    """
    Compute all recession risk metrics.
    Returns a dict of serializable values (floats, strings, pd.Series).
    Does NOT return model or scaler objects.
    """
    empty = _empty_metrics()

    try:
        conn = _get_conn()
        features_df, usrec, yield_curve_daily = _build_feature_frame(conn)

        # Load HY OAS for divergence score
        hy_oas_full = _to_monthly(_load_raw("BAMLH0A0HYM2", conn, scale=100.0))

        # Load prob_recession from regimes table
        reg_rows = conn.execute(
            "SELECT prob_recession FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
        macro_recession_signal = float(reg_rows["prob_recession"]) * 100.0 if reg_rows else None

        conn.close()
    except Exception:
        return empty

    if features_df.empty:
        return empty

    # ── Train model inline for probability series ─────────────────────────────
    model, scaler, feat_names = train_recession_model()
    if model is None:
        return empty

    # Historical probability series
    X = features_df[FEATURE_NAMES].shift(3)
    combined = pd.concat([X], axis=1).dropna()
    if combined.empty:
        return empty

    X_scaled = scaler.transform(combined.values)
    proba    = model.predict_proba(X_scaled)
    # Class order: [0=expansion, 1=recession]
    rec_class_idx = list(model.classes_).index(1) if 1 in model.classes_ else -1
    if rec_class_idx == -1:
        return empty

    prob_series = pd.Series(
        proba[:, rec_class_idx] * 100.0,
        index=combined.index,
    )

    # Current recession probability
    today = pd.Timestamp(date.today())
    valid_prob = prob_series[prob_series.index <= today]
    if valid_prob.empty:
        return empty
    recession_prob = float(valid_prob.iloc[-1])
    recession_label, recession_color = _classify_prob(recession_prob)

    # ── Yield curve metrics ───────────────────────────────────────────────────
    yc_monthly = (features_df["yield_curve"]).dropna()
    if yc_monthly.empty:
        return empty

    current_spread_pct = float(yc_monthly.iloc[-1])          # in % (e.g. 0.49)
    current_spread_bps = current_spread_pct * 100.0           # in bps (e.g. 49)
    is_inverted        = current_spread_bps < 0.0

    # Inversion duration
    inversion_duration = 0
    if is_inverted:
        for i in range(len(yc_monthly) - 1, -1, -1):
            if yc_monthly.iloc[i] * 100.0 < 0:
                inversion_duration += 1
            else:
                break

    # Percentile rank vs 30yr history
    cutoff_30yr = today - pd.DateOffset(years=30)
    yc_30yr     = yc_monthly[yc_monthly.index >= cutoff_30yr]
    yc_pct_rank = _pct_rank(yc_30yr, current_spread_pct)

    # ── Divergence score ──────────────────────────────────────────────────────
    hy_pct_rank = _pct_rank(hy_oas_full, float(hy_oas_full.iloc[-1])) if not hy_oas_full.empty else None

    if macro_recession_signal is not None and hy_pct_rank is not None:
        divergence_score = float(hy_pct_rank) - macro_recession_signal
        if divergence_score > 20:
            divergence_label = "Markets ahead of macro"
            divergence_color = "#e67e22"
        elif divergence_score < -20:
            divergence_label = "Macro ahead of markets"
            divergence_color = "#e67e22"
        else:
            divergence_label = "Aligned"
            divergence_color = "#2ecc71"
    else:
        divergence_score = 0.0
        divergence_label = "Aligned"
        divergence_color = "#2ecc71"

    # ── Feature coefficients ──────────────────────────────────────────────────
    coef_dict = {
        feat: float(c)
        for feat, c in zip(feat_names, model.coef_[0])
    }

    # ── USREC series ──────────────────────────────────────────────────────────
    usrec_series = usrec.reindex(prob_series.index, method="ffill").fillna(0)

    # ── data_as_of ────────────────────────────────────────────────────────────
    # Use freshest date across actual macro/market series (not USREC which ends 2020)
    _fresh_dates = [
        features_df[col].dropna().index[-1]
        for col in ["yield_curve", "hy_spread", "unemployment", "indpro_yoy"]
        if len(features_df[col].dropna()) > 0
    ]
    data_as_of = max(_fresh_dates).strftime("%Y-%m-%d") if _fresh_dates else valid_prob.index[-1].strftime("%Y-%m-%d")

    curve_shape = _load_curve_shape()

    return {
        "recession_prob":           recession_prob,
        "recession_label":          recession_label,
        "recession_color":          recession_color,
        "yield_curve_spread":       current_spread_bps,
        "yield_curve_pct_rank":     yc_pct_rank,
        "inversion_duration_months": inversion_duration,
        "is_inverted":              is_inverted,
        "divergence_score":         divergence_score,
        "divergence_label":         divergence_label,
        "divergence_color":         divergence_color,
        "recession_prob_series":    prob_series,
        "yield_curve_series":       yield_curve_daily,
        "usrec_series":             usrec_series,
        "n_training_samples":       len(combined),
        "model_features":           feat_names,
        "feature_coefficients":     coef_dict,
        "data_as_of":               data_as_of,
        "curve_shape":              curve_shape,
        # Current input values for sensitivity panel defaults
        "_current_unrate":          float(features_df["unemployment"].dropna().iloc[-1]) if not features_df["unemployment"].dropna().empty else 4.0,
        "_current_hy_oas":          float(features_df["hy_spread"].dropna().iloc[-1]) if not features_df["hy_spread"].dropna().empty else 350.0,
        "_current_indpro_yoy":      float(features_df["indpro_yoy"].dropna().iloc[-1]) if not features_df["indpro_yoy"].dropna().empty else 0.0,
        "_current_lei":             float(features_df["lei_proxy"].dropna().iloc[-1]) if not features_df["lei_proxy"].dropna().empty else 0.0,
    }


def _classify_prob(p: float) -> tuple[str, str]:
    if p < 20:
        return "Low Risk", "#2ecc71"
    elif p < 40:
        return "Elevated", "#e67e22"
    else:
        return "High Risk", "#e74c3c"


def _empty_metrics() -> dict:
    return {
        "recession_prob":            None,
        "recession_label":           "No data",
        "recession_color":           "#8b949e",
        "yield_curve_spread":        None,
        "yield_curve_pct_rank":      None,
        "inversion_duration_months": None,
        "is_inverted":               None,
        "divergence_score":          None,
        "divergence_label":          "No data",
        "divergence_color":          "#8b949e",
        "recession_prob_series":     pd.Series(dtype=float),
        "yield_curve_series":        pd.Series(dtype=float),
        "usrec_series":              pd.Series(dtype=float),
        "n_training_samples":        0,
        "model_features":            FEATURE_NAMES,
        "feature_coefficients":      {},
        "data_as_of":                "N/A",
        "curve_shape":               {},
        "_current_unrate":           4.0,
        "_current_hy_oas":           350.0,
        "_current_indpro_yoy":       0.0,
        "_current_lei":              0.0,
    }
