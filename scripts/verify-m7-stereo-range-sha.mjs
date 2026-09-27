#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectScriptInvocation } from "./compare-script-invocation.mjs";

export const M7_STEREO_RANGE_SHA256 =
  "219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c";

/**
 * @param {string} stereoWavPath
 */
export function verifyStereoRangeWavSha256(stereoWavPath) {
  const path = resolve(stereoWavPath);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== M7_STEREO_RANGE_SHA256) {
    throw new Error(
      `STEREO_RANGE.wav SHA-256 mismatch: expected ${M7_STEREO_RANGE_SHA256}, got ${actual} (${path})`,
    );
  }
  return actual;
}

function main() {
  const wavPath = process.argv[2];
  if (!wavPath) {
    console.error("Usage: node scripts/verify-m7-stereo-range-sha.mjs <path/to/STEREO_RANGE.wav>");
    process.exit(2);
  }
  try {
    console.log(verifyStereoRangeWavSha256(wavPath));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isDirectScriptInvocation(import.meta.url)) {
  main();
}
