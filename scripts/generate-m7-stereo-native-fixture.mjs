#!/usr/bin/env node
/**
 * Disposable two-channel fixture for M7 integrated Native group B (stereo lanes).
 * Does not modify mono RANGE.wav or generate-ui-workspace-native-fixture.mjs.
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectScriptInvocation } from "./compare-script-invocation.mjs";
import {
  cleanupOwnedFixtureRoot,
  createManagedFixtureRoot,
  validateEmptyFixtureRoot,
  writeFileExclusive,
} from "./ui-workspace-fixture-safe.mjs";
import { M7_STEREO_RANGE_SHA256 } from "./verify-m7-stereo-range-sha.mjs";

const RATE = 44_100;
const CHANNELS = 2;
const BITS = 16;
const PEAK = 0.8;
const FRAME_COUNT = RATE * 4;
const ATTACK_FRAMES_LEFT = [4_410, 26_460, 88_200];
const ATTACK_FRAMES_RIGHT = [13_230, 52_920, 110_250];

function burstSample(offset, rate, seed) {
  const phase = ((offset * 1103515245 + seed) >>> 0) >> 8 & 65535;
  return (
    (phase / 32768 - 1) *
    Math.exp(-offset / (rate * 0.0025)) *
    PEAK
  );
}

function buildMonoPcm(frameCount, attackFrames, seed) {
  const samples = new Float32Array(frameCount);
  const burstLen = RATE / 80;
  for (const attack of attackFrames) {
    for (let offset = 0; offset < burstLen; offset++) {
      const n = attack + offset;
      if (n >= frameCount) break;
      samples[n] = burstSample(offset, RATE, seed);
    }
  }
  return samples;
}

function interleaveStereo(left, right) {
  const out = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    out[i * 2] = left[i];
    out[i * 2 + 1] = right[i];
  }
  return out;
}

function floatToInt16Interleaved(samples) {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return out;
}

function wavHeader(dataBytes) {
  const blockAlign = (CHANNELS * BITS) / 8;
  const byteRate = RATE * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function buildStereoWavBuffer() {
  const left = buildMonoPcm(FRAME_COUNT, ATTACK_FRAMES_LEFT, 12_345);
  const right = buildMonoPcm(FRAME_COUNT, ATTACK_FRAMES_RIGHT, 98_765);
  const interleaved = interleaveStereo(left, right);
  const data = floatToInt16Interleaved(interleaved);
  const file = Buffer.concat([wavHeader(data.length), data]);
  return { file, frameCount: FRAME_COUNT, left, right };
}

/**
 * @param {{ fixtureRoot?: string }} options
 */
export async function generateM7StereoNativeFixture(options = {}) {
  let ownedRoot = null;
  let fixtureRoot;
  if (options.fixtureRoot) {
    fixtureRoot = validateEmptyFixtureRoot(options.fixtureRoot);
  } else {
    fixtureRoot = createManagedFixtureRoot();
    ownedRoot = fixtureRoot;
  }

  try {
    const { file, frameCount, left, right } = buildStereoWavBuffer();
    const relativePath = "SET/AUDIO/STEREO_RANGE.wav";
    const wavPath = join(fixtureRoot, relativePath);
    writeFileExclusive(wavPath, file);
    const sha256 = createHash("sha256").update(file).digest("hex");
    if (sha256 !== M7_STEREO_RANGE_SHA256) {
      throw new Error(
        `STEREO_RANGE.wav SHA-256 drift: expected ${M7_STEREO_RANGE_SHA256}, got ${sha256}`,
      );
    }

    return {
      fixtureRoot,
      ownedRoot,
      generator: "generate-m7-stereo-native-fixture.mjs",
      files: [{
        pathRelative: relativePath.replace(/\\/g, "/"),
        byteSize: file.length,
        sha256,
        sampleRate: RATE,
        channels: CHANNELS,
        bitsPerSample: BITS,
        frameCount,
        role: "stereoSample",
        attackFramesLeft: ATTACK_FRAMES_LEFT,
        attackFramesRight: ATTACK_FRAMES_RIGHT,
        leftDistinctFromRight: left.some((v, i) => v !== right[i]),
      }],
    };
  } catch (error) {
    if (ownedRoot) cleanupOwnedFixtureRoot(ownedRoot);
    throw error;
  }
}

async function main() {
  const manifest = await generateM7StereoNativeFixture();
  console.log(JSON.stringify(manifest, null, 2));
}

if (isDirectScriptInvocation(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
