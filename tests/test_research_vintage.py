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


# Codex S-9, S-10: the studies run refuses replay artifacts made from another
# version of the database, or a histories file paired with another replay.

def _regimes_db(path, labels=("Overheating", "Stagflation"), prob=0.4):
    import sqlite3

    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE regimes (date TEXT, label TEXT, computed_at TEXT, prob_goldilocks REAL, "
                  "prob_overheating REAL, prob_stagflation REAL, prob_recession REAL, growth_trend REAL, inflation_trend REAL)")
        for i, lab in enumerate(labels):
            c.execute("INSERT INTO regimes VALUES (?, ?, '2026-11-03T00:00:00', 0.2, ?, 0.2, 0.2, 0.1, 0.3)",
                      (f"2024-0{i + 1}-01", lab, prob))
    return path


def _table_csv(by_v):
    long = pd.DataFrame([(v, m, lab) for v, d in sorted(by_v.items()) for m, lab in d.items()],
                        columns=["vintage", "month", "label"])
    return long.to_csv(index=False).encode()


def _artifacts(labels=("Overheating", "Stagflation"), prob=0.4, later=None):
    """Histories for `labels` (first known in vintage 2024-05-15) and the
    replay they came from; `later` adds a later vintage's labels."""
    from scripts.research.vintage_regime import REPLAY_COL, replay_digest

    months = [f"2024-0{i + 1}" for i in range(len(labels))]
    by_v = {"2024-05-15": dict(zip(months, labels))}
    if later:
        by_v["2024-06-14"] = dict(zip(months, later))
    h = pd.DataFrame({"served": list(labels), "served_prob_goldilocks": 0.2, "served_prob_overheating": prob,
                      "served_prob_stagflation": 0.2, "served_prob_recession": 0.2, "served_growth_trend": 0.1,
                      "served_inflation_trend": 0.3, "first_known": list(labels), "first_known_vintage": "2024-05-15",
                      "at_governed_start": list(labels), REPLAY_COL: replay_digest(_table_csv(by_v))},
                     index=pd.Index(months, name="month"))
    return h, by_v


def _digest(by_v):
    from scripts.research.vintage_regime import replay_digest

    return replay_digest(_table_csv(by_v))


def test_artifacts_from_this_database_pass(tmp_path):
    from scripts.research.vintage_studies import check_artifacts

    h, by_v = _artifacts()
    check_artifacts(_regimes_db(tmp_path / "s.db"), h, by_v, _digest(by_v))


@pytest.mark.parametrize("db_kw, words", [
    ({"labels": ("Overheating", "Recession")}, "served labels differ"),
    ({"labels": ("Overheating", "Stagflation", "Goldilocks")}, "served months"),
    ({"prob": 0.41}, "prob_overheating differs"),
])
def test_artifacts_from_another_database_version_are_refused(tmp_path, db_kw, words):
    from scripts.research.vintage_studies import ArtifactMismatch, check_artifacts

    h, by_v = _artifacts()
    with pytest.raises(ArtifactMismatch, match=words):
        check_artifacts(_regimes_db(tmp_path / "s.db", **db_kw), h, by_v, _digest(by_v))


def test_a_histories_file_paired_with_another_replay_is_refused(tmp_path):
    from scripts.research.vintage_studies import ArtifactMismatch, check_artifacts

    h, _ = _artifacts()
    _, other = _artifacts(labels=("Overheating", "Goldilocks"))
    with pytest.raises(ArtifactMismatch, match="first-known labels"):
        check_artifacts(_regimes_db(tmp_path / "s.db"), h, other, _digest(other))


def _write(tmp_path, h, by_v):
    import gzip

    h.to_csv(tmp_path / "histories.csv")
    (tmp_path / "labels.csv.gz").write_bytes(gzip.compress(_table_csv(by_v)))


def _studies(tmp_path, src):
    from scripts.research import vintage_studies as vs

    vs.main(["--db", str(src), "--labels", str(tmp_path / "labels.csv.gz"), "--histories", str(tmp_path / "histories.csv"),
             "--scratch", str(tmp_path / "scratch"), "--out", str(tmp_path / "out")])


def test_the_studies_run_stops_on_stale_artifacts_before_any_study(tmp_path, monkeypatch):
    from scripts.research import vintage_studies as vs

    src = _regimes_db(tmp_path / "store.db", labels=("Overheating", "Recession"))  # refreshed since the replay
    _write(tmp_path, *_artifacts())
    monkeypatch.setattr(vs, "run_catalog", _no_load)
    with pytest.raises(vs.ArtifactMismatch, match="served labels differ"):
        _studies(tmp_path, src)
    assert not (tmp_path / "out").exists()


def test_a_replay_that_differs_only_after_first_release_is_refused(tmp_path, monkeypatch):
    """S-10: both tables agree on every first-known label, but a later
    vintage differs (the label a study session reads); the digest refuses it."""
    from scripts.research import vintage_studies as vs

    src = _regimes_db(tmp_path / "store.db")
    h, mine = _artifacts(later=("Overheating", "Stagflation"))
    _, other = _artifacts(later=("Overheating", "Recession"))
    assert all(other["2024-05-15"][m] == lab for m, lab in zip(h.index, h["first_known"]))
    _write(tmp_path, h, other)
    monkeypatch.setattr(vs, "run_catalog", _no_load)
    with pytest.raises(vs.ArtifactMismatch, match="not the histories' replay digest"):
        _studies(tmp_path, src)
    _write(tmp_path, h, mine)  # the matching pair gets past the check to the studies
    with pytest.raises(AssertionError, match="computation started"):
        _studies(tmp_path, src)


def test_histories_without_a_replay_digest_are_refused(tmp_path):
    from scripts.research.vintage_regime import REPLAY_COL
    from scripts.research.vintage_studies import ArtifactMismatch, check_artifacts

    h, by_v = _artifacts()
    with pytest.raises(ArtifactMismatch, match="none recorded"):
        check_artifacts(_regimes_db(tmp_path / "s.db"), h.drop(columns=[REPLAY_COL]), by_v, _digest(by_v))


def test_the_replay_digest_covers_exactly_the_bytes_the_studies_parse(tmp_path):
    import gzip

    from scripts.research.vintage_studies import read_replay

    _, by_v = _artifacts(later=("Goldilocks", "Recession"))
    (tmp_path / "t.csv.gz").write_bytes(gzip.compress(_table_csv(by_v), mtime=0))
    digest, vdates, parsed = read_replay(tmp_path / "t.csv.gz")
    assert digest == _digest(by_v) and vdates == ["2024-05-15", "2024-06-14"] and parsed == by_v


# Verifier finding: the study's regime-sentence filter dropped the engine's
# ranking claim ("... concentrated in X ...; weakest in Y ..."), so reversed
# and withdrawn strongest/weakest claims were never counted. Sentences below
# are the engine's own output for catalog studies on 2026-11-03 data.

_RANKED = "At 20 sessions the response is concentrated in Overheating (n = 51, median +1.8%); weakest in Stagflation (n = 26, median +0.9%)."
_TIE = ("The two leading regimes at 20 sessions are within 0.5 percentage points of each other (Overheating n = 69, median +1.7%; "
        "Goldilocks n = 11, median +1.5%); no strongest or weakest claim.")
_SINGLE = "Only Overheating reaches n ≥ 10 at 20 sessions (n = 24, median +0.4%); no ranking across regimes."
_NONE = "No regime reaches n = 10 at 20 sessions, so the split is not informative."
_SMALL = "n<10: Goldilocks (9), Recession Risk (3), Unlabeled (23, outside the totals)."
_OTHER = ["Insufficient data at 120 sessions (n = 0 completed windows).",
          "Sample since 1996 (data from 1996-03-01; events evaluable 1996-06-03 to 2026-09-30); 89 events after a 20-session cooldown."]


@pytest.mark.parametrize("claim", [_RANKED, _TIE, _SINGLE, _NONE])
def test_the_regime_sentences_keep_every_kind_of_ranking_claim(claim):
    from scripts.research.vintage_studies import _regime_sentences, regime_claim

    sentences = [_OTHER[0], claim, _SMALL, _OTHER[1]]
    assert _regime_sentences(sentences) == [claim, _SMALL]
    assert regime_claim(sentences) == claim


def test_claim_outcomes_ignore_numbers_and_see_reversals():
    from scripts.research.vintage_studies import claim_outcome

    assert claim_outcome(_RANKED) == {"kind": "ranked", "strongest": "Overheating", "weakest": "Stagflation"}
    assert claim_outcome(_TIE) == {"kind": "tie", "regimes": ["Goldilocks", "Overheating"]}
    assert claim_outcome(_SINGLE) == {"kind": "single", "regime": "Overheating"}
    assert claim_outcome(_NONE) == {"kind": "none"} and claim_outcome(None) == {"kind": "missing"}
    reversed_ = _RANKED.replace("Overheating", "X").replace("Stagflation", "Overheating").replace("X", "Stagflation")
    assert claim_outcome(reversed_) != claim_outcome(_RANKED)
    assert claim_outcome(_RANKED.replace("+1.8%", "+2.0%")) == claim_outcome(_RANKED)
    with pytest.raises(ValueError):
        claim_outcome("At 20 sessions something new.")


def _res(claim, cells):
    return {"result": {"regimes": [{"regime": r, "horizons": [{"h": 20, "n": n, "median": m, "note": "n<10" if n < 10 else None}]}
                                   for r, (n, m) in cells.items()],
                       "horizons": [{"h": 20, "n": 89, "median": 0.01}], "verdict": {"sentences": [claim, _OTHER[1]]}},
            "events": [("2020-01-02", "Overheating")]}


def test_compare_counts_a_reversed_ranking_as_a_changed_outcome():
    from scripts.research.vintage_studies import compare

    reversed_ = "At 20 sessions the response is concentrated in Stagflation (n = 23, median +1.9%); weakest in Overheating (n = 55, median +1.4%)."
    c = compare({"s": _res(_RANKED, {"Overheating": (51, .018), "Stagflation": (26, .009)})},
                {"s": _res(reversed_, {"Overheating": (55, .014), "Stagflation": (23, .019)})})["s"]
    assert c["regime_outcome_changed"] and c["regime_verdict_changed"] and c["split_changed"]
    assert c["eligible_served"] == c["eligible_alt"] == ["Overheating", "Stagflation"]
    assert c["regime_outcome_alt"] == {"kind": "ranked", "strongest": "Stagflation", "weakest": "Overheating"}
