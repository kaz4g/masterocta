import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const live = readFileSync(join(dir, "native-acceptance-a04-live.sh"), "utf8");

test("live runner owns a fresh HOME and separates shell pid from app pid", () => {
  assert.match(live, /\/tmp\/masterocta-native-acceptance-/);
  assert.match(live, /pgrep -x masterocta/);
  assert.match(live, /launch_shell_pid=/);
  assert.match(live, /app_pid=/);
  assert.match(live, /APP_PID\}" != "\$\{LAUNCH_PID\}/);
  assert.match(live, /LAUNCH_SHELL_EXITED_BEFORE_APP=YES/);
  assert.match(live, /APP_CRASH=NO/);
  assert.match(live, /LAUNCH_SHELL_STOP_CLASSIFICATION=EXPECTED_TEARDOWN/);
  assert.match(live, /APP_PROCESS_RESIDUAL=/);
  assert.match(live, /native-acceptance-a04-rehearsal\.sh/);
  assert.match(live, /ax-ready/);
  assert.match(live, /PRE_range\.sha256/);
  assert.match(live, /REFUSE_EXISTING_MASTEROCTA/);
  assert.doesNotMatch(live, /sleep 340|sleep [0-9]+ms then cancel/);
});
