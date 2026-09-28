"""tests/desk_etf_store.py — the Desk's ETFs in a hermetic store (desk/fill-etf). Not a test module.

`add_etfs(path)` writes the 24 Desk ETFs into `asset_prices` of an existing
test database (the event-study synthetic store, or an empty one), as the
full refresh stores them: adjusted closes with volume, on the real XNYS
sessions (the engine's `exchange_calendars` calendar), seeded random walks,
from START (XLC from its 2018-06-19 listing, XLRE from 2015-10-08) to END.
`starts` moves a series' first close, `drop` removes named sessions from a
series, and `only` limits the symbols written, so a test can build a short
history, a gap, or a database that predates the refresh. `closes(path)` reads
back {symbol: {date: close}}; the tests compute every expected value from it.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np

SECTORS = ("XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY")
OTHERS = ("SPY", "RSP", "IWM", "QQQ", "SMH", "SOXX", "IGV", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP")
ETFS = SECTORS + OTHERS
START = "2014-01-02"
END = "2026-09-18"  # a Friday: the last completed session at the tests' clock
LISTED = {"XLC": "2018-06-19", "XLRE": "2015-10-08"}


def sessions(start: str = START, end: str = END) -> list[str]:
    from src.desk import event_study as es

    return [d.strftime("%Y-%m-%d") for d in es.sessions_between(es.session_calendar(start, end), start, end)]


def add_etfs(path: Path, *, seed: int = 11, end: str = END, starts: dict[str, str] | None = None,
             drop: dict[str, tuple[str, ...]] | None = None, only: tuple[str, ...] | None = None) -> Path:
    from src.market_data import asset_history

    rng = np.random.default_rng(seed)
    days = sessions(START, end)
    first = {**LISTED, **(starts or {})}
    common = rng.normal(0.0003, 0.009, len(days))
    conn = sqlite3.connect(path)
    try:
        asset_history.ensure_table(conn)
        for sym in ETFS:
            own = rng.normal(0.0, 0.006, len(days))
            beta = 1.0 if sym not in ("TLT", "IEF", "UUP", "GLD") else -0.4
            level = 50.0 * np.exp(np.cumsum(beta * common + own))
            if only is not None and sym not in only:
                continue
            gone = set((drop or {}).get(sym, ()))
            rows = [(d, float(v)) for d, v in zip(days, level) if d >= first.get(sym, START) and d not in gone]
            asset_history.write_series(conn, sym, "1d", rows, provider="yfinance", volume={d: 1.0e6 for d, _ in rows})
        conn.commit()
    finally:
        conn.close()
    return path


def closes(path: Path) -> dict[str, dict[str, float]]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        out: dict[str, dict[str, float]] = {}
        for sym, d, c in conn.execute("SELECT symbol, date, close FROM asset_prices WHERE interval = '1d'"):
            out.setdefault(sym, {})[d] = c
        return out
    finally:
        conn.close()
