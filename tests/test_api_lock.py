"""The API image's lock covers requirements-api.txt (desk/integration, 2026-09-22).

scripts/lock_api_requirements.py walks a hand-kept ROOTS list, so a package
added to requirements-api.txt without a matching root never reaches
requirements-api.lock, and the image (which installs only the lock) fails at
import. desk/event-study added exchange_calendars this way. These tests pin
the three together: the script's roots are requirements-api.txt's packages,
and every root is pinned in the lock.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _key(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _requirement_names(path: Path) -> set[str]:
    names = set()
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        names.add(_key(re.split(r"[\[<>=!~ ;]", line, maxsplit=1)[0]))
    return names


def _lock_script():
    spec = importlib.util.spec_from_file_location("lock_api_requirements", ROOT / "scripts" / "lock_api_requirements.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_lock_script_roots_are_the_api_requirements():
    roots = {_key(name) for name, _ in _lock_script().ROOTS}
    assert roots == _requirement_names(ROOT / "requirements-api.txt")


def test_every_api_requirement_is_pinned_in_the_lock():
    pinned = {_key(line.split("==", 1)[0]) for line in (ROOT / "requirements-api.lock").read_text().splitlines()
              if "==" in line and not line.startswith("#")}
    missing = _requirement_names(ROOT / "requirements-api.txt") - pinned
    assert not missing, f"in requirements-api.txt but not pinned in requirements-api.lock: {sorted(missing)}"
