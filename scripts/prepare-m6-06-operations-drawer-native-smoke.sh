#!/usr/bin/env bash
# Isolated HOME + managed synthetic Set for MO-M6-06-DRAWER-SPEC-AND-NATIVE-1.
# Does not accept an operator output path. Never targets original Octatrack media.
set -euo pipefail

if [[ $# -ne 0 ]]; then
  printf '%s\n' "usage: $0" >&2
  printf '%s\n' "This script does not take a fixture or HOME path. It uses a managed temp root." >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SHORT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ISOLATED_HOME="${MASTEROCTA_NATIVE_ACCEPTANCE_HOME:-/tmp/masterocta-m6-06-native-${SHORT}-${STAMP}}"

mkdir -p "${ISOLATED_HOME}"

echo "work_id=MO-M6-06-DRAWER-SPEC-AND-NATIVE-1"
echo "commit=${COMMIT}"
echo "isolated_home=${ISOLATED_HOME}"
echo "native_write_status=NOT_RUN"
echo "forbidden=original_octatrack_media,user_local_music_paths,arbitrary_cli_output"

PREPARE="${ROOT_DIR}/scripts/prepare-ui-workspace-native-acceptance.sh"
if [[ ! -f "${PREPARE}" ]]; then
  echo "missing shared native prepare script: ${PREPARE}" >&2
  exit 1
fi

PREP_LOG="${ISOLATED_HOME}/shared-prepare.log"
set +e
MASTEROCTA_NATIVE_ACCEPTANCE_HOME="${ISOLATED_HOME}" \
  bash "${PREPARE}" >"${PREP_LOG}" 2>&1
PREP_STATUS=$?
set -e
cat "${PREP_LOG}"

if [[ "${PREP_STATUS}" -ne 0 ]]; then
  echo "shared UI workspace native prepare failed" >&2
  exit "${PREP_STATUS}"
fi

FIXTURE_ROOT="$(awk -F= '/^fixture_root=/{print substr($0, index($0,$2)); found=1} END{if(!found) exit 1}' "${PREP_LOG}")"

cat <<EOF

=== M6-06 Operations Drawer Native write (operator; macOS Tauri) ===
Register (read-only): ${FIXTURE_ROOT}
Target after clone:   SET/AUDIO/ops_rename_src.wav
Overlay:              Operations Drawer (role=dialog). No central Operation Modal.
Write:                managed clone + rename PREPARE only. Do not Apply.
Never:                original Octatrack media, operator music folders, \$HOME production catalog.

Launch:
  REAL_HOME="\${REAL_HOME:-\$HOME}" \\
    ${ROOT_DIR}/scripts/launch-native-acceptance-tauri.sh $(printf '%q' "${ISOLATED_HOME}") $(printf '%q' "${ROOT_DIR}")

Protocol: docs/testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md
Acceptance: docs/planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md

EOF
