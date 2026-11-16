"""Phase 4a's registered population (docs/desk/OPTIONS_PHASE4A.md, section 1): the registration record matches the
generator, the reserved seed stays untouched, and a request depends only on (seed, index)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.options_bench.phase4a import population as pop

REPO = Path(__file__).resolve().parent.parent
REG = json.loads((REPO / "scripts" / "options_bench" / "phase4a" / "registration.json").read_text())


def test_the_registration_record_is_the_generator_s_spec_seeds_and_code():
    now = pop.registration()
    assert REG["spec"] == json.loads(json.dumps(pop.SPEC))
    assert REG["spec_sha256"] == now["spec_sha256"]
    assert REG["generator_sha256"] == hashlib.sha256(Path(pop.__file__).read_bytes()).hexdigest()
    assert (REG["dev_seed"], REG["reserved_seed"]) == (pop.DEV_SEED, pop.RESERVED_SEED) == (20261116, 20261117)


def test_the_reserved_population_is_never_generated_by_default():
    with pytest.raises(PermissionError):
        pop.request(pop.RESERVED_SEED, 0)
    with pytest.raises(PermissionError):
        next(pop.requests(pop.RESERVED_SEED, 1))


def test_a_request_depends_only_on_its_seed_and_index():
    a = pop.request(pop.DEV_SEED, 3)
    b = next(r for i, r in enumerate(pop.requests(pop.DEV_SEED, 4)) if i == 3)
    assert a.params == b.params
    assert a.rows == b.rows and a.other_rows == b.other_rows and a.dividends == b.dividends


def test_the_requests_are_synthetic_and_well_formed():
    r = pop.request(pop.DEV_SEED, 0)
    assert r.rows and all(row["contract"].startswith("P000") for row in r.rows + r.other_rows)
    assert all(0.01 <= row["bid"] <= row["ask"] for row in r.rows)
    kind = "call" if r.params["view"] == "up" else "put"
    assert {row["type"] for row in r.rows} == {kind}
