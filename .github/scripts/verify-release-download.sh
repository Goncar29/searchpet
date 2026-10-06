#!/usr/bin/env bash
# Post-release check for build-apk.yml. Runs after the GitHub release is
# published.
#
# The web download button links to releases/latest/download/SearchPet.apk.
# This downloads that public URL and compares its SHA-256 with the APK this run
# just built. A plain "the URL answers" check would also pass while `latest`
# still points to an older release, so the hash is what proves users get this
# version. A failure here turns the run red, so a broken download reaches the
# maintainer instead of a user hitting a 404.
#
# Usage: verify-release-download.sh <local apk> [url]
set -euo pipefail

LOCAL_APK="${1:?usage: verify-release-download.sh <local apk> [url]}"
URL="${2:-https://github.com/${GITHUB_REPOSITORY:-Goncar29/searchpet}/releases/latest/download/SearchPet.apk}"
# About five minutes in total: a new release can take a while to become
# `latest` behind GitHub's cache, and a red run without a real problem would
# teach everyone to ignore this check.
ATTEMPTS="${ATTEMPTS:-10}"
WAIT_SECONDS="${WAIT_SECONDS:-30}"

EXPECTED=$(sha256sum "$LOCAL_APK" | cut -d' ' -f1)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# Bounded curl: without a limit a stalled connection would hold the job until
# its 45-minute timeout instead of moving on to the next attempt.
for attempt in $(seq 1 "$ATTEMPTS"); do
  if curl -sSL --fail --connect-timeout 15 --max-time 300 -o "$TMP" "$URL"; then
    ACTUAL=$(sha256sum "$TMP" | cut -d' ' -f1)
    if [[ "$ACTUAL" == "$EXPECTED" ]]; then
      echo "OK: $URL serves this build (sha256 $EXPECTED)"
      exit 0
    fi
    echo "Attempt $attempt/$ATTEMPTS: $URL serves sha256 $ACTUAL, expected $EXPECTED"
  else
    echo "Attempt $attempt/$ATTEMPTS: download of $URL failed"
  fi
  if (( attempt < ATTEMPTS )); then sleep "$WAIT_SECONDS"; fi
done

echo "::error::$URL does not serve the APK this run built. The /download button on the web would give users the wrong file or a 404."
exit 1
