"""src/market_data/quality.py — price-quality checks on the stored price
histories (Analyst Desk P0c, 2026-11-03).

Reads `asset_prices`, `market_daily` and `desk_series` and returns flags. It
never repairs a row and never fetches anything; scripts/validate_db.py
decides what a flag means for publishing. Standard library plus
api/calendar.py only, so the validator still runs on the lean requirement
sets (tests/test_workflows.py pins that).

Checks, per stored series (one symbol and interval of one table):

  split        the close moved by a ratio within 3% of a split factor (2:1,
               3:1, 3:2, 1:2, 1:10, ...), at least 31% in log terms, and the
               new level held the next stored session. ETFs only: an index, a
               futures contract, an FX rate or a FRED series cannot split. On
               the newest row nothing can show the level held, so a split
               ratio there is judged by size alone (implausible, or a jump).
  implausible  one move larger than the instrument class has ever made in
               the stored history, with room to spare: a log move of 0.405
               (+50% or -33%) for equities, ETFs and gold futures, log 1.10
               (x3) for volatility, 3 percentage points for a yield or a
               spread, log 0.22 (+25%) for a currency; a month allows log
               0.69 (x2) for equities and log 0.405 for currencies.
  stale        a bar that may repeat the previous one: the same close and the
               same volume, in a series that carries volume. Two real sessions
               can match, so this is advisory.
  stale_run    the same close three or more sessions in a row, or two
               month-ends in a row on a monthly series (yields and spreads
               are left out: an unchanged rate is ordinary).
  spike        a bad print: a large move that reverses the next session
               (both legs at least 8 robust sigma, opposite signs, the two
               together within a quarter of the smaller leg), not echoed by
               the instrument's peers that day.
  jump         a move of at least 10 robust sigma and the class's floor that
               no check above explains; real market days land here, with how
               many peers moved with them.
  gap          NYSE sessions missing between two stored rows of a series that
               trades on NYSE's calendar (US ETFs and indices, the VIX).
  off_calendar a row dated on a day NYSE was closed, for the same series.
  cross_table  the same ETF in both tables. market_daily keeps each close as
               the provider served it when the row was written (Polygon's raw
               closes before 2026-05-27, Yahoo's auto-adjusted ones since, a
               row rewritten when a later fetch covers it); asset_prices is
               the whole adjusted history, refetched every full run. Between
               fetches their ratio moves only on an ex-date, and then
               downward, as the newer adjustment lowers older closes. A
               one-session blip, a rise, or a fall of more than 10% says the
               tables disagree: a wrong close in one of them, two sources or
               adjustment vintages spliced, or one table not refreshed.

Robust sigma is 1.4826 x the median absolute deviation of the series' own
moves over the 250 observations before the row (recomputed every 21 rows),
so a move is never judged against itself.

Every flag is advisory: the validator reports flags and never fails a
database on them. `severity` is "high" for a split or implausible move in
asset_prices or market_daily, whose rows go on screen as they are stored, or an
implausible move in a tier-1 desk_series series, and "advisory" otherwise. The
validator names every new high-severity flag in its warnings. Whether any of
them should block publishing is a separate decision (Codex design review,
2026-11-03: blocking on these heuristics needs independently established,
newly introduced corruption; see the review loop's backlog).

Not covered: market_intraday (the five-minute bars the intraday refresh keeps
for 30 days). Its own checks are a separate follow-up.
"""

from __future__ import annotations

import math
import sqlite3
import statistics
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from api import calendar as cal

# ── thresholds (fixed before the run on the published database, 2026-11-03) ──────────────────────────────
WINDOW = 250          # observations in the robust-sigma window
STRIDE = 21           # the window is recomputed every this many rows
MIN_WINDOW = 60       # fewer moves than this: no sigma, so no z-based flag
JUMP_Z = 10.0
SPIKE_Z = 8.0
SPIKE_REVERT = 0.25   # |leg1 + leg2| within this share of the smaller leg
PEER_Z = 5.0          # a peer moving this many of its own sigma that day confirms the move
STALE_RUN = 3
STALE_RUN_MONTHLY = 2  # two month-ends with one adjusted close: a repeated monthly bar
SPLIT_TOLERANCE = 0.03
SPLIT_MIN_LOG = math.log(1.36)  # 3:2 is the smallest factor checked (log 0.405); 1.36 leaves the tolerance room
SPLIT_FACTORS = (2.0, 3.0, 4.0, 5.0, 8.0, 10.0, 20.0, 1.5)
RATIO_STEP = 0.003    # cross_table: 0.3% in log terms
RATIO_DROP = math.log(1 / 0.9)  # cross_table: a fall in the ratio above 10% is no distribution
# A flag is known only if its observation is unchanged to this (log, or pp for a rate). Two
# published snapshots a day apart (2026-11-03 and 11-04) differ by up to 1.5e-6 on the same
# flags: the provider's restated adjusted history is not an exact rescale. 2e-5 holds that
# noise with room and stays 150x below cross_table's 0.3% step, so a real change is new.
OBSERVED_TOL = 2e-5

SCREEN_TABLES = ("asset_prices", "market_daily")  # read on screen as stored
HIGH_CHECKS = ("split", "implausible")
CAL_FIRST, CAL_LAST = date(min(cal.HOLIDAYS), 1, 1), date(max(cal.HOLIDAYS), 12, 31)


@dataclass(frozen=True)
class Profile:
    kind: str                      # equity | index | vol | futures | fx | rate | spot | generic
    transform: str = "log"         # log: log(c_t / c_t-1); level: c_t - c_t-1
    implausible: float | None = None
    floor: float = 0.0             # smallest move the jump and spike checks name
    splits: bool = False
    nyse: bool = False             # trades on NYSE's calendar (gap and off_calendar)
    stale_run: bool = True
    peers: tuple[str, ...] = ()    # peer groups whose moves confirm a large move
    peer_need: int = 1


L15, L2, L3 = math.log(1.5), math.log(2.0), math.log(3.0)
_US = ("us_listed",)
ETF = Profile("equity", implausible=L15, floor=0.05, splits=True, nyse=True, peers=_US, peer_need=3)
INDEX = Profile("index", implausible=L15, floor=0.05, nyse=True, peers=_US, peer_need=3)
VOL = Profile("vol", implausible=L3, floor=0.25, nyse=True, peers=("vol",))
GOLD_FUT = Profile("futures", implausible=L15, floor=0.04, peers=("gold",))
FX = Profile("fx", implausible=math.log(1.25), floor=0.03, peers=("usd",))
RATE = Profile("rate", transform="level", implausible=3.0, floor=0.25, stale_run=False, peers=("rates",))
SPOT = Profile("spot", implausible=L2, floor=0.10)
GENERIC = Profile("generic", floor=0.05)

VOL_SYMBOLS = {"^VIX", "VIXCLS", "VIXY"}
GOLD = {"GC=F", "GLD"}
US_INDICES = {"^GSPC", "^RUT", "^NDX", "^DJI"}
FRED_RATES_PREFIX = ("DGS", "T10Y", "BAML", "DFII", "T5Y")


def profile(table: str, series: str, interval: str = "1d") -> Profile:
    """The class a stored series is judged as."""
    if series in VOL_SYMBOLS:
        p = replace(VOL, nyse=table != "desk_series")
    elif table == "desk_series" and series.startswith(FRED_RATES_PREFIX):
        p = RATE
    elif table == "desk_series" and series == "DCOILWTICO":
        p = SPOT
    elif series.endswith("=X") or series == "DX-Y.NYB":
        p = FX
    elif series == "GC=F":
        p = GOLD_FUT
    elif series in US_INDICES:
        p = INDEX
    elif table in SCREEN_TABLES and not series.startswith("^") and "=" not in series:
        p = replace(ETF, peers=_US + (("gold",) if series in GOLD else ()))
    else:
        p = GENERIC
    if interval == "1mo":  # a month is a different clock: wider limits, no session calendar, no z checks
        wide = {"fx": math.log(1.5)}.get(p.kind, L2 if p.implausible is not None else None)
        p = replace(p, implausible=wide, nyse=False, peers=())
    return p


@dataclass
class Series:
    table: str
    series: str
    interval: str
    dates: list[str] = field(default_factory=list)
    closes: list[float] = field(default_factory=list)
    volumes: list[float | None] | None = None


def _num(x) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def _iso(d) -> str | None:
    if not isinstance(d, str) or len(d) < 10:
        return None
    try:
        return date.fromisoformat(d[:10]).isoformat() if len(d) == 10 else None
    except ValueError:
        return None


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}


def load(conn: sqlite3.Connection) -> tuple[list[Series], dict[str, int]]:
    """Every stored price series, ordered by date. Rows no check can read (a
    close that is not a finite number, a malformed date, a second row on the
    same date) are counted by reason in the second value, never silently
    dropped; the validator's own checks judge them. A sqlite error raises."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    skipped: dict[str, int] = {}
    out: list[Series] = []
    plans = []
    if "asset_prices" in tables:
        cols = _columns(conn, "asset_prices")
        vol = "volume" if "volume" in cols else "NULL"
        plans.append(("asset_prices", f"SELECT symbol, interval, date, close, {vol} FROM asset_prices "
                                      "ORDER BY symbol, interval, date", "volume" in cols))
    if "market_daily" in tables:
        cols = _columns(conn, "market_daily")
        vol = "volume" if "volume" in cols else "NULL"
        plans.append(("market_daily", f"SELECT symbol, '1d', date, close, {vol} FROM market_daily ORDER BY symbol, date",
                      "volume" in cols))
    if "desk_series" in tables:
        plans.append(("desk_series", "SELECT series_id, '1d', date, value, NULL FROM desk_series ORDER BY series_id, date", False))
    for table, sql, has_volume in plans:
        cur: Series | None = None
        for sym, interval, d, close, volume in conn.execute(sql):
            if cur is None or (cur.series, cur.interval) != (sym, interval):
                cur = Series(table, str(sym), str(interval), volumes=[] if has_volume else None)
                out.append(cur)
            day, c = _iso(d), _num(close)
            if day is None:
                skipped[f"{table}: malformed date"] = skipped.get(f"{table}: malformed date", 0) + 1
                continue
            if c is None:
                skipped[f"{table}: non-numeric close"] = skipped.get(f"{table}: non-numeric close", 0) + 1
                continue
            if cur.dates and day <= cur.dates[-1]:
                skipped[f"{table}: second row on one date"] = skipped.get(f"{table}: second row on one date", 0) + 1
                continue
            cur.dates.append(day)
            cur.closes.append(c)
            if cur.volumes is not None:
                cur.volumes.append(_num(volume))
    return [s for s in out if s.dates], skipped


def _moves(s: Series, p: Profile) -> list[float | None]:
    """moves[i] is the move into row i (moves[0] is None). A log move needs two positive closes."""
    out: list[float | None] = [None]
    for a, b in zip(s.closes, s.closes[1:]):
        if p.transform == "level":
            m = b - a
            out.append(m if math.isfinite(m) else None)
        else:  # a difference of logs: no ratio of two extreme closes can underflow or overflow
            out.append(math.log(b) - math.log(a) if a > 0 and b > 0 else None)
    return out


def _sigmas(moves: list[float | None]) -> list[float | None]:
    """sigma[i]: 1.4826 x MAD of the moves in the WINDOW rows before row i's block
    (blocks of STRIDE rows), None with fewer than MIN_WINDOW moves or no spread."""
    out: list[float | None] = []
    cache: dict[int, float | None] = {}
    for i in range(len(moves)):
        b = i // STRIDE
        if b not in cache:
            end = b * STRIDE
            win = [m for m in moves[max(0, end - WINDOW):end] if m is not None]
            sig = None
            if len(win) >= MIN_WINDOW:
                med = statistics.median(win)
                mad = statistics.median([abs(m - med) for m in win])
                if mad > 0:
                    sig = 1.4826 * mad
                else:  # mostly unchanged: fall back to the mean absolute deviation
                    mean_ad = sum(abs(m - med) for m in win) / len(win)
                    sig = 1.2533 * mean_ad if mean_ad > 0 else None
            cache[b] = sig
        out.append(cache[b])
    return out


def _fmt(p: Profile, m: float) -> str:
    if p.transform == "level":
        return f"{m * 100:+.0f}bp"
    if m > 700:  # exp() would overflow; the move is astronomically large either way
        return f"log move {m:+.1f}"
    return f"{math.expm1(m) * 100:+.1f}%"


def _split_factor(m: float) -> float | None:
    if abs(m) > math.log(max(SPLIT_FACTORS) * (1 + SPLIT_TOLERANCE)):
        return None
    ratio = math.exp(m)
    for f in SPLIT_FACTORS:
        for target in (f, 1 / f):
            if abs(ratio / target - 1) <= SPLIT_TOLERANCE:
                return target
    return None


def _ratio_label(target: float) -> str:
    if target >= 1:
        return f"{target:g}x (a {target:g}:1 reverse split left unadjusted?)" if target != 1.5 else "1.5x (a 2:3 reverse split?)"
    inv = 1 / target
    return f"1/{inv:g} (a {inv:g}:1 split left unadjusted?)" if inv != 1.5 else "2/3 (a 3:2 split left unadjusted?)"


def _nyse_missing(a: str, b: str) -> list[str]:
    """NYSE sessions strictly between two stored dates, within years the calendar knows
    (the scan is clamped to them, so two rows centuries apart cost at most the table's span)."""
    out = []
    d = max(date.fromisoformat(a) + timedelta(days=1), CAL_FIRST)
    end = min(date.fromisoformat(b), CAL_LAST + timedelta(days=1))
    while d < end:
        if cal.calendar_known(d) and cal.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _tier1_desk() -> set[str]:
    try:
        from api import freshness  # stdlib + api only; imported late so the module loads without it
    except ImportError:  # pragma: no cover - the repo always carries it
        return set()
    return {sid for sid, meta in freshness.DESK_REFRESH_SERIES.items() if int(meta.get("tier", 1)) == 1}


def _severity(table: str, series: str, check: str, tier1: set[str]) -> str:
    if check in HIGH_CHECKS and (table in SCREEN_TABLES or (table == "desk_series" and check == "implausible" and series in tier1)):
        return "high"
    return "advisory"


def _flag(s: Series, d: str, check: str, detail: str, tier1: set[str], i: int | None = None,
          move: float | None = None, observed: tuple = ()) -> dict:
    """One flag. `observed` holds the stored observations the flag is about, in
    scale-free form (the earlier date; the move or moves; the repeated volume; the
    run or the gap; nothing more for a row on a closed day), which tells a known flag
    from one whose numbers changed (compare). Left out: the context a test weighs
    (robust sigma, peers), and a level it only compared for equality (a repeated
    close), which a restatement rescales without changing the flag. A move check (split, implausible) also carries the
    move and the two closes it runs between."""
    out = {"check": check, "table": s.table, "series": s.series, "interval": s.interval, "date": d,
           "severity": _severity(s.table, s.series, check, tier1), "detail": detail, "observed": list(observed)}
    if i is not None:
        out.update(move=move, prev_date=s.dates[i - 1], prev_close=s.closes[i - 1], close=s.closes[i])
    return out


def key(flag: dict) -> tuple[str, str, str, str, str]:
    return flag["check"], flag["table"], flag["series"], flag["interval"], flag["date"]


def check_series(s: Series, p: Profile, moves, sigmas, peer_z, tier1: set[str]) -> list[dict]:
    """Every flag on one series. peer_z(group, date, exclude) counts the peers that moved."""
    flags: list[dict] = []
    n = len(s.closes)
    taken: set[int] = set()   # rows a stronger explanation already covers
    for i in range(1, n):
        m = moves[i]
        if m is None:
            continue
        nxt = moves[i + 1] if i + 1 < n else None
        prv = moves[i - 1] if i - 1 in taken else None  # the row before was a bad print: this move may be its way back
        returning = prv is not None and abs(m + prv) <= 0.5 * abs(m)
        target = _split_factor(m) if p.splits and abs(m) >= SPLIT_MIN_LOG else None
        if target is not None and nxt is not None and abs(m + nxt) > 0.5 * abs(m) and not returning:
            flags.append(_flag(s, s.dates[i], "split", f"close {s.closes[i - 1]:g} -> {s.closes[i]:g} on {s.dates[i]}: "
                                                         f"ratio {math.exp(m):.4f}, near {_ratio_label(target)}", tier1, i, m,
                               (s.dates[i - 1], m)))
            taken.add(i)
            continue
        if p.implausible is not None and abs(m) >= p.implausible:
            unconfirmed = f"; a split ratio ({_ratio_label(target)}), unconfirmed on the newest row" \
                if target is not None and nxt is None else ""
            flags.append(_flag(s, s.dates[i], "implausible", f"{_fmt(p, m)} from {s.dates[i - 1]} "
                                                               f"({s.closes[i - 1]:g} -> {s.closes[i]:g}), beyond the {p.kind} limit "
                                                               f"of {_fmt(p, p.implausible) if p.transform == 'level' else f'log {p.implausible:.3f}'}"
                                                               f"{unconfirmed}", tier1, i, m, (s.dates[i - 1], m)))
            taken.add(i)
    # stale: a repeated bar, and a run of one close
    if s.volumes is not None and any((v or 0) > 0 for v in s.volumes):
        for i in range(1, n):
            if s.closes[i] == s.closes[i - 1] and s.volumes[i] == s.volumes[i - 1] and s.volumes[i] is not None:
                flags.append(_flag(s, s.dates[i], "stale", f"close {s.closes[i]:g} and volume {s.volumes[i]:g} repeat "
                                                             f"{s.dates[i - 1]}'s bar", tier1,
                                   observed=(s.dates[i - 1], float(s.volumes[i]))))
                taken.add(i)
    if p.stale_run:
        run, need = 1, STALE_RUN_MONTHLY if s.interval == "1mo" else STALE_RUN
        for i in range(1, n + 1):
            if i < n and s.closes[i] == s.closes[i - 1]:
                run += 1
                continue
            if run >= need:
                first, last = s.dates[i - run], s.dates[i - 1]
                flags.append(_flag(s, last, "stale_run", f"close {s.closes[i - 1]:g} on {run} rows in a row, {first} to {last}", tier1,
                                   observed=(first, run)))
            run = 1
    # spike and jump: z-based, daily only
    if s.interval == "1d":
        for i in range(1, n):
            m, sig = moves[i], sigmas[i]
            if m is None or sig is None or i in taken or abs(m) < p.floor:
                continue
            z = abs(m) / sig
            nxt = moves[i + 1] if i + 1 < n else None
            confirmed = max((peer_z(g, s.dates[i], s) for g in p.peers), default=0)
            if (nxt is not None and z >= SPIKE_Z and abs(nxt) / sig >= SPIKE_Z and m * nxt < 0
                    and abs(m + nxt) <= SPIKE_REVERT * min(abs(m), abs(nxt)) and confirmed < p.peer_need):
                flags.append(_flag(s, s.dates[i], "spike", f"{_fmt(p, m)} on {s.dates[i]} then {_fmt(p, nxt)} on {s.dates[i + 1]} "
                                                             f"({z:.0f} sigma, {confirmed} peer(s) moved with it): a bad print?", tier1,
                                   observed=(s.dates[i - 1], m, nxt)))
                taken.update((i, i + 1))
            elif z >= JUMP_Z:
                peers = f", {confirmed} peer(s) moved with it" if p.peers else ""
                flags.append(_flag(s, s.dates[i], "jump", f"{_fmt(p, m)} from {s.dates[i - 1]} ({z:.0f} sigma{peers})", tier1,
                                   observed=(s.dates[i - 1], m)))
    # gaps and off-calendar rows: NYSE-calendar daily series only
    if p.nyse and s.interval == "1d":
        for i in range(n):
            d = date.fromisoformat(s.dates[i])
            if cal.calendar_known(d) and not cal.is_trading_day(d):
                flags.append(_flag(s, s.dates[i], "off_calendar", f"row dated {s.dates[i]}, a day NYSE was closed "
                                                                    f"(close {s.closes[i]:g})", tier1))
            if i:
                missing = _nyse_missing(s.dates[i - 1], s.dates[i])
                if missing:
                    more = f" ({len(missing)} sessions, first {missing[0]})" if len(missing) > 1 else ""
                    flags.append(_flag(s, s.dates[i], "gap", f"no row for {missing[0] if len(missing) == 1 else 'the NYSE sessions'} "
                                                           f"between {s.dates[i - 1]} and {s.dates[i]}{more}", tier1,
                                       observed=(s.dates[i - 1], len(missing))))
    return flags


def cross_table(raw: Series, adj: Series, tier1: set[str]) -> list[dict]:
    """market_daily's closes against asset_prices' adjusted ones for the same
    symbol, on the sessions both store. Flags are the market_daily series'
    (dated at the row whose ratio moved), always advisory."""
    a = dict(zip(adj.dates, adj.closes))
    pairs = [(d, c, a[d]) for d, c in zip(raw.dates, raw.closes) if d in a and c > 0 and a[d] > 0]
    logq = [math.log(c) - math.log(ad) for _, c, ad in pairs]
    steps = [None] + [q1 - q0 for q0, q1 in zip(logq, logq[1:])]
    flags = []
    i = 1
    while i < len(pairs):
        s = steps[i]
        nxt = steps[i + 1] if i + 1 < len(pairs) else None
        if abs(s) > RATIO_STEP and nxt is not None and abs(s + nxt) <= 0.001 + 0.2 * abs(s):
            d = pairs[i][0]
            flags.append(_flag(raw, d, "cross_table", f"{d}: market_daily's close ({pairs[i][1]:g}) and asset_prices' "
                                                       f"({pairs[i][2]:g}) disagree for one session ({s * 100:+.2f}%, back on "
                                                       f"{pairs[i + 1][0]}): a wrong close in one of the two tables?", tier1,
                                observed=(pairs[i - 1][0], s, nxt)))
            i += 2
            continue
        if s > RATIO_STEP or s < -RATIO_DROP:
            d = pairs[i][0]
            why = "rose, which no distribution explains" if s > 0 else "fell by more than any distribution"
            flags.append(_flag(raw, d, "cross_table", f"{d}: the market_daily/asset_prices close ratio {why} "
                                                       f"({s * 100:+.2f}% from {pairs[i - 1][0]}): sources or adjustment vintages "
                                                       "spliced, or one table not refreshed?", tier1,
                                observed=(pairs[i - 1][0], s)))
        i += 1
    return flags


def run(conn: sqlite3.Connection) -> dict:
    """All checks on every stored price series. A sqlite error raises: the
    validator runs this as a mandatory check."""
    series, skipped = load(conn)
    tier1 = _tier1_desk()
    profs = {id(s): profile(s.table, s.series, s.interval) for s in series}
    moves = {id(s): _moves(s, profs[id(s)]) for s in series}
    sigmas = {id(s): _sigmas(moves[id(s)]) if s.interval == "1d" else [None] * len(s.dates) for s in series}
    # peer groups: date -> list of (series name, |z|) for each daily series of the group
    groups: dict[str, dict[str, list[tuple[str, float]]]] = {}
    for s in series:
        p = profs[id(s)]
        if s.interval != "1d" or not p.peers:
            continue
        for i, (m, sig) in enumerate(zip(moves[id(s)], sigmas[id(s)])):
            if m is not None and sig:
                for g in p.peers:
                    groups.setdefault(g, {}).setdefault(s.dates[i], []).append((s.series, abs(m) / sig))

    def peer_z(group: str, d: str, s: Series) -> int:
        return len({name for name, z in groups.get(group, {}).get(d, []) if name != s.series and z >= PEER_Z})

    flags: list[dict] = []
    for s in series:
        flags.extend(check_series(s, profs[id(s)], moves[id(s)], sigmas[id(s)], peer_z, tier1))
    adj = {s.series: s for s in series if s.table == "asset_prices" and s.interval == "1d"}
    for s in series:
        if s.table == "market_daily" and s.series in adj:
            flags.extend(cross_table(s, adj[s.series], tier1))
    flags.sort(key=lambda f: (f["table"], f["series"], f["interval"], f["date"], f["check"]))
    return {"series": len(series), "rows": sum(len(s.dates) for s in series), "skipped": skipped, "flags": flags}


def _same_observation(a: list, b: list) -> bool:
    """Two flags' observations agree: same dates and counts, each move within OBSERVED_TOL."""
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if isinstance(x, float) or isinstance(y, float):
            if x is None or y is None or abs(float(x) - float(y)) > OBSERVED_TOL:
                return False
        elif x != y:
            return False
    return True


def compare(current: dict, previous: dict | None) -> dict:
    """Current flags against the previous snapshot's: a flag is known when the previous
    snapshot holds one with the same key (check, table, series, interval, date) and the
    same observation (same earlier date, run or gap, each move within OBSERVED_TOL),
    and new otherwise, so a stored price that changed under a known flag (a worse bad
    print, a different move, a wider cross-table gap) is new again once the change
    exceeds the provider's rounding noise. A dividend restatement of an adjusted history
    scales every close before the ex-date by one factor, so it leaves every move and
    cross-table step unchanged, to that noise, except the one across the ex-date (that
    flag, if any, is new once). Without a previous
    snapshot nothing is new or known (`judged` is False)."""
    if previous is None:
        return {"judged": False, "flags": [{**f, "new": None} for f in current.get("flags", [])]}
    seen: dict[tuple, list[list]] = {}
    for f in previous.get("flags", []):
        seen.setdefault(key(f), []).append(f.get("observed", []))
    return {"judged": True, "flags": [{**f, "new": not any(_same_observation(f.get("observed", []), o)
                                                            for o in seen.get(key(f), []))}
                                      for f in current.get("flags", [])]}


def counts(flags: list[dict]) -> dict[str, dict[str, int]]:
    """Per check: flags in total, new, and of high severity."""
    out: dict[str, dict[str, int]] = {}
    for f in flags:
        c = out.setdefault(f["check"], {"total": 0, "new": 0, "high": 0})
        c["total"] += 1
        c["new"] += 1 if f.get("new") else 0
        c["high"] += 1 if f["severity"] == "high" else 0
    return dict(sorted(out.items()))
