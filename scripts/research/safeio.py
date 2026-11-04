"""Output writing for the research scripts that can never touch the source
database (Codex S-6, S-7).

Two rules:

* Before any computation, every output path is checked against the source
  database and its SQLite sidecars (-wal, -shm, -journal): by resolved path
  (symlinks followed) and by file identity (hard links). An alias is refused.
* Every file is written to a temporary file in the same directory and moved
  into place with os.replace, which replaces a symlink rather than writing
  through it, so even an output path created after the check cannot truncate
  the file it points at.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

SIDECARS = ("", "-wal", "-shm", "-journal")


class OutputAliasesSource(ValueError):
    """An output path is the source database or one of its files."""


def protected_paths(db: Path | str) -> list[Path]:
    src = Path(db).resolve()
    return [src.with_name(src.name + s) for s in SIDECARS]


def _same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:  # either side missing
        return False


def guard_outputs(db: Path | str, outputs: list[Path | str]) -> None:
    """Raise unless no output resolves to, or is a hard link of, the source
    database or a sidecar."""
    prot = protected_paths(db)
    for out in outputs:
        o = Path(out)
        r = o.resolve()
        if any(r == p or _same_file(o, p) for p in prot):
            raise OutputAliasesSource(f"output {out} is the source database {db} or one of its files")


def write_bytes(path: Path | str, data: bytes, *, db: Path | str | None = None) -> None:
    """Atomically write `data` to `path` (temporary file + os.replace)."""
    p = Path(path)
    if db is not None:
        guard_outputs(db, [p])
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", dir=p.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_text(path: Path | str, text: str, *, db: Path | str | None = None) -> None:
    write_bytes(path, text.encode("utf-8"), db=db)
