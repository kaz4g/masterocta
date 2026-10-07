#!/usr/bin/env node
/**
 * Read-only receptacle for P_BANK_ID same-content / different-slot captures.
 *
 * status / inspect / verify-manifest do not write.
 * write-manifest writes SHA256SUMS.json only. A symlink or other non-regular
 * destination is refused and is not followed.
 * This script does not copy bank bytes, does not encode a bank, and does not
 * close ReadinessGap::BankInternalIdentity.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const META_SCHEMA = "masterocta.pse-bank-identity-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-identity-capture-manifest:v1";
export const PINNED_OFFSET = 585459;
const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const HEADER_LEN = 21;
const CHECKSUM_LEN = 2;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_identity_device",
);

const AB_FILES = [
  "project.work",
  "project.strd",
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
];

export const REQUIRED_CAPTURES = [
  {
    name: "bank_ab_current_a",
    capture_id: "1",
    current_bank_ui: "A",
    source_bank_ui: "A",
    destination_bank_ui: "B",
    files: AB_FILES,
  },
  {
    name: "bank_ab_current_b",
    capture_id: "2",
    current_bank_ui: "B",
    source_bank_ui: "A",
    destination_bank_ui: "B",
    files: AB_FILES,
  },
];

export const OPTIONAL_CAPTURES = [
  {
    name: "bank_abc_slot_c",
    capture_id: "3",
    current_bank_ui: "A",
    source_bank_ui: "A",
    destination_bank_ui: "C",
    files: [...AB_FILES, "bank03.work", "bank03.strd"],
  },
];

const PLANNED = [...REQUIRED_CAPTURES, ...OPTIONAL_CAPTURES];

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
  if (meta.capture_label !== planned.name || meta.capture_id !== planned.capture_id) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== "P_BANK_ID") {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.current_bank_ui !== planned.current_bank_ui) {
    throw new Error("current_bank_ui does not match the capture label");
  }
  if (meta.source_bank_ui !== planned.source_bank_ui || meta.destination_bank_ui !== planned.destination_bank_ui) {
    throw new Error("source or destination bank does not match the capture label");
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

export function inspectCapture(captureName, root = FIXTURE_ROOT) {
  const planned = PLANNED.find((entry) => entry.name === captureName);
  if (!planned) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  const meta = readMeta(captureDir);
  if (!provenanceReady(meta, planned)) {
    return {
      capture_label: planned.name,
      capture_status: "WAITING",
      evidence: false,
      bank_internal_identity: "UNKNOWN",
    };
  }
  const files = {};
  for (const name of planned.files) {
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
    source_bank_ui: planned.source_bank_ui,
    destination_bank_ui: planned.destination_bank_ui,
    files,
    evidence: true,
    bank_internal_identity: "UNKNOWN",
  };
}

function captureRow(planned, root) {
  const captureDir = resolveCaptureDir(planned.name, root);
  let meta;
  try {
    meta = readMeta(captureDir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || String(err.message).includes("missing"))) {
      return { capture_label: planned.name, capture_status: "MISSING" };
    }
    if (String(err.message).includes("synthetic_modification") || String(err.message).includes("Symlink")) {
      return { capture_label: planned.name, capture_status: "REJECTED", error: err.message };
    }
    return { capture_label: planned.name, capture_status: "MISSING" };
  }
  try {
    if (!provenanceReady(meta, planned)) {
      return { capture_label: planned.name, capture_status: "WAITING" };
    }
    const inspected = inspectCapture(planned.name, root);
    return {
      capture_label: planned.name,
      capture_status: inspected.capture_status,
      current_bank_ui: planned.current_bank_ui,
    };
  } catch (err) {
    return { capture_label: planned.name, capture_status: "REJECTED", error: err.message };
  }
}

export function captureStatus(root = FIXTURE_ROOT) {
  const required = REQUIRED_CAPTURES.map((planned) => captureRow(planned, root));
  const optionalDir = resolveCaptureDir(OPTIONAL_CAPTURES[0].name, root);
  let optional = [];
  try {
    lstatSync(optionalDir);
    optional = [captureRow(OPTIONAL_CAPTURES[0], root)];
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  const present = required.filter((entry) => entry.capture_status === "PRESENT");
  return {
    capture_status: present.length === 0
      ? "WAITING_FOR_REAL_DEVICE"
      : present.length === REQUIRED_CAPTURES.length
        ? "READY_FOR_REVIEW"
        : "PARTIAL",
    same_content_different_slot_device_evidence: present.length === REQUIRED_CAPTURES.length
      ? "DECLARED"
      : "ABSENT",
    bank_internal_identity: "UNKNOWN",
    readiness_gap_bank_internal_identity: "OPEN",
    bank_changeplan_readiness: "NOT_READY",
    domain_changed: false,
    captures: [...required, ...optional],
  };
}

/**
 * Raw diff classes for two bank buffers. The pinned offset is reported as
 * PINNED_OFFSET, not as proven slot identity.
 */
export function classifyRawDiffs(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
    return { same_length: false, diffs: [] };
  }
  const checksumStart = left.length - CHECKSUM_LEN;
  const diffs = [];
  for (let offset = 0; offset < left.length; offset += 1) {
    if (left[offset] === right[offset]) continue;
    let classification = "UNKNOWN";
    if (offset < HEADER_LEN) classification = "HEADER";
    else if (offset >= checksumStart) classification = "CHECKSUM";
    else if (offset === PINNED_OFFSET) classification = "PINNED_OFFSET";
    diffs.push({
      offset,
      left: left[offset],
      right: right[offset],
      classification,
    });
  }
  return { same_length: true, diffs };
}

/**
 * Typed BankFile equality is a separate proof. This receptacle never supplies it.
 * Differing or matching pinned bytes therefore stay UNKNOWN.
 */
export function judgmentFromDeclaredSameContent(pinnedRelation, typedContentEqual) {
  if (typedContentEqual !== true) {
    return {
      bank_internal_identity: "UNKNOWN",
      offset_585459_classification: "UNKNOWN",
      readiness_gap_bank_internal_identity: "OPEN",
    };
  }
  if (pinnedRelation === "DIFFERENT") {
    return {
      bank_internal_identity: "UNKNOWN",
      offset_585459_classification: "IDENTITY_CANDIDATE",
      note: "INTERNAL_IDENTITY_CANDIDATE_STRENGTHENED",
      readiness_gap_bank_internal_identity: "OPEN",
    };
  }
  if (pinnedRelation === "EQUAL") {
    return {
      bank_internal_identity: "UNKNOWN",
      offset_585459_classification: "CONTENT_DEPENDENT",
      note: "Pinned bytes match. Remaining diffs are not a full semantic map.",
      readiness_gap_bank_internal_identity: "OPEN",
    };
  }
  return {
    bank_internal_identity: "UNKNOWN",
    offset_585459_classification: "UNKNOWN",
    readiness_gap_bank_internal_identity: "OPEN",
  };
}

export function buildManifest(captureName, root = FIXTURE_ROOT) {
  const planned = PLANNED.find((entry) => entry.name === captureName);
  if (!planned) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  const files = planned.files.flatMap((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) return [];
    return [{ path: name, sha256: sha256File(full), size: st.size }];
  });
  return { schema: MANIFEST_SCHEMA, capture: planned.name, files };
}

function writeRegularFileNoFollow(filePath, contents) {
  let existing = null;
  try {
    existing = lstatSync(filePath);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error("Refusing non-regular manifest destination: SHA256SUMS.json");
    }
    unlinkSync(filePath);
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(filePath, flags, 0o644);
  try {
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}

export function writeManifest(captureName, root = FIXTURE_ROOT) {
  const planned = PLANNED.find((entry) => entry.name === captureName);
  if (!planned) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  for (const name of planned.files) {
    const st = assertRegularFile(path.join(captureDir, name), name);
    if (!st) throw new Error(`write-manifest requires a regular ${name}`);
  }
  const manifest = buildManifest(captureName, root);
  writeRegularFileNoFollow(
    path.join(captureDir, "SHA256SUMS.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function verifyManifest(captureName, root = FIXTURE_ROOT) {
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
  try {
    if (command === "status") {
      console.log(JSON.stringify(captureStatus(), null, 2));
      return;
    }
    if (command === "inspect") {
      console.log(JSON.stringify(inspectCapture(captureName), null, 2));
      return;
    }
    if (command === "write-manifest") {
      const manifest = writeManifest(captureName);
      console.log(`Wrote SHA256SUMS.json (${manifest.files.length} files)`);
      return;
    }
    if (command === "verify-manifest") {
      const result = verifyManifest(captureName);
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
  console.error("Usage: node scripts/pse-bank-identity-device.mjs <status|inspect|write-manifest|verify-manifest> [capture]");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
