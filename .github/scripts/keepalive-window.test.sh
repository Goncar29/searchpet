#!/usr/bin/env bash
# Tests for keepalive-window.sh. A fake `curl` first on PATH plays the
# UptimeRobot API: it keeps the monitor status in a file, logs every call, and
# can be told to fail. No network, never touches the real account.
#
# Every case asserts the exit code AND a message only that path prints, plus
# what was (or was not) sent to the API.
#
# Usage: bash .github/scripts/keepalive-window.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/keepalive-window.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
# Fake UptimeRobot API. State: $FAKE_DIR/status.<id>. Log: $FAKE_DIR/calls.
# Monitor 1 is the /health one; any other id is a quiet monitor.
args="$*"
# A GET to the monitored URL is the wake request, not an API call.
if [[ "$args" == *example.test/health* ]]; then
  echo "wake $args" >> "$FAKE_DIR/calls"
  if [[ "${FAKE_WAKE_FAIL:-}" == "1" ]]; then
    echo "curl: (28) Operation timed out" >&2; exit 28
  fi
  echo '{"status":"ok"}'; exit 0
fi
method="${args##*/v2/}"; method="${method%% *}"
echo "$method $args" >> "$FAKE_DIR/calls"
if [[ "${FAKE_FAIL:-}" == "$method" ]]; then
  echo '{"stat":"fail","error":{"type":"invalid_parameter"}}'; exit 0
fi
case "$method" in
  getMonitors)
    id=$(echo "$args" | grep -o 'monitors=[0-9]*' | cut -d= -f2)
    if [[ "${FAKE_MISSING:-}" == "$id" ]]; then echo '{"stat":"ok","monitors":[]}'; exit 0; fi
    if [[ "$id" == "1" ]]; then url=https://example.test/health; else url=https://example.test/quiet-$id; fi
    echo "{\"stat\":\"ok\",\"monitors\":[{\"id\":$id,\"url\":\"$url\",\"status\":$(cat "$FAKE_DIR/status.$id")}]}" ;;
  editMonitor)
    id=$(echo "$args" | grep -o 'id=[0-9]*' | head -1 | cut -d= -f2)
    new=$(echo "$args" | grep -o 'status=[01]' | cut -d= -f2)
    if [[ "$new" == "0" ]]; then echo 0 > "$FAKE_DIR/status.$id"; else echo 2 > "$FAKE_DIR/status.$id"; fi
    echo "{\"stat\":\"ok\",\"monitor\":{\"id\":$id}}" ;;
esac
FAKE
chmod +x "$WORK/bin/curl"

FAILED=0
PASSED=0

# run <hour> <initial status> [extra env...] ; sets OUT, CODE, CALLS, FINAL
# Quiet monitors 5 and 6 start in QUIET_STATUS (default: same as monitor 1);
# their final states land in FINAL5 and FINAL6.
run() {
  local hour="$1" status="$2"; shift 2
  rm -f "$WORK/calls"; : > "$WORK/calls"
  echo "$status" > "$WORK/status.1"
  echo "${QUIET_STATUS:-$status}" > "$WORK/status.5"
  echo "${QUIET_STATUS:-$status}" > "$WORK/status.6"
  OUT=$(env PATH="$WORK/bin:$PATH" FAKE_DIR="$WORK" UPTIMEROBOT_API_KEY=test-key \
        MONITOR_ID=1 NOW_UTC_HOUR="$hour" "$@" bash "$SCRIPT" 2>&1)
  CODE=$?
  CALLS=$(cat "$WORK/calls")
  FINAL=$(cat "$WORK/status.1")
  FINAL5=$(cat "$WORK/status.5")
  FINAL6=$(cat "$WORK/status.6")
}

check() {
  local name="$1" ok="$2"
  if [[ "$ok" == "yes" ]]; then
    PASSED=$((PASSED + 1)); echo "ok   - $name"
  else
    FAILED=$((FAILED + 1)); echo "FAIL - $name"
    echo "       exit $CODE, final status $FINAL"
    echo "       output: $OUT"
    echo "       calls: $CALLS"
  fi
}

yes_if() { if "$@"; then echo yes; else echo no; fi; }

run 7 2
check "07 UTC, monitor active: pauses it" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 0 -a "${OUT##*set to }" = paused)"

# 08 and 09 are not valid octal: without base-10 parsing, bash arithmetic
# errors on them. 07 would pass either way, so it would prove nothing.
run 08 2
check "hour 08 with a leading zero is read as decimal" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 0)"

run 8 0
check "08 UTC, already paused: no edit call" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 0 -a "${OUT##*OK: }" = "monitor 1, nothing to change")"
[[ "$CALLS" != *editMonitor* ]] && check "08 UTC sends no editMonitor" yes || check "08 UTC sends no editMonitor" no

run 9 0
check "09 UTC, still paused: resumes it" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 2 -a "${OUT#*set to active}" != "$OUT")"
# Measured 2026-10-07..09: a resumed UptimeRobot monitor never woke a sleeping
# Render instance; the backend slept until a person hit it, hours later.
[[ "$CALLS" == *"wake "*example.test/health* && "$OUT" == *"OK: backend awake"* ]] \
  && check "09 UTC resume wakes the backend with its own GET" yes \
  || check "09 UTC resume wakes the backend with its own GET" no

run 7 2
[[ "$CALLS" != *"wake "* ]] && check "07 UTC sends no wake request" yes || check "07 UTC sends no wake request" no

run 8 0
[[ "$CALLS" != *"wake "* ]] && check "08 UTC, in the window, sends no wake request" yes \
  || check "08 UTC, in the window, sends no wake request" no

run 9 0 FAKE_WAKE_FAIL=1
check "wake request that fails makes the job fail" \
  "$(yes_if test "$CODE" = 1 -a "${OUT#*wake request to https://example.test/health failed}" != "$OUT")"
check "a failed wake still leaves the monitor active" "$(yes_if test "$FINAL" = 2)"

run 10 2
[[ "$CALLS" == *"wake "* && "$CALLS" != *editMonitor* ]] \
  && check "already active outside the window: wakes again, so a failed wake is retried" yes \
  || check "already active outside the window: wakes again, so a failed wake is retried" no

run 6 2
check "06 UTC, active: left alone" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 2)"
[[ "$CALLS" != *editMonitor* ]] && check "06 UTC sends no editMonitor" yes || check "06 UTC sends no editMonitor" no

run 15 0
check "a run missed at 09 UTC is corrected later in the day" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 2)"

run 7 2 UPTIMEROBOT_API_KEY=
check "missing API key fails instead of skipping" \
  "$(yes_if test "$CODE" != 0 -a "${OUT#*UPTIMEROBOT_API_KEY is not set}" != "$OUT")"

run 7 2 FAKE_FAIL=getMonitors
check "getMonitors not ok fails" \
  "$(yes_if test "$CODE" = 1 -a "${OUT#*getMonitors failed}" != "$OUT")"

run 7 2 FAKE_FAIL=editMonitor
check "editMonitor not ok fails" \
  "$(yes_if test "$CODE" = 1 -a "${OUT#*editMonitor failed}" != "$OUT")"

run 7 2 FAKE_MISSING=1
check "unknown monitor id fails" \
  "$(yes_if test "$CODE" = 1 -a "${OUT#*Monitor 1 not found in the account}" != "$OUT")"

# Quiet monitors (QUIET_MONITOR_IDS). Their 6-hourly checks opened a false
# "down" incident whenever they landed in the window (2026-10-07 to 10-10).
run 7 2 QUIET_MONITOR_IDS="5 6"
check "07 UTC pauses the quiet monitors too" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 0 -a "$FINAL5" = 0 -a "$FINAL6" = 0)"
[[ "$OUT" == *"OK: monitor 5 set to paused"* && "$OUT" == *"OK: monitor 6 set to paused"* ]] \
  && check "07 UTC reports each quiet monitor paused" yes \
  || check "07 UTC reports each quiet monitor paused" no

QUIET_STATUS=2 run 8 0 QUIET_MONITOR_IDS="5 6"
check "08 UTC, a quiet monitor resumed by hand is paused again" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL5" = 0 -a "$FINAL6" = 0)"

run 9 0 QUIET_MONITOR_IDS="5 6"
check "09 UTC resumes the quiet monitors" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 2 -a "$FINAL5" = 2 -a "$FINAL6" = 2)"
# Resumed before the wake, their first check would hit a sleeping Render.
wake_line=$(grep -n '^wake ' <<< "$CALLS" | head -1 | cut -d: -f1)
quiet_line=$(grep -n '^editMonitor .*id=5' <<< "$CALLS" | head -1 | cut -d: -f1)
[[ -n "$wake_line" && -n "$quiet_line" && "$wake_line" -lt "$quiet_line" ]] \
  && check "09 UTC resumes the quiet monitors only after the wake" yes \
  || check "09 UTC resumes the quiet monitors only after the wake" no
[[ "$CALLS" != *"wake "*quiet-* ]] \
  && check "a quiet monitor's url is never used to wake" yes \
  || check "a quiet monitor's url is never used to wake" no

run 9 0 QUIET_MONITOR_IDS="5 6" FAKE_WAKE_FAIL=1
check "a failed wake leaves the quiet monitors paused" \
  "$(yes_if test "$CODE" = 1 -a "$FINAL5" = 0 -a "$FINAL6" = 0)"

run 7 2 QUIET_MONITOR_IDS="5 6" FAKE_MISSING=6
check "an unknown quiet monitor id fails" \
  "$(yes_if test "$CODE" = 1 -a "${OUT#*Monitor 6 not found in the account}" != "$OUT")"

run 7 2
check "no QUIET_MONITOR_IDS leaves the other monitors alone" \
  "$(yes_if test "$CODE" = 0 -a "$FINAL5" = 2 -a "$FINAL6" = 2)"

echo
echo "$PASSED passed, $FAILED failed"
(( FAILED == 0 ))
