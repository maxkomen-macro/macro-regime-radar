"""ALFRED (archival FRED) vintages for the vintage impact study (Desk plan D8).

Research only: nothing here is imported by the app, the API or the refresh.
It reads FRED's public API with the FRED key from the environment and caches
each series' full vintage history as gzipped JSON in a cache directory the
caller names (never the repo: the cache is regenerable, and the study's
outputs are the counts, not the raw vintages).

A vintage table has one row per (observation date, real-time period): the
value FRED/ALFRED served for that observation from `realtime_start` through
`realtime_end` inclusive (output_type=1). `as_of(table, day)` rebuilds the
series exactly as it could be downloaded on `day`, and `first_release(table)`
the value and date each observation was first published.

Usage:
    FRED_API_KEY=... python3 -m scripts.research.alfred --cache DIR INDPRO CPIAUCSL UNRATE USREC
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd

API = "https://api.stlouisfed.org/fred/series/observations"
PAGE = 100_000
OPEN_END = "9999-12-31"
# The study's observation window starts well before the stored history
# (1996-03) so a three-month slope and a 12-month change have their inputs.
DEFAULT_OBS_START = "1990-01-01"


def _get(params: dict, attempts: int = 5) -> dict:
    import requests

    last: Exception | None = None
    for i in range(attempts):
        try:
            r = requests.get(API, params=params, timeout=60)
            if r.status_code == 200:
                return r.json()
            last = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as exc:  # network: retry with backoff
            last = exc
        time.sleep(2 ** (i + 1))
    raise RuntimeError(f"ALFRED request failed after {attempts} attempts: {last}")


def fetch_vintages(series_id: str, obs_start: str = DEFAULT_OBS_START) -> list[dict]:
    """Every (date, realtime_start, realtime_end, value) row ALFRED holds for
    the series from `obs_start`, across all vintages, paginated."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise SystemExit("FRED_API_KEY is not set")
    rows: list[dict] = []
    offset = 0
    while True:
        page = _get({
            "series_id": series_id, "api_key": key, "file_type": "json",
            "realtime_start": "1776-07-04", "realtime_end": OPEN_END,
            "observation_start": obs_start, "output_type": 1,
            "limit": PAGE, "offset": offset, "order_by": "observation_date", "sort_order": "asc",
        })
        obs = page.get("observations", [])
        rows.extend({"date": o["date"], "rs": o["realtime_start"], "re": o["realtime_end"], "value": o["value"]}
                    for o in obs)
        offset += len(obs)
        if not obs or offset >= int(page.get("count", 0)):
            break
    return rows


def cache_path(cache: Path, series_id: str) -> Path:
    return cache / f"alfred_{series_id}.json.gz"


def load(cache: Path, series_id: str, *, refresh: bool = False, obs_start: str = DEFAULT_OBS_START) -> pd.DataFrame:
    """The vintage table, from the cache when present (else fetched and cached).
    Columns: date, rs, re (Timestamps; `re` 9999-12-31 is capped at 2262-04-11
    by pandas, so it is kept as a string compare-safe ISO date), value (float,
    NaN where ALFRED serves '.')."""
    p = cache_path(cache, series_id)
    if refresh or not p.exists():
        rows = fetch_vintages(series_id, obs_start)
        p.parent.mkdir(parents=True, exist_ok=True)
        meta = {"series_id": series_id, "obs_start": obs_start,
                "fetched_at_utc": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"), "rows": rows}
        with gzip.open(p, "wt") as f:
            json.dump(meta, f)
    with gzip.open(p, "rt") as f:
        meta = json.load(f)
    df = pd.DataFrame(meta["rows"])
    df["value"] = pd.to_numeric(df["value"].replace(".", None), errors="coerce")
    df.attrs["fetched_at_utc"] = meta["fetched_at_utc"]
    df.attrs["series_id"] = series_id
    return df


def as_of(table: pd.DataFrame, day: str) -> pd.Series:
    """The series as published on `day` (ISO date): for each observation, the
    value whose real-time period covers `day`; observations not yet published
    (or withdrawn) on `day` are absent; '.' (no value) is dropped, as the
    pipeline drops blanks (src/utils/fred_client._download)."""
    m = (table["rs"] <= day) & (table["re"] >= day)
    s = table.loc[m, ["date", "value"]].dropna()
    out = pd.Series(s["value"].to_numpy(dtype=float), index=pd.to_datetime(s["date"]))
    return out.sort_index()


def first_release(table: pd.DataFrame) -> pd.DataFrame:
    """Per observation: its first published (non-blank) value and the date it
    was first published. Index: observation date. Columns: value, published."""
    t = table.dropna(subset=["value"]).sort_values(["date", "rs"])
    g = t.groupby("date", sort=True).first()
    out = pd.DataFrame({"value": g["value"].astype(float), "published": g["rs"]})
    out.index = pd.to_datetime(out.index)
    return out


def latest(table: pd.DataFrame) -> pd.Series:
    """The current vintage (what a download today returns)."""
    return as_of(table, table["rs"].max())


class StoreMismatch(RuntimeError):
    """ALFRED's latest vintage is not the data the store holds (Codex S-5)."""


def store_gap(stored: pd.Series, table: pd.DataFrame) -> dict:
    """Compare a stored series with the table's latest vintage over the stored
    span (first stored month on): the months on each side, the months in
    both, and the largest absolute difference over them (inf when none)."""
    lat = latest(table)
    if len(stored):
        lat = lat[lat.index >= stored.index.min()]
    j = stored.index.intersection(lat.index)
    err = float((stored.loc[j] - lat.loc[j]).abs().max()) if len(j) else float("inf")
    return {"stored_months": int(len(stored)), "alfred_months": int(len(lat)), "months": int(len(j)), "max_abs_diff": err}


def enforce_store_match(gaps: dict[str, dict], tol: float = 1e-9) -> None:
    """Raise unless, for every series, the store and ALFRED's latest vintage
    hold the same months with the same values: a stale or partial cache, or a
    store refreshed after the cache, stops the run before any result."""
    problems = []
    for sid, g in gaps.items():
        if g["stored_months"] == 0 or g["months"] != g["stored_months"] or g["months"] != g["alfred_months"]:
            problems.append(f"{sid}: {g['stored_months']} stored months, {g['alfred_months']} ALFRED months, {g['months']} in both")
        if not g["max_abs_diff"] <= tol:
            problems.append(f"{sid}: ALFRED's latest vintage differs from the store by up to {g['max_abs_diff']}")
    if problems:
        raise StoreMismatch("ALFRED cache does not match the store: " + "; ".join(problems))


def vintage_dates(table: pd.DataFrame) -> list[str]:
    """Every date on which ALFRED records a change to the series."""
    return sorted(table["rs"].unique().tolist())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("series", nargs="+")
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--refresh", action="store_true", help="re-download even when cached")
    ap.add_argument("--obs-start", default=DEFAULT_OBS_START)
    a = ap.parse_args(argv)
    for sid in a.series:
        t = load(a.cache, sid, refresh=a.refresh, obs_start=a.obs_start)
        fr = first_release(t)
        print(f"{sid}: {len(t)} rows, {t['date'].nunique()} observations, {len(vintage_dates(t))} vintage dates "
              f"({t['rs'].min()} .. {t['rs'].max()}), first obs {fr.index.min().date()} first published {fr['published'].min()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
