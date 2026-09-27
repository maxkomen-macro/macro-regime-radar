"""tests/test_desk_firing.py — the firing state, N1 (desk/frame-3-api, B1 commit 5).

docs/desk/FRAME3_API_PLAN.md §1.11 N1 and §5 (v4 B-05): pure tests on
synthetic signal traces, plus the comparison session at frozen times. A
signal fires on a session when its raw trigger (before any cooldown; a cross
only on its strict crossing session) and its condition hold there, and the
session is evaluable; `firing_day` counts the consecutive firing sessions up
to `evaluated_on` and never bridges an unevaluable one; a stale study is in
neither of /overview's lists.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from api import desk_v2
from src.desk import event_study as es

# eight consecutive XNYS sessions (2026-09-10 … 2026-09-21: Mon 14th through Mon 21st)
SESSIONS = ("2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21")


def trace(trigger, holds=None, evaluable=None, sessions=SESSIONS) -> es.SignalTrace:
    n = len(sessions)
    return es.SignalTrace(sessions=sessions, evaluable=np.array(evaluable if evaluable is not None else [True] * n),
                          trigger=np.array(trigger), holds=np.array(holds if holds is not None else [True] * n), z=None)


def state(t, *, cross=False, comparison="2026-09-21", prev="2026-09-18"):
    return desk_v2.firing_state(t, comparison, prev, cross=cross)


def lists(t, **kw):
    f = state(t, **kw)
    return desk_v2.fire_lists([({"slug": "s", "label": "S", "short": "s"}, f)])


def test_1_false_to_true_between_the_two_sessions_is_a_new_fire():
    t = trace([0, 0, 0, 0, 0, 0, 0, 1])
    new, still = lists(t)
    assert new == [{"slug": "s", "label": "S", "short": "s"}] and still == []
    assert state(t)["firing_now"] is True and state(t)["firing_day"] == 1


def test_2_true_to_true_is_still_firing_with_its_day():
    t = trace([0, 0, 0, 0, 1, 1, 1, 1])
    new, still = lists(t)
    assert new == [] and still == [{"slug": "s", "label": "S", "short": "s", "firing_day": 4}]


def test_3_a_stale_study_is_in_neither_list():
    t = trace([0, 0, 0, 0, 0, 0, 1, 1], evaluable=[1, 1, 1, 1, 1, 1, 1, 0])  # last evaluable is the 18th
    f = state(t)
    assert f["evaluated_on"] == "2026-09-18" and f["stale"] is True
    assert lists(t) == ([], [])


def test_4_an_unevaluable_prev_session_is_a_null_state_and_in_neither_list():
    t = trace([0, 0, 0, 0, 0, 0, 0, 1], evaluable=[1, 1, 1, 1, 1, 1, 0, 1])
    f = state(t)
    assert f["state_prev"] is None and f["state_comparison"] is True and f["stale"] is False
    assert lists(t) == ([], [])


def test_5_an_unevaluable_session_inside_a_run_resets_the_day():
    t = trace([1, 1, 1, 1, 1, 1, 1, 1], evaluable=[1, 1, 1, 1, 0, 1, 1, 1])
    assert state(t)["firing_day"] == 3


def test_6_a_trigger_inside_a_cooldown_still_fires():
    """The engine's events are cooldown-filtered; the firing state reads the raw trigger."""
    z = pd.Series([0.0, 2.5, 2.6, 2.7, 0.0, 0.0, 0.0, 2.1])
    pos, raw = es.detect_events(z, 2.0, "+", 5)
    assert pos.tolist() == [1, 7] and raw == 4  # the 14th and 15th are inside the first event's cooldown
    t = trace(es.trigger_mask(z, 2.0, "+"))
    assert state(t)["firing_now"] is True and state(t, comparison="2026-09-15", prev="2026-09-14")["state_comparison"] is True


def test_7_a_cross_fires_only_on_its_crossing_session():
    t = trace([0, 0, 0, 0, 0, 0, 1, 0])
    assert state(t, cross=True)["firing_now"] is False
    t2 = trace([0, 0, 0, 0, 0, 0, 0, 1])
    f = state(t2, cross=True)
    assert f["firing_now"] is True and f["firing_day"] == 1


def test_8_a_trigger_whose_condition_fails_does_not_fire():
    t = trace([1, 1, 1, 1, 1, 1, 1, 1], holds=[1, 1, 1, 1, 1, 1, 1, 0])
    f = state(t)
    assert f["firing_now"] is False and f["firing_day"] is None
    assert lists(t) == ([], [])


def test_9_the_day_is_null_unless_firing():
    assert state(trace([1, 1, 1, 1, 1, 1, 1, 0]))["firing_day"] is None
    none_evaluable = state(trace([1] * 8, evaluable=[0] * 8))
    assert none_evaluable["firing_now"] is None and none_evaluable["firing_day"] is None


@pytest.mark.parametrize(("now", "comparison", "prev"), [
    (datetime(2026, 9, 22, 13, 0, tzinfo=timezone.utc), "2026-09-21", "2026-09-18"),   # Tue 09:00 ET, before the open
    (datetime(2026, 9, 22, 19, 59, tzinfo=timezone.utc), "2026-09-21", "2026-09-18"),  # 15:59 ET, before the close
    (datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc), "2026-09-22", "2026-09-21"),   # 16:00 ET, the close
    (datetime(2026, 9, 27, 15, 0, tzinfo=timezone.utc), "2026-09-25", "2026-09-24"),   # a Sunday
    (datetime(2026, 11, 26, 18, 0, tzinfo=timezone.utc), "2026-11-25", "2026-11-24"),  # Thanksgiving
    (datetime(2026, 11, 27, 18, 5, tzinfo=timezone.utc), "2026-11-27", "2026-11-25"),  # its 13:00 half-day, after the close
])
def test_10_the_comparison_session_at_a_frozen_now(now, comparison, prev):
    assert desk_v2.sessions_now(now) == (comparison, prev)


def test_a_session_outside_the_run_is_a_null_state():
    f = state(trace([0] * 8), comparison="2026-09-22", prev="2026-09-21")
    assert f["state_comparison"] is None and f["state_prev"] is False and f["stale"] is True


# ── stale by publication cadence (desk/fill-compute, the owner's item 7) ────

@pytest.mark.parametrize(("allowance", "last", "stale"), [
    (0, "2026-09-18", True),    # an exchange close one session behind is stale
    (3, "2026-09-18", False),   # a FRED daily input one session behind is current
    (3, "2026-09-16", False),   # three sessions behind (17th, 18th, 21st): still current
    (3, "2026-09-15", True),    # four behind: stale
    (8, "2026-09-10", False),   # WTI, published weekly: five behind is current
])
def test_stale_is_judged_by_the_studys_publication_allowance(allowance, last, stale):
    ev = [s <= last for s in SESSIONS]
    t = trace([0] * len(SESSIONS), evaluable=ev)
    f = desk_v2.firing_state(t, "2026-09-21", "2026-09-18", cross=False, allowance=allowance)
    assert (f["evaluated_on"], f["stale"]) == (last, stale)


def test_a_study_dated_after_the_comparison_session_is_stale_whatever_its_allowance():
    """A clock behind the data (the comparison session before the study's last
    one) is stale as before: a study is never called firing today for a session
    that is not today's."""
    t = trace([0] * len(SESSIONS), evaluable=[1] * len(SESSIONS))
    for allowance in (0, 3, 8):
        f = desk_v2.firing_state(t, SESSIONS[-3], SESSIONS[-4], cross=False, allowance=allowance)
        assert (f["evaluated_on"], f["stale"]) == (SESSIONS[-1], True), allowance


def test_the_allowance_is_the_slowest_inputs():
    from api import desk_catalog as catalog

    got = {slug: desk_v2.publication_allowance(catalog.BY_SLUG[slug]) for slug in catalog.LEDGER_ORDER}
    assert got["golden-cross"] == got["rsi-above-70"] == got["gold-2sigma-spx-weak"] == 0   # closes only
    assert got["vix-spike-2sigma-5d"] == 0                                                  # ^VIX is a close now
    assert got["hy-2sigma-20d"] == got["2s10s-2sigma-steepening"] == 3                      # FRED daily
    assert got["oil-2sigma-20d"] == 8                                                        # WTI, weekly
    assert got["dollar-2sigma-20d"] == 0


def test_a_fred_study_a_session_behind_is_not_stale_on_the_ledger(monkeypatch):
    """The Ledger passes each row its allowance: a 2s10s row evaluated a session
    before the comparison session is current; its firing state is its own session's."""
    t = trace([0, 0, 0, 0, 0, 0, 1, 0], evaluable=[1, 1, 1, 1, 1, 1, 1, 0])
    f = desk_v2.firing_state(t, "2026-09-21", "2026-09-18", cross=False, allowance=3)
    assert f["stale"] is False and f["firing_now"] is True and f["firing_day"] == 1
