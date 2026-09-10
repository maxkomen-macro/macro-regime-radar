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
- BOOTSTRAP_DB_MAX_AGE_MIN  if set, a startup DB older than this many minutes
                            is re-downloaded; unset → download only when the
                            DB file is missing.
- BOOTSTRAP_DB_REFRESH_MIN  if > 0, a lifespan task re-downloads every N
                            minutes (default 0 = disabled).
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time

import httpx

from datetime import datetime, timezone

from api.db import DB_PATH

log = logging.getLogger("mrr.bootstrap")

# Last-attempt ledger for /api/freshness and /health/ready — never a token.
_state: dict = {
    "token_configured": False,
    "last_attempt_at": None,
    "last_result": None,  # downloaded | skipped | no_asset | error
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


def _token() -> str:
    return os.environ.get("GH_DB_TOKEN", "")


def refresh_interval_min() -> float:
    """BOOTSTRAP_DB_REFRESH_MIN as a float, 0 (disabled) on unset/garbage."""
    raw = os.environ.get("BOOTSTRAP_DB_REFRESH_MIN", "0")
    try:
        return max(0.0, float(raw))
    except ValueError:
        log.warning("BOOTSTRAP_DB_REFRESH_MIN=%r is not a number — refresh disabled", raw)
        return 0.0


def _max_age_min() -> float | None:
    """BOOTSTRAP_DB_MAX_AGE_MIN as a float, None (only-if-missing) on unset/garbage."""
    raw = os.environ.get("BOOTSTRAP_DB_MAX_AGE_MIN")
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning("BOOTSTRAP_DB_MAX_AGE_MIN=%r is not a number — treating as unset", raw)
        return None


def _should_download() -> bool:
    if not DB_PATH.exists():
        return True
    max_age = _max_age_min()
    if max_age is None:
        return False  # default: only-if-missing
    age_min = (time.time() - DB_PATH.stat().st_mtime) / 60.0
    return age_min > max_age


def refresh_db(force: bool = False) -> bool:
    """Download the latest snapshot into DB_PATH if warranted. Returns True
    when a new file was swapped into place. Blocking — call at startup or via
    asyncio.to_thread from the event loop."""
    token = _token()
    _state["last_attempt_at"] = _now_iso()
    if not token:
        _state["last_result"] = "skipped"
        log.info("GH_DB_TOKEN not set — DB bootstrap skipped; serving the on-disk DB as-is")
        return False
    if not force and not _should_download():
        _state["last_result"] = "skipped"
        log.info("DB present and within freshness policy — bootstrap download skipped")
        return False

    auth = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "macro-regime-radar-api",
    }
    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        # 1) resolve the current asset on data-latest (its id changes per upload)
        meta = client.get(
            f"{_GH_API_REPO}/releases/tags/data-latest",
            headers={**auth, "Accept": "application/vnd.github+json"},
        )
        meta.raise_for_status()
        asset = next(
            (a for a in meta.json().get("assets", []) if a["name"] == _DB_ASSET_NAME),
            None,
        )
        if asset is None:
            _state["last_result"] = "no_asset"
            log.warning("data-latest release has no %s asset — keeping on-disk DB", _DB_ASSET_NAME)
            return False
        _state["asset_updated_at"] = asset.get("updated_at")
        _state["asset_size"] = asset.get("size")
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
            os.replace(tmp, DB_PATH)  # atomic swap into place
        except Exception as exc:
            _state["last_result"] = "error"
            _state["last_error"] = _redact(repr(exc), token)
            raise
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    _state["last_result"] = "downloaded"
    _state["last_error"] = None
    _state["last_downloaded_at"] = _now_iso()
    log.info("DB snapshot downloaded from data-latest (%d bytes)", DB_PATH.stat().st_size)
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
    """Lifespan task: re-download every interval_min minutes. Single task,
    exceptions logged and swallowed (never fatal), cancelled on shutdown."""
    log.info("periodic DB refresh armed: every %.0f min", interval_min)
    while True:
        await asyncio.sleep(interval_min * 60.0)
        try:
            await asyncio.to_thread(refresh_db, True)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("periodic DB refresh failed — will retry next interval")
