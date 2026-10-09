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
# Fake UptimeRobot API. State: $FAKE_DIR/status. Log: $FAKE_DIR/calls.
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
    if [[ "${FAKE_MISSING:-}" == "1" ]]; then echo '{"stat":"ok","monitors":[]}'; exit 0; fi
    echo "{\"stat\":\"ok\",\"monitors\":[{\"id\":1,\"url\":\"https://example.test/health\",\"status\":$(cat "$FAKE_DIR/status")}]}" ;;
  editMonitor)
    new=$(echo "$args" | grep -o 'status=[01]' | cut -d= -f2)
    if [[ "$new" == "0" ]]; then echo 0 > "$FAKE_DIR/status"; else echo 2 > "$FAKE_DIR/status"; fi
    echo '{"stat":"ok","monitor":{"id":1}}' ;;
esac
FAKE
chmod +x "$WORK/bin/curl"

FAILED=0
PASSED=0

# run <hour> <initial status> [extra env...] ; sets OUT, CODE, CALLS, FINAL
run() {
  local hour="$1" status="$2"; shift 2
  rm -f "$WORK/calls"; : > "$WORK/calls"
  echo "$status" > "$WORK/status"
  OUT=$(env PATH="$WORK/bin:$PATH" FAKE_DIR="$WORK" UPTIMEROBOT_API_KEY=test-key \
        MONITOR_ID=1 NOW_UTC_HOUR="$hour" "$@" bash "$SCRIPT" 2>&1)
  CODE=$?
  CALLS=$(cat "$WORK/calls")
  FINAL=$(cat "$WORK/status")
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
  "$(yes_if test "$CODE" = 0 -a "$FINAL" = 0 -a "${OUT##*OK: }" = "nothing to change")"
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
  "$(yes_if test "$CODE" = 1 -a "${OUT#*not found in the account}" != "$OUT")"

echo
echo "$PASSED passed, $FAILED failed"
(( FAILED == 0 ))
