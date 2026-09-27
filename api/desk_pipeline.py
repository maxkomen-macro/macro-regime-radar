"""api/desk_pipeline.py — the Desk v2 /pipeline (desk/frame-3-api-b2a;
DESK_FRAME3_SPEC §12.9, docs/desk/FRAME3_API_PLAN.md §1.9 and §7 commit 10).

The Data Pipeline tab lists every stored series a Desk panel reads, grouped:

- the Desk registry series that are available at tier 2 or below
  (src/desk/series.py): read through the engine's reader, so a row is dated
  by the observations the Desk can read;
- the raw_series series a Desk panel reads: INDPRO and CPIAUCSL (the regime),
  UNRATE, T10YIE and T5YIE (inputs of the recession model), USREC (its
  training target) and BAMLC0A0CM (the Macro tab's IG level).

The relay, the intraday bars and the news are no Desk panel's input and are
left out. `desk_pipeline` is the worker item (what depends on the generation:
each row's dates and note, the watermarks); `payload` adds, per response, what
depends on "now" (each row's status, plan §0.5) and the published validation
verdict for the request's own generation (api/bootstrap.validation_for, S-01).

Statuses follow each series' existing freshness policy (plan N9, spec §12.1):
desk_series rows through api/freshness.desk_series_states (close → current,
stale → stale, unknown → missing); ^GSPC, GC=F and ^RUT through the
asset_prices rule of api/freshness.assess applied to the symbol's newest row
(current and delayed → current, stale → stale, absent → missing); raw_series
rows through api/freshness.fred_series_state (the same mapping), and only when
the series has stored rows: a watermark never makes a row with none current
(Codex R-01). A group's
status is the worst of its series: missing, then stale, then current.

Stdlib at import; the engine and the worker are imported at the point of use.
Every connection opened here is closed in a `finally` (verifier V-54).
"""

from __future__ import annotations

import re
import sqlite3
from datetime import date, datetime
from typing import Any

# The groups, in the tab's order, with each group's series in display order
# (spec §12.9 names no groups; these are session A's fixture's,
# web/src/fixtures/desk/pipeline.json, and FRAME3_DATA_AUDIT.md §1's).
PIPELINE_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Rates", ("DGS3MO", "DGS2", "T10Y2Y", "DGS5", "DGS10", "DGS30", "T10YIE", "T5YIE")),
    ("Credit", ("BAMLH0A0HYM2", "BAMLC0A0CM")),
    ("Equities & vol", ("^GSPC", "^NDX", "^RUT", "VIXCLS")),
    ("FX & commodities", ("DX-Y.NYB", "JPY=X", "GC=F", "DCOILWTICO")),
    ("Macro (monthly)", ("CPIAUCSL", "INDPRO", "UNRATE", "USREC")),
    # desk/fill-etf: the ETFs the full refresh stores in asset_prices (src/desk/series.py)
    ("Sector ETFs", ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")),
    ("Equity ETFs", ("SPY", "RSP", "IWM", "QQQ", "SMH", "SOXX", "IGV")),
    ("Bond, gold & dollar ETFs", ("TLT", "IEF", "HYG", "LQD", "GLD", "UUP")),
)
# The raw_series rows (plan §1.9 "the row set"): read from raw_series, labelled
# and dated by api/freshness.SERIES_REGISTRY.
RAW_SERIES_ROWS: tuple[str, ...] = ("INDPRO", "CPIAUCSL", "UNRATE", "T10YIE", "T5YIE", "USREC", "BAMLC0A0CM")

# S-02: the Desk tabs that read each series, derived from what each tab's served
# values are computed from (spec §12; FRAME3_API_PLAN.md §1), never from a
# fixture. A series feeds a tab when a value the tab shows is computed from its
# stored rows, directly or through a stored result derived from it:
# - the regimes table, from the classifier's two inputs (src/regime.py over
#   src/config.py SERIES growth and inflation), which every event study reads
#   too (each event's K−2 label and the evaluable mask, event_study.regime_at);
# - the recession model (src/analytics/recession.py), whose inputs are
#   api/main.RECESSION_INPUTS and whose training target is USREC.
REGIME_INPUTS: tuple[str, ...] = ("INDPRO", "CPIAUCSL")
RECESSION_MODEL: tuple[str, ...] = ("DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE", "T5YIE", "UNRATE", "INDPRO", "USREC")
# Each catalog study's inputs (spec §12.3: shock, condition series, target, as
# registry keys; api/desk_catalog on desk/frame-3-api), and the Ledger's rows
# (spec §8; the two RSI rows read the S&P's closes, desk/fill-compute).
CATALOG_INPUTS: dict[str, tuple[str, ...]] = {
    "gold-2sigma-spx-weak": ("gold", "spx"),
    "golden-cross": ("spx",),
    "death-cross": ("spx",),
    "vix-spike-2sigma-5d": ("vix", "spx"),
    "hy-2sigma-20d": ("hy_oas", "spx"),
    "10y-2sigma-20d": ("us10y", "spx"),
    "dollar-2sigma-20d": ("dxy", "spx"),
    "oil-2sigma-gold": ("wti", "gold"),
    "spx-2sigma-10y": ("spx", "us10y"),
    "spx-20d-2sigma": ("spx",),
    "spx-5d-2sigma": ("spx",),
    "2s10s-2sigma-steepening": ("curve_2s10s", "spx"),
    "oil-2sigma-20d": ("wti", "spx"),
    "rsi-above-70": ("spx",),
    "rsi-below-30": ("spx",),
}
LEDGER_STUDIES: tuple[str, ...] = (
    "2s10s-2sigma-steepening", "dollar-2sigma-20d", "golden-cross", "rsi-below-30", "vix-spike-2sigma-5d",
    "gold-2sigma-spx-weak", "hy-2sigma-20d", "spx-20d-2sigma", "death-cross", "rsi-above-70", "oil-2sigma-20d",
    "spx-5d-2sigma",
)
# /technicals' scored markers and its 20-day z (spec §12.7 signals_allowlist, move_20d_sigma)
TECHNICALS_STUDIES: tuple[str, ...] = ("golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma",
                                        "spx-5d-2sigma")
# /overview's data_status contributors (spec §12.1, N9)
DATA_STATUS_SERIES: tuple[str, ...] = ("T10Y2Y", "VIXCLS", "BAMLH0A0HYM2", "DGS2", "DGS10", "^GSPC", "GC=F")
CURVE_SERIES: tuple[str, ...] = ("DGS3MO", "DGS2", "DGS5", "DGS10", "DGS30")  # /macro curve (api/desk_items_macro.TENORS)
# desk/fill-etf: the ETF blocks (api/desk_items_etf.py), by what each reads
SECTOR_ETFS: tuple[str, ...] = ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")
LEADERSHIP_SERIES: tuple[str, ...] = ("SPY", *SECTOR_ETFS)   # /sectors and /technicals' sectors block
BREADTH_SERIES: tuple[str, ...] = ("SPY", *SECTOR_ETFS, "RSP", "IWM")  # /sectors' breadth block
STOCK_BOND_SERIES: tuple[str, ...] = ("SPY", "TLT")                     # /macro's stock_bond block
CORRELATION_SERIES: tuple[str, ...] = ("SPY", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP", "IWM", "QQQ", "VIXCLS")  # /macro's correlations
CREDIT_SERIES: tuple[str, ...] = ("BAMLH0A0HYM2", "BAMLC0A0CM")                # /macro credit: HY stored, IG's watermark


def _studies_read(slugs) -> set[str]:
    """The FRED ids and symbols a set of studies reads, the regimes' inputs included."""
    from src.desk import series as registry

    return {registry.get(k).series_id for s in slugs for k in CATALOG_INPUTS[s]} | set(REGIME_INPUTS)


def tab_readers() -> dict[str, set[str]]:
    """Each Desk tab and the series its served values are computed from.
    Basket & Hedge serves nothing yet (§12.13), so it reads nothing."""
    ledger = _studies_read(LEDGER_STUDIES)
    return {
        # tiles (the K−2 regime, the recession score, the trend, VIX), the Ledger's signals
        # (active_signals, since_last_close), VIX's change and data_status
        "Overview": set(REGIME_INPUTS) | set(RECESSION_MODEL) | {"^GSPC", "VIXCLS"} | ledger | set(DATA_STATUS_SERIES),
        "Technicals": {"^GSPC"} | _studies_read(TECHNICALS_STUDIES) | set(LEADERSHIP_SERIES),
        "Event Study": _studies_read(CATALOG_INPUTS),
        "Regime": set(REGIME_INPUTS) | set(RECESSION_MODEL),   # the rows, the next prints, the recession score
        "Macro": set(CURVE_SERIES) | set(CREDIT_SERIES) | set(STOCK_BOND_SERIES) | set(CORRELATION_SERIES),
        "Sectors": set(LEADERSHIP_SERIES) | set(BREADTH_SERIES),
        "Ledger": ledger,
        "Position Monitor": {"^GSPC", "DGS2", "DGS10"},        # the S&P from /technicals, 2s10s from /macro
    }


TAB_ORDER: tuple[str, ...] = ("Overview", "Technicals", "Event Study", "Regime", "Macro", "Sectors", "Ledger", "Position Monitor")

# A registered series no live tab reads yet says so, in its row's note.
NO_LIVE_READER: dict[str, str] = {
    "^NDX": "No Desk tab reads it: the Nasdaq row on Macro & Correlations reads QQQ, and Basket & Hedge is not served.",
    "^RUT": "No Desk tab reads it: Sectors compares small caps with large through IWM against SPY.",
    "JPY=X": "No Desk tab reads it: the dollar row on Macro & Correlations reads UUP.",
    # desk/fill-etf: stored; the tabs that read them are served by items 4 and 5
    **{t: "No Desk tab reads it yet: Basket & Hedge is not served." for t in ("SMH", "SOXX", "IGV")},
}


# The Desk's language (DESK_FRAME3_SPEC §1.5, the ban list of
# web/src/screens/desk/desk-language.test.ts) covers every string the API
# prints. The registry's notes are written for the event-study engine; where
# one uses a banned word, /pipeline prints it reworded, the meaning kept.
# Pinned by tests/test_desk_v2_pipeline.py (every served note passes the list).
DESK_WORDING: dict[str, tuple[tuple[str, str], ...]] = {
    "GC=F": (("so entry is always the next session", "so entry is the next session"),),
}


def feeds_of(series_id: str) -> list[str]:
    readers = tab_readers()
    return [tab for tab in TAB_ORDER if series_id in readers[tab]]


# The provider each row declares (R-15): the registry's own source, never the
# stored rows' provider column, so an unstored row names its provider too. The
# strings are the inventory's (api/desk.py; parity pinned by the tests).
PROVIDER_DESK_FRED = "FRED (Desk daily history)"
PROVIDER_DESK_MARKET = "EODHD first, Yahoo disclosed fallback (Desk daily history)"
STATE_WORD = {"close": "current", "current": "current", "delayed": "current", "stale": "stale"}
ORDER = ("current", "stale", "missing")  # worst last

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def _date_or_none(value: Any) -> str | None:
    text = str(value)[:10] if value is not None else ""
    if not _DATE.match(text):
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _ts_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and _TS.match(value) else None


def desk_specs() -> list:
    """The Desk registry series the tab lists: available, tier 2 or below."""
    from src.desk import series as registry

    return [s for s in registry.SERIES if s.available and s.tier <= 2]


def row_ids() -> list[str]:
    return [sid for _, ids in PIPELINE_GROUPS for sid in ids]


# ── The item (per generation) ───────────────────────────────────────────────

def _watermarks(conn: sqlite3.Connection) -> dict[str, dict]:
    from api import provenance

    if not provenance.table_exists(conn, "source_watermarks"):
        return {}
    cols = ("source", "last_obs", "last_value", "advanced_at", "checked_at", "status", "detail")
    return {r[0]: dict(zip(cols, r)) for r in conn.execute(f"SELECT {', '.join(cols)} FROM source_watermarks")}


def _with_reader_note(series_id: str, note: str | None) -> str | None:
    for before, after in DESK_WORDING.get(series_id, ()):
        note = note.replace(before, after) if note else note
    extra = NO_LIVE_READER.get(series_id)
    return note if extra is None else (f"{note} {extra}" if note else extra)


def _desk_row(conn: sqlite3.Connection, spec) -> dict:
    """A registry row: dated by the engine's reader; an unstored series has
    the engine's not_stored sentence as its note."""
    from api import desk as desk_mod
    from src.desk import event_study as es

    try:
        s = es.load_level(conn, spec)
        first, last, note = s.index[0].strftime("%Y-%m-%d"), s.index[-1].strftime("%Y-%m-%d"), spec.note
    except es.NotStored as exc:
        first = last = None
        note = str(exc)
    if spec.source == "asset_prices":
        store, provider = "asset_prices", desk_mod.SOURCE_BY_ID["asset_prices"]
    else:
        store, provider = "desk_series", PROVIDER_DESK_FRED if spec.source == "fred" else PROVIDER_DESK_MARKET
    return {"label": spec.label, "id": spec.series_id, "key": spec.key, "provider": provider, "freq": "daily",
            "first": first, "last": last, "feeds": feeds_of(spec.series_id), "note": _with_reader_note(spec.series_id, note),
            "store": store}


def _raw_row(conn: sqlite3.Connection, sid: str, watermarks: dict, raw_table: bool) -> dict:
    """A raw_series row: its first and last month stamps; a daily series stored
    month-stamped is dated by its watermark's last_obs (S-03). The watermark
    dates stored rows only: with none stored (the series absent, or the table),
    the row is undated and missing whatever the watermark says (Codex R-01)."""
    from api import desk as desk_mod
    from api import freshness as freshness_mod

    meta = freshness_mod.SERIES_REGISTRY[sid]
    n, first, last = 0, None, None
    if raw_table:
        n, lo, hi = conn.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM raw_series WHERE series_id = ?", (sid,)).fetchone()
        first, last = _date_or_none(lo), _date_or_none(hi)
    stamp = last
    if meta["cadence"] == "daily":
        last = _date_or_none((watermarks.get(f"fred:{sid}") or {}).get("last_obs")) if n else None
    return {"label": meta["label"], "id": sid, "key": None, "provider": desk_mod.SOURCE_BY_KIND["fred"], "freq": meta["cadence"],
            "first": first, "last": last, "feeds": feeds_of(sid), "note": _with_reader_note(sid, None), "store": "raw_series",
            "stamp": stamp, "stored": n > 0}


def desk_pipeline(ctx: dict) -> dict:
    """The desk_pipeline item: every row's dates, provider, feeds and note; the
    watermarks the statuses read; whether desk_series exists; and the Desk
    store's last refresh (`source_watermarks` row "desk_series", `checked_at`)."""
    from api import db
    from api import provenance
    from src.analytics import dbpath

    by_id = {s.series_id: s for s in desk_specs()}
    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        watermarks = _watermarks(conn)
        desk_table = provenance.table_exists(conn, "desk_series")
        raw_table = provenance.table_exists(conn, "raw_series")
        rows = [(_desk_row(conn, by_id[sid]) if sid in by_id else _raw_row(conn, sid, watermarks, raw_table))
                for sid in row_ids()]
    finally:
        conn.close()
    return {"rows": rows, "watermarks": watermarks, "desk_table": desk_table,
            "last_refresh_utc": _ts_or_none((watermarks.get("desk_series") or {}).get("checked_at"))}


# ── The payload (per response) ──────────────────────────────────────────────

def statuses(item: dict, now: datetime) -> dict[str, str]:
    """Each row's status as of `now`, by its series' own freshness policy."""
    from api import calendar as cal
    from api import desk as desk_mod
    from api import freshness as freshness_mod

    rows, wm = item["rows"], item["watermarks"]
    out: dict[str, str] = {}
    desk = [r for r in rows if r["store"] == "desk_series"]
    stored = {r["id"]: r["last"] for r in desk if r["last"]} if item["desk_table"] else None
    states = {s["id"][len("desk:"):]: s["state"] for s in freshness_mod.desk_series_states(
        stored=stored, specs=desk_mod.desk_series_specs(stored), watermarks=wm, now=now)}
    today_ny = now.astimezone(cal.NY).date()
    for r in rows:
        if r["store"] == "desk_series":
            state = states.get(r["id"], "unknown")
        elif r["store"] == "asset_prices":
            if r["last"] is None:
                state = "unknown"
            else:
                rep = freshness_mod.assess(db_fresh={"asset_prices_date": r["last"]}, series_latest=[], relay=None,
                                           bootstrap=None, now=now, watermarks=wm)
                state = next(x["verdict"] for x in rep["sla"] if x["feed"] == "asset_prices")
        elif not r["stored"]:
            state = "unknown"  # no stored observation: missing, whatever the watermark says (Codex R-01)
        else:
            state = freshness_mod.fred_series_state(r["id"], today_ny=today_ny, stored_date=r["stamp"],
                                                    watermark=wm.get(f"fred:{r['id']}"))["state"]
        out[r["id"]] = STATE_WORD.get(state, "missing")
    return out


def worst(states: list[str]) -> str:
    return max(states, key=ORDER.index) if states else "missing"


ROW_FIELDS = ("label", "id", "key", "provider", "freq", "first", "last", "feeds", "status", "note")


def payload(item: dict, now: datetime, validation: str | None) -> dict:
    """§12.9's /pipeline data: the item's rows grouped, with their statuses as
    of `now`, and the verdict published with this generation's file (or null)."""
    status = statuses(item, now)
    by_id = {r["id"]: r for r in item["rows"]}
    groups = []
    for name, ids in PIPELINE_GROUPS:
        series = [{k: (status[sid] if k == "status" else by_id[sid][k]) for k in ROW_FIELDS} for sid in ids]
        groups.append({"name": name, "status": worst([s["status"] for s in series]), "series": series})
    return {"last_refresh_utc": item["last_refresh_utc"], "validation": validation, "groups": groups}
