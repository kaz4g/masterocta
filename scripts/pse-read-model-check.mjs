#!/usr/bin/env node
/**
 * Shared local/CI entry for Project Structure Read Model checks.
 *
 * Runs the real masterocta / ot-domain tests listed in
 * scripts/pse-read-model-inventory.json, then copies tracked fixtures into a
 * temporary tree and proves PRE/POST byte identity around the product reader.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  captureToFile,
  compareManifests,
  formatSummary,
  loadManifestFile,
  writeJsonAtomic,
} from "./pse-fixture-manifest.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tauriDir = path.join(repositoryRoot, "src-tauri");
const inventoryPath = path.join(
  repositoryRoot,
  "scripts/pse-read-model-inventory.json",
);
const INVENTORY_SCHEMA = "masterocta-pse-read-model-inventory:v1";

export class CheckStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CheckStop";
    this.code = code;
  }
}

export function loadInventory(raw = readFileSync(inventoryPath, "utf8")) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CheckStop("MALFORMED_INVENTORY", "inventory is not valid JSON");
  }
  if (parsed.schema !== INVENTORY_SCHEMA) {
    throw new CheckStop(
      "SCHEMA_MISMATCH",
      `inventory schema is ${JSON.stringify(parsed.schema)}`,
    );
  }
  if (!Array.isArray(parsed.suites) || parsed.suites.length === 0) {
    throw new CheckStop("MALFORMED_INVENTORY", "inventory suites are missing");
  }
  return parsed;
}

export function parseListedTests(output) {
  const tests = [];
  const ignored = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(.+): test(?:, ignore)?$/);
    if (!match) {
      continue;
    }
    const name = match[1].trim();
    if (line.includes(", ignore")) {
      ignored.push(name);
    } else {
      tests.push(name);
    }
  }
  return { tests, ignored };
}

export function parseExecutedTests(output) {
  const executed = [];
  const failed = [];
  const ignored = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^test (\S+) \.\.\. (ok|FAILED|ignored|ignored, )/);
    if (!match) {
      continue;
    }
    const [, name, status] = match;
    if (status.startsWith("ignored")) {
      ignored.push(name);
    } else if (status === "FAILED") {
      failed.push(name);
      executed.push(name);
    } else {
      executed.push(name);
    }
  }
  const summary = output.match(
    /test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/,
  );
  return {
    executed,
    failed,
    ignored,
    passedCount: summary ? Number(summary[1]) : executed.length - failed.length,
    failedCount: summary ? Number(summary[2]) : failed.length,
    ignoredCount: summary ? Number(summary[3]) : ignored.length,
  };
}

export function shortName(fullName) {
  const parts = fullName.split("::");
  return parts[parts.length - 1];
}

export function requiredTestStatus(required, listed, ignoredListed, executed) {
  const listedShort = new Set(listed.map(shortName));
  const ignoredShort = new Set(ignoredListed.map(shortName));
  const executedShort = new Set(executed.map(shortName));
  const missing = [];
  const ignoredRequired = [];
  const notRun = [];
  for (const name of required) {
    if (ignoredShort.has(name)) {
      ignoredRequired.push(name);
      continue;
    }
    if (!listedShort.has(name)) {
      missing.push(name);
      continue;
    }
    if (!executedShort.has(name)) {
      notRun.push(name);
    }
  }
  return { missing, ignoredRequired, notRun };
}

function cargoPathEnv() {
  const cargoBin = path.join(process.env.HOME ?? "", ".cargo", "bin");
  return cargoBin ? `${cargoBin}:${process.env.PATH ?? ""}` : process.env.PATH;
}

function runCargo(args, extraEnv = {}) {
  const result = spawnSync("cargo", args, {
    cwd: tauriDir,
    env: { ...process.env, PATH: cargoPathEnv(), ...extraEnv },
    encoding: "utf8",
  });
  if (result.error) {
    throw new CheckStop("CARGO_START", result.error.message);
  }
  return result;
}

export function cargoArgsForSuite(suite, extra) {
  const args = ["test", "--locked", "-p", suite.package, "--lib"];
  if (suite.features?.length) {
    args.push("--features", suite.features.join(","));
  }
  args.push(suite.filter, "--", ...extra);
  return args;
}

function assertSuiteInventory(suite) {
  const listedRun = runCargo(cargoArgsForSuite(suite, ["--list"]));
  const listedOutput = `${listedRun.stdout ?? ""}\n${listedRun.stderr ?? ""}`;
  if (listedRun.status !== 0) {
    throw new CheckStop(
      "LIST_FAILED",
      `${suite.id} cargo --list exited ${listedRun.status}\n${listedOutput}`,
    );
  }
  const { tests, ignored } = parseListedTests(listedOutput);
  if (tests.length === 0 && ignored.length === 0) {
    throw new CheckStop(
      "ZERO_TESTS",
      `${suite.id} listed 0 tests for filter ${JSON.stringify(suite.filter)}`,
    );
  }
  const executedRun = runCargo(cargoArgsForSuite(suite, ["--nocapture"]));
  const executedOutput = `${executedRun.stdout ?? ""}\n${executedRun.stderr ?? ""}`;
  const parsed = parseExecutedTests(executedOutput);
  if (parsed.passedCount === 0 && parsed.failedCount === 0) {
    throw new CheckStop(
      "ZERO_TESTS",
      `${suite.id} executed 0 tests for filter ${JSON.stringify(suite.filter)}`,
    );
  }
  const status = requiredTestStatus(
    suite.required_tests,
    tests,
    ignored,
    parsed.executed,
  );
  if (status.missing.length > 0) {
    throw new CheckStop(
      "MISSING_REQUIRED",
      `${suite.id} missing required tests: ${status.missing.join(", ")}`,
    );
  }
  if (status.ignoredRequired.length > 0) {
    throw new CheckStop(
      "IGNORED_REQUIRED",
      `${suite.id} required tests are ignored: ${status.ignoredRequired.join(", ")}`,
    );
  }
  if (status.notRun.length > 0) {
    throw new CheckStop(
      "NOT_RUN_REQUIRED",
      `${suite.id} required tests did not execute: ${status.notRun.join(", ")}`,
    );
  }
  if (parsed.failed.length > 0 || executedRun.status !== 0) {
    throw new CheckStop(
      "TEST_FAILED",
      `${suite.id} failed: ${parsed.failed.join(", ") || `exit ${executedRun.status}`}\n${executedOutput}`,
    );
  }
  return {
    id: suite.id,
    listed: tests.length,
    ignoredListed: ignored.length,
    executed: parsed.executed.length,
    passed: parsed.passedCount,
    required: suite.required_tests.length,
  };
}

function fixtureDir(name) {
  return path.join(tauriDir, "tests/fixtures", name);
}

function copyTrackedFiles(destination, fixture, files) {
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    cpSync(path.join(fixtureDir(fixture), file), path.join(destination, file));
  }
}

function runHarness(root, expect, extraEnv = {}) {
  const args = cargoArgsForSuite(
    {
      package: "masterocta",
      features: ["test-seams"],
      filter: "external_copy_harness_reads_when_root_is_set",
    },
    ["--nocapture"],
  );
  const result = runCargo(args, {
    PSE_READ_MODEL_ROOT: root,
    PSE_READ_MODEL_PROJECT: "SET/PROJECT",
    PSE_READ_MODEL_EXPECT: expect,
    ...extraEnv,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!output.includes(`PSE_READ_MODEL_HARNESS_OK=${expect}`)) {
    throw new CheckStop(
      "HARNESS_FAILED",
      `reader harness ${expect} did not report success (exit ${result.status})\n${output}`,
    );
  }
  if (result.status !== 0) {
    throw new CheckStop(
      "HARNESS_FAILED",
      `reader harness ${expect} exited ${result.status}\n${output}`,
    );
  }
}

function compareScenario(label, tree, evidenceDir, expect) {
  const prePath = path.join(evidenceDir, `${label}-pre.json`);
  const postPath = path.join(evidenceDir, `${label}-post.json`);
  const reportPath = path.join(evidenceDir, `${label}-compare.json`);
  const canonicalRoot = realpathSync(tree);
  captureToFile(canonicalRoot, prePath);
  runHarness(canonicalRoot, expect);
  captureToFile(tree, postPath);
  const report = compareManifests(
    loadManifestFile(prePath, `${label} pre`),
    loadManifestFile(postPath, `${label} post`),
  );
  writeJsonAtomic(reportPath, report);
  process.stdout.write(`\n>>> preserve ${label}\n`);
  process.stdout.write(formatSummary(report));
  if (report.verdict !== "PASS") {
    throw new CheckStop(
      "FIXTURE_MUTATED",
      `${label} PRE/POST mismatch: ${report.stop_reason}`,
    );
  }
  return { label, expect, pre: prePath, post: postPath, report: reportPath };
}

function runPreserve(evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  const workRoot = mkdtempSync(path.join(tmpdir(), "pse-read-model-copy-"));
  const results = [];
  try {
    const happy = path.join(workRoot, "happy");
    copyTrackedFiles(path.join(happy, "SET", "PROJECT"), "real_device", [
      "project.work",
      "bank01.work",
      "bank01.strd",
      "markers.work",
      "arr01.work",
    ]);
    results.push(compareScenario("happy", happy, evidenceDir, "ok"));

    const mixed = path.join(workRoot, "mixed");
    copyTrackedFiles(path.join(mixed, "SET", "PROJECT"), "real_device", [
      "project.work",
      "bank01.work",
    ]);
    writeFileSync(path.join(mixed, "SET", "PROJECT", "bank02.work"), "not a bank");
    results.push(compareScenario("mixed", mixed, evidenceDir, "mixed"));

    const missing = path.join(workRoot, "missing");
    copyTrackedFiles(path.join(missing, "SET", "PROJECT"), "real_device", [
      "project.work",
      "bank01.work",
    ]);
    results.push(compareScenario("missing", missing, evidenceDir, "missing"));

    if (process.platform !== "win32") {
      const linked = path.join(workRoot, "symlink");
      copyTrackedFiles(path.join(linked, "SET", "PROJECT"), "real_device", [
        "project.work",
        "bank01.work",
      ]);
      symlinkSync(
        "bank01.work",
        path.join(linked, "SET", "PROJECT", "bank02.work"),
      );
      results.push(
        compareScenario("symlink", linked, evidenceDir, "symlink_absent"),
      );
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
  return results;
}

export function runReadModelCheck({
  inventoryOnly = false,
  preserveOnly = false,
  evidenceDir = path.join(tmpdir(), `pse-read-model-evidence-${process.pid}`),
} = {}) {
  const inventory = loadInventory();
  const suiteReports = [];
  if (!preserveOnly) {
    for (const suite of inventory.suites) {
      process.stdout.write(`\n>>> inventory: ${suite.id}\n`);
      suiteReports.push(assertSuiteInventory(suite));
    }
  }
  const preserveReports = inventoryOnly ? [] : runPreserve(evidenceDir);
  const summary = {
    schema: "masterocta-pse-read-model-check:v1",
    inventory,
    suites: suiteReports,
    preserve: preserveReports,
    evidence_dir: evidenceDir,
  };
  writeJsonAtomic(path.join(evidenceDir, "summary.json"), summary);
  process.stdout.write(
    `\nread-model check PASS suites=${suiteReports.length} preserve=${preserveReports.length} evidence=${evidenceDir}\n`,
  );
  return summary;
}

function usage() {
  return `Usage:
  node scripts/pse-read-model-check.mjs [--inventory] [--preserve] [--evidence <dir>]
`;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CheckStop("USAGE", `missing value for ${name}`);
  }
  return value;
}

export function runCli(argv) {
  const args = argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(usage());
    return 0;
  }
  runReadModelCheck({
    inventoryOnly: args.includes("--inventory"),
    preserveOnly: args.includes("--preserve"),
    evidenceDir: takeOption(args, "--evidence") ?? undefined,
  });
  return 0;
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    const code = error instanceof CheckStop ? error.code : "ERROR";
    process.stderr.write(`STOP ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
