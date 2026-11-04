"""Desk D3 (2026-11-03): the private SPY option-chain snapshot collector, src/market_data/option_snapshots.py.

Every chain here is synthetic (no provider quote enters the public repository): a fake EODHD options endpoint
behind httpx.MockTransport that honours the filters, sorts and paging the collector uses, and a fake GitHub
releases API. Nothing reaches the network.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api.providers import eodhd as eod  # noqa: E402
from api.providers.cache import TokenBucket  # noqa: E402
from src.market_data import option_snapshots as osn  # noqa: E402

TOKEN = "synthetic-options-token-123"
GH_TOKEN = "synthetic-gh-token-456"
ARCHIVE = "someone/spy-archive"
SESSION = "2026-11-02"  # a Monday
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)  # 07:00 New York, Tuesday, before the open
STAMP = "2026-11-02 21:30:00"  # after the close read as UTC or as New York: names 2026-11-02 both ways


@pytest.fixture(autouse=True)
def _free_bucket(monkeypatch):
    # the mocked endpoint answers instantly; the real pacing is exercised in its own test
    monkeypatch.setattr(eod, "_bucket", TokenBucket(rate=1e9, burst=10**9))
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)


def make_chain(spec: dict[str, int], stamp: str = STAMP) -> list[dict]:
    """spec: expiry -> strikes per type. Synthetic rows in the provider's attribute shape."""
    rows = []
    for exp, n in spec.items():
        for t in ("call", "put"):
            for i in range(n):
                k = 400 + i
                rows.append({
                    "contract": f"SPY{exp.replace('-', '')[2:]}{t[0].upper()}{k:05d}000",
                    "underlying_symbol": "SPY", "exp_date": exp, "expiration_type": "weekly", "type": t,
                    "strike": float(k), "bid": 1.0 + i / 100, "ask": 1.1 + i / 100, "bid_date": stamp,
                    "ask_date": stamp, "volatility": 0.2, "open_interest": 10 + i, "dte": 1,
                })
    return rows


class FakeEodhd:
    def __init__(self, rows: list[dict], *, inclusive: bool = True, fail_after: int | None = None,
                 fail_status: int = 503, probe_rows: list[dict] | None = None, dup_exp: str | None = None,
                 tamper=None):
        self.rows = rows
        self.tamper = tamper  # (query, page rows) -> page rows: a provider answer the test wants to be wrong
        self.inclusive = inclusive
        self.calls: list[dict] = []
        self.fail_after = fail_after
        self.fail_status = fail_status
        self.dup_exp = dup_exp

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "eodhd.com"
        q = {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query).items()}
        assert q["api_token"] == TOKEN
        self.calls.append(q)
        if self.fail_after is not None and len(self.calls) > self.fail_after:
            return httpx.Response(self.fail_status, text="no")
        sel = [r for r in self.rows if r["underlying_symbol"] == q["filter[underlying_symbol]"]]
        if "filter[exp_date_eq]" in q:
            sel = [r for r in sel if r["exp_date"] == q["filter[exp_date_eq]"]]
        if "filter[exp_date_from]" in q:
            f = q["filter[exp_date_from]"]
            sel = [r for r in sel if (r["exp_date"] >= f if self.inclusive else r["exp_date"] > f)]
        if "filter[type]" in q:
            sel = [r for r in sel if r["type"] == q["filter[type]"]]
        key = (lambda r: (r["exp_date"], r["contract"])) if q.get("sort") == "exp_date" else (lambda r: (r["strike"], r["contract"]))
        sel = sorted(sel, key=key)
        if self.dup_exp and q.get("filter[exp_date_eq]") == self.dup_exp and sel:
            sel = sel + [sel[0]]
        lim, off = int(q["page[limit]"]), int(q.get("page[offset]", 0))
        page = sel[off:off + lim]
        fields = q.get("fields[options-contracts]")
        if fields:
            keep = fields.split(",")
            page = [{k: r[k] for k in keep if k in r} for r in page]
        nxt = f"https://eodhd.com/api/next?page%5Boffset%5D={off + lim}" if off + lim < len(sel) else None
        if self.tamper is not None:
            page = self.tamper(q, page)
        return httpx.Response(200, json={"meta": {"offset": off, "limit": lim},
                                         "data": [{"id": r.get("contract"), "type": "options-contracts", "attributes": r} for r in page],
                                         "links": {"next": nxt}})


def client_for(fake: FakeEodhd) -> eod.EodhdClient:
    return eod.EodhdClient(TOKEN, transport=httpx.MockTransport(fake), max_retries=osn.CLIENT_RETRIES)


def go(fake, store, now=NOW):
    return osn.run(token=TOKEN, store=store, now=now, client=client_for(fake), sleep=lambda s: None, clock=lambda: now)


SPEC = {"2026-11-02": 30, "2026-11-03": 40, "2026-11-04": 40, "2026-11-06": 60, "2026-12-18": 600, "2027-01-15": 80}


def read_stored(root: Path, session: str, attempt: int = 1) -> tuple[list[dict], dict, bytes]:
    d = root / "SPY" / session[:7]
    data_name, man_name = osn.asset_names(session, attempt)
    raw = (d / data_name).read_bytes()
    rows = [json.loads(line) for line in gzip.decompress(raw).decode().splitlines()]
    return rows, json.loads((d / man_name).read_text()), raw


# ── gates: nothing is called without the collector's own token and a private store ──


def test_no_token_holds_without_a_call(tmp_path):
    fake = FakeEodhd(make_chain(SPEC))
    r = osn.run(token=None, store=osn.LocalStore(tmp_path / "out"), now=NOW, client=client_for(fake))
    assert (r.state, r.detail, r.requests, fake.calls) == ("held", "no_options_token", 0, [])


def test_no_private_store_holds_without_a_call():
    fake = FakeEodhd(make_chain(SPEC))
    r = osn.run(token=TOKEN, store=None, now=NOW, client=client_for(fake))
    assert (r.state, r.detail, fake.calls) == ("held", "no_private_store", [])


def test_the_token_is_the_collectors_own_and_never_the_apis():
    assert osn.options_token({"EODHD_API_TOKEN": "x"}) is None
    assert osn.options_token({"EODHD_OPTIONS_TOKEN": "  t  "}) == "t"
    src = (ROOT / "src/market_data/option_snapshots.py").read_text()
    assert "EODHD_API_TOKEN\"" not in src and "dotenv" not in src and "_load_token(" not in src
    assert "sqlite3" not in src  # it never writes the (public) database


def test_no_other_module_reads_the_collector_token():
    """Adding EODHD_OPTIONS_TOKEN cannot switch asset_history, desk_history or the API to EODHD: only the
    collector reads it, and the provider layer's loader reads EODHD_API_TOKEN alone."""
    readers = []
    for p in list((ROOT / "src").rglob("*.py")) + list((ROOT / "api").rglob("*.py")) + list((ROOT / "scripts").rglob("*.py")):
        if "EODHD_OPTIONS_TOKEN" in p.read_text(errors="ignore"):
            readers.append(str(p.relative_to(ROOT)))
    assert readers == ["src/market_data/option_snapshots.py"]


def test_the_provider_loader_ignores_the_collector_token(monkeypatch, tmp_path):
    from api.providers import market
    monkeypatch.delenv("EODHD_API_TOKEN", raising=False)
    monkeypatch.setenv("EODHD_OPTIONS_TOKEN", TOKEN)
    if (ROOT / ".env").exists() and "EODHD_API_TOKEN=" in (ROOT / ".env").read_text():
        pytest.skip("a local .env carries EODHD_API_TOKEN")
    assert market._load_token() is None


def test_a_local_store_inside_the_repository_is_refused():
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, osn.LocalStore(ROOT / "data" / "snapshots"))
    assert r.state == "storage_refused" and fake.calls == []
    assert not (ROOT / "data" / "snapshots").exists()


# ── collection ──


def test_a_whole_chain_is_stored_raw_complete_and_deterministic(tmp_path):
    chain = make_chain(SPEC)
    fake = FakeEodhd(chain)
    r = go(fake, osn.LocalStore(tmp_path / "a"))
    assert r.state == "stored" and r.session == SESSION and r.attempt == 1
    rows, man, raw = read_stored(tmp_path / "a", SESSION)
    # raw provider rows, unmodified, every one of them
    key = lambda x: x["contract"]  # noqa: E731
    assert sorted(rows, key=key) == sorted(chain, key=key)
    assert man["complete"] is True and man["incomplete_reasons"] == []
    assert man["schema"] == osn.SCHEMA and man["provider"] == "eodhd" and man["session"] == SESSION
    assert man["retrieval_started_at"] == man["retrieval_finished_at"] == "2026-11-03T12:00:00Z"
    assert man["data_sha256"] == hashlib.sha256(raw).hexdigest() and man["data_bytes"] == len(raw)
    assert man["expiries_listed"] == man["expiries_complete"] == len(SPEC)
    assert {e["exp_date"]: e["contracts"] for e in man["expiries"]} == {k: 2 * v for k, v in SPEC.items()}
    assert man["rows_by_quote_session"] == {SESSION: len(chain)}
    assert man["requests"] == len(fake.calls) == r.requests and man["marketplace_units"] == 10 * r.requests
    assert man["attempt"] == 1 and man["data_file"] == osn.asset_names(SESSION, 1)[0] and man["private"] is True
    # the same chain gives byte-identical data
    r2 = go(FakeEodhd(list(reversed(chain))), osn.LocalStore(tmp_path / "b"))
    assert r2.state == "stored" and read_stored(tmp_path / "b", SESSION)[2] == raw


@pytest.mark.parametrize("inclusive", [True, False])
def test_the_expiry_listing_is_complete_whichever_way_the_from_filter_reads(tmp_path, monkeypatch, inclusive):
    monkeypatch.setattr(osn, "PAGE_LIMIT", 50)  # many listing pages, several expiries larger than a page
    fake = FakeEodhd(make_chain(SPEC), inclusive=inclusive)
    r = go(fake, osn.LocalStore(tmp_path))
    if not inclusive:
        # an exclusive filter hides the session's own expiry from a listing that starts on it: the snapshot
        # names what it saw, and every expiry it lists is whole
        assert r.manifest["expiries_listed"] == len(SPEC) - 1
    else:
        assert r.manifest["expiries_listed"] == len(SPEC)
    assert r.manifest["expiries_complete"] == r.manifest["expiries_listed"]
    assert r.state == "stored"


def test_an_expiry_over_one_page_is_split_by_type_and_paged(tmp_path, monkeypatch):
    monkeypatch.setattr(osn, "PAGE_LIMIT", 100)
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, osn.LocalStore(tmp_path))
    rec = {e["exp_date"]: e for e in r.manifest["expiries"]}
    big = rec["2026-12-18"]
    assert big["complete"] and big["calls"] == big["puts"] == 600
    assert big["requests"] == 1 + 6 + 6  # the first page, then six strike pages per type
    assert any(c.get("filter[type]") == "put" and c.get("page[offset]") == "500" for c in fake.calls)
    assert r.state == "stored"


def test_a_complete_session_is_never_fetched_again(tmp_path):
    store = osn.LocalStore(tmp_path)
    assert go(FakeEodhd(make_chain(SPEC)), store).state == "stored"
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, store)
    assert (r.state, r.requests, fake.calls) == ("already_stored", 0, [])


def test_a_provider_that_has_not_moved_costs_one_probe(tmp_path):
    store = osn.LocalStore(tmp_path)
    assert go(FakeEodhd(make_chain(SPEC)), store).state == "stored"
    later = datetime(2026, 11, 4, 3, 0, tzinfo=timezone.utc)  # 2026-11-03 has closed; the provider still has 11-02
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, store, now=later)
    assert (r.state, r.session, r.requests, len(fake.calls)) == ("already_stored", SESSION, 1, 1)


def test_the_request_cap_stores_a_flagged_partial_and_a_retry_appends(tmp_path, monkeypatch):
    store = osn.LocalStore(tmp_path)
    monkeypatch.setattr(osn, "MAX_REQUESTS", 6)  # probe, three listing pages, two expiries
    first = go(FakeEodhd(make_chain(SPEC)), store)
    assert first.state == "stored_partial" and first.attempt == 1 and first.requests == 6
    m1 = first.manifest
    assert not m1["complete"] and "request_cap" in m1["incomplete_reasons"]
    assert m1["expiries_listed"] == len(SPEC) and m1["expiries_complete"] == 2 and m1["request_cap"] == 6
    assert [e["reason"] for e in m1["expiries"] if not e["complete"]] == ["not_fetched"] * (len(SPEC) - 2)
    _, _, raw1 = read_stored(tmp_path, SESSION, 1)
    monkeypatch.setattr(osn, "MAX_REQUESTS", 200)
    second = go(FakeEodhd(make_chain(SPEC)), store)
    assert second.state == "stored" and second.attempt == 2
    # attempt 1 is still there, byte for byte: history is appended, never replaced
    assert read_stored(tmp_path, SESSION, 1)[2] == raw1
    assert [m["attempt"] for m in store.attempts(SESSION)] == [1, 2]
    assert go(FakeEodhd(make_chain(SPEC)), store).state == "already_stored"


def test_attempts_are_bounded(tmp_path, monkeypatch):
    store = osn.LocalStore(tmp_path)
    monkeypatch.setattr(osn, "MAX_REQUESTS", 6)
    for i in range(osn.MAX_ATTEMPTS):
        assert go(FakeEodhd(make_chain(SPEC)), store).state == "stored_partial"
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, store)
    assert r.state == "attempts_exhausted" and len(fake.calls) == 1


def test_a_stored_attempt_is_never_overwritten(tmp_path):
    store = osn.LocalStore(tmp_path)
    store.check()
    store.add(SESSION, 1, b"data", b"{}")
    with pytest.raises(osn.StorageError):
        store.add(SESSION, 1, b"other", b"{}")
    assert (tmp_path / "SPY" / "2026-11" / osn.asset_names(SESSION, 1)[0]).read_bytes() == b"data"


def test_a_session_that_moves_mid_run_is_not_complete(tmp_path):
    now = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)  # 11-02 and 11-03 have both closed
    # the probe reads expiries from 11-03 on: its 100 rows are all 11-03 expiry rows carrying 11-02 marks
    chain = make_chain({"2026-11-02": 30, "2026-11-03": 60}) + make_chain({"2026-11-20": 30}, stamp="2026-11-03 21:30:00")
    r = go(FakeEodhd(chain), osn.LocalStore(tmp_path), now=now)
    assert r.session == SESSION and r.state == "stored_partial"
    assert "session_moved" in r.manifest["incomplete_reasons"]
    assert r.manifest["rows_by_quote_session"] == {SESSION: 180, "2026-11-03": 60}


def test_duplicate_rows_leave_the_expiry_incomplete(tmp_path):
    fake = FakeEodhd(make_chain(SPEC), dup_exp="2026-11-04")
    r = go(fake, osn.LocalStore(tmp_path))
    rec = {e["exp_date"]: e for e in r.manifest["expiries"]}
    assert not rec["2026-11-04"]["complete"] and rec["2026-11-04"]["reason"] == "rows_inconsistent"
    assert r.state == "stored_partial" and "expiry_incomplete" in r.manifest["incomplete_reasons"]


def test_an_unentitled_token_stores_nothing(tmp_path):
    fake = FakeEodhd(make_chain(SPEC), fail_after=0, fail_status=403)
    r = go(fake, osn.LocalStore(tmp_path))
    assert r.state == "not_entitled" and len(fake.calls) == 1
    assert not list(tmp_path.rglob("*.json"))


@pytest.mark.parametrize("status, reason", [(402, "provider_quota_exhausted"), (429, "provider_rate_limited")])
def test_quota_or_rate_limit_stops_the_run_without_a_retry(tmp_path, status, reason):
    fake = FakeEodhd(make_chain(SPEC), fail_after=6, fail_status=status)
    r = go(fake, osn.LocalStore(tmp_path))
    assert len(fake.calls) == 7  # the failing request is not retried and nothing follows it
    assert r.state == "stored_partial" and reason in r.manifest["incomplete_reasons"]


def test_marks_that_name_no_session_store_nothing(tmp_path):
    fake = FakeEodhd(make_chain(SPEC, stamp="2026-11-02 18:00:00"))  # an intraday mark
    r = go(fake, osn.LocalStore(tmp_path))
    assert r.state == "session_unknown" and len(fake.calls) == 1


def test_the_summary_line_carries_counts_only(tmp_path):
    chain = make_chain(SPEC)
    r = go(FakeEodhd(chain), osn.LocalStore(tmp_path))
    line = r.line()
    assert line.startswith("option_snapshots: stored underlying=SPY session=2026-11-02 ")
    assert TOKEN not in line and str(tmp_path) not in line
    assert not any(c["contract"] in line for c in chain)
    assert not re.search(r"\d+\.\d", line)  # no price


def test_pacing_stays_under_the_clients_rate_limit():
    slept = []
    t = [0.0]
    fake = FakeEodhd(make_chain({"2026-11-03": 3}))
    f = osn.Fetcher(client_for(fake), sleep=lambda s: (slept.append(s), t.__setitem__(0, t[0] + s)), clock=lambda: t[0])
    for _ in range(3):
        f(exp_date_eq="2026-11-03", sort="strike", limit=10, offset=0)
    assert slept == [osn.MIN_INTERVAL_S, osn.MIN_INTERVAL_S] and 1 / osn.MIN_INTERVAL_S < 5.0


# ── history report ──


def test_history_names_complete_partial_and_missing_sessions(tmp_path, monkeypatch):
    ms = [{"underlying": "SPY", "session": "2026-10-27", "complete": True},
          {"underlying": "SPY", "session": "2026-10-28", "complete": False},
          {"underlying": "SPY", "session": "2026-10-30", "complete": False},
          {"underlying": "SPY", "session": "2026-10-30", "complete": True}]
    h = osn.history(ms, NOW)
    assert h["complete"] == ["2026-10-27", "2026-10-30"] and h["partial_only"] == ["2026-10-28"]
    assert h["missing"] == ["2026-10-29", "2026-11-02"]  # weekends are not sessions
    assert h["attempts"] == 4


def test_the_report_cli_makes_no_eodhd_call(tmp_path, monkeypatch, capsys):
    store = osn.LocalStore(tmp_path)
    go(FakeEodhd(make_chain(SPEC)), store)
    monkeypatch.setenv("EODHD_OPTIONS_TOKEN", TOKEN)

    def boom(*a, **k):
        raise AssertionError("no EODHD call in --report")
    monkeypatch.setattr(eod.EodhdClient, "options_contracts", boom)
    assert osn.main(["--report", "--out-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "sessions=1 attempts=1 complete=1 first_complete=2026-11-02" in out


def test_the_cli_without_configuration_is_held_and_exits_zero(monkeypatch, capsys):
    for k in (osn.TOKEN_ENV, osn.REPO_ENV, osn.GH_TOKEN_ENV):
        monkeypatch.delenv(k, raising=False)
    assert osn.main([]) == 0
    assert capsys.readouterr().out.strip() == "option_snapshots: held underlying=SPY session=- requests=0 detail=no_options_token"


# ── the private GitHub store ──


class FakeGitHub:
    def __init__(self, *, private: bool = True, full_name: str = ARCHIVE):
        self.private = private
        self.full_name = full_name
        self.releases: dict[str, dict] = {}
        self.assets: dict[int, dict] = {}
        self.blobs: dict[int, bytes] = {}
        self.calls: list[tuple[str, str]] = []
        self.deletes = 0
        self._id = 100

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {GH_TOKEN}"
        url = urlparse(str(request.url))
        path, q = url.path, {k: v[0] for k, v in parse_qs(url.query).items()}
        m = request.method
        self.calls.append((m, path))
        base = f"/repos/{ARCHIVE}"
        if m == "DELETE":
            self.deletes += 1
            return httpx.Response(204)
        if m == "GET" and path == base:
            return httpx.Response(200, json={"full_name": self.full_name, "private": self.private,
                                             "visibility": "private" if self.private else "public"})
        if m == "GET" and path.startswith(f"{base}/releases/tags/"):
            tag = path.rsplit("/", 1)[1]
            return httpx.Response(200, json=self.releases[tag]) if tag in self.releases else httpx.Response(404)
        if m == "POST" and path == f"{base}/releases":
            body = json.loads(request.content)
            self._id += 1
            rel = {"id": self._id, "tag_name": body["tag_name"]}
            self.releases[body["tag_name"]] = rel
            return httpx.Response(201, json=rel)
        if m == "GET" and path == f"{base}/releases":
            return httpx.Response(200, json=list(self.releases.values()) if q.get("page") == "1" else [])
        if m == "GET" and re.fullmatch(rf"{base}/releases/\d+/assets", path):
            rid = int(path.split("/")[-2])
            items = [a for a in self.assets.values() if a["release"] == rid]
            p = int(q.get("page", 1))
            return httpx.Response(200, json=items[(p - 1) * 100:p * 100])
        if m == "POST" and url.netloc == "uploads.github.com":
            rid = int(path.split("/")[-2])
            name = q["name"]
            if any(a["name"] == name and a["release"] == rid for a in self.assets.values()):
                return httpx.Response(422)
            self._id += 1
            self.assets[self._id] = {"id": self._id, "name": name, "size": len(request.content), "release": rid}
            self.blobs[self._id] = request.content
            return httpx.Response(201, json=self.assets[self._id])
        if m == "GET" and re.fullmatch(rf"{base}/releases/assets/\d+", path):
            assert request.headers["Accept"] == "application/octet-stream"
            return httpx.Response(200, content=self.blobs[int(path.rsplit("/", 1)[1])])
        return httpx.Response(418)


def gh_store(fake: FakeGitHub, repo: str = ARCHIVE) -> osn.GitHubReleaseStore:
    return osn.GitHubReleaseStore(repo, GH_TOKEN, transport=httpx.MockTransport(fake))


def test_the_github_store_round_trips_append_only_in_monthly_releases(tmp_path, monkeypatch):
    gh = FakeGitHub()
    store = gh_store(gh)
    monkeypatch.setattr(osn, "MAX_REQUESTS", 6)
    assert go(FakeEodhd(make_chain(SPEC)), store).state == "stored_partial"
    monkeypatch.setattr(osn, "MAX_REQUESTS", 200)
    store = gh_store(gh)  # a later run: a fresh process
    r = go(FakeEodhd(make_chain(SPEC)), store)
    assert r.state == "stored" and r.attempt == 2
    assert list(gh.releases) == ["spy-options-2026-11"]
    assert sorted(a["name"] for a in gh.assets.values()) == sorted(osn.asset_names(SESSION, 1) + osn.asset_names(SESSION, 2))
    assert gh.deletes == 0
    data = next(gh.blobs[i] for i, a in gh.assets.items() if a["name"] == osn.asset_names(SESSION, 2)[0])
    man = json.loads(next(gh.blobs[i] for i, a in gh.assets.items() if a["name"] == osn.asset_names(SESSION, 2)[1]))
    assert man["data_sha256"] == hashlib.sha256(data).hexdigest() and man["complete"] is True
    assert go(FakeEodhd(make_chain(SPEC)), gh_store(gh)).state == "already_stored"
    assert "complete=1" in osn.report_line(gh_store(gh), NOW)


def test_the_github_store_refuses_a_public_repository():
    gh = FakeGitHub(private=False)
    fake = FakeEodhd(make_chain(SPEC))
    r = go(fake, gh_store(gh))
    assert r.state == "storage_refused" and "not_private" in r.detail and fake.calls == []


@pytest.mark.parametrize("repo", ["maxkomen-macro/macro-regime-radar", "MaxKomen-Macro/Macro-Regime-Radar"])
def test_the_github_store_refuses_this_repository_before_any_request(repo):
    gh = FakeGitHub()
    r = go(FakeEodhd(make_chain(SPEC)), gh_store(gh, repo))
    assert r.state == "storage_refused" and gh.calls == []


def test_the_github_store_refuses_the_running_repository(monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", ARCHIVE)
    gh = FakeGitHub()
    assert go(FakeEodhd(make_chain(SPEC)), gh_store(gh)).state == "storage_refused" and gh.calls == []


def test_the_github_store_refuses_a_full_release(monkeypatch):
    gh = FakeGitHub()
    store = gh_store(gh)
    store.check()
    rel = store._release(SESSION, create=True)
    for i in range(osn.RELEASE_ASSET_LIMIT - 1):
        gh.assets[10_000 + i] = {"id": 10_000 + i, "name": f"x{i}", "size": 1, "release": rel["id"]}
    with pytest.raises(osn.StorageError, match="asset limit"):
        store.add(SESSION, 1, b"d", b"{}")


def test_storage_errors_never_carry_the_token_or_the_archive_name():
    def handler(request):
        return httpx.Response(500, text=f"{GH_TOKEN} {ARCHIVE}")
    store = osn.GitHubReleaseStore(ARCHIVE, GH_TOKEN, transport=httpx.MockTransport(handler))
    r = go(FakeEodhd(make_chain(SPEC)), store)
    assert r.state == "storage_failed"
    assert GH_TOKEN not in r.line() and "spy-archive" not in r.line()


def test_store_from_env_reads_only_its_own_names():
    assert osn.store_from_env({}) is None
    assert osn.store_from_env({"GITHUB_TOKEN": "x", "GH_TOKEN": "y"}) is None
    s = osn.store_from_env({osn.REPO_ENV: ARCHIVE, osn.GH_TOKEN_ENV: GH_TOKEN})
    assert isinstance(s, osn.GitHubReleaseStore) and s.repo == ARCHIVE


# ── the one workflow step ──


def _steps():
    doc = yaml.safe_load((ROOT / ".github/workflows/refresh-data.yml").read_text())
    return doc["jobs"]["refresh"]["steps"]


def test_the_workflow_step_is_scoped_bounded_and_cannot_fail_the_refresh():
    steps = _steps()
    names = [s["name"] for s in steps]
    mine = [s for s in steps if "option_snapshots" in (s.get("run") or "")]
    assert len(mine) == 1
    step = mine[0]
    assert step["name"] == "Collect private SPY option snapshot (Desk D3)"
    assert step["if"] == "steps.mode.outputs.mode == 'full'"
    assert step["continue-on-error"] is True and step["timeout-minutes"] == 10
    assert step["env"] == {"EODHD_OPTIONS_TOKEN": "${{ secrets.EODHD_OPTIONS_TOKEN }}",
                           "OPTION_SNAPSHOT_REPO": "${{ secrets.OPTION_SNAPSHOT_REPO }}",
                           "OPTION_SNAPSHOT_GH_TOKEN": "${{ secrets.OPTION_SNAPSHOT_GH_TOKEN }}"}
    assert step["run"].strip() == "python -m src.market_data.option_snapshots"
    i = names.index(step["name"])
    assert i == names.index("Load earnings cache (Options Finder)") + 1
    assert i < names.index("Validate the refreshed database")


def test_the_three_secrets_appear_only_in_that_step():
    text = (ROOT / ".github/workflows/refresh-data.yml").read_text()
    for secret in ("EODHD_OPTIONS_TOKEN", "OPTION_SNAPSHOT_REPO", "OPTION_SNAPSHOT_GH_TOKEN"):
        assert text.count(f"secrets.{secret}") == 1, secret
        for s in _steps():
            if s["name"] != "Collect private SPY option snapshot (Desk D3)":
                assert secret not in json.dumps(s), (secret, s["name"])
    assert "EODHD_API_TOKEN" not in text
    for wf in (ROOT / ".github/workflows").glob("*.yml"):
        if wf.name != "refresh-data.yml":
            assert "EODHD_OPTIONS_TOKEN" not in wf.read_text() and "OPTION_SNAPSHOT" not in wf.read_text(), wf.name


def test_no_publish_or_artifact_step_can_carry_a_snapshot():
    for s in _steps():
        blob = json.dumps(s)
        if "gh release upload" in blob or "upload-artifact" in blob:
            assert "SPY-options" not in blob and "option_snapshots" not in blob and "jsonl" not in blob, s["name"]


def test_an_interrupted_upload_is_kept_and_the_next_attempt_takes_a_new_number(tmp_path):
    """A data file without its manifest (an upload cut off between the two) was never committed: it reads as
    no attempt, stays where it is, and the retry is written under the next number."""
    store = osn.LocalStore(tmp_path)
    store.check()
    d = tmp_path / "SPY" / "2026-11"
    d.mkdir(parents=True)
    orphan = d / osn.asset_names(SESSION, 1)[0]
    orphan.write_bytes(b"cut off")
    assert store.attempts(SESSION) == [] and store.taken(SESSION) == {1}
    r = go(FakeEodhd(make_chain(SPEC)), store)
    assert r.state == "stored" and r.attempt == 2 and orphan.read_bytes() == b"cut off"


# ── Max's A-2 pre-merge cases (2026-11-04): reproduced, fixed, pinned ──


def _empty_for(exp: str, type_: str | None = None):
    def tamper(q, page):
        if q.get("filter[exp_date_eq]") == exp and (type_ is None or q.get("filter[type]") == type_):
            return []
        return page
    return tamper


def test_a2_case1_a_listed_expiry_answering_no_rows_is_never_complete(tmp_path):
    """Reproduced at 5301606: the listing saw 2026-11-04, the exact fetch answered no rows and no next link,
    and the expiry was recorded complete with 0 contracts, so the whole snapshot read complete."""
    store = osn.LocalStore(tmp_path)
    r = go(FakeEodhd(make_chain(SPEC), tamper=_empty_for("2026-11-04")), store)
    rec = {e["exp_date"]: e for e in r.manifest["expiries"]}
    assert rec["2026-11-04"] == {"exp_date": "2026-11-04", "contracts": 0, "calls": 0, "puts": 0, "requests": 1,
                                 "complete": False, "reason": "no_rows"}
    assert r.state == "stored_partial" and r.manifest["complete"] is False
    assert "expiry_incomplete" in r.manifest["incomplete_reasons"]
    assert r.manifest["expiries_complete"] == len(SPEC) - 1
    # the partial attempt stays, and a later run with a whole answer completes the session as attempt 2
    r2 = go(FakeEodhd(make_chain(SPEC)), store)
    assert (r2.state, r2.attempt) == ("stored", 2)
    assert [m["complete"] for m in store.attempts(SESSION)] == [False, True]


def test_a2_case1_a_listed_expiry_with_one_side_missing_is_never_complete(tmp_path, monkeypatch):
    """The provider answers an expiry's calls whole and no puts at all: listed, paged to the end, unique, and
    still not a whole SPY expiry. Both the one-page path and the by-type path (2026-12-18 at 100 a page)."""
    monkeypatch.setattr(osn, "PAGE_LIMIT", 100)
    for exp in ("2026-12-18", "2026-11-03"):
        chain = [r for r in make_chain(SPEC) if not (r["exp_date"] == exp and r["type"] == "put")]
        r = go(FakeEodhd(chain), osn.LocalStore(tmp_path / exp))
        rec = {e["exp_date"]: e for e in r.manifest["expiries"]}[exp]
        assert rec["complete"] is False and rec["reason"] == "type_missing" and rec["puts"] == 0 and rec["calls"] == SPEC[exp]
        assert r.state == "stored_partial" and r.manifest["expiries_complete"] == len(SPEC) - 1


def _strip_symbol(exp: str, *, value=None, drop=True):
    def tamper(q, page):
        if q.get("filter[exp_date_eq]") == exp and page:
            bad = dict(page[0], contract="QQQ261106C00400000")
            if drop:
                bad.pop("underlying_symbol", None)
            else:
                bad["underlying_symbol"] = value
            return page + [bad]
        return page
    return tamper


@pytest.mark.parametrize("drop, value", [(True, None), (False, None), (False, "QQQ"), (False, "spy")])
def test_a2_case2_a_row_not_naming_spy_never_passes(tmp_path, drop, value):
    """Reproduced at 5301606: a QQQ contract with no underlying_symbol, served inside a SPY expiry, passed
    the expiry check and was stored in a complete snapshot."""
    chain = make_chain(SPEC)
    r = go(FakeEodhd(chain, tamper=_strip_symbol("2026-11-06", value=value, drop=drop)), osn.LocalStore(tmp_path))
    assert r.state == "stored_partial" and "provider_contradiction" in r.manifest["incomplete_reasons"]
    rows, man, _ = read_stored(tmp_path, SESSION)
    assert not any(x["contract"].startswith("QQQ") for x in rows)
    assert all(x["underlying_symbol"] == "SPY" for x in rows)
    rec = {e["exp_date"]: e for e in man["expiries"]}
    assert rec["2026-11-06"]["complete"] is False and rec["2026-11-06"]["reason"] == "not_fetched"
    assert all(rec[e]["complete"] for e in ("2026-11-02", "2026-11-03", "2026-11-04"))  # earlier expiries kept


def test_a2_case2_the_probe_and_listing_must_name_spy_too(tmp_path):
    def probe_tamper(q, page):
        return [{k: v for k, v in r.items() if k != "underlying_symbol"} for r in page] if q.get("page[limit]") == str(osn.PROBE_LIMIT) else page
    fake = FakeEodhd(make_chain(SPEC), tamper=probe_tamper)
    r = go(fake, osn.LocalStore(tmp_path))
    assert (r.state, r.detail, len(fake.calls)) == ("provider_error", "contradiction", 1)
    assert fake.calls[0]["fields[options-contracts]"] == osn.PROBE_FIELDS and "underlying_symbol" in osn.PROBE_FIELDS

    def list_tamper(q, page):
        if q.get("fields[options-contracts]") == osn.LIST_FIELDS:
            return [dict(x, underlying_symbol="QQQ") for x in page]
        return page
    fake = FakeEodhd(make_chain(SPEC), tamper=list_tamper)
    r = go(fake, osn.LocalStore(tmp_path / "b"))
    assert r.state == "provider_error" and r.detail == "no_rows"  # nothing collected, nothing stored
    assert "provider_contradiction" in r.manifest["incomplete_reasons"]
    assert not list((tmp_path / "b").rglob("*.json"))


def test_a2_case2_rows_belong_rejects_a_missing_symbol():
    row = make_chain({"2026-11-03": 1})[0]
    assert osn._rows_belong([row], "2026-11-03", None)
    assert not osn._rows_belong([{k: v for k, v in row.items() if k != "underlying_symbol"}], "2026-11-03", None)
