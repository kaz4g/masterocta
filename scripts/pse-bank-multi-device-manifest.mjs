#!/usr/bin/env node
/**
 * SHA-256 manifest for pse_bank_multi_device capture directories.
 * Read-only: never modifies fixture bytes (writes manifest sidecar only).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "masterocta-pse-bank-multi-device-manifest:v1";
const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/tests/fixtures/pse_bank_multi_device",
);

const TRACKED_GLOB = [
  "project.work",
  "project.strd",
  /^bank\d{2}\.(work|strd)$/,
  /^arr\d{2}\.(work|strd)$/,
  "markers.work",
  "markers.strd",
];

function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function listTrackedFiles(captureDir) {
  const names = readdirSync(captureDir).sort();
  return names.filter((name) => {
    if (TRACKED_GLOB.some((rule) =>
      typeof rule === "string" ? rule === name : rule.test(name),
    )) {
      return statSync(path.join(captureDir, name)).isFile();
    }
    return false;
  });
}

export function buildManifest(captureDir) {
  const files = listTrackedFiles(captureDir);
  const entries = files.map((name) => ({
    path: name,
    sha256: sha256File(path.join(captureDir, name)),
    size: statSync(path.join(captureDir, name)).size,
  }));
  return {
    schema: SCHEMA,
    capture: path.basename(captureDir),
    generated_at: new Date().toISOString(),
    files: entries,
  };
}

function main() {
  const [, , command, captureName] = process.argv;
  if (command !== "write" || !captureName) {
    console.error("Usage: node scripts/pse-bank-multi-device-manifest.mjs write <capture-dir-name>");
    process.exit(2);
  }
  const captureDir = path.join(ROOT, captureName);
  const manifest = buildManifest(captureDir);
  const outPath = path.join(captureDir, "SHA256SUMS.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath} (${manifest.files.length} files)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
