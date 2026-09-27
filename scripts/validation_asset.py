"""scripts/validation_asset.py — the verdict published with the database
(docs/desk/FRAME3_API_PLAN.md §1.9 and §6 S-01; desk/frame-3-api-b2a).

Both database writers (refresh-data.yml, intraday-refresh.yml) run this in
its own step right after the database's publish step, and upload what it
writes as the `validation.json` release asset:

    {"verdict": "pass" | "fail", "mode": <the validator's mode>,
     "timestamp": <the validator report's generated_at>,
     "db_sha256": <the sha256 of the database file just uploaded>}

Exactly those four fields. The API (api/bootstrap.py) checks `db_sha256`
against the file it serves before it serves the verdict; the full report
stays where it is (the validated-db run artifact).

Stdlib only: the intraday workflow runs it on the lean market install.

    python scripts/validation_asset.py validation.json data/macro_radar.db publish/validation.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

FIELDS = ("verdict", "mode", "timestamp", "db_sha256")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build(report_path: Path, db_path: Path) -> dict:
    """The slim verdict from the validator's report and the database's bytes."""
    rep = json.loads(Path(report_path).read_text())
    if rep.get("verdict") not in ("pass", "fail"):
        raise ValueError(f"the validator's verdict is {rep.get('verdict')!r}, not pass or fail")
    for key in ("mode", "generated_at"):
        if not isinstance(rep.get(key), str) or not rep[key]:
            raise ValueError(f"the validator's report has no {key}")
    return {"verdict": rep["verdict"], "mode": rep["mode"], "timestamp": rep["generated_at"], "db_sha256": sha256_of(Path(db_path))}


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 3:
        print("usage: validation_asset.py <validator report> <database> <output>", file=sys.stderr)
        return 2
    out = build(Path(args[0]), Path(args[1]))
    dst = Path(args[2])
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out))
    print(f"validation.json: {out['verdict']} ({out['mode']}, {out['timestamp']}), db sha256 {out['db_sha256'][:12]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
