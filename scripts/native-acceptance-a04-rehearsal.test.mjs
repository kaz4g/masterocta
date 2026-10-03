import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const rehearsal = readFileSync(join(dir, "native-acceptance-a04-rehearsal.sh"), "utf8");

test("rehearsal script is labeled non-canonical", () => {
  assert.match(rehearsal, /A04_AUTOMATION_REHEARSAL_ONLY/);
  assert.match(rehearsal, /NOT_CANONICAL_EVIDENCE/);
  assert.match(rehearsal, /register-root/);
  assert.match(rehearsal, /a04-reanalyze-and-cancel/);
  assert.match(rehearsal, /A04_CANCEL_SAFETY/);
  assert.doesNotMatch(rehearsal, /A04_\[A-Z_\]\+/);
  assert.match(rehearsal, /slice_count=/);
  assert.doesNotMatch(rehearsal, /markers=4/);
  assert.match(rehearsal, /MARKERS_BEFORE/);
  assert.match(rehearsal, /FRAMES_BEFORE/);
  assert.match(rehearsal, /CANCEL_WINDOW_NOT_OBSERVED/);
  assert.match(rehearsal, /CANCEL_SAFETY_STATUS=NOT_RUN/);
  assert.match(rehearsal, /SINGLE_FRESH_HOME_FULL_RUN/);
  assert.match(rehearsal, /A04_REPAIR5_FINAL_REPORT/);
  assert.match(rehearsal, /FRONTMOST_AX_NOT_STABLE/);
  assert.match(rehearsal, /CANCEL_TERMINAL_PASS/);
  assert.match(rehearsal, /emit_final_report/);
  assert.match(rehearsal, /a04-session-usable/);
  assert.match(rehearsal, /PRODUCT_BUG_FOUND/);
  assert.match(rehearsal, /CANCEL_AX_OUT/);
  const terminalAt = rehearsal.indexOf("CANCEL_TERMINAL_STATE=PASS");
  const afterAt = rehearsal.indexOf('AFTER="$(draft_snapshot)"');
  assert.ok(terminalAt > 0 && afterAt > terminalAt);
  assert.doesNotMatch(rehearsal, /sleep 340|A04_REANALYZE_CANCEL_DELAY/);
});
