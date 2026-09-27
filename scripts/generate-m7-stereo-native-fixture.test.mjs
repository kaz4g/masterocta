import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { generateM7StereoNativeFixture } from "./generate-m7-stereo-native-fixture.mjs";
import { cleanupOwnedFixtureRoot } from "./ui-workspace-fixture-safe.mjs";
import {
  M7_STEREO_RANGE_SHA256,
  verifyStereoRangeWavSha256,
} from "./verify-m7-stereo-range-sha.mjs";

test("managed stereo generation matches fixed SHA and channel layout", async () => {
  const manifest = await generateM7StereoNativeFixture();
  try {
    const stereo = manifest.files[0];
    assert.equal(stereo.sha256, M7_STEREO_RANGE_SHA256);
    assert.equal(stereo.channels, 2);
    assert.equal(stereo.sampleRate, 44100);
    assert.equal(stereo.frameCount, 44100 * 4);
    assert.equal(stereo.leftDistinctFromRight, true);
    const path = join(manifest.fixtureRoot, stereo.pathRelative);
    verifyStereoRangeWavSha256(path);
  } finally {
    cleanupOwnedFixtureRoot(manifest.fixtureRoot);
  }
});
