"""The earnings cache's vault and read-time rules (src/events/earnings_store.py; design EC sections 2-4).

The owner's required regression tests (2026-10-29 23:26 UTC) are marked REQUIRED: fiscal-year rollover, a
missing quarter despite two agreeing runs, an unreported anchor, a disappeared report, a newer inconsistent run.
Also pinned: stability (two passing, complete entries, the newer under 48 hours old, at most 48 hours apart),
D, possible events and their three resolutions, the anchor's label and date rules, the whole claimed range,
hand-maintained rows, and the vault's encryption. Every vault is built here from synthetic rows.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from src.events import earnings_store as store

NOW = datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc)
SESSION = date(2026, 10, 28)
T1, T2 = NOW - timedelta(hours=1), NOW - timedelta(hours=13)  # the newest two runs
SECRET = "vault-TESTONLY-91ab"
SYM = "ZQAA1"


def day(n: int) -> date:
    return SESSION + timedelta(days=n)


def build(listings, *, runs=(T1, T2), statuses=("passing", "passing"), complete=(True, True), span=(-7, 120),
          only=None):
    """A vault whose days span[0]..span[1] are covered by `runs` (newest first). `listings`: (offset, label or None,
    reported) for SYM; `only`: {offset: set of run indexes that list it} (default: every run)."""
    days, occ = {}, {}
    for n in range(span[0], span[1]):
        entries = []
        for i, (t, st, ok) in enumerate(zip(runs, statuses, complete)):
            rows = [[SYM, "amc", lab[0] if lab else None, lab[1] if lab else None, rep]
                    for off, lab, rep in listings if off == n and i in (only or {}).get(off, set(range(len(runs))))]
            entries.append({"run": store.iso(t), "at": store.iso(t), "status": st, "complete": ok, "rows": rows})
        days[day(n).isoformat()] = entries
    for off, lab, rep in listings:
        occ[f"{SYM}|{day(off).isoformat()}"] = {"s": SYM, "d": day(off).isoformat(), "h": "amc",
                                                "labels": [list(lab)] if lab else [],
                                                "reported": [list(lab)] if rep and lab else [],
                                                "f": store.iso(T2), "l": store.iso(T1)}
    return {"format": 1, "runs": [], "days": days, "occ": occ}


def cov(vault, session=SESSION, now=NOW, other=()):
    return store.coverage(vault, store.index(vault).get(SYM, []), session, now, other)


# ── the chain ────────────────────────────────────────────────────────────────

def test_a_reported_quarter_and_the_stable_next_one_reconcile_through_it():
    c = cov(build([(-5, (2026, 3), True), (60, (2026, 4), False)]))
    assert c.state == "reconciled" and c.through == day(60)
    assert [o.day for o in c.events] == [day(60)]


def test_REQUIRED_fiscal_year_rollover_q4_to_q1_of_the_next_year():
    c = cov(build([(-5, (2026, 4), True), (60, (2027, 1), False), (115, (2027, 2), False)]))
    assert c.state == "reconciled" and c.through == day(115)
    wrong = cov(build([(-5, (2026, 4), True), (60, (2026, 1), False)]))  # Q1 of the same year is not next
    assert wrong.state == "listed" and wrong.through is None


def test_REQUIRED_a_missing_quarter_stays_unknown_despite_two_agreeing_runs():
    v = build([(-5, (2026, 2), True), (60, (2026, 4), False)])  # Q3 skipped
    occ = store.occurrences(v, store.index(v)[SYM], SESSION, NOW)
    assert next(o for o in occ if o.day == day(60)).stable  # both runs agree on Q4 ...
    c = cov(v)
    assert c.state == "listed" and c.through is None  # ... which is a stable observation, not coverage


def test_REQUIRED_an_unreported_anchor_never_reconciles():
    c = cov(build([(-5, (2026, 3), False), (60, (2026, 4), False)]))  # Q3 only scheduled, no actual figures
    assert c.state == "listed" and c.reason == "no quarter seen reported"


def test_a_relabelled_anchor_or_one_on_two_dates_is_unknown():
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    v["occ"][f"{SYM}|{day(-5).isoformat()}"]["labels"].append([2026, 2])
    assert cov(v).state == "listed"
    v = build([(-5, (2026, 3), True), (-2, (2026, 3), True), (60, (2026, 4), False)])
    assert cov(v).state == "listed"


def test_an_anchor_after_the_session_is_unknown():
    v = build([(-1, (2026, 3), True), (60, (2026, 4), False)])
    assert cov(v, session=day(-3)).state == "listed"
    assert cov(v, session=day(-1)).state == "reconciled"


def test_an_unstable_next_quarter_stops_the_chain():
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)], only={60: {0}})  # listed only by the newest run
    assert cov(v).state == "listed"


def test_a_label_that_differs_between_the_two_runs_is_not_stable():
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    v["days"][day(60).isoformat()][1]["rows"][0][3] = 1
    assert cov(v).state == "listed"


# ── possible events (R4) ─────────────────────────────────────────────────────

def test_REQUIRED_a_disappeared_report_stays_a_possible_event_and_blocks_the_chain():
    v = build([(-5, (2026, 3), True), (30, None, False), (60, (2026, 4), False)], only={30: {1}})
    c = cov(v)
    gone = next(o for o in c.events if o.day == day(30))
    assert gone.possible and not gone.listed
    assert c.state == "listed" and c.through is None


def test_a_disappeared_report_between_two_links_cuts_k_before_it():
    v = build([(-5, (2026, 3), True), (20, (2026, 4), False), (40, None, False), (110, (2027, 1), False)],
              only={40: {1}})
    c = cov(v)
    assert c.state == "reconciled" and c.through == day(20)


def test_a_possible_event_is_resolved_by_a_stable_move_of_its_quarter():
    v = build([(-5, (2026, 3), True), (30, (2026, 4), False), (60, (2026, 4), False)], only={30: {1}})
    c = cov(v)
    assert c.state == "reconciled" and c.through == day(60)
    moved = next(o for o in c.events if o.day == day(60))
    assert moved.moved_from == [day(30)] and all(o.day != day(30) for o in c.events)


def test_a_possible_event_is_resolved_when_its_quarter_is_seen_reported():
    v = build([(-5, (2026, 3), True), (3, (2026, 3), False), (60, (2026, 4), False)], only={3: {1}})
    c = cov(v)
    assert all(o.day != day(3) for o in c.events) and c.state == "reconciled"


def test_an_unlabelled_possible_event_is_resolved_only_when_past():
    v = build([(-5, (2026, 3), True), (2, None, False), (60, (2026, 4), False)], only={2: {1}})
    assert cov(v).state == "listed"
    assert cov(v, session=day(3), now=NOW + timedelta(hours=1)).state == "reconciled"


# ── stability and freshness (R5) ─────────────────────────────────────────────

def test_REQUIRED_a_newer_inconsistent_run_withdraws_what_older_agreeing_runs_established():
    listings = [(-5, (2026, 3), True), (20, (2026, 4), False), (110, (2027, 1), False)]
    assert cov(build(listings)).through == day(110)
    v = build(listings, runs=(NOW - timedelta(minutes=5), T1, T2), statuses=("passing", "passing", "passing"),
              complete=(True, True, True))
    for n in range(40, 50):  # the newest run covered days 40-49 and was inconsistent
        e = v["days"][day(n).isoformat()]
        e.insert(0, {**e[0], "at": store.iso(NOW - timedelta(minutes=1)), "status": "inconsistent"})
        del e[2:]
    c = cov(v)
    assert store.stable_through(v, SESSION, NOW) == day(39)
    assert c.state == "reconciled" and c.through == day(20)


@pytest.mark.parametrize("status", ["partial", "inconsistent"])
def test_a_newer_non_passing_entry_on_the_session_day_leaves_nothing_confirmed(status):
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)], statuses=(status, "passing"))
    assert cov(v).state == "unconfirmed"


def test_freshness_edges():
    listings = [(-5, (2026, 3), True), (60, (2026, 4), False)]
    v = build(listings)
    assert cov(v, now=T1 + timedelta(hours=48) - timedelta(seconds=1)).state == "reconciled"
    assert cov(v, now=T1 + timedelta(hours=48)).state == "unconfirmed"  # exactly 48 hours is not fresh
    far = build(listings, runs=(T1, T1 - timedelta(hours=48, seconds=1)))
    assert cov(far).state == "unconfirmed"  # the two reads more than 48 hours apart
    one = build(listings, runs=(T1,), statuses=("passing",), complete=(True,))
    assert cov(one).state == "unconfirmed"  # one read is not two


def test_an_incomplete_day_ends_d_and_k_cannot_pass_it():
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    v["days"][day(30).isoformat()][0]["complete"] = False
    assert store.stable_through(v, SESSION, NOW) == day(29)
    assert cov(v).state == "listed"


def test_a_missing_day_ends_d():
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    del v["days"][day(15).isoformat()]
    assert store.stable_through(v, SESSION, NOW) == day(14)


def test_no_listing_gives_unlisted_through_d():
    c = cov(build([]))
    assert c.state == "unlisted" and c.listed_through == day(119) and c.through is None


# ── hand-maintained rows ─────────────────────────────────────────────────────

def test_a_hand_maintained_row_between_links_cuts_k_and_one_on_a_link_date_does_not():
    listings = [(-5, (2026, 3), True), (20, (2026, 4), False), (110, (2027, 1), False)]
    assert cov(build(listings), other=[day(50)]).through == day(20)
    assert cov(build(listings), other=[day(20)]).through == day(110)
    assert cov(build(listings), other=[day(5)]).state == "listed"


# ── labels ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("y, q, want", [
    (2026, 3, (2026, 3)), ("2026", "3", (2026, 3)), (2026.0, 4.0, (2026, 4)),
    (2026, 0, None), (2026, 5, None), (2026, 2.5, None), (True, 3, None), (None, 3, None), (1989, 3, None),
    (float("nan"), 3, None), ("Q3", 2026, None),
])
def test_labels(y, q, want):
    assert store.label(y, q) == want


def test_next_label_rolls_the_year():
    assert store.next_label((2026, 4)) == (2027, 1) and store.next_label((2026, 1)) == (2026, 2)


# ── the vault ────────────────────────────────────────────────────────────────

def test_the_vault_round_trips_and_holds_ciphertext_only(tmp_path):
    path = tmp_path / "v.db"
    conn = sqlite3.connect(path)
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    store.write_vault(conn, v, SECRET, NOW)
    assert store.open_vault(conn, SECRET).vault == v
    assert store.open_vault(conn, "another-TESTONLY").status == "rotated"
    assert store.open_vault(conn, "").status == "no_key"
    conn.execute(f"UPDATE {store.TABLE} SET blob = substr(blob, 1, length(blob) - 1) || X'00'")
    assert store.open_vault(conn, SECRET).status == "unreadable"
    conn.close()
    assert SYM.encode() not in path.read_bytes()
    empty = sqlite3.connect(tmp_path / "e.db")
    assert store.open_vault(empty, SECRET).status == "absent"
    empty.close()


def test_the_content_digest_carries_every_run_that_charged_a_call():
    """S-2: the call charges, the reservation and a 429 are publication-worthy; a zero-call skip is not."""
    v = build([(60, (2026, 4), False)])
    a = store.content_digest(v, SECRET)
    v["runs"].append({"id": "s", "status": "skipped", "calls": 0, "calls_by_utc_date": {}, "saw_429": False})
    assert store.content_digest(v, SECRET) == a
    v["runs"].append({"id": "f", "status": "failed", "calls": 1, "calls_by_utc_date": {"2026-10-29": 1}, "saw_429": True})
    b = store.content_digest(v, SECRET)
    assert b != a
    v["runs"][-1]["saw_429"] = False
    assert store.content_digest(v, SECRET) not in (a, b)


def test_a_newer_unanswered_request_withdraws_a_day_and_marks_it_contested():
    """S-1: a withdrawal newer than the day's newest entry makes the day unstable and contested; an older one
    does nothing."""
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)])
    assert cov(v).state == "reconciled" and not store.contested(v, SESSION)
    v["withdrawn"] = {SESSION.isoformat(): store.iso(T2 - timedelta(hours=1))}
    assert cov(v).state == "reconciled"
    v["withdrawn"] = {SESSION.isoformat(): store.iso(T1 + timedelta(minutes=1))}
    assert cov(v).state == "unconfirmed" and store.contested(v, SESSION)


def test_after_a_withdrawal_a_day_needs_two_newer_passing_reads_again():
    """Codex S-4: a read older than the withdrawal never counts again; one newer passing read is not enough."""
    old = NOW - timedelta(hours=30)
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)], runs=(T1, old))
    v["withdrawn"] = {day(n).isoformat(): store.iso(old + timedelta(hours=1)) for n in range(-7, 120)}
    assert not store.day_stable(v, SESSION, NOW) and cov(v).state == "unconfirmed"
    assert not store.contested(v, SESSION)  # the newest read is passing and newer than the withdrawal: unread
    v = build([(-5, (2026, 3), True), (60, (2026, 4), False)], runs=(T1, T2))
    v["withdrawn"] = {day(n).isoformat(): store.iso(T2 - timedelta(hours=1)) for n in range(-7, 120)}
    assert store.day_stable(v, SESSION, NOW) and cov(v).state == "reconciled"


def test_the_content_digest_ignores_the_runs_bookkeeping():
    v = build([(60, (2026, 4), False)])
    a = store.content_digest(v, SECRET)
    v["runs"].append({"id": "x"})
    assert store.content_digest(v, SECRET) == a
    v["days"][day(0).isoformat()][0]["at"] = store.iso(NOW)
    assert store.content_digest(v, SECRET) != a
