"""api/desk_items.py — the Desk v2 worker items (desk/frame-3-api, B1).

Every /study-family answer is a lookup (docs/desk/FRAME3_API_PLAN.md §0.2):
each query-backed catalog study is a worker item, `desk_study:<slug>`,
rebuilt with every generation (api/analytics_cache.ITEMS registers them). A
builder returns one of three values (plan §1.0):

- `{"ok": True, "native": <the unchanged run() dict>, "events": EventTable,
  "trace": SignalTrace, "pre1970": {input_key: N}}`;
- `{"ok": False, "kind": "not_stored", "reason", "series"}`: an input the
  store does not hold (the engine's NotStored, in its words);
- `{"ok": False, "kind": "study_error", "reason", "series": None}`: the
  engine's StudyError, e.g. "no evaluable session".

Both refusals are values, so they never hold a generation back; any other
exception propagates and is stored as the item's error.

`native` is what `es.run(query)` returns for the same generation and as-of,
byte for byte: the builder opens the connection `run` would and passes the
same generation key and cutoff, so api/analytics_cache's presets may reuse it.
The connection is closed on every path. Every heavy import is lazy.
"""

from __future__ import annotations

from typing import Any, Callable

from api import desk_catalog


def desk_study(slug: str) -> Callable[[dict], dict]:
    """The worker item for one catalog study."""
    study = desk_catalog.BY_SLUG[slug]
    kwargs = study.engine_kwargs
    if kwargs is None:
        raise ValueError(f"{slug} has no engine query")

    def build(ctx: dict) -> dict:
        from src.analytics import dbpath
        from src.desk import event_study as es

        q = es.Query(**kwargs)
        cutoff = es.resolve_as_of(None, es.DB_PATH)
        conn = es._connect(es.DB_PATH)
        try:
            try:
                native, table, trace = es.run_on_traced(conn, q, generation=dbpath.current_key(es.DB_PATH), as_of=cutoff)
            except es.NotStored as exc:
                return {"ok": False, "kind": "not_stored", "reason": str(exc), "series": exc.series}
            except es.StudyError as exc:
                return {"ok": False, "kind": "study_error", "reason": str(exc), "series": None}
            pre1970 = pre1970_counts(conn, native, trace, cutoff)
        finally:
            conn.close()
        return {"ok": True, "native": native, "events": table, "trace": trace, "pre1970": pre1970}

    build.__name__ = f"_desk_study_{slug.replace('-', '_')}"
    return build


def pre1970_counts(conn: Any, native: dict, trace: Any, cutoff: str) -> dict[str, int]:
    """Plan §1.2 (round 4's R-10): for each input whose stored history starts
    before 1970-01-01, the dates the engine counts as calendar sessions without
    a value that are NYSE holidays: an api/calendar holiday before 1970, inside
    the input's stored range, a session of the study's own calendar, and a date
    on which the input has no stored value. Empty for every other study."""
    from api.calendar import HOLIDAYS
    from src.desk import event_study as es
    from src.desk import series as registry

    out: dict[str, int] = {}
    sessions = set(trace.sessions)
    for m in native["provenance"]["inputs"]:
        first, last = m["history_from"], m["last"]
        if first >= "1970-01-01" or not m["missing_sessions"]:
            continue
        stored = set(es.load_level(conn, registry.get(m["key"]), cutoff).index.strftime("%Y-%m-%d"))
        n = sum(1 for year, days in HOLIDAYS.items() if year < 1970 for d in days
                if first <= d.isoformat() <= last and d.isoformat() in sessions and d.isoformat() not in stored)
        if n:
            out[m["key"]] = n
    return out
