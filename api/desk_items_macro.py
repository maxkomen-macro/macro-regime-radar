"""api/desk_items_macro.py — the worker items behind the Desk v2 /regime and
/macro routes (desk/frame-3-api-b2a; docs/desk/FRAME3_API_PLAN.md §7 commits
7 and 8).

Each item is a function of the generation being built (api/analytics_cache.ITEMS):
whatever depends on the generation alone is computed here, once, off the
request path. What depends on "now" (plan §0.5: the K−2 selection, the next
CPI release date) is left to api/desk_v2_macro.py, per response.

An item's blocks are computed apart. A block whose stored input is absent, or
whose computation failed, is kept as a refusal carrying the reason its route
serves (plan §3: "Awaiting refresh: …"), so one block never takes its route
down. Two failures are facts about the whole item and propagate instead: a
failed schema read (api.provenance.SchemaCheckFailed, answered 503
`schema_check`) and a failed import (the worker rebuilds the file, R-01).

Heavy dependencies are imported inside the builders. Every connection opened
here is closed in a `finally` (verifier V-54) and carries no Python callback
(V-51). Like api/desk.py, nothing here imports src.config.
"""

from __future__ import annotations

import logging
import math
import sqlite3
from typing import Any, Callable

from api import desk_envelope as env

log = logging.getLogger("mrr.desk")

# ── Mirrors (plan N6) ───────────────────────────────────────────────────────
# api/ cannot import src.regime: it imports src.config, which requires
# FRED_API_KEY. The classifier's window (src/config.py ROLLING_WINDOW) and its
# four-entry table (src/regime.py REGIMES) are mirrored here and pinned equal
# by AST parity tests (tests/test_desk_v2_regime.py). The next-print
# threshold's closed form holds for a window of three only.
REGIME_WINDOW = 3
REGIME_TABLE: dict[tuple[bool, bool], str] = {
    (True, False): "Goldilocks",       # growth up, inflation down
    (True, True): "Overheating",       # growth up, inflation up
    (False, True): "Stagflation",      # growth down, inflation up
    (False, False): "Recession Risk",  # growth down, inflation down
}

# The two prints that decide the next regime row (§12.6): key, FRED id, axis,
# and the event_calendar name of its release (none is stored for INDPRO).
NEXT_PRINTS: tuple[tuple[str, str, str, str | None], ...] = (
    ("cpi", "CPIAUCSL", "inflation", "CPI Release"),
    ("indpro", "INDPRO", "growth", None),
)

# §12.6 recession.data and plan R4: `_classify_prob`'s own edges
# (src/analytics/recession.py), as fractions; a parity test pins the two.
RECESSION_BAND_EDGES = (0.20, 0.40)
RECESSION_PEAK_FROM = "2015-01-01"


# ── Parts ───────────────────────────────────────────────────────────────────

def _fact_about_the_item(exc: BaseException) -> bool:
    """A failure that is the whole item's, never one block's."""
    if isinstance(exc, ImportError):
        return True
    from api import provenance

    return isinstance(exc, provenance.SchemaCheckFailed)


def part(what: str, fn: Callable[[], Any]) -> dict:
    """One block's value as stored: `{"ok": True, "data": …}`, or a refusal
    `{"ok": False, "reason": …}` with the reason its route serves. An absent
    input raises `desk_envelope.Awaiting` with that reason; any other failure
    is logged and refused with the S-27 sentence."""
    try:
        return {"ok": True, "data": fn()}
    except env.Awaiting as a:
        return {"ok": False, "reason": a.reason}
    except Exception as exc:  # noqa: BLE001 — one block's failure is that block's answer
        if _fact_about_the_item(exc):
            raise
        log.warning("desk item: %s could not be computed: %s: %s", what, type(exc).__name__, exc, exc_info=True)
        return {"ok": False, "reason": env.BLOCK_FAILED_REASON}


def absent() -> env.Awaiting:
    """A block whose stored input is absent (plan §3): the S-27 sentence."""
    return env.Awaiting(env.BLOCK_FAILED_REASON)


# ── /regime: the desk_regime item (plan §1.6, N5, N6) ───────────────────────

def _direction(trend: Any) -> str | None:
    """The classifier's own test (src/regime.py classify_regime): rising iff
    the stored trend is > 0. None when the row stores no finite trend."""
    if trend is None:
        return None
    try:
        v = float(trend)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return "rising" if v > 0 else "falling"


def regime_rows(conn: sqlite3.Connection) -> list[dict]:
    """Every stored regimes row, ascending, one per month: its label and the
    signs of its stored trends. An older database without the table has none."""
    from api import provenance

    if not provenance.table_exists(conn, "regimes"):
        return []
    by_month: dict[str, dict] = {}
    for date, label, growth, inflation in conn.execute(
            "SELECT date, label, growth_trend, inflation_trend FROM regimes ORDER BY date"):
        month = str(date)[:7]
        by_month[month] = {"month": month, "label": label, "growth": _direction(growth), "inflation": _direction(inflation)}
    return [by_month[m] for m in sorted(by_month)]


def _month_after(month: str, n: int = 1) -> str:
    y, m = int(month[:4]), int(month[5:7])
    y, m = divmod((y * 12 + m - 1) + n, 12)
    return f"{y:04d}-{m + 1:02d}"


def next_print(key: str, series_id: str, axis: str, joint, raw, latest: dict) -> dict | None:
    """N6 for one series (§12.6, FRAME3_API_PLAN.md N6). The classifier reads
    3-point OLS slopes over the rows of the joint INDPRO–CPIAUCSL frame
    (src/regime.py), which for rows y₀, y₁, y₂ is (y₂ − y₀)/2: the next row
    m+1 rises iff x(m+1) > x_prev, the series' value on the joint row before
    m (not always m−1: a month one series skipped has no joint row). So a
    print at or below `threshold_mom = x_prev / x(m) − 1` m/m makes the axis
    falling, and one above it rising; equality is falling (a zero slope).

    `operator` is "<=" when the latest row's own axis is rising (such a print
    flips it), ">" when falling. `flips_to` holds the other axis at the latest
    row's sign. Both `threshold_mom` and `flips_to` are null when the series
    already has a value for m+1 (the next row waits on the other series).
    None when the latest row or the joint frame cannot place it."""
    other = "growth" if axis == "inflation" else "inflation"
    own_sign, other_sign = latest.get(axis), latest.get(other)
    if own_sign is None or other_sign is None:
        return None
    import pandas as pd

    m = latest["month"]
    at = pd.Timestamp(f"{m}-01")
    if at not in joint.index:
        return None
    pos = joint.index.get_loc(at)
    if pos < 1:
        return None
    x_m, x_prev = float(joint[axis].iloc[pos]), float(joint[axis].iloc[pos - 1])
    if not (math.isfinite(x_m) and math.isfinite(x_prev)) or x_m == 0.0:
        return None
    reference = _month_after(m)
    printed = raw.dropna()
    has_next = bool(len(printed)) and reference in {d.strftime("%Y-%m") for d in printed.index}
    rising = own_sign == "rising"
    if has_next:
        threshold, flips = None, None
    else:
        threshold = x_prev / x_m - 1.0
        flipped = {axis: not rising, other: other_sign == "rising"}
        flips = REGIME_TABLE[(flipped["growth"], flipped["inflation"])]
    return {
        "reference_month": reference,
        "series": series_id,
        "threshold_mom": threshold,
        "operator": "<=" if rising else ">",
        "flips_to": flips,
        "first_effective_month": _month_after(reference, 2),
        "freq": "monthly",
        "source": series_id,
    }


def next_prints(conn: sqlite3.Connection, rows: list[dict]) -> dict:
    """N6 for CPIAUCSL and INDPRO from the newest stored regimes row (§12.6:
    the next prints are read from the latest print, never from the K−2 row)."""
    if REGIME_WINDOW != 3:  # the closed form below is the 3-point slope's
        raise RuntimeError(f"the next-print threshold is defined for a window of 3, not {REGIME_WINDOW}")
    if not rows:
        raise absent()
    import pandas as pd

    from src.analytics.recession import _load_raw

    raw = {sid: _load_raw(sid, conn) for _, sid, _, _ in NEXT_PRINTS}
    by_axis = {axis: raw[sid] for _, sid, axis, _ in NEXT_PRINTS}
    # the classifier's joint frame (src/regime.py run_regime_classification's `base`)
    joint = pd.DataFrame({"growth": by_axis["growth"], "inflation": by_axis["inflation"]}).dropna()
    return {k: next_print(k, sid, axis, joint, raw[sid], rows[-1]) for k, sid, axis, _ in NEXT_PRINTS}


def release_times(conn: sqlite3.Connection) -> dict[str, list[str]]:
    """Every stored release time (event_calendar, UTC) of each next print's
    event, ascending: the route picks the first after its own "now"."""
    from api import provenance

    out: dict[str, list[str]] = {k: [] for k, *_ in NEXT_PRINTS}
    if not provenance.table_exists(conn, "event_calendar"):
        return out
    for k, _, _, event in NEXT_PRINTS:
        if event is not None:
            out[k] = [str(r[0]) for r in conn.execute(
                "SELECT event_datetime FROM event_calendar WHERE event_name = ? AND event_datetime IS NOT NULL "
                "ORDER BY event_datetime", (event,))]
    return out


def recession_band(score: float) -> str:
    """Plan R4: low < 0.20 ≤ elevated < 0.40 ≤ high_risk (v3 §11)."""
    lo, hi = RECESSION_BAND_EDGES
    return "low" if score < lo else ("elevated" if score < hi else "high_risk")


def _month_minus(month: str, n: int) -> str:
    return _month_after(month, -n)


def recession_block(ctx: dict) -> dict:
    """§12.6 `recession.data`: the generation's `recession` item (the score,
    a percent 0–100 ÷ 100, and its served series) with N5's provenance, read
    off the same model frames. Refused when the model has no result."""
    rec = ctx.get("recession")
    prob = rec.get("recession_prob") if isinstance(rec, dict) else None
    if prob is None:
        raise absent()
    from src.analytics.recession import recession_provenance

    prov = recession_provenance()
    if prov is None or prov["training"] is None:
        raise absent()
    points = rec.get("recession_prob_series") or []
    if [p["date"] for p in points] != prov["scoring_index"]:
        # the extraction must date exactly the score it serves (plan N5 parity)
        raise RuntimeError("the recession provenance does not date the served score series")
    month = prov["probability_month"]
    ago = _month_minus(month, 12)
    year_ago = next(({"score": p["value"] / 100.0, "probability_month": p["date"][:7]}
                     for p in points if p["date"][:7] == ago), None)
    since = [p for p in points if p["date"] >= RECESSION_PEAK_FROM]
    if not since:
        raise absent()
    top = since[0]
    for p in since[1:]:
        if p["value"] > top["value"]:  # strictly greater: the earliest on ties
            top = p
    score = float(prob) / 100.0
    return {
        "score": score,
        "probability_month": month,
        "inputs_through": prov["inputs_through"],
        "feature_months": prov["feature_months"],
        "band": recession_band(score),
        "band_edges": list(RECESSION_BAND_EDGES),
        "year_ago": year_ago,
        "peak": {"score": top["value"] / 100.0, "probability_month": top["date"][:7], "window": "since 2015"},
        "training": prov["training"],
        "methodology": "in-sample fitted scores",
        "freq": "monthly",
        "source": "recession model (src/analytics/recession.py)",
    }


def desk_regime(ctx: dict) -> dict:
    """The desk_regime item: the stored regimes rows, the recession block, the
    next-print thresholds, and the stored release times. The K−2 selection and
    the release date are the route's, per response (plan §0.5)."""
    from api import db
    from src.analytics import dbpath

    conn = dbpath.connect_ro(db.DB_PATH)
    try:
        rows = regime_rows(conn)
        prints = part("next_prints", lambda: next_prints(conn, rows))
        releases = release_times(conn)
    finally:
        conn.close()
    return {"rows": rows, "recession": part("recession", lambda: recession_block(ctx)),
            "next_prints": prints, "release_times": releases}
