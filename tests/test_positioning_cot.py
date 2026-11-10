"""Desk P4 (D7): the CFTC positions step, its reader and GET /api/desk/positioning, on invented positions.

Every store here is built from scripts/desk_positioning_fixture.synth_rows: invented weekly reports, shaped as the
CFTC's API serves them, that satisfy the CFTC's open-interest identity (test-data rule). Nothing reaches the network.
The method is docs/desk/POSITIONING_SPEC.md; the check against the CFTC's own archive is scripts/check_cot_reference.py.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import db
from api import desk_envelope as env
from api import desk_positioning as dp
from api import worker as worker_mod
from api.analytics_cache import _desk_positioning
from api.main import app
from scripts import check_cot_reference as ref
from scripts import desk_positioning_fixture as fx
from src.market_data import cot, cot_schedule
from tests import desk_contract as dc

client = TestClient(app, raise_server_exceptions=False)
# The tests' own invented world: weekly reports to Tuesday 2026-09-22 (released 2026-09-25), stored the next day.
END = date(2026, 9, 22)
NOW = datetime(2026, 9, 26, 11, 20, tzinfo=timezone.utc)
CODES = {r: [m.contract_code for m in cot.MARKETS if m.report == r] for r in cot.REPORTS}


def served(**over):
    """A fake CFTC read: each report's invented rows, after `over[report]` (a function of the row list) edits them."""
    def get(url: str):
        for key, report in cot.REPORTS.items():
            if f"/{report.dataset}.json" in url:
                rows = fx.synth_rows(report, CODES[key], end=END)
                return over[key](rows) if key in over else rows
        raise AssertionError(url)
    return get


def refresh(path: Path, get=None, now: datetime = NOW) -> dict:
    return cot.refresh(path, now=now, get=get or served(), retry_wait=0)


def rows_of(path: Path, sql: str, *args) -> list[tuple]:
    with sqlite3.connect(path) as c:
        return c.execute(sql, args).fetchall()


def block(path: Path) -> dict:
    with sqlite3.connect(path) as c:
        return dp.futures_block(c)


# ── the invented rows the tests stand on ────────────────────────────────────

def test_the_invented_rows_satisfy_the_cftc_identity_and_parse():
    for key, report in cot.REPORTS.items():
        raw = fx.synth_rows(report, CODES[key], end=END)
        assert len(raw) == fx.WEEKS * len(CODES[key])
        parsed, refused = cot.parse_rows(report, raw, set(CODES[key]))
        assert refused == [] and len(parsed) == len(raw) * len(report.categories)


# ── the step: store, runs, watermark ────────────────────────────────────────

def test_a_run_stores_every_report_commits_and_records_the_watermark(tmp_path):
    f = tmp_path / "s.db"
    s = refresh(f)
    assert s["status"] == "ok" and s["failed"] == []
    assert s["counts"] == {"new": fx.WEEKS * 5 * 5, "revised": 0, "restored": 0, "withdrawn": 0, "refused": 0}
    assert set(s["newest"].values()) == {END.isoformat()}
    assert rows_of(f, f"SELECT status, source FROM {cot.RUNS}") == [("committed", "cftc_pre")]
    (obs, status), = rows_of(f, "SELECT last_obs, status FROM source_watermarks WHERE source = ?", cot.WATERMARK)
    assert (obs, status) == (END.isoformat(), "ok")
    # Every row is traceable: provider, the run that wrote it, the CFTC's row id, when the store first held it.
    prov = rows_of(f, f"SELECT DISTINCT provider, run_id = (SELECT run_id FROM {cot.RUNS}), first_stored_at FROM {cot.TABLE}")
    assert prov == [("CFTC", 1, "2026-09-26T11:20:00Z")]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE source_row_id NOT LIKE 'SYN%'") == [(0,)]


def test_a_second_identical_run_changes_nothing(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)
    s = refresh(f, now=NOW + timedelta(days=7))
    assert s["counts"] == {"new": 0, "revised": 0, "restored": 0, "withdrawn": 0, "refused": 0}
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.REVISIONS}") == [(0,)]
    # The rows keep the run that wrote their numbers and the day the store first held them.
    assert rows_of(f, f"SELECT DISTINCT first_stored_at, stored_at FROM {cot.TABLE}") == [("2026-09-26T11:20:00Z",) * 2]


def _amend(rows):
    """The CFTC corrects one report: 1,000 contracts move from the leveraged funds' long side to the dealers' long side
    of the S&P report dated 2026-09-15 (the identity still holds)."""
    rows = copy.deepcopy(rows)
    for r in rows:
        if r["cftc_contract_market_code"] == "13874A" and r["report_date_as_yyyy_mm_dd"].startswith("2026-09-15"):
            r["lev_money_positions_long"] = str(int(r["lev_money_positions_long"]) - 1000)
            r["dealer_positions_long_all"] = str(int(r["dealer_positions_long_all"]) + 1000)
    return rows


def test_an_amended_report_keeps_its_old_numbers_in_the_revisions(tmp_path):
    f = tmp_path / "s.db"
    first = refresh(f)
    later = NOW + timedelta(days=7)
    s = refresh(f, served(tff=_amend), now=later)
    assert s["counts"]["revised"] == 2 and s["counts"]["new"] == 0
    revs = rows_of(f, f"SELECT category, old_long, new_long, old_run_id, new_run_id, revised_at FROM {cot.REVISIONS} ORDER BY category")
    assert [r[0] for r in revs] == ["dealer", "leveraged_funds"]
    assert revs[0][2] - revs[0][1] == 1000 and revs[1][1] - revs[1][2] == 1000
    assert {r[3] for r in revs} == {first["run_id"]} and {r[4] for r in revs} == {s["run_id"]}
    assert {r[5] for r in revs} == {cot.stamp(later)}
    # The row takes the new numbers and the run that wrote them; it keeps the day the store first held it.
    (lng, run, first_at, at), = rows_of(f, f"SELECT long, run_id, first_stored_at, stored_at FROM {cot.TABLE} WHERE contract_code = "
                                           "'13874A' AND as_of = '2026-09-15' AND category = 'leveraged_funds'")
    assert lng == revs[1][2] and run == s["run_id"] and first_at == "2026-09-26T11:20:00Z" and at == cot.stamp(later)
    assert block(f)["revisions_stored"] == 2


def _drop(as_of: str, code: str = "13874A"):
    return lambda rows: [r for r in rows if not (r["cftc_contract_market_code"] == code
                                                 and r["report_date_as_yyyy_mm_dd"].startswith(as_of))]


def test_a_report_the_cftc_stops_serving_is_withdrawn_kept_and_restored(tmp_path):
    """Owner F-3 / Codex S-9: a withdrawal is confirmed by a second read in a row. The first read that leaves the
    report out marks it unserved and keeps it readable; the next one that leaves it out withdraws it."""
    f = tmp_path / "s.db"
    refresh(f)
    s = refresh(f, served(tff=_drop("2026-09-22")), now=NOW + timedelta(days=1))
    assert s["counts"]["withdrawn"] == 0 and s["status"] == "partial"
    assert s["unconfirmed"] == ["Traders in Financial Futures, futures only: 1 stored report(s) of 13874A not served "
                                "(newest 2026-09-22), kept readable until the next read confirms them withdrawn"]
    assert "unconfirmed: " in s["detail"]
    assert _spx(f)["as_of"] == "2026-09-22" and _spx(f)["excluded"] == [] and _spx(f)["reports"] == fx.WEEKS
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL") == [(5,)]
    s = refresh(f, served(tff=_drop("2026-09-22")), now=NOW + timedelta(days=2))
    assert s["counts"]["withdrawn"] == 5 and s["unconfirmed"] == []
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL") == [(5,)]
    spx = next(m for m in block(f)["markets"] if m["key"] == "spx")
    # Set aside, never read: the newest readable S&P report is the week before.
    assert spx["as_of"] == "2026-09-15" and spx["excluded"] == [
        {"as_of": "2026-09-22", "reason": "the CFTC no longer serves it (withdrawn)"}]
    assert spx["reports"] == fx.WEEKS - 1
    # The watermark follows the oldest market's newest report.
    assert s["newest"]["spx"] == "2026-09-15" and s["status"] == "ok"
    s = refresh(f, now=NOW + timedelta(days=3))
    assert s["counts"]["restored"] == 5 and s["counts"]["withdrawn"] == 0
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL OR withdrawn_at IS NOT NULL") == [(0,)]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL") == [(0,)]


def _latest_week_only(rows):
    newest = max(r["report_date_as_yyyy_mm_dd"] for r in rows)
    return [r for r in rows if r["report_date_as_yyyy_mm_dd"] == newest]


def _readable(path: Path) -> dict[str, int]:
    return {m["key"]: m["reports"] for m in block(path)["markets"]}


def test_owner_repro_a_shortened_valid_read_keeps_the_stored_history_and_says_why(tmp_path):
    """Max's reproduction (2026-11-10): 210 reports per market stored, then a read serving only the latest week for
    every market, each row valid. It withdrew 5,225 category rows and left one readable report per market. A read
    that leaves out more than MAX_WITHDRAWN_PER_READ stored reports of a market is incomplete: nothing of that
    market is replaced or withdrawn, and the run says why."""
    f = tmp_path / "s.db"
    refresh(f)
    assert _readable(f) == {k: fx.WEEKS for k in ("spx", "ust10y", "usd", "gold", "wti")}
    before = rows_of(f, f"SELECT * FROM {cot.TABLE} ORDER BY report, contract_code, as_of, category")
    s = refresh(f, served(tff=_latest_week_only, disaggregated=_latest_week_only), now=NOW + timedelta(days=1))
    assert s["counts"]["withdrawn"] == 0 and s["status"] == "partial"
    assert s["failed"] and all("treated as incomplete" in x for x in s["failed"])
    assert f"{fx.WEEKS - 1} stored reports not served" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL") == [(0,)]
    assert rows_of(f, f"SELECT * FROM {cot.TABLE} ORDER BY report, contract_code, as_of, category") == before
    assert _readable(f) == {k: fx.WEEKS for k in ("spx", "ust10y", "usd", "gold", "wti")}
    # the run wrote nothing, so it did not commit; the watermark says why
    assert rows_of(f, f"SELECT status FROM {cot.RUNS} WHERE run_id = ?", s["run_id"]) == [("failed",)]
    (detail,) = rows_of(f, "SELECT detail FROM source_watermarks WHERE source = ?", cot.WATERMARK)[0]
    assert "treated as incomplete" in detail
    # the next complete read stores normally
    s = refresh(f, now=NOW + timedelta(days=2))
    assert s["status"] == "ok" and s["counts"]["withdrawn"] == 0 and s["counts"]["new"] == 0


def test_a_shortened_market_is_held_while_the_others_are_stored(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)
    later = END + timedelta(days=7)
    newer = lambda key: (lambda rows: fx.synth_rows(cot.REPORTS[key], CODES[key], end=later, weeks=fx.WEEKS + 1))  # noqa: E731
    cut_gold = lambda rows: [r for r in newer("disaggregated")(rows)  # noqa: E731
                             if r["cftc_contract_market_code"] != "088691" or r["report_date_as_yyyy_mm_dd"] >= "2026-01"]
    s = refresh(f, served(tff=newer("tff"), disaggregated=cut_gold), now=NOW + timedelta(days=8))
    assert s["status"] == "partial" and "088691" in s["detail"] and "treated as incomplete" in s["detail"]
    assert s["counts"]["withdrawn"] == 0
    newest = s["newest"]
    assert newest["gold"] == "2026-09-22"  # held: its new week is not stored either
    assert {newest[k] for k in ("spx", "ust10y", "usd", "wti")} == {"2026-09-29"}


@pytest.mark.parametrize("dropped, held", [(2, False), (3, True)])
def test_at_most_two_reports_of_a_market_are_withdrawn_by_one_read(tmp_path, dropped, held):
    """A complete read that leaves out one or two stored reports of a market marks them unserved, and a second such
    read withdraws them (kept, restorable); three or more is an incomplete read, and nothing is marked or withdrawn."""
    assert cot.MAX_WITHDRAWN_PER_READ == 2
    f = tmp_path / "s.db"
    refresh(f)
    weeks = [(END - timedelta(days=7 * i)).isoformat() for i in (3, 40, 100)][:dropped]
    drop = lambda rows: [r for r in rows if not (r["cftc_contract_market_code"] == "13874A"  # noqa: E731
                                                  and r["report_date_as_yyyy_mm_dd"][:10] in weeks)]
    s = refresh(f, served(tff=drop), now=NOW + timedelta(days=1))
    if held:
        assert s["status"] == "partial" and s["counts"]["withdrawn"] == 0 and "13874A (3 stored reports not served" in s["detail"]
        assert _readable(f)["spx"] == fx.WEEKS
        assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL") == [(0,)]
    else:
        assert s["status"] == "partial" and s["counts"]["withdrawn"] == 0 and _readable(f)["spx"] == fx.WEEKS
        s = refresh(f, served(tff=drop), now=NOW + timedelta(days=2))
        assert s["status"] == "ok" and s["counts"]["withdrawn"] == dropped * 5
        assert _readable(f)["spx"] == fx.WEEKS - dropped
        s = refresh(f, now=NOW + timedelta(days=3))
        assert s["counts"]["restored"] == dropped * 5 and _readable(f)["spx"] == fx.WEEKS


def _oldest_cut(n):
    return lambda rows: [r for r in rows if r["report_date_as_yyyy_mm_dd"][:10] > (END - timedelta(weeks=fx.WEEKS - 1 - n + 1)).isoformat()]


def _newest_cut(n):
    return lambda rows: [r for r in rows if r["report_date_as_yyyy_mm_dd"][:10] <= (END - timedelta(weeks=n)).isoformat()]


@pytest.mark.parametrize("step", [1, 2], ids=["a week a read", "two weeks a read"])
@pytest.mark.parametrize("cut", [_oldest_cut, _newest_cut], ids=["oldest weeks cut", "newest weeks cut"])
def test_codex_s9_s10_ever_shorter_reads_never_wear_the_history_down(tmp_path, cut, step):
    """Codex S-9: 210 reports stored, then reads of 208, 206 and 204 (identity-valid) withdrew 50 category rows each
    with status ok. Codex S-10: reads of 209, 208, 207, 206, 205 still withdrew one more report a read, because the
    cap counted only readable reports. The cap counts every stored report the read leaves out, withdrawn ones too:
    no read is ok, at most two reports of a market are ever withdrawn, and from three left out every read is held."""
    f = tmp_path / "s.db"
    refresh(f)
    markets = ("spx", "ust10y", "usd", "gold", "wti")
    for i, n in enumerate(range(step, 6 * step, step), start=1):
        assert len({r["report_date_as_yyyy_mm_dd"] for r in cut(n)(fx.synth_rows(cot.REPORTS["tff"], CODES["tff"], end=END))}) == fx.WEEKS - n
        s = refresh(f, served(tff=cut(n), disaggregated=cut(n)), now=NOW + timedelta(days=i))
        assert s["status"] == "partial", (n, s["detail"])
        if n > cot.MAX_WITHDRAWN_PER_READ:
            assert len(s["failed"]) == 2 and all("treated as incomplete" in x for x in s["failed"]) and s["counts"]["withdrawn"] == 0
        assert all(v >= fx.WEEKS - cot.MAX_WITHDRAWN_PER_READ for v in _readable(f).values()), (n, _readable(f))
    gone = rows_of(f, f"SELECT contract_code, COUNT(DISTINCT as_of) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL GROUP BY contract_code")
    assert all(k <= cot.MAX_WITHDRAWN_PER_READ for _, k in gone), gone
    if step == 2:  # the first read only marks; the next leaves out four and is held: nothing is ever withdrawn
        assert gone == [] and _readable(f) == {k: fx.WEEKS for k in markets}
    # the full history served again restores and clears every mark
    s = refresh(f, now=NOW + timedelta(days=9))
    assert s["status"] == "ok" and s["counts"]["withdrawn"] == 0 and s["unconfirmed"] == []
    assert _readable(f) == {k: fx.WEEKS for k in markets}
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL OR withdrawn_at IS NOT NULL") == [(0,)]


def test_a_third_report_left_out_beside_two_withdrawn_ones_holds_the_market_and_says_why(tmp_path):
    """At most two reports of a market are withdrawn while the CFTC leaves them out; a third left out is not taken on
    trust: the market is held, the others are stored, and the watermark names it (the owner's call)."""
    f = tmp_path / "s.db"
    refresh(f)
    two = [(END - timedelta(weeks=k)).isoformat() for k in (30, 60)]
    drop = lambda extra: (lambda rows: [r for r in rows if not (r["cftc_contract_market_code"] == "13874A"  # noqa: E731
                                                                and r["report_date_as_yyyy_mm_dd"][:10] in two + extra)])
    refresh(f, served(tff=drop([])), now=NOW + timedelta(days=1))
    assert refresh(f, served(tff=drop([])), now=NOW + timedelta(days=2))["counts"]["withdrawn"] == 10
    s = refresh(f, served(tff=drop([(END - timedelta(weeks=90)).isoformat()])), now=NOW + timedelta(days=3))
    assert s["status"] == "partial" and s["counts"]["withdrawn"] == 0
    assert "13874A (3 stored reports not served" in s["detail"] and "treated as incomplete" in s["detail"]
    assert _readable(f)["spx"] == fx.WEEKS - 2 and _readable(f)["ust10y"] == fx.WEEKS
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL AND withdrawn_at IS NULL") == [(0,)]


def test_a_newest_week_a_lagging_read_leaves_out_stays_readable_and_is_served_again(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)
    s = refresh(f, served(tff=_newest_cut(1), disaggregated=_newest_cut(1)), now=NOW + timedelta(hours=1))
    assert s["status"] == "partial" and s["counts"]["withdrawn"] == 0 and len(s["unconfirmed"]) == 5
    assert set(s["newest"].values()) == {END.isoformat()}  # the watermark keeps the newest stored report
    s = refresh(f, now=NOW + timedelta(hours=2))
    assert s["status"] == "ok" and s["counts"]["restored"] == 0 and s["unconfirmed"] == []
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL OR withdrawn_at IS NOT NULL") == [(0,)]


def test_a_store_written_before_the_confirmation_rule_gets_the_column(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)
    with sqlite3.connect(f) as c:
        c.execute(f"ALTER TABLE {cot.TABLE} DROP COLUMN unserved_since")
    s = refresh(f, served(tff=_drop("2026-09-22")), now=NOW + timedelta(days=1))
    assert s["counts"]["withdrawn"] == 0 and rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE unserved_since IS NOT NULL") == [(5,)]


def test_an_amendment_is_stored_while_another_market_is_held(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)

    def amend_and_cut(rows):
        out = []
        for r in rows:
            if r["cftc_contract_market_code"] == "043602" and r["report_date_as_yyyy_mm_dd"] < "2025":
                continue  # the 10-year note cut short
            if r["cftc_contract_market_code"] == "13874A" and r["report_date_as_yyyy_mm_dd"].startswith("2026-09-15"):
                r = dict(r)
                r["lev_money_positions_long"] = str(int(r["lev_money_positions_long"]) + 7)
                r["open_interest_all"] = str(int(r["open_interest_all"]) + 7)
                r["lev_money_positions_short"] = str(int(r["lev_money_positions_short"]))
                r["dealer_positions_short_all"] = str(int(r["dealer_positions_short_all"]) + 7)
            out.append(r)
        return out

    s = refresh(f, served(tff=amend_and_cut), now=NOW + timedelta(days=1))
    assert s["status"] == "partial" and "043602" in s["detail"] and s["counts"]["revised"] > 0
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.REVISIONS} WHERE contract_code = '13874A' AND as_of = '2026-09-15'") != [(0,)]
    assert _readable(f)["ust10y"] == fx.WEEKS


def test_a_market_the_read_does_not_serve_is_not_withdrawn(tmp_path):
    """A read that serves none of a market's reports is not a full read of it: its stored reports stay readable."""
    f = tmp_path / "s.db"
    refresh(f)
    s = refresh(f, served(tff=lambda rows: [r for r in rows if r["cftc_contract_market_code"] != "098662"]), now=NOW + timedelta(days=1))
    assert s["status"] == "partial" and "no report served for 098662" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL") == [(0,)]
    assert {m["key"] for m in block(f)["markets"]} == {"spx", "ust10y", "usd", "gold", "wti"}


def test_a_failed_read_keeps_what_is_stored_and_says_so(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)

    def down(rows):
        raise OSError("connection refused")

    s = refresh(f, served(disaggregated=down), now=NOW + timedelta(days=1))
    assert s["status"] == "partial" and "not read: Disaggregated, futures only: OSError: connection refused" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE report = 'disaggregated' AND withdrawn_at IS NULL") == [(fx.WEEKS * 2 * 5,)]
    assert rows_of(f, f"SELECT status FROM {cot.RUNS} ORDER BY started_at") == [("committed",), ("committed",)]


def test_a_run_that_reads_nothing_fails_and_its_watermark_says_error(tmp_path):
    f = tmp_path / "s.db"

    def down(url):
        raise OSError("no route to host")

    s = refresh(f, down)
    assert s["status"] == "error" and s["newest"] == {m.key: None for m in cot.MARKETS}
    assert rows_of(f, f"SELECT status FROM {cot.RUNS}") == [("failed",)]
    assert rows_of(f, "SELECT last_obs, status FROM source_watermarks") == [(None, "error")]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE}") == [(0,)]


def test_an_answer_that_reaches_the_row_limit_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(cot, "ROW_LIMIT", 100)
    s = refresh(tmp_path / "s.db")
    assert s["status"] == "error" and "page limit" in s["detail"]


def test_main_never_fails_the_refresh(tmp_path, monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(cot, "refresh", boom)
    assert cot.main(["--db", str(tmp_path / "x.db")]) == 0
    assert "not refreshed (RuntimeError: disk full)" in capsys.readouterr().out


# ── parsing: what is refused ────────────────────────────────────────────────

TFF = cot.REPORTS["tff"]


def _one(**edit):
    row = dict(fx.synth_rows(TFF, ["13874A"], end=END, weeks=1)[0])
    for k, v in edit.items():
        if v is None:
            row.pop(k, None)
        else:
            row[k] = v
    return row


@pytest.mark.parametrize("edit, why", [
    ({"dealer_positions_long_all": "12.5"}, "not a whole number of contracts"),
    ({"dealer_positions_long_all": "-3"}, "not a whole number of contracts"),
    ({"dealer_positions_long_all": None}, "dealer_positions_long_all is missing"),
    ({"open_interest_all": "1"}, "is not the open interest"),
    ({"futonly_or_combined": "Combined"}, "not a futures-only row"),
    ({"report_date_as_yyyy_mm_dd": "2026-02-30T00:00:00.000"}, "is not a date"),
    ({"report_date_as_yyyy_mm_dd": "09/22/2026"}, "is not a date"),
    ({"cftc_contract_market_code": "999999"}, "was not asked for"),
    ({"id": ""}, "no market name or row id"),
])
def test_a_row_that_breaks_a_rule_is_refused_with_why(edit, why):
    parsed, refused = cot.parse_rows(TFF, [_one(**edit)], {"13874A"})
    assert parsed == [] and len(refused) == 1 and why in refused[0]


def test_a_report_served_twice_is_refused_both_times():
    row = _one()
    parsed, refused = cot.parse_rows(TFF, [row, dict(row)], {"13874A"})
    assert parsed == [] and refused == [f"13874A {END.isoformat()}: served more than once"]


def _spoil(rows, at=0):
    rows = copy.deepcopy(rows)
    rows[at]["open_interest_all"] = "7"
    return rows


def test_a_refused_row_stops_its_report_being_stored_and_says_why(tmp_path):
    # Codex S-1: no partial read is published. The other report is stored as usual.
    f = tmp_path / "s.db"
    s = refresh(f, served(tff=_spoil))
    # nothing stored for three of the five markets yet: the watermark holds no observation
    assert s["counts"]["refused"] == 1 and s["status"] == "error"
    assert "Traders in Financial Futures, futures only: 1 row(s) refused, so nothing of it was replaced" in s["detail"]
    assert "is not the open interest 7" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE report = 'tff'") == [(0,)]
    assert rows_of(f, f"SELECT COUNT(DISTINCT as_of || contract_code) FROM {cot.TABLE} WHERE report = 'disaggregated'") == [(fx.WEEKS * 2,)]


def test_an_invalid_replacement_keeps_the_stored_reports_and_withdraws_nothing(tmp_path):
    # Codex S-1's counterexample: valid reports stored, then served again with the newest one's open interest broken.
    f = tmp_path / "s.db"
    refresh(f)
    before = rows_of(f, f"SELECT * FROM {cot.TABLE} ORDER BY report, contract_code, as_of, category")
    newest = max(range(fx.WEEKS * 3), key=lambda i: fx.synth_rows(cot.REPORTS["tff"], CODES["tff"], end=END)[i]["report_date_as_yyyy_mm_dd"])
    s = refresh(f, served(tff=lambda rows: _spoil(rows, newest)), now=NOW + timedelta(days=7))
    assert s["counts"] == {"new": 0, "revised": 0, "restored": 0, "withdrawn": 0, "refused": 1}
    assert s["status"] == "partial" and "nothing of it was replaced" in s["detail"]
    assert rows_of(f, f"SELECT * FROM {cot.TABLE} ORDER BY report, contract_code, as_of, category") == before
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.TABLE} WHERE withdrawn_at IS NOT NULL") == [(0,)]
    assert rows_of(f, f"SELECT COUNT(*) FROM {cot.REVISIONS}") == [(0,)]
    assert block(f)["markets"][0]["as_of"] == END.isoformat()


# ── the reader: what is set aside ───────────────────────────────────────────

@pytest.fixture
def store(tmp_path):
    f = tmp_path / "s.db"
    refresh(f)
    return f


def _edit(path: Path, sql: str, *args):
    with sqlite3.connect(path) as c:
        c.execute(sql, args)


def _spx(path: Path) -> dict:
    return next(m for m in block(path)["markets"] if m["key"] == "spx")


def test_a_report_from_a_run_that_never_committed_is_set_aside(store):
    _edit(store, f"INSERT INTO {cot.RUNS} VALUES ('r-open', 'cftc_pre', '2026-09-26T11:00:00Z', NULL, 'started', NULL)")
    _edit(store, f"UPDATE {cot.TABLE} SET run_id = 'r-open' WHERE contract_code = '13874A' AND as_of = '2026-09-22' AND category = 'dealer'")
    assert _spx(store)["excluded"] == [{"as_of": "2026-09-22", "reason": "a run that never committed wrote it"}]


@pytest.mark.parametrize("sql, why", [
    ("UPDATE {t} SET long = long + 5 WHERE {w} AND category = 'dealer'",
     "its long or short positions plus spreading are not its open interest"),
    ("UPDATE {t} SET open_interest = open_interest + 1 WHERE {w} AND category = 'dealer'",
     "its categories disagree on the open interest"),
    ("DELETE FROM {t} WHERE {w} AND category = 'nonreportables'", "it does not hold every trader category of its report"),
    ("UPDATE {t} SET first_stored_at = '2026-09-21T23:00:00Z' WHERE {w}", "it is dated after the store first held it (2026-09-21)"),
])
def test_a_stored_report_that_breaks_a_rule_is_set_aside_with_why(store, sql, why):
    _edit(store, sql.format(t=cot.TABLE, w="contract_code = '13874A' AND as_of = '2026-09-22'"))
    spx = _spx(store)
    assert spx["excluded"] == [{"as_of": "2026-09-22", "reason": why}] and spx["as_of"] == "2026-09-15"


def test_a_market_with_no_readable_report_is_missing_and_none_at_all_awaits(store):
    _edit(store, f"UPDATE {cot.TABLE} SET withdrawn_at = '2026-09-27T00:00:00Z' WHERE contract_code = '13874A'")
    b = block(store)
    assert [m["key"] for m in b["markets"]] == ["ust10y", "usd", "gold", "wti"]
    (miss,) = b["missing"]
    assert miss["key"] == "spx" and miss["reason"] == "no readable report is stored" and len(miss["excluded"]) == fx.WEEKS
    _edit(store, f"UPDATE {cot.TABLE} SET withdrawn_at = '2026-09-27T00:00:00Z'")
    with pytest.raises(env.Awaiting) as e:
        block(store)
    assert str(e.value) == dp.NONE_READABLE


def test_a_store_without_the_tables_awaits(tmp_path):
    f = tmp_path / "empty.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    with pytest.raises(env.Awaiting) as e:
        block(f)
    assert str(e.value) == dp.NOT_STORED


# ── the figures ─────────────────────────────────────────────────────────────

def _manual(path: Path, code: str, report: str, cat: str) -> list[tuple[str, int, int]]:
    """(as_of, net, open interest) of a category, every report, straight from the table."""
    return rows_of(path, f"SELECT as_of, long - short, open_interest FROM {cot.TABLE} WHERE contract_code = ? AND report = ? "
                         "AND category = ? ORDER BY as_of", code, report, cat)


def test_the_figures_follow_the_spec(store):
    b = block(store)
    assert b["provider"] == "CFTC" and b["lag_note"] == dp.LAG_NOTE and b["range_years"] == 3 and b["range_min_reports"] == 150
    for m in b["markets"]:
        mk = next(x for x in cot.MARKETS if x.key == m["key"])
        rows = _manual(store, mk.contract_code, mk.report, mk.primary)
        as_of, net, oi = rows[-1]
        assert (m["as_of"], m["net"], m["open_interest"]) == (as_of, net, oi)
        assert m["net"] == m["long"] - m["short"] and m["net_pct_oi"] == pytest.approx(100 * net / oi)
        # The change is against the report a week before.
        p_as_of, p_net, p_oi = rows[-2]
        assert m["change_1w"] == {"from": p_as_of, "net": net - p_net,
                                  "net_pct_oi": pytest.approx(100 * net / oi - 100 * p_net / p_oi)}
        # Where it sits: the reports dated after the same day three years earlier, through the report.
        start = date(2023, 9, 22)
        win = [(a, 100 * n / o) for a, n, o in rows if date.fromisoformat(a) > start]
        cur = 100 * net / oi
        r = m["range_3y"]
        assert r["n"] == len(win) and 156 <= r["n"] <= 157 and r["from"] == win[0][0] and r["to"] == as_of
        assert r["percentile"] == pytest.approx(100 * sum(1 for _, v in win if v <= cur) / len(win))
        assert r["min_pct_oi"] == pytest.approx(min(v for _, v in win)) and r["max_pct_oi"] == pytest.approx(max(v for _, v in win))
        assert [s["as_of"] for s in m["series"]] == [a for a, _ in win]
        # Every category of the report, in the CFTC's order, and the identity holds on them.
        cats = cot.REPORTS[mk.report].categories
        assert [c["category"] for c in m["categories"]] == [c[0] for c in cats]
        spreads = sum(c["spread"] or 0 for c in m["categories"])
        assert sum(c["long"] for c in m["categories"]) + spreads == oi == sum(c["short"] for c in m["categories"]) + spreads
        assert m["history_from"] == rows[0][0] and m["reports"] == fx.WEEKS


def test_the_change_needs_the_report_a_week_before(store):
    _edit(store, f"DELETE FROM {cot.TABLE} WHERE contract_code = '13874A' AND as_of = '2026-09-15'")
    spx = _spx(store)
    assert spx["change_1w"] is None
    assert spx["change_reason"] == "the report before is dated 2026-09-08, not the week before"


def test_the_range_needs_150_reports_in_the_window(store):
    _edit(store, f"DELETE FROM {cot.TABLE} WHERE contract_code = '13874A' AND as_of < '2024-01-01'")
    spx = _spx(store)
    n = len(rows_of(store, f"SELECT DISTINCT as_of FROM {cot.TABLE} WHERE contract_code = '13874A'"))
    assert n < 150 and spx["range_3y"] is None
    assert spx["range_reason"] == f"needs 150 weekly reports in the three years to 2026-09-22; {n} are stored"


def test_a_report_dated_later_than_the_window_never_enters_it(store):
    """Point in time: the window ends at the report, so a set-aside later report never enters an earlier figure."""
    _edit(store, f"UPDATE {cot.TABLE} SET withdrawn_at = '2026-09-27T00:00:00Z' WHERE contract_code = '13874A' AND as_of = '2026-09-22'")
    spx = _spx(store)
    assert spx["range_3y"]["to"] == "2026-09-15" and spx["series"][-1]["as_of"] == "2026-09-15"


# ── release dates ───────────────────────────────────────────────────────────

def test_the_release_is_read_from_the_cftc_schedule():
    assert dp.release_of("2026-09-22", "2026-09-26T11:20:00Z") == {
        "released": "2026-09-25", "release_delayed": False, "release_basis": "cftc_schedule",
        "release_note": "CFTC schedule, 15:30 ET"}
    # Veterans Day week: positions as of Tuesday 10 November, released Monday 16 November.
    assert dp.release_of("2026-11-10", "2026-11-17T06:00:00Z")["release_delayed"] is True
    assert dp.release_of("2026-11-10", "2026-11-17T06:00:00Z")["release_note"].endswith("delayed by a federal holiday")
    # The schedule's first release is the year's first Monday, for positions as of 30 December 2025.
    assert dp.release_of("2025-12-30", "2026-01-06T00:00:00Z")["released"] == "2026-01-05"
    # Earlier reports are not on it: nothing is inferred.
    assert dp.release_of("2025-12-16", "2026-01-06T00:00:00Z") == {
        "released": None, "release_delayed": None, "release_basis": None,
        "release_note": "release date not on the CFTC schedule this store holds"}
    # A store that held the report before the scheduled date shows the schedule is wrong for it.
    early = dp.release_of("2026-09-22", "2026-09-24T22:00:00Z")
    assert early["released"] is None and early["release_note"] == "the store held it on 2026-09-24, before the scheduled 2026-09-25"


def test_the_schedule_is_the_cftcs_2026_page():
    assert len(cot_schedule.RELEASES) == 52 and cot_schedule.FIRST == date(2026, 1, 5) and cot_schedule.LAST == date(2026, 12, 28)
    assert sum(d for _, d in cot_schedule.RELEASES) == 6
    assert [r for r, _ in cot_schedule.RELEASES] == sorted({r for r, _ in cot_schedule.RELEASES})
    assert cot_schedule.release_for(date(2026, 12, 28)) is None  # past the last scheduled release
    assert cot_schedule.release_for(date(2026, 12, 22)) == (date(2026, 12, 28), True)
    # Every scheduled release is the Friday after a Tuesday's positions, or later in a holiday week.
    for released, delayed in cot_schedule.RELEASES:
        assert released.weekday() == 4 or delayed, released


# ── the route ───────────────────────────────────────────────────────────────

@pytest.fixture
def serve(tmp_path, monkeypatch, install_worker):
    def start(path: Path):
        monkeypatch.setattr(db, "DB_PATH", path)
        db.reset_connections_for_tests()
        w = install_worker(worker_mod.AnalyticsWorker(items=[("desk_positioning", _desk_positioning)], poll_s=0.05, preload=False))
        w.start(serving=True)
        assert w.wait_published(timeout=30)
        return w
    return start


def test_the_route_serves_the_stored_positions_in_the_contract(store, serve):
    serve(store)
    body = dc.check_response("/positioning", client.get("/api/desk/positioning"))
    assert body["status"] == "ready"
    fut, hold = body["data"]["futures"], body["data"]["holdings"]
    assert fut["status"] == "ready" and [m["key"] for m in fut["data"]["markets"]] == ["spx", "ust10y", "usd", "gold", "wti"]
    assert fut["data"] == json.loads(json.dumps(block(store)))
    assert hold["status"] == "awaiting" and hold["unavailable"]["reason"] == dp.HOLDINGS_NOT_STORED


def test_the_route_awaits_on_a_store_without_positions_and_refuses_parameters(tmp_path, serve):
    f = tmp_path / "empty.db"
    with sqlite3.connect(f) as c:
        c.execute("CREATE TABLE t (x)")
    serve(f)
    body = dc.check_response("/positioning", client.get("/api/desk/positioning"))
    assert body["data"]["futures"]["unavailable"]["reason"] == dp.NOT_STORED
    r = client.get("/api/desk/positioning?market=spx")
    body = dc.check_response("/positioning", r)
    assert r.status_code == 422 and body["error"]["code"] == "unsupported" and "market" in body["error"]["message"]


# ── the fixture and the reference check ─────────────────────────────────────

def test_the_committed_fixture_is_what_the_served_code_builds(tmp_path):
    """web/src/fixtures/desk/positioning.json is regenerated by scripts/desk_positioning_fixture.py, byte for byte."""
    payload = fx.build(tmp_path / "fx.db")
    assert json.dumps(payload, indent=1, sort_keys=False) + "\n" == fx.OUT.read_text()
    assert payload["futures"]["credit"].startswith("Invented positions, not CFTC data")


def _archive_zip(report: str, rows: list[dict], name: str) -> bytes:
    """An archive file shaped as the CFTC's yearly text files, from the invented API rows."""
    import csv
    import io
    import zipfile

    cols = ref.ARCHIVE_COLUMNS[report]
    api = {c[0]: c[1:] for c in cot.REPORTS[report].categories}
    out = io.StringIO()
    head = ["CFTC_Contract_Market_Code", "Report_Date_as_YYYY-MM-DD", "Open_Interest_All"] + [
        c for cat in cols.values() for c in cat if c]
    w = csv.DictWriter(out, head)
    w.writeheader()
    for r in rows:
        line = {"CFTC_Contract_Market_Code": r["cftc_contract_market_code"],
                "Report_Date_as_YYYY-MM-DD": r["report_date_as_yyyy_mm_dd"][:10], "Open_Interest_All": r["open_interest_all"]}
        for cat, archive_cols in cols.items():
            for a_col, api_col in zip(archive_cols, api[cat]):
                if a_col:
                    line[a_col] = r[api_col]
        w.writerow(line)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, out.getvalue())
    return buf.getvalue()


def test_the_reference_check_matches_a_store_and_catches_one_contract(store, tmp_path, capsys):
    files = []
    for key in cot.REPORTS:
        p = tmp_path / ("fut_fin_txt_2026.zip" if key == "tff" else "fut_disagg_txt_2026.zip")
        p.write_bytes(_archive_zip(key, fx.synth_rows(cot.REPORTS[key], CODES[key], end=END), "x.txt"))
        files.append(str(p))
    assert ref.main(["--db", str(store), "--files", *files]) == 0
    assert capsys.readouterr().out.count(": match") == 5
    _edit(store, f"UPDATE {cot.TABLE} SET short = short + 1 WHERE contract_code = '067651' AND as_of = '2026-03-03' AND category = 'swap_dealers'")
    assert ref.main(["--db", str(store), "--files", *files]) == 1
    out = capsys.readouterr().out
    assert "wti    067651" in out and "DIFFER" in out and "('067651', '2026-03-03', 'swap_dealers')" in out


def test_the_reference_check_reads_the_2006_2016_number_and_date_forms():
    assert ref._int("2754179.000000") == 2754179 and ref._int(" 12 ") == 12
    with pytest.raises(ValueError):
        ref._int("12.5")
    assert ref._date("1/10/2012 12:00:00 AM") == "2012-01-10" and ref._date("2017-01-03") == "2017-01-03"
