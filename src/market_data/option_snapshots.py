"""src/market_data/option_snapshots.py — private SPY option-chain snapshots (Desk D3, 2026-11-03).

Max's D3 decision: start private SPY snapshot collection, so the Desk's later surface and term-structure
features have their own history. Storage (his choice A, 2026-11-03 21:20 UTC): release assets in a private
GitHub repository. Raw snapshots stay private: never in this public repository, never in the data-latest
release (its database is public, so not even encrypted there), never in a workflow log or run artifact. This
module writes nothing to the database and nothing inside the repository.

What one run does, in order, and where it stops:

  1. Reads EODHD_OPTIONS_TOKEN from the environment, and nothing else for EODHD: never EODHD_API_TOKEN, never
     .env. Setting this secret therefore cannot switch asset_history or desk_history from Yahoo to EODHD,
     which read EODHD_API_TOKEN (api/providers/market._load_token). No token: "held", no call made.
  2. Needs a private store: OPTION_SNAPSHOT_REPO and OPTION_SNAPSHOT_GH_TOKEN (the archive repository and a
     token for it), or --out-dir PATH (a folder outside the repository) for a manual run. No store: "held",
     no call. The GitHub store refuses any repository the API does not report as private, and this one.
  3. If the store already holds a complete snapshot of the last completed NYSE session: "already_stored",
     no call made.
  4. One probe request names the session the provider's end-of-day marks describe (the Options Finder's
     chain_session rule, imported, not copied). Unnamed: "session_unknown". Already stored: done.
  5. Lists every expiry from that session on (seek pages sorted by expiry), then fetches each expiry exactly
     (exp_date_eq; split by type and paged by strike when one page cannot hold it). Every row of every page,
     probe and listing included, must name SPY in underlying_symbol; a row that names another underlying or
     none stops the run (provider_contradiction). An expiry is complete only when its last page has no next
     link, it has rows of both types, its contract ids are unique, and every row names SPY, that expiry (and
     type); a listed expiry that answers no rows is "no_rows", one side missing "type_missing", both
     incomplete. The provider sends no total, so that is the evidence, recorded per expiry.
  6. Writes the raw provider rows, unmodified, as gzip JSON lines (sorted, deterministic) plus a manifest:
     schema version, provider, the quote session, the retrieval start and end, per-expiry counts and
     completeness, the session each row's marks describe, the request count and the data file's SHA-256. A
     snapshot is complete only when the listing and every expiry are complete and the collected rows, read by
     the same session rule, name the probe's session: a newer one is "session_moved", none at all
     "session_unknown". Each row's histogram session is that rule applied to the row alone.

History is append-only. Each attempt at a session is its own pair of assets, numbered a01, a02, ...; nothing
stored is ever deleted, overwritten or replaced. A session with a complete attempt is never collected again;
one with only partial attempts is retried on later runs, at most MAX_ATTEMPTS times. The snapshot of record
for a session is its complete attempt; partial attempts stay as flagged evidence. --report names the complete
sessions, the partial-only ones and the NYSE sessions with nothing stored. GitHub allows 1,000 assets per
release, so releases are monthly (spy-options-YYYY-MM: at most 23 sessions x 4 attempts x 2 = 184 assets),
and a release that could not take two more assets is refused before any upload.

Bounds: at most MAX_REQUESTS EODHD requests a run, retries included (each is 10 marketplace calls on
EODHD's published weights, api/providers/quota.py), no client retry, paced under the client's own rate
limit; a 429 or a 402 (the shared options quota spent) stops the run. A complete
stored session costs no request; a provider that has not moved past a stored session costs one.

One summary line of counts and a state word; never a price, a contract, the store's name or a token. The
step exits 0 on every end so it cannot fail the refresh; a failure state also prints a workflow warning.

    python -m src.market_data.option_snapshots                     the refresh step (GitHub store from env)
    python -m src.market_data.option_snapshots --out-dir PATH      a manual run into a local folder
    python -m src.market_data.option_snapshots --report [...]      stored history, counts only, no EODHD call

Before the first live run (D3): the secrets, and D1's check of EODHD's retention, storage and call-limit
terms for the options dataset. Setup: docs/RUNBOOK.md section 9.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

import httpx

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import calendar as cal  # noqa: E402
from api.providers import eodhd as eod  # noqa: E402
from api.providers import quota  # noqa: E402
from api.providers.errors import ProviderError  # noqa: E402
from api.providers.market import chain_session  # noqa: E402

UNDERLYING = "SPY"
TOKEN_ENV = "EODHD_OPTIONS_TOKEN"
REPO_ENV = "OPTION_SNAPSHOT_REPO"
GH_TOKEN_ENV = "OPTION_SNAPSHOT_GH_TOKEN"
PUBLIC_REPO = "maxkomen-macro/macro-regime-radar"

SCHEMA = 1
ENDPOINT = "/mp/unicornbay/options/contracts"
# The live chain on 2026-11-03 held more than 10,000 SPY contracts in its first 25 expiries (the API's
# expirations scan stopped there, truncated), so a whole chain is roughly 25 listing pages plus one or two
# requests per expiry: about 100. Retries included; 2,000 marketplace calls at EODHD's weight of 10.
MAX_REQUESTS = 200
MAX_ATTEMPTS = 4  # stored attempts per session; a session that never completes stops costing calls
PAGE_LIMIT = 1000  # the provider's page maximum (api/providers/eodhd.py clamps to it)
MAX_OFFSET = 10000  # the client clamps offsets above this, so paging must stop before it
PROBE_LIMIT = 100
LIST_FIELDS = "exp_date,underlying_symbol"
PROBE_FIELDS = "contract,underlying_symbol,exp_date,bid_date,ask_date"
MIN_INTERVAL_S = 0.25  # 4 requests a second, under the client's 5-a-second bucket
REQUEST_TIMEOUT_S = 30.0
# No client retry: the options quota (100,000 marketplace calls, 10 a request, a rolling 24 h from the first
# request) and the 1,000-a-minute limit are shared with the API's Options lens and Finder on the same account,
# so a 429 or a 402 (quota spent) stops the run and the next run picks the session up (D1, 2026-11-03).
CLIENT_RETRIES = 0
RELEASE_ASSET_LIMIT = 1000  # GitHub's per-release asset limit
ASSET_BYTES_LIMIT = 2 * 1024**3 - 1  # GitHub's per-asset size limit
TYPES = ("call", "put")

FAILURE_STATES = {"not_entitled", "provider_error", "session_unknown", "storage_refused", "storage_failed", "attempts_exhausted"}


class StorageError(Exception):
    """The private store refused or failed. The message never carries a token or the store's name."""


class BudgetExhausted(Exception):
    pass


class Contradiction(Exception):
    """The provider answered something the completeness proof cannot rely on."""


# ── the private stores ────────────────────────────────────────────────────────

_ASSET_RE = re.compile(rf"^{UNDERLYING}-options-(\d{{4}}-\d{{2}}-\d{{2}})-a(\d{{2}})\.(jsonl\.gz|manifest\.json)$")


def asset_names(session: str, attempt: int) -> tuple[str, str]:
    stem = f"{UNDERLYING}-options-{session}-a{attempt:02d}"
    return f"{stem}.jsonl.gz", f"{stem}.manifest.json"


def release_tag(session: str) -> str:
    return f"spy-options-{session[:7]}"


class Store(Protocol):
    def check(self) -> None: ...
    def attempts(self, session: str) -> list[dict]: ...
    def taken(self, session: str) -> set[int]: ...
    def add(self, session: str, attempt: int, data: bytes, manifest: bytes) -> None: ...
    def manifests(self) -> list[dict]: ...


class LocalStore:
    """A folder outside the repository: <root>/SPY/<YYYY-MM>/<asset>. The manifest is written last, so an
    attempt without one was never committed; an existing file is never overwritten."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).expanduser().resolve()

    def check(self) -> None:
        repo = ROOT.resolve()
        if self.root == repo or repo in self.root.parents:
            raise StorageError("refused: the output folder is inside the repository, which is public")
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise StorageError(f"the output folder cannot be created ({type(exc).__name__})") from exc

    def _dir(self, session: str) -> Path:
        return self.root / UNDERLYING / session[:7]

    def _names(self, session: str) -> set[str]:
        d = self._dir(session)
        return {p.name for p in d.iterdir()} if d.is_dir() else set()

    def attempts(self, session: str) -> list[dict]:
        out = []
        for name in sorted(self._names(session)):
            m = _ASSET_RE.match(name)
            if m and m.group(1) == session and m.group(3) == "manifest.json":
                try:
                    out.append(json.loads((self._dir(session) / name).read_text()))
                except (OSError, ValueError) as exc:
                    raise StorageError(f"a stored manifest cannot be read ({type(exc).__name__})") from exc
        return out

    def taken(self, session: str) -> set[int]:
        return {int(m.group(2)) for n in self._names(session) if (m := _ASSET_RE.match(n)) and m.group(1) == session}

    def add(self, session: str, attempt: int, data: bytes, manifest: bytes) -> None:
        d = self._dir(session)
        d.mkdir(parents=True, exist_ok=True)
        if attempt in self.taken(session):
            raise StorageError("refused: that attempt is already stored; history is never replaced")
        for name, blob in zip(asset_names(session, attempt), (data, manifest)):
            tmp = d / f".{name}.tmp"
            try:
                tmp.write_bytes(blob)
                os.link(tmp, d / name)  # fails rather than overwrite
            except FileExistsError as exc:
                raise StorageError("refused: that attempt is already stored; history is never replaced") from exc
            except OSError as exc:
                raise StorageError(f"the output folder cannot be written ({type(exc).__name__})") from exc
            finally:
                tmp.unlink(missing_ok=True)

    def manifests(self) -> list[dict]:
        out = []
        for p in sorted((self.root / UNDERLYING).glob("*/*.manifest.json")):
            try:
                out.append(json.loads(p.read_text()))
            except (OSError, ValueError):
                continue
        return out


_REPO_RE = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$")


class GitHubReleaseStore:
    """Release assets in a private GitHub repository: one release a month (tag spy-options-YYYY-MM), two
    assets an attempt. The token needs only Contents read and write on that one repository (Metadata read is
    granted with it). A release needs a commit to tag, so the repository must be created with a README."""

    API = "https://api.github.com"
    UPLOADS = "https://uploads.github.com"

    def __init__(self, repo: str, token: str, *, transport: httpx.BaseTransport | None = None) -> None:
        self.repo = repo.strip()
        self.token = token.strip()
        self._transport = transport
        self._releases: dict[str, dict | None] = {}
        self._asset_cache: dict[int, dict[str, dict]] = {}

    def _req(self, method: str, url: str, *, ok: tuple[int, ...], **kw: Any) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "macro-regime-radar-option-snapshots",
            **kw.pop("headers", {}),
        }
        try:
            # httpx drops the Authorization header on a redirect to another host (asset downloads go to storage)
            with httpx.Client(timeout=60.0, transport=self._transport, follow_redirects=True) as c:
                r = c.request(method, url, headers=headers, **kw)
        except httpx.HTTPError as exc:
            raise StorageError(f"the private store is unreachable ({type(exc).__name__})") from exc
        if r.status_code not in ok:
            raise StorageError(f"the private store answered HTTP {r.status_code} to {method}")
        return r

    def check(self) -> None:
        if not _REPO_RE.match(self.repo):
            raise StorageError("refused: the private store's repository name is not owner/name")
        if not self.token:
            raise StorageError("refused: the private store has no token")
        own = {PUBLIC_REPO.lower(), (os.environ.get("GITHUB_REPOSITORY") or "").lower()} - {""}
        if self.repo.lower() in own:
            raise StorageError("refused: the private store is this public repository")
        meta = self._req("GET", f"{self.API}/repos/{self.repo}", ok=(200,)).json()
        if meta.get("private") is not True or meta.get("visibility", "private") != "private":
            raise StorageError("refused: the private store's repository is not private")
        if str(meta.get("full_name", "")).lower() in own:
            raise StorageError("refused: the private store is this public repository")

    def _release(self, session: str, *, create: bool) -> dict | None:
        tag = release_tag(session)
        if self._releases.get(tag) is not None:
            return self._releases[tag]
        r = self._req("GET", f"{self.API}/repos/{self.repo}/releases/tags/{tag}", ok=(200, 404))
        rel = r.json() if r.status_code == 200 else None
        if rel is None and create:
            body = {"tag_name": tag, "name": f"SPY option-chain snapshots {session[:7]}", "draft": False,
                    "prerelease": False,
                    "body": "Private raw EODHD end-of-day option-chain snapshots (Desk D3). Append-only. Do not publish."}
            rel = self._req("POST", f"{self.API}/repos/{self.repo}/releases", ok=(201,), json=body).json()
        self._releases[tag] = rel
        return rel

    def _assets(self, rel: dict, *, fresh: bool = False) -> dict[str, dict]:
        rid = int(rel["id"])
        if not fresh and rid in self._asset_cache:
            return self._asset_cache[rid]
        out: dict[str, dict] = {}
        for page in range(1, 20):  # 1,000 assets at 100 a page, with room
            r = self._req("GET", f"{self.API}/repos/{self.repo}/releases/{rid}/assets", ok=(200,),
                          params={"per_page": 100, "page": page})
            batch = r.json()
            out.update({a["name"]: a for a in batch})
            if len(batch) < 100:
                break
        self._asset_cache[rid] = out
        return out

    def _download(self, asset: dict) -> bytes:
        return self._req("GET", f"{self.API}/repos/{self.repo}/releases/assets/{asset['id']}", ok=(200,),
                         headers={"Accept": "application/octet-stream"}).content

    def _session_assets(self, session: str) -> dict[str, dict]:
        rel = self._release(session, create=False)
        if rel is None:
            return {}
        return {n: a for n, a in self._assets(rel).items() if (m := _ASSET_RE.match(n)) and m.group(1) == session}

    def attempts(self, session: str) -> list[dict]:
        out = []
        for name, asset in sorted(self._session_assets(session).items()):
            if name.endswith(".manifest.json"):
                try:
                    out.append(json.loads(self._download(asset)))
                except ValueError as exc:
                    raise StorageError("a stored manifest is not JSON") from exc
        return out

    def taken(self, session: str) -> set[int]:
        return {int(_ASSET_RE.match(n).group(2)) for n in self._session_assets(session)}  # type: ignore[union-attr]

    def add(self, session: str, attempt: int, data: bytes, manifest: bytes) -> None:
        rel = self._release(session, create=True)
        assert rel is not None
        existing = self._assets(rel, fresh=True)
        names = asset_names(session, attempt)
        if any(n in existing for n in names) or attempt in self.taken(session):
            raise StorageError("refused: that attempt is already stored; history is never replaced")
        if len(existing) + 2 > RELEASE_ASSET_LIMIT:
            raise StorageError("refused: the month's release is at GitHub's asset limit")
        if max(len(data), len(manifest)) > ASSET_BYTES_LIMIT:
            raise StorageError("refused: a snapshot is over GitHub's asset size limit")
        # data first, manifest last: an attempt without its manifest reads as never committed
        for name, blob, ctype in zip(names, (data, manifest), ("application/gzip", "application/json")):
            self._req("POST", f"{self.UPLOADS}/repos/{self.repo}/releases/{rel['id']}/assets", ok=(201,),
                      params={"name": name}, content=blob, headers={"Content-Type": ctype})
        after = self._assets(rel, fresh=True)
        for name, blob in zip(names, (data, manifest)):
            if name not in after or int(after[name].get("size", -1)) != len(blob):
                raise StorageError("an uploaded asset is missing or the wrong size after upload")

    def manifests(self) -> list[dict]:
        out = []
        for page in range(1, 20):
            r = self._req("GET", f"{self.API}/repos/{self.repo}/releases", ok=(200,), params={"per_page": 100, "page": page})
            batch = r.json()
            for rel in batch:
                if not str(rel.get("tag_name", "")).startswith("spy-options-"):
                    continue
                for name, asset in sorted(self._assets(rel).items()):
                    if _ASSET_RE.match(name) and name.endswith(".manifest.json"):
                        try:
                            out.append(json.loads(self._download(asset)))
                        except (ValueError, StorageError):
                            continue
            if len(batch) < 100:
                break
        return out


# ── the collection ────────────────────────────────────────────────────────────


def _exp(value: Any) -> date | None:
    try:
        d = date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None
    return d if 2000 <= d.year <= 2100 else None


@dataclass
class Fetcher:
    """EODHD calls under the run's request cap, paced, counted from the client's own quota counter (every
    attempt, retries included)."""

    client: eod.EodhdClient
    cap: int | None = None  # MAX_REQUESTS when not given
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    _start: int = 0
    _last: float | None = None

    def __post_init__(self) -> None:
        if self.cap is None:
            self.cap = MAX_REQUESTS
        self._start = quota.snapshot()["requests"]

    @property
    def used(self) -> int:
        return quota.snapshot()["requests"] - self._start

    def __call__(self, **kw: Any) -> tuple[list[dict], bool]:
        if self.used + self.client.max_retries + 1 > (self.cap or 0):
            raise BudgetExhausted()
        if self._last is not None:
            wait = MIN_INTERVAL_S - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
        try:
            d = self.client.options_contracts(UNDERLYING, **kw)
        finally:
            self._last = self.clock()
        rows = [r.get("attributes", r) if isinstance(r, dict) else r for r in d.get("data") or []]
        if not all(isinstance(r, dict) for r in rows):
            raise Contradiction("a row that is not an object")
        # Every request asks for underlying_symbol (the probe and listing name it in `fields`), and a row that
        # does not name SPY, including one that leaves it out, stops the run: nothing on that page is relied on.
        if any(r.get("underlying_symbol") != UNDERLYING for r in rows):
            raise Contradiction("a row that does not name the underlying")
        return rows, bool((d.get("links") or {}).get("next"))


def list_expiries(fetch: Fetcher, start: date) -> tuple[list[str], bool]:
    """Every expiry on or after `start` that any row shows. Seek pages sorted by expiry; the next page starts
    at the newest expiry seen (right whether the provider's filter includes its own date or not), or a day
    later when a page got no further, so the anchor always advances. Returns (expiries, listing complete)."""
    seen: set[date] = set()
    anchor = start

    def listed() -> list[str]:
        return sorted(d.isoformat() for d in seen)

    while True:
        try:
            rows, more = fetch(exp_date_from=anchor.isoformat(), sort="exp_date", limit=PAGE_LIMIT, fields=LIST_FIELDS)
        except BudgetExhausted:
            return listed(), False
        dates = [_exp(r.get("exp_date")) for r in rows]
        if any(d is None for d in dates):
            raise Contradiction("an expiry that does not parse")
        ds: list[date] = dates  # type: ignore[assignment]
        if any(b < a for a, b in zip(ds, ds[1:])) or any(d < anchor for d in ds):
            raise Contradiction("an expiry page out of order or out of range")
        seen.update(ds)
        if not more:
            return listed(), True
        if not ds:
            return listed(), False  # a next link with nothing to anchor on
        anchor = ds[-1] if ds[-1] > anchor else anchor + timedelta(days=1)
        if anchor.year > 2100:
            return listed(), False


def _pages(fetch: Fetcher, exp: str, type_: str) -> tuple[list[dict], bool, int]:
    """Every row of one expiry and type, paged by strike. Returns (rows, proven complete, requests)."""
    rows: list[dict] = []
    offset, n = 0, 0
    while True:
        page, more = fetch(exp_date_eq=exp, type_=type_, sort="strike", limit=PAGE_LIMIT, offset=offset)
        n += 1
        rows.extend(page)
        if not more:
            return rows, True, n
        if not page or offset + PAGE_LIMIT > MAX_OFFSET:
            return rows, False, n
        offset += PAGE_LIMIT


def _rows_belong(rows: list[dict], exp: str, type_: str | None) -> bool:
    ids = [r.get("contract") for r in rows]
    if any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        return False
    for r in rows:
        if str(r.get("exp_date"))[:10] != exp or r.get("type") not in TYPES or (type_ and r.get("type") != type_):
            return False
        if r.get("underlying_symbol") != UNDERLYING:  # a missing symbol never passes (A-2, case 2)
            return False
    return True


def fetch_expiry(fetch: Fetcher, exp: str) -> tuple[list[dict], dict]:
    """One expiry, exactly: one page when it holds everything, else calls and puts apart (strike is unique
    within a type, so strike order pages without ties)."""
    rows, more = fetch(exp_date_eq=exp, sort="strike", limit=PAGE_LIMIT, offset=0)
    n, reason = 1, None
    if not more:
        if not _rows_belong(rows, exp, None):
            reason = "rows_inconsistent"
    else:
        rows = []
        for t in TYPES:
            part, done, k = _pages(fetch, exp, t)
            n += k
            rows.extend(part)
            if not done:
                reason = "pages_exhausted"
            elif not _rows_belong(part, exp, t) and reason is None:
                reason = "rows_inconsistent"
        if reason is None and not _rows_belong(rows, exp, None):
            reason = "rows_inconsistent"
    calls, puts = sum(r.get("type") == "call" for r in rows), sum(r.get("type") == "put" for r in rows)
    # The listing saw this expiry, so an answer with no rows contradicts it, and a listed SPY expiry carries
    # both calls and puts: either is an incomplete expiry, never a complete one with nothing in it (A-2, case 1).
    if reason is None and not rows:
        reason = "no_rows"
    elif reason is None and not (calls and puts):
        reason = "type_missing"
    rec = {"exp_date": exp, "contracts": len(rows), "calls": calls, "puts": puts, "requests": n,
           "complete": reason is None}
    if reason:
        rec["reason"] = reason
    return rows, rec


@dataclass
class Snapshot:
    session: str
    rows: list[dict]
    manifest: dict
    data: bytes = b""


def _sort_key(r: dict) -> tuple:
    try:
        strike = float(r.get("strike"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        strike = float("inf")
    return (str(r.get("exp_date")), str(r.get("type")), strike, str(r.get("contract")))


def encode(rows: list[dict]) -> bytes:
    lines = "".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n" for r in sorted(rows, key=_sort_key))
    return gzip.compress(lines.encode(), compresslevel=9, mtime=0)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _provider_stop(exc: ProviderError) -> str:
    if getattr(exc, "status", None) == 402:
        return "provider_quota_exhausted"
    return f"provider_{exc.kind}"


def build_snapshot(session: str, rows: list[dict], expiries: list[dict], listing_complete: bool, *,
                   requests: int, cap: int, started: datetime, finished: datetime, now: datetime, stop: str | None) -> Snapshot:
    by_session: dict[str, int] = {}
    for r in rows:
        s = chain_session([r], now) or "unnamed"  # the shared rule, row by row: its newest nameable mark (S-2)
        by_session[s] = by_session.get(s, 0) + 1
    newest = chain_session(rows, now) if rows else None
    reasons = [stop] if stop else []
    if not listing_complete:
        reasons.append("expiry_listing_incomplete")
    if any(not e["complete"] for e in expiries):
        reasons.append("expiry_incomplete")
    if newest is None:
        reasons.append("session_unknown")  # no row's marks name a session: nothing ties the rows to the probe's (S-1)
    elif newest != session:
        reasons.append("session_moved")  # the provider published a newer session while this run read it
    if not rows:
        reasons.append("no_rows")
    data = encode(rows)
    manifest = {
        "schema": SCHEMA,
        "kind": "eodhd_option_chain_snapshot",
        "private": True,
        "note": "Raw provider rows, unmodified. Private: never commit, publish or display.",
        "underlying": UNDERLYING,
        "provider": eod.PROVIDER,
        "endpoint": ENDPOINT,
        "cadence": "end_of_day",
        "session": session,
        "session_rule": "api.providers.market.chain_session (newest end-of-day mark, both clock readings)",
        "retrieval_started_at": _iso(started),
        "retrieval_finished_at": _iso(finished),
        "collector_commit": os.environ.get("GITHUB_SHA") or None,
        "complete": not reasons,
        "incomplete_reasons": sorted(set(reasons)),
        "expiry_listing_complete": listing_complete,
        "expiries_listed": len(expiries),
        "expiries_complete": sum(e["complete"] for e in expiries),
        "expiries": expiries,
        "contracts": len(rows),
        "rows_by_quote_session": dict(sorted(by_session.items())),
        "requests": requests,
        "request_cap": cap,
        "marketplace_units": requests * quota.weight_for(ENDPOINT),
        "data_bytes": len(data),
        "data_sha256": hashlib.sha256(data).hexdigest(),
    }
    return Snapshot(session, rows, manifest, data)


def collect(fetch: Fetcher, session: str, *, now: datetime, clock: Callable[[], datetime]) -> Snapshot:
    started = clock()
    rows: list[dict] = []
    records: list[dict] = []
    stop = None
    listing_complete = False
    exps: list[str] = []
    try:
        exps, listing_complete = list_expiries(fetch, date.fromisoformat(session))
        for exp in exps:
            part, rec = fetch_expiry(fetch, exp)
            rows.extend(part)
            records.append(rec)
    except BudgetExhausted:
        stop = "request_cap"
    except Contradiction:
        stop = "provider_contradiction"
    except ProviderError as exc:
        stop = _provider_stop(exc)
    # an expiry the run stopped in, or never reached, is listed with nothing kept from it
    records.extend({"exp_date": e, "contracts": 0, "calls": 0, "puts": 0, "requests": 0,
                    "complete": False, "reason": "not_fetched"} for e in exps[len(records):])
    return build_snapshot(session, rows, records, listing_complete, requests=fetch.used, cap=fetch.cap or 0,
                          started=started, finished=clock(), now=now, stop=stop)


# ── one run ───────────────────────────────────────────────────────────────────


@dataclass
class Result:
    state: str
    session: str | None = None
    requests: int = 0
    manifest: dict | None = None
    attempt: int | None = None
    detail: str | None = None

    def line(self) -> str:
        m = self.manifest or {}
        parts = [f"option_snapshots: {self.state}", f"underlying={UNDERLYING}", f"session={self.session or '-'}",
                 f"requests={self.requests}"]
        if self.attempt is not None:
            parts.append(f"attempt={self.attempt}")
        if m:
            parts += [f"expiries={m['expiries_complete']}/{m['expiries_listed']}", f"contracts={m['contracts']}",
                      f"complete={'yes' if m['complete'] else 'no'}", f"bytes={m['data_bytes']}"]
            if m["incomplete_reasons"]:
                parts.append("reasons=" + ",".join(m["incomplete_reasons"]))
        if self.detail:
            parts.append(f"detail={self.detail}")
        return " ".join(parts)


def options_token(env: dict | None = None) -> str | None:
    """The collector's own token, from the environment only (no .env fall-through, no EODHD_API_TOKEN)."""
    tok = (env if env is not None else os.environ).get(TOKEN_ENV) or ""
    return tok.strip() or None


def store_from_env(env: dict | None = None, *, transport: httpx.BaseTransport | None = None) -> GitHubReleaseStore | None:
    env = env if env is not None else os.environ
    repo, tok = (env.get(REPO_ENV) or "").strip(), (env.get(GH_TOKEN_ENV) or "").strip()
    if not repo and not tok:
        return None
    return GitHubReleaseStore(repo, tok, transport=transport)


def _complete(ms: list[dict]) -> bool:
    return any(m.get("complete") is True for m in ms)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def run(*, token: str | None, store: Store | None, now: datetime | None = None,
        client: eod.EodhdClient | None = None, sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], datetime] = _utcnow) -> Result:
    now = now or clock()
    if not token:
        return Result("held", detail="no_options_token")
    if store is None:
        return Result("held", detail="no_private_store")
    try:
        store.check()
        expected = cal.last_completed_session(now).isoformat()
        if _complete(store.attempts(expected)):
            return Result("already_stored", session=expected)
    except StorageError as exc:
        return Result("storage_refused" if str(exc).startswith("refused") else "storage_failed", detail=_word(exc))
    fetch = Fetcher(client or eod.EodhdClient(token, timeout=REQUEST_TIMEOUT_S, max_retries=CLIENT_RETRIES), sleep=sleep)
    try:
        probe, _ = fetch(exp_date_from=expected, sort="exp_date", limit=PROBE_LIMIT, fields=PROBE_FIELDS)
    except ProviderError as exc:
        state = "not_entitled" if exc.kind in ("unauthorized", "missing_token") else "provider_error"
        return Result(state, requests=fetch.used, detail=_provider_stop(exc))
    except Contradiction:
        return Result("provider_error", requests=fetch.used, detail="contradiction")
    session = chain_session(probe, now)
    if session is None:
        return Result("session_unknown", requests=fetch.used)
    try:
        prior = store.attempts(session)
        taken = store.taken(session)
    except StorageError as exc:
        return Result("storage_failed", session=session, requests=fetch.used, detail=_word(exc))
    if _complete(prior):
        return Result("already_stored", session=session, requests=fetch.used)
    if len(taken) >= MAX_ATTEMPTS:
        return Result("attempts_exhausted", session=session, requests=fetch.used)
    attempt = max(taken, default=0) + 1
    snap = collect(fetch, session, now=now, clock=clock)
    snap.manifest["attempt"] = attempt
    snap.manifest["data_file"] = asset_names(session, attempt)[0]
    if not snap.rows:
        return Result("provider_error", session=session, requests=fetch.used, manifest=snap.manifest, detail="no_rows")
    manifest_bytes = json.dumps(snap.manifest, indent=1, sort_keys=True).encode()
    try:
        store.add(session, attempt, snap.data, manifest_bytes)
    except StorageError as exc:
        return Result("storage_failed", session=session, requests=fetch.used, manifest=snap.manifest,
                      attempt=attempt, detail=_word(exc))
    return Result("stored" if snap.manifest["complete"] else "stored_partial", session=session,
                  requests=fetch.used, manifest=snap.manifest, attempt=attempt)


def _word(exc: Exception) -> str:
    """A short, token-free reason for the summary line."""
    return re.sub(r"[^a-z0-9_]+", "_", str(exc).lower()).strip("_")[:80] or type(exc).__name__


def history(manifests: list[dict], now: datetime) -> dict:
    """Stored history by NYSE session: complete, partial only, and missing (a session between the first
    stored one and the last completed session with nothing stored). Counts and session dates only."""
    by: dict[str, list[dict]] = {}
    for m in manifests:
        if m.get("underlying") == UNDERLYING and isinstance(m.get("session"), str):
            by.setdefault(m["session"], []).append(m)
    complete = sorted(s for s, ms in by.items() if _complete(ms))
    partial = sorted(s for s in by if s not in complete)
    missing: list[str] = []
    if by:
        d = date.fromisoformat(min(by))
        last = cal.last_completed_session(now)
        while d <= last:
            if cal.calendar_known(d) and cal.is_trading_day(d) and d.isoformat() not in by:
                missing.append(d.isoformat())
            d += timedelta(days=1)
    return {"sessions": len(by), "complete": complete, "partial_only": partial, "missing": missing,
            "attempts": sum(len(ms) for ms in by.values())}


def report_line(store: Store, now: datetime | None = None) -> str:
    h = history(store.manifests(), now or _utcnow())
    c = h["complete"]
    return (f"option_snapshots report: underlying={UNDERLYING} sessions={h['sessions']} attempts={h['attempts']} "
            f"complete={len(c)} first_complete={c[0] if c else '-'} last_complete={c[-1] if c else '-'} "
            f"partial_only={len(h['partial_only'])}{(' [' + ','.join(h['partial_only'][-10:]) + ']') if h['partial_only'] else ''} "
            f"missing={len(h['missing'])}{(' [' + ','.join(h['missing'][-10:]) + ']') if h['missing'] else ''}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Private SPY option-chain snapshots (Desk D3).")
    ap.add_argument("--out-dir", type=Path, help="a local folder outside the repository, instead of the GitHub store")
    ap.add_argument("--report", action="store_true", help="counts of stored sessions; makes no EODHD call")
    args = ap.parse_args(argv)
    store: Store | None = LocalStore(args.out_dir) if args.out_dir else store_from_env()
    if args.report:
        if store is None:
            print("option_snapshots report: no private store configured")
            return 0
        try:
            store.check()
            print(report_line(store))
        except StorageError as exc:
            print(f"option_snapshots report: storage_failed detail={_word(exc)}")
        return 0
    result = run(token=options_token(), store=store)
    summary = result.line()
    print(summary)
    if os.environ.get("GITHUB_ACTIONS") == "true" and result.state in FAILURE_STATES:
        print(f"::warning::{summary}")
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        try:
            with open(step_summary, "a") as fh:
                fh.write(summary + "\n")
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
