"""api/allocation_child.py — allocation, computed in a child process
(fix/prelaunch-1).

The background worker builds allocation in a spawned process instead of a
thread of the API server. Its numerical libraries (SciPy's SLSQP, riskfolio,
cvxpy, pandas) hold the GIL for tens of milliseconds at a time; in the
server's own process that stalled the event loop (measured: /health/live up
to 1.1 s during a rebuild). A separate interpreter has its own GIL.

The child reads a snapshot file of the generation being built (written by the
parent from the generation's in-memory copy), so it sees exactly the data
every other result of that generation came from. It never touches the
network: allocation reads the stored price histories.
"""

from __future__ import annotations

import contextlib
import io
from pathlib import Path


def compute(snapshot_path: str) -> dict:
    """The JSON-safe allocation payload for one snapshot file, or
    {"not_stored": message} for a database that predates the histories."""
    import src.analytics.allocation as al
    from api.analytics_cache import jsonable

    al.DB_PATH = Path(snapshot_path)  # this process exists for this one computation
    log = io.StringIO()
    try:
        with contextlib.redirect_stdout(log):
            payload = jsonable(al.get_allocation_data())
    except al.AssetHistoriesNotStored as exc:
        return {"not_stored": str(exc)}
    return {"payload": payload, "log": log.getvalue()[-4000:]}


def run(snapshot_path: str, conn) -> None:
    """Process target: send compute()'s answer (or the error) up the pipe. The
    error keeps its type and, for a missing package, the package's name, so
    the server can still answer "dependency missing: <name>"."""
    try:
        conn.send(compute(snapshot_path))
    except BaseException as exc:  # noqa: BLE001 — the parent turns it into the item's error
        conn.send({"error": f"{type(exc).__name__}: {exc}", "type": type(exc).__name__,
                   "module": getattr(exc, "name", None) if isinstance(exc, ImportError) else None})
    finally:
        conn.close()
