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


def _connect() -> sqlite3.Connection:
    """A read-only connection to the generation's copy for one build (the
    caller closes it in a `finally`); one opener, which the failing-build tests
    wrap (tests/test_desk_v2_study.py, plan §5)."""
    from api import db
    from src.analytics import dbpath

    return dbpath.connect_ro(db.DB_PATH)


# ── /regime: the desk_regime item (plan §1.6, N5, N6) ───────────────────────

def direction(trend: Any) -> str | None:
    """The classifier's own test (src/regime.py classify_regime): rising iff
    the stored trend is > 0. None when the row stores no finite trend (a NULL
    never reads as falling: desk/frame-3-api's Codex R-03). The one rule
    /regime and /overview's regime tile read a direction by."""
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
    """Every stored regimes row, ascending, one per month: its label and its
    stored slopes as stored (`direction` reads them). An older database without
    the table has none."""
    from api import provenance

    if not provenance.table_exists(conn, "regimes"):
        return []
    by_month: dict[str, dict] = {}
    for date, label, growth, inflation in conn.execute(
            "SELECT date, label, growth_trend, inflation_trend FROM regimes ORDER BY date"):
        month = str(date)[:7]
        by_month[month] = {"month": month, "label": label, "growth_trend": growth, "inflation_trend": inflation}
    return [by_month[m] for m in sorted(by_month)]


# The classifier's four stored odds, by the label each is for (src/regime.py's softmax columns).
CLASSIFIER_ODDS = (("Goldilocks", "prob_goldilocks"), ("Overheating", "prob_overheating"),
                   ("Stagflation", "prob_stagflation"), ("Recession Risk", "prob_recession"))


def classifier_latest(conn: sqlite3.Connection) -> dict | None:
    """The home page's classifier reading (desk/fill-compute): the newest stored
    regimes row's four-way odds, and the label with the largest (the home
    page's dominant odds, /api/regime/latest). `odds` is null when that label
    is Recession Risk: the Desk never shows regimes.prob_recession (CLAUDE.md).
    None when the row stores no finite odds."""
    from api import provenance

    if not provenance.table_exists(conn, "regimes"):
        return None
    cols = {r[1] for r in conn.execute("PRAGMA table_info(regimes)")}
    if not all(c in cols for _, c in CLASSIFIER_ODDS):
        return None
    row = conn.execute(f"SELECT date, {', '.join(c for _, c in CLASSIFIER_ODDS)} FROM regimes ORDER BY date DESC LIMIT 1").fetchone()
    if row is None:
        return None
    odds = []
    for (label, _col), v in zip(CLASSIFIER_ODDS, row[1:]):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(x):
            return None
        odds.append((x, label))
    top, label = max(odds, key=lambda t: t[0])  # the first of equal odds, in the table's order
    return {"month": str(row[0])[:7], "label": label, "odds": None if label == "Recession Risk" else top}


def newest_known_at(conn: sqlite3.Connection, rows: list[dict]) -> str | None:
    """When the store learned the newest regimes row (fix/freshness 3a): a row
    stamped M exists once both its inputs, CPI and INDPRO for M, are stored, so
    it became known at the later of the two series' watermark advances, when
    both watermarks stand on M. None when either does not, or the store keeps
    no watermarks (an older database)."""
    from api import provenance

    if not rows or not provenance.table_exists(conn, "source_watermarks"):
        return None
    marks = dict(conn.execute(
        "SELECT source, last_obs || '|' || COALESCE(advanced_at, '') FROM source_watermarks "
        "WHERE source IN ('fred:CPIAUCSL', 'fred:INDPRO')").fetchall())
    month = rows[-1]["month"]
    seen = []
    for source in ("fred:CPIAUCSL", "fred:INDPRO"):
        last, _, advanced = str(marks.get(source) or "").partition("|")
        if last[:7] != month or not advanced:
            return None
        seen.append(advanced)
    return max(seen)


def _month_after(month: str, n: int = 1) -> str:
    y, m = int(month[:4]), int(month[5:7])
    y, m = divmod((y * 12 + m - 1) + n, 12)
    return f"{y:04d}-{m + 1:02d}"


def _printed(raw) -> dict[str, float]:
    """A series' printed values by month (`YYYY-MM`), finite only."""
    return {d.strftime("%Y-%m"): float(v) for d, v in raw.dropna().items() if math.isfinite(float(v))}


def next_print(key: str, series_id: str, axis: str, joint, raw, basis: dict, next_row: dict | None = None,
               other_raw=None) -> dict | None:
    """N6 for one series (§12.6, FRAME3_API_PLAN.md N6): the next month's print
    after the row `basis`. The classifier reads 3-point OLS slopes over the rows
    of the joint INDPRO–CPIAUCSL frame (src/regime.py), which for rows y₀, y₁, y₂
    is (y₂ − y₀)/2: the row m+1 after the basis m rises iff x(m+1) > x_prev,
    the series' value on the joint row before m (not always m−1: a month one
    series skipped has no joint row). So a print at or below `threshold_mom =
    x_prev / x(m) − 1` m/m makes the axis falling, and one above it rising;
    equality is falling (a zero slope).

    `operator` is "<=" when the basis row's own axis is rising (such a print
    flips it), ">" when falling; `from_direction` is that axis. `flips_to` is
    the label the flipped axis gives with the other axis at row m+1 (Codex
    R-06): `other` says where that comes from, `published` when the other
    series has printed m+1 (its direction there, x(m+1) against its x_prev), or
    `assumed` when it has not (the basis row's sign, kept). When this series
    has already printed m+1, `threshold_mom` and `flips_to` are null and the
    print is served instead: `printed_mom`, its m/m change, and
    `printed_direction`, the axis it gives row m+1 (the stored row's own when
    m+1 is stored, else the sign of x(m+1) − x_prev). None when the basis row
    or the joint frame cannot place it."""
    other = "growth" if axis == "inflation" else "inflation"
    own_sign, other_sign = direction(basis.get(f"{axis}_trend")), direction(basis.get(f"{other}_trend"))
    if own_sign is None or other_sign is None:
        return None
    import pandas as pd

    m = basis["month"]
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
    by_month = _printed(raw)
    stored = next_row if next_row is not None and next_row["month"] == reference else None
    # Codex R-06: the other axis at row m+1, published when its series has printed m+1, else assumed kept.
    o_prev = float(joint[other].iloc[pos - 1])
    o_next = _printed(other_raw).get(reference) if other_raw is not None else None
    if stored is not None and direction(stored.get(f"{other}_trend")) is not None:
        other_info = {"direction": direction(stored.get(f"{other}_trend")), "status": "published"}
    elif o_next is not None and math.isfinite(o_prev):
        other_info = {"direction": "rising" if o_next > o_prev else "falling", "status": "published"}
    else:
        other_info = {"direction": other_sign, "status": "assumed"}
    other_series = next(sid for _k, sid, ax, _e in NEXT_PRINTS if ax == other)
    rising = own_sign == "rising"
    printed_mom = printed_dir = None
    if reference in by_month:
        threshold, flips = None, None
        x_next = by_month[reference]
        printed_mom = x_next / x_m - 1.0
        printed_dir = direction(stored.get(f"{axis}_trend")) if stored is not None else None
        printed_dir = printed_dir or ("rising" if x_next > x_prev else "falling")
    else:
        threshold = x_prev / x_m - 1.0
        flipped = {axis: not rising, other: other_info["direction"] == "rising"}
        flips = REGIME_TABLE[(flipped["growth"], flipped["inflation"])]
    return {
        "reference_month": reference,
        "series": series_id,
        "threshold_mom": threshold,
        "operator": "<=" if rising else ">",
        "flips_to": flips,
        "first_effective_month": _month_after(reference, 2),
        "from_direction": own_sign,
        "printed_mom": printed_mom,
        "printed_direction": printed_dir,
        "other": {"axis": other, "series": other_series, "reference_month": reference, **other_info},
        "freq": "monthly",
        "source": series_id,
    }


# The rows a page may show as governing today: the K−2 row is the newest or one of the two before it
# while the refresh keeps up (the K−1 and K rows print during month K); the route picks per response.
NEXT_PRINT_BASES = 3


def published_row(row: dict, prev: dict | None, raw: dict) -> dict:
    """Codex R-05: a stored row after the one the page shows, already
    published: its label, the month it governs from, and the two prints that
    made it, each with its own reference month, its m/m change (against the
    series' previous month, null when that month is not printed), the axis it
    gave the row and the previous row's."""
    prints = {}
    for key, sid, axis, _event in NEXT_PRINTS:
        vals = _printed(raw[sid])
        x, x_before = vals.get(row["month"]), vals.get(_month_after(row["month"], -1))
        prints[key] = {
            "reference_month": row["month"], "series": sid,
            "mom": x / x_before - 1.0 if x is not None and x_before not in (None, 0.0) else None,
            "direction": direction(row.get(f"{axis}_trend")),
            "from_direction": direction(prev.get(f"{axis}_trend")) if prev is not None else None,
        }
    return {"month": row["month"], "label": row["label"], "first_effective_month": _month_after(row["month"], 2), **prints}


def next_prints_for(joint, raw: dict, rows: list[dict], basis_month: str) -> dict:
    """§12.6 `next_prints.data` for the row `basis_month` the page shows
    (Codex R-05): the stored rows after it, already published, each with the
    prints that made it; and the upcoming prints, N6 read from the newest
    stored row (`upcoming_from`), for the month after it."""
    by = {r["month"]: r for r in rows}
    basis = by[basis_month]
    later = [r for r in rows if r["month"] > basis_month]
    published = [published_row(r, prev, raw) for prev, r in zip([basis] + later, later)]
    latest = rows[-1]
    other = {axis: raw[sid] for _k, sid, axis, _e in NEXT_PRINTS}
    upcoming = {k: next_print(k, sid, axis, joint, raw[sid], latest, None,
                              other_raw=other["growth" if axis == "inflation" else "inflation"])
                for k, sid, axis, _ in NEXT_PRINTS}
    return {
        "basis": {"month": basis_month, "label": basis["label"]},
        "published": published,
        "upcoming_from": {"month": latest["month"], "label": latest["label"]},
        **upcoming,
    }


def next_prints(conn: sqlite3.Connection, rows: list[dict]) -> dict:
    """The next prints for each of the last NEXT_PRINT_BASES stored rows as the
    row shown, by month (§12.6; the route serves the one for the K−2 row the
    page shows)."""
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
    return {"by_basis": {r["month"]: next_prints_for(joint, raw, rows, r["month"]) for r in rows[-NEXT_PRINT_BASES:]}}


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


# ── What each regime has meant, and the last changes (desk/fill-compute) ───
# Codex R-01: measured from when each regime was known, the engine's K−2 rule.
# A row stamped M needs the prints published during M+1, so it governs month
# M+2 (a session in month K reads the row stamped K−2): each stored label is
# paired with the S&P's return and the VIX of the month it governed, and a
# change is dated by the month it took effect. Every stored row counts once
# (Q8's labels, Q9's changes: a row whose label differs from the previous
# stored row's).
REGIME_ORDER = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
CHANGES_SHOWN = 5


def governed_month(stamp: str) -> str:
    """The month a row stamped `stamp` governs (event_study.REGIME_LAG_MONTHS later)."""
    from src.desk import event_study as es

    return _month_after(stamp, es.REGIME_LAG_MONTHS)


def month_closes(spx: Any) -> Any:
    """The S&P's closes aligned on the XNYS calendar from its first stored
    close through the last day of the newest close's month, validated as the
    engine validates them: NaN on a session without a close, so a month not
    over yet ends on a session with none (desk/fill-compute: the one input of
    `month_returns` and of /technicals' seasonality)."""
    import pandas as pd

    from src.desk import event_study as es
    from src.desk import series as registry

    start = spx.index[0].strftime("%Y-%m-%d")
    end = (spx.index[-1] + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d")
    sessions = es.sessions_between(es.session_calendar(start, end), start, end)
    al, _off, _missing = es.align(spx, sessions)
    al, _bad, _why = es.validate_values(al, registry.get("spx"))
    return al


def month_returns(spx: Any) -> dict[str, float]:
    """The S&P's simple return over each calendar month, close on the month's
    last XNYS session over close on the previous month's last XNYS session;
    a month whose last session, or whose previous month's, has no stored close
    (a month not over yet included) has none. The shared
    `src/analytics/technicals.monthly_returns` on `month_closes`."""
    from src.analytics import technicals

    r = technicals.monthly_returns(month_closes(spx)).dropna()
    return {str(m): float(v) for m, v in r.items()}


RETURN_STATUSES = ("complete", "pending", "missing")


class MonthReturns:
    """Each month's S&P return and its status (Codex R-08): `complete` with a
    value; `pending` when the month's window is not complete yet (its last
    XNYS session is after the newest stored close, or the month is later
    still); `missing` when the window is complete but a close it needs (the
    month's last session's, or the previous month's) is not stored."""

    def __init__(self, spx: Any) -> None:
        import pandas as pd

        from src.analytics import technicals

        al = month_closes(spx)
        self.values = {str(m): float(v) for m, v in technicals.monthly_returns(al).dropna().items()}
        idx = al.index
        self.month_end = {str(m): d.strftime("%Y-%m-%d") for m, d in pd.Series(idx, index=idx).groupby(idx.to_period("M")).max().items()}
        closes = al.dropna()
        self.newest = closes.index[-1].strftime("%Y-%m-%d") if len(closes) else ""
        self.first_month = str(idx[0].to_period("M")) if len(idx) else ""

    def status(self, month: str) -> tuple[str, float | None]:
        if month in self.values:
            return "complete", self.values[month]
        end = self.month_end.get(month)
        if month > max(self.month_end, default=""):
            return "pending", None
        if end is not None and end > self.newest:
            return "pending", None
        return "missing", None


def month_sessions(months: list[str]) -> dict[str, int]:
    """Codex R-09: each calendar month's XNYS sessions, the whole month,
    whatever the VIX's stored range: the denominator of its coverage."""
    from src.desk import event_study as es

    if not months:
        return {}
    start, end = f"{min(months)}-01", _month_after(max(months))
    sessions = es.sessions_between(es.session_calendar(start, end), start, end)
    out = {m: 0 for m in months}
    for d in sessions:
        m = d.strftime("%Y-%m")
        if m in out:
            out[m] += 1
    return out


def month_vix(vix: Any) -> tuple[dict[str, dict], dict]:
    """Codex R-07: the VIX aligned on the XNYS calendar and validated as the
    engine does for every input (src/desk/event_study.align, validate_values)
    before aggregating. Per calendar month: the sum and count of the stored
    closes on its sessions (`month_sessions` counts the sessions due, R-09);
    with the rows set aside (off-session, invalid) counted apart."""
    from src.desk import event_study as es
    from src.desk import series as registry

    start, end = vix.index[0].strftime("%Y-%m-%d"), vix.index[-1].strftime("%Y-%m-%d")
    sessions = es.sessions_between(es.session_calendar(start, end), start, end)
    al, off, _missing = es.align(vix, sessions)
    al, bad, _why = es.validate_values(al, registry.get("vix"))
    out: dict[str, dict] = {}
    for d, v in al.items():
        m = d.strftime("%Y-%m")
        cell = out.setdefault(m, {"sum": 0.0, "days": 0})
        if v == v:
            cell["sum"] += float(v)
            cell["days"] += 1
    return out, {"first": start, "last": end, "off_session_dropped": int(off), "invalid": int(bad)}


def _levels(conn: sqlite3.Connection) -> tuple[Any, Any]:
    """The S&P's and the VIX's levels. The S&P is required; the VIX is None
    while it is not stored (^VIX in asset_prices, which a store reaches with its
    first full refresh after desk/fill-compute), so the changes, which read the
    S&P only, and the stats' S&P columns never wait on it."""
    from src.desk import event_study as es
    from src.desk import series as registry

    try:
        spx = es.load_level(conn, registry.get("spx"))
    except es.NotStored:
        raise absent() from None
    try:
        vix = es.load_level(conn, registry.get("vix"))
    except es.NotStored:
        vix = None
    return spx, vix


def regime_stats(rows: list[dict], spx: Any, vix: Any) -> dict:
    """§12.6 `stats.data` (desk/fill-compute; Codex R-01, R-04, R-07): per
    regime, its stored labels (`months`), and over the months those labels
    governed (`governed_month`): the S&P's median and mean simple monthly
    return and the share up over `spx_n` complete months, with the governed
    months whose window is not complete yet (`spx_pending`) and those missing
    a close (`spx_missing`) counted apart; the mean of the VIX's validated
    closes on the sessions of the governed months whose window is complete
    (`vix_days`), against every XNYS session of those whole months
    (`vix_sessions`, Codex R-09: whatever the VIX's stored range, so a missing
    session stays in the denominator). With the VIX not stored (`vix` None),
    `vix_avg` null and `vix_days` 0 of the sessions due."""
    import statistics

    if not rows:
        raise absent()
    returns = MonthReturns(spx)
    vx, vix_cov = month_vix(vix) if vix is not None else ({}, None)
    due = month_sessions([governed_month(r["month"]) for r in rows])
    out = []
    for label in REGIME_ORDER:
        governed = [governed_month(r["month"]) for r in rows if r["label"] == label]
        status = [returns.status(g) for g in governed]
        r_ = [v for st, v in status if st == "complete"]
        done = [g for g, (st, _v) in zip(governed, status) if st != "pending"]
        total = sum(vx[g]["sum"] for g in done if g in vx)
        days = sum(vx[g]["days"] for g in done if g in vx)
        sessions = sum(due[g] for g in done)
        out.append({
            "regime": label, "months": len(governed), "spx_n": len(r_),
            "spx_pending": sum(1 for st, _ in status if st == "pending"),
            "spx_missing": sum(1 for st, _ in status if st == "missing"),
            "spx_median_mo": statistics.median(r_) if r_ else None,
            "spx_mean_mo": statistics.fmean(r_) if r_ else None,
            "up_pct": sum(1 for x in r_ if x > 0) / len(r_) if r_ else None,
            "vix_avg": total / days if days else None, "vix_days": days, "vix_sessions": sessions,
        })
    from src.desk import event_study as es
    from src.desk import series as registry

    v = registry.get("vix")
    vix_source = f"{v.series_id} ({v.table})" if vix is not None else f"{v.series_id} ({v.table}) not stored yet"
    return {"rows": out, "window": {"start": rows[0]["month"], "end": rows[-1]["month"], "n": len(rows)},
            "governed": {"start": governed_month(rows[0]["month"]), "end": governed_month(rows[-1]["month"]), "n": len(rows)},
            "lag_months": es.REGIME_LAG_MONTHS,
            "totals": {k: sum(r[k] for r in out) for k in ("months", "spx_n", "spx_pending", "spx_missing", "vix_days", "vix_sessions")},
            "vix_coverage": {"stored": vix is not None, **(vix_cov or {"first": None, "last": None, "off_session_dropped": 0, "invalid": 0})},
            "freq": "monthly", "source": f"regimes table (src/regime.py); asset_prices ^GSPC; {vix_source}"}


def regime_changes(rows: list[dict], spx: Any) -> dict:
    """§12.6 `changes.data` (desk/fill-compute; Codex R-01, R-08): every stored
    row whose label differs from the previous stored row's (Q9), the last five
    newest first, each dated by the month it took effect (`effective_month`,
    the month the new label governed) with the S&P's simple return over that
    month and its status (`MonthReturns.status`); `n` counts them all."""
    if not rows:
        raise absent()
    returns = MonthReturns(spx)
    changes = [(prev, row) for prev, row in zip(rows, rows[1:]) if prev["label"] != row["label"]]
    shown = []
    for prev, row in reversed(changes[-CHANGES_SHOWN:]):
        effective = governed_month(row["month"])
        st, value = returns.status(effective)
        shown.append({"effective_month": effective, "stamp_month": row["month"], "from": prev["label"], "to": row["label"],
                      "from_month": prev["month"], "spx_1m": value, "spx_1m_status": st})
    return {"rows": shown, "n": len(changes), "window": {"start": rows[0]["month"], "end": rows[-1]["month"], "n": len(rows)},
            "lag_months": _lag(), "freq": "monthly", "source": "regimes table (src/regime.py); asset_prices ^GSPC"}


def _lag() -> int:
    from src.desk import event_study as es

    return es.REGIME_LAG_MONTHS


def desk_regime(ctx: dict) -> dict:
    """The desk_regime item, the one /regime and /overview read: the stored
    regimes rows, the newest row's classifier odds and when the store learned
    that row, the recession block (the recession tile is its seven tile
    fields), the next-print thresholds, the stored release times, and what
    each regime has meant and the last changes. Both routes show the newest
    stored row (fix/freshness 3a, D2: the label the Dashboard shows); the
    release date and since-last-close are the routes', per response (plan §0.5)."""
    conn = _connect()
    try:
        rows = regime_rows(conn)
        classifier = classifier_latest(conn)
        known_at = newest_known_at(conn, rows)
        prints = part("next_prints", lambda: next_prints(conn, rows))
        releases = release_times(conn)
        levels = part("levels", lambda: _levels(conn))
    finally:
        conn.close()

    def with_levels(fn: Callable[[Any, Any], dict]) -> Callable[[], dict]:
        def build() -> dict:
            if not levels["ok"]:
                raise env.Awaiting(levels["reason"])
            return fn(*levels["data"])
        return build

    return {"rows": rows, "classifier": classifier, "newest_known_at": known_at,
            "recession": part("recession", lambda: recession_block(ctx)),
            "next_prints": prints, "release_times": releases,
            "stats": part("stats", with_levels(lambda spx, vix: regime_stats(rows, spx, vix))),
            "changes": part("changes", with_levels(lambda spx, vix: regime_changes(rows, spx)))}


# ── /macro: the desk_macro item (plan §1.8, N7, N8, R5) ─────────────────────

# §12.8's five tenors, by FRED id. A tenor is read only when the Desk registry
# (src/desk/series.py) declares it, through the engine's reader; one it does
# not declare, or whose rows are not stored, is null with a null date.
TENORS: tuple[tuple[str, str], ...] = (("3m", "DGS3MO"), ("2y", "DGS2"), ("5y", "DGS5"), ("10y", "DGS10"), ("30y", "DGS30"))
# plan R5: tight < 0.30 ≤ normal < 0.70 ≤ wide on the three-year HY rank; the
# edges are served on every answer, even when the rank is null (R-14)
CREDIT_BAND_EDGES = (0.30, 0.70)
IG_SOURCE = "fred:BAMLC0A0CM"  # IG is stored month-stamped in raw_series; its watermark dates it (S-22)


def tenor_levels(conn: sqlite3.Connection) -> dict:
    """Each tenor's finite stored observations (a pandas Series on the dates),
    or None when the registry does not declare it or nothing is stored."""
    import numpy as np

    from src.desk import event_study as es
    from src.desk import series as registry

    out: dict = {}
    for tenor, series_id in TENORS:
        spec = registry.BY_SERIES_ID.get(series_id)
        if spec is None or not spec.available:
            out[tenor] = None
            continue
        try:
            s = es.load_level(conn, spec)
        except es.NotStored:
            out[tenor] = None
            continue
        s = s[np.isfinite(s.to_numpy(dtype=float))]
        out[tenor] = s if len(s) else None
    return out


def _snapshot(values: dict, dates: dict, common) -> dict:
    snap = {tenor: values.get(tenor) for tenor, _ in TENORS}
    snap["date"] = common.strftime("%Y-%m-%d") if common is not None else None
    snap["dates"] = {tenor: dates.get(tenor) for tenor, _ in TENORS}
    return snap


def _on(levels: dict, day) -> dict:
    """Every stored tenor on one common date."""
    values = {t: float(s.loc[day]) for t, s in levels.items() if s is not None}
    return _snapshot(values, {t: day.strftime("%Y-%m-%d") for t in values}, day)


def _each_at_or_before(levels: dict, bounds: dict) -> dict:
    """Each stored tenor's newest observation on or before its own bound, with
    its own date; `date` is null (the snapshot has no common date)."""
    values, dates = {}, {}
    for t, s in levels.items():
        if s is None:
            continue
        upto = s[s.index <= bounds[t]]
        if len(upto):
            values[t], dates[t] = float(upto.iloc[-1]), upto.index[-1].strftime("%Y-%m-%d")
    return _snapshot(values, dates, None)


def curve(levels: dict) -> dict:
    """N8 (§12.8; plan N8, S-24, S-29, S-30): the curve today and a month ago.

    - `today.date` is the latest date on which every stored tenor has a
      value; `month_ago` is the same alignment on or before `today.date` − 1
      calendar month.
    - With no such date (disjoint histories), `today.date` is null and each
      stored tenor carries its own newest observation; `month_ago.date` is
      null too, each tenor carrying its newest on or before its own `today`
      date − 1 month (R-18).
    - With a common `today.date` but no common date a month earlier, only
      `month_ago` takes that per-tenor form, on or before `today.date` − 1 month.
    - `today.dates` and `month_ago.dates` name every tenor on every path: the
      common date, the tenor's own, or null for a tenor not stored or with no
      observation early enough (R-19, R-20).
    - The three differences are taken between common dates only: each is null
      whenever a date it needs is null (S-29), or a tenor it reads is absent."""
    import pandas as pd

    stored = {t: s for t, s in levels.items() if s is not None}
    common = None
    for s in stored.values():
        common = s.index if common is None else common.intersection(s.index)
    month = pd.DateOffset(months=1)
    if common is not None and len(common):
        day = common.max()
        today = _on(levels, day)
        earlier = common[common <= day - month]
        month_ago = _on(levels, earlier.max()) if len(earlier) else _each_at_or_before(levels, {t: day - month for t in stored})
    else:
        today = _each_at_or_before(levels, {t: s.index.max() for t, s in stored.items()})
        month_ago = _each_at_or_before(levels, {t: s.index.max() - month for t, s in stored.items()})

    def spread(snap: dict) -> float | None:
        if snap["date"] is None or snap["10y"] is None or snap["2y"] is None:
            return None
        return (snap["10y"] - snap["2y"]) * 100.0

    now_bp, then_bp = spread(today), spread(month_ago)
    return {
        "today": today,
        "month_ago": month_ago,
        "2s10s_bp": now_bp,
        "2s10s_chg_bp": now_bp - then_bp if now_bp is not None and then_bp is not None else None,
        "10y_chg_bp": ((today["10y"] - month_ago["10y"]) * 100.0
                       if today["date"] is not None and month_ago["date"] is not None
                       and today["10y"] is not None and month_ago["10y"] is not None else None),
        "freq": "daily",
        "source": "FRED",
    }


def credit_band(pct: float | None) -> str | None:
    """Plan R5 on the three-year HY rank; null exactly when the rank is."""
    if pct is None:
        return None
    lo, hi = CREDIT_BAND_EDGES
    return "tight" if pct < lo else ("normal" if pct < hi else "wide")


def _gap_reason(missing: list[str]) -> str:
    n = len(missing)
    head = ", ".join(missing[:3])
    more = f" and {n - 3} more" if n > 3 else ""
    return f"no value on {n} expected {'session' if n == 1 else 'sessions'} in the three-year window: {head}{more}"


def _ig(conn: sqlite3.Connection) -> dict | None:
    """IG's newest observation as its watermark records it (S-22)."""
    from datetime import date

    from api import provenance

    if not provenance.table_exists(conn, "source_watermarks"):
        return None
    row = conn.execute("SELECT last_obs, last_value FROM source_watermarks WHERE source = ?", (IG_SOURCE,)).fetchone()
    if row is None or row[0] is None or row[1] is None:
        return None
    try:
        day = date.fromisoformat(str(row[0])[:10]).isoformat()
        value = float(row[1])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    return {"value": value, "date": day, "freq": "daily", "source": "FRED BAMLC0A0CM"}


def credit(conn: sqlite3.Connection) -> dict:
    """N7 (§12.8; plan N7, S-12, B-07), with HY and IG levels.

    - The rank window is [HY date − 3 years, HY date], closed. `valid` is every
      finite stored observation dated in it, weekend month-end prints
      included. `expected` is the XNYS sessions of the engine's calendar in
      it (exchange_calendars), less `api.calendar.bond_extra_closures`; a
      session with no finite observation is missing.
    - With nothing missing: the rank of the current value among the valid
      ones (values strictly below it over the count, current included) and
      their range. With any missing: both null, and the reason: "coverage from
      <first observation> only" when every missing session precedes the first
      observation, else the gap's first three dates and its count.
    - The line window is [HY date − 12 months, HY date]: every observation,
      and the maximum, earliest on ties."""
    import numpy as np
    import pandas as pd

    from api import calendar as cal
    from src.desk import event_study as es
    from src.desk import series as registry

    try:
        hy = es.load_level(conn, registry.get("hy_oas"))
    except es.NotStored:
        raise absent() from None
    hy = hy[np.isfinite(hy.to_numpy(dtype=float))]
    ig = _ig(conn)
    if not len(hy) or ig is None:
        raise absent()
    end = hy.index[-1]
    current = float(hy.iloc[-1])
    start = end - pd.DateOffset(years=3)
    window = hy[(hy.index >= start) & (hy.index <= end)]
    sessions = es.sessions_between(es.session_calendar(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")),
                                   start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    closed = set().union(*(cal.bond_extra_closures(y) for y in range(start.year, end.year + 1)))
    expected = [s for s in sessions if s.date() not in closed]
    have = set(window.index)
    missing = [s for s in expected if s not in have]
    first_obs, last_obs = window.index[0], window.index[-1]
    values = window.to_numpy(dtype=float)
    if missing:
        pct, span = None, None
        if all(s < first_obs for s in missing):
            reason = f"coverage from {first_obs.strftime('%Y-%m-%d')} only"
        else:
            reason = _gap_reason([s.strftime("%Y-%m-%d") for s in missing])
    else:
        pct = float((values < current).sum() / len(values))
        span, reason = [float(values.min()), float(values.max())], None
    line_start = end - pd.DateOffset(months=12)
    line = hy[(hy.index >= line_start) & (hy.index <= end)]
    top = line.idxmax()  # the first occurrence: the earliest date on ties
    return {
        "hy": {"value": current, "date": end.strftime("%Y-%m-%d"), "freq": "daily", "source": "FRED BAMLH0A0HYM2"},
        "ig": ig,
        "hy_pct_3y": pct,
        "hy_range_3y": span,
        "rank_window": {"start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d"), "n": len(values),
                        "expected_n": len(expected), "valid_n": len(values), "missing_n": len(missing),
                        "first_obs": first_obs.strftime("%Y-%m-%d"), "last_obs": last_obs.strftime("%Y-%m-%d")},
        "reason": reason,
        "band": credit_band(pct),
        "band_edges": list(CREDIT_BAND_EDGES),
        "series": [{"date": d.strftime("%Y-%m-%d"), "hy": float(v)} for d, v in line.items()],
        "line_window": {"start": line_start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d"), "n": len(line)},
        "peak_12m": {"date": top.strftime("%Y-%m-%d"), "hy": float(line.loc[top])},
    }


def desk_macro(ctx: dict) -> dict:
    """The desk_macro item: the curve and credit blocks. Nothing in /macro
    depends on "now", so the route serves the item as it is."""
    conn = _connect()
    try:
        return {"curve": part("curve", lambda: curve(tenor_levels(conn))), "credit": part("credit", lambda: credit(conn))}
    finally:
        conn.close()
