import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSourceInventoryMatches,
  collectSourceInventory,
} from "./verify-ui-workspace-source-inventory.mjs";

test("source inventory records files and detects mutation, deletion, and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "mo-source-inventory-"));
  try {
    mkdirSync(join(root, "SET", "AUDIO"), { recursive: true });
    mkdirSync(join(root, "SET", "ACCEPT_PROJ"), { recursive: true });
    writeFileSync(join(root, "SET", "AUDIO", "ops_rename_src.wav"), "src");
    writeFileSync(join(root, "SET", "ACCEPT_PROJ", "project.work"), "work");
    symlinkSync("ops_rename_src.wav", join(root, "SET", "AUDIO", "alias.wav"));

    const before = collectSourceInventory(root);
    const paths = before.entries.map((entry) => entry.relativePath);
    assert.deepEqual(paths, [
      "SET",
      "SET/ACCEPT_PROJ",
      "SET/ACCEPT_PROJ/project.work",
      "SET/AUDIO",
      "SET/AUDIO/alias.wav",
      "SET/AUDIO/ops_rename_src.wav",
    ]);
    assertSourceInventoryMatches(before, collectSourceInventory(root));

    writeFileSync(join(root, "SET", "AUDIO", "ops_rename_src.wav"), "changed");
    assert.throws(
      () => assertSourceInventoryMatches(before, collectSourceInventory(root)),
      /source fixture inventory mismatch/,
    );
    writeFileSync(join(root, "SET", "AUDIO", "ops_rename_src.wav"), "src");
    rmSync(join(root, "SET", "ACCEPT_PROJ", "project.work"));
    assert.throws(
      () => assertSourceInventoryMatches(before, collectSourceInventory(root)),
      /source fixture inventory mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source inventory rejects a symlinked fixture root", () => {
  const parent = mkdtempSync(join(tmpdir(), "mo-source-inventory-link-"));
  try {
    const real = join(parent, "real");
    mkdirSync(real);
    const link = join(parent, "link");
    symlinkSync(real, link);
    assert.throws(() => collectSourceInventory(link), /must not be a symlink/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
