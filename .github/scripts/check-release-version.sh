#!/usr/bin/env bash
# Release guard for build-apk.yml. Runs on a `v*` tag push, before the build.
#
# 1. The tag must equal `expo.version` in app.json (tag v1.2.3 -> "1.2.3").
#    Otherwise the release page says one version and the installed app
#    reports another.
# 2. `expo.android.versionCode` must be strictly greater than the one at the
#    previous `v*` tag. Android decides whether an APK is an update by
#    versionCode alone: a code that does not grow means the new APK either
#    refuses to install over the old one or ships as the "same" app.
#
# Usage: check-release-version.sh <tag> [app.json path]
set -euo pipefail

TAG="${1:?usage: check-release-version.sh <tag> [app.json]}"
APP_JSON="${2:-frontend/packages/mobile/app.json}"

read_field() {
  # $1 = JSON text on stdin, $2 = dotted path inside "expo"
  node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      let v = JSON.parse(s).expo;
      for (const k of process.argv[1].split(".")) v = v?.[k];
      if (v === undefined) { console.error("missing expo." + process.argv[1]); process.exit(2); }
      console.log(v);
    });' "$1"
}

if [[ ! "$TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "::error::Tag '$TAG' is not of the form vMAJOR.MINOR.PATCH"
  exit 1
fi
TAG_VERSION="${BASH_REMATCH[1]}"

APP_VERSION=$(read_field version < "$APP_JSON")
APP_CODE=$(read_field android.versionCode < "$APP_JSON")

if [[ "$APP_VERSION" != "$TAG_VERSION" ]]; then
  echo "::error::Tag $TAG does not match app.json expo.version $APP_VERSION. Bump app.json (and versionCode) before tagging."
  exit 1
fi

# Previous release tag: the newest v* tag that is not this one and is an
# ancestor of this commit.
PREV_TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*' "${TAG}^" 2>/dev/null || true)
if [[ -z "$PREV_TAG" ]]; then
  echo "No previous v* tag found; skipping the versionCode comparison."
  echo "OK: $TAG matches app.json $APP_VERSION (versionCode $APP_CODE)"
  exit 0
fi

PREV_CODE=$(git show "$PREV_TAG:$APP_JSON" | read_field android.versionCode)
if (( APP_CODE <= PREV_CODE )); then
  echo "::error::versionCode $APP_CODE is not greater than $PREV_CODE at $PREV_TAG. Android would not treat this APK as an update."
  exit 1
fi

echo "OK: $TAG matches app.json $APP_VERSION; versionCode $PREV_CODE ($PREV_TAG) -> $APP_CODE"
