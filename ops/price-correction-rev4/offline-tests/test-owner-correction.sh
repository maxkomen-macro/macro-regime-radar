#!/usr/bin/env bash
# Offline tests for owner-correction.sh's GitHub-facing phases (pause, the first reads of prepare, publish,
# resume, recover, rollback). A mock gh (mock/gh) stands in for GitHub; it records every upload
# and workflow change. No network is used: run it as
#   unshare -rn bash test-owner-correction.sh <path to owner-correction.sh>
# (or plain bash on a machine without unshare: gh is replaced by the mock, so nothing reaches GitHub). Needs python3.
# The mock needs jq only for scripts that call gh with --jq (rev 3). All file contents are invented test bytes.
set -u
SCRIPT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAILN=0; FAILED=()

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

fresh() {  # fresh <db state> <verdict state> <snapshot state>; each state: original | ours | other | absent
  T="$(mktemp -d)"; export MOCK_GH_DIR="$T/gh"; mkdir -p "$MOCK_GH_DIR/assets" "$MOCK_GH_DIR/fail" "$MOCK_GH_DIR/runs" "$T/bin" "$T/cwd"
  printf '#!/bin/sh\nexec python3 "%s" "$@"\n' "$HERE/mock/gh" > "$T/bin/gh"; chmod +x "$T/bin/gh"   # works even where the copy lost its exec bit
  export PATH="$T/bin:$BASE_PATH"
  export RUN="$T/run"; mkdir -p "$RUN/published" "$RUN/publish" "$RUN/verify"
  printf 'ORIGINAL DATABASE: synthetic test bytes, not market data\n%.0s' {1..40} > "$RUN/published/macro_radar.db"
  printf 'CORRECTED DATABASE: synthetic test bytes, not market data\n%.0s' {1..40} > "$RUN/publish/macro_radar.db"
  printf '{"verdict": "pass", "mode": "market-only", "db_sha256": "%s"}\n' "$(sha "$RUN/published/macro_radar.db")" > "$RUN/published/validation.json"
  printf '{"verdict": "pass", "mode": "market-only", "db_sha256": "%s"}\n' "$(sha "$RUN/publish/macro_radar.db")" > "$RUN/publish/validation.json"
  printf '{"synthetic": "snapshot built from the original test database"}\n' > "$RUN/published/snapshot-latest.json"
  printf '{"synthetic": "snapshot built from the corrected test database"}\n' > "$RUN/publish/snapshot-latest.json"
  sha "$RUN/published/macro_radar.db" > "$RUN/sha-original.txt"; sha "$RUN/publish/macro_radar.db" > "$RUN/sha-new.txt"
  for n in macro_radar.db validation.json snapshot-latest.json; do echo "$n $(sha "$RUN/publish/$n")"; done > "$RUN/prepared.ok"   # a prepare that passed every check
  local i=0 st n; local names=(macro_radar.db validation.json snapshot-latest.json)
  for st in "$1" "$2" "$3"; do
    n="${names[$i]}"; i=$((i + 1))
    case "$st" in
      original) cp "$RUN/published/$n" "$MOCK_GH_DIR/assets/$n" ;;
      ours) cp "$RUN/publish/$n" "$MOCK_GH_DIR/assets/$n" ;;
      other) printf 'NEWER FILE FROM A WRITER RUN (synthetic)\n' > "$MOCK_GH_DIR/assets/$n" ;;
      absent) continue ;;
    esac
    echo "2026-11-05T22:15:2${i}Z 50${i}" > "$MOCK_GH_DIR/assets/$n.meta"
  done
  printf 'ignored-other-asset\n' > "$MOCK_GH_DIR/assets/refresh-status.json"; echo "2026-11-05T18:53:07Z 600" > "$MOCK_GH_DIR/assets/refresh-status.json.meta"
  writers disabled_manually disabled_manually
  printf '.github/workflows/intraday-refresh.yml\tactive\n.github/workflows/refresh-data.yml\tactive\n' > "$RUN/workflow-states-before.tsv"
  gh api repos/maxkomen-macro/macro-regime-radar/releases/tags/data-latest | python3 -c '
import json, sys
for a in sorted(json.load(sys.stdin)["assets"], key=lambda a: a["name"]): print(a["name"], a["size"], a["updated_at"], a["id"], sep="\t")' > "$RUN/assets-before.tsv"
  : > "$MOCK_GH_DIR/calls.log"
}
writers() {  # writers <refresh-data state> <intraday state>
  printf '.github/workflows/refresh-data.yml\t%s\n.github/workflows/intraday-refresh.yml\t%s\n.github/workflows/daily-memo.yml\tactive\n.github/workflows/keep-api-warm.yml\tactive\n' "$1" "$2" > "$MOCK_GH_DIR/workflows.tsv"
}
fail() { : > "$MOCK_GH_DIR/fail/$1"; }
runs() { echo "[{\"status\": \"$2\", \"createdAt\": \"2026-11-06T06:00:00Z\"}]" > "$MOCK_GH_DIR/runs/$1.json"; }
uploads() { if [ -f "$MOCK_GH_DIR/uploads.log" ]; then tr '\n' ' ' < "$MOCK_GH_DIR/uploads.log" | sed 's/ $//'; fi; }
changes() { if [ -f "$MOCK_GH_DIR/workflow-changes.log" ]; then tr '\n' ';' < "$MOCK_GH_DIR/workflow-changes.log"; fi; }
state() {  # the release as "db verdict snapshot" classes
  local n out=""
  for n in macro_radar.db validation.json snapshot-latest.json; do
    if [ ! -f "$MOCK_GH_DIR/assets/$n" ]; then out="$out absent"
    elif [ "$(sha "$MOCK_GH_DIR/assets/$n")" = "$(sha "$RUN/publish/$n")" ]; then out="$out ours"
    elif [ "$(sha "$MOCK_GH_DIR/assets/$n")" = "$(sha "$RUN/published/$n")" ]; then out="$out original"
    else out="$out other"; fi
  done
  echo "${out# }"
}
run() { (cd "$T/cwd" && POLL_SEC=0 bash "$SCRIPT" "$1") > "$T/out.txt" 2>&1; RC=$?; }
check() {  # check <id> <description> <condition result 0/1> <detail>
  if [ "$3" -eq 0 ]; then PASS=$((PASS + 1)); echo "PASS $1 $2"
  else FAILN=$((FAILN + 1)); FAILED+=("$1"); echo "FAIL $1 $2 :: $4"; sed 's/^/       | /' "$T/out.txt" | tail -6; fi
}
stops_without_upload() {  # stops_without_upload <id> <description>
  local u; u="$(uploads)"
  # a stop caused by a broken stand-in is not a pass (the setup check at the top also proves the stand-in runs)
  [ "$RC" -ne 0 ] && [ -z "$u" ] && ! grep -qE "bad interpreter|command not found|mock gh: unhandled" "$T/out.txt"
  check "$1" "$2" $? "rc=$RC uploads=[$u] release=[$(state)]"
  [ "$RC" -ne 0 ] && echo "       stopped with: $(grep -m1 -E '^(STOP|STOPPED)' "$T/out.txt")"
}

BASE_PATH="$PATH"
echo "script under test: $SCRIPT ($(sha "$SCRIPT"))"
fresh original original original
gh auth status && [ "$(gh api repos/x/y/releases/tags/data-latest | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["assets"]))')" = 4 ] \
  || { echo "SETUP FAILED: the gh stand-in does not run here; no result below would mean anything"; exit 2; }
echo "== 1. failed or incomplete reads stop safely"

fresh original original original; fail release; run recover
stops_without_upload F01 "recover: release listing read fails"
fresh original original original; fail release-garbled; run recover
stops_without_upload F02 "recover: release listing is truncated JSON"
fresh original original original; fail download-macro_radar.db; run recover
stops_without_upload F03 "recover: download of a present database fails (timeout)"
fresh ours original original; fail truncate-validation.json; run recover
stops_without_upload F04 "recover: download of a present verdict is incomplete"
fresh ours ours ours; fail download-snapshot-latest.json; run rollback
stops_without_upload F05 "rollback: download of a present snapshot fails"
fresh ours ours ours; fail release; run rollback
stops_without_upload F06 "rollback: release listing read fails"
fresh ours ours ours; fail truncate-macro_radar.db; run rollback
stops_without_upload F07 "rollback: download of a present database is incomplete"
fresh original original original; fail release; run publish
stops_without_upload F08 "publish: release listing read fails"
fresh original original original; fail workflows; run recover
stops_without_upload F09 "recover: writer-state read fails (permission error)"
fresh ours ours ours; fail workflows-garbled; run rollback
stops_without_upload F10 "rollback: writer-state read is truncated JSON"
fresh original original original; fail workflows-one; run publish
stops_without_upload F11 "publish: writer-state read lists only one writer"
fresh original original original; fail workflows; run publish
stops_without_upload F12 "publish: writer-state read fails"
fresh original original original; fail runs; run recover
stops_without_upload F13 "recover: run listing read fails"
fresh ours ours ours; fail runs; run rollback
stops_without_upload F14 "rollback: run listing read fails"
fresh original original original; fail release-mutate-after-2; run recover
stops_without_upload F15 "recover: release changes between the listing and the downloads"
fresh original original original; rm -f "$RUN/assets-before.tsv" "$RUN/sha-new.txt"; fail download-validation.json; run prepare
[ "$RC" -ne 0 ] && [ ! -e "$RUN/assets-before.tsv" ] && [ -z "$(uploads)" ]
check F16 "prepare: download of the verdict fails before anything is recorded" $? "rc=$RC"
fresh original original original; rm -f "$RUN/assets-before.tsv" "$RUN/sha-new.txt"; fail workflows; run prepare
[ "$RC" -ne 0 ] && [ ! -e "$RUN/assets-before.tsv" ]
check F17 "prepare: writer-state read fails before the download" $? "rc=$RC"
fresh original original original; rm -f "$RUN/workflow-states-before.tsv"; writers active active; fail workflows; run pause
[ "$RC" -ne 0 ] && [ ! -s "$RUN/workflow-states-before.tsv" ] && [ -z "$(changes)" ]
check F18 "pause: writer-state read fails, nothing recorded or disabled" $? "rc=$RC changes=[$(changes)]"
fresh original original original; rm -f "$RUN/workflow-states-before.tsv"; writers active active; fail runs; run pause
[ "$RC" -ne 0 ] && grep -q "could not read the writers' runs" "$T/out.txt"
check F19 "pause: run listing fails after disabling, stops instead of reporting drained" $? "rc=$RC"
fresh original original original; fail workflows; run resume
[ "$RC" -ne 0 ]
check F20 "resume: writer-state read-back fails, does not report restored" $? "rc=$RC"

echo "== 2. absent assets come only from a complete listing"
fresh ours original absent; run recover
[ "$RC" -eq 0 ] && [ "$(uploads)" = "validation.json snapshot-latest.json" ] && [ "$(state)" = "ours ours ours" ]
check A01 "recover: snapshot absent from a complete listing is uploaded, verdict replaced, database kept" $? "rc=$RC uploads=[$(uploads)] release=[$(state)]"
fresh original ours absent; run rollback
[ "$RC" -eq 0 ] && [ "$(uploads)" = "validation.json snapshot-latest.json" ] && [ "$(state)" = "original original original" ]
check A02 "rollback: absent snapshot and our verdict restored, original database kept" $? "rc=$RC uploads=[$(uploads)] release=[$(state)]"
fresh absent absent absent; run recover
[ "$RC" -eq 0 ] && [ "$(uploads)" = "macro_radar.db validation.json snapshot-latest.json" ] && [ "$(state)" = "ours ours ours" ]
check A03 "recover: all three absent from a complete listing, all uploaded database first" $? "rc=$RC uploads=[$(uploads)]"

echo "== 3. an unknown or newer published file causes zero uploads"
fresh other original original; run recover
stops_without_upload N01 "recover: database is newer data"
fresh ours ours other; run rollback
stops_without_upload N02 "rollback: snapshot is newer data"
fresh ours other absent; run recover
stops_without_upload N03 "recover: verdict is newer data, snapshot absent"
fresh original original original; printf 'NEWER (synthetic)\n' > "$MOCK_GH_DIR/assets/macro_radar.db"; echo "2026-11-06T06:41:00Z 777" > "$MOCK_GH_DIR/assets/macro_radar.db.meta"; run publish
stops_without_upload N04 "publish: release changed since prepare"

echo "== 4. writers positively confirmed paused and drained"
fresh original original original; writers active disabled_manually; run publish
stops_without_upload P01 "publish: refresh-data still active"
fresh original original original; writers disabled_manually active; run recover
stops_without_upload P02 "recover: intraday-refresh still active"
fresh ours ours ours; writers active active; run rollback
stops_without_upload P03 "rollback: both writers active"
fresh original original original; runs refresh-data.yml in_progress; run publish
stops_without_upload P04 "publish: a refresh-data run in progress"
fresh original original original; runs intraday-refresh.yml queued; run recover
stops_without_upload P05 "recover: an intraday run queued"
fresh ours ours ours; runs refresh-data.yml waiting; run rollback
stops_without_upload P06 "rollback: a refresh-data run waiting"
fresh original original original
python3 -c 'import json; print(json.dumps([{"status": "completed", "createdAt": "2026-11-06T06:%02d:00Z" % (59 - i)} for i in range(50)] + [{"status": "queued", "createdAt": "2026-11-06T05:00:00Z"}]))' > "$MOCK_GH_DIR/runs/intraday-refresh.yml.json"
run publish
stops_without_upload P10 "publish: an older queued run behind 50 completed ones still counts as open"
fresh ours ours ours; fail runs-garbled; run rollback
stops_without_upload P11 "rollback: run listing is truncated JSON"
fresh original original original; mkdir -p "$MOCK_GH_DIR/runs-seq"; echo "pending pending queued queued queued queued queued queued queued queued queued queued queued queued" > "$MOCK_GH_DIR/runs-seq/intraday-refresh.yml"; run publish
stops_without_upload P12 "publish: a run moving from pending to queued during the check is still seen"
fresh original original original
python3 -c 'import json; print(json.dumps([{"status": "completed"} for i in range(1001)]))' > "$MOCK_GH_DIR/runs/refresh-data.yml.json"
run recover
stops_without_upload P13 "recover: more than 1,000 runs, so completeness cannot be established"
fresh original original original
python3 -c 'import json; print(json.dumps([{"status": "completed"} for i in range(1000)]))' > "$MOCK_GH_DIR/runs/intraday-refresh.yml.json"
run publish
stops_without_upload P16 "publish: exactly 1,000 runs (the API's cap) is not taken as complete"
fresh original original original
python3 -c 'import json; print(json.dumps([{"status": "completed"} for i in range(250)] + [{"status": "waiting"}]))' > "$MOCK_GH_DIR/runs/refresh-data.yml.json"
run publish
stops_without_upload P14 "publish: an open run on the third page of the listing is seen"
fresh original original original
python3 -c 'import json; print(json.dumps([{"status": "completed"} for i in range(250)]))' > "$MOCK_GH_DIR/runs/refresh-data.yml.json"
run publish
[ "$RC" -eq 0 ] && [ "$(uploads)" = "macro_radar.db validation.json snapshot-latest.json" ]
check P15 "publish: 250 completed runs over three pages count as drained" $? "rc=$RC uploads=[$(uploads)]"
fresh original original original; rm -f "$RUN/workflow-states-before.tsv"; writers active active; runs refresh-data.yml in_progress
(cd "$T/cwd" && POLL_SEC=0 DRAIN_TIMEOUT_MIN=0 bash "$SCRIPT" pause) > "$T/out.txt" 2>&1; RC=$?
[ "$RC" -ne 0 ] && [ "$(changes)" = "disable refresh-data.yml;disable intraday-refresh.yml;" ] && grep -q "still open" "$T/out.txt" \
  && [ "$(cat "$RUN/workflow-states-before.tsv")" = "$(printf '.github/workflows/intraday-refresh.yml\tactive\n.github/workflows/refresh-data.yml\tactive')" ]
check P07 "pause: records both active, disables both, refuses to report drained while a run is open" $? "rc=$RC changes=[$(changes)]"
fresh original original original; rm -f "$RUN/workflow-states-before.tsv"; writers active active; run pause
[ "$RC" -eq 0 ] && grep -q "OK: writers disabled and drained" "$T/out.txt"
check P08 "pause: both writers read back disabled and drained" $? "rc=$RC"
fresh original original original; writers active active; run pause
[ "$RC" -eq 0 ] && grep -q "kept for resume" "$T/out.txt" && grep -q "intraday-refresh.yml	active" "$RUN/workflow-states-before.tsv"
check P09 "pause again: keeps the first recorded states" $? "rc=$RC"

echo "== 6. a prepare that did not pass every check cannot be published"
fresh original original original; rm -f "$RUN/prepared.ok"; run publish
stops_without_upload G01 "publish: prepare stopped at a late check (publish set written, no completion marker)"
fresh ours original absent; rm -f "$RUN/prepared.ok"; run recover
stops_without_upload G02 "recover: prepare did not pass every check"
fresh ours ours ours; rm -f "$RUN/prepared.ok"; run rollback
stops_without_upload G03 "rollback: prepare did not pass every check"
fresh original original original; printf 'EDITED AFTER PREPARE (synthetic)\n' > "$RUN/publish/macro_radar.db"; run publish
stops_without_upload G04 "publish: the prepared database changed after prepare"
fresh original original original; printf '{"synthetic": "a different snapshot"}\n' > "$RUN/publish/snapshot-latest.json"; run publish
stops_without_upload G05 "publish: the prepared snapshot changed after prepare"
fresh ours ours ours; printf '{"verdict": "fail", "db_sha256": "%s"}\n' "$(sha "$RUN/publish/macro_radar.db")" > "$RUN/publish/validation.json"; run rollback
stops_without_upload G06 "rollback: the prepared verdict changed after prepare"
fresh ours original absent; printf '{"synthetic": "a different snapshot"}\n' > "$RUN/publish/snapshot-latest.json"; run recover
stops_without_upload G07 "recover: the prepared snapshot changed after prepare"

fresh original original original; writers disabled_manually disabled_manually; fail upload-validation.json; run publish; rm -f "$MOCK_GH_DIR/fail/upload-validation.json"; : > "$MOCK_GH_DIR/workflow-changes.log"; run resume
[ "$RC" -ne 0 ] && [ -z "$(changes)" ] && grep -q "was not verified" "$T/out.txt"
check G08 "resume: refuses after a partial publish, so no writer runs on a partial set" $? "rc=$RC changes=[$(changes)]"
fresh ours original absent; fail upload-snapshot-latest.json; run publish; rm -f "$MOCK_GH_DIR/fail/upload-snapshot-latest.json"; run rollback; r1=$RC; run resume
[ "$r1" -eq 0 ] && [ "$RC" -eq 0 ] && [ "$(changes)" = "enable intraday-refresh.yml;enable refresh-data.yml;" ] && [ "$(state)" = "original original original" ]
check G09 "resume: allowed once rollback has restored the original set" $? "rollback rc=$r1 resume rc=$RC changes=[$(changes)] release=[$(state)]"

fresh original original original; fail upload-macro_radar.db; run publish; r1=$RC; rm -f "$MOCK_GH_DIR/fail/upload-macro_radar.db"; run resume
[ "$r1" -ne 0 ] && [ "$RC" -ne 0 ] && [ -z "$(changes)" ] && grep -q "was not verified" "$T/out.txt"
check G10 "resume: refuses after the first upload fails (database deleted, no upload recorded)" $? "publish rc=$r1 resume rc=$RC changes=[$(changes)]"
fresh original original original; run publish; r1=$RC; fail upload-validation.json; run rollback; r2=$RC; rm -f "$MOCK_GH_DIR/fail/upload-validation.json"; run resume
[ "$r1" -eq 0 ] && [ "$r2" -ne 0 ] && [ "$RC" -ne 0 ] && [ -z "$(changes)" ]
check G11 "resume: refuses after a verified publish followed by a failed rollback upload" $? "publish rc=$r1 rollback rc=$r2 resume rc=$RC changes=[$(changes)] release=[$(state)]"
run rollback; r3=$RC; run resume
[ "$r3" -eq 0 ] && [ "$RC" -eq 0 ] && [ "$(state)" = "original original original" ] && [ "$(changes)" = "enable intraday-refresh.yml;enable refresh-data.yml;" ]
check G12 "rollback rerun finishes; resume is then allowed" $? "rollback rc=$r3 resume rc=$RC changes=[$(changes)] release=[$(state)]"
fresh original original original; fail upload-macro_radar.db; run publish; rm -f "$MOCK_GH_DIR/fail/upload-macro_radar.db"; : > "$MOCK_GH_DIR/uploads.log"; run publish
stops_without_upload G13 "publish rerun after a failed first upload stops and points to recover"
run recover; r1=$RC; run resume
[ "$r1" -eq 0 ] && [ "$RC" -eq 0 ] && [ "$(state)" = "ours ours ours" ]
check G14 "recover finishes the failed first upload; resume is then allowed" $? "recover rc=$r1 resume rc=$RC release=[$(state)]"

echo "== 5. the intended cases still work"
fresh original original original; run publish
[ "$RC" -eq 0 ] && [ "$(uploads)" = "macro_radar.db validation.json snapshot-latest.json" ] && [ "$(state)" = "ours ours ours" ] && [ -s "$RUN/assets-after.tsv" ]
check I01 "publish: database, verdict, snapshot in order, read back whole" $? "rc=$RC uploads=[$(uploads)] release=[$(state)]"
fresh original original original; fail upload-validation.json; run publish
r1=$RC; u1="$(uploads)"; s1="$(state)"; rm -f "$MOCK_GH_DIR/fail/upload-validation.json"; : > "$MOCK_GH_DIR/uploads.log"; run recover
[ "$r1" -ne 0 ] && [ "$u1" = "macro_radar.db validation.json" ] && [ "$s1" = "ours absent original" ] && [ "$RC" -eq 0 ] \
  && [ "$(uploads)" = "validation.json snapshot-latest.json" ] && [ "$(state)" = "ours ours ours" ]
check I02 "publish stops when an upload fails (verdict deleted by --clobber); recover finishes it" $? "publish rc=$r1 [$u1] [$s1]; recover rc=$RC [$(uploads)] [$(state)]"
fresh ours ours ours; run rollback
[ "$RC" -eq 0 ] && [ "$(uploads)" = "macro_radar.db validation.json snapshot-latest.json" ] && [ "$(state)" = "original original original" ]
check I03 "rollback: a completed publish is put back" $? "rc=$RC uploads=[$(uploads)] release=[$(state)]"
fresh original ours ours; run rollback
[ "$RC" -eq 0 ] && [ "$(uploads)" = "validation.json snapshot-latest.json" ] && [ "$(state)" = "original original original" ]
check I04 "rollback rerun: finishes a partial rollback" $? "rc=$RC uploads=[$(uploads)]"
fresh ours ours ours; run recover
[ "$RC" -eq 0 ] && [ -z "$(uploads)" ] && [ "$(state)" = "ours ours ours" ]
check I05 "recover: nothing to do when all three are ours" $? "rc=$RC uploads=[$(uploads)]"
fresh original original original; printf '.github/workflows/intraday-refresh.yml\tdisabled_manually\n.github/workflows/refresh-data.yml\tactive\n' > "$RUN/workflow-states-before.tsv"; run resume
[ "$RC" -eq 0 ] && [ "$(changes)" = "enable refresh-data.yml;" ]
check I06 "resume: re-enables only the writer recorded active, reads the states back" $? "rc=$RC changes=[$(changes)]"
fresh original original original; REHEARSAL=1 run publish
[ "$RC" -eq 0 ] && [ -z "$(uploads)" ]
check I07 "publish with REHEARSAL=1 uploads nothing" $? "rc=$RC uploads=[$(uploads)]"
fresh original original original; writers active active; fail workflows; REHEARSAL=1 run publish
stops_without_upload I08 "REHEARSAL=1 still stops on a failed writer-state read"

echo
echo "$PASS passed, $FAILN failed${FAILED[*]:+: ${FAILED[*]}}"
[ "$FAILN" -eq 0 ]
