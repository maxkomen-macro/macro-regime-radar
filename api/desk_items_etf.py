"""api/desk_items_etf.py — the Desk's ETF blocks (desk/fill-etf).

One worker item, `desk_etf` (api/analytics_cache.ITEMS), rebuilt with every
generation, reads the ETFs the full refresh stores in `asset_prices`
(src/desk/series.py, src/market_data/asset_history.py) through the engine's
reader (`event_study.load_level`: completed sessions, provenance-aware,
nothing after the generation's as-of) and computes the blocks the Sectors,
Technicals and Macro tabs serve (DESK_FRAME3_SPEC §12.7, §12.8, §12.14). Each
block is stored as a part (api/desk_items_macro.part), so one that cannot be
computed awaits with its reason while the others serve.

Every series is aligned onto the XNYS session calendar the engine uses
(`event_study.session_calendar`), a session without a close is a gap and is
never filled, and a price that is not finite and positive is a gap too
(`validate_values`). A statistic that needs a close the store does not hold
(before a series' first close, as for XLC before 2018-06-19 and XLRE before
2015-10-08, or a missing session) is null with the reason, never a value.

Rules (the spec names each):
- Sector leadership (§12.14, v3 A-18): over the 60 XNYS sessions to `t`, the
  newest session with an SPY close, rel = ln(P(t)/P(t−60)) − ln(SPY(t)/SPY(t−60))
  on adjusted closes; ranked best first, the rows without one last. Band
  ±0.01 (the bars' green, gray and red).
- Pattern `sector-pattern-v1`: the mean rel of the six cyclical sector ETFs
  (XLB, XLE, XLF, XLI, XLK, XLY) less the mean rel of the three defensive ones
  (XLP, XLU, XLV); XLC and XLRE are in neither group. Above +0.01 "cyclical",
  below −0.01 "defensive", otherwise "mixed"; null unless all nine are served.
- Breadth (§12.14), on the same session `t`, of the eleven sector ETFs only
  (never stocks): a sector is above its 50-day (200-day) average when its close
  on `t` is strictly above the simple mean of its closes over the 50 (200)
  XNYS session slots ending at `t`, every slot holding a close (the §12.7 rule
  for the S&P's averages); one without that close or those slots is "not
  available" with the reason, counted in neither `n` nor `of`. Equal against
  cap weight is RSP's 60-session log return less SPY's, small caps against
  large IWM's; each one-year line is that same 60-session difference on every
  session of the twelve months to `t`.

Stdlib at import; numpy, pandas and the engine are imported at the point of
use. The connection is closed in a `finally` (verifier V-54).
"""

from __future__ import annotations

import math
from typing import Any

from api import desk_envelope as env

WINDOW_SESSIONS = 60   # v3 A-18: t − 60 XNYS sessions, "3 months"
WINDOW_MONTHS = 3
BAND = 0.01            # the ±1% band of the leadership bars and the pattern rule
PATTERN_RULE = "sector-pattern-v1"
BENCHMARK = "spy"
SOURCE = "asset_prices"
PROVIDER_WORDS = {"eodhd": "EODHD", "yfinance": "Yahoo"}


def _fin(x: Any) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def _f(x: Any) -> float | None:
    return float(x) if x is not None and math.isfinite(float(x)) else None


class Store:
    """The stored closes of a set of registry series on one XNYS calendar:
    `px[key]` a float array over `sessions` (NaN for a session without a close),
    `first[key]` each series' first stored close, `providers` the providers of
    the rows read. A series the store lacks is absent from `px`."""

    def __init__(self, conn: Any, keys: list[str], cutoff: str) -> None:
        import numpy as np
        import pandas as pd

        from src.desk import event_study as es
        from src.desk import series as registry

        raw: dict[str, Any] = {}
        self.missing: list[str] = []
        for k in keys:
            try:
                raw[k] = es.load_level(conn, registry.get(k), cutoff)
            except es.NotStored:
                self.missing.append(k)
        self.first = {k: s.index[0].strftime("%Y-%m-%d") for k, s in raw.items()}
        self.last = {k: s.index[-1].strftime("%Y-%m-%d") for k, s in raw.items()}
        self.providers: list[str] = []
        syms = [registry.get(k).series_id for k in raw if registry.get(k).table == "asset_prices"]
        if syms:
            marks = ",".join("?" * len(syms))
            self.providers = sorted(r[0] for r in conn.execute(
                f"SELECT DISTINCT provider FROM asset_prices WHERE interval = '1d' AND symbol IN ({marks})", syms))
        if not raw:
            self.sessions = pd.DatetimeIndex([])
            self.iso: list[str] = []
            self.px: dict[str, Any] = {}
            return
        start = min(s.index[0] for s in raw.values()).strftime("%Y-%m-%d")
        end = max(s.index[-1] for s in raw.values()).strftime("%Y-%m-%d")
        self.sessions = es.sessions_between(es.session_calendar(start, end), start, end)
        self.iso = [d.strftime("%Y-%m-%d") for d in self.sessions]
        self.px = {}
        for k, s in raw.items():
            al, _off, _gaps = es.align(s, self.sessions)
            al, _bad, _why = es.validate_values(al, registry.get(k))
            self.px[k] = al.to_numpy(dtype=float)
        self._np = np

    def has(self, key: str) -> bool:
        return key in self.px

    def newest(self, key: str) -> int | None:
        """The index of the newest session with a close of `key`."""
        if key not in self.px:
            return None
        idx = self._np.flatnonzero(self._np.isfinite(self.px[key]))
        return int(idx[-1]) if len(idx) else None

    def close(self, key: str, i: int) -> float | None:
        if key not in self.px or i < 0:
            return None
        v = float(self.px[key][i])
        return v if math.isfinite(v) else None

    def gap_reason(self, key: str, i: int) -> str | None:
        """Why `key` has no close on session i: before its first close, or a gap."""
        if key not in self.px:
            return "not stored in this database"
        if i < 0:
            return "no session that far back in the stored calendar"
        if self.close(key, i) is not None:
            return None
        day = self.iso[i]
        if day < self.first[key]:
            return f"no close on {day}: its history starts {self.first[key]}"
        return f"no close stored for {day}"

    def log_ret(self, key: str, i: int, j: int) -> tuple[float | None, str | None]:
        """ln(P(i)/P(j)), or null with the reason."""
        a, b = self.close(key, i), self.close(key, j)
        if a is None or b is None:
            return None, self.gap_reason(key, i if a is None else j)
        return math.log(a / b), None


def awaiting_refresh(symbols: list[str]) -> env.Awaiting:
    """A block whose inputs this database predates (the full refresh stores them)."""
    names = ", ".join(symbols)
    return env.Awaiting(f"Awaiting refresh: the full refresh stores {names}; this database predates it.")


def provider_words(providers: list[str]) -> list[str]:
    return [PROVIDER_WORDS.get(p, p) for p in providers]


# ── Sector leadership (§12.14) ──────────────────────────────────────────────

def leadership(store: Store) -> dict:
    """The sectors block's leadership part: each sector ETF's 60-session log
    return less SPY's, ranked, and the pattern word by its rule."""
    from src.desk import series as registry

    sectors = [(t, name, short, group) for t, name, short, group in registry.SECTOR_ETFS]
    keys = [t.lower() for t, *_ in sectors]
    if not store.has(BENCHMARK) or not any(store.has(k) for k in keys):
        raise awaiting_refresh([registry.get(k).series_id for k in (BENCHMARK, *keys) if not store.has(k)])
    t = store.newest(BENCHMARK)
    if t is None or t - WINDOW_SESSIONS < 0:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    t0 = t - WINDOW_SESSIONS
    spy, _why = store.log_ret(BENCHMARK, t, t0)
    if spy is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    rows = []
    for tick, name, short, group in sectors:
        own, why = store.log_ret(tick.lower(), t, t0)
        rows.append({"etf": tick, "name": name, "short": short, "group": group,
                     "rel_ret": None if own is None else own - spy, "ret": own,
                     "first": store.first.get(tick.lower()), "reason": why})
    served = sorted((r for r in rows if r["rel_ret"] is not None), key=lambda r: (-r["rel_ret"], r["etf"]))
    rows = served + [r for r in rows if r["rel_ret"] is None]
    return {
        "window_months": WINDOW_MONTHS,
        "window": {"start": store.iso[t0], "end": store.iso[t], "n": WINDOW_SESSIONS},
        "compared_on": store.iso[t],
        "unit": "log_return",
        "band": BAND,
        "benchmark": {"etf": "SPY", "name": "S&P 500 ETF", "ret": spy},
        "leadership": rows,
        "pattern": pattern(rows),
        "date": store.iso[t],
        "freq": "daily",
        "source": SOURCE,
        "providers": provider_words(store.providers),
    }


def pattern(rows: list[dict]) -> dict:
    """`sector-pattern-v1`: the cyclical group's mean rel less the defensive
    group's; the word by the ±BAND rule, null unless every member is served."""
    groups: dict[str, list[dict]] = {"cyclical": [], "defensive": []}
    for r in rows:
        if r["group"] in groups:
            groups[r["group"]].append(r)
    out = {"rule": PATTERN_RULE, "band": BAND,
           "cyclicals": sorted(r["etf"] for r in groups["cyclical"]),
           "defensives": sorted(r["etf"] for r in groups["defensive"]),
           "word": None, "spread": None, "reason": None}
    lost = sorted(r["etf"] for g in groups.values() for r in g if r["rel_ret"] is None)
    if lost:
        out["reason"] = f"{', '.join(lost)} not served, so the groups cannot be compared."
        return out
    mean = {g: sum(r["rel_ret"] for r in rs) / len(rs) for g, rs in groups.items()}
    spread = mean["cyclical"] - mean["defensive"]
    out["spread"] = spread
    out["word"] = "cyclical" if spread > BAND else "defensive" if spread < -BAND else "mixed"
    return out


# ── Breadth (§12.14) ────────────────────────────────────────────────────────

MA_WINDOWS = (50, 200)
LINE_MONTHS = 12


def above_average(store: Store, key: str, t: int, w: int) -> tuple[bool | None, str | None]:
    """Whether `key`'s close on session t is strictly above the mean of its
    closes over the w session slots ending at t; null with the reason when
    that close or any slot's close is not stored."""
    lo = t - w + 1
    if lo < 0:
        return None, "no session that far back in the stored calendar"
    px = store.px.get(key)
    if px is None:
        return None, "not stored in this database"
    window = px[lo:t + 1]
    gaps = [i for i, v in enumerate(window) if not math.isfinite(float(v))]
    if gaps:
        return None, store.gap_reason(key, lo + gaps[0])
    return bool(float(px[t]) > float(window.mean())), None


def relative_line(store: Store, key: str, t: int) -> tuple[float | None, str | None, list[dict], dict]:
    """`key` against SPY: its 60-session log return less SPY's on t (with the
    reason when null), and the same difference on every session of the twelve
    months to t, a point null where a close it needs is not stored."""
    import pandas as pd

    rel, why = None, None
    own, why = store.log_ret(key, t, t - WINDOW_SESSIONS)
    spy, why_spy = store.log_ret(BENCHMARK, t, t - WINDOW_SESSIONS)
    if own is not None and spy is not None:
        rel = own - spy
    else:
        why = why or why_spy
    since = store.sessions[t] - pd.DateOffset(months=LINE_MONTHS)
    first = int(store.sessions.searchsorted(since, side="right"))
    points = []
    for i in range(first, t + 1):
        a, _ = store.log_ret(key, i, i - WINDOW_SESSIONS)
        b, _ = store.log_ret(BENCHMARK, i, i - WINDOW_SESSIONS)
        points.append({"date": store.iso[i], "rel": None if a is None or b is None else a - b})
    window = {"start": store.iso[first], "end": store.iso[t], "n": len(points)}
    return rel, why, points, window


def breadth(store: Store) -> dict:
    """The /sectors breadth block: the eleven sector ETFs against their 50-
    and 200-day averages, RSP and IWM against SPY, all on session t."""
    from src.desk import series as registry

    keys = [t.lower() for t, *_ in registry.SECTOR_ETFS]
    if not store.has(BENCHMARK) or not any(store.has(k) for k in keys):
        raise awaiting_refresh([registry.get(k).series_id for k in (BENCHMARK, *keys) if not store.has(k)])
    t = store.newest(BENCHMARK)
    if t is None or t - WINDOW_SESSIONS < 0:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    out: dict[str, Any] = {"compared_on": store.iso[t], "of_total": len(keys)}
    for w in MA_WINDOWS:
        by, lost = {}, []
        for (tick, *_rest), k in zip(registry.SECTOR_ETFS, keys):
            above, why = above_average(store, k, t, w)
            if above is None:
                lost.append({"etf": tick, "reason": why})
            else:
                by[tick] = above
        out[f"above_{w}"] = {"n": sum(by.values()), "of": len(by), "compared_on": store.iso[t],
                             "window": {"start": store.iso[max(t - w + 1, 0)], "end": store.iso[t], "n": w},
                             "by_etf": by, "not_available": lost}
    for name, key in (("eqw_vs_cap", "rsp"), ("small_vs_large", "iwm")):
        if store.has(key):
            rel, why, points, window = relative_line(store, key, t)
        else:
            rel, why, points, window = None, awaiting_refresh([key.upper()]).reason, [], None
        out[f"{name}_3m"] = rel
        out[f"{name}_reason"] = why if rel is None else None
        out[f"{name}_series"] = points
        out[f"{name}_line_window"] = window
    out["relative_window"] = {"start": store.iso[t - WINDOW_SESSIONS], "end": store.iso[t], "n": WINDOW_SESSIONS}
    out.update({"unit": "log_return", "date": store.iso[t], "freq": "daily", "source": SOURCE,
                "providers": provider_words(store.providers)})
    return out


# ── The item ────────────────────────────────────────────────────────────────

SECTOR_KEYS = ("xlb", "xlc", "xle", "xlf", "xli", "xlk", "xlp", "xlre", "xlu", "xlv", "xly")


def desk_etf(ctx: dict) -> dict:
    """The desk_etf item: each block as a part, read on one connection."""
    from api.desk_items_macro import _connect, part
    from src.desk import event_study as es

    cutoff = es.resolve_as_of(None, es.DB_PATH)
    conn = _connect()
    try:
        store = Store(conn, [BENCHMARK, *SECTOR_KEYS, "rsp", "iwm"], cutoff)
    finally:
        conn.close()
    return {"sectors": part("sectors", lambda: leadership(store)), "breadth": part("breadth", lambda: breadth(store))}
