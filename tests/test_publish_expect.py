"""CS-2 (DR-27): publish_artifacts.sh --expect is the memo ledger's compare-and-swap.

Every ledger and source-registry write names the blob it read. In every attempt,
after the fetch and before the commit, the script checks that blob in the exact
main it just fetched; a mismatch exits 4 with nothing committed and no retry.
Unrelated changes on main still rebuild and retry as before. These run in real
git repositories, with the harness from tests/test_publish_artifacts.py.
"""

from __future__ import annotations

import shlex

import pytest

from tests.test_publish_artifacts import REAL_GIT, Race, _env, _git, _publish_cmd, _shim_git, _write

LEDGER = "docs/memo/ledger-daily.json"
SOURCES = "docs/memo/sources.json"


def _seed(race: Race, path: str, text: str) -> str:
    """Commit `path` on main from the dev clone; return its blob sha."""
    _git(race.dev, "pull", "--quiet", "--ff-only", "origin", "main", env=race.env)
    _write(race.dev, path, text)
    _git(race.dev, "add", "--", path, env=race.env)
    _git(race.dev, "commit", "--quiet", "-m", f"seed {path}", env=race.env)
    _git(race.dev, "push", "--quiet", "origin", "main", env=race.env)
    return _git(race.origin, "rev-parse", f"main:{path}", env=race.env)


def test_a_matching_expect_publishes(tmp_path):
    race = Race(tmp_path)
    blob = _seed(race, LEDGER, '{"v": 0}\n')
    race.checkout_runner()
    _write(race.runner, LEDGER, '{"v": 1}\n')
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}={blob}", "Memo ledger [skip ci]", LEDGER]))
    assert res.returncode == 0, res.stdout + res.stderr
    assert race.show(race.tip(), LEDGER) == '{"v": 1}'


def test_a_changed_file_stops_with_exit_4_and_nothing_committed(tmp_path):
    race = Race(tmp_path)
    blob = _seed(race, LEDGER, '{"v": 0}\n')
    race.checkout_runner()
    _seed(race, LEDGER, '{"v": "owner edit"}\n')          # a reviewed PR edits the ledger
    before = race.tip()
    _write(race.runner, LEDGER, '{"v": 1}\n')
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}={blob}", "Memo ledger [skip ci]", LEDGER]))
    assert res.returncode == 4, res.stdout + res.stderr
    assert "the ledger changed under this run" in res.stderr
    assert "Attempt 2" not in res.stdout, "a mismatch is never retried"
    assert race.tip() == before
    assert race.show(before, LEDGER) == '{"v": "owner edit"}'


def test_absent_matches_a_missing_file_and_refuses_a_present_one(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    _write(race.runner, SOURCES, '{"version": 1}\n')
    ok = race.run(_publish_cmd(["--expect", f"{SOURCES}=absent", "Sources [skip ci]", SOURCES]))
    assert ok.returncode == 0, ok.stdout + ok.stderr
    tip = race.tip()
    _write(race.runner, SOURCES, '{"version": 1, "x": 2}\n')
    again = race.run(_publish_cmd(["--expect", f"{SOURCES}=absent", "Sources [skip ci]", SOURCES]))
    assert again.returncode == 4, again.stdout + again.stderr
    assert race.tip() == tip


def test_a_ledger_change_between_fetch_and_push_is_caught_on_the_next_attempt(tmp_path):
    """The first attempt's push is rejected because main moved; the rebuild re-checks
    the expectation on the newer main and stops, rather than overwriting the edit."""
    race = Race(tmp_path)
    blob = _seed(race, LEDGER, '{"v": 0}\n')
    race.checkout_runner()
    _write(race.runner, LEDGER, '{"v": 1}\n')
    helper = tmp_path / "edit_ledger.sh"
    helper.write_text(
        "set -e\n"
        f"cd {shlex.quote(str(race.dev))}\n"
        f"G={shlex.quote(REAL_GIT)}\n"
        "$G pull --quiet --ff-only origin main\n"
        f"echo '{{\"v\": \"concurrent\"}}' > {LEDGER}\n"
        "$G add -A && $G commit --quiet -m 'another memo run' && $G push --quiet origin main\n"
    )
    env = _env(tmp_path, _shim_git(tmp_path, f"bash {shlex.quote(str(helper))} >/dev/null 2>&1"))
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}={blob}", "Memo ledger [skip ci]", LEDGER]), env=env)
    assert res.returncode == 4, res.stdout + res.stderr
    assert "Attempt 1 failed" in res.stdout
    assert race.show(race.tip(), LEDGER) == '{"v": "concurrent"}'


def test_an_unrelated_change_on_main_still_rebuilds_and_publishes(tmp_path):
    race = Race(tmp_path)
    blob = _seed(race, LEDGER, '{"v": 0}\n')
    race.checkout_runner()
    merge = race.merge_code("unrelated")
    _write(race.runner, LEDGER, '{"v": 1}\n')
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}={blob}", "Memo ledger [skip ci]", LEDGER]))
    assert res.returncode == 0, res.stdout + res.stderr
    tip = race.tip()
    assert race.parents(tip) == [merge]
    assert race.changed(merge, tip) == [LEDGER]


def test_one_commit_can_carry_the_page_and_the_ledger_under_one_expectation(tmp_path):
    race = Race(tmp_path)
    blob = _seed(race, LEDGER, '{"v": 0}\n')
    race.checkout_runner()
    _write(race.runner, LEDGER, '{"v": "sending"}\n')
    _write(race.runner, "docs/memo/daily_memo.html", "<p>memo</p>\n")
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}={blob}", "Daily memo [skip ci]",
                                 "docs/memo/daily_memo.html", LEDGER]))
    assert res.returncode == 0, res.stdout + res.stderr
    tip = race.tip()
    assert sorted(race.changed(race.parents(tip)[0], tip)) == ["docs/memo/daily_memo.html", LEDGER]


@pytest.mark.parametrize("spec", [
    "docs/memo/other.json=absent",                  # not an allowed file
    f"{LEDGER}=abc",                                # not a blob sha
    f"{LEDGER}",                                    # no '='
    f"{LEDGER}=ABCDEF0123456789ABCDEF0123456789ABCDEF01",  # upper case is not git's form
])
def test_a_malformed_expect_is_a_usage_error(tmp_path, spec):
    race = Race(tmp_path)
    race.checkout_runner()
    before = race.tip()
    _write(race.runner, LEDGER, "{}\n")
    res = race.run(_publish_cmd(["--expect", spec, "Memo ledger [skip ci]", LEDGER]))
    assert res.returncode == 2, res.stdout + res.stderr
    assert race.tip() == before


def test_the_same_path_expected_twice_is_refused(tmp_path):
    race = Race(tmp_path)
    race.checkout_runner()
    _write(race.runner, LEDGER, "{}\n")
    res = race.run(_publish_cmd(["--expect", f"{LEDGER}=absent", "--expect", f"{LEDGER}=absent", "m", LEDGER]))
    assert res.returncode == 2


def test_the_allow_list_gains_exactly_the_two_ledgers_and_the_registry():
    from tests.test_publish_artifacts import SCRIPT

    text = SCRIPT.read_text()
    block = text.split("ALLOWED=(", 1)[1].split(")", 1)[0]
    allowed = [ln.strip().strip('"') for ln in block.splitlines() if ln.strip()]
    assert allowed == [
        "output/playbook.json",
        "docs/memo/daily_memo.html",
        "docs/memo/weekly_memo.html",
        "docs/memo/ledger-daily.json",
        "docs/memo/ledger-weekly.json",
        "docs/memo/sources.json",
    ]
