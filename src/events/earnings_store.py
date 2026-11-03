"""src/events/earnings_store.py — the Options Finder earnings cache's vault and its read-time rules.

The refresh step (src/events/earnings_cache.py) fills one encrypted vault; the API's worker item opens it, and
the Finder's route asks `coverage` what may be said for one symbol at one session. No network I/O here, and only
the standard library and `cryptography`, so the pipeline and the API share it (design EC, sections 2-4).

The vault is one row of table earnings_cache_vault: AES-256-GCM over zlib(JSON), keyed from EARNINGS_CACHE_KEY
through HKDF-SHA256. The public data-latest database carries ciphertext only (plan rev 2, D5). Inside: the runs,
the newest two covering entries per New York day, and every (symbol, date) occurrence any reply ever listed.

Read-time rules (capability report rev 2, R2/R4/R5, and the owner's 2026-10-29 23:26 UTC clarifications):
  - a day is stable when its two newest covering entries both come from passing runs and are complete, the
    newest is under 48 hours old and the two are at most 48 hours apart; a newer non-passing entry, or a newer
    request for the day that got no answer, withdraws it, until two reads newer than that request agree again;
  - D is the last day of the unbroken stable stretch from the session;
  - a listing is stable when its day is stable and both entries list it once, with the same fiscal label;
  - an occurrence its day's newest entry no longer lists is a possible event until its date passes, its quarter
    is seen reported on another date, or the same quarter is stable on another date (moved);
  - coverage is reconciled through K only along a chain from a quarter a passing run saw with actual figures
    under that same label: each link the next fiscal quarter (Q4 rolls to Q1 of the next year), stable, on or
    after the session and on or before D, with nothing else listed or possible between links. Anything else is
    unknown. Reconciled coverage is provider-based (Finnhub's labels and dates) and covers regular quarterly
    reports only; it is never company confirmation.
"""

from __future__ import annotations

import json
import os
import zlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

TABLE = "earnings_cache_vault"
FORMAT = 1
AAD = b"earnings_cache_vault/v1"
SALT = b"mrr-earnings-cache"
KEY_ENV = "EARNINGS_CACHE_KEY"
FRESH = timedelta(hours=48)  # plan D3
LEDGER_PREFIX, LEDGER_SUFFIX = "earnings-cache-ledger-", ".bin"
LEDGER_AAD = b"earnings_cache_ledger/v1"
LEDGER_FORMAT = 1
# a reservation's provisional withdrawals count once the run that wrote them can no longer be running (its step's
# 10-minute timeout, with room): before that it is in flight, and its own final write replaces them (design 9.6)
PROVISIONAL_GRACE = timedelta(minutes=15)
DAY_ENTRIES = 2  # covering entries kept per day
LABEL_YEARS = (1990, 2100)

PASSING, PARTIAL, INCONSISTENT, FAILED, SKIPPED = "passing", "partial", "inconsistent", "failed", "skipped"

SCHEMA = (f"CREATE TABLE IF NOT EXISTS {TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), format INTEGER NOT NULL, "
          "key_id TEXT NOT NULL, content_digest TEXT NOT NULL, nonce BLOB NOT NULL, blob BLOB NOT NULL, "
          "updated_at TEXT NOT NULL)")


# ── keys and the blob ────────────────────────────────────────────────────────

def _hkdf(secret: str, info: bytes, length: int) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    return HKDF(algorithm=hashes.SHA256(), length=length, salt=SALT, info=info).derive(secret.encode("utf-8"))


def key_id(secret: str) -> str:
    """Which key wrote the blob: a fingerprint, not the key."""
    return _hkdf(secret, b"key-id", 8).hex()


def content_digest(vault: Mapping[str, Any], secret: str) -> str:
    """A keyed digest of what must be published (design EC 4.1): the observations (days, occurrences and
    withdrawals) and every run that charged a call (its calls per UTC date, status and 429), so a run that called
    Finnhub changes it even when nothing was answered (Codex S-2), and a zero-call skip does not."""
    import hmac

    charged = [{k: r.get(k) for k in ("id", "status", "calls", "calls_by_utc_date", "saw_429", "finished")}
               for r in vault.get("runs") or [] if isinstance(r, Mapping) and r.get("calls")]
    body = json.dumps({"days": vault.get("days") or {}, "occ": vault.get("occ") or {},
                       "withdrawn": vault.get("withdrawn") or {}, "provisional": vault.get("provisional") or {},
                       "charged": charged}, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hmac.new(_hkdf(secret, b"digest", 32), body, "sha256").hexdigest()


def seal(vault: Mapping[str, Any], secret: str) -> tuple[bytes, bytes]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    plain = zlib.compress(json.dumps(vault, separators=(",", ":"), sort_keys=True).encode("utf-8"), 9)
    return nonce, AESGCM(_hkdf(secret, b"aes-key", 32)).encrypt(nonce, plain, AAD)


def unseal(nonce: bytes, blob: bytes, secret: str) -> dict:
    """The vault; raises on a wrong key, a tampered blob or a body that does not parse."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    plain = AESGCM(_hkdf(secret, b"aes-key", 32)).decrypt(bytes(nonce), bytes(blob), AAD)
    out = json.loads(zlib.decompress(plain).decode("utf-8"))
    if not isinstance(out, dict) or out.get("format") != FORMAT:
        raise ValueError("unexpected vault body")
    return out


def empty_vault() -> dict:
    return {"format": FORMAT, "runs": [], "days": {}, "occ": {}, "withdrawn": {}, "provisional": {}}


# ── the durable ledger's assets (design EC section 9) ────────────────────────

def ledger_name(seq: int) -> str:
    return f"{LEDGER_PREFIX}{seq:09d}{LEDGER_SUFFIX}"


def ledger_seq(name: str) -> int | None:
    """The seq of a ledger asset's name; None for a name that is not a ledger asset; ValueError for one that looks
    like a ledger asset but whose seq part is not exactly 9 digits (the order is then unsafe, DR-22)."""
    if not name.startswith(LEDGER_PREFIX):
        return None
    mid = name[len(LEDGER_PREFIX):]
    if not mid.endswith(LEDGER_SUFFIX):
        raise ValueError("not a sequenced ledger name")
    mid = mid[: -len(LEDGER_SUFFIX)]
    if len(mid) != 9 or not mid.isdigit():
        raise ValueError("not a sequenced ledger name")
    return int(mid)


def seal_ledger(vault: Mapping[str, Any], secret: str, seq: int, now: datetime) -> bytes:
    """One ledger asset: the vault sealed under its own AAD in a public envelope (key id, seq, time; no symbol,
    no report date, no count of names)."""
    import base64

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    plain = zlib.compress(json.dumps(vault, separators=(",", ":"), sort_keys=True).encode("utf-8"), 9)
    blob = AESGCM(_hkdf(secret, b"aes-key", 32)).encrypt(nonce, plain, LEDGER_AAD)
    return json.dumps({"format": LEDGER_FORMAT, "key_id": key_id(secret), "seq": seq, "written_at": iso(now),
                       "nonce": base64.b64encode(nonce).decode(), "blob": base64.b64encode(blob).decode()}).encode()


def open_ledger(raw: bytes, secret: str, seq: int) -> Opened:
    """ok with the vault, rotated (another key), or unreadable (tampered, truncated, or a seq that disagrees with
    its name or its body). Never raises."""
    import base64

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        env = json.loads(raw)
        if not isinstance(env, dict) or env.get("format") != LEDGER_FORMAT or env.get("seq") != seq:
            return Opened("unreadable")
        if env.get("key_id") != key_id(secret):
            return Opened("rotated")
        plain = AESGCM(_hkdf(secret, b"aes-key", 32)).decrypt(base64.b64decode(env["nonce"]),
                                                               base64.b64decode(env["blob"]), LEDGER_AAD)
        out = json.loads(zlib.decompress(plain).decode("utf-8"))
    except Exception:  # noqa: BLE001 — a state, never an error
        return Opened("unreadable")
    if not isinstance(out, dict) or out.get("format") != FORMAT or out.get("seq") != seq:
        return Opened("unreadable")
    return Opened("ok", out)


@dataclass
class Opened:
    status: str  # ok | absent | no_key | rotated | unreadable
    vault: dict | None = None


def open_vault(conn, secret: str | None) -> Opened:
    """Never raises: a value for every state (the API's worker item must not fail, C1)."""
    if not secret:
        return Opened("no_key")
    try:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (TABLE,)).fetchone() is None:
            return Opened("absent")
        row = conn.execute(f"SELECT key_id, nonce, blob FROM {TABLE} WHERE id = 1").fetchone()
    except Exception:  # noqa: BLE001
        return Opened("unreadable")
    if row is None:
        return Opened("absent")
    try:
        if row[0] != key_id(secret):
            return Opened("rotated")
        return Opened("ok", unseal(row[1], row[2], secret))
    except Exception:  # noqa: BLE001 — a tampered or unreadable blob: the state only
        return Opened("unreadable")


def write_vault(conn, vault: Mapping[str, Any], secret: str, now: datetime) -> None:
    nonce, blob = seal(vault, secret)
    with conn:
        conn.execute(SCHEMA)
        conn.execute(f"DELETE FROM {TABLE}")
        conn.execute(f"INSERT INTO {TABLE} (id, format, key_id, content_digest, nonce, blob, updated_at) "
                     "VALUES (1, ?, ?, ?, ?, ?, ?)", (FORMAT, key_id(secret), content_digest(vault, secret), nonce, blob, iso(now)))


# ── helpers ──────────────────────────────────────────────────────────────────

def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def at(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)


def label(year: Any, quarter: Any) -> tuple[int, int] | None:
    """A fiscal (year, quarter) when both are whole numbers in range, else None (unlabelled)."""
    out = []
    for v in (year, quarter):
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            return None
        try:
            f = float(v)
        except ValueError:
            return None
        if f != f or f in (float("inf"), float("-inf")) or f != int(f):
            return None
        out.append(int(f))
    y, q = out
    return (y, q) if 1 <= q <= 4 and LABEL_YEARS[0] <= y <= LABEL_YEARS[1] else None


def next_label(lab: tuple[int, int]) -> tuple[int, int]:
    y, q = lab
    return (y + 1, 1) if q == 4 else (y, q + 1)


# ── read-time state (design EC section 2) ────────────────────────────────────

@dataclass
class Occurrence:
    symbol: str
    day: date
    hour: str
    labels: list[tuple[int, int]]
    reported: list[tuple[int, int]]
    first_seen: datetime
    last_seen: datetime
    listed: bool = False
    stable: bool = False
    possible: bool = False
    resolved: bool = False
    moved_from: list[date] = field(default_factory=list)

    @property
    def label(self) -> tuple[int, int] | None:
        return self.labels[0] if len(self.labels) == 1 else None

    @property
    def relabelled(self) -> bool:
        return len(self.labels) > 1


@dataclass
class Coverage:
    state: str  # reconciled | listed | unlisted | unconfirmed
    through: date | None = None  # K (reconciled)
    listed_through: date | None = None  # D (unlisted)
    events: list[Occurrence] = field(default_factory=list)
    reason: str = ""


def index(vault: Mapping[str, Any]) -> dict[str, list[dict]]:
    """The vault's occurrences by symbol (built once per generation, not per request)."""
    out: dict[str, list[dict]] = {}
    for raw in (vault.get("occ") or {}).values():
        out.setdefault(raw.get("s"), []).append(raw)
    return out


def _entries(vault: Mapping[str, Any], d: date) -> list[dict]:
    return list((vault.get("days") or {}).get(d.isoformat()) or [])


def withdrawal(vault: Mapping[str, Any], d: date, now: datetime | None) -> datetime | None:
    """The newest withdrawal of `d`: a request for it that got no answer (Codex S-1), a conservative restart's
    barrier (DR-17), or a reservation's provisional withdrawal once its run can no longer be running (design 9.6;
    with now None, every provisional one counts)."""
    out = None
    w = (vault.get("withdrawn") or {}).get(d.isoformat())
    if w is not None:
        out = at(w)
    for p in (vault.get("provisional") or {}).values():
        t = at(p["at"])
        if d.isoformat() in (p.get("days") or ()) and (now is None or now - t >= PROVISIONAL_GRACE):
            out = t if out is None else max(out, t)
    return out


def _withdrawn_after(vault: Mapping[str, Any], d: date, entry: Mapping[str, Any], now: datetime | None) -> bool:
    w = withdrawal(vault, d, now)
    return w is not None and w >= at(entry["at"])


def contested(vault: Mapping[str, Any], d: date, now: datetime | None = None) -> bool:
    """The newest read covering `d` was not a passing, complete one, or a newer request for it got no answer."""
    es = _entries(vault, d)
    if not es:
        return withdrawal(vault, d, now) is not None
    e1 = es[0]
    return not (e1.get("status") == PASSING and e1.get("complete") is True) or _withdrawn_after(vault, d, e1, now)


def day_stable(vault: Mapping[str, Any], d: date, now: datetime) -> bool:
    es = _entries(vault, d)
    if len(es) < DAY_ENTRIES:
        return False
    e1, e2 = es[0], es[1]
    if not all(e.get("status") == PASSING and e.get("complete") is True for e in (e1, e2)):
        return False
    if _withdrawn_after(vault, d, e2, now):  # both reads must postdate any withdrawal (Codex S-4)
        return False
    t1, t2 = at(e1["at"]), at(e2["at"])
    return now - t1 < FRESH and timedelta(0) <= t1 - t2 <= FRESH


def stable_through(vault: Mapping[str, Any], session: date, now: datetime) -> date | None:
    """D: the last day of the unbroken stretch of stable days from the session, or None."""
    d, out = session, None
    while day_stable(vault, d, now):
        out, d = d, d + timedelta(days=1)
    return out


def _labels_on(entry: Mapping[str, Any], symbol: str) -> list[tuple[int, int] | None]:
    return [label(r[2], r[3]) for r in entry.get("rows") or [] if r and r[0] == symbol]


def occurrences(vault: Mapping[str, Any], raws: Iterable[Mapping[str, Any]], session: date,
                now: datetime) -> list[Occurrence]:
    out: list[Occurrence] = []
    for raw in raws:
        labs = sorted({lab for lab in (label(*p) for p in raw.get("labels") or []) if lab is not None})
        reps = sorted({lab for lab in (label(*p) for p in raw.get("reported") or []) if lab is not None})
        o = Occurrence(raw["s"], date.fromisoformat(raw["d"]), raw.get("h") or "unknown", labs, reps,
                       at(raw["f"]), at(raw["l"]))
        es = _entries(vault, o.day)
        if es:
            now_labels = _labels_on(es[0], o.symbol)
            o.listed = bool(now_labels)
            if len(es) >= DAY_ENTRIES and len(now_labels) == 1 and now_labels[0] is not None and day_stable(vault, o.day, now):
                o.stable = _labels_on(es[1], o.symbol) == now_labels
        out.append(o)
    for o in out:  # R4: resolved when past, reported, or moved to a stable date
        if o.day < session:
            o.resolved = True
        elif not o.listed and o.label is not None:
            twins = [t for t in out if t is not o]
            if any(o.label in t.reported for t in twins):
                o.resolved = True
            moved = [t for t in twins if t.stable and t.label == o.label]
            if moved:
                o.resolved = True
                for t in moved:
                    t.moved_from.append(o.day)
        o.possible = not o.listed and not o.resolved
    return sorted(out, key=lambda o: o.day)


def coverage(vault: Mapping[str, Any], raws: Iterable[Mapping[str, Any]], session: date, now: datetime,
             other_days: Iterable[date] = ()) -> Coverage:
    """What may be said for one symbol at one session (design EC section 3). `raws`: the symbol's occurrences
    (index()); `other_days`: the New York dates of its hand-maintained earnings rows."""
    occ = occurrences(vault, raws, session, now)
    events = [o for o in occ if (o.listed or o.possible) and o.day >= session]
    other = sorted(set(other_days))
    d = stable_through(vault, session, now)
    if d is None:
        return Coverage("unconfirmed", events=events, reason="no stable day at the session")
    has_events = bool(events) or any(x >= session for x in other)

    def unknown(reason: str) -> Coverage:
        return Coverage("listed" if has_events else "unlisted", listed_through=None if has_events else d,
                        events=events, reason=reason)

    anchors = [o for o in occ if o.reported]
    if not anchors:
        return unknown("no quarter seen reported")
    if any(o.relabelled or o.label is None or o.reported != [o.label] for o in anchors):
        return unknown("a reported quarter's label changed")
    if len({o.label for o in anchors}) != len(anchors):
        return unknown("one reported quarter on two dates")
    p = max(anchors, key=lambda o: o.label)
    if p.day > session:  # DR-15: the days from the session to the anchor carry no fiscal evidence
        return unknown("the reported quarter is after the session")
    live = [o for o in occ if not o.resolved and o is not p]
    if any(o.label is not None and o.label <= p.label and o.day > p.day for o in live):
        return unknown("a quarter at or before the reported one is listed later")
    listed_labels = [o.label for o in live if o.listed and o.label is not None]
    if len(listed_labels) != len(set(listed_labels)):
        return unknown("one quarter listed on two dates")
    cur, links = p, []
    while True:
        want = next_label(cur.label)
        cands = [o for o in live if o.listed and not o.relabelled and o.label == want]
        if len(cands) != 1:
            break
        c = cands[0]
        if not c.stable or c.day <= cur.day or c.day < session or c.day > d:
            break
        if any(o is not c and cur.day < o.day <= c.day and (o.listed or o.possible) for o in live):
            break
        if any(cur.day < x < c.day for x in other):
            break
        links.append(c)
        cur = c
    # the whole claimed range, endpoints included (DR-15): K is the last link with no other event from the
    # session through it (the anchor's own report is a known report, not another one)
    link_ids, link_days = {id(c) for c in links}, {c.day for c in links}
    k = None
    for c in links:
        if any(id(o) not in link_ids and session <= o.day <= c.day and (o.listed or o.possible) for o in live):
            break
        if any(x not in link_days and session <= x <= c.day for x in other):
            break
        k = c.day
    if k is None:
        return unknown("no stable next quarter after the reported one")
    return Coverage("reconciled", through=k, events=events)


# ── the API's ledger reader (design LR, Amendment A-3) ───────────────────────
# Pure helpers for api/earnings_ledger_reader.py and the Finder's withdraw-only rule (api/desk_options.py). Nothing
# above changes: the cache job keeps open_ledger, and coverage is computed exactly as before.

MAX_PLAIN = 16 * 1024 * 1024  # a real vault is a few MB (design LR 2.1, DR-30)
LEDGER_LIMITS = {"days": 400, "occ": 50_000, "withdrawn": 400, "provisional": 400, "runs": 500}
LEDGER_MAX_ROWS = 5000  # rows in one day entry


def _schema_ok(v: Any) -> bool:
    """The opened vault's shape, checked before anything uses it (design LR 2.1)."""
    if not isinstance(v, dict) or v.get("format") != FORMAT:
        return False
    for k, typ in (("days", dict), ("occ", dict), ("withdrawn", dict), ("provisional", dict), ("runs", list)):
        x = v.get(k, typ())
        if not isinstance(x, typ) or len(x) > LEDGER_LIMITS[k]:
            return False
    for entries in (v.get("days") or {}).values():
        if not isinstance(entries, list) or len(entries) > DAY_ENTRIES:
            return False
        for e in entries:
            if not isinstance(e, dict) or not isinstance(e.get("at"), str):
                return False
            rows = e.get("rows", [])
            if not isinstance(rows, list) or len(rows) > LEDGER_MAX_ROWS:
                return False
    for o in (v.get("occ") or {}).values():
        if not isinstance(o, dict) or not all(isinstance(o.get(f), str) for f in ("s", "d", "f", "l")):
            return False
        if not all(isinstance(o.get(f, []), list) for f in ("labels", "reported", "reported_by")):
            return False
    for p in (v.get("provisional") or {}).values():
        if not isinstance(p, dict) or not isinstance(p.get("at"), str) or not isinstance(p.get("days", []), list):
            return False
    if not all(isinstance(w, str) for w in (v.get("withdrawn") or {}).values()):
        return False
    return all(isinstance(r, dict) for r in v.get("runs") or [])


def open_ledger_bounded(raw: bytes, secret: str, seq: int) -> Opened:
    """open_ledger with bounds (design LR 2.1): the same envelope, key and seq checks; the plaintext capped at
    MAX_PLAIN; a complete stream (checksum verified, DR-33) with no trailing bytes; then the schema. ok, rotated or
    unreadable. Never raises."""
    import base64

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        env = json.loads(raw)
        if not isinstance(env, dict) or env.get("format") != LEDGER_FORMAT or env.get("seq") != seq:
            return Opened("unreadable")
        if env.get("key_id") != key_id(secret):
            return Opened("rotated")
        packed = AESGCM(_hkdf(secret, b"aes-key", 32)).decrypt(base64.b64decode(env["nonce"]),
                                                                base64.b64decode(env["blob"]), LEDGER_AAD)
        d = zlib.decompressobj()
        plain = d.decompress(packed, MAX_PLAIN)
        if d.unconsumed_tail or not d.eof or d.unused_data:
            return Opened("unreadable")
        out = json.loads(plain.decode("utf-8"))
    except Exception:  # noqa: BLE001 — a state, never an error
        return Opened("unreadable")
    if not _schema_ok(out) or out.get("seq") != seq:
        return Opened("unreadable")
    return Opened("ok", out)


def material(cov: Coverage) -> tuple:
    """What a coverage answer says, without its provenance times (first_seen, last_seen): the answer served keeps
    the published vault's, so no time is ever renewed (design LR 3.2)."""
    return (cov.state, cov.through, cov.listed_through, cov.reason,
            tuple(sorted((o.day, o.hour, o.label, o.listed, o.possible, tuple(o.moved_from)) for o in cov.events)))


def _newest_run_day(v: Mapping[str, Any]) -> date | None:
    from zoneinfo import ZoneInfo

    starts = [at(r["started"]) for r in v.get("runs") or [] if isinstance(r, Mapping) and r.get("started")]
    return max(starts).astimezone(ZoneInfo("America/New_York")).date() if starts else None


def _prefix(a: Any, b: Any) -> bool:
    a, b = list(a or []), list(b or [])
    return b[: len(a)] == a


def _day_continues(old: list, new: list | None) -> bool:
    """new == (N + old)[:DAY_ENTRIES] for zero or more entries N, newest first, none older than old's newest."""
    if not old:
        return True
    if new is None:
        return False
    newest = at(old[0]["at"])
    for k in range(len(new) + 1):
        if new[k:] == old[: len(new) - k] and len(new) == min(DAY_ENTRIES, k + len(old)):
            if all(at(e["at"]) >= newest for e in new[:k]):
                return True
    return False


def continues(older: Mapping[str, Any], newer: Mapping[str, Any]) -> bool:
    """True only when `newer` could have come from `older` by the cache's own writes (design LR 3.4; DR-24, DR-25,
    DR-31): day entries only gain newer reads in front, withdrawals never fall or vanish, a reservation is either
    kept, converted into withdrawals, or superseded by its own run's final record, and an occurrence keeps its
    first sighting and every label and reported label it had. Days and occurrences below the writer's own
    pruning floors may vanish. These are every field the read-time rules consult. Never raises."""
    from src.events.earnings_cache import KEEP_DAYS_BEFORE, KEEP_OCC_DAYS

    try:
        top = _newest_run_day(newer)
        f = (top - timedelta(days=KEEP_DAYS_BEFORE)).isoformat() if top else ""
        g = (top - timedelta(days=KEEP_OCC_DAYS)).isoformat() if top else ""
        o_days, n_days = older.get("days") or {}, newer.get("days") or {}
        o_w, n_w = older.get("withdrawn") or {}, newer.get("withdrawn") or {}
        o_p, n_p = older.get("provisional") or {}, newer.get("provisional") or {}
        for d, entries in o_days.items():
            if d >= f and not _day_continues(list(entries or []), n_days.get(d)):
                return False
        for d, w in o_w.items():
            if d >= f and (d not in n_w or at(n_w[d]) < at(w)):
                return False
        runs = {r.get("id"): r for r in newer.get("runs") or [] if isinstance(r, Mapping)}
        for rid, p in o_p.items():
            if n_p.get(rid) == p:
                continue
            t = at(p["at"])
            kept = [d for d in p.get("days") or () if d >= f]
            if all(d in n_w and at(n_w[d]) >= t for d in kept):
                continue
            rec = runs.get(p["at"])
            if rec is not None and not rec.get("provisional"):
                continue
            return False
        n_occ = newer.get("occ") or {}
        for k, o in (older.get("occ") or {}).items():
            if o["d"] < g:
                continue
            n = n_occ.get(k)
            if n is None or any(n.get(x) != o.get(x) for x in ("s", "d", "f")) or at(n["l"]) < at(o["l"]):
                return False
            if not all(_prefix(o.get(x), n.get(x)) for x in ("labels", "reported", "reported_by")):
                return False
        return True
    except Exception:  # noqa: BLE001 — anything malformed is a break
        return False
