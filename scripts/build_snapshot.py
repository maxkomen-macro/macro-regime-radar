#!/usr/bin/env python3
"""Build the public static snapshot for zero-cost availability (2026-09-06).

Reads the validated database through the FastAPI app in-process (no server,
no network) for exactly the endpoints listed in web/src/api/snapshot-manifest
.json, and writes one JSON file the frontend seeds its cache from:

    { "generated_at": ..., "db_mtime": ..., "source": "build_snapshot",
      "entries": { "/api/regime/latest": {...}, ... } }

Nothing sensitive can enter: only the manifest's read-only, public endpoints
are fetched; the provider status entry is scrubbed of counters and reasons
that mention configuration; no token, private URL, tick, or assistant
history exists on any of these routes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MANIFEST = ROOT / "web" / "src" / "api" / "snapshot-manifest.json"
import re  # noqa: E402

# Secret-shaped VALUES (never key names: "token_configured" is a boolean the
# freshness report legitimately carries).
SECRET_PATTERNS = [
    re.compile(r"api_token=", re.I),
    re.compile(r"bearer\s+[a-z0-9._\-]{8,}", re.I),
    re.compile(r"\b(sk-ant-|ghp_|github_pat_|gho_|xox[bap]-)[a-z0-9_\-]{6,}", re.I),
    re.compile(r"\b[0-9a-f]{32,}\b", re.I),
]


def scrub_status(body: dict) -> dict:
    """Keep the provider matrix and entitlement verdicts; drop reasons that
    could describe the server's configuration in detail."""
    ents = {}
    for fam, e in (body.get("entitlements") or {}).items():
        ents[fam] = {"family": fam, "available": e.get("available"), "checked_at": e.get("checked_at")}
    return {
        "generated_at": body.get("generated_at"),
        "eodhd_configured": bool(body.get("eodhd_configured")),
        "primary": body.get("primary"),
        "entitlements": ents,
        "cache": {},
        "relay": {"feeds": (body.get("relay") or {}).get("feeds", {}), "degraded": True, "degraded_reasons": ["snapshot: relay state unknown while the API is offline"], "token_configured": bool(body.get("eodhd_configured"))},
        "security": {"assistant_mode": (body.get("security") or {}).get("assistant_mode", "off"), "counters": {}},
    }


def build(db_path: Path | None = None) -> dict:
    if db_path:
        os.environ["MRR_DB_PATH"] = str(db_path)
    os.environ.setdefault("EODHD_PROBE_ON_START", "0")
    from fastapi.testclient import TestClient

    from api import db as api_db
    from api.main import app

    if db_path:
        api_db.DB_PATH = db_path  # type: ignore[misc]
    manifest = json.loads(MANIFEST.read_text())
    entries: dict = {}
    problems: list[str] = []
    with TestClient(app) as client:
        for item in manifest:
            path = item["path"]
            r = client.get(path)
            if r.status_code != 200:
                problems.append(f"{path}: HTTP {r.status_code}")
                continue
            body = r.json()
            text = json.dumps(body)
            if any(p.search(text) for p in SECRET_PATTERNS):
                # A public snapshot must never carry a secret-shaped value.
                problems.append(f"{path}: body contains a secret-shaped value; excluded")
                continue
            entries[path] = body
    mtime = None
    p = db_path or api_db.DB_PATH
    if p.exists():
        mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "db_mtime": mtime,
        "source": "build_snapshot",
        "entries": entries,
        "problems": problems,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--out", default=str(ROOT / "web" / "public" / "snapshot" / "latest.json"))
    a = ap.parse_args(argv)
    snap = build(Path(a.db) if a.db else None)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, separators=(",", ":"), default=str))
    print(f"snapshot: {len(snap['entries'])} entries → {out} ({out.stat().st_size:,} bytes)")
    for p in snap["problems"]:
        print(f"  skipped {p}")
    return 0 if snap["entries"] else 1


if __name__ == "__main__":
    sys.exit(main())
