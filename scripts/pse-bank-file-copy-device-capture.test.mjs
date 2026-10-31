#!/usr/bin/env node
import assert from "node:assert/strict";
import { realpathSync, existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ADJACENT_TRANSITIONS,
  BASE_COMPARED_REL_PATHS,
  DESTINATION_PROJECT,
  META_SCHEMA,
  OPERATION_KIND,
  PLANNED_CAPTURES,
  POWER_CYCLE_CONTROL_CAPTURE,
  SOURCE_PROJECT,
  WORK_ID,
  analyzeFileManagerCapture,
  assertOperationKind,
  buildDatasetCommand,
  buildManifest,
  evidenceStatus,
  frozenPolicyFields,
  metaTemplate,
  verifyManifest,
  writeManifest,
} from "./pse-bank-file-copy-device-capture.mjs";
import {
  LEGACY_OPERATION_KIND,
  META_SCHEMA as PATTERN_META_SCHEMA,
  OPERATION_KIND as PATTERN_OPERATION_KIND,
} from "./pse-bank-copy-state-doc-device-evidence.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SAFE_TEMP = realpathSync(tmpdir());

test("schema constants match operation classification ledger", () => {
  const ledger = JSON.parse(
    readFileSync(path.join(SCRIPT_DIR, "pse-bank-copy-operation-classification.json"), "utf8"),
  );
  assert.equal(ledger.harness_contracts.reserved_file_manager_capture_schema, META_SCHEMA);
  assert.throws(() => assertOperationKind({ operation_kind: PATTERN_OPERATION_KIND }));
  assert.throws(() => assertOperationKind({ operation_kind: LEGACY_OPERATION_KIND }));
  assert.doesNotThrow(() => assertOperationKind({ operation_kind: OPERATION_KIND }));
});

test("empty receptacle reports WAITING_FOR_OPERATOR_CAPTURE without DEVICE_CAPTURE pass", () => {
  const root = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-empty-"));
  try {
    const status = evidenceStatus(root);
    assert.equal(status.CAPTURE_STATUS, "WAITING_FOR_OPERATOR_CAPTURE");
    assert.equal(status.DEVICE_CAPTURE, "NOT_RUN");
    assert.equal(status.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
    assert.notEqual(status.RESULT, "READY_FOR_OPERATOR");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frozen policy keeps Apply and promotion blocked", () => {
  const policy = frozenPolicyFields();
  assert.equal(policy.bank_copy_apply_authorized, "NO");
  assert.equal(policy.old_capture_promotion, "BLOCKED");
  assert.equal(policy.issue_181, "OPEN");
  assert.equal(policy.issue_217, "OPEN");
  assert.equal(policy.issue_221, "OPEN");
});

function transportMeta(options = {}) {
  return {
    capture_transport: "Operator copied CF files via documented USB path",
    capture_required_mode_change: "no",
    capture_may_flush_device_state: options.mayFlush ?? "no",
    capture_flush_exclusion: options.flushExclusion
      ?? "power_cycle_control: S0 recaptured after power-off, CF removal, copy, reinsertion, and power-on matched byte-for-byte.",
  };
}

function sessionMeta(planned, options = {}) {
  return {
    capture_run_id: options.captureRunId ?? "fm-synthetic-run-1",
    continues_from_previous_stage: ["S3", "S4", "S5"].includes(planned.stage_id)
      ? (options.continuesFromPrevious ?? "yes")
      : "",
    source_ui_sentinel: options.sourceSentinel ?? "SRC-FM-SENTINEL",
    prior_destination_ui_sentinel: options.priorDestinationSentinel ?? "DST-PRIOR-SENTINEL",
    destination_ui_sentinel: planned.stage_id === "S0" || planned.stage_id === "S1"
      ? (options.priorDestinationSentinel ?? "DST-PRIOR-SENTINEL")
      : (options.destinationSentinel ?? "SRC-FM-SENTINEL"),
  };
}

function baseBuf(seed, byte = 0x10) {
  return Buffer.from([seed, byte, byte, byte, 0, 0, 0, 0]);
}

function writeSideFiles(stageDir, side, files) {
  const sideDir = path.join(stageDir, side);
  mkdirSync(sideDir, { recursive: true });
  for (const name of BASE_COMPARED_REL_PATHS) {
    writeFileSync(path.join(sideDir, name), files[name] ?? baseBuf(side === "source" ? 1 : 2, 0x20));
  }
}

function stageRank(stageId) {
  return Number(stageId.slice(1));
}

function syntheticStageFiles(planned, options = {}) {
  const rank = stageRank(planned.stage_id);
  const source = {};
  const destination = {};
  for (const name of BASE_COMPARED_REL_PATHS) {
    source[name] = baseBuf(1, name.endsWith(".work") ? 0x11 : 0x12);
    destination[name] = baseBuf(2, name.endsWith(".work") ? 0x21 : 0x22);
  }
  const copyAt = options.copyAt ?? "S2";
  if (rank >= stageRank(copyAt)) {
    destination["bank04.work"] = Buffer.from(source["bank01.work"]);
    if (options.copyStrdAt && rank >= stageRank(options.copyStrdAt)) {
      destination["bank04.strd"] = Buffer.from(source["bank01.strd"]);
    }
  }
  if (options.destProjectWorkAt && rank >= stageRank(options.destProjectWorkAt)) {
    destination["project.work"] = Buffer.from("[STATES]\nBANK=3\nPATTERN=1\n[/STATES]\n", "latin1");
  }
  if (options.destProjectStrdAt && rank >= stageRank(options.destProjectStrdAt)) {
    destination["project.strd"] = Buffer.from("[STATES]\nBANK=3\nPATTERN=2\n[/STATES]\n", "latin1");
  }
  return { source, destination };
}

function operatorFields(planned) {
  const common = {
    actual_source_filename: "bank01",
    actual_destination_filename: "bank04",
    copy_menu_path: "File Manager (operator confirmed path)",
    rename_operation: "",
    file_manager_entry_sync_observed: "",
    bank_switch_operation: "",
    save_operation: "",
    reload_operation: "",
    copy_operation: "",
    file_manager_entry_operation: "",
  };
  if (planned.stage_id === "S0" || planned.stage_id === "S4") common.save_operation = "Explicit project save";
  if (planned.stage_id === "S1") {
    common.file_manager_entry_operation = "Entered File Manager on destination project";
    common.file_manager_entry_sync_observed = "yes";
  }
  if (planned.stage_id === "S2") common.copy_operation = "File Manager COPY bank01 to destination bank04";
  if (planned.stage_id === "S3") common.bank_switch_operation = "Switched active bank away from destination";
  if (planned.stage_id === "S5") common.reload_operation = "Project reload on destination";
  return common;
}

function materializeSyntheticCapture(options = {}) {
  const root = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-synth-"));
  for (const planned of PLANNED_CAPTURES) {
    const stageDir = path.join(root, planned.name);
    mkdirSync(stageDir, { recursive: true });
    const { source, destination } = syntheticStageFiles(planned, options);
    writeSideFiles(stageDir, "source", source);
    writeSideFiles(stageDir, "destination", destination);
    const meta = {
      ...metaTemplate(planned),
      ...transportMeta(options),
      ...sessionMeta(planned, options),
      ...operatorFields(planned),
      device_generated: true,
      capture_sequence_proven: true,
      os_revision: "R0173",
      os_release: "1.40",
      capture_date: "2026-10-31",
      operator_note: "synthetic File Manager bank file copy capture",
      current_bank_ui: planned.stage_id === "S3" ? "B" : "D",
      current_pattern_ui: planned.stage_id === "S3" ? "B01" : "D01",
      ...(options.metaOverrides?.[planned.stage_id] ?? {}),
    };
    writeFileSync(path.join(stageDir, "capture.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  }
  const controlDir = path.join(root, POWER_CYCLE_CONTROL_CAPTURE);
  mkdirSync(controlDir, { recursive: true });
  const s0 = path.join(root, PLANNED_CAPTURES[0].name);
  for (const side of ["source", "destination"]) {
    mkdirSync(path.join(controlDir, side), { recursive: true });
    for (const name of BASE_COMPARED_REL_PATHS) {
      writeFileSync(
        path.join(controlDir, side, name),
        readFileSync(path.join(s0, side, name)),
      );
    }
  }
  writeFileSync(
    path.join(controlDir, "capture.meta.json"),
    `${JSON.stringify({
      ...metaTemplate(PLANNED_CAPTURES[0]),
      ...transportMeta(options),
      device_generated: true,
      capture_sequence_proven: true,
      stage_id: "S0",
      operator_note: "power cycle control",
    }, null, 2)}\n`,
  );
  for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
  writeManifest(POWER_CYCLE_CONTROL_CAPTURE, root);
  return root;
}

test("synthetic happy path is deterministic and keeps promotion blocked", () => {
  const rootA = materializeSyntheticCapture();
  const rootB = materializeSyntheticCapture();
  try {
    const analyzeA = analyzeFileManagerCapture(rootA);
    const analyzeB = analyzeFileManagerCapture(rootB);
    assert.deepEqual(
      { ...analyzeA, captures: undefined },
      { ...analyzeB, captures: undefined },
    );
    assert.equal(analyzeA.OPERATION_KIND_VALIDITY, "PASS");
    assert.equal(analyzeA.SOURCE_INTEGRITY, "PASS");
    assert.equal(analyzeA.UNTOUCHED_BANK_INVARIANCE, "PASS");
    assert.equal(analyzeA.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
    assert.equal(analyzeA.SAMPLE_AUDIO_COPY_OBSERVATION, "NOT_OBSERVED");
    assert.notEqual(analyzeA.RESULT, "DEVICE_CONFIRMED");
    const dataset = buildDatasetCommand(rootA);
    assert.ok(Array.isArray(dataset.stages));
    assert.equal(dataset.stages.length, PLANNED_CAPTURES.length);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("rejects NATIVE_BANK_COPY and pattern paste schema roots", () => {
  const root = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-reject-a-"));
  try {
    const stageDir = path.join(root, PLANNED_CAPTURES[0].name);
    mkdirSync(stageDir, { recursive: true });
    writeSideFiles(stageDir, "source", {});
    writeSideFiles(stageDir, "destination", {});
    writeFileSync(
      path.join(stageDir, "capture.meta.json"),
      `${JSON.stringify({
        schema: PATTERN_META_SCHEMA,
        operation_kind: LEGACY_OPERATION_KIND,
        synthetic_modification: false,
      })}\n`,
    );
    const status = evidenceStatus(root);
    assert.equal(status.OPERATION_KIND_VALIDITY ?? "FAIL", "FAIL");
    assert.equal(status.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("capture run id mismatch after S3 fails session continuity", () => {
  const root = materializeSyntheticCapture({
    metaOverrides: {
      S4: { capture_run_id: "other-session" },
      S5: { capture_run_id: "other-session" },
    },
  });
  try {
    const analyzed = analyzeFileManagerCapture(root);
    assert.equal(analyzed.SESSION_CONTINUITY, "NOT_PROVEN");
    assert.throws(() => buildDatasetCommand(root), /dataset export blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest hash mismatch fails verification without rewrite", () => {
  const root = materializeSyntheticCapture();
  try {
    const stage = PLANNED_CAPTURES[0].name;
    const sideFile = path.join(root, stage, "destination", "bank02.work");
    writeFileSync(sideFile, Buffer.from([9, 9, 9, 9]));
    assert.equal(verifyManifest(stage, root).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unrecorded rename when filenames differ is rejected", () => {
  const root = materializeSyntheticCapture({
    metaOverrides: {
      S2: {
        actual_source_filename: "bank01",
        actual_destination_filename: "bank02",
        rename_operation: "",
        copy_operation: "File Manager COPY bank01 then RENAME to bank02",
      },
    },
  });
  try {
    assert.throws(() => buildDatasetCommand(root), /rename_operation|blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink under stage is rejected", () => {
  const root = materializeSyntheticCapture();
  try {
    const target = path.join(root, "outside.bin");
    writeFileSync(target, Buffer.from([1]));
    const link = path.join(root, PLANNED_CAPTURES[0].name, "destination", "bank03.work");
    rmSync(link);
    symlinkSync(target, link);
    assert.throws(() => buildManifest(PLANNED_CAPTURES[0].name, root), /Symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing file manager entry metadata fails S1 provenance", () => {
  const root = materializeSyntheticCapture({
    metaOverrides: {
      S1: {
        file_manager_entry_operation: "",
        file_manager_entry_sync_observed: "",
      },
    },
  });
  try {
    const row = evidenceStatus(root).captures.find((entry) => entry.stage_id === "S1");
    assert.equal(row.capture_status, "REJECTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown transport keeps copy attribution inconclusive", () => {
  const transportUnknown = {
    capture_transport: "unknown",
    capture_required_mode_change: "unknown",
    capture_may_flush_device_state: "unknown",
    capture_flush_exclusion: "",
  };
  const root = materializeSyntheticCapture({
    metaOverrides: Object.fromEntries(
      ["S0", "S1", "S2", "S3", "S4", "S5"].map((stage_id) => [stage_id, transportUnknown]),
    ),
  });
  try {
    const analyzed = analyzeFileManagerCapture(root);
    assert.equal(analyzed.CAPTURE_TRANSPORT_CONFIDENCE, "UNKNOWN");
    assert.equal(analyzed.COPY_OPERATION_ATTRIBUTION, "INCONCLUSIVE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untouched destination banks changing fails invariance", () => {
  const root = materializeSyntheticCapture();
  try {
    const s2Dir = path.join(root, PLANNED_CAPTURES[2].name, "destination");
    const file = path.join(s2Dir, "bank02.work");
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from([0xff])]));
    writeManifest(PLANNED_CAPTURES[2].name, root);
    const analyzed = analyzeFileManagerCapture(root);
    assert.equal(analyzed.UNTOUCHED_BANK_INVARIANCE, "FAIL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adjacent transitions cover S0 through S5", () => {
  assert.equal(ADJACENT_TRANSITIONS.length, 5);
  assert.equal(PLANNED_CAPTURES.length, 6);
  assert.equal(SOURCE_PROJECT, "P_FM_SRC");
  assert.equal(DESTINATION_PROJECT, "P_FM_DST");
  assert.equal(WORK_ID, "MO-PSE-BANK-FILE-COPY-DEVICE-CAPTURE-1");
});

test("write-manifest refuses repository roots", () => {
  const repoRoot = path.resolve(SCRIPT_DIR, "..");
  assert.throws(
    () => writeManifest(PLANNED_CAPTURES[0].name, repoRoot),
    /refuses repository capture roots/,
  );
});

test("AppleDouble file in stage side fails closed", () => {
  const root = materializeSyntheticCapture();
  try {
    writeFileSync(path.join(root, PLANNED_CAPTURES[0].name, "source", "._bank01.work"), Buffer.from([0]));
    assert.throws(() => buildManifest(PLANNED_CAPTURES[0].name, root), /Unexpected metadata file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("meta template uses UNKNOWN manual citation without quote", () => {
  const template = metaTemplate(PLANNED_CAPTURES[0]);
  assert.equal(template.manual_citation.status, "UNKNOWN");
  assert.equal(template.manual_citation.quote, null);
  assert.equal(template.source_project, "P_FM_SRC");
});

function snapshotTree(dir) {
  const rows = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        rows.push(`${full} -> symlink`);
        continue;
      }
      if (st.isDirectory()) walk(full);
      else rows.push(`${full}:${st.size}:${readFileSync(full).toString("hex")}`);
    }
  };
  walk(dir);
  return rows.sort();
}

test("write-manifest rejects a symlink capture root without touching the target", () => {
  const real = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-real-"));
  const linkParent = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-link-"));
  const link = path.join(linkParent, "root");
  writeFileSync(path.join(real, "marker"), "stay");
  symlinkSync(real, link);
  const before = snapshotTree(real);
  try {
    assert.throws(() => writeManifest(PLANNED_CAPTURES[0].name, link), /symlink/);
    assert.deepEqual(snapshotTree(real), before);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(linkParent, { recursive: true, force: true });
  }
});

test("write-manifest rejects a symlink parent without creating the capture root", () => {
  const realParent = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-parent-real-"));
  const outside = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-parent-out-"));
  const link = path.join(outside, "parent");
  symlinkSync(realParent, link);
  const capture = path.join(link, "capture");
  const before = snapshotTree(realParent);
  try {
    assert.throws(() => writeManifest(PLANNED_CAPTURES[0].name, capture), /symlink/);
    assert.deepEqual(snapshotTree(realParent), before);
    assert.equal(existsSync(path.join(realParent, "capture")), false);
  } finally {
    rmSync(realParent, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("write-manifest does not create a missing repository capture root", () => {
  const missing = path.join(SCRIPT_DIR, "..", "pse-fm-missing-root-not-created");
  assert.equal(existsSync(missing), false);
  assert.throws(() => writeManifest(PLANNED_CAPTURES[0].name, missing), /repository/);
  assert.equal(existsSync(missing), false);
});

test("write-manifest accepts an existing regular root outside the repository", () => {
  const root = materializeSyntheticCapture();
  try {
    const manifest = writeManifest(PLANNED_CAPTURES[0].name, root);
    assert.ok(manifest.files.length > 0);
    const sums = path.join(root, PLANNED_CAPTURES[0].name, "SHA256SUMS.json");
    assert.equal(lstatSync(sums).isSymbolicLink(), false);
    assert.equal(verifyManifest(PLANNED_CAPTURES[0].name, root).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write-manifest refuses a symlinked SHA256SUMS.json and leaves the target unchanged", () => {
  const root = materializeSyntheticCapture();
  const externalDir = mkdtempSync(path.join(SAFE_TEMP, "pse-fm-sums-"));
  const external = path.join(externalDir, "SHA256SUMS.json");
  writeFileSync(external, "original-manifest\n");
  const sums = path.join(root, PLANNED_CAPTURES[0].name, "SHA256SUMS.json");
  try {
    rmSync(sums);
    symlinkSync(external, sums);
    assert.throws(() => writeManifest(PLANNED_CAPTURES[0].name, root), /symlink|non-regular/);
    assert.equal(readFileSync(external, "utf8"), "original-manifest\n");
    assert.equal(lstatSync(sums).isSymbolicLink(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  }
});

function patchStageMeta(root, patch) {
  for (const planned of PLANNED_CAPTURES) {
    const metaPath = path.join(root, planned.name, "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    patch(meta, planned);
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
}

function assertRejectedEverywhere(root) {
  const status = evidenceStatus(root);
  const analyzed = analyzeFileManagerCapture(root);
  assert.equal(analyzed.DEVICE_CAPTURE, status.DEVICE_CAPTURE);
  assert.equal(analyzed.RESULT, status.RESULT);
  assert.notEqual(analyzed.DEVICE_CAPTURE, "PASS");
  assert.notEqual(analyzed.RESULT, "READY_FOR_OPERATOR");
  assert.equal(analyzed.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
  assert.equal(status.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
  assert.throws(() => buildDatasetCommand(root));
}

test("manifest-valid captures with failed provenance are not accepted", () => {
  const cases = [
    (meta) => { meta.device_generated = false; },
    (meta) => { meta.capture_sequence_proven = false; },
    (meta) => { meta.os_release = "invalid"; },
    (meta, planned) => {
      if (planned.stage_id === "S4" || planned.stage_id === "S5") meta.capture_run_id = "other-run";
    },
    (meta) => { meta.operation_kind = "NATIVE_BANK_COPY"; },
  ];
  for (const patch of cases) {
    const root = materializeSyntheticCapture();
    try {
      patchStageMeta(root, patch);
      assertRejectedEverywhere(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("destination project document changes stay out of untouched-bank integrity", () => {
  const entry = materializeSyntheticCapture({ destProjectWorkAt: "S1" });
  const save = materializeSyntheticCapture({ destProjectStrdAt: "S4" });
  try {
    const entryStatus = evidenceStatus(entry);
    assert.equal(entryStatus.PROJECT_STATE_EFFECT, "BYTE_CHANGED");
    assert.equal(entryStatus.DESTINATION_INTEGRITY, "PASS");
    assert.equal(entryStatus.UNTOUCHED_BANK_INVARIANCE, "PASS");
    assert.equal(entryStatus.FILE_MANAGER_ENTRY_SYNC, "OBSERVED");
    assert.doesNotThrow(() => buildDatasetCommand(entry));

    const saveStatus = evidenceStatus(save);
    assert.equal(saveStatus.PROJECT_STATE_EFFECT, "BYTE_CHANGED");
    assert.equal(saveStatus.DESTINATION_INTEGRITY, "PASS");
    assert.equal(saveStatus.UNTOUCHED_BANK_INVARIANCE, "PASS");
    assert.doesNotThrow(() => buildDatasetCommand(save));
  } finally {
    rmSync(entry, { recursive: true, force: true });
    rmSync(save, { recursive: true, force: true });
  }
});

test("missing destination project document and stale manifest are rejected", () => {
  const missing = materializeSyntheticCapture();
  const stale = materializeSyntheticCapture();
  try {
    rmSync(path.join(missing, PLANNED_CAPTURES[0].name, "destination", "project.work"));
    const missingStatus = evidenceStatus(missing);
    assert.notEqual(missingStatus.DEVICE_CAPTURE, "PASS");
    assert.throws(() => buildDatasetCommand(missing));

    const staleFile = path.join(stale, PLANNED_CAPTURES[1].name, "destination", "project.strd");
    writeFileSync(staleFile, Buffer.from("stale"));
    assert.equal(verifyManifest(PLANNED_CAPTURES[1].name, stale).ok, false);
    assert.throws(() => buildDatasetCommand(stale));
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(stale, { recursive: true, force: true });
  }
});

test("bank05 changed only at S2 fails untouched invariance", () => {
  const root = materializeSyntheticCapture();
  try {
    const original = Buffer.from("bank05-stable");
    const changed = Buffer.from("bank05-changed");
    for (const planned of [...PLANNED_CAPTURES, { name: POWER_CYCLE_CONTROL_CAPTURE }]) {
      for (const side of ["source", "destination"]) {
        const dir = path.join(root, planned.name, side);
        writeFileSync(path.join(dir, "bank05.work"), original);
        writeFileSync(path.join(dir, "bank05.strd"), original);
      }
      writeManifest(planned.name, root);
    }
    const s2 = path.join(root, PLANNED_CAPTURES[2].name, "destination");
    writeFileSync(path.join(s2, "bank05.work"), changed);
    writeFileSync(path.join(s2, "bank05.strd"), changed);
    writeManifest(PLANNED_CAPTURES[2].name, root);
    const status = evidenceStatus(root);
    assert.equal(status.UNTOUCHED_BANK_INVARIANCE, "FAIL");
    assert.notEqual(status.DEVICE_CAPTURE, "PASS");
    assert.throws(() => buildDatasetCommand(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recorded S2 sample observations are forwarded and promotion stays blocked", () => {
  const root = materializeSyntheticCapture({
    metaOverrides: {
      S2: {
        sample_slot_reference_observation: "SLOTS_MATCH_SOURCE",
        sample_audio_copy_observation: "AUDIO_FILES_ABSENT",
      },
    },
  });
  try {
    const status = evidenceStatus(root);
    const analyzed = analyzeFileManagerCapture(root);
    const dataset = buildDatasetCommand(root);
    assert.equal(status.SAMPLE_SLOT_REFERENCE_OBSERVATION, "SLOTS_MATCH_SOURCE");
    assert.equal(status.SAMPLE_AUDIO_COPY_OBSERVATION, "AUDIO_FILES_ABSENT");
    assert.equal(analyzed.SAMPLE_SLOT_REFERENCE_OBSERVATION, "SLOTS_MATCH_SOURCE");
    assert.equal(dataset.judgment.SAMPLE_AUDIO_COPY_OBSERVATION, "AUDIO_FILES_ABSENT");
    assert.equal(status.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
    assert.equal(analyzed.DEVICE_EVIDENCE_PROMOTION, "BLOCKED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
