import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PINNED_OFFSET } from "./pse-bank-identity-device.mjs";
import {
  ADJACENT_TRANSITIONS,
  FIXTURE_ROOT,
  META_SCHEMA,
  OPERATION_KIND,
  PLANNED_CAPTURES,
  REQUIRED_FILES,
  RETIRED_TRANSITIONS,
  analyzePatternPaste,
  buildManifest,
  assertPlannedCaptureName,
  classifyPatternPaste,
  metaTemplate,
  patternPasteSuccessGate,
  persistenceStatus,
  verifyManifest,
  writeManifest,
} from "./pse-pattern-paste-persistence.mjs";

test("planned stages are baseline, destination-before-paste, paste, control, save, reload", () => {
  assert.deepEqual(PLANNED_CAPTURES.map((entry) => entry.stage_semantics), [
    "BASELINE_SAVED",
    "DESTINATION_SELECT_BEFORE_PASTE",
    "PATTERN_PASTE",
    "CONTROL_SWITCH",
    "PROJECT_SAVE",
    "PROJECT_RELOAD",
  ]);
  assert.deepEqual(ADJACENT_TRANSITIONS.map((entry) => entry.label), [
    "DESTINATION_SELECT_BEFORE_PASTE",
    "PATTERN_PASTE",
    "CONTROL_SWITCH",
    "PROJECT_SAVE",
    "PROJECT_RELOAD",
  ]);
  assert.equal(ADJACENT_TRANSITIONS.some((entry) => RETIRED_TRANSITIONS.includes(entry.label)), false);
});

test("retired COPY and DESTINATION_SWITCH names are rejected", () => {
  assert.throws(() => assertPlannedCaptureName("s1_after_copy"), /Retired capture ordering/);
  assert.throws(() => assertPlannedCaptureName("s2_after_destination_switch"), /Retired capture ordering/);
  const stages = syntheticStages({ destWorkAt: "S2", destStrdAt: "S2" });
  stages[1].prior_transition = "COPY";
  const judged = classifyPatternPaste({ stages });
  assert.equal(judged.result, "STOP_WITH_FINDINGS");
  assert.match(judged.error, /Retired capture ordering/);
});

test("S2 PRESENT sentinel confirms pattern paste; absence does not", () => {
  const confirmed = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S2", destStrdAt: "S2" }) });
  assert.equal(confirmed.pattern_paste_effect_confirmed_on_device, "YES");
  assert.equal(confirmed.pattern_paste_command_effect, "CONFIRMED");
  const stages = syntheticStages({});
  stages[2].meta.destination_ui_sentinel = "ABSENT";
  const absent = classifyPatternPaste({ stages });
  assert.equal(absent.pattern_paste_command_effect, "UNCONFIRMED");
  assert.equal(absent.persistence_judgment, "NOT_RUN");
  assert.equal(absent.cross_bank_pattern_paste_persistence, "NOT_RUN");
  assert.equal(absent.result, "STOP_WITH_FINDINGS");
});

test("first destination change is labeled by the producing transition", () => {
  const paste = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S2", destStrdAt: "S2" }) });
  assert.equal(paste.dest_work_first_changed_at, "PATTERN_PASTE");
  assert.equal(paste.dest_strd_first_changed_at, "PATTERN_PASTE");
  assert.equal(paste.dest_work_changed_on_pattern_paste, "YES");
  assert.equal(paste.dest_strd_changed_on_pattern_paste, "YES");
  assert.equal(paste.cross_bank_pattern_paste_persistence, "OBSERVED_BOTH_VISIBLE_AT_PATTERN_PASTE");

  const control = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S3", destStrdAt: "S3" }) });
  assert.equal(control.dest_work_first_changed_at, "CONTROL_SWITCH");
  assert.equal(control.dest_work_changed_on_pattern_paste, "NO");
  assert.equal(control.cross_bank_pattern_paste_persistence, "OBSERVED_FLUSH_ON_LEAVING_DESTINATION_CANDIDATE");

  const save = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S4", destStrdAt: "S4" }) });
  assert.equal(save.dest_work_first_changed_at, "PROJECT_SAVE");
  assert.equal(save.cross_bank_pattern_paste_persistence, "OBSERVED_PROJECT_SAVE_PERSISTENCE_CANDIDATE");

  const reload = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S5", destStrdAt: "S5" }) });
  assert.equal(reload.dest_work_first_changed_at, "PROJECT_RELOAD");
  assert.equal(reload.pattern_paste_effect_first_observed_on_disk, "PROJECT_RELOAD");
});

test("S0 to S1 BANK change is destination select, not a copy retarget", () => {
  const judged = classifyPatternPaste({
    stages: syntheticStages({
      destWorkAt: "S2",
      destStrdAt: "S4",
      projectBankByStage: { S0: 0, S1: 1, S2: 1, S3: 3, S4: 3, S5: 3 },
    }),
  });
  assert.equal(Object.hasOwn(judged, "project_state_copy_retarget_observed"), false);
  assert.equal(judged.project_state_destination_select.bank_before, 0);
  assert.equal(judged.project_state_destination_select.bank_after, 1);
  assert.equal(judged.project_state_pattern_paste.bank_before, 1);
  assert.equal(judged.project_state_pattern_paste.bank_after, 1);
  assert.equal(judged.cross_bank_pattern_paste_persistence, "OBSERVED_WORKING_CHECKPOINT_SEPARATION");
});

test("unknown transport does not generalize checkpoint semantics", () => {
  const judged = classifyPatternPaste({ stages: syntheticStages({ destWorkAt: "S2", destStrdAt: "S2" }) });
  assert.equal(judged.copy_saved_checkpoint_semantics, "UNKNOWN");
  assert.equal(judged.issue_217, "OPEN");
  assert.equal(judged.issue_221, "OPEN");
  assert.equal(judged.bank_changeplan_readiness, "NOT_READY");
  assert.equal(judged.capture_transport_limitation, "UNKNOWN");
  assert.equal(JSON.stringify(judged).includes("CLOSE_REVIEW"), false);
  assert.equal(judged.operation_kind, OPERATION_KIND);
});

test("template fixture is not promoted and analyze does not rewrite bytes", () => {
  const before = snapshotTree(FIXTURE_ROOT);
  const status = persistenceStatus(FIXTURE_ROOT);
  const analyzed = analyzePatternPaste(FIXTURE_ROOT);
  assert.equal(status.persistence_harness, "READY");
  assert.equal(status.scope_correction, "PASS");
  assert.equal(status.copy_saved_checkpoint_semantics, "UNKNOWN");
  assert.equal(analyzed.fixture_no_write, "PASS");
  const hasBytes = MATRIX_PRESENT(FIXTURE_ROOT);
  const promoted = status.capture_sequence_proven === "YES";
  if (!promoted) {
    assert.equal(status.capture_sequence_proven, "NO");
    assert.equal(status.device_evidence_promotion, "BLOCKED");
    assert.equal(status.result, hasBytes ? "STOP_FOR_OPERATOR_CONFIRMATION" : "WAITING_FOR_REAL_DEVICE");
  } else {
    assert.equal(status.device_evidence_promotion, "ALLOWED");
    assert.equal(status.device_capture, "PASS");
    assert.equal(status.pattern_paste_effect_confirmed_on_device, "YES");
    assert.equal(status.dest_work_first_changed_at, "CONTROL_SWITCH");
    assert.equal(status.dest_strd_first_changed_at, "PROJECT_SAVE");
    assert.equal(status.dest_work_changed_on_pattern_paste, "NO");
    assert.equal(status.dest_strd_changed_on_pattern_paste, "NO");
    assert.equal(
      status.cross_bank_pattern_paste_persistence,
      "OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE",
    );
    assert.equal(status.working_checkpoint_separation_observed, "YES");
    assert.equal(status.pattern_paste_survives_project_reload, "UNKNOWN");
    assert.equal(status.capture_transport_limitation, "UNKNOWN");
    assert.equal(status.copy_saved_checkpoint_semantics, "UNKNOWN");
    assert.equal(status.issue_217, "OPEN");
    assert.equal(status.issue_221, "OPEN");
    assert.equal(status.bank_changeplan_readiness, "NOT_READY");
    assert.equal(JSON.stringify(status).includes("CLOSE_REVIEW"), false);
    assert.equal(status.project_work_active_bank_write_lag_observed, "YES");
    assert.equal(status.project_bank_selection_first_persisted_at, "DESTINATION_SELECT_BEFORE_PASTE");
    assert.equal(status.control_bank_selection_persisted_at, "PROJECT_SAVE");
    assert.deepEqual(status.project_bank_sequence, { S0: 0, S1: 1, S2: 1, S3: 1, S4: 3, S5: 3 });
    assert.deepEqual(status.project_pattern_sequence, { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 });
  }
  for (const planned of PLANNED_CAPTURES) {
    const meta = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, planned.name, "capture.meta.json"), "utf8"));
    assert.equal(meta.schema, META_SCHEMA);
    assert.equal(meta.operation_kind, OPERATION_KIND);
    assert.equal(meta.device_generated, promoted);
    assert.equal(meta.capture_sequence_proven, promoted ? true : null);
  }
  assert.equal(snapshotTree(FIXTURE_ROOT), before);
});

test("old schema is rejected once device_generated is set", () => {
  const root = materializeReadyCapture();
  try {
    const metaPath = path.join(root, "s0_baseline_saved", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.schema = "masterocta.pse-bank-copy-persistence-capture:v1";
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    const row = persistenceStatus(root).captures.find((entry) => entry.capture_label === "s0_baseline_saved");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /schema/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest becomes stale after metadata changes", () => {
  const root = materializeReadyCapture();
  try {
    writeManifest("s2_after_pattern_paste", root);
    assert.equal(verifyManifest("s2_after_pattern_paste", root).ok, true);
    const metaPath = path.join(root, "s2_after_pattern_paste", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.operator_note = "metadata changed after manifest";
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    assert.equal(verifyManifest("s2_after_pattern_paste", root).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink capture directory is rejected with stage metadata", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-paste-link-"));
  try {
    mkdirSync(path.join(root, "outside"));
    symlinkSync(path.join(root, "outside"), path.join(root, "s0_baseline_saved"));
    const row = persistenceStatus(root).captures.find((entry) => entry.stage_id === "S0");
    assert.equal(row.capture_status, "REJECTED");
    assert.equal(row.stage_semantics, "BASELINE_SAVED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing S2 sentinel blocks evidence promotion", () => {
  const root = materializeReadyCapture();
  try {
    const metaPath = path.join(root, "s2_after_pattern_paste", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.destination_ui_sentinel = null;
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const status = persistenceStatus(root);
    assert.equal(status.device_evidence_promotion, "BLOCKED");
    assert.equal(status.device_capture, "INCOMPLETE");
    assert.equal(status.pattern_paste_gate_reason, "S2_UI_SENTINEL");
    assert.notEqual(status.device_capture, "PASS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("S1 without clipboard copy is not promoted", () => {
  const root = materializeReadyCapture();
  try {
    const metaPath = path.join(root, "s1_destination_selected_before_paste", "capture.meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.source_pattern_copy_to_clipboard_performed = false;
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, root);
    const status = persistenceStatus(root);
    const row = status.captures.find((entry) => entry.stage_id === "S1");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /clipboard copy/);
    assert.equal(status.device_evidence_promotion, "BLOCKED");
    assert.notEqual(status.device_capture, "PASS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest hashing rejects an oversized bank before reading it", () => {
  const root = materializeReadyCapture();
  try {
    writeFileSync(path.join(root, "s0_baseline_saved", "bank01.work"), Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.throws(() => buildManifest("s0_baseline_saved", root), /bank01\.work exceeds its size cap/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oversized project.work is rejected before it is parsed", () => {
  const root = materializeReadyCapture();
  try {
    writeFileSync(path.join(root, "s0_baseline_saved", "project.work"), Buffer.alloc(1024 * 1024 + 1));
    const row = persistenceStatus(root).captures.find((entry) => entry.stage_id === "S0");
    assert.equal(row.capture_status, "REJECTED");
    assert.match(row.error, /exceeds 1 MiB/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pattern paste gate accepts the canonical sentinel shape", () => {
  assert.equal(patternPasteSuccessGate(syntheticStages({})).ok, true);
});

function snapshotTree(root) {
  const digest = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const full = path.join(dir, name);
      const st = lstatSync(full);
      digest.update(name);
      if (st.isSymbolicLink()) {
        digest.update("symlink");
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) digest.update(readFileSync(full));
    }
  };
  walk(root);
  return digest.digest("hex");
}

function MATRIX_PRESENT(root) {
  return ["project.work", "bank02.work"].every((name) => {
    try {
      return lstatSync(path.join(root, "s0_baseline_saved", name)).isFile();
    } catch {
      return false;
    }
  });
}

function projectText(bankRaw, patternRaw = 0) {
  return `[STATES]\nBANK=${bankRaw}\nPATTERN=${patternRaw}\n[/STATES]\n`;
}

function syntheticStages(options) {
  const {
    destWorkAt = "S2",
    destStrdAt = "S2",
    projectBankByStage = {},
    reloadSentinel = null,
  } = options;
  const fileSize = Math.max(PINNED_OFFSET + 4, 64);
  const baseBuf = (seed) => {
    const buf = Buffer.alloc(fileSize, seed);
    buf[PINNED_OFFSET] = 108;
    return buf;
  };
  return PLANNED_CAPTURES.map((planned) => {
    const files = {};
    for (const name of REQUIRED_FILES) {
      if (name === "capture.meta.json") continue;
      if (name.startsWith("project.")) {
        files[name] = Buffer.from(projectText(projectBankByStage[planned.stage_id] ?? 3), "latin1");
        continue;
      }
      const slot = Number(name.slice(4, 6));
      files[name] = baseBuf(slot);
    }
    const mutate = (suffix, atStage) => {
      if (stageRank(planned.stage_id) >= stageRank(atStage)) {
        files[`bank02.${suffix}`] = Buffer.from(files[`bank02.${suffix}`]);
        files[`bank02.${suffix}`][10] ^= 0x55;
      }
    };
    mutate("work", destWorkAt);
    mutate("strd", destStrdAt);
    const meta = {
      ...metaTemplate(planned),
      device_generated: true,
      capture_sequence_proven: true,
      os_version: "1.40",
      capture_date: "2026-10-10",
      operator_note: "synthetic pattern paste",
      source_pattern_copy_to_clipboard_performed: planned.stage_id !== "S0",
      source_sentinel_present_a: true,
      dest_sentinel_present_b: false,
      destination_ui_sentinel: planned.stage_id === "S2" || stageRank(planned.stage_id) > stageRank("S2")
        ? "PRESENT"
        : null,
      destination_ui_sentinel_after_reload: planned.stage_id === "S5" ? reloadSentinel : null,
    };
    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
      stage_semantics: planned.stage_semantics,
      prior_transition: planned.prior_transition,
      meta,
      files,
    };
  });
}

function stageRank(stageId) {
  return Number(stageId.slice(1));
}

function materializeReadyCapture() {
  const root = mkdtempSync(path.join(tmpdir(), "pse-paste-ready-"));
  for (const stage of syntheticStages({})) {
    const dir = path.join(root, stage.capture_name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "capture.meta.json"), `${JSON.stringify(stage.meta, null, 2)}\n`);
    for (const [name, buf] of Object.entries(stage.files)) writeFileSync(path.join(dir, name), buf);
  }
  return root;
}

test("committed captures verify manifests and keep unknown transport and reload sentinel", () => {
  assert.equal(MATRIX_PRESENT(FIXTURE_ROOT), true);
  for (const planned of PLANNED_CAPTURES) {
    assert.equal(verifyManifest(planned.name, FIXTURE_ROOT).ok, true);
    const meta = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, planned.name, "capture.meta.json"), "utf8"));
    assert.equal(meta.capture_transport, "unknown");
    assert.equal(meta.destination_ui_sentinel_after_reload, null);
    assert.equal(meta.offset_585459_classification, undefined);
  }
  const judged = classifyPatternPaste({
    stages: syntheticStages({ destWorkAt: "S3", destStrdAt: "S4" }),
  });
  assert.equal(
    judged.cross_bank_pattern_paste_persistence,
    "OBSERVED_WORK_FLUSH_ON_CONTROL_SWITCH_STRD_ON_PROJECT_SAVE",
  );
  assert.equal(judged.working_checkpoint_separation_observed, "YES");
  assert.equal(judged.copy_saved_checkpoint_semantics, "UNKNOWN");
  assert.equal(judged.pattern_paste_survives_project_reload, "UNKNOWN");
});

test("injected write cleanup uses the harness hook", async () => {
  const harness = await import("./pse-pattern-paste-persistence.mjs");
  const root = materializeReadyCapture();
  harness.setManifestWriteImpl(() => {
    throw new Error("injected write failure");
  });
  try {
    assert.throws(() => harness.writeManifest("s0_baseline_saved", root), /injected write failure/);
    assert.equal(
      readdirSync(path.join(root, "s0_baseline_saved")).some((name) => name.includes(".partial-")),
      false,
    );
  } finally {
    harness.setManifestWriteImpl(null);
    rmSync(root, { recursive: true, force: true });
  }
});
