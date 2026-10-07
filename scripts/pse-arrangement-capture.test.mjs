import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FIXTURE_ROOT,
  PLANNED_CAPTURES,
  buildManifest,
  captureStatus,
  classifyArrangementRule,
  inspectCapture,
  parseStatesSection,
  resolveCaptureDir,
  verifyManifest,
  writeManifest,
} from "./pse-arrangement-capture.mjs";

const STATES = (arrangement, mode = 0) => `############################
# Project States
############################

[STATES]
BANK=0
PATTERN=0
ARRANGEMENT=${arrangement}
ARRANGEMENT_MODE=${mode}
PART=0
[/STATES]
`;

function scaffold(root) {
  for (const planned of PLANNED_CAPTURES) {
    const dir = path.join(root, planned.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "capture.meta.json"),
      `${JSON.stringify({
        schema: "masterocta.pse-arrangement-capture:v1",
        capture_id: planned.capture_id,
        capture_label: planned.name,
        device: "Octatrack MkII",
        os_version: "",
        project_name: "P_ARR_TEST",
        selected_arrangement_ui: planned.ui,
        expected_arrangement_index: planned.index,
        save_actions: [],
        capture_date: "",
        device_generated: false,
        synthetic_modification: false,
      }, null, 2)}\n`,
      "utf8",
    );
  }
}

function readyMeta(planned, extra = {}) {
  return {
    schema: "masterocta.pse-arrangement-capture:v1",
    capture_id: planned.capture_id,
    capture_label: planned.name,
    device: "Octatrack MkII",
    os_version: "1.40",
    project_name: "P_ARR_TEST",
    selected_arrangement_ui: planned.ui,
    expected_arrangement_index: planned.index,
    save_actions: ["PROJECT SAVE"],
    capture_date: "2026-10-07",
    device_generated: true,
    synthetic_modification: false,
    ...extra,
  };
}

test("parseStatesSection reads the single STATES block", () => {
  const parsed = parseStatesSection(STATES(7, 3));
  assert.equal(parsed.arrangement, 7);
  assert.equal(parsed.arrangement_mode, 3);
});

test("parseStatesSection does not invent a missing or duplicated field", () => {
  assert.equal(parseStatesSection("[STATES]\nBANK=0\n[/STATES]\n").arrangement, "UNKNOWN");
  assert.equal(
    parseStatesSection("[STATES]\nARRANGEMENT=1\nARRANGEMENT=2\n[/STATES]\n").arrangement,
    "UNKNOWN",
  );
  assert.equal(parseStatesSection("ARRANGEMENT=4\n").arrangement, "UNKNOWN");
  assert.equal(
    parseStatesSection("[STATES]\nARRANGEMENT=256\n[/STATES]\n").arrangement,
    "UNKNOWN",
  );
});

test("resolveCaptureDir rejects path traversal", () => {
  assert.throws(() => resolveCaptureDir("../outside"), /Invalid capture name/);
  assert.throws(() => resolveCaptureDir(".."), /Invalid capture name/);
});

test("committed scaffold is waiting and is not device evidence", () => {
  const status = captureStatus(FIXTURE_ROOT);
  assert.equal(status.capture_status, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.arrangement_mapping_rule, "UNKNOWN");
  assert.equal(status.domain_changed, false);
  assert.deepEqual(
    status.captures.map((entry) => entry.capture_status),
    ["WAITING", "WAITING", "WAITING"],
  );
});

test("empty receptacle status stays waiting", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-wait-"));
  scaffold(root);
  const status = captureStatus(root);
  assert.equal(status.capture_status, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.arrangement_mapping_rule, "UNKNOWN");
});

test("synthetic modification is not evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-synth-"));
  scaffold(root);
  const planned = PLANNED_CAPTURES[0];
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(readyMeta(planned, { synthetic_modification: true })),
    "utf8",
  );
  writeFileSync(path.join(root, planned.name, "project.work"), STATES(0), "utf8");
  assert.throws(() => inspectCapture(planned.name, root), /synthetic_modification/);
  const status = captureStatus(root);
  assert.equal(status.captures[0].capture_status, "REJECTED");
});

test("a symlink project.work is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-link-"));
  scaffold(root);
  const planned = PLANNED_CAPTURES[0];
  const outside = path.join(root, "outside.work");
  writeFileSync(outside, STATES(0), "utf8");
  symlinkSync(outside, path.join(root, planned.name, "project.work"));
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(readyMeta(planned)),
    "utf8",
  );
  assert.throws(() => inspectCapture(planned.name, root), /Symlink not allowed/);
});

test("expected index that disagrees with the UI label is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-index-"));
  scaffold(root);
  const planned = PLANNED_CAPTURES[0];
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(readyMeta(planned, { expected_arrangement_index: 4 })),
    "utf8",
  );
  writeFileSync(path.join(root, planned.name, "project.work"), STATES(4), "utf8");
  assert.throws(
    () => inspectCapture(planned.name, root),
    /expected_arrangement_index does not match the UI label/,
  );
});

test("one capture does not become a mapping rule", () => {
  assert.equal(classifyArrangementRule([{ ui: 1, raw: 0 }]), "UNKNOWN");
});

test("two consistent captures classify without writing domain state", () => {
  assert.equal(
    classifyArrangementRule([
      { ui: 1, raw: 0 },
      { ui: 2, raw: 1 },
    ]),
    "ZERO_BASED",
  );
  assert.equal(
    classifyArrangementRule([
      { ui: 1, raw: 1 },
      { ui: 8, raw: 8 },
    ]),
    "ONE_BASED",
  );
  assert.equal(
    classifyArrangementRule([
      { ui: 1, raw: 10 },
      { ui: 2, raw: 11 },
    ]),
    "OTHER",
  );
  assert.equal(
    classifyArrangementRule([
      { ui: 1, raw: 0 },
      { ui: 2, raw: 9 },
    ]),
    "UNKNOWN",
  );
});

test("write-manifest refuses a capture without project.work and writes nothing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-nowork-"));
  scaffold(root);
  assert.throws(() => writeManifest("arrangement_1", root), /project\.work/);
  assert.throws(() => readFileSync(path.join(root, "arrangement_1", "SHA256SUMS.json")));
});

test("manifest hashes stay stable across a second write", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-arr-hash-"));
  scaffold(root);
  const project = path.join(root, "arrangement_1", "project.work");
  const arr = path.join(root, "arrangement_1", "arr01.work");
  writeFileSync(project, STATES(0), "utf8");
  writeFileSync(arr, "ARR01", "utf8");
  writeFileSync(path.join(root, "arrangement_1", "._project.work"), "APPLE", "utf8");
  writeFileSync(path.join(root, "arrangement_1", ".DS_Store"), "DS", "utf8");
  const first = writeManifest("arrangement_1", root);
  const before = readFileSync(project);
  const second = writeManifest("arrangement_1", root);
  assert.deepEqual(second.files, first.files);
  assert.deepEqual(readFileSync(project), before);
  assert.deepEqual(
    first.files.map((entry) => entry.path),
    ["arr01.work", "project.work"],
  );
  const verified = verifyManifest("arrangement_1", root);
  assert.equal(verified.ok, true);
  writeFileSync(project, STATES(1), "utf8");
  assert.equal(verifyManifest("arrangement_1", root).ok, false);
});

test("buildManifest lists only arrangement evidence names", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pse-arr-manifest-"));
  writeFileSync(path.join(dir, "project.work"), "FORM", "utf8");
  writeFileSync(path.join(dir, "bank01.work"), "BANK", "utf8");
  writeFileSync(path.join(dir, "arr08.work"), "ARR", "utf8");
  const manifest = buildManifest(dir);
  assert.equal(manifest.schema, "masterocta-pse-arrangement-capture-manifest:v1");
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    ["arr08.work", "project.work"],
  );
});
