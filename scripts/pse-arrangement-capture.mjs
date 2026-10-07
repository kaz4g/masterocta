#!/usr/bin/env node
/**
 * Read-only receptacle check for pse_arrangement_device.
 *
 * status / inspect / verify-manifest do not write.
 * write-manifest writes SHA256SUMS.json only, and only when project.work
 * is a regular file. It never rewrites project.work or arrNN bytes.
 * This script does not assign an arrangement slot in domain code.
 */
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const META_SCHEMA = "masterocta.pse-arrangement-capture:v1";
export const MANIFEST_SCHEMA = "masterocta-pse-arrangement-capture-manifest:v1";
const PROJECT_WORK_CAP_BYTES = 1024 * 1024;
const CAPTURE_NAME = /^[a-z0-9_]+$/;

export const FIXTURE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_arrangement_device",
);

/** UI number is the operator fact. Index is that UI choice minus one, fixed before parsing. */
export const PLANNED_CAPTURES = [
  { name: "arrangement_1", capture_id: "A", ui: 1, index: 0 },
  { name: "arrangement_2", capture_id: "B", ui: 2, index: 1 },
  { name: "arrangement_8", capture_id: "C", ui: 8, index: 7 },
];

const TRACKED = new Set([
  "project.work",
  "project.strd",
  ...Array.from({ length: 8 }, (_, slot) => {
    const nn = String(slot + 1).padStart(2, "0");
    return [`arr${nn}.work`, `arr${nn}.strd`];
  }).flat(),
]);

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

export function parseStatesSection(text) {
  const lines = text.split(/\n/).map((line) => line.replace(/\r$/, ""));
  const starts = [];
  lines.forEach((line, index) => {
    if (line.trim() === "[STATES]") starts.push(index);
  });
  if (starts.length !== 1) {
    return { arrangement: "UNKNOWN", arrangement_mode: "UNKNOWN" };
  }
  const arrangement = [];
  const arrangementMode = [];
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "[/STATES]") break;
    const arrangementMatch = line.match(/^ARRANGEMENT=([0-9]+)$/);
    const modeMatch = line.match(/^ARRANGEMENT_MODE=([0-9]+)$/);
    if (arrangementMatch) arrangement.push(Number(arrangementMatch[1]));
    if (modeMatch) arrangementMode.push(Number(modeMatch[1]));
  }
  return {
    arrangement: oneByte(arrangement),
    arrangement_mode: oneByte(arrangementMode),
  };
}

function oneByte(values) {
  if (values.length !== 1) return "UNKNOWN";
  const value = values[0];
  if (!Number.isInteger(value) || value < 0 || value > 255) return "UNKNOWN";
  return value;
}

function readMeta(captureDir) {
  const metaPath = path.join(captureDir, "capture.meta.json");
  const st = assertRegularFile(metaPath, "capture.meta.json");
  if (!st) throw new Error("capture.meta.json is missing");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.synthetic_modification !== false) {
    throw new Error("synthetic_modification capture is not evidence");
  }
  return meta;
}

function provenanceReady(meta, planned) {
  if (meta.device_generated !== true) return false;
  if (meta.schema !== META_SCHEMA) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.capture_label !== planned.name || meta.capture_id !== planned.capture_id) {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.device !== "Octatrack MkII" || meta.project_name !== "P_ARR_TEST") {
    throw new Error("capture provenance is incomplete");
  }
  if (meta.selected_arrangement_ui !== planned.ui || meta.expected_arrangement_index !== planned.index) {
    throw new Error("expected_arrangement_index does not match the UI label");
  }
  if (typeof meta.os_version !== "string" || meta.os_version.trim() === "") {
    throw new Error("capture provenance is incomplete");
  }
  if (typeof meta.capture_date !== "string" || meta.capture_date.trim() === "") {
    throw new Error("capture provenance is incomplete");
  }
  if (!Array.isArray(meta.save_actions) || meta.save_actions.length === 0) {
    throw new Error("capture provenance is incomplete");
  }
  if (!meta.save_actions.every((action) => typeof action === "string" && action.trim() !== "")) {
    throw new Error("capture provenance is incomplete");
  }
  return true;
}

function listEvidenceFiles(captureDir) {
  let names;
  try {
    names = readdirSync(captureDir);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return names.filter((name) => TRACKED.has(name)).sort();
}

export function buildManifest(captureDir) {
  const files = listEvidenceFiles(captureDir);
  const entries = files.map((name) => {
    const full = path.join(captureDir, name);
    const st = assertRegularFile(full, name);
    if (!st) throw new Error(`Tracked name disappeared: ${name}`);
    return {
      path: name,
      sha256: sha256File(full),
      size: st.size,
    };
  });
  return {
    schema: MANIFEST_SCHEMA,
    capture: path.basename(captureDir),
    files: entries,
  };
}

function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function inspectCapture(captureName, root = FIXTURE_ROOT) {
  const planned = PLANNED_CAPTURES.find((entry) => entry.name === captureName);
  if (!planned) throw new Error(`Not a planned capture: ${captureName}`);
  const captureDir = resolveCaptureDir(captureName, root);
  const meta = readMeta(captureDir);
  if (!provenanceReady(meta, planned)) {
    return {
      capture_label: planned.name,
      capture_status: "WAITING",
      arrangement: "UNKNOWN",
      arrangement_mode: "UNKNOWN",
      evidence: false,
    };
  }
  const projectPath = path.join(captureDir, "project.work");
  const st = assertRegularFile(projectPath, "project.work");
  if (!st) throw new Error("device_generated capture is missing project.work");
  if (st.size > PROJECT_WORK_CAP_BYTES) {
    throw new Error("project.work exceeds 1 MiB");
  }
  const states = parseStatesSection(readFileSync(projectPath, "latin1"));
  const files = {};
  for (const name of TRACKED) {
    const full = path.join(captureDir, name);
    const fileStat = assertRegularFile(full, name);
    files[name] = fileStat
      ? { present: true, size: fileStat.size, sha256: sha256File(full) }
      : { present: false };
  }
  return {
    capture_label: planned.name,
    capture_status: "PRESENT",
    selected_arrangement_ui: planned.ui,
    expected_arrangement_index: planned.index,
    arrangement: states.arrangement,
    arrangement_mode: states.arrangement_mode,
    files,
    evidence: Number.isInteger(states.arrangement),
  };
}

export function classifyArrangementRule(rows) {
  const usable = rows.filter(
    (row) => Number.isInteger(row.ui) && Number.isInteger(row.raw),
  );
  if (usable.length < 2) return "UNKNOWN";
  if (usable.every((row) => row.raw === row.ui - 1)) return "ZERO_BASED";
  if (usable.every((row) => row.raw === row.ui)) return "ONE_BASED";
  const offsets = new Set(usable.map((row) => row.raw - row.ui));
  if (offsets.size === 1) return "OTHER";
  return "UNKNOWN";
}

export function captureStatus(root = FIXTURE_ROOT) {
  const captures = PLANNED_CAPTURES.map((planned) => {
    const captureDir = resolveCaptureDir(planned.name, root);
    let meta;
    try {
      meta = readMeta(captureDir);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return { capture_label: planned.name, capture_status: "MISSING" };
      }
      if (String(err.message).includes("synthetic_modification")) {
        return { capture_label: planned.name, capture_status: "REJECTED", error: err.message };
      }
      if (String(err.message).includes("Symlink")) {
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
        selected_arrangement_ui: planned.ui,
        arrangement: inspected.arrangement,
        arrangement_mode: inspected.arrangement_mode,
      };
    } catch (err) {
      return {
        capture_label: planned.name,
        capture_status: "REJECTED",
        error: err.message,
      };
    }
  });
  const present = captures.filter((entry) => entry.capture_status === "PRESENT");
  const rule = classifyArrangementRule(
    present.map((entry) => ({ ui: entry.selected_arrangement_ui, raw: entry.arrangement })),
  );
  const capture_status = present.length === 0 ? "WAITING_FOR_REAL_DEVICE" : "PARTIAL";
  return {
    capture_status: present.length === PLANNED_CAPTURES.length && rule !== "UNKNOWN"
      ? "READY_FOR_REVIEW"
      : capture_status,
    arrangement_mapping_rule: present.length >= 2 ? rule : "UNKNOWN",
    domain_changed: false,
    captures,
  };
}

export function writeManifest(captureName, root = FIXTURE_ROOT) {
  const captureDir = resolveCaptureDir(captureName, root);
  const project = assertRegularFile(path.join(captureDir, "project.work"), "project.work");
  if (!project) throw new Error("write-manifest requires a regular project.work");
  const manifest = buildManifest(captureDir);
  if (!manifest.files.some((entry) => entry.path === "project.work")) {
    throw new Error("write-manifest requires project.work");
  }
  const outPath = path.join(captureDir, "SHA256SUMS.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function verifyManifest(captureName, root = FIXTURE_ROOT) {
  const captureDir = resolveCaptureDir(captureName, root);
  const sidecar = path.join(captureDir, "SHA256SUMS.json");
  const st = assertRegularFile(sidecar, "SHA256SUMS.json");
  if (!st) throw new Error("SHA256SUMS.json is missing");
  const recorded = JSON.parse(readFileSync(sidecar, "utf8"));
  const fresh = buildManifest(captureDir);
  const recordedFiles = JSON.stringify(recorded.files ?? null);
  const freshFiles = JSON.stringify(fresh.files);
  return {
    ok: recorded.schema === MANIFEST_SCHEMA && recordedFiles === freshFiles,
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
  console.error("Usage: node scripts/pse-arrangement-capture.mjs <status|inspect|write-manifest|verify-manifest> [capture]");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
