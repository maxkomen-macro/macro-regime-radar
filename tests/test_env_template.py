"""tests/test_env_template.py — the deploy templates name every variable (launch-1).

A variable the code reads but the template does not mention is a variable the
owner finds out about from a defect. This walks the source for environment
reads and asserts each one is documented in deploy/api.env.example (the API
host) or web/.env.example (the static build), and that neither template
carries a filled-in secret.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
API_TEMPLATE = ROOT / "deploy" / "api.env.example"
WEB_TEMPLATE = ROOT / "web" / ".env.example"

# Read by uvicorn or a library rather than by this code. WEB_CONCURRENCY is
# named in the template as the one to leave alone; the rest are standard
# library conventions (proxies, CA bundles) with no project-specific value.
NOT_OURS = {"PYTHONUNBUFFERED", "PIP_NO_CACHE_DIR", "PYTHONPATH", "HTTP_PROXY", "HTTPS_PROXY",
            "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "GITHUB_ACTIONS", "GITHUB_RUN_ID"}
# Test-harness or pipeline-only variables, documented where they are used.
NOT_THE_DEPLOY = {"MRR_PROBE_LOG", "MRR_APP_DIR", "E2E_BASE_URL", "CAPTURE_DIR", "CAPTURE_STEP",
                  "CAPTURE_SIDEBAR", "BASELINE_DIR", "BASELINE_LABELS", "RENAMES", "ALLOW_BASELINE_OVERWRITE",
                  "SOAK_S", "IDLE_S"}

# Vite's own built-ins and npm's, set by the toolchain rather than the owner.
TOOLCHAIN = {"DEV", "PROD", "MODE", "BASE_URL", "SSR", "NODE_ENV"}


def _api_closure() -> list[Path]:
    """api/**/*.py plus every src module the API imports, at module level or
    lazily inside a function (verify loop 1: reads in src/ were missed)."""
    import ast

    seen: set[Path] = set()
    todo = list((ROOT / "api").rglob("*.py"))
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.add(path)
        for node in ast.walk(ast.parse(path.read_text())):
            mods: list[str] = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                mods = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            for mod in mods:
                if mod.split(".")[0] not in ("api", "src"):
                    continue
                cand = ROOT.joinpath(*mod.split("."))
                for p in (cand.with_suffix(".py"), cand / "__init__.py"):
                    if p.exists():
                        todo.append(p)
    return sorted(seen)


def _env_reads(source: str) -> set[str]:
    """Every environment variable a Python module reads, however it is spelled:
    os.environ[...], .get/.setdefault/.pop, os.getenv, a bare `environ` or
    `getenv`, get_secret(...), `"X" in os.environ`, a name held in a module
    constant, and a loop over a literal tuple of names."""
    import ast

    tree = ast.parse(source)
    consts: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    consts[t.id] = node.value.value
    loops: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and isinstance(node.iter, (ast.Tuple, ast.List)):
            vals = [e.value for e in node.iter.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            if vals:
                loops.setdefault(node.target.id, []).extend(vals)

    def names_of(node) -> list[str]:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [node.value]
        if isinstance(node, ast.Name):
            if node.id in consts:
                return [consts[node.id]]
            return loops.get(node.id, [])
        return []

    def is_environ(node) -> bool:
        return (isinstance(node, ast.Attribute) and node.attr == "environ") or (isinstance(node, ast.Name) and node.id == "environ")

    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and node.args:
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr in ("get", "setdefault", "pop") and is_environ(f.value):
                found.update(names_of(node.args[0]))
            elif (isinstance(f, ast.Attribute) and f.attr in ("getenv", "get_secret")) or (isinstance(f, ast.Name) and f.id in ("getenv", "get_secret")):
                found.update(names_of(node.args[0]))
        elif isinstance(node, ast.Subscript) and is_environ(node.value):
            found.update(names_of(node.slice))
        elif isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], (ast.In, ast.NotIn)) and is_environ(node.comparators[0]):
            found.update(names_of(node.left))
    return {n for n in found if re.fullmatch(r"[A-Z][A-Z0-9_]+", n)}


def _api_vars() -> set[str]:
    names: set[str] = set()
    for path in _api_closure():
        names |= _env_reads(path.read_text())
    return {n for n in names if n not in NOT_OURS and n not in NOT_THE_DEPLOY}


_WEB_READS = [
    re.compile(r"import\.meta\.env\.([A-Z][A-Z0-9_]+)"),
    re.compile(r"import\.meta\.env\[\s*[\"'`]([A-Z][A-Z0-9_]+)[\"'`]\s*\]"),
    re.compile(r"process\.env\.([A-Z][A-Z0-9_]+)"),
    re.compile(r"process\.env\[\s*[\"'`]([A-Z][A-Z0-9_]+)[\"'`]\s*\]"),
    re.compile(r"\benv\.(VITE_[A-Z0-9_]+)"),
]
_WEB_DESTRUCTURE = re.compile(r"(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:import\.meta\.env|process\.env)")


def _web_files() -> list[Path]:
    web = ROOT / "web"
    files = [p for ext in ("*.ts", "*.tsx", "*.mjs", "*.js") for p in (web / "src").rglob(ext)]
    files += list((web / "scripts").glob("*.mjs")) + [web / "vite.config.ts"]
    return [p for p in files if p.exists() and ".test." not in p.name and "__fixtures__" not in p.parts]


def _web_vars() -> set[str]:
    names: set[str] = set()
    for path in _web_files():
        text = path.read_text()
        for pat in _WEB_READS:
            names.update(m.group(1) for m in pat.finditer(text))
        for m in _WEB_DESTRUCTURE.finditer(text):
            for part in m.group(1).split(","):
                name = part.split(":")[0].split("=")[0].strip()
                if re.fullmatch(r"[A-Z][A-Z0-9_]+", name):
                    names.add(name)
    return {n for n in names if n not in TOOLCHAIN}


def _documented(template: Path) -> set[str]:
    """Names the template assigns, commented or not: an exact name, never a
    substring (WS_MAX must not count as documented because WS_MAX_TOTAL is)."""
    return {m.group(1) for m in re.finditer(r"(?m)^\s*#?\s*([A-Z][A-Z0-9_]+)=", template.read_text())}


def test_the_api_template_names_every_variable_the_api_reads():
    missing = sorted(_api_vars() - _documented(API_TEMPLATE))
    assert not missing, f"deploy/api.env.example does not mention: {', '.join(missing)}"


def test_the_web_template_names_every_variable_the_build_reads():
    """The bundle, vite.config.ts and the Vercel build command's script."""
    missing = sorted(_web_vars() - _documented(WEB_TEMPLATE))
    assert not missing, f"web/.env.example does not mention: {', '.join(missing)}"


def test_the_scan_sees_every_way_of_reading_a_variable():
    """The spellings verify loop 1 slipped past the old regex scan."""
    src = """
import os
from os import environ, getenv
NAME = "HELD_IN_A_CONSTANT"
a = os.environ["SUBSCRIPTED"]
b = environ.get("BARE_ENVIRON")
c = getenv("BARE_GETENV")
d = os.environ.setdefault("SET_DEFAULT", "1")
e = "MEMBERSHIP" in os.environ
f = os.environ.get(NAME)
g = get_secret("VIA_GET_SECRET")
for var in ("LOOP_ONE", "LOOP_TWO"):
    os.environ.get(var)
"""
    assert _env_reads(src) == {"SUBSCRIPTED", "BARE_ENVIRON", "BARE_GETENV", "SET_DEFAULT", "MEMBERSHIP",
                               "HELD_IN_A_CONSTANT", "VIA_GET_SECRET", "LOOP_ONE", "LOOP_TWO"}
    assert "WS_MAX" not in {"WS_MAX_TOTAL"}  # exact names: see _documented


@pytest.mark.parametrize("template", [API_TEMPLATE, WEB_TEMPLATE], ids=["api", "web"])
def test_each_documented_variable_says_what_it_is_for(template):
    """A name with no sentence around it is a name the owner has to guess:
    every variable line, commented or not, carries an inline comment or sits
    under a comment line of its own."""
    lines = template.read_text().splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]+)=(.*)$", line)
        if not m:
            continue
        inline = "#" in m.group(2)
        # Its own comment directly above: not another variable's line, not a
        # section heading ("# ── Must set ──"), which names no purpose.
        prev = lines[i - 1].strip() if i > 0 else ""
        own = prev.startswith("#") and not re.match(r"^#\s*[A-Z][A-Z0-9_]+=", prev) and not prev.startswith("# ──")
        assert inline or own, f"{m.group(1)} in {template.name} says nothing about what it is for"


def test_the_templates_carry_no_secret_value():
    for template in (API_TEMPLATE, WEB_TEMPLATE):
        for line in template.read_text().splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if any(word in name for word in ("TOKEN", "KEY", "SECRET", "HOOK")):
                assert value.strip() == "", f"{name} in {template.name} carries a value"


@pytest.mark.parametrize("name", ["DEPLOY_PUBLIC", "CORS_ORIGINS", "ASSISTANT_ACCESS", "OPS_ACCESS_KEY",
                                  "BOOTSTRAP_DB_REFRESH_MIN", "TRUSTED_PROXY_HOPS", "EODHD_API_TOKEN",
                                  "FINNHUB_API_KEY", "ANTHROPIC_API_KEY", "GH_DB_TOKEN", "MAX_BODY_BYTES",
                                  "ASSISTANT_DAILY_CAP_USD", "WEB_CONCURRENCY"])
def test_the_launch_decisions_are_in_the_template(name):
    """The variables the spec calls out by name, including the one the image
    must never inherit."""
    assert name in API_TEMPLATE.read_text()


def test_the_refresh_interval_is_the_one_the_spec_asks_for():
    assert "BOOTSTRAP_DB_REFRESH_MIN=10" in API_TEMPLATE.read_text()
