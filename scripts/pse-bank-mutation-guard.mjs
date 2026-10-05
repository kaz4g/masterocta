#!/usr/bin/env node
/**
 * Bank Mutation Safety Guard for the Project Structure / Bank Editor line (#191).
 *
 * Fails closed while Bank Apply is unauthorized:
 * - production Rust in the Bank editor path may not reach a filesystem write API;
 * - the Project Structure frontend may only issue `v2_project_structure_read`;
 * - no v2 Bank / Project Structure command other than the read may exist;
 * - legacy Bank-family write commands must stay disabled;
 * - the ChangePlan / Mutation gate ledger must cover every #191 gate, and
 *   mutation / recovery gates stay BLOCKED until #182 and #183 exist.
 *
 * This is a static trip-wire, not a proof that no write syscall runs. Lifting
 * any rule belongs to the reviewed #182 / #183 work, not to an edit of the
 * ledger alone.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GUARD_SCHEMA = "masterocta-pse-bank-mutation-guard:v1";
export const LEDGER_SCHEMA = "masterocta-pse-bank-mutation-gates:v1";

const defaultRepositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const REQUIRED_RUST_TARGETS = [
  "src-tauri/src/project_structure_reader.rs",
  "src-tauri/src/project_structure_command.rs",
  "src-tauri/src/bank_validation.rs",
  "src-tauri/crates/ot-domain/src/project_structure.rs",
  "src-tauri/crates/ot-codec/src/project_structure.rs",
];
const RUST_DISCOVERY_ROOTS = ["src-tauri/src", "src-tauri/crates"];
const RUST_DISCOVERY_NAME = /(bank|project_structure)/i;

export const REQUIRED_FRONTEND_TARGETS = [
  "src/api/projectStructure.ts",
  "src/features/project-structure/",
];
const FRONTEND_FEATURE_DISCOVERY = /^(project-structure|bank)/i;
const FRONTEND_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const FRONTEND_SOURCE_FILE = /\.[cm]?[jt]sx?$/;

export const ALLOWED_PSE_IPC_COMMANDS = ["v2_project_structure_read"];
const V2_COMMAND_FAMILY = /(bank|project_structure)/;

export const LEGACY_BANK_FAMILY_COMMANDS = [
  "copy_bank",
  "copy_parts",
  "copy_patterns",
  "copy_tracks",
  "save_parts",
  "commit_part",
  "commit_all_parts",
  "reload_part",
];

export const ISSUE_191_GATE_IDS = [
  "change-plan.bank-copy-deterministic",
  "change-plan.bank-move-deterministic",
  "change-plan.bank-swap-deterministic",
  "change-plan.affected-reference-enumeration",
  "change-plan.stale-precondition-detection",
  "change-plan.plan-generation-no-write",
  "mutation.pre-manifest",
  "mutation.post-manifest",
  "mutation.expected-changed-files-only",
  "mutation.unrelated-files-preserved",
  "mutation.reference-integrity",
  "recovery.backup-creation",
  "recovery.failure-injection",
  "recovery.partial-apply-failure",
  "recovery.verify-failure",
  "recovery.rollback",
  "recovery.restores-pre-state",
  "recovery.retry-idempotency",
];
const GATE_PHASES = new Set(["change-plan", "mutation", "recovery"]);
const GATE_STATUSES = new Set(["BLOCKED", "ACTIVE"]);

const RUST_WRITE_PATTERNS = [
  [
    /\bfs::(write|rename|copy|remove_file|remove_dir|remove_dir_all|create_dir|create_dir_all|set_permissions|hard_link|soft_link)\b/,
    "std::fs write / rename / delete API",
  ],
  [/\bFile::(create|create_new|options)\b/, "File constructor that can write"],
  [
    /\.(write|append|create|create_new|truncate)\(\s*true\s*\)/,
    "OpenOptions write mode",
  ],
  [
    /\b(write_all|write_fmt|write_vectored|set_len|set_modified|set_times)\s*\(/,
    "write method on a file handle",
  ],
  [/\bio::Write\b/, "std::io::Write import"],
  [/\b(?:unix::fs::)?symlink(?:_file|_dir)?\s*\(/, "symlink creation"],
  [
    /\blibc::(O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND|O_EXCL|write|pwrite|writev|ftruncate|truncate|unlink|unlinkat|rename|renameat|renameat2|renamex_np|mkdir|mkdirat|rmdir|symlink|symlinkat|link|linkat|chmod|fchmod|fchmodat)\b/,
    "libc write / create / delete call or flag",
  ],
  [/\bto_data_file\s*\(/, "ot-tools-io file serialization"],
  [
    /\b(ot_executor|ot_backup|tempfile|write_runtime|rename_write_runtime|prepared_rename_runtime|mutation_gate|slice_export_apply)\b/,
    "dependency on a write / Apply runtime",
  ],
];

function finding(rule, target, detail) {
  return { rule, target, detail };
}

/**
 * Replaces comments and string / char literal contents with spaces so that
 * pattern and brace matching only see code tokens. Offsets are preserved.
 */
export function maskRustSource(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let index = from; index < to && index < out.length; index += 1) {
      if (out[index] !== "\n") out[index] = " ";
    }
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "/" && source[cursor + 1] === "*") {
          depth += 1;
          cursor += 2;
        } else if (source[cursor] === "*" && source[cursor + 1] === "/") {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      if (depth > 0) {
        return { masked: null, error: "unterminated block comment" };
      }
      blank(index, cursor);
      index = cursor;
      continue;
    }
    const rawMatch = /^b?r(#*)"/.exec(source.slice(index, index + 260));
    if (rawMatch && !/[A-Za-z0-9_]/.test(source[index - 1] ?? "")) {
      const terminator = `"${rawMatch[1]}`;
      const bodyStart = index + rawMatch[0].length;
      const end = source.indexOf(terminator, bodyStart);
      if (end === -1) {
        return { masked: null, error: "unterminated raw string literal" };
      }
      blank(bodyStart, end);
      index = end + terminator.length;
      continue;
    }
    if (char === '"') {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== '"') {
        cursor += source[cursor] === "\\" ? 2 : 1;
      }
      if (cursor >= source.length) {
        return { masked: null, error: "unterminated string literal" };
      }
      blank(index + 1, cursor);
      index = cursor + 1;
      continue;
    }
    if (char === "'") {
      if (next === "\\") {
        const end = source.indexOf("'", index + 2);
        if (end === -1) {
          return { masked: null, error: "unterminated char literal" };
        }
        blank(index + 1, end);
        index = end + 1;
        continue;
      }
      if (source[index + 2] === "'") {
        blank(index + 1, index + 2);
        index += 3;
        continue;
      }
    }
    index += 1;
  }
  return { masked: out.join(""), error: null };
}

/**
 * Removes `#[cfg(test)] mod name { ... }` bodies from masked source. Test
 * helpers may write to temporary fixture copies; production code may not.
 */
export function stripRustTestModules(masked) {
  let code = masked;
  const opener = /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z0-9_]+\s*\{/g;
  for (;;) {
    opener.lastIndex = 0;
    const match = opener.exec(code);
    if (!match) break;
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < code.length && depth > 0) {
      if (code[cursor] === "{") depth += 1;
      else if (code[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth > 0) {
      return { code: null, error: "unbalanced braces in a cfg(test) module" };
    }
    const removed = code.slice(match.index, cursor).replace(/[^\n]/g, " ");
    code = code.slice(0, match.index) + removed + code.slice(cursor);
  }
  return { code, error: null };
}

export function scanRustSource(target, source) {
  const { masked, error } = maskRustSource(source);
  if (error) {
    return [finding("RUST_PARSE", target, `${error}; not scanned (fail closed)`)];
  }
  const stripped = stripRustTestModules(masked);
  if (stripped.error) {
    return [finding("RUST_PARSE", target, `${stripped.error}; not scanned (fail closed)`)];
  }
  const findings = [];
  const lines = stripped.code.split("\n");
  lines.forEach((line, lineIndex) => {
    for (const [pattern, label] of RUST_WRITE_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        findings.push(
          finding(
            "RUST_WRITE_API",
            `${target}:${lineIndex + 1}`,
            `${label} (${match[0].trim()}) in the Bank editor read path; Bank Apply needs the #182 contract and #183 runner`,
          ),
        );
      }
    }
  });
  return findings;
}

function resolveImport(fromRelative, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRelative), specifier),
  );
  return resolved.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "");
}

function importIsTypeOnly(clause) {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return true;
  const braces = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (!braces) return false;
  const names = braces[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

export function scanFrontendSource(target, source, legacyWriteCommands = []) {
  const findings = [];
  for (const match of source.matchAll(/['"`](v2_[a-z0-9_]+)['"`]/g)) {
    if (!ALLOWED_PSE_IPC_COMMANDS.includes(match[1])) {
      findings.push(
        finding(
          "FRONTEND_IPC",
          target,
          `${match[1]} is not an allowed Project Structure IPC command; only ${ALLOWED_PSE_IPC_COMMANDS.join(", ")} until #182 / #183`,
        ),
      );
    }
  }
  for (const command of legacyWriteCommands) {
    const literal = new RegExp(`['"\`]${command.replace(/[:]/g, "\\:")}['"\`]`);
    if (literal.test(source)) {
      findings.push(
        finding("FRONTEND_IPC", target, `legacy write command ${command} referenced`),
      );
    }
  }

  const allowedApiModules =
    target === "src/api/projectStructure.ts"
      ? new Set(["src/api/client"])
      : new Set(["src/api/projectStructure"]);
  const imports = [
    ...source.matchAll(/(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g),
  ].map((match) => ({ clause: match[1], specifier: match[2], typeOnly: importIsTypeOnly(match[1]) }));
  for (const match of source.matchAll(/(?:\bimport|\brequire)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    imports.push({ clause: "", specifier: match[1], typeOnly: false });
  }
  for (const { specifier, typeOnly } of imports) {
    if (typeOnly) continue;
    if (specifier.startsWith("@tauri-apps/")) {
      findings.push(
        finding("FRONTEND_IMPORT", target, `direct Tauri import ${specifier}; use the Project Structure read API`),
      );
      continue;
    }
    const resolved = resolveImport(target, specifier);
    if (resolved === "src/api" || resolved.startsWith("src/api/")) {
      if (!allowedApiModules.has(resolved)) {
        findings.push(
          finding(
            "FRONTEND_IMPORT",
            target,
            `value import from ${resolved}; the Bank editor path may only use ${[...allowedApiModules].join(", ")}`,
          ),
        );
      }
    }
  }
  return findings;
}

export function parseV2Commands(source) {
  return [
    ...source.matchAll(/#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+(v2_[a-z0-9_]+)\s*\(/g),
  ].map((match) => match[1]);
}

export function scanV2CommandSurface(source) {
  const commands = parseV2Commands(source);
  if (commands.length === 0) {
    return [finding("V2_SURFACE", "src-tauri/src/v2_api.rs", "no v2 commands parsed (fail closed)")];
  }
  const findings = [];
  if (!commands.includes("v2_project_structure_read")) {
    findings.push(
      finding("V2_SURFACE", "src-tauri/src/v2_api.rs", "v2_project_structure_read is missing"),
    );
  }
  for (const command of commands) {
    if (V2_COMMAND_FAMILY.test(command) && !ALLOWED_PSE_IPC_COMMANDS.includes(command)) {
      findings.push(
        finding(
          "V2_SURFACE",
          "src-tauri/src/v2_api.rs",
          `${command} adds a Bank / Project Structure command beyond the read; requires the #182 contract and #183 gates`,
        ),
      );
    }
  }
  return findings;
}

export function parseLegacyGate(source) {
  const read = (name) => {
    const match = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(source);
    if (!match) return null;
    return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  };
  return {
    read: read("READ_COMMANDS"),
    authorized: read("AUTHORIZED_COMMANDS"),
    disabled: read("DISABLED_COMMANDS"),
  };
}

export function scanLegacyGate(source) {
  const target = "src-tauri/src/legacy_command_gate.rs";
  const gate = parseLegacyGate(source);
  if (!gate.read || !gate.authorized || !gate.disabled) {
    return [finding("LEGACY_GATE", target, "command classification arrays not parsed (fail closed)")];
  }
  const findings = [];
  for (const command of LEGACY_BANK_FAMILY_COMMANDS) {
    if (!gate.disabled.includes(command)) {
      findings.push(finding("LEGACY_GATE", target, `${command} must stay in DISABLED_COMMANDS`));
    }
    if (gate.read.includes(command) || gate.authorized.includes(command)) {
      findings.push(finding("LEGACY_GATE", target, `${command} must not be READ or AUTHORIZED`));
    }
  }
  return findings;
}

function inventoryTestNames(inventory) {
  const names = new Set();
  for (const suite of inventory?.suites ?? []) {
    for (const name of suite.required_tests ?? []) names.add(name);
  }
  return names;
}

export function evaluateLedger(ledger, { inventory, fileExists } = {}) {
  const target = "scripts/pse-bank-mutation-gates.json";
  const findings = [];
  const fail = (detail) => findings.push(finding("LEDGER", target, detail));
  if (ledger?.schema !== LEDGER_SCHEMA) {
    fail(`schema must be ${LEDGER_SCHEMA}`);
    return { findings, summary: null };
  }
  if (ledger.contract?.issue !== 182) {
    fail("contract hook must reference #182");
  }
  const contractDocument = ledger.contract?.document ?? null;
  if (contractDocument !== null) {
    if (typeof contractDocument !== "string" || !fileExists?.(contractDocument)) {
      fail(`contract document ${contractDocument} does not exist`);
    }
  }
  if (ledger.mutation_runner?.issue !== 183) {
    fail("mutation runner hook must reference #183");
  }
  if (ledger.mutation_runner?.implemented !== false) {
    fail("mutation_runner.implemented may only change together with the #183 runner and this guard");
  }

  const gates = Array.isArray(ledger.gates) ? ledger.gates : [];
  const seen = new Map();
  for (const gate of gates) {
    if (seen.has(gate.id)) fail(`duplicate gate ${gate.id}`);
    seen.set(gate.id, gate);
  }
  for (const id of ISSUE_191_GATE_IDS) {
    if (!seen.has(id)) fail(`#191 gate ${id} is missing from the ledger`);
  }
  for (const id of seen.keys()) {
    if (!ISSUE_191_GATE_IDS.includes(id)) fail(`unknown gate ${id}`);
  }

  const inventoryNames = inventoryTestNames(inventory);
  const summary = { BLOCKED: 0, ACTIVE: 0 };
  for (const gate of gates) {
    const label = gate.id ?? "<unnamed>";
    if (!GATE_PHASES.has(gate.phase)) fail(`${label} has unknown phase ${gate.phase}`);
    if (!GATE_STATUSES.has(gate.status)) {
      fail(`${label} has unknown status ${gate.status}`);
      continue;
    }
    if (typeof gate.id === "string" && !gate.id.startsWith(`${gate.phase}.`)) {
      fail(`${label} id does not match phase ${gate.phase}`);
    }
    summary[gate.status] += 1;
    const tests = Array.isArray(gate.required_tests) ? gate.required_tests : null;
    if (!tests) {
      fail(`${label} required_tests must be an array`);
      continue;
    }
    if (gate.status === "BLOCKED") {
      if (tests.length > 0) {
        fail(`${label} is BLOCKED but lists required tests; mark it ACTIVE through the gate rules instead`);
      }
      if (!Array.isArray(gate.waits_on) || gate.waits_on.length === 0) {
        fail(`${label} is BLOCKED without waits_on`);
      }
      continue;
    }
    if (gate.phase !== "change-plan") {
      fail(
        `${label} cannot be ACTIVE: mutation / recovery gates need the #182 contract and the #183 mutation runner, which this guard does not have yet`,
      );
      continue;
    }
    if (tests.length === 0) {
      fail(`${label} is ACTIVE without required tests`);
    }
    for (const test of tests) {
      if (!inventoryNames.has(test)) {
        fail(`${label} requires ${test}, which is not in scripts/pse-read-model-inventory.json`);
      }
    }
  }
  return { findings, summary };
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === "node_modules") continue;
      files.push(...listFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export function discoverTargets(repositoryRoot) {
  const relative = (full) => path.relative(repositoryRoot, full).split(path.sep).join("/");
  const rust = new Set(REQUIRED_RUST_TARGETS);
  for (const root of RUST_DISCOVERY_ROOTS) {
    for (const file of listFiles(path.join(repositoryRoot, root))) {
      const rel = relative(file);
      if (!rel.endsWith(".rs") || rel.includes("/tests/") || rel.includes("/benches/")) continue;
      if (RUST_DISCOVERY_NAME.test(path.basename(rel))) rust.add(rel);
    }
  }
  const frontendDirectories = new Set(
    REQUIRED_FRONTEND_TARGETS.filter((target) => target.endsWith("/")),
  );
  const featuresRoot = path.join(repositoryRoot, "src/features");
  if (existsSync(featuresRoot)) {
    for (const entry of readdirSync(featuresRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && FRONTEND_FEATURE_DISCOVERY.test(entry.name)) {
        frontendDirectories.add(`src/features/${entry.name}/`);
      }
    }
  }
  const frontend = new Set(REQUIRED_FRONTEND_TARGETS.filter((target) => !target.endsWith("/")));
  for (const directory of frontendDirectories) {
    for (const file of listFiles(path.join(repositoryRoot, directory))) {
      const rel = relative(file);
      if (FRONTEND_SOURCE_FILE.test(rel) && !FRONTEND_TEST_FILE.test(rel)) frontend.add(rel);
    }
  }
  return {
    rust: [...rust].sort(),
    frontend: [...frontend].sort(),
    frontendDirectories: [...frontendDirectories].sort(),
  };
}

export function runGuard({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const findings = [];
  const read = (relativePath) => {
    const full = path.join(repositoryRoot, relativePath);
    if (!existsSync(full)) {
      findings.push(finding("MISSING_TARGET", relativePath, "required guard target is missing (fail closed)"));
      return null;
    }
    return readFileSync(full, "utf8");
  };

  const targets = discoverTargets(repositoryRoot);
  for (const directory of REQUIRED_FRONTEND_TARGETS.filter((target) => target.endsWith("/"))) {
    if (!existsSync(path.join(repositoryRoot, directory))) {
      findings.push(finding("MISSING_TARGET", directory, "required guard directory is missing (fail closed)"));
    }
  }

  for (const target of targets.rust) {
    const source = read(target);
    if (source !== null) findings.push(...scanRustSource(target, source));
  }

  const legacySource = read("src-tauri/src/legacy_command_gate.rs");
  let legacyWriteCommands = [];
  if (legacySource !== null) {
    findings.push(...scanLegacyGate(legacySource));
    const gate = parseLegacyGate(legacySource);
    legacyWriteCommands = [...(gate.disabled ?? []), ...(gate.authorized ?? [])];
  }

  for (const target of targets.frontend) {
    const source = read(target);
    if (source !== null) findings.push(...scanFrontendSource(target, source, legacyWriteCommands));
  }

  const v2Source = read("src-tauri/src/v2_api.rs");
  if (v2Source !== null) findings.push(...scanV2CommandSurface(v2Source));

  let ledgerSummary = null;
  const ledgerSource = read("scripts/pse-bank-mutation-gates.json");
  const inventorySource = read("scripts/pse-read-model-inventory.json");
  if (ledgerSource !== null && inventorySource !== null) {
    let ledger;
    let inventory;
    try {
      ledger = JSON.parse(ledgerSource);
      inventory = JSON.parse(inventorySource);
    } catch (error) {
      findings.push(finding("LEDGER", "scripts/pse-bank-mutation-gates.json", `invalid JSON: ${error.message}`));
    }
    if (ledger && inventory) {
      const result = evaluateLedger(ledger, {
        inventory,
        fileExists: (relativePath) =>
          !path.isAbsolute(relativePath) &&
          !relativePath.split(/[\\/]/).includes("..") &&
          existsSync(path.join(repositoryRoot, relativePath)),
      });
      findings.push(...result.findings);
      ledgerSummary = result.summary;
    }
  }

  return {
    schema: GUARD_SCHEMA,
    verdict: findings.length === 0 ? "PASS" : "FAIL",
    exit_code: findings.length === 0 ? 0 : 1,
    scanned: {
      rust: targets.rust,
      frontend: targets.frontend,
      v2_api: "src-tauri/src/v2_api.rs",
      legacy_gate: "src-tauri/src/legacy_command_gate.rs",
    },
    gates: ledgerSummary,
    bank_apply: "NOT_AUTHORIZED",
    findings,
  };
}

export function runCli(argv) {
  const args = argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const reportIndex = args.indexOf("--report");
  const repositoryRoot =
    rootIndex !== -1 && args[rootIndex + 1] ? path.resolve(args[rootIndex + 1]) : defaultRepositoryRoot;
  const report = runGuard({ repositoryRoot });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  if (reportIndex !== -1 && args[reportIndex + 1]) {
    writeFileSync(path.resolve(args[reportIndex + 1]), text);
  }
  return report.exit_code;
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  process.exitCode = runCli(process.argv);
}
