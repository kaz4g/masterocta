#!/usr/bin/env bash
# MO-M7-A04-AUTOMATION-REHEARSAL — A01 + A02–A04 only (NOT canonical evidence).
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  printf '%s\n' "usage: $0 <isolated_home> <native_pid> [repo_root]" >&2
  exit 2
fi

HOME_ISO="$1"
PID="$2"
ROOT_DIR="$(cd "${3:-$(dirname "$0")/..}" && pwd -P)"
JXA="${ROOT_DIR}/scripts/native-acceptance-ax-steps.js"
CATALOG="${HOME_ISO}/Library/Application Support/MasterOCTa/catalog.sqlite3"
RANGE_REL="SET/AUDIO/RANGE.wav"
RANGE_A_START="44100"
RANGE_A_END="132300"
RANGE_B_START="176400"
RANGE_B_END="220500"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVID="${HOME_ISO}/acceptance-evidence-a04-rehearsal-${STAMP}"
LOG="${EVID}/rehearsal.log"

AX_LAST_OUT=""
CANCEL_TERMINAL_PASS=NO

mkdir -p "${EVID}"
exec > >(tee -a "${LOG}") 2>&1

ax_metric() {
  local key="$1"
  local default="${2:-}"
  if [[ -z "${AX_LAST_OUT}" ]]; then
    printf '%s\n' "${default}"
    return
  fi
  local line
  line="$(printf '%s\n' "${AX_LAST_OUT}" | grep -E "^${key}=" | tail -1 || true)"
  if [[ -n "${line}" ]]; then
    printf '%s\n' "${line#*=}"
  else
    printf '%s\n' "${default}"
  fi
}

emit_final_report() {
  local head_sha
  head_sha="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
  printf '%s\n' "=== A04_REPAIR5_FINAL_REPORT NOT_CANONICAL_EVIDENCE ==="
  printf '%s\n' "BASE_SHA=8774bc1c2c29e94bbdf1440b9622b5ccb6da21e9"
  printf '%s\n' "HEAD_SHA=${head_sha}"
  printf '%s\n' "PRODUCT_CODE_CHANGED=NO"
  printf '%s\n' "AUTOMATION_TESTS=NOT_RUN_IN_SCRIPT"
  printf '%s\n' "FRONTMOST_AX_STABLE=$(ax_metric FRONTMOST_AX_STABLE UNKNOWN)"
  printf '%s\n' "REANALYSIS_ACTIVE_STATE_OBSERVED=$(ax_metric REANALYSIS_ACTIVE_STATE_OBSERVED NOT_RUN)"
  printf '%s\n' "CANCEL_WINDOW_OBSERVED=$(ax_metric CANCEL_WINDOW_OBSERVED NOT_RUN)"
  printf '%s\n' "CANCEL_FIRST_SEEN_MS=$(ax_metric CANCEL_FIRST_SEEN_MS NOT_RUN)"
  printf '%s\n' "CANCEL_ENABLED_MS=$(ax_metric CANCEL_ENABLED_MS NOT_RUN)"
  printf '%s\n' "CANCEL_PRESS_MS=$(ax_metric CANCEL_PRESS_MS NOT_RUN)"
  printf '%s\n' "ANALYSIS_TERMINAL_MS=$(ax_metric ANALYSIS_TERMINAL_MS NOT_RUN)"
  printf '%s\n' "CANCEL_PRESS=$(ax_metric CANCEL_PRESS NOT_RUN)"
  printf '%s\n' "CANCEL_TERMINAL_STATE=${CANCEL_TERMINAL_PASS}"
  printf '%s\n' "CANCEL_SAFETY=${CANCEL_SAFETY_STATUS:-NOT_RUN}"
  printf '%s\n' "CURRENT_FIXTURE_CANCEL_WINDOW=${FIXTURE_CANCEL_WINDOW:-UNKNOWN}"
  printf '%s\n' "SINGLE_FRESH_HOME_FULL_RUN=${SINGLE_RUN_STATUS:-NOT_RUN}"
  printf '%s\n' "FRESH_HOME_RUN_1=${FRESH_HOME_RUN_1:-NOT_RUN}"
  printf '%s\n' "FRESH_HOME_RUN_2=${FRESH_HOME_RUN_2:-NOT_RUN}"
  printf '%s\n' "FRESH_HOME_RUN_3=${FRESH_HOME_RUN_3:-NOT_RUN}"
  printf '%s\n' "MANUAL_INTERVENTION=NO"
  printf '%s\n' "A04_AUTOMATION_READY=${A04_READY:-NO}"
  printf '%s\n' "CLASSIFICATION=${CLASSIFICATION:-AUTOMATION_SMOKE_ONLY}"
  printf '%s\n' "PR=NOT_CREATED"
}

ax() {
  local out=""
  local status=0
  out="$(/usr/bin/osascript -l JavaScript "${JXA}" "$@" 2>&1)" || status=$?
  AX_LAST_OUT="${out}"
  printf '%s\n' "${out}"
  if [[ "${status}" -ne 0 ]]; then
    return 1
  fi
  if printf '%s\n' "${out}" | grep -qE '\[ERROR\]|GOTO_FOLDER_PRECONDITION_FAILED|GO_TO_FOLDER_FOCUS_TIMEOUT|RANGE_FOCUS_TIMEOUT|FRONTMOST_AX_NOT_STABLE|A04_[A-Z0-9_]*(FAIL|TIMEOUT)|A04_RANGE_INPUT_NOT_AVAILABLE|A04_REANALYZE_GUARD_FAIL|CANCEL_WINDOW_NOT_OBSERVED|CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE'; then
    return 1
  fi
  return 0
}

die() {
  local stage="$1"
  local detail="$2"
  CLASSIFICATION="AUTOMATION_BUG"
  if printf '%s\n' "${detail}" | grep -q 'CANCEL_WINDOW_NOT_OBSERVED'; then
    CLASSIFICATION="AUTOMATION_BUG"
    FIXTURE_CANCEL_WINDOW="UNKNOWN"
    if printf '%s\n' "${AX_LAST_OUT}" | grep -qE 'CANCEL_NAME_POLLS=[1-9]'; then
      CLASSIFICATION="CANCEL_WINDOW_NOT_OBSERVED"
      FIXTURE_CANCEL_WINDOW="INSUFFICIENT"
    fi
  elif printf '%s\n' "${detail}" | grep -q 'CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE'; then
    CLASSIFICATION="ACCEPTANCE_FIXTURE_CANCEL_WINDOW_INSUFFICIENT"
    FIXTURE_CANCEL_WINDOW="INSUFFICIENT"
  elif printf '%s\n' "${detail}" | grep -q 'A04_CANCEL_SAFETY'; then
    CLASSIFICATION="PRODUCT_BUG_FOUND"
  elif printf '%s\n' "${AX_LAST_OUT}" | grep -q 'CLASSIFICATION='; then
    CLASSIFICATION="$(printf '%s\n' "${AX_LAST_OUT}" | grep -E '^CLASSIFICATION=' | tail -1 | cut -d= -f2-)"
  fi
  A04_READY=NO
  SINGLE_RUN_STATUS=FAIL
  CANCEL_SAFETY_STATUS=NOT_RUN
  if printf '%s\n' "${detail}" | grep -q 'CANCEL_WINDOW_NOT_OBSERVED'; then
    :
  elif [[ "${stage}" != "A04_CANCEL_SAFETY" ]]; then
    CANCEL_SAFETY_STATUS=NOT_RUN
  fi
  printf '%s\n' "RESULT=STOP stage=${stage} detail=${detail}"
  printf '%s\n' "A04_AUTOMATION_REHEARSAL_ONLY=FAIL"
  printf '%s\n' "NOT_CANONICAL_EVIDENCE=YES"
  emit_final_report
  exit 1
}

pass() {
  printf '%s\n' "stage=${1} result=PASS ${2:-}"
}

draft_snapshot() {
  /usr/bin/sqlite3 -readonly -bail "${CATALOG}" <<SQL
SELECT revision, region_start, region_end FROM slice_drafts ORDER BY id DESC LIMIT 1;
SELECT COUNT(*) FROM slice_draft_markers;
SELECT CASE WHEN COUNT(*) > 0 THEN COUNT(*) - 1 ELSE 0 END FROM slice_draft_markers;
SELECT start_frame FROM slice_draft_markers ORDER BY ordinal;
SQL
}

printf '%s\n' "=== A04_AUTOMATION_REHEARSAL_ONLY NOT_CANONICAL_EVIDENCE ==="
EXEC_SHA="$(git -C "${ROOT_DIR}" rev-parse HEAD)"
printf '%s\n' "execution_sha=${EXEC_SHA}"
printf '%s\n' "isolated_home=${HOME_ISO}"
printf '%s\n' "pid=${PID}"
printf '%s\n' "evidence=${EVID}"

[[ -f "${HOME_ISO}/fixture-manifest.json" ]] || die "preflight" "missing fixture-manifest.json"
FIXTURE_ROOT="$(node -e 'const m=require(process.argv[1]); if(!m.fixtureRoot) process.exit(1); process.stdout.write(m.fixtureRoot);' "${HOME_ISO}/fixture-manifest.json")"
[[ -d "${FIXTURE_ROOT}" ]] || die "preflight" "fixture root missing"

# A01
if ! /usr/bin/pgrep -x masterocta >/dev/null 2>&1; then die "A01" "masterocta not running"; fi
if ! /usr/sbin/lsof -a -p "${PID}" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -F "catalog.sqlite3" >/dev/null; then
  die "A01" "pid ${PID} does not hold catalog.sqlite3"
fi
REAL_HOME="${REAL_HOME:-${HOME}}"
REAL_CAT="${REAL_HOME}/Library/Application Support/MasterOCTa/catalog.sqlite3"
if /usr/sbin/lsof -a -p "${PID}" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -F "${REAL_CAT}" >/dev/null 2>&1; then
  die "A01" "real-home catalog open on pid"
fi
pass "A01" "isolation"

# A02
OUT="$(ax register-root "${PID}" "${FIXTURE_ROOT}")" || die "A02" "${OUT}"
[[ "${OUT}" == *register-root* ]] || die "A02" "${OUT}"
pass "A02" "register-root"

for _ in $(seq 1 30); do
  ROOTS="$(/usr/bin/sqlite3 -readonly -bail "${CATALOG}" "SELECT COUNT(*) FROM roots;" 2>/dev/null || echo 0)"
  [[ "${ROOTS}" == "1" ]] && break
  sleep 1
done
[[ "${ROOTS}" == "1" ]] || die "A02" "roots=${ROOTS}"

OUT="$(ax select-row "${PID}" "${RANGE_REL}")" || die "A02" "${OUT}"
pass "A02" "select-row"

# A03
ax paste-range "${PID}" "開始フレーム" "${RANGE_A_START}" || die "A03" "${AX_LAST_OUT:-paste start}"
ax paste-range "${PID}" "終了フレーム" "${RANGE_A_END}" || die "A03" "${AX_LAST_OUT:-paste end}"
OUT="$(ax play-stop "${PID}")" || die "A03" "${OUT}"
pass "A03" "range-play-stop"

# Draft A
ax slice-prepare-workspace "${PID}" || die "A04" "${AX_LAST_OUT:-slice-prepare-workspace}"
ax slice-detect "${PID}" || die "A04" "${AX_LAST_OUT:-slice-detect}"
ax slice-wait-apply "${PID}" || die "A04" "${AX_LAST_OUT:-slice-wait-apply}"
ax slice-apply "${PID}" || die "A04" "${AX_LAST_OUT:-slice-apply}"
ax slice-wait-draft "${PID}" || die "A04" "${AX_LAST_OUT:-slice-wait-draft}"

BASELINE="$(draft_snapshot)"
printf '%s\n' "[A04][BASELINE]" "${BASELINE}" | tee "${EVID}/A04_baseline.txt"
[[ -n "${BASELINE}" ]] || die "A04" "empty baseline"

MARKERS_BEFORE="$(echo "${BASELINE}" | sed -n '2p')"
SLICES_BEFORE="$(echo "${BASELINE}" | sed -n '3p')"
case "${MARKERS_BEFORE}" in
  *[!0-9]* | '') die "A04" "markers baseline invalid: ${MARKERS_BEFORE}" ;;
  0) die "A04" "markers baseline invalid: ${MARKERS_BEFORE}" ;;
esac
printf '%s\n' "[A04][BASELINE] revision/region line follows; marker_count=${MARKERS_BEFORE} slice_count=${SLICES_BEFORE}"

# A04 cancel safety (a04-paste-range-b closes expanded workspace first)
ax a04-paste-range-b "${PID}" "${RANGE_B_START}" "${RANGE_B_END}" || die "A04" "${AX_LAST_OUT:-paste-range-b}"
ax a04-copy-pending "${PID}" || die "A04" "${AX_LAST_OUT:-copy-pending}"
ax a04-verify-pending "${PID}" "${RANGE_B_START}" "${RANGE_B_END}" || die "A04" "${AX_LAST_OUT:-verify-pending}"
ax a04-reanalyze-and-cancel "${PID}" || die "A04" "${AX_LAST_OUT:-reanalyze-and-cancel}"

if printf '%s\n' "${AX_LAST_OUT}" | grep -q 'CANCEL_TERMINAL_STATE=PASS'; then
  CANCEL_TERMINAL_PASS=PASS
else
  die "A04" "cancel terminal not observed"
fi

CANCEL_AX_OUT="${AX_LAST_OUT}"
ax a04-session-usable "${PID}" || die "A04" "${AX_LAST_OUT:-session-usable}"
printf '%s\n' "[A04][SESSION]" "${AX_LAST_OUT}" | tee "${EVID}/A04_session_usable.txt"
AX_LAST_OUT="${CANCEL_AX_OUT}"

AFTER="$(draft_snapshot)"
printf '%s\n' "[A04][AFTER_CANCEL]" "${AFTER}" | tee "${EVID}/A04_after_cancel.txt"

read -r REV_B REG_START_B REG_END_B _ <<< "$(echo "${BASELINE}" | sed -n '1p' | tr '|' ' ')"
read -r REV_A REG_START_A REG_END_A _ <<< "$(echo "${AFTER}" | sed -n '1p' | tr '|' ' ')"
REG_B="${REG_START_B}..${REG_END_B}"
REG_A="${REG_START_A}..${REG_END_A}"
MARKERS_AFTER="$(echo "${AFTER}" | sed -n '2p')"
SLICES_AFTER="$(echo "${AFTER}" | sed -n '3p')"

printf '%s\n' "[A04][CANCEL_SAFETY]"
if [[ "${REV_B}" == "${REV_A}" ]]; then REV_OK=PASS; else REV_OK=FAIL; fi
if [[ "${REG_B}" == "${REG_A}" ]]; then REG_OK=PASS; else REG_OK=FAIL; fi
if [[ "${MARKERS_BEFORE}" == "${MARKERS_AFTER}" ]]; then MARK_OK=PASS; else MARK_OK=FAIL; fi
if [[ "${SLICES_BEFORE}" == "${SLICES_AFTER}" ]]; then SLICE_OK=PASS; else SLICE_OK=FAIL; fi
printf '%s\n' "revision: before=${REV_B} after=${REV_A} ${REV_OK}"
printf '%s\n' "region: before=${REG_B} after=${REG_A} ${REG_OK}"
printf '%s\n' "markers: before=${MARKERS_BEFORE} after=${MARKERS_AFTER} ${MARK_OK}"
printf '%s\n' "slices: before=${SLICES_BEFORE} after=${SLICES_AFTER} ${SLICE_OK}"

if [[ "${REV_B}" != "${REV_A}" || "${REG_B}" != "${REG_A}" || "${MARKERS_BEFORE}" != "${MARKERS_AFTER}" || "${SLICES_BEFORE}" != "${SLICES_AFTER}" ]]; then
  die "A04_CANCEL_SAFETY" "draft changed after cancel"
fi

FRAMES_BEFORE="$(echo "${BASELINE}" | tail -n +4 | paste -sd, -)"
FRAMES_AFTER="$(echo "${AFTER}" | tail -n +4 | paste -sd, -)"
if [[ "${FRAMES_BEFORE}" != "${FRAMES_AFTER}" ]]; then
  die "A04_CANCEL_SAFETY" "marker frames changed"
fi

FIXTURE_CANCEL_WINDOW="SUFFICIENT"
if printf '%s\n' "${AX_LAST_OUT}" | grep -q 'CANCEL_WINDOW_OBSERVED=YES'; then
  FIXTURE_CANCEL_WINDOW="SUFFICIENT"
fi
CLASSIFICATION="AUTOMATION_BUG"
if printf '%s\n' "${AX_LAST_OUT}" | grep -q 'CANCEL_AUTOMATION=PASS'; then
  CLASSIFICATION="AUTOMATION_SMOKE_ONLY"
fi
A04_READY=NO
SINGLE_RUN_STATUS=PASS
CANCEL_SAFETY_STATUS=PASS
FRESH_HOME_RUN_1=NOT_RUN
FRESH_HOME_RUN_2=NOT_RUN
FRESH_HOME_RUN_3=NOT_RUN

printf '%s\n' "A04_AUTOMATION_REHEARSAL_ONLY=PASS"
emit_final_report
