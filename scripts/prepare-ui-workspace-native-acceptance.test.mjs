import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREPARE_SCRIPT = join(REPO_ROOT, "scripts/prepare-ui-workspace-native-acceptance.sh");
const REAL_NODE = process.execPath;

/**
 * @param {string} generatorStdout
 */
function runPrepareWithStubbedGenerator(generatorStdout) {
  const stubDir = mkdtempSync(join(tmpdir(), "mo-native-node-stub-"));
  const stubNode = join(stubDir, "node");
  const payload = generatorStdout.replace(/'/g, `'\\''`);
  writeFileSync(
    stubNode,
    `#!/usr/bin/env bash
set -euo pipefail
REAL_NODE='${REAL_NODE.replace(/'/g, "'\\''")}'
joined="$*"
if [[ "$joined" == *generate-ui-workspace-native-fixture.mjs* ]]; then
  printf '%s' '${payload}'
  exit 0
fi
exec "$REAL_NODE" "$@"
`,
    { encoding: "utf8" },
  );
  chmodSync(stubNode, 0o755);
  const isolatedHome = mkdtempSync(join(tmpdir(), "mo-native-prep-home-"));
  try {
    const result = spawnSync("bash", [PREPARE_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ""}`,
        MASTEROCTA_NATIVE_ACCEPTANCE_HOME: isolatedHome,
      },
    });
    return { ...result, isolatedHome, stubDir };
  } catch (error) {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
    throw error;
  }
}

test("prepare fails closed on empty generator manifest", () => {
  const { status, stderr, stubDir, isolatedHome } = runPrepareWithStubbedGenerator("");
  try {
    assert.notEqual(status, 0);
    assert.match(stderr, /empty manifest/);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("prepare fails closed on invalid generator JSON", () => {
  const { status, stderr, stubDir, isolatedHome } = runPrepareWithStubbedGenerator("{not-json");
  try {
    assert.notEqual(status, 0);
    assert.match(stderr, /not valid JSON|validation failed/);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("prepare fails closed when fixtureRoot is missing", () => {
  const { status, stderr, stubDir, isolatedHome } = runPrepareWithStubbedGenerator("{}");
  try {
    assert.notEqual(status, 0);
    assert.match(stderr, /missing fixtureRoot|validation failed/);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});
