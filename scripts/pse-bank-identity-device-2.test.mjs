import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FIXTURE_ROOT,
  PLANNED_CAPTURE,
  analyzeCapture,
  captureStatus,
  resolveCaptureDir,
} from "./pse-bank-identity-device-2.mjs";
import { projectStatesTemplate, bankRawForUi } from "./pse-bank-identity-device.mjs";

test("P_BANK_ID2 receptacle waits for device capture", () => {
  const status = captureStatus(FIXTURE_ROOT);
  assert.equal(status.device_capture, "NOT_RUN");
  assert.equal(status.typed_content_equal_a_b_c, "NOT_RUN");
  assert.equal(status.offset_585459_classification, "CONTENT_DEPENDENT");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(status.result, "STOP_FOR_DEVICE");
  const analyzed = analyzeCapture(PLANNED_CAPTURE.name, FIXTURE_ROOT);
  assert.equal(analyzed.raw_diff_class, "NOT_RUN");
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
