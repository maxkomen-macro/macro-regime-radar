"""src/market_data/sec_13f.py — SEC Form 13F holder concentration for basket names (Desk P4, D7).

Institutional investment managers with at least $100 million in 13(f)
securities file Form 13F within 45 days of each calendar quarter's end, listing
their long positions at the quarter's end. The SEC publishes every filing,
flattened, in its Form 13F data sets (one zip per three months of filing
dates, www.sec.gov "Form 13F Data Sets"). This step reads the data sets that
cover the newest quarter whose filing deadline they include and the quarter
before it, and stores, per US ticker and quarter:

    holders            filers reporting a long position in shares (no put or call rows, no principal amounts)
    shares             the shares those filers report, summed
    top10_shares       the shares of its ten largest holders
    large_filers_top10 of the 100 largest filers that quarter, how many hold it among their ten largest positions

into the additive table `holdings_13f`, with the quarter's dates and counts in
`holdings_13f_periods` and the tickers whose mapping could not be settled, with
why, in `holdings_13f_refused`. US government data; the Desk credits the SEC.

Amendments: a 13F-HR/A marked RESTATEMENT replaces the filer's report for the
quarter (the latest original or restatement by filing date and accession
number is the base); one marked NEW HOLDINGS adds its positions, when filed
after the base. Notices (13F-NT) hold no positions. An amendment of no stated
type is set aside and counted.

Identifiers: a 13F row names a security by CUSIP, not by ticker. The SEC's own
fails-to-deliver files pair each ticker with its CUSIP; a ticker is mapped to
the CUSIP of its newest fails record, and only when the first word of that
record's issuer description agrees with the first word of the issuer name the
13F filers give that CUSIP most often (equal, or the shorter, of three letters
or more, begins the longer). A ticker the files pair with two CUSIPs on
its newest date, or whose names disagree, is refused with why, never guessed.
CUSIPs are used during the run only and are not stored.

Fair access: the SEC asks automated clients to declare a User-Agent with a
contact and to stay under ten requests a second. The contact is passed in by
the step's runner (src/market_data/positioning.py), which reads it from the
environment (`SEC_USER_AGENT`, an Actions secret); this module reads no
environment variable, so the API, which imports its table names, never sees
it. It is never printed or stored;
requests are spaced at least 0.2 s apart, a 429 or a server error is retried
with backoff, and a refusal (403) is not retried. A run whose data sets are
the ones already stored downloads nothing more than the two index pages.

Run:  python -m src.market_data.positioning --sec-only [--db data/macro_radar.db] [--cache-dir DIR]
The step never fails the refresh: a failed read keeps what is stored (every
write is one transaction, made only when the whole computation succeeded),
records the watermark `sec_13f` (status ok or error, the reasons in its detail)
and exits 0; scripts/validate_db.py only warns.

Method: docs/desk/POSITIONING_SPEC.md §3. Stdlib only.
"""

from __future__ import annotations

import csv
import io
import re
import shutil
import sqlite3
import statistics
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import watermarks  # noqa: E402
from src.market_data import cot  # noqa: E402  (the shared positioning_runs table)

DB_PATH = ROOT / "data" / "macro_radar.db"
PROVIDER = "SEC"
SOURCE = "sec_13f"
WATERMARK = "sec_13f"
TABLE = "holdings_13f"
PERIODS = "holdings_13f_periods"
REFUSED = "holdings_13f_refused"
RUNS = cot.RUNS
METHOD = "13f-1"  # stored with each quarter; a stored quarter computed by another method is recomputed

SITE = "https://www.sec.gov"
SETS_PAGE = f"{SITE}/data-research/sec-markets-data/form-13f-data-sets"
FTD_PAGE = f"{SITE}/data-research/sec-markets-data/fails-deliver-data"
CONTACT_ENV = "SEC_USER_AGENT"
MIN_INTERVAL_S = 0.2       # at most five requests a second, half the SEC's limit
TIMEOUT_S = 120
RETRIES = 3
RETRY_WAIT_S = 2.0         # doubled after each failed try
MAX_DOWNLOAD_BYTES = 1_000_000_000
FTD_FILES = 6              # the newest six half-month fails files, about three months
DEADLINE_DAYS = 45
LARGE_FILERS = 100
TOP_POSITIONS = 10
TOP_HOLDERS = 10
BUDGET_S = 480.0           # inside the workflow step's ten minutes: stop cleanly, keep what is stored

SET_RE = re.compile(r'href="(/files/[^"]*?/(\d{2}[a-z]{3}\d{4})-(\d{2}[a-z]{3}\d{4})_form13f\.zip)"', re.I)
FTD_RE = re.compile(r'href="(/files/[^"]*?/cnsfails(\d{6})([ab])\.zip)"', re.I)
CUSIP_RE = re.compile(r"^[0-9A-Z]{9}$")

SUBMISSION_COLUMNS = ("ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT")
COVER_COLUMNS = ("ACCESSION_NUMBER", "ISAMENDMENT", "AMENDMENTTYPE", "REPORTTYPE")
INFO_COLUMNS = ("ACCESSION_NUMBER", "NAMEOFISSUER", "CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL")
FTD_COLUMNS = ("SETTLEMENT DATE", "CUSIP", "SYMBOL", "DESCRIPTION")

DDL = (
    f"""
CREATE TABLE IF NOT EXISTS {PERIODS} (
    period          TEXT PRIMARY KEY,  -- YYYY-MM-DD: the quarter end the holdings are as of
    deadline        TEXT NOT NULL,     -- YYYY-MM-DD: 45 days after the period
    data_sets       TEXT NOT NULL,     -- the SEC data sets read, comma-separated file names
    filings_through TEXT NOT NULL,     -- YYYY-MM-DD: the last filing date the data sets cover
    newest_filing   TEXT,              -- YYYY-MM-DD: the newest filing date read for the period
    ftd_files       TEXT NOT NULL,     -- the SEC fails-to-deliver files the tickers were paired from
    filers          INTEGER NOT NULL,  -- filers with a long position in shares in the period
    filings         INTEGER NOT NULL,  -- holdings reports and amendments read for the period
    restatements    INTEGER NOT NULL,  -- RESTATEMENT amendments that replaced a report
    new_holdings    INTEGER NOT NULL,  -- NEW HOLDINGS amendments added
    set_aside       INTEGER NOT NULL,  -- amendments of no stated type and rows that could not be read
    names           INTEGER NOT NULL,  -- tickers stored for the period
    revised_names   INTEGER NOT NULL,  -- tickers whose figures changed when the period was last recomputed
    method          TEXT NOT NULL,
    run_id          TEXT NOT NULL,     -- positioning_runs
    computed_at     TEXT NOT NULL      -- UTC
) WITHOUT ROWID
""",
    f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    symbol_key         TEXT NOT NULL,     -- the ticker without punctuation, upper case (BRK.B → BRKB)
    period             TEXT NOT NULL,     -- YYYY-MM-DD quarter end
    symbol             TEXT NOT NULL,     -- the ticker as the SEC's fails file writes it
    issuer             TEXT NOT NULL,     -- the issuer name 13F filers give it most often
    holders            INTEGER NOT NULL CHECK (holders > 0),
    shares             INTEGER NOT NULL CHECK (shares > 0),
    top10_shares       INTEGER NOT NULL CHECK (top10_shares > 0),
    large_filers_top10 INTEGER NOT NULL CHECK (large_filers_top10 >= 0),
    run_id             TEXT NOT NULL,
    PRIMARY KEY (symbol_key, period)
) WITHOUT ROWID
""",
    f"""
CREATE TABLE IF NOT EXISTS {REFUSED} (
    symbol_key TEXT NOT NULL,
    period     TEXT NOT NULL,
    symbol     TEXT NOT NULL,
    reason     TEXT NOT NULL,
    run_id     TEXT NOT NULL,
    PRIMARY KEY (symbol_key, period)
) WITHOUT ROWID
""",
)
HOLDING_COLUMNS = ("symbol_key", "period", "symbol", "issuer", "holders", "shares", "top10_shares", "large_filers_top10", "run_id")
FIGURES = ("holders", "shares", "top10_shares", "large_filers_top10")


class FetchFailed(RuntimeError):
    """A request the SEC did not answer, or refused."""


class Refused(RuntimeError):
    """Data the step will not store (a schema it does not know, a gap in the data sets, the budget spent)."""


@dataclass(frozen=True)
class DataSet:
    path: str     # the site path of the zip
    start: date   # the first filing date it covers
    end: date     # the last

    @property
    def name(self) -> str:
        return self.path.rsplit("/", 1)[-1]


def ensure_tables(conn: sqlite3.Connection) -> None:
    cot.ensure_tables(conn)  # positioning_runs
    for ddl in DDL:
        conn.execute(ddl)


def symbol_key(symbol: str) -> str:
    """BRK.B, BRK-B, BRK/B and BRKB are one key."""
    return re.sub(r"[^0-9A-Z]", "", symbol.upper())


# ── dates ───────────────────────────────────────────────────────────────────

def quarter_end_on_or_before(d: date) -> date:
    for month, day in ((12, 31), (9, 30), (6, 30), (3, 31)):
        q = date(d.year, month, day)
        if q <= d:
            return q
    return date(d.year - 1, 12, 31)


def previous_quarter_end(q: date) -> date:
    return quarter_end_on_or_before(q.replace(day=1) - timedelta(days=1))


def deadline_of(period: date) -> date:
    return period + timedelta(days=DEADLINE_DAYS)


def _sec_date(s: str) -> date:
    """The data sets write 31-JUL-2026."""
    return datetime.strptime(s.strip(), "%d-%b-%Y").date()


def _name_date(s: str) -> date:
    """The data set names write 01jun2026."""
    return datetime.strptime(s, "%d%b%Y").date()


# ── the index pages ─────────────────────────────────────────────────────────

def data_sets(html: str) -> list[DataSet]:
    """The data sets the SEC's page lists, by filing-date window (the quarterly-named sets before 2024 are not read)."""
    out = {m.group(1): DataSet(m.group(1), _name_date(m.group(2).lower()), _name_date(m.group(3).lower())) for m in SET_RE.finditer(html)}
    return sorted(out.values(), key=lambda s: s.end)


def ftd_paths(html: str, n: int = FTD_FILES) -> list[str]:
    """The newest `n` half-month fails-to-deliver files the SEC's page lists, newest first."""
    found = {m.group(1): (m.group(2), m.group(3).lower()) for m in FTD_RE.finditer(html)}
    return sorted(found, key=lambda p: found[p], reverse=True)[:n]


def choose(sets: list[DataSet]) -> tuple[date, date, list[DataSet]]:
    """The newest quarter whose filing deadline the data sets cover, the quarter before it, and the data sets that
    cover every filing date after the earlier quarter's end; `Refused` when they leave a gap."""
    if not sets:
        raise Refused("the SEC's page lists no Form 13F data set")
    through = max(s.end for s in sets)
    period = quarter_end_on_or_before(through)
    while deadline_of(period) > through:
        period = previous_quarter_end(period)
    prev = previous_quarter_end(period)
    needed = sorted((s for s in sets if s.end > prev), key=lambda s: s.start)
    if needed[0].start > prev + timedelta(days=1):
        raise Refused(f"no data set covers filings from {prev + timedelta(days=1)} (the first read starts {needed[0].start})")
    for a, b in zip(needed, needed[1:]):
        if b.start != a.end + timedelta(days=1):
            raise Refused(f"the data sets leave a gap between {a.end} and {b.start}")
    return period, prev, needed


# ── HTTP ────────────────────────────────────────────────────────────────────

class Client:
    """GETs from www.sec.gov with the declared contact, spaced, retried with backoff, never past a refusal."""

    def __init__(self, contact: str, *, retry_wait: float = RETRY_WAIT_S, cache_dir: Path | None = None,
                 opener: Callable[..., Any] = urllib.request.urlopen, sleep: Callable[[float], None] = time.sleep):
        self._headers = {"User-Agent": contact, "Accept-Encoding": "identity"}
        self._retry_wait = retry_wait
        self._cache = cache_dir
        self._open = opener
        self._sleep = sleep
        self._last = 0.0
        self.requests = 0

    def _space(self) -> None:
        wait = self._last + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            self._sleep(wait)
        self._last = time.monotonic()

    def _cached(self, path: str) -> Path | None:
        if self._cache is None:
            return None
        return self._cache / re.sub(r"[^0-9A-Za-z._-]", "_", path.strip("/"))

    def get(self, path: str, dest: Path | None = None) -> bytes | Path:
        """The body of `SITE + path`, or, with `dest`, the body written to that file."""
        cached = self._cached(path)
        if cached is not None and cached.exists() and cached.stat().st_size > 0:
            if dest is None:
                return cached.read_bytes()
            return cached
        url = SITE + path
        wait = self._retry_wait
        last = ""
        for attempt in range(RETRIES):
            self._space()
            self.requests += 1
            try:
                with self._open(urllib.request.Request(url, headers=self._headers), timeout=TIMEOUT_S) as resp:
                    target = dest if dest is not None else None
                    if target is None:
                        body = resp.read(MAX_DOWNLOAD_BYTES + 1)
                        if len(body) > MAX_DOWNLOAD_BYTES:
                            raise FetchFailed(f"{path}: larger than {MAX_DOWNLOAD_BYTES:,} bytes")
                        if cached is not None:
                            cached.write_bytes(body)
                        return body
                    size = 0
                    with open(target, "wb") as fh:
                        while chunk := resp.read(1 << 20):
                            size += len(chunk)
                            if size > MAX_DOWNLOAD_BYTES:
                                raise FetchFailed(f"{path}: larger than {MAX_DOWNLOAD_BYTES:,} bytes")
                            fh.write(chunk)
                    if cached is not None:
                        shutil.copyfile(target, cached)
                    return Path(target)
            except urllib.error.HTTPError as exc:
                if exc.code == 403:
                    raise FetchFailed(f"{path}: refused by the SEC (HTTP 403); not retried") from None
                last = f"HTTP {exc.code}"
                if exc.code != 429 and exc.code < 500:
                    raise FetchFailed(f"{path}: {last}") from None
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = type(exc).__name__
            if attempt < RETRIES - 1:
                self._sleep(wait)
                wait *= 2
        raise FetchFailed(f"{path}: {last} after {RETRIES} tries")


# ── reading the files ───────────────────────────────────────────────────────

def _tsv(z: zipfile.ZipFile, name: str, need: tuple[str, ...]) -> tuple[Iterator[list[str]], dict[str, int]]:
    members = {m.rsplit("/", 1)[-1].upper(): m for m in z.namelist()}
    if name.upper() not in members:
        raise Refused(f"{name} is not in the data set")
    fh = io.TextIOWrapper(z.open(members[name.upper()]), encoding="utf-8", errors="replace", newline="")
    reader = csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE)
    header = [h.strip().upper() for h in next(reader, [])]
    missing = [c for c in need if c not in header]
    if missing:
        raise Refused(f"{name} has no {', '.join(missing)} column")
    return reader, {c: header.index(c) for c in need}


def _count(raw: str) -> int | None:
    """A whole, non-negative number, or None."""
    s = raw.strip().replace(",", "")
    if not s:
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    if x < 0 or x != int(x) or x > 1e15:
        return None
    return int(x)


def read_filings(z: zipfile.ZipFile, periods: set[date], set_name: str) -> list[dict]:
    """The data set's holdings reports and amendments for `periods`, with each one's amendment type."""
    cover: dict[str, tuple[str, str, str]] = {}
    rows, ix = _tsv(z, "COVERPAGE.tsv", COVER_COLUMNS)
    for r in rows:
        if len(r) > max(ix.values()):
            cover[r[ix["ACCESSION_NUMBER"]].strip()] = (r[ix["ISAMENDMENT"]].strip().upper(), r[ix["AMENDMENTTYPE"]].strip().upper(),
                                                        r[ix["REPORTTYPE"]].strip().upper())
    out = []
    rows, ix = _tsv(z, "SUBMISSION.tsv", SUBMISSION_COLUMNS)
    for r in rows:
        if len(r) <= max(ix.values()):
            continue
        kind = r[ix["SUBMISSIONTYPE"]].strip().upper()
        if kind not in ("13F-HR", "13F-HR/A"):
            continue  # notices hold no positions
        try:
            period = _sec_date(r[ix["PERIODOFREPORT"]])
            filed = _sec_date(r[ix["FILING_DATE"]])
        except ValueError:
            continue
        if period not in periods:
            continue
        acc = r[ix["ACCESSION_NUMBER"]].strip()
        _is_amend, amend_type, report_type = cover.get(acc, ("", "", ""))
        out.append({"accession": acc, "cik": r[ix["CIK"]].strip().lstrip("0") or "0", "period": period, "filed": filed,
                    "kind": kind, "amendment": amend_type if kind == "13F-HR/A" else "", "report_type": report_type,
                    "data_set": set_name})
    return out


def effective(filings: list[dict]) -> tuple[dict[str, dict], Counter]:
    """The filings whose positions count, by accession, per filer and period (module docstring), and the counts."""
    by: dict[tuple[str, date], list[dict]] = defaultdict(list)
    for f in filings:
        by[(f["cik"], f["period"])].append(f)
    keep: dict[str, dict] = {}
    n: Counter = Counter()
    for group in by.values():
        group.sort(key=lambda f: (f["filed"], f["accession"]))
        if any(f["report_type"] == "13F NOTICE" for f in group if f["kind"] == "13F-HR"):
            group = [f for f in group if not (f["kind"] == "13F-HR" and f["report_type"] == "13F NOTICE")]
        untyped = [f for f in group if f["kind"] == "13F-HR/A" and f["amendment"] not in ("RESTATEMENT", "NEW HOLDINGS")]
        n["set_aside"] += len(untyped)
        bases = [f for f in group if f["kind"] == "13F-HR" or f["amendment"] == "RESTATEMENT"]
        base = bases[-1] if bases else None
        after = (base["filed"], base["accession"]) if base else (date.min, "")
        adds = [f for f in group if f["amendment"] == "NEW HOLDINGS" and (f["filed"], f["accession"]) > after]
        if base:
            keep[base["accession"]] = base
            if base["amendment"] == "RESTATEMENT":
                n["restatements"] += 1
        for f in adds:
            keep[f["accession"]] = f
            n["new_holdings"] += 1
        n["filings"] += len(group)
    return keep, n


def load_positions(work: sqlite3.Connection, z: zipfile.ZipFile, keep: dict[str, dict], names: dict[date, dict[str, Counter]],
                   deadline: Callable[[], None]) -> Counter:
    """Each counted filing's long positions in shares into `work.rows`; the issuer names filers give each CUSIP."""
    n: Counter = Counter()
    rows, ix = _tsv(z, "INFOTABLE.tsv", INFO_COLUMNS)
    width = max(ix.values())
    batch: list[tuple] = []
    for i, r in enumerate(rows):
        if len(r) <= width:
            continue
        acc = r[ix["ACCESSION_NUMBER"]].strip()
        f = keep.get(acc)
        if f is None:
            continue
        if r[ix["PUTCALL"]].strip() or r[ix["SSHPRNAMTTYPE"]].strip().upper() != "SH":
            continue  # options rows and principal amounts are not shares held
        cusip = r[ix["CUSIP"]].strip().upper()
        shares, value = _count(r[ix["SSHPRNAMT"]]), _count(r[ix["VALUE"]])
        if not CUSIP_RE.match(cusip) or shares is None or value is None:
            n[("rows_set_aside", f["period"])] += 1
            continue
        if shares == 0:
            continue
        batch.append((acc, cusip, shares, value))
        names[f["period"]][cusip][r[ix["NAMEOFISSUER"]].strip().upper()] += 1
        if len(batch) >= 50_000:
            work.executemany("INSERT INTO rows VALUES (?, ?, ?, ?)", batch)
            batch.clear()
            deadline()
        n["rows"] += 1
    if batch:
        work.executemany("INSERT INTO rows VALUES (?, ?, ?, ?)", batch)
    return n


def read_ftd(blobs: Iterable[tuple[str, bytes]]) -> tuple[dict[str, dict], dict[str, str]]:
    """Ticker → (CUSIP, description, symbol, date) from the fails files: the CUSIP of the ticker's newest record.
    A ticker with two CUSIPs on its newest date is refused, with why."""
    seen: dict[str, dict] = {}
    for name, blob in blobs:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for member in z.namelist():
                text = z.read(member).decode("latin-1")
                reader = csv.reader(io.StringIO(text), delimiter="|", quoting=csv.QUOTE_NONE)
                header = [h.strip().upper() for h in next(reader, [])]
                if any(c not in header for c in FTD_COLUMNS):
                    raise Refused(f"{name}: the fails file has no {', '.join(c for c in FTD_COLUMNS if c not in header)} column")
                ix = {c: header.index(c) for c in FTD_COLUMNS}
                for r in reader:
                    if len(r) <= max(ix.values()):
                        continue
                    sym, cusip, day = r[ix["SYMBOL"]].strip().upper(), r[ix["CUSIP"]].strip().upper(), r[ix["SETTLEMENT DATE"]].strip()
                    key = symbol_key(sym)
                    if not key or not CUSIP_RE.match(cusip) or not re.fullmatch(r"\d{8}", day):
                        continue
                    cur = seen.get(key)
                    if cur is None or day > cur["day"]:
                        seen[key] = {"day": day, "cusips": {cusip}, "description": r[ix["DESCRIPTION"]].strip().upper(), "symbol": sym}
                    elif day == cur["day"]:
                        cur["cusips"].add(cusip)
    pairs, refused = {}, {}
    for key, v in seen.items():
        if len(v["cusips"]) > 1:
            refused[key] = (f"the SEC's fails-to-deliver files pair {v['symbol']} with {len(v['cusips'])} CUSIPs on "
                            f"{v['day'][:4]}-{v['day'][4:6]}-{v['day'][6:]}, so its 13F rows cannot be settled")
            continue
        pairs[key] = {"cusip": next(iter(v["cusips"])), "description": v["description"], "symbol": v["symbol"]}
    return pairs, refused


def _first_word(name: str) -> str:
    words = re.sub(r"[^0-9A-Z]+", " ", name.upper()).split()
    if words and words[0] == "THE":
        words = words[1:]
    return words[0] if words else ""


def names_agree(a: str, b: str) -> bool:
    """The first words of two issuer names agree: equal, or the shorter (three letters or more) begins the longer
    (the fails files abbreviate: FED for FEDERAL)."""
    x, y = sorted((_first_word(a), _first_word(b)), key=len)
    return bool(x) and (x == y or (len(x) >= 3 and y.startswith(x)))


def modal_name(c: Counter) -> str:
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


# ── the figures ─────────────────────────────────────────────────────────────

def figures(work: sqlite3.Connection, period: date) -> tuple[dict[str, dict], int]:
    """Per CUSIP: holders, shares, the ten largest holders' shares and how many of the largest filers hold it among
    their ten largest positions; and the count of filers. A filer's positions are valued at the period's median
    reported price per share of each CUSIP (a filer's own value over its own shares, the median across filers), so a
    filer who writes values in the wrong unit moves neither its rank nor anyone else's."""
    p = period.isoformat()
    work.execute("DROP TABLE IF EXISTS pos")
    work.execute("""CREATE TABLE pos AS SELECT e.cik AS cik, r.cusip AS cusip, SUM(r.shares) AS shares, SUM(r.value) AS value
                    FROM rows r JOIN eff e ON e.accession = r.accession WHERE e.period = ? GROUP BY e.cik, r.cusip""", (p,))
    work.execute("CREATE INDEX pos_cusip ON pos (cusip, shares)")
    price: dict[str, float] = {}
    cur, samples = None, []
    for cusip, x in work.execute("SELECT cusip, CAST(value AS REAL) / shares FROM pos WHERE shares > 0 AND value > 0 ORDER BY cusip"):
        if cusip != cur:
            if samples:
                price[cur] = statistics.median(samples)
            cur, samples = cusip, []
        samples.append(x)
    if samples:
        price[cur] = statistics.median(samples)
    value: dict[str, float] = defaultdict(float)
    holdings: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for cik, cusip, shares in work.execute("SELECT cik, cusip, shares FROM pos"):
        v = shares * price.get(cusip, 0.0)
        value[cik] += v
        holdings[cik].append((v, cusip))
    large = sorted(value, key=lambda c: (-value[c], c))[:LARGE_FILERS]
    in_top: Counter = Counter()
    for cik in large:
        for _v, cusip in sorted(holdings[cik], key=lambda t: (-t[0], t[1]))[:TOP_POSITIONS]:
            in_top[cusip] += 1
    out: dict[str, dict] = {}
    cur, held = None, []

    def close(cusip: str | None, held: list[int]) -> None:
        if cusip is not None and held:
            out[cusip] = {"holders": len(held), "shares": sum(held), "top10_shares": sum(held[:TOP_HOLDERS]),
                          "large_filers_top10": in_top.get(cusip, 0)}

    for cusip, shares in work.execute("SELECT cusip, shares FROM pos ORDER BY cusip, shares DESC"):
        if cusip != cur:
            close(cur, held)
            cur, held = cusip, []
        held.append(shares)
    close(cur, held)
    return out, len(value)


def compute(set_files: list[tuple[str, Path]], ftd_blobs: list[tuple[str, bytes]], period: date, prev: date, *,
            deadline: Callable[[], None] = lambda: None, workdir: Path | None = None) -> dict:
    """Everything one run stores, from local copies of the data sets and the fails files. Pure of the store."""
    periods = {period, prev}
    filings: list[dict] = []
    for name, path in set_files:
        with zipfile.ZipFile(path) as z:
            filings += read_filings(z, periods, name)
    keep, counts = effective(filings)
    per_period: dict[date, Counter] = {p: Counter() for p in periods}
    for f in filings:
        per_period[f["period"]]["filings"] += 1
    for f in keep.values():
        if f["amendment"] == "RESTATEMENT":
            per_period[f["period"]]["restatements"] += 1
        elif f["amendment"] == "NEW HOLDINGS":
            per_period[f["period"]]["new_holdings"] += 1
    for f in filings:
        if f["kind"] == "13F-HR/A" and f["amendment"] not in ("RESTATEMENT", "NEW HOLDINGS"):
            per_period[f["period"]]["set_aside"] += 1
    newest = {p: max((f["filed"] for f in filings if f["period"] == p), default=None) for p in periods}
    names: dict[date, dict[str, Counter]] = {p: defaultdict(Counter) for p in periods}
    with tempfile.TemporaryDirectory(dir=workdir) as tmp:
        work = sqlite3.connect(Path(tmp) / "work.db")
        try:
            work.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;"
                               "CREATE TABLE rows (accession TEXT, cusip TEXT, shares INTEGER, value INTEGER);"
                               "CREATE TABLE eff (accession TEXT PRIMARY KEY, period TEXT, cik TEXT);")
            work.executemany("INSERT INTO eff VALUES (?, ?, ?)", [(a, f["period"].isoformat(), f["cik"]) for a, f in keep.items()])
            for name, path in set_files:
                with zipfile.ZipFile(path) as z:
                    c = load_positions(work, z, keep, names, deadline)
                for p in periods:  # rows that could not be read, counted against the period they would have entered
                    per_period[p]["rows_set_aside"] += c[("rows_set_aside", p)]
                deadline()
            work.execute("CREATE INDEX rows_acc ON rows (accession)")
            stats = {}
            filers = {}
            for p in sorted(periods):
                stats[p], filers[p] = figures(work, p)
                deadline()
        finally:
            work.close()
    pairs, conflicts = read_ftd(ftd_blobs)
    held: dict[date, dict[str, dict]] = {p: {} for p in periods}
    refused: dict[date, dict[str, dict]] = {p: {} for p in periods}
    for p in periods:
        for key, why in conflicts.items():
            refused[p][key] = {"symbol": key, "reason": why}
        for key, pair in pairs.items():
            s = stats[p].get(pair["cusip"])
            if s is None:
                continue  # no 13F long position in shares under its CUSIP: served as "no 13F row stored"
            issuer = modal_name(names[p][pair["cusip"]])
            if not names_agree(issuer, pair["description"]):
                refused[p][key] = {"symbol": pair["symbol"],
                                   "reason": (f"the SEC's fails-to-deliver files name {pair['symbol']} {pair['description'].title()!r} "
                                              f"and 13F filers name its CUSIP {issuer.title()!r}, so the pairing is not settled")}
                continue
            held[p][key] = {"symbol": pair["symbol"], "issuer": issuer, **s}
    return {"period": period, "prev": prev, "held": held, "refused": refused, "filers": filers, "per_period": per_period,
            "newest_filing": newest, "counts": counts, "pairs": len(pairs)}


# ── the store ───────────────────────────────────────────────────────────────

def stored_inputs(conn: sqlite3.Connection, period: date) -> tuple[str, str] | None:
    """The data sets and method the stored period was computed from, when its run committed."""
    row = conn.execute(f"SELECT p.data_sets, p.method FROM {PERIODS} p JOIN {RUNS} r ON r.run_id = p.run_id "
                       f"WHERE p.period = ? AND r.status = 'committed'", (period.isoformat(),)).fetchone()
    return (row[0], row[1]) if row else None


def write(conn: sqlite3.Connection, result: dict, sets: list[DataSet], ftd: list[str], run_id: str, now: datetime) -> dict:
    """Replace the two periods' rows in the open transaction; the caller commits."""
    counts = {}
    for p in (result["prev"], result["period"]):
        ps = p.isoformat()
        old = {r[0]: r[1:] for r in conn.execute(f"SELECT symbol_key, {', '.join(FIGURES)} FROM {TABLE} WHERE period = ?", (ps,))}
        new = result["held"][p]
        revised = sum(1 for k, v in new.items() if k in old and tuple(v[f] for f in FIGURES) != tuple(old[k]))
        conn.execute(f"DELETE FROM {TABLE} WHERE period = ?", (ps,))
        conn.execute(f"DELETE FROM {REFUSED} WHERE period = ?", (ps,))
        conn.executemany(f"INSERT INTO {TABLE} ({', '.join(HOLDING_COLUMNS)}) VALUES ({', '.join('?' * len(HOLDING_COLUMNS))})",
                         [(k, ps, v["symbol"], v["issuer"], v["holders"], v["shares"], v["top10_shares"], v["large_filers_top10"], run_id)
                          for k, v in sorted(new.items())])
        conn.executemany(f"INSERT INTO {REFUSED} (symbol_key, period, symbol, reason, run_id) VALUES (?, ?, ?, ?, ?)",
                         [(k, ps, v["symbol"], v["reason"], run_id) for k, v in sorted(result["refused"][p].items())])
        c = result["per_period"][p]
        newest = result["newest_filing"][p]
        conn.execute(f"INSERT OR REPLACE INTO {PERIODS} (period, deadline, data_sets, filings_through, newest_filing, ftd_files, "
                     f"filers, filings, restatements, new_holdings, set_aside, names, revised_names, method, run_id, computed_at) "
                     f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (ps, deadline_of(p).isoformat(), ",".join(s.name for s in sets), max(s.end for s in sets).isoformat(),
                      newest.isoformat() if newest else None, ",".join(f.rsplit("/", 1)[-1] for f in ftd),
                      result["filers"][p], c["filings"], c["restatements"], c["new_holdings"], c["set_aside"] + c["rows_set_aside"],
                      len(new), revised, METHOD, run_id, cot.stamp(now)))
        counts[ps] = {"names": len(new), "refused": len(result["refused"][p]), "revised": revised, "filers": result["filers"][p]}
    return counts


def refresh(db_path: Path | str = DB_PATH, *, now: datetime | None = None, client: Client | None = None,
            contact: str | None = None, cache_dir: Path | None = None, budget_s: float = BUDGET_S,
            workdir: Path | None = None) -> dict:
    """Read the SEC's index pages; when the needed data sets differ from the stored ones, download them and the fails
    files, compute, and replace the two quarters in one transaction. Any failure keeps what is stored."""
    now = now or datetime.now(timezone.utc)
    started = time.monotonic()

    def deadline() -> None:
        if time.monotonic() - started > budget_s:
            raise Refused(f"stopped after {budget_s:.0f} s so the refresh keeps its time; nothing replaced")

    conn = sqlite3.connect(db_path)
    try:
        ensure_tables(conn)
        watermarks.ensure_table(conn)
        conn.commit()
        contact = (contact or "").strip()
        if client is None and "@" not in (contact or ""):
            detail = (f"not read: the SEC asks automated clients for a declared contact and {CONTACT_ENV} is not set; "
                      "what is stored is kept")
            newest = conn.execute(f"SELECT MAX(period) FROM {PERIODS}").fetchone()[0]
            return _record(conn, newest, "error", detail, now, advanced=False)
        client = client or Client(contact, cache_dir=cache_dir)
        run_id = None
        try:
            sets = data_sets(client.get(_path(SETS_PAGE)).decode("utf-8", "replace"))
            period, prev, needed = choose(sets)
            names = ",".join(s.name for s in needed)
            stored = stored_inputs(conn, period)
            if stored == (names, METHOD):
                newest = conn.execute(f"SELECT MAX(period) FROM {PERIODS}").fetchone()[0]
                return _record(conn, newest, "ok", f"SEC 13F unchanged: {period} from {names} already stored "
                                                    f"({client.requests} request(s))", now, advanced=False)
            ftd = ftd_paths(client.get(_path(FTD_PAGE)).decode("utf-8", "replace"))
            if not ftd:
                raise Refused("the SEC's fails-to-deliver page lists no file")
            run_id = cot.start_run(conn, SOURCE, now)
            conn.commit()
            with tempfile.TemporaryDirectory(dir=workdir) as tmp:
                files = []
                for s in needed:
                    deadline()
                    got = client.get(s.path, Path(tmp) / s.name)
                    files.append((s.name, Path(got)))
                blobs = []
                for f in ftd:
                    deadline()
                    blobs.append((f.rsplit("/", 1)[-1], client.get(f)))
                result = compute(files, blobs, period, prev, deadline=deadline, workdir=workdir)
            deadline()
            counts = write(conn, result, needed, ftd, run_id, now)
            c = counts[period.isoformat()]
            detail = (f"SEC 13F {period} (deadline {deadline_of(period)}) and {prev} from {names}: {c['names']} tickers, "
                      f"{c['filers']:,} filers, {c['refused']} refused, {c['revised']} revised · "
                      f"{result['pairs']:,} ticker pairings from {len(ftd)} fails files · {client.requests} request(s)")
            cot.finish_run(conn, run_id, "committed", detail, now)
            out = _record(conn, period.isoformat(), "ok", detail, now, commit=False)
            conn.commit()
            return out
        except Exception as exc:  # noqa: BLE001 — any failure keeps what is stored and says why in the watermark
            conn.rollback()
            why = str(exc) if isinstance(exc, (FetchFailed, Refused)) else f"{type(exc).__name__}: {exc}"
            detail = f"not read: {why}; what is stored is kept"
            if run_id is not None:
                cot.finish_run(conn, run_id, "failed", detail, now)
            newest = conn.execute(f"SELECT MAX(period) FROM {PERIODS}").fetchone()[0]
            return _record(conn, newest, "error", detail, now, advanced=False)
    finally:
        conn.close()


def _path(url: str) -> str:
    return url[len(SITE):]


def _record(conn: sqlite3.Connection, last_obs: str | None, status: str, detail: str, now: datetime, *,
            advanced: bool = True, commit: bool = True) -> dict:
    if not advanced:
        # keep the stored observation date; only the check and its status move
        row = conn.execute("SELECT last_obs FROM source_watermarks WHERE source = ?", (WATERMARK,)).fetchone()
        last_obs = row[0] if row and row[0] else last_obs
    watermarks.record(conn, WATERMARK, last_obs, status=status, detail=detail, now=now)
    if commit:
        conn.commit()
    return {"status": status, "detail": detail, "last_obs": last_obs}

