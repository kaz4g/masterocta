#!/usr/bin/env node
/**
 * Read-only capture harness for Operation B — File Manager bank file copy
 * (source project P_FM_SRC → destination project P_FM_DST).
 *
 * status / analyze / verify-manifest / dataset do not mutate device bytes.
 * write-manifest writes SHA256SUMS.json only to an explicit local capture root.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");

export const PINNED_OS_REVISION = "R0173";
export const PINNED_OS_RELEASE = "1.40";

export const META_SCHEMA = "masterocta.pse-bank-file-copy-device-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-file-copy-device-manifest:v1";
export const WORK_ID = "MO-PSE-BANK-FILE-COPY-DEVICE-CAPTURE-1";
export const OPERATION_KIND = "file_manager_bank_file_copy";
export const SOURCE_PROJECT = "P_FM_SRC";
export const DESTINATION_PROJECT = "P_FM_DST";

export const POWER_CYCLE_CONTROL_CAPTURE = "control_s0_power_cycle";
export const POWER_CYCLE_CONTROL_KIND = "power_cycle_control";

const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const META_CAP_BYTES = 256 * 1024;
const CAPTURE_NAME = /^[a-z0-9_]+$/;
const BANK_STEM = /^bank(0[1-9]|1[0-6])$/;
const PROJECT_SIDE = /^source|destination$/;

const BASE_BANK_FILES = [];
for (let i = 1; i <= 4; i += 1) {
  const stem = `bank${String(i).padStart(2, "0")}`;
  BASE_BANK_FILES.push(`${stem}.work`, `${stem}.strd`);
}

export const BASE_COMPARED_REL_PATHS = [
  "project.work",
  "project.strd",
  ...BASE_BANK_FILES,
];

export const FIXTURE_ROOT = path.join(
  SCRIPT_DIR,
  "../src-tauri/tests/fixtures/pse_bank_file_copy_device",
);

export const PLANNED_CAPTURES = [
  {
    name: "s0_baseline_both_projects_saved",
    stage_id: "S0",
    stage_semantics: "BASELINE_BOTH_PROJECTS_SAVED",
    prior_transition: null,
  },
  {
    name: "s1_after_file_manager_entry_pre_copy",
    stage_id: "S1",
    stage_semantics: "FILE_MANAGER_ENTRY_PRE_COPY",
    prior_transition: "FILE_MANAGER_ENTRY_SYNC",
  },
  {
    name: "s2_immediately_after_file_manager_copy",
    stage_id: "S2",
    stage_semantics: "IMMEDIATE_FILE_MANAGER_BANK_FILE_COPY",
    prior_transition: "FILE_MANAGER_BANK_FILE_COPY",
  },
  {
    name: "s3_after_bank_switch",
    stage_id: "S3",
    stage_semantics: "AFTER_BANK_SWITCH",
    prior_transition: "BANK_SWITCH",
  },
  {
    name: "s4_after_destination_project_save",
    stage_id: "S4",
    stage_semantics: "DESTINATION_PROJECT_SAVE",
    prior_transition: "DESTINATION_PROJECT_SAVE",
  },
  {
    name: "s5_after_destination_project_reload",
    stage_id: "S5",
    stage_semantics: "DESTINATION_PROJECT_RELOAD",
    prior_transition: "DESTINATION_PROJECT_RELOAD",
  },
];

export const ADJACENT_TRANSITIONS = [
  {
    from: "s0_baseline_both_projects_saved",
    to: "s1_after_file_manager_entry_pre_copy",
    label: "FILE_MANAGER_ENTRY_SYNC",
  },
  {
    from: "s1_after_file_manager_entry_pre_copy",
    to: "s2_immediately_after_file_manager_copy",
    label: "FILE_MANAGER_BANK_FILE_COPY",
  },
  {
    from: "s2_immediately_after_file_manager_copy",
    to: "s3_after_bank_switch",
    label: "BANK_SWITCH",
  },
  {
    from: "s3_after_bank_switch",
    to: "s4_after_destination_project_save",
    label: "DESTINATION_PROJECT_SAVE",
  },
  {
    from: "s4_after_destination_project_save",
    to: "s5_after_destination_project_reload",
    label: "DESTINATION_PROJECT_RELOAD",
  },
];

const STAGE_OPERATOR_FIELD = {
  S0: "save_operation",
  S1: "file_manager_entry_operation",
  S2: "copy_operation",
  S3: "bank_switch_operation",
  S4: "save_operation",
  S5: "reload_operation",
};

export function plannedCapture(captureName) {
  return PLANNED_CAPTURES.find((entry) => entry.name === captureName) ?? null;
}

export function assertOperationKind(meta) {
  const value = meta?.operation_kind;
  if (value === undefined || value === null || value === "") {
    throw new Error(`operation_kind must be ${OPERATION_KIND}`);
  }
  if (value !== OPERATION_KIND) {
    throw new Error(`operation_kind must be ${OPERATION_KIND}`);
  }
}

export function metaTemplate(planned) {
  return {
    schema: META_SCHEMA,
    work_id: WORK_ID,
    operation_kind: OPERATION_KIND,
    stage_id: planned.stage_id,
    stage_semantics: planned.stage_semantics,
    prior_transition: planned.prior_transition,
    source_project: SOURCE_PROJECT,
    destination_project: DESTINATION_PROJECT,
    source_bank: "A",
    destination_bank: "D",
    actual_source_filename: "",
    actual_destination_filename: "",
    copy_menu_path: "",
    copy_operation: "",
    rename_operation: "",
    current_bank_ui: "",
    current_pattern_ui: "",
    source_ui_sentinel: "",
    prior_destination_ui_sentinel: "",
    destination_ui_sentinel: "",
    capture_transport: "",
    capture_required_mode_change: "",
    capture_may_flush_device_state: "",
    capture_flush_exclusion: "",
    file_manager_entry_operation: "",
    file_manager_entry_sync_observed: "",
    bank_switch_operation: "",
    save_operation: "",
    reload_operation: "",
    manual_citation: {
      status: "UNKNOWN",
      manual_edition: "",
      section: "",
      page: "",
      source_url: "",
      quote: null,
    },
    capture_run_id: "",
    continues_from_previous_stage: "",
    device: "Octatrack MkII",
    device_model: "Octatrack MkII",
    os_revision: "",
    os_release: "",
    device_generated: false,
    synthetic_modification: false,
    capture_sequence_proven: null,
    capture_date: "",
    operator_note:
      "TEMPLATE. File Manager bank file copy on disposable P_FM_SRC / P_FM_DST. Keep device_generated false until operator confirms sequence, transport, sentinels, and manifests.",
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizedUnknown(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "unknown" || trimmed === "not_recorded";
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

function sizeCap(relPath) {
  const base = path.basename(relPath);
  if (base === "capture.meta.json" || base === "SHA256SUMS.json") return META_CAP_BYTES;
  if (base.startsWith("project.")) return PROJECT_WORK_CAP_BYTES;
  return BANK_FILE_CAP_BYTES;
}

function assertRegularFile(filePath, label) {
  let st;
  try {
    st = lstatSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed in capture: ${label}`);
  if (!st.isFile()) throw new Error(`Not a regular file: ${label}`);
  return st;
}

function assertRegularDirectory(dirPath, label) {
  let st;
  try {
    st = lstatSync(dirPath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed for directory: ${label}`);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${label}`);
  return st;
}

export function assertWriteManifestRoot(root) {
  const resolved = path.resolve(root);
  const repoReal = realpathSync(REPOSITORY_ROOT);
  let rootReal;
  try {
    rootReal = realpathSync(resolved);
  } catch {
    mkdirSync(resolved, { recursive: true });
    rootReal = realpathSync(resolved);
  }
  const rel = path.relative(repoReal, rootReal);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("write-manifest refuses repository capture roots");
  }
  if (lstatSync(rootReal).isSymbolicLink()) {
    throw new Error("write-manifest refuses symlink capture roots");
  }
  return rootReal;
}

export function assertCanonicalCaptureRoot(root) {
  const rootResolved = path.resolve(root);
  let st;
  try {
    st = lstatSync(rootResolved);
  } catch (err) {
    if (err && err.code === "ENOENT") return rootResolved;
    throw err;
  }
  if (st.isSymbolicLink()) throw new Error("Symlink capture root is not allowed");
  const parent = path.dirname(rootResolved);
  if (parent !== rootResolved) {
    try {
      if (lstatSync(parent).isSymbolicLink()) throw new Error("Symlink parent capture root is not allowed");
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  }
  return rootResolved;
}

export function resolveCaptureDir(captureName, root) {
  if (captureName !== POWER_CYCLE_CONTROL_CAPTURE && !plannedCapture(captureName)) {
    throw new Error(`Not a planned capture: ${captureName}`);
  }
  if (!CAPTURE_NAME.test(captureName)) throw new Error(`Invalid capture name: ${captureName}`);
  const rootResolved = assertCanonicalCaptureRoot(root);
  const captureDir = path.join(rootResolved, captureName);
  const rel = path.relative(rootResolved, captureDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Capture path escapes capture root: ${captureName}`);
  }
  let st;
  try {
    st = lstatSync(captureDir);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return captureDir;
  }
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed for capture directory: ${captureName}`);
  if (!st.isDirectory()) throw new Error(`Capture path is not a directory: ${captureName}`);
  const canonicalRel = path.relative(realpathSync(rootResolved), realpathSync(captureDir));
  if (canonicalRel.startsWith("..") || path.isAbsolute(canonicalRel)) {
    throw new Error(`Capture path escapes capture root: ${captureName}`);
  }
  return captureDir;
}

function resolveProjectSideDir(captureDir, side) {
  if (!PROJECT_SIDE.test(side)) throw new Error(`Invalid project side: ${side}`);
  const sideDir = path.join(captureDir, side);
  const rel = path.relative(captureDir, sideDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Project side escapes stage: ${side}`);
  return sideDir;
}

function assertRelPathUnderSide(relPath) {
  if (relPath.includes("..") || path.isAbsolute(relPath)) {
    throw new Error(`Invalid relative path: ${relPath}`);
  }
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..")) throw new Error(`Invalid relative path: ${relPath}`);
  return normalized.split(path.sep).join("/");
}

function isAllowedComparedRelPath(relPath) {
  const base = path.basename(relPath);
  if (BASE_COMPARED_REL_PATHS.includes(base)) return true;
  const stem = base.replace(/\.(work|strd)$/, "");
  if (!BANK_STEM.test(stem)) return false;
  return base.endsWith(".work") || base.endsWith(".strd");
}

function listComparedRelPaths(captureDir) {
  const paths = new Set(BASE_COMPARED_REL_PATHS.map((name) => `source/${name}`).concat(
    BASE_COMPARED_REL_PATHS.map((name) => `destination/${name}`),
  ));
  for (const side of ["source", "destination"]) {
    const sideDir = path.join(captureDir, side);
    let entries;
    try {
      entries = readdirSync(sideDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith("._") || entry === ".DS_Store") {
        throw new Error(`Unexpected metadata file in ${side}: ${entry}`);
      }
      const rel = assertRelPathUnderSide(`${side}/${entry}`);
      if (!isAllowedComparedRelPath(rel.replace(`${side}/`, ""))) {
        throw new Error(`Unexpected file in capture: ${rel}`);
      }
      paths.add(rel);
    }
  }
  return [...paths].sort();
}

function readMeta(captureDir) {
  const metaPath = path.join(captureDir, "capture.meta.json");
  const st = assertRegularFile(metaPath, "capture.meta.json");
  if (!st) throw Object.assign(new Error("capture.meta.json is missing"), { code: "ENOENT" });
  if (st.size > META_CAP_BYTES) throw new Error("capture.meta.json exceeds its size cap");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.synthetic_modification !== false) {
    throw new Error("synthetic_modification capture is not evidence");
  }
  return meta;
}

export function parseCaptureMayFlushState(meta) {
  const value = meta?.capture_may_flush_device_state;
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "unknown") return "unknown";
  if (normalized === "yes" || normalized === "true" || normalized === "1") return "yes";
  if (normalized === "no" || normalized === "false" || normalized === "0") return "no";
  return "unknown";
}

function transportRecorded(meta) {
  for (const key of ["capture_transport", "capture_required_mode_change"]) {
    const value = meta[key];
    if (typeof value !== "string" || value.trim() === "" || value.trim().toLowerCase() === "unknown") {
      return false;
    }
  }
  return parseCaptureMayFlushState(meta) !== "unknown";
}

function transportMayFlush(meta) {
  return parseCaptureMayFlushState(meta) === "yes";
}

const POWER_CYCLE_EXCLUSION = new RegExp(`^${POWER_CYCLE_CONTROL_KIND}(?:$|[\\s:;,(-])`);

export function flushExclusionIsPowerCycleControl(meta) {
  const value = meta?.capture_flush_exclusion;
  if (typeof value !== "string") return false;
  return POWER_CYCLE_EXCLUSION.test(value.trim());
}

function stageTransportConfidence(meta, powerCycleControl) {
  if (!transportRecorded(meta)) return "UNKNOWN";
  if (transportMayFlush(meta)) return "MAY_FLUSH";
  if (!flushExclusionIsPowerCycleControl(meta)) return "UNKNOWN";
  if (powerCycleControl !== "VERIFIED") return "UNKNOWN";
  return "NON_MUTATING_CONFIRMED";
}

export function assertPinnedFirmware(meta) {
  if (meta.os_revision?.trim() !== PINNED_OS_REVISION || meta.os_release?.trim() !== PINNED_OS_RELEASE) {
    throw new Error(`capture OS must be ${PINNED_OS_REVISION} / ${PINNED_OS_RELEASE} for this experiment`);
  }
}

function readBoundedSideFile(captureDir, relPath) {
  const normalized = assertRelPathUnderSide(relPath);
  const full = path.join(captureDir, normalized);
  const st = assertRegularFile(full, normalized);
  if (!st) throw new Error(`missing ${normalized}`);
  if (st.size > sizeCap(normalized)) throw new Error(`${normalized} exceeds its size cap`);
  return readFileSync(full);
}

function readStageSideFiles(captureDir, relPaths) {
  const files = {};
  for (const rel of relPaths) {
    files[rel] = readBoundedSideFile(captureDir, rel);
  }
  return files;
}

export function buildManifest(captureName, root) {
  const captureDir = resolveCaptureDir(captureName, root);
  const relPaths = listComparedRelPaths(captureDir);
  const files = relPaths.flatMap((relPath) => {
    const full = path.join(captureDir, ...relPath.split("/"));
    const st = assertRegularFile(full, relPath);
    if (!st) return [];
    if (st.size > sizeCap(relPath)) throw new Error(`${relPath} exceeds its size cap`);
    return [{ path: relPath, sha256: sha256File(full), size: st.size }];
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
        // ignore
      }
    }
    try {
      unlinkSync(partial);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function writeManifest(captureName, root) {
  const rootResolved = assertWriteManifestRoot(root);
  const captureDir = resolveCaptureDir(captureName, rootResolved);
  const relPaths = listComparedRelPaths(captureDir);
  for (const relPath of relPaths) {
    const st = assertRegularFile(path.join(captureDir, ...relPath.split("/")), relPath);
    if (!st) throw new Error(`write-manifest requires a regular ${relPath}`);
  }
  const manifest = buildManifest(captureName, rootResolved);
  writeRegularFileAtomic(
    path.join(captureDir, "SHA256SUMS.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyManifest(captureName, root) {
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  if (st.size > META_CAP_BYTES) throw new Error("SHA256SUMS.json exceeds its size cap");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureName, root);
  const expectedPaths = fresh.files.map((entry) => entry.path);
  const fileSetOk = Array.isArray(recorded.files)
    && recorded.files.length === expectedPaths.length
    && expectedPaths.every((name) => recorded.files.some((entry) => entry.path === name));
  return {
    ok: recorded.schema === MANIFEST_SCHEMA
      && recorded.capture === captureName
      && fileSetOk
      && JSON.stringify(recorded.files) === JSON.stringify(fresh.files),
    recorded_files: recorded.files ?? null,
    fresh_files: fresh.files,
  };
}

export function buffersEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

function sha256SideFile(files, relPath) {
  const buf = files[relPath];
  return Buffer.isBuffer(buf) ? sha256Buffer(buf) : null;
}

function fileChangedBetween(fromFiles, toFiles, relPath) {
  const before = sha256SideFile(fromFiles, relPath);
  const after = sha256SideFile(toFiles, relPath);
  if (before == null || after == null) return "NOT_COMPARED";
  return before === after ? "NO" : "YES";
}

function sharedCaptureRunId(stages) {
  const ids = stages.map((stage) => stage.meta?.capture_run_id);
  if (ids.some((id) => typeof id !== "string" || id.trim() === "" || id.trim().toLowerCase() === "unknown")) {
    return null;
  }
  const first = ids[0].trim();
  if (ids.some((id) => id.trim() !== first)) return null;
  return first;
}

function continuesFromPreviousStage(meta) {
  return typeof meta?.continues_from_previous_stage === "string"
    && meta.continues_from_previous_stage.trim().toLowerCase() === "yes";
}

function sessionContinuity(stages) {
  if (!sharedCaptureRunId(stages)) return "NOT_PROVEN";
  const postCopy = stages.filter((stage) => ["S3", "S4", "S5"].includes(stage.stage_id));
  if (postCopy.length !== 3 || postCopy.some((stage) => !continuesFromPreviousStage(stage.meta))) {
    return "NOT_PROVEN";
  }
  return "PROVEN";
}

function fileManagerEntryRecorded(meta) {
  return nonEmptyString(meta?.file_manager_entry_operation)
    || nonEmptyString(meta?.file_manager_entry_sync_observed);
}

function renameRecordedIfNeeded(meta) {
  const renameOp = String(meta?.rename_operation ?? "").trim();
  if (nonEmptyString(renameOp) && !normalizedUnknown(renameOp)) return true;
  const copyOp = String(meta?.copy_operation ?? "").toLowerCase();
  if (copyOp.includes("rename") && !nonEmptyString(renameOp)) return false;
  return true;
}

export function frozenPolicyFields() {
  return {
    work_id: WORK_ID,
    operation_kind: OPERATION_KIND,
    source_project: SOURCE_PROJECT,
    destination_project: DESTINATION_PROJECT,
    legacy_copy_bank: "DISABLED",
    legacy_copy_patterns: "DISABLED",
    bank_copy_apply_authorized: "NO",
    pattern_copy_apply_authorized: "NO",
    copy_state_doc_rule: "BLOCKED",
    move_state_doc_rule: "BLOCKED",
    swap_state_doc_rule: "BLOCKED",
    old_capture_promotion: "BLOCKED",
    bank_changeplan_readiness: "NOT_READY",
    apply_readiness: "NOT_READY",
    apply_authorized: "NO",
    issue_181: "OPEN",
    issue_217: "OPEN",
    issue_221: "OPEN",
    masterocta_filesystem_write: "NO",
  };
}

function stageHasAnyBytes(root, captureName) {
  const captureDir = path.join(root, captureName);
  for (const side of ["source", "destination"]) {
    for (const name of BASE_COMPARED_REL_PATHS) {
      try {
        const st = lstatSync(path.join(captureDir, side, name));
        if (st.isFile() && !st.isSymbolicLink()) return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

function sequenceProvenFromMeta(root) {
  return PLANNED_CAPTURES.every((planned) => {
    try {
      const meta = readMeta(resolveCaptureDir(planned.name, root));
      return meta.capture_sequence_proven === true;
    } catch {
      return false;
    }
  });
}

function assertProjectSideLayout(captureDir) {
  for (const side of ["source", "destination"]) {
    const sideDir = resolveProjectSideDir(captureDir, side);
    const st = assertRegularDirectory(sideDir, side);
    if (!st) throw new Error(`missing ${side}/ project directory`);
  }
}

function provenanceReady(meta, planned, captureDir) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) throw new Error("capture schema mismatch");
  assertOperationKind(meta);
  if (meta.capture_sequence_proven !== true) throw new Error("capture sequence is not proven");
  if (meta.work_id !== WORK_ID) throw new Error("capture provenance is incomplete");
  if (meta.stage_id !== planned.stage_id || meta.stage_semantics !== planned.stage_semantics) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.prior_transition !== planned.prior_transition) throw new Error("capture provenance is incomplete");
  if (meta.source_project !== SOURCE_PROJECT || meta.destination_project !== DESTINATION_PROJECT) {
    throw new Error("source/destination project metadata mismatch");
  }
  for (const key of ["os_revision", "os_release", "capture_date", "operator_note", "current_bank_ui", "current_pattern_ui"]) {
    if (!nonEmptyString(meta[key])) throw new Error("capture provenance is incomplete");
  }
  assertPinnedFirmware(meta);
  if (!transportRecorded(meta)) throw new Error("capture transport metadata is incomplete");
  const opField = STAGE_OPERATOR_FIELD[planned.stage_id];
  if (!nonEmptyString(meta[opField])) {
    throw new Error(`${planned.stage_id} must record a non-empty ${opField}`);
  }
  if (planned.stage_id === "S1" && !fileManagerEntryRecorded(meta)) {
    throw new Error("S1 requires file_manager_entry_operation or file_manager_entry_sync_observed");
  }
  if (!renameRecordedIfNeeded(meta)) {
    throw new Error("rename_operation must be recorded when source and destination filenames differ");
  }
  assertProjectSideLayout(captureDir);
  listComparedRelPaths(captureDir);
  return true;
}

function captureRow(planned, root) {
  const plannedMeta = {
    capture_label: planned.name,
    stage_id: planned.stage_id,
    stage_semantics: planned.stage_semantics,
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
    if (meta.schema !== META_SCHEMA && meta.device_generated === true) {
      throw new Error("capture schema mismatch");
    }
    if (!provenanceReady(meta, planned, captureDir)) {
      return { ...plannedMeta, capture_status: "WAITING" };
    }
    const verified = verifyManifest(planned.name, root);
    if (!verified.ok) throw new Error("SHA256SUMS.json is stale");
    return { ...plannedMeta, capture_status: "PRESENT", manifest_verified: true };
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
}

function loadPowerCycleControl(root) {
  let captureDir;
  try {
    captureDir = resolveCaptureDir(POWER_CYCLE_CONTROL_CAPTURE, root);
    lstatSync(captureDir);
  } catch (err) {
    if (err && err.code === "ENOENT") return { status: "MISSING" };
    return { status: "REJECTED", error: err.message };
  }
  try {
    if (!verifyManifest(POWER_CYCLE_CONTROL_CAPTURE, root).ok) return { status: "MANIFEST_INVALID" };
  } catch (err) {
    return { status: "MANIFEST_INVALID", error: err.message };
  }
  const relPaths = listComparedRelPaths(captureDir);
  const files = {};
  for (const relPath of relPaths) {
    files[relPath] = readBoundedSideFile(captureDir, relPath);
  }
  return { status: "MANIFEST_VERIFIED", files };
}

function judgePowerCycleControl(control, baselineStage) {
  if (!control || typeof control !== "object") return "MISSING";
  if (control.status !== "MANIFEST_VERIFIED") return control.status ?? "MISSING";
  const baseline = baselineStage?.files;
  if (!baseline || !control.files) return "MISMATCH";
  const identical = Object.keys(control.files).every((relPath) => {
    const before = baseline[relPath];
    const after = control.files[relPath];
    return Buffer.isBuffer(before) && Buffer.isBuffer(after) && sha256Buffer(before) === sha256Buffer(after);
  });
  return identical ? "VERIFIED" : "MISMATCH";
}

function readStageFiles(captureDir) {
  const relPaths = listComparedRelPaths(captureDir);
  return readStageSideFiles(captureDir, relPaths);
}

function buildTransitionMatrix(stages) {
  if (!stages[0] || stages[0].stage_id !== "S0") {
    throw new Error("File Manager bank copy dataset must start at S0");
  }
  const transitions = ADJACENT_TRANSITIONS.map((edge) => {
    const fromStage = stages.find((stage) => stage.capture_name === edge.from);
    const toStage = stages.find((stage) => stage.capture_name === edge.to);
    if (!fromStage || !toStage) throw new Error(`Missing stage for ${edge.label}`);
    const relPaths = [...new Set([
      ...Object.keys(fromStage.files),
      ...Object.keys(toStage.files),
    ])].sort();
    const cells = relPaths.map((relPath) => ({
      path: relPath,
      change: fileChangedBetween(fromStage.files, toStage.files, relPath),
    }));
    return {
      transition: edge.label,
      from: edge.from,
      to: edge.to,
      cells,
      changed_paths: cells.filter((cell) => cell.change === "YES").map((cell) => cell.path),
    };
  });
  return { transitions };
}

function sidePrefix(side) {
  return `${side}/`;
}

function bankStemFromMeta(meta) {
  const stem = String(meta?.actual_source_filename ?? "").trim();
  if (BANK_STEM.test(stem)) return stem;
  return null;
}

function destStemFromMeta(meta) {
  const stem = String(meta?.actual_destination_filename ?? "").trim();
  if (BANK_STEM.test(stem)) return stem;
  return null;
}

function untouchedBankPaths(meta) {
  const copyDest = destStemFromMeta(meta);
  const paths = [];
  for (let i = 1; i <= 4; i += 1) {
    const stem = `bank${String(i).padStart(2, "0")}`;
    if (copyDest && stem === copyDest) continue;
    paths.push(`destination/${stem}.work`, `destination/${stem}.strd`);
  }
  return paths;
}

function classifyFileManagerEvidence(dataset) {
  const shell = {
    ...frozenPolicyFields(),
    CAPTURE_SCHEMA_VALIDITY: "UNKNOWN",
    OPERATION_KIND_VALIDITY: "UNKNOWN",
    SOURCE_INTEGRITY: "UNKNOWN",
    DESTINATION_INTEGRITY: "UNKNOWN",
    STAGE_MANIFEST_INTEGRITY: "UNKNOWN",
    SESSION_CONTINUITY: "NOT_PROVEN",
    FILE_MANAGER_ENTRY_SYNC: "NOT_RECORDED",
    CAPTURE_TRANSPORT_CONFIDENCE: "UNKNOWN",
    COPY_OPERATION_ATTRIBUTION: "INCONCLUSIVE",
    WORKING_ROLE_EFFECT: "INCONCLUSIVE",
    SAVED_CHECKPOINT_ROLE_EFFECT: "INCONCLUSIVE",
    PROJECT_STATE_EFFECT: "INCONCLUSIVE",
    UNTOUCHED_BANK_INVARIANCE: "INCONCLUSIVE",
    SAMPLE_SLOT_REFERENCE_OBSERVATION: "NOT_OBSERVED",
    SAMPLE_AUDIO_COPY_OBSERVATION: "NOT_OBSERVED",
    DEVICE_EVIDENCE_PROMOTION: "BLOCKED",
    DEVICE_CAPTURE: "NOT_RUN",
    RESULT: "STOP_WITH_FINDINGS",
  };

  const stages = dataset?.stages;
  if (!Array.isArray(stages) || stages.length !== PLANNED_CAPTURES.length) {
    return shell;
  }

  let schemaOk = true;
  let operationOk = true;
  for (const stage of stages) {
    try {
      if (stage.meta.schema !== META_SCHEMA) schemaOk = false;
      assertOperationKind(stage.meta);
    } catch {
      schemaOk = false;
      operationOk = false;
    }
  }
  shell.CAPTURE_SCHEMA_VALIDITY = schemaOk ? "PASS" : "FAIL";
  shell.OPERATION_KIND_VALIDITY = operationOk ? "PASS" : "FAIL";
  if (!schemaOk || !operationOk) {
    return { ...shell, RESULT: "BLOCKED" };
  }

  shell.STAGE_MANIFEST_INTEGRITY = dataset.manifest_integrity ?? "UNKNOWN";
  shell.SESSION_CONTINUITY = sessionContinuity(stages);

  const s0 = stages.find((stage) => stage.stage_id === "S0");
  const s1 = stages.find((stage) => stage.stage_id === "S1");
  const s2 = stages.find((stage) => stage.stage_id === "S2");
  if (!s0 || !s1 || !s2) return shell;

  const sourcePaths = Object.keys(s0.files).filter((rel) => rel.startsWith("source/"));
  const destPaths = Object.keys(s0.files).filter((rel) => rel.startsWith("destination/"));
  const sourceStable = sourcePaths.every((relPath) =>
    ["S0", "S1", "S2", "S3", "S4", "S5"].every((stageId) => {
      const stage = stages.find((entry) => entry.stage_id === stageId);
      if (!stage?.files?.[relPath]) return false;
      return sha256SideFile(s0.files, relPath) === sha256SideFile(stage.files, relPath);
    }));
  shell.SOURCE_INTEGRITY = sourceStable ? "PASS" : "FAIL";

  const destMeta = s2.meta;
  const destWork = destStemFromMeta(destMeta)
    ? `destination/${destStemFromMeta(destMeta)}.work`
    : null;
  const destStrd = destStemFromMeta(destMeta)
    ? `destination/${destStemFromMeta(destMeta)}.strd`
    : null;

  let destIntegrity = "PASS";
  for (const relPath of destPaths) {
    const hashS0 = sha256SideFile(s0.files, relPath);
    const hashS5 = sha256SideFile(stages.find((entry) => entry.stage_id === "S5").files, relPath);
    if (hashS0 == null || hashS5 == null) {
      destIntegrity = "FAIL";
      continue;
    }
    const isCopyTarget = relPath === destWork || relPath === destStrd;
    if (!isCopyTarget && hashS0 !== hashS5) destIntegrity = "FAIL";
  }
  shell.DESTINATION_INTEGRITY = destIntegrity;

  const matrix = buildTransitionMatrix(stages);
  const entryTransition = matrix.transitions.find((entry) => entry.transition === "FILE_MANAGER_ENTRY_SYNC");
  if (entryTransition && fileManagerEntryRecorded(s1.meta)) {
    shell.FILE_MANAGER_ENTRY_SYNC = entryTransition.changed_paths.length > 0 ? "OBSERVED" : "NO_BYTE_CHANGE";
  } else {
    shell.FILE_MANAGER_ENTRY_SYNC = "NOT_RECORDED";
  }

  shell.power_cycle_control = judgePowerCycleControl(dataset.power_cycle_control, s0);
  const transportConfidences = stages.map((stage) =>
    stageTransportConfidence(stage.meta, shell.power_cycle_control));
  shell.CAPTURE_TRANSPORT_CONFIDENCE = transportConfidences.includes("UNKNOWN")
    ? "UNKNOWN"
    : transportConfidences.includes("MAY_FLUSH")
      ? "MAY_FLUSH"
      : "NON_MUTATING_CONFIRMED";

  const copyTransition = matrix.transitions.find((entry) => entry.transition === "FILE_MANAGER_BANK_FILE_COPY");
  const copyPaths = copyTransition?.changed_paths ?? [];
  if (shell.CAPTURE_TRANSPORT_CONFIDENCE === "NON_MUTATING_CONFIRMED" && nonEmptyString(s2.meta?.copy_operation)) {
    shell.COPY_OPERATION_ATTRIBUTION = copyPaths.length > 0 ? "ATTRIBUTED" : "NO_BYTE_CHANGE";
  } else {
    shell.COPY_OPERATION_ATTRIBUTION = "INCONCLUSIVE";
  }

  if (destWork && copyTransition) {
    const workChange = copyTransition.cells.find((cell) => cell.path === destWork)?.change;
    shell.WORKING_ROLE_EFFECT = shell.COPY_OPERATION_ATTRIBUTION === "ATTRIBUTED" && workChange === "YES"
      ? "BYTE_CHANGED"
      : workChange === "NO"
        ? "BYTE_UNCHANGED"
        : "INCONCLUSIVE";
  }
  if (destStrd && copyTransition) {
    const strdChange = copyTransition.cells.find((cell) => cell.path === destStrd)?.change;
    shell.SAVED_CHECKPOINT_ROLE_EFFECT = shell.COPY_OPERATION_ATTRIBUTION === "ATTRIBUTED" && strdChange === "YES"
      ? "BYTE_CHANGED"
      : strdChange === "NO"
        ? "BYTE_UNCHANGED"
        : "INCONCLUSIVE";
  }

  const projectWork = "destination/project.work";
  const projectStrd = "destination/project.strd";
  const projectChanges = matrix.transitions.flatMap((transition) =>
    transition.cells.filter((cell) =>
      (cell.path === projectWork || cell.path === projectStrd) && cell.change === "YES"));
  shell.PROJECT_STATE_EFFECT = projectChanges.length > 0 ? "BYTE_CHANGED" : "BYTE_UNCHANGED";

  const untouched = untouchedBankPaths(s2.meta);
  const untouchedOk = untouched.every((relPath) =>
    ["S0", "S1", "S2", "S3", "S4", "S5"].every((stageId, index, arr) => {
      if (stageId === "S0") return true;
      const prev = stages.find((entry) => entry.stage_id === arr[index - 1]);
      const cur = stages.find((entry) => entry.stage_id === stageId);
      return sha256SideFile(prev.files, relPath) === sha256SideFile(cur.files, relPath);
    }));
  shell.UNTOUCHED_BANK_INVARIANCE = untouchedOk ? "PASS" : "FAIL";

  if (
    nonEmptyString(dataset?.sample_slot_reference_observation)
    && !normalizedUnknown(dataset.sample_slot_reference_observation)
  ) {
    shell.SAMPLE_SLOT_REFERENCE_OBSERVATION = dataset.sample_slot_reference_observation;
  }
  if (
    nonEmptyString(dataset?.sample_audio_copy_observation)
    && !normalizedUnknown(dataset.sample_audio_copy_observation)
  ) {
    shell.SAMPLE_AUDIO_COPY_OBSERVATION = dataset.sample_audio_copy_observation;
  }

  const promotableStructure =
    shell.STAGE_MANIFEST_INTEGRITY === "PASS"
    && shell.SOURCE_INTEGRITY === "PASS"
    && shell.DESTINATION_INTEGRITY === "PASS"
    && shell.SESSION_CONTINUITY === "PROVEN"
    && shell.UNTOUCHED_BANK_INVARIANCE === "PASS"
    && renameRecordedIfNeeded(s2.meta)
    && fileManagerEntryRecorded(s1.meta);

  shell.DEVICE_CAPTURE = promotableStructure ? "PASS" : "INCONCLUSIVE";
  shell.DEVICE_EVIDENCE_PROMOTION = "BLOCKED";
  shell.RESULT = promotableStructure && shell.COPY_OPERATION_ATTRIBUTION !== "INCONCLUSIVE"
    ? "READY_FOR_OPERATOR"
    : "STOP_WITH_FINDINGS";
  return shell;
}

function manifestIntegrityForRoot(root) {
  let verified = 0;
  for (const planned of PLANNED_CAPTURES) {
    try {
      if (verifyManifest(planned.name, root).ok) verified += 1;
    } catch {
      // ignore
    }
  }
  if (verified === 0) return "NOT_RUN";
  if (verified === PLANNED_CAPTURES.length) return "PASS";
  return "FAIL";
}

export function buildDatasetFromRoot(root) {
  if (!sequenceProvenFromMeta(root)) {
    throw new Error("capture sequence is not proven");
  }
  const stages = PLANNED_CAPTURES.map((planned) => {
    const captureDir = resolveCaptureDir(planned.name, root);
    if (!provenanceReady(readMeta(captureDir), planned, captureDir)) {
      throw new Error(`stage ${planned.stage_id} is not provenance-ready`);
    }
    if (!verifyManifest(planned.name, root).ok) {
      throw new Error(`stage ${planned.stage_id} manifest is stale`);
    }
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      stage_semantics: planned.stage_semantics,
      prior_transition: planned.prior_transition,
      meta: readMeta(captureDir),
      files: readStageFiles(captureDir),
    };
  });
  return {
    stages,
    manifest_integrity: "PASS",
    power_cycle_control: loadPowerCycleControl(root),
  };
}

export function evidenceStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const bytesPresent = PLANNED_CAPTURES.some((planned) => stageHasAnyBytes(root, planned.name));
  const sequenceProven = sequenceProvenFromMeta(root);
  const rejected = captures.some((row) => row.capture_status === "REJECTED");
  const allPresent = captures.every((row) => row.capture_status === "PRESENT");

  const base = {
    ...frozenPolicyFields(),
    CAPTURE_STATUS: "WAITING_FOR_OPERATOR_CAPTURE",
    capture_sequence_proven: sequenceProven ? "YES" : "NO",
    captures,
    DEVICE_CAPTURE: "NOT_RUN",
    DEVICE_EVIDENCE_PROMOTION: "BLOCKED",
  };

  if (rejected) {
    return {
      ...base,
      CAPTURE_STATUS: "REJECTED",
      RESULT: "STOP_WITH_FINDINGS",
    };
  }
  if (!sequenceProven || !allPresent) {
    return {
      ...base,
      CAPTURE_STATUS: bytesPresent ? "PARTIAL" : "WAITING_FOR_OPERATOR_CAPTURE",
      RESULT: bytesPresent ? "STOP_FOR_OPERATOR_CONFIRMATION" : "WAITING_FOR_OPERATOR_CAPTURE",
    };
  }

  try {
    const dataset = buildDatasetFromRoot(root);
    const judged = classifyFileManagerEvidence(dataset);
    return {
      ...base,
      CAPTURE_STATUS: "COMPLETE",
      ...judged,
    };
  } catch (err) {
    return {
      ...base,
      CAPTURE_STATUS: "PARTIAL",
      RESULT: "STOP_FOR_OPERATOR_CONFIRMATION",
      error: err.message,
    };
  }
}

function loadAnalyzableStages(root) {
  return PLANNED_CAPTURES.flatMap((planned) => {
    try {
      const captureDir = resolveCaptureDir(planned.name, root);
      const meta = readMeta(captureDir);
      const files = readStageFiles(captureDir);
      return [{
        capture_name: planned.name,
        stage_id: planned.stage_id,
        stage_semantics: planned.stage_semantics,
        prior_transition: planned.prior_transition,
        meta,
        files,
      }];
    } catch {
      return [];
    }
  });
}

export function analyzeFileManagerCapture(root = FIXTURE_ROOT) {
  const status = evidenceStatus(root);
  const stages = loadAnalyzableStages(root);
  if (stages.length === 0) {
    return { ...status, fixture_no_write: "PASS" };
  }
  const judged = classifyFileManagerEvidence({
    stages,
    manifest_integrity: manifestIntegrityForRoot(root),
    power_cycle_control: loadPowerCycleControl(root),
  });
  return { ...status, ...judged, fixture_no_write: "PASS" };
}

export function buildDatasetCommand(root = FIXTURE_ROOT) {
  const dataset = buildDatasetFromRoot(root);
  const judged = classifyFileManagerEvidence(dataset);
  if (judged.RESULT === "BLOCKED" || judged.RESULT === "STOP_WITH_FINDINGS") {
    throw new Error(`dataset export blocked: ${judged.RESULT}`);
  }
  return { ...dataset, judgment: judged };
}

export function resolveCommandRoot(explicit) {
  const candidate = (typeof explicit === "string" ? explicit.trim() : "") || process.env.CAPTURE_ROOT?.trim() || "";
  if (!candidate) return FIXTURE_ROOT;
  return path.resolve(candidate);
}

function main() {
  const [, , command, arg1, arg2] = process.argv;
  const stageCommand = command === "write-manifest" || command === "verify-manifest";
  const root = resolveCommandRoot(stageCommand ? arg2 : arg1);
  try {
    if (command === "status") {
      console.log(JSON.stringify(evidenceStatus(root), null, 2));
      return;
    }
    if (command === "analyze") {
      console.log(JSON.stringify(analyzeFileManagerCapture(root), null, 2));
      return;
    }
    if (command === "dataset") {
      console.log(JSON.stringify(buildDatasetCommand(root), null, 2));
      return;
    }
    if (command === "write-manifest") {
      if (!arg1) throw new Error("write-manifest requires a stage name");
      if (!arg2) throw new Error("write-manifest requires an explicit capture root");
      const manifest = writeManifest(arg1, root);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      if (!arg1) throw new Error("verify-manifest requires a stage name");
      const result = verifyManifest(arg1, root);
      if (!result.ok) {
        console.error("manifest mismatch");
        process.exitCode = 1;
        return;
      }
      console.log("manifest matches");
      return;
    }
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
