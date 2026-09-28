"""tests/test_desk_v2_ledger.py — GET /ledger and the projection memo (desk/frame-3-api, B1 commit 5).

docs/desk/FRAME3_API_PLAN.md §1.5, §1.10 R3/R7 and §5. The twelve rows in the
spec's §8 order; `scored_n` counts the rows whose study completed; an
unavailable row (RSI, and WTI and DXY on a store without them) serves its
reason with every statistic and firing field null, and is not stale; an
available row's statistics are its study's at h = 20, and its firing state is
the study's (B-05, case 11: /ledger and /study agree for a slug in one
generation). The memo never holds a field that depends on "now".
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from api import desk_catalog as catalog, desk_v2
from api.main import app
from tests import desk_contract as dc
from tests.test_desk_v2_study import TIER2, _serve, synth_path  # noqa: F401 (fixture)

client = TestClient(app)
NOW_KEYS = {"comparison_session", "prev_session", "stale", "firing_now", "firing_day", "evaluated_on",
            "served_from_cache", "elapsed_ms"}


@pytest.fixture()
def served(install_worker, monkeypatch, synth_path):  # noqa: F811
    return _serve(install_worker, monkeypatch, synth_path)


def _ledger() -> dict:
    return dc.check_response("/ledger", client.get("/api/desk/ledger"))["data"]


def test_the_ledger_rows_order_and_counts(served):
    d = _ledger()
    assert d["verdict_rule"] == "v1" and d["horizon"] == 20
    assert [r["slug"] for r in d["signals"]] == list(catalog.LEDGER_ORDER)
    unavailable = {"dollar-2sigma-20d", "oil-2sigma-20d"}  # the synthetic store has no WTI, DXY; the RSI rows are scored
    assert d["scored_n"] == 12 - len(unavailable) and d["scored_n"] + d["unavailable_n"] == 12
    for r in d["signals"]:
        assert r["group"] == catalog.LEDGER_GROUP[r["slug"]] and r["horizon"] == 20
        if r["slug"] in unavailable:
            assert r["available"] is False and r["unavailable"]["reason"] and r["stale"] is False
            assert all(r[k] is None for k in desk_v2.LEDGER_STATS + ("firing_now", "firing_day", "evaluated_on")), r
        else:
            assert r["available"] is True and r["unavailable"] is None and r["n"] is not None
    for slug in ("rsi-above-70", "rsi-below-30"):
        r = next(r for r in d["signals"] if r["slug"] == slug)
        assert r["available"] is True and r["group"] == "spx" and r["target_unit"] == "log_return" and r["verdict"]


@pytest.mark.parametrize("slug", [s for s in catalog.LEDGER_ORDER if catalog.BY_SLUG[s].question and s not in TIER2])
def test_a_ledger_row_is_its_study_at_one_month(served, slug):
    row = next(r for r in _ledger()["signals"] if r["slug"] == slug)
    study = dc.check_response("/study", client.get(f"/api/desk/study?preset={slug}"))["data"]
    h20 = next(r for r in study["horizons"] if r["h"] == 20)
    assert (row["n"], row["up_n"], row["up_pct"], row["median"], row["baseline_median"], row["verdict"]) == \
        (h20["n"], h20["up_n"], h20["up_pct"], h20["median"], h20["baseline_median"], h20["verdict"])
    assert row["last_fired"] == study["last_event"] and row["sample_start"] == study["sample_start"]
    assert (row["target_unit"], row["display_unit"]) == (study["question"]["target_unit"], study["question"]["display_unit"])
    for k in ("firing_now", "firing_day", "evaluated_on", "stale"):  # B-05 case 11
        assert row[k] == study[k], (slug, k)
    delta = h20["median"] - h20["baseline_median"] if h20["median"] is not None else None
    want = None if delta is None else (delta if row["target_unit"] == "bp" else 100 * delta)
    assert (row["vs_normal"] is None) == (want is None) and (want is None or abs(row["vs_normal"] - want) < 1e-12)


def test_vs_normal_is_log_pp_or_bp():
    assert desk_v2.vs_normal(0.0123, "log_return") == pytest.approx(1.23) and desk_v2.vs_normal(-6.0, "bp") == -6.0
    assert desk_v2.vs_normal(None, "bp") is None


def test_the_ledger_takes_no_parameters(served):
    r = client.get("/api/desk/ledger?horizon=5")
    assert r.status_code == 422 and dc.check_response("/ledger", r)["error"]["code"] == "unsupported"


def test_the_memo_serves_the_ledger_and_now_moves_over_it(served, monkeypatch):
    """Plan §5: a repeat on one generation is a memo hit, and after a session
    boundary and a month boundary every field that depends on now follows the
    new now; no memo entry holds one of them."""
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 17, 21, 0, tzinfo=timezone.utc))  # Thu after the close
    a = _ledger()
    hits = []
    real = desk_v2.memo
    monkeypatch.setattr(desk_v2, "memo", lambda key, build: hits.append(r := real(key, build)) or r)
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc))  # Fri after the close
    b = _ledger()
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc))  # into October
    c = _ledger()
    assert [h for h, _ in hits] == [True, True]
    assert (a["comparison_session"], a["prev_session"]) == ("2026-09-17", "2026-09-16")
    assert (b["comparison_session"], b["prev_session"]) == ("2026-09-18", "2026-09-17")
    assert (c["comparison_session"], c["prev_session"]) == ("2026-10-01", "2026-09-30")
    for row_a, row_b, row_c in zip(a["signals"], b["signals"], c["signals"]):
        if not row_a["available"]:
            continue
        assert row_b["evaluated_on"] == "2026-09-18" and row_b["stale"] is False  # the synthetic data ends the 18th
        assert row_a["stale"] is True and row_c["stale"] is True, row_a["slug"]
        assert {k: row_a[k] for k in desk_v2.LEDGER_STATS} == {k: row_c[k] for k in desk_v2.LEDGER_STATS}
    s1 = dc.check_response("/study", client.get("/api/desk/study?preset=spx-5d-2sigma"))["data"]
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc))
    s2 = dc.check_response("/study", client.get("/api/desk/study?preset=spx-5d-2sigma"))["data"]
    assert s1["served_from_cache"] is False and s2["served_from_cache"] is True
    assert (s1["comparison_session"], s1["stale"]) == ("2026-10-01", True)
    assert (s2["comparison_session"], s2["stale"]) == ("2026-09-18", False)
    routes = set()
    for key, value in desk_v2._memo.items():
        route = key[1]
        routes.add(route)
        if route == "/study":
            entries = [value[0]]                        # (payload, trace)
        elif route == "/ledger":
            entries = [row for row, _trace, _cross in value]
        else:
            entries = list(value)                       # /study/events rows
        for entry in entries:
            assert not NOW_KEYS & set(entry), (route, sorted(NOW_KEYS & set(entry)))
    assert {"/ledger", "/study"} <= routes


def test_the_ledger_rows_feed_the_firing_lists(served, monkeypatch):
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc))
    entries = desk_v2.ledger_rows(*desk_v2.sessions_now())
    new, still = desk_v2.fire_lists(entries)
    rows = {r["slug"]: (r, f) for r, f in entries}
    for item in new + still:
        r, f = rows[item["slug"]]
        assert r["available"] and not r["stale"] and f["state_comparison"] is True
    for item in still:
        assert item["firing_day"] == rows[item["slug"]][0]["firing_day"] >= 2


def test_codex_r03_the_ledger_judges_each_input_on_its_own_calendar(served, monkeypatch):
    """Codex R-03 on the route: the synthetic store ends Friday 2026-09-18 for
    every series. On Tuesday the 22nd, the 2s10s and HY rows read FRED series
    two business days behind (within FRED's grace) and the S&P two sessions
    behind (an exchange close has none): stale, as every S&P row is."""
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 22, 21, 0, tzinfo=timezone.utc))
    d = _ledger()
    by = {r["slug"]: r for r in d["signals"] if r["available"]}
    assert d["comparison_session"] == "2026-09-22"
    for slug in ("2s10s-2sigma-steepening", "hy-2sigma-20d", "golden-cross", "spx-20d-2sigma"):
        assert by[slug]["evaluated_on"] == "2026-09-18" and by[slug]["stale"] is True, slug
    # One session later than the data, the FRED rows' own grace and the S&P's are both honoured.
    monkeypatch.setattr(desk_v2, "_now", lambda: datetime(2026, 9, 18, 21, 0, tzinfo=timezone.utc))
    assert all(r["stale"] is False for r in _ledger()["signals"] if r["available"])
