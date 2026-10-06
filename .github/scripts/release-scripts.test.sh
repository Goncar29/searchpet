#!/usr/bin/env bash
# Tests for the two release scripts used by build-apk.yml:
#   check-release-version.sh   (runs before the build on a v* tag)
#   verify-release-download.sh (runs after the release is published)
#
# Every case asserts the exit code AND the message that names the reason. An
# exit code alone cannot tell "the guard rejected the tag" from "the script
# crashed", and a crash would pass a check that only expects a non-zero exit.
#
# Self-contained: builds throwaway git repos under a temp dir and serves files
# through file:// URLs, so it needs no network and never touches this repo.
#
# Usage: bash .github/scripts/release-scripts.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/check-release-version.sh"
VERIFY="$HERE/verify-release-download.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

FAILED=0
PASSED=0

# expect <name> <expected exit> <expected message fragment> -- <command...>
expect() {
  local name="$1" want_code="$2" want_msg="$3"
  shift 4
  local out code
  out=$("$@" 2>&1)
  code=$?
  if [[ "$code" == "$want_code" && "$out" == *"$want_msg"* ]]; then
    PASSED=$((PASSED + 1))
    echo "ok   - $name"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL - $name"
    echo "       want exit $want_code with: $want_msg"
    echo "       got  exit $code with: $out"
  fi
}

# --- check-release-version.sh ------------------------------------------------

REPO="$WORK/repo"
git_() { git -C "$REPO" -c user.email=test@example.com -c user.name=test "$@"; }

# commit_app <version> <versionCode as raw JSON>
commit_app() {
  mkdir -p "$REPO/frontend/packages/mobile"
  printf '{"expo":{"version":"%s","android":{"versionCode":%s}}}\n' "$1" "$2" \
    > "$REPO/frontend/packages/mobile/app.json"
  git_ add -A
  git_ commit -q -m "app $1 ($2)"
}

guard() { (cd "$REPO" && bash "$GUARD" "$1"); }

new_repo() { rm -rf "$REPO"; mkdir -p "$REPO"; git -C "$REPO" init -q; }

# No previous tag reachable: must fail, never skip the versionCode comparison.
new_repo
commit_app 1.1.0 5
git_ tag v1.1.0
expect "no previous tag fails instead of skipping" 1 "No previous v* tag reachable" -- guard v1.1.0

# A previous release, then the cases on top of it.
new_repo
commit_app 1.0.6 4
git_ tag v1.0.6
commit_app 1.1.0 5
git_ tag v1.1.0
expect "matching tag and grown versionCode pass" 0 "versionCode 4 (v1.0.6) -> 5" -- guard v1.1.0
expect "tag that differs from app.json fails" 1 "does not match app.json expo.version 1.1.0" -- guard v1.2.0
expect "tag without three numbers fails" 1 "is not of the form vMAJOR.MINOR.PATCH" -- guard v1.1

git_ tag -d v1.1.0 > /dev/null
commit_app 1.1.0 4
git_ tag v1.1.0
expect "versionCode that did not grow fails" 1 "versionCode 4 is not greater than 4 at v1.0.6" -- guard v1.1.0

git_ tag -d v1.1.0 > /dev/null
commit_app 1.1.0 '"5a"'
git_ tag v1.1.0
expect "non-integer versionCode fails" 1 "versionCode '5a' is not a positive integer" -- guard v1.1.0

# --- verify-release-download.sh ----------------------------------------------

printf 'the apk this run built' > "$WORK/built.apk"
printf 'an older apk' > "$WORK/older.apk"
verify() { ATTEMPTS=1 WAIT_SECONDS=0 bash "$VERIFY" "$WORK/built.apk" "$1"; }

# file:// URL for a local path. On Windows (Git Bash) curl is a native binary
# that cannot open /tmp/..., so it gets the Windows path; on Linux this is a
# plain file:// URL.
file_url() {
  if command -v cygpath > /dev/null; then echo "file:///$(cygpath -m "$1")"; else echo "file://$1"; fi
}

expect "link serving this build passes" 0 "serves this build" -- verify "$(file_url "$WORK/built.apk")"
# "serves sha256" is printed only when the download worked and the hash
# differs. The final error line is the same for a failed download, so
# asserting on it would let this case pass without ever comparing hashes.
expect "link serving another build fails on the hash" 1 "serves sha256" -- verify "$(file_url "$WORK/older.apk")"
expect "link that does not answer fails" 1 "failed" -- verify "$(file_url "$WORK/missing.apk")"

echo
echo "$PASSED passed, $FAILED failed"
(( FAILED == 0 ))
