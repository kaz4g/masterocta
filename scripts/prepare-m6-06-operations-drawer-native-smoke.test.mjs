import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { cleanupOwnedFixtureRoot } from "./ui-workspace-fixture-safe.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts/prepare-m6-06-operations-drawer-native-smoke.sh");
const REAL_NODE = process.execPath;

function spawnPrepare({ extraArgs = [], env = {}, timeout = 30000, home } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "mo-m6-06-home-"));
  const isolatedHome = home ?? join(parent, "isolated");
  const result = spawnSync("/bin/bash", [SCRIPT, ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      MASTEROCTA_NATIVE_ACCEPTANCE_HOME: isolatedHome,
      ...env,
    },
  });
  return { ...result, parent, isolatedHome };
}

function runWithStubbedGenerator(generatorStdout) {
  const stubDir = mkdtempSync(join(tmpdir(), "mo-m6-06-node-stub-"));
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
  try {
    return spawnPrepare({
      env: { PATH: `${stubDir}:${process.env.PATH ?? ""}` },
    });
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
}

test("refuses CLI fixture or HOME path arguments", () => {
  const { status, stderr, parent } = spawnPrepare({
    extraArgs: ["/tmp/not-a-safe-output"],
  });
  try {
    assert.equal(status, 2);
    assert.match(stderr, /does not take a fixture or HOME path/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("prints M6-06 work id, Drawer protocol, and native NOT_RUN", () => {
  const { status, stdout, parent, isolatedHome } = spawnPrepare();
  let fixtureRoot = "";
  try {
    assert.equal(status, 0);
    assert.match(stdout, /work_id=MO-M6-06-DRAWER-SPEC-AND-NATIVE-1/);
    assert.match(stdout, /native_write_status=NOT_RUN/);
    assert.match(stdout, /Operations Drawer/);
    assert.match(stdout, /ops_rename_src\.wav/);
    assert.match(stdout, /Do not Apply/);
    assert.match(stdout, /original Octatrack media/);
    assert.match(stdout, /launch-native-acceptance-tauri\.sh/);
    assert.match(stdout, /source_inventory=RECORDED/);
    assert.match(stdout, /--expect /);
    const match = stdout.match(/^fixture_root=(.*)$/m);
    assert.ok(match);
    fixtureRoot = match[1];
    const inventory = JSON.parse(readFileSync(join(isolatedHome, "source-inventory.json"), "utf8"));
    const paths = inventory.entries.map((entry) => entry.relativePath);
    assert.ok(paths.includes("SET/AUDIO/ops_rename_src.wav"));
    assert.ok(paths.includes("SET/ACCEPT_PROJ/project.work"));
    assert.ok(paths.includes("SET/AUDIO/RANGE.wav"));
  } finally {
    if (fixtureRoot) cleanupOwnedFixtureRoot(fixtureRoot);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("fails closed when the shared UI native prepare fails", () => {
  const { status, stderr, parent } = runWithStubbedGenerator("");
  try {
    assert.notEqual(status, 0);
    assert.match(stderr, /shared UI workspace native prepare failed|empty manifest/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects an existing directory, a symlink, the operator home, and a non-temp path", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mo-m6-06-reject-"));
  const existing = mkdtempSync(join(scratch, "existing-"));
  const target = mkdtempSync(join(scratch, "target-"));
  writeFileSync(join(target, "canary.txt"), "keep");
  const link = join(scratch, "link");
  symlinkSync(target, link);
  try {
    for (const home of [existing, link, process.env.HOME, REPO_ROOT]) {
      const { status, stderr, parent } = spawnPrepare({ home });
      try {
        assert.notEqual(status, 0, String(home));
        assert.match(stderr, /isolated home/);
        assert.equal(readFileSync(join(target, "canary.txt"), "utf8"), "keep");
        assert.equal(existsSync(join(target, "shared-prepare.log")), false);
        assert.equal(existsSync(join(target, "fixture-manifest.json")), false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
