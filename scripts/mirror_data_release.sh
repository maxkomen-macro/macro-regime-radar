#!/usr/bin/env bash
# Private storage cutover only (docs/data/PRIVATE_STORAGE.md, step 1).
#
# Copies the data repo's current data-latest files to this repo's data-latest,
# so readers not yet switched keep receiving them. It copies what the data repo
# holds now, not what this run built, so a mirror that failed on one run is
# repaired on the next even when nothing new was published. A file whose
# release digest already matches is left alone (no new asset id, so no reader
# re-downloads it). Order: database, snapshot, verdict, as on the primary.
#
# Env: DATA_RELEASE_REPO (the data repo), GITHUB_REPOSITORY (this repo),
# DATA_RELEASE_TOKEN (reads the data repo), GH_TOKEN (writes this repo).
# The earnings ledger is never touched: it lives on this repo only.
set -euo pipefail

SRC="${DATA_RELEASE_REPO:?DATA_RELEASE_REPO is not set}"
DST="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
FILES=(macro_radar.db snapshot-latest.json validation.json)

if [ "$SRC" = "$DST" ]; then
  echo "mirror: the data repo is this repo; nothing to mirror"
  exit 0
fi
SRC_TOKEN="${DATA_RELEASE_TOKEN:?the mirror reads the data repo with the DATA_RELEASE_TOKEN secret, which is not set}"
DST_TOKEN="${GH_TOKEN:?the mirror writes this repo with GH_TOKEN, which is not set}"

listing() {  # repo token -> "name<TAB>digest" lines; fails when the release cannot be listed
  GH_TOKEN="$2" gh api "repos/$1/releases/tags/data-latest" --jq '.assets[] | "\(.name)\t\(.digest // "")"'
}
digest_of() {  # listing name -> digest ("" when listed without one); fails when not listed
  awk -F'\t' -v n="$2" '$1 == n { print $2; found = 1 } END { exit !found }' <<<"$1"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

src_list="$(listing "$SRC" "$SRC_TOKEN")"
# This repo's release is created only when GitHub says it does not exist (404);
# any other failure (403, rate limit, 5xx) stops here with GitHub's own message.
if ! dst_list="$(listing "$DST" "$DST_TOKEN" 2>"$work/dst.err")"; then
  if ! grep -q "(HTTP 404)" "$work/dst.err"; then
    echo "mirror: could not list this repo's data-latest:" >&2
    cat "$work/dst.err" >&2
    exit 1
  fi
  GH_TOKEN="$DST_TOKEN" gh release create data-latest --repo "$DST" --title "Latest data snapshot" \
    --notes "Rolling SQLite snapshot published by the refresh workflows. Not stored in git history."
  dst_list=""
fi
copied=0
for name in "${FILES[@]}"; do
  if ! src_digest="$(digest_of "$src_list" "$name")"; then
    echo "mirror: $name is not on the data repo; skipped"
    continue
  fi
  dst_digest="$(digest_of "$dst_list" "$name" || true)"
  if [ -n "$src_digest" ] && [ "$src_digest" = "$dst_digest" ]; then
    echo "mirror: $name already current"
    continue
  fi
  rm -f "$work/$name"
  GH_TOKEN="$SRC_TOKEN" gh release download data-latest --repo "$SRC" --pattern "$name" --dir "$work" --clobber
  got="sha256:$(sha256sum "$work/$name" | cut -d' ' -f1)"
  if [ -n "$src_digest" ] && [ "$got" != "$src_digest" ]; then
    echo "mirror: $name did not match its listed digest; stopped before uploading it" >&2
    exit 1
  fi
  if [ "$got" = "$dst_digest" ]; then  # listed without a digest on the data repo, but the bytes match
    echo "mirror: $name already current"
    continue
  fi
  GH_TOKEN="$DST_TOKEN" gh release upload data-latest "$work/$name" --clobber --repo "$DST"
  copied=$((copied + 1))
  echo "mirror: copied $name"
done
echo "mirror: $copied file(s) copied to this repo's data-latest"
