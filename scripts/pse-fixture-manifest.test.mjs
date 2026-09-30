import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPARE_SCHEMA,
  MANIFEST_SCHEMA,
  ManifestStop,
  captureRoot,
  captureToFile,
  compareManifests,
  loadManifestFile,
  runCli,
} from "./pse-fixture-manifest.mjs";

const scriptPath = fileURLToPath(
  new URL("./pse-fixture-manifest.mjs", import.meta.url),
);

function makeTree() {
  const root = mkdtempSync(path.join(tmpdir(), "pse-manifest-"));
  mkdirSync(path.join(root, "SET", "PROJECT"), { recursive: true });
  writeFileSync(path.join(root, "SET", "PROJECT", "bank01.work"), "bank-bytes");
  writeFileSync(path.join(root, "SET", "PROJECT", "project.work"), "project-v1");
  writeFileSync(path.join(root, "keep.txt"), "sentinel");
  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("pse fixture manifest capture", () => {
  it("is deterministic and path-ordered", () => {
    const root = makeTree();
    try {
      const first = captureRoot(root);
      const second = captureRoot(root);
      assert.equal(first.schema, MANIFEST_SCHEMA);
      assert.deepEqual(first, second);
      const paths = first.entries.map((entry) => entry.relative_path);
      const sorted = [...paths].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      );
      assert.deepEqual(paths, sorted);
      assert.ok(first.entries.every((entry) => !path.isAbsolute(entry.relative_path)));
    } finally {
      cleanup(root);
    }
  });

  it("records symlink text without following an external target", () => {
    const root = makeTree();
    const outside = mkdtempSync(path.join(tmpdir(), "pse-outside-"));
    try {
      const target = path.join(outside, "secret.bin");
      writeFileSync(target, "do-not-hash-me");
      symlinkSync(target, path.join(root, "SET", "PROJECT", "bank02.work"));
      const manifest = captureRoot(root);
      const link = manifest.entries.find(
        (entry) => entry.relative_path === "SET/PROJECT/bank02.work",
      );
      assert.equal(link.entry_type, "symlink");
      assert.equal(link.link_target, target);
      assert.equal(link.sha256, undefined);
      assert.ok(
        !manifest.entries.some((entry) =>
          String(entry.sha256 ?? "").includes("do-not-hash-me"),
        ),
      );
    } finally {
      cleanup(root);
      cleanup(outside);
    }
  });

  it("refuses to write a manifest inside the tree", () => {
    const root = makeTree();
    try {
      assert.throws(
        () => captureToFile(root, path.join(root, "pre.json")),
        (error) => error instanceof ManifestStop && error.code === "OUTPUT_INSIDE_ROOT",
      );
    } finally {
      cleanup(root);
    }
  });
});

describe("pse fixture manifest negative compare", () => {
  function pair(root) {
    const evidence = mkdtempSync(path.join(tmpdir(), "pse-evidence-"));
    const prePath = path.join(evidence, "pre.json");
    captureToFile(root, prePath);
    return { evidence, prePath };
  }

  it("detects a one-byte content change and exits 2", () => {
    const root = makeTree();
    const { evidence, prePath } = pair(root);
    try {
      writeFileSync(path.join(root, "keep.txt"), "sentineX");
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.schema, COMPARE_SCHEMA);
      assert.equal(report.verdict, "FAIL");
      assert.equal(report.diffs[0].class, "content_changed");
      const cli = spawnSync(process.execPath, [
        scriptPath,
        "compare",
        "--pre",
        prePath,
        "--post",
        postPath,
      ]);
      assert.equal(cli.status, 2);
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });

  it("detects an added file", () => {
    const root = makeTree();
    const { evidence, prePath } = pair(root);
    try {
      writeFileSync(path.join(root, "SET", "PROJECT", "extra.txt"), "new");
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.verdict, "FAIL");
      assert.ok(report.diffs.some((diff) => diff.class === "added"));
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });

  it("detects a deleted file", () => {
    const root = makeTree();
    const { evidence, prePath } = pair(root);
    try {
      rmSync(path.join(root, "keep.txt"));
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.verdict, "FAIL");
      assert.ok(report.diffs.some((diff) => diff.class === "removed"));
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });

  it("detects a rename", () => {
    const root = makeTree();
    const { evidence, prePath } = pair(root);
    try {
      renameSync(path.join(root, "keep.txt"), path.join(root, "kept.txt"));
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.verdict, "FAIL");
      assert.ok(
        report.diffs.some(
          (diff) =>
            diff.class === "renamed" &&
            diff.from === "keep.txt" &&
            diff.to === "kept.txt",
        ),
      );
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });

  it("detects a symlink target change", () => {
    const root = makeTree();
    symlinkSync("bank01.work", path.join(root, "SET", "PROJECT", "alias.work"));
    const { evidence, prePath } = pair(root);
    try {
      rmSync(path.join(root, "SET", "PROJECT", "alias.work"));
      symlinkSync("project.work", path.join(root, "SET", "PROJECT", "alias.work"));
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.verdict, "FAIL");
      assert.ok(report.diffs.some((diff) => diff.class === "link_changed"));
      const cli = spawnSync(process.execPath, [
        scriptPath,
        "compare",
        "--pre",
        prePath,
        "--post",
        postPath,
      ]);
      assert.equal(cli.status, 2);
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });

  it("passes when the tree is unchanged", () => {
    const root = makeTree();
    const { evidence, prePath } = pair(root);
    try {
      const postPath = path.join(evidence, "post.json");
      captureToFile(root, postPath);
      const report = compareManifests(
        loadManifestFile(prePath, "pre"),
        loadManifestFile(postPath, "post"),
      );
      assert.equal(report.verdict, "PASS");
      assert.equal(
        runCli([
          process.execPath,
          scriptPath,
          "compare",
          "--pre",
          prePath,
          "--post",
          postPath,
        ]),
        0,
      );
    } finally {
      cleanup(root);
      cleanup(evidence);
    }
  });
});

describe("pse fixture manifest package wiring", () => {
  it("keeps the script importable by the Node test runner", () => {
    const source = readFileSync(scriptPath, "utf8");
    assert.match(source, /masterocta-pse-fixture-manifest:v1/);
    assert.match(source, /entry_type === "symlink"/);
  });
});
