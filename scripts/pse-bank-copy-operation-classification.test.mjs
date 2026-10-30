#!/usr/bin/env node
/**
 * Read-only contract tests for Bank Copy operation classification ledger.
 * Work ID: MO-PSE-BANK-COPY-SEMANTICS-RECONCILIATION-1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assertOperationKind,
  LEGACY_OPERATION_KIND,
  OPERATION_KIND,
} from "./pse-bank-copy-state-doc-device-evidence.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = path.join(SCRIPT_DIR, "pse-bank-copy-operation-classification.json");

/** @returns {import("./pse-bank-copy-operation-classification.json")} */
function loadLedger() {
  return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
}

test("ledger schema and operation identifiers are stable", () => {
  const ledger = loadLedger();
  assert.equal(ledger.schema, "masterocta.pse-bank-copy-operation-classification:v1");
  assert.equal(ledger.work_id, "MO-PSE-BANK-COPY-SEMANTICS-RECONCILIATION-1");
  const ops = Object.keys(ledger.operations);
  assert.equal(ops.length, 3);
  for (const id of ops) {
    for (const other of ledger.operations[id].mutually_exclusive_with) {
      assert.notEqual(id, other);
      assert.ok(ledger.operations[other], `${other} missing for ${id}`);
    }
  }
});

test("P_BANK_COPY_STATE stays STOP_WITH_FINDINGS and promotion BLOCKED", () => {
  const ledger = loadLedger();
  const rows = ledger.evidence_records.filter((row) => row.id.startsWith("P_BANK_COPY_STATE"));
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.equal(row.device_capture, "REJECTED");
    assert.equal(row.result, "STOP_WITH_FINDINGS");
    assert.equal(row.promotion, "BLOCKED");
    assert.notEqual(row.classification, "DEVICE_CONFIRMED");
  }
});

test("NATIVE_BANK_COPY alias is not whole-bank device proof", () => {
  const ledger = loadLedger();
  const alias = ledger.legacy_aliases.NATIVE_BANK_COPY;
  assert.equal(alias.maps_to_operation, "A_PATTERN_COPY_PASTE");
  assert.equal(alias.whole_bank_copy_device_confirmed, false);
});

test("remap preview is CODE_CONFIRMED and does not authorize Apply", () => {
  const ledger = loadLedger();
  const row = ledger.evidence_records.find((entry) => entry.id === "BANK_COPY_REMAP_PREVIEW");
  assert.ok(row);
  assert.equal(row.classification, "CODE_CONFIRMED");
  assert.equal(row.applicability_to_masterocta_bank_copy, "READ_ONLY_PREVIEW_MODEL");
  assert.equal(ledger.safety_gates.BANK_COPY_APPLY_AUTHORIZED, "NO");
});

test("pattern paste harness rejects bank_copy and reserved File Manager kind", () => {
  const ledger = loadLedger();
  const accepted = new Set(ledger.harness_contracts.pattern_paste_accepted_operation_kinds);
  assert.equal(accepted.size, 2);
  assert.ok(accepted.has(OPERATION_KIND));
  assert.ok(accepted.has(LEGACY_OPERATION_KIND));

  for (const value of [undefined, "", OPERATION_KIND, LEGACY_OPERATION_KIND]) {
    assert.doesNotThrow(() => assertOperationKind({ operation_kind: value }));
  }

  for (const rejected of ledger.harness_contracts.pattern_paste_rejected_operation_kinds) {
    assert.throws(() => assertOperationKind({ operation_kind: rejected }), /pattern_copy_paste/);
  }
});

test("reserved capture schemas stay separate from pattern paste schema", () => {
  const ledger = loadLedger();
  assert.notEqual(
    ledger.harness_contracts.pattern_paste_capture_schema,
    ledger.harness_contracts.reserved_file_manager_capture_schema,
  );
  assert.match(ledger.harness_contracts.reserved_file_manager_capture_schema, /bank-file-copy/);
  assert.match(ledger.harness_contracts.reserved_pattern_paste_gap_capture_schema, /pattern-paste-gap/);
});
