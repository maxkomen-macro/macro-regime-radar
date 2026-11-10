#!/usr/bin/env bash
# owner-correction.sh: the owner-run market_daily correction (option A), rev 4, 2026-11-06.
#
# Runbook: https://claude.ai/artifact/9K546WJ18rknn3QFwVBAhA
# Approved by the owner on 2026-11-05 at 19:14 UTC (item 4); execution support at 22:37 UTC (item 6);
# failure-handling repair on 2026-11-06 at 05:49 UTC (item 5).
#
# Keep this file outside the checkout. Run it from the root of a fresh clone of maxkomen-macro/macro-regime-radar,
# one phase at a time:
#
#   bash ../owner-correction.sh init                 # checks the checkout and tools, creates a fresh run folder
#   export RUN=<the folder init printed>
#   bash ../owner-correction.sh pause                # records the writers' states, disables them, drains runs
#   bash ../owner-correction.sh prepare              # fresh download, restate, rebuild, check against the reviewed impact
#   bash ../owner-correction.sh publish              # uploads database, verdict, snapshot; verifies the published set
#   API_URL=https://<api-host> bash ../owner-correction.sh verify-api   # the serving generation uses the corrected file
#   bash ../owner-correction.sh resume               # restores the writers' recorded states
#   bash ../owner-correction.sh verify-persist       # after a writer publishes a newer database: the correction is still there
#
#   bash ../owner-correction.sh recover              # only if publish stopped partway (writers still paused)
#   bash ../owner-correction.sh pause; bash ../owner-correction.sh rollback; bash ../owner-correction.sh resume
#                                                 # only to undo a publish (see the runbook)
#
# Every phase stops at the first failed command or check (set -Eeuo pipefail). Every read of GitHub (the
# release listing, a download, the writers' states, their runs) is checked: a failed, partial or malformed
# read stops the phase, and nothing is inferred from it. Nothing is uploaded before `publish`.
# REHEARSAL=1 prints the commands that would change GitHub (disable, enable, upload) and skips them; it also
# lets later phases continue while the never-disabled writers read as active. Everything else runs as normal.
#
# These are provider-reported, distribution-unadjusted prices (Yahoo's Close, split-adjusted only).
# The anchor check compares Yahoo with Yahoo. It is a vendor consistency check, not independent
# exchange validation.

set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true   # bash 4.4+; on older bash every read below is checked explicitly
trap 'echo "STOPPED: line $LINENO: $BASH_COMMAND" >&2' ERR

REPO="maxkomen-macro/macro-regime-radar"
MIN_REF="0341f1114aba6ad6700bb150e465bce4e97e7e3e"   # #50: freshness text "Stored provider close"
WRITERS=("refresh-data.yml" "intraday-refresh.yml")
ASSETS=("macro_radar.db" "validation.json" "snapshot-latest.json")
DRAIN_TIMEOUT_MIN="${DRAIN_TIMEOUT_MIN:-120}"
ADOPT_TIMEOUT_MIN="${ADOPT_TIMEOUT_MIN:-40}"
POLL_SEC="${POLL_SEC:-60}"
export FRED_API_KEY="${FRED_API_KEY:-placeholder}"
export EODHD_PROBE_ON_START=0

die() { echo "STOP: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }
need_run() { [ -n "${RUN:-}" ] && [ -d "$RUN" ] || die "set RUN to the folder that init created"; }
need_prepared() {  # prepare passed every check, and all three publish files are still the ones it checked
  local a want got n=0
  [ -s "$RUN/prepared.ok" ] || die "prepare did not pass every check in this folder; $1"
  while read -r a want; do
    case "$a" in macro_radar.db|validation.json|snapshot-latest.json) ;; *) die "prepared.ok is malformed; $1" ;; esac
    got=$(sha "$RUN/publish/$a") || die "could not hash the prepared $a; $1"
    [ "$got" = "$want" ] || die "the prepared $a changed after prepare; $1"
    n=$((n + 1))
  done < "$RUN/prepared.ok"
  [ "$n" -eq "${#ASSETS[@]}" ] || die "prepared.ok does not list all three files; $1"
  [ "$(sha "$RUN/publish/macro_radar.db")" = "$(cat "$RUN/sha-new.txt")" ] || die "the prepared database is not the one prepare recorded; $1"
  [ "$(sha "$RUN/publish/macro_radar.db")" = "$(verdict_sha "$RUN/publish/validation.json")" ] || die "the prepared verdict does not match the prepared database; $1"
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["verdict"] == "pass" else 1)' "$RUN/publish/validation.json" \
    || die "the prepared verdict is not pass; $1"
}
ghw() {  # a gh command that changes GitHub
  if [ "${REHEARSAL:-0}" = "1" ]; then echo "REHEARSAL, not run: gh $*"; else gh "$@"; fi
}
sha() { local s; s=$(shasum -a 256 "$1") || return 1; s="${s%% *}"; [ "${#s}" -eq 64 ] || return 1; echo "$s"; }
same_file() { local x y; x=$(sha "$1") || return 1; y=$(sha "$2") || return 1; [ "$x" = "$y" ]; }
nbytes() { local n; n=$(wc -c < "$1") || return 1; echo $((n + 0)); }
verdict_sha() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["db_sha256"])' "$1"; }

# --- Reads of GitHub. Each prints only what one complete, well-formed read returned, and returns non-zero
# --- otherwise. These never call die (they run inside $(...)); every caller stops on failure with "|| die".

assets_tsv() {  # the release's assets as "name<TAB>size<TAB>updated_at<TAB>id" rows, from one complete listing
  local j
  j=$(gh api "repos/$REPO/releases/tags/data-latest") || { echo "  the release listing could not be read" >&2; return 1; }
  printf '%s' "$j" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("tag_name") != "data-latest" or not isinstance(d.get("assets"), list):
    sys.exit("  the release listing is incomplete")
for a in sorted(d["assets"], key=lambda a: a["name"]):
    if not (isinstance(a.get("name"), str) and a["name"] and isinstance(a.get("size"), int)
            and isinstance(a.get("updated_at"), str) and a["updated_at"] and isinstance(a.get("id"), int)):
        sys.exit("  an asset row in the release listing is incomplete")
    if a.get("state", "uploaded") != "uploaded":
        sys.exit("  %s is in state %s (an unfinished upload)" % (a["name"], a["state"]))
    print(a["name"], a["size"], a["updated_at"], a["id"], sep="\t")
' || { echo "  the release listing is malformed or incomplete" >&2; return 1; }
}
asset_size() {  # asset_size <listing> <name>: its size, or nothing when the listing has no such asset
  awk -F'\t' -v n="$2" '$1 == n { print $2 }' <<< "$1"
}
writer_states() {  # both writers' "path<TAB>state" rows, from one complete read
  local j
  j=$(gh api "repos/$REPO/actions/workflows?per_page=100") || { echo "  the writers' states could not be read" >&2; return 1; }
  printf '%s' "$j" | python3 -c '
import json, sys
want = [".github/workflows/intraday-refresh.yml", ".github/workflows/refresh-data.yml"]
rows = {w["path"]: w["state"] for w in json.load(sys.stdin)["workflows"] if w.get("path") in want}
if sorted(rows) != want or not all(isinstance(rows[p], str) and rows[p] for p in want):
    sys.exit("  the read does not list both writers with a state")
for p in want: print(p, rows[p], sep="\t")
' || { echo "  the writers' states are malformed or incomplete" >&2; return 1; }
}
writers_disabled() {  # 0: both writers read as disabled. 1: a writer is not disabled. 2: the read failed
  local s p st n=0
  s=$(writer_states) || return 2
  while IFS=$'\t' read -r p st; do
    case "$st" in
      disabled_manually|disabled_inactivity) n=$((n + 1)) ;;
      *) echo "  $p is $st" >&2 ;;
    esac
  done <<< "$s"
  [ "$n" -eq 2 ] || return 1
}
open_runs() {  # open writer runs, from one complete listing per writer of every run created in the last 36 days
  # GitHub ends every workflow run within 35 days, waiting time included, so an open run cannot be older.
  # The status comes from that listing, never from per-status queries, so a run that changes status during
  # the check is still seen. The listing must be complete: the pages' run ids must add up to total_count.
  local tmp since w page total c n=0
  since=$(python3 -c 'import datetime as d; print((d.datetime.now(d.timezone.utc) - d.timedelta(days=36)).strftime("%Y-%m-%dT%H:%M:%SZ"))') \
    || return 1
  tmp=$(mktemp -d) || return 1
  for w in "${WRITERS[@]}"; do
    page=1
    while :; do
      gh api "repos/$REPO/actions/workflows/$w/runs?created=>=$since&per_page=100&page=$page" > "$tmp/$w.$page.json" \
        || { echo "  the runs of $w could not be read" >&2; rm -rf "$tmp"; return 1; }
      total=$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["total_count"]; assert isinstance(t, int) and 0 <= t < 1000; print(t)' \
        "$tmp/$w.$page.json") || { echo "  the runs of $w are malformed, or 1,000 or more (the API returns at most 1,000, so completeness is unproven)" >&2; rm -rf "$tmp"; return 1; }
      [ $((page * 100)) -lt "$total" ] || break
      page=$((page + 1))
    done
    c=$(python3 -c '
import glob, json, sys
pages = [json.load(open(p)) for p in glob.glob(sys.argv[1] + "/" + sys.argv[2] + ".*.json")]
totals = set(p["total_count"] for p in pages)
assert len(totals) == 1, "total_count changed between pages"
runs = {}
for p in pages:
    for r in p["workflow_runs"]:
        assert isinstance(r.get("id"), int) and isinstance(r.get("status"), str) and r["status"]
        runs[r["id"]] = r["status"]
assert len(runs) == totals.pop(), "the pages do not add up to total_count"
print(sum(s != "completed" for s in runs.values()))' "$tmp" "$w") \
      || { echo "  the runs of $w are incomplete or malformed" >&2; rm -rf "$tmp"; return 1; }
    [ "$c" -eq 0 ] || echo "  $w: $c run(s) not completed" >&2
    n=$((n + c))
  done
  rm -rf "$tmp"
  echo "  writers: $n run(s) not completed among every run of the last 36 days" >&2
  echo "$n"
}
completed_since() {  # completed_since <utc time>: completed writer runs created after it, from complete reads
  local n=0 w j c
  for w in "${WRITERS[@]}"; do
    j=$(gh run list --repo "$REPO" --workflow "$w" --limit 50 --json status,createdAt) \
      || { echo "  the runs of $w could not be read" >&2; return 1; }
    c=$(printf '%s' "$j" | python3 -c '
import json, sys
r = json.load(sys.stdin)
assert isinstance(r, list) and all(isinstance(x.get("status"), str) and isinstance(x.get("createdAt"), str) for x in r)
print(sum(x["status"] == "completed" and x["createdAt"] > sys.argv[1] for x in r))' "$1") \
      || { echo "  the runs of $w are malformed" >&2; return 1; }
    n=$((n + c))
  done
  echo "$n"
}
download_one() {  # download_one <listing> <name> <folder>: the whole asset, or failure
  local size got
  size=$(asset_size "$1" "$2")
  [ -n "$size" ] || { echo "  $2 is not in the release listing" >&2; return 1; }
  rm -f "$3/$2"
  gh release download data-latest --repo "$REPO" --pattern "$2" --dir "$3" --clobber \
    || { echo "  the download of $2 failed" >&2; return 1; }
  [ -f "$3/$2" ] || { echo "  the download of $2 wrote no file" >&2; return 1; }
  got=$(nbytes "$3/$2") || return 1
  [ "$got" = "$size" ] || { echo "  the download of $2 is incomplete: $got of $size bytes" >&2; return 1; }
}
download_set() {  # download_set <folder>: all three files, whole, under one unchanged listing; prints the listing
  local t1 t2 a
  mkdir -p "$1"
  t1=$(assets_tsv) || return 1
  for a in "${ASSETS[@]}"; do download_one "$t1" "$a" "$1" || return 1; done
  t2=$(assets_tsv) || return 1
  [ "$t1" = "$t2" ] || { echo "  the release changed during the download" >&2; return 1; }
  printf '%s\n' "$t1"
}

require_paused_and_drained() {  # stops unless both writers read as disabled and neither has an open run
  local rc=0 c
  writers_disabled || rc=$?
  [ "$rc" -ne 2 ] || die "could not read the writers' states; nothing was changed"
  if [ "$rc" -ne 0 ]; then
    [ "${REHEARSAL:-0}" = "1" ] || die "both writers must be disabled first; run pause"
    echo "REHEARSAL: the writers were never disabled; continuing because nothing is uploaded"
  fi
  c=$(open_runs) || die "could not read the writers' runs; nothing was changed"
  [ "$c" -eq 0 ] || die "$c writer run(s) still open; run pause again to drain them"
  if [ "$rc" -eq 0 ]; then echo "confirmed: both writers disabled, no writer run open"
  else echo "REHEARSAL: no writer run open (writers not disabled)"; fi
}

cmd_init() {
  [ -f scripts/restate_market_daily.py ] && [ -f scripts/restate_impact.py ] || die "run from the repository root"
  git remote get-url origin | grep -q "$REPO" || die "origin is not $REPO"
  [ -z "$(git status --porcelain)" ] || die "the checkout has uncommitted or untracked files"
  git fetch -q origin main
  git merge-base --is-ancestor "$MIN_REF" HEAD || die "HEAD does not contain $MIN_REF (#50); check out origin/main"
  git merge-base --is-ancestor HEAD origin/main || die "HEAD is not on origin/main"
  ls data/macro_radar.pre-restate-*.db >/dev/null 2>&1 && die "an old data/macro_radar.pre-restate-*.db exists; move it out first"
  for f in data/macro_radar.db data/macro_radar.db-wal data/macro_radar.db-shm; do
    [ -e "$f" ] && die "$f exists; move your local database out of data/ first"
  done
  gh auth status >/dev/null 2>&1 || die "gh is not signed in"
  python3 -c 'import pandas, yfinance, requests' || die "the Python environment lacks pandas, yfinance or requests"
  local run; run="$(cd .. && pwd)/restate-run-$(date -u +%Y%m%dT%H%M%SZ)"
  [ -e "$run" ] && die "$run already exists"
  mkdir "$run" "$run/published" "$run/publish" "$run/verify"
  git rev-parse HEAD > "$run/checkout-ref.txt"
  ok "checkout $(git rev-parse --short HEAD) contains #50 and is on origin/main"
  echo "export RUN=$run"
}

cmd_pause() {  # also used again before recover or rollback: the first recording is kept, so resume restores it
  need_run
  local s
  if [ -e "$RUN/workflow-states-before.tsv" ]; then
    echo "states recorded earlier are kept for resume:"
  else
    s=$(writer_states) || die "could not read the writers' states; nothing was changed"
    printf '%s\n' "$s" > "$RUN/workflow-states-before.tsv"
  fi
  [ "$(wc -l < "$RUN/workflow-states-before.tsv")" -eq 2 ] || die "expected two writer workflows"
  cat "$RUN/workflow-states-before.tsv"
  local w; for w in "${WRITERS[@]}"; do ghw workflow disable "$w" --repo "$REPO" || die "could not disable $w; run pause again"; done
  local start rc c; start=$(date +%s)
  while :; do
    rc=0; writers_disabled || rc=$?
    [ "$rc" -ne 2 ] || die "could not read the writers' states; run pause again (the recorded states are kept)"
    [ "$rc" -eq 0 ] || [ "${REHEARSAL:-0}" = "1" ] || die "a writer still reads as enabled after disable; run pause again"
    c=$(open_runs) || die "could not read the writers' runs; run pause again (the recorded states are kept)"
    [ "$c" -eq 0 ] && break
    [ $(( $(date +%s) - start )) -lt $((DRAIN_TIMEOUT_MIN * 60)) ] || die "runs still open after $DRAIN_TIMEOUT_MIN min; the writers stay disabled"
    sleep "$POLL_SEC"
  done
  if [ "$rc" -eq 0 ]; then ok "writers disabled and drained"; else ok "rehearsal: writers not disabled; no writer run open"; fi
}

cmd_prepare() {
  need_run
  [ -s "$RUN/workflow-states-before.tsv" ] || die "run pause first"
  [ -e "$RUN/assets-before.tsv" ] && die "prepare already ran in this folder; use a fresh RUN from init"
  require_paused_and_drained
  local listing; listing=$(download_set "$RUN/published") || die "could not download the published set completely; nothing was changed"
  printf '%s\n' "$listing" > "$RUN/assets-before.tsv"
  local orig; orig=$(sha "$RUN/published/macro_radar.db") || die "could not hash the download"
  [ "$orig" = "$(verdict_sha "$RUN/published/validation.json")" ] || die "published validation.json does not match the published database"
  echo "$orig" > "$RUN/sha-original.txt"
  cp "$RUN/published/macro_radar.db" data/macro_radar.db
  same_file data/macro_radar.db "$RUN/published/macro_radar.db" || die "working copy differs from the download"
  ok "working copy is the fresh published file $orig"

  python3 scripts/restate_market_daily.py --db data/macro_radar.db --spy-splice --report "$RUN/restate-dry.json" | tee "$RUN/dry.out"
  python3 - "$RUN/restate-dry.json" <<'EOF'
import collections, json, sys
d = json.load(open(sys.argv[1]))
kinds = collections.Counter(r["kind"] for r in d["rows"] if r["changed"])
worst = max(abs(a["log_diff"]) for a in d["anchors"])
checks = {
    "7,916 target rows, all changing": len(d["rows"]) == 7916 and sum(kinds.values()) == 7916,
    "92 mid-session and 7,824 splice rows": kinds == {"mid-session": 92, "splice": 7824},
    "210 anchors": len(d["anchors"]) == 210,
    "worst anchor |log diff| <= 1e-4 (reviewed 6.12e-5)": worst <= 1e-4,
    "264 changed returns": len(d["returns"]) == 264,
    "no problems": d["problems"] == [],
    "dry run wrote nothing": d["applied"] is False,
}
for k, v in checks.items(): print(("OK  " if v else "FAIL") + " dry run: " + k)
sys.exit(0 if all(checks.values()) else 1)
EOF

  python3 scripts/restate_market_daily.py --db data/macro_radar.db --spy-splice --apply --report "$RUN/restate-apply.json" | tee "$RUN/apply.out"
  local snaps=(data/macro_radar.pre-restate-*.db)
  [ "${#snaps[@]}" -eq 1 ] && [ -f "${snaps[0]}" ] || die "expected exactly one pre-restate snapshot"
  local snap="${snaps[0]}"
  [ "$(sha "$snap")" = "$orig" ] || die "the snapshot is not byte-identical to the published file"
  echo "SNAP=$snap" > "$RUN/state.env"
  python3 - "$RUN/restate-apply.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
ok = d["applied"] is True and len(d["rows"]) == 7916 and all(r["changed"] for r in d["rows"]) and d["problems"] == []
print(("OK  " if ok else "FAIL") + " apply: 7,916 rows written, no problems")
sys.exit(0 if ok else 1)
EOF

  python3 scripts/restate_impact.py --before "$snap" --after data/macro_radar.db --report "$RUN/impact.json" | tee "$RUN/impact.out"
  python3 - "$RUN/impact.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1])); ds = r["downstream"]
sp = ds["surprise"]
checks = {
    "prices: 7,916 rows changed, none on one side only": r["prices"]["rows_changed"] == 7916 and r["prices"]["rows_only_on_one_side"] == 0,
    "returns: 264 changed": r["returns"]["changed"] == 264,
    "surprise: 1,831 rows, SPY weekly return 131 and z-score 1,700 only":
        sp.get("rows_changed") == 1831 and {k: v["rows_changed"] for k, v in sp["by_name"].items()} == {"SPY_weekly_ret": 131, "SPY_weekly_ret_z": 1700},
    "backtest: 0 of 144 rows changed": ds["backtest"].get("rows_changed") == 0 and ds["backtest"].get("rows_compared") == 144,
    "risk: 0 of 3 rows changed": ds["risk"].get("rows_changed") == 0 and ds["risk"].get("rows_compared") == 3,
    "garch: the known loader error on both sides (backlog W-6)": "error_before" in ds["garch"] and "error_after" in ds["garch"],
}
for k, v in checks.items(): print(("OK  " if v else "FAIL") + " impact: " + k)
sys.exit(0 if all(checks.values()) else 1)
EOF

  python3 -m src.analytics.surprise | tee "$RUN/surprise.out"
  python3 - "$snap" data/macro_radar.db <<'EOF'
import contextlib, sqlite3, sys
import pandas as pd
def dm(p):
    with contextlib.closing(sqlite3.connect(f"file:{p}?mode=ro", uri=True)) as c:
        return pd.read_sql("SELECT name, date, value FROM derived_metrics", c)
m = dm(sys.argv[1]).merge(dm(sys.argv[2]), on=["name", "date"], how="outer", suffixes=("_before", "_after"), indicator=True)
ch = m[(m["_merge"] != "both") | ((m["value_after"] - m["value_before"]).abs() > 1e-6)]
by = ch.groupby("name").size().to_dict()
ok = len(ch) == 1831 and by == {"SPY_weekly_ret": 131, "SPY_weekly_ret_z": 1700}
print(("OK  " if ok else "FAIL") + f" derived_metrics write: {len(ch)} rows changed {by}")
sys.exit(0 if ok else 1)
EOF

  python3 scripts/validate_db.py data/macro_radar.db --previous "$snap" --mode market-only --json "$RUN/validation-report.json" | tee "$RUN/validate.out"
  grep -q -- "- Changed vs previous: yes (market_daily)" "$RUN/validate.out" || die "validation: expected market_daily as the only change"
  grep -q -- "- Upload: yes" "$RUN/validate.out" || die "validation: upload is not yes"
  grep -q "^| cross_table " "$RUN/validate.out" && die "validation: cross_table flags remain"
  awk -F'|' '/^\| (jump|spike|stale|stale_run|off_calendar|gap|split) /{ if ($4+0 != 0 || $5+0 != 0) bad=1 } END { exit bad }' "$RUN/validate.out" \
    || die "validation: a price-quality check shows a new or high-severity flag"
  ok "validation passed, no new flags"

  python3 scripts/validation_asset.py "$RUN/validation-report.json" data/macro_radar.db "$RUN/publish/validation.json"
  python3 scripts/build_snapshot.py --db data/macro_radar.db --out "$RUN/publish/snapshot-latest.json" > "$RUN/snapshot.out" 2>&1
  # The baseline is a snapshot built now, by this code, from a copy of the original file: the published
  # snapshot-latest.json comes only from full refreshes, so it is usually older than the published database.
  mkdir "$RUN/snapshot-baseline" && cp "$snap" "$RUN/snapshot-baseline/macro_radar.db"   # same file name: the snapshot records it
  python3 scripts/build_snapshot.py --db "$RUN/snapshot-baseline/macro_radar.db" --out "$RUN/snapshot-from-original.json" > "$RUN/snapshot-baseline.out" 2>&1
  rm -rf "$RUN/snapshot-baseline"
  [ ! -s data/macro_radar.db-wal ] || die "the database has an unmerged WAL; stop"
  cp data/macro_radar.db "$RUN/publish/macro_radar.db"
  local new; new=$(sha "$RUN/publish/macro_radar.db")
  [ "$new" = "$(verdict_sha "$RUN/publish/validation.json")" ] || die "verdict does not match the database copy"
  python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); sys.exit(0 if v["verdict"]=="pass" else 1)' "$RUN/publish/validation.json" \
    || die "verdict is not pass"
  echo "$new" > "$RUN/sha-new.txt"
  python3 - "$RUN/snapshot-from-original.json" "$RUN/publish/snapshot-latest.json" <<'EOF'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
ALLOWED_LEAVES = {"generated_at", "db_mtime", "built_at", "last_attempt_at", "local_time", "db_size"}
def walk(x, y, p=""):
    if isinstance(x, dict) and isinstance(y, dict):
        for k in sorted(set(x) | set(y)): yield from walk(x.get(k), y.get(k), f"{p}/{k}")
    elif isinstance(x, list) and isinstance(y, list) and len(x) == len(y):
        for i, (u, v) in enumerate(zip(x, y)): yield from walk(u, v, f"{p}[{i}]")
    elif isinstance(x, float) and isinstance(y, float):
        if abs(x - y) > 1e-6: yield (p, x, y)
    elif x != y: yield (p, x, y)
bad = []
for p, x, y in walk(a, b):
    leaf = p.rsplit("/", 1)[-1]
    if leaf in ALLOWED_LEAVES: continue
    bad.append((p, str(x)[:80], str(y)[:80]))
for r in bad: print("FAIL snapshot differs:", r)
print(("OK  " if not bad else "FAIL") + " snapshot: against one built from the original file, only timestamps and size differ")
sys.exit(0 if not bad else 1)
EOF
  require_paused_and_drained
  local a; for a in "${ASSETS[@]}"; do echo "$a $(sha "$RUN/publish/$a")"; done > "$RUN/prepared.tmp"
  mv "$RUN/prepared.tmp" "$RUN/prepared.ok"   # written last: only a prepare that passed every check leaves it
  ok "publish set ready in $RUN/publish (database $new); nothing uploaded"
}

begin_mutation() {  # before any upload: the release may be partial until the whole set is verified again
  [ "${REHEARSAL:-0}" = "1" ] && return 0
  echo "$1 $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RUN/mutation-open"
  rm -f "$RUN/assets-after.tsv" "$RUN/rolled-back.ok"   # any earlier verification no longer describes the release
}
end_mutation() { rm -f "$RUN/mutation-open"; }  # only after the whole published or restored set is verified

publish_remaining() {  # uploads whichever of the three files is not yet ours, database first
  local a
  for a in "${ASSETS[@]}"; do
    if [ -e "$RUN/uploaded-$a" ]; then echo "already uploaded: $a"; continue; fi
    begin_mutation publish
    ghw release upload data-latest "$RUN/publish/$a" --repo "$REPO" --clobber || die "the upload of $a failed; run recover"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$RUN/uploaded-$a"
  done
}

cmd_publish() {
  need_run
  need_prepared "nothing uploaded; run prepare in a fresh RUN"
  { ls "$RUN"/uploaded-* >/dev/null 2>&1 || [ -e "$RUN/mutation-open" ]; } && die "publish already started here; use recover"
  require_paused_and_drained
  local now; now=$(assets_tsv) || die "could not read the release listing; nothing uploaded"
  if [ "$now" != "$(cat "$RUN/assets-before.tsv")" ]; then
    diff "$RUN/assets-before.tsv" - <<< "$now" || true
    die "the release changed since prepare; nothing uploaded; start again with a fresh RUN"
  fi
  publish_remaining
  [ "${REHEARSAL:-0}" = "1" ] && { ok "rehearsal: nothing uploaded"; return; }
  verify_published
}

verify_published() {
  local v t a; v="$RUN/verify/$(date -u +%Y%m%dT%H%M%SZ)"
  t=$(download_set "$v") || die "could not read back the published set completely; run recover"
  for a in "${ASSETS[@]}"; do
    same_file "$v/$a" "$RUN/publish/$a" || die "published $a is not the prepared file; run recover"
  done
  printf '%s\n' "$t" > "$RUN/assets-after.tsv"
  end_mutation
  ok "published set is the prepared database, verdict and snapshot ($(cat "$RUN/sha-new.txt"))"
}

cmd_resume() {
  need_run
  [ -s "$RUN/workflow-states-before.tsv" ] || die "no recorded states"
  if [ "${REHEARSAL:-0}" != "1" ] && [ -e "$RUN/mutation-open" ]; then
    die "an upload ($(cut -d' ' -f1 "$RUN/mutation-open")) started here and the whole set was not verified since; run recover or rollback first, so no writer runs on a partial set"
  fi
  local p s
  while IFS=$'\t' read -r p s; do
    if [ "$s" = "active" ]; then ghw workflow enable "$(basename "$p")" --repo "$REPO" || die "could not enable $p; run resume again"
    else echo "left as recorded: $p $s"; fi
  done < "$RUN/workflow-states-before.tsv"
  [ "${REHEARSAL:-0}" = "1" ] && return
  s=$(writer_states) || die "could not read the writers' states back; run resume again"
  [ "$s" = "$(cat "$RUN/workflow-states-before.tsv")" ] || { printf '%s\n' "$s"; die "writer states differ from the recorded ones"; }
  ok "writers restored to their recorded states"
}

cmd_verify_api() {
  need_run
  [ -n "${API_URL:-}" ] || die "set API_URL to the API's base URL, e.g. https://<api-host>"
  [ -s "$RUN/assets-after.tsv" ] || die "run publish first"
  local start; start=$(date +%s)
  while :; do
    if python3 - "${API_URL%/}" "$RUN" <<'EOF'
import json, sys, urllib.request
base, run = sys.argv[1], sys.argv[2]
def get(path):
    with urllib.request.urlopen(base + path, timeout=60) as r: return json.load(r)
db_row = next(l.rstrip("\n").split("\t") for l in open(f"{run}/assets-after.tsv") if l.startswith("macro_radar.db\t"))
size, updated = int(db_row[1]), db_row[2]
f = get("/api/freshness"); b = f.get("bootstrap") or {}; g = f.get("generation") or {}
p = get("/api/desk/pipeline")
checks = {
    "the API holds the uploaded asset (size and updated_at)": b.get("asset_size") == size and b.get("asset_updated_at") == updated,
    "the serving generation was built after the upload": (g.get("built_at") or "") >= updated,
    "the serving generation's verdict is the published pass (data.validation)": p.get("status") == "ready" and (p.get("data") or {}).get("validation") == "pass",
}
apply = json.load(open(f"{run}/restate-apply.json"))
want = {(r["symbol"], r["date"]): r["provider_close"] for r in apply["rows"]
        if (r["symbol"], r["date"]) in {("USO", "2026-09-01"), ("SPY", "2024-02-23"), ("SPY", "2024-02-26")}}
ret = next(x["after_pct"] for x in apply["returns"] if (x["symbol"], x["date"]) == ("SPY", "2024-02-27"))
bars = get("/api/market/daily?symbols=SPY,USO&days=1100")
got = {(x["symbol"], x["date"]): x for x in bars}
checks["served closes equal the restated provider closes (USO 2026-09-01, SPY 2024-02-23 and 02-26)"] = \
    len(want) == 3 and all(k in got and abs(got[k]["close"] - v) < 1e-6 for k, v in want.items())
spy27 = got.get(("SPY", "2024-02-27"), {}).get("ret_1d")
checks[f"served SPY return on 2024-02-27 is the restated {ret:+.2f}% (was +2.66%)"] = spy27 is not None and abs(spy27 - ret) < 1e-6
for k, v in checks.items(): print(("OK  " if v else "WAIT") + " " + k)
print("generation", g.get("id"), g.get("built_at"), "pipeline", p.get("generation_id"))
sys.exit(0 if all(checks.values()) else 3)
EOF
    then ok "the API serves the corrected file"; break; fi
    [ $(( $(date +%s) - start )) -lt $((ADOPT_TIMEOUT_MIN * 60)) ] || die "not adopted after $ADOPT_TIMEOUT_MIN min; send me $RUN"
    sleep 120
  done
}

cmd_verify_persist() {
  need_run
  [ -s "$RUN/assets-after.tsv" ] && [ -s "$RUN/uploaded-macro_radar.db" ] || die "run publish first"
  local since done_runs db_then db_now listing
  since=$(cat "$RUN/uploaded-macro_radar.db")
  done_runs=$(completed_since "$since") || die "could not read the writers' runs; try again"
  [ "$done_runs" -ge 1 ] || die "no writer run has completed since the upload at $since; try again later"
  db_then=$(awk -F'\t' '$1=="macro_radar.db"{print $3}' "$RUN/assets-after.tsv")
  listing=$(assets_tsv) || die "could not read the release listing; try again"
  db_now=$(awk -F'\t' '$1=="macro_radar.db"{print $3}' <<< "$listing")
  [ -n "$db_then" ] && [ -n "$db_now" ] && [ "$db_now" \> "$db_then" ] \
    || die "no writer has published a newer database since $db_then; try again after the next refresh"
  local v; v="$RUN/verify/persist-$(date -u +%Y%m%dT%H%M%SZ)"
  download_set "$v" > "$v.listing.tsv" || die "could not download the published set completely; try again"
  python3 scripts/restate_market_daily.py --db "$v/macro_radar.db" --spy-splice | tee "$v/dry.out"
  grep -q "^0 of 7916 target rows differ" "$v/dry.out" || die "the published file no longer carries the correction"
  python3 - "$v/macro_radar.db" <<'EOF'
import contextlib, sqlite3, sys
with contextlib.closing(sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)) as c:
    r = dict(c.execute("SELECT name, value FROM derived_metrics WHERE date='2024-03-01' AND name IN ('SPY_weekly_ret','SPY_weekly_ret_z')").fetchall())
ok = abs(r["SPY_weekly_ret"] - 0.00985) < 5e-4 and abs(r["SPY_weekly_ret_z"] - 0.306) < 0.05
print(("OK  " if ok else "FAIL") + f" week ending 2024-03-01: SPY_weekly_ret {r['SPY_weekly_ret']:.5f} (expect 0.00985), z {r['SPY_weekly_ret_z']:.3f} (expect 0.306)")
sys.exit(0 if ok else 1)
EOF
  ok "the correction persisted through a writer run"
}

classify_one() {  # classify_one <folder> <name>: ours, original or other, by hash
  local s ours orig
  s=$(sha "$1/$2") && ours=$(sha "$RUN/publish/$2") && orig=$(sha "$RUN/published/$2") || return 1
  if [ "$s" = "$ours" ]; then echo "$2 ours"
  elif [ "$s" = "$orig" ]; then echo "$2 original"
  else echo "$2 other"; fi
}

fetch_classified() {  # fetch_classified <folder>: each published file is ours, original, missing or other
  # "missing" comes only from a complete listing that has no such asset. A present asset must download whole
  # (its size equals the listing's), and the listing must be the same after the downloads. Anything else stops.
  local v="$1" t1 t2 a size cls n=0
  mkdir -p "$v"; : > "$v/classification.txt"
  t1=$(assets_tsv) || die "could not read the release listing; nothing uploaded"
  printf '%s\n' "$t1" > "$v/assets.tsv"
  for a in "${ASSETS[@]}"; do
    size=$(asset_size "$t1" "$a")
    if [ -z "$size" ]; then echo "$a missing" >> "$v/classification.txt"; continue; fi
    download_one "$t1" "$a" "$v" || die "could not read the published $a completely; nothing uploaded"
    cls=$(classify_one "$v" "$a") || die "could not hash $a; nothing uploaded"
    echo "$cls" >> "$v/classification.txt"
  done
  t2=$(assets_tsv) || die "could not read the release listing again; nothing uploaded"
  [ "$t1" = "$t2" ] || die "the release changed while it was being read; nothing uploaded"
  cat "$v/classification.txt"
  while read -r a cls; do
    n=$((n + 1))
    case "$cls" in
      ours|original|missing) ;;
      other) die "$a is neither ours nor the original: newer data. Nothing uploaded; leave the writers paused and send me $RUN" ;;
      *) die "unexpected classification for $a; nothing uploaded" ;;
    esac
  done < "$v/classification.txt"
  [ "$n" -eq "${#ASSETS[@]}" ] || die "classification incomplete; nothing uploaded"
}
classified_as() {  # classified_as <folder> <name> <class>
  local a cls
  while read -r a cls; do [ "$a" = "$2" ] && [ "$cls" = "$3" ] && return 0; done < "$1/classification.txt"
  return 1
}

cmd_recover() {  # finish a publish that stopped partway
  need_run
  need_prepared "nothing to recover, and nothing uploaded"
  require_paused_and_drained
  local v; v="$RUN/verify/recover-$(date -u +%Y%m%dT%H%M%SZ)"
  fetch_classified "$v"
  # Each file is now ours, the original, or absent from a complete listing (a --clobber upload deletes the old
  # asset before it uploads). Writers are confirmed paused and nothing newer is published, so finishing cannot
  # overwrite newer data.
  rm -f "$RUN"/uploaded-*
  local a
  for a in "${ASSETS[@]}"; do
    if classified_as "$v" "$a" ours; then date -u +%Y-%m-%dT%H:%M:%SZ > "$RUN/uploaded-$a"; fi
  done
  publish_remaining
  [ "${REHEARSAL:-0}" = "1" ] && return
  verify_published
}

cmd_rollback() {  # put the original set back; also finishes a rollback that stopped partway
  need_run
  need_prepared "nothing to roll back, and nothing uploaded"
  require_paused_and_drained
  local v; v="$RUN/verify/rollback-$(date -u +%Y%m%dT%H%M%SZ)"
  fetch_classified "$v"
  local a
  for a in "${ASSETS[@]}"; do
    if classified_as "$v" "$a" original; then echo "already original: $a"; continue; fi
    begin_mutation rollback
    ghw release upload data-latest "$RUN/published/$a" --repo "$REPO" --clobber || die "the upload of the original $a failed; run rollback again"
  done
  [ "${REHEARSAL:-0}" = "1" ] && return
  local w; w="$RUN/verify/rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"
  download_set "$w" > "$w.listing.tsv" || die "could not read back the restored set completely; run rollback again"
  for a in "${ASSETS[@]}"; do same_file "$w/$a" "$RUN/published/$a" || die "restored $a does not match the original"; done
  date -u +%Y-%m-%dT%H:%M:%SZ > "$RUN/rolled-back.ok"
  end_mutation
  ok "original set restored; now run resume"
}

case "${1:-}" in
  init) cmd_init ;;
  pause) cmd_pause ;;
  prepare) cmd_prepare ;;
  publish) cmd_publish ;;
  resume) cmd_resume ;;
  verify-api) cmd_verify_api ;;
  verify-persist) cmd_verify_persist ;;
  recover) cmd_recover ;;
  rollback) cmd_rollback ;;
  *) sed -n '2,32p' "$0"; exit 2 ;;
esac
