"""api/analytics_cache.py — the database-derived results the API serves, built
by the background worker (api/worker.py) and looked up by the handlers.

The source computations stay in src/analytics/ (nothing quantitative is
ported); this module (a) lists them as worker ITEMS, each a function of the
generation being built, and (b) converts pandas/numpy members into
JSON-serializable structures. Handlers call the get_* accessors, which only
read the published generation: they never compute (fix/prelaunch-1).

Until this branch the results sat in TTL caches that outlived a database swap
by up to an hour (B-H1). A generation is keyed on the database file key
instead, so a swap produces a new generation with every result rebuilt from
the new file, and the old results are never served beside the new data.

Every analytics module reads through src/analytics/dbpath.py, which routes the
worker's reads to the copy it is building. allocation.py computes from the
stored price histories and never downloads (AssetHistoriesNotStored on a
database that predates them).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


# ── JSON conversion ───────────────────────────────────────────────────────────

def jsonable(obj: Any) -> Any:
    """Recursively convert pandas/numpy members to JSON-safe structures.

    - Series on a DatetimeIndex → [{"date": "YYYY-MM-DD", "value": float}]
    - Series on any other index → {str(key): value}
    - DataFrame → {"index": [...], "columns": [...], "data": [[...]]}
    - numpy scalars/arrays → Python scalars/lists; NaN/inf → None
    """
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.ndarray):
        return [jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, pd.Series):
        if isinstance(obj.index, pd.DatetimeIndex):
            return [
                {"date": idx.strftime("%Y-%m-%d"), "value": jsonable(v)}
                for idx, v in obj.items()
                if pd.notna(v)
            ]
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, pd.DataFrame):
        return {
            "index": [jsonable(i) if not isinstance(i, str) else i for i in obj.index],
            "columns": [str(c) for c in obj.columns],
            "data": [[jsonable(v) for v in row] for row in obj.to_numpy().tolist()],
        }
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    return str(obj)


# ── worker items (fix/prelaunch-1) ───────────────────────────────────────────
# Each item takes the build context (the results computed so far in this
# generation, plus "credit_raw") and returns its JSON-safe payload. An item
# that raises stores that error as its answer; the rest of the generation
# still builds.

REGIMES = ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")


from api.db import NotStored  # noqa: E402  (re-exported for the handlers)


def _label() -> str:
    from api import db

    row = db.latest_regime()
    return row["label"] if row else "Goldilocks"


def _credit(ctx: dict) -> dict:
    from src.analytics.credit import get_credit_metrics

    raw = get_credit_metrics()
    ctx["credit_raw"] = raw  # takeaway and analogues take the pandas members
    return jsonable(raw)


def _recession(ctx: dict) -> dict:
    from api.recession_cache import _to_jsonable
    from src.analytics.recession import get_recession_metrics

    return _to_jsonable(get_recession_metrics())


def _recession_model(ctx: dict):
    from src.analytics.recession import train_recession_model

    return train_recession_model()


def _lbo_defaults(ctx: dict) -> dict:
    from src.analytics.lbo import get_lbo_defaults

    return get_lbo_defaults()


def _rec_prob(ctx: dict) -> float | None:
    rec = ctx.get("recession")
    return rec.get("recession_prob") if isinstance(rec, dict) else None


def _takeaway(ctx: dict) -> dict:
    """generate_market_takeaway with its inputs assembled exactly the way the
    Streamlit Intelligence tab assembles them (probs, label, credit metrics,
    recession-model probability)."""
    from api import db
    from src.analytics.intelligence import generate_market_takeaway
    from src.analytics.regimes import get_current_regime_probs

    credit, rec_prob = ctx.get("credit_raw"), _rec_prob(ctx)
    if credit is None or rec_prob is None:
        # Never narrate a fabricated 0% — degrade to 503 instead.
        raise db.DBUnavailable("Recession model has no data — takeaway unavailable.")
    probs = get_current_regime_probs()
    label = _label()
    out = generate_market_takeaway(probs, label, credit, rec_prob)
    out["regime_probs"] = probs
    out["current_regime"] = label
    return jsonable(out)


def _duration(ctx: dict) -> dict:
    from src.analytics.intelligence import get_regime_duration

    return jsonable(get_regime_duration())


def _transitions(ctx: dict) -> dict:
    from src.analytics.intelligence import get_transition_narrative

    return jsonable(get_transition_narrative(_label()))


def _analogues(ctx: dict) -> list:
    """find_historical_analogues fed with the same live inputs the Streamlit
    tab uses: current regime, HY-spread percentile, recession-model prob."""
    from api import db
    from src.analytics.intelligence import find_historical_analogues

    credit, rec_prob = ctx.get("credit_raw"), _rec_prob(ctx)
    hy_pct = credit.get("hy_pct_rank") if credit else None
    if rec_prob is None or hy_pct is None:
        # The similarity scores are meaningless without their live inputs —
        # never substitute a median and caption it as measured.
        raise db.DBUnavailable("Analogue inputs unavailable (credit percentile / recession model).")
    return jsonable(find_historical_analogues(_label(), hy_pct, rec_prob, 4))


def _playbooks(ctx: dict) -> dict:
    """All four static regime playbooks in one payload (reference content —
    the client's selector switches without a refetch)."""
    from src.analytics.intelligence import get_regime_playbook

    return {r: jsonable(get_regime_playbook(r)) for r in REGIMES}


def _scenario_defs(ctx: dict) -> list:
    """The five prebuilt scenario definitions, key included."""
    from src.analytics.intelligence import SCENARIOS

    return [{"key": k, **jsonable(v)} for k, v in SCENARIOS.items()]


ALLOCATION_TIMEOUT_S = 300.0


class _AllocationInChild:
    """get_allocation_data() over the stored price histories, in a spawned
    child process (api/allocation_child.py): its numerical libraries hold the
    GIL long enough to stall the server's event loop, and a child has its own.
    An async item: the worker starts it before the rest of the generation and
    collects it last, so the child's imports overlap the other items."""

    def start(self, ctx: dict):
        import multiprocessing
        import os
        import sqlite3
        import tempfile

        from api import allocation_child
        from api import db
        from src.analytics import dbpath

        fd, snap = tempfile.mkstemp(prefix="mrr-allocation-", suffix=".db")
        os.close(fd)
        gen = dbpath.pinned_generation()
        dst = sqlite3.connect(snap)
        try:
            if gen is not None and getattr(gen, "anchor", None) is not None:
                gen.anchor.backup(dst)  # the generation's own copy, not the file on disk now
            else:
                src = sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)
                try:
                    src.backup(dst)
                finally:
                    src.close()
        finally:
            dst.close()
        mp = multiprocessing.get_context("spawn")
        parent, child = mp.Pipe(duplex=False)
        proc = mp.Process(target=allocation_child.run, args=(snap, child), name="mrr-allocation", daemon=True)
        proc.start()
        child.close()
        return proc, parent, snap

    def finish(self, handle) -> dict:
        import os

        proc, conn, snap = handle
        try:
            if not conn.poll(ALLOCATION_TIMEOUT_S):
                proc.terminate()
                raise TimeoutError(f"allocation did not finish within {ALLOCATION_TIMEOUT_S:.0f} s")
            out = conn.recv()
        finally:
            conn.close()
            proc.join(10)
            if proc.is_alive():
                proc.kill()
            try:
                os.remove(snap)
            except OSError:
                pass
        if "not_stored" in out:
            raise NotStored(out["not_stored"])
        if "error" in out:
            raise RuntimeError(f"allocation failed in its child process: {out['error']}")
        return out["payload"]

    def cancel(self, handle) -> None:
        import os

        proc, conn, snap = handle
        proc.terminate()
        proc.join(5)
        conn.close()
        try:
            os.remove(snap)
        except OSError:
            pass

    def __call__(self, ctx: dict) -> dict:
        return self.finish(self.start(ctx))


_allocation = _AllocationInChild()


ITEMS = [
    ("credit", _credit),
    ("recession", _recession),
    ("recession_model", _recession_model),
    ("lbo_defaults", _lbo_defaults),
    ("duration", _duration),
    ("transitions", _transitions),
    ("takeaway", _takeaway),
    ("analogues", _analogues),
    ("playbooks", _playbooks),
    ("scenario_defs", _scenario_defs),
    ("allocation", _allocation),
]


# ── accessors (handlers): look up, never compute ─────────────────────────────

def _result(name: str):
    from api.worker import get_worker

    return get_worker().result(name)


def get_cached_credit_metrics() -> dict:
    return _result("credit")


def get_cached_takeaway() -> dict:
    return _result("takeaway")


def get_cached_duration() -> dict:
    return _result("duration")


def get_cached_transitions() -> dict:
    return _result("transitions")


def get_cached_analogues() -> list[dict]:
    return _result("analogues")


def get_playbooks() -> dict:
    return _result("playbooks")


def get_scenario_defs() -> list[dict]:
    return _result("scenario_defs")


def get_lbo_defaults() -> dict:
    return _result("lbo_defaults")


def get_cached_allocation() -> dict:
    return _result("allocation")


def run_scenario_cached_inputs(
    scenario_key: str | None, custom_shocks: dict | None
) -> dict:
    """The scenario stress POST is a calculator over the visitor's shocks: it
    reads the latest stored probabilities (from the published generation) and
    does arithmetic, so it has nothing to precompute."""
    from src.analytics.intelligence import run_scenario

    return jsonable(run_scenario(scenario_key=scenario_key, custom_shocks=custom_shocks))
