#!/usr/bin/env node
/**
 * P_BANK_ID2 receptacle: Banks A/B/C copied on-device, current bank D at capture.
 * Typed equality is enforced before raw slot analysis (Rust test). Offset 585459
 * stays content-dependent from evidence-1; do not reopen it as slot identity.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_OFFSET,
  bankRawForUi,
  classifyRawDiffs,
  parseStatesSection,
} from "./pse-bank-identity-device.mjs";

export const META_SCHEMA = "masterocta.pse-bank-identity-device-2-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-identity-device-2-capture-manifest:v1";
const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_identity_device_2",
);

export const PLANNED_CAPTURE = {
  name: "abc_equal_current_d",
  capture_id: "1",
  current_bank_ui: "D",
  source_bank_ui: "A",
  copied_to: ["B", "C"],
  comparison_banks: ["A", "B", "C"],
  files: [
    "project.work",
    "project.strd",
    "bank01.work",
    "bank01.strd",
    "bank02.work",
    "bank02.strd",
    "bank03.work",
    "bank03.strd",
  ],
  optional_files: ["bank04.work", "bank04.strd"],
};

export function resolveCaptureDir(captureName, root = FIXTURE_ROOT) {
  if (!CAPTURE_NAME.test(captureName)) {
    throw new Error(`Invalid capture name (use [a-z0-9_]+): ${captureName}`);
  }
  const rootResolved = path.resolve(root);
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

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function provenanceReady(meta, planned, captureDir) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) throw new Error("capture provenance is incomplete");
  if (meta.capture_label !== planned.name || meta.capture_id !== planned.capture_id) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== "P_BANK_ID2") {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.current_bank_ui !== planned.current_bank_ui) {
    throw new Error("current_bank_ui does not match the capture label");
  }
  if (meta.source_bank_ui !== planned.source_bank_ui) {
    throw new Error("source bank does not match the capture label");
  }
  if (!arraysEqual(meta.copied_to, planned.copied_to)) {
    throw new Error("copied_to does not match the capture label");
  }
  if (!arraysEqual(meta.comparison_banks, planned.comparison_banks)) {
    throw new Error("comparison_banks does not match the capture label");
  }
  const projectPath = path.join(captureDir, "project.work");
  const projectStat = assertRegularFile(projectPath, "project.work");
  if (!projectStat) throw new Error("capture provenance is incomplete");
  if (projectStat.size > PROJECT_WORK_CAP_BYTES) {
    throw new Error("project.work exceeds 1 MiB");
  }
  const states = parseStatesSection(readFileSync(projectPath, "latin1"));
  if (states.bank !== bankRawForUi(planned.current_bank_ui)) {
    throw new Error("project.work BANK does not match declared current_bank_ui");
  }
  if (meta.same_content_different_slot_evidence !== true) {
    throw new Error("same_content_different_slot_evidence is not declared");
  }
  if (meta.content_edited_after_copy !== false) {
    throw new Error("content edited after the bank copy is not same-content evidence");
  }
  for (const key of ["os_version", "copy_operation", "save_operation", "capture_date"]) {
    if (typeof meta[key] !== "string" || meta[key].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  return true;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function plannedManifestFiles(captureDir, planned) {
  const names = [...planned.files];
  for (const name of planned.optional_files) {
    if (assertRegularFile(path.join(captureDir, name), name)) names.push(name);
  }
  return names;
}

export function inspectCapture(captureName = PLANNED_CAPTURE.name, root = FIXTURE_ROOT) {
  const planned = PLANNED_CAPTURE;
  if (captureName !== planned.name) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  const meta = readMeta(captureDir);
  if (!provenanceReady(meta, planned, captureDir)) {
    return {
      capture_label: planned.name,
      capture_status: "WAITING",
      evidence: false,
    };
  }
  const files = {};
  for (const name of plannedManifestFiles(captureDir, planned)) {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) throw new Error(`device_generated capture is missing ${name}`);
    const cap = name.startsWith("project.") ? PROJECT_WORK_CAP_BYTES : BANK_FILE_CAP_BYTES;
    if (st.size > cap) throw new Error(`${name} exceeds its size cap`);
    files[name] = { present: true, size: st.size, sha256: sha256File(full) };
  }
  return {
    capture_label: planned.name,
    capture_status: "PRESENT",
    current_bank_ui: planned.current_bank_ui,
    comparison_banks: planned.comparison_banks,
    files,
    evidence: true,
  };
}

export function captureStatus(root = FIXTURE_ROOT) {
  const planned = PLANNED_CAPTURE;
  let row;
  try {
    resolveCaptureDir(planned.name, root);
    const captureDir = resolveCaptureDir(planned.name, root);
    let meta;
    try {
      meta = readMeta(captureDir);
    } catch (err) {
      if (err && (err.code === "ENOENT" || String(err.message).includes("missing"))) {
        row = { capture_label: planned.name, capture_status: "MISSING" };
      } else {
        throw err;
      }
    }
    if (!row) {
      try {
        if (!provenanceReady(meta, planned, captureDir)) {
          row = { capture_label: planned.name, capture_status: "WAITING" };
        } else {
          row = {
            capture_label: planned.name,
            capture_status: inspectCapture(planned.name, root).capture_status,
            current_bank_ui: planned.current_bank_ui,
          };
        }
      } catch (err) {
        row = { capture_label: planned.name, capture_status: "REJECTED", error: err.message };
      }
    }
  } catch (err) {
    row = { capture_label: planned.name, capture_status: "REJECTED", error: err.message };
  }
  const deviceCapture = row.capture_status === "PRESENT" ? "PASS" : "NOT_RUN";
  return {
    work_id: "MO-PSE-BANK-INTERNAL-IDENTITY-DEVICE-EVIDENCE-2",
    device_capture: deviceCapture,
    typed_content_equal_a_b_c: deviceCapture === "PASS" ? "PENDING_RUST" : "NOT_RUN",
    offset_585459_classification: "CONTENT_DEPENDENT",
    bank_internal_identity: "NO_INTERNAL_IDENTITY_OBSERVED",
    readiness_gap_bank_internal_identity: "OPEN",
    bank_changeplan_readiness: "NOT_READY",
    result: deviceCapture === "PASS" ? "PENDING_ANALYSIS" : "STOP_FOR_DEVICE",
    capture: row,
  };
}

export function rawCompareBanks(captureDir, suffix) {
  const read = (slot) => readFileSync(path.join(captureDir, `bank0${slot}.${suffix}`));
  const banks = [1, 2, 3].map(read);
  const pairwise = [];
  for (let left = 0; left < banks.length; left += 1) {
    for (let right = left + 1; right < banks.length; right += 1) {
      pairwise.push({
        left: left + 1,
        right: right + 1,
        suffix,
        ...classifyRawDiffs(banks[left], banks[right]),
      });
    }
  }
  return pairwise;
}

export function analyzeCapture(captureName = PLANNED_CAPTURE.name, root = FIXTURE_ROOT) {
  const status = captureStatus(root);
  if (status.device_capture !== "PASS") {
    return {
      ...status,
      raw_diff_class: "NOT_RUN",
      typed_content_equal_a_b_c: "NOT_RUN",
    };
  }
  const captureDir = resolveCaptureDir(captureName, root);
  const workDiffs = rawCompareBanks(captureDir, "work");
  const strdDiffs = rawCompareBanks(captureDir, "strd");
  const nonChecksum = (entry) => entry.diffs.filter((diff) => diff.classification !== "CHECKSUM");
  const slotCorrelated = [...workDiffs, ...strdDiffs].flatMap(nonChecksum).filter(
    (diff) => diff.classification !== "PINNED_OFFSET",
  );
  return {
    ...status,
    typed_content_equal_a_b_c: "PENDING_RUST",
    raw_diff_class: slotCorrelated.length === 0 ? "checksum_only_pending_typed" : "unknown_pending_typed",
    offset_585459_classification: "CONTENT_DEPENDENT",
    work_pairwise: workDiffs,
    strd_pairwise: strdDiffs,
    pinned_offset: PINNED_OFFSET,
    note: "Run Rust p_bank_id2_abc_equal_current_d_analysis after typed gate passes.",
  };
}

export function buildManifest(captureName = PLANNED_CAPTURE.name, root = FIXTURE_ROOT) {
  const planned = PLANNED_CAPTURE;
  if (captureName !== planned.name) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  const files = plannedManifestFiles(captureDir, planned).flatMap((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) return [];
    return [{ path: name, sha256: sha256File(full), size: st.size }];
  });
  return { schema: MANIFEST_SCHEMA, capture: planned.name, files };
}

function writeRegularFileAtomic(filePath, contents) {
  const destination = path.resolve(filePath);
  let existing = null;
  try {
    existing = lstatSync(destination);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error("Refusing non-regular manifest destination: SHA256SUMS.json");
    }
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${process.pid}`;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(partial, flags, 0o644);
  try {
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(partial, destination);
  } catch (err) {
    try {
      unlinkSync(partial);
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

export function writeManifest(captureName = PLANNED_CAPTURE.name, root = FIXTURE_ROOT) {
  const planned = PLANNED_CAPTURE;
  const captureDir = resolveCaptureDir(captureName, root);
  for (const name of planned.files) {
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

export function verifyManifest(captureName = PLANNED_CAPTURE.name, root = FIXTURE_ROOT) {
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureName, root);
  return {
    ok: recorded.schema === MANIFEST_SCHEMA
      && JSON.stringify(recorded.files ?? null) === JSON.stringify(fresh.files),
    recorded_files: recorded.files ?? null,
    fresh_files: fresh.files,
  };
}

function main() {
  const [, , command, captureName] = process.argv;
  const name = captureName ?? PLANNED_CAPTURE.name;
  try {
    if (command === "status") {
      console.log(JSON.stringify(captureStatus(), null, 2));
      return;
    }
    if (command === "inspect") {
      console.log(JSON.stringify(inspectCapture(name), null, 2));
      return;
    }
    if (command === "analyze") {
      console.log(JSON.stringify(analyzeCapture(name), null, 2));
      return;
    }
    if (command === "write-manifest") {
      const manifest = writeManifest(name);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      const result = verifyManifest(name);
      if (!result.ok) {
        console.error("PRE_SHA != POST_SHA");
        process.exitCode = 1;
        return;
      }
      console.log("PRE_SHA == POST_SHA");
      return;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.error(
    "Usage: node scripts/pse-bank-identity-device-2.mjs <status|inspect|analyze|write-manifest|verify-manifest> [capture]",
  );
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
