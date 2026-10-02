"""tests/test_desk_contract.py — the contract helper's own tests (desk/frame-3-api, B1).

tests/desk_contract.py transcribes DESK_FRAME3_SPEC §12 into schemas. These
tests keep the transcription honest in both directions: a body built from the
schemas passes, and every declared field fails the check when it is removed,
nulled where the table allows no null, given a wrong type or joined by a key
outside the table. The block paths read off the schemas are §12.0's list, and
the frame-3 client's fixtures (web/src/fixtures/desk, from `DESK_WEB_SRC`
when this tree does not carry them) keep the contract as served.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any, Iterator

import pytest

from api import desk_envelope as env
from tests import desk_contract as dc

ROOT = Path(__file__).resolve().parent.parent
WEB_SRC = Path(os.environ.get("DESK_WEB_SRC", ROOT / "web" / "src"))
FIXTURES = WEB_SRC / "fixtures" / "desk"
LIVE = ("/overview", "/study", "/study/catalog", "/study/events", "/ledger", "/regime", "/technicals", "/macro", "/pipeline",
        "/sectors",  # /sectors served since desk/fill-etf (§12.14)
        "/basket/price", "/basket/hedge",  # desk/books
        "/instruments",  # desk/usability (§12.17)
        "/basket/shares")  # desk/cap-weight (§12.18)


def test_the_contract_covers_every_enveloped_route():
    assert tuple(dc.ROUTES) == LIVE == env.ENVELOPED_ROUTES[:env.LIVE_ROUTES]
    assert tuple(dc.STUBS) == env.ENVELOPED_ROUTES[env.LIVE_ROUTES:]


def test_the_block_paths_read_off_the_tables_are_section_12_0s():
    assert dc.nested_paths() == env.NESTED_PATHS


def test_the_csv_columns_are_the_specs():
    spec = (ROOT / "docs" / "desk" / "DESK_FRAME3_SPEC.md").read_text()
    assert f"`{','.join(dc.EVENTS_CSV_COLUMNS)}`" in spec


@pytest.mark.parametrize("route", LIVE)
@pytest.mark.parametrize("nulls", [False, True])
def test_a_body_built_from_the_tables_passes(route, nulls):
    dc.check(route, json.dumps(dc.example_envelope(route, nulls=nulls)))


@pytest.mark.parametrize("route", tuple(dc.STUBS))
def test_a_stub_answer_built_from_the_tables_passes(route):
    dc.check(route, dc.example_envelope(route))


# ── every field, mutated ────────────────────────────────────────────────────

def _sites(t: Any, path: tuple = ()) -> Iterator[tuple[tuple, Any]]:
    """(path into an example, declared field) for every field of a schema;
    arrays are followed at index 0, maps at the example's key, blocks through data."""
    if isinstance(t, dc.F):
        yield from _sites(t.t, path)
    elif isinstance(t, dc.Obj):
        for k, v in t.fields.items():
            yield path + (k,), v
            yield from _sites(v, path + (k,))
    elif isinstance(t, dc.Arr):
        yield from _sites(t.item, path + (0,))
    elif isinstance(t, dc.MapOf):
        yield from _sites(t.value, path + ("k",))
    elif isinstance(t, dc.Block):
        yield from _sites(t.data, path + ("data",))


def _at(root: Any, path: tuple) -> Any:
    for p in path:
        root = root[p]
    return root


def _mutated(route: str, path: tuple, change) -> dict:
    body = dc.example_envelope(route)
    parent = _at(body["data"], path[:-1])
    change(parent, path[-1])
    return body


WRONG = {dc.STR: 5, dc.INT: 1.5, dc.NUM: "1", dc.FRAC: 1.5, dc.BOOL: 1, dc.DATE: "2026-02-30",
         dc.MONTH: "2026-13", dc.TS: "2026-09-24T11:30:00"}


def _kind(field: Any) -> Any:
    return field.t if isinstance(field, dc.F) else field


@pytest.mark.parametrize("route", LIVE)
def test_every_field_is_required_typed_and_null_only_where_allowed(route):
    sites = list(_sites(dc.ROUTES[route]))
    assert sites
    for path, field in sites:
        name = ".".join(map(str, path))
        opt = isinstance(field, dc.F) and field.opt
        if not opt:
            body = _mutated(route, path, lambda p, k: p.pop(k))
            assert dc.problems(route, body), f"{route} {name}: removing it passed"
        if not (isinstance(field, dc.F) and field.null):
            body = _mutated(route, path, lambda p, k: p.__setitem__(k, None))
            assert dc.problems(route, body), f"{route} {name}: null passed"
        kind = _kind(field)
        if isinstance(kind, str):
            body = _mutated(route, path, lambda p, k: p.__setitem__(k, WRONG[kind]))
            assert dc.problems(route, body), f"{route} {name}: {WRONG[kind]!r} passed as a {kind}"
        elif isinstance(kind, (dc.Enum, dc.Const)):
            body = _mutated(route, path, lambda p, k: p.__setitem__(k, "zz-not-in-the-table"))
            assert dc.problems(route, body), f"{route} {name}: an unlisted value passed"
        elif isinstance(kind, (dc.Obj, dc.Block)):
            body = _mutated(route, path, _add_extra_key)
            assert dc.problems(route, body), f"{route} {name}: a key outside the table passed"


def _add_extra_key(parent: dict, key: str) -> None:
    """A key outside the table, on an object or on a ready block's data (on its
    first row when the data is an array, as /macro's correlations are)."""
    v = parent[key]
    target = v["data"] if set(v) == dc.BLOCK_KEYS else v
    (target[0] if isinstance(target, list) else target)["zz_extra"] = 1


def test_a_key_outside_the_table_fails_at_the_top_of_every_payload():
    for route in LIVE:
        body = dc.example_envelope(route)
        body["data"]["zz_extra"] = 1
        assert any("zz_extra: a key outside the table" in e for e in dc.problems(route, body)), route


def test_array_lengths_hold():
    body = dc.example_envelope("/study/catalog")
    body["data"]["studies"] = body["data"]["studies"][:14]
    assert dc.problems("/study/catalog", body)
    body = dc.example_envelope("/study")
    body["data"]["last_events"] = body["data"]["last_events"] * 6
    assert dc.problems("/study", body)


def test_deferred_blocks_are_never_ready_and_keep_their_sentence():
    body = dc.example_envelope("/technicals")
    body["data"]["vol"] = {"status": "ready", "data": {"atm_iv_1m": 0.2}, "unavailable": None}
    assert dc.problems("/technicals", body)
    body = dc.example_envelope("/technicals")
    body["data"]["vol"]["unavailable"]["reason"] = "some other words"
    assert dc.problems("/technicals", body)


def test_a_block_envelope_outside_the_listed_paths_fails():
    body = dc.example_envelope("/overview")
    body["data"]["tiles"] = {"status": "ready", "data": body["data"]["tiles"], "unavailable": None}
    assert any("block envelope's keys" in e for e in dc.problems("/overview", body))


def test_an_awaiting_block_carries_a_reason_and_no_data():
    body = dc.example_envelope("/regime")
    body["data"]["current"] = {"status": "awaiting", "data": None, "unavailable": {"reason": "no stored regime row for 2026-07", "until": None}}
    assert not dc.problems("/regime", body)
    for broken in ({"status": "awaiting", "data": {"label": "x"}, "unavailable": {"reason": "r", "until": None}},
                   {"status": "awaiting", "data": None, "unavailable": {"reason": " ", "until": None}},
                   {"status": "awaiting", "data": None, "unavailable": None},
                   {"status": "ready", "data": None, "unavailable": None},
                   {"status": "computing", "data": None, "unavailable": None}):
        body["data"]["current"] = broken
        assert dc.problems("/regime", body), broken


# ── the envelope (§12.0) ────────────────────────────────────────────────────

def _env(**over) -> dict:
    return {**dc.example_envelope("/ledger"), **over}


@pytest.mark.parametrize("broken", [
    {"status": "done"},
    {"generation_id": None},                                     # a ready answer names its generation
    {"as_of": None},                                             # generation_id and as_of go together
    {"as_of": "2026-09-31"},
    {"engine_version": ""},
    {"unavailable": {"reason": "r", "until": None}},             # only when awaiting
    {"error": {"code": "c", "message": "m"}},                    # only when an error
    {"status": "awaiting", "unavailable": {"reason": "r", "until": None}},  # data still served
    {"status": "computing", "data": None},                       # a computing answer names no generation
    {"status": "error", "data": None, "error": {"code": "", "message": "m"}},
    {"status": "error", "data": None, "error": {"code": "c", "message": "m", "detail": "x"}},
    {"status": "error", "data": None, "error": {"code": "c"}},
    # S-28 / R-16: provider and retryable ride only on schema_check, exactly as "api" and true
    {"status": "error", "data": None, "error": {"code": "internal", "message": "m", "retryable": True, "provider": "api"}},
    {"status": "error", "data": None, "error": {"code": "unsupported", "message": "m", "provider": "api"}},
    {"status": "error", "data": None, "error": {"code": "schema_check", "message": "m"}},
    {"status": "error", "data": None, "error": {"code": "schema_check", "message": "m", "retryable": True}},
    {"status": "error", "data": None, "error": {"code": "schema_check", "message": "m", "retryable": False, "provider": "api"}},
    {"status": "error", "data": None, "error": {"code": "schema_check", "message": "m", "retryable": True, "provider": "x"}},
    {"status": "error", "data": None, "error": {"code": "schema_check", "message": "m", "retryable": True, "provider": "api", "kind": "schema_check"}},
])
def test_the_envelope_state_rules(broken):
    assert dc.problems("/ledger", _env(**broken)), broken


def test_the_envelope_answers_that_hold():
    assert not dc.problems("/ledger", _env(status="computing", data=None, generation_id=None, as_of=None))
    assert not dc.problems("/ledger", _env(status="error", data=None, error={"code": "c", "message": "m"}))
    assert not dc.problems("/ledger", _env(status="error", data=None, generation_id=None, as_of=None,
                                           error={"code": "schema_check", "message": "m", "retryable": True, "provider": "api"}))
    assert not dc.problems("/ledger", _env(status="awaiting", data=None, unavailable={"reason": "r", "until": "2026-10-01"}))
    body = _env()
    del body["error"]
    assert dc.problems("/ledger", body)
    assert dc.problems("/ledger", {**_env(), "extra": 1})


def test_no_nan_or_infinity_on_the_wire_or_in_a_value():
    raw = json.dumps(dc.example_envelope("/technicals")).replace('"price": 1.5', '"price": NaN')
    assert "NaN" in raw and dc.problems("/technicals", raw)
    body = dc.example_envelope("/technicals")
    body["data"]["price"] = float("inf")
    assert dc.problems("/technicals", body)
    with pytest.raises(AssertionError):
        dc.check("/technicals", raw)


@pytest.mark.parametrize(("tag", "good", "bad"), [
    (dc.DATE, ["2026-09-23", "2024-02-29"], ["2026-9-23", "2026-02-30", "2025-02-29", "20260923", "2026-09-23T00:00:00Z"]),
    (dc.MONTH, ["2026-07", "2026-12"], ["2026-7", "2026-13", "2026-00", "2026-07-01"]),
    (dc.TS, ["2026-09-24T11:30:00Z", "2026-09-24T11:30:00.123+00:00", "2026-09-24T07:30:00-04:00"],
     ["2026-09-24T11:30:00", "2026-09-24 11:30:00Z", "2026-09-24"]),
])
def test_the_date_formats(tag, good, bad):
    assert all(dc._scalar_ok(tag, v) for v in good)
    assert not any(dc._scalar_ok(tag, v) for v in bad)


def test_fractions_and_integers_are_what_they_say():
    assert dc._scalar_ok(dc.FRAC, 0) and dc._scalar_ok(dc.FRAC, 1.0) and not dc._scalar_ok(dc.FRAC, 1.0001)
    assert not dc._scalar_ok(dc.INT, True) and not dc._scalar_ok(dc.NUM, False) and dc._scalar_ok(dc.NUM, -3)


# ── the frame-3 client's fixtures ───────────────────────────────────────────

FIXTURE_FILES = {"/overview": "overview.json", "/study": "study.json", "/study/catalog": "study-catalog.json",
                 "/study/events": "study-events.json", "/ledger": "ledger.json", "/regime": "regime.json",
                 "/technicals": "technicals.json", "/macro": "macro.json", "/pipeline": "pipeline.json",
                 "/sectors": "sectors.json",  # desk/fill-etf
                 "/basket/price": "basket-price.json", "/basket/hedge": "basket-hedge.json",  # desk/books
                 "/instruments": "instruments.json",  # desk/usability
                 "/basket/shares": "basket-shares.json"}  # desk/cap-weight


def _wire(route: str, payload: dict) -> dict:
    """What the client's fixture server puts on the wire (envelope.ts readyEnvelope):
    the payload's as_of and generation_id move to the envelope, its block paths are wrapped."""
    payload = copy.deepcopy(payload)
    meta = {"generation_id": payload.pop("generation_id", "gen-fixture"), "as_of": payload.pop("as_of", "2026-09-24")}
    for path in env.NESTED_PATHS.get(route, ()):
        *parents, key = path.split(".")
        at = payload
        for p in parents:
            at = at.get(p) if isinstance(at, dict) else None
        if isinstance(at, dict) and key in at and not (isinstance(at[key], dict) and set(at[key]) == dc.BLOCK_KEYS):
            at[key] = {"status": "ready", "data": at[key], "unavailable": None}
    return {"status": "ready", **meta, "engine_version": "fixture", "data": payload, "unavailable": None, "error": None}


# desk/books: a basket route's fixture holds one answer per request the page makes (`answers`).
MULTI = {"/basket/price", "/basket/hedge"}


@pytest.mark.parametrize("route", LIVE)
def test_the_clients_fixtures_keep_the_contract(route):
    f = FIXTURES / FIXTURE_FILES[route]
    if not f.exists():
        pytest.skip(f"no frame-3 fixtures at {FIXTURES} (set DESK_WEB_SRC to a web/src that carries them)")
    doc = json.loads(f.read_text())
    payloads = list(doc["answers"].values()) if route in MULTI else [doc]
    assert payloads, f"{f.name} carries no answer"
    for payload in payloads:
        dc.check(route, json.dumps(_wire(route, payload)))
