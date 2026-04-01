"""
src/analytics/allocation.py
Standalone asset allocation analytics module.

Implements portfolio optimization methods:
- Mean-Variance Optimization (MVO) — maximize Sharpe ratio
- Minimum Variance — minimize portfolio volatility
- Risk Parity — equal risk contribution from each asset

Uses index proxies (^GSPC, ^RUT, GC=F) for longer history pre-ETF-inception.
NO imports from src.config — avoids FRED_API_KEY requirement.
"""
from __future__ import annotations

import sqlite3
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.optimize import minimize

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

# ── Asset class configuration ──────────────────────────────────────────────────
# index: free index proxy to extend history before ETF inception; None = ETF only
ASSET_CLASSES: Dict[str, Dict] = {
    "US Large Cap":     {"etf": "SPY",  "index": "^GSPC", "etf_start": "1993-01-29"},
    "US Small Cap":     {"etf": "IWM",  "index": "^RUT",  "etf_start": "2000-05-26"},
    "Int'l Developed":  {"etf": "EFA",  "index": None,    "etf_start": "2001-08-27"},
    "Emerging Markets": {"etf": "EEM",  "index": None,    "etf_start": "2003-04-14"},
    "US Agg Bond":      {"etf": "AGG",  "index": None,    "etf_start": "2003-09-29"},
    "US Treasuries":    {"etf": "IEF",  "index": None,    "etf_start": "2002-07-30"},
    "IG Credit":        {"etf": "LQD",  "index": None,    "etf_start": "2002-07-30"},
    "High Yield":       {"etf": "HYG",  "index": None,    "etf_start": "2007-04-11"},
    "Commodities":      {"etf": "DJP",  "index": None,    "etf_start": "2006-06-06"},
    "Gold":             {"etf": "GLD",  "index": "GC=F",  "etf_start": "2004-11-18"},
}

REGIME_LABELS: List[str] = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]

FACTOR_PROXIES: Dict[str, Dict[str, str]] = {
    "Value":    {"long": "IWD",  "short": "IWF"},
    "Momentum": {"long": "MTUM", "short": "SPY"},
    "Quality":  {"long": "QUAL", "short": "SPY"},
    "Size":     {"long": "IWM",  "short": "SPY"},
    "Low Vol":  {"long": "USMV", "short": "SPY"},
}

STYLE_ETFS: Dict[str, str] = {
    "Growth":       "IWF",
    "Value":        "IWD",
    "Large Cap":    "SPY",
    "Small Cap":    "IWM",
    "Active Proxy": "ARKK",
    "Passive":      "VTI",
}

CURRENCY_PAIRS: Dict[str, str] = {
    "EUR/USD": "EURUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USD/JPY": "JPY=X",
    "EM FX":   "CEW",
    "DXY":     "DX-Y.NYB",
}


# ── Database ───────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _normalize_month(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Snap every timestamp to the 1st of its month for cross-source alignment."""
    return idx.to_period("M").to_timestamp()


# ── Data fetching ──────────────────────────────────────────────────────────────

def _fetch_prices(ticker: str, start: str, end: str) -> pd.Series:
    """Download adjusted close prices via yfinance. Returns empty Series on failure."""
    try:
        raw = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
        if raw is None or raw.empty:
            return pd.Series(dtype=float)
        col = "Close"
        if isinstance(raw.columns, pd.MultiIndex):
            # yfinance returns MultiIndex when multi-ticker
            if (col, ticker) in raw.columns:
                return raw[(col, ticker)].dropna()
            # fallback: first Close column
            close_cols = [c for c in raw.columns if c[0] == col]
            if close_cols:
                return raw[close_cols[0]].dropna()
            return pd.Series(dtype=float)
        if col in raw.columns:
            return raw[col].dropna()
        return pd.Series(dtype=float)
    except Exception as exc:
        print(f"  Warning: could not fetch {ticker}: {exc}")
        return pd.Series(dtype=float)


def get_asset_returns(
    start_date: str = "1990-01-01",
    end_date: Optional[str] = None,
) -> pd.DataFrame:
    """
    Monthly returns (as decimals) for all 10 asset classes.

    For assets with an index proxy:
      - Fetch index data from start_date → etf_start
      - Fetch ETF data from etf_start → end_date
      - Normalize index prices at the splice point and concat
    For assets without a proxy (index=None):
      - Fetch ETF from etf_start → end_date only
    """
    if end_date is None:
        end_date = datetime.now().strftime("%Y-%m-%d")

    all_returns: Dict[str, pd.Series] = {}

    for name, cfg in ASSET_CLASSES.items():
        etf       = cfg["etf"]
        idx       = cfg["index"]
        etf_start = cfg["etf_start"]

        # ── Fetch ETF prices ───────────────────────────────────────────────────
        etf_prices = _fetch_prices(etf, etf_start, end_date)

        if len(etf_prices) == 0:
            print(f"  Skipping {name}: no ETF data")
            continue

        combined = etf_prices.copy()

        # ── Splice index proxy for pre-ETF history ─────────────────────────────
        if idx is not None and start_date < etf_start:
            idx_prices = _fetch_prices(idx, start_date, etf_start)

            if len(idx_prices) > 0:
                # Find first ETF price and last index price to compute scale factor
                first_etf_date  = etf_prices.index[0]
                # Use closest index price on or before ETF inception
                pre_splice = idx_prices[idx_prices.index < first_etf_date]

                if len(pre_splice) > 0:
                    last_idx_price   = pre_splice.iloc[-1]
                    first_etf_price  = etf_prices.iloc[0]
                    scale            = first_etf_price / last_idx_price if last_idx_price != 0 else 1.0
                    scaled_pre       = pre_splice * scale
                    combined         = pd.concat([scaled_pre, etf_prices])
                    combined         = combined[~combined.index.duplicated(keep="last")]
                    combined         = combined.sort_index()

        # ── Monthly returns ────────────────────────────────────────────────────
        monthly   = combined.resample("ME").last()
        returns   = monthly.pct_change().dropna()
        all_returns[name] = returns

    df = pd.DataFrame(all_returns)

    # Keep rows with at least 6 of 10 assets present; forward-fill small gaps.
    # Do NOT call dropna() — NaN is preserved for assets not yet launched.
    df = df.dropna(thresh=6)
    df = df.ffill(limit=2)

    return df


# ── Regime data ────────────────────────────────────────────────────────────────

def get_regime_history() -> pd.DataFrame:
    """Return regime labels indexed by date from the DB."""
    conn = _get_conn()
    df = pd.read_sql_query(
        "SELECT date, label AS regime, confidence FROM regimes ORDER BY date",
        conn,
        parse_dates=["date"],
    )
    conn.close()
    return df.set_index("date")


def get_current_regime() -> Tuple[str, float]:
    """Return (label, confidence) for the most recent regime row."""
    conn = _get_conn()
    df = pd.read_sql_query(
        "SELECT label, confidence FROM regimes ORDER BY date DESC LIMIT 1",
        conn,
    )
    conn.close()
    if df.empty:
        return "Unknown", 0.0
    return str(df.iloc[0]["label"]), float(df.iloc[0]["confidence"])


def get_risk_free_rate() -> float:
    """Return annualized risk-free rate from FEDFUNDS in raw_series, or 4.5% fallback."""
    conn = _get_conn()
    df = pd.read_sql_query(
        "SELECT value FROM raw_series WHERE series_id='FEDFUNDS' ORDER BY date DESC LIMIT 1",
        conn,
    )
    conn.close()
    if df.empty:
        return 0.045
    return float(df.iloc[0]["value"]) / 100.0


# ── Regime-conditional statistics ─────────────────────────────────────────────

def get_regime_conditional_stats(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    min_months: int = 12,
) -> Dict[str, Dict]:
    """Annualized mean, std, and Sharpe per regime (only regimes with ≥ min_months)."""
    rf = get_risk_free_rate()

    combined = returns.copy()
    combined["regime"] = regimes["regime"].reindex(returns.index, method="ffill")
    combined = combined.dropna(subset=["regime"])

    stats: Dict[str, Dict] = {}
    for regime in REGIME_LABELS:
        sub = combined.loc[combined["regime"] == regime].drop(columns=["regime"])
        sub = sub.dropna(axis=1, how="all")   # drop assets with zero observations this regime
        if len(sub) < min_months:
            continue
        mean_ann  = sub.mean() * 12           # skipna=True by default
        std_ann   = sub.std() * np.sqrt(12)
        sharpe    = (mean_ann - rf) / std_ann.replace(0, np.nan)
        stats[regime] = {
            "mean":     mean_ann,
            "std":      std_ann,
            "sharpe":   sharpe,
            "n_months": len(sub),
        }
    return stats


def get_regime_conditional_covariance(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    min_months: int = 24,
) -> Dict[str, pd.DataFrame]:
    """Annualized covariance matrix per regime (only regimes with ≥ min_months)."""
    combined = returns.copy()
    combined["regime"] = regimes["regime"].reindex(returns.index, method="ffill")
    combined = combined.dropna(subset=["regime"])

    covs: Dict[str, pd.DataFrame] = {}
    for regime in REGIME_LABELS:
        sub = combined.loc[combined["regime"] == regime].drop(columns=["regime"])
        sub = sub.dropna(axis=1, how="all")   # drop assets absent for this regime
        sub_clean = sub.dropna()              # rectangular block: rows with all remaining assets
        if len(sub_clean) < min_months:
            continue
        covs[regime] = sub_clean.cov() * 12
    return covs


def get_correlation_by_regime(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    min_months: int = 12,
) -> Dict[str, pd.DataFrame]:
    """Correlation matrix per regime."""
    combined = returns.copy()
    combined["regime"] = regimes["regime"].reindex(returns.index, method="ffill")
    combined = combined.dropna(subset=["regime"])

    corrs: Dict[str, pd.DataFrame] = {}
    for regime in REGIME_LABELS:
        sub = combined.loc[combined["regime"] == regime].drop(columns=["regime"])
        sub = sub.dropna(axis=1, how="all")
        sub_clean = sub.dropna()
        if len(sub_clean) < min_months:
            continue
        corrs[regime] = sub_clean.corr()
    return corrs


# ── Portfolio metrics ──────────────────────────────────────────────────────────

def _port_return(w: np.ndarray, mu: np.ndarray) -> float:
    return float(np.dot(w, mu))


def _port_vol(w: np.ndarray, cov: np.ndarray) -> float:
    v = float(np.sqrt(np.dot(w, np.dot(cov, w))))
    return max(v, 1e-10)


def _port_sharpe(w: np.ndarray, mu: np.ndarray, cov: np.ndarray, rf: float) -> float:
    return (_port_return(w, mu) - rf) / _port_vol(w, cov)


def _regularize(cov: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """Add tiny ridge to covariance to avoid singularity."""
    return cov + eps * np.eye(cov.shape[0])


def get_market_cap_weights() -> dict:
    """
    Approximate market cap weights for asset classes.
    Used as prior for Black-Litterman equilibrium.
    """
    return {
        "US Large Cap":     0.40,
        "US Small Cap":     0.05,
        "Int'l Developed":  0.20,
        "Emerging Markets": 0.08,
        "US Agg Bond":      0.10,
        "US Treasuries":    0.05,
        "IG Credit":        0.04,
        "High Yield":       0.02,
        "Commodities":      0.02,
        "Gold":             0.04,
    }


# ── Optimization methods ───────────────────────────────────────────────────────

def mean_variance_optimize(
    expected_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.045,
    max_weight: float = 0.40,
    min_weight: float = 0.0,
) -> Dict:
    """Maximum-Sharpe-ratio portfolio (Markowitz MVO)."""
    cov = _regularize(cov_matrix)
    n   = len(expected_returns)
    x0  = np.full(n, 1.0 / n)

    result = minimize(
        lambda w: -_port_sharpe(w, expected_returns, cov, risk_free_rate),
        x0,
        method="SLSQP",
        bounds=[(min_weight, max_weight)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}],
        options={"maxiter": 1000, "ftol": 1e-9},
    )

    w = result.x if result.success else x0
    w = np.clip(w, 0, max_weight)
    w /= w.sum()

    return {
        "weights":         w,
        "expected_return": _port_return(w, expected_returns),
        "volatility":      _port_vol(w, cov),
        "sharpe_ratio":    _port_sharpe(w, expected_returns, cov, risk_free_rate),
        "method":          "Mean-Variance (MVO)",
        "converged":       result.success,
    }


def minimum_variance_optimize(
    cov_matrix: np.ndarray,
    max_weight: float = 0.40,
    min_weight: float = 0.0,
) -> Dict:
    """Minimum-variance portfolio (ignores expected returns)."""
    cov = _regularize(cov_matrix)
    n   = cov.shape[0]
    x0  = np.full(n, 1.0 / n)

    result = minimize(
        lambda w: np.dot(w, np.dot(cov, w)),
        x0,
        method="SLSQP",
        bounds=[(min_weight, max_weight)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}],
        options={"maxiter": 1000, "ftol": 1e-9},
    )

    w = result.x if result.success else x0
    w = np.clip(w, 0, max_weight)
    w /= w.sum()

    return {
        "weights":   w,
        "volatility": _port_vol(w, cov),
        "method":    "Minimum Variance",
        "converged": result.success,
    }


def risk_parity_optimize(
    cov_matrix: np.ndarray,
    max_weight: float = 0.40,
    min_weight: float = 0.02,
) -> Dict:
    """
    Risk-parity portfolio: each asset contributes equally to total risk.
    RC_i = w_i * (Σw)_i / σ_p
    Objective: minimize Σ (RC_i - σ_p/n)²
    """
    cov = _regularize(cov_matrix)
    n   = cov.shape[0]

    # Start with inverse-volatility weights
    vols = np.sqrt(np.diag(cov))
    x0   = (1.0 / vols) / (1.0 / vols).sum()
    x0   = np.clip(x0, min_weight, max_weight)
    x0  /= x0.sum()

    def objective(w: np.ndarray) -> float:
        vol = _port_vol(w, cov)
        marginal = np.dot(cov, w)
        rc       = w * marginal / vol
        target   = vol / n
        return float(np.sum((rc - target) ** 2))

    result = minimize(
        objective,
        x0,
        method="SLSQP",
        bounds=[(min_weight, max_weight)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}],
        options={"maxiter": 2000, "ftol": 1e-10},
    )

    w = result.x if result.success else x0
    w = np.clip(w, min_weight, max_weight)
    w /= w.sum()

    vol      = _port_vol(w, cov)
    marginal = np.dot(cov, w)
    rc       = w * marginal / vol

    return {
        "weights":           w,
        "volatility":        vol,
        "risk_contributions": rc,
        "method":            "Risk Parity",
        "converged":         result.success,
    }


def black_litterman_optimize(
    cov_matrix: np.ndarray,
    asset_names: list,
    regime_returns: np.ndarray,
    risk_free_rate: float = 0.02,
    max_weight: float = 0.40,
    min_weight: float = 0.0,
    tau: float = 0.05,
    delta: float = 2.5,
) -> Dict:
    """
    Black-Litterman portfolio optimization.

    1. Start with equilibrium returns implied by market cap weights.
    2. Blend with "views" (regime-conditional returns).
    3. Optimize using blended expected returns.
    """
    n   = len(asset_names)
    reg = 1e-6 * np.eye(n)

    # Market cap weights (prior)
    mkt_caps = get_market_cap_weights()
    w_mkt = np.array([mkt_caps.get(name, 1.0 / n) for name in asset_names])
    w_mkt = w_mkt / w_mkt.sum()

    # Equilibrium returns: π = δ Σ w_mkt
    pi = delta * cov_matrix @ w_mkt

    # Views: absolute views on each asset
    P = np.eye(n)
    Q = regime_returns

    # View uncertainty
    omega = np.diag(tau * np.diag(P @ cov_matrix @ P.T))

    # BL master formula: posterior expected returns
    tau_cov_inv = np.linalg.inv(tau * cov_matrix + reg)
    omega_inv   = np.linalg.inv(omega + reg)
    M           = np.linalg.inv(tau_cov_inv + P.T @ omega_inv @ P + reg)
    bl_returns  = M @ (tau_cov_inv @ pi + P.T @ omega_inv @ Q)

    # Optimize Sharpe using BL returns
    def neg_sharpe(w: np.ndarray) -> float:
        ret = w @ bl_returns
        vol = np.sqrt(w @ cov_matrix @ w)
        return -(ret - risk_free_rate) / vol if vol > 0 else 0.0

    result = minimize(
        neg_sharpe,
        w_mkt,
        method="SLSQP",
        bounds=[(min_weight, max_weight)] * n,
        constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}],
        options={"maxiter": 1000},
    )

    weights  = result.x if result.success else w_mkt
    port_ret = float(weights @ bl_returns)
    port_vol = float(np.sqrt(weights @ cov_matrix @ weights))

    return {
        "weights":             weights,
        "expected_return":     port_ret,
        "volatility":          port_vol,
        "sharpe_ratio":        (port_ret - risk_free_rate) / port_vol if port_vol > 0 else 0.0,
        "method":              "Black-Litterman",
        "equilibrium_returns": pi,
        "blended_returns":     bl_returns,
        "converged":           result.success,
    }


def hierarchical_risk_parity_optimize(
    cov_matrix: np.ndarray,
    asset_names: list,
    max_weight: float = 0.40,
    min_weight: float = 0.02,
) -> Dict:
    """
    Hierarchical Risk Parity (López de Prado, 2016).

    1. Cluster assets by correlation distance.
    2. Build hierarchical tree via Ward linkage.
    3. Allocate recursively: split risk inversely proportional to cluster variance.
    """
    from scipy.cluster.hierarchy import linkage, leaves_list
    from scipy.spatial.distance import squareform

    n = len(asset_names)

    # Correlation matrix → distance matrix
    std  = np.sqrt(np.diag(cov_matrix))
    corr = cov_matrix / np.outer(std, std)
    corr = np.clip(corr, -1, 1)
    dist = np.sqrt(0.5 * (1 - corr))
    np.fill_diagonal(dist, 0)

    # Hierarchical clustering
    dist_condensed = squareform(dist)
    link           = linkage(dist_condensed, method="ward")
    sort_idx       = leaves_list(link)

    # Quasi-diagonalize covariance
    sorted_cov = cov_matrix[np.ix_(sort_idx, sort_idx)]

    def get_cluster_var(cov: np.ndarray, indices: list) -> float:
        sub = cov[np.ix_(indices, indices)]
        w   = np.ones(len(indices)) / len(indices)
        return float(w @ sub @ w)

    def recursive_bisection(cov: np.ndarray, indices: list) -> dict:
        if len(indices) == 1:
            return {indices[0]: 1.0}
        mid   = len(indices) // 2
        left  = indices[:mid]
        right = indices[mid:]
        var_l = get_cluster_var(cov, left)
        var_r = get_cluster_var(cov, right)
        alpha = 1 - var_l / (var_l + var_r)
        lw    = recursive_bisection(cov, left)
        rw    = recursive_bisection(cov, right)
        out   = {}
        for idx, w in lw.items():
            out[idx] = w * alpha
        for idx, w in rw.items():
            out[idx] = w * (1 - alpha)
        return out

    hrp_dict = recursive_bisection(sorted_cov, list(range(n)))

    # Map back to original asset order
    weights = np.zeros(n)
    for sorted_pos, w in hrp_dict.items():
        weights[sort_idx[sorted_pos]] = w

    # Apply constraints and renormalize
    weights = np.clip(weights, min_weight, max_weight)
    weights = weights / weights.sum()

    port_vol = float(np.sqrt(weights @ cov_matrix @ weights))

    return {
        "weights":       weights,
        "volatility":    port_vol,
        "method":        "Hierarchical Risk Parity",
        "cluster_order": [asset_names[i] for i in sort_idx],
    }


# ── Efficient frontier ─────────────────────────────────────────────────────────

def generate_efficient_frontier(
    expected_returns: np.ndarray,
    cov_matrix: np.ndarray,
    risk_free_rate: float = 0.045,
    n_points: int = 40,
    max_weight: float = 0.40,
    min_weight: float = 0.0,
) -> pd.DataFrame:
    """Parametric efficient frontier: min-variance at each target return level."""
    cov = _regularize(cov_matrix)
    n   = len(expected_returns)

    # Bounds for feasible return range
    min_var_w   = minimum_variance_optimize(cov, max_weight, min_weight)["weights"]
    min_var_ret = _port_return(min_var_w, expected_returns)
    max_ret     = float(np.dot(np.eye(n)[np.argmax(expected_returns)], expected_returns))

    # Avoid going all the way to max (often infeasible with weight caps)
    target_rets = np.linspace(min_var_ret, max_ret * 0.90, n_points)
    points: List[Dict] = []

    for tgt in target_rets:
        res = minimize(
            lambda w: np.dot(w, np.dot(cov, w)),
            np.full(n, 1.0 / n),
            method="SLSQP",
            bounds=[(min_weight, max_weight)] * n,
            constraints=[
                {"type": "eq", "fun": lambda w: np.sum(w) - 1},
                {"type": "eq", "fun": lambda w, t=tgt: _port_return(w, expected_returns) - t},
            ],
            options={"maxiter": 1000, "ftol": 1e-9},
        )
        if res.success:
            w   = np.clip(res.x, 0, max_weight)
            vol = _port_vol(w, cov)
            ret = _port_return(w, expected_returns)
            points.append({
                "volatility": vol,
                "return":     ret,
                "sharpe":     (ret - risk_free_rate) / vol,
            })

    return pd.DataFrame(points)


# ── Drawdown analysis ──────────────────────────────────────────────────────────

def calculate_drawdowns(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
) -> Dict:
    """Max drawdown by asset class, overall and by regime."""
    cum      = (1 + returns).cumprod()
    run_max  = cum.cummax()
    dd_series = (cum - run_max) / run_max

    combined = dd_series.copy()
    combined["regime"] = regimes["regime"].reindex(dd_series.index, method="ffill")
    combined = combined.dropna(subset=["regime"])

    by_regime: Dict[str, pd.Series] = {}
    for regime in REGIME_LABELS:
        sub = combined.loc[combined["regime"] == regime].drop(columns=["regime"])
        if len(sub) > 0:
            by_regime[regime] = sub.min()

    return {
        "by_regime": pd.DataFrame(by_regime),
        "overall":   dd_series.min(),
    }


# ── CVaR / Expected Shortfall ──────────────────────────────────────────────────

def calculate_cvar(
    returns: pd.DataFrame,
    weights: np.ndarray = None,
    confidence: float = 0.95,
) -> Dict:
    """
    Calculate Conditional Value-at-Risk (Expected Shortfall).

    CVaR answers: "In the worst X% of periods, what's the average loss?"
    More informative than VaR because it captures tail severity, not just threshold.
    """
    alpha = 1 - confidence

    asset_cvar: Dict[str, Dict] = {}
    for col in returns.columns:
        sorted_rets = returns[col].dropna().sort_values()
        cutoff_idx  = int(len(sorted_rets) * alpha)
        if cutoff_idx > 0:
            worst = sorted_rets.iloc[:cutoff_idx]
            asset_cvar[col] = {
                "cvar":      float(worst.mean()),
                "var":       float(sorted_rets.iloc[cutoff_idx]),
                "n_periods": cutoff_idx,
            }
        else:
            asset_cvar[col] = {
                "cvar":      float(sorted_rets.min()),
                "var":       float(sorted_rets.min()),
                "n_periods": 1,
            }

    portfolio_cvar = None
    if weights is not None:
        port_returns = (returns * weights).sum(axis=1)
        sorted_port  = port_returns.dropna().sort_values()
        cutoff_idx   = int(len(sorted_port) * alpha)
        if cutoff_idx > 0:
            worst_port = sorted_port.iloc[:cutoff_idx]
            portfolio_cvar = {
                "cvar":          float(worst_port.mean()),
                "var":           float(sorted_port.iloc[cutoff_idx]),
                "worst_periods": sorted_port.iloc[:5].to_dict(),
            }
        else:
            portfolio_cvar = {
                "cvar":          float(sorted_port.min()),
                "var":           float(sorted_port.min()),
                "worst_periods": sorted_port.iloc[:1].to_dict(),
            }

    return {
        "confidence":    confidence,
        "asset_cvar":    asset_cvar,
        "portfolio_cvar": portfolio_cvar,
    }


def calculate_regime_cvar(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    confidence: float = 0.95,
) -> Dict:
    """CVaR conditioned on each regime. Shows how tail risk varies by macro environment."""
    rets = returns.copy()
    rets.index = _normalize_month(pd.to_datetime(rets.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()

    merged = rets.merge(reg[["date", "label"]], left_index=True, right_on="date", how="inner")

    result: Dict[str, Optional[Dict]] = {}
    for regime in REGIME_LABELS:
        subset = merged[merged["label"] == regime].drop(columns=["date", "label"])
        if len(subset) >= 5:
            result[regime] = calculate_cvar(subset, confidence=confidence)
        else:
            result[regime] = None
    return result


# ── Regime transition P&L attribution ──────────────────────────────────────────

def calculate_transition_pnl(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    lookforward_months: int = 3,
) -> Dict:
    """
    Average forward returns after each regime transition.

    Answers: "When we shifted from Goldilocks → Overheating, which assets
    drove gains/losses over the next N months?"
    """
    rets = returns.copy()
    rets.index = _normalize_month(pd.to_datetime(rets.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()
    reg = reg.sort_values("date").reset_index(drop=True)

    # Detect transitions
    transitions = []
    for i in range(1, len(reg)):
        prev, curr = reg.iloc[i - 1]["label"], reg.iloc[i]["label"]
        if prev != curr:
            transitions.append({"date": reg.iloc[i]["date"], "from": prev, "to": curr})

    # Collect forward returns per transition pair
    buckets: Dict[str, Dict] = {}
    for t in transitions:
        key = f"{t['from']} \u2192 {t['to']}"
        if key not in buckets:
            buckets[key] = {"count": 0, "returns": []}
        end_date = t["date"] + pd.DateOffset(months=lookforward_months)
        fwd = rets[(rets.index >= t["date"]) & (rets.index < end_date)]
        if len(fwd) > 0:
            cumulative = (1 + fwd).prod() - 1
            buckets[key]["count"] += 1
            buckets[key]["returns"].append(cumulative)

    # Aggregate
    results: Dict[str, Dict] = {}
    for key, data in buckets.items():
        if data["count"] > 0:
            avg_rets = pd.concat(data["returns"], axis=1).mean(axis=1)
            results[key] = {
                "count":        data["count"],
                "avg_return":   avg_rets.to_dict(),
                "total_return": float(avg_rets.sum()),
            }
    return results


# ── Real vs nominal returns ─────────────────────────────────────────────────────

def calculate_real_returns(
    nominal_returns: pd.DataFrame,
    cpi_series: pd.Series,
) -> pd.DataFrame:
    """Convert nominal returns to real (inflation-adjusted) returns."""
    cpi       = cpi_series.sort_index()
    inflation = cpi.pct_change()

    nom = nominal_returns.copy()
    nom.index = _normalize_month(pd.to_datetime(nom.index))
    inflation.index = _normalize_month(pd.to_datetime(inflation.index))
    inflation = inflation.reindex(nom.index, method="ffill")

    real = pd.DataFrame(index=nom.index)
    for col in nom.columns:
        real[col] = (1 + nom[col]) / (1 + inflation) - 1
    return real


def get_real_vs_nominal_summary(
    returns: pd.DataFrame,
    regimes: pd.DataFrame,
    cpi_series: pd.Series,
) -> Dict:
    """
    Compare real vs nominal annualised returns by regime.

    Key insight: Stagflation shows positive nominal but negative real returns —
    critical for liability-driven investors (pensions, endowments).
    """
    real_rets = calculate_real_returns(returns, cpi_series)

    nom  = returns.copy()
    nom.index  = _normalize_month(pd.to_datetime(nom.index))
    real_rets.index = _normalize_month(pd.to_datetime(real_rets.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()

    summary: Dict[str, Dict] = {}
    for regime in REGIME_LABELS:
        regime_dates = reg[reg["label"] == regime]["date"]
        nom_sub  = nom[nom.index.isin(regime_dates)]
        real_sub = real_rets[real_rets.index.isin(regime_dates)]
        if len(nom_sub) > 0:
            summary[regime] = {
                "nominal":          (nom_sub.mean()  * 12).to_dict(),
                "real":             (real_sub.mean() * 12).to_dict(),
                "inflation_drag":   ((nom_sub.mean() - real_sub.mean()) * 12).to_dict(),
                "n_months":         len(nom_sub),
            }
    return summary


# ── Factor decomposition ──────────────────────────────────────────────────────

def get_factor_returns() -> pd.DataFrame:
    """
    Fetch factor proxy returns using long/short ETF pairs.

    Factor return = Long ETF return − Short ETF return.
    Mimics Fama-French factor construction without their data files.
    """
    tickers: set = set()
    for proxy in FACTOR_PROXIES.values():
        tickers.add(proxy["long"])
        tickers.add(proxy["short"])

    data = yf.download(sorted(tickers), period="max", interval="1mo", progress=False)
    # Handle both flat and MultiIndex columns from yfinance
    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"]
    else:
        prices = data
    rets = prices.pct_change().dropna()

    factor_rets = pd.DataFrame(index=rets.index)
    for factor, proxy in FACTOR_PROXIES.items():
        lng, sht = proxy["long"], proxy["short"]
        if lng in rets.columns and sht in rets.columns:
            factor_rets[factor] = rets[lng] - rets[sht]

    return factor_rets.dropna(how="all")


def calculate_factor_exposures(
    portfolio_returns: pd.Series,
    factor_returns: pd.DataFrame,
) -> Optional[Dict]:
    """
    Regress portfolio returns on factor returns (OLS) to get factor betas.

    R_portfolio = alpha + sum(beta_i * F_i) + epsilon
    """
    from sklearn.linear_model import LinearRegression

    port = portfolio_returns.copy()
    port.index = _normalize_month(pd.to_datetime(port.index))
    facts = factor_returns.copy()
    facts.index = _normalize_month(pd.to_datetime(facts.index))
    aligned = pd.concat([port, facts], axis=1).dropna()
    if len(aligned) < 12:
        return None

    y = aligned.iloc[:, 0].values
    X = aligned.iloc[:, 1:].values

    model = LinearRegression().fit(X, y)
    return {
        "exposures":  dict(zip(factor_returns.columns, [float(c) for c in model.coef_])),
        "r_squared":  float(model.score(X, y)),
        "alpha":      float(model.intercept_) * 12,
    }


def calculate_regime_factor_performance(
    factor_returns: pd.DataFrame,
    regimes: pd.DataFrame,
) -> Dict:
    """Annualised factor returns by regime."""
    frets = factor_returns.copy()
    frets.index = _normalize_month(pd.to_datetime(frets.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()

    merged = frets.merge(reg[["date", "label"]], left_index=True, right_on="date", how="inner")

    result: Dict[str, Dict[str, float]] = {}
    for regime in REGIME_LABELS:
        sub = merged[merged["label"] == regime].drop(columns=["date", "label"])
        if len(sub) >= 6:
            result[regime] = {col: float(sub[col].mean() * 12) for col in sub.columns}
    return result


# ── Style / manager selection ─────────────────────────────────────────────────

def get_style_returns() -> pd.DataFrame:
    """Fetch style ETF monthly returns."""
    tickers = sorted(set(STYLE_ETFS.values()))
    data = yf.download(tickers, period="max", interval="1mo", progress=False)
    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"]
    else:
        prices = data
    rets = prices.pct_change().dropna()

    style_rets = pd.DataFrame(index=rets.index)
    for style, ticker in STYLE_ETFS.items():
        if ticker in rets.columns:
            style_rets[style] = rets[ticker]
    return style_rets.dropna(how="all")


def calculate_style_regime_performance(
    regimes: pd.DataFrame,
) -> Optional[Dict]:
    """
    Style performance by regime: return, vol, Sharpe, hit-rate.
    Includes Growth-Value and Small-Large spread analysis.
    """
    style_rets = get_style_returns()
    style_rets.index = _normalize_month(pd.to_datetime(style_rets.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()

    merged = style_rets.merge(reg[["date", "label"]], left_index=True, right_on="date", how="inner")

    results: Dict[str, Dict] = {}
    for regime in REGIME_LABELS:
        sub = merged[merged["label"] == regime].drop(columns=["date", "label"])
        if len(sub) < 6:
            continue
        results[regime] = {}
        for col in sub.columns:
            s = sub[col].dropna()
            ann_ret = float(s.mean() * 12)
            ann_vol = float(s.std() * np.sqrt(12))
            results[regime][col] = {
                "return":     ann_ret,
                "volatility": ann_vol,
                "sharpe":     ann_ret / ann_vol if ann_vol > 0 else 0.0,
                "hit_rate":   float((s > 0).mean()),
            }
        # Spread analysis
        if "Growth" in results[regime] and "Value" in results[regime]:
            results[regime]["Growth-Value Spread"] = {
                "return": results[regime]["Growth"]["return"] - results[regime]["Value"]["return"],
            }
        if "Small Cap" in results[regime] and "Large Cap" in results[regime]:
            results[regime]["Small-Large Spread"] = {
                "return": results[regime]["Small Cap"]["return"] - results[regime]["Large Cap"]["return"],
            }
    return results or None


# ── Currency overlay ──────────────────────────────────────────────────────────

def get_currency_returns() -> pd.DataFrame:
    """Fetch currency / FX pair monthly returns."""
    tickers = sorted(set(CURRENCY_PAIRS.values()))
    data = yf.download(tickers, period="max", interval="1mo", progress=False)
    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"]
    else:
        prices = data
    rets = prices.pct_change().dropna()

    reverse_map = {v: k for k, v in CURRENCY_PAIRS.items()}
    rets.columns = [reverse_map.get(c, c) for c in rets.columns]

    # JPY=X gives USD/JPY (yen per dollar).  Invert so positive = JPY strength.
    if "USD/JPY" in rets.columns:
        rets["USD/JPY"] = -rets["USD/JPY"]

    return rets.dropna(how="all")


def calculate_currency_regime_impact(
    regimes: pd.DataFrame,
) -> Optional[Dict]:
    """FX performance (return + vol) by regime."""
    fx = get_currency_returns()
    fx.index = _normalize_month(pd.to_datetime(fx.index))
    reg = regimes.copy()
    reg["date"] = pd.to_datetime(reg["date"]).dt.to_period("M").dt.to_timestamp()

    merged = fx.merge(reg[["date", "label"]], left_index=True, right_on="date", how="inner")

    results: Dict[str, Dict] = {}
    for regime in REGIME_LABELS:
        sub = merged[merged["label"] == regime].drop(columns=["date", "label"])
        if len(sub) >= 6:
            results[regime] = {
                col: {
                    "return":     float(sub[col].mean() * 12),
                    "volatility": float(sub[col].std() * np.sqrt(12)),
                }
                for col in sub.columns
            }
    return results or None


def calculate_hedging_impact(
    portfolio_returns: pd.Series,
    fx_returns: pd.DataFrame,
    hedge_ratio: float = 0.5,
) -> Optional[Dict]:
    """Simplified FX hedging impact estimate using EUR/USD as primary hedge."""
    aligned = pd.concat([portfolio_returns, fx_returns], axis=1).dropna()
    if len(aligned) < 12 or "EUR/USD" not in aligned.columns:
        return None

    port = aligned.iloc[:, 0]
    fx   = aligned["EUR/USD"]
    hedged = port - (fx * hedge_ratio)

    return {
        "unhedged_return":  float(port.mean() * 12),
        "hedged_return":    float(hedged.mean() * 12),
        "unhedged_vol":     float(port.std() * np.sqrt(12)),
        "hedged_vol":       float(hedged.std() * np.sqrt(12)),
        "hedging_benefit":  float((hedged.std() - port.std()) * np.sqrt(12)),
    }


# ── Main entry point ───────────────────────────────────────────────────────────

def get_allocation_data() -> Dict:
    """
    Fetch all data, run optimizations, and return a dict for the dashboard.

    Keys:
        current_regime, confidence, rf_rate,
        regime_stats, regime_correlations,
        optimizations (mvo/min_var/risk_parity/frontier/asset_names) or None,
        drawdowns, data_start, data_end, n_months, asset_classes
    """
    print("Fetching asset returns (this may take ~30s on first run)...")
    returns = get_asset_returns(start_date="1990-01-01")
    n_months   = len(returns)
    data_start = returns.index[0].strftime("%Y-%m") if n_months else "N/A"
    data_end   = returns.index[-1].strftime("%Y-%m") if n_months else "N/A"
    print(f"  {n_months} months  ({data_start} → {data_end})  ×  {len(returns.columns)} assets")

    regimes         = get_regime_history()
    current_regime, confidence = get_current_regime()
    rf_rate         = get_risk_free_rate()
    regime_stats    = get_regime_conditional_stats(returns, regimes)
    regime_cov      = get_regime_conditional_covariance(returns, regimes)
    regime_corr     = get_correlation_by_regime(returns, regimes)
    drawdowns       = calculate_drawdowns(returns, regimes)

    print(f"Current regime: {current_regime}  ({confidence:.0%})")
    print(f"Risk-free rate: {rf_rate:.2%}")

    optimizations = None
    if current_regime in regime_stats and current_regime in regime_cov:
        # Intersect: only assets with a non-NaN mean AND present in the cov matrix
        stats_assets = [
            a for a in regime_stats[current_regime]["mean"].index
            if not np.isnan(regime_stats[current_regime]["mean"][a])
        ]
        cov_df      = regime_cov[current_regime]
        asset_names = [a for a in stats_assets if a in cov_df.index]

        mu  = regime_stats[current_regime]["mean"][asset_names].values
        cov = cov_df.loc[asset_names, asset_names].values

        print("\nRunning optimizations...")
        mvo      = mean_variance_optimize(mu, cov, rf_rate)
        min_var  = minimum_variance_optimize(cov)
        rp       = risk_parity_optimize(cov)

        # Fill in return / Sharpe for methods that don't compute them internally
        for res in (min_var, rp):
            res["expected_return"] = _port_return(res["weights"], mu)
            res["sharpe_ratio"]    = _port_sharpe(res["weights"], mu, cov, rf_rate)

        # Black-Litterman (with fallback)
        try:
            bl_result = black_litterman_optimize(cov, asset_names, mu, rf_rate)
        except Exception as e:
            print(f"  Black-Litterman failed: {e}, using equal weights")
            eq_w = np.ones(len(asset_names)) / len(asset_names)
            bl_result = {
                "weights":         eq_w,
                "expected_return": float(eq_w @ mu),
                "volatility":      float(np.sqrt(eq_w @ cov @ eq_w)),
                "sharpe_ratio":    0.0,
                "method":          "Black-Litterman (fallback)",
                "converged":       False,
            }

        # Hierarchical Risk Parity (with fallback)
        try:
            hrp_result = hierarchical_risk_parity_optimize(cov, asset_names)
            hrp_result["expected_return"] = float(hrp_result["weights"] @ mu)
            hrp_result["sharpe_ratio"]    = _port_sharpe(
                hrp_result["weights"], mu, cov, rf_rate
            )
        except Exception as e:
            print(f"  HRP failed: {e}, using equal weights")
            eq_w = np.ones(len(asset_names)) / len(asset_names)
            hrp_result = {
                "weights":         eq_w,
                "expected_return": float(eq_w @ mu),
                "volatility":      float(np.sqrt(eq_w @ cov @ eq_w)),
                "sharpe_ratio":    0.0,
                "method":          "HRP (fallback)",
            }

        frontier = generate_efficient_frontier(mu, cov, rf_rate)

        for label, res in [
            ("MVO", mvo), ("Min Var", min_var), ("Risk Parity", rp),
            ("Black-Litterman", bl_result), ("HRP", hrp_result),
        ]:
            print(f"  {label:16s}  ret={res['expected_return']:+.1%}  "
                  f"vol={res['volatility']:.1%}  Sharpe={res['sharpe_ratio']:.2f}")

        optimizations = {
            "mvo":              mvo,
            "min_var":          min_var,
            "risk_parity":      rp,
            "black_litterman":  bl_result,
            "hrp":              hrp_result,
            "frontier":         frontier,
            "asset_names":      asset_names,
        }

    # ── Risk analytics (CVaR, transitions, real returns) ───────────────────────
    print("\nComputing risk analytics...")

    # Fetch CPI from DB (standalone — no src.config import)
    cpi_series = None
    try:
        with _get_conn() as conn:
            cpi_df = pd.read_sql(
                "SELECT date, value FROM raw_series WHERE series_id='CPIAUCSL' ORDER BY date",
                conn,
            )
        if not cpi_df.empty:
            cpi_df["date"] = pd.to_datetime(cpi_df["date"])
            cpi_series = cpi_df.set_index("date")["value"]
            print(f"  CPI series: {len(cpi_series)} rows")
        else:
            print("  CPI series: empty (CPIAUCSL not in raw_series)")
    except Exception as e:
        print(f"  CPI fetch failed: {e}")

    # Fetch regimes table (separate from regime_history which uses a different schema)
    regimes_df = pd.DataFrame()
    try:
        with _get_conn() as conn:
            regimes_df = pd.read_sql(
                "SELECT date, label FROM regimes ORDER BY date", conn
            )
    except Exception as e:
        print(f"  Regimes fetch failed: {e}")

    cvar_95     = calculate_cvar(returns, confidence=0.95)
    cvar_99     = calculate_cvar(returns, confidence=0.99)
    regime_cvar = calculate_regime_cvar(returns, regimes_df, confidence=0.95) if not regimes_df.empty else {}

    # Add portfolio CVaR per optimisation method
    if optimizations is not None:
        opt_assets = optimizations.get("asset_names", list(returns.columns))
        for key in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp"):
            if key in optimizations:
                w = np.array(optimizations[key]["weights"])
                optimizations[key]["cvar_95"] = calculate_cvar(
                    returns[opt_assets], weights=w, confidence=0.95
                )["portfolio_cvar"]

    transition_pnl = calculate_transition_pnl(returns, regimes_df) if not regimes_df.empty else {}

    real_nominal = None
    if cpi_series is not None and not regimes_df.empty:
        try:
            real_nominal = get_real_vs_nominal_summary(returns, regimes_df, cpi_series)
            print(f"  Real/nominal: {len(real_nominal)} regimes" if real_nominal else "  Real/nominal: empty result")
        except Exception as e:
            print(f"  Real/nominal calc failed: {e}")
    else:
        print(f"  Skipping real/nominal: cpi={'None' if cpi_series is None else 'OK'}, "
              f"regimes={'empty' if regimes_df.empty else len(regimes_df)}")

    print("  Risk analytics done.")

    # ── Factor / style / currency analytics ────────────────────────────────────
    print("Computing factor, style, and currency analytics...")

    regime_factors: Optional[Dict]     = None
    portfolio_factors: Dict[str, Dict] = {}
    try:
        factor_rets = get_factor_returns()
        if not regimes_df.empty:
            regime_factors = calculate_regime_factor_performance(factor_rets, regimes_df)
        if optimizations is not None:
            opt_assets = optimizations.get("asset_names", list(returns.columns))
            for key in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp"):
                if key in optimizations:
                    w = np.array(optimizations[key]["weights"])
                    port_rets = (returns[opt_assets] * w).sum(axis=1)
                    exp = calculate_factor_exposures(port_rets, factor_rets)
                    if exp:
                        portfolio_factors[key] = exp
    except Exception as e:
        print(f"  Factor analysis failed: {e}")

    style_performance: Optional[Dict] = None
    try:
        if not regimes_df.empty:
            style_performance = calculate_style_regime_performance(regimes_df)
    except Exception as e:
        print(f"  Style analysis failed: {e}")

    currency_impact: Optional[Dict] = None
    try:
        if not regimes_df.empty:
            currency_impact = calculate_currency_regime_impact(regimes_df)
    except Exception as e:
        print(f"  Currency analysis failed: {e}")

    print("  Factor/style/currency done.")

    return {
        "current_regime":      current_regime,
        "confidence":          confidence,
        "rf_rate":             rf_rate,
        "regime_stats":        regime_stats,
        "regime_correlations": regime_corr,
        "optimizations":       optimizations,
        "drawdowns":           drawdowns,
        "data_start":          data_start,
        "data_end":            data_end,
        "n_months":            n_months,
        "asset_classes":       list(ASSET_CLASSES.keys()),
        "cvar_95":             cvar_95,
        "cvar_99":             cvar_99,
        "regime_cvar":         regime_cvar,
        "transition_pnl":      transition_pnl,
        "real_nominal":        real_nominal,
        "regime_factors":      regime_factors,
        "portfolio_factors":   portfolio_factors,
        "style_performance":   style_performance,
        "currency_impact":     currency_impact,
    }


# ── CLI test ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("ASSET ALLOCATION MODULE TEST")
    print("=" * 60)

    data = get_allocation_data()

    print(f"\n{'=' * 60}")
    print("RESULTS SUMMARY")
    print("=" * 60)
    print(f"Data: {data['n_months']} months ({data['data_start']} → {data['data_end']})")
    print(f"Risk-free rate: {data['rf_rate']:.2%}")

    if data["optimizations"]:
        opt = data["optimizations"]
        print("\n--- Optimization Results (5 Methods) ---")
        for key in ("mvo", "min_var", "risk_parity", "black_litterman", "hrp"):
            if key not in opt:
                continue
            r = opt[key]
            print(f"\n{r['method']}:")
            print(f"  Expected Return : {r['expected_return']:+.1%}")
            print(f"  Volatility      : {r['volatility']:.1%}")
            print(f"  Sharpe Ratio    : {r['sharpe_ratio']:.2f}")
            ranked = sorted(zip(opt["asset_names"], r["weights"]), key=lambda x: x[1], reverse=True)
            print("  Top holdings:")
            for name, w in ranked[:5]:
                if w > 0.01:
                    print(f"    {name:<22} {w:.1%}")

    print("\n--- Regime-Conditional Returns ---")
    for regime, s in data["regime_stats"].items():
        print(f"\n{regime} ({s['n_months']} months):")
        for asset in s["mean"].nlargest(3).index:
            print(f"  {asset:<22} {s['mean'][asset]:+.1%}")
