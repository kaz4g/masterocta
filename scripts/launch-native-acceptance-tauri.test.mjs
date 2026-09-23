import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildNativeAcceptanceChildEnv,
  resolveCargoExecutable,
} from "./launch-native-acceptance-env.mjs";

const ROOT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LAUNCHER = join(ROOT_DIR, "scripts/launch-native-acceptance-tauri.sh");
const REAL_NODE = process.execPath;

function fakeCargoBin(root) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const cargoPath = join(binDir, "cargo");
  writeFileSync(cargoPath, "#!/bin/sh\nexit 0\n");
  chmodSync(cargoPath, 0o755);
  return cargoPath;
}

/**
 * @param {string} stdout
 * @param {string} isolatedHome
 */
function parseChildEnv(stdout, isolatedHome) {
  assert.ok(stdout.trim().length > 0, "expected non-empty child env JSON");
  const childEnv = JSON.parse(stdout.trim());
  for (const key of ["HOME", "PATH", "CARGO_HOME", "RUSTUP_HOME"]) {
    assert.ok(typeof childEnv[key] === "string" && childEnv[key].length > 0, key);
  }
  assert.equal(childEnv.HOME, isolatedHome);
  return childEnv;
}

function spawnPrintChildEnv(launcherPath, isolatedHome, repoRoot, env = {}) {
  const nodeBinDir = dirname(process.execPath);
  return spawnSync(
    "bash",
    [launcherPath, "--print-child-env", isolatedHome, repoRoot],
    {
      env: {
        ...process.env,
        PATH: `${nodeBinDir}:/usr/bin:/bin`,
        ...env,
      },
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

function makeHarnessEnv(isolatedHome, realHomeTmp) {
  fakeCargoBin(join(realHomeTmp, ".cargo"));
  mkdirSync(isolatedHome, { recursive: true });
  return {
    REAL_HOME: realHomeTmp,
    HOME: process.env.HOME,
  };
}

/**
 * @param {string} helperStdout
 * @param {() => import("node:child_process").SpawnSyncReturns<string>} run
 */
function withStubbedEnvHelper(helperStdout, run) {
  const stubDir = mkdtempSync(join(tmpdir(), "mo-native-node-stub-"));
  const stubNode = join(stubDir, "node");
  const payload = helperStdout.replace(/'/g, `'\\''`);
  writeFileSync(
    stubNode,
    `#!/usr/bin/env bash
set -euo pipefail
REAL_NODE='${REAL_NODE.replace(/'/g, "'\\''")}'
joined="$*"
if [[ "$joined" == *launch-native-acceptance-env.mjs* ]]; then
  printf '%s' '${payload}'
  exit 0
fi
exec "$REAL_NODE" "$@"
`,
    { encoding: "utf8" },
  );
  chmodSync(stubNode, 0o755);
  try {
    return run(stubDir);
  } finally {
    rmSync(stubDir, { recursive: true, force: true });
  }
}

test("Case A: cargo on PATH is used", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-a-"));
  const cargoPath = fakeCargoBin(tmp);
  const binDir = join(tmp, "bin");
  const resolved = resolveCargoExecutable({
    pathEnv: binDir,
    cargoHome: join(tmp, "unused-cargo-home"),
    realHome: tmp,
  });
  assert.equal(resolved, cargoPath);
});

test("Case B: cargo missing from PATH but present under REAL_HOME/.cargo/bin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-b-"));
  const cargoPath = fakeCargoBin(join(tmp, ".cargo"));
  const resolved = resolveCargoExecutable({
    pathEnv: "/usr/bin:/bin",
    cargoHome: join(tmp, ".cargo"),
    realHome: tmp,
  });
  assert.equal(resolved, cargoPath);
});

test("Case C: missing cargo fails closed with explicit error", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-c-"));
  const result = buildNativeAcceptanceChildEnv({
    isolatedHome: join(tmp, "isolated"),
    realHome: tmp,
    pathEnv: "/usr/bin:/bin",
    cargoHome: join(tmp, "empty-cargo"),
    rustupHome: join(tmp, "empty-rustup"),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /cargo not found/);
  assert.match(result.error, /\.cargo\/bin/);
});

test("Case D/E: child uses isolated HOME and real toolchain homes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-de-"));
  const cargoPath = fakeCargoBin(join(tmp, ".cargo"));
  const isolated = join(tmp, "isolated-home");
  const result = buildNativeAcceptanceChildEnv({
    isolatedHome: isolated,
    realHome: tmp,
    pathEnv: dirname(cargoPath),
    cargoHome: join(tmp, ".cargo"),
    rustupHome: join(tmp, ".rustup"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.env.HOME, isolated);
  assert.equal(result.env.CARGO_HOME, join(tmp, ".cargo"));
  assert.equal(result.env.RUSTUP_HOME, join(tmp, ".rustup"));
  assert.ok(result.env.PATH.includes(dirname(cargoPath)));
});

test("Case F: launcher --print-child-env does not mutate parent HOME/PATH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-f-"));
  fakeCargoBin(join(tmp, ".cargo"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });

  const parentHome = process.env.HOME;
  const parentPath = process.env.PATH;

  const nodeBinDir = dirname(process.execPath);
  const run = spawnSync(
    "bash",
    [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
    {
      env: {
        ...process.env,
        REAL_HOME: tmp,
        PATH: `${nodeBinDir}:/usr/bin:/bin`,
        HOME: parentHome,
      },
      encoding: "utf8",
    },
  );

  assert.equal(process.env.HOME, parentHome);
  assert.equal(process.env.PATH, parentPath);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const childEnv = JSON.parse(run.stdout.trim());
  assert.equal(childEnv.HOME, isolated);
  assert.equal(childEnv.CARGO_HOME, join(tmp, ".cargo"));
  assert.equal(childEnv.RUSTUP_HOME, join(tmp, ".rustup"));
  assert.ok(childEnv.PATH.includes(join(tmp, ".cargo", "bin")));
});

test("launcher --print-child-env via relative script path returns valid JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-rel-"));
  const isolated = join(tmp, "isolated-home");
  const env = makeHarnessEnv(isolated, tmp);
  const run = spawnPrintChildEnv("scripts/launch-native-acceptance-tauri.sh", isolated, ROOT_DIR, env);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  parseChildEnv(run.stdout, isolated);
});

test("launcher --print-child-env via canonical repo path returns valid JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-can-"));
  const isolated = join(tmp, "isolated-home");
  const env = makeHarnessEnv(isolated, tmp);
  const canonicalRepo = realpathSync(ROOT_DIR);
  const run = spawnPrintChildEnv(LAUNCHER, isolated, canonicalRepo, env);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  parseChildEnv(run.stdout, isolated);
});

test("launcher --print-child-env via logical symlink repo path returns valid JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-log-"));
  const isolated = join(tmp, "isolated-home");
  const env = makeHarnessEnv(isolated, tmp);
  const logicalParent = mkdtempSync(join(tmpdir(), "mo-native-launcher-logical-parent-"));
  const logicalRepo = join(logicalParent, "checkout");
  symlinkSync(ROOT_DIR, logicalRepo);
  const logicalLauncher = join(logicalRepo, "scripts/launch-native-acceptance-tauri.sh");
  try {
    assert.notEqual(resolve(logicalRepo), realpathSync(logicalRepo));
    const run = spawnPrintChildEnv(logicalLauncher, isolated, logicalRepo, env);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    parseChildEnv(run.stdout, isolated);
  } finally {
    rmSync(logicalParent, { recursive: true, force: true });
  }
});

test("launcher fails closed when environment helper returns empty JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-empty-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  withStubbedEnvHelper("", (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /empty JSON/);
    return run;
  });
});

test("launcher fails closed when environment helper returns invalid JSON", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-badjson-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  withStubbedEnvHelper("{not-json", (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /invalid JSON/);
    return run;
  });
});

test("launcher fails closed when child environment missing HOME", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-nohome-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  const partial = JSON.stringify({
    PATH: "/bin",
    CARGO_HOME: "/tmp/cargo",
    RUSTUP_HOME: "/tmp/rustup",
  });
  withStubbedEnvHelper(partial, (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /missing HOME/);
    return run;
  });
});

test("launcher fails closed when child environment missing PATH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-nopath-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  const partial = JSON.stringify({
    HOME: isolated,
    CARGO_HOME: "/tmp/cargo",
    RUSTUP_HOME: "/tmp/rustup",
  });
  withStubbedEnvHelper(partial, (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /missing PATH/);
    return run;
  });
});

test("launcher fails closed when child environment missing CARGO_HOME", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-nocargo-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  const partial = JSON.stringify({
    HOME: isolated,
    PATH: "/bin",
    RUSTUP_HOME: "/tmp/rustup",
  });
  withStubbedEnvHelper(partial, (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /missing CARGO_HOME/);
    return run;
  });
});

test("launcher fails closed when child environment missing RUSTUP_HOME", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mo-native-launcher-norustup-"));
  const isolated = join(tmp, "isolated-home");
  mkdirSync(isolated, { recursive: true });
  const partial = JSON.stringify({
    HOME: isolated,
    PATH: "/bin",
    CARGO_HOME: "/tmp/cargo",
  });
  withStubbedEnvHelper(partial, (stubDir) => {
    const run = spawnSync(
      "bash",
      [LAUNCHER, "--print-child-env", isolated, ROOT_DIR],
      {
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /missing RUSTUP_HOME/);
    return run;
  });
});

test("prepare script prints code-derived catalog path without bundle-id segment", () => {
  const prepare = readFileSync(
    join(ROOT_DIR, "scripts/prepare-ui-workspace-native-acceptance.sh"),
    "utf8",
  );
  assert.match(
    prepare,
    /Library\/Application Support\/MasterOCTa\/catalog\.sqlite3/,
  );
  assert.doesNotMatch(
    prepare,
    /Application Support\/\$\{BUNDLE_ID\}/,
  );
  assert.doesNotMatch(
    prepare,
    /jp\.d3nousan\.masterocta\/MasterOCTa/,
  );
});

test("native acceptance docs launch from current checkout, not historical #136 worktree", () => {
  const docs = readFileSync(
    join(ROOT_DIR, "docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md"),
    "utf8",
  );
  const operatorSection = docs.slice(docs.indexOf("## Operator commands (next)"));
  assert.doesNotMatch(
    operatorSection,
    /cd \.worktrees\/ui-workspace-native-acceptance-1/,
  );
  assert.match(
    operatorSection,
    /Library\/Application Support\/MasterOCTa\/catalog\.sqlite3/,
  );
});
