"""
src/data/openbb_client.py — Unified data-access wrappers via OpenBB.

Additive layer alongside the existing yfinance + FRED pipelines — does not
replace them. Used for data sources the current pipeline cannot reach
(notably Fama-French factors) and as a consistent interface for future
expansion.

Does NOT import src.config (avoids FRED_API_KEY EnvironmentError). Keys
are resolved via st.secrets → os.environ fall-through, mirroring the
get_secret() pattern in src/config.py.

Public surface:
    fetch_equity_prices(symbol, start, end)        -> pd.DataFrame
    fetch_economic_indicator(series_id, start, end) -> pd.DataFrame
    fetch_fama_french_factors(start, end)          -> pd.DataFrame
    fetch_and_store_fama_french(conn, start="1990-01-01") -> int

Graceful failure: any upstream error (missing key, network, OpenBB import
failure, upstream schema change) returns an empty DataFrame and logs a
warning. Callers must be empty-safe.
"""

from __future__ import annotations

import io
import logging
import os
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

logger = logging.getLogger(__name__)

_FF5_DAILY_URL = (
    "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
    "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
)

_EQUITY_COLS  = ["date", "open", "high", "low", "close", "volume"]
_FF_COLS      = ["date", "mkt_rf", "smb", "hml", "rmw", "cma", "rf"]
_FRED_COLS    = ["date", "value"]


# ── Secret resolution (no src.config import) ────────────────────────────────
def _get_secret(key: str) -> str:
    try:
        import streamlit as st
        return st.secrets.get(key, os.environ.get(key, ""))
    except Exception:
        return os.environ.get(key, "")


# ── OpenBB lazy init ────────────────────────────────────────────────────────
_obb = None


def _get_obb():
    """Lazy-import and configure OpenBB. Returns None on any failure."""
    global _obb
    if _obb is not None:
        return _obb
    try:
        from openbb import obb  # type: ignore
    except Exception as exc:
        logger.warning("[openbb_client] OpenBB import failed: %s", exc)
        return None

    fred_key = _get_secret("FRED_API_KEY")
    if fred_key:
        try:
            obb.user.credentials.fred_api_key = fred_key
        except Exception as exc:
            logger.warning("[openbb_client] could not set FRED key: %s", exc)

    _obb = obb
    return obb


def _to_df(output) -> pd.DataFrame:
    """Best-effort conversion of an OpenBB OBBject to a pandas DataFrame."""
    if output is None:
        return pd.DataFrame()
    for attr in ("to_dataframe", "to_df"):
        fn = getattr(output, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:
                pass
    results = getattr(output, "results", output)
    try:
        if isinstance(results, list):
            records = [r.model_dump() if hasattr(r, "model_dump") else dict(r) for r in results]
            return pd.DataFrame(records)
    except Exception as exc:
        logger.warning("[openbb_client] dataframe conversion failed: %s", exc)
    return pd.DataFrame()


# ── Public wrappers ─────────────────────────────────────────────────────────
def fetch_equity_prices(symbol: str, start: str, end: str) -> pd.DataFrame:
    """
    Fetch historical daily OHLCV for a single symbol via OpenBB.

    Returns columns: date, open, high, low, close, volume.
    """
    obb = _get_obb()
    if obb is None:
        return pd.DataFrame(columns=_EQUITY_COLS)
    try:
        output = obb.equity.price.historical(
            symbol=symbol, start_date=start, end_date=end, provider="yfinance"
        )
        df = _to_df(output)
    except Exception as exc:
        logger.warning("[openbb_client] equity.price.historical failed for %s: %s", symbol, exc)
        return pd.DataFrame(columns=_EQUITY_COLS)

    if df.empty:
        return pd.DataFrame(columns=_EQUITY_COLS)

    if "date" not in df.columns and df.index.name == "date":
        df = df.reset_index()
    keep = [c for c in _EQUITY_COLS if c in df.columns]
    return df[keep].copy()


def fetch_economic_indicator(series_id: str, start: str, end: str) -> pd.DataFrame:
    """
    Fetch a FRED economic series via OpenBB.

    Returns columns: date, value.
    """
    obb = _get_obb()
    if obb is None:
        return pd.DataFrame(columns=_FRED_COLS)
    try:
        output = obb.economy.fred_series(
            symbol=series_id, start_date=start, end_date=end, provider="fred"
        )
        df = _to_df(output)
    except Exception as exc:
        logger.warning("[openbb_client] economy.fred_series failed for %s: %s", series_id, exc)
        return pd.DataFrame(columns=_FRED_COLS)

    if df.empty:
        return pd.DataFrame(columns=_FRED_COLS)
    if "date" not in df.columns and df.index.name == "date":
        df = df.reset_index()
    # FRED returns a value column named after the series — normalize
    value_col = series_id if series_id in df.columns else (
        "value" if "value" in df.columns else next(
            (c for c in df.columns if c != "date"), None
        )
    )
    if value_col is None:
        return pd.DataFrame(columns=_FRED_COLS)
    out = df[["date", value_col]].rename(columns={value_col: "value"})
    return out


def fetch_fama_french_factors(
    start: str = "1990-01-01",
    end: str | None = None,
) -> pd.DataFrame:
    """
    Fetch Ken French's 5-factor daily data and return a normalized DataFrame.

    OpenBB 4.x does not expose a Fama-French endpoint, so this wrapper goes
    directly to Ken French's data library. Kept inside openbb_client so the
    rest of the codebase still has a single "unified data layer" interface.

    Returns columns: date, mkt_rf, smb, hml, rmw, cma, rf — values in decimal
    form (e.g. 0.00123 for 12.3 bps daily), *not* percent.
    """
    try:
        resp = requests.get(_FF5_DAILY_URL, timeout=30)
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("[openbb_client] Fama-French download failed: %s", exc)
        return pd.DataFrame(columns=_FF_COLS)

    try:
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
            raw = zf.read(csv_name).decode("latin-1")
    except Exception as exc:
        logger.warning("[openbb_client] Fama-French zip decode failed: %s", exc)
        return pd.DataFrame(columns=_FF_COLS)

    # The CSV has a preamble and a trailing annual section — find the header
    # line that starts with ",Mkt-RF,SMB,..." and take daily rows from there.
    lines = raw.splitlines()
    header_idx = next(
        (i for i, line in enumerate(lines) if line.strip().startswith(",Mkt-RF")),
        None,
    )
    if header_idx is None:
        logger.warning("[openbb_client] Fama-French: header row not found.")
        return pd.DataFrame(columns=_FF_COLS)

    # Read daily rows until a blank line or the "Annual Factors" marker
    data_lines: list[str] = []
    for line in lines[header_idx + 1:]:
        s = line.strip()
        if not s or s.lower().startswith("annual"):
            break
        # Daily rows start with YYYYMMDD — skip any preamble text
        head = s.split(",", 1)[0].strip()
        if not (head.isdigit() and len(head) == 8):
            continue
        data_lines.append(line)

    if not data_lines:
        return pd.DataFrame(columns=_FF_COLS)

    try:
        df = pd.read_csv(
            io.StringIO(lines[header_idx] + "\n" + "\n".join(data_lines)),
            dtype=str,
        )
    except Exception as exc:
        logger.warning("[openbb_client] Fama-French parse failed: %s", exc)
        return pd.DataFrame(columns=_FF_COLS)

    df = df.rename(columns={df.columns[0]: "date"})
    rename = {"Mkt-RF": "mkt_rf", "SMB": "smb", "HML": "hml",
              "RMW": "rmw", "CMA": "cma", "RF": "rf"}
    df = df.rename(columns=rename).copy()

    df.loc[:, "date"] = pd.to_datetime(df["date"], format="%Y%m%d", errors="coerce")
    for col in ["mkt_rf", "smb", "hml", "rmw", "cma", "rf"]:
        df.loc[:, col] = pd.to_numeric(df[col], errors="coerce") / 100.0  # published in percent
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

    if start:
        df = df.loc[df["date"] >= pd.to_datetime(start)].copy()
    if end:
        df = df.loc[df["date"] <= pd.to_datetime(end)].copy()
    df.loc[:, "date"] = df["date"].dt.strftime("%Y-%m-%d")
    return df[_FF_COLS].reset_index(drop=True)


# ── Store to DB ─────────────────────────────────────────────────────────────
def fetch_and_store_fama_french(
    conn: sqlite3.Connection,
    start: str = "1990-01-01",
) -> int:
    """Fetch FF5 daily and upsert into the `factor_data` table. Returns row count."""
    df = fetch_fama_french_factors(start=start)
    if df.empty:
        logger.warning("[openbb_client] Fama-French returned no rows — nothing stored.")
        return 0

    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    rows = [
        (r.date, r.mkt_rf, r.smb, r.hml, r.rmw, r.cma, r.rf,
         "openbb_kenneth_french", fetched_at)
        for r in df.itertuples(index=False)
    ]
    conn.executemany(
        """
        INSERT INTO factor_data (date, mkt_rf, smb, hml, rmw, cma, rf, source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            mkt_rf=excluded.mkt_rf, smb=excluded.smb, hml=excluded.hml,
            rmw=excluded.rmw, cma=excluded.cma, rf=excluded.rf,
            source=excluded.source, fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    logger.info("[openbb_client] Fama-French: %d rows upserted into factor_data.", len(rows))
    return len(rows)


# ── CLI entry for one-shot backfill ─────────────────────────────────────────
def _default_db_path() -> Path:
    return Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db = _default_db_path()
    conn = sqlite3.connect(db)
    try:
        n = fetch_and_store_fama_french(conn)
        print(f"[openbb_client] factor_data rows written: {n}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
