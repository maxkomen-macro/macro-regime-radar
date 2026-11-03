"""The ledger reader's pure rules in src/events/earnings_store.py (design LR sections 2.1, 3.2, 3.4).

`continues(older, newer)` is true only when `newer` could have come from `older` by the cache's own writes; every
evidence-bearing field the read-time rules consult is checked (days, withdrawn, provisional, occ: DR-24, DR-25,
DR-31). `open_ledger_bounded` opens a ledger asset under a plaintext cap with a complete stream and a schema check
(DR-30, DR-33). `material` is the part of a coverage answer that decides what may be said (no provenance times).
"""

from __future__ import annotations

import base64
import copy
import json
import os
import zlib
from datetime import timedelta

import pytest

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


def two_runs(mod, db):
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    return rows


def ledger_vaults(db):
    """Every ledger asset the release holds, opened, by seq (the newest two are kept)."""
    rel = release_of(db)
    out = {}
    for n in rel.ledger_names():
        seq = store.ledger_seq(n)
        o = store.open_ledger(rel.assets[n], SECRET, seq)
        assert o.status == "ok"
        out[seq] = o.vault
    return out


SESSION = TODAY + timedelta(days=2)


# ── continues: the cache's own sequences continue ────────────────────────────

def test_a_reservation_then_its_final_state_continue(mod, db):
    run(mod, db, Finnhub(_reconciled_market(), None))
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=20)))
    vs = ledger_vaults(db)
    (a, va), (b, vb) = sorted(vs.items())
    assert b == a + 1
    assert va["provisional"] and not vb["provisional"]  # the reservation, then its run's own final state
    assert store.continues(va, vb)
    assert store.continues(vb, vb)


def test_a_published_vault_and_the_next_runs_states_continue(mod, db, tmp_path):
    two_runs(mod, db)
    p = vault_of(db).vault
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=40)))
    newest = max(ledger_vaults(db).items())[1]
    assert newest["seq"] > p["seq"]
    assert store.continues(p, newest)


def test_a_failed_run_withdrawing_days_continues_and_the_reverse_does_not(mod, db):
    rows = two_runs(mod, db)
    p = vault_of(db).vault
    run(mod, db, Finnhub(rows, None, fail_at={1: 429}), clock=Clock(NOW + timedelta(hours=44)))
    newest = max(ledger_vaults(db).items())[1]
    assert newest["withdrawn"]
    assert store.continues(p, newest)
    assert not store.continues(newest, p)  # the older state lacks the newer withdrawal


def test_a_conservative_restart_record_continues(mod, db):
    two_runs(mod, db)
    p = copy.deepcopy(vault_of(db).vault)
    rel = release_of(db)
    for n in rel.ledger_names():
        rel.assets[n] = b"not a ledger"  # unreadable newest asset -> the next run restarts conservatively
    run(mod, db, Finnhub(_reconciled_market(), None), clock=Clock(NOW + timedelta(hours=40)))
    restart = vault_of(db).vault
    assert restart["seq"] > p["seq"]
    assert store.continues(p, restart)


# ── continues: forks break ───────────────────────────────────────────────────

@pytest.fixture
def pair(mod, db):
    rows = two_runs(mod, db)
    older = vault_of(db).vault
    run(mod, db, Finnhub(rows, None, fail_at={1: 429}), clock=Clock(NOW + timedelta(hours=44)))
    newer = max(ledger_vaults(db).items())[1]
    assert store.continues(older, newer)
    return older, newer


def test_dropping_a_withdrawal_breaks_continuity(pair):
    older, newer = pair
    fork = copy.deepcopy(newer)
    fork2 = copy.deepcopy(fork)
    d = sorted(fork2["withdrawn"])[-1]
    del fork2["withdrawn"][d]
    assert not store.continues(fork, fork2)


def test_lowering_a_withdrawal_breaks_continuity(pair):
    _, newer = pair
    fork = copy.deepcopy(newer)
    d = sorted(fork["withdrawn"])[-1]
    fork["withdrawn"][d] = store.iso(store.at(fork["withdrawn"][d]) - timedelta(seconds=1))
    assert not store.continues(newer, fork)


def test_dropping_a_non_passing_day_entry_breaks_continuity_dr24(mod, db):
    two_runs(mod, db)
    older = copy.deepcopy(vault_of(db).vault)
    d = SESSION.isoformat()
    bad = dict(older["days"][d][0], status=store.INCONSISTENT, at=store.iso(NOW + timedelta(hours=30)))
    held = copy.deepcopy(older)
    held["days"][d] = [bad] + held["days"][d][:1]
    assert store.continues(older, held)
    assert not store.continues(held, older)  # the fork restores the two passing reads over a contradiction


def test_one_newer_read_cannot_retire_a_withdrawal_dr25(pair):
    _, newer = pair
    d = sorted(newer["withdrawn"])[-1]
    b = store.at(newer["withdrawn"][d])
    fork = copy.deepcopy(newer)
    del fork["withdrawn"][d]
    entry = dict((fork["days"].get(d) or [{"run": store.iso(b), "status": store.PASSING, "complete": True, "rows": []}])[0])
    entry["at"] = store.iso(b + timedelta(minutes=30))
    fork["days"][d] = [entry] + list(fork["days"].get(d) or [])[:1]
    assert not store.continues(newer, fork)


def test_a_reservation_that_vanishes_without_conversion_or_a_final_record_breaks(mod, db):
    run(mod, db, Finnhub(_reconciled_market(), None))
    vs = ledger_vaults(db)
    va = min(vs.items())[1]
    assert va["provisional"]
    fork = copy.deepcopy(va)
    fork["provisional"] = {}
    for r in fork["runs"]:
        r["provisional"] = True  # its run is still not final, and nothing converted its days
    fork["seq"] = va["seq"] + 1
    assert not store.continues(va, fork)


def test_dropping_an_occurrence_or_one_of_its_labels_breaks_continuity_dr31(mod, db):
    two_runs(mod, db)
    older = vault_of(db).vault
    k = next(k for k, o in older["occ"].items() if o["s"] == "ZQZZ9" and o["labels"])
    gone = copy.deepcopy(older)
    del gone["occ"][k]
    assert not store.continues(older, gone)
    two = copy.deepcopy(older)
    two["occ"][k]["labels"] = two["occ"][k]["labels"] + [[2027, 1]]
    assert store.continues(older, two)  # the writer appends labels
    assert not store.continues(two, older)  # a label seen cannot disappear
    rep = copy.deepcopy(older)
    kr = next(k for k, o in older["occ"].items() if o["reported"])
    rep["occ"][kr]["reported"] = []
    assert not store.continues(older, rep)
    first = copy.deepcopy(older)
    first["occ"][k]["f"] = store.iso(NOW + timedelta(days=1))
    assert not store.continues(older, first)


def test_days_below_the_pruning_floor_may_vanish(mod, db):
    two_runs(mod, db)
    older = copy.deepcopy(vault_of(db).vault)
    old_day = (TODAY - timedelta(days=60)).isoformat()
    older["days"][old_day] = [{"run": store.iso(NOW), "at": store.iso(NOW), "status": store.PASSING,
                               "complete": True, "rows": []}]
    older["withdrawn"][old_day] = store.iso(NOW)
    assert store.continues(older, vault_of(db).vault)


def test_malformed_input_never_continues(mod, db):
    two_runs(mod, db)
    v = vault_of(db).vault
    assert not store.continues(v, {"days": "x"})
    assert not store.continues({"occ": [1]}, v)


# ── material ─────────────────────────────────────────────────────────────────

def test_material_leaves_out_provenance_times_only(mod, db):
    two_runs(mod, db)
    v = vault_of(db).vault
    raws = store.index(v)["ZQZZ9"]
    a = store.coverage(v, raws, SESSION, NOW + timedelta(hours=21))
    assert a.state == "reconciled"
    moved = copy.deepcopy(raws)
    for r in moved:
        r["l"] = store.iso(store.at(r["l"]) + timedelta(hours=1))
    b = store.coverage(v, moved, SESSION, NOW + timedelta(hours=21))
    assert store.material(a) == store.material(b)
    other = store.coverage(v, raws, SESSION + timedelta(days=30), NOW + timedelta(hours=21))
    assert store.material(other) != store.material(a)


def test_the_rules_leave_their_inputs_unchanged(pair):
    older, newer = pair
    before = json.dumps([older, newer], sort_keys=True)
    store.continues(older, newer)
    store.continues(newer, older)
    raws = store.index(newer).get("ZQZZ9", [])
    store.material(store.coverage(newer, raws, SESSION, NOW + timedelta(hours=45)))
    assert json.dumps([older, newer], sort_keys=True) == before


# ── open_ledger_bounded ──────────────────────────────────────────────────────

def _seal_raw(plain: bytes, seq: int, *, secret=SECRET, fmt=store.LEDGER_FORMAT):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    blob = AESGCM(store._hkdf(secret, b"aes-key", 32)).encrypt(nonce, plain, store.LEDGER_AAD)
    return json.dumps({"format": fmt, "key_id": store.key_id(secret), "seq": seq, "written_at": store.iso(NOW),
                       "nonce": base64.b64encode(nonce).decode(), "blob": base64.b64encode(blob).decode()}).encode()


def _vault(seq=3):
    v = store.empty_vault()
    v["seq"] = seq
    return v


def test_a_real_asset_opens_like_open_ledger(mod, db):
    two_runs(mod, db)
    rel = release_of(db)
    n = rel.ledger_names()[-1]
    seq = store.ledger_seq(n)
    a = store.open_ledger_bounded(rel.assets[n], SECRET, seq)
    assert a.status == "ok" and a.vault == store.open_ledger(rel.assets[n], SECRET, seq).vault
    assert store.open_ledger_bounded(rel.assets[n], SECRET, seq + 1).status == "unreadable"  # name and body disagree
    assert store.open_ledger_bounded(rel.assets[n], "another-key", seq).status == "rotated"


def test_a_truncated_or_trailing_stream_is_unreadable_dr33():
    good = zlib.compress(json.dumps(_vault()).encode(), 9)
    assert store.open_ledger_bounded(_seal_raw(good, 3), SECRET, 3).status == "ok"
    assert store.open_ledger_bounded(_seal_raw(good[:-4], 3), SECRET, 3).status == "unreadable"  # checksum gone
    assert store.open_ledger_bounded(_seal_raw(good + b"tail", 3), SECRET, 3).status == "unreadable"


def test_plaintext_over_the_cap_is_unreadable_dr30(monkeypatch):
    monkeypatch.setattr(store, "MAX_PLAIN", 4096)
    v = _vault()
    v["runs"] = [{"id": "x" * 100}] * 60  # about 6 KB of JSON, compressing to very little
    raw = _seal_raw(zlib.compress(json.dumps(v).encode(), 9), 3)
    assert len(raw) < 4096
    assert store.open_ledger_bounded(raw, SECRET, 3).status == "unreadable"


@pytest.mark.parametrize("breach", ["days", "rows", "entries", "occ", "runs", "type", "format"])
def test_a_vault_breaking_the_schema_limits_is_unreadable(breach, monkeypatch):
    v = _vault()
    if breach == "days":
        monkeypatch.setattr(store, "LEDGER_LIMITS", dict(store.LEDGER_LIMITS, days=2))
        v["days"] = {f"2026-11-0{i}": [] for i in range(1, 4)}
    elif breach == "rows":
        monkeypatch.setattr(store, "LEDGER_MAX_ROWS", 2)
        v["days"] = {"2026-11-01": [{"at": store.iso(NOW), "rows": [["A", "amc", 2026, 3, 0]] * 3}]}
    elif breach == "entries":
        v["days"] = {"2026-11-01": [{"at": store.iso(NOW), "rows": []}] * (store.DAY_ENTRIES + 1)}
    elif breach == "occ":
        monkeypatch.setattr(store, "LEDGER_LIMITS", dict(store.LEDGER_LIMITS, occ=1))
        v["occ"] = {f"A|2026-11-0{i}": {"s": "A", "d": f"2026-11-0{i}", "f": store.iso(NOW), "l": store.iso(NOW),
                                        "labels": [], "reported": []} for i in (1, 2)}
    elif breach == "runs":
        monkeypatch.setattr(store, "LEDGER_LIMITS", dict(store.LEDGER_LIMITS, runs=1))
        v["runs"] = [{}, {}]
    elif breach == "type":
        v["occ"] = []
    elif breach == "format":
        v["format"] = 2
    raw = _seal_raw(zlib.compress(json.dumps(v).encode(), 9), 3)
    assert store.open_ledger_bounded(raw, SECRET, 3).status == "unreadable"
