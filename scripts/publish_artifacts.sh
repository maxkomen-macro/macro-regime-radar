#!/usr/bin/env bash
# Publish generated files to main without committing the runner's checkout.
#
#   scripts/publish_artifacts.sh "<commit message>" <path> [<path> ...]
#
# The workflows that write to git (refresh-data, daily-memo, weekly-memo) used to
# commit in their own checkout, then `git fetch && git reset --soft origin/main &&
# git commit`. A soft reset keeps the runner's whole index from its checkout, so
# the commit's tree reverted every change merged to main while the run was in
# flight (2026-10-02 4bb6c39 undid desk/cap-weight; 2026-11-04 d9359019 undid
# #35 and #30).
#
# This script never commits the runner's checkout. Each attempt:
#   1. fetches main and checks out that exact commit in a fresh, temporary worktree;
#   2. copies in only the named generated files (each must be on ALLOWED below);
#   3. commits there, so the parent is the main just fetched and every other path
#      is main's own content;
#   4. checks that the new commit has exactly that one parent and changes only the
#      named files (a failure here stops the script; it is never retried);
#   5. pushes without force. If main moved since the fetch the push is rejected,
#      and the next attempt rebuilds the commit on the newer main.
# Five attempts with a 5-14 s random backoff, as before; each fetch and push is
# cut off after NET_TIMEOUT (60 s, killed 10 s later), so the script ends within
# about 5 x (2 x 70 s) + 4 x 14 s = 13 minutes, inside the workflow step's
# 15-minute timeout. A file that already matches main makes no commit and
# exits 0. Before committing, every staged file must be a regular file whose
# blob equals the generated file (a symlink or a directory on main at that path,
# or a symlinked parent directory, fails the check).
#
# Exit codes: 0 published or nothing to publish; 1 every attempt failed;
# 2 bad arguments; 3 the built commit failed its own check (nothing pushed).

set -uo pipefail

# The only files a workflow may publish to git. Adding one is a reviewed change.
ALLOWED=(
  "output/playbook.json"
  "docs/memo/daily_memo.html"
  "docs/memo/weekly_memo.html"
)
REMOTE="origin"
BRANCH="main"
ATTEMPTS=5
NET_TIMEOUT="${PUBLISH_ARTIFACTS_NET_TIMEOUT:-60}"   # seconds per fetch or push (the env var is for tests)
case "$NET_TIMEOUT" in ""|*[!0-9]*|0*) NET_TIMEOUT=60 ;; esac

die() { echo "publish_artifacts: $2" >&2; exit "$1"; }

[ "$#" -ge 2 ] || die 2 "usage: publish_artifacts.sh \"<commit message>\" <path> [<path> ...]"
MSG="$1"; shift
[ -n "$MSG" ] || die 2 "empty commit message"

# Only a run of main's own workflow may write to main: a run dispatched from
# another branch would otherwise publish that branch's output (the old step's
# push went to the run's own branch and was rejected).
if [ -n "${GITHUB_REF:-}" ] && [ "$GITHUB_REF" != "refs/heads/$BRANCH" ]; then
  die 2 "this run is on $GITHUB_REF, not refs/heads/$BRANCH; nothing published"
fi

SRC=$(git rev-parse --show-toplevel 2>/dev/null) || die 2 "not inside a git checkout"
cd "$SRC" || die 2 "cannot enter $SRC"

PATHS=()
for p in "$@"; do
  ok=no
  for a in "${ALLOWED[@]}"; do [ "$p" = "$a" ] && ok=yes; done
  [ "$ok" = yes ] || die 2 "'$p' is not an allowed generated file (${ALLOWED[*]})"
  for q in "${PATHS[@]+"${PATHS[@]}"}"; do [ "$q" = "$p" ] && die 2 "'$p' named twice"; done
  [ -f "$p" ] && [ ! -L "$p" ] || die 2 "'$p' is not a regular file in $SRC"
  PATHS+=("$p")
done

TMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SNAP=$(mktemp -d "$TMP_ROOT/publish-snap-XXXXXX") || die 1 "mktemp failed"
WT=""

remove_worktree() {
  if [ -n "$WT" ]; then
    git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git worktree prune >/dev/null 2>&1 || true
    WT=""
  fi
}
cleanup() { remove_worktree; rm -rf "$SNAP"; }
trap cleanup EXIT

# Snapshot the generated files once, so every attempt publishes the same bytes.
for p in "${PATHS[@]}"; do
  mkdir -p "$SNAP/$(dirname "$p")" && cp -p "$p" "$SNAP/$p" || die 1 "cannot snapshot $p"
done

# One attempt. Returns 0 on success (or nothing to publish), 1 to retry, 3 fatal.
attempt() {
  local base new parents changed f want p dir want_blob got
  timeout --kill-after=10 "$NET_TIMEOUT" \
    git fetch --no-tags --quiet "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH" || return 1
  base=$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$BRANCH^{commit}") || return 1

  WT=$(mktemp -d "$TMP_ROOT/publish-wt-XXXXXX") || return 1
  git worktree add --detach --quiet "$WT" "$base" || return 1
  for p in "${PATHS[@]}"; do
    # Never write through a link: every parent directory main has at this path
    # must be a real directory, and the file itself is replaced, not followed.
    dir=$(dirname "$p")
    while [ "$dir" != "." ]; do
      if [ -L "$WT/$dir" ] || { [ -e "$WT/$dir" ] && [ ! -d "$WT/$dir" ]; }; then
        echo "publish_artifacts: '$dir' on $BRANCH at ${base:0:12} is not a plain directory" >&2; return 3
      fi
      dir=$(dirname "$dir")
    done
    if [ -L "$WT/$p" ] || { [ -e "$WT/$p" ] && [ ! -f "$WT/$p" ]; }; then
      echo "publish_artifacts: '$p' on $BRANCH at ${base:0:12} is not a regular file" >&2; return 3
    fi
    mkdir -p "$WT/$(dirname "$p")" && rm -f "$WT/$p" && cp -p "$SNAP/$p" "$WT/$p" || return 1
  done
  git -C "$WT" add -- "${PATHS[@]}" || return 1

  # Each staged entry must be a regular file holding exactly the generated bytes.
  for p in "${PATHS[@]}"; do
    want_blob=$(git -C "$WT" hash-object --path="$p" -- "$SNAP/$p") || return 1
    got=$(git -C "$WT" ls-files --stage -- "$p")
    case "$got" in
      "100644 $want_blob 0"$'\t'"$p"|"100755 $want_blob 0"$'\t'"$p") ;;
      *) echo "publish_artifacts: staged '$p' is '$got', expected blob $want_blob" >&2; return 3 ;;
    esac
  done

  if git -C "$WT" diff --cached --quiet; then
    echo "Nothing to publish: ${PATHS[*]} already match $REMOTE/$BRANCH at ${base:0:12}"
    return 0
  fi
  git -C "$WT" commit --quiet --no-verify -m "$MSG" || return 1
  new=$(git -C "$WT" rev-parse HEAD) || return 1

  # The commit must sit directly on the fetched main and touch only the named files.
  parents=$(git rev-list --parents -n 1 "$new" | cut -d' ' -f2-)
  [ "$parents" = "$base" ] || { echo "publish_artifacts: commit $new has parents '$parents', expected $base" >&2; return 3; }
  changed=$(git diff --name-only --no-renames "$base" "$new") || return 1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    want=no
    for p in "${PATHS[@]}"; do [ "$f" = "$p" ] && want=yes; done
    [ "$want" = yes ] || { echo "publish_artifacts: commit $new changes '$f', which was not named" >&2; return 3; }
  done <<< "$changed"

  timeout --kill-after=10 "$NET_TIMEOUT" \
    git push --quiet "$REMOTE" "$new:refs/heads/$BRANCH" || return 1
  echo "Published ${PATHS[*]} as ${new:0:12} on ${base:0:12}"
  return 0
}

for i in $(seq 1 "$ATTEMPTS"); do
  attempt; rc=$?
  remove_worktree
  if [ "$rc" -eq 0 ]; then echo "Push succeeded on attempt $i"; exit 0; fi
  if [ "$rc" -eq 3 ]; then echo "publish_artifacts: refusing to push a commit that failed its check" >&2; exit 3; fi
  echo "Attempt $i failed (fetch/build/push), retrying on the current $REMOTE/$BRANCH..."
  if [ "$i" -lt "$ATTEMPTS" ] && [ "${PUBLISH_ARTIFACTS_NO_BACKOFF:-}" != "1" ]; then
    sleep $((RANDOM % 10 + 5))
  fi
done
echo "Push failed after $ATTEMPTS attempts"
exit 1
