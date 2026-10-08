#!/usr/bin/env node
/**
 * Read-only persistence receptacle for disposable project P_BANK_PERSIST.
 *
 * status / analyze / verify-manifest do not write bank bytes.
 * write-manifest writes SHA256SUMS.json only, refuses symlinks, and does not
 * follow them. Does not copy banks, encode fixtures, close #217, or change
 * BANK_CHANGEPLAN_READINESS. Unconfirmed copy (Run B lesson from #226) must not
 * feed persistence judgments.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_OFFSET } from "./pse-bank-identity-device.mjs";

export const META_SCHEMA = "masterocta.pse-bank-copy-persistence-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-copy-persistence-manifest:v1";
export const WORK_ID = "MO-PSE-BANK-COPY-PERSISTENCE-1";
const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const CHECKSUM_LEN = 2;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const REQUIRED_FILES = [
  "capture.meta.json",
  "project.work",
  "project.strd",
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
  "bank03.work",
  "bank03.strd",
  "bank04.work",
  "bank04.strd",
];

export const MATRIX_FILES = [
  "project.work",
  "project.strd",
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
  "bank03.work",
  "bank03.strd",
  "bank04.work",
  "bank04.strd",
];

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_copy_persistence",
);

export const PLANNED_CAPTURES = [
  { name: "s0_baseline_saved", stage_id: "S0", prior_transition: null },
  { name: "s1_after_copy", stage_id: "S1", prior_transition: "COPY" },
  { name: "s2_after_destination_switch", stage_id: "S2", prior_transition: "DESTINATION_SWITCH" },
  { name: "s3_after_control_switch", stage_id: "S3", prior_transition: "CONTROL_SWITCH" },
  { name: "s4_after_project_save", stage_id: "S4", prior_transition: "PROJECT_SAVE" },
  { name: "s5_after_project_reload", stage_id: "S5", prior_transition: "PROJECT_RELOAD" },
];

export const ADJACENT_TRANSITIONS = [
  { from: "s0_baseline_saved", to: "s1_after_copy", label: "COPY" },
  { from: "s1_after_copy", to: "s2_after_destination_switch", label: "DESTINATION_SWITCH" },
  { from: "s2_after_destination_switch", to: "s3_after_control_switch", label: "CONTROL_SWITCH" },
  { from: "s3_after_control_switch", to: "s4_after_project_save", label: "PROJECT_SAVE" },
  { from: "s4_after_project_save", to: "s5_after_project_reload", label: "PROJECT_RELOAD" },
];

const DEST_BANK = "bank02";
const UNTOUCHED_BANK = "bank03";
const CONTROL_BANK = "bank04";

export function plannedCapture(captureName) {
  return PLANNED_CAPTURES.find((entry) => entry.name === captureName) ?? null;
}

/**
 * Parse [STATES] with exactly one BANK= and one PATTERN= before [/STATES].
 */
export function parsePersistenceStatesSection(text) {
  const lines = text.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const starts = lines
    .map((line, index) => (line.trim() === "[STATES]" ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) {
    return { ok: false, bank: null, pattern: null };
  }
  let bankCount = 0;
  let patternCount = 0;
  let bank = null;
  let pattern = null;
  let closed = false;
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "[/STATES]") {
      closed = true;
      break;
    }
    const bankMatch = line.match(/^BANK=([0-9]+)$/);
    if (bankMatch) {
      bankCount += 1;
      bank = Number(bankMatch[1]);
      continue;
    }
    const patternMatch = line.match(/^PATTERN=([0-9]+)$/);
    if (patternMatch) {
      patternCount += 1;
      pattern = Number(patternMatch[1]);
    }
  }
  if (!closed || bankCount !== 1 || patternCount !== 1) {
    return { ok: false, bank: null, pattern: null };
  }
  if (bank > 255 || pattern > 255) {
    return { ok: false, bank: null, pattern: null };
  }
  return { ok: true, bank, pattern };
}

export function assertPlannedCaptureName(captureName) {
  if (!plannedCapture(captureName)) {
    throw new Error(`Not a planned capture: ${captureName}`);
  }
}

export function metaTemplate(planned) {
  return {
    schema: META_SCHEMA,
    stage_id: planned.stage_id,
    prior_transition: planned.prior_transition,
    project_name: "P_BANK_PERSIST",
    device: "Octatrack MkII",
    os_version: "",
    device_generated: false,
    synthetic_modification: false,
    role_source_bank_ui: "A",
    role_destination_bank_ui: "B",
    role_untouched_bank_ui: "C",
    role_control_bank_ui: "D",
    source_sentinel_present_a: null,
    dest_sentinel_present_b: null,
    destination_ui_sentinel: null,
    destination_ui_sentinel_after_reload: null,
    save_operation: "",
    copy_confirmation: "",
    project_reloaded: null,
    capture_transport: "unknown",
    capture_required_mode_change: "unknown",
    capture_may_flush_device_state: "unknown",
    capture_date: "",
    operator_note:
      "TEMPLATE. Replace after the real-device capture. Keep device_generated false until copied files and operator notes are in place. Do not invent menu labels before measurement.",
  };
}

export function assertCanonicalFixtureRoot(root = FIXTURE_ROOT) {
  const rootResolved = path.resolve(root);
  let st;
  try {
    st = lstatSync(rootResolved);
  } catch (err) {
    if (err && err.code === "ENOENT") throw new Error("Fixture root does not exist");
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error("Symlink not allowed for fixture root");
  }
  const parent = path.dirname(rootResolved);
  if (parent !== rootResolved) {
    const parentStat = lstatSync(parent);
    if (parentStat.isSymbolicLink()) {
      throw new Error("Symlink not allowed in fixture root parent");
    }
  }
  return rootResolved;
}

function canonicalFixtureRoot(rootResolved) {
  return realpathSync(rootResolved);
}

export function resolveCaptureDir(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  if (!CAPTURE_NAME.test(captureName)) {
    throw new Error(`Invalid capture name (use [a-z0-9_]+): ${captureName}`);
  }
  const rootResolved = assertCanonicalFixtureRoot(root);
  const captureDir = path.resolve(rootResolved, captureName);
  const rel = path.relative(rootResolved, captureDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Capture path escapes fixture root: ${captureName}`);
  }
  let st;
  try {
    st = lstatSync(captureDir);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return captureDir;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`Symlink not allowed for capture directory: ${captureName}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Capture path is not a directory: ${captureName}`);
  }
  const canonicalRoot = canonicalFixtureRoot(rootResolved);
  const canonicalCapture = realpathSync(captureDir);
  const canonicalRel = path.relative(canonicalRoot, canonicalCapture);
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new Error(`Capture path escapes fixture root: ${captureName}`);
  }
  return captureDir;
}

function assertRegularFile(filePath, label) {
  let st;
  try {
    st = lstatSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`Symlink not allowed in capture: ${label}`);
  }
  if (!st.isFile()) {
    throw new Error(`Not a regular file: ${label}`);
  }
  return st;
}

function readMeta(captureDir) {
  const metaPath = path.join(captureDir, "capture.meta.json");
  const st = assertRegularFile(metaPath, "capture.meta.json");
  if (!st) throw Object.assign(new Error("capture.meta.json is missing"), { code: "ENOENT" });
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.synthetic_modification !== false) {
    throw new Error("synthetic_modification capture is not evidence");
  }
  return meta;
}

function provenanceReady(meta, planned) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) throw new Error("capture provenance is incomplete");
  if (meta.stage_id !== planned.stage_id || meta.prior_transition !== planned.prior_transition) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== "P_BANK_PERSIST") {
    throw new Error("capture provenance is incomplete");
  }
  for (const key of [
    "role_source_bank_ui",
    "role_destination_bank_ui",
    "role_untouched_bank_ui",
    "role_control_bank_ui",
  ]) {
    const expected = { role_source_bank_ui: "A", role_destination_bank_ui: "B", role_untouched_bank_ui: "C", role_control_bank_ui: "D" }[key];
    if (meta[key] !== expected) throw new Error("capture role banks do not match the receptacle label");
  }
  if (
    meta.project_reloaded !== true
    && meta.project_reloaded !== false
    && meta.project_reloaded !== null
  ) {
    throw new Error("capture provenance is incomplete");
  }
  for (const key of ["os_version", "capture_date", "operator_note"]) {
    if (typeof meta[key] !== "string" || meta[key].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  if (typeof meta.save_operation !== "string" || typeof meta.copy_confirmation !== "string") {
    throw new Error("capture provenance is incomplete");
  }
  for (const transportKey of [
    "capture_transport",
    "capture_required_mode_change",
    "capture_may_flush_device_state",
  ]) {
    if (typeof meta[transportKey] !== "string" || meta[transportKey].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  return true;
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

export function buildManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const files = REQUIRED_FILES.flatMap((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) return [];
    return [{ path: name, sha256: sha256File(full), size: st.size }];
  });
  return { schema: MANIFEST_SCHEMA, capture: captureName, files };
}

/** @type {((fd: number, data: string | Buffer) => void) | null} */
let manifestWriteImpl = null;

export function setManifestWriteImpl(fn) {
  manifestWriteImpl = fn;
}

export function writeRegularFileAtomic(filePath, contents) {
  const destination = path.resolve(filePath);
  let existing = null;
  try {
    existing = lstatSync(destination);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error("Refusing non-regular manifest destination: SHA256SUMS.json");
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${process.pid}`;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(partial, flags, 0o644);
    (manifestWriteImpl ?? writeFileSync)(fd, contents);
    closeSync(fd);
    fd = null;
    renameSync(partial, destination);
  } catch (err) {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failure during cleanup.
      }
    }
    try {
      unlinkSync(partial);
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

export function writeManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  assertCanonicalFixtureRoot(root);
  const captureDir = resolveCaptureDir(captureName, root);
  for (const name of REQUIRED_FILES) {
    const st = assertRegularFile(path.join(captureDir, name), name);
    if (!st) throw new Error(`write-manifest requires a regular ${name}`);
  }
  const manifest = buildManifest(captureName, root);
  writeRegularFileAtomic(
    path.join(captureDir, "SHA256SUMS.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyManifest(captureName, root = FIXTURE_ROOT) {
  assertPlannedCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureName, root);
  const fileSetOk = Array.isArray(recorded.files)
    && recorded.files.length === REQUIRED_FILES.length
    && REQUIRED_FILES.every((name) => recorded.files.some((entry) => entry.path === name));
  return {
    ok: recorded.schema === MANIFEST_SCHEMA
      && recorded.capture === captureName
      && fileSetOk
      && JSON.stringify(recorded.files) === JSON.stringify(fresh.files),
    recorded_files: recorded.files ?? null,
    fresh_files: fresh.files,
  };
}

function manifestVerified(captureName, root) {
  try {
    const verified = verifyManifest(captureName, root);
    return verified.ok ? { ok: true } : { ok: false, error: "SHA256SUMS.json is stale" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function captureRow(planned, root) {
  const plannedMeta = {
    capture_label: planned.name,
    stage_id: planned.stage_id,
    prior_transition: planned.prior_transition,
  };
  let captureDir;
  try {
    captureDir = resolveCaptureDir(planned.name, root);
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
  let meta;
  try {
    meta = readMeta(captureDir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || String(err.message).includes("missing"))) {
      return { ...plannedMeta, capture_status: "MISSING" };
    }
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
  try {
    if (!provenanceReady(meta, planned)) {
      return { ...plannedMeta, capture_status: "WAITING", stage_id: planned.stage_id };
    }
    for (const name of REQUIRED_FILES) {
      const st = assertRegularFile(path.join(captureDir, name), name);
      if (!st) throw new Error(`device_generated capture is missing ${name}`);
      const cap = name.startsWith("project.") ? PROJECT_WORK_CAP_BYTES : BANK_FILE_CAP_BYTES;
      if (st.size > cap) throw new Error(`${name} exceeds its size cap`);
    }
    const projectPath = path.join(captureDir, "project.work");
    const states = parsePersistenceStatesSection(readFileSync(projectPath, "latin1"));
    if (!states.ok) throw new Error("project.work [STATES] must contain one BANK and one PATTERN");
    const manifest = manifestVerified(planned.name, root);
    if (!manifest.ok) throw new Error(manifest.error);
    return {
      ...plannedMeta,
      capture_status: "PRESENT",
      stage_id: planned.stage_id,
      manifest_verified: true,
    };
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
}

function frozenPolicyFields() {
  return {
    work_id: WORK_ID,
    offset_585459_classification: "CONTENT_DEPENDENT",
    copy_state_doc_rule: "BLOCKED",
    active_bank_retarget_rule: "BLOCKED",
    bank_changeplan_readiness: "NOT_READY",
    issue_217: "OPEN",
    issue_221: "OPEN",
    copy_saved_checkpoint_semantics: "UNKNOWN",
    persistence_harness: "READY",
  };
}

function deviceCaptureStatus(captures) {
  if (captures.some((row) => row.capture_status === "REJECTED")) return "REJECTED";
  if (captures.every((row) => row.capture_status === "PRESENT")) return "PASS";
  if (captures.every((row) => row.capture_status === "WAITING" || row.capture_status === "MISSING")) {
    return "WAITING_FOR_REAL_DEVICE";
  }
  return "INCOMPLETE";
}

export function persistenceStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const device_capture = deviceCaptureStatus(captures);
  const base = {
    ...frozenPolicyFields(),
    device_capture,
    captures,
  };
  if (device_capture === "WAITING_FOR_REAL_DEVICE") {
    return {
      ...base,
      copy_command_effect: "NOT_RUN",
      persistence_judgment: "NOT_RUN",
      result: "WAITING_FOR_REAL_DEVICE",
    };
  }
  if (device_capture !== "PASS") {
    return {
      ...base,
      copy_command_effect: "NOT_RUN",
      persistence_judgment: "NOT_RUN",
      result: device_capture === "REJECTED" ? "STOP_WITH_FINDINGS" : "WAITING_FOR_REAL_DEVICE",
    };
  }
  const dataset = buildPersistenceDatasetFromFixture(root);
  const judged = classifyPersistence(dataset);
  return { ...base, ...judged.summary, result: judged.result };
}

function readStageFilesFromDir(captureDir) {
  const files = {};
  for (const name of MATRIX_FILES) {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) throw new Error(`missing ${name}`);
    files[name] = readFileSync(full);
  }
  return files;
}

export function buildPersistenceDatasetFromFixture(root, options = {}) {
  const stages = PLANNED_CAPTURES.map((planned) => {
    const captureDir = resolveCaptureDir(planned.name, root);
    const meta = readMeta(captureDir);
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      prior_transition: planned.prior_transition,
      meta,
      files: readStageFilesFromDir(captureDir),
    };
  });
  return {
    stages,
    dest_typed_first_change: options.dest_typed_first_change ?? null,
  };
}

function sentinelYes(value) {
  return value === true || value === "YES" || value === "PRESENT";
}

function sentinelNo(value) {
  return value === false || value === "NO" || value === "ABSENT";
}

export function copySuccessGate(stages) {
  const byId = Object.fromEntries(stages.map((stage) => [stage.stage_id, stage.meta]));
  const s0 = byId.S0;
  const s2 = byId.S2;
  if (!s0 || !s2) {
    return { ok: false, reason: "MISSING_STAGE_META" };
  }
  if (!sentinelYes(s0.source_sentinel_present_a)) {
    return { ok: false, reason: "S0_SOURCE_SENTINEL" };
  }
  if (!sentinelNo(s0.dest_sentinel_present_b)) {
    return { ok: false, reason: "S0_DEST_SENTINEL" };
  }
  if (s2.destination_ui_sentinel !== "PRESENT") {
    return { ok: false, reason: "S2_UI_SENTINEL" };
  }
  return { ok: true, reason: null };
}

function buffersEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

function pinnedOffsetReport(buf) {
  if (!Buffer.isBuffer(buf) || buf.length <= PINNED_OFFSET) return null;
  return buf[PINNED_OFFSET];
}

export function buildTransitionMatrix(stages) {
  const baseline = stages[0];
  if (!baseline || baseline.stage_id !== "S0") {
    throw new Error("Persistence dataset must start at S0");
  }
  const baselineSha = {};
  for (const name of MATRIX_FILES) {
    baselineSha[name] = sha256Buffer(baseline.files[name]);
  }
  const transitions = ADJACENT_TRANSITIONS.map((edge) => {
    const fromStage = stages.find((stage) => stage.capture_name === edge.from);
    const toStage = stages.find((stage) => stage.capture_name === edge.to);
    if (!fromStage || !toStage) throw new Error(`Missing stage for ${edge.label}`);
    const cells = MATRIX_FILES.map((fileName) => {
      const before = fromStage.files[fileName];
      const after = toStage.files[fileName];
      const same_length = before.length === after.length;
      const raw_equal = buffersEqual(before, after);
      return {
        file: fileName,
        same_length,
        raw_equal,
        sha256_before: sha256Buffer(before),
        sha256_after: sha256Buffer(after),
      };
    });
    const length_mismatch = cells.some((cell) => !cell.same_length);
    return {
      transition: edge.label,
      from: edge.from,
      to: edge.to,
      length_mismatch,
      cells,
    };
  });

  const firstChangedAt = (suffix) => {
    const fileName = `${DEST_BANK}.${suffix}`;
    const base = baselineSha[fileName];
    for (const stage of stages.slice(1)) {
      if (sha256Buffer(stage.files[fileName]) !== base) {
        return stage.stage_id;
      }
    }
    return "NONE";
  };

  const perStagePinned = stages.map((stage) => ({
    stage_id: stage.stage_id,
    dest_work_offset: pinnedOffsetReport(stage.files[`${DEST_BANK}.work`]),
    dest_strd_offset: pinnedOffsetReport(stage.files[`${DEST_BANK}.strd`]),
  }));

  return {
    baseline_stage: "S0",
    transitions,
    dest_work_first_changed_at: firstChangedAt("work"),
    dest_strd_first_changed_at: firstChangedAt("strd"),
    per_stage_pinned_offset: perStagePinned,
  };
}

function sideEffectOnNonDest(transition) {
  const prefixes = [UNTOUCHED_BANK, CONTROL_BANK];
  return transition.cells.some(
    (cell) => prefixes.some((prefix) => cell.file.startsWith(`${prefix}.`)) && !cell.raw_equal,
  );
}

function destChanged(transition) {
  return transition.cells.some(
    (cell) => cell.file.startsWith(`${DEST_BANK}.`) && !cell.raw_equal,
  );
}

function projectBankAtStage(stage) {
  const parsed = parsePersistenceStatesSection(stage.files["project.work"].toString("latin1"));
  return parsed.ok ? parsed.bank : null;
}

/**
 * Classify persistence from an ordered S0–S5 in-memory dataset.
 * Synthetic-only typed hints may be supplied; real fixture analysis leaves them null.
 */
export function classifyPersistence(dataset) {
  const shell = {
    ...frozenPolicyFields(),
    copy_command_effect: "NOT_RUN",
    persistence_judgment: "NOT_RUN",
    copy_effect_first_observed_on_disk: "NOT_RUN",
    dest_work_first_changed_at: "NOT_RUN",
    dest_strd_first_changed_at: "NOT_RUN",
    work_strd_divergence_observed: "NOT_RUN",
    copy_survives_project_reload: "UNKNOWN",
    project_state_copy_retarget_observed: "NOT_RUN",
    copy_persistence_boundary: "NOT_RUN",
    runtime_or_save_side_effect: "NOT_RUN",
    transition_matrix: null,
  };

  const stages = dataset?.stages;
  if (!Array.isArray(stages) || stages.length !== PLANNED_CAPTURES.length) {
    return {
      ...shell,
      result: "STOP_WITH_FINDINGS",
      persistence_judgment: "INCOMPLETE_DATASET",
    };
  }

  let matrix;
  try {
    matrix = buildTransitionMatrix(stages);
  } catch (err) {
    return {
      ...shell,
      result: "STOP_WITH_FINDINGS",
      persistence_judgment: "INCOMPLETE_DATASET",
      error: err.message,
    };
  }

  shell.transition_matrix = matrix;
  shell.dest_work_first_changed_at = matrix.dest_work_first_changed_at;
  shell.dest_strd_first_changed_at = matrix.dest_strd_first_changed_at;
  shell.work_strd_divergence_observed = matrix.dest_work_first_changed_at !== matrix.dest_strd_first_changed_at
    && matrix.dest_work_first_changed_at !== "NONE"
    && matrix.dest_strd_first_changed_at !== "NONE"
    ? "YES"
    : matrix.dest_work_first_changed_at === "NONE" && matrix.dest_strd_first_changed_at === "NONE"
      ? "NO"
      : "NO";

  if (matrix.transitions.some((entry) => entry.length_mismatch)) {
    return {
      ...shell,
      result: "STOP_WITH_FINDINGS",
      persistence_judgment: "LENGTH_MISMATCH",
      summary: shell,
    };
  }

  const gate = copySuccessGate(stages);
  if (!gate.ok) {
    return {
      ...shell,
      copy_command_effect: "UNCONFIRMED",
      persistence_judgment: "NOT_RUN",
      result: "STOP_WITH_FINDINGS",
      copy_gate_reason: gate.reason,
      summary: shell,
    };
  }

  shell.copy_command_effect = "CONFIRMED";

  const copyTransition = matrix.transitions.find((entry) => entry.transition === "COPY");
  const saveTransition = matrix.transitions.find((entry) => entry.transition === "PROJECT_SAVE");
  if (copyTransition && destChanged(copyTransition)) {
    shell.copy_effect_first_observed_on_disk = "COPY";
  } else if (saveTransition && destChanged(saveTransition)) {
    shell.copy_effect_first_observed_on_disk = "PROJECT_SAVE";
  } else {
    shell.copy_effect_first_observed_on_disk = "UNKNOWN";
  }

  const s0Bank = projectBankAtStage(stages[0]);
  const s1Bank = projectBankAtStage(stages[1]);
  shell.project_state_copy_retarget_observed = s0Bank != null && s1Bank != null && s0Bank !== s1Bank ? "YES" : "NO";

  const sideEffects = matrix.transitions
    .filter((entry) => sideEffectOnNonDest(entry))
    .map((entry) => entry.transition);
  shell.runtime_or_save_side_effect = sideEffects.length > 0 ? sideEffects.join("+") : "NONE";

  const s5Meta = stages.find((stage) => stage.stage_id === "S5")?.meta;
  if (s5Meta?.destination_ui_sentinel_after_reload === "PRESENT") {
    shell.copy_survives_project_reload = "YES";
  } else if (s5Meta?.destination_ui_sentinel_after_reload === "ABSENT" || s5Meta?.destination_ui_sentinel_after_reload === "NO") {
    shell.copy_survives_project_reload = "NO";
  } else {
    shell.copy_survives_project_reload = "UNKNOWN";
  }

  const lastDestChange = matrix.transitions
    .filter((entry) => destChanged(entry))
    .map((entry) => entry.transition)
    .pop();
  shell.copy_persistence_boundary = lastDestChange ?? "NONE_OBSERVED";

  const transportUnknown = stages.some((stage) => stage.meta.capture_transport === "unknown");
  shell.copy_saved_checkpoint_semantics = transportUnknown ? "UNKNOWN" : "UNKNOWN";

  shell.persistence_judgment = "OBSERVATION_ONLY";
  return {
    ...shell,
    result: "STOP_WITH_FINDINGS",
    summary: shell,
  };
}

export function analyzePersistence(root = FIXTURE_ROOT) {
  const status = persistenceStatus(root);
  if (status.device_capture !== "PASS") {
    return {
      ...status,
      fixture_no_write: "PASS",
    };
  }
  const dataset = buildPersistenceDatasetFromFixture(root);
  const judged = classifyPersistence(dataset);
  return {
    ...status,
    ...judged,
    fixture_no_write: "PASS",
  };
}

function main() {
  const [, , command, captureName] = process.argv;
  try {
    if (command === "status") {
      console.log(JSON.stringify(persistenceStatus(), null, 2));
      return;
    }
    if (command === "analyze") {
      console.log(JSON.stringify(analyzePersistence(), null, 2));
      return;
    }
    if (command === "write-manifest") {
      if (!captureName) throw new Error("write-manifest requires a capture name");
      const manifest = writeManifest(captureName);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      if (!captureName) throw new Error("verify-manifest requires a capture name");
      const result = verifyManifest(captureName);
      if (!result.ok) {
        console.error("manifest mismatch");
        process.exitCode = 1;
        return;
      }
      console.log("manifest matches");
      return;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.error(
    "Usage: node scripts/pse-bank-copy-persistence.mjs <status|analyze|write-manifest|verify-manifest> [capture]",
  );
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
