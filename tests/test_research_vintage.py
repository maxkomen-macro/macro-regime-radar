"""The vintage study's pure helpers (scripts/research/, Desk plan D8).

Research code: nothing served imports it. These pin the real-time
reconstruction rules the study's counts rest on, on synthetic ALFRED tables.
"""
from pathlib import Path

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


# Codex S-3: the scratch copy must carry committed transactions still in a WAL file.

def test_the_scratch_copy_carries_frames_still_in_the_wal(tmp_path):
    import sqlite3

    from scripts.research.vintage_studies import make_scratch_db, snapshot_db

    src = tmp_path / "store.db"
    writer = sqlite3.connect(src)
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("PRAGMA wal_autocheckpoint=0")
    writer.execute("CREATE TABLE regimes (date TEXT PRIMARY KEY, label TEXT)")
    writer.commit()
    writer.executemany("INSERT INTO regimes VALUES (?, ?)", [("2024-01-01", "Overheating"), ("2024-02-01", "Goldilocks")])
    writer.commit()  # committed, but only in store.db-wal while this connection stays open
    try:
        assert (tmp_path / "store.db-wal").stat().st_size > 0
        snap = snapshot_db(src, tmp_path / "snap.db")
        alt = make_scratch_db(src, tmp_path / "alt.db", {"2024-01": "Stagflation", "2024-02": None})
        with sqlite3.connect(snap) as c:
            assert c.execute("SELECT date, label FROM regimes ORDER BY date").fetchall() == [
                ("2024-01-01", "Overheating"), ("2024-02-01", "Goldilocks")]
        with sqlite3.connect(alt) as c:
            assert c.execute("SELECT date, label FROM regimes ORDER BY date").fetchall() == [("2024-01-01", "Stagflation")]
        # the source is untouched
        assert writer.execute("SELECT count(*) FROM regimes").fetchone()[0] == 2
    finally:
        writer.close()


# Codex S-5: the recession study stops when the ALFRED cache is not the store's data.

def test_the_store_check_passes_when_the_cache_is_the_store():
    stored = pd.Series([99.0, 101.0], index=pd.to_datetime(["2024-01-01", "2024-02-01"]))
    gap = alfred.store_gap(stored, TABLE)
    assert gap == {"stored_months": 2, "alfred_months": 2, "months": 2, "max_abs_diff": 0.0}
    alfred.enforce_store_match({"X": gap})


@pytest.mark.parametrize("stored, words", [
    # the store was refreshed after the cache: a revised value
    (pd.Series([99.5, 101.0], index=pd.to_datetime(["2024-01-01", "2024-02-01"])), "differs from the store"),
    # the store has a newer month than the cache (stale cache)
    (pd.Series([99.0, 101.0, 102.0], index=pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"])), "3 stored months, 2 ALFRED"),
    # the cache has a month the store lacks
    (pd.Series([99.0], index=pd.to_datetime(["2024-01-01"])), "1 stored months, 2 ALFRED"),
    # nothing stored
    (pd.Series(dtype=float, index=pd.DatetimeIndex([])), "0 stored months"),
])
def test_the_store_check_rejects_a_stale_or_partial_cache(stored, words):
    with pytest.raises(alfred.StoreMismatch, match=words):
        alfred.enforce_store_match({"X": alfred.store_gap(stored, TABLE)})


# Codex S-6: no study run can delete or overwrite its source database.

def _db(path):
    import sqlite3

    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE regimes (date TEXT PRIMARY KEY, label TEXT)")
        c.execute("INSERT INTO regimes VALUES ('2024-01-01', 'Overheating')")
    return path


def _labels(path):
    import sqlite3

    with sqlite3.connect(path) as c:
        return c.execute("SELECT date, label FROM regimes").fetchall()


@pytest.mark.parametrize("name", ["served.db", "governed_start.db"])
def test_a_source_inside_the_scratch_outputs_is_refused_before_any_write(tmp_path, name):
    from scripts.research.vintage_studies import check_paths

    src = _db(tmp_path / name)
    with pytest.raises(ValueError, match="writes in --scratch"):
        check_paths(src, tmp_path)
    assert _labels(src) == [("2024-01-01", "Overheating")]
    check_paths(src, tmp_path / "elsewhere")  # a separate scratch directory is fine


def test_a_snapshot_onto_its_own_source_is_refused_and_the_source_survives(tmp_path):
    from scripts.research.vintage_studies import make_scratch_db, snapshot_db

    src = _db(tmp_path / "store.db")
    with pytest.raises(ValueError, match="is the source"):
        snapshot_db(src, src)
    with pytest.raises(ValueError, match="is the source"):
        snapshot_db(src, tmp_path / "store.db-wal")
    with pytest.raises(ValueError, match="is the source"):
        make_scratch_db(src, src, {"2024-01": "Stagflation"})
    assert _labels(src) == [("2024-01-01", "Overheating")]


# Codex S-7: no output file can be, or write through to, the source database.

@pytest.mark.parametrize("target", ["store.db", "store.db-wal", "store.db-shm", "store.db-journal"])
def test_an_output_symlinked_to_the_source_or_a_sidecar_is_refused(tmp_path, target):
    from scripts.research import safeio

    src = _db(tmp_path / "store.db")
    out = tmp_path / "out"
    out.mkdir()
    (out / "summary.json").symlink_to(tmp_path / target)
    with pytest.raises(safeio.OutputAliasesSource):
        safeio.guard_outputs(src, [out / "summary.json"])
    with pytest.raises(safeio.OutputAliasesSource):
        safeio.write_text(out / "summary.json", "{}", db=src)
    assert _labels(src) == [("2024-01-01", "Overheating")]


def test_an_output_hard_linked_to_the_source_is_refused(tmp_path):
    import os

    from scripts.research import safeio

    src = _db(tmp_path / "store.db")
    out = tmp_path / "out"
    out.mkdir()
    os.link(src, out / "summary.json")
    with pytest.raises(safeio.OutputAliasesSource):
        safeio.guard_outputs(src, [out / "summary.json"])
    assert _labels(src) == [("2024-01-01", "Overheating")]
    safeio.guard_outputs(src, [out / "other.json"])  # an unrelated output is fine


def test_a_write_replaces_a_symlink_instead_of_writing_through_it(tmp_path):
    from scripts.research import safeio

    src = _db(tmp_path / "store.db")
    before = src.read_bytes()
    link = tmp_path / "summary.json"
    link.symlink_to(src)  # created after any check: the write itself must not follow it
    safeio.write_text(link, "{}")
    assert not link.is_symlink() and link.read_text() == "{}"
    assert src.read_bytes() == before and _labels(src) == [("2024-01-01", "Overheating")]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["store.db", "summary.json"]  # no temporary left


def _alias_out(tmp_path, src, name):
    out = tmp_path / "out"
    out.mkdir()
    (out / name).symlink_to(src)
    return out


def _no_load(*a, **k):
    raise AssertionError("computation started before the output check")


def test_the_regime_run_refuses_an_aliased_output_before_computing(tmp_path, monkeypatch):
    from scripts.research import alfred as al, safeio, vintage_regime

    src = _db(tmp_path / "store.db")
    monkeypatch.setattr(al, "load", _no_load)
    with pytest.raises(safeio.OutputAliasesSource):
        vintage_regime.run(tmp_path / "cache", src, _alias_out(tmp_path, src, "regime_summary.json"))
    assert _labels(src) == [("2024-01-01", "Overheating")]


def test_the_recession_run_refuses_an_aliased_output_before_computing(tmp_path, monkeypatch):
    from scripts.research import alfred as al, safeio, vintage_recession

    src = _db(tmp_path / "store.db")
    monkeypatch.setattr(al, "load", _no_load)
    with pytest.raises(safeio.OutputAliasesSource):
        vintage_recession.run(tmp_path / "cache", src, _alias_out(tmp_path, src, "recession_histories.csv"))
    assert _labels(src) == [("2024-01-01", "Overheating")]


def test_the_studies_run_refuses_an_aliased_output_before_computing(tmp_path):
    from scripts.research import safeio, vintage_studies

    src = _db(tmp_path / "store.db")
    out = _alias_out(tmp_path, src, "studies_summary.json")
    with pytest.raises(safeio.OutputAliasesSource):
        vintage_studies.main(["--db", str(src), "--labels", str(tmp_path / "missing.csv.gz"),
                              "--histories", str(tmp_path / "missing.csv"), "--scratch", str(tmp_path / "scratch"),
                              "--out", str(out)])
    assert _labels(src) == [("2024-01-01", "Overheating")]
    assert not (tmp_path / "scratch").exists()


# Codex S-8: a refresh during a run cannot pass the replica check on one
# version of the database and report results from another.

def _refresh(path):
    import sqlite3

    with sqlite3.connect(path) as c:
        c.execute("UPDATE regimes SET label = 'Stagflation'")


class _Stop(Exception):
    pass


def test_the_regime_run_validates_and_compares_one_snapshot(tmp_path, monkeypatch):
    from scripts.research import alfred as al, vintage_regime as vr

    src = _db(tmp_path / "store.db")
    seen = {}
    monkeypatch.setattr(al, "load", lambda cache, sid: pd.DataFrame())
    monkeypatch.setattr(vr, "replay_all", lambda ind, cpi: {})
    monkeypatch.setattr(vr, "enforce_replica", lambda diag: None)

    def check(db, reps, ind_t, cpi_t):
        seen["checked"] = (Path(db), _labels(db))
        _refresh(src)  # a refresh lands after validation
        return {}

    def served(db):
        seen["compared"] = (Path(db), _labels(db))
        raise _Stop

    monkeypatch.setattr(vr, "check_replica", check)
    monkeypatch.setattr(vr, "served_rows", served)
    with pytest.raises(_Stop):
        vr.run(tmp_path / "cache", src, tmp_path / "out")
    (p1, l1), (p2, l2) = seen["checked"], seen["compared"]
    assert p1 == p2 and p1.resolve() != src.resolve()
    assert l1 == l2 == [("2024-01-01", "Overheating")]
    assert _labels(src) == [("2024-01-01", "Stagflation")]  # the refresh happened; the run never saw it
    assert not p1.exists()  # the snapshot is removed when the run ends


def test_the_recession_run_checks_and_fits_on_one_snapshot(tmp_path, monkeypatch):
    from scripts.research import alfred as al, vintage_recession as vrec
    from src.analytics import recession as rec

    src = _db(tmp_path / "store.db")
    seen = {}
    monkeypatch.setattr(al, "load", lambda cache, sid: pd.DataFrame())
    monkeypatch.setattr(rec, "_load_raw", lambda sid, conn, scale=1.0: pd.Series(dtype=float))
    monkeypatch.setattr(al, "store_gap", lambda stored, table: {})

    def store_ok(gaps):
        _refresh(src)  # a refresh lands after the store check

    def fit():
        seen["fit"] = (Path(rec.DB_PATH), _labels(rec.DB_PATH))
        raise _Stop

    original = rec.DB_PATH
    monkeypatch.setattr(al, "enforce_store_match", store_ok)
    monkeypatch.setattr(rec, "train_recession_model", fit)
    with pytest.raises(_Stop):
        vrec.run(tmp_path / "cache", src, tmp_path / "out")
    path, labels = seen["fit"]
    assert path.resolve() != src.resolve() and labels == [("2024-01-01", "Overheating")]
    assert _labels(src) == [("2024-01-01", "Stagflation")]
    assert rec.DB_PATH == original  # the module's path is restored
