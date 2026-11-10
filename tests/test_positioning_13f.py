"""Desk P4 (D7): the SEC 13F step, its reader and the holdings block of GET /api/desk/positioning, on invented filings.

Every store here is built from scripts/desk_positioning_fixture.synth_sec: invented 13F data sets and fails-to-deliver
files in the SEC's own shapes (seeded filers SYN-<n>, issuers 'INVENTED <ticker> CORP', CUSIPs SYN<n>; test-data rule),
read through a fake client. Nothing reaches the network. The method is docs/desk/POSITIONING_SPEC.md §3; the check
against the filings on EDGAR is scripts/check_13f_reference.py.
"""

from __future__ import annotations

import io
import json
import sqlite3
import urllib.error
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import db
from api import desk_envelope as env
from api import desk_positioning as dp
from api import worker as worker_mod
from api.analytics_cache import _desk_positioning
from api.main import app
from scripts import desk_positioning_fixture as fx
from src.desk import presets
from src.market_data import sec_13f as s13
from tests import desk_contract as dc

client = TestClient(app, raise_server_exceptions=False)
_RealClient = s13.Client
NOW = datetime(2026, 9, 19, 11, 20, tzinfo=timezone.utc)
Q2, Q1 = date(2026, 6, 30), date(2026, 3, 31)
SETS_PATH = s13._path(s13.SETS_PAGE)


def files(**kw) -> dict[str, bytes]:
    return fx.synth_sec(**kw)


def refresh(path: Path, sec: fx.FakeSec | None = None, **kw) -> dict:
    return s13.refresh(path, now=kw.pop("now", NOW), client=sec or fx.FakeSec(files()), **kw)


def rows_of(path: Path, sql: str, *args) -> list[tuple]:
    with sqlite3.connect(path) as c:
        return c.execute(sql, args).fetchall()


def snapshot(path: Path) -> list:
    return [rows_of(path, f"SELECT * FROM {t} ORDER BY 1, 2") for t in (s13.TABLE, s13.REFUSED, s13.PERIODS)]


@pytest.fixture
def store(tmp_path) -> Path:
    f = tmp_path / "store.db"
    assert refresh(f)["status"] == "ok"
    return f


# ── the index pages and the choice of quarters ─────────────────────────────

def test_the_data_sets_and_fails_files_are_read_from_the_index_pages():
    fs = files()
    sets = s13.data_sets(fs[SETS_PATH].decode())
    assert [(s.start, s.end) for s in sets] == [(date(2025, 12, 1), date(2026, 2, 28)), (date(2026, 3, 1), date(2026, 5, 31)),
                                                 (date(2026, 6, 1), date(2026, 8, 31))]
    ftd = s13.ftd_paths(fs[s13._path(s13.FTD_PAGE)].decode())
    assert [p.rsplit("/", 1)[-1] for p in ftd] == ["cnsfails202609b.zip", "cnsfails202609a.zip", "cnsfails202608b.zip",
                                                    "cnsfails202608a.zip", "cnsfails202607b.zip", "cnsfails202607a.zip"]
    # the quarterly-named sets before 2024 are not read
    assert s13.data_sets('<a href="/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">') == []


def W(a: str, b: str) -> s13.DataSet:
    return s13.DataSet(f"/files/x/{a}-{b}_form13f.zip", s13._name_date(a), s13._name_date(b))


def test_the_newest_quarter_is_the_one_whose_deadline_the_data_sets_cover():
    sets = [W("01dec2025", "28feb2026"), W("01mar2026", "31may2026"), W("01jun2026", "31aug2026")]
    period, prev, needed = s13.choose(sets)
    assert (period, prev) == (Q2, Q1) and [s.name for s in needed] == [sets[1].name, sets[2].name]
    # a newest set that stops before the 45-day deadline (2026-08-14) leaves the quarter before as the newest
    period, prev, needed = s13.choose(sets[:2] + [W("01jun2026", "10aug2026")])
    assert (period, prev) == (Q1, date(2025, 12, 31)) and len(needed) == 3
    assert s13.deadline_of(Q2) == date(2026, 8, 14) and s13.deadline_of(date(2025, 12, 31)) == date(2026, 2, 14)


def test_a_gap_in_the_data_sets_is_refused():
    with pytest.raises(s13.Refused, match="gap between 2026-05-31 and 2026-06-02"):
        s13.choose([W("01mar2026", "31may2026"), W("02jun2026", "31aug2026")])
    with pytest.raises(s13.Refused, match="no data set covers filings from 2026-04-01"):
        s13.choose([W("15apr2026", "31may2026"), W("01jun2026", "31aug2026")])
    with pytest.raises(s13.Refused, match="lists no Form 13F data set"):
        s13.choose([])


# ── amendments ──────────────────────────────────────────────────────────────

def F(acc, filed, kind="13F-HR", amendment="", cik="1", period=Q2, report_type="13F HOLDINGS REPORT"):
    return {"accession": acc, "cik": cik, "period": period, "filed": date.fromisoformat(filed), "kind": kind,
            "amendment": amendment, "report_type": report_type, "data_set": "x"}


def test_a_restatement_replaces_the_report_and_new_holdings_filed_after_it_add():
    keep, n = s13.effective([
        F("a1", "2026-07-20"),
        F("a2", "2026-07-25", "13F-HR/A", "NEW HOLDINGS"),   # superseded by the restatement filed after it
        F("a3", "2026-08-01", "13F-HR/A", "RESTATEMENT"),
        F("a4", "2026-08-05", "13F-HR/A", "NEW HOLDINGS"),
    ])
    assert sorted(keep) == ["a3", "a4"] and n["restatements"] == 1 and n["new_holdings"] == 1
    # the latest base by filing date, then accession number
    keep, _ = s13.effective([F("b2", "2026-07-20"), F("b1", "2026-07-20", "13F-HR/A", "RESTATEMENT")])
    assert sorted(keep) == ["b2"]
    # filers and quarters are separate
    keep, _ = s13.effective([F("c1", "2026-07-20"), F("c2", "2026-07-21", cik="2"), F("c3", "2026-05-01", period=Q1)])
    assert sorted(keep) == ["c1", "c2", "c3"]


def test_the_stored_figures_follow_the_amendment_rule_and_skip_options_and_principal_rows(store):
    """A second count straight from the invented files: holders and shares per ticker, by the module docstring's rule."""
    fs = files()
    filings, info = [], defaultdict(list)
    for path, blob in fs.items():
        if path.endswith("_form13f.zip"):
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                filings += s13.read_filings(z, {Q1, Q2}, path)
                lines = z.read("INFOTABLE.tsv").decode().splitlines()[1:]
            for line in lines:
                acc, name, cusip, value, shares, kind, putcall = line.split("\t")
                info[acc].append((cusip, int(shares), kind, putcall))
    by = defaultdict(list)
    for f in filings:
        by[(f["cik"], f["period"])].append(f)
    held = defaultdict(Counter)  # (period, cusip) → cik → shares
    for (cik, period), group in by.items():
        group.sort(key=lambda f: (f["filed"], f["accession"]))
        base = [f for f in group if f["kind"] == "13F-HR" or f["amendment"] == "RESTATEMENT"][-1]
        counted = [base] + [f for f in group if f["amendment"] == "NEW HOLDINGS" and (f["filed"], f["accession"]) > (base["filed"], base["accession"])]
        for f in counted:
            for cusip, shares, kind, putcall in info[f["accession"]]:
                if kind == "SH" and not putcall and cusip != "BAD":
                    held[(period, cusip)][cik] += shares
    cusip_of = {sym: f"SYN{i:05d}0" for i, sym in enumerate(presets.constituents())}
    stored = {(k, p): (h, sh, t) for k, p, h, sh, t in rows_of(store, f"SELECT symbol_key, period, holders, shares, top10_shares FROM {s13.TABLE}")}
    for sym in presets.constituents():
        if sym == fx.SEC_MISMATCH:
            continue  # refused: its names disagree
        for p in (Q1, Q2):
            c = held.get((p, cusip_of[sym]))
            want = (len(c), sum(c.values()), sum(sorted(c.values(), reverse=True)[:10])) if c else None
            assert stored.get((sym, p.isoformat())) == want, (sym, p)


def test_a_filer_writing_values_in_the_wrong_unit_moves_no_rank(tmp_path):
    """Positions are valued at the CUSIP's median reported price, so filer 7's values in thousands change nothing."""
    a = tmp_path / "a.db"
    refresh(a)
    fs = files()
    # the same files with filer 7's values written in dollars like everyone else's
    fixed = {}
    for path, blob in fs.items():
        if not path.endswith("_form13f.zip"):
            fixed[path] = blob
            continue
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            members = {m: z.read(m) for m in z.namelist()}
        subs = members["SUBMISSION.tsv"].decode().splitlines()
        accs7 = {ln.split("\t")[0] for ln in subs[1:] if ln.split("\t")[3] == f"{7:010d}"}
        lines = members["INFOTABLE.tsv"].decode().splitlines()
        out = [lines[0]]
        for ln in lines[1:]:
            parts = ln.split("\t")
            if parts[0] in accs7:
                parts[3] = str(int(parts[3]) * 1000)
            out.append("\t".join(parts))
        members["INFOTABLE.tsv"] = ("\n".join(out) + "\n").encode()
        fixed[path] = fx._zip(members)
    b = tmp_path / "b.db"
    refresh(b, fx.FakeSec(fixed))
    q = f"SELECT symbol_key, period, large_filers_top10 FROM {s13.TABLE} ORDER BY 1, 2"
    assert rows_of(a, q) == rows_of(b, q)


# ── the store ───────────────────────────────────────────────────────────────

def test_an_amendment_of_no_stated_type_refuses_the_quarter():
    # Its effect cannot be applied: were it a restatement, leaving it out would publish the numbers it replaced.
    with pytest.raises(s13.Refused, match="a5 .*states no amendment type.*nothing replaced"):
        s13.effective([F("a1", "2026-07-20"), F("a5", "2026-08-06", "13F-HR/A", "")])


def test_a_run_stores_both_quarters_with_their_dates_and_counts(store):
    periods = rows_of(store, f"SELECT period, deadline, data_sets, filings_through, filers, restatements, new_holdings, "
                             f"(SELECT COUNT(*) FROM {s13.TABLE} t WHERE t.period = p.period), "
                             f"method FROM {s13.PERIODS} p ORDER BY period")
    assert [p[:4] for p in periods] == [
        ("2026-03-31", "2026-05-15", "01mar2026-31may2026_form13f.zip,01jun2026-31aug2026_form13f.zip", "2026-08-31"),
        ("2026-06-30", "2026-08-14", "01mar2026-31may2026_form13f.zip,01jun2026-31aug2026_form13f.zip", "2026-08-31")]
    for p in periods:
        assert p[4] == fx.SEC_FILERS and p[5] == 6 and p[6] == 4 and p[7] > 0 and p[8] == s13.METHOD
    runs = rows_of(store, f"SELECT source, status FROM {s13.RUNS}")
    assert runs == [("sec_13f", "committed")]
    wm = rows_of(store, "SELECT last_obs, status FROM source_watermarks WHERE source = 'sec_13f'")
    assert wm == [("2026-06-30", "ok")]


def test_no_cusip_is_stored(store):
    """CUSIPs are used during the run only (POSITIONING_SPEC §3.4)."""
    for t in (s13.TABLE, s13.REFUSED, s13.PERIODS):
        for row in rows_of(store, f"SELECT * FROM {t}"):
            assert not any(isinstance(x, str) and "SYN" in x and any(ch.isdigit() for ch in x.split("SYN")[-1][:5]) for x in row), (t, row)
        cols = [r[1] for r in rows_of(store, f"PRAGMA table_info({t})")]
        assert not any("cusip" in c for c in cols)


def test_tickers_that_cannot_be_settled_are_refused_with_why(store):
    refused = dict(rows_of(store, f"SELECT symbol_key, reason FROM {s13.REFUSED} WHERE period = '2026-06-30'"))
    assert "files name NBIS 'Not The Same Co Com' and 13F filers name its CUSIP 'Invented Nbis Corp'" in refused["NBIS"]
    assert "pair ZQTWO with 2 CUSIPs on 2026-09-20" in refused["ZQTWO"]
    held = {k for (k,) in rows_of(store, f"SELECT symbol_key FROM {s13.TABLE} WHERE period = '2026-06-30'")}
    assert "CRWV" not in held and "CRWV" not in refused  # its CUSIP has no 13F row: served as "no 13F row stored"
    assert {"NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG"} <= held


def test_names_agree_on_their_first_word_or_an_abbreviation_of_it():
    assert s13.names_agree("NVIDIA CORPORATION", "NVIDIA CORP COM")
    assert s13.names_agree("The Trade Desk Inc", "TRADE DESK INC COM CL A")
    assert s13.names_agree("FEDERAL AGRIC MTG CORP", "FED AGRICLT MTG CP")
    assert not s13.names_agree("INVENTED NBIS CORP", "NOT THE SAME CO")
    assert not s13.names_agree("AB", "ABC")  # an abbreviation is three letters or more
    assert s13.symbol_key("BRK.B") == s13.symbol_key("brk-b") == s13.symbol_key("BRK/B") == "BRKB"


def test_a_second_run_on_the_same_data_sets_downloads_nothing(store):
    before = snapshot(store)
    sec = fx.FakeSec(files())
    s = refresh(store, sec)
    assert s["status"] == "ok" and "unchanged" in s["detail"] and sec.paths == [SETS_PATH]
    assert snapshot(store) == before


def _as_method_13f_1(path: Path) -> None:
    """Turn a store into one method 13f-1 wrote: its periods table with the NOT NULL set_aside column it had (no
    default) and every quarter stamped 13f-1, the data sets unchanged."""
    with sqlite3.connect(path) as c:
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({s13.PERIODS})")]
        ddl = c.execute("SELECT sql FROM sqlite_master WHERE name = ?", (s13.PERIODS,)).fetchone()[0]
        c.execute(f"ALTER TABLE {s13.PERIODS} RENAME TO old_periods")
        c.execute(ddl.replace("new_holdings    INTEGER NOT NULL,",
                              "new_holdings    INTEGER NOT NULL,\n    set_aside       INTEGER NOT NULL,", 1))
        c.execute(f"INSERT INTO {s13.PERIODS} ({', '.join(cols)}, set_aside) SELECT {', '.join(cols)}, 0 FROM old_periods")
        c.execute("DROP TABLE old_periods")
        c.execute(f"UPDATE {s13.PERIODS} SET method = '13f-1'")


def test_a_store_method_13f_1_wrote_is_read_again_under_the_new_rules(store):
    # Codex S-4, S-5, without patching METHOD: the data sets are the stored ones, yet the quarters are recomputed
    # (13f-1 accepted what 13f-2 refuses), and the old NOT NULL set_aside column does not stop the write.
    assert s13.METHOD != "13f-1"
    _as_method_13f_1(store)
    assert "set_aside" in {r[1] for r in rows_of(store, f"PRAGMA table_info({s13.PERIODS})")}
    sec = fx.FakeSec(files())
    s = refresh(store, sec)
    assert s["status"] == "ok" and "unchanged" not in s["detail"], s["detail"]
    assert any(p.endswith("_form13f.zip") for p in sec.paths)
    assert "set_aside" not in {r[1] for r in rows_of(store, f"PRAGMA table_info({s13.PERIODS})")}
    assert {m for (m,) in rows_of(store, f"SELECT method FROM {s13.PERIODS}")} == {s13.METHOD}
    # a store 13f-1 wrote, read again with an unreadable row: refused, and the old quarters stay as they were
    other = store.with_name("other.db")
    import shutil
    shutil.copyfile(store, other)
    _as_method_13f_1(other)
    before = snapshot(other)
    fs = files()
    _edit_member(fs, "01jun2026-31aug2026_form13f.zip", "INFOTABLE.tsv", _blank_value_of_a_counted_row)
    s = refresh(other, fx.FakeSec(fs))
    assert s["status"] == "error" and "nothing replaced" in s["detail"]
    # the stored figures stay; only the obsolete column is gone (dropped before the read)
    after = snapshot(other)
    aside = 10  # set_aside's place in 13f-1's periods row, after new_holdings
    assert after[:2] == before[:2]
    assert after[2] == [r[:aside] + r[aside + 1:] for r in before[2]] and all(r[aside] == 0 for r in before[2])


def test_a_new_method_recomputes_and_counts_the_revised_names(store, monkeypatch):
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    monkeypatch.setattr(s13, "TOP_HOLDERS", 5)
    sec = fx.FakeSec(files())
    assert refresh(store, sec)["status"] == "ok" and any(p.endswith("_form13f.zip") for p in sec.paths)
    revised = dict(rows_of(store, f"SELECT period, revised_names FROM {s13.PERIODS}"))
    assert revised["2026-06-30"] > 0  # every name's top-holders shares changed
    assert {m for (m,) in rows_of(store, f"SELECT method FROM {s13.PERIODS}")} == {"13f-test"}


@pytest.mark.parametrize("fail", ["data set", "fails file", "index"])
def test_a_failed_read_keeps_what_is_stored(store, monkeypatch, fail):
    monkeypatch.setattr(s13, "METHOD", "13f-test")  # so the run reads everything again
    before = snapshot(store)
    fs = files()
    target = {"data set": next(p for p in fs if p.endswith("01jun2026-31aug2026_form13f.zip")),
              "fails file": next(p for p in fs if p.endswith("cnsfails202608a.zip")), "index": SETS_PATH}[fail]
    s = refresh(store, fx.FakeSec(fs, fail={target}))
    assert s["status"] == "error" and "refused by the SEC (HTTP 403); not retried" in s["detail"] and "what is stored is kept" in s["detail"]
    assert snapshot(store) == before
    wm = rows_of(store, "SELECT last_obs, status FROM source_watermarks WHERE source = 'sec_13f'")
    assert wm == [("2026-06-30", "error")]
    statuses = [st for (st,) in rows_of(store, f"SELECT status FROM {s13.RUNS} ORDER BY started_at, run_id")]
    assert statuses.count("committed") == 1 and statuses.count("failed") == (0 if fail == "index" else 1)


def test_a_data_set_of_another_shape_is_refused_and_nothing_replaced(store, monkeypatch):
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    before = snapshot(store)
    fs = files()
    path = next(p for p in fs if p.endswith("01jun2026-31aug2026_form13f.zip"))
    with zipfile.ZipFile(io.BytesIO(fs[path])) as z:
        members = {m: z.read(m) for m in z.namelist()}
    members["INFOTABLE.tsv"] = members["INFOTABLE.tsv"].replace(b"SSHPRNAMT\t", b"SHARES\t", 1)
    fs[path] = fx._zip(members)
    s = refresh(store, fx.FakeSec(fs))
    assert s["status"] == "error" and "INFOTABLE.tsv has no SSHPRNAMT column" in s["detail"]
    assert snapshot(store) == before


def _edit_member(fs: dict, suffix: str, member: str, edit) -> None:
    path = next(p for p in fs if p.endswith(suffix))
    with zipfile.ZipFile(io.BytesIO(fs[path])) as z:
        members = {m: z.read(m) for m in z.namelist()}
    members[member] = edit(members[member])
    fs[path] = fx._zip(members)


def _blank_value_of_a_counted_row(blob: bytes) -> bytes:
    """Codex S-2's repro: a counted filing's share row keeps its shares and loses its VALUE."""
    lines = blob.decode().split("\n")
    head = lines[0].split("\t")
    for i, line in enumerate(lines[1:], start=1):
        cells = line.split("\t")
        if len(cells) == len(head) and cells[head.index("SSHPRNAMTTYPE")] == "SH" and not cells[head.index("PUTCALL")]:
            cells[head.index("VALUE")] = ""
            lines[i] = "\t".join(cells)
            return "\n".join(lines).encode()
    raise AssertionError("no share row")


UNREADABLE = {
    "a counted row's value": ("01jun2026-31aug2026_form13f.zip", "INFOTABLE.tsv", _blank_value_of_a_counted_row,
                              "has no readable CUSIP, share count or value"),
    "a short holdings row": ("01jun2026-31aug2026_form13f.zip", "INFOTABLE.tsv", lambda b: b + b"SYN-0001-26-000001\tX\n",
                             "INFOTABLE.tsv line"),
    "a short submission row": ("01mar2026-31may2026_form13f.zip", "SUBMISSION.tsv", lambda b: b + b"SYN-1\n",
                               "SUBMISSION.tsv line"),
    "a filing with no date": ("01jun2026-31aug2026_form13f.zip", "SUBMISSION.tsv",
                              lambda b: b.replace(b"30-JUN-2026", b"30-XXX-2026", 1), "has no readable period or filing date"),
    "a fails file cut short": ("cnsfails202608a.zip", "cnsfails202608a.txt", lambda b: b"\n".join(l for i, l in enumerate(b.split(b"\n")) if i != 1),  # a record lost
                               "is not whole"),
    "a fails file with no trailer": ("cnsfails202609b.zip", "cnsfails202609b.txt",
                                     lambda b: b"\n".join(l for l in b.split(b"\n") if not l.startswith(b"Trailer record count")),
                                     "its trailer counts no records"),
    "a filing with no cover page": ("01jun2026-31aug2026_form13f.zip", "COVERPAGE.tsv",
                                    lambda b: b"\n".join(l for i, l in enumerate(b.split(b"\n")) if i != 1),
                                    "has no COVERPAGE.tsv row"),
    "a ticker with no CUSIP": ("cnsfails202609a.zip", "cnsfails202609a.txt", lambda b: b.replace(b"|SYN", b"|SYN?", 1),
                               "with no readable CUSIP or date"),
}


@pytest.mark.parametrize("case", sorted(UNREADABLE))
def test_an_unreadable_row_replaces_nothing_and_says_where(store, monkeypatch, case):
    # Codex S-2: the figures would leave the row out, so a partial quarter would be published as whole.
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    before = snapshot(store)
    fs = files()
    suffix, member, edit, why = UNREADABLE[case]
    _edit_member(fs, suffix, member, edit)
    s = refresh(store, fx.FakeSec(fs))
    assert s["status"] == "error" and why in s["detail"] and "nothing replaced" in s["detail"], s["detail"]
    assert snapshot(store) == before
    assert rows_of(store, "SELECT last_obs, status FROM source_watermarks WHERE source = 'sec_13f'") == [("2026-06-30", "error")]


def test_codex_s2_one_holder_of_two_is_never_published(tmp_path):
    # Two filers hold one CUSIP, 10 and 90 shares; the second row loses its VALUE: no quarter is stored at all.
    f = tmp_path / "s.db"
    fs = files()
    _edit_member(fs, "01jun2026-31aug2026_form13f.zip", "INFOTABLE.tsv", _blank_value_of_a_counted_row)
    s = refresh(f, fx.FakeSec(fs))
    assert s["status"] == "error" and "nothing replaced" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {s13.TABLE}") == [(0,)] == rows_of(f, f"SELECT COUNT(*) FROM {s13.PERIODS}")


def test_codex_s3_a_restatement_without_its_cover_row_never_leaves_the_original_standing(store, monkeypatch):
    # Codex S-3's repro: the original reports 10 shares and a RESTATEMENT 90; the amendment's cover row is gone.
    # The type is unknown, so the run is refused and the stored quarter stays, rather than serving the 10.
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    before = snapshot(store)
    fs = files()
    path = next(p for p in fs if p.endswith("01jun2026-31aug2026_form13f.zip"))
    with zipfile.ZipFile(io.BytesIO(fs[path])) as z:
        cover = z.read("COVERPAGE.tsv").decode().split("\n")
    restated = next(l.split("\t")[0] for l in cover[1:] if "\tRESTATEMENT\t" in l)
    _edit_member(fs, "01jun2026-31aug2026_form13f.zip", "COVERPAGE.tsv",
                 lambda b: b"\n".join(l for l in b.split(b"\n") if not l.startswith(restated.encode() + b"\t")))
    s = refresh(store, fx.FakeSec(fs))
    assert s["status"] == "error" and f"(filing {restated}) has no COVERPAGE.tsv row" in s["detail"]
    assert snapshot(store) == before


def test_an_empty_read_is_refused_not_stored_as_a_quarter_nobody_held(store, monkeypatch):
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    before = snapshot(store)
    fs = files()
    for p in [p for p in fs if "cnsfails" in p]:
        _edit_member(fs, p.rsplit("/", 1)[-1], p.rsplit("/", 1)[-1].replace(".zip", ".txt"),
                     lambda b: b"\n".join([b.split(b"\n")[0], b"Trailer record count 0", b""]))
    s = refresh(store, fx.FakeSec(fs))
    assert s["status"] == "error" and "pair no ticker with a CUSIP" in s["detail"]
    assert snapshot(store) == before


def test_the_time_budget_stops_the_run_cleanly(store, monkeypatch):
    monkeypatch.setattr(s13, "METHOD", "13f-test")
    before = snapshot(store)
    s = refresh(store, budget_s=-1)
    assert s["status"] == "error" and "nothing replaced" in s["detail"]
    assert snapshot(store) == before


def test_without_a_declared_contact_nothing_is_fetched(tmp_path, monkeypatch, capsys):
    from src.market_data import positioning

    monkeypatch.setenv(s13.CONTACT_ENV, "Invented Person invented@example.invalid")
    f = tmp_path / "s.db"
    s = s13.refresh(f, now=NOW)  # the module reads no environment: no contact passed, none used
    assert s["status"] == "error" and "SEC_USER_AGENT is not set" in s["detail"]
    assert rows_of(f, f"SELECT COUNT(*) FROM {s13.TABLE}") == [(0,)]
    monkeypatch.delenv(s13.CONTACT_ENV)
    monkeypatch.setattr(s13, "Client", lambda *a, **kw: pytest.fail("no request without a contact"))
    assert positioning.main(["--db", str(f), "--sec-only"]) == 0
    assert "SEC_USER_AGENT is not set" in capsys.readouterr().out
    assert rows_of(f, f"SELECT COUNT(*) FROM {s13.TABLE}") == [(0,)]


def test_the_13f_module_reads_no_environment_so_the_api_never_reads_the_contact():
    # The API imports sec_13f for its table names; the contact is read only by the step's runner.
    from tests.test_env_template import _api_closure, _env_reads

    root = Path(__file__).resolve().parents[1]
    assert _env_reads((root / "src/market_data/sec_13f.py").read_text()) == set()
    assert _env_reads((root / "src/market_data/positioning.py").read_text()) == {s13.CONTACT_ENV} == {"SEC_USER_AGENT"}
    closure = {p.relative_to(root).as_posix() for p in _api_closure()}
    assert "src/market_data/sec_13f.py" in closure and "src/market_data/positioning.py" not in closure


# ── the HTTP client ────────────────────────────────────────────────────────

class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def test_the_client_declares_the_contact_spaces_requests_backs_off_and_stops_at_a_refusal(tmp_path):
    contact = "Invented Person invented@example.invalid"
    seen, sleeps = [], []
    script = [urllib.error.HTTPError("u", 429, "Too Many", {}, None), urllib.error.HTTPError("u", 503, "Busy", {}, None), b"ok"]

    def opener(req, timeout):
        seen.append((req.full_url, req.get_header("User-agent")))
        x = script.pop(0)
        if isinstance(x, Exception):
            raise x
        return _Resp(x)

    c = s13.Client(contact, retry_wait=1.0, opener=opener, sleep=sleeps.append)
    assert c.get("/files/a.zip") == b"ok" and c.requests == 3
    assert all(u == "https://www.sec.gov/files/a.zip" and ua == contact for u, ua in seen)
    assert [s for s in sleeps if s >= 1.0] == [1.0, 2.0]  # backoff doubles
    refusals = []

    def refuse(req, timeout):
        refusals.append(1)
        raise urllib.error.HTTPError("u", 403, "Forbidden", {}, None)

    c = s13.Client(contact, opener=refuse, sleep=lambda s: None)
    with pytest.raises(s13.FetchFailed) as exc:
        c.get("/files/b.zip")
    assert refusals == [1] and "not retried" in str(exc.value) and contact not in str(exc.value) and "invented@" not in str(exc.value)
    # a download goes to its file, and the cache keeps it under its whole path
    c = s13.Client(contact, opener=lambda req, timeout: _Resp(b"zipbytes"), sleep=lambda s: None, cache_dir=tmp_path)
    assert Path(c.get("/files/x/y.zip", tmp_path / "dl.zip")).read_bytes() == b"zipbytes"
    assert (tmp_path / "files_x_y.zip").read_bytes() == b"zipbytes"


# ── the reader ─────────────────────────────────────────────────────────────

def hold(path: Path) -> dict:
    with sqlite3.connect(path) as c:
        return dp.holdings_block(c)


def test_the_reader_serves_the_names_asked_for_in_their_order(store):
    h = dp.holdings_for(hold(store), ["CEG", "NBIS", "NVDA", "CRWV", "ZZZZ"])
    assert [n["symbol"] for n in h["names"]] == ["CEG", "NVDA"]
    assert [x["symbol"] for x in h["excluded"]] == ["NBIS", "CRWV", "ZZZZ"]
    assert h["excluded"][1]["reason"].startswith("no 13F row stored: the SEC's fails-to-deliver files read pair no CUSIP with CRWV")
    assert "_rows" not in h and "_refused" not in h
    n = h["names"][1]
    stored = rows_of(store, f"SELECT holders, shares, top10_shares FROM {s13.TABLE} WHERE symbol_key = 'NVDA' AND period = ?", Q2.isoformat())[0]
    prev = rows_of(store, f"SELECT holders FROM {s13.TABLE} WHERE symbol_key = 'NVDA' AND period = ?", Q1.isoformat())[0][0]
    assert (n["holders"], n["shares"], n["top10_share"]) == (stored[0], stored[1], stored[2] / stored[1])
    assert n["holders_prev"] == prev and n["holders_change"] == stored[0] - prev
    assert h["period"] == "2026-06-30" and h["previous_period"] == "2026-03-31" and h["deadline"] == "2026-08-14"


def test_a_ticker_written_another_way_is_the_same_name(store):
    h = dp.holdings_for(hold(store), ["NVDA"])
    with sqlite3.connect(store) as c:
        c.execute(f"UPDATE {s13.TABLE} SET symbol_key = 'BRKB' WHERE symbol_key = 'NVDA'")
    h = dp.holdings_for(hold(store), ["BRK.B"])
    assert [n["symbol"] for n in h["names"]] == ["BRK.B"]


def test_the_reader_awaits_without_the_tables_or_a_committed_run(tmp_path, store):
    empty = tmp_path / "e.db"
    sqlite3.connect(empty).close()
    with pytest.raises(env.Awaiting, match="SEC 13F holdings are not stored"):
        hold(empty)
    with sqlite3.connect(store) as c:
        c.execute(f"UPDATE {s13.RUNS} SET status = 'failed'")
    with pytest.raises(env.Awaiting):
        hold(store)


def test_a_quarter_whose_deadline_the_filings_read_do_not_reach_is_not_served(store):
    with sqlite3.connect(store) as c:
        c.execute(f"UPDATE {s13.PERIODS} SET filings_through = '2026-08-10' WHERE period = '2026-06-30'")
    h = hold(store)
    assert h["period"] == "2026-03-31" and h["previous_period"] is None
    assert h["previous_reason"] == "the quarter before, 2025-12-31, is not stored"
    n = dp.holdings_for(h, ["NVDA"])["names"][0]
    assert n["holders_prev"] is None and n["holders_change"] is None


# ── the route ──────────────────────────────────────────────────────────────

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


def test_the_route_serves_the_holdings_of_the_names_asked_for(store, serve):
    serve(store)
    body = dc.check_response("/positioning", client.get("/api/desk/positioning?names=NVDA,brk-b,CEG"))
    h = body["data"]["holdings"]
    assert h["status"] == "ready" and [n["symbol"] for n in h["data"]["names"]] == ["NVDA", "CEG"]
    assert [x["symbol"] for x in h["data"]["excluded"]] == ["BRK.B"]
    assert body["data"]["futures"]["status"] == "awaiting"  # this store holds no CFTC report
    body = dc.check_response("/positioning", client.get("/api/desk/positioning"))
    assert body["data"]["holdings"]["data"]["names"] == [] and body["data"]["holdings"]["data"]["excluded"] == []


@pytest.mark.parametrize("query, words", [
    ("market=spx", "market is not a parameter of /positioning"),
    ("names=NVDA&names=AMD", "given more than once"),
    ("names=NVDA,nvda", "NVDA is named twice"),
    ("names=" + ",".join(f"ZQ{i:02d}" for i in range(26)), "at most 25 names"),
    ("names=SAP.XETRA", "not a US listing"),
])
def test_the_route_refuses_what_it_cannot_answer(store, serve, query, words):
    serve(store)
    r = client.get(f"/api/desk/positioning?{query}")
    body = dc.check_response("/positioning", r)
    assert r.status_code == 422 and body["error"]["code"] == "unsupported" and words in body["error"]["message"]


def test_the_committed_fixture_holds_invented_filings():
    payload = json.loads(fx.OUT.read_text())
    h = payload["holdings"]
    assert h["credit"].startswith("Invented filings, not SEC data")
    assert [n["symbol"] for n in h["names"]] + [x["symbol"] for x in h["excluded"]] == [
        "NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"]
    assert all(n["issuer"].startswith("INVENTED ") for n in h["names"])


# ── the full refresh's step ────────────────────────────────────────────────

def test_the_full_refresh_runs_one_advisory_positioning_step_with_the_contact_as_a_secret():
    import yaml

    root = Path(__file__).resolve().parents[1]
    steps = yaml.safe_load((root / ".github/workflows/refresh-data.yml").read_text())["jobs"]["refresh"]["steps"]
    mine = [s for s in steps if "src.market_data.positioning" in str(s.get("run", ""))]
    assert len(mine) == 1
    step = mine[0]
    assert step["name"] == "Store positioning (CFTC + SEC 13F)"
    assert step["if"] == "steps.mode.outputs.mode == 'full'"
    assert step["continue-on-error"] is True and step["timeout-minutes"] == 10
    # a repository variable would be printed in the public log; a secret is masked
    assert step["env"] == {"SEC_USER_AGENT": "${{ secrets.SEC_USER_AGENT }}"}
    names = [s.get("name") for s in steps]
    assert names.index("Store positioning (CFTC + SEC 13F)") < names.index("Validate the refreshed database")
    # the step's modules are stdlib only (the full refresh installs no extra package for them)
    import ast
    for mod in ("positioning", "sec_13f", "cot"):
        tree = ast.parse((root / f"src/market_data/{mod}.py").read_text())
        imported = {n.names[0].name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)}
        imported |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
        assert imported <= set(__import__("sys").stdlib_module_names) | {"src", "__future__"}, (mod, imported)


def test_the_step_runs_the_13f_read_even_when_the_cftc_read_fails(tmp_path, monkeypatch, capsys):
    from src.market_data import cot, positioning

    calls = []
    monkeypatch.setattr(cot, "main", lambda argv: calls.append(("cot", argv)) or 0)

    def fake_refresh(path, budget_s, **kw):
        calls.append(("sec", budget_s))
        raise RuntimeError("boom")

    monkeypatch.setattr(s13, "refresh", fake_refresh)
    assert positioning.main(["--db", str(tmp_path / "x.db")]) == 0
    assert [c[0] for c in calls] == ["cot", "sec"] and 60 <= calls[1][1] <= positioning.STEP_BUDGET_S
    assert "sec_13f: not refreshed (RuntimeError)" in capsys.readouterr().out


def test_the_contact_is_sent_in_the_header_and_stored_nowhere(tmp_path, monkeypatch, capsys):
    contact = "Invented Person invented@example.invalid"
    fs = files()
    sent = []

    def opener(req, timeout):
        sent.append(req.get_header("User-agent"))
        return _Resp(fs[req.full_url[len(s13.SITE):]])

    monkeypatch.setenv(s13.CONTACT_ENV, contact)
    monkeypatch.setattr(s13, "Client", lambda c, **kw: _RealClient(c, opener=opener, sleep=lambda s: None, **kw))
    f = tmp_path / "s.db"
    from src.market_data import positioning

    assert positioning.main(["--db", str(f), "--sec-only"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("sec_13f: ok") and sent and set(sent) == {contact}
    assert "invented@" not in out
    with sqlite3.connect(f) as c:
        for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
            for row in c.execute(f"SELECT * FROM {t}"):
                assert not any(isinstance(x, str) and "invented@" in x for x in row), t

