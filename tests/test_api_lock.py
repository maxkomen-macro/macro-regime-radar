"""The API image's lock covers requirements-api.txt (desk/integration, 2026-09-22).

scripts/lock_api_requirements.py walks a hand-kept ROOTS list, so a package
added to requirements-api.txt without a matching root never reaches
requirements-api.lock, and the image (which installs only the lock) fails at
import. desk/event-study added exchange_calendars this way. These tests pin
the three together: the script's roots are requirements-api.txt's packages,
and every root is pinned in the lock.

desk/hardening (review R-02, 2026-09-23): names alone let a broken lock pass
(`exchange_calendars==0.0.0` in place of 4.13.2, or `toolz` removed from under
it). The lock is now checked as what it claims to be, the tested closure of
requirements-api.txt: every requirement, the txt file's and each locked
package's own (markers evaluated here, extras followed), must be pinned, at a
version its specifier accepts; nothing outside that closure may be pinned; and
each pin must be the version installed in the environment the suite runs in,
since the lock is that environment's `pip freeze`. The closure is walked here
from the installed metadata, independently of the script, and the checks are
run against deliberately broken copies too, so a check that stopped checking
would fail.
"""

from __future__ import annotations

import importlib.metadata as md
import importlib.util
import re
from pathlib import Path

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import InvalidVersion, Version

ROOT = Path(__file__).resolve().parents[1]
TXT = ROOT / "requirements-api.txt"
LOCK = ROOT / "requirements-api.lock"


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
    assert roots == _requirement_names(TXT)


def test_every_api_requirement_is_pinned_in_the_lock():
    pinned = {_key(line.split("==", 1)[0]) for line in LOCK.read_text().splitlines()
              if "==" in line and not line.startswith("#")}
    missing = _requirement_names(TXT) - pinned
    assert not missing, f"in requirements-api.txt but not pinned in requirements-api.lock: {sorted(missing)}"


# ── R-02: versions and the closure ────────────────────────────────────────────

def _txt_requirements(text: str) -> list[Requirement]:
    reqs = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line and not line.startswith("-"):
            reqs.append(Requirement(line))
    return reqs


def _lock_pins(text: str) -> tuple[dict[str, str], list[str]]:
    """name → pinned version, and the problems of the file's own form."""
    pins: dict[str, str] = {}
    problems: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;#]+)", line)
        if m is None:
            problems.append(f"lock line is not an exact pin: {line!r}")
            continue
        name = canonicalize_name(m.group(1))
        try:
            Version(m.group(2))
        except InvalidVersion:
            problems.append(f"{name}: pinned to an invalid version {m.group(2)!r}")
            continue
        if name in pins:
            problems.append(f"{name}: pinned twice")
        pins[name] = m.group(2)
    return pins, problems


def _applies(req: Requirement, extras: set[str]) -> bool:
    if req.marker is None:
        return True
    env = default_environment()
    return any(req.marker.evaluate({**env, "extra": e}) for e in (extras or {""}))


def lock_problems(txt_text: str, lock_text: str) -> list[str]:
    """Everything wrong with `lock_text` as the tested closure of `txt_text`."""
    pins, problems = _lock_pins(lock_text)
    seen: dict[str, set[str]] = {}
    # the txt file's own markers too (verifier V-09): a platform-only line is not this platform's
    queue: list[tuple[Requirement, str]] = [(r, "requirements-api.txt") for r in _txt_requirements(txt_text) if _applies(r, set())]
    while queue:
        req, wanted_by = queue.pop(0)
        name = canonicalize_name(req.name)
        pin = pins.get(name)
        if pin is None:
            problems.append(f"{name}: required by {wanted_by} ({req}) but not pinned in the lock")
            continue
        if not req.specifier.contains(pin, prereleases=True):
            problems.append(f"{name}=={pin}: does not satisfy {wanted_by}'s requirement {req}")
        extras = {canonicalize_name(e) for e in req.extras}
        if name in seen and extras <= seen[name]:
            continue
        seen[name] = seen.get(name, set()) | extras
        try:
            installed = md.version(name)
        except md.PackageNotFoundError:
            problems.append(f"{name}=={pin}: pinned but not installed where the suite runs, so its closure is unchecked")
            continue
        if installed != pin:
            problems.append(f"{name}: pinned {pin} but the tested environment has {installed}")
            continue
        for raw in md.distribution(name).requires or []:
            dep = Requirement(raw)
            if _applies(dep, extras):
                queue.append((dep, f"{name}{'[' + ','.join(sorted(extras)) + ']' if extras else ''}"))
    for name in sorted(set(pins) - set(seen)):
        problems.append(f"{name}=={pins[name]}: pinned but outside requirements-api.txt's closure")
    return problems


def test_the_lock_is_the_tested_closure_of_the_api_requirements():
    """Every requirement in the closure pinned at a version it accepts, the
    installed one, and nothing else pinned."""
    problems = lock_problems(TXT.read_text(), LOCK.read_text())
    assert problems == [], "\n".join(problems)


def test_the_closure_matches_the_lock_script_walk():
    """The script that writes the lock and this test walk the same closure."""
    pins, _ = _lock_pins(LOCK.read_text())
    walked = {canonicalize_name(n) for n in _lock_script().closure()}
    assert walked == set(pins), (sorted(walked - set(pins)), sorted(set(pins) - walked))


def _mutated(**edits: str | None) -> str:
    """The real lock with named pins replaced (a new line) or removed (None)."""
    out = []
    for line in LOCK.read_text().splitlines():
        name = canonicalize_name(line.split("==", 1)[0]) if "==" in line and not line.startswith("#") else None
        if name in edits:
            if edits[name] is not None:
                out.append(edits[name])
            continue
        out.append(line)
    return "\n".join(out) + "\n"


def test_a_wrong_version_fails_the_check():
    """R-02's first case: the txt file pins exchange_calendars==4.13.2."""
    problems = lock_problems(TXT.read_text(), _mutated(**{"exchange-calendars": "exchange_calendars==0.0.0"}))
    assert any(p.startswith("exchange-calendars==0.0.0: does not satisfy requirements-api.txt") for p in problems), problems
    # the txt file's own range, too: riskfolio-lib is pinned to 7.3.x
    problems = lock_problems(TXT.read_text().replace("riskfolio-lib==7.3.*", "riskfolio-lib==7.4.*"), LOCK.read_text())
    assert any(p.startswith("riskfolio-lib==7.3.") and "riskfolio-lib==7.4.*" in p for p in problems), problems


def test_a_dependency_removed_from_under_a_root_fails_the_check():
    """R-02's second case: toolz is exchange_calendars' dependency, not a root."""
    assert "toolz" not in _requirement_names(TXT)
    problems = lock_problems(TXT.read_text(), _mutated(toolz=None))
    assert any(p.startswith("toolz: required by exchange-calendars") for p in problems), problems


def test_a_pin_outside_the_closure_or_not_the_tested_version_fails_the_check():
    lock = LOCK.read_text()
    stray = lock + "left-pad==1.0.0\n"
    assert any(p.startswith("left-pad==1.0.0: pinned but outside") for p in lock_problems(TXT.read_text(), stray))
    pins, _ = _lock_pins(lock)
    other = str(Version(pins["httpx"]).major + 1) + ".0.0"  # satisfies the bare `httpx`, but was not tested
    problems = lock_problems(TXT.read_text(), _mutated(httpx=f"httpx=={other}"))
    assert any(p == f"httpx: pinned {other} but the tested environment has {pins['httpx']}" for p in problems), problems
    problems = lock_problems(TXT.read_text(), lock + "httpx==" + pins["httpx"] + "\n")
    assert any(p == "httpx: pinned twice" for p in problems), problems
    assert any("not an exact pin" in p for p in lock_problems(TXT.read_text(), lock + "numpy>=1\n"))


def test_a_requirement_for_another_platform_is_not_required_here():
    """Verifier V-09: a txt line whose marker does not hold on this platform
    is not part of this closure, so it need not be pinned."""
    txt = TXT.read_text() + '\nnot-a-real-package ; sys_platform == "no-such-platform"\n'
    assert lock_problems(txt, LOCK.read_text()) == []
    txt = TXT.read_text() + '\nnot-a-real-package ; python_version >= "3"\n'
    assert any(p.startswith("not-a-real-package: required by requirements-api.txt") for p in lock_problems(txt, LOCK.read_text()))
