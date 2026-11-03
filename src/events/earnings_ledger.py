"""src/events/earnings_ledger.py — the earnings cache's durable ledger on the data-latest release (design EC section 9).

The ledger is a set of immutable, sequenced release assets `earnings-cache-ledger-<seq, 9 digits>.bin`, each one
sealed vault (src/events/earnings_store.py, `seal_ledger`). A write uploads a new asset under a new name, never
with --clobber (which deletes before it uploads); only after that upload succeeds are ledger assets other than the
two newest deleted. So a failed write never removes the last state that reached the release (Codex DR-20).

    python -m src.events.earnings_cache --fetch-ledger     before the step: list and download (refresh-data.yml)
    python -m src.events.earnings_cache --publish-ledger   after it, always: upload a final state still pending

Everything here goes through the `gh` command line with the workflow's built-in token. It prints counts and
states only, never an asset URL or a command's output. Every function returns a value; none raises.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping

from src.events import earnings_store as store

RELEASE = "data-latest"
STATE_FILE = "earnings-ledger.state"
PENDING_FILE = "earnings-ledger.pending"
SUBDIR = "earnings-ledger"
KEEP = 2  # assets kept after a successful upload: the newest two
CALL_S = 30.0  # one gh command's limit

Gh = Callable[[list[str], float], tuple[int, str]]


def gh_cli(env: Mapping[str, str] | None = None) -> Gh:
    """The real `gh`, with the workflow's token from the environment; output is returned, never printed."""
    environ = dict(os.environ if env is None else env)

    def run(args: list[str], timeout: float) -> tuple[int, str]:
        try:
            done = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout, env=environ)
        except (OSError, subprocess.SubprocessError):
            return 1, ""
        return done.returncode, done.stdout

    return run


@dataclass
class State:
    state: str  # ok | absent | unavailable
    names: list[str] = field(default_factory=list)  # every ledger asset the listing showed
    files: dict[int, Path] = field(default_factory=dict)  # seq -> downloaded file (the newest KEEP)
    reason: str = ""

    @property
    def top(self) -> int | None:
        seqs = [s for s in (store.ledger_seq(n) for n in self.names) if s is not None]
        return max(seqs) if seqs else None


def _list(gh: Gh) -> list[str] | None:
    rc, out = gh(["release", "view", RELEASE, "--json", "assets"], CALL_S)
    if rc != 0:
        return None
    try:
        assets = json.loads(out).get("assets")
        return [str(a["name"]) for a in assets]
    except (ValueError, AttributeError, KeyError, TypeError):
        return None


def _ledger_names(names: list[str]) -> list[str] | None:
    """The ledger assets among a listing, or None when one looks like a ledger asset but its seq part is not
    exactly 9 digits: the order is then unsafe (DR-22)."""
    out = []
    for n in names:
        try:
            if store.ledger_seq(n) is not None:
                out.append(n)
        except ValueError:
            return None
    return out


def fetch(directory: Path, gh: Gh) -> State:
    """The fetch step: list the release, download the newest KEEP ledger assets, record the state."""
    directory = Path(directory)
    sub = directory / SUBDIR
    sub.mkdir(parents=True, exist_ok=True)
    for f in sub.glob(f"{store.LEDGER_PREFIX}*"):
        f.unlink()
    listing = _list(gh)
    if listing is None:
        st = State("unavailable", reason="the release could not be listed")
    else:
        names = _ledger_names(listing)
        if names is None:
            st = State("unavailable", reason="a ledger asset name is not in sequence form")
        elif not names:
            st = State("absent")
        else:
            st = State("ok", names=sorted(names, key=store.ledger_seq))
            for n in sorted(names, key=store.ledger_seq)[-KEEP:]:
                rc, _ = gh(["release", "download", RELEASE, "--pattern", n, "--dir", str(sub), "--clobber"], CALL_S)
                if rc != 0 or not (sub / n).exists():
                    st = State("unavailable", names=st.names, reason="a ledger asset could not be downloaded")
                    break
                st.files[store.ledger_seq(n)] = sub / n
    _write_state(directory, st)
    return st


def _write_state(directory: Path, st: State) -> None:
    (Path(directory) / STATE_FILE).write_text(json.dumps(
        {"state": st.state, "names": st.names, "files": {str(k): v.name for k, v in st.files.items()},
         "reason": st.reason}))


def read_state(directory: Path) -> State:
    """What the fetch step recorded; no record (the step did not run, or failed) is `unavailable`."""
    directory = Path(directory)
    try:
        raw = json.loads((directory / STATE_FILE).read_text())
        st = State(raw["state"], list(raw.get("names") or []),
                   {int(k): directory / SUBDIR / v for k, v in (raw.get("files") or {}).items()}, raw.get("reason", ""))
    except (OSError, ValueError, KeyError, TypeError):
        return State("unavailable", reason="no ledger state recorded")
    if st.state not in ("ok", "absent", "unavailable") or _ledger_names(st.names) is None:
        return State("unavailable", reason="the ledger state is not readable")
    return st


def write_local(directory: Path, seq: int, body: bytes) -> Path:
    sub = Path(directory) / SUBDIR
    sub.mkdir(parents=True, exist_ok=True)
    path = sub / store.ledger_name(seq)
    path.write_bytes(body)
    return path


def upload(directory: Path, path: Path, gh: Gh) -> bool:
    """Upload one sequenced asset under its own name (never --clobber), then keep only the newest KEEP. True when
    the asset is in the release; a failed prune only leaves extra assets."""
    rc, _ = gh(["release", "upload", RELEASE, str(path)], CALL_S)
    if rc != 0:
        return False
    listing = _list(gh)
    names = _ledger_names(listing) if listing is not None else None
    if names:
        for n in sorted(names, key=store.ledger_seq)[:-KEEP]:
            gh(["release", "delete-asset", RELEASE, n, "--yes"], CALL_S)
    return True


def mark_pending(directory: Path, path: Path | None) -> None:
    p = Path(directory) / PENDING_FILE
    if path is None:
        p.unlink(missing_ok=True)
    else:
        p.write_text(path.name)


def publish_pending(directory: Path, gh: Gh) -> str:
    """The always-run step: upload a final state the cache step could not, so it reaches the release even when
    validation fails. Returns the one public word: none, uploaded or failed."""
    directory = Path(directory)
    try:
        name = (directory / PENDING_FILE).read_text().strip()
    except OSError:
        return "none"
    path = directory / SUBDIR / name
    if store.ledger_seq(name) is None or not path.exists():
        return "failed"
    if upload(directory, path, gh):
        mark_pending(directory, None)
        return "uploaded"
    return "failed"
