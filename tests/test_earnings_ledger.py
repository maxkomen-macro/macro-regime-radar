"""The earnings cache's durable ledger and failure recovery (design EC section 9; Amendment A-1, item EC7).

The owner's required recovery tests (2026-10-30 01:41 UTC) are marked REQUIRED: provider calls followed by a
refresh failure, a 429 followed by a restart, an unavailable or unreadable ledger, a failed publication, and newer
contradictory evidence alongside an older database snapshot. Also pinned: immutable sequenced assets (no
--clobber), the reservation in the release before the first call, the conservative restart and its barrier, the
equal-seq start after a fully successful run, pruning that never drops the newest state, the reservation's upper
bound for spacing and the 429 pace, provisional withdrawals and anchor provenance.

"A refresh fails" is played as the workflow sees it: the database the run changed is not published, so the next
run starts from the previously published copy (restored here), while the ledger assets stay in the release.
"""

from __future__ import annotations

import shutil
from datetime import timedelta

import pytest

from src.events import earnings_ledger as ledger
from src.events import earnings_store as store
from tests.test_earnings_cache import (  # noqa: F401  (fixtures)
    NOW,
    SECRET,
    TODAY,
    Clock,
    Finnhub,
    _no_network,
    _reconciled_market,
    db,
    market,
    mod,
    release_of,
    run,
    vault_of,
)


def unpublished(db_path, snapshot):
    """The refresh failed validation: its database is not published; the next run downloads the old one."""
    shutil.copy(snapshot, db_path)


def snapshot_of(db_path, tmp_path, name):
    out = tmp_path / name
    shutil.copy(db_path, out)
    return out


# ── the assets ───────────────────────────────────────────────────────────────

def test_a_run_writes_a_reservation_asset_before_its_first_call_and_a_final_one_after(mod, db):
    rel = release_of(db)
    seen = {}

    def first_call_check(url, params=None, timeout=None, stream=False):
        if not seen:
            seen["assets"] = rel.ledger_names()
        return inner(url, params=params, timeout=timeout, stream=stream)

    inner = Finnhub(market(), Clock(NOW))
    res, _, _, _ = run(mod, db, first_call_check)
    assert seen["assets"] == [store.ledger_name(1)]  # the reservation was in the release before any call
    assert rel.ledger_names() == [store.ledger_name(1), store.ledger_name(2)] and res.status == "passing"
    reservation = store.open_ledger(rel.assets[store.ledger_name(1)], SECRET, 1).vault
    rec = reservation["runs"][-1]
    assert rec["provisional"] is True and rec["calls"] == 40 and rec["saw_429"] is True
    assert store.at(rec["finished"]) - store.at(rec["started"]) == timedelta(minutes=10)  # DR-23 upper bound
    assert len(reservation["provisional"][rec["id"]]["days"]) == 127
    final = store.open_ledger(rel.assets[store.ledger_name(2)], SECRET, 2).vault
    assert final["provisional"] == {} and final == vault_of(db).vault and final["seq"] == 2


def test_a_successful_run_leaves_equal_copies_and_the_next_run_starts_normally(mod, db):
    """DR-16: equal seqs with identical states are the normal case, not a conflict."""
    run(mod, db)
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert res.status == "passing" and len(fake.calls) == 19
    assert release_of(db).ledger_names() == [store.ledger_name(3), store.ledger_name(4)]  # pruned to two


def test_the_reservation_upload_failing_means_no_call_and_no_write(mod, db):
    rel = release_of(db)
    rel.upload_fails = 1
    res, fake, _, _ = run(mod, db)
    assert "the ledger could not be written" in res.line and not fake.calls
    assert rel.ledger_names() == [] and vault_of(db).status == "absent"


# ── REQUIRED: provider calls followed by a refresh failure ──────────────────

def test_REQUIRED_calls_followed_by_a_failed_refresh_are_still_counted(mod, db, tmp_path):
    published = snapshot_of(db, tmp_path, "published.db")
    res, fake, _, _ = run(mod, db)
    assert res.status == "passing" and len(fake.calls) == 19
    unpublished(db, published)
    assert vault_of(db).status == "absent"  # the published database never saw the run
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=1)))
    assert "less than 10 hours ago" in res.line and not fake.calls  # spacing from the ledger
    v = vault_of(db).vault
    assert any(r.get("calls_by_utc_date") == {NOW.date().isoformat(): 19} for r in v["runs"])


def test_REQUIRED_a_cancelled_or_lost_run_leaves_its_reservation_counted(mod, db, tmp_path):
    published = snapshot_of(db, tmp_path, "published.db")

    def lost(url, params=None, timeout=None, stream=False):
        raise KeyboardInterrupt  # the runner is cancelled or lost mid-call: no final write

    with pytest.raises(KeyboardInterrupt):
        run(mod, db, lost)
    unpublished(db, published)
    assert release_of(db).ledger_names() == [store.ledger_name(1)]
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=9, minutes=59)))
    assert "less than 10 hours ago" in res.line and not fake.calls  # 10 h from the reservation's upper bound
    res, fake, sleeps, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert len(fake.calls) == 19 and sleeps[1:3] == [12.0, 12.0]  # its 429 is assumed: the slow pace


# ── REQUIRED: a 429 followed by a restart ───────────────────────────────────

def test_REQUIRED_a_429_followed_by_a_failed_refresh_keeps_the_slow_pace(mod, db, tmp_path):
    published = snapshot_of(db, tmp_path, "published.db")
    res, _, _, _ = run(mod, db, Finnhub(market(), None, fail_at={5: 429}))
    assert "HTTP 429" in res.line
    unpublished(db, published)
    res, fake, sleeps, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert sleeps[1:3] == [12.0, 12.0], res.line
    res2, _, sleeps2, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=40, minutes=11)))  # 24 h after its end
    assert sleeps2[1:3] == [12.0, 12.0] or "trading hours" in res2.line or "10 hours" in res2.line


# ── REQUIRED: an unavailable or unreadable ledger ───────────────────────────

@pytest.mark.parametrize("failure", ["list", "download"])
def test_REQUIRED_an_unavailable_ledger_means_no_call_and_no_write(mod, db, failure):
    run(mod, db)
    rel = release_of(db)
    before = dict(rel.assets)
    rel.fail.add(failure)
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert "the ledger could not be read" in res.line and not fake.calls and rel.assets == before


def test_a_ledger_name_out_of_sequence_form_is_unavailable(mod, db):
    run(mod, db)
    rel = release_of(db)
    rel.assets[store.LEDGER_PREFIX + "12.bin"] = b"x"
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert "the ledger could not be read" in res.line and not fake.calls


@pytest.mark.parametrize("case", ["corrupt", "missing", "conflict"])
def test_REQUIRED_an_unreadable_missing_or_conflicting_ledger_restarts_conservatively(mod, db, case):
    rel = release_of(db)
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    top = rel.ledger_names()[-1]
    if case == "corrupt":
        rel.assets[top] = rel.assets[top][:-9] + b"truncated"
    elif case == "missing":
        rel.assets.clear()
    else:  # the same seq, another state
        v = store.open_ledger(rel.assets[top], SECRET, store.ledger_seq(top)).vault
        v["runs"] = []
        rel.assets[top] = store.seal_ledger(v, SECRET, store.ledger_seq(top), NOW)
    later = NOW + timedelta(hours=44)
    res, fake, _, _ = run(mod, db, Finnhub(rows, None), clock=Clock(later))
    assert "accounting uncertain" in res.line and not fake.calls
    v = vault_of(db).vault
    session = later.astimezone(store.timezone.utc).date()
    assert v["runs"][-1]["calls_by_utc_date"] == {later.date().isoformat(): 80} and v["runs"][-1]["saw_429"] is True
    cov = store.coverage(v, store.index(v)["ZQZZ9"], TODAY + timedelta(days=2), later)
    assert cov.state == "unconfirmed"  # DR-17: the barrier withdraws every older read
    # DR-22: the restart is the newest asset, survives pruning and is what the next run starts from
    names = rel.ledger_names()
    assert store.ledger_seq(names[-1]) > store.ledger_seq(top) and len(names) <= 2
    assert store.open_ledger(rel.assets[names[-1]], SECRET, store.ledger_seq(names[-1])).status == "ok"
    del session
    res, fake, _, _ = run(mod, db, Finnhub(rows, None), clock=Clock(later + timedelta(hours=1)))
    assert "less than 10 hours ago" in res.line and not fake.calls  # the restart's record holds spacing


# ── REQUIRED: a failed publication ──────────────────────────────────────────

def test_REQUIRED_a_final_upload_that_fails_is_published_by_the_always_run_step(mod, db, tmp_path):
    rel = release_of(db)
    published = snapshot_of(db, tmp_path, "published.db")
    real_upload = ledger.upload
    calls = {"n": 0}

    def flaky(directory, path, gh):
        calls["n"] += 1
        return False if calls["n"] == 2 else real_upload(directory, path, gh)  # the final upload fails

    import src.events.earnings_cache as ec

    ec.ledger.upload = flaky
    try:
        res, _, _, _ = run(mod, db)
    finally:
        ec.ledger.upload = real_upload
    assert res.status == "passing" and rel.ledger_names() == [store.ledger_name(1)]
    assert ledger.publish_pending(db.parent, rel) == "uploaded"
    assert rel.ledger_names() == [store.ledger_name(1), store.ledger_name(2)]
    unpublished(db, published)
    v = None
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    assert res.status == "passing" and len(fake.calls) == 19
    v = vault_of(db).vault
    assert [r["status"] for r in v["runs"]] == ["passing", "passing"]  # the exact record, not the reservation


def test_REQUIRED_a_final_upload_that_never_lands_leaves_the_conservative_reservation(mod, db, tmp_path):
    rel = release_of(db)
    published = snapshot_of(db, tmp_path, "published.db")
    res, _, _, _ = run(mod, db, Finnhub(market(), None))
    rel.assets.pop(store.ledger_name(2))  # as if the final upload and the always-run step both failed
    unpublished(db, published)
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=5)))
    assert "less than 10 hours ago" in res.line and not fake.calls
    v = vault_of(db).vault
    assert v["runs"][0]["calls_by_utc_date"] == {NOW.date().isoformat(): 40}  # the reservation's charge


def test_the_always_run_step_with_nothing_pending_does_nothing(mod, db):
    run(mod, db)
    rel = release_of(db)
    before = list(rel.calls)
    assert ledger.publish_pending(db.parent, rel) == "none" and rel.calls == before


# ── REQUIRED: newer contradictory evidence alongside an older database snapshot ─

def test_REQUIRED_a_newer_contradiction_reaches_the_reader_at_the_next_publish_or_after_48_hours(mod, db, tmp_path):
    """Design 9.6: the Finder reads the published database only. A contradiction seen by a run whose refresh
    fails stays in the ledger; the older snapshot keeps its coverage until the Finder adopts a database carrying
    the contradiction (a later run writes it into the vault table), or until its newest read is 48 hours old."""
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    snapshot = snapshot_of(db, tmp_path, "snapshot.db")  # published, reconciled
    later = NOW + timedelta(hours=44)
    session = TODAY + timedelta(days=2)

    def coverage_in(path, now):
        import sqlite3

        conn = sqlite3.connect(path)
        try:
            v = store.open_vault(conn, SECRET).vault
        finally:
            conn.close()
        return store.coverage(v, store.index(v)["ZQZZ9"], session, now)

    assert coverage_in(snapshot, later).state == "reconciled"
    res, _, _, _ = run(mod, db, Finnhub(rows, None, fail_at={1: 429}), clock=Clock(later))
    assert res.status == "failed"
    unpublished(db, snapshot)  # the refresh failed: the Finder keeps the snapshot
    assert coverage_in(db, later + timedelta(hours=1)).state == "reconciled"  # 9.6: not withdrawn by itself
    newest_read = store.at(vault_of(db).vault["days"][session.isoformat()][0]["at"])
    assert coverage_in(db, newest_read + timedelta(hours=48)).state == "unconfirmed"  # (b) freshness
    # (a) a later run that reads the ledger writes the contradiction into the vault table it publishes
    res, fake, sleeps, _ = run(mod, db, Finnhub(rows, None), clock=Clock(later + timedelta(hours=1)))
    assert fake.calls and sleeps and min(sleeps) >= 12  # the 429 an hour ago keeps the slow pace
    # one read now postdates the withdrawal; both must (S-4), so the published coverage stays unknown
    assert coverage_in(db, later + timedelta(hours=1)).state == "unconfirmed"


# ── reader-side details ─────────────────────────────────────────────────────

def test_a_provisional_withdrawal_counts_only_after_its_run_can_no_longer_be_running(mod, db):
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    v = vault_of(db).vault
    t = NOW + timedelta(hours=30)
    v["provisional"] = {store.iso(t): {"at": store.iso(t), "days": [(TODAY + timedelta(days=2)).isoformat()]}}
    session = TODAY + timedelta(days=2)
    raws = store.index(v)["ZQZZ9"]
    assert store.coverage(v, raws, session, t + timedelta(minutes=14)).state == "reconciled"  # in flight
    assert store.coverage(v, raws, session, t + timedelta(minutes=15)).state == "unconfirmed"
    assert store.contested(v, session, t + timedelta(minutes=15))


def test_a_retained_anchor_keeps_the_run_that_saw_it_reported(mod, db):
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    o = vault_of(db).vault["occ"][f"ZQZZ9|{(TODAY - timedelta(days=3)).isoformat()}"]
    assert o["reported"] == [[2026, 3]] and len(o["reported_by"]) == 1
    y, q, rid, at = o["reported_by"][0]
    assert (y, q) == (2026, 3) and rid == store.iso(NOW) and store.at(at) > NOW
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    o2 = vault_of(db).vault["occ"][f"ZQZZ9|{(TODAY - timedelta(days=3)).isoformat()}"]
    assert o2["reported_by"] == o["reported_by"]  # the first observation is kept, never replaced
