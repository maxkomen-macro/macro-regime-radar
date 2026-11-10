"""scripts/memo_content.py — the memo job's private, session-pinned copy of the database (CS-2).

Design .loop/design-CS2.md v16, sections 4 (step 3) and 6. Every function here edits
only the memo job's private copy of the origin run's validated-db, which is never
uploaded; the refresh pipeline, the site and src/analytics/* are unchanged.

- pin(conn, P, ...): deletes every price row dated after the pinned session P
  (market_daily, asset_prices, market_intraday) and every price-derived weekly
  bucket observed after P. Macro observations stay (section 6).
- store_market_metrics(conn, symbols, P): replaces every market weekly-return row
  with one computation from the pinned closes (DR-54, DR-56, DR-58, DR-59, DR-69,
  DR-70), storing only P's bucket.
- fix_market_alerts(conn, P): re-dates and re-words the three alerts built from
  market returns to the interval they measure, and removes the credit comparison
  when SPY and HYG cover different sessions (DR-67, DR-68).
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta, timezone

ZSCORE_WINDOW = 104      # src/analytics/surprise.ZSCORE_WINDOW (pinned by a test)
MIN_PERIODS = 26         # src/analytics/surprise.MIN_PERIODS (pinned by a test)
SUFFIXES = ("_weekly_ret", "_weekly_ret_z", "_weekly_ret_obs", "_weekly_ret_from")
MARKET_ALERTS = ("SPY_drawdown", "credit_stress", "USD_breakout")
CREDIT_NOTE = "Credit comparison unavailable: SPY and HYG returns cover different sessions ({spy}, {hyg})"


def _table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def friday(d: date) -> date:
    """The W-FRI week label of d: the Friday ending its (Sat..Fri] week, as pandas resample('W-FRI')."""
    return d + timedelta(days=(4 - d.weekday()) % 7)


# ── the price pin (section 6) ─────────────────────────────────────────────────


def pin(conn: sqlite3.Connection, p: date, market: list[str], assets: list[str]) -> str:
    """Delete every price row dated after P and every price-derived bucket observed after P."""
    iso = p.isoformat()
    counts = {}
    for table, col in (("market_daily", "date"), ("asset_prices", "date"), ("market_intraday", "ts")):
        if _table(conn, table):
            counts[table] = conn.execute(f"DELETE FROM {table} WHERE substr({col}, 1, 10) > ?", (iso,)).rowcount
    removed = 0
    if _table(conn, "derived_metrics"):
        for sym in dict.fromkeys([*market, *assets]):
            labels = [r[0] for r in conn.execute(
                "SELECT date FROM derived_metrics WHERE name = ? AND value > ?", (f"{sym}_weekly_ret_obs", float(p.toordinal())))]
            for label in labels:
                removed += conn.execute(
                    f"DELETE FROM derived_metrics WHERE date = ? AND name IN ({','.join('?' * len(SUFFIXES))})",
                    (label, *[sym + s for s in SUFFIXES])).rowcount
    conn.commit()
    return f"pinned to {iso}: removed " + ", ".join(f"{t} {n}" for t, n in counts.items()) + f", derived {removed}"


# ── z-scores: exact power-of-two scaling and a compensated mean (DR-69, DR-70) ─


def _scale(values: list[float]) -> list[float] | None:
    """Every value times 2**-k, k the binary exponent of the largest |value|: exact."""
    top = max(abs(v) for v in values)
    if top == 0:
        return None
    k = math.frexp(top)[1]
    return [math.ldexp(v, -k) for v in values]


def zscore(window: list[float]) -> float | None:
    """The z-score of window[-1] against the window (sample std, as rolling().std()), or None.
    No intermediate overflows, underflows or loses the spread to rounding: the returns are
    scaled exactly, the mean is compensated, and the deviations are scaled exactly again."""
    n = len(window)
    if n < MIN_PERIODS or n < 2 or not all(math.isfinite(v) for v in window):
        return None
    xs = _scale(window)
    if xs is None:
        return None
    mu = math.fsum(xs) / n
    corr = math.fsum(x - mu for x in xs) / n
    ds = _scale([(x - mu) - corr for x in xs])
    if ds is None:
        return None
    var = math.fsum(d * d for d in ds) / (n - 1)
    if not (var > 0 and math.isfinite(var)):
        return None
    z = ds[-1] / math.sqrt(var)
    return z if math.isfinite(z) else None


# ── buckets, returns and the stored rows (section 4, step 3) ──────────────────


def buckets(rows: list[tuple[str, float]]) -> dict[date, tuple[date, float | None]]:
    """{W-FRI label: (the bucket's last row date, its close or None when not finite and positive)}.
    The last row by date decides the bucket: an invalid last close is never replaced by an
    earlier day of the same week."""
    out: dict[date, tuple[date, float | None]] = {}
    for d_str, close in rows:
        d = date.fromisoformat(str(d_str)[:10])
        ok = close is not None and isinstance(close, (int, float)) and math.isfinite(close) and close > 0
        label = friday(d)
        if label not in out or d >= out[label][0]:
            out[label] = (d, float(close) if ok else None)
    return out


def symbol_metrics(rows: list[tuple[str, float]], p: date) -> dict | None:
    """P's bucket for one symbol: {label, obs, from, ret, z}, or None when the symbol gets no
    rows (fewer than MIN_PERIODS buckets, no bucket in P's week, or no defined return)."""
    b = buckets([r for r in rows if str(r[0])[:10] <= p.isoformat()])
    if len(b) < MIN_PERIODS:
        return None
    end = friday(p)
    if end not in b:
        return None
    first = min(b)
    weeks = []
    w = first
    while w <= end:
        weeks.append(w)
        w += timedelta(days=7)
    closes = [b[w][1] if w in b else None for w in weeks]
    rets: list[float | None] = [None]
    for i in range(1, len(weeks)):
        a, c = closes[i - 1], closes[i]
        r = c / a - 1 if a is not None and c is not None else None
        rets.append(r if r is not None and math.isfinite(r) else None)
    r_p = rets[-1]
    if r_p is None:
        return None
    window = [r for r in rets[-ZSCORE_WINDOW:] if r is not None]
    z = zscore(window) if len(window) >= MIN_PERIODS else None
    return {"label": end, "obs": b[end][0], "from": b[weeks[-2]][0], "ret": r_p, "z": z}


def store_market_metrics(conn: sqlite3.Connection, symbols: list[str], p: date) -> str:
    """Replace every market weekly row in the private copy with P's bucket only."""
    stamp = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    names = [s + suf for s in symbols for suf in SUFFIXES]
    for i in range(0, len(names), 400):
        chunk = names[i:i + 400]
        conn.execute(f"DELETE FROM derived_metrics WHERE name IN ({','.join('?' * len(chunk))})", chunk)
    stored, absent = [], []
    for sym in symbols:
        rows = conn.execute("SELECT date, close FROM market_daily WHERE symbol = ? ORDER BY date", (sym,)).fetchall()
        m = symbol_metrics(rows, p)
        if m is None:
            absent.append(sym)
            continue
        label = m["label"].isoformat()
        out = [(f"{sym}_weekly_ret_obs", float(m["obs"].toordinal())),
               (f"{sym}_weekly_ret_from", float(m["from"].toordinal())),
               (f"{sym}_weekly_ret", float(m["ret"]))]
        if m["z"] is not None:
            out.append((f"{sym}_weekly_ret_z", float(m["z"])))
        conn.executemany("INSERT INTO derived_metrics (name, date, value, computed_at) VALUES (?, ?, ?, ?)",
                         [(n, label, v, stamp) for n, v in out])
        stored.append(sym)
    conn.commit()
    return (f"market metrics at {p.isoformat()}: {len(stored)} symbols stored"
            + (f"; no defined return for {', '.join(absent)}" if absent else ""))


# ── market alerts in the memo's copy (DR-67, DR-68) ───────────────────────────


def _bucket_dates(conn: sqlite3.Connection, sym: str) -> tuple[date | None, date | None]:
    def one(suffix: str) -> date | None:
        row = conn.execute("SELECT value FROM derived_metrics WHERE name = ?", (sym + suffix,)).fetchone()
        return date.fromordinal(int(row[0])) if row and row[0] is not None else None
    return one("_weekly_ret_from"), one("_weekly_ret_obs")


def fix_market_alerts(conn: sqlite3.Connection, p: date) -> str:
    """Re-date SPY_drawdown, credit_stress and USD_breakout from the W-FRI label to their
    observation date and re-word them to the interval they measure. credit_stress stays only
    when SPY's and HYG's returns cover the same sessions. Returns the disclosure line, or ""."""
    spy, hyg, uup = _bucket_dates(conn, "SPY"), _bucket_dates(conn, "HYG"), _bucket_dates(conn, "UUP")
    note = ""
    rows = conn.execute(
        f"SELECT id, name, value, message FROM alert_feed WHERE alert_type = 'market' "
        f"AND name IN ({','.join('?' * len(MARKET_ALERTS))})", MARKET_ALERTS).fetchall()
    for rid, name, value, message in rows:
        tail = message.split(" — ", 1)[1] if " — " in message else ""
        suffix = f" — {tail}" if tail else ""
        if name == "SPY_drawdown" and all(spy):
            text, obs = f"SPY return from {spy[0]} to {spy[1]} {value:.2%}{suffix}", spy[1]
        elif name == "credit_stress":
            if all(spy) and all(hyg) and spy == hyg:
                text, obs = f"HYG underperformed SPY by {value:.2%} from {spy[0]} to {spy[1]}{suffix}", spy[1]
            else:
                conn.execute("DELETE FROM alert_feed WHERE id = ?", (rid,))
                fmt = lambda b: f"{b[0]}-{b[1]}" if all(b) else "unavailable"  # noqa: E731
                note = CREDIT_NOTE.format(spy=fmt(spy), hyg=fmt(hyg))
                continue
        elif name == "USD_breakout" and all(uup):
            text, obs = f"UUP return from {uup[0]} to {uup[1]}, z-score {value:.2f}{suffix}", uup[1]
        else:
            # store_market_metrics writes _from and _obs with every return an alert reads
            raise ValueError(f"{name} has no stored interval for its return; the memo stops rather than show it undated")
        conn.execute("UPDATE alert_feed SET date = ?, message = ? WHERE id = ?", (obs.isoformat(), text, rid))
    conn.commit()
    return note
