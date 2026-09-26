"""api/bootstrap.py — DB snapshot bootstrap from the private data-latest Release.

Ports the proven dashboard pattern (dashboard/app.py:_refresh_db_snapshot) to
the FastAPI service: when GH_DB_TOKEN is set, resolve the `macro_radar.db`
asset on the `data-latest` GitHub Release (repo maxkomen-macro/macro-regime-radar)
and download it atomically into api.db.DB_PATH — temp file in the same
directory + os.replace(), so a reader never sees a torn file (api/db.py opens
a fresh read-only connection per request and tolerates the swap).

Behavior knobs (all env; the token is never logged):
- GH_DB_TOKEN               read-only Contents PAT. Absent → no-op: dev keeps
                            whatever DB is on disk, untouched.
- BOOTSTRAP_DB_REFRESH_MIN  if > 0, a lifespan task checks the release every N
                            minutes (default 0 = disabled).
- BOOTSTRAP_DB_MAX_AGE_MIN  legacy: reported in status(), decides nothing.

What decides a download (fix/prelaunch-1, B-H1): the release asset's identity
(its id, which every --clobber upload renews, plus updated_at, size and
digest), recorded beside the database in `<db>.asset.json` after each swap.
Startup and every periodic check ask GitHub for the current asset; the same
identity means no download, no swap, no new database file key, and so no
rebuild by the worker (api/worker.py). The local file's mtime never decides.
After a swap the worker is poked, builds a generation from the new file, and
publishes reads and results together.

The published verdict (desk/frame-3-api-b2a; FRAME3_API_PLAN.md §1.9, S-01):
both database writers upload `validation.json` beside the database, the
validator's {verdict, mode, timestamp, db_sha256}. Bootstrap binds it to the
file it verifies, in memory only, through one bracketed procedure: read the
file key, require the file's -wal (and at a download the served file's) to be
absent or empty, hash the file and compare with `db_sha256`, read the key and
the WALs again, and bind exactly the first key when the hash matches, the key
did not move and the WAL is still empty. At a download it runs on the new file
before the swap (os.replace keeps the inode, mtime and size, so the bound key
is the one the swapped file carries); on a poll with an unchanged asset it runs
on the served file whenever nothing is held or the held hash is not the
current asset's, so a late or failed upload and a restart recover with no
database download. /api/desk/pipeline serves the verdict only for the
generation whose key is the bound key (`validation_for`): a local commit moves
the key (WAL frames count, a checkpoint moves the mtime and size), and the
verdict reads unknown until the next upload is verified. The worker re-reads
the key after its copy and drops a copy taken across a change (hardening
R-11), so a generation's key is always the key of the bytes it holds.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
from pathlib import Path

import httpx

from datetime import datetime, timezone

from api import db
from src.analytics import dbpath

log = logging.getLogger("mrr.bootstrap")

# Last-attempt ledger for /api/freshness and /health/ready — never a token.
_state: dict = {
    "token_configured": False,
    "last_attempt_at": None,
    "last_result": None,  # downloaded | unchanged | skipped | no_asset | error
    "last_error": None,
    "last_downloaded_at": None,
    "asset_updated_at": None,
    "asset_size": None,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def status() -> dict:
    """Snapshot provenance for the freshness endpoint: what the server holds
    and when it last tried to refresh it."""
    out = dict(_state)
    out["token_configured"] = bool(_token())
    out["refresh_interval_min"] = refresh_interval_min()
    out["max_age_min"] = _max_age_min()
    DB_PATH = db.DB_PATH
    if DB_PATH.exists():
        st = DB_PATH.stat()
        out["db_mtime"] = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        out["db_size"] = st.st_size
    else:
        out["db_mtime"] = None
        out["db_size"] = None
    return out

_GH_API_REPO = "https://api.github.com/repos/maxkomen-macro/macro-regime-radar"
_DB_ASSET_NAME = "macro_radar.db"
# Tests inject an httpx.MockTransport here; None means the real network.
_transport: httpx.BaseTransport | None = None


def _token() -> str:
    # Stripped like every other token loader: a value pasted with a trailing
    # newline made h11 reject the header with the token in the error text
    # (launch-1 verify loop 1).
    return os.environ.get("GH_DB_TOKEN", "").strip()


def public_error(exc: BaseException) -> str:
    """What a failed refresh may say in /api/freshness and in a log line: the
    kind of failure and an HTTP status, never the exception's own text, which
    can carry a signed download URL or a header value."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code} from GitHub"
    if isinstance(exc, ValueError) and str(exc).startswith("downloaded "):
        return str(exc)  # _validate_sqlite's own sentences
    return type(exc).__name__


def refresh_interval_min() -> float:
    """BOOTSTRAP_DB_REFRESH_MIN as a float, 0 (disabled) on unset/garbage."""
    raw = os.environ.get("BOOTSTRAP_DB_REFRESH_MIN", "0")
    try:
        return max(0.0, float(raw))
    except ValueError:
        log.warning("BOOTSTRAP_DB_REFRESH_MIN=%r is not a number — refresh disabled", raw)
        return 0.0


def _max_age_min() -> float | None:
    """BOOTSTRAP_DB_MAX_AGE_MIN as a float for status(); since fix/prelaunch-1
    it decides nothing (the release asset's identity does)."""
    raw = os.environ.get("BOOTSTRAP_DB_MAX_AGE_MIN")
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning("BOOTSTRAP_DB_MAX_AGE_MIN=%r is not a number — treating as unset", raw)
        return None


def identity_path() -> Path:
    return db.DB_PATH.with_name(db.DB_PATH.name + ".asset.json")


def asset_identity(asset: dict) -> dict:
    """What identifies a published database: the release asset itself, never
    the local file's modification time."""
    return {k: asset.get(k) for k in ("id", "updated_at", "size", "digest")}


def _read_identity() -> dict | None:
    try:
        return json.loads(identity_path().read_text())
    except (OSError, ValueError):
        return None


def _write_identity(identity: dict) -> None:
    path = identity_path()
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(identity))
    os.replace(tmp, path)


# ── The published validation verdict (S-01) ─────────────────────────────────

_VALIDATION_ASSET_NAME = "validation.json"
_VALIDATION_FIELDS = ("verdict", "mode", "timestamp", "db_sha256")
_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
# (verdict, mode, timestamp, validated_key, db_sha256) once bound, else None
_validation: dict | None = None
_validation_lock = threading.Lock()


def _set_validation(bound: dict | None) -> None:
    global _validation
    with _validation_lock:
        _validation = bound


def validation_state() -> dict | None:
    """What bootstrap holds: the bound verdict and its key, or None."""
    with _validation_lock:
        return dict(_validation) if _validation is not None else None


def validation_for(key: tuple | None) -> str | None:
    """The verdict to serve for a generation with this file key: the held
    verdict when it was bound to exactly this key, else None ("unknown")."""
    held = validation_state()
    if held is None or key is None or held["validated_key"] != tuple(key):
        return None
    return held["verdict"]


def reset_validation_for_tests() -> None:
    _set_validation(None)


def parse_validation(raw: bytes) -> dict | None:
    """The published verdict, or None unless it has exactly the four fields
    with a pass/fail verdict and a sha256 in hex."""
    try:
        doc = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(doc, dict) or set(doc) != set(_VALIDATION_FIELDS):
        return None
    if doc["verdict"] not in ("pass", "fail") or not isinstance(doc["mode"], str) or not isinstance(doc["timestamp"], str):
        return None
    if not isinstance(doc["db_sha256"], str) or not _SHA256_HEX.match(doc["db_sha256"]):
        return None
    return doc


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _wal_empty(path: Path | str) -> bool:
    try:
        return os.stat(f"{path}-wal").st_size == 0
    except OSError:
        return True  # absent


def bind_validation(published: dict, path: Path | str, *, served: Path | str | None = None) -> dict | None:
    """The bracketed binding (plan §1.9 part 2, rounds 3 and 4 of R-01), run on
    the file whose bytes are hashed: `path` (a download's new file, or the
    served file on a poll), with `served` the served file whose WAL the new one
    will sit beside at a download.

    1. k1 = file_key(path);
    2. path's WAL (and served's) absent or empty;
    3. its sha256 equal to the published `db_sha256`;
    4. k2 = file_key(path), and the WALs still empty;
    5. bind exactly k1 when all hold and k1 == k2; else nothing.

    A non-empty WAL holds commits the hash never saw (a WAL commit leaves the
    main file's bytes unchanged), and any commit after step 4 moves the key,
    which the per-request gate then refuses."""
    wals = [path] + ([served] if served is not None else [])
    k1 = dbpath.file_key(path)
    if k1 is None or not all(_wal_empty(w) for w in wals):
        return None
    sha = sha256_file(path)
    if sha != published["db_sha256"]:
        return None
    k2 = dbpath.file_key(path)
    if k2 != k1 or not all(_wal_empty(w) for w in wals):
        return None
    return {"verdict": published["verdict"], "mode": published["mode"], "timestamp": published["timestamp"],
            "validated_key": tuple(k1), "db_sha256": sha}


def _asset_sha(asset: dict) -> str | None:
    """The database asset's sha256 as the release lists it (`sha256:<hex>`)."""
    digest = str(asset.get("digest") or "")
    hexpart = digest[len("sha256:"):] if digest.startswith("sha256:") else ""
    return hexpart if _SHA256_HEX.match(hexpart) else None


def _fetch_validation(client: httpx.Client, auth: dict, assets: list[dict]) -> dict | None:
    """The published verdict from the release listing's validation.json, or
    None when it is not listed or does not parse."""
    asset = next((a for a in assets if a.get("name") == _VALIDATION_ASSET_NAME), None)
    if asset is None:
        return None
    resp = client.get(asset["url"], headers={**auth, "Accept": "application/octet-stream"}, timeout=30.0)
    resp.raise_for_status()
    return parse_validation(resp.content)


def _verify_published(client: httpx.Client, auth: dict, assets: list[dict], path: Path | str, *,
                      served: Path | str | None = None) -> dict | None:
    """Fetch the published verdict and bind it to `path`; any failure binds
    nothing (logged without its text: a URL can be signed)."""
    try:
        published = _fetch_validation(client, auth, assets)
        return bind_validation(published, path, served=served) if published is not None else None
    except Exception as exc:  # noqa: BLE001 — the verdict is optional; the database never waits on it
        log.warning("validation.json could not be verified (%s); the verdict reads unknown", public_error(exc))
        return None


def _poke_worker() -> None:
    from api import worker as worker_mod

    worker_mod.get_worker().poke()


def refresh_db(force: bool = False) -> bool:
    """Swap in the published database when its release asset has changed.
    Returns True when a new file was swapped into place. `force` downloads
    even when the identity matches (an operator's repair). Blocking — call at
    startup or via asyncio.to_thread from the event loop."""
    token = _token()
    _state["last_attempt_at"] = _now_iso()
    if not token:
        _state["last_result"] = "skipped"
        log.info("GH_DB_TOKEN not set — DB bootstrap skipped; serving the on-disk DB as-is")
        return False
    DB_PATH = db.DB_PATH

    auth = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "macro-regime-radar-api",
    }
    with httpx.Client(follow_redirects=True, timeout=30.0, transport=_transport) as client:
        # 1) resolve the current asset on data-latest (its id changes per upload)
        try:
            meta = client.get(
                f"{_GH_API_REPO}/releases/tags/data-latest",
                headers={**auth, "Accept": "application/vnd.github+json"},
            )
            meta.raise_for_status()
            assets = meta.json().get("assets", [])
        except Exception as exc:
            # a failed check is this attempt's result, never the last one's
            _state["last_result"] = "error"
            _state["last_error"] = public_error(exc)
            raise
        asset = next(
            (a for a in assets if a["name"] == _DB_ASSET_NAME),
            None,
        )
        if asset is None:
            _state["last_result"] = "no_asset"
            log.warning("data-latest release has no %s asset — keeping on-disk DB", _DB_ASSET_NAME)
            return False
        _state["asset_updated_at"] = asset.get("updated_at")
        _state["asset_size"] = asset.get("size")
        remote = asset_identity(asset)
        if not force and DB_PATH.exists() and _read_identity() == remote:
            _state["last_result"] = "unchanged"
            _state["last_error"] = None
            log.info("data-latest asset unchanged (id %s, updated %s): no download, no swap", remote.get("id"), remote.get("updated_at"))
            # S-01 (R-05): re-fetch the verdict while nothing held matches the current
            # asset (the listing's digest, else the file on disk), with no download
            held = validation_state()
            if held is None or held["db_sha256"] != (_asset_sha(asset) or sha256_file(DB_PATH)):
                _set_validation(_verify_published(client, auth, assets, DB_PATH))
            return False
        # 2) stream the bytes to a temp file beside DB_PATH, then swap atomically.
        #    httpx (like requests in the dashboard) drops the Authorization header
        #    on the cross-host redirect to the signed CDN URL, so no double-auth
        #    rejection there.
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(DB_PATH.parent), suffix=".db.tmp")
        os.close(fd)
        try:
            with client.stream(
                "GET",
                asset["url"],
                headers={**auth, "Accept": "application/octet-stream"},
                timeout=120.0,
            ) as dl, open(tmp, "wb") as out:
                dl.raise_for_status()
                for chunk in dl.iter_bytes(65536):
                    out.write(chunk)
            _validate_sqlite(tmp)
            # S-01: bind the published verdict to the new file's bytes and key, before the
            # swap (os.replace keeps the inode, mtime and size); held only once it is in place
            bound = _verify_published(client, auth, assets, tmp, served=DB_PATH)
            os.replace(tmp, DB_PATH)  # atomic swap into place
            _write_identity(remote)
            _set_validation(bound)
        except Exception as exc:
            _state["last_result"] = "error"
            _state["last_error"] = public_error(exc)
            raise
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    _state["last_result"] = "downloaded"
    _state["last_error"] = None
    _state["last_downloaded_at"] = _now_iso()
    log.info("DB snapshot downloaded from data-latest (%d bytes)", DB_PATH.stat().st_size)
    _poke_worker()  # build the new generation now, not at the next poll
    return True


def _redact(text: str, token: str) -> str:
    return text.replace(token, "***") if token else text


def _validate_sqlite(path: str) -> None:
    """Refuse to swap in a torn or empty download: header, quick_check, and
    the regimes table must all be present (last-known-good stays in place)."""
    import sqlite3

    with open(path, "rb") as fh:
        if fh.read(16) != b"SQLite format 3\x00":
            raise ValueError("downloaded file is not a SQLite database")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("downloaded database failed quick_check")
        n = conn.execute("SELECT COUNT(*) FROM regimes").fetchone()[0]
        if not n:
            raise ValueError("downloaded database has no regime rows")
    finally:
        conn.close()


async def periodic_refresh(interval_min: float) -> None:
    """Lifespan task: check the release every interval_min minutes and swap
    only when the asset changed (identity, not force). Single task, exceptions
    logged and swallowed (never fatal), cancelled on shutdown."""
    log.info("periodic DB refresh armed: every %.0f min", interval_min)
    while True:
        await asyncio.sleep(interval_min * 60.0)
        try:
            await asyncio.to_thread(refresh_db, False)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — no traceback: its text can carry a signed URL
            log.warning("periodic DB refresh failed (%s); will retry next interval", public_error(exc))
