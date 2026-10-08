#!/usr/bin/env node
/**
 * Read-only crossover receptacle for disposable projects P_BANK_XA / P_BANK_XB.
 *
 * status / inspect / analyze / verify-manifest do not write bank bytes.
 * write-manifest writes SHA256SUMS.json only, refuses symlinks, and does not
 * follow them. This script does not copy banks, encode a bank onto the
 * fixture, or close ReadinessGap::BankInternalIdentity.
 * Offset 585459 stays CONTENT_DEPENDENT. Device captures are not PASS until
 * a real manifest verifies. Identity is not advanced from raw equality alone.
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
import {
  PINNED_OFFSET,
  bankRawForUi,
  parseStatesSection,
} from "./pse-bank-identity-device.mjs";

export const META_SCHEMA = "masterocta.pse-bank-identity-crossover-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-bank-identity-crossover-manifest:v1";
export const WORK_ID = "MO-PSE-BANK-INTERNAL-IDENTITY-CROSSOVER-1";
const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const BANK_FILE_CAP_BYTES = 2 * 1024 * 1024;
const CHECKSUM_LEN = 2;
const CAPTURE_NAME = /^[a-z0-9_]+$/;
const RUNS = ["A", "B"];
const SLOTS = ["A", "B", "C"];
const ALL_SLOTS = ["A", "B", "C", "D"];
const SUFFIXES = ["work", "strd"];
const ABSOLUTE_CAPTURES = ["run_a_pre", "run_a_post", "run_b_pre", "run_b_post"];

export const REQUIRED_FILES = [
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

const SLOT_FILE = { A: "bank01", B: "bank02", C: "bank03", D: "bank04" };

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_identity_crossover",
);

export const PLANNED_CAPTURES = [
  {
    name: "run_a_pre",
    run_id: "A",
    phase: "PRE",
    project_name: "P_BANK_XA",
    copy_order: [],
  },
  {
    name: "run_a_post",
    run_id: "A",
    phase: "POST",
    project_name: "P_BANK_XA",
    copy_order: ["B", "C"],
  },
  {
    name: "run_b_pre",
    run_id: "B",
    phase: "PRE",
    project_name: "P_BANK_XB",
    copy_order: [],
  },
  {
    name: "run_b_post",
    run_id: "B",
    phase: "POST",
    project_name: "P_BANK_XB",
    copy_order: ["C", "B"],
  },
];

export function plannedCapture(captureName) {
  return PLANNED_CAPTURES.find((entry) => entry.name === captureName) ?? null;
}

export function assertPlannedCaptureName(captureName) {
  if (!plannedCapture(captureName)) {
    throw new Error(`Not a planned capture: ${captureName}`);
  }
}

export function metaTemplate(planned) {
  return {
    schema: META_SCHEMA,
    run_id: planned.run_id,
    phase: planned.phase,
    project_name: planned.project_name,
    device: "Octatrack MkII",
    os_version: "",
    device_generated: false,
    synthetic_modification: false,
    source_bank_ui: "A",
    comparison_banks: ["A", "B", "C"],
    current_bank_ui: "D",
    copy_order: planned.copy_order,
    project_reloaded: null,
    capture_date: "",
    operator_note:
      "TEMPLATE. Replace after the real-device capture. Keep device_generated false until the copied files and the operator note are in place.",
  };
}

/** Reject symlinked fixture roots before manifest writes. */
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

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function provenanceReady(meta, planned, captureDir) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) throw new Error("capture provenance is incomplete");
  if (meta.run_id !== planned.run_id || meta.phase !== planned.phase) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== planned.project_name) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.current_bank_ui !== "D") {
    throw new Error("current_bank_ui does not match the capture label");
  }
  if (meta.source_bank_ui !== "A" || !arraysEqual(meta.comparison_banks, ["A", "B", "C"])) {
    throw new Error("comparison banks do not match the capture label");
  }
  if (!arraysEqual(meta.copy_order, planned.copy_order)) {
    throw new Error("copy_order does not match the capture label");
  }
  if (typeof meta.project_reloaded !== "boolean") {
    throw new Error("capture provenance is incomplete");
  }
  for (const key of ["os_version", "capture_date", "operator_note"]) {
    if (typeof meta[key] !== "string" || meta[key].trim() === "") {
      throw new Error("capture provenance is incomplete");
    }
  }
  const projectPath = path.join(captureDir, "project.work");
  const projectStat = assertRegularFile(projectPath, "project.work");
  if (!projectStat) throw new Error("capture provenance is incomplete");
  if (projectStat.size > PROJECT_WORK_CAP_BYTES) {
    throw new Error("project.work exceeds 1 MiB");
  }
  const states = parseStatesSection(readFileSync(projectPath, "latin1"));
  if (states.bank !== bankRawForUi("D")) {
    throw new Error("project.work BANK does not match declared current_bank_ui");
  }
  return true;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
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
    run_id: planned.run_id,
    phase: planned.phase,
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
    if (!provenanceReady(meta, planned, captureDir)) {
      return { capture_label: planned.name, capture_status: "WAITING", run_id: planned.run_id, phase: planned.phase };
    }
    for (const name of REQUIRED_FILES) {
      const st = assertRegularFile(path.join(captureDir, name), name);
      if (!st) throw new Error(`device_generated capture is missing ${name}`);
      const cap = name.startsWith("project.") ? PROJECT_WORK_CAP_BYTES : BANK_FILE_CAP_BYTES;
      if (st.size > cap) throw new Error(`${name} exceeds its size cap`);
    }
    const manifest = manifestVerified(planned.name, root);
    if (!manifest.ok) throw new Error(manifest.error);
    return {
      capture_label: planned.name,
      capture_status: "PRESENT",
      run_id: planned.run_id,
      phase: planned.phase,
      current_bank_ui: "D",
      manifest_verified: true,
    };
  } catch (err) {
    return { ...plannedMeta, capture_status: "REJECTED", error: err.message };
  }
}

function frozenJudgment() {
  return {
    offset_585459_classification: "CONTENT_DEPENDENT",
    bank_internal_identity: "UNKNOWN",
    internal_id_rewrite_required_by_evidence: "UNKNOWN",
    readiness_gap_bank_internal_identity: "OPEN",
    issue_221: "OPEN",
    bank_changeplan_readiness: "NOT_READY",
    stable_slot_correlated_field: "INSUFFICIENT",
    copy_order_correlated_field: "INSUFFICIENT",
    source_runtime_correlated: "INSUFFICIENT",
  };
}

export function crossoverStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => captureRow(planned, root));
  const rejected = captures.some((entry) => entry.capture_status === "REJECTED");
  const present = captures.every((entry) => entry.capture_status === "PRESENT");
  let deviceCapture = "WAITING_FOR_REAL_DEVICE";
  let result = "WAITING_FOR_REAL_DEVICE";
  if (rejected) {
    deviceCapture = "REJECTED";
    result = "STOP_WITH_FINDINGS";
  } else if (present) {
    deviceCapture = "PASS";
    result = "PENDING_RUST";
  }
  const runField = (runId, phase) => {
    const row = captures.find((entry) => entry.run_id === runId && entry.phase === phase);
    if (!row || row.capture_status === "WAITING" || row.capture_status === "MISSING") return "NOT_RUN";
    if (row.capture_status === "PRESENT") return "PASS";
    return "REJECTED";
  };
  return {
    work_id: WORK_ID,
    crossover_harness: "READY",
    device_capture: deviceCapture,
    run_a_pre: runField("A", "PRE"),
    run_a_post: runField("A", "POST"),
    run_b_pre: runField("B", "PRE"),
    run_b_post: runField("B", "POST"),
    run_a_copy_order: ["B", "C"],
    run_b_copy_order: ["C", "B"],
    current_bank: "D",
    ...frozenJudgment(),
    result,
    captures,
  };
}

function readBank(captureDir, slot, suffix) {
  const name = `${SLOT_FILE[slot]}.${suffix}`;
  const full = path.join(captureDir, name);
  const st = assertRegularFile(full, name);
  if (!st) throw new Error(`missing ${name}`);
  return readFileSync(full);
}

export function collectFileDeltas(root = FIXTURE_ROOT) {
  const status = crossoverStatus(root);
  if (status.device_capture !== "PASS") {
    return { ...status, raw_delta_classification: "NOT_RUN", diffs: [] };
  }
  const loaded = {};
  for (const planned of PLANNED_CAPTURES) {
    const dir = resolveCaptureDir(planned.name, root);
    loaded[planned.name] = {};
    for (const slot of [...SLOTS, "D"]) {
      loaded[planned.name][slot] = {
        work: readBank(dir, slot, "work"),
        strd: readBank(dir, slot, "strd"),
      };
    }
  }
  const diffs = [];
  let lengthMismatch = false;
  for (const runId of RUNS) {
    const preName = runId === "A" ? "run_a_pre" : "run_b_pre";
    const postName = runId === "A" ? "run_a_post" : "run_b_post";
    const copyOrder = runId === "A" ? ["B", "C"] : ["C", "B"];
    for (const slot of ALL_SLOTS) {
      const rank = SLOTS.includes(slot) ? copyOrder.indexOf(slot) : null;
      for (const suffix of SUFFIXES) {
        const pre = loaded[preName][slot][suffix];
        const post = loaded[postName][slot][suffix];
        if (pre.length !== post.length) {
          lengthMismatch = true;
          continue;
        }
        const checksumStart = pre.length - CHECKSUM_LEN;
        for (let offset = 0; offset < pre.length; offset += 1) {
          if (pre[offset] === post[offset]) continue;
          diffs.push({
            run: runId,
            slot,
            copy_rank: rank == null || rank === -1 ? null : rank + 1,
            suffix,
            offset,
            before: pre[offset],
            after: post[offset],
            classification: offset === PINNED_OFFSET
              ? "CONTENT_DEPENDENT"
              : offset >= checksumStart
                ? "CHECKSUM"
                : "PENDING_TYPED_REPORT",
            typed_field_region: null,
          });
        }
      }
    }
  }
  return {
    ...status,
    result: lengthMismatch ? "STOP_WITH_FINDINGS" : "PENDING_RUST",
    bank_internal_identity: "UNKNOWN",
    raw_delta_classification: lengthMismatch ? "LENGTH_MISMATCH" : "PENDING_TYPED_REPORT",
    typed_delta_classification: "PENDING_RUST",
    length_mismatch: lengthMismatch,
    diffs,
    untouched: {
      A: untouchedPair(loaded.run_a_pre),
      B: untouchedPair(loaded.run_b_pre),
    },
  };
}

function untouchedPair(slots) {
  const compared = ["work", "strd"].map((suffix) => {
    const left = slots.B[suffix];
    const right = slots.C[suffix];
    if (left.length !== right.length) return { suffix, same_length: false, diffs: [] };
    const diffs = [];
    for (let offset = 0; offset < left.length; offset += 1) {
      if (left[offset] !== right[offset]) diffs.push({ offset, b: left[offset], c: right[offset] });
    }
    return { suffix, same_length: true, diffs };
  });
  const mismatch = compared.some((entry) => !entry.same_length);
  const rawDiff = compared.some((entry) => entry.diffs.length > 0);
  return {
    untouched_slot_identity_observed: mismatch || rawDiff ? "INSUFFICIENT" : "PENDING_TYPED",
    compared,
  };
}

export function analyzeCrossover(captureName = null, root = FIXTURE_ROOT) {
  if (captureName != null) assertPlannedCaptureName(captureName);
  const collected = collectFileDeltas(root);
  if (collected.device_capture !== "PASS") return collected;
  return {
    ...collected,
    note: "Typed deltas stay pending until BankFile decode. Raw diffs are not an identity verdict.",
  };
}

function copyRank(copyOrder, slot) {
  const index = copyOrder.indexOf(slot);
  return index === -1 ? null : index + 1;
}

function readPair(pre, post) {
  if (!Buffer.isBuffer(pre) || !Buffer.isBuffer(post) || pre.length !== post.length) {
    return { same_length: false, byOffset: new Map(), pre, post, length: null };
  }
  const checksumStart = pre.length - CHECKSUM_LEN;
  const byOffset = new Map();
  for (let offset = 0; offset < pre.length; offset += 1) {
    if (pre[offset] === post[offset]) continue;
    byOffset.set(offset, {
      before: pre[offset],
      after: post[offset],
      checksum: offset >= checksumStart,
    });
  }
  return { same_length: true, byOffset, pre, post, length: pre.length };
}

function changedCells(cells) {
  const found = [];
  for (const run of RUNS) {
    for (const slot of SLOTS) {
      if (cells[run][slot].changed) found.push({ run, slot, ...cells[run][slot] });
    }
  }
  return found;
}

function slotRule(cells) {
  const bankB = [cells.A.B, cells.B.B];
  const bankC = [cells.A.C, cells.B.C];
  return bankB.every((cell) => cell.changed)
    && bankC.every((cell) => cell.changed)
    && bankB[0].after === bankB[1].after
    && bankC[0].after === bankC[1].after
    && bankB[0].after !== bankC[0].after;
}

function orderRule(cells) {
  const at = (run, rank) => SLOTS.map((slot) => cells[run][slot]).find((cell) => cell.copy_rank === rank);
  const first = [at("A", 1), at("B", 1)];
  const second = [at("A", 2), at("B", 2)];
  if (first.some((cell) => !cell) || second.some((cell) => !cell)) return false;
  return first.every((cell) => cell.changed)
    && second.every((cell) => cell.changed)
    && first[0].after === first[1].after
    && second[0].after === second[1].after
    && first[0].after !== second[0].after;
}

function sourceRule(cells) {
  const source = [cells.A.A, cells.B.A];
  const destinationsQuiet = RUNS.every((run) => ["B", "C"].every((slot) => !cells[run][slot].changed));
  return source.every((cell) => cell.changed)
    && source[0].after === source[1].after
    && destinationsQuiet;
}

function dChangeAt(pairs, run, suffix, offset) {
  const pair = pairs.find((entry) => entry.run === run && entry.slot === "D" && entry.suffix === suffix);
  return pair?.byOffset.get(offset) ?? null;
}

function runtimeControlMatchesOffset(cells, pairs, suffix, offset) {
  for (const run of RUNS) {
    const dChange = dChangeAt(pairs, run, suffix, offset);
    if (!dChange) continue;
    for (const slot of SLOTS) {
      const cell = cells[run][slot];
      if (
        cell.changed
        && cell.before === dChange.before
        && cell.after === dChange.after
      ) {
        return true;
      }
    }
  }
  return false;
}

function dOnlyRuntimeOffset(cells, pairs, suffix, offset) {
  const destChanged = RUNS.some((run) => SLOTS.some((slot) => cells[run][slot].changed));
  if (destChanged) return false;
  return RUNS.some((run) => Boolean(dChangeAt(pairs, run, suffix, offset)));
}

function classifyOffset(offset, suffix, cells, typed, regions, pairs) {
  if (offset === PINNED_OFFSET) return "CONTENT_DEPENDENT";
  const region = regions?.[suffix]?.[offset] ?? regions?.[suffix]?.[String(offset)] ?? null;
  const changed = changedCells(cells);
  if (region && changed.length > 0 && changed.every((cell) => (typed?.[cell.run]?.[cell.slot] ?? []).includes(region))) {
    return "CONTENT_DEPENDENT";
  }
  if (changed.length > 0 && changed.every((cell) => cell.checksum)) return "CHECKSUM";
  if (runtimeControlMatchesOffset(cells, pairs, suffix, offset)) return "RUNTIME_CONTROL_MATCH";
  if (dOnlyRuntimeOffset(cells, pairs, suffix, offset)) return "RUNTIME_CONTROL_MATCH";
  if (slotRule(cells)) return "STABLE_SLOT_CORRELATED";
  if (orderRule(cells)) return "COPY_ORDER_CORRELATED";
  if (sourceRule(cells)) return "SOURCE_OR_RUNTIME_DEPENDENT";
  return "UNEXPLAINED";
}

function judgmentShell(overrides) {
  return {
    length_mismatch: false,
    diffs: [],
    offset_classes: [],
    absolute_slot_comparison: "NOT_RUN",
    stable_slot_correlated_field: "INSUFFICIENT",
    copy_order_correlated_field: "INSUFFICIENT",
    source_runtime_correlated: "INSUFFICIENT",
    bank_d_runtime_control: "NOT_RUN",
    run_a_copy_effect_observed: "NOT_RUN",
    run_b_copy_effect_observed: "NOT_RUN",
    run_a_destinations_post_raw_equal: "NOT_RUN",
    run_a_destinations_post_typed_equal: "NOT_RUN",
    crossover_completeness: "INSUFFICIENT",
    crossover_negative_evidence: "INSUFFICIENT",
    offset_585459_classification: "CONTENT_DEPENDENT",
    bank_internal_identity: "UNKNOWN",
    internal_id_rewrite_required_by_evidence: "UNKNOWN",
    readiness_gap_bank_internal_identity: "OPEN",
    issue_221: "OPEN",
    bank_changeplan_readiness: "NOT_READY",
    raw_delta_classification: "NONE",
    typed_delta_classification: "INSUFFICIENT",
    untouched_slot_identity_observed: "NOT_RUN",
    result: "STOP_WITH_FINDINGS",
    ...overrides,
  };
}

function closureBundleReady(closure) {
  if (!closure || typeof closure !== "object") return false;
  const required = [
    "device_capture_valid",
    "manifest_verified",
    "current_bank_d",
    "bank_roundtrip",
    "pre_post_typed_classified",
    "pre_post_raw_classified",
    "bank_d_negative_control",
    "same_content_absolute_completed",
  ];
  return required.every((key) => closure[key] === true);
}

function runCopyEffectObserved(_dataset, pairs) {
  const observed = { A: false, B: false };
  for (const pair of pairs) {
    if (pair.slot !== "B" && pair.slot !== "C") continue;
    for (const change of pair.byOffset.values()) {
      if (change.checksum) continue;
      observed[pair.run] = true;
    }
  }
  return {
    run_a_copy_effect_observed: observed.A ? "YES" : "NO",
    run_b_copy_effect_observed: observed.B ? "YES" : "NO",
  };
}

function compareAbsoluteBuffers(left, right, suffix, captureName, leftSlot, rightSlot) {
  const diffs = [];
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
    return { same_length: false, diffs };
  }
  const checksumStart = left.length - CHECKSUM_LEN;
  for (let offset = 0; offset < left.length; offset += 1) {
    if (left[offset] === right[offset]) continue;
    if (offset === PINNED_OFFSET || offset >= checksumStart) continue;
    diffs.push({
      capture: captureName,
      suffix,
      left_slot: leftSlot,
      right_slot: rightSlot,
      offset,
      left: left[offset],
      right: right[offset],
      classification: "ABSOLUTE_SLOT_CANDIDATE",
    });
  }
  return { same_length: true, diffs };
}

function absolutePairKey(leftSlot, rightSlot) {
  return [leftSlot, rightSlot].sort().join("-");
}

function absoluteTypedContentEqual(dataset, captureName, leftSlot, rightSlot) {
  if (
    (leftSlot === "B" && rightSlot === "C")
    || (leftSlot === "C" && rightSlot === "B")
  ) {
    return true;
  }
  const map = dataset.absolute_typed_content_equal?.[captureName];
  if (!map) return false;
  const key = absolutePairKey(leftSlot, rightSlot);
  return map[key] === true;
}

export function defaultAbsoluteTypedContentEqual() {
  const row = { "B-C": true, "B-D": false, "C-D": false };
  return Object.fromEntries(ABSOLUTE_CAPTURES.map((capture) => [capture, { ...row }]));
}

export function analyzeAbsoluteSlotComparison(dataset) {
  const captures = dataset?.absolute_captures;
  if (!captures) {
    return { status: "INSUFFICIENT", slot_candidate: false, diffs: [] };
  }
  const diffs = [];
  for (const captureName of ABSOLUTE_CAPTURES) {
    const cap = captures[captureName];
    if (!cap?.B || !cap?.C) {
      return { status: "INSUFFICIENT", slot_candidate: false, diffs: [] };
    }
    for (const suffix of SUFFIXES) {
      const leftB = cap.B[suffix];
      const leftC = cap.C[suffix];
      if (absoluteTypedContentEqual(dataset, captureName, "B", "C")) {
        diffs.push(...compareAbsoluteBuffers(leftB, leftC, suffix, captureName, "B", "C").diffs);
      }
      if (cap.D && absoluteTypedContentEqual(dataset, captureName, "B", "D")) {
        diffs.push(...compareAbsoluteBuffers(leftB, cap.D[suffix], suffix, captureName, "B", "D").diffs);
      }
      if (cap.D && absoluteTypedContentEqual(dataset, captureName, "C", "D")) {
        diffs.push(...compareAbsoluteBuffers(leftC, cap.D[suffix], suffix, captureName, "C", "D").diffs);
      }
    }
  }
  return {
    status: "PASS",
    slot_candidate: diffs.length > 0,
    diffs,
  };
}

export function buildCrossoverDatasetFromFixture(root, typed_deltas, options = {}) {
  const runs = {};
  for (const runId of RUNS) {
    const preName = runId === "A" ? "run_a_pre" : "run_b_pre";
    const postName = runId === "A" ? "run_a_post" : "run_b_post";
    const planned = PLANNED_CAPTURES.find((entry) => entry.name === postName);
    const slots = {};
    for (const slot of ALL_SLOTS) {
      slots[slot] = {};
      for (const suffix of SUFFIXES) {
        const preDir = resolveCaptureDir(preName, root);
        const postDir = resolveCaptureDir(postName, root);
        slots[slot][suffix] = {
          pre: readBank(preDir, slot, suffix),
          post: readBank(postDir, slot, suffix),
        };
      }
    }
    runs[runId] = { copy_order: planned.copy_order, slots };
  }
  const absolute_captures = {};
  for (const captureName of ABSOLUTE_CAPTURES) {
    const dir = resolveCaptureDir(captureName, root);
    absolute_captures[captureName] = {};
    for (const slot of ["B", "C", "D"]) {
      absolute_captures[captureName][slot] = {
        work: readBank(dir, slot, "work"),
        strd: readBank(dir, slot, "strd"),
      };
    }
  }
  return {
    runs,
    typed_deltas,
    typed_regions: options.typed_regions ?? { work: {}, strd: {} },
    absolute_captures,
    absolute_typed_content_equal:
      options.absolute_typed_content_equal ?? defaultAbsoluteTypedContentEqual(),
    closure: options.closure ?? null,
    run_a_destinations_post_raw_equal: options.run_a_destinations_post_raw_equal ?? null,
    run_a_destinations_post_typed_equal: options.run_a_destinations_post_typed_equal ?? null,
  };
}

function presence(classes, name, unexplained) {
  if (classes.has(name)) return "PRESENT";
  if (unexplained) return "INSUFFICIENT";
  return "NONE";
}

/**
 * Classify PRE→POST deltas from an in-memory dataset.
 * `typed_deltas[run][slot]` lists BankFile fields that differ for that slot.
 * A missing typed report does not become a slot-identity hit.
 */
export function classifyCrossover(dataset) {
  if (!dataset?.typed_deltas) {
    return judgmentShell({
      stable_slot_correlated_field: "INSUFFICIENT",
      copy_order_correlated_field: "INSUFFICIENT",
      source_runtime_correlated: "INSUFFICIENT",
      raw_delta_classification: "TYPED_REPORT_MISSING",
      typed_delta_classification: "INSUFFICIENT",
    });
  }
  const regions = dataset.typed_regions ?? { work: {}, strd: {} };
  const pairs = [];
  let lengthMismatch = false;
  for (const run of RUNS) {
    for (const slot of ALL_SLOTS) {
      for (const suffix of SUFFIXES) {
        const buffers = dataset.runs?.[run]?.slots?.[slot]?.[suffix];
        if (!buffers) {
          return judgmentShell({
            raw_delta_classification: "INCOMPLETE_DATASET",
            typed_delta_classification: dataset.typed_deltas,
            stable_slot_correlated_field: "INSUFFICIENT",
            copy_order_correlated_field: "INSUFFICIENT",
            source_runtime_correlated: "INSUFFICIENT",
          });
        }
        const parsed = readPair(buffers.pre, buffers.post);
        if (!parsed.same_length) lengthMismatch = true;
        pairs.push({
          run,
          slot,
          suffix,
          ...parsed,
          copy_rank: SLOTS.includes(slot)
            ? copyRank(dataset.runs[run].copy_order ?? [], slot)
            : null,
        });
      }
    }
  }
  if (lengthMismatch) {
    return judgmentShell({
      length_mismatch: true,
      raw_delta_classification: "LENGTH_MISMATCH",
      typed_delta_classification: dataset.typed_deltas,
      stable_slot_correlated_field: "INSUFFICIENT",
      copy_order_correlated_field: "INSUFFICIENT",
      source_runtime_correlated: "INSUFFICIENT",
    });
  }

  const copyEffects = runCopyEffectObserved(dataset, pairs);
  const absolute = analyzeAbsoluteSlotComparison(dataset);
  const absoluteStatus = absolute.status === "PASS" ? "PASS" : "INSUFFICIENT";

  const offsets = { work: new Set(), strd: new Set() };
  for (const pair of pairs) {
    for (const offset of pair.byOffset.keys()) offsets[pair.suffix].add(offset);
  }
  const offsetClasses = [];
  const diffs = [];
  for (const suffix of SUFFIXES) {
    for (const offset of [...offsets[suffix]].sort((left, right) => left - right)) {
      const cells = {};
      for (const run of RUNS) {
        cells[run] = {};
        for (const slot of SLOTS) {
          const pair = pairs.find((entry) => entry.run === run && entry.slot === slot && entry.suffix === suffix);
          const change = pair.byOffset.get(offset);
          cells[run][slot] = {
            before: change ? change.before : pair.pre[offset],
            after: change ? change.after : pair.post[offset],
            changed: Boolean(change),
            checksum: Boolean(change?.checksum),
            copy_rank: pair.copy_rank,
          };
        }
      }
      const classification = classifyOffset(
        offset,
        suffix,
        cells,
        dataset.typed_deltas,
        regions,
        pairs,
      );
      offsetClasses.push({ suffix, offset, classification });
      for (const run of RUNS) {
        for (const slot of ALL_SLOTS) {
          const pair = pairs.find((entry) => entry.run === run && entry.slot === slot && entry.suffix === suffix);
          const change = pair.byOffset.get(offset);
          if (!change) continue;
          diffs.push({
            run,
            slot,
            copy_rank: pair.copy_rank,
            suffix,
            offset,
            before: change.before,
            after: change.after,
            classification,
            typed_field_region: regions?.[suffix]?.[offset] ?? regions?.[suffix]?.[String(offset)] ?? null,
          });
        }
      }
    }
  }

  const classes = new Set(offsetClasses.map((entry) => entry.classification));
  if (absolute.slot_candidate) classes.add("ABSOLUTE_SLOT_CANDIDATE");
  const unexplained = classes.has("UNEXPLAINED");
  const stableDelta = classes.has("STABLE_SLOT_CORRELATED");
  const stableAbsolute = absolute.slot_candidate;
  const orderPresent = classes.has("COPY_ORDER_CORRELATED");
  const runtimePresent = classes.has("RUNTIME_CONTROL_MATCH") || classes.has("SOURCE_OR_RUNTIME_DEPENDENT");
  const summary = offsetClasses.length === 0 && !absolute.slot_candidate
    ? "NONE"
    : [...classes].sort().join("+");

  const bankDRuntime = pairs.some((pair) => pair.slot === "D" && pair.byOffset.size > 0)
    ? "PRESENT"
    : "NONE";

  const closureReady = closureBundleReady(dataset.closure);
  const canCloseReview = closureReady
    && !unexplained
    && !stableDelta
    && !stableAbsolute
    && !orderPresent
    && !runtimePresent
    && copyEffects.run_b_copy_effect_observed === "YES"
    && absoluteStatus === "PASS";

  const partialCompleteness = copyEffects.run_b_copy_effect_observed === "NO" ? "PARTIAL" : "COMPLETE";

  const fieldWhenIncomplete = (present) => {
    if (present) return "PRESENT";
    if (!closureReady || absoluteStatus !== "PASS") return "INSUFFICIENT";
    return "NONE_OBSERVED";
  };

  if (unexplained || stableDelta || stableAbsolute) {
    return judgmentShell({
      diffs,
      offset_classes: offsetClasses,
      absolute_slot_comparison: absoluteStatus,
      absolute_slot_diffs: absolute.diffs,
      stable_slot_correlated_field: stableDelta || stableAbsolute ? "PRESENT" : fieldWhenIncomplete(false),
      copy_order_correlated_field: fieldWhenIncomplete(orderPresent),
      source_runtime_correlated: runtimePresent ? "PRESENT" : fieldWhenIncomplete(false),
      bank_d_runtime_control: bankDRuntime === "PRESENT" ? "PRESENT" : fieldWhenIncomplete(false),
      ...copyEffects,
      run_a_destinations_post_raw_equal: dataset.run_a_destinations_post_raw_equal ?? "NOT_RUN",
      run_a_destinations_post_typed_equal: dataset.run_a_destinations_post_typed_equal ?? "NOT_RUN",
      crossover_completeness: partialCompleteness,
      crossover_negative_evidence: copyEffects.run_b_copy_effect_observed === "NO" ? "INSUFFICIENT" : "SUFFICIENT",
      raw_delta_classification: summary,
      typed_delta_classification: dataset.typed_deltas,
      bank_internal_identity: stableDelta || stableAbsolute ? "CANDIDATE_PRESENT" : "UNKNOWN",
      result: "STOP_WITH_FINDINGS",
    });
  }

  if (canCloseReview) {
    return judgmentShell({
      diffs,
      offset_classes: offsetClasses,
      absolute_slot_comparison: absoluteStatus,
      absolute_slot_diffs: absolute.diffs,
      stable_slot_correlated_field: "NONE",
      copy_order_correlated_field: orderPresent ? "PRESENT" : "NONE",
      source_runtime_correlated: runtimePresent ? "PRESENT" : "NONE",
      bank_d_runtime_control: bankDRuntime === "PRESENT" ? "PRESENT" : "NONE",
      ...copyEffects,
      run_a_destinations_post_raw_equal: dataset.run_a_destinations_post_raw_equal ?? "NOT_RUN",
      run_a_destinations_post_typed_equal: dataset.run_a_destinations_post_typed_equal ?? "NOT_RUN",
      crossover_completeness: "COMPLETE",
      crossover_negative_evidence: "SUFFICIENT",
      bank_internal_identity: "NO_INTERNAL_IDENTITY_OBSERVED",
      internal_id_rewrite_required_by_evidence: "NO",
      readiness_gap_bank_internal_identity: "CLOSE_REVIEW",
      issue_221: "CLOSE_REVIEW",
      raw_delta_classification: summary,
      typed_delta_classification: dataset.typed_deltas,
      result: "PASS",
    });
  }

  return judgmentShell({
    diffs,
    offset_classes: offsetClasses,
    absolute_slot_comparison: absoluteStatus,
    absolute_slot_diffs: absolute.diffs,
    stable_slot_correlated_field: fieldWhenIncomplete(false),
    copy_order_correlated_field: fieldWhenIncomplete(orderPresent),
    source_runtime_correlated: runtimePresent ? "PRESENT" : fieldWhenIncomplete(false),
    bank_d_runtime_control: bankDRuntime === "PRESENT" ? "PRESENT" : fieldWhenIncomplete(false),
    ...copyEffects,
    run_a_destinations_post_raw_equal: dataset.run_a_destinations_post_raw_equal ?? "NOT_RUN",
    run_a_destinations_post_typed_equal: dataset.run_a_destinations_post_typed_equal ?? "NOT_RUN",
    crossover_completeness: partialCompleteness,
    crossover_negative_evidence: copyEffects.run_b_copy_effect_observed === "NO" ? "INSUFFICIENT" : "SUFFICIENT",
    raw_delta_classification: summary,
    typed_delta_classification: dataset.typed_deltas,
    bank_internal_identity: "UNKNOWN",
    internal_id_rewrite_required_by_evidence: "UNKNOWN",
    result: "STOP_WITH_FINDINGS",
  });
}

export function classifyUntouchedBaseline({ workB, workC, workD = null, strdB, strdC, strdD = null, typedEqual }) {
  const pairs = [
    ["work", workB, workC],
    ["strd", strdB, strdC],
  ];
  if (workD && strdD) {
    pairs.push(["work", workB, workD], ["work", workC, workD], ["strd", strdB, strdD], ["strd", strdC, strdD]);
  }
  const diffs = [];
  for (const [suffix, left, right] of pairs) {
    if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) {
      return {
        untouched_slot_identity_observed: "INSUFFICIENT",
        untouched_slot_correlated_candidate: "INSUFFICIENT",
        diffs,
      };
    }
    const checksumStart = left.length - CHECKSUM_LEN;
    for (let offset = 0; offset < left.length; offset += 1) {
      if (left[offset] === right[offset]) continue;
      diffs.push({
        suffix,
        offset,
        before: left[offset],
        after: right[offset],
        classification: offset === PINNED_OFFSET
          ? "CONTENT_DEPENDENT"
          : offset >= checksumStart
            ? "CHECKSUM"
            : "UNTOUCHED_SLOT_CANDIDATE",
      });
    }
  }
  if (diffs.some((entry) => entry.classification === "UNTOUCHED_SLOT_CANDIDATE")) {
    return {
      untouched_slot_identity_observed: "RAW_DIFF",
      untouched_slot_correlated_candidate: "PRESENT",
      diffs,
    };
  }
  if (typedEqual !== true) {
    return {
      untouched_slot_identity_observed: "INSUFFICIENT",
      untouched_slot_correlated_candidate: "NONE",
      diffs,
    };
  }
  return {
    untouched_slot_identity_observed: "NO",
    untouched_slot_correlated_candidate: "NONE",
    diffs,
  };
}

export function emptyTypedDeltas() {
  return {
    A: { A: [], B: [], C: [], D: [] },
    B: { A: [], B: [], C: [], D: [] },
  };
}

export function committedCrossoverTypedDeltas() {
  return {
    A: {
      A: [],
      B: ["patterns"],
      C: ["patterns"],
      D: ["parts.unsaved", "parts_edited_bitmask"],
    },
    B: { A: [], B: [], C: [], D: [] },
  };
}

function main() {
  const [, , command, captureName] = process.argv;
  try {
    if (command === "status") {
      console.log(JSON.stringify(crossoverStatus(), null, 2));
      return;
    }
    if (command === "analyze") {
      console.log(JSON.stringify(analyzeCrossover(captureName ?? null), null, 2));
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
    "Usage: node scripts/pse-bank-identity-crossover.mjs <status|analyze|write-manifest|verify-manifest> [capture]",
  );
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
