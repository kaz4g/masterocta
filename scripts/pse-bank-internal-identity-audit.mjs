#!/usr/bin/env node
/**
 * Read-only Bank internal identity audit for pse_bank_multi_device fixtures.
 * Writes nothing; stdout only when run as CLI.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCaptureDir } from "./pse-bank-multi-device-manifest.mjs";

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

/** Pinned single raw slot-correlated byte on P_TEST captures. */
export const PINNED_SLOT_CORRELATED_OFFSET = 585_459;

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_multi_device",
);

export function fixtureRoot() {
  return ROOT;
}

function fixtureRootResolved() {
  return path.resolve(ROOT);
}

/**
 * Resolve a bank file under the fixture root; reject traversal and symlinks.
 */
export function readRegularFileUnderRoot(fullPath, rootResolved) {
  const resolved = path.resolve(fullPath);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes fixture root: ${resolved}`);
  }
  const st = lstatSync(resolved);
  if (st.isSymbolicLink()) {
    throw new Error(`Symlink not allowed: ${resolved}`);
  }
  if (!st.isFile()) {
    throw new Error(`Not a regular file: ${resolved}`);
  }
  return readFileSync(resolved);
}

export function resolveFixtureBankPath(capture, fileName) {
  const captureDir = resolveCaptureDir(capture);
  const full = path.resolve(captureDir, fileName);
  readRegularFileUnderRoot(full, fixtureRootResolved());
  return full;
}

export function readBankBytes(capture, fileName) {
  const full = path.resolve(resolveCaptureDir(capture), fileName);
  return readRegularFileUnderRoot(full, fixtureRootResolved());
}

export function sha256BankFile(capture, fileName) {
  const bytes = readBankBytes(capture, fileName);
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildShaMatrix(captures = CAPTURES, files = BANK_TARGET_FILES) {
  const matrix = {};
  for (const capture of captures) {
    matrix[capture] = {};
    for (const file of files) {
      matrix[capture][file] = sha256BankFile(capture, file);
    }
  }
  return matrix;
}

export function transitionChangedFiles(transitions = TRANSITIONS, files = BANK_TARGET_FILES) {
  const out = {};
  for (const [from, to] of transitions) {
    const changed = files.filter(
      (file) => sha256BankFile(from, file) !== sha256BankFile(to, file),
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

/**
 * Classify candidates for identity semantics. Proximity to temporally varying
 * bytes is noted but does not discard a slot-correlated byte without field-level
 * or same-content/different-slot device proof.
 */
export function classifyCandidates(candidates, bank01Varying, bank02Varying, fileLength) {
  const checksumStart = fileLength - CHECKSUM_LEN;
  return candidates.map((entry) => {
    if (entry.offset < HEADER_LEN) {
      return { ...entry, classification: "KNOWN_HEADER" };
    }
    if (entry.offset >= checksumStart) {
      return { ...entry, classification: "CHECKSUM_DERIVED" };
    }
    const nearTemporalVariance =
      bank01Varying.some((v) => Math.abs(v - entry.offset) <= 32) ||
      bank02Varying.some((v) => Math.abs(v - entry.offset) <= 32);
    if (nearTemporalVariance) {
      return {
        ...entry,
        classification: "UNRESOLVED_SLOT_CORRELATED",
        note: "Near temporally varying payload; identity vs content not distinguished",
      };
    }
    return {
      ...entry,
      classification: "UNRESOLVED_SLOT_CORRELATED",
      note: "Slot-correlated; no operational slot semantics",
    };
  });
}

/**
 * Device evidence when the operator saved identical bank content into two slots.
 * Declared in capture.meta.json — not inferred from raw byte equality (identity
 * bytes would prevent equality even when musical content matches).
 */
export function sameContentDifferentSlotDeviceEvidence(captures = CAPTURES) {
  for (const capture of captures) {
    const metaPath = path.resolve(resolveCaptureDir(capture), "capture.meta.json");
    const meta = JSON.parse(
      readRegularFileUnderRoot(metaPath, fixtureRootResolved()).toString("utf8"),
    );
    if (meta.same_content_different_slot_evidence === true) {
      return "PRESENT";
    }
  }
  return "ABSENT";
}

export function judgeBankInternalIdentity(classifiedCandidates) {
  const unresolved = classifiedCandidates.filter(
    (entry) => entry.classification === "UNRESOLVED_SLOT_CORRELATED",
  );
  if (unresolved.length > 0) {
    return "UNKNOWN";
  }
  const hadRawSlotCorrelation = classifiedCandidates.some(
    (entry) =>
      entry.classification !== "KNOWN_HEADER" &&
      entry.classification !== "CHECKSUM_DERIVED",
  );
  if (!hadRawSlotCorrelation) {
    return "NOT_OBSERVED";
  }
  return "UNKNOWN";
}

export function analyzeFixtures() {
  const bank01Buffers = CAPTURES.map((c) => readBankBytes(c, "bank01.work"));
  const bank02Buffers = CAPTURES.map((c) => readBankBytes(c, "bank02.work"));
  const bank01Varying = varyingOffsets(bank01Buffers);
  const bank02Varying = varyingOffsets(bank02Buffers);
  const { fileLength, candidates } = findSlotCorrelatedCandidates();
  const classified = classifyCandidates(
    candidates,
    bank01Varying,
    bank02Varying,
    fileLength,
  );
  const unresolved = classified.filter(
    (entry) => entry.classification === "UNRESOLVED_SLOT_CORRELATED",
  );

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
    slotCorrelatedCandidatesClassified: classified,
    slotCorrelatedCandidatesUnresolved: unresolved,
    sameContentDifferentSlotDeviceEvidence: sameContentDifferentSlotDeviceEvidence(),
    bankInternalIdentity: judgeBankInternalIdentity(classified),
  };
}

function main() {
  const report = analyzeFixtures();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
