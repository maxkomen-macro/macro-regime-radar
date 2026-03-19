from pathlib import Path
import os
from dotenv import load_dotenv

# ── Paths ──────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR      = PROJECT_ROOT / "data"
RAW_DIR       = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
DB_PATH       = DATA_DIR / "macro_radar.db"

# ── FRED API ───────────────────────────────────────────────────────────────
load_dotenv(PROJECT_ROOT / ".env")
FRED_API_KEY = os.getenv("FRED_API_KEY")

if not FRED_API_KEY:
    raise EnvironmentError("FRED_API_KEY not found in environment or .env file")

# ── FRED Series IDs ────────────────────────────────────────────────────────
SERIES = {
    "growth":       "INDPRO",    # Industrial Production Index (monthly)
    "inflation":    "CPIAUCSL",  # CPI All Urban Consumers (monthly)
    "yield_10y":    "DGS10",     # 10-Year Treasury Constant Maturity Rate (daily)
    "yield_2y":     "DGS2",      # 2-Year Treasury Constant Maturity Rate (daily)
    "unemployment": "UNRATE",    # Unemployment Rate (monthly)
    "vix":          "VIXCLS",    # CBOE Volatility Index (daily → resampled monthly)
}

# ── Fetch window ───────────────────────────────────────────────────────────
LOOKBACK_YEARS = 30

# ── Regime thresholds ─────────────────────────────────────────────────────
ROLLING_WINDOW = 3  # months for trend computation

# ── Signal thresholds ─────────────────────────────────────────────────────
YIELD_CURVE_INVERSION_THRESHOLD = 0.0   # spread < 0 triggers
UNRATE_SPIKE_THRESHOLD          = 0.3   # pp rise over 3 months
UNRATE_SPIKE_WINDOW             = 3     # months
CPI_HOT_THRESHOLD               = 4.0  # YoY %
CPI_COLD_THRESHOLD              = 1.0  # YoY %
VIX_SPIKE_THRESHOLD             = 30.0

# ── Extended FRED Series (Priced Metrics / Trader Pack) ────────────────────
PRICED_SERIES = {
    "fedfunds":      "FEDFUNDS",   # Federal Funds Effective Rate (monthly)
    "sofr":          "SOFR",       # Secured Overnight Financing Rate (daily→monthly)
    "breakeven_5y":  "T5YIE",      # 5-Year Breakeven Inflation Rate (daily→monthly)
    "breakeven_10y": "T10YIE",     # 10-Year Breakeven Inflation Rate (daily→monthly)
    "tips_5y":       "DFII5",      # 5-Year TIPS Yield (daily→monthly)
    "tips_10y":      "DFII10",     # 10-Year TIPS Yield (daily→monthly)
}
SERIES.update(PRICED_SERIES)   # fetch_all_series() picks these up automatically

# ── Polygon API (optional — no raise) ──────────────────────────────────────
POLYGON_API_KEY             = os.getenv("POLYGON_API_KEY")
MARKET_DAILY_BACKFILL_YEARS = int(os.getenv("MARKET_DAILY_BACKFILL_YEARS", "10"))

# ── Output paths ───────────────────────────────────────────────────────────
OUTPUT_DIR         = PROJECT_ROOT / "output"
PLAYBOOK_JSON_PATH = OUTPUT_DIR / "playbook.json"
