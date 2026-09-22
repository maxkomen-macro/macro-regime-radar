#!/usr/bin/env bash
# make sync-data — pull the latest validated snapshot from the private
# data-latest Release into data/macro_radar.db (2026-09-06).
#
# Requires `gh auth login` (or GH_TOKEN in the environment). Downloads to a
# temp file beside the target, validates it (header, integrity_check, regime
# rows, no max-date regression), prints before/after freshness, then swaps it
# in with an atomic rename. Never prints a credential; never leaves a torn
# file behind; a failed validation keeps the current file untouched.
set -euo pipefail

REPO="${MRR_REPO:-maxkomen-macro/macro-regime-radar}"
TARGET="${MRR_DB_PATH:-data/macro_radar.db}"
PY="${PYTHON:-.venv/bin/python}"
[ -x "$PY" ] || PY=python3

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required (brew install gh); aborting." >&2
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ]; then
  echo "gh is not authenticated: run 'gh auth login' (read access to $REPO) and retry." >&2
  exit 2
fi

mkdir -p "$(dirname "$TARGET")"
TMPDIR_SYNC="$(mktemp -d "$(dirname "$TARGET")/.sync.XXXXXX")"
trap 'rm -rf "$TMPDIR_SYNC"' EXIT

echo "→ release asset:"
gh release view data-latest --repo "$REPO" --json assets --jq '.assets[] | select(.name=="macro_radar.db") | "  \(.name) \(.size) bytes updated \(.updatedAt)"'

echo "→ downloading…"
gh release download data-latest --repo "$REPO" --pattern macro_radar.db --dir "$TMPDIR_SYNC" --clobber
NEW="$TMPDIR_SYNC/macro_radar.db"

if [ -f "$TARGET" ]; then
  echo "→ current file:"
  "$PY" scripts/validate_db.py "$TARGET" --mode verify-only --json "$TMPDIR_SYNC/before.json" >/dev/null 2>&1 || true
  "$PY" - "$TMPDIR_SYNC/before.json" <<'PYEOF'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
    for k, v in r["current"]["fresh"].items():
        print(f"  {k:22s} {v}")
except Exception as e:
    print("  (could not read current file)", e)
PYEOF
fi

echo "→ validating download…"
if [ -f "$TARGET" ]; then
  "$PY" scripts/validate_db.py "$NEW" --previous "$TARGET" --mode verify-only --allow-stale "local sync: freshness is the Release's, not this machine's" --json "$TMPDIR_SYNC/after.json" >/dev/null
else
  "$PY" scripts/validate_db.py "$NEW" --mode verify-only --allow-stale "local sync" --json "$TMPDIR_SYNC/after.json" >/dev/null
fi
"$PY" - "$TMPDIR_SYNC/after.json" <<'PYEOF'
import json, sys
r = json.load(open(sys.argv[1]))
print("  verdict:", r["verdict"], "| integrity:", r["current"].get("integrity"))
for k, v in r["current"]["fresh"].items():
    print(f"  {k:22s} {v}")
for f in r.get("failures", []):
    print("  FAIL:", f)
PYEOF

mv -f "$NEW" "$TARGET"   # same filesystem: atomic rename
rm -f "$TARGET-wal" "$TARGET-shm" 2>/dev/null || true
echo "✓ $TARGET replaced atomically."
