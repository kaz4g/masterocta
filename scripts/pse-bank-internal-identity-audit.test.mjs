import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeFixtures,
  BANK_TARGET_FILES,
  CAPTURES,
  classifyCandidates,
  findSlotCorrelatedCandidates,
  fixtureRoot,
  judgeBankInternalIdentity,
  PINNED_SLOT_CORRELATED_OFFSET,
  readBankBytes,
  readRegularFileUnderRoot,
  resolveFixtureBankPath,
  sameContentDifferentSlotDeviceEvidence,
  TRANSITIONS,
  transitionChangedFiles,
} from "./pse-bank-internal-identity-audit.mjs";

test("fixture root exists", () => {
  assert.match(fixtureRoot(), /pse_bank_multi_device$/);
});

test("analyzeFixtures is deterministic", () => {
  const a = JSON.stringify(analyzeFixtures());
  const b = JSON.stringify(analyzeFixtures());
  assert.equal(a, b);
});

test("pinned slot-correlated offset before elimination", () => {
  const { candidates, fileLength } = findSlotCorrelatedCandidates();
  assert.equal(fileLength, 636_113);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].offset, PINNED_SLOT_CORRELATED_OFFSET);
  assert.equal(candidates[0].bank01Value, 64);
  assert.equal(candidates[0].bank02Value, 108);
});

test("unresolved slot-correlated candidate yields UNKNOWN judgment", () => {
  const report = analyzeFixtures();
  assert.equal(report.slotCorrelatedCandidatesUnresolved.length, 1);
  assert.equal(
    report.slotCorrelatedCandidatesUnresolved[0].offset,
    PINNED_SLOT_CORRELATED_OFFSET,
  );
  assert.equal(report.bankInternalIdentity, "UNKNOWN");
  assert.equal(sameContentDifferentSlotDeviceEvidence(), "ABSENT");
});

test("classifyCandidates keeps pinned offset unresolved", () => {
  const { candidates, fileLength } = findSlotCorrelatedCandidates();
  const bank01 = CAPTURES.map((c) => readBankBytes(c, "bank01.work"));
  const bank02 = CAPTURES.map((c) => readBankBytes(c, "bank02.work"));
  const varying = (buffers) => {
    const len = buffers[0].length;
    const out = [];
    for (let i = 0; i < len; i += 1) {
      if (new Set(buffers.map((b) => b[i])).size > 1) {
        out.push(i);
      }
    }
    return out;
  };
  const classified = classifyCandidates(
    candidates,
    varying(bank01),
    varying(bank02),
    fileLength,
  );
  assert.equal(judgeBankInternalIdentity(classified), "UNKNOWN");
});

test("readRegularFileUnderRoot rejects symlinks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pse-bank-audit-symlink-"));
  const outside = path.join(dir, "outside.bin");
  writeFileSync(outside, "x");
  const link = path.join(dir, "link.work");
  symlinkSync(outside, link);
  assert.throws(
    () => readRegularFileUnderRoot(link, dir),
    /Symlink not allowed/,
  );
});

test("resolveFixtureBankPath accepts committed bank01.work", () => {
  const resolved = resolveFixtureBankPath("bank_a_active", "bank01.work");
  assert.match(resolved, /bank_a_active[/\\]bank01\.work$/);
  assert.doesNotThrow(() => readBankBytes("bank_a_active", "bank01.work"));
});

test("transition diffs match pinned capture choreography", () => {
  const transitions = transitionChangedFiles();
  assert.deepEqual(transitions["bank_a_active->bank_b_active"], [...BANK_TARGET_FILES]);
  assert.deepEqual(transitions["bank_b_active->bank_b_pattern_4"], [
    "bank02.work",
    "bank02.strd",
  ]);
  assert.deepEqual(transitions["bank_a_working_diverged->bank_a_after_save"], [
    "bank01.work",
    "bank01.strd",
  ]);
  assert.equal(TRANSITIONS.length, 4);
  assert.equal(CAPTURES.length, 5);
});
