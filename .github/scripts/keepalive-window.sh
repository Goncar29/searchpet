#!/usr/bin/env bash
# Lets the backend sleep for a nightly window to save Render instance-hours.
#
# Render's free plan gives 750 instance-hours per month to the whole workspace,
# shared with another service. The UptimeRobot /health monitor (every 5 min)
# keeps SearchPet awake 24/7, which is 744 h in a 31-day month: on 2026-08-31
# the workspace ran out and Render suspended the backend for ~4 h. Pausing that
# monitor from 07:00 to 09:00 UTC (04:00-06:00 in Uruguay) lets Render put the
# service to sleep after its 15 idle minutes. A request in the window still
# works; it just waits for a cold start.
#
# Runs every 10 minutes and RECONCILES: it computes the state the monitor
# should be in for the current hour and sets it. A run GitHub drops or delays
# (its cron is best-effort) is corrected by a later one. A "pause at 4, resume at 6"
# pair would leave the monitor paused for good if the resume run never came.
#
# Outside the window it also sends its own GET to the monitored URL, because
# resuming the monitor alone does not wake a sleeping instance (see below).
#
# Fails loudly when the API key is missing, the API does not answer "ok", or
# the backend does not answer the wake request: a job that skips quietly would
# look green while the backend never sleeps, or never wakes again.
#
# Usage: keepalive-window.sh
# Env:   UPTIMEROBOT_API_KEY  main (read/write) API key, required
#        MONITOR_ID           UptimeRobot monitor id, required
#        SLEEP_START_UTC      first hour of the window (default 7)
#        SLEEP_END_UTC        first hour after the window (default 9)
#        NOW_UTC_HOUR         override the current hour (tests)
#        UPTIMEROBOT_API      API base URL (default https://api.uptimerobot.com/v2)
set -euo pipefail

: "${UPTIMEROBOT_API_KEY:?UPTIMEROBOT_API_KEY is not set: add it as a repository secret}"
: "${MONITOR_ID:?MONITOR_ID is not set}"
START="${SLEEP_START_UTC:-7}"
END="${SLEEP_END_UTC:-9}"
HOUR="${NOW_UTC_HOUR:-$(date -u +%H)}"
HOUR=$((10#$HOUR))
API="${UPTIMEROBOT_API:-https://api.uptimerobot.com/v2}"

api() {
  # $1 = method name, rest = extra form fields
  local method="$1"; shift
  curl -sS --fail --connect-timeout 15 --max-time 60 -X POST "$API/$method" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "api_key=$UPTIMEROBOT_API_KEY" \
    --data "format=json" "$@"
}

json_field() {
  # Reads a dotted path from JSON on stdin; prints nothing if absent.
  node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      let v = JSON.parse(s);
      for (const k of process.argv[1].split(".")) v = v?.[k];
      if (v !== undefined) console.log(v);
    });' "$1"
}

if (( HOUR >= START && HOUR < END )); then WANT=paused; else WANT=active; fi

RESPONSE=$(api getMonitors --data "monitors=$MONITOR_ID")
if [[ "$(json_field stat <<< "$RESPONSE")" != "ok" ]]; then
  echo "::error::getMonitors failed: $RESPONSE"
  exit 1
fi
STATUS=$(json_field monitors.0.status <<< "$RESPONSE")
URL=$(json_field monitors.0.url <<< "$RESPONSE")
if [[ -z "$STATUS" ]]; then
  echo "::error::Monitor $MONITOR_ID not found in the account"
  exit 1
fi
# UptimeRobot status 0 is "paused"; every other value is an active monitor.
if [[ "$STATUS" == "0" ]]; then HAVE=paused; else HAVE=active; fi

echo "Hour $HOUR UTC, window ${START}-${END}: monitor $MONITOR_ID ($URL) is $HAVE, should be $WANT"
if [[ "$HAVE" == "$WANT" ]]; then
  echo "OK: nothing to change"
else
  if [[ "$WANT" == "paused" ]]; then NEW=0; else NEW=1; fi
  RESPONSE=$(api editMonitor --data "id=$MONITOR_ID" --data "status=$NEW")
  if [[ "$(json_field stat <<< "$RESPONSE")" != "ok" ]]; then
    echo "::error::editMonitor failed: $RESPONSE"
    exit 1
  fi
  echo "OK: monitor $MONITOR_ID set to $WANT"
fi

[[ "$WANT" == "active" ]] || exit 0

# Wake the backend ourselves. Measured 2026-10-07 to 10-09: a resumed
# UptimeRobot monitor never woke a sleeping Render instance, so the backend
# slept until a person hit it, 2 to 6 hours after the window ended. Runs on
# every run outside the window, not only on the resume, so a wake that fails
# is retried 10 minutes later. A cold start takes ~15 s; the timeout leaves
# room for a slow one.
if ! curl -sS --fail --connect-timeout 30 --max-time 120 -o /dev/null "$URL"; then
  echo "::error::wake request to $URL failed: the backend did not answer"
  exit 1
fi
echo "OK: backend awake ($URL)"
