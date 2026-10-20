#!/usr/bin/env node
// Records or compares every file under a synthetic UI-workspace fixture.
// Symlinks are recorded and not followed. Absolute paths are not stored.
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { isDirectScriptInvocation } from "./compare-script-invocation.mjs";
import {
  assertNotSymlink,
  isPathInside,
  trustedTempRoots,
} from "./ui-workspace-fixture-safe.mjs";

/**
 * @param {string} fixtureRoot
 */
export function collectSourceInventory(fixtureRoot) {
  if (typeof fixtureRoot !== "string" || fixtureRoot.trim() === "") {
    throw new Error("source fixture path is required");
  }
  assertNotSymlink(fixtureRoot, "source fixture root");
  const root = realpathSync(fixtureRoot);
  assertNotSymlink(root, "canonical source fixture root");
  const trusted = trustedTempRoots();
  if (!trusted.some((temp) => isPathInside(root, temp))) {
    throw new Error(`source fixture must live under a trusted temp directory (got ${root})`);
  }
  /** @type {Array<Record<string, string | number>>} */
  const entries = [];
  /**
   * @param {string} dir
   */
  function walk(dir) {
    const names = readdirSync(dir).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const absolute = join(dir, name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        entries.push({
          relativePath,
          kind: "symlink",
          linkTarget: readlinkSync(absolute),
        });
        continue;
      }
      if (stat.isDirectory()) {
        entries.push({ relativePath, kind: "directory" });
        walk(absolute);
        continue;
      }
      if (!stat.isFile()) {
        entries.push({ relativePath, kind: "other" });
        continue;
      }
      const bytes = readFileSync(absolute);
      entries.push({
        relativePath,
        kind: "file",
        byteSize: stat.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  walk(root);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { version: 1, entries };
}

/**
 * @param {unknown} inventory
 * @returns {string}
 */
export function inventoryKey(inventory) {
  return JSON.stringify(inventory);
}

/**
 * @param {unknown} expected
 * @param {ReturnType<typeof collectSourceInventory>} actual
 */
export function assertSourceInventoryMatches(expected, actual) {
  if (inventoryKey(expected) !== inventoryKey(actual)) {
    throw new Error("source fixture inventory mismatch");
  }
}

function readInventory(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("source inventory is not version 1");
  }
  return parsed;
}

function main() {
  const mode = process.argv[2];
  const inventoryPath = process.argv[3];
  const fixtureRoot = process.argv[4];
  if ((mode !== "--write" && mode !== "--expect") || !inventoryPath || !fixtureRoot) {
    console.error(
      "Usage: node scripts/verify-ui-workspace-source-inventory.mjs --write <inventory.json> <fixture-root>",
    );
    console.error(
      "       node scripts/verify-ui-workspace-source-inventory.mjs --expect <inventory.json> <fixture-root>",
    );
    process.exit(2);
  }
  try {
    const actual = collectSourceInventory(fixtureRoot);
    if (mode === "--write") {
      writeFileSync(inventoryPath, `${JSON.stringify(actual, null, 2)}\n`, { flag: "wx" });
      console.log(`source_inventory=RECORDED entries=${actual.entries.length}`);
      return;
    }
    assertSourceInventoryMatches(readInventory(inventoryPath), actual);
    console.log(`source_inventory=PASS entries=${actual.entries.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isDirectScriptInvocation(import.meta.url)) {
  main();
}
