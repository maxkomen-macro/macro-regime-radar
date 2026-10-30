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
    request for the day that got no answer, withdraws it;
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

    charged = [{k: r.get(k) for k in ("id", "status", "calls", "calls_by_utc_date", "saw_429")}
               for r in vault.get("runs") or [] if isinstance(r, Mapping) and r.get("calls")]
    body = json.dumps({"days": vault.get("days") or {}, "occ": vault.get("occ") or {},
                       "withdrawn": vault.get("withdrawn") or {}, "charged": charged}, separators=(",", ":"),
                      sort_keys=True).encode("utf-8")
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
    return {"format": FORMAT, "runs": [], "days": {}, "occ": {}, "withdrawn": {}}


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


def _withdrawn_after(vault: Mapping[str, Any], d: date, entry: Mapping[str, Any]) -> bool:
    """A request for `d` that got no answer, newer than `entry` (Codex S-1: a failed read withdraws, R5)."""
    w = (vault.get("withdrawn") or {}).get(d.isoformat())
    return w is not None and at(w) >= at(entry["at"])


def contested(vault: Mapping[str, Any], d: date) -> bool:
    """The newest read covering `d` was not a passing, complete one, or a newer request for it got no answer."""
    es = _entries(vault, d)
    if not es:
        return (vault.get("withdrawn") or {}).get(d.isoformat()) is not None
    e1 = es[0]
    return not (e1.get("status") == PASSING and e1.get("complete") is True) or _withdrawn_after(vault, d, e1)


def day_stable(vault: Mapping[str, Any], d: date, now: datetime) -> bool:
    es = _entries(vault, d)
    if len(es) < DAY_ENTRIES:
        return False
    e1, e2 = es[0], es[1]
    if not all(e.get("status") == PASSING and e.get("complete") is True for e in (e1, e2)):
        return False
    if _withdrawn_after(vault, d, e1):
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
