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
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { projectStatesTemplate } from "./pse-bank-identity-device.mjs";
import {
  FIXTURE_ROOT,
  PLANNED_CAPTURES,
  REQUIRED_FILES,
  analyzeCrossover,
  classifyCrossover,
  classifyUntouchedBaseline,
  crossoverStatus,
  emptyTypedDeltas,
  metaTemplate,
  verifyManifest,
  writeManifest,
} from "./pse-bank-identity-crossover.mjs";

const PINNED = 585459;

test("empty crossover receptacle waits for a real device and does not write", () => {
  const before = snapshotTree(FIXTURE_ROOT);
  const status = crossoverStatus(FIXTURE_ROOT);
  const analyzed = analyzeCrossover(null, FIXTURE_ROOT);
  assert.equal(status.crossover_harness, "READY");
  assert.equal(status.device_capture, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.result, "WAITING_FOR_REAL_DEVICE");
  assert.equal(status.run_a_pre, "NOT_RUN");
  assert.equal(status.run_a_post, "NOT_RUN");
  assert.equal(status.run_b_pre, "NOT_RUN");
  assert.equal(status.run_b_post, "NOT_RUN");
  assert.deepEqual(status.run_a_copy_order, ["B", "C"]);
  assert.deepEqual(status.run_b_copy_order, ["C", "B"]);
  assert.equal(status.current_bank, "D");
  assert.equal(status.offset_585459_classification, "CONTENT_DEPENDENT");
  assert.equal(status.bank_internal_identity, "UNKNOWN");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(status.issue_221, "OPEN");
  assert.equal(status.bank_changeplan_readiness, "NOT_READY");
  assert.equal(analyzed.raw_delta_classification, "NOT_RUN");
  assert.equal(JSON.stringify(status).includes("PROVEN_ABSENT"), false);
  for (const planned of PLANNED_CAPTURES) {
    const row = status.captures.find((entry) => entry.capture_label === planned.name);
    assert.equal(row.capture_status, "WAITING");
    const meta = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, planned.name, "capture.meta.json"), "utf8"));
    assert.equal(meta.device_generated, false);
    assert.deepEqual(meta.copy_order, planned.copy_order);
    assert.equal(meta.project_name, planned.project_name);
  }
  assert.deepEqual(snapshotTree(FIXTURE_ROOT), before);
});

test("missing, stale, and symlink manifests are rejected; a matching manifest passes", () => {
  const missingRoot = materializeReady();
  assert.equal(crossoverStatus(missingRoot).device_capture, "REJECTED");

  const staleRoot = materializeReady();
  for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, staleRoot);
  const bank = path.join(staleRoot, "run_a_post", "bank02.work");
  const bytes = readFileSync(bank);
  bytes[0] ^= 0xff;
  writeFileSync(bank, bytes);
  assert.equal(crossoverStatus(staleRoot).device_capture, "REJECTED");
  assert.equal(verifyManifest("run_a_post", staleRoot).ok, false);

  const linkRoot = materializeReady();
  for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, linkRoot);
  const outside = path.join(linkRoot, "outside.json");
  writeFileSync(outside, "{}\n");
  const sidecar = path.join(linkRoot, "run_b_pre", "SHA256SUMS.json");
  unlinkSync(sidecar);
  symlinkSync(outside, sidecar);
  assert.equal(crossoverStatus(linkRoot).device_capture, "REJECTED");
  assert.throws(() => verifyManifest("run_b_pre", linkRoot), /Symlink not allowed/);

  const okRoot = materializeReady();
  for (const planned of PLANNED_CAPTURES) writeManifest(planned.name, okRoot);
  const status = crossoverStatus(okRoot);
  assert.equal(status.device_capture, "PASS");
  assert.equal(status.run_a_pre, "PASS");
  assert.equal(status.result, "PENDING_RUST");
  assert.equal(status.bank_internal_identity, "UNKNOWN");
  assert.equal(status.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(verifyManifest("run_a_post", okRoot).ok, true);
  const analyzed = analyzeCrossover(null, okRoot);
  assert.equal(analyzed.typed_delta_classification, "PENDING_RUST");
  assert.notEqual(analyzed.bank_internal_identity, "CANDIDATE_PRESENT");
  assert.equal(analyzed.readiness_gap_bank_internal_identity, "OPEN");
});

test("symlink capture directories and unplanned names are rejected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pse-xover-linkdir-"));
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, "run_a_pre"));
  assert.equal(crossoverStatus(root).device_capture, "REJECTED");
  assert.throws(() => analyzeCrossover("other", root), /Not a planned capture/);
  assert.throws(() => analyzeCrossover("run_a_extra", FIXTURE_ROOT), /Not a planned capture/);
});

test("current bank other than D is rejected", () => {
  for (const projectText of [
    projectStatesTemplate(0),
    projectStatesTemplate(30),
    "[STATES]\nBANK=3\nBANK=3\n[/STATES]\n",
    "[NOTES]\nBANK=3\n[/NOTES]\n[STATES]\nPATTERN=0\n[/STATES]\n",
  ]) {
    const root = materializeReady({ projectText });
    assert.equal(crossoverStatus(root).device_capture, "REJECTED");
    assert.match(
      crossoverStatus(root).captures.find((entry) => entry.capture_label === "run_a_pre").error,
      /BANK does not match/,
    );
  }
});

test("unequal lengths stay fail-closed", () => {
  const dataset = syntheticDataset(16, []);
  dataset.runs.A.slots.B.work.post = Buffer.alloc(8);
  const judged = classifyCrossover(dataset);
  assert.equal(judged.length_mismatch, true);
  assert.equal(judged.raw_delta_classification, "LENGTH_MISMATCH");
  assert.equal(judged.result, "STOP_WITH_FINDINGS");
  assert.equal(judged.bank_internal_identity, "UNKNOWN");
  assert.equal(judged.raw_delta_classification.includes("CHECKSUM"), false);
});

test("synthetic crossover classes follow slot, copy order, typed content, or checksum", () => {
  const slot = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "B", offset: 10, after: 2 },
    { run: "A", slot: "C", offset: 10, after: 3 },
    { run: "B", slot: "B", offset: 10, after: 2 },
    { run: "B", slot: "C", offset: 10, after: 3 },
  ]));
  assert.equal(slot.stable_slot_correlated_field, "PRESENT");
  assert.equal(slot.copy_order_correlated_field, "NONE");
  assert.equal(slot.bank_internal_identity, "CANDIDATE_PRESENT");
  assert.equal(slot.internal_id_rewrite_required_by_evidence, "UNKNOWN");
  assert.equal(slot.readiness_gap_bank_internal_identity, "OPEN");
  assert.equal(slot.issue_221, "OPEN");
  assert.equal(slot.bank_changeplan_readiness, "NOT_READY");
  assert.equal(slot.result, "PASS");
  assert.equal(slot.diffs.some((diff) => diff.slot === "B" && diff.copy_rank === 1 && diff.after === 2), true);
  assert.equal(slot.diffs.some((diff) => diff.slot === "B" && diff.run === "B" && diff.copy_rank === 2), true);

  const order = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "B", offset: 10, after: 1 },
    { run: "A", slot: "C", offset: 10, after: 2 },
    { run: "B", slot: "C", offset: 10, after: 1 },
    { run: "B", slot: "B", offset: 10, after: 2 },
  ]));
  assert.equal(order.copy_order_correlated_field, "PRESENT");
  assert.equal(order.stable_slot_correlated_field, "NONE");
  assert.equal(order.bank_internal_identity, "NO_INTERNAL_IDENTITY_OBSERVED");
  assert.equal(order.internal_id_rewrite_required_by_evidence, "NO");
  assert.equal(order.readiness_gap_bank_internal_identity, "CLOSE_REVIEW");
  assert.equal(order.issue_221, "CLOSE_REVIEW");
  assert.equal(order.bank_changeplan_readiness, "NOT_READY");
  assert.equal(JSON.stringify(order).includes("PROVEN_ABSENT"), false);

  const typed = emptyTypedDeltas();
  typed.A.B = ["patterns"];
  typed.A.C = ["patterns"];
  typed.B.B = ["patterns"];
  typed.B.C = ["patterns"];
  const content = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "B", offset: 10, after: 2 },
    { run: "A", slot: "C", offset: 10, after: 3 },
    { run: "B", slot: "B", offset: 10, after: 2 },
    { run: "B", slot: "C", offset: 10, after: 3 },
  ], { typed_deltas: typed, typed_regions: { work: { 10: "patterns" }, strd: {} } }));
  assert.equal(content.stable_slot_correlated_field, "NONE");
  assert.equal(content.bank_internal_identity, "NO_INTERNAL_IDENTITY_OBSERVED");
  assert.equal(content.diffs.every((diff) => diff.classification === "CONTENT_DEPENDENT"), true);
  assert.equal(content.diffs[0].typed_field_region, "patterns");

  const checksum = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "B", offset: 30, after: 9 },
    { run: "A", slot: "C", offset: 31, after: 4 },
    { run: "B", slot: "B", offset: 30, after: 9 },
    { run: "B", slot: "C", offset: 31, after: 4 },
  ]));
  assert.equal(checksum.stable_slot_correlated_field, "NONE");
  assert.equal(checksum.raw_delta_classification, "CHECKSUM");
  assert.equal(checksum.bank_internal_identity, "NO_INTERNAL_IDENTITY_OBSERVED");
  assert.equal(checksum.internal_id_rewrite_required_by_evidence, "NO");

  const source = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "A", offset: 4, after: 7 },
    { run: "B", slot: "A", offset: 4, after: 7 },
  ]));
  assert.equal(source.source_runtime_correlated, "PRESENT");
  assert.equal(source.stable_slot_correlated_field, "NONE");
  assert.equal(source.bank_internal_identity, "NO_INTERNAL_IDENTITY_OBSERVED");
});

test("offset 585459 stays content-dependent even when the bytes follow a slot", () => {
  const judged = classifyCrossover(syntheticDataset(PINNED + 16, [
    { run: "A", slot: "B", offset: PINNED, after: 2 },
    { run: "A", slot: "C", offset: PINNED, after: 3 },
    { run: "B", slot: "B", offset: PINNED, after: 2 },
    { run: "B", slot: "C", offset: PINNED, after: 3 },
  ]));
  assert.equal(judged.offset_585459_classification, "CONTENT_DEPENDENT");
  assert.equal(judged.stable_slot_correlated_field, "NONE");
  assert.notEqual(judged.bank_internal_identity, "CANDIDATE_PRESENT");
  assert.equal(judged.diffs.every((diff) => diff.classification === "CONTENT_DEPENDENT"), true);
});

test("one-run payload noise stays insufficient", () => {
  const judged = classifyCrossover(syntheticDataset(32, [
    { run: "A", slot: "B", offset: 10, after: 4 },
  ]));
  assert.equal(judged.result, "STOP_WITH_FINDINGS");
  assert.equal(judged.bank_internal_identity, "UNKNOWN");
  assert.equal(judged.stable_slot_correlated_field, "INSUFFICIENT");
});

test("untouched B and C baseline records equality or a raw slot candidate", () => {
  const equal = Buffer.alloc(16, 1);
  const same = classifyUntouchedBaseline({
    workB: equal,
    workC: Buffer.from(equal),
    strdB: equal,
    strdC: Buffer.from(equal),
    typedEqual: true,
  });
  assert.equal(same.untouched_slot_identity_observed, "NO");
  assert.equal(same.untouched_slot_correlated_candidate, "NONE");

  const other = Buffer.from(equal);
  other[3] = 9;
  const drifted = classifyUntouchedBaseline({
    workB: equal,
    workC: other,
    strdB: equal,
    strdC: Buffer.from(equal),
    typedEqual: true,
  });
  assert.equal(drifted.untouched_slot_identity_observed, "RAW_DIFF");
  assert.equal(drifted.untouched_slot_correlated_candidate, "PRESENT");
});

test("committed templates match the planned capture contract", () => {
  for (const planned of PLANNED_CAPTURES) {
    const onDisk = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, planned.name, "capture.meta.json"), "utf8"));
    const template = metaTemplate(planned);
    assert.equal(onDisk.schema, template.schema);
    assert.equal(onDisk.device_generated, false);
    assert.equal(onDisk.synthetic_modification, false);
    assert.equal(onDisk.current_bank_ui, "D");
    assert.equal(lstatSync(path.join(FIXTURE_ROOT, planned.name)).isSymbolicLink(), false);
  }
});

function syntheticDataset(length, edits, extra = {}) {
  const runs = {};
  for (const run of ["A", "B"]) {
    const slots = {};
    for (const slot of ["A", "B", "C"]) {
      slots[slot] = {
        work: pair(length, edits.filter((edit) => edit.run === run && edit.slot === slot && edit.suffix !== "strd")),
        strd: pair(length, edits.filter((edit) => edit.run === run && edit.slot === slot && edit.suffix === "strd")),
      };
    }
    runs[run] = {
      copy_order: run === "A" ? ["B", "C"] : ["C", "B"],
      slots,
    };
  }
  return {
    runs,
    typed_deltas: extra.typed_deltas ?? emptyTypedDeltas(),
    typed_regions: extra.typed_regions ?? { work: {}, strd: {} },
  };
}

function pair(length, edits) {
  const pre = Buffer.alloc(length);
  const post = Buffer.alloc(length);
  for (const edit of edits) post[edit.offset] = edit.after;
  return { pre, post };
}

function readyMeta(planned) {
  return {
    ...metaTemplate(planned),
    os_version: "1.40 (R0173)",
    device_generated: true,
    project_reloaded: true,
    capture_date: "2026-10-07",
    operator_note: "synthetic harness capture",
  };
}

function materializeReady({ projectText } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "pse-xover-"));
  const project = projectText ?? projectStatesTemplate(3);
  for (const planned of PLANNED_CAPTURES) {
    const dir = path.join(root, planned.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "capture.meta.json"), JSON.stringify(readyMeta(planned)));
    for (const name of REQUIRED_FILES) {
      if (name.startsWith("project.")) writeFileSync(path.join(dir, name), project);
      else writeFileSync(path.join(dir, name), Buffer.from(`stub-${name}`));
    }
  }
  return root;
}

function snapshotTree(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const child of readdirSync(full)) {
        files.push(`${entry.name}/${child}:${readFileSync(path.join(full, child)).toString("hex")}`);
      }
    } else if (entry.isFile()) {
      files.push(`${entry.name}:${readFileSync(full).toString("hex")}`);
    }
  }
  return files.sort();
}
