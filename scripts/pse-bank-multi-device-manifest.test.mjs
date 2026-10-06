import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest } from "./pse-bank-multi-device-manifest.mjs";

test("buildManifest lists project.work and bank files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pse-bank-manifest-"));
  writeFileSync(path.join(dir, "project.work"), "FORM", "utf8");
  writeFileSync(path.join(dir, "bank01.work"), "BANK", "utf8");
  const manifest = buildManifest(dir);
  assert.equal(manifest.schema, "masterocta-pse-bank-multi-device-manifest:v1");
  assert.equal(manifest.files.length, 2);
  const paths = manifest.files.map((entry) => entry.path);
  assert.deepEqual(paths, ["bank01.work", "project.work"]);
});
