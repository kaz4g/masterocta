import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFixtures,
  BANK_TARGET_FILES,
  CAPTURES,
  eliminateCandidates,
  findSlotCorrelatedCandidates,
  fixtureRoot,
  PINNED_SLOT_CORRELATED_OFFSET,
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

test("elimination removes the pinned candidate as content-dependent", () => {
  const report = analyzeFixtures();
  assert.equal(report.slotCorrelatedCandidatesSurvivingElimination.length, 0);
  assert.equal(report.bankInternalIdentity, "NOT_OBSERVED");
  assert.equal(report.sameContentDifferentSlotDeviceEvidence, "ABSENT");
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
