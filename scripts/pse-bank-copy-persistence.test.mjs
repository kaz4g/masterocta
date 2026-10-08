import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ADJACENT_TRANSITIONS,
  FIXTURE_ROOT,
  PLANNED_CAPTURES,
  REQUIRED_FILES,
  analyzePersistence,
  buildTransitionMatrix,
  classifyPersistence,
  copySuccessGate,
  metaTemplate,
  parsePersistenceStatesSection,
  persistenceStatus,
  setManifestWriteImpl,
  verifyManifest,
  writeManifest,
  writeRegularFileAtomic,
} from "./pse-bank-copy-persistence.mjs";
import { PINNED_OFFSET } from "./pse-bank-identity-device.mjs";

test("template fixture stays waiting and does not rewrite tree", () => {
  const before = snapshotTree(FIXTURE_ROOT);
  const status = persistenceStatus(FIXTURE_ROOT);
  assert.equal(status.persistence_harness, "READY");
  assert.equal(status.device_capture, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.result, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.issue_217, "OPEN");
  assert.equal(status.copy_saved_checkpoint_semantics, "UNKNOWN");
  assert.equal(status.bank_changeplan_readiness, "NOT_READY");
  assert.equal(JSON.stringify(status).includes("CLOSE_REVIEW"), false);
  for (const planned of PLANNED_CAPTURES) {
    const row = status.captures.find((entry) => entry.capture_label === planned.name);
    assert.equal(row.capture_status, "WAITING");
    const meta = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, planned.name, "capture.meta.json"), "utf8"));
    assert.equal(meta.device_generated, false);
    assert.equal(meta.schema, "masterocta.pse-bank-copy-persistence-capture:v1");
  }
  assert.deepEqual(snapshotTree(FIXTURE_ROOT), before);
});

test("STATES parser requires close tag and rejects duplicate BANK or PATTERN", () => {
  assert.deepEqual(parsePersistenceStatesSection("[STATES]\nBANK=1\nPATTERN=0\n[/STATES]\n"), {
    ok: true,
    bank: 1,
    pattern: 0,
  });
  assert.equal(parsePersistenceStatesSection("[STATES]\nBANK=1\nPATTERN=0\n").ok, false);
  assert.equal(parsePersistenceStatesSection("[STATES]\nBANK=1\nBANK=2\nPATTERN=0\n[/STATES]\n").ok, false);
  assert.equal(parsePersistenceStatesSection("[STATES]\nBANK=1\nPATTERN=0\nPATTERN=1\n[/STATES]\n").ok, false);
});

test("symlink root and unplanned capture names are rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-persist-link-"));
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, "s0_baseline_saved"));
  assert.equal(persistenceStatus(root).device_capture, "REJECTED");
});

test("copy gate blocks persistence when UI copy is unconfirmed (case E)", () => {
  const stages = syntheticStages({});
  stages[2].meta.destination_ui_sentinel = null;
  const judged = classifyPersistence({ stages: stages });
  assert.equal(judged.copy_command_effect, "UNCONFIRMED");
  assert.equal(judged.persistence_judgment, "NOT_RUN");
  assert.equal(judged.result, "STOP_WITH_FINDINGS");
});

test("synthetic cases A–D observe work/strd timing and destination switch", () => {
  const a = classifyPersistence({
    stages: syntheticStages({
      destWorkAt: "S1",
      destStrdAt: "S4",
    }),
  });
  assert.equal(a.dest_work_first_changed_at, "S1");
  assert.equal(a.dest_strd_first_changed_at, "S4");
  assert.equal(a.work_strd_divergence_observed, "YES");
  assert.equal(a.copy_effect_first_observed_on_disk, "COPY");

  const b = classifyPersistence({
    stages: syntheticStages({
      destWorkAt: "S1",
      destStrdAt: "S1",
    }),
  });
  assert.equal(b.dest_work_first_changed_at, "S1");
  assert.equal(b.dest_strd_first_changed_at, "S1");
  assert.equal(b.work_strd_divergence_observed, "NO");

  const cStages = syntheticStages({
    destWorkAt: "S1",
    destStrdAt: "S1",
    untouchedChangeAt: "S4",
  });
  const matrix = buildTransitionMatrix(cStages);
  const beforeSave = matrix.transitions.filter(
    (entry) => entry.transition !== "PROJECT_SAVE" && entry.transition !== "PROJECT_RELOAD",
  );
  assert.equal(
    beforeSave.every((entry) => entry.cells.filter((cell) => cell.file.startsWith("bank03.")).every((cell) => cell.raw_equal)),
    true,
  );

  const d = classifyPersistence({
    stages: syntheticStages({
      projectBankByStage: { S0: 3, S1: 3, S2: 1, S3: 3, S4: 3, S5: 3 },
    }),
  });
  assert.equal(d.project_state_copy_retarget_observed, "NO");
  const dSwitch = classifyPersistence({
    stages: syntheticStages({
      projectBankByStage: { S0: 3, S1: 1, S2: 1, S3: 3, S4: 3, S5: 3 },
      destWorkAt: "S1",
      destStrdAt: "S1",
    }),
  });
  assert.equal(dSwitch.project_state_copy_retarget_observed, "YES");
});

test("case F flags runtime side effect when only C or D changes", () => {
  const f = classifyPersistence({
    stages: syntheticStages({
      sideEffectBank: "bank03",
      sideEffectAt: "S1",
    }),
  });
  assert.match(f.runtime_or_save_side_effect, /COPY/);
});

test("case G reload sentinel absent and case H keeps semantics unknown", () => {
  const g = classifyPersistence({
    stages: syntheticStages({
      reloadSentinel: "ABSENT",
    }),
  });
  assert.equal(g.copy_survives_project_reload, "NO");

  const h = classifyPersistence({ stages: syntheticStages({}) });
  assert.equal(h.copy_saved_checkpoint_semantics, "UNKNOWN");
  assert.equal(h.issue_217, "OPEN");
  assert.equal(JSON.stringify(h).includes("CLOSE_REVIEW"), false);
});

test("length mismatch is fail-closed", () => {
  const stages = syntheticStages({});
  stages[1].files["bank02.work"] = Buffer.alloc(8);
  const judged = classifyPersistence({ stages: stages });
  assert.equal(judged.persistence_judgment, "LENGTH_MISMATCH");
  assert.equal(judged.result, "STOP_WITH_FINDINGS");
});

test("manifest symlink and partial write boundaries", () => {
  const root = materializeReadyCapture();
  writeManifest("s0_baseline_saved", root);
  assert.equal(verifyManifest("s0_baseline_saved", root).ok, true);

  const stale = materializeReadyCapture();
  writeManifest("s0_baseline_saved", stale);
  const bank = path.join(stale, "s0_baseline_saved", "bank02.work");
  const bytes = readFileSync(bank);
  bytes[0] ^= 0xff;
  writeFileSync(bank, bytes);
  assert.equal(verifyManifest("s0_baseline_saved", stale).ok, false);

  const linkRoot = materializeReadyCapture();
  writeManifest("s0_baseline_saved", linkRoot);
  const outside = path.join(linkRoot, "outside.json");
  writeFileSync(outside, "{}\n");
  const sidecar = path.join(linkRoot, "s0_baseline_saved", "SHA256SUMS.json");
  unlinkSync(sidecar);
  symlinkSync(outside, sidecar);
  assert.throws(() => verifyManifest("s0_baseline_saved", linkRoot), /Symlink not allowed/);
});

test("REJECTED capture row includes stage metadata", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-persist-bad-"));
  mkdirSync(path.join(root, "s0_baseline_saved"));
  writeFileSync(
    path.join(root, "s0_baseline_saved", "capture.meta.json"),
    `${JSON.stringify({ ...metaTemplate(PLANNED_CAPTURES[0]), synthetic_modification: true }, null, 2)}\n`,
  );
  const row = persistenceStatus(root).captures.find((entry) => entry.capture_label === "s0_baseline_saved");
  assert.equal(row.capture_status, "REJECTED");
  assert.equal(row.stage_id, "S0");
});

function snapshotTree(root) {
  const digest = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        digest.update(name);
        digest.update(readFileSync(full));
      }
    }
  };
  walk(root);
  return digest.digest("hex");
}

function projectText(bankRaw, patternRaw = 0) {
  return `[STATES]\nBANK=${bankRaw}\nPATTERN=${patternRaw}\n[/STATES]\n`;
}

function syntheticStages(options) {
  const {
    destWorkAt = "S1",
    destStrdAt = "S1",
    untouchedChangeAt = null,
    sideEffectBank = null,
    sideEffectAt = null,
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
        const bank = projectBankByStage[planned.stage_id] ?? 3;
        files[name] = Buffer.from(projectText(bank), "latin1");
        continue;
      }
      const slot = name.slice(0, 6);
      let seed = 1;
      if (slot === "bank02") seed = 2;
      if (slot === "bank03") seed = 3;
      if (slot === "bank04") seed = 4;
      files[name] = baseBuf(seed);
    }

    const stageIndex = planned.stage_id;
    const applyDest = (suffix, atStage) => {
      if (stageIndex === atStage || stageRank(stageIndex) >= stageRank(atStage)) {
        const key = `bank02.${suffix}`;
        files[key] = Buffer.from(files[key]);
        files[key][10] ^= 0x55;
      }
    };
    applyDest("work", destWorkAt);
    applyDest("strd", destStrdAt);

    if (untouchedChangeAt && stageRank(stageIndex) >= stageRank(untouchedChangeAt)) {
      files["bank03.work"][11] ^= 0x33;
    }
    if (sideEffectBank && sideEffectAt && stageRank(stageIndex) >= stageRank(sideEffectAt)) {
      const key = `${sideEffectBank}.work`;
      files[key][12] ^= 0x44;
    }

    const meta = {
      ...metaTemplate(planned),
      device_generated: true,
      os_version: "1.40",
      capture_date: "2026-10-08",
      operator_note: "synthetic",
      source_sentinel_present_a: true,
      dest_sentinel_present_b: false,
      destination_ui_sentinel: planned.stage_id === "S2" || stageRank(planned.stage_id) > stageRank("S2") ? "PRESENT" : null,
      destination_ui_sentinel_after_reload: planned.stage_id === "S5" ? reloadSentinel : null,
      capture_transport: "unknown",
      capture_required_mode_change: "unknown",
      capture_may_flush_device_state: "unknown",
    };

    return {
      capture_name: planned.name,
      stage_id: planned.stage_id,
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
  const root = mkdtempSync(path.join(tmpdir(), "pse-persist-ready-"));
  const stages = syntheticStages({});
  for (const stage of stages) {
    const dir = path.join(root, stage.capture_name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "capture.meta.json"), `${JSON.stringify(stage.meta, null, 2)}\n`);
    for (const [name, buf] of Object.entries(stage.files)) {
      writeFileSync(path.join(dir, name), buf);
    }
  }
  return root;
}

test("copySuccessGate accepts canonical sentinel shapes", () => {
  const stages = syntheticStages({});
  assert.equal(copySuccessGate(stages).ok, true);
});

test("adjacent transition labels match receptacle plan", () => {
  assert.deepEqual(
    ADJACENT_TRANSITIONS.map((entry) => entry.label),
    ["COPY", "DESTINATION_SWITCH", "CONTROL_SWITCH", "PROJECT_SAVE", "PROJECT_RELOAD"],
  );
});

test("analyze on template fixture reports fixture_no_write pass", () => {
  const analyzed = analyzePersistence(FIXTURE_ROOT);
  assert.equal(analyzed.fixture_no_write, "PASS");
});
