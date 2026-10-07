import assert from "node:assert/strict";
import {
  lstatSync,
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
import { sameContentDifferentSlotDeviceEvidence } from "./pse-bank-internal-identity-audit.mjs";
import {
  FIXTURE_ROOT,
  PINNED_OFFSET,
  REQUIRED_CAPTURES,
  captureStatus,
  classifyRawDiffs,
  inspectCapture,
  judgmentFromDeclaredSameContent,
  parseStatesSection,
  bankRawForUi,
  projectStatesTemplate,
  resolveCaptureDir,
  verifyManifest,
  writeManifest,
} from "./pse-bank-identity-device.mjs";

function metaFor(planned, extra = {}) {
  return {
    schema: "masterocta.pse-bank-identity-capture:v1",
    capture_id: planned.capture_id,
    capture_label: planned.name,
    device: "Octatrack MkII",
    os_version: "",
    project_name: "P_BANK_ID",
    current_bank_ui: planned.current_bank_ui,
    source_bank_ui: planned.source_bank_ui,
    destination_bank_ui: planned.destination_bank_ui,
    copy_operation: "",
    save_operation: "",
    content_edited_after_copy: false,
    same_content_different_slot_evidence: false,
    capture_date: "",
    device_generated: false,
    synthetic_modification: false,
    operator_note: "",
    ...extra,
  };
}

function scaffold(root, captures = REQUIRED_CAPTURES) {
  for (const planned of captures) {
    const dir = path.join(root, planned.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "capture.meta.json"),
      `${JSON.stringify(metaFor(planned), null, 2)}\n`,
      "utf8",
    );
  }
}

function writeEvidenceFiles(root, planned) {
  const projectBody = projectStatesTemplate(bankRawForUi(planned.current_bank_ui));
  for (const name of planned.files) {
    const body = name.startsWith("project.") ? projectBody : `FILE ${name}\n`;
    writeFileSync(path.join(root, planned.name, name), body, "utf8");
  }
}

test("committed P_BANK_ID captures stay short of a proven identity", () => {
  const status = captureStatus(FIXTURE_ROOT);
  assert.equal(status.capture_status, "READY_FOR_REVIEW");
  assert.equal(status.same_content_different_slot_device_evidence, "DECLARED");
  assert.equal(status.bank_internal_identity, "UNKNOWN");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(status.bank_changeplan_readiness, "NOT_READY");
  assert.equal(status.domain_changed, false);
  assert.equal(sameContentDifferentSlotDeviceEvidence(), "ABSENT");
  for (const planned of [...REQUIRED_CAPTURES, { name: "bank_abc_slot_c" }]) {
    const verified = verifyManifest(planned.name, FIXTURE_ROOT);
    assert.equal(verified.ok, true, planned.name);
  }
});

test("resolveCaptureDir rejects path traversal", () => {
  assert.throws(() => resolveCaptureDir("../outside"), /Invalid capture name/);
});

test("parseStatesSection reads BANK from the single STATES block", () => {
  assert.equal(parseStatesSection(projectStatesTemplate(0)).bank, 0);
  assert.equal(parseStatesSection(projectStatesTemplate(3)).bank, 3);
  assert.equal(parseStatesSection("[STATES]\nBANK=0\nBANK=1\n[/STATES]\n").bank, "UNKNOWN");
});

test("a symlinked capture directory is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-capdir-"));
  const outside = path.join(root, "outside_dir");
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, "bank_ab_current_a"));
  assert.throws(
    () => resolveCaptureDir("bank_ab_current_a", root),
    /Symlink not allowed for capture directory/,
  );
});

test("project.work BANK must match declared current_bank_ui", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-bankstate-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  writeEvidenceFiles(root, planned);
  writeFileSync(
    path.join(root, planned.name, "project.work"),
    projectStatesTemplate(1),
    "utf8",
  );
  writeFileSync(
    path.join(root, planned.name, "project.strd"),
    projectStatesTemplate(1),
    "utf8",
  );
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(metaFor(planned, {
      device_generated: true,
      same_content_different_slot_evidence: true,
      os_version: "1.40 (R0173)",
      copy_operation: "Bank copy",
      save_operation: "Project save",
      capture_date: "2026-10-07",
    })),
    "utf8",
  );
  assert.throws(
    () => inspectCapture(planned.name, root),
    /BANK does not match declared current_bank_ui/,
  );
  assert.equal(captureStatus(root).captures[0].capture_status, "REJECTED");
});

test("committed manifests hash every audited bank file", () => {
  for (const planned of REQUIRED_CAPTURES) {
    const verified = verifyManifest(planned.name, FIXTURE_ROOT);
    assert.equal(verified.ok, true, planned.name);
    for (const name of ["bank03.work", "bank03.strd"]) {
      assert.ok(
        verified.fresh_files.some((entry) => entry.path === name),
        `${planned.name} missing ${name}`,
      );
    }
  }
  const captureA = verifyManifest("bank_ab_current_a", FIXTURE_ROOT);
  assert.ok(captureA.fresh_files.some((entry) => entry.path === "bank04.work"));
});

test("a declared capture without files is rejected rather than ready", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-missing-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(metaFor(planned, {
      device_generated: true,
      same_content_different_slot_evidence: true,
      os_version: "1.40 (R0173)",
      copy_operation: "operator note: menu label not transcribed",
      save_operation: "operator note: menu label not transcribed",
      capture_date: "2026-10-07",
    })),
    "utf8",
  );
  const status = captureStatus(root);
  assert.equal(status.captures[0].capture_status, "REJECTED");
  assert.equal(status.bank_internal_identity, "UNKNOWN");
  assert.notEqual(status.capture_status, "READY_FOR_REVIEW");
});

test("synthetic modification is not evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-synth-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(metaFor(planned, { synthetic_modification: true, device_generated: true })),
    "utf8",
  );
  assert.throws(() => inspectCapture(planned.name, root), /synthetic_modification/);
  assert.equal(captureStatus(root).captures[0].capture_status, "REJECTED");
});

test("a symlink bank file is rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-link-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  const outside = path.join(root, "outside.work");
  writeFileSync(outside, "OUTSIDE", "utf8");
  writeEvidenceFiles(root, planned);
  unlinkSync(path.join(root, planned.name, "bank01.work"));
  symlinkSync(outside, path.join(root, planned.name, "bank01.work"));
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(metaFor(planned, {
      device_generated: true,
      same_content_different_slot_evidence: true,
      os_version: "1.40 (R0173)",
      copy_operation: "Bank copy",
      save_operation: "Project save",
      capture_date: "2026-10-07",
    })),
    "utf8",
  );
  assert.throws(() => inspectCapture(planned.name, root), /Symlink not allowed/);
  assert.equal(readFileSync(outside, "utf8"), "OUTSIDE");
});

test("content edited after the copy is not same-content evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-edit-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  writeEvidenceFiles(root, planned);
  writeFileSync(
    path.join(root, planned.name, "capture.meta.json"),
    JSON.stringify(metaFor(planned, {
      device_generated: true,
      same_content_different_slot_evidence: true,
      content_edited_after_copy: true,
      os_version: "1.40 (R0173)",
      copy_operation: "Bank copy",
      save_operation: "Project save",
      capture_date: "2026-10-07",
    })),
    "utf8",
  );
  assert.equal(captureStatus(root).captures[0].capture_status, "REJECTED");
});

test("present captures stay unknown until typed equality is proven", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-ready-"));
  scaffold(root);
  for (const planned of REQUIRED_CAPTURES) {
    writeEvidenceFiles(root, planned);
    writeFileSync(
      path.join(root, planned.name, "capture.meta.json"),
      JSON.stringify(metaFor(planned, {
        device_generated: true,
        same_content_different_slot_evidence: true,
        os_version: "1.40 (R0173)",
        copy_operation: "operator note: exact menu label pending",
        save_operation: "operator note: exact menu label pending",
        capture_date: "2026-10-07",
      })),
      "utf8",
    );
  }
  const status = captureStatus(root);
  assert.equal(status.capture_status, "READY_FOR_REVIEW");
  assert.equal(status.same_content_different_slot_device_evidence, "DECLARED");
  assert.equal(status.bank_internal_identity, "UNKNOWN");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  const before = readFileSync(path.join(root, REQUIRED_CAPTURES[0].name, "bank01.work"));
  const manifest = writeManifest(REQUIRED_CAPTURES[0].name, root);
  assert.deepEqual(readFileSync(path.join(root, REQUIRED_CAPTURES[0].name, "bank01.work")), before);
  assert.equal(verifyManifest(REQUIRED_CAPTURES[0].name, root).ok, true);
  writeFileSync(path.join(root, REQUIRED_CAPTURES[0].name, "bank02.work"), "CHANGED\n", "utf8");
  assert.equal(verifyManifest(REQUIRED_CAPTURES[0].name, root).ok, false);
  assert.ok(manifest.files.some((entry) => entry.path === "bank01.work"));
});

test("write-manifest refuses a symlinked sidecar and a missing bank", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-bank-id-sidecar-"));
  scaffold(root);
  const planned = REQUIRED_CAPTURES[0];
  assert.throws(() => writeManifest(planned.name, root), /project\.work/);
  writeEvidenceFiles(root, planned);
  const outside = path.join(root, "outside.json");
  writeFileSync(outside, "KEEP\n", "utf8");
  symlinkSync(outside, path.join(root, planned.name, "SHA256SUMS.json"));
  assert.throws(() => writeManifest(planned.name, root), /Refusing non-regular manifest destination/);
  assert.equal(readFileSync(outside, "utf8"), "KEEP\n");
  assert.equal(lstatSync(path.join(root, planned.name, "SHA256SUMS.json")).isSymbolicLink(), true);
});

test("pinned offset diffs are not proven identity without typed coverage", () => {
  const left = Buffer.alloc(PINNED_OFFSET + 3, 0);
  const right = Buffer.from(left);
  right[0] = 1;
  right[PINNED_OFFSET] = 64;
  right[right.length - 1] = 9;
  const diff = classifyRawDiffs(left, right);
  assert.deepEqual(
    diff.diffs.map((entry) => entry.classification),
    ["HEADER", "PINNED_OFFSET", "CHECKSUM"],
  );
  const untyped = judgmentFromDeclaredSameContent("DIFFERENT", false);
  assert.equal(untyped.bank_internal_identity, "UNKNOWN");
  assert.equal(untyped.offset_585459_classification, "UNKNOWN");
  assert.equal(untyped.readiness_gap_bank_internal_identity, "OPEN");
  const strengthened = judgmentFromDeclaredSameContent("DIFFERENT", true);
  assert.equal(strengthened.offset_585459_classification, "IDENTITY_CANDIDATE");
  assert.equal(strengthened.bank_internal_identity, "UNKNOWN");
  const matched = judgmentFromDeclaredSameContent("EQUAL", true);
  assert.equal(matched.offset_585459_classification, "CONTENT_DEPENDENT");
  assert.equal(matched.bank_internal_identity, "UNKNOWN");
});
