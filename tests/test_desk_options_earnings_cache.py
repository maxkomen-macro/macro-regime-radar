"""The Options Finder's earnings answer with the earnings cache and the display switch (design EC sections 5-6,
plan rev 2 D6).

The route runs end to end as in tests/test_desk_options_api.py (fake EODHD and Finnhub at the transport, the
clock at Saturday 2026-10-24 14:00 UTC, session Friday Oct 23), over a store that also holds an encrypted vault
built here from synthetic rows. Pinned: the switch off answers the hand-maintained rows only and withholds the
coverage, whatever the vault says; every vault state that does not open answers as before the cache; each
known-table state's words, flags, status and moves; the 48-hour edge; a gap day; K before and after the
visitor's date; possible and moved reports; a share-class name; and no Finnhub request from the route.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from api import db, desk_options
from api import worker as worker_mod
from src.desk import options_finder as of
from src.events import earnings_store as store
from tests import options_route_fake as fk
from tests.test_desk_options_api import ITEM, MACRO, STORED, STORED_WORDS, UP, World

SESSION = date(2026, 10, 23)
NOW = fk.NOW  # Sat Oct 24 14:00 UTC (10:00 New York)
T1, T2 = NOW - timedelta(hours=1), NOW - timedelta(hours=13)  # the newest two runs
SECRET = "vault-TESTONLY-route-7d"
HAND = ("SYN earnings (hand-maintained)", "2026-12-10T21:30:00Z")  # Dec 10, after the close


def day(n: int) -> date:
    return SESSION + timedelta(days=n)


def vault(listings, *, runs=(T1, T2), statuses=("passing", "passing"), complete=(True, True), span=(-7, 120),
          only=None) -> dict:
    """Days span[0]..span[1]-1 from the session covered by `runs` (newest first). `listings`: (offset, label or
    None, reported) for SYN; `only`: {offset: set of run indexes that list it} (default: every run)."""
    days, occ = {}, {}
    for n in range(*span):
        entries = []
        for i, (t, st, ok) in enumerate(zip(runs, statuses, complete)):
            rows = [["SYN", "amc", lab[0] if lab else None, lab[1] if lab else None, rep]
                    for off, lab, rep in listings if off == n and i in (only or {}).get(off, set(range(len(runs))))]
            entries.append({"run": store.iso(t), "at": store.iso(t), "status": st, "complete": ok, "rows": rows})
        days[day(n).isoformat()] = entries
    for off, lab, rep in listings:
        seen = [runs[i] for i in sorted((only or {}).get(off, set(range(len(runs)))))]
        occ[f"SYN|{day(off).isoformat()}"] = {"s": "SYN", "d": day(off).isoformat(), "h": "amc",
                                              "labels": [list(lab)] if lab else [],
                                              "reported": [list(lab)] if rep and lab else [],
                                              "f": store.iso(min(seen)), "l": store.iso(max(seen))}
    return {"format": 1, "runs": [], "days": days, "occ": occ}


NOV30, FEB15 = (date(2026, 11, 30) - SESSION).days, (date(2027, 2, 15) - SESSION).days
CHAIN = [(-5, (2026, 3), True), (NOV30, (2026, 4), False), (FEB15, (2027, 1), False)]  # K = Feb 15, after the date
SHORT = [(-5, (2026, 3), True), (NOV30, (2026, 4), False)]  # K = Nov 30, before the visitor's Dec 18


class CacheWorld(World):
    def serve_vault(self, v: dict | None, *, key: str | None = SECRET, write_key: str = SECRET, display: bool = True,
                    hand=(), now: datetime = NOW, corrupt: bool = False, **store_kw) -> "CacheWorld":
        path = fk.store(self.tmp / f"cache{len(list(self.tmp.iterdir()))}.db", **{"macro": MACRO, "earnings": STORED, **store_kw})
        conn = sqlite3.connect(path)
        if v is not None:
            store.write_vault(conn, v, write_key, T1)
        if corrupt:
            conn.execute(f"UPDATE {store.TABLE} SET blob = substr(blob, 1, length(blob) - 1) || X'00'")
        conn.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                         "VALUES (?, ?, 'medium', 'manual_csv', '2026-10-01', 'SYN', 'earnings')", list(hand))
        conn.commit()
        conn.close()
        if key is None:
            self.mp.delenv(store.KEY_ENV, raising=False)
        else:
            self.mp.setenv(store.KEY_ENV, key)
        if display:
            self.mp.setenv(desk_options.DISPLAY_ENV, "1")
        else:
            self.mp.delenv(desk_options.DISPLAY_ENV, raising=False)
        self.mp.setattr(desk_options, "_now", lambda: now)
        self.mp.setattr(db, "DB_PATH", path)
        self.worker = self.install(worker_mod.AnalyticsWorker(items=ITEM, poll_s=0.05, preload=False))
        self.worker.start(serving=True)
        assert self.worker.wait_published(timeout=30)
        return self


@pytest.fixture()
def world(tmp_path, monkeypatch, install_worker):
    from api.providers import entitlements, market

    w = CacheWorld(tmp_path, monkeypatch, install_worker)
    yield w
    market.clear_caches()
    entitlements.reset_for_tests()


def modelled(d: dict) -> list[dict]:
    rows = [r for r in d["rows"] if r["modelled"]]
    assert rows
    return rows


def earnings(d: dict) -> list[dict]:
    return [e for e in d["events"] if e["kind"] == "earnings"]


def assert_unknown(d: dict) -> None:
    """Unknown coverage never reads as no earnings: the flag on every modelled row, no reconciled flag, the status
    unknown and no implied move."""
    assert all(of.UNKNOWN_FLAG in r["flags"] and of.RECONCILED_FLAG not in r["flags"] for r in modelled(d))
    assert d["earnings_status"] == "unknown"
    assert all(m["move_sd_pct"] is None for m in d["earnings_moves"])


# ── the display switch off (D6) ──────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "", "0", "off", "false", "no", "enabled"])
def test_the_switch_off_withholds_finnhub_whatever_the_vault_says(world, value):
    """Off unless 1, true, on or yes: the stored Finnhub rows and the reconciled vault are not used."""
    world.serve_vault(vault(CHAIN), display=False)
    if value is not None:
        world.mp.setenv(desk_options.DISPLAY_ENV, value)
    d = world.ok(**UP)
    assert earnings(d) == [] and d["earnings_moves"] == []
    assert d["coverage"][0] == of.CACHE_WORDS["withheld"]
    assert not any("Finnhub" in s for s in d["sources"]) and "Finnhub" not in " ".join(d["coverage"][1:])
    assert_unknown(d)
    assert world.fh.calls == []


@pytest.mark.parametrize("value", ["1", "true", "ON", " yes "])
def test_the_switch_reads_on_for_its_four_spellings(monkeypatch, value):
    monkeypatch.setenv(desk_options.DISPLAY_ENV, value)
    assert desk_options.display_on()


def test_the_switch_off_keeps_a_hand_maintained_row(world):
    d = world.serve_vault(vault(CHAIN), display=False, hand=[HAND]).ok(**UP)
    (e,) = earnings(d)
    assert e["date"] == "2026-12-10" and e["source"] == desk_options.HAND_SOURCE
    assert d["coverage"][0] == of.CACHE_WORDS["withheld"] and desk_options.HAND_SOURCE in d["sources"]
    assert_unknown(d)


# ── the cache does not open: the route answers as before it ─────────────────

@pytest.mark.parametrize("case", ["absent", "no_key", "rotated", "unreadable"])
def test_a_vault_that_does_not_open_answers_with_the_stored_rows(world, case):
    kw = {"absent": dict(v=None), "no_key": dict(v=vault(CHAIN), key=None),
          "rotated": dict(v=vault(CHAIN), write_key="another-TESTONLY"), "unreadable": dict(v=vault(CHAIN), corrupt=True)}[case]
    w = world.serve_vault(**kw)
    assert w.worker.current.results["desk_options_inputs"]["earnings_cache"] == {"status": case}
    d = w.ok(**UP)
    assert d["coverage"][0] == STORED_WORDS
    assert [(e["date"], e["source"]) for e in earnings(d)] == [("2026-11-30", "Finnhub earnings calendar (stored)")]
    assert_unknown(d)


# ── the known table, display on and the vault open ──────────────────────────

def test_reconciled_through_a_date_after_the_visitors_replaces_the_unknown_flag(world):
    d = world.serve_vault(vault(CHAIN)).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["reconciled"].format(k="Feb 15, 2027")
    assert all(of.RECONCILED_FLAG in r["flags"] and of.UNKNOWN_FLAG not in r["flags"] for r in modelled(d))
    by_day = {e["date"]: e for e in earnings(d)}
    assert by_day["2026-11-30"]["name"] == "SYN earnings (Q4 2026)" and by_day["2026-11-30"]["timing"] == "amc"
    assert by_day["2026-11-30"]["source"] == ("Finnhub earnings calendar (last seen Oct 24, 09:00 ET; scheduled, "
                                              "not confirmed by the company)")
    assert desk_options.CACHE_SOURCE in d["sources"]
    assert "Finnhub earnings calendar (stored by the site's refresh)" not in d["sources"]  # DR-06
    # the scan runs to Jun 2027, past K: the status stays unknown, and the move pair (Dec 18, Jan 15) is inside K
    assert d["earnings_status"] == "unknown"
    (move, *_) = d["earnings_moves"]
    assert move["date"] == "2026-11-30" and move["reason"] != of.UNKNOWN_MOVE
    assert world.fh.calls == []


def test_reconciled_through_the_last_scanned_expiry_is_its_own_status(world):
    d = world.serve_vault(vault(CHAIN)).ok(**{**UP, "scan_months": "1"})
    assert d["earnings_status"] == "reconciled"


def test_reconciled_through_a_date_before_the_visitors_keeps_the_unknown_flag(world):
    d = world.serve_vault(vault(SHORT)).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["reconciled"].format(k="Nov 30, 2026")
    assert_unknown(d)
    (move,) = d["earnings_moves"]
    assert move["reason"] == of.UNKNOWN_MOVE  # the pair's second expiry is after K


def test_listed_when_the_anchor_was_never_seen_reported(world):
    d = world.serve_vault(vault([(-5, (2026, 3), False), *CHAIN[1:]])).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["listed"]
    assert {e["date"] for e in earnings(d)} == {"2026-11-30", "2027-02-15"}
    assert_unknown(d)
    assert d["earnings_moves"][0]["reason"] == of.UNKNOWN_MOVE


def test_unlisted_through_d(world):
    d = world.serve_vault(vault([])).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unlisted"].format(symbol="SYN", d="Feb 19, 2027")
    assert earnings(d) == [] and d["earnings_moves"] == []
    assert_unknown(d)


def test_unconfirmed_unread_with_one_read(world):
    d = world.serve_vault(vault(CHAIN, runs=(T1,), statuses=("passing",), complete=(True,))).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unconfirmed"]
    assert_unknown(d)


@pytest.mark.parametrize("status, complete", [("partial", False), ("inconsistent", True), ("passing", False)])
def test_unconfirmed_contested_when_the_newest_read_of_the_session_failed_its_checks(world, status, complete):
    d = world.serve_vault(vault(CHAIN, statuses=(status, "passing"), complete=(complete, True))).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["contested"]
    assert_unknown(d)


def test_the_48_hour_edge(world):
    inside = world.serve_vault(vault(CHAIN), now=T1 + timedelta(hours=48) - timedelta(seconds=1)).ok(**UP)
    assert inside["coverage"][0].startswith("Finnhub's calendar lists these regular quarterly reports through")
    edge = world.serve_vault(vault(CHAIN), now=T1 + timedelta(hours=48)).ok(**UP)
    assert edge["coverage"][0] == of.CACHE_WORDS["unconfirmed"]
    assert_unknown(edge)


def test_a_gap_day_before_the_next_quarter_leaves_it_unreconciled(world):
    v = vault(CHAIN)
    del v["days"][day(20).isoformat()]
    d = world.serve_vault(v).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["listed"]
    assert_unknown(d)


def test_a_disappeared_report_is_a_possible_event_and_blocks_reconciliation(world):
    """Between the reported quarter and the first link: nothing is reconciled (between two links, K stops before
    it: tests/test_earnings_store.py)."""
    d = world.serve_vault(vault([*CHAIN, (20, None, False)], only={20: {1}})).ok(**UP)  # before the first link
    gone = next(e for e in earnings(d) if e["date"] == day(20).isoformat())
    assert gone["source"] == ("Finnhub earnings calendar (no longer listed, last seen Oct 23, 21:00 ET; "
                              "a possible report)")
    assert d["coverage"][0] == of.CACHE_WORDS["listed"]
    assert_unknown(d)


def test_a_moved_report_says_where_it_was(world):
    d = world.serve_vault(vault([*CHAIN, (NOV30 - 5, (2026, 4), False)], only={NOV30 - 5: {1}})).ok(**UP)
    by_day = {e["date"]: e for e in earnings(d)}
    assert "2026-11-25" not in by_day
    assert by_day["2026-11-30"]["source"].endswith("not confirmed by the company; moved from Nov 25, 2026)")
    assert d["coverage"][0] == of.CACHE_WORDS["reconciled"].format(k="Feb 15, 2027")


def test_a_hand_maintained_row_joins_the_cache_and_cuts_k_before_it(world):
    d = world.serve_vault(vault(CHAIN), hand=[HAND]).ok(**UP)
    by_day = {e["date"]: e for e in earnings(d)}
    assert by_day["2026-12-10"]["source"] == desk_options.HAND_SOURCE and "2026-11-30" in by_day
    assert d["coverage"][0] == of.CACHE_WORDS["reconciled"].format(k="Nov 30, 2026")
    assert_unknown(d)
    assert any(desk_options.HAND_SOURCE in s and desk_options.CACHE_SOURCE in s for s in d["sources"])


def test_a_hand_maintained_row_on_a_link_date_is_the_same_report(world):
    d = world.serve_vault(vault(CHAIN), hand=[("SYN earnings (hand-maintained)", "2026-11-30T21:30:00Z")]).ok(**UP)
    (e, *rest) = [e for e in earnings(d) if e["date"] == "2026-11-30"]
    assert not rest and e["source"] == desk_options.HAND_SOURCE
    assert d["coverage"][0] == of.CACHE_WORDS["reconciled"].format(k="Feb 15, 2027")


def test_an_unplaceable_hand_maintained_row_leaves_nothing_reconciled(world):
    d = world.serve_vault(vault(CHAIN), hand=[("SYN earnings (hand-maintained)", "2026-12-10T16:30:00")]).ok(**UP)
    assert d["coverage"][0] == of.UNREADABLE_WORDS
    assert_unknown(d)


# ── the rest of the domain ──────────────────────────────────────────────────

def test_a_share_class_is_not_checked_even_with_the_cache_open(world, monkeypatch):
    world.serve_vault(vault(CHAIN))
    item = world.worker.current.results["desk_options_inputs"]
    assert item["earnings_cache"]["status"] == "ok"
    rows, cov, src, _ = desk_options._earnings("BRK.B", SESSION, item)
    assert (rows, cov["earnings"], src) == ([], "not_checked", None)


def test_another_symbols_listing_says_nothing_about_this_one(world):
    v = vault([])
    v["occ"]["ZQAA1|2026-11-30"] = {"s": "ZQAA1", "d": "2026-11-30", "h": "amc", "labels": [[2026, 4]], "reported": [],
                                    "f": store.iso(T2), "l": store.iso(T1)}
    d = world.serve_vault(v).ok(**UP)
    assert d["coverage"][0] == of.CACHE_WORDS["unlisted"].format(symbol="SYN", d="Feb 19, 2027")


def test_a_cache_that_raises_while_applied_answers_with_the_stored_rows(world, monkeypatch):
    world.serve_vault(vault(CHAIN))
    monkeypatch.setattr(store, "coverage", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    d = world.ok(**UP)
    assert d["coverage"][0] == STORED_WORDS


def test_the_item_reads_the_vault_once_and_never_raises(world, monkeypatch):
    w = world.serve_vault(vault(CHAIN))
    cache = w.worker.current.results["desk_options_inputs"]["earnings_cache"]
    assert cache["status"] == "ok" and set(cache) == {"status", "vault", "index"} and list(cache["index"]) == ["SYN"]
    monkeypatch.setattr(store, "open_vault", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    got = desk_options.desk_options_inputs({})
    assert got["stored"] and got["earnings_cache"] == {"status": "unreadable"}
