"""The vintage study's pure helpers (scripts/research/, Desk plan D8).

Research code: nothing served imports it. These pin the real-time
reconstruction rules the study's counts rest on, on synthetic ALFRED tables.
"""
import pandas as pd
import pytest

from scripts.research import alfred
from scripts.research.vintage_recession import band
from scripts.research.vintage_regime import vintage_on
from scripts.research.vintage_studies import point_in_time_regime_at

# Two observations: Jan published 02-15 then revised 03-15; Feb published 03-15;
# Mar published as '.' (no value) on 04-15.
TABLE = pd.DataFrame([
    {"date": "2024-01-01", "rs": "2024-02-15", "re": "2024-03-14", "value": 100.0},
    {"date": "2024-01-01", "rs": "2024-03-15", "re": "9999-12-31", "value": 99.0},
    {"date": "2024-02-01", "rs": "2024-03-15", "re": "9999-12-31", "value": 101.0},
    {"date": "2024-03-01", "rs": "2024-04-15", "re": "9999-12-31", "value": float("nan")},
])


def test_as_of_serves_the_value_in_force_that_day():
    assert alfred.as_of(TABLE, "2024-02-14").empty
    s = alfred.as_of(TABLE, "2024-02-15")
    assert s.to_dict() == {pd.Timestamp("2024-01-01"): 100.0}
    s = alfred.as_of(TABLE, "2024-03-14")
    assert s.to_dict() == {pd.Timestamp("2024-01-01"): 100.0}
    s = alfred.as_of(TABLE, "2024-03-15")
    assert s.to_dict() == {pd.Timestamp("2024-01-01"): 99.0, pd.Timestamp("2024-02-01"): 101.0}


def test_as_of_drops_blanks_like_the_pipeline():
    s = alfred.as_of(TABLE, "2024-05-01")
    assert pd.Timestamp("2024-03-01") not in s.index


def test_first_release_is_the_first_non_blank_print():
    fr = alfred.first_release(TABLE)
    assert fr.loc[pd.Timestamp("2024-01-01"), "value"] == 100.0
    assert fr.loc[pd.Timestamp("2024-01-01"), "published"] == "2024-02-15"
    assert fr.loc[pd.Timestamp("2024-02-01"), "published"] == "2024-03-15"
    assert pd.Timestamp("2024-03-01") not in fr.index  # never had a value


def test_latest_is_the_newest_vintage():
    assert alfred.latest(TABLE).to_dict() == {pd.Timestamp("2024-01-01"): 99.0, pd.Timestamp("2024-02-01"): 101.0}


def test_vintage_on_takes_the_newest_on_or_before():
    v = ["2024-02-15", "2024-03-15"]
    assert vintage_on(v, "2024-02-14") is None
    assert vintage_on(v, "2024-02-15") == "2024-02-15"
    assert vintage_on(v, "2024-03-14") == "2024-02-15"
    assert vintage_on(v, "2024-12-31") == "2024-03-15"


def test_point_in_time_label_follows_the_session_date():
    # row 2024-01 is Overheating in the first vintage, revised to Stagflation on 03-15
    vdates = ["2024-02-15", "2024-03-15"]
    by_v = {"2024-02-15": {"2024-01": "Overheating"},
            "2024-03-15": {"2024-01": "Stagflation", "2024-02": "Goldilocks"}}
    f = point_in_time_regime_at(vdates, by_v, lag=2)
    sessions = pd.DatetimeIndex(["2024-03-01", "2024-03-14", "2024-03-15", "2024-04-01"])
    months = pd.Series(dtype=object, index=pd.PeriodIndex([], freq="M"))
    got = list(f(sessions, months))
    # March sessions read row 2024-01; April reads row 2024-02
    assert got == ["Overheating", "Overheating", "Stagflation", "Goldilocks"]


def test_point_in_time_label_is_unlabeled_before_the_row_exists():
    vdates = ["2024-02-15"]
    by_v = {"2024-02-15": {"2024-01": "Overheating"}}
    f = point_in_time_regime_at(vdates, by_v, lag=2)
    months = pd.Series(dtype=object, index=pd.PeriodIndex([], freq="M"))
    assert list(f(pd.DatetimeIndex(["2024-04-01"]), months)) == ["Unlabeled"]


def test_band_edges_match_the_served_bands():
    assert band(19.99) == "low" and band(20.0) == "elevated"
    assert band(39.99) == "elevated" and band(40.0) == "high"


# Codex S-1: the replica checks must refuse to report on incompatible inputs.

def _diag(**over):
    d = {"newest_run_rows": 3, "replica_rows_compared": 3, "replica_labels_equal": 3, "replica_max_prob_abs_err": 0.0,
         "alfred_latest_vs_stored": {
             "INDPRO": {"stored_months": 5, "alfred_months": 5, "months": 5, "max_abs_diff": 0.0},
             "CPIAUCSL": {"stored_months": 5, "alfred_months": 5, "months": 5, "max_abs_diff": 0.0}}}
    d.update(over)
    return d


def test_the_replica_passes_only_on_full_equal_coverage():
    from scripts.research.vintage_regime import enforce_replica

    enforce_replica(_diag())


@pytest.mark.parametrize("over, words", [
    ({"replica_labels_equal": 2}, "labels equal on 2 of 3"),
    ({"replica_rows_compared": 2, "replica_labels_equal": 2}, "replica covers 2 of 3"),
    ({"replica_max_prob_abs_err": 0.01}, "odds differ"),
    ({"replica_max_prob_abs_err": float("nan")}, "odds differ"),
    ({"newest_run_rows": 0, "replica_rows_compared": 0, "replica_labels_equal": 0}, "no rows"),
])
def test_the_replica_rejects_a_mismatched_replay(over, words):
    from scripts.research.vintage_regime import ReplicaMismatch, enforce_replica

    with pytest.raises(ReplicaMismatch, match=words):
        enforce_replica(_diag(**over))


@pytest.mark.parametrize("gap, words", [
    ({"stored_months": 5, "alfred_months": 5, "months": 5, "max_abs_diff": 899.0}, "differs from the store"),
    ({"stored_months": 5, "alfred_months": 4, "months": 4, "max_abs_diff": 0.0}, "5 stored months, 4 ALFRED months"),
    ({"stored_months": 0, "alfred_months": 5, "months": 0, "max_abs_diff": float("inf")}, "0 stored months"),
])
def test_the_replica_rejects_alfred_data_that_is_not_the_store(gap, words):
    from scripts.research.vintage_regime import ReplicaMismatch, enforce_replica

    d = _diag()
    d["alfred_latest_vs_stored"]["INDPRO"] = gap
    with pytest.raises(ReplicaMismatch, match=words):
        enforce_replica(d)


def test_the_recession_replica_needs_the_same_months_and_values():
    from scripts.research.vintage_recession import ReplicaMismatch, enforce_replica

    idx = pd.date_range("2024-01-31", periods=3, freq="ME")
    s = pd.Series([1.0, 2.0, 3.0], index=idx)
    assert enforce_replica(s, s.copy()) == 0.0
    with pytest.raises(ReplicaMismatch, match="differs"):
        enforce_replica(s, s + 0.5)
    with pytest.raises(ReplicaMismatch, match="covers 2 months"):
        enforce_replica(s, s.iloc[:2])
    shifted = pd.Series([1.0, 2.0, 3.0], index=idx + pd.offsets.MonthEnd(1))
    with pytest.raises(ReplicaMismatch, match="2 in both"):
        enforce_replica(s, shifted)
    with pytest.raises(ReplicaMismatch):
        enforce_replica(pd.Series(dtype=float), pd.Series(dtype=float))
