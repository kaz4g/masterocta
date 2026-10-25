#!/usr/bin/env node
/**
 * Read-only receptacle for native Octatrack pattern copy/paste (source bank A to
 * destination bank D) on P_BANK_COPY_STATE. The device cannot copy whole banks;
 * stage names keep their historical "bank_copy" spelling for compatibility.
 *
 * status / analyze / verify-manifest do not write bank bytes.
 * write-manifest writes SHA256SUMS.json only.
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
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAURI_ROOT = path.join(SCRIPT_DIR, "../src-tauri");

export const PINNED_OS_REVISION = "R0173";
export const PINNED_OS_RELEASE = "1.40";

const BANK_DOCUMENT_FILES = [
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
  "bank03.work",
  "bank03.strd",
  "bank04.work",
  "bank04.strd",
];

/** @type {((paths: string[]) => void) | null} */
let bankDecodeValidator = null;

export function setBankDecodeValidator(fn) {
  bankDecodeValidator = fn;
}

export const META_SCHEMA = "masterocta.pse-bank-copy-state-doc-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-copy-state-doc-manifest:v1";
export const WORK_ID = "MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1";
export const OPERATION_KIND = "pattern_copy_paste";
export const LEGACY_OPERATION_KIND = "NATIVE_BANK_COPY";
const ACCEPTED_OPERATION_KINDS = new Set([OPERATION_KIND, LEGACY_OPERATION_KIND]);
export const PROJECT_NAME = "P_BANK_COPY_STATE";

const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const META_CAP_BYTES = 256 * 1024;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const SOURCE_BANK = "bank01";
export const CONTROL_BANK = "bank02";
export const UNTOUCHED_BANK = "bank03";
export const DEST_BANK = "bank04";

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

export const MATRIX_FILES = REQUIRED_FILES.filter((name) => name !== "capture.meta.json");

export const POWER_CYCLE_CONTROL_CAPTURE = "control_s0_power_cycle";
export const POWER_CYCLE_CONTROL_KIND = "power_cycle_control";
export const POWER_CYCLE_CONTROL_FILES = MATRIX_FILES;

export const FIXTURE_ROOT = path.join(SCRIPT_DIR, "../src-tauri/tests/fixtures/pse_bank_copy_state_doc");

export const PLANNED_CAPTURES = [
  {
    name: "s0_baseline_saved",
    stage_id: "S0",
    stage_semantics: "BASELINE_SAVED",
    prior_transition: null,
  },
  {
    name: "s1_source_working_diverged_pre_copy",
    stage_id: "S1",
    stage_semantics: "SOURCE_WORKING_DIVERGED_PRE_COPY",
    prior_transition: "SOURCE_WORKING_ONLY_EDIT",
  },
  {
    name: "s2_immediately_after_bank_copy",
    stage_id: "S2",
    stage_semantics: "IMMEDIATE_NATIVE_BANK_COPY",
    prior_transition: "NATIVE_BANK_COPY",
  },
  {
    name: "s3_after_control_switch",
    stage_id: "S3",
    stage_semantics: "CONTROL_SWITCH",
    prior_transition: "CONTROL_SWITCH",
  },
  {
    name: "s4_after_project_save",
    stage_id: "S4",
    stage_semantics: "PROJECT_SAVE",
    prior_transition: "PROJECT_SAVE",
  },
  {
    name: "s5_after_project_reload",
    stage_id: "S5",
    stage_semantics: "PROJECT_RELOAD",
    prior_transition: "PROJECT_RELOAD",
  },
];

export const ADJACENT_TRANSITIONS = [
  {
    from: "s0_baseline_saved",
    to: "s1_source_working_diverged_pre_copy",
    label: "SOURCE_WORKING_ONLY_EDIT",
  },
  {
    from: "s1_source_working_diverged_pre_copy",
    to: "s2_immediately_after_bank_copy",
    label: "NATIVE_BANK_COPY",
  },
  {
    from: "s2_immediately_after_bank_copy",
    to: "s3_after_control_switch",
    label: "CONTROL_SWITCH",
  },
  {
    from: "s3_after_control_switch",
    to: "s4_after_project_save",
    label: "PROJECT_SAVE",
  },
  {
    from: "s4_after_project_save",
    to: "s5_after_project_reload",
    label: "PROJECT_RELOAD",
  },
];

const STAGE_ATTRIBUTION = {
  S1: "SOURCE_WORKING_ONLY_EDIT",
  S2: "NATIVE_BANK_COPY",
  S3: "CONTROL_SWITCH",
  S4: "PROJECT_SAVE",
  S5: "PROJECT_RELOAD",
};

const STAGE_OPERATOR_FIELD = {
  S0: "save_operation",
  S1: "working_edit_operation",
  S2: "copy_operation",
  S3: "control_switch_operation",
  S4: "save_operation",
  S5: "reload_operation",
};

export function plannedCapture(captureName) {
  return PLANNED_CAPTURES.find((entry) => entry.name === captureName) ?? null;
}

export function parseProjectStatesSection(text) {
  const lines = text.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const starts = lines
    .map((line, index) => (line.trim() === "[STATES]" ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return { ok: false, bank: null, pattern: null };
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
  if (!closed || bankCount !== 1 || patternCount !== 1 || bank > 15 || pattern > 15) {
    return { ok: false, bank: null, pattern: null };
  }
  return { ok: true, bank, pattern };
}

const PROJECT_POSITION_KEYS = new Set(["BANK", "PATTERN"]);

/**
 * Compare two project.work documents line by line.
 * POSITION_ONLY: the only differing lines are the current-position keys
 * (BANK / PATTERN) inside a single well-formed [STATES] section.
 */
export function classifyProjectWorkChange(before, after) {
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after)) return "OTHER";
  if (buffersEqual(before, after)) return "UNCHANGED";
  const beforeText = before.toString("latin1");
  const afterText = after.toString("latin1");
  if (!parseProjectStatesSection(beforeText).ok || !parseProjectStatesSection(afterText).ok) return "OTHER";
  const left = beforeText.split("\n");
  const right = afterText.split("\n");
  if (left.length !== right.length) return "OTHER";
  let inStates = false;
  for (let index = 0; index < left.length; index += 1) {
    const marker = left[index].replace(/\r$/, "").trim();
    if (marker === "[STATES]") inStates = true;
    else if (marker === "[/STATES]") inStates = false;
    if (left[index] === right[index]) continue;
    if (!inStates) return "OTHER";
    const leftMatch = left[index].match(/^([A-Z_]+)=[0-9]+\r?$/);
    const rightMatch = right[index].match(/^([A-Z_]+)=[0-9]+\r?$/);
    if (!leftMatch || !rightMatch || leftMatch[1] !== rightMatch[1] || !PROJECT_POSITION_KEYS.has(leftMatch[1])) {
      return "OTHER";
    }
    if (left[index].endsWith("\r") !== right[index].endsWith("\r")) return "OTHER";
  }
  return "POSITION_ONLY";
}

export function assertPlannedCaptureName(captureName) {
  if (!plannedCapture(captureName)) {
    throw new Error(`Not a planned capture: ${captureName}`);
  }
}

function assertManifestCaptureName(captureName) {
  if (captureName !== POWER_CYCLE_CONTROL_CAPTURE) assertPlannedCaptureName(captureName);
}

function manifestFileList(captureName) {
  return captureName === POWER_CYCLE_CONTROL_CAPTURE ? POWER_CYCLE_CONTROL_FILES : REQUIRED_FILES;
}

export function metaTemplate(planned) {
  return {
    schema: META_SCHEMA,
    work_id: WORK_ID,
    operation_kind: OPERATION_KIND,
    stage_id: planned.stage_id,
    stage_semantics: planned.stage_semantics,
    prior_transition: planned.prior_transition,
    project_name: PROJECT_NAME,
    device: "Octatrack MkII",
    os_revision: "",
    os_release: "",
    device_generated: false,
    synthetic_modification: false,
    capture_sequence_proven: null,
    source_bank_ui: "A",
    destination_bank_ui: "D",
    control_bank_ui: "B",
    untouched_bank_ui: "C",
    current_bank_ui: "",
    current_pattern_ui: "",
    source_pattern: "",
    destination_pattern: "",
    save_operation: "",
    working_edit_operation: "",
    copy_operation: "",
    control_switch_operation: "",
    reload_operation: "",
    capture_transport: "",
    capture_required_mode_change: "",
    capture_may_flush_device_state: "",
    capture_flush_exclusion: "",
    capture_run_id: "",
    continues_from_previous_stage: "",
    source_ui_sentinel: "",
    prior_destination_ui_sentinel: "",
    destination_ui_sentinel: "",
    capture_date: "",
    operator_note:
      "TEMPLATE. Native pattern copy/paste from Bank A to Bank D on disposable P_BANK_COPY_STATE. Keep device_generated false until operator confirms sequence, OS, S1 divergence, transport, and sentinels.",
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
  if (st.isSymbolicLink()) throw new Error("Symlink not allowed for fixture root");
  const parent = path.dirname(rootResolved);
  if (parent !== rootResolved && lstatSync(parent).isSymbolicLink()) {
    throw new Error("Symlink not allowed in fixture root parent");
  }
  return rootResolved;
}

export function resolveCaptureDir(captureName, root = FIXTURE_ROOT) {
  assertManifestCaptureName(captureName);
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
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed for capture directory: ${captureName}`);
  if (!st.isDirectory()) throw new Error(`Capture path is not a directory: ${captureName}`);
  const canonicalRel = path.relative(realpathSync(rootResolved), realpathSync(captureDir));
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
  if (st.isSymbolicLink()) throw new Error(`Symlink not allowed in capture: ${label}`);
  if (!st.isFile()) throw new Error(`Not a regular file: ${label}`);
  return st;
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
  return "PROVEN_NON_MUTATING";
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

function postCopySessionContinuity(stages) {
  if (!sharedCaptureRunId(stages)) return "NOT_PROVEN";
  const postCopy = stages.filter((stage) => stage.stage_id === "S3" || stage.stage_id === "S4" || stage.stage_id === "S5");
  if (postCopy.length !== 3 || postCopy.some((stage) => !continuesFromPreviousStage(stage.meta))) {
    return "NOT_PROVEN";
  }
  return "PROVEN";
}

function sentinelValue(meta, key) {
  const value = meta?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const placeholder = normalized.toLowerCase();
  if (normalized === "" || placeholder === "unknown" || placeholder === "not_recorded") return null;
  return normalized;
}

function sameSentinel(left, right) {
  return left != null && left === right;
}

function agreedSentinel(stages, stageIds, key) {
  const values = stageIds.map((stageId) => {
    const stage = stages.find((entry) => entry.stage_id === stageId);
    return sentinelValue(stage?.meta, key);
  });
  if (values.some((value) => value == null)) return null;
  const [first] = values;
  if (values.some((value) => !sameSentinel(value, first))) return null;
  return first;
}

function destinationSentinelStatus(stages) {
  const source = agreedSentinel(stages, ["S0", "S1"], "source_ui_sentinel");
  const priorDestination = agreedSentinel(stages, ["S0", "S1"], "prior_destination_ui_sentinel");
  if (!source || !priorDestination || sameSentinel(source, priorDestination)) return "NOT_RECORDED";
  const observed = ["S2", "S5"].map((stageId) => {
    const stage = stages.find((entry) => entry.stage_id === stageId);
    return sentinelValue(stage?.meta, "destination_ui_sentinel");
  });
  if (observed.some((value) => value == null)) return "NOT_RECORDED";
  if (observed.every((value) => sameSentinel(value, source))) return "RECORDED";
  return "MISMATCH";
}

export function assertPinnedFirmware(meta) {
  if (meta.os_revision?.trim() !== PINNED_OS_REVISION || meta.os_release?.trim() !== PINNED_OS_RELEASE) {
    throw new Error(`capture OS must be ${PINNED_OS_REVISION} / ${PINNED_OS_RELEASE} for this experiment`);
  }
}

const UI_BANK_INDEX = { A: 0, B: 1, C: 2, D: 3 };

export function parseBankUiToIndex(label) {
  const key = String(label).trim().toUpperCase();
  if (!Object.hasOwn(UI_BANK_INDEX, key)) {
    throw new Error(`unrecognized current_bank_ui: ${label}`);
  }
  return UI_BANK_INDEX[key];
}

export function parsePatternUiToIndex(label, bankUi) {
  const match = String(label).trim().match(/^([A-P])(\d{2})$/i);
  if (!match) {
    throw new Error(`unrecognized current_pattern_ui: ${label}`);
  }
  const letter = match[1].toUpperCase();
  if (bankUi != null && String(bankUi).trim() !== "" && letter !== String(bankUi).trim().toUpperCase()) {
    throw new Error(`current_pattern_ui ${label} is not bank-qualified for ${String(bankUi).trim().toUpperCase()}`);
  }
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 15) {
    throw new Error(`current_pattern_ui out of range: ${label}`);
  }
  return index;
}

export function assertOperationKind(meta) {
  const value = meta?.operation_kind;
  if (value === undefined || value === null || value === "") return;
  if (!ACCEPTED_OPERATION_KINDS.has(value)) {
    throw new Error(`operation_kind must be ${OPERATION_KIND} when recorded`);
  }
}

/** source_pattern / destination_pattern are optional; when recorded they must be bank-qualified. */
export function assertCopyPatternRoles(meta) {
  for (const [key, bankKey] of [["source_pattern", "source_bank_ui"], ["destination_pattern", "destination_bank_ui"]]) {
    if (!nonEmptyString(meta?.[key])) continue;
    try {
      parsePatternUiToIndex(meta[key], meta[bankKey]);
    } catch (err) {
      throw new Error(`${key} is invalid (${err.message})`);
    }
  }
}

function recordedCopyPattern(stage, key) {
  const value = stage?.meta?.[key];
  return nonEmptyString(value) ? value.trim().toUpperCase() : "NOT_RECORDED";
}

export function assertUiMatchesProjectStates(meta, states) {
  if (!states.ok) throw new Error("project.work [STATES] must contain one BANK and one PATTERN in 0..15");
  const bank = parseBankUiToIndex(meta.current_bank_ui);
  const pattern = parsePatternUiToIndex(meta.current_pattern_ui, meta.current_bank_ui);
  if (bank !== states.bank || pattern !== states.pattern) {
    throw new Error("current_bank_ui/current_pattern_ui do not match project.work [STATES]");
  }
}

function decodeBankDocumentPaths(paths) {
  if (bankDecodeValidator) {
    bankDecodeValidator(paths);
    return;
  }
  execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--bin",
      "pse_bank_copy_capture_decode_check",
      "--",
      ...paths,
    ],
    { cwd: TAURI_ROOT, stdio: "pipe" },
  );
}

function assertCaptureRegularFileWithinCap(captureDir, name) {
  const filePath = path.join(captureDir, name);
  const st = assertRegularFile(filePath, name);
  if (!st) throw new Error(`device_generated capture is missing ${name}`);
  if (st.size > sizeCap(name)) throw new Error(`${name} exceeds its size cap`);
  return st;
}

function readBoundedCaptureFile(captureDir, name) {
  assertCaptureRegularFileWithinCap(captureDir, name);
  return readFileSync(path.join(captureDir, name));
}

function assertAllBankDocumentsDecodable(captureDir) {
  const paths = BANK_DOCUMENT_FILES.map((name) => path.join(captureDir, name));
  for (const name of BANK_DOCUMENT_FILES) {
    assertCaptureRegularFileWithinCap(captureDir, name);
  }
  decodeBankDocumentPaths(paths);
}

function assertAllStagesPresentForDataset(root) {
  const rows = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const bad = rows.filter((row) => row.capture_status !== "PRESENT");
  if (bad.length > 0) {
    throw new Error("dataset export requires every stage PRESENT with verified manifests");
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
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
  if (meta.device !== "Octatrack MkII" || meta.project_name !== PROJECT_NAME) {
    throw new Error("capture provenance is incomplete");
  }
  if (
    meta.source_bank_ui !== "A"
    || meta.destination_bank_ui !== "D"
    || meta.control_bank_ui !== "B"
    || meta.untouched_bank_ui !== "C"
  ) {
    throw new Error("bank roles do not match the receptacle");
  }
  assertCopyPatternRoles(meta);
  for (const key of ["os_revision", "os_release", "capture_date", "operator_note", "current_bank_ui", "current_pattern_ui"]) {
    if (!nonEmptyString(meta[key])) throw new Error("capture provenance is incomplete");
  }
  assertPinnedFirmware(meta);
  if (!transportRecorded(meta)) throw new Error("capture transport metadata is incomplete");
  const opField = STAGE_OPERATOR_FIELD[planned.stage_id];
  if (!nonEmptyString(meta[opField])) {
    throw new Error(`${planned.stage_id} must record a non-empty ${opField}`);
  }
  assertCaptureRegularFileWithinCap(captureDir, "project.work");
  assertCaptureRegularFileWithinCap(captureDir, "project.strd");
  const states = parseProjectStatesSection(readBoundedCaptureFile(captureDir, "project.work").toString("latin1"));
  assertUiMatchesProjectStates(meta, states);
  assertAllBankDocumentsDecodable(captureDir);
  if (planned.stage_id === "S1") {
    const work = readBoundedCaptureFile(captureDir, `${SOURCE_BANK}.work`);
    const strd = readBoundedCaptureFile(captureDir, `${SOURCE_BANK}.strd`);
    if (buffersEqual(work, strd)) {
      throw new Error("S1 requires bank01.work != bank01.strd (PRE source role divergence)");
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

function sizeCap(name) {
  if (name === "capture.meta.json" || name === "SHA256SUMS.json") return META_CAP_BYTES;
  if (name.startsWith("project.")) return PROJECT_WORK_CAP_BYTES;
  return BANK_FILE_CAP_BYTES;
}

export function buildManifest(captureName, root = FIXTURE_ROOT) {
  assertManifestCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const files = manifestFileList(captureName).flatMap((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) return [];
    if (st.size > sizeCap(name)) throw new Error(`${name} exceeds its size cap`);
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

export function writeManifest(captureName, root = FIXTURE_ROOT) {
  assertManifestCaptureName(captureName);
  assertCanonicalFixtureRoot(root);
  const captureDir = resolveCaptureDir(captureName, root);
  for (const name of manifestFileList(captureName)) {
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
  assertManifestCaptureName(captureName);
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  if (st.size > META_CAP_BYTES) throw new Error("SHA256SUMS.json exceeds its size cap");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureName, root);
  const expectedFiles = manifestFileList(captureName);
  const fileSetOk = Array.isArray(recorded.files)
    && recorded.files.length === expectedFiles.length
    && expectedFiles.every((name) => recorded.files.some((entry) => entry.path === name));
  return {
    ok: recorded.schema === MANIFEST_SCHEMA
      && recorded.capture === captureName
      && fileSetOk
      && JSON.stringify(recorded.files) === JSON.stringify(fresh.files),
    recorded_files: recorded.files ?? null,
    fresh_files: fresh.files,
  };
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
    for (const name of REQUIRED_FILES) {
      if (name === "capture.meta.json") continue;
      if (BANK_DOCUMENT_FILES.includes(name) || name.startsWith("project.")) {
        assertCaptureRegularFileWithinCap(captureDir, name);
      } else {
        const st = assertRegularFile(path.join(captureDir, name), name);
        if (!st) throw new Error(`device_generated capture is missing ${name}`);
        if (st.size > sizeCap(name)) throw new Error(`${name} exceeds its size cap`);
      }
    }
    assertAllBankDocumentsDecodable(captureDir);
    const verified = verifyManifest(planned.name, root);
    if (!verified.ok) throw new Error("SHA256SUMS.json is stale");
    return { ...plannedMeta, capture_status: "PRESENT", manifest_verified: true };
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
}

function frozenPolicyFields() {
  return {
    work_id: WORK_ID,
    operation_kind: OPERATION_KIND,
    disposable_project: PROJECT_NAME,
    copy_state_doc_rule: "BLOCKED",
    move_state_doc_rule: "BLOCKED",
    swap_state_doc_rule: "BLOCKED",
    active_bank_retarget_rule: "BLOCKED",
    bank_changeplan_readiness: "NOT_READY",
    apply_authorized: "NO",
    issue_181_close_ready: "NO",
    issue_217_close_ready: "NO",
    issue_221: "OPEN",
    bank_internal_identity: "UNKNOWN",
    copy_saved_checkpoint_semantics: "UNKNOWN",
    readiness_gap_working_saved_checkpoint: "OPEN",
    readiness_granularity_mismatch: "YES",
    masterocta_filesystem_write: "NO",
  };
}

function stageHasComparedBytes(root, captureName) {
  const captureDir = path.join(root, captureName);
  return MATRIX_FILES.every((name) => {
    try {
      const st = lstatSync(path.join(captureDir, name));
      return st.isFile() && !st.isSymbolicLink();
    } catch {
      return false;
    }
  });
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

export function buffersEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.length === right.length && left.equals(right);
}

export function classifyByteProvenance(after, candidates) {
  const matches = Object.entries(candidates).filter(([, buf]) => buffersEqual(after, buf)).map(([label]) => label);
  if (matches.length === 0) return "DERIVED_OTHER";
  if (matches.length === 1) return matches[0];
  return "AMBIGUOUS";
}

function readStageFilesFromDir(captureDir) {
  const files = {};
  for (const name of MATRIX_FILES) {
    const st = assertRegularFile(path.join(captureDir, name), name);
    if (!st) throw new Error(`missing ${name}`);
    files[name] = readBoundedCaptureFile(captureDir, name);
  }
  return files;
}

export function loadPowerCycleControl(root = FIXTURE_ROOT) {
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
  const files = {};
  for (const name of POWER_CYCLE_CONTROL_FILES) {
    files[name] = readBoundedCaptureFile(captureDir, name);
  }
  return { status: "MANIFEST_VERIFIED", files };
}

export function judgePowerCycleControl(control, baselineStage) {
  if (!control || typeof control !== "object") return "MISSING";
  if (control.status !== "MANIFEST_VERIFIED") return control.status ?? "MISSING";
  const baseline = baselineStage?.files;
  if (!baseline || !control.files) return "MISMATCH";
  const identical = POWER_CYCLE_CONTROL_FILES.every((name) => {
    const before = baseline[name];
    const after = control.files[name];
    return Buffer.isBuffer(before) && Buffer.isBuffer(after) && sha256Buffer(before) === sha256Buffer(after);
  });
  return identical ? "VERIFIED" : "MISMATCH";
}

export function buildBankCopyDatasetFromFixture(root, options = {}) {
  if (!sequenceProvenFromMeta(root)) {
    throw new Error("capture sequence is not proven");
  }
  assertAllStagesPresentForDataset(root);
  const stages = PLANNED_CAPTURES.map((planned) => {
    const captureDir = resolveCaptureDir(planned.name, root);
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      stage_semantics: planned.stage_semantics,
      prior_transition: planned.prior_transition,
      meta: readMeta(captureDir),
      files: readStageFilesFromDir(captureDir),
    };
  });
  return { stages, ...options, power_cycle_control: loadPowerCycleControl(root) };
}

export function buildTransitionMatrix(stages) {
  if (!stages[0] || stages[0].stage_id !== "S0") {
    throw new Error("Bank copy dataset must start at S0");
  }
  const transitions = ADJACENT_TRANSITIONS.map((edge) => {
    const fromStage = stages.find((stage) => stage.capture_name === edge.from);
    const toStage = stages.find((stage) => stage.capture_name === edge.to);
    if (!fromStage || !toStage) throw new Error(`Missing stage for ${edge.label}`);
    const cells = MATRIX_FILES.map((fileName) => {
      const before = fromStage.files[fileName];
      const after = toStage.files[fileName];
      return {
        file: fileName,
        byte_size_before: before.length,
        byte_size_after: after.length,
        changed: !buffersEqual(before, after),
        sha256_before: sha256Buffer(before),
        sha256_after: sha256Buffer(after),
      };
    });
    return {
      transition: edge.label,
      from: edge.from,
      to: edge.to,
      cells,
    };
  });
  const s1 = stages.find((stage) => stage.stage_id === "S1");
  const baselineDestWork = s1.files[`${DEST_BANK}.work`];
  const baselineDestStrd = s1.files[`${DEST_BANK}.strd`];
  const firstChangedAt = (suffix, baseline) => {
    for (const stage of stages.slice(stages.findIndex((entry) => entry.stage_id === "S1"))) {
      const current = stage.files[`${DEST_BANK}.${suffix}`];
      if (!buffersEqual(baseline, current)) return STAGE_ATTRIBUTION[stage.stage_id] ?? "INCONCLUSIVE";
    }
    return "NOT_OBSERVED";
  };
  return {
    baseline_stage: "S1",
    transitions,
    dest_work_first_changed_at: firstChangedAt("work", baselineDestWork),
    dest_strd_first_changed_at: firstChangedAt("strd", baselineDestStrd),
  };
}

function changedOnTransition(matrix, transitionLabel, fileName) {
  const transition = matrix.transitions.find((entry) => entry.transition === transitionLabel);
  const cell = transition?.cells.find((entry) => entry.file === fileName);
  if (!cell) return "INCONCLUSIVE";
  return cell.changed ? "YES" : "NO";
}

function sourceOnlyProjectWorkChange(stages) {
  const s0 = stages.find((stage) => stage.stage_id === "S0");
  const s1 = stages.find((stage) => stage.stage_id === "S1");
  return classifyProjectWorkChange(s0?.files?.["project.work"], s1?.files?.["project.work"]);
}

function sourceOnlyPrecondition(matrix, projectWorkChange) {
  const transition = matrix.transitions.find((entry) => entry.transition === "SOURCE_WORKING_ONLY_EDIT");
  if (!transition) return "NOT_RUN";
  const unexpected = transition.cells.filter((cell) => {
    if (!cell.changed || cell.file === `${SOURCE_BANK}.work`) return false;
    return !(cell.file === "project.work" && projectWorkChange === "POSITION_ONLY");
  });
  if (unexpected.length > 0) return "CONTAMINATED";
  const sourceWork = transition.cells.find((cell) => cell.file === `${SOURCE_BANK}.work`);
  if (!sourceWork?.changed) return "NOT_PROVEN";
  return "PASS";
}

/**
 * Pattern copy/paste may leave the destination bank .work untouched until the
 * device switches away from the pasted bank; that deferred write is expected.
 */
function destWorkWriteTiming(matrix) {
  const atPaste = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${DEST_BANK}.work`);
  if (atPaste === "YES") return { timing: "ON_PASTE", written_stage: "S2" };
  if (atPaste === "NO" && changedOnTransition(matrix, "CONTROL_SWITCH", `${DEST_BANK}.work`) === "YES") {
    return { timing: "DEFERRED_TO_BANK_SWITCH", written_stage: "S3" };
  }
  if (atPaste === "NO") return { timing: "NOT_WRITTEN_BY_BANK_SWITCH", written_stage: null };
  return { timing: "INCONCLUSIVE", written_stage: null };
}

function patternUiQualification(stages) {
  for (const stage of stages) {
    const states = parseProjectStatesSection(stage.files["project.work"].toString("latin1"));
    try {
      assertUiMatchesProjectStates(stage.meta, states);
    } catch {
      return "FAIL";
    }
  }
  return "PASS";
}

function projectStateEffect(beforeStage, afterStage) {
  const before = parseProjectStatesSection(beforeStage.files["project.work"].toString("latin1"));
  const after = parseProjectStatesSection(afterStage.files["project.work"].toString("latin1"));
  return {
    bank_before: before.ok ? before.bank : null,
    bank_after: after.ok ? after.bank : null,
    pattern_before: before.ok ? before.pattern : null,
    pattern_after: after.ok ? after.pattern : null,
  };
}

export function classifyBankCopyEvidence(dataset) {
  const shell = {
    ...frozenPolicyFields(),
    device_capture: "NOT_RUN",
    capture_transport_confidence: "UNKNOWN",
    power_cycle_control: "NOT_RUN",
    pre_source_work_strd_divergence: "NOT_RUN",
    immediate_copy_timing_attribution: "NOT_RUN",
    copy_operation_proven: "NO",
    dest_work_immediate_change: "INCONCLUSIVE",
    dest_strd_immediate_change: "INCONCLUSIVE",
    source_work_immediate_change: "INCONCLUSIVE",
    source_strd_immediate_change: "INCONCLUSIVE",
    control_bank_immediate_change: "INCONCLUSIVE",
    untouched_bank_immediate_change: "INCONCLUSIVE",
    dest_work_provenance: "INCONCLUSIVE",
    dest_strd_provenance: "INCONCLUSIVE",
    dest_work_first_changed_at: "NOT_RUN",
    dest_strd_first_changed_at: "NOT_RUN",
    copy_project_bank_effect: "INCONCLUSIVE",
    copy_project_pattern_effect: "INCONCLUSIVE",
    source_only_precondition: "NOT_RUN",
    source_only_project_work_change: "NOT_RUN",
    dest_work_write_timing: "NOT_RUN",
    copy_source_pattern: "NOT_RECORDED",
    copy_destination_pattern: "NOT_RECORDED",
    post_copy_session_continuity: "NOT_PROVEN",
    control_switch_attribution: "INCONCLUSIVE",
    project_save_attribution: "INCONCLUSIVE",
    project_reload_attribution: "INCONCLUSIVE",
    destination_ui_sentinel: "NOT_RECORDED",
    pattern_ui_qualification: "NOT_RUN",
    copy_effect_attribution: "INCONCLUSIVE",
    copy_working_role: "DEVICE_EVIDENCE_REQUIRED",
    copy_saved_checkpoint_role: "DEVICE_EVIDENCE_REQUIRED",
    result: "STOP_WITH_FINDINGS",
  };
  const stages = dataset?.stages;
  if (!Array.isArray(stages) || stages.length !== PLANNED_CAPTURES.length) {
    return { ...shell, result: "STOP_WITH_FINDINGS" };
  }
  const byId = Object.fromEntries(stages.map((stage) => [stage.stage_id, stage]));
  const s1 = byId.S1;
  if (!s1) return { ...shell, result: "STOP_WITH_FINDINGS" };
  const s1Work = s1.files[`${SOURCE_BANK}.work`];
  const s1Strd = s1.files[`${SOURCE_BANK}.strd`];
  shell.pre_source_work_strd_divergence = buffersEqual(s1Work, s1Strd) ? "FAIL" : "PASS";
  if (shell.pre_source_work_strd_divergence === "FAIL") {
    return {
      ...shell,
      pre_source_role_divergence: "NOT_PROVEN",
      result: "STOP_WITH_FINDINGS",
    };
  }
  let matrix;
  try {
    matrix = buildTransitionMatrix(stages);
  } catch (err) {
    return { ...shell, error: err.message, result: "STOP_WITH_FINDINGS" };
  }
  shell.dest_work_first_changed_at = matrix.dest_work_first_changed_at;
  shell.dest_strd_first_changed_at = matrix.dest_strd_first_changed_at;
  shell.source_only_project_work_change = sourceOnlyProjectWorkChange(stages);
  shell.source_only_precondition = sourceOnlyPrecondition(matrix, shell.source_only_project_work_change);
  const destWrite = destWorkWriteTiming(matrix);
  shell.dest_work_write_timing = destWrite.timing;
  shell.copy_source_pattern = recordedCopyPattern(byId.S2, "source_pattern");
  shell.copy_destination_pattern = recordedCopyPattern(byId.S2, "destination_pattern");
  shell.post_copy_session_continuity = postCopySessionContinuity(stages);
  shell.destination_ui_sentinel = destinationSentinelStatus(stages);
  shell.pattern_ui_qualification = patternUiQualification(stages);
  shell.power_cycle_control = judgePowerCycleControl(dataset.power_cycle_control, byId.S0);
  const transportConfidences = stages.map((stage) => stageTransportConfidence(stage.meta, shell.power_cycle_control));
  const osMismatch = stages.some((stage) => {
    try {
      assertPinnedFirmware(stage.meta);
      return false;
    } catch {
      return true;
    }
  });
  shell.capture_transport_confidence = osMismatch || transportConfidences.includes("UNKNOWN")
    ? "UNKNOWN"
    : transportConfidences.includes("MAY_FLUSH")
      ? "MAY_FLUSH"
      : "PROVEN_NON_MUTATING";
  shell.immediate_copy_timing_attribution = shell.capture_transport_confidence === "PROVEN_NON_MUTATING"
    ? "PASS"
    : "INCONCLUSIVE";
  if (
    shell.post_copy_session_continuity === "PROVEN"
    && shell.source_only_precondition === "PASS"
    && shell.immediate_copy_timing_attribution === "PASS"
    && shell.pattern_ui_qualification === "PASS"
  ) {
    shell.control_switch_attribution = "ATTRIBUTED";
    shell.project_save_attribution = "ATTRIBUTED";
    shell.project_reload_attribution = "ATTRIBUTED";
  }
  shell.dest_work_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${DEST_BANK}.work`);
  shell.dest_strd_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${DEST_BANK}.strd`);
  shell.source_work_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${SOURCE_BANK}.work`);
  shell.source_strd_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${SOURCE_BANK}.strd`);
  shell.control_bank_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${CONTROL_BANK}.work`)
    === "YES"
    || changedOnTransition(matrix, "NATIVE_BANK_COPY", `${CONTROL_BANK}.strd`) === "YES"
      ? "YES"
      : "NO";
  shell.untouched_bank_immediate_change = changedOnTransition(matrix, "NATIVE_BANK_COPY", `${UNTOUCHED_BANK}.work`)
    === "YES"
    || changedOnTransition(matrix, "NATIVE_BANK_COPY", `${UNTOUCHED_BANK}.strd`) === "YES"
      ? "YES"
      : "NO";
  const s2 = byId.S2;
  const copyAttributable = shell.immediate_copy_timing_attribution === "PASS"
    && shell.source_only_precondition === "PASS"
    && shell.pattern_ui_qualification === "PASS";
  if (s2 && copyAttributable) {
    shell.copy_effect_attribution = "ATTRIBUTED";
    const destWorkStage = byId[destWrite.written_stage] ?? s2;
    shell.dest_work_provenance = classifyByteProvenance(destWorkStage.files[`${DEST_BANK}.work`], {
      SOURCE_WORKING: s1Work,
      SOURCE_SAVEDCHECKPOINT: s1Strd,
      PRIOR_DESTINATION_WORKING: s1.files[`${DEST_BANK}.work`],
      PRIOR_DESTINATION_SAVEDCHECKPOINT: s1.files[`${DEST_BANK}.strd`],
    });
    shell.dest_strd_provenance = classifyByteProvenance(s2.files[`${DEST_BANK}.strd`], {
      SOURCE_WORKING: s1Work,
      SOURCE_SAVEDCHECKPOINT: s1Strd,
      PRIOR_DESTINATION_WORKING: s1.files[`${DEST_BANK}.work`],
      PRIOR_DESTINATION_SAVEDCHECKPOINT: s1.files[`${DEST_BANK}.strd`],
    });
  }
  const copyState = projectStateEffect(s1, s2);
  if (copyState.bank_before != null && copyState.bank_after != null) {
    if (copyState.bank_before === copyState.bank_after) shell.copy_project_bank_effect = "UNCHANGED";
    else if (copyState.bank_after === 3) shell.copy_project_bank_effect = "CHANGED_TO_DESTINATION";
    else shell.copy_project_bank_effect = "CHANGED_OTHER";
  }
  if (copyState.pattern_before != null && copyState.pattern_after != null) {
    shell.copy_project_pattern_effect = copyState.pattern_before === copyState.pattern_after ? "UNCHANGED" : "CHANGED";
  }
  const copyOp = s2?.meta?.copy_operation;
  shell.copy_operation_proven = nonEmptyString(copyOp) ? "YES" : "NO";
  const promotable = copyAttributable
    && shell.post_copy_session_continuity === "PROVEN"
    && shell.destination_ui_sentinel === "RECORDED"
    && shell.capture_transport_confidence === "PROVEN_NON_MUTATING";
  if (!promotable) {
    return { ...shell, device_capture: "INCONCLUSIVE", result: "STOP_WITH_FINDINGS" };
  }
  // Promotion to domain rules requires conclusive Copy role + SavedCheckpoint semantics (Phase B only).
  return { ...shell, device_capture: "PASS", result: "READY_FOR_REVIEW" };
}

export function evidenceStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const bytesPresent = PLANNED_CAPTURES.some((planned) => stageHasComparedBytes(root, planned.name));
  const sequenceProven = sequenceProvenFromMeta(root);
  const rejected = captures.some((row) => row.capture_status === "REJECTED");
  const allPresent = captures.every((row) => row.capture_status === "PRESENT");
  const pinnedOsConsistent = allPresent && captures.every((row) => {
    try {
      const meta = readMeta(resolveCaptureDir(row.capture_label, root));
      assertPinnedFirmware(meta);
      return true;
    } catch {
      return false;
    }
  });
  const base = {
    ...frozenPolicyFields(),
    capture_sequence_proven: sequenceProven ? "YES" : "NO",
    captures,
    device_evidence_promotion: "BLOCKED",
  };
  if (rejected) {
    return {
      ...base,
      device_capture: "REJECTED",
      result: "STOP_WITH_FINDINGS",
    };
  }
  if (!sequenceProven || !allPresent) {
    return {
      ...base,
      device_capture: bytesPresent ? "PRESENT_UNPROMOTED" : "WAITING_FOR_REAL_DEVICE",
      result: bytesPresent ? "STOP_FOR_OPERATOR_CONFIRMATION" : "WAITING_FOR_OPERATOR_CAPTURE",
    };
  }
  if (!pinnedOsConsistent) {
    return {
      ...base,
      device_capture: "INCOMPLETE",
      result: "STOP_FOR_OPERATOR_CONFIRMATION",
    };
  }
  const dataset = buildBankCopyDatasetFromFixture(root);
  const judged = classifyBankCopyEvidence(dataset);
  return {
    ...base,
    device_evidence_promotion: judged.result === "READY_FOR_REVIEW" ? "ALLOWED" : "BLOCKED",
    ...judged,
  };
}

export function resolveCommandRoot(explicit) {
  const candidate = (typeof explicit === "string" ? explicit.trim() : "") || process.env.CAPTURE_ROOT?.trim() || "";
  if (!candidate) return FIXTURE_ROOT;
  return path.resolve(candidate);
}

export function analyzeBankCopyEvidence(root = FIXTURE_ROOT) {
  const status = evidenceStatus(root);
  return { ...status, fixture_no_write: "PASS" };
}

/**
 * Audit the *stored bytes*, not the device operation, when stage directories
 * contain captures from more than one native session.
 *
 * A verified snapshot proves only schema / device / manifest / decodability.
 * It intentionally does not waive operator UI, transport, sentinel, source-only,
 * or session-continuity requirements used by evidenceStatus().
 *
 * split_before_stage is a non-persistent operator declaration: it never edits
 * capture.meta.json, manifest files, device bytes, or domain readiness.
 */
export function auditMixedCapture(root = FIXTURE_ROOT, { split_before_stage = null } = {}) {
  if (split_before_stage !== null && !PLANNED_CAPTURES.slice(1).some((entry) => entry.stage_id === split_before_stage)) {
    throw new Error("split_before_stage must be S1, S2, S3, S4, or S5");
  }
  const captured = PLANNED_CAPTURES.map((planned) => {
    const entry = {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      raw_snapshot: "REJECTED",
      manifest_verified: false,
      capture_run_id: null,
      ui_consistency: "NOT_EVALUATED",
    };
    try {
      const dir = resolveCaptureDir(planned.name, root);
      const meta = readMeta(dir);
      if (
        meta.schema !== META_SCHEMA || meta.work_id !== WORK_ID
        || meta.stage_id !== planned.stage_id || meta.stage_semantics !== planned.stage_semantics
        || meta.project_name !== PROJECT_NAME || meta.device !== "Octatrack MkII"
        || meta.device_generated !== true
      ) {
        throw new Error("snapshot provenance metadata is incomplete");
      }
      assertPinnedFirmware(meta);
      assertOperationKind(meta);
      assertCopyPatternRoles(meta);
      if (!verifyManifest(planned.name, root).ok) throw new Error("SHA256SUMS.json is stale");
      assertAllBankDocumentsDecodable(dir);
      const files = readStageFilesFromDir(dir);
      const states = parseProjectStatesSection(files["project.work"].toString("latin1"));
      if (!states.ok) throw new Error("project.work [STATES] is invalid");
      let uiConsistency = "MATCH";
      try {
        assertUiMatchesProjectStates(meta, states);
      } catch {
        uiConsistency = "MISMATCH";
      }
      return {
        ...entry,
        raw_snapshot: "VERIFIED",
        manifest_verified: true,
        capture_run_id: sentinelValue(meta, "capture_run_id"),
        ui_consistency: uiConsistency,
        project_state: { bank: states.bank, pattern: states.pattern },
        recorded_ui: {
          bank: meta.current_bank_ui ?? null,
          pattern: meta.current_pattern_ui ?? null,
        },
        meta,
        files,
      };
    } catch (err) {
      return { ...entry, error: err.message };
    }
  });
  const partitions = [];
  const transitions = [];
  let segment = null;
  for (let index = 0; index < captured.length; index += 1) {
    const current = captured[index];
    const previous = captured[index - 1] ?? null;
    const isDeclaredBoundary = current.stage_id === split_before_stage;
    const isRunIdBoundary = !!(
      previous?.capture_run_id && current.capture_run_id
      && previous.capture_run_id !== current.capture_run_id
    );
    if (!segment || isDeclaredBoundary || isRunIdBoundary) {
      segment = { segment_id: `segment_${partitions.length + 1}`, stage_ids: [] };
      partitions.push(segment);
    }
    segment.stage_ids.push(current.stage_id);
    if (!previous) continue;
    const edge = ADJACENT_TRANSITIONS[index - 1];
    if (isDeclaredBoundary || isRunIdBoundary) {
      transitions.push({
        transition: edge.label,
        from: previous.stage_id,
        to: current.stage_id,
        attribution: "CROSS_SESSION_NOT_COMPARABLE",
        changed_files: null,
      });
      continue;
    }
    if (previous.raw_snapshot !== "VERIFIED" || current.raw_snapshot !== "VERIFIED") {
      transitions.push({
        transition: edge.label,
        from: previous.stage_id,
        to: current.stage_id,
        attribution: "UNAVAILABLE",
        changed_files: null,
      });
      continue;
    }
    const sameRecordedRun = previous.capture_run_id && current.capture_run_id
      && previous.capture_run_id === current.capture_run_id
      && continuesFromPreviousStage(current.meta);
    transitions.push({
      transition: edge.label,
      from: previous.stage_id,
      to: current.stage_id,
      attribution: sameRecordedRun ? "SAME_RUN_METADATA_RECORDED" : "RAW_DIFF_ONLY",
      changed_files: MATRIX_FILES.filter((name) => !buffersEqual(previous.files[name], current.files[name])),
    });
  }
  const s0 = captured[0];
  const s1 = captured[1];
  const sourceEdit = transitions[0];
  const paste = transitions[1];
  const sourceWorkChanged = s1.raw_snapshot === "VERIFIED" && !buffersEqual(
    s1.files[`${SOURCE_BANK}.work`], s1.files[`${SOURCE_BANK}.strd`],
  );
  const projectWorkChange = s0.raw_snapshot === "VERIFIED" && s1.raw_snapshot === "VERIFIED"
    ? classifyProjectWorkChange(s0.files["project.work"], s1.files["project.work"])
    : "NOT_EVALUATED";
  const unexpectedSourceFiles = sourceEdit?.changed_files?.filter((name) =>
    name !== `${SOURCE_BANK}.work` && !(name === "project.work" && projectWorkChange === "POSITION_ONLY")
  ) ?? null;
  const snapshots = captured.map(({ meta: _meta, files: _files, ...entry }) => entry);
  const allVerified = snapshots.every((entry) => entry.raw_snapshot === "VERIFIED");
  return {
    ...frozenPolicyFields(),
    audit_mode: "MIXED_SESSION_RAW_SNAPSHOT",
    operator_declared_split_before: split_before_stage,
    raw_snapshot_integrity: allVerified ? "PASS" : "FAIL",
    device_evidence_promotion: "BLOCKED",
    copy_effect_attribution: "INCONCLUSIVE",
    working_content_transfer: "NOT_PROVEN_BY_THIS_AUDIT",
    result: allVerified ? "RAW_AUDIT_COMPLETE" : "RAW_AUDIT_INCOMPLETE",
    snapshots,
    session_partitions: partitions,
    transitions,
    raw_observations: {
      s1_source_work_differs_from_saved: s1.raw_snapshot === "VERIFIED"
        ? (sourceWorkChanged ? "YES" : "NO") : "NOT_EVALUATED",
      source_edit_unexpected_changed_files: unexpectedSourceFiles,
      s1_to_s2_destination_work_changed: paste?.changed_files
        ? (paste.changed_files.includes(`${DEST_BANK}.work`) ? "YES" : "NO") : "NOT_EVALUATED",
      s1_to_s2_destination_saved_changed: paste?.changed_files
        ? (paste.changed_files.includes(`${DEST_BANK}.strd`) ? "YES" : "NO") : "NOT_EVALUATED",
    },
  };
}

/**
 * Forensic inspection of historic operator captures whose manifests are
 * missing/stale. This is deliberately NOT an evidence-promotion path.
 * Observations are labelled UNVERIFIED even when individual byte comparisons
 * are possible. The strict audit-mixed/analyze gates remain unchanged.
 */
export function inspectMixedCapture(root = FIXTURE_ROOT, { split_before_stage = null } = {}) {
  if (split_before_stage !== null && !PLANNED_CAPTURES.slice(1).some((entry) => entry.stage_id === split_before_stage)) {
    throw new Error("split_before_stage must be S1, S2, S3, S4, or S5");
  }

  const captured = PLANNED_CAPTURES.map((planned) => {
    const row = {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      inspection_status: "UNAVAILABLE",
      manifest_status: "NOT_EVALUATED",
      manifest_discrepancies: [],
      missing_files: [],
      capture_run_id: null,
      ui_consistency: "NOT_EVALUATED",
      project_state: null,
      bank_semantic_decode: "NOT_RUN",
    };
    let captureDir;
    try {
      captureDir = resolveCaptureDir(planned.name, root);
      const meta = readMeta(captureDir);
      if (
        meta.schema !== META_SCHEMA || meta.work_id !== WORK_ID
        || meta.stage_id !== planned.stage_id || meta.stage_semantics !== planned.stage_semantics
        || meta.project_name !== PROJECT_NAME || meta.device !== "Octatrack MkII"
        || meta.device_generated !== true
      ) {
        throw new Error("snapshot provenance metadata is incomplete");
      }
      assertPinnedFirmware(meta);
      assertOperationKind(meta);
      assertCopyPatternRoles(meta);
      row.capture_run_id = sentinelValue(meta, "capture_run_id");

      // buildManifest validates regular-file, no-symlink and size-cap rules
      // without modifying either the source tree or the existing manifest.
      const fresh = buildManifest(planned.name, root);
      const actualFiles = new Map(fresh.files.map((item) => [item.path, item]));
      row.missing_files = REQUIRED_FILES.filter((name) => !actualFiles.has(name));
      let checked;
      try {
        checked = verifyManifest(planned.name, root);
      } catch (err) {
        row.manifest_status = String(err.message).includes("SHA256SUMS.json is missing")
          ? "MISSING" : "INVALID";
        row.manifest_error = err.message;
      }
      if (checked) {
        if (checked.ok) {
          row.manifest_status = "VERIFIED";
        } else {
          const previous = Array.isArray(checked.recorded_files) ? checked.recorded_files : [];
          const previousByPath = new Map(previous.filter((item) => item && typeof item.path === "string")
            .map((item) => [item.path, item]));
          for (const name of REQUIRED_FILES) {
            const old = previousByPath.get(name);
            const now = actualFiles.get(name);
            if (!old || !now || old.sha256 !== now.sha256 || old.size !== now.size) {
              row.manifest_discrepancies.push({
                file: name,
                finding: !now ? "MISSING_CURRENT_FILE" : !old ? "NOT_IN_RECORDED_MANIFEST" : "HASH_OR_SIZE_MISMATCH",
                recorded_sha256: typeof old?.sha256 === "string" ? old.sha256 : null,
                current_sha256: typeof now?.sha256 === "string" ? now.sha256 : null,
              });
            }
          }
          const recordedDocument = JSON.parse(readFileSync(path.join(captureDir, "SHA256SUMS.json"), "utf8"));
          const structurallyValid = recordedDocument.schema === MANIFEST_SCHEMA
            && recordedDocument.capture === planned.name
            && previous.length === REQUIRED_FILES.length
            && REQUIRED_FILES.every((name) => previous.filter((item) => item?.path === name).length === 1);
          const onlyMeta = structurallyValid && row.manifest_discrepancies.length === 1
            && row.manifest_discrepancies[0].file === "capture.meta.json";
          row.manifest_status = onlyMeta ? "STALE_METADATA_ONLY" : "STALE_OTHER_OR_FILESET";
        }
      }
      const files = {};
      for (const name of MATRIX_FILES) {
        if (actualFiles.has(name)) files[name] = readBoundedCaptureFile(captureDir, name);
      }
      row.inspection_status = row.missing_files.length ? "PARTIAL_BYTES" : "BYTES_READABLE";
      if (files["project.work"]) {
        const state = parseProjectStatesSection(files["project.work"].toString("latin1"));
        row.project_state = state.ok ? { bank: state.bank, pattern: state.pattern } : null;
        if (state.ok) {
          try {
            assertUiMatchesProjectStates(meta, state);
            row.ui_consistency = "MATCH";
          } catch {
            row.ui_consistency = "MISMATCH";
          }
        } else {
          row.ui_consistency = "INVALID_PROJECT_STATE";
        }
      } else {
        row.ui_consistency = "PROJECT_WORK_MISSING";
      }
      return { ...row, meta, files };
    } catch (err) {
      return { ...row, error: err.message, files: {} };
    }
  });

  const partitions = [];
  const transitions = [];
  let segment = null;
  for (let index = 0; index < captured.length; index += 1) {
    const current = captured[index];
    const previous = captured[index - 1] ?? null;
    const boundary = current.stage_id === split_before_stage || !!(
      previous?.capture_run_id && current.capture_run_id && previous.capture_run_id !== current.capture_run_id
    );
    if (!segment || boundary) {
      segment = { segment_id: "segment_" + (partitions.length + 1), stage_ids: [] };
      partitions.push(segment);
    }
    segment.stage_ids.push(current.stage_id);
    if (!previous) continue;
    const edge = ADJACENT_TRANSITIONS[index - 1];
    if (boundary) {
      transitions.push({
        transition: edge.label, from: previous.stage_id, to: current.stage_id,
        attribution: "CROSS_SESSION_NOT_COMPARABLE", changed_files: null, uncompared_files: MATRIX_FILES,
      });
      continue;
    }
    const comparable = MATRIX_FILES.filter((name) =>
      Buffer.isBuffer(previous.files[name]) && Buffer.isBuffer(current.files[name]));
    transitions.push({
      transition: edge.label, from: previous.stage_id, to: current.stage_id,
      attribution: comparable.length ? "UNVERIFIED_STORED_BYTE_DIFF_ONLY" : "UNAVAILABLE",
      changed_files: comparable.length
        ? comparable.filter((name) => !buffersEqual(previous.files[name], current.files[name])) : null,
      uncompared_files: MATRIX_FILES.filter((name) => !comparable.includes(name)),
    });
  }

  const s1 = captured[1];
  const sourceEdit = transitions[0];
  const paste = transitions[1];
  const sourceWork = s1?.files?.[SOURCE_BANK + ".work"];
  const sourceSaved = s1?.files?.[SOURCE_BANK + ".strd"];
  const hasSourcePair = Buffer.isBuffer(sourceWork) && Buffer.isBuffer(sourceSaved);
  const sourceProjectPosition = Buffer.isBuffer(captured[0]?.files?.["project.work"])
    && Buffer.isBuffer(s1?.files?.["project.work"])
    ? classifyProjectWorkChange(captured[0].files["project.work"], s1.files["project.work"])
    : "NOT_EVALUATED";
  const unexpected = sourceEdit?.changed_files?.filter((name) =>
    name !== SOURCE_BANK + ".work"
    && !(name === "project.work" && sourceProjectPosition === "POSITION_ONLY")
  ) ?? null;
  const publicSnapshots = captured.map(({ meta: _meta, files: _files, ...row }) => row);
  const manifestVerified = publicSnapshots.filter((row) => row.manifest_status === "VERIFIED").length;
  const bytesReadable = publicSnapshots.filter((row) => row.inspection_status === "BYTES_READABLE").length;
  const comparableStages = publicSnapshots.filter((row) =>
    row.inspection_status === "BYTES_READABLE" || row.inspection_status === "PARTIAL_BYTES").length;
  const observedYesNo = (transition, name) => !transition?.changed_files
    ? "NOT_EVALUATED" : transition.uncompared_files.includes(name)
      ? "NOT_EVALUATED" : transition.changed_files.includes(name) ? "YES_UNVERIFIED" : "NO_UNVERIFIED";

  return {
    ...frozenPolicyFields(),
    audit_mode: "MIXED_SESSION_FORENSIC_INSPECTION",
    operator_declared_split_before: split_before_stage,
    inspection_report_generated: "YES",
    stage_bytes_readable: bytesReadable + "/" + PLANNED_CAPTURES.length,
    stages_partially_or_fully_readable: comparableStages + "/" + PLANNED_CAPTURES.length,
    manifests_verified: manifestVerified + "/" + PLANNED_CAPTURES.length,
    raw_snapshot_integrity: manifestVerified === PLANNED_CAPTURES.length ? "PASS" : "UNVERIFIED",
    device_evidence_promotion: "BLOCKED",
    copy_effect_attribution: "INCONCLUSIVE",
    working_content_transfer: "NOT_PROVEN_BY_THIS_INSPECTION",
    result: "INSPECTION_REPORT_ONLY_NOT_EVIDENCE",
    snapshots: publicSnapshots,
    session_partitions: partitions,
    transitions,
    raw_observations: {
      s1_source_work_differs_from_saved: hasSourcePair
        ? (buffersEqual(sourceWork, sourceSaved) ? "NO_UNVERIFIED" : "YES_UNVERIFIED")
        : "NOT_EVALUATED",
      source_only_project_work_change: sourceProjectPosition,
      source_edit_unexpected_changed_files: unexpected,
      s1_to_s2_destination_work_changed: observedYesNo(paste, DEST_BANK + ".work"),
      s1_to_s2_destination_saved_changed: observedYesNo(paste, DEST_BANK + ".strd"),
    },
  };
}

export function buildBankCopyDatasetCommand(root = FIXTURE_ROOT) {
  if (!sequenceProvenFromMeta(root)) {
    throw new Error("capture sequence is not proven");
  }
  return buildBankCopyDatasetFromFixture(root);
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
      console.log(JSON.stringify(analyzeBankCopyEvidence(root), null, 2));
      return;
    }
    if (command === "audit-mixed") {
      const audit = auditMixedCapture(root, { split_before_stage: arg2 || null });
      console.log(JSON.stringify(audit, null, 2));
      if (audit.raw_snapshot_integrity !== "PASS") process.exitCode = 1;
      return;
    }
    if (command === "inspect-mixed") {
      console.log(JSON.stringify(inspectMixedCapture(root, { split_before_stage: arg2 || null }), null, 2));
      return;
    }
    if (command === "dataset") {
      console.log(JSON.stringify(buildBankCopyDatasetCommand(root), null, 2));
      return;
    }
    if (command === "write-manifest") {
      if (!arg1) throw new Error("write-manifest requires a capture name");
      const manifest = writeManifest(arg1, root);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      if (!arg1) throw new Error("verify-manifest requires a capture name");
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
