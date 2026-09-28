"""tests/test_desk_v2_regime.py — GET /api/desk/regime (desk/frame-3-api-b2a).

DESK_FRAME3_SPEC §12.6 and docs/desk/FRAME3_API_PLAN.md §7 commit 7: the
`desk_regime` item (stored rows, N5 recession provenance, N6 next-print
thresholds), rules R4, R8 and R9, and the route in the §12.0 envelope.

Every route test runs on the hermetic store (tests/desk_macro_store.py), served
by a worker that builds only the items the route reads, so none skips; the
shape is also checked on the scratch and published copies when present. N6 is
checked against the real classifier (src/regime.py, imported with
FRED_API_KEY set), never against a copy of its arithmetic.
"""

from __future__ import annotations

import ast
import json
import os
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from tests import desk_contract as contract
from tests import desk_macro_store as store
from api import analytics_cache as ac
from api import db
from api import desk_envelope as env
from api import desk_items_macro as items
from api import desk_v2_macro as v2m
from api.main import app

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path(os.environ.get("DESK_DB", ROOT / "data" / "desk_scratch.db"))
PUBLISHED = ROOT / "data" / "macro_radar.db"
client = TestClient(app)
REGIME_ITEMS = ("recession", "desk_regime")
AWAITING_REFRESH = "Awaiting refresh: this could not be computed from the current data."


def _items(*names: str) -> list:
    return [(n, f) for n, f in ac.ITEMS if n in names]


def serve(install_worker, monkeypatch, path: Path, names=REGIME_ITEMS, **kw):
    """A worker serving `path`, building only `names`."""
    from api import worker as worker_mod

    monkeypatch.setattr(db, "DB_PATH", path)
    db.reset_connections_for_tests()
    w = install_worker(worker_mod.AnalyticsWorker(_items(*names), poll_s=0.05, **kw))
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    return w


def at(monkeypatch, when: datetime) -> None:
    monkeypatch.setattr(v2m, "_now", lambda: when)


@pytest.fixture()
def hermetic(tmp_path, install_worker, monkeypatch):
    path = store.build(tmp_path / "macro_radar.db")
    return serve(install_worker, monkeypatch, path)


def get_regime() -> dict:
    return contract.check_response("/regime", client.get("/api/desk/regime"))


# ── The route: shape, blocks, K−2 ───────────────────────────────────────────

def test_regime_shape(hermetic, monkeypatch):
    at(monkeypatch, datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc))
    body = get_regime()
    assert body["status"] == "ready"
    d = body["data"]
    for k in ("stats", "changes"):  # the hermetic store holds no S&P closes: the S-27 sentence (desk/fill-compute)
        assert d[k] == {"status": "awaiting", "data": None,
                        "unavailable": {"reason": "Awaiting refresh: this could not be computed from the current data.", "until": None}}
    months = [h["month"] for h in d["history"]]
    assert len(months) == 60 and months == sorted(months) and months[-1] == store.END_MONTH
    assert d["current"]["status"] == d["recession"]["status"] == d["next_prints"]["status"] == "ready"
    assert d["history_note"] == "labels as stored; revisions are not replayed."


def test_current_is_the_k_minus_2_row_and_moves_at_a_month_boundary_inside_one_generation(hermetic, monkeypatch):
    """R8 and plan §0.5: `print` is K−2 for the comparison session's month,
    recomputed per response, so it moves at a month boundary with no new
    generation; `latest_print` stays the newest stored row."""
    rows = {r["month"]: r for r in hermetic.current.results["desk_regime"]["rows"]}
    at(monkeypatch, datetime(2026, 9, 30, 21, 0, tzinfo=timezone.utc))  # Wed 17:00 ET: 2026-09-30 is complete
    a = get_regime()
    at(monkeypatch, datetime(2026, 10, 1, 13, 0, tzinfo=timezone.utc))   # Thu 09:00 ET: still 2026-09-30
    b = get_regime()
    at(monkeypatch, datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc))  # Thu 16:30 ET: 2026-10-01 is complete
    c = get_regime()
    assert a["generation_id"] == b["generation_id"] == c["generation_id"]
    for body, month in ((a, "2026-07"), (b, "2026-07"), (c, "2026-08")):
        cur = body["data"]["current"]["data"]
        assert cur["print"] == month and cur["label"] == rows[month]["label"]
        assert (cur["growth"], cur["inflation"]) == (items.direction(rows[month]["growth_trend"]),
                                                     items.direction(rows[month]["inflation_trend"]))
        assert cur["latest_print"] == store.END_MONTH


def test_a_missing_k_minus_2_row_leaves_current_and_the_next_prints_awaiting_and_the_rest_served(tmp_path, install_worker, monkeypatch):
    """desk/fill-compute: the next prints are read from the K−2 row too, so without it both cards await together."""
    path = store.build(tmp_path / "macro_radar.db")
    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM regimes WHERE date = '2026-07-01'")
    conn.commit()
    conn.close()
    serve(install_worker, monkeypatch, path)
    at(monkeypatch, datetime(2026, 9, 25, 21, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    assert d["current"] == {"status": "awaiting", "data": None, "unavailable": {"reason": AWAITING_REFRESH, "until": None}}
    assert d["next_prints"] == d["current"]
    assert d["recession"]["status"] == "ready"
    assert "2026-07" not in [h["month"] for h in d["history"]]


def test_without_a_recession_result_the_recession_block_is_awaiting(tmp_path, install_worker, monkeypatch):
    """A composite route's block whose stored input is absent (plan §3)."""
    serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"), names=("desk_regime",))
    d = get_regime()["data"]
    assert d["recession"] == {"status": "awaiting", "data": None, "unavailable": {"reason": AWAITING_REFRESH, "until": None}}
    assert d["current"]["status"] == "ready"


def test_a_recession_block_that_fails_leaves_the_rows_served(tmp_path, install_worker, monkeypatch):
    """desk/frame-3-api's rule, kept through the merge: a recession provenance
    that cannot be built leaves the regime rows served; /regime's recession
    block and /overview's recession tile both read awaiting (S-27)."""
    from src.analytics import recession

    def broken():
        raise RuntimeError("the provenance could not be built")

    monkeypatch.setattr(recession, "recession_provenance", broken)
    w = serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"))
    item = w.current.results["desk_regime"]
    assert item["rows"] and item["recession"] == {"ok": False, "reason": AWAITING_REFRESH}
    at(monkeypatch, datetime(2026, 9, 25, 21, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    assert d["recession"]["status"] == "awaiting" and d["current"]["status"] == "ready"
    from api import desk_v2

    with pytest.raises(env.Awaiting) as exc:
        desk_v2.recession_tile(item)
    assert exc.value.reason == AWAITING_REFRESH


def test_an_empty_regimes_table_serves_an_empty_history_and_awaiting_blocks(tmp_path, install_worker, monkeypatch):
    serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db", regimes=False))
    d = get_regime()["data"]
    assert d["history"] == []
    assert d["current"]["status"] == d["next_prints"]["status"] == "awaiting"


def test_before_the_first_generation_the_route_answers_computing(install_worker, monkeypatch, tmp_path):
    """S-11: 202 `computing`, Retry-After: 2, no generation named."""
    import threading

    from api import worker as worker_mod

    monkeypatch.setattr(db, "DB_PATH", store.build(tmp_path / "macro_radar.db"))
    gate = threading.Event()  # never opened: the first generation never publishes
    w = install_worker(worker_mod.AnalyticsWorker(_items(*REGIME_ITEMS), poll_s=0.05, wait_s=0.2, build_gate=gate))
    w.start(serving=True)
    r = client.get("/api/desk/regime")
    body = contract.check_response("/regime", r)
    assert r.status_code == 202 and body["status"] == "computing" and body["generation_id"] is None
    gate.set()


def test_a_failed_item_is_a_500_in_the_envelope(tmp_path, install_worker, monkeypatch):
    """A whole-route item that failed answers `internal`, never a stack."""
    w = serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"))
    w.current.results.pop("desk_regime")
    w.current.errors["desk_regime"] = RuntimeError("boom at /secret/path")
    r = client.get("/api/desk/regime")
    body = contract.check_response("/regime", r)
    assert r.status_code == 500 and body["error"]["code"] == "internal" and "secret" not in r.text


def test_a_failed_schema_read_is_the_routes_503(tmp_path, install_worker, monkeypatch):
    """Plan §3: hardening's SchemaCheckFailed, stored as the item's error,
    answers 503 `schema_check` with `retryable` and `provider` in `error`."""
    from api import provenance

    w = serve(install_worker, monkeypatch, store.build(tmp_path / "macro_radar.db"))
    w.current.results.pop("desk_regime")
    w.current.errors["desk_regime"] = provenance.SchemaCheckFailed("could not read whether the regimes table exists")
    r = client.get("/api/desk/regime")
    body = contract.check_response("/regime", r)
    assert r.status_code == 503
    assert body["error"] == {"code": "schema_check", "message": "could not read whether the regimes table exists",
                             "retryable": True, "provider": "api"}


# ── R8, R9 ──────────────────────────────────────────────────────────────────

def test_the_k_minus_2_rule_is_the_engines():
    """R8: the mirrored lag is the engine's, and print_for is regime_at's
    month arithmetic for every day of three years."""
    from src.desk import event_study as es

    assert v2m.REGIME_LAG_MONTHS == es.REGIME_LAG_MONTHS
    days = pd.date_range("2024-01-01", "2026-12-31", freq="D")
    months = pd.Series([f"L{p}" for p in pd.period_range("2023-01", "2026-12", freq="M")],
                       index=pd.period_range("2023-01", "2026-12", freq="M"))
    labels = es.regime_at(pd.DatetimeIndex(days), months)
    for d, label in zip(days, labels):
        assert label == f"L{v2m.print_for(d.date())}", d


def test_the_run_ends_at_a_missing_month_and_at_a_change():
    """R9 (S-14): consecutive months only; a missing month is never bridged."""
    rows = [{"month": m, "label": l} for m, l in (("2025-07", "A"), ("2025-08", "B"), ("2025-09", "B"),
                                                   ("2025-11", "B"), ("2025-12", "B"), ("2026-01", "B"))]
    assert v2m.run_ending_at(rows, "2026-01") == (3, "2025-11")
    assert v2m.run_ending_at(rows, "2025-09") == (2, "2025-08")
    assert v2m.run_ending_at(rows, "2025-07") == (1, "2025-07")


def test_months_in_and_since_on_the_route(hermetic, monkeypatch):
    rows = hermetic.current.results["desk_regime"]["rows"]
    at(monkeypatch, datetime(2026, 9, 25, 21, 0, tzinfo=timezone.utc))
    cur = get_regime()["data"]["current"]["data"]
    by = {r["month"]: r["label"] for r in rows}
    n, m = 0, cur["print"]
    while by.get(m) == cur["label"]:
        n, m = n + 1, v2m.months_before(m, 1)
    assert (cur["months_in"], cur["since"]) == (n, v2m.months_before(m, -1))


# ── R4 and the recession block (N5) ─────────────────────────────────────────

def test_the_recession_band_is_the_models_classification():
    """R4: the served band and _classify_prob draw their lines at the same
    place (the model's percent, the served fraction)."""
    from src.analytics.recession import _classify_prob

    word = {"Low Risk": "low", "Elevated": "elevated", "High Risk": "high_risk"}
    for p in (0.0, 5.0, 19.99, 19.999999999, 20.0, 20.000001, 30.0, 39.99, 40.0, 40.01, 75.0, 100.0):
        assert items.recession_band(p / 100.0) == word[_classify_prob(p)[0]], p
    assert list(items.RECESSION_BAND_EDGES) == [0.20, 0.40]


def test_the_provenance_dates_the_served_score(tmp_path, monkeypatch):
    """N5 parity: the extraction's scoring index is the served series' dates,
    its probability month is the last point's, inputs run three feature rows
    behind, and training spans the rows the model fits."""
    from src.analytics import recession

    path = store.build(tmp_path / "macro_radar.db")
    monkeypatch.setattr(recession, "DB_PATH", path)
    metrics = recession.get_recession_metrics()
    prov = recession.recession_provenance()
    served = [d.strftime("%Y-%m-%d") for d in metrics["recession_prob_series"].index]
    assert prov["scoring_index"] == served and served
    assert prov["probability_month"] == served[-1][:7]
    conn = recession._get_conn()
    try:
        feats, usrec, _ = recession._build_feature_frame(conn)
    finally:
        conn.close()
    pos = feats.index.get_loc(pd.Timestamp(served[-1]))
    assert prov["inputs_through"] == feats.index[pos - 3].strftime("%Y-%m")
    assert set(prov["feature_months"]) == set(recession.FEATURE_NAMES)
    assert set(prov["feature_months"].values()) == {prov["inputs_through"]}
    model, scaler, _ = recession.train_recession_model()
    fitted = pd.concat([feats[recession.FEATURE_NAMES].shift(3), usrec.rename("usrec")], axis=1).dropna()
    assert len(fitted) == scaler.n_samples_seen_
    assert prov["training"] == {"start": fitted.index[0].strftime("%Y-%m"), "end": fitted.index[-1].strftime("%Y-%m")}


def test_the_recession_block_reads_the_served_series(hermetic, monkeypatch):
    rec = hermetic.current.results["recession"]
    points = rec["recession_prob_series"]
    data = get_regime()["data"]["recession"]["data"]
    assert data["score"] == rec["recession_prob"] / 100.0
    assert data["probability_month"] == points[-1]["date"][:7]
    assert data["band"] == items.recession_band(data["score"]) and data["band_edges"] == [0.2, 0.4]
    ago = v2m.months_before(data["probability_month"], 12)
    want = next(p for p in points if p["date"][:7] == ago)
    assert data["year_ago"] == {"score": want["value"] / 100.0, "probability_month": ago}
    since = [p for p in points if p["date"] >= "2015-01-01"]
    top = max(p["value"] for p in since)
    first = next(p for p in since if p["value"] == top)
    assert data["peak"] == {"score": top / 100.0, "probability_month": first["date"][:7], "window": "since 2015"}
    assert data["methodology"] == "in-sample fitted scores"
    assert data["source"] == "recession model (src/analytics/recession.py)"


def test_a_year_ago_month_the_series_lacks_is_null():
    ctx = {"recession": {"recession_prob": 30.0, "recession_prob_series": [
        {"date": "2016-01-31", "value": 10.0}, {"date": "2020-05-31", "value": 90.0},
        {"date": "2021-03-31", "value": 90.0}, {"date": "2026-08-31", "value": 30.0}]}}
    prov = {"probability_month": "2026-08", "inputs_through": "2026-05", "feature_months": {},
            "training": {"start": "2003-04", "end": "2026-09"},
            "scoring_index": ["2016-01-31", "2020-05-31", "2021-03-31", "2026-08-31"]}
    from src.analytics import recession

    orig = recession.recession_provenance
    recession.recession_provenance = lambda: prov
    try:
        data = items.recession_block(ctx)
    finally:
        recession.recession_provenance = orig
    assert data["year_ago"] is None
    assert data["peak"] == {"score": 0.9, "probability_month": "2020-05", "window": "since 2015"}  # earliest on ties
    assert data["band"] == "elevated"


def test_a_provenance_that_dates_another_series_is_never_served():
    ctx = {"recession": {"recession_prob": 30.0, "recession_prob_series": [{"date": "2026-08-31", "value": 30.0}]}}
    from src.analytics import recession

    orig = recession.recession_provenance
    recession.recession_provenance = lambda: {"probability_month": "2026-07", "inputs_through": "2026-04",
                                              "feature_months": {}, "training": {"start": "2003-04", "end": "2026-09"},
                                              "scoring_index": ["2026-07-31"]}
    try:
        stored = items.part("recession", lambda: items.recession_block(ctx))
    finally:
        recession.recession_provenance = orig
    assert stored == {"ok": False, "reason": AWAITING_REFRESH}


# ── N6: the next-print thresholds, against the real classifier ──────────────

@pytest.fixture()
def classifier(monkeypatch):
    """The real classifier (src/regime.py), imported with FRED_API_KEY set.
    src.config would load the repo's .env into the process: that is switched
    off, and the modules this import adds are dropped afterwards."""
    import dotenv

    monkeypatch.setenv("FRED_API_KEY", os.environ.get("FRED_API_KEY") or "oracle-test")
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: False)
    added = [m for m in ("src.config", "src.utils.db", "src.regime") if m not in sys.modules]
    import src.regime as regime

    yield regime
    for m in added:
        sys.modules.pop(m, None)


def _levels(start: float, steps: list[float]) -> list[float]:
    out = [start]
    for s in steps:
        out.append(out[-1] * (1.0 + s))
    return out


# the last row's own-axis sign: rising, or falling (both series, both states)
UP = [0.004, 0.003, 0.005, 0.002, 0.004, 0.003]
DOWN = [-0.004, -0.003, -0.005, -0.002, -0.004, -0.003]


def _oracle_store(tmp_path: Path, regime, growth: list[float], inflation: list[float], *, cpi_gap: str | None = None,
                  extra: dict | None = None) -> Path:
    """raw_series and regimes as the pipeline stores them, the rows classified
    by the real classifier over the joint frame."""
    months = pd.date_range("2026-02-01", periods=len(growth), freq="MS")
    g, i = pd.Series(growth, index=months), pd.Series(inflation, index=months)
    if cpi_gap:
        i = i.drop(pd.Timestamp(cpi_gap))
    path = tmp_path / "oracle.db"
    conn = sqlite3.connect(path)
    conn.execute(store.RAW_DDL)
    conn.execute(store.REGIMES_DDL)
    store.write_raw(conn, "INDPRO", g)
    store.write_raw(conn, "CPIAUCSL", i)
    for sid, s in (extra or {}).items():
        store.write_raw(conn, sid, s)
    df = regime.run_regime_classification({"growth": g, "inflation": i})
    conn.executemany("INSERT INTO regimes (date, label, confidence, growth_trend, inflation_trend, computed_at) VALUES (?,?,?,?,?,?)",
                     [(r.date, r.label, 0.5, r.growth_trend, r.inflation_trend, "t") for r in df.itertuples()])
    conn.commit()
    conn.close()
    return path


def _next(path: Path, basis: str | None = None) -> tuple[dict, list[dict]]:
    """N6 read from `basis` (default the newest stored row)."""
    conn = sqlite3.connect(path)
    try:
        rows = items.regime_rows(conn)
        return items.next_prints(conn, rows)["by_basis"][basis or rows[-1]["month"]], rows
    finally:
        conn.close()


def _label_with(regime, path: Path, axis: str, value: float, latest: dict) -> str:
    """Append month m+1 to the joint frame: `value` for the axis under test,
    and for the other axis a value that keeps its latest sign; reclassify."""
    conn = sqlite3.connect(path)
    try:
        from src.analytics.recession import _load_raw

        joint = pd.DataFrame({"growth": _load_raw("INDPRO", conn), "inflation": _load_raw("CPIAUCSL", conn)}).dropna()
    finally:
        conn.close()
    other = "growth" if axis == "inflation" else "inflation"
    nxt = joint.index[-1] + pd.offsets.MonthBegin(1)
    prev_other = joint[other].iloc[-2]
    keep = prev_other * (1.05 if items.direction(latest[f"{other}_trend"]) == "rising" else 0.95)
    joint.loc[nxt] = {axis: value, other: keep}
    g = regime.compute_trends(joint["growth"]).iloc[-1]
    i = regime.compute_trends(joint["inflation"]).iloc[-1]
    return regime.classify_regime(g, i)


CASES = [  # (key, axis, growth path, inflation path)
    ("cpi", "inflation", UP, UP),       # inflation rising → operator <=
    ("cpi", "inflation", DOWN, DOWN),   # inflation falling → operator >
    ("indpro", "growth", UP, DOWN),     # growth rising → operator <=
    ("indpro", "growth", DOWN, UP),     # growth falling → operator >
]


@pytest.mark.parametrize("key,axis,gsteps,isteps", CASES)
def test_next_print_threshold_is_the_classifiers_boundary(tmp_path, classifier, key, axis, gsteps, isteps):
    """N6 oracle. Exact at x_prev (a zero slope is falling, so equality sits on
    the `<=` side); the inverse reconstructs x_prev; and 1e-4 either side of
    the boundary lands on flips_to on the operator's side and on the unchanged
    label on the other."""
    path = _oracle_store(tmp_path, classifier, _levels(100.0, gsteps), _levels(250.0, isteps))
    np_, rows = _next(path)
    latest = rows[-1]
    p = np_[key]
    sid = "CPIAUCSL" if key == "cpi" else "INDPRO"
    rising = items.direction(latest[f"{axis}_trend"]) == "rising"
    assert p["operator"] == ("<=" if rising else ">")
    unchanged = latest["label"]
    assert p["flips_to"] != unchanged
    conn = sqlite3.connect(path)
    try:
        from src.analytics.recession import _load_raw

        s = _load_raw(sid, conn)
    finally:
        conn.close()
    x_m, x_prev = float(s.iloc[-1]), float(s.iloc[-2])
    assert p["threshold_mom"] == x_prev / x_m - 1.0
    assert x_m * (1.0 + p["threshold_mom"]) == pytest.approx(x_prev, rel=1e-12)
    # exact equality: the appended level is x_prev itself, a zero slope
    at_eq = _label_with(classifier, path, axis, x_prev, latest)
    assert at_eq == (p["flips_to"] if rising else unchanged)
    eps = 1e-4
    selected = x_prev * (1 - eps) if p["operator"] == "<=" else x_prev * (1 + eps)
    opposite = x_prev * (1 + eps) if p["operator"] == "<=" else x_prev * (1 - eps)
    assert _label_with(classifier, path, axis, selected, latest) == p["flips_to"]
    assert _label_with(classifier, path, axis, opposite, latest) == unchanged
    assert p["reference_month"] == v2m.months_before(latest["month"], -1)
    assert p["first_effective_month"] == v2m.months_before(latest["month"], -3)
    assert (p["series"], p["source"], p["freq"]) == (sid, sid, "monthly")


def test_x_prev_is_the_joint_row_before_m_across_a_month_one_series_skipped(tmp_path, classifier):
    """S-13: CPI has no print for the month before m (as 2025-10), so the
    joint frame's row before m is m−2, and the oracle agrees."""
    growth, infl = _levels(100.0, UP), _levels(250.0, UP)
    months = pd.date_range("2026-02-01", periods=len(growth), freq="MS")
    gap = months[-2].strftime("%Y-%m-%d")
    path = _oracle_store(tmp_path, classifier, growth, infl, cpi_gap=gap)
    np_, rows = _next(path)
    p, latest = np_["cpi"], rows[-1]
    x_m, x_prev = infl[-1], infl[-3]
    assert p["threshold_mom"] == x_prev / x_m - 1.0
    selected = x_prev * (1 - 1e-4) if p["operator"] == "<=" else x_prev * (1 + 1e-4)
    assert _label_with(classifier, path, "inflation", selected, latest) == p["flips_to"]


def test_a_series_that_already_printed_the_next_month_is_not_evaluable(tmp_path, classifier):
    """S-13: CPI has printed m+1 (INDPRO has not), so the next row waits on
    INDPRO: CPI's threshold and flips_to are null, INDPRO's are served."""
    growth, infl = _levels(100.0, UP), _levels(250.0, UP)
    months = pd.date_range("2026-02-01", periods=len(growth), freq="MS")
    extra_cpi = pd.Series([infl[-1] * 1.001], index=[months[-1] + pd.offsets.MonthBegin(1)])
    path = _oracle_store(tmp_path, classifier, growth, infl, extra={"CPIAUCSL": extra_cpi})
    np_, rows = _next(path)
    assert np_["cpi"]["threshold_mom"] is None and np_["cpi"]["flips_to"] is None
    assert np_["cpi"]["operator"] in ("<=", ">") and np_["cpi"]["reference_month"] == v2m.months_before(rows[-1]["month"], -1)
    assert np_["indpro"]["threshold_mom"] is not None and np_["indpro"]["flips_to"] is not None
    # Codex R-06: CPI's m+1 print is out, so INDPRO's flip reads it, not the basis row's sign
    assert np_["indpro"]["other"]["status"] == "published" and np_["cpi"]["other"]["status"] == "assumed"


def test_codex_r06_a_flip_uses_the_other_axis_already_published_for_that_month(tmp_path, classifier):
    """Codex R-06: the flip a print would cause was the label with the other axis
    held at the basis row's sign, even when the other series had already printed
    that month the other way. Here growth and inflation rise through m; INDPRO's
    m+1 print is out and turns growth falling; CPI's is not. A CPI print across
    its threshold gives Recession Risk (growth falling, inflation falling), not
    Goldilocks, and the real classifier agrees."""
    growth, infl = _levels(100.0, UP), _levels(250.0, UP)
    months = pd.date_range("2026-02-01", periods=len(growth), freq="MS")
    nxt = months[-1] + pd.offsets.MonthBegin(1)
    g_next = growth[-2] * 0.99  # below the joint row before m: growth falling at m+1
    path = _oracle_store(tmp_path, classifier, growth, infl, extra={"INDPRO": pd.Series([g_next], index=[nxt])})
    np_, rows = _next(path)
    latest, cpi = rows[-1], np_["cpi"]
    assert latest["label"] == "Overheating" and cpi["operator"] == "<="
    assert cpi["other"] == {"axis": "growth", "series": "INDPRO", "reference_month": nxt.strftime("%Y-%m"),
                            "direction": "falling", "status": "published"}
    assert cpi["flips_to"] == "Recession Risk"
    joint = pd.DataFrame({"growth": pd.Series(growth + [g_next], index=list(months) + [nxt]),
                          "inflation": pd.Series(infl + [infl[-2] * (1 - 1e-4)], index=list(months) + [nxt])})
    got = classifier.classify_regime(classifier.compute_trends(joint["growth"]).iloc[-1],
                                     classifier.compute_trends(joint["inflation"]).iloc[-1])
    assert got == cpi["flips_to"]
    # unpublished, the same flip is qualified as an assumption: growth kept rising, so Goldilocks
    plain = tmp_path / "plain"
    plain.mkdir()
    np0, _ = _next(_oracle_store(plain, classifier, growth, infl))
    assert np0["cpi"]["other"]["status"] == "assumed" and np0["cpi"]["flips_to"] == "Goldilocks"


def test_the_mirrors_are_the_classifiers():
    """api/ cannot import src.regime (src.config needs FRED_API_KEY): the
    window and the table are mirrors, AST-read from the source."""
    cfg = ast.parse((ROOT / "src" / "config.py").read_text())
    window = next(ast.literal_eval(n.value) for n in cfg.body if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == "ROLLING_WINDOW" for t in n.targets))
    assert items.REGIME_WINDOW == window == 3
    reg = ast.parse((ROOT / "src" / "regime.py").read_text())
    table = next(ast.literal_eval(n.value) for n in reg.body if isinstance(n, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == "REGIMES" for t in n.targets))
    assert items.REGIME_TABLE == table


# ── The release date (per response) ─────────────────────────────────────────

def test_codex_r05_each_release_date_is_its_own_reference_months(hermetic, monkeypatch):
    """Codex R-05: the release date was the first stored release after "now",
    whatever month it covered, beside a threshold for a different month. The
    hermetic store's newest row is August; the next CPI print is September's,
    released in October: on Sep 5 the next stored release is Sep 11 (August's
    print), and after Oct 14 12:30 it is Nov 10 (October's); neither is
    September's. Each upcoming print now carries its own month's release, and
    whether it is out."""
    cases = ((datetime(2026, 9, 5, 15, 0, tzinfo=timezone.utc), False),
             (datetime(2026, 10, 14, 12, 29, tzinfo=timezone.utc), False),
             (datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc), True))
    for now, out in cases:
        at(monkeypatch, now)
        d = get_regime()["data"]["next_prints"]["data"]
        assert d["upcoming_from"]["month"] == "2026-08"
        assert (d["cpi"]["reference_month"], d["cpi"]["release_date"], d["cpi"]["released"]) == ("2026-09", "2026-10-14", out), now
        assert (d["indpro"]["release_date"], d["indpro"]["released"]) == (None, None)
    # on Sep 5 the page shows the July row: the August row is already published, apart from the upcoming prints
    at(monkeypatch, datetime(2026, 9, 5, 15, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]["next_prints"]["data"]
    assert d["basis"]["month"] == "2026-07" and [r["month"] for r in d["published"]] == ["2026-08"]
    assert d["published"][0]["cpi"]["reference_month"] == "2026-08"
    # past the last stored release: none (and in Feb 2027 the K−2 row is not stored, so the block awaits with `current`)
    at(monkeypatch, datetime(2027, 2, 1, 15, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    assert d["next_prints"]["status"] == d["current"]["status"] == "awaiting"


def test_release_for_binds_a_reference_month_to_its_release_in_new_york_dates():
    times = ["2026-09-11T12:30:00Z", "2026-10-15T03:30:00Z", "2026-11-10 13:30:00", "not a time"]
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert v2m.release_for(times, "2026-09", now) == ("2026-10-14", False)  # 03:30 UTC Oct 15 is Oct 14 in New York
    assert v2m.release_for(times, "2026-08", now) == ("2026-09-11", True)
    assert v2m.release_for(times, "2026-10", now) == ("2026-11-10", False)
    assert v2m.release_for(times, "2026-12", now) == (None, None)


# ── Real stores ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [SCRATCH, PUBLISHED], ids=["scratch", "published"])
def test_regime_shape_on_a_real_store(path, install_worker, monkeypatch):
    if not path.exists() or path.stat().st_size == 0:
        pytest.skip(f"{path.name} is not in this tree")
    serve(install_worker, monkeypatch, path)
    at(monkeypatch, datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc))
    body = get_regime()
    d = body["data"]
    if d["current"]["status"] == "ready":
        assert d["current"]["data"]["print"] == "2026-07"
    if d["next_prints"]["status"] == "ready":
        assert d["next_prints"]["data"]["basis"]["month"] == d["current"]["data"]["print"]
        for k in ("cpi", "indpro"):
            p = d["next_prints"]["data"][k]
            if p is not None and p["threshold_mom"] is not None:
                assert -0.5 < p["threshold_mom"] < 0.5


# ── Connections to the generation's copy (plan §5, verifier V-51, V-54) ─────

_FAILING_BUILD = r'''
import faulthandler, gc, json, os, sqlite3, sys, threading


def main():
    root, store_path, names = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
    sys.path.insert(0, root)
    from pathlib import Path

    from api import analytics_cache as ac
    from api import db
    from api import worker as worker_mod
    from src.analytics import dbpath

    faulthandler.dump_traceback_later(120, exit=True)
    gc.disable()  # a connection left for the collector stays until the passes below
    opened: list = []
    real = dbpath.connect_ro

    class FailsMidway:
        """A real connection to the copy whose reads fail once it is open."""

        def __init__(self, conn):
            self._conn = conn

        def execute(self, *args, **kwargs):
            raise sqlite3.OperationalError("forced failure mid-build")

        def close(self):
            self._conn.close()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    def failing(path):
        conn = real(path)
        opened.append(conn)
        return FailsMidway(conn)

    dbpath.connect_ro = failing
    db.DB_PATH = Path(store_path)
    w = worker_mod.AnalyticsWorker([(n, f) for n, f in ac.ITEMS if n in names], poll_s=0.05)
    worker_mod._worker = w
    w.start(serving=True)
    assert w.wait_published(timeout=180)
    served = dbpath.generation_for(db.DB_PATH)

    def is_open(conn):
        try:
            conn.in_transaction
            return True
        except sqlite3.ProgrammingError:
            return False

    left_open = sum(1 for c in opened if is_open(c))
    del opened[:]  # the list itself must not keep a connection alive below

    def bounded(fn, what, timeout=30):
        box = {}

        def run():
            try:
                box["value"] = fn()
            except BaseException as exc:
                box["error"] = repr(exc)

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            print("RESULT " + json.dumps({"hung": what, "left_open": left_open}), flush=True)
            faulthandler.dump_traceback(all_threads=True)
            os._exit(3)
        if "error" in box:
            raise RuntimeError(what + ": " + box["error"])
        return box.get("value")

    gc.collect()

    def fresh_reader():  # a new thread, a new connection, after the collection
        return db._connect().execute("SELECT COUNT(*) FROM regimes").fetchone()[0]

    fresh = bounded(fresh_reader, "a fresh reader after the collection", timeout=10)
    faulthandler.cancel_dump_traceback_later()
    errors = {n: type(e).__name__ for n, e in w.current.errors.items()}
    print("RESULT " + json.dumps({"left_open": left_open, "fresh": fresh, "errors": errors,
                                  "results": sorted(w.current.results)}), flush=True)
    w.stop()
    os._exit(0)


if __name__ == "__main__":
    main()
'''


def run_failing_build(tmp_path: Path, names: tuple[str, ...]) -> dict:
    """plan §5 test 1: every connection a Desk item opens to the copy fails once
    open; after the build none is left open, and a fresh reader reads."""
    path = store.build(tmp_path / "macro_radar.db")
    script = tmp_path / "failing_build.py"
    script.write_text(_FAILING_BUILD)
    env_ = {**os.environ, "EODHD_PROBE_ON_START": "0", "ASSISTANT_ACCESS": "off", "PREFETCH_MARKET": "0"}
    try:
        proc = subprocess.run([sys.executable, str(script), str(ROOT), str(path), ",".join(names)],
                              capture_output=True, text=True, timeout=300, env=env_, cwd=ROOT)
    except subprocess.TimeoutExpired as exc:
        pytest.fail(f"the build did not finish in 300 s: {(exc.stdout or '')[-2000:]}")
    assert "Timeout (" not in proc.stderr, proc.stderr[-6000:]
    lines = [line for line in proc.stdout.splitlines() if line.startswith("RESULT ")]
    assert lines, (proc.returncode, proc.stdout[-2000:], proc.stderr[-4000:])
    res = json.loads(lines[-1][len("RESULT "):])
    assert "hung" not in res and proc.returncode == 0, (res, proc.stderr[-4000:])
    return res


def test_a_desk_regime_build_that_fails_midway_leaves_no_connection_to_the_copy(tmp_path):
    res = run_failing_build(tmp_path, ("recession", "desk_regime"))
    assert res["left_open"] == 0 and res["fresh"] > 0, res
    # the regimes read fails its schema check: a fact about the whole item
    assert res["errors"].get("desk_regime") == "SchemaCheckFailed", res


def test_the_b2a_modules_add_no_callback_to_a_connection():
    """V-51: no Python authorizer, progress handler or trace callback on any
    connection these modules open."""
    for name in ("api/desk_items_macro.py", "api/desk_v2_macro.py"):
        text = (ROOT / name).read_text()
        for call in ("set_authorizer", "set_progress_handler", "set_trace_callback"):
            assert call not in text, (name, call)


def test_the_b2a_modules_never_import_src_config():
    env_ = {k: v for k, v in os.environ.items() if k != "FRED_API_KEY"}
    code = "import sys, api.desk_v2_macro, api.desk_items_macro; print('src.config' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env_, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == "False"



# ── What each regime has meant, and the last changes (desk/fill-compute) ────

def _rows(labels: list[tuple[str, str]]) -> list[dict]:
    return [{"month": m, "label": lab, "growth_trend": 1.0, "inflation_trend": 1.0} for m, lab in labels]


def test_month_returns_are_last_session_closes_and_skip_an_unfinished_month():
    import pandas as pd

    from src.desk import event_study as es

    sessions = es.sessions_between(es.session_calendar("2026-05-01", "2026-09-18"), "2026-05-01", "2026-09-18")
    spx = pd.Series([100.0 + i for i in range(len(sessions))], index=sessions)
    rets = items.month_returns(spx)
    last = lambda m: max(d for d in sessions if d.strftime("%Y-%m") == m)  # noqa: E731
    assert rets["2026-07"] == pytest.approx(spx[last("2026-07")] / spx[last("2026-06")] - 1, rel=1e-12)
    assert "2026-05" not in rets and "2026-09" not in rets  # no April close; September is not over
    held = items.month_returns(spx.drop(last("2026-07")))
    assert "2026-07" not in held and "2026-08" not in held  # a missing month-end close voids both months it closes


FACTORS = {"2025-12": 1.00, "2026-01": 1.01, "2026-02": 1.02, "2026-03": 0.97, "2026-04": 1.04, "2026-05": 0.95,
           "2026-06": 1.06, "2026-07": 1.07}


def _stepped_spx(through: str = "2026-07-31"):
    """Every session of a month at one price, so each month's return is exactly its factor less one."""
    import pandas as pd

    from src.desk import event_study as es

    sessions = es.sessions_between(es.session_calendar("2025-12-01", through), "2025-12-01", through)
    out = []
    for d in sessions:
        m = d.strftime("%Y-%m")
        out.append(100.0 * float(pd.Series([FACTORS[k] for k in FACTORS if k <= m]).prod()))
    return pd.Series(out, index=sessions), sessions


STEP_ROWS = [("2026-01", "Goldilocks"), ("2026-02", "Goldilocks"), ("2026-03", "Stagflation"),
             ("2026-05", "Stagflation"), ("2026-06", "Overheating")]  # April missing


def test_codex_r01_each_label_is_measured_over_the_month_it_governed():
    """Codex R-01: a label stamped M is known only once M+1's prints are out, and a
    session in month K reads the row stamped K−2 (the engine's rule). Pairing a label
    with its own month credited it with a month traded before it existed. Each label
    is now measured over the month it governed: Goldilocks (stamped Jan, Feb) over
    March and April, not January and February."""
    import statistics

    spx, _ = _stepped_spx()
    st = items.regime_stats(_rows(STEP_ROWS), spx, None)
    by = {r["regime"]: r for r in st["rows"]}
    g = by["Goldilocks"]
    assert (g["months"], g["spx_n"], g["spx_pending"], g["spx_missing"]) == (2, 2, 0, 0)
    assert g["spx_median_mo"] == pytest.approx(statistics.median([-0.03, 0.04])) and g["up_pct"] == 0.5  # March, April
    s_ = by["Stagflation"]  # stamped March and May: May and July
    assert s_["spx_mean_mo"] == pytest.approx((-0.05 + 0.07) / 2) and s_["spx_n"] == 2
    o = by["Overheating"]  # stamped June: August, not over in the store
    assert (o["months"], o["spx_n"], o["spx_pending"], o["spx_median_mo"]) == (1, 0, 1, None)
    assert st["governed"] == {"start": "2026-03", "end": "2026-08", "n": 5} and st["lag_months"] == 2
    assert st["window"] == {"start": "2026-01", "end": "2026-06", "n": 5}


def test_codex_r01_a_change_is_dated_by_the_month_it_took_effect():
    spx, _ = _stepped_spx()
    ch = items.regime_changes(_rows(STEP_ROWS), spx)
    assert ch["n"] == 2 and ch["lag_months"] == 2
    assert [(c["effective_month"], c["stamp_month"], c["from"], c["to"], c["from_month"]) for c in ch["rows"]] == [
        ("2026-08", "2026-06", "Stagflation", "Overheating", "2026-05"), ("2026-05", "2026-03", "Goldilocks", "Stagflation", "2026-02")]
    assert (ch["rows"][1]["spx_1m"], ch["rows"][1]["spx_1m_status"]) == (pytest.approx(-0.05), "complete")  # May
    assert (ch["rows"][0]["spx_1m"], ch["rows"][0]["spx_1m_status"]) == (None, "pending")  # August is not over


def test_codex_r08_a_missing_close_is_not_a_window_still_open():
    """Codex R-08: a return null because its window is not complete yet and one null
    because a historical close is not stored were one state ("month not over")."""
    spx, sessions = _stepped_spx()
    may_end = max(d for d in sessions if d.strftime("%Y-%m") == "2026-05")
    ch = items.regime_changes(_rows(STEP_ROWS), spx.drop(may_end))
    assert [(c["effective_month"], c["spx_1m"], c["spx_1m_status"]) for c in ch["rows"]] == [
        ("2026-08", None, "pending"), ("2026-05", None, "missing")]
    st = items.regime_stats(_rows(STEP_ROWS), spx.drop(may_end), None)
    by = {r["regime"]: r for r in st["rows"]}
    assert (by["Stagflation"]["spx_n"], by["Stagflation"]["spx_missing"]) == (1, 1)  # May missing, July complete
    mid = _stepped_spx("2026-07-15")[0]  # July's window not complete yet in the store
    assert items.MonthReturns(mid).status("2026-07") == ("pending", None)
    assert items.MonthReturns(mid).status("2026-06") == ("complete", pytest.approx(0.06))


def test_codex_r04_r07_the_vix_is_validated_aligned_and_its_coverage_served():
    """Codex R-07: the VIX is aligned on the XNYS calendar and validated like every
    engine input before it is averaged; an off-session row and an invalid value are
    set aside and counted. Codex R-04: its stored sessions are served apart from the
    label count, against the sessions due in the complete governed months."""
    import pandas as pd

    spx, sessions = _stepped_spx()
    vix = pd.Series([10.0 + d.month for d in sessions], index=sessions)
    march = [d for d in sessions if d.strftime("%Y-%m") == "2026-03"]
    april = [d for d in sessions if d.strftime("%Y-%m") == "2026-04"]
    vix[march[3]] = -1.0                                   # invalid for a logged series
    vix = pd.concat([vix, pd.Series([99.0], index=[pd.Timestamp("2026-03-07")])]).sort_index()  # a Saturday
    st = items.regime_stats(_rows(STEP_ROWS), spx, vix)
    g = {r["regime"]: r for r in st["rows"]}["Goldilocks"]
    assert (g["vix_days"], g["vix_sessions"]) == (len(march) + len(april) - 1, len(march) + len(april))
    assert g["vix_avg"] == pytest.approx((13.0 * (len(march) - 1) + 14.0 * len(april)) / (len(march) + len(april) - 1))
    assert st["vix_coverage"] == {"stored": True, "first": "2025-12-01", "last": "2026-07-31", "off_session_dropped": 1, "invalid": 1}
    o = {r["regime"]: r for r in st["rows"]}["Overheating"]
    assert (o["vix_days"], o["vix_sessions"], o["vix_avg"]) == (0, 0, None)  # August is not over: no VIX from it either
    assert st["totals"]["vix_days"] == sum(r["vix_days"] for r in st["rows"]) and st["totals"]["spx_pending"] == 1
    none = items.regime_stats(_rows(STEP_ROWS), spx, None)
    assert none["vix_coverage"]["stored"] is False and all(r["vix_avg"] is None for r in none["rows"])


@pytest.mark.parametrize("path", [PUBLISHED], ids=["published"])
def test_the_stats_and_the_changes_on_the_audits_store(path, install_worker, monkeypatch, tmp_path):
    """FRAME3_DATA_AUDIT.md §2.4 on the audit's store: Q8's labels and Q9's 123 changes, each measured over the
    month it governed (Codex R-01). The store predates the ^VIX close (desk/fill-compute, item 7), so its VIX
    column is null until the next full refresh stores it; with that close added the refresh's way
    (tests/desk_vix.py, from the store's own VIXCLS rows), the VIX over the governed months."""
    if not path.exists() or path.stat().st_size == 0:
        pytest.skip(f"{path.name} is not in this tree")
    from tests.desk_vix import with_vix_close

    serve(install_worker, monkeypatch, path)
    at(monkeypatch, datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    if d["history"][-1]["month"] != "2026-08":
        pytest.skip("not the audit's store")
    if d["stats"]["data"]["rows"][0]["vix_days"] == 0:
        before = d["stats"]["data"]
        assert all(r["vix_avg"] is None and r["vix_days"] == 0 for r in before["rows"]) and "not stored yet" in before["source"]
        assert before["rows"][0]["spx_n"] == 26 and before["vix_coverage"]["stored"] is False and d["changes"]["status"] == "ready"
        serve(install_worker, monkeypatch, with_vix_close(path, tmp_path / "with-vix.db"))
    at(monkeypatch, datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    if d["history"][-1]["month"] != "2026-08":
        pytest.skip("not the audit's store")
    st, ch = d["stats"]["data"], d["changes"]["data"]
    assert [(r["regime"], r["months"], r["spx_n"], r["spx_pending"]) for r in st["rows"]] == [
        ("Goldilocks", 27, 26, 1), ("Overheating", 213, 212, 1), ("Stagflation", 102, 102, 0), ("Recession Risk", 21, 21, 0)]
    assert st["window"] == {"start": "1996-05", "end": "2026-08", "n": 363}
    assert st["governed"] == {"start": "1996-07", "end": "2026-10", "n": 363}
    # Goldilocks over its governed months, checked against a month-end resample and the stored VIXCLS rows
    g = st["rows"][0]
    assert (g["spx_median_mo"], g["spx_mean_mo"], g["up_pct"]) == (
        pytest.approx(0.0118291114849147, rel=1e-9), pytest.approx(0.0061619848236379, rel=1e-9), pytest.approx(17 / 26))
    assert g["vix_avg"] == pytest.approx(16.85300556586271, rel=1e-12) and (g["vix_days"], g["vix_sessions"]) == (539, 539)
    # Codex R-07: FRED's VIX copy carries 34 rows on days XNYS did not trade; the aligned reader sets them aside
    assert st["vix_coverage"]["off_session_dropped"] == 34 and st["totals"]["vix_days"] == 7566 and st["totals"]["vix_sessions"] == 7568
    assert ch["n"] == 123 and [(c["effective_month"], c["stamp_month"], c["from"], c["to"], c["spx_1m_status"]) for c in ch["rows"]] == [
        ("2026-10", "2026-08", "Goldilocks", "Overheating", "pending"), ("2026-09", "2026-07", "Overheating", "Goldilocks", "pending"),
        ("2026-03", "2026-01", "Stagflation", "Overheating", "complete"), ("2025-11", "2025-09", "Overheating", "Stagflation", "complete"),
        ("2025-08", "2025-06", "Stagflation", "Overheating", "complete")]
    assert ch["rows"][2]["spx_1m"] == pytest.approx(-0.050932690968577, rel=1e-12)  # March 2026


# ── Both cards read one label (desk/fill-compute) ───────────────────────────

REGIME_AXES = {"Goldilocks": ("rising", "falling"), "Overheating": ("rising", "rising"),
               "Stagflation": ("falling", "rising"), "Recession Risk": ("falling", "falling")}
FOUR = [("Goldilocks", UP, DOWN), ("Overheating", UP, UP), ("Stagflation", DOWN, UP), ("Recession Risk", DOWN, DOWN)]


def _flip(d: str) -> str:
    return "falling" if d == "rising" else "rising"


def _regime(growth: str, inflation: str) -> str:
    return next(k for k, v in REGIME_AXES.items() if v == (growth, inflation))


@pytest.mark.parametrize("label,gsteps,isteps", FOUR, ids=[f[0] for f in FOUR])
def test_the_flip_text_matches_the_displayed_label_for_every_regime(tmp_path, install_worker, monkeypatch, classifier,
                                                                    label, gsteps, isteps):
    """The next prints are read from the row WHERE WE ARE shows (the K−2 row
    for the response's session), so their flips start from its label: a CPI
    print flips inflation away from that row's inflation, an INDPRO print
    growth away from its growth, and each lands on the regime the table gives."""
    path = _oracle_store(tmp_path, classifier, _levels(100.0, gsteps), _levels(250.0, isteps))
    conn = sqlite3.connect(path)
    last = conn.execute("SELECT date, label FROM regimes ORDER BY date DESC LIMIT 1").fetchone()
    conn.close()
    assert last[1] == label, "the oracle store's newest row carries the regime under test"
    serve(install_worker, monkeypatch, path)
    y, m = int(last[0][:4]), int(last[0][5:7]) + 2  # the session month K whose K−2 row is the newest
    y, m = (y + 1, m - 12) if m > 12 else (y, m)
    at(monkeypatch, datetime(y, m, 15, 21, 0, tzinfo=timezone.utc))
    d = get_regime()["data"]
    cur, np_ = d["current"]["data"], d["next_prints"]["data"]
    assert np_["basis"] == {"month": cur["print"], "label": cur["label"]} and cur["label"] == label
    assert np_["published"] == [] and np_["upcoming_from"] == np_["basis"]
    growth, inflation = REGIME_AXES[label]
    assert (cur["growth"], cur["inflation"]) == (growth, inflation)
    cpi, ind = np_["cpi"], np_["indpro"]
    assert (cpi["from_direction"], ind["from_direction"]) == (inflation, growth)
    assert cpi["operator"] == ("<=" if inflation == "rising" else ">") and cpi["flips_to"] == _regime(growth, _flip(inflation))
    assert ind["operator"] == ("<=" if growth == "rising" else ">") and ind["flips_to"] == _regime(_flip(growth), inflation)
    assert label not in (cpi["flips_to"], ind["flips_to"])


def test_a_print_already_made_is_said_from_the_displayed_row(tmp_path, install_worker, monkeypatch, classifier):
    """When the displayed K−2 row's next month is stored (mid-month K, before the
    K−2 row stops governing), the card reads that print from the displayed row:
    no threshold, the print's m/m change, the axis it gave, and the stored next
    row's own label."""
    growth, infl = _levels(100.0, UP), _levels(250.0, DOWN + [0.01])  # the last CPI print jumps: inflation turns rising
    growth = growth + [growth[-1] * 1.003]
    path = _oracle_store(tmp_path, classifier, growth, infl)
    conn = sqlite3.connect(path)
    rows = items.regime_rows(conn)
    conn.close()
    basis, after = rows[-2], rows[-1]
    np_, _ = _next(path, basis["month"])
    assert np_["basis"] == {"month": basis["month"], "label": basis["label"]}
    # Codex R-05: the row after it is published, with the prints that made it, apart from the upcoming prints
    (pub,) = np_["published"]
    assert (pub["month"], pub["label"], pub["first_effective_month"]) == (after["month"], after["label"], v2m.months_before(after["month"], -2))
    cpi = pub["cpi"]
    assert cpi["reference_month"] == after["month"] and cpi["mom"] == pytest.approx(infl[-1] / infl[-2] - 1, rel=1e-12)
    assert cpi["direction"] == items.direction(after["inflation_trend"])
    assert cpi["from_direction"] == items.direction(basis["inflation_trend"])
    # the upcoming prints read from the newest row, for the month after it
    assert np_["upcoming_from"] == {"month": after["month"], "label": after["label"]}
    assert np_["cpi"]["reference_month"] == v2m.months_before(after["month"], -1) and np_["cpi"]["threshold_mom"] is not None


def test_the_routes_next_print_keys_mirror_the_items():
    assert v2m.NEXT_PRINT_KEYS == items.NEXT_PRINTS


# ── The home page's classifier beside the rule-based label (desk/fill-compute) ──

def _odds_store(tmp_path: Path, rows: list[tuple]) -> sqlite3.Connection:
    conn = sqlite3.connect(tmp_path / "odds.db")
    conn.execute("CREATE TABLE regimes (date TEXT, label TEXT, growth_trend REAL, inflation_trend REAL, prob_goldilocks REAL, "
                 "prob_overheating REAL, prob_stagflation REAL, prob_recession REAL)")
    conn.executemany("INSERT INTO regimes VALUES (?,?,?,?,?,?,?,?)", rows)
    return conn


def test_the_classifier_reading_is_the_newest_rows_dominant_odds(tmp_path):
    conn = _odds_store(tmp_path, [("2026-07-01", "Goldilocks", 1, -1, 0.61, 0.01, 0.01, 0.37),
                                  ("2026-08-01", "Overheating", 1, 1, 0.11, 0.4246, 0.3698, 0.0957)])
    try:
        assert items.classifier_latest(conn) == {"month": "2026-08", "label": "Overheating", "odds": 0.4246}
        conn.execute("UPDATE regimes SET prob_recession = 0.9 WHERE date = '2026-08-01'")
        # the Desk never shows regimes.prob_recession: the label is named, its odds are not
        assert items.classifier_latest(conn) == {"month": "2026-08", "label": "Recession Risk", "odds": None}
        conn.execute("UPDATE regimes SET prob_goldilocks = NULL WHERE date = '2026-08-01'")
        assert items.classifier_latest(conn) is None
    finally:
        conn.close()


def test_the_route_serves_the_classifier_beside_the_k_minus_2_label(install_worker, monkeypatch):
    if not PUBLISHED.exists() or PUBLISHED.stat().st_size == 0:
        pytest.skip("no published copy")
    serve(install_worker, monkeypatch, PUBLISHED)
    at(monkeypatch, datetime(2026, 9, 24, 16, 0, tzinfo=timezone.utc))
    cur = get_regime()["data"]["current"]["data"]
    if cur["latest_print"] != "2026-08":
        pytest.skip("not the audit's store")
    assert cur["label"] == "Goldilocks" and cur["print"] == "2026-07"
    assert cur["classifier"] == {"month": "2026-08", "label": "Overheating", "odds": 0.4246, "agrees": False}
