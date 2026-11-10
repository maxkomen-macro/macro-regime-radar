"""Verbatim copies of two files as they stood before the dividend-scenario fix, for same-process comparisons.

- `options_math_38916cb.py`: src/desk/options_math.py at 38916cb, before design S's smoothing.
- `fd_6b21304.py`: scripts/options_bench/fd.py at 6b21304, before D-2's ex-dividend obstacle.

Tests load them with `load`, which first checks each file's git blob id, so a copy cannot drift from its commit.
They are test references only: nothing outside tests imports them. A bit-identical guarantee is checked by running
the old and the current code in the same process, because a recorded float.hex value is specific to the platform's
numpy and libm."""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent


def blob_id(name: str) -> str:
    """The file's git blob id (what `git rev-parse <commit>:<path>` prints for the original)."""
    data = (HERE / name).read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def load(name: str, blob: str) -> ModuleType:
    """Import the frozen copy under a private module name, after checking that it is the expected blob."""
    got = blob_id(name)
    if got != blob:
        raise AssertionError(f"{name} is blob {got}, not the frozen {blob}")
    mod_name = f"_frozen_pre_dividend_fix_{Path(name).stem}"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    spec = importlib.util.spec_from_file_location(mod_name, HERE / name)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod   # dataclasses look the module up while the class body runs
    spec.loader.exec_module(mod)
    return mod
