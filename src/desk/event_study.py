"""src/desk/event_study.py — the conditional event-study engine (desk/event-study).

Answers "after a defined shock in asset A, while condition B holds, what did
target T do over the next h sessions?" against an unconditional baseline and
split by regime (docs/desk/EVENT_STUDY_SPEC.md). A second study type scores
the S&P 500's 50/200-day crosses with the same machinery (§6).

Reads only stored tables through src/analytics/dbpath (the published
generation in the API): `desk_series` and `asset_prices` for the levels
(src/desk/series.py says which), `regimes` for the labels. It never fetches,
never recomputes a regime, and never writes.

Rules (spec §5 and the reviews of 2026-09-21, R-01 … R-20), each pinned by
tests/test_event_study.py and mapped in docs/desk/EVENT_STUDY_REPORT.md §9:
- Session calendar (R-04, R-02): the NYSE calendar from the exchange_calendars
  package (XNYS), sessions and early closes included, over the whole span of
  the study's inputs. Nothing is derived from stored rows. Every series is
  aligned onto it: an observation dated off-session is dropped and counted; a
  session a series has no value for (the S&P included) is missing and counts
  as an exclusion; a date outside the calendar is rejected, never given
  regular hours. A window's required sessions are the ones its computation
  reads (a w-session move reads t−w and t, a forward window e and e+h, the
  cooldown every session); a missing required session excludes the window
  and is counted. The z-score's 252-session window tolerates up to
  Z_WINDOW − Z_MIN_PRESENT missing moves (bond-market holidays).
- Valid prices (R-17): before any log, a non-finite or non-positive value is
  an exclusion with a reason, counted per series, for events and baseline.
- As-of (desk/hardening review R-06): the series reader reads no row dated
  after the as-of, an explicit date, else the generation's (the New York date
  its copy was staged, api/worker.Generation.as_of), else today in New York;
  in a desk_series store with provenance (Codex R-14, R-15, api/provenance.py)
  it reads only rows a committed refresh wrote, dated no later than that
  run's New York date, and sets aside a row without provenance as
  hand-inserted; what it leaves out is counted per series, disclosed and
  hashed.
- Stored values (verifier V-14): the reader reads only numeric stored values;
  a malformed one (text in the value column) is quarantined on read,
  excluded from the study and counted, disclosed and hashed like a future-
  dated row, so no single junk row can take the Desk down. The same holds for
  the date column (verifier V-22): a row whose date is not a valid ISO date
  (not YYYY-MM-DD text, or no such day) is set aside on read the same way.
- One evaluability mask (R-05): a session is evaluable when the shock's
  z-score exists, the co-condition is computable, the target has a value and
  the lagged regime label exists. Events and the baseline both use it; every
  baseline candidate goes through the same entry delay and the same
  completeness rules as an event, with its regime label from the signal
  date. Events in months before the first regime row keep their own
  "Unlabeled" row, outside the totals.
- Timing (R-01, R-02, R-03): every series declares when its daily value is
  fixed and when it is known, as rules resolved per session against the
  calendar's open and close (early closes handled). FRED daily Treasury and
  OAS values are known at the next session's open. Entry is the event date's
  close only when the target's value is fixed at or after every input is
  known; otherwise the first later session whose fixing is (the next session
  for every input but WTI, which EIA publishes weekly and is known at 13:00 ET
  on the eighth business day after its date: the eighth session, desk/hardening
  review R-01). Gold and copper as targets always enter a later session.
- Cooldown: sessions i+1 … i+w after an event at i. The shock defines the
  event date; the condition is evaluated on it; a shock whose condition fails
  is dropped and still starts the cooldown. Every filtering stage is
  recorded (R-19) and a zero-event verdict names the stage that emptied the set.
- Statistics (R-06, R-18): per horizon its own n and the cluster bootstrap on
  Δ over blocks of overlapping forward windows; the resample is enumerated
  exactly when blocks ≤ EXACT_MAX_BLOCKS (7^7 = 823,543 draws), N_BOOT
  Monte Carlo draws otherwise; an interval needs MIN_BLOCKS_INTERVAL blocks;
  a zero-exclusion claim needs MIN_BLOCKS_EXCLUSION blocks, the 90% interval
  on the point estimate's side of zero (boundary included), and fewer than
  OPPOSITE_SIGN_MAX of the resampled medians adverse, zero counted as
  adverse; when the interval and that test disagree the verdict says
  "exclusion not established". The method, the draws and the adverse share
  are disclosed and hashed.
- Crosses (R-10, R-21): strict only; equality never fires; the side state
  carries through equal sessions and resets whenever either average is
  unevaluable; an event is admitted only when the immediately preceding
  session was evaluable and the carried side was the other one.
- Calendar extension (R-22): the calendar is built one exchange session
  past the last input date so every session has a next open; the study's
  session index stays bounded by the inputs.
- Verdict (R-08, R-11, R-12, R-20): fixed vocabulary; every cited horizon
  carries its n and blocks; the interval sentence covers only horizons that
  have one; a regime ranking needs two eligible regimes and a contrast of at
  least MIN_REGIME_CONTRAST between the top two.
- Provenance (R-09): `inputs_hash` covers the data generation id, a content
  hash of every input series and of the regime table, every effective
  parameter, the timing rules, the resampling method and draws per horizon.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
import re
import sqlite3
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

import exchange_calendars as xcals
import numpy as np
import pandas as pd

from src.analytics import dbpath
from src.analytics import technicals
from src.desk import series as registry

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "macro_radar.db"
NY = "America/New_York"

MASTER = "spx"
CALENDAR = "XNYS"
WINDOWS = (5, 20, 60)
THRESHOLDS = (1.5, 2.0, 2.5)
SIGNS = ("+", "-", "both")
HORIZONS = (5, 10, 20, 60)
PRIMARY_HORIZON = 20
Z_WINDOW = 252
Z_MIN_PRESENT = 240  # moves that must be present in the 252-session z window (R-04, bond holidays)
MA_FAST, MA_SLOW = 50, 200
# The RSI study (desk/fill-compute): the S&P's RSI(14) (src/analytics/technicals.rsi,
# the one copy) crossing strictly above 70 or below 30; after each retained
# crossing the next RSI_PERIOD sessions are a cooldown, so one visit that dips
# back and forth across the level counts once.
RSI_UPPER, RSI_LOWER = technicals.RSI_UPPER, technicals.RSI_LOWER
RSI_PERIOD = technicals.RSI_PERIOD
RSI_SIDES = ("above", "below")
N_BOOT = 10000                  # Monte Carlo draws above EXACT_MAX_BLOCKS (R-18, round 3)
OPPOSITE_SIGN_MAX = 0.03        # R-18: a zero-exclusion claim also needs fewer than this share of resampled medians on the other side of the point estimate
CI_LEVEL = 0.90
DEFAULT_SEED = 20260921
MAX_SEED = 2**32 - 1
COND_VALUE_BOUND = 1e6          # R-15: cond_value is clamped to ±this at validation
REGIME_LAG_MONTHS = 2
MIN_REGIME_N = 10
EXACT_MAX_BLOCKS = 7            # R-18: enumerate the block resample exactly up to here (7^7 draws)
MIN_BLOCKS_INTERVAL = 5         # blocks an interval needs
MIN_BLOCKS_EXCLUSION = 10       # blocks a zero-exclusion claim needs
REGIME_LABELS = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
UNLABELED = "Unlabeled"
# The magnitude word at the cited horizon: |Δ| against the baseline's
# interquartile range. Below MODEST_IQR the effect is "modest", above it
# "material". Two words, both calibrated to the target's own dispersion.
MODEST_IQR = 0.5
# R-20: the top two eligible regimes need at least this contrast in median
# for a strongest/weakest claim: half a percentage point for a return
# target, five basis points for a yield or spread target (a judgment).
MIN_REGIME_CONTRAST = {"pct": 0.005, "bp": 5.0}

CONDITIONS: dict[str, dict] = {
    "spx_below_50dma": {"label": "S&P 500 below its 50-day average", "series": "spx", "param": None},
    "spx_20d_negative": {"label": "S&P 500 20-session return below zero", "series": "spx", "param": None},
    "vix_above": {"label": "VIX above {value:g}", "series": "vix", "param": "level"},
    "hy_oas_20d_change_above": {"label": "HY OAS 20-session change above {value:g} bp", "series": "hy_oas", "param": "bp"},
    "regime": {"label": "Regime is {value}", "series": None, "param": "regime"},
}
_SIGN_WORD = {"+": "up", "-": "down", "both": "abs"}
_WORD_SIGN = {v: k for k, v in _SIGN_WORD.items()}
_REGIME_SLUG = {r: r.lower().replace(" ", "_") for r in REGIME_LABELS}
_SLUG_REGIME = {v: k for k, v in _REGIME_SLUG.items()}


class StudyError(ValueError):
    """A query the engine cannot run as asked (the API answers 422)."""


class NotStored(RuntimeError):
    """An input series has no stored rows in this database. When the full
    refresh stores that series (registry.stored_by_refresh) the database
    predates it: `awaiting_refresh` is set and the API answers 200
    `awaiting_refresh`; otherwise (a planned tier) the API answers 503
    `not_stored` (desk/integration). `series` is the registry key. Both
    survive copy.copy, which is how the worker re-raises a stored error."""

    def __init__(self, message: str, *, series: str | None = None, awaiting_refresh: bool = False):
        super().__init__(message)
        self.series = series
        self.awaiting_refresh = awaiting_refresh


@dataclass(frozen=True)
class Query:
    kind: str = "shock"              # shock | cross | rsi
    shock: str = "gold"
    w: int = 20
    z: float = 2.0
    sign: str = "+"
    cond: str | None = None
    cond_value: float | str | None = None
    regime: str = "all"              # all | a label: an AND filter on the event set
    target: str = "spx"
    cross: str | None = None         # golden | death (kind == "cross"); above | below (kind == "rsi": RSI crossing 70 / 30)
    seed: int = DEFAULT_SEED


PRESETS: dict[str, Query] = {
    "gold-2sigma-spx-weak": Query(shock="gold", w=20, z=2.0, sign="+", cond="spx_below_50dma", target="spx"),
    "spx-golden-cross": Query(kind="cross", cross="golden", target="spx"),
    "spx-death-cross": Query(kind="cross", cross="death", target="spx"),
}


# ── queries and slugs ─────────────────────────────────────────────────────────

def _finite(x: Any, what: str) -> float:
    """A finite float from a number or a string, else StudyError (R-14)."""
    if isinstance(x, bool):
        raise StudyError(f"{what} must be a number, not a boolean")
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise StudyError(f"{what} must be a number; got {x!r}") from None
    if not math.isfinite(v):
        raise StudyError(f"{what} must be finite; got {x!r}")
    return v


def _integer(x: Any, what: str) -> int:
    if isinstance(x, bool):
        raise StudyError(f"{what} must be an integer, not a boolean")
    if isinstance(x, int):
        return x
    if isinstance(x, float) and x.is_integer():
        return int(x)
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        raise StudyError(f"{what} must be an integer; got {x!r}") from None


def validate(q: Query) -> Query:
    if q.kind not in ("shock", "cross", "rsi"):
        raise StudyError(f"kind must be shock, cross or rsi, not {q.kind!r}")
    targets = {s.key for s in registry.with_role("target")}
    if q.target not in targets:
        raise StudyError(f"target must be one of {', '.join(sorted(targets))}; got {q.target!r}")
    if q.regime != "all" and q.regime not in REGIME_LABELS:
        raise StudyError(f"regime must be 'all' or one of {', '.join(REGIME_LABELS)}; got {q.regime!r}")
    seed = _integer(q.seed, "seed")
    if not 0 <= seed <= MAX_SEED:
        raise StudyError(f"seed must be between 0 and {MAX_SEED}; got {q.seed!r}")
    for key in (q.target, q.shock if q.kind == "shock" else MASTER):
        if key in registry.BY_KEY and registry.BY_KEY[key].tier >= 3:
            raise StudyError(f"{registry.BY_KEY[key].label} ({key}) is deferred (tier 3): listed, not yet stored, not selectable.")
    if q.kind == "cross":
        if q.cross not in ("golden", "death"):
            raise StudyError("cross must be golden or death")
        if q.target != MASTER:
            raise StudyError("the cross study is defined on the S&P 500 (target=spx)")
        return replace(q, shock=MASTER, w=20, z=2.0, sign="+", cond=None, cond_value=None, seed=seed)
    if q.kind == "rsi":
        if q.cross not in RSI_SIDES:
            raise StudyError("an RSI study crosses above (70) or below (30)")
        if q.target != MASTER:
            raise StudyError("the RSI study is defined on the S&P 500 (target=spx)")
        # w is the cooldown after each crossing (the RSI period); z and sign are unused, as for a cross
        return replace(q, shock=MASTER, w=RSI_PERIOD, z=2.0, sign="+", cond=None, cond_value=None, seed=seed)
    shocks = {s.key for s in registry.with_role("shock")}
    if q.shock not in shocks:
        raise StudyError(f"shock must be one of {', '.join(sorted(shocks))}; got {q.shock!r}")
    w = _integer(q.w, "w")
    if w not in WINDOWS:
        raise StudyError(f"w must be one of {WINDOWS}; got {q.w!r}")
    z = _finite(q.z, "z")
    if z not in THRESHOLDS:
        raise StudyError(f"z must be one of {THRESHOLDS}; got {q.z!r}")
    if q.sign not in SIGNS:
        raise StudyError(f"sign must be one of {SIGNS}")
    cond = q.cond if q.cond not in (None, "", "none") else None
    value: float | str | None = None
    if cond is not None:
        if cond not in CONDITIONS:
            raise StudyError(f"cond must be one of {', '.join(CONDITIONS)}; got {cond!r}")
        param = CONDITIONS[cond]["param"]
        if param == "regime":
            if q.cond_value not in REGIME_LABELS:
                raise StudyError(f"cond_value must name a regime for cond=regime: {', '.join(REGIME_LABELS)}")
            value = str(q.cond_value)
        elif param is not None:
            value = min(COND_VALUE_BOUND, max(-COND_VALUE_BOUND, _finite(q.cond_value, f"cond_value ({param})")))  # R-15
        elif q.cond_value not in (None, ""):
            raise StudyError(f"cond={cond} takes no cond_value")
    return replace(q, w=w, z=z, cond=cond, cond_value=value, cross=None, seed=seed)


def _num_slug(v: float) -> str:
    return repr(float(v))  # lossless: float(repr(x)) == x (R-07, R-15)


def slug_for(q: Query) -> str:
    """A stable, lossless address for any study; a preset keeps its name.
    The seed is not part of the address."""
    q = validate(q)
    for name, preset in PRESETS.items():
        if validate(preset) == replace(q, seed=DEFAULT_SEED):
            return name
    if q.kind == "cross":
        return f"{q.target}-{q.cross}-cross" + ("" if q.regime == "all" else f"-{_REGIME_SLUG[q.regime]}")
    if q.kind == "rsi":
        level = f"{RSI_UPPER:g}" if q.cross == "above" else f"{RSI_LOWER:g}"
        return f"{q.target}-rsi-{q.cross}-{level}" + ("" if q.regime == "all" else f"-{_REGIME_SLUG[q.regime]}")
    cond = "none" if q.cond is None else q.cond
    if q.cond_value is not None:
        cond += "=" + (_REGIME_SLUG[q.cond_value] if q.cond == "regime" else _num_slug(q.cond_value))
    return f"{q.shock}-w{q.w}-z{_num_slug(q.z)}-{_SIGN_WORD[q.sign]}-{cond}-{q.target}" + ("" if q.regime == "all" else f"-{_REGIME_SLUG[q.regime]}")


_NUM = r"-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?"
_SLUG_RE = re.compile(
    rf"^(?P<shock>[a-z0-9_]+)-w(?P<w>\d+)-z(?P<z>{_NUM})-(?P<sign>up|down|abs)-(?P<cond>[a-z0-9_]+)(?:=(?P<val>{_NUM}|[a-z_]+))?-(?P<target>[a-z0-9_]+)(?:-(?P<regime>goldilocks|overheating|stagflation|recession_risk))?$"
)
_CROSS_RE = re.compile(r"^(?P<target>[a-z0-9_]+)-(?P<cross>golden|death)-cross(?:-(?P<regime>goldilocks|overheating|stagflation|recession_risk))?$")
_RSI_RE = re.compile(r"^(?P<target>[a-z0-9_]+)-rsi-(?P<side>above-70|below-30)(?:-(?P<regime>goldilocks|overheating|stagflation|recession_risk))?$")


def parse_slug(slug: str) -> Query:
    if slug in PRESETS:
        return PRESETS[slug]
    m = _CROSS_RE.match(slug)
    if m:
        return Query(kind="cross", cross=m["cross"], target=m["target"], regime=_SLUG_REGIME.get(m["regime"] or "", "all"))
    m = _RSI_RE.match(slug)
    if m:
        return Query(kind="rsi", cross=m["side"].split("-")[0], target=m["target"], regime=_SLUG_REGIME.get(m["regime"] or "", "all"))
    m = _SLUG_RE.match(slug)
    if not m:
        raise StudyError(f"unknown study {slug!r}")
    cond = None if m["cond"] == "none" else m["cond"]
    val: float | str | None = None
    if m["val"] is not None:
        val = _SLUG_REGIME.get(m["val"], m["val"]) if cond == "regime" else _finite(m["val"], "cond_value")
    return Query(shock=m["shock"], w=_integer(m["w"], "w"), z=_finite(m["z"], "z"), sign=_WORD_SIGN[m["sign"]], cond=cond, cond_value=val,
                 target=m["target"], regime=_SLUG_REGIME.get(m["regime"] or "", "all"))


def cache_key(q: Query) -> str:
    """The losslessly serialized validated parameters (R-07)."""
    return json.dumps(asdict(validate(q)), sort_keys=True, separators=(",", ":"))


# ── stored data ───────────────────────────────────────────────────────────────

def _connect(db_path: Path | str) -> sqlite3.Connection:
    return dbpath.connect_ro(db_path)


def resolve_as_of(as_of: str | None = None, db_path: Path | str | None = None) -> str:
    """The date after which a stored row is future-dated and never read (review
    R-06): `as_of` when given; else the as-of of the generation a read of
    `db_path` uses (the pinned one, or the served one: the New York date its
    copy was staged); else today's New York date, for a script or a test
    reading a file directly."""
    if as_of:
        return str(as_of)[:10]
    gen = dbpath.generation_for(db_path if db_path is not None else DB_PATH)
    if gen is None:
        gen = dbpath.pinned_generation()
    gen_as_of = getattr(gen, "as_of", None) if gen is not None else None
    if gen_as_of:
        return str(gen_as_of)[:10]
    return pd.Timestamp.now(tz=NY).strftime("%Y-%m-%d")


NUMERIC = "IN ('real', 'integer')"  # SQLite storage classes a stored level may have (V-14)
# a stored date the reader can take: ISO-shaped text (V-22) on or after the floor (V-26: pandas and
# the XNYS calendar cannot build a session index for year 0 or the year 1000; the registry's
# earliest declared start is 1962); whether it is a real day is checked on parse. The floor is one
# constant, api/freshness.DESK_DATE_FLOOR, which validate_db reads too (Codex round 4); that
# module is stdlib-only, so importing it costs the engine nothing.
from api import provenance  # noqa: E402
from api.freshness import DESK_DATE_FLOOR as DATE_FLOOR  # noqa: E402
ISO_DATE = f"(typeof(date) = 'text' AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date >= '{DATE_FLOOR}')"


def load_level(conn: sqlite3.Connection, spec: registry.DeskSeries, as_of: str | None = None) -> pd.Series:
    """A stored level series on a DatetimeIndex, or NotStored. No row dated
    after the as-of is read (review R-06), and no stored value that is not a
    number (verifier V-14: text in the value column made float() raise and
    took the assets list, and every free-form study, down), and no row whose
    date is not a valid ISO date on or after DATE_FLOOR (verifiers V-22,
    V-26, the same fault in the date column). Each row counts in exactly one
    bucket, tested in this order (V-28): a date that is not ISO-shaped text on
    or after the floor is malformed; else, in a desk_series store with
    provenance, one no committed refresh wrote has no provenance (Codex R-14,
    the hand-inserted class); else one dated after the as-of, or after the
    New York date of the run that committed it, is future-dated; else one
    whose value is not a number is non-numeric; else
    one whose date names no real day ('1999-99-99', '2010-02-30') is
    malformed. So '9999-99-99' counts as future-dated and '2010-02-30' with a
    text value as non-numeric; validate_db, which judges date and value apart,
    can count such a row under both. How many of each were left out is in
    `.attrs["malformed_date_excluded"]`, `["no_provenance_excluded"]`,
    `["future_excluded"]` (of which `["after_run_excluded"]` were dated after
    their run's New York date, those dates in `["after_run_dates"]`) and
    `["non_numeric_excluded"]`."""
    cutoff = resolve_as_of(as_of)
    prov = False
    # Codex R-27: the schema is read fail-closed. A table is missing only when a read that
    # completed says so, and a store is read without provenance only when one says the
    # columns are absent; a read that keeps failing raises provenance.SchemaCheckFailed
    if not provenance.table_exists(conn, spec.table):
        raise not_stored(spec, table_missing=True)
    if spec.table == "asset_prices":
        where, arg, col = "FROM asset_prices WHERE symbol = ? AND interval = '1d'", spec.series_id, "close"
    else:
        prov = provenance.is_migrated(conn)
        where = (f"FROM desk_series d {provenance.COMMITTED_JOIN} WHERE d.series_id = ?" if prov
                 else "FROM desk_series WHERE series_id = ?")
        arg, col = spec.series_id, "value"
    committed = " AND r.run_id IS NOT NULL" if prov else ""  # R-14: a committed refresh wrote it
    in_run = " AND date <= r.as_of" if prov else ""          # and it is not dated after that run's day
    # R-27: no query error is read as "no rows": it raises (a missing table was ruled out above)
    rows = conn.execute(f"SELECT date, {col} {where} AND {ISO_DATE} AND date <= ?{committed}{in_run} AND typeof({col}) {NUMERIC} "
                        "ORDER BY date", (arg, cutoff)).fetchall()
    misshapen = conn.execute(f"SELECT COUNT(*) {where} AND NOT {ISO_DATE}", (arg,)).fetchone()[0]
    unprovenanced = conn.execute(f"SELECT COUNT(*) {where} AND {ISO_DATE} AND r.run_id IS NULL", (arg,)).fetchone()[0] if prov else 0
    future = conn.execute(f"SELECT COUNT(*) {where} AND {ISO_DATE}{committed} AND date > ?", (arg, cutoff)).fetchone()[0]
    after_run = conn.execute(f"SELECT COUNT(*), GROUP_CONCAT(DISTINCT r.as_of) {where} AND {ISO_DATE}{committed} AND date <= ? "
                             "AND date > r.as_of", (arg, cutoff)).fetchone() if prov else (0, None)
    junk = conn.execute(f"SELECT COUNT(*) {where} AND {ISO_DATE} AND date <= ?{committed}{in_run} AND typeof({col}) NOT {NUMERIC}",
                        (arg, cutoff)).fetchone()[0]
    if rows:
        # ISO-shaped but no such day ('1999-99-99', '2010-02-30'): set aside too (V-22)
        dates = pd.to_datetime(pd.Index([r[0] for r in rows]), format="%Y-%m-%d", errors="coerce")
        ok = ~pd.isna(dates)
        impossible = int((~ok).sum())
        rows = [r for r, good in zip(rows, ok) if good]
        dates = dates[ok]
    else:
        impossible = 0
    if not rows:
        raise not_stored(spec, table_missing=rows is None)
    s = pd.Series([float(r[1]) for r in rows], index=pd.DatetimeIndex(dates), name=spec.key).sort_index()
    s = s[~s.index.duplicated(keep="last")]
    s.attrs["malformed_date_excluded"] = int(misshapen) + impossible
    s.attrs["no_provenance_excluded"] = int(unprovenanced)
    s.attrs["future_excluded"] = int(future) + int(after_run[0])
    s.attrs["after_run_excluded"] = int(after_run[0])
    s.attrs["after_run_dates"] = sorted(set((after_run[1] or "").split(",")) - {""})
    s.attrs["non_numeric_excluded"] = int(junk)
    return s


def not_stored(spec: registry.DeskSeries, *, table_missing: bool) -> NotStored:
    """The typed absence of one series, in words (desk/integration): awaiting
    the first full refresh when that refresh stores it, planned otherwise."""
    name = f"{spec.label} ({spec.series_id})"
    if registry.stored_by_refresh(spec):
        # "first" only when the table itself is absent; a table without this
        # series' rows means a fetch that did not land (verifier V-08).
        msg = (f"{name} is awaiting the first full refresh: this database has no {spec.table} table yet, and that refresh stores it."
               if table_missing else
               f"{name} is awaiting the next full refresh: this database has no {spec.series_id} rows in {spec.table} yet.")
        return NotStored(msg, series=spec.key, awaiting_refresh=True)
    return NotStored(f"{name} is not stored in this database: it is a tier {spec.tier} series, and the full refresh "
                     f"stores tiers up to {registry.REFRESH_TIER} only.", series=spec.key)


def load_regimes(conn: sqlite3.Connection) -> pd.Series:
    """Regime label by month (PeriodIndex 'M'), as stored: one row per month."""
    rows = conn.execute("SELECT date, label FROM regimes ORDER BY date").fetchall()
    if not rows:
        return pd.Series(dtype=object, index=pd.PeriodIndex([], freq="M"))
    idx = pd.PeriodIndex([pd.Timestamp(r[0]).to_period("M") for r in rows], freq="M")
    return pd.Series([r[1] for r in rows], index=idx)


def content_hash(s: pd.Series) -> str:
    """A content hash of a stored series (R-09): every date and value."""
    h = hashlib.sha256()
    for d, v in s.items():
        h.update(f"{d.strftime('%Y-%m-%d') if hasattr(d, 'strftime') else d},{v!r}\n".encode())
    return h.hexdigest()[:16]


def regime_at(dates: pd.DatetimeIndex, months: pd.Series, lag: int = REGIME_LAG_MONTHS) -> pd.Index:
    """The label a session in month K takes: the row stamped K − lag, else Unlabeled."""
    if len(dates) == 0:
        return pd.Index([], dtype=object)
    keys = dates.to_period("M") - lag
    return pd.Index(months.reindex(keys).fillna(UNLABELED).to_numpy(dtype=object))


def first_labelled_date(months: pd.Series, lag: int = REGIME_LAG_MONTHS) -> pd.Timestamp | None:
    if months.empty:
        return None
    return (months.index.min() + lag).to_timestamp(how="start")


def last_labelled_date(months: pd.Series, lag: int = REGIME_LAG_MONTHS) -> pd.Timestamp | None:
    if months.empty:
        return None
    return (months.index.max() + lag).to_timestamp(how="end").normalize()


# ── the session calendar (R-04, R-02) ─────────────────────────────────────────

_CALENDARS: dict[tuple[str, str], Any] = {}


def session_calendar(start: str, end: str):
    """The XNYS calendar covering [start, end] and at least one exchange
    session beyond `end` (R-22): built from the 1st of January of `start`'s
    year to the end of the month after `end`, cached in the process."""
    beyond = (pd.Timestamp(end) + pd.offsets.MonthEnd(2)).strftime("%Y-%m-%d")
    key = (f"{start[:4]}-01-01", beyond)
    cal = _CALENDARS.get(key)
    if cal is None:
        cal = xcals.get_calendar(CALENDAR, start=key[0], end=key[1])
        _CALENDARS[key] = cal
    return cal


def sessions_between(cal, start: str, end: str) -> pd.DatetimeIndex:
    """The calendar's sessions within [start, end]; a bound that falls on a
    non-session (2 January 1995 was the observed New Year's Day) is fine."""
    all_sessions = pd.DatetimeIndex(cal.sessions).tz_localize(None).as_unit("ns")
    return all_sessions[(all_sessions >= pd.Timestamp(start)) & (all_sessions <= pd.Timestamp(end))]


@dataclass
class SessionClock:
    """Per-session open, close and next open (UTC), from the calendar, and
    where each session sits in it (a `session_clock` rule reads a session n
    places later, review R-01)."""
    sessions: pd.DatetimeIndex
    opens: pd.DatetimeIndex
    closes: pd.DatetimeIndex
    next_opens: pd.DatetimeIndex
    cal: Any = None
    positions: np.ndarray | None = None
    all_sessions: pd.DatetimeIndex | None = None


def clock_for(cal, sessions: pd.DatetimeIndex) -> SessionClock:
    """The clock for these sessions; a date the calendar does not know as a
    session is rejected (R-02: never regular hours by assumption)."""
    sessions = pd.DatetimeIndex(sessions).as_unit("ns")  # one resolution for every epoch comparison (pandas 3 units)
    all_sessions = pd.DatetimeIndex(cal.sessions).tz_localize(None).as_unit("ns")
    if len(sessions) == 0:
        empty = pd.DatetimeIndex([], tz="UTC")
        return SessionClock(sessions, empty, empty, empty, cal, np.zeros(0, dtype=int), all_sessions)
    pos = all_sessions.get_indexer(sessions)
    if (pos < 0).any():
        bad = sessions[pos < 0][0].strftime("%Y-%m-%d")
        raise StudyError(f"{bad} is not a session of the {CALENDAR} calendar")
    if (pos + 1 >= len(all_sessions)).any():  # cannot happen with session_calendar (R-22); kept as the guard
        raise StudyError(f"the {CALENDAR} calendar ends before the session after {sessions[-1].date()}")
    opens = pd.DatetimeIndex(cal.opens.to_numpy()[pos], tz="UTC").as_unit("ns")
    closes = pd.DatetimeIndex(cal.closes.to_numpy()[pos], tz="UTC").as_unit("ns")
    next_opens = pd.DatetimeIndex(cal.opens.to_numpy()[pos + 1], tz="UTC").as_unit("ns")
    return SessionClock(sessions, opens, closes, next_opens, cal, pos, all_sessions)


def when_vec(rule: registry.Rule, clock: SessionClock) -> pd.DatetimeIndex:
    """The aware datetimes a rule resolves to for every session of the clock."""
    anchor, off = rule
    delta = pd.Timedelta(minutes=off)
    if anchor == "clock":
        wall = (clock.sessions + delta).tz_localize(NY, ambiguous=False, nonexistent="shift_forward")
        return wall.tz_convert("UTC").as_unit("ns")
    if anchor == "session_clock":
        # the clock time on the n-th calendar session after each date (review R-01)
        n, minutes = divmod(off, 1440)
        ahead = clock.positions + n
        if len(ahead) and ahead.max() >= len(clock.all_sessions):
            raise StudyError(f"the {CALENDAR} calendar ends before the {n}th session after {clock.sessions[-1].date()}")
        day = clock.all_sessions[ahead] if len(ahead) else clock.sessions
        wall = (day + pd.Timedelta(minutes=minutes)).tz_localize(NY, ambiguous=False, nonexistent="shift_forward")
        return wall.tz_convert("UTC").as_unit("ns")
    base = {"open": clock.opens, "close": clock.closes, "next_open": clock.next_opens}[anchor]
    return (base + delta).as_unit("ns")


MAX_ENTRY_DELAY = 15  # sessions; WTI's eighth-business-day rule is the longest declared (review R-01)


def entry_delay_vec(inputs: list[registry.DeskSeries], target: registry.DeskSeries, clock: SessionClock) -> np.ndarray:
    """Per session: how many sessions after it the target is entered, the
    first session whose fixing of the target is at or after every input is
    known (R-02), and never the same session for a target whose fixing time
    is ambiguous (R-03). An input known by the next open gives 0 or 1; WTI,
    known at 13:00 ET on the eighth business day after its date, gives 8
    (desk/hardening review R-01). Events and baseline take the same delay."""
    n = len(clock.sessions)
    if n == 0:
        return np.zeros(0, dtype=int)
    known = np.max(np.stack([when_vec(s.known, clock).asi8 for s in inputs]), axis=0)
    delay = np.full(n, -1, dtype=int)
    for d in range(1 if target.defer_as_target else 0, MAX_ENTRY_DELAY + 1):
        todo = delay < 0
        if not todo.any():
            break
        ahead = clock if d == 0 else clock_for(clock.cal, clock.all_sessions[clock.positions + d])
        delay[todo & (when_vec(target.fixed, ahead).asi8 >= known)] = d
    if (delay < 0).any():
        raise StudyError(f"{target.label} has no fixing within {MAX_ENTRY_DELAY} sessions of its inputs being known")
    return delay


def same_session_vec(inputs: list[registry.DeskSeries], target: registry.DeskSeries, clock: SessionClock) -> np.ndarray:
    """Per session: enter at that session's close (True) or a later one (False)."""
    return entry_delay_vec(inputs, target, clock) == 0


def when(rule: registry.Rule, sessions: pd.DatetimeIndex, pos: int):
    """One session's resolution of a rule (the vector form is the engine's)."""
    cal = session_calendar(sessions[0].strftime("%Y-%m-%d"), sessions[-1].strftime("%Y-%m-%d"))
    return when_vec(rule, clock_for(cal, sessions[[pos]]))[0].to_pydatetime()


def same_session_entry(inputs: list[registry.DeskSeries], target: registry.DeskSeries, sessions: pd.DatetimeIndex, pos: int) -> bool:
    cal = session_calendar(sessions[0].strftime("%Y-%m-%d"), sessions[-1].strftime("%Y-%m-%d"))
    return bool(same_session_vec(inputs, target, clock_for(cal, sessions[[pos]]))[0])


# ── alignment, validity and transforms (R-04, R-17) ───────────────────────────

def align(raw: pd.Series, sessions: pd.DatetimeIndex) -> tuple[pd.Series, int, int]:
    """The series on the session calendar (NaN where a session has no value),
    the observations inside the calendar's range dropped for being
    off-session, and the sessions inside the series' own range it is missing."""
    inside = (raw.index >= sessions[0]) & (raw.index <= sessions[-1])
    off = int((inside & ~raw.index.isin(sessions)).sum())
    al = raw.reindex(sessions)
    span = (sessions >= raw.index[0]) & (sessions <= raw.index[-1])
    missing = int(al[span].isna().sum())
    return al, off, missing


def validate_values(al: pd.Series, spec: registry.DeskSeries) -> tuple[pd.Series, int, str | None]:
    """R-17: non-finite values, and non-positive ones for a series that is
    logged, are exclusions with a reason; they become missing sessions."""
    present = al.notna()
    finite = np.isfinite(al.to_numpy(dtype=float))
    bad = present.to_numpy() & ~finite
    reason = "non-finite value"
    if spec.unit in ("log_return", "log_change"):
        bad = bad | (present.to_numpy() & finite & (al.to_numpy(dtype=float) <= 0.0))
        reason = "non-finite or non-positive value (the series is logged)"
    n_bad = int(bad.sum())
    if n_bad:
        al = al.where(~bad)
    return al, n_bad, (reason if n_bad else None)


def move(level: pd.Series, spec: registry.DeskSeries, w: int) -> pd.Series:
    """The w-session move in the series' declared unit; NaN when either
    session it reads (t−w or t) is missing."""
    if spec.unit == "bp":
        return level.diff(w) * spec.scale
    return np.log(level).diff(w)


def zscore(m: pd.Series, window: int = Z_WINDOW, min_present: int = Z_MIN_PRESENT) -> pd.Series:
    """z against the trailing `window` sessions of the same move, ending on
    (and including) each session; NaN at a session whose own move is missing
    or whose window holds fewer than `min_present` moves."""
    mu = m.rolling(window, min_periods=min_present).mean()
    sd = m.rolling(window, min_periods=min_present).std(ddof=1)
    return (m - mu) / sd.replace(0.0, np.nan)


def trigger_mask(z: pd.Series, thr: float, sign: str) -> np.ndarray:
    """The sessions whose z meets the threshold, before any cooldown: the
    comparison detect_events applies, and the Desk's firing state reads
    (desk/frame-3-api)."""
    if sign == "+":
        fire = z >= thr
    elif sign == "-":
        fire = z <= -thr
    else:
        fire = z.abs() >= thr
    return fire.fillna(False).to_numpy().astype(bool)


def _after_cooldown(hits: np.ndarray, w: int) -> np.ndarray:
    kept: list[int] = []
    next_ok = -1
    for i in hits:
        if i >= next_ok:
            kept.append(int(i))
            next_ok = int(i) + w + 1  # sessions i+1 … i+w are the cooldown
    return np.array(kept, dtype=int)


def detect_events(z: pd.Series, thr: float, sign: str, w: int) -> tuple[np.ndarray, int]:
    """Event positions after the cooldown, and the raw count before it."""
    hits = np.flatnonzero(trigger_mask(z, thr, sign))
    return _after_cooldown(hits, w), int(len(hits))


def rsi_zone_mask(r: pd.Series, side: str) -> np.ndarray:
    """The sessions whose RSI is strictly in the zone (above 70, or below 30):
    the raw trigger the Desk's firing state reads for an RSI study."""
    v = r.to_numpy(dtype=float)
    ok = np.isfinite(v)
    inside = np.zeros(len(v), dtype=bool)
    inside[ok] = v[ok] > RSI_UPPER if side == "above" else v[ok] < RSI_LOWER
    return inside


def rsi_crossings(r: pd.Series, side: str, cooldown: int = RSI_PERIOD) -> tuple[np.ndarray, int]:
    """Strict crossings into the zone (desk/fill-compute): a session whose RSI
    is in the zone when the preceding session's RSI was defined and not in it,
    so a crossing never bridges an undefined session and the level itself
    (70, 30) is outside the zone. After each retained crossing the next
    `cooldown` sessions are excluded. The positions after the cooldown, and
    the raw count before it."""
    inside = rsi_zone_mask(r, side)
    ok = np.isfinite(r.to_numpy(dtype=float))
    prev_ok = np.concatenate([[False], ok[:-1]])
    prev_in = np.concatenate([[False], inside[:-1]])
    hits = np.flatnonzero(inside & prev_ok & ~prev_in)
    return _after_cooldown(hits, cooldown), int(len(hits))


def cross_positions(level: pd.Series, kind: str) -> tuple[np.ndarray, pd.Series]:
    """Strict golden (50d above 200d) or death (50d below 200d) crosses (R-10):
    equality never fires; the state carries through equal sessions and a
    cross that resolves through equality fires on the first session strictly
    beyond. Also returns the evaluability of the rule (both averages exist)."""
    fast = level.rolling(MA_FAST, min_periods=MA_FAST).mean()
    slow = level.rolling(MA_SLOW, min_periods=MA_SLOW).mean()
    valid = (fast.notna() & slow.notna()).to_numpy()
    sgn = np.sign((fast - slow).to_numpy())
    out: list[int] = []
    side: int | None = None  # the carried side; equality keeps it (R-10), an unevaluable session resets it (R-21)
    want_from, want_to = (-1, 1) if kind == "golden" else (1, -1)
    for i in range(len(level)):
        if not valid[i] or np.isnan(sgn[i]):
            side = None
            continue
        s = int(sgn[i])
        if s == 0:
            continue
        if s == want_to and side == want_from and i > 0 and valid[i - 1]:
            out.append(i)  # the preceding session was evaluable and the carried side was the other one
        side = s
    return np.array(out, dtype=int), pd.Series(valid, index=level.index)


def condition_series(cond: str, value: float | str | None, al: dict[str, pd.Series]) -> pd.Series:
    """On the session calendar: 1.0 where the condition holds, 0.0 where it
    does not, NaN where it cannot be evaluated (warm-up, missing input)."""
    if cond == "spx_below_50dma":
        s = al[MASTER]
        ma = s.rolling(MA_FAST, min_periods=MA_FAST).mean()
        return (s < ma).astype(float).where(ma.notna() & s.notna())
    if cond == "spx_20d_negative":
        r = move(al[MASTER], registry.get(MASTER), 20)
        return (r < 0).astype(float).where(r.notna())
    if cond == "vix_above":
        s = al["vix"]
        return (s > float(value)).astype(float).where(s.notna())
    if cond == "hy_oas_20d_change_above":
        d = move(al["hy_oas"], registry.get("hy_oas"), 20)
        return (d > float(value)).astype(float).where(d.notna())
    raise StudyError(f"unknown condition {cond!r}")


def forward_moves(level: pd.Series, spec: registry.DeskSeries, pos: np.ndarray, h: int) -> np.ndarray:
    """The h-session forward move from each entry position on the aligned
    target; NaN when the window is incomplete (the entry session e or the
    exit session e+h missing, or e+h beyond the data)."""
    vals = level.to_numpy(dtype=float)
    n = len(vals)
    out = np.full(len(pos), np.nan)
    ok = (pos >= 0) & (pos + h < n)
    idx = np.flatnonzero(ok)
    idx = idx[~np.isnan(vals[pos[idx]]) & ~np.isnan(vals[pos[idx] + h])]
    p = pos[idx]
    if spec.unit == "bp":
        out[idx] = (vals[p + h] - vals[p]) * spec.scale
    else:
        out[idx] = np.log(vals[p + h] / vals[p])
    return out


# ── statistics (R-06, R-18) ───────────────────────────────────────────────────

def cluster_blocks(entries: np.ndarray, h: int) -> np.ndarray:
    """Block id per event (entries ascending): events whose forward windows
    e … e+h overlap share a block (R-06)."""
    ids = np.zeros(len(entries), dtype=int)
    bid, end = -1, -1
    for i, e in enumerate(entries):
        if e > end:
            bid += 1
            end = e + h
        else:
            end = max(end, e + h)
        ids[i] = bid
    return ids


def _weighted_medians(values_sorted: np.ndarray, block_of: np.ndarray, counts: np.ndarray) -> np.ndarray:
    """The median of each draw's resample: draw k holds every value of block
    b `counts[k, b]` times. Vectorized over draws."""
    w = counts[:, block_of]
    cw = np.cumsum(w, axis=1)
    total = cw[:, -1]
    k1 = (total - 1) // 2
    k2 = total // 2
    i1 = (cw <= k1[:, None]).sum(axis=1)
    i2 = (cw <= k2[:, None]).sum(axis=1)
    return (values_sorted[i1] + values_sorted[i2]) / 2.0


def block_resample_medians(ev: np.ndarray, blocks: np.ndarray, rng: np.random.Generator, n_boot: int) -> tuple[np.ndarray, str, int]:
    """Medians of the block resamples: every one of B^B draws when
    B ≤ EXACT_MAX_BLOCKS (exact), else `n_boot` Monte Carlo draws (R-18)."""
    order = np.argsort(ev, kind="stable")
    values_sorted, block_of = ev[order], blocks[order]
    B = int(blocks.max()) + 1
    if B <= EXACT_MAX_BLOCKS:
        n_draws = B**B
        out = np.empty(n_draws)
        chunk = 65536
        it = itertools.product(range(B), repeat=B)
        done = 0
        while done < n_draws:
            rows = np.fromiter(itertools.chain.from_iterable(itertools.islice(it, chunk)), dtype=np.int64)
            rows = rows.reshape(-1, B)
            counts = np.zeros((len(rows), B), dtype=np.int64)
            np.add.at(counts, (np.repeat(np.arange(len(rows)), B), rows.ravel()), 1)
            out[done:done + len(rows)] = _weighted_medians(values_sorted, block_of, counts)
            done += len(rows)
        return out, "exact", n_draws
    draws = rng.integers(0, B, size=(n_boot, B))
    counts = np.zeros((n_boot, B), dtype=np.int64)
    np.add.at(counts, (np.repeat(np.arange(n_boot), B), draws.ravel()), 1)
    return _weighted_medians(values_sorted, block_of, counts), "monte_carlo", n_boot


def horizon_stats(ev: np.ndarray, entries: np.ndarray, base: np.ndarray, h: int, rng: np.random.Generator,
                  n_boot: int = N_BOOT, ci: float = CI_LEVEL) -> dict:
    """One horizon: its own n (events with a complete window), the events'
    statistics, the baseline's, Δ, and the cluster-bootstrap interval on Δ
    (exact or Monte Carlo, disclosed); the exclusion verdict needs
    MIN_BLOCKS_EXCLUSION blocks."""
    keep = ~np.isnan(ev)
    ev, entries = ev[keep], entries[keep]
    base = base[~np.isnan(base)]
    n_incomplete = int((~keep).sum())
    out: dict[str, Any] = {"h": h, "n": int(len(ev)), "n_incomplete": n_incomplete, "baseline_n": int(len(base)),
                           "resampling": None, "n_draws": 0}
    if len(base):
        out.update(baseline_median=float(np.median(base)), baseline_hit_rate=float(np.mean(base > 0)),
                   baseline_p25=float(np.percentile(base, 25)), baseline_p75=float(np.percentile(base, 75)))
    else:
        out.update(baseline_median=None, baseline_hit_rate=None, baseline_p25=None, baseline_p75=None)
    if len(ev) == 0 or not len(base):
        out.update(hit_rate=None, median=None, mean=None, p25=None, p75=None, delta=None, n_blocks=0, ci90=None,
                   ci_excludes_zero=None, note="insufficient data")
        return out
    order = np.argsort(entries, kind="stable")
    ev, entries = ev[order], entries[order]
    blocks = cluster_blocks(entries, h)
    n_blocks = int(blocks.max()) + 1
    med = float(np.median(ev))
    out.update(hit_rate=float(np.mean(ev > 0)), median=med, mean=float(np.mean(ev)),
               p25=float(np.percentile(ev, 25)), p75=float(np.percentile(ev, 75)),
               delta=med - out["baseline_median"], n_blocks=n_blocks)
    if n_blocks < MIN_BLOCKS_INTERVAL:
        out.update(ci90=None, ci_excludes_zero=None, note=f"too few blocks for an interval ({n_blocks} < {MIN_BLOCKS_INTERVAL})")
        return out
    medians, method, n_draws = block_resample_medians(ev, blocks, rng, n_boot)
    deltas = medians - out["baseline_median"]
    judged = judge_exclusion(deltas, out["delta"], ci)
    out.update(ci90=judged["ci90"], resampling=method, n_draws=int(n_draws), opposite_sign_share=judged["opposite_sign_share"])
    if n_blocks < MIN_BLOCKS_EXCLUSION:
        out.update(ci_excludes_zero=None, exclusion=None, note="too few independent blocks to judge exclusion")
    else:
        out.update(ci_excludes_zero=judged["ci_excludes_zero"], exclusion=judged["exclusion"],
                   note=None if judged["exclusion"] != "not established" else "exclusion not established")
    return out


def judge_exclusion(deltas: np.ndarray, point: float, ci: float = CI_LEVEL) -> dict:
    """R-18 (round 3, final): the interval on Δ, the adverse share of the
    resampled medians, and the verdict. Zero is adverse: with a positive
    point estimate the adverse draws are those ≤ 0, with a negative one
    those ≥ 0 (a point estimate of exactly zero is wholly adverse). The
    interval "excludes zero" when it lies on the point estimate's side,
    the boundary included, so an interval touching zero, such as
    [−0.02, 0], is judged and fails the adverse-share ceiling rather than
    reading as "included". Both bounds are resampled values (the lower by
    numpy's "lower" method, the upper by "higher"), never interpolations
    between them. "established" only when the interval excludes
    zero and the adverse share is below OPPOSITE_SIGN_MAX; "not
    established" when the two disagree; "included" otherwise."""
    tail = (1.0 - ci) / 2.0 * 100.0
    # both bounds are resampled values, never interpolations, rounded outward
    lo = float(np.percentile(deltas, tail, method="lower"))
    hi = float(np.percentile(deltas, 100.0 - tail, method="higher"))
    if point > 0:
        share = float(np.mean(deltas <= 0.0))
        excludes = bool(lo >= 0.0)
    elif point < 0:
        share = float(np.mean(deltas >= 0.0))
        excludes = bool(hi <= 0.0)
    else:
        share = 1.0
        excludes = False
    if not excludes:
        verdict = "included"
    elif share < OPPOSITE_SIGN_MAX:
        verdict = "established"
    else:
        verdict = "not established"
    return {"ci90": [float(lo), float(hi)], "ci_excludes_zero": excludes, "opposite_sign_share": share, "exclusion": verdict}


def _clean(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=float)
    return a[~np.isnan(a)]


def regime_split(labels: np.ndarray, moves_by_h: dict[int, np.ndarray], base_labels: np.ndarray,
                 base_by_h: dict[int, np.ndarray], unl_by_h: dict[int, np.ndarray] | None = None) -> list[dict]:
    """Per regime and horizon: n, hit rate, median and mean (suppressed below
    MIN_REGIME_N with note "n<10") beside that regime's own baseline. The
    Unlabeled row reports the events outside the totals (R-05)."""
    rows = []
    for r in list(REGIME_LABELS) + [UNLABELED]:
        per_h = []
        if r == UNLABELED:
            n_ev = int(len(unl_by_h[HORIZONS[0]])) if unl_by_h else 0
        else:
            n_ev = int((labels == r).sum())
        for h in moves_by_h:
            if r == UNLABELED:
                a = _clean(unl_by_h[h]) if unl_by_h else np.array([])
                b = np.array([])
            else:
                a = _clean(moves_by_h[h][labels == r])
                b = _clean(base_by_h[h][base_labels == r]) if len(base_labels) else np.array([])
            n = int(len(a))
            cell: dict[str, Any] = {"h": h, "n": n, "baseline_n": int(len(b)),
                                    "baseline_median": float(np.median(b)) if len(b) else None,
                                    "baseline_hit_rate": float(np.mean(b > 0)) if len(b) else None}
            if n >= MIN_REGIME_N:
                cell.update(hit_rate=float(np.mean(a > 0)), median=float(np.median(a)), mean=float(np.mean(a)), note=None)
            else:
                cell.update(hit_rate=None, median=None, mean=None, note="n<10")
            per_h.append(cell)
        rows.append({"regime": r, "n_events": n_ev, "excluded_from_totals": r == UNLABELED, "horizons": per_h})
    return rows


# ── formatting and verdict ────────────────────────────────────────────────────

def fmt_move(x: float | None, unit: str) -> str:
    if x is None:
        return "n/a"
    if unit == "bp":
        return f"{x:+.0f} bp"
    return f"{x * 100:+.1f}%"


def _hn(row: dict) -> str:
    return f"{row['h']} sessions (n = {row['n']}, {row['n_blocks']} block{'s' if row['n_blocks'] != 1 else ''})"


def zero_event_sentence(stages: list[dict], shock_label: str) -> str:
    """R-19: name the filtering stage that emptied the set, from the recorded stages."""
    prev = None
    for st in stages:
        if st["n"] == 0:
            if prev is None:
                return f"No events: no session of {shock_label} met the threshold."
            return (f"No events: {prev['n']} session{'s' if prev['n'] != 1 else ''} passed the {prev['stage']} stage "
                    f"({prev['what']}) but none passed the {st['stage']} stage ({st['what']}).")
        prev = st
    return "No events."


def verdict_sentences(*, unit: str, horizons: list[dict], regimes: list[dict], data_start: pd.Timestamp,
                      sample_start: pd.Timestamp, sample_end: pd.Timestamp, n_events: int, n_raw: int, w: int | None,
                      shock_label: str, target_label: str, stages: list[dict] | None = None,
                      raw_word: str = "shock sessions") -> list[str]:
    """Rule-generated sentences. Vocabulary: "modest", "material",
    "concentrated in", "not distinguishable from baseline", "insufficient
    data", "too few independent blocks to judge exclusion", "exclusion not established". Never predicts,
    will, proves, or model. Every cited horizon carries its own n and block
    count (R-08); the interval sentence covers only horizons that have one
    (R-11); a ranking needs two eligible regimes (R-12) and a contrast of at
    least MIN_REGIME_CONTRAST (R-20)."""
    out: list[str] = []
    with_ci = [r for r in horizons if r.get("ci90")]
    judged = [r for r in with_ci if r.get("exclusion") is not None]
    unjudged = [r for r in with_ci if r.get("exclusion") is None]
    excl = [r for r in judged if r["exclusion"] == "established"]
    weak = [r for r in judged if r["exclusion"] == "not established"]
    incl = [r for r in judged if r["exclusion"] == "included"]
    none = [r for r in horizons if r["n"] == 0]
    few = [r for r in horizons if r["n"] > 0 and not r.get("ci90")]
    fmt_unit = "pct" if unit != "bp" else "bp"
    if n_events == 0:
        out.append(zero_event_sentence(stages or [], shock_label))
    else:
        if excl:
            out.append(f"The 90% interval on Δ excludes zero at {'; '.join(_hn(r) for r in excl)}.")
            p = next((r for r in excl if r["h"] == PRIMARY_HORIZON), excl[0])
            iqr = (p["baseline_p75"] or 0.0) - (p["baseline_p25"] or 0.0)
            size = "modest" if iqr <= 0 or abs(p["delta"]) < MODEST_IQR * iqr else "material"
            out.append(f"The effect is {size} at {p['h']} sessions (n = {p['n']}): median {fmt_move(p['median'], unit)} against a "
                       f"baseline of {fmt_move(p['baseline_median'], unit)}, Δ {fmt_move(p['delta'], unit)}.")
        for r in weak:
            out.append(f"At {_hn(r)} the 90% interval on Δ is [{fmt_move(r['ci90'][0], unit)}, {fmt_move(r['ci90'][1], unit)}] but "
                       f"{r['opposite_sign_share'] * 100:.1f}% of resampled medians are adverse (zero included); exclusion not established.")
        if incl:
            out.append(f"{target_label} is not distinguishable from baseline at {'; '.join(_hn(r) for r in incl)}"
                       f"{' (the 90% interval on Δ includes zero)' if not excl and not weak else ''}.")
        for r in unjudged:
            out.append(f"At {_hn(r)} the 90% interval on Δ is [{fmt_move(r['ci90'][0], unit)}, {fmt_move(r['ci90'][1], unit)}]; "
                       f"too few independent blocks to judge exclusion.")
        for r in few:
            out.append(f"No interval at {r['h']} sessions: {r['n']} event{'s' if r['n'] != 1 else ''} in {r['n_blocks']} "
                       f"overlapping block{'s' if r['n_blocks'] != 1 else ''}, fewer than the {MIN_BLOCKS_INTERVAL} an interval needs.")
    for r in none:
        out.append(f"Insufficient data at {r['h']} sessions (n = 0 completed windows).")
    # regimes at the primary horizon (the Unlabeled row is outside the totals and never ranked)
    eligible, small = [], []
    for row in regimes:
        cell = next(c for c in row["horizons"] if c["h"] == PRIMARY_HORIZON)
        if row["regime"] == UNLABELED:
            if cell["n"] > 0:
                small.append(f"{UNLABELED} ({cell['n']}, outside the totals)")
            continue
        if cell["note"] == "n<10":
            small.append(f"{row['regime']} ({cell['n']})")
        else:
            eligible.append((row["regime"], cell))
    if len(eligible) >= 2:
        eligible.sort(key=lambda t: t[1]["median"], reverse=True)
        strong, second, weak = eligible[0], eligible[1], eligible[-1]
        contrast = strong[1]["median"] - second[1]["median"]
        floor = MIN_REGIME_CONTRAST[fmt_unit]
        if contrast < floor:
            out.append(f"The two leading regimes at {PRIMARY_HORIZON} sessions are within "
                       f"{'0.5 percentage points' if fmt_unit == 'pct' else '5 bp'} of each other ({strong[0]} n = {strong[1]['n']}, median "
                       f"{fmt_move(strong[1]['median'], unit)}; {second[0]} n = {second[1]['n']}, median {fmt_move(second[1]['median'], unit)}); "
                       "no strongest or weakest claim.")
        else:
            out.append(f"At {PRIMARY_HORIZON} sessions the response is concentrated in {strong[0]} (n = {strong[1]['n']}, median "
                       f"{fmt_move(strong[1]['median'], unit)}); weakest in {weak[0]} (n = {weak[1]['n']}, median {fmt_move(weak[1]['median'], unit)}).")
    elif len(eligible) == 1:
        r, cell = eligible[0]
        out.append(f"Only {r} reaches n ≥ {MIN_REGIME_N} at {PRIMARY_HORIZON} sessions (n = {cell['n']}, median "
                   f"{fmt_move(cell['median'], unit)}); no ranking across regimes.")
    elif n_events:
        out.append(f"No regime reaches n = {MIN_REGIME_N} at {PRIMARY_HORIZON} sessions, so the split is not informative.")
    if small:
        out.append("n<10: " + ", ".join(small) + ".")
    tail = f"{n_events} events"
    if w is not None:
        tail += f" after a {w}-session cooldown ({n_raw} {raw_word} before it)"
    else:
        tail += "; no cooldown, a cross cannot recur before the opposite cross"
    prim = next((r for r in horizons if r["h"] == PRIMARY_HORIZON), None)
    if prim and prim["n"]:
        tail += f"; {prim['n_blocks']} independent block{'s' if prim['n_blocks'] != 1 else ''} at {PRIMARY_HORIZON} sessions"
        if prim.get("resampling"):
            tail += f" ({'exact enumeration' if prim['resampling'] == 'exact' else 'Monte Carlo'}, {prim['n_draws']:,} draws)"
    out.append(f"Sample since {data_start.year} (data from {data_start.date()}; events evaluable "
               f"{sample_start.date()} to {sample_end.date()}); {tail}.")
    return out


# ── the study ─────────────────────────────────────────────────────────────────

def _series_meta(key: str, raw: pd.Series, off: int, missing: int, invalid: int, invalid_reason: str | None) -> dict:
    spec = registry.get(key)
    first = raw.index[0].strftime("%Y-%m-%d")
    return {
        "key": key, "label": spec.label, "series_id": spec.series_id, "table": spec.table,
        "unit": spec.unit, "known_by": spec.known_by,
        "fixed": registry.rule_str(spec.fixed), "known": registry.rule_str(spec.known), "defer_as_target": spec.defer_as_target,
        "history_from": first, "history_declared": spec.history_from,
        "last": raw.index[-1].strftime("%Y-%m-%d"), "rows": int(len(raw)),
        "off_session_dropped": off, "missing_sessions": missing,
        "invalid_values": invalid, "invalid_reason": invalid_reason,
        "content_hash": content_hash(raw),
        "warn": first > registry.HISTORY_BAR, "note": spec.note,
    }


def _inputs_hash(q: Query, metas: list[dict], months: pd.Series, generation: Any, horizons: list[dict],
                 future_excluded: dict[str, int] | None = None, non_numeric_excluded: dict[str, int] | None = None,
                 malformed_date_excluded: dict[str, int] | None = None, no_provenance_excluded: dict[str, int] | None = None) -> str:
    """R-09: the data generation id, the content hash of every input series
    and of the regime table, every effective parameter, the timing rules and
    the resampling method and draws per horizon, and the rows the as-of left
    out (R-06; absent when none, so a clean store hashes as before)."""
    payload = {
        "generation": str(generation),
        "params": asdict(q),
        "series": {m["series_id"]: m["content_hash"] for m in metas},
        "regimes": content_hash(pd.Series(months.to_numpy(dtype=object), index=[str(p) for p in months.index])),
        "timing": {m["key"]: [m["fixed"], m["known"], m["defer_as_target"]] for m in metas},
        "resampling": {str(r["h"]): [r["resampling"], r["n_draws"]] for r in horizons},
        "engine": {"calendar": CALENDAR, "z_window": Z_WINDOW, "z_min_present": Z_MIN_PRESENT, "n_boot": N_BOOT, "ci": CI_LEVEL,
                   "lag": REGIME_LAG_MONTHS, "horizons": HORIZONS, "ma": [MA_FAST, MA_SLOW], "exact_max_blocks": EXACT_MAX_BLOCKS,
                   "min_blocks_interval": MIN_BLOCKS_INTERVAL, "min_blocks_exclusion": MIN_BLOCKS_EXCLUSION,
                   "opposite_sign_max": OPPOSITE_SIGN_MAX, "master": MASTER},
    }
    if q.kind == "rsi":  # desk/fill-compute; absent for every other kind, so they hash as before
        payload["rsi"] = {"period": RSI_PERIOD, "upper": RSI_UPPER, "lower": RSI_LOWER, "smoothing": "wilder",
                          "event": "strict crossing", "cooldown": q.w}
    if future_excluded:
        payload["future_excluded"] = dict(sorted(future_excluded.items()))
    if non_numeric_excluded:  # V-14; absent when none, so a clean store hashes as before
        payload["non_numeric_excluded"] = dict(sorted(non_numeric_excluded.items()))
    if malformed_date_excluded:  # V-22; the same
        payload["malformed_date_excluded"] = dict(sorted(malformed_date_excluded.items()))
    if no_provenance_excluded:  # Codex R-14; the same
        payload["no_provenance_excluded"] = dict(sorted(no_provenance_excluded.items()))
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def run(q: Query, db_path: Path | str = DB_PATH, *, n_boot: int = N_BOOT, as_of: str | None = None) -> dict:
    """Run one study against the stored data. JSON-safe dict."""
    cutoff = resolve_as_of(as_of, db_path)
    conn = _connect(db_path)
    try:
        return run_on(conn, q, generation=dbpath.current_key(db_path), n_boot=n_boot, as_of=cutoff)
    finally:
        conn.close()


def run_on(conn: sqlite3.Connection, q: Query, *, generation: Any, n_boot: int = N_BOOT, as_of: str | None = None) -> dict:
    """Run one study on a given connection (the API leases a generation's
    copy and hands it here with the generation's as-of, R-16, R-06)."""
    raw_cv = q.cond_value
    q = validate(q)
    clamped = (isinstance(q.cond_value, float) and raw_cv is not None and not isinstance(raw_cv, str)
               and abs(float(raw_cv)) > COND_VALUE_BOUND)
    return _run(q, conn, n_boot=n_boot, generation=generation, clamped=clamped, as_of=resolve_as_of(as_of))


@dataclass(frozen=True)
class EventTable:
    """A run's retained events, ascending, one row per event (desk/frame-3-api
    plan §2): the event set the run's own statistics are computed from, so the
    Desk's counts, extrema and CSV are projections of it and nothing is rebuilt
    from `recent_events`. Arrays are read-only; `sessions` is the study's
    calendar as ISO dates, shared with the run's SignalTrace."""

    sessions: tuple[str, ...]
    event_idx: np.ndarray               # int[k], positions on `sessions`
    entry_idx: np.ndarray               # int[k], event + delay; −1 when the entry is after the stored data
    entry_delay: np.ndarray             # int[k], for every event, entry-less ones included
    same_session: np.ndarray            # bool[k], entry_delay == 0
    regime: tuple[str, ...]             # the K−2 label per event
    exit_idx: dict[int, np.ndarray]     # h → int[k], entry + h when value[h] is finite, else −1
    value: dict[int, np.ndarray]        # h → float[k], the native outcome, NaN when incomplete
    n_unlabeled: int

    def __len__(self) -> int:
        return len(self.event_idx)


@dataclass(frozen=True)
class SignalTrace:
    """Per session of the study's calendar: the evaluability mask, the raw
    trigger (the threshold comparison before the cooldown, or the strict
    crossing sessions), whether the condition holds, and the shock's z (None
    for a cross). Read-only arrays; the firing state is computed from them."""

    sessions: tuple[str, ...]
    evaluable: np.ndarray               # bool[n]
    trigger: np.ndarray                 # bool[n]
    holds: np.ndarray                   # bool[n]
    z: np.ndarray | None                # float[n]
    # Codex R-03 (desk/fill-compute): each input's newest validated observation on the calendar (after
    # alignment drops off-session rows and validation sets bad values aside), (key, "YYYY-MM-DD" | None)
    inputs_last: tuple[tuple[str, str | None], ...] = ()


def _frozen(a: np.ndarray, dtype: Any) -> np.ndarray:
    out = np.array(a, dtype=dtype, copy=True)
    out.setflags(write=False)
    return out


def _traced(t: dict) -> tuple[EventTable, SignalTrace]:
    sessions = tuple(np.datetime_as_string(t["sessions"].to_numpy(dtype="datetime64[ns]"), unit="D").tolist())
    entry = np.where(t["has_entry"], t["entry"], -1)
    value = {h: _frozen(v, float) for h, v in t["moves_by_h"].items()}
    table = EventTable(
        sessions=sessions,
        event_idx=_frozen(t["ev_pos"], np.int64),
        entry_idx=_frozen(entry, np.int64),
        entry_delay=_frozen(t["ev_delay"], np.int64),
        same_session=_frozen(t["same"], bool),
        regime=tuple(str(x) for x in t["labels"]),
        exit_idx={h: _frozen(np.where(np.isfinite(v), entry + h, -1), np.int64) for h, v in value.items()},
        value=value,
        n_unlabeled=int(t["n_unlabeled"]),
    )
    trace = SignalTrace(
        sessions=sessions,
        evaluable=_frozen(t["evaluable"], bool),
        trigger=_frozen(t["trigger"], bool),
        holds=_frozen(t["holds"], bool),
        z=None if t["z"] is None else _frozen(t["z"], float),
        inputs_last=t.get("inputs_last", ()),
    )
    return table, trace


def run_traced(q: Query, db_path: Path | str = DB_PATH, *, n_boot: int = N_BOOT,
               as_of: str | None = None) -> tuple[dict, EventTable, SignalTrace]:
    """`run`, also returning the run's full event table and signal trace
    (desk/frame-3-api). The dict is the one `run` returns, byte for byte."""
    cutoff = resolve_as_of(as_of, db_path)
    conn = _connect(db_path)
    try:
        return run_on_traced(conn, q, generation=dbpath.current_key(db_path), n_boot=n_boot, as_of=cutoff)
    finally:
        conn.close()


def run_on_traced(conn: sqlite3.Connection, q: Query, *, generation: Any, n_boot: int = N_BOOT,
                  as_of: str | None = None) -> tuple[dict, EventTable, SignalTrace]:
    """`run_on`, also returning the event table and signal trace, which leave
    `_run` on a side channel and are never keys of the dict."""
    raw_cv = q.cond_value
    q = validate(q)
    clamped = (isinstance(q.cond_value, float) and raw_cv is not None and not isinstance(raw_cv, str)
               and abs(float(raw_cv)) > COND_VALUE_BOUND)
    t: dict = {}
    out = _run(q, conn, n_boot=n_boot, generation=generation, clamped=clamped, as_of=resolve_as_of(as_of), trace=t)
    return (out, *_traced(t))


def _run(q: Query, conn: sqlite3.Connection, *, n_boot: int, generation: Any, clamped: bool = False, as_of: str,
         trace: dict | None = None) -> dict:
    target_spec = registry.get(q.target)
    shock_spec = registry.get(q.shock)
    cond_meta = CONDITIONS.get(q.cond or "") if q.kind == "shock" else None
    keys = {q.target, q.shock}
    if cond_meta and cond_meta["series"]:
        keys.add(cond_meta["series"])
    raw = {k: load_level(conn, registry.get(k), as_of) for k in sorted(keys)}
    future_excluded = {k: s.attrs.get("future_excluded", 0) for k, s in raw.items() if s.attrs.get("future_excluded", 0)}
    non_numeric = {k: s.attrs.get("non_numeric_excluded", 0) for k, s in raw.items() if s.attrs.get("non_numeric_excluded", 0)}
    malformed = {k: s.attrs.get("malformed_date_excluded", 0) for k, s in raw.items() if s.attrs.get("malformed_date_excluded", 0)}
    unprovenanced = {k: s.attrs.get("no_provenance_excluded", 0) for k, s in raw.items() if s.attrs.get("no_provenance_excluded", 0)}
    months = load_regimes(conn)

    # the session calendar over the whole span of the inputs (R-04, R-02)
    start = min(s.index[0] for s in raw.values()).strftime("%Y-%m-%d")
    end = max(s.index[-1] for s in raw.values()).strftime("%Y-%m-%d")
    cal = session_calendar(start, end)
    sessions = sessions_between(cal, start, end)
    if len(sessions) == 0:
        raise StudyError(f"no {CALENDAR} session between {start} and {end}")
    clock = clock_for(cal, sessions)
    al: dict[str, pd.Series] = {}
    off: dict[str, int] = {}
    missing: dict[str, int] = {}
    invalid: dict[str, int] = {}
    invalid_reason: dict[str, str | None] = {}
    for k, s in raw.items():
        a, off[k], missing[k] = align(s, sessions)
        al[k], invalid[k], invalid_reason[k] = validate_values(a, registry.get(k))
    target, shock = al[q.target], al[q.shock]
    n_sessions = len(sessions)

    # events on the session calendar
    if q.kind == "rsi":
        r = technicals.rsi(shock)
        ev_pos, n_raw = rsi_crossings(r, q.cross or "above", q.w)
        n_shocks = int(len(ev_pos))
        w = q.w
        # Codex R-02 (desk/fill-compute): a session is eligible, as an event or a baseline candidate, only
        # where a crossing could be judged there: its RSI and the preceding session's both defined (the
        # crossing rule reads both), so the first session after an RSI re-seed is neither.
        input_ok = r.notna() & r.shift(1).notna()
        level = RSI_UPPER if q.cross == "above" else RSI_LOWER
        study_label = f"S&P 500 {RSI_PERIOD}-session RSI (Wilder) crossing {q.cross} {level:g}, strict"
        z = None
    elif q.kind == "cross":
        ev_pos, rule_ok = cross_positions(shock, q.cross or "golden")
        n_raw = n_shocks = int(len(ev_pos))
        w = None
        input_ok = rule_ok
        study_label = f"S&P 500 {q.cross} cross (50-day average crossing {'above' if q.cross == 'golden' else 'below'} the 200-day, strict)"
        z = None
    else:
        z = zscore(move(shock, shock_spec, q.w))
        if z.notna().sum() == 0:
            raise StudyError(f"{shock_spec.label} has fewer than {Z_MIN_PRESENT + q.w} sessions with a value on the calendar; no z-score can be formed.")
        ev_pos, n_raw = detect_events(z, q.z, q.sign, q.w)
        n_shocks = int(len(ev_pos))
        w = q.w
        input_ok = z.notna()
        word = {"+": "≥ +", "-": "≤ −", "both": "|z| ≥ "}[q.sign]
        study_label = f"{shock_spec.label} {q.w}-session move {word}{q.z:g}σ (252-session z)"

    # the evaluability mask (R-05)
    labels_all = regime_at(sessions, months).to_numpy(dtype=object)
    labeled = pd.Series(labels_all != UNLABELED, index=sessions)
    cond_label = None
    cond_ok = pd.Series(True, index=sessions)
    holds = pd.Series(True, index=sessions)
    if q.kind == "shock" and q.cond is not None:
        if q.cond == "regime":
            holds = pd.Series(labels_all == q.cond_value, index=sessions)
            cond_label = CONDITIONS[q.cond]["label"].format(value=q.cond_value)
        else:
            cs = condition_series(q.cond, q.cond_value, al)
            if cs.notna().sum() == 0:
                raise StudyError(f"{q.cond} cannot be evaluated: its input has too little history.")
            cond_ok = cs.notna()
            holds = cs.eq(1.0)
            cond_label = CONDITIONS[q.cond]["label"].format(value=q.cond_value) if q.cond_value is not None else CONDITIONS[q.cond]["label"]
    target_ok = target.notna()
    mask_no_regime = (input_ok & cond_ok & target_ok).to_numpy()
    evaluable = mask_no_regime & labeled.to_numpy()
    if not evaluable.any():
        raise StudyError("no evaluable session: the inputs, the condition and the regime table do not overlap.")
    ev_sessions = np.flatnonzero(evaluable)
    sample_start, sample_end = sessions[ev_sessions[0]], sessions[ev_sessions[-1]]

    # the filtering stages (R-19)
    holds_arr = holds.to_numpy()
    n_evaluable_events = int(evaluable[ev_pos].sum())
    unl_pos = ev_pos[mask_no_regime[ev_pos] & ~labeled.to_numpy()[ev_pos] & holds_arr[ev_pos]]
    ev_pos = ev_pos[evaluable[ev_pos] & holds_arr[ev_pos]]
    n_after_condition = int(len(ev_pos))
    labels = labels_all[ev_pos]
    if q.regime != "all":
        sel = labels == q.regime
        ev_pos, labels = ev_pos[sel], labels[sel]
    n_events = int(len(ev_pos))

    # entry (R-01, R-02, R-03): the same delay for events and baseline candidates (R-05)
    inputs = [shock_spec] + ([registry.get(cond_meta["series"])] if cond_meta and cond_meta["series"] else [])
    delay_all = entry_delay_vec(inputs, target_spec, clock)

    def entries_for(pos: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        delay = delay_all[pos] if len(pos) else np.zeros(0, dtype=int)
        ent = pos + delay
        has = ent < n_sessions
        return np.where(has, ent, -1), delay == 0, has

    entry, same, has_entry = entries_for(ev_pos)
    ev_delay = delay_all[ev_pos] if len(ev_pos) else np.zeros(0, dtype=int)
    n_no_entry = int((~has_entry).sum())
    moves_by_h = {h: forward_moves(target, target_spec, entry, h) for h in HORIZONS}
    unl_entry, _, _ = entries_for(unl_pos)
    unl_by_h = {h: forward_moves(target, target_spec, unl_entry, h) for h in HORIZONS}
    base_pos = ev_sessions
    base_entry, _, base_has = entries_for(base_pos)
    base_by_h = {h: forward_moves(target, target_spec, base_entry, h) for h in HORIZONS}
    base_labels = labels_all[base_pos]  # the regime of the signal date

    rng = np.random.default_rng(q.seed)
    horizons = [horizon_stats(moves_by_h[h], entry, base_by_h[h], h, rng, n_boot=n_boot) for h in HORIZONS]
    regimes = regime_split(labels, moves_by_h, base_labels, base_by_h, unl_by_h)

    stages = [
        {"stage": "threshold", "n": n_raw, "what": (f"sessions where {shock_spec.label} met the threshold" if q.kind == "shock" else
                                                     "strict RSI crossings" if q.kind == "rsi" else "strict crosses")},
        {"stage": "cooldown", "n": n_shocks, "what": f"first sessions after a {w}-session cooldown" if w else "crosses"},
        {"stage": "evaluable", "n": n_evaluable_events, "what": "on an evaluable session (z, condition, target and lagged regime label present)"},
        {"stage": "condition", "n": n_after_condition, "what": f"with the condition holding ({cond_label})" if cond_label else "no condition"},
        {"stage": "regime filter", "n": n_events, "what": f"in regime {q.regime}" if q.regime != "all" else "no regime filter"},
        {"stage": "entry", "n": int(has_entry.sum()), "what": "with an entry session inside the data"},
    ] + [{"stage": f"complete window {r['h']}", "n": r["n"], "what": f"with the {r['h']}-session exit inside the data and present"} for r in horizons]

    zs = z.to_numpy(dtype=float)[ev_pos] if z is not None and len(ev_pos) else None
    recent = []
    for i in range(max(0, len(ev_pos) - 10), len(ev_pos)):
        recent.append({
            "date": sessions[ev_pos[i]].strftime("%Y-%m-%d"),
            "z": None if zs is None or np.isnan(zs[i]) else round(float(zs[i]), 2),
            "regime": str(labels[i]),
            "entry_date": sessions[entry[i]].strftime("%Y-%m-%d") if has_entry[i] else None,
            "same_session": bool(same[i]),
            "entry_delay": int(ev_delay[i]),
            "moves": {str(h): (None if np.isnan(moves_by_h[h][i]) else float(moves_by_h[h][i])) for h in HORIZONS},
        })
    recent.reverse()

    if trace is not None:
        # desk/frame-3-api: the run's own arrays, copied onto a side channel; nothing here reaches
        # the returned dict, so the native payload and inputs_hash are unchanged
        if q.kind == "cross":
            trigger = np.zeros(n_sessions, dtype=bool)
            trigger[cross_positions(shock, q.cross or "golden")[0]] = True
        elif q.kind == "rsi":
            trigger = rsi_zone_mask(r, q.cross or "above")  # the zone, before the crossing rule and the cooldown
        else:
            trigger = trigger_mask(z, q.z, q.sign)
        last_valid = {}
        for k, a in al.items():
            ok = np.flatnonzero(np.isfinite(a.to_numpy(dtype=float)))
            last_valid[k] = sessions[int(ok[-1])].strftime("%Y-%m-%d") if len(ok) else None
        trace.update(
            inputs_last=tuple(sorted(last_valid.items())),
            sessions=sessions, ev_pos=ev_pos.copy(), labels=labels.copy(), entry=entry.copy(), same=same.copy(),
            has_entry=has_entry.copy(), ev_delay=ev_delay.copy(), moves_by_h={h: m.copy() for h, m in moves_by_h.items()},
            n_unlabeled=int(len(unl_pos)), z=None if z is None else z.to_numpy(dtype=float).copy(),
            evaluable=evaluable.copy(), trigger=trigger, holds=holds_arr.astype(bool),
        )

    metas = [_series_meta(k, raw[k], off[k], missing[k], invalid[k], invalid_reason[k]) for k in sorted(raw)]
    as_of_by = {m["key"]: m["last"] for m in metas}
    data_start = max(raw[k].index[0] for k in keys)
    sentences = verdict_sentences(
        unit=target_spec.unit, horizons=horizons, regimes=regimes, data_start=data_start,
        sample_start=sample_start, sample_end=sample_end, n_events=n_events, n_raw=n_raw, w=w,
        shock_label=shock_spec.label, target_label=target_spec.label, stages=stages,
        **({"raw_word": "RSI crossings"} if q.kind == "rsi" else {}),
    )
    # review R-01: an input known sessions after its date says so, and what it does to the entry
    for spec in inputs:
        if spec.known[0] == "session_clock" and len(ev_delay):
            lo, hi = int(ev_delay.min()), int(ev_delay.max())
            span = f"{lo} sessions" if lo == hi else f"{lo} to {hi} sessions"
            sentences.append(f"{spec.label} is taken as known at {registry.rule_str(spec.known)}"
                             + (f" ({spec.known_note})" if spec.known_note else "")
                             + f", so each event enters {target_spec.label} {span} after its date; the baseline takes the same delay.")
    warnings = [f"{m['label']}: history from {m['history_from']} (after {registry.HISTORY_BAR[:4]})" for m in metas if m["warn"]]
    if (q.kind == "shock" and q.cond == "regime") or q.regime != "all":
        warnings.append(f"a regime condition or filter limits the sample to sessions with a lagged label ({sample_start.date()} to {sample_end.date()}).")
    dropped = {m["key"]: m["off_session_dropped"] for m in metas if m["off_session_dropped"]}
    if dropped:
        warnings.append("off-session observations dropped: " + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items())) + ".")
    gaps = {m["key"]: m["missing_sessions"] for m in metas if m["missing_sessions"]}
    if gaps:
        warnings.append("calendar sessions without a value: " + ", ".join(f"{k} {v}" for k, v in sorted(gaps.items())) + ".")
    bad = {m["key"]: (m["invalid_values"], m["invalid_reason"]) for m in metas if m["invalid_values"]}
    if bad:
        warnings.append("invalid values excluded: " + ", ".join(f"{k} {v} ({why})" for k, (v, why) in sorted(bad.items())) + ".")
    if future_excluded:
        # R-14, R-15: a row not after the as-of but after the New York date of the refresh that
        # committed it is named with that date
        after_as_of = {k: n - raw[k].attrs.get("after_run_excluded", 0) for k, n in future_excluded.items()}
        after_as_of = {k: n for k, n in after_as_of.items() if n}
        after_run = {k: raw[k].attrs["after_run_excluded"] for k in future_excluded if raw[k].attrs.get("after_run_excluded", 0)}
        if after_as_of:
            warnings.append(f"rows dated after {as_of} excluded: " + ", ".join(f"{k} {n}" for k, n in sorted(after_as_of.items())) + ".")
        if after_run:
            warnings.append("rows dated after the New York date of the refresh that stored them excluded: "
                            + ", ".join(f"{k} {n} (after {', '.join(raw[k].attrs['after_run_dates'])})" for k, n in sorted(after_run.items())) + ".")
    if unprovenanced:
        warnings.append("stored rows no committed refresh wrote (no provenance) set aside on read and excluded: "
                        + ", ".join(f"{k} {n}" for k, n in sorted(unprovenanced.items())) + ".")
    if non_numeric:
        warnings.append("non-numeric stored values quarantined on read and excluded: "
                        + ", ".join(f"{k} {n}" for k, n in sorted(non_numeric.items())) + ".")
    if malformed:
        warnings.append("stored rows with a malformed date set aside on read and excluded: "
                        + ", ".join(f"{k} {n}" for k, n in sorted(malformed.items())) + ".")
    if clamped:
        warnings.append(f"cond_value was clamped to ±{COND_VALUE_BOUND:g}.")
    known_rules = sorted({f"{s.label}: {registry.rule_str(s.known)}" for s in inputs})
    fl, ll = first_labelled_date(months), last_labelled_date(months)
    return {
        "study": {
            "slug": slug_for(q),
            "preset": next((n for n, p in PRESETS.items() if validate(p) == replace(q, seed=DEFAULT_SEED)), None),
            "kind": q.kind,
            "label": study_label + (f", while {cond_label}" if cond_label else "") + (f", regime {q.regime}" if q.regime != "all" else "") + f" → {target_spec.label}",
            "params": asdict(q),
            "shock": {"key": q.shock, "label": shock_spec.label, "unit": shock_spec.unit},
            "condition": {"key": q.cond, "label": cond_label, "value": q.cond_value} if cond_label else None,
            "target": {"key": q.target, "label": target_spec.label, "unit": target_spec.unit,
                       "format": "bp" if target_spec.unit == "bp" else "pct"},
        },
        "horizons": horizons,
        "regimes": regimes,
        "recent_events": recent,
        "verdict": {"text": " ".join(sentences), "sentences": sentences},
        "provenance": {
            "as_of": min(as_of_by[k] for k in keys),
            "as_of_by_series": {k: as_of_by[k] for k in sorted(keys)},
            "calendar": f"{CALENDAR} (exchange_calendars {xcals.__version__}), {start} to {end}: {n_sessions} sessions",
            "data_start": data_start.strftime("%Y-%m-%d"),
            "sample_start": sample_start.strftime("%Y-%m-%d"),
            "sample_end": sample_end.strftime("%Y-%m-%d"),
            "n_sessions": int(evaluable.sum()),
            "n_events": n_events,
            "n_events_raw": n_raw,
            "n_shocks": n_shocks,
            "n_after_condition": n_after_condition,
            "n_unlabeled": int(len(unl_pos)),
            "n_no_entry": n_no_entry,
            "n_incomplete_by_h": {str(r["h"]): r["n_incomplete"] for r in horizons},
            "n_blocks_by_h": {str(r["h"]): r["n_blocks"] for r in horizons},
            "resampling_by_h": {str(r["h"]): [r["resampling"], r["n_draws"]] for r in horizons},
            "opposite_sign_share_by_h": {str(r["h"]): r.get("opposite_sign_share") for r in horizons},
            "exclusion_by_h": {str(r["h"]): r.get("exclusion") for r in horizons},
            "baseline_n_by_h": {str(r["h"]): r["baseline_n"] for r in horizons},
            "baseline_no_entry": int((~base_has).sum()),
            "stages": stages,
            "exclusions": {m["key"]: {"off_session": m["off_session_dropped"], "missing_sessions": m["missing_sessions"],
                                      "invalid_values": m["invalid_values"], "invalid_reason": m["invalid_reason"],
                                      "non_numeric": int(raw[m["key"]].attrs.get("non_numeric_excluded", 0)),
                                      "malformed_date": int(raw[m["key"]].attrs.get("malformed_date_excluded", 0)),
                                      "no_provenance": int(raw[m["key"]].attrs.get("no_provenance_excluded", 0))} for m in metas},
            "event_rule": ("the shock defines the event date; the condition is evaluated on that date and a shock whose condition "
                           "fails is dropped and still starts the cooldown (stages: threshold → cooldown → evaluable → condition → "
                           "regime filter → entry → complete window per horizon)" if q.kind == "shock" else
                           (f"a strict RSI crossing: the first session the S&P's {RSI_PERIOD}-session RSI (Wilder) is strictly "
                            f"{q.cross} {RSI_UPPER if q.cross == 'above' else RSI_LOWER:g} after a session it was defined and not; "
                            "the level itself never fires" if q.kind == "rsi" else
                            "a strict cross: the first session the 50-day average is strictly on the other side of the 200-day; equality never fires")),
            "cooldown": (f"{w} sessions on the session calendar" + (" (the RSI period)" if q.kind == "rsi" else "") if w is not None
                         else "no cooldown (a cross cannot recur before the opposite cross)"),
            "cooldown_sessions": w,
            "seed": q.seed,
            "n_boot": n_boot,
            "ci": CI_LEVEL,
            "bootstrap": (f"cluster bootstrap: events whose forward windows overlap form one block; every draw of B blocks is enumerated when "
                          f"B ≤ {EXACT_MAX_BLOCKS}, else {n_boot} Monte Carlo draws; an interval needs {MIN_BLOCKS_INTERVAL} blocks; "
                          f"a zero-exclusion claim needs {MIN_BLOCKS_EXCLUSION} blocks, the 90% interval on the point estimate's side of zero "
                          f"and fewer than {OPPOSITE_SIGN_MAX:.0%} of resampled medians adverse (zero counts as adverse)"),
            "z_window": Z_WINDOW if q.kind == "shock" else None,
            "z_min_present": Z_MIN_PRESENT if q.kind == "shock" else None,
            "inputs_hash": _inputs_hash(q, metas, months, generation, horizons, future_excluded, non_numeric, malformed, unprovenanced),
            "as_of_cutoff": as_of,
            "future_excluded": dict(sorted(future_excluded.items())),
            "non_numeric_excluded": dict(sorted(non_numeric.items())),
            "malformed_date_excluded": dict(sorted(malformed.items())),
            "no_provenance_excluded": dict(sorted(unprovenanced.items())),
            "generation": str(generation),
            "inputs": metas,
            "warnings": warnings,
            "master_calendar": (f"the {CALENDAR} calendar from exchange_calendars, sessions and early closes included, over the inputs' span; "
                                "every series aligned onto it; off-session observations dropped and counted; a session without a value is "
                                "missing and counted; a window is incomplete when a session it reads is missing (a move reads t−w and t, a "
                                f"forward window e and e+h) and is excluded and counted; the z window needs {Z_MIN_PRESENT} of its {Z_WINDOW} moves"),
            "evaluability": ("a session counts, for events and the baseline alike, when the shock's z exists, the condition is computable, "
                             "the target has a value and the lagged regime label exists; every baseline candidate takes the same entry delay "
                             "and the same completeness rules as an event, with its regime from the signal date"),
            "regime_source": "regimes table (src/regime.py: a rule on the INDPRO and CPI slopes over the last three monthly readings, one row per month), read as stored",
            "regime_lag_months": REGIME_LAG_MONTHS,
            "regime_rule": f"a session in month K takes the row stamped K−{REGIME_LAG_MONTHS} months (that row needs data published mid K−1); earlier sessions are Unlabeled, reported in their own row, outside the totals",
            "regime_revision_caveat": "every regimes row is rewritten by each full refresh, so a historical label reflects today's FRED revisions of INDPRO and CPI, not what was knowable then",
            "regimes_first": fl.strftime("%Y-%m-%d") if fl is not None else None,
            "regimes_last": ll.strftime("%Y-%m-%d") if ll is not None else None,
            "entry_rule": (f"the target's close on the event date only when its value is fixed ({registry.rule_str(target_spec.fixed)}) at or after "
                           f"every input is known ({'; '.join(known_rules)}), resolved per session against the {CALENDAR} open and close; else the first "
                           "later session whose fixing is"
                           + ("; this target's fixing time is ambiguous, so entry is never the event's own session" if target_spec.defer_as_target else "")
                           + "; the baseline takes the same delay"),
            "entry_same_session": bool(same.all()) if len(same) else None,
            "entry_delay_sessions": sorted({int(x) for x in ev_delay}),
            "forward_rule": "close at entry to close h sessions later; a window whose entry or exit session is missing is excluded, not truncated, and counted; the baseline is every evaluable session under the same rule",
            "hit_rate_rule": "share of forward moves > 0 in the target's unit; never sign-flipped by the engine",
        },
    }


def assets() -> dict:
    return assets_with_coverage(None)


def _exclusion_warnings(ex: dict[str, int], cutoff: str, after_run: int = 0, after_run_dates: list[str] | None = None) -> list[str]:
    """The reader's exclusions for one series, in the words a study's warnings use (Codex R-12).
    `after_run` of the future-dated rows were dated after the New York date of the refresh that
    committed them, `after_run_dates` (R-14, R-15), the effective cutoff for those rows."""
    out = []
    n = ex.get("future", 0) - after_run
    if n:
        out.append(f"{n} stored row{'s' if n != 1 else ''} dated after {cutoff} excluded")
    if after_run:
        out.append(f"{after_run} stored row{'s' if after_run != 1 else ''} dated after {', '.join(after_run_dates or [])}, "
                   f"the New York date of the refresh that stored {'them' if after_run != 1 else 'it'}, excluded")
    n = ex.get("no_provenance", 0)
    if n:
        out.append(f"{n} stored row{'s' if n != 1 else ''} no committed refresh wrote (no provenance) set aside on read")
    n = ex.get("non_numeric", 0)
    if n:
        out.append(f"{n} non-numeric stored value{'s' if n != 1 else ''} quarantined on read")
    n = ex.get("malformed_date", 0)
    if n:
        out.append(f"{n} stored row{'s' if n != 1 else ''} with a malformed date set aside on read")
    return out


def assets_with_coverage(db_path: Path | str | None, as_of: str | None = None) -> dict:
    coverage: dict[str, dict] = {}
    if db_path is not None:
        cutoff = resolve_as_of(as_of, db_path)
        conn = _connect(db_path)
        try:
            for spec in registry.SERIES:
                if not spec.available:
                    continue
                try:
                    s = load_level(conn, spec, cutoff)
                except NotStored:
                    continue
                # Codex R-12: what the reader left out, carried into the asset's coverage
                ex = {"future": int(s.attrs.get("future_excluded", 0)), "non_numeric": int(s.attrs.get("non_numeric_excluded", 0)),
                      "malformed_date": int(s.attrs.get("malformed_date_excluded", 0)),
                      "no_provenance": int(s.attrs.get("no_provenance_excluded", 0))}
                coverage[spec.key] = {"history_from": s.index[0].strftime("%Y-%m-%d"), "last": s.index[-1].strftime("%Y-%m-%d"),
                                      "rows": int(len(s)), "exclusions": ex,
                                      "warnings": _exclusion_warnings(ex, cutoff, int(s.attrs.get("after_run_excluded", 0)),
                                                                      s.attrs.get("after_run_dates"))}
        finally:
            conn.close()

    def row(spec: registry.DeskSeries) -> dict:
        cov = coverage.get(spec.key)
        if not spec.available:
            status = "unavailable"
        elif cov:
            status = "stored"
        elif db_path is not None and registry.stored_by_refresh(spec):
            status = "awaiting_refresh"  # desk/integration: the full refresh stores it; this database predates that
        elif spec.tier >= 3:
            status = "deferred"
        else:
            status = "planned"
        hf = cov["history_from"] if cov else spec.history_from
        return {
            "key": spec.key, "label": spec.label, "series_id": spec.series_id, "source": spec.source, "table": spec.table,
            "shock_unit": spec.unit, "history_from": hf, "history_declared": spec.history_from,
            "warn": hf > registry.HISTORY_BAR, "default": (hf <= registry.HISTORY_BAR) and status == "stored",
            "tier": spec.tier, "status": status, "known_by": spec.known_by,
            "fixed": registry.rule_str(spec.fixed), "known": registry.rule_str(spec.known), "defer_as_target": spec.defer_as_target,
            "roles": list(spec.roles),
            "last": cov["last"] if cov else None, "rows": cov["rows"] if cov else None,
            "exclusions": cov["exclusions"] if cov else None, "warnings": cov["warnings"] if cov else [],
            "note": spec.note, "reason": spec.reason,
        }

    everything = [row(s) for s in registry.SERIES]
    by_key = {r["key"]: r for r in everything}
    return {
        "shocks": [by_key[s.key] for s in registry.with_role("shock")],
        "conditions": [{"key": k, "label": v["label"], "series": v["series"], "param": v["param"]} for k, v in CONDITIONS.items()],
        "targets": [by_key[s.key] for s in registry.with_role("target")],
        "unavailable": [r for r in everything if r["status"] == "unavailable"],
        # desk/integration: the keys a study cannot read until the full refresh stores them
        "awaiting_refresh": [r["key"] for r in everything if r["status"] == "awaiting_refresh"],
        "windows": list(WINDOWS), "thresholds": list(THRESHOLDS), "signs": list(SIGNS), "horizons": list(HORIZONS),
        "regimes": list(REGIME_LABELS),
        "presets": [{"slug": n, "params": asdict(p), "kind": p.kind} for n, p in PRESETS.items()],
        "history_bar": registry.HISTORY_BAR,
        "regime_lag_months": REGIME_LAG_MONTHS,
        "master_calendar": f"{CALENDAR} (exchange_calendars)",
    }
