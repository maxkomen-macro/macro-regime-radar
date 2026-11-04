"""tests/test_desk_corr_views.py — Desk P1b: correlation windows and correlation by regime.

The method is docs/desk/CORRELATION_VIEWS.md; each test names the section it
pins. Every expected value is computed here from the closes the hermetic store
holds (tests/desk_etf_store.py) and from regime rows the test writes itself, so
the item's own helpers are never their own reference.
"""

from __future__ import annotations

import math
import os
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

os.environ.setdefault("FRED_API_KEY", "test")

from api import desk_items_etf as etf  # noqa: E402
from src.desk import event_study as es  # noqa: E402
from tests import desk_etf_store as hs  # noqa: E402

KEYS = [etf.BENCHMARK, *etf.SECTOR_KEYS, "rsp", "iwm", *(k for k, _ in etf.CORR_ASSETS), etf.VIX[0], "smh"]


def _store(tmp_path: Path, regimes: pd.Series | None = None, **kw) -> etf.Store:
    path = hs.add_etfs(tmp_path / "etf.db", **kw)
    conn = sqlite3.connect(path)
    try:
        st = etf.Store(conn, KEYS, hs.END)
    finally:
        conn.close()
    st.regimes = regimes
    return st


def _closes(st: etf.Store, key: str) -> pd.Series:
    return pd.Series(st.px[key], index=st.sessions)


def _rets(st: etf.Store, key: str) -> pd.Series:
    """Daily log returns from consecutive calendar sessions, NaN across a gap (§2), computed here."""
    c = _closes(st, key)
    return np.log(c / c.shift(1))


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.corrcoef(a, b)[0, 1])


def _months(start: str, end: str, label_of) -> pd.Series:
    idx = pd.period_range(start, end, freq="M")
    return pd.Series([label_of(p) for p in idx], index=idx, dtype=object)


CYCLE = es.REGIME_LABELS  # Goldilocks, Overheating, Stagflation, Recession Risk


def _cycling(start: str = "2013-01", end: str = "2026-07", every: int = 3) -> pd.Series:
    return _months(start, end, lambda p: CYCLE[((p.year * 12 + p.month) // every) % 4])


# ── §3 windows ──────────────────────────────────────────────────────────────

def test_the_noise_band_is_the_fisher_z_90_band_of_w_independent_pairs():
    for w, want in ((20, 0.3790), (60, 0.2145), (120, 0.1509)):
        assert etf.noise_band(w) == pytest.approx(math.tanh(1.6448536269514722 / math.sqrt(w - 3)), abs=0)
        assert etf.noise_band(w) == pytest.approx(want, abs=5e-5)
    assert etf.HORIZONS == (20, 60, 120)


def test_views_add_keys_and_leave_every_existing_value_as_it_was(tmp_path):
    """§1: the views are new keys; the 60-session fields a client reads today are unchanged."""
    st = _store(tmp_path, _cycling())
    plain = (etf.stock_bond(st), etf.correlations(st), etf.matrix(st))
    viewed = (etf.stock_bond(st, True), etf.correlations(st, True), etf.matrix(st, True))
    sb0, sb1 = plain[0], viewed[0]
    assert {k: sb1[k] for k in sb0} == sb0 and set(sb1) - set(sb0) == {"horizons", "by_horizon"}
    for r0, r1 in zip(plain[1], viewed[1]):
        assert {k: r1[k] for k in r0} == r0 and set(r1) - set(r0) == {"by_horizon", "by_regime"}
    mx0, mx1 = plain[2], viewed[2]
    assert {k: mx1[k] for k in mx0} == mx0 and set(mx1) - set(mx0) == {"horizons", "by_horizon"}
    assert list(sb0) == [k for k in sb1 if k in sb0]  # the existing keys keep their order


def test_by_horizon_60_is_the_served_60_session_answer_field_for_field(tmp_path):
    """§1: a client reads every horizon one way; "60" is the block's own answer."""
    st = _store(tmp_path, _cycling())
    sb = etf.stock_bond(st, True)
    h = sb["by_horizon"]["60"]
    for k in ("today", "today_date", "today_reason", "year_ago", "year_ago_date", "flipped", "flipped_on",
              "flipped_to", "series", "window", "line_window"):
        assert h[k] == sb[k], k
    assert (h["horizon"], h["noise_band"]) == (60, etf.noise_band(60))
    for r in etf.correlations(st, True):
        h = r["by_horizon"]["60"]
        assert (h["corr"], h["window"], h["reason"]) == (r["corr"], r["window"], r["reason"]), r["symbol"]
    mx = etf.matrix(st, True)
    h = mx["by_horizon"]["60"]
    for k in ("values", "no_data", "window", "coverage", "lead"):
        assert h[k] == mx[k], k
    assert sb["horizons"] == mx["horizons"] == [20, 60, 120]


def test_each_horizon_is_pearson_of_the_last_w_daily_log_returns(tmp_path):
    """§2, §3: Pearson over the w return dates ending at the newest session both close on."""
    st = _store(tmp_path, _cycling())
    spy, tlt = _rets(st, "spy"), _rets(st, "tlt")
    t = int(np.flatnonzero(np.isfinite(st.px["spy"]) & np.isfinite(st.px["tlt"]))[-1])
    sb = etf.stock_bond(st, True)
    for w in (20, 60, 120):
        want = _pearson(spy.iloc[t - w + 1:t + 1].to_numpy(), tlt.iloc[t - w + 1:t + 1].to_numpy())
        h = sb["by_horizon"][str(w)]
        assert h["today"] == pytest.approx(want, abs=1e-12)
        assert h["window"] == {"start": st.iso[t - w + 1], "end": st.iso[t], "n": w}
        assert h["today_date"] == st.iso[t]
        # every point of the one-year line is the same statistic on its own session
        mid = len(h["series"]) // 2
        d = h["series"][mid]["date"]
        i = st.iso.index(d)
        assert h["series"][mid]["corr"] == pytest.approx(_pearson(spy.iloc[i - w + 1:i + 1].to_numpy(),
                                                                  tlt.iloc[i - w + 1:i + 1].to_numpy()), abs=1e-12)
    rows = {r["symbol"]: r for r in etf.correlations(st, True)}
    gld = _rets(st, "gld")
    for w in (20, 120):
        h = rows["GLD"]["by_horizon"][str(w)]
        assert h["corr"] == pytest.approx(_pearson(spy.iloc[t - w + 1:t + 1].to_numpy(), gld.iloc[t - w + 1:t + 1].to_numpy()), abs=1e-12)
        assert h["noise_band"] == etf.noise_band(w)


def test_a_gap_nulls_only_the_windows_it_falls_in_with_the_reason(tmp_path):
    """§3: TLT without the close 40 sessions before the end: two returns are gone,
    so 60 and 120 are null with their reasons while 20 is served; nothing is filled."""
    days = hs.sessions()
    gone = days[-41]
    st = _store(tmp_path, _cycling(), drop={"TLT": (gone,)})
    sb = etf.stock_bond(st, True)
    assert sb["by_horizon"]["20"]["today"] is not None and sb["by_horizon"]["20"]["today_reason"] is None
    for w in ("60", "120"):
        h = sb["by_horizon"][w]
        assert h["today"] is None
        assert h["today_reason"] == f"fewer than {w} complete daily return pairs in the window to {days[-1]}"
    row = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")
    assert row["by_horizon"]["20"]["corr"] is not None
    assert row["by_horizon"]["120"]["corr"] is None and row["by_horizon"]["120"]["reason"].startswith("fewer than 120")
    mx = etf.matrix(st, True)
    nd = {w: {n["symbol"]: n["reason"] for n in mx["by_horizon"][w]["no_data"]} for w in ("20", "60", "120")}
    assert "TLT" not in nd["20"]
    assert nd["60"]["TLT"] == f"only 58 of 60 daily returns in the window to {days[-1]}: no close stored for {gone}"
    assert nd["120"]["TLT"].startswith("only 118 of 120 daily returns")
    assert mx["by_horizon"]["120"]["coverage"][mx["assets"].index("TLT")] == 118


def test_a_short_history_is_served_at_20_and_no_data_at_120(tmp_path):
    """§3: SMH listed 80 sessions before the end: complete 20- and 60-session
    windows, no 120-session one; its cells at 120 are null, never filled."""
    days = hs.sessions()
    st = _store(tmp_path, _cycling(), starts={"SMH": days[-80]})
    mx = etf.matrix(st, True)
    j = mx["assets"].index("SMH")
    absent = {n["symbol"] for n in mx["no_data"]} - {"SMH"}  # the hermetic store holds no ^VIX
    assert absent == {"^VIX"}
    for w in ("20", "60"):
        b = mx["by_horizon"][w]
        assert {n["symbol"] for n in b["no_data"]} == absent, w
        assert all(v is not None for v, a in zip(b["values"][j], mx["assets"]) if a not in absent), w
    b = mx["by_horizon"]["120"]
    assert all(v is None for v in b["values"][j]) and all(row[j] is None for row in b["values"])
    reason = {n["symbol"]: n["reason"] for n in b["no_data"]}["SMH"]
    assert reason.startswith(f"only 79 of 120 daily returns in the window to {days[-1]}: no close on ")
    assert b["coverage"][j] == 79
    # the other assets' 120-session cells are still served
    i = mx["assets"].index("SPY")
    assert b["values"][i][mx["assets"].index("TLT")] is not None


# ── §4 by regime ────────────────────────────────────────────────────────────

def _expected_regime(st: etf.Store, months: pd.Series, a: str, b: str) -> dict:
    """The §4 statistic computed here: each return date takes the row stamped two
    calendar months before its own month."""
    ra, rb = _rets(st, a), _rets(st, b)
    t = int(np.flatnonzero(np.isfinite(st.px[a]) & np.isfinite(st.px[b]))[-1])
    ok = (ra.notna() & rb.notna()).to_numpy()
    lo = int(np.flatnonzero(ok[:t + 1])[0])
    out: dict = {"t": t, "lo": lo, "by": {}, "unlabeled": 0, "incomplete": 0}
    pooled: dict[str, list[int]] = {}
    for i in range(lo, t + 1):
        d = st.sessions[i]
        key = pd.Period(year=d.year, month=d.month, freq="M") - 2
        lab = months.get(key) if key in months.index else None
        if not ok[i]:
            out["incomplete"] += 1
        elif lab is None:
            out["unlabeled"] += 1
        else:
            pooled.setdefault(lab, []).append(i)
    for lab, idx in pooled.items():
        out["by"][lab] = (len(idx), _pearson(ra.iloc[idx].to_numpy(), rb.iloc[idx].to_numpy()) if len(idx) >= 60 else None,
                          st.iso[idx[0]], st.iso[idx[-1]])
    every = sorted(i for idx in pooled.values() for i in idx)
    out["all"] = (len(every), _pearson(ra.iloc[every].to_numpy(), rb.iloc[every].to_numpy()))
    return out


def test_each_regime_is_the_pooled_pearson_of_its_returns_under_the_k_minus_2_rule(tmp_path):
    months = _cycling()
    st = _store(tmp_path, months)
    want = _expected_regime(st, months, "spy", "tlt")
    row = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")
    br = row["by_regime"]
    assert (br["regime_history"], br["lag_months"], br["as_known"], br["min_n"]) == ("revised", 2, None, 60)
    assert br["as_known_reason"] == etf.AS_KNOWN_REASON and br["reason"] is None
    assert br["rule"].startswith("A daily return dated in month K takes the regimes row stamped K−2 months")
    assert br["sample"] == {"start": st.iso[want["lo"]], "end": st.iso[want["t"]]}
    assert (br["unlabeled_n"], br["incomplete_n"]) == (want["unlabeled"], want["incomplete"])
    assert [g["regime"] for g in br["regimes"]] == list(es.REGIME_LABELS)
    for g in br["regimes"]:
        n, r, first, last = want["by"][g["regime"]]
        assert (g["n"], g["first"], g["last"]) == (n, first, last), g["regime"]
        assert g["corr"] == pytest.approx(r, abs=1e-12), g["regime"]
    assert br["all"]["n"] == want["all"][0] and br["all"]["corr"] == pytest.approx(want["all"][1], abs=1e-12)
    assert sum(g["n"] for g in br["regimes"]) == br["all"]["n"]


def test_the_label_is_the_engines_own_regime_at(tmp_path):
    """§4: the item reads the engine's rule (event_study.regime_at), never its own copy."""
    months = _cycling()
    st = _store(tmp_path, months)
    assert list(st.labels()) == list(es.regime_at(st.sessions, months))


def test_dates_without_a_row_are_unlabeled_counted_and_left_out(tmp_path):
    """§4: no row for 2025-10 leaves December 2025's returns Unlabeled; returns
    before the first row's governed month are Unlabeled too."""
    full = _cycling()
    holed = full.drop(pd.Period("2025-10", freq="M"))
    for d in ("a", "b", "c"):
        (tmp_path / d).mkdir()
    a, b = _store(tmp_path / "a", full), _store(tmp_path / "b", holed)
    ra = next(r for r in etf.correlations(a, True) if r["symbol"] == "TLT")["by_regime"]
    rb = next(r for r in etf.correlations(b, True) if r["symbol"] == "TLT")["by_regime"]
    december = sum(1 for d in hs.sessions() if d.startswith("2025-12"))
    assert rb["unlabeled_n"] - ra["unlabeled_n"] == december  # every December return is complete in this store
    assert ra["all"]["n"] - rb["all"]["n"] == december
    # the store starts 2014-01-02 and the rows 2013-01, so the first months are labelled; rows that start later
    # leave the earlier returns Unlabeled
    late = _cycling(start="2016-01")
    rc = next(r for r in etf.correlations(_store(tmp_path / "c", late), True) if r["symbol"] == "TLT")["by_regime"]
    before = sum(1 for d in hs.sessions() if "2014-01-03" <= d < "2016-03-01")
    assert rc["unlabeled_n"] == before


def test_a_regime_short_of_60_returns_is_null_with_its_reason(tmp_path):
    """§4: Recession Risk only in 2026-05 (governs July 2026): fewer than 60 returns, so no value."""
    months = _months("2013-01", "2026-07", lambda p: "Recession Risk" if str(p) == "2026-05" else "Overheating")
    st = _store(tmp_path, months)
    br = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")["by_regime"]
    rr = next(g for g in br["regimes"] if g["regime"] == "Recession Risk")
    july = sum(1 for d in hs.sessions() if d.startswith("2026-07"))
    assert (rr["corr"], rr["n"], rr["spells"], rr["largest_spell_share"]) == (None, july, 1, 1.0)
    assert rr["reason"] == f"only {july} daily returns in Recession Risk; a correlation needs 60"
    gl = next(g for g in br["regimes"] if g["regime"] == "Goldilocks")
    assert (gl["corr"], gl["n"], gl["first"], gl["spells"], gl["largest_spell_share"]) == (None, 0, None, 0, None)
    assert gl["reason"] == "only 0 daily returns in Goldilocks; a correlation needs 60"


def test_spells_are_runs_of_months_and_the_largest_share_is_counted(tmp_path):
    """§4: Stagflation governs 2015-01..2015-06 (6 months) and 2020-01..2020-03 (3), with a
    missing row inside the second run splitting it; spells count runs holding a used return."""
    def lab(p):
        if "2014-11" <= str(p) <= "2015-04":
            return "Stagflation"
        if str(p) in ("2019-11", "2020-01"):
            return "Stagflation"
        return "Overheating"
    months = _months("2013-01", "2026-07", lab).drop(pd.Period("2019-12", freq="M"))
    st = _store(tmp_path, months)
    br = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")["by_regime"]
    g = next(x for x in br["regimes"] if x["regime"] == "Stagflation")
    days = hs.sessions()
    first = sum(1 for d in days if "2015-01" <= d[:7] <= "2015-06")
    jan, mar = (sum(1 for d in days if d.startswith(m)) for m in ("2020-01", "2020-03"))
    assert g["n"] == first + jan + mar
    assert g["spells"] == 3  # 2015-01..06, 2020-01, 2020-03 (2020-02 has no row)
    assert g["largest_spell_share"] == pytest.approx(first / g["n"], abs=1e-15)


def test_the_current_regime_is_the_row_governing_the_end_session(tmp_path):
    """§4: the store ends 2026-09-18, governed by the row stamped 2026-07; rows that
    end at 2026-06 leave the end session Unlabeled, so `current` is null."""
    months = _cycling()
    st = _store(tmp_path, months)
    br = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")["by_regime"]
    assert (br["current"], br["current_row"]) == (months[pd.Period("2026-07", freq="M")], "2026-07")
    (tmp_path / "x").mkdir()
    st2 = _store(tmp_path / "x", _cycling(end="2026-06"))
    br2 = next(r for r in etf.correlations(st2, True) if r["symbol"] == "TLT")["by_regime"]
    assert br2["current"] is None and br2["current_row"] is None


def test_no_regime_rows_says_so_and_serves_no_regime_value(tmp_path):
    st = _store(tmp_path, None)
    br = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")["by_regime"]
    assert br["reason"] == "no regime history is stored in this database"
    assert br["regimes"] == [] and br["all"] is None and br["current"] is None
    assert br["regime_history"] == "revised" and br["as_known"] is None


def test_a_row_without_data_carries_no_views(tmp_path):
    """A row the store cannot compute keeps its reason; its views are null, never zero."""
    st = _store(tmp_path, _cycling(), only=tuple(s for s in hs.ETFS if s != "UUP"))
    row = next(r for r in etf.correlations(st, True) if r["symbol"] == "UUP")
    assert row["corr"] is None and row["reason"].startswith("Awaiting refresh")
    assert row["by_horizon"] is None and row["by_regime"] is None


def test_the_item_reads_the_stored_regimes(tmp_path, monkeypatch):
    """desk_etf loads the regimes table on its connection (event_study.load_regimes) and
    tolerates a database without one."""
    from api import db
    from tests.test_event_study import _synthetic_db

    path = hs.add_etfs(_synthetic_db(tmp_path / "macro_radar.db"))
    monkeypatch.setattr(db, "DB_PATH", path)
    conn = sqlite3.connect(path)
    try:
        assert etf._regimes(conn).equals(es.load_regimes(conn))
        conn.execute("DROP TABLE regimes")
        assert etf._regimes(conn) is None
    finally:
        conn.close()


# ── the published copy ──────────────────────────────────────────────────────

DB = Path(os.environ.get("DESK_DB", Path(__file__).resolve().parents[1] / "data" / "macro_radar.db"))


@pytest.mark.skipif(not DB.exists() or DB.stat().st_size == 0, reason="needs the published database copy (data/macro_radar.db)")
def test_on_the_published_copy_the_views_hold_their_rules():
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        cutoff = es.resolve_as_of(None, DB)
        st = etf.Store(conn, KEYS, cutoff)
        st.regimes = etf._regimes(conn)
        months = es.load_regimes(conn)
    finally:
        conn.close()
    if not st.has("spy") or not st.has("tlt"):
        pytest.skip("this copy predates the ETFs")
    sb = etf.stock_bond(st, True)
    assert {k: sb["by_horizon"]["60"][k] for k in ("today", "series", "window")} == {k: sb[k] for k in ("today", "series", "window")}
    rows = etf.correlations(st, True)
    for r in rows:
        if r["by_horizon"] is None:
            continue
        assert r["by_horizon"]["60"]["corr"] == r["corr"]
        br = r["by_regime"]
        assert sum(g["n"] for g in br["regimes"]) == br["all"]["n"]
        end = pd.Timestamp(r["date"])
        gov = pd.Period(year=end.year, month=end.month, freq="M") - 2
        assert br["current"] == (months.get(gov) if gov in months.index else None)
        assert br["current_row"] == (str(gov) if gov in months.index else None)
    want = _expected_regime(st, months, "spy", "tlt")
    br = next(r for r in rows if r["symbol"] == "TLT")["by_regime"]
    for g in br["regimes"]:
        n, r, *_ = want["by"].get(g["regime"], (0, None))
        assert g["n"] == n
        assert (g["corr"] is None and r is None) or g["corr"] == pytest.approx(r, abs=1e-12)
    mx = etf.matrix(st, True)
    assert mx["by_horizon"]["60"]["values"] == mx["values"]


def test_a_row_without_a_common_return_keeps_the_by_regime_shape_with_its_reason(tmp_path):
    """§4 empty samples: TLT holds one close, on the last session, so the row has an end
    session and no daily return: by_regime keeps its keys, with the reason and nulls."""
    days = hs.sessions()
    st = _store(tmp_path, _cycling(), starts={"TLT": days[-1]})
    row = next(r for r in etf.correlations(st, True) if r["symbol"] == "TLT")
    assert row["date"] == days[-1] and row["corr"] is None
    br = row["by_regime"]
    assert br["reason"] == f"no daily return both series hold through {days[-1]}"
    assert (br["regimes"], br["all"], br["current"], br["current_row"], br["sample"]) == ([], None, None, None, None)
    assert (br["unlabeled_n"], br["incomplete_n"]) == (None, None)
    assert all(h["corr"] is None and h["reason"].startswith("fewer than") for h in row["by_horizon"].values())
