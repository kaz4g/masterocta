#!/usr/bin/env node
/**
 * Read-only Bank internal identity audit for pse_bank_multi_device fixtures.
 * Writes nothing; stdout only when run as CLI.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORK_ID = "MO-PSE-BANK-INTERNAL-IDENTITY-1";
export const OT_TOOLS_IO_REV = "cd246d8a595647364eb4cc78211033b2d1302526";
export const HEADER_LEN = 21;
export const CHECKSUM_LEN = 2;

export const CAPTURES = [
  "bank_a_active",
  "bank_b_active",
  "bank_b_pattern_4",
  "bank_a_working_diverged",
  "bank_a_after_save",
];

export const BANK_TARGET_FILES = [
  "bank01.work",
  "bank01.strd",
  "bank02.work",
  "bank02.strd",
];

export const TRANSITIONS = [
  ["bank_a_active", "bank_b_active"],
  ["bank_b_active", "bank_b_pattern_4"],
  ["bank_b_pattern_4", "bank_a_working_diverged"],
  ["bank_a_working_diverged", "bank_a_after_save"],
];

/** Pinned single raw slot-correlated byte before content-neighborhood elimination. */
export const PINNED_SLOT_CORRELATED_OFFSET = 585_459;

const CONTENT_NEIGHBORHOOD = 32;

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_multi_device",
);

export function fixtureRoot() {
  return ROOT;
}

export function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function readBankBytes(capture, fileName) {
  const full = path.join(ROOT, capture, fileName);
  const st = lstatSync(full);
  if (st.isSymbolicLink()) {
    throw new Error(`Symlink not allowed: ${capture}/${fileName}`);
  }
  return readFileSync(full);
}

export function buildShaMatrix(captures = CAPTURES, files = BANK_TARGET_FILES) {
  const matrix = {};
  for (const capture of captures) {
    matrix[capture] = {};
    for (const file of files) {
      matrix[capture][file] = sha256File(path.join(ROOT, capture, file));
    }
  }
  return matrix;
}

export function transitionChangedFiles(transitions = TRANSITIONS, files = BANK_TARGET_FILES) {
  const out = {};
  for (const [from, to] of transitions) {
    const changed = files.filter(
      (file) =>
        sha256File(path.join(ROOT, from, file)) !== sha256File(path.join(ROOT, to, file)),
    );
    out[`${from}->${to}`] = changed;
  }
  return out;
}

function varyingOffsets(buffers) {
  const len = buffers[0].length;
  const offsets = [];
  for (let i = 0; i < len; i += 1) {
    const values = new Set(buffers.map((b) => b[i]));
    if (values.size > 1) {
      offsets.push(i);
    }
  }
  return offsets;
}

export function findSlotCorrelatedCandidates(captures = CAPTURES) {
  const bank01 = captures.map((c) => readBankBytes(c, "bank01.work"));
  const bank02 = captures.map((c) => readBankBytes(c, "bank02.work"));
  const len = bank01[0].length;
  if (!bank02.every((b) => b.length === len)) {
    throw new Error("bank01/bank02 length mismatch");
  }
  const candidates = [];
  for (let i = 0; i < len; i += 1) {
    const v01 = new Set(bank01.map((b) => b[i]));
    const v02 = new Set(bank02.map((b) => b[i]));
    if (v01.size === 1 && v02.size === 1 && [...v01][0] !== [...v02][0]) {
      candidates.push({
        offset: i,
        bank01Value: [...v01][0],
        bank02Value: [...v02][0],
        classification: "SLOT_CORRELATED_CANDIDATE",
      });
    }
  }
  return { fileLength: len, candidates };
}

function overlapsNeighborhood(offset, varying, radius) {
  return varying.some((v) => Math.abs(v - offset) <= radius);
}

export function eliminateCandidates(
  candidates,
  bank01Varying,
  bank02Varying,
  fileLength,
) {
  const checksumStart = fileLength - CHECKSUM_LEN;
  return candidates
    .map((entry) => {
      if (entry.offset < HEADER_LEN) {
        return { ...entry, classification: "KNOWN_HEADER" };
      }
      if (entry.offset >= checksumStart) {
        return { ...entry, classification: "CHECKSUM_DERIVED" };
      }
      if (
        overlapsNeighborhood(entry.offset, bank01Varying, CONTENT_NEIGHBORHOOD) ||
        overlapsNeighborhood(entry.offset, bank02Varying, CONTENT_NEIGHBORHOOD)
      ) {
        return { ...entry, classification: "CONTENT_DEPENDENT" };
      }
      return { ...entry, classification: "UNKNOWN" };
    })
    .filter((entry) => entry.classification === "UNKNOWN");
}

export function analyzeFixtures() {
  const bank01Buffers = CAPTURES.map((c) => readBankBytes(c, "bank01.work"));
  const bank02Buffers = CAPTURES.map((c) => readBankBytes(c, "bank02.work"));
  const bank01Varying = varyingOffsets(bank01Buffers);
  const bank02Varying = varyingOffsets(bank02Buffers);
  const { fileLength, candidates } = findSlotCorrelatedCandidates();
  const surviving = eliminateCandidates(
    candidates,
    bank01Varying,
    bank02Varying,
    fileLength,
  );

  let sameContentDifferentSlot = "ABSENT";
  for (const capture of CAPTURES) {
    for (const ext of [".work", ".strd"]) {
      const a = readBankBytes(capture, `bank01${ext}`);
      const b = readBankBytes(capture, `bank02${ext}`);
      if (a.equals(b)) {
        sameContentDifferentSlot = "PRESENT";
      }
    }
  }

  const bankInternalIdentity =
    surviving.length === 0 ? "NOT_OBSERVED" : "UNKNOWN";

  return {
    workId: WORK_ID,
    otToolsIoRev: OT_TOOLS_IO_REV,
    parserInternalBankIdField: "ABSENT",
    fileLength,
    shaMatrix: buildShaMatrix(),
    transitions: transitionChangedFiles(),
    bank01TemporalVaryingOffsetCount: bank01Varying.length,
    bank02TemporalVaryingOffsetCount: bank02Varying.length,
    slotCorrelatedCandidatesRaw: candidates,
    slotCorrelatedCandidatesSurvivingElimination: surviving,
    sameContentDifferentSlotDeviceEvidence: sameContentDifferentSlot,
    bankInternalIdentity,
  };
}

function main() {
  const report = analyzeFixtures();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
