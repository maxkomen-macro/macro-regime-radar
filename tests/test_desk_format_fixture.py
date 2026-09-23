"""The Desk's Python-format fixture is current (desk/frame-2, review R-03).

web/src/screens/desk/event-study/__fixtures__/py-format.json holds the strings
Python prints (the engine's fmt_move and Python's format) for the doubles the
page formats; web/src/screens/desk/pyformat.test.ts checks the TypeScript
formatters against it. If the engine's formatter or the saved payloads change,
this fails until scripts/desk_format_fixture.py is run again.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _script():
    spec = importlib.util.spec_from_file_location("desk_format_fixture", ROOT / "scripts/desk_format_fixture.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_the_python_format_fixture_matches_a_fresh_run():
    mod = _script()
    assert mod.OUT.read_text() == mod.render(), "run python scripts/desk_format_fixture.py"


def test_the_fixture_carries_exact_ties_that_toFixed_gets_wrong():
    mod = _script()
    bp = {repr(x): s for x, s in mod.build()["bp"]}
    assert bp["2.5"] == "+2 bp" and bp["3.5"] == "+4 bp" and bp["-0.0"] == "-0 bp"
