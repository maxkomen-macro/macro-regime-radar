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
                  "SNAPSHOT_REPO", "SNAPSHOT_TAG", "SNAPSHOT_ASSET", "VITE_PROXY_TARGET", "SOAK_S", "IDLE_S"}

ENV_READ = re.compile(r"""os\.environ(?:\.get)?\(\s*["']([A-Z][A-Z0-9_]+)["']|os\.getenv\(\s*["']([A-Z][A-Z0-9_]+)["']""")
VITE_READ = re.compile(r"""(?:import\.meta\.env|env)\.(VITE_[A-Z0-9_]+)|process\.env\.([A-Z][A-Z0-9_]+)""")


def _api_vars() -> set[str]:
    names: set[str] = set()
    for path in list((ROOT / "api").rglob("*.py")):
        for m in ENV_READ.finditer(path.read_text()):
            names.add(m.group(1) or m.group(2))
    # The analytics modules the API imports read one secret through get_secret.
    names.add("ANTHROPIC_API_KEY")
    return {n for n in names if n not in NOT_OURS and n not in NOT_THE_DEPLOY}


def _web_vars() -> set[str]:
    names: set[str] = set()
    src = ROOT / "web" / "src"
    for path in list(src.rglob("*.ts")) + list(src.rglob("*.tsx")):
        if ".test." in path.name:
            continue
        for m in VITE_READ.finditer(path.read_text()):
            name = m.group(1) or m.group(2)
            if name and name.startswith("VITE_"):
                names.add(name)
    return names


def test_the_api_template_names_every_variable_the_api_reads():
    template = API_TEMPLATE.read_text()
    missing = sorted(name for name in _api_vars() if name not in template)
    assert not missing, f"deploy/api.env.example does not mention: {', '.join(missing)}"


def test_the_web_template_names_every_variable_the_bundle_reads():
    template = WEB_TEMPLATE.read_text()
    missing = sorted(name for name in _web_vars() if name not in template)
    assert not missing, f"web/.env.example does not mention: {', '.join(missing)}"


def test_each_documented_variable_says_what_it_is_for():
    """A name with no sentence around it is a name the owner has to guess."""
    text = API_TEMPLATE.read_text()
    # Every uncommented assignment is preceded by a comment block.
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not re.match(r"^[A-Z][A-Z0-9_]+=", line):
            continue
        above = [ln for ln in lines[max(0, i - 6):i] if ln.startswith("#")]
        assert above, f"{line.split('=')[0]} is documented nowhere in the template"


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
