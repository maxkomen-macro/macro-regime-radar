"""AGENTS.md (Codex) and CLAUDE.md (Claude Code) carry one shared block.

Each assistant loads only its own file, so the operating rules sit in both,
between the same two markers. This test fails when the two copies differ, when a
marker goes missing, or when a retired Git routine comes back.
"""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FILES = ("AGENTS.md", "CLAUDE.md")
START = "<!-- shared-instructions:start -->"
END = "<!-- shared-instructions:end -->"

# Codex reads at most project_doc_max_bytes (32 KiB by default) of a project's
# instruction files and silently drops the rest; its global instructions file is
# loaded separately and does not count (checked on codex-cli 0.159.3 with
# `codex debug prompt-input`). 24 KiB is a chosen margin, three quarters of the
# product limit: it fails well before Codex would start dropping text, and leaves
# room if a nested AGENTS.md is ever added beside this one.
AGENTS_MAX_BYTES = 24 * 1024

# Commands from the Git session routine AGENTS.md carried until November 2026,
# and the workflow step that reverted merged pull requests twice.
RETIRED = (
    "git pull --no-rebase",
    "git checkout HEAD -- data/macro_radar.db",
    "git reset --soft origin/main &&",
)


def _text(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def _shared(name: str) -> str:
    text = _text(name)
    assert text.count(START) == 1, f"{name}: expected exactly one start marker"
    assert text.count(END) == 1, f"{name}: expected exactly one end marker"
    return text.split(START, 1)[1].split(END, 1)[0]


def test_the_shared_block_is_identical_in_both_files():
    assert _shared("AGENTS.md") == _shared("CLAUDE.md"), (
        "AGENTS.md and CLAUDE.md differ between the shared-instructions markers: "
        "make the same edit in both"
    )


def test_the_shared_block_carries_the_operating_rules():
    block = _shared("AGENTS.md")
    for heading in (
        "## Git, approval and deploy rules (hard)",
        "## Never",
        "## Topic rules (`.claude/rules/`)",
    ):
        assert heading in block, f"shared block lost its section: {heading}"


@pytest.mark.parametrize("name", FILES)
def test_no_retired_git_routine(name):
    text = _text(name)
    for command in RETIRED:
        assert command not in text, f"{name} carries a retired routine: {command}"


def test_agents_md_fits_the_codex_budget():
    size = len(_text("AGENTS.md").encode("utf-8"))
    assert size <= AGENTS_MAX_BYTES, f"AGENTS.md is {size} bytes, over {AGENTS_MAX_BYTES}"
