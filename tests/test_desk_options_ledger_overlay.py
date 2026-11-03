"""The Options Finder's earnings coverage against the API's ledger reader (design LR section 3.3; Amendment A-3).

The route runs end to end as in tests/test_desk_options_earnings_cache.py (fake EODHD at the transport, the clock
at Saturday 2026-10-24 14:00 UTC, session Friday Oct 23, an encrypted vault built from synthetic rows). The reader's
snapshot is set directly; the reader itself has its own tests (tests/test_earnings_ledger_reader.py).

Pinned: the rule only withdraws (a published answer or unknown, never more); every reader state but `ok` answers
unknown with the `unchecked` sentence; l < p, l == p and l > p each as design 3.3 says; an older database with a
newer contradiction in the ledger answers unknown at the next request without the database or the generation
changing; an exception in the overlay answers unknown, never the stored rows; a symbol missing from the ledger
index evaluates normally; the Finder response is never cacheable; unknown keeps the published rows; the display
switch off and every other surface ignore the reader.
"""

from __future__ import annotations

import copy
import json
from datetime import timedelta

import pytest

from api import desk_options
from api import earnings_ledger_reader as reader
from src.desk import options_finder as of
from src.events import earnings_store as store
from tests.test_desk_options_api import UP
from tests.test_desk_options_earnings_cache import (  # noqa: F401  (fixtures)
    CHAIN,
    HAND,
    NOW,
    SESSION,
    T1,
    T2,
    assert_unknown,
    earnings,
    modelled,
    vault,
    world,
)

T0 = NOW - timedelta(minutes=30)  # a newer run, after the published one
REAL_CURRENT = reader.current
RECONCILED = of.CACHE_WORDS["reconciled"].format(k="Feb 15, 2027")


def seqd(v: dict, seq: int) -> dict:
    v = copy.deepcopy(v)
    v["seq"] = seq
    return v


def hold(world, v: dict | None, *, status: str = "ok", seq: int | None = None):
    """The reader's snapshot for the rest of the test: `v` as the newest opened ledger state."""
    held = json.loads(json.dumps(v)) if v is not None else None
    s = (held.get("seq") or 0) if seq is None and held is not None else seq
    snap = reader.Snapshot(status, seq=s, asset_id=7, vault=held, index=store.index(held) if held else None,
                           last_success=0.0, high=s)
    world.mp.setattr(reader, "current", lambda: snap)
    return snap


def advance(v: dict, t, *, status: str = "passing", complete: bool = True, days: set | None = None,
            seq: int | None = None) -> dict:
    """`v` after one more run at `t` that read `days` (default every day) as the cache writes it: a new entry in
    front of each day (the newest DAY_ENTRIES kept), copying the newest entry's rows, and each occurrence it listed
    last seen at `t` when that read passed."""
    out = copy.deepcopy(v)
    for d, entries in out["days"].items():
        if days is not None and d not in days:
            continue
        rows = copy.deepcopy(entries[0]["rows"]) if entries else []
        new = {"run": store.iso(t), "at": store.iso(t), "status": status, "complete": complete, "rows": rows}
        out["days"][d] = ([new] + entries)[: store.DAY_ENTRIES]
        if status == "passing":
            for o in out["occ"].values():
                if o["d"] == d:
                    o["l"] = store.iso(t)
    if seq is not None:
        out["seq"] = seq
    return out


P = lambda: seqd(vault(CHAIN), 4)  # noqa: E731 — the published vault, reconciled through Feb 15, 2027


# ── every reader state but ok answers unknown, at once ─────────────────────

@pytest.mark.parametrize("status", ["off", "starting", "stale", "missing", "misnamed", "unreadable", "rotated",
                                    "regressed", "inconsistent", "unauthorized"])
def test_a_reader_without_a_trusted_state_answers_unknown_unchecked(world, status):
    published = P()
    w = world.serve_vault(published, ledger=None)
    hold(w, published if status != "off" else None, status=status)  # the held state is kept, never served
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unchecked"]
    assert_unknown(d)
    # the published rows and their provenance stay listed: a possible report is never dropped
    assert {e["date"] for e in earnings(d)} == {"2026-11-30", "2027-02-15"}
    assert all("last seen Oct 24, 09:00 ET" in e["source"] for e in earnings(d))


def test_the_reader_off_answers_unknown_through_the_real_module(world):
    """No snapshot set: no reader runs in tests, so the module's own `current()` is `off`."""
    w = world.serve_vault(P(), ledger=None)
    w.mp.setattr(reader, "current", REAL_CURRENT)
    assert reader._reader is None and reader.current().status == "off"
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unchecked"]
    assert_unknown(d)


# ── l == p ──────────────────────────────────────────────────────────────────

def test_the_same_seq_and_state_serves_the_published_answer(world):
    published = P()
    w = world.serve_vault(published, ledger=None)
    hold(w, published)
    d = w.ok(**UP)
    assert d["coverage"][0] == RECONCILED
    assert all(of.RECONCILED_FLAG in r["flags"] for r in modelled(d))


def test_the_same_seq_with_another_state_answers_contested(world):
    published = P()
    w = world.serve_vault(published, ledger=None)
    other = copy.deepcopy(published)
    other["withdrawn"] = {SESSION.isoformat(): store.iso(T1)}
    hold(w, other)
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["contested"]
    assert_unknown(d)


# ── l < p: the database is newer ────────────────────────────────────────────

def test_an_older_ledger_that_the_database_continues_serves_the_published_answer(world):
    w = world.serve_vault(P(), ledger=None)
    hold(w, seqd(vault(CHAIN, runs=(T2,), statuses=("passing",), complete=(True,)), 3))
    assert w.ok(**UP)["coverage"][0] == RECONCILED


def test_an_older_ledger_with_a_withdrawal_the_database_lost_answers_contested(world):
    w = world.serve_vault(P(), ledger=None)
    older = seqd(vault(CHAIN), 3)
    older["withdrawn"] = {SESSION.isoformat(): store.iso(T1 + timedelta(minutes=5))}
    hold(w, older)
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["contested"]
    assert_unknown(d)


# ── l > p: the ledger is newer ──────────────────────────────────────────────

def test_a_newer_ledger_that_agrees_serves_the_published_answer_with_its_provenance(world):
    """More passing reads never raise anything: the answer is the published one, its times the published ones."""
    published = P()
    w = world.serve_vault(published, ledger=None)
    newer = advance(published, T0, seq=6)
    assert store.continues(published, newer)
    hold(w, newer)
    d = w.ok(**UP)
    assert d["coverage"][0] == RECONCILED
    assert all("last seen Oct 24, 09:00 ET" in e["source"] for e in earnings(d))  # P's time, not T0's (C4)


def test_REQUIRED_an_older_database_with_a_newer_contradiction_answers_unknown_at_the_next_request(world):
    """Design LR 7.1 (Amendment A-2's pre-display requirement): the database is reconciled; a run whose refresh
    failed validation wrote a failed read of the session day to the ledger only. The next request answers unknown,
    with the database file, the generation and the worker untouched."""
    published = P()
    w = world.serve_vault(published, ledger="same")
    gen = w.worker.current
    path = desk_options_db_path()
    before = path.read_bytes()
    assert w.ok(**UP)["coverage"][0] == RECONCILED
    hold(w, advance(published, T0, status="partial", complete=False, days={SESSION.isoformat()}, seq=5))
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["contested"]
    assert_unknown(d)
    assert w.worker.current is gen and path.read_bytes() == before  # nothing rebuilt, nothing written
    hold(w, published)  # the reader recovers to a state that agrees: the published answer again
    assert w.ok(**UP)["coverage"][0] == RECONCILED


def test_a_newer_ledger_whose_answer_differs_answers_contested_even_when_it_would_say_more(world):
    """Withdraw-only: a ledger state that reconciles further than the database is never served."""
    short = seqd(vault(CHAIN, runs=(T1,), statuses=("passing",), complete=(True,)), 4)  # unconfirmed: one read
    w = world.serve_vault(short, ledger=None)
    hold(w, seqd(vault(CHAIN), 5))
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["contested"]
    assert_unknown(d)


def test_a_newer_ledger_that_forks_from_the_database_answers_contested(world):
    """The same answer but not reachable from P by the cache's writes (a published withdrawal dropped)."""
    published = P()
    published["withdrawn"] = {(SESSION - timedelta(days=3)).isoformat(): store.iso(T2 - timedelta(hours=1))}
    w = world.serve_vault(published, ledger=None)
    newer = advance(published, T0, seq=6)
    newer["withdrawn"] = {}
    assert not store.continues(published, newer)
    hold(w, newer)
    assert w.ok(**UP)["coverage"][0] == of.CACHE_WORDS["contested"]


def test_a_symbol_missing_from_the_ledger_index_evaluates_normally(world):
    """DR-29: no KeyError and no `unchecked`; the ledger lists nothing for it, which differs from P: contested."""
    published = P()
    w = world.serve_vault(published, ledger=None)
    snap = hold(w, advance(published, T0, seq=6))
    w.mp.setattr(reader, "current", lambda: reader.Snapshot("ok", seq=6, asset_id=7, vault=snap.vault, index={},
                                                            last_success=0.0, high=6))
    assert w.ok(**UP)["coverage"][0] == of.CACHE_WORDS["contested"]


# ── failures inside the overlay ─────────────────────────────────────────────

@pytest.mark.parametrize("where", ["current", "coverage", "continues", "seq"])
def test_an_exception_in_the_overlay_answers_unknown_never_the_stored_rows(world, where):
    published = P()
    w = world.serve_vault(published, ledger=None)
    hold(w, advance(published, T0, seq=6))

    def boom(*a, **k):
        raise RuntimeError("synthetic")

    if where == "current":
        w.mp.setattr(reader, "current", boom)
    elif where == "coverage":
        real = store.coverage
        calls = []

        def second_raises(*a, **k):
            calls.append(1)
            if len(calls) > 1:
                raise RuntimeError("synthetic")
            return real(*a, **k)

        w.mp.setattr(store, "coverage", second_raises)
    elif where == "continues":
        w.mp.setattr(store, "continues", boom)
        hold(w, seqd(vault(CHAIN), 3))
    else:
        w.mp.setattr(reader, "current", lambda: reader.Snapshot("ok", seq="x", asset_id=7, vault={}, index={},
                                                                last_success=0.0, high=1))
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unchecked"]
    assert_unknown(d)
    assert "Finnhub earnings calendar (stored)" not in [e["source"] for e in earnings(d)]


# ── the wording reaches the page (DR-28) ────────────────────────────────────

@pytest.mark.parametrize("reason", ["unchecked", "contested"])
def test_each_reason_renders_its_own_sentence(reason):
    cov = {"earnings": "unconfirmed", "earnings_through": None, "listed_through": None, "reason": reason}
    assert of.coverage_words(cov, "SYN", True, True)[0] == of.CACHE_WORDS[reason]


def test_the_unread_reason_keeps_the_unconfirmed_sentence():
    cov = {"earnings": "unconfirmed", "earnings_through": None, "listed_through": None, "reason": "unread"}
    assert of.coverage_words(cov, "SYN", True, True)[0] == of.CACHE_WORDS["unconfirmed"]


# ── what never changes ──────────────────────────────────────────────────────

def test_the_finder_response_is_never_cacheable(world):
    """Design LR 3.6: a ledger change takes effect at the next request, so no response may outlive it."""
    w = world.serve_vault(P())
    r = w.get(**UP)
    assert r.status_code == 200 and r.headers.get("cache-control") == "no-store"
    assert "expires" not in r.headers and "etag" not in r.headers


def test_a_hand_maintained_row_stays_when_the_reader_withdraws(world):
    published = P()
    w = world.serve_vault(published, ledger=None, hand=[HAND])
    hold(w, published, status="stale")
    d = w.ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unchecked"]
    assert "2026-12-10" in {e["date"] for e in earnings(d)}
    assert any(desk_options.HAND_SOURCE in s for s in d["sources"])


@pytest.mark.parametrize("state", ["raises", "contradicts", "stale"])
def test_the_switch_off_answers_exactly_as_without_the_reader(world, state):
    """One generation, the reader off then in each state: the same response, byte for byte."""
    published = P()
    w = world.serve_vault(published, display=False, ledger=None)
    w.get(**UP)  # the first request fills the chain cache ("requests" then reads 0)
    base = w.get(**UP)
    if state == "raises":
        w.mp.setattr(reader, "current", lambda: (_ for _ in ()).throw(RuntimeError("synthetic")))
    elif state == "contradicts":
        hold(w, advance(published, T0, status="partial", complete=False, seq=9))
    else:
        hold(w, published, status="stale")
    r = w.get(**UP)
    assert r.status_code == base.status_code == 200
    assert r.content == base.content


def desk_options_db_path():
    from pathlib import Path

    from api import db

    return Path(db.DB_PATH)
