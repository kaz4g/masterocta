#!/usr/bin/env bash
# Self-contained A04 live rehearsal. One fresh HOME per invocation.
# NOT canonical M7 evidence.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
if [[ $# -gt 1 ]]; then
  printf '%s\n' "usage: $0 [repo_root]" >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  ROOT_DIR="$(cd "$1" && pwd -P)"
fi

PREPARE="${ROOT_DIR}/scripts/prepare-ui-workspace-native-acceptance.sh"
LAUNCH="${ROOT_DIR}/scripts/launch-native-acceptance-tauri.sh"
REHEARSAL="${ROOT_DIR}/scripts/native-acceptance-a04-rehearsal.sh"
JXA="${ROOT_DIR}/scripts/native-acceptance-ax-steps.js"

BASE_SHA="8774bc1c2c29e94bbdf1440b9622b5ccb6da21e9"
SHORT="$(git -C "${ROOT_DIR}" rev-parse --short=12 HEAD)"
AUTOMATION_SHA="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOME_ISO="/tmp/masterocta-native-acceptance-${SHORT}-${STAMP}"
CATALOG="${HOME_ISO}/Library/Application Support/MasterOCTa/catalog.sqlite3"
EVID="${HOME_ISO}/a04-live-pre"
LAUNCH_LOG="${HOME_ISO}/launch.log"
LAUNCH_PID=""
APP_PID=""
RESULT_STATUS=1

if /usr/bin/pgrep -x masterocta >/dev/null 2>&1; then
  printf '%s\n' "REFUSE_EXISTING_MASTEROCTA=YES"
  printf '%s\n' "detail=masterocta is already running; start from a clean process list" >&2
  exit 2
fi

mkdir -p "${HOME_ISO}" "${EVID}"

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "${APP_PID}" ]]; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done
    if kill -0 "${APP_PID}" >/dev/null 2>&1; then
      kill -9 "${APP_PID}" >/dev/null 2>&1 || true
    fi
  fi
  if [[ -n "${LAUNCH_PID}" ]] && kill -0 "${LAUNCH_PID}" >/dev/null 2>&1; then
    kill "${LAUNCH_PID}" >/dev/null 2>&1 || true
    pkill -P "${LAUNCH_PID}" >/dev/null 2>&1 || true
    printf '%s\n' "LAUNCH_SHELL_STOPPED=YES"
    printf '%s\n' "LAUNCH_SHELL_STOP_CLASSIFICATION=EXPECTED_TEARDOWN"
  fi
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" >/dev/null 2>&1; then
    printf '%s\n' "APP_PROCESS_RESIDUAL=YES app_pid=${APP_PID}"
    status=1
  elif /usr/bin/pgrep -x masterocta >/dev/null 2>&1; then
    printf '%s\n' "APP_PROCESS_RESIDUAL=YES"
    status=1
  else
    printf '%s\n' "APP_PROCESS_RESIDUAL=NO"
  fi
  /usr/bin/osascript -e 'tell application "System Events"
    if exists process "Vivaldi" then
      set visible of process "Vivaldi" to true
      repeat with w in windows of process "Vivaldi"
        set miniaturized of w to false
      end repeat
    end if
  end tell' >/dev/null 2>&1 || true
  if [[ "${status}" -eq 0 ]]; then
    printf '%s\n' "A04_LIVE_RUN=PASS"
  else
    printf '%s\n' "A04_LIVE_RUN=FAIL"
  fi
  exit "${status}"
}
trap cleanup EXIT

printf '%s\n' "=== A04_LIVE_REHEARSAL NOT_CANONICAL_EVIDENCE ==="
printf '%s\n' "HOME=${HOME_ISO}"
printf '%s\n' "catalog=${CATALOG}"
printf '%s\n' "BASE_SHA=${BASE_SHA}"
printf '%s\n' "automation_sha=${AUTOMATION_SHA}"
printf '%s\n' "launch_shell_pid=pending"
printf '%s\n' "app_pid=pending"

export MASTEROCTA_NATIVE_ACCEPTANCE_HOME="${HOME_ISO}"
bash "${PREPARE}" > "${EVID}/prepare.log"
FIXTURE_ROOT="$(node -e 'const m=require(process.argv[1]); if(!m.fixtureRoot) process.exit(1); process.stdout.write(m.fixtureRoot);' "${HOME_ISO}/fixture-manifest.json")"
RANGE_WAV="${FIXTURE_ROOT}/SET/AUDIO/RANGE.wav"
[[ -f "${RANGE_WAV}" ]] || { printf '%s\n' "PRE_FAIL missing RANGE.wav" >&2; exit 1; }
/usr/bin/shasum -a 256 "${RANGE_WAV}" | tee "${EVID}/PRE_range.sha256"
printf '%s\n' "fixture_root=${FIXTURE_ROOT}" | tee "${EVID}/identity.txt"
printf '%s\n' "HOME=${HOME_ISO}" >> "${EVID}/identity.txt"
printf '%s\n' "catalog=${CATALOG}" >> "${EVID}/identity.txt"
printf '%s\n' "BASE_SHA=${BASE_SHA}" >> "${EVID}/identity.txt"
printf '%s\n' "automation_sha=${AUTOMATION_SHA}" >> "${EVID}/identity.txt"

bash "${LAUNCH}" "${HOME_ISO}" "${ROOT_DIR}" > "${LAUNCH_LOG}" 2>&1 &
LAUNCH_PID=$!
printf '%s\n' "launch_shell_pid=${LAUNCH_PID}"

deadline=$((SECONDS + 600))
while (( SECONDS < deadline )); do
  if ! kill -0 "${LAUNCH_PID}" >/dev/null 2>&1; then
    printf '%s\n' "LAUNCH_FAILED=YES"
    printf '%s\n' "LAUNCH_SHELL_EXITED_BEFORE_APP=YES"
    printf '%s\n' "APP_CRASH=NO"
    tail -n 40 "${LAUNCH_LOG}" >&2 || true
    exit 1
  fi
  APP_PID="$(/usr/bin/pgrep -x masterocta | tail -1 || true)"
  if [[ -n "${APP_PID}" && "${APP_PID}" != "${LAUNCH_PID}" ]]; then
    break
  fi
  APP_PID=""
  sleep 1
done

if [[ -z "${APP_PID}" ]]; then
  printf '%s\n' "LAUNCH_FAILED=YES"
  printf '%s\n' "APP_PID_TIMEOUT=YES"
  printf '%s\n' "APP_CRASH=NO"
  exit 1
fi
printf '%s\n' "app_pid=${APP_PID}"
printf '%s\n' "app_pid=${APP_PID}" >> "${EVID}/identity.txt"
printf '%s\n' "launch_shell_pid=${LAUNCH_PID}" >> "${EVID}/identity.txt"

ready_deadline=$((SECONDS + 180))
AX_READY=NO
while (( SECONDS < ready_deadline )); do
  if /usr/bin/osascript -l JavaScript "${JXA}" ax-ready "${APP_PID}" > "${EVID}/ax-ready.log" 2>&1; then
    if grep -q 'FRONTMOST_AX_STABLE=YES' "${EVID}/ax-ready.log" && grep -q 'AX_READY=YES' "${EVID}/ax-ready.log"; then
      AX_READY=YES
      break
    fi
  fi
  sleep 2
done
printf '%s\n' "AX_READY=${AX_READY}"
if [[ "${AX_READY}" != "YES" ]]; then
  printf '%s\n' "FRONTMOST_AX_NOT_STABLE"
  cat "${EVID}/ax-ready.log" >&2 || true
  exit 1
fi

set +e
bash "${REHEARSAL}" "${HOME_ISO}" "${APP_PID}" "${ROOT_DIR}"
RESULT_STATUS=$?
set -e
exit "${RESULT_STATUS}"
