import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FIXTURE_ROOT,
  PLANNED_CAPTURE,
  analyzeCapture,
  captureStatus,
  deriveRawDiffClass,
  manifestVerified,
  resolveCaptureDir,
  verifyManifest,
  writeManifest,
} from "./pse-bank-identity-device-2.mjs";
import { classifyRawDiffs } from "./pse-bank-identity-device.mjs";
import { projectStatesTemplate, bankRawForUi } from "./pse-bank-identity-device.mjs";

test("committed P_BANK_ID2 capture requires manifest and defers typed equality to Rust", () => {
  const status = captureStatus(FIXTURE_ROOT);
  assert.equal(status.device_capture, "PASS");
  assert.equal(status.capture.manifest_verified, true);
  assert.equal(status.typed_content_equal_a_b_c, "PENDING_RUST");
  assert.equal(status.same_content_different_slot_device_evidence, "PENDING_RUST");
  assert.equal(status.offset_585459_classification, "CONTENT_DEPENDENT");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(manifestVerified(PLANNED_CAPTURE.name, FIXTURE_ROOT).ok, true);
  const analyzed = analyzeCapture(PLANNED_CAPTURE.name, FIXTURE_ROOT);
  assert.notEqual(analyzed.raw_diff_class, "NOT_RUN");
  assert.notEqual(analyzed.raw_diff_class, "checksum_only_pending_typed");
});

test("symlinked capture directory is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-capdir-"));
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, PLANNED_CAPTURE.name));
  assert.throws(
    () => resolveCaptureDir(PLANNED_CAPTURE.name, root),
    /Symlink not allowed for capture directory/,
  );
});

test("device capture requires BANK D in project.work", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-bankd-"));
  const dir = path.join(root, PLANNED_CAPTURE.name);
  mkdirSync(dir, { recursive: true });
  const meta = {
    schema: "masterocta.pse-bank-identity-device-2-capture:v1",
    capture_id: "1",
    capture_label: PLANNED_CAPTURE.name,
    device: "Octatrack MkII",
    project_name: "P_BANK_ID2",
    current_bank_ui: "D",
    source_bank_ui: "A",
    copied_to: ["B", "C"],
    comparison_banks: ["A", "B", "C"],
    same_content_different_slot_evidence: true,
    content_edited_after_copy: false,
    project_reloaded_after_copy: true,
    part_saved_before_copy: true,
    device_generated: true,
    synthetic_modification: false,
    os_version: "1.40 (R0173)",
    copy_operation: "operator note",
    save_operation: "operator note",
    capture_date: "2026-10-07",
    operator_note: "",
  };
  writeFileSync(path.join(dir, "capture.meta.json"), JSON.stringify(meta), "utf8");
  writeFileSync(
    path.join(dir, "project.work"),
    projectStatesTemplate(bankRawForUi("A")),
    "utf8",
  );
  for (const name of PLANNED_CAPTURE.files) {
    if (name.startsWith("project.")) continue;
    writeFileSync(path.join(dir, name), `stub ${name}\n`, "utf8");
  }
  assert.equal(captureStatus(root).capture.capture_status, "REJECTED");
});

test("missing manifest rejects a device-generated capture", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-noman-"));
  copyFixtureTree(root);
  assert.equal(captureStatus(root).device_capture, "REJECTED");
});

test("stale manifest rejects a device-generated capture", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-stale-"));
  copyFixtureTree(root);
  writeManifest(PLANNED_CAPTURE.name, root);
  writeFileSync(
    path.join(root, PLANNED_CAPTURE.name, "bank01.work"),
    readFileSync(path.join(root, PLANNED_CAPTURE.name, "bank01.work")).slice(0, -1),
  );
  assert.equal(captureStatus(root).device_capture, "REJECTED");
});

test("modified bank bytes with valid manifest still reject promotion", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-mod-"));
  copyFixtureTree(root);
  writeManifest(PLANNED_CAPTURE.name, root);
  writeFileSync(path.join(root, PLANNED_CAPTURE.name, "bank02.work"), Buffer.alloc(636_113, 7));
  assert.equal(captureStatus(root).device_capture, "REJECTED");
  assert.equal(verifyManifest(PLANNED_CAPTURE.name, root).ok, false);
});

test("symlink manifest rejects promotion", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id2-symlink-"));
  copyFixtureTree(root);
  const outside = path.join(root, "outside-manifest.json");
  writeFileSync(outside, "{}\n", "utf8");
  const sidecar = path.join(root, PLANNED_CAPTURE.name, "SHA256SUMS.json");
  try {
    unlinkSync(sidecar);
  } catch {
    // ignore
  }
  symlinkSync(outside, sidecar);
  assert.equal(captureStatus(root).device_capture, "REJECTED");
});

test("unequal bank lengths are not treated as checksum-only", () => {
  const left = Buffer.alloc(10, 1);
  const right = Buffer.alloc(8, 1);
  const pairwise = [{ left: 1, right: 2, suffix: "work", ...classifyRawDiffs(left, right) }];
  assert.equal(deriveRawDiffClass(pairwise, []), "LENGTH_MISMATCH");
});

test("analyzeCapture rejects unplanned capture names", () => {
  assert.throws(
    () => analyzeCapture("other", FIXTURE_ROOT),
    /Not a planned capture/,
  );
});

function copyFixtureTree(root) {
  const src = path.join(FIXTURE_ROOT, PLANNED_CAPTURE.name);
  const dest = path.join(root, PLANNED_CAPTURE.name);
  mkdirSync(dest, { recursive: true });
  for (const name of [
    "capture.meta.json",
    "project.work",
    "project.strd",
    ...PLANNED_CAPTURE.files.filter((entry) => !entry.startsWith("project.")),
  ]) {
    copyFileSync(path.join(src, name), path.join(dest, name));
  }
}
