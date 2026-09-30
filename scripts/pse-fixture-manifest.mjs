#!/usr/bin/env node
/**
 * PRE/POST fixture manifest for Project Structure read-only CI.
 *
 * Unlike the Gate C byte-manifest, this recorder keeps symlink entries
 * (raw link text only) and never follows an external target. Manifests and
 * reports must be written outside the copied Project tree.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MANIFEST_SCHEMA = "masterocta-pse-fixture-manifest:v1";
export const COMPARE_SCHEMA = "masterocta-pse-fixture-manifest-compare:v1";
const HASH_PREFIX = "sha256:";
const PARTIAL_SUFFIX = ".partial";

export class ManifestStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManifestStop";
    this.code = code;
  }
}

export function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function resolvedPathForContainment(inputPath) {
  const absolute = path.resolve(inputPath);
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      return missing.reduce(
        (acc, part) => path.join(acc, part),
        realpathSync(current),
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new ManifestStop(
          "UNREADABLE",
          `could not resolve ${JSON.stringify(inputPath)}: ${error.code ?? error.message}`,
        );
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ManifestStop(
        "UNREADABLE",
        `could not resolve ${JSON.stringify(inputPath)}`,
      );
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
}

function pathIsInsideRoot(rootPath, candidatePath) {
  const rootReal = realpathSync(rootPath);
  const candidateReal = resolvedPathForContainment(candidatePath);
  const relative = path.relative(rootReal, candidateReal);
  if (relative === "") {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  return !relative.split(path.sep).includes("..");
}

function assertOutputOutsideRoot(rootPath, outputPath) {
  if (pathIsInsideRoot(rootPath, outputPath)) {
    throw new ManifestStop(
      "OUTPUT_INSIDE_ROOT",
      "write the manifest outside the copied Project tree",
    );
  }
}

function posixRelative(root, target) {
  const relative = path.relative(root, target);
  const parts = relative.split(path.sep);
  if (relative === "" || parts.includes("..") || path.isAbsolute(relative)) {
    throw new ManifestStop(
      "PATH_ESCAPE",
      "captured path left the fixture root",
    );
  }
  return relative.split(path.sep).join("/");
}

function fileTypeKind(stats) {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSocket()) return "socket";
  if (stats.isFIFO()) return "fifo";
  if (stats.isCharacterDevice() || stats.isBlockDevice()) return "device";
  return "unknown";
}

function assertAllowedKind(kind, relativePath) {
  if (kind === "file" || kind === "directory" || kind === "symlink") {
    return;
  }
  throw new ManifestStop(
    "FORBIDDEN_ENTRY_TYPE",
    `forbidden entry type ${kind} at ${JSON.stringify(relativePath)}`,
  );
}

function openRegularFileNofollow(absolutePath) {
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW === undefined ? 0 : constants.O_NOFOLLOW);
  try {
    return openSync(absolutePath, flags);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not open ${JSON.stringify(absolutePath)}: ${error.code ?? error.message}`,
    );
  }
}

function hashRegularFile(absolutePath, expectedSize) {
  const before = lstatSync(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new ManifestStop(
      "FORBIDDEN_ENTRY_TYPE",
      "path is no longer a regular file",
    );
  }
  if (before.size !== expectedSize) {
    throw new ManifestStop(
      "CHANGED_DURING_CAPTURE",
      "file size changed before hashing",
    );
  }
  const fd = openRegularFileNofollow(absolutePath);
  const hasher = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) {
        break;
      }
      total += read;
      hasher.update(buffer.subarray(0, read));
    }
    if (total !== expectedSize) {
      throw new ManifestStop(
        "CHANGED_DURING_CAPTURE",
        "file size changed while hashing",
      );
    }
  } finally {
    closeSync(fd);
  }
  return HASH_PREFIX + hasher.digest("hex");
}

function fileEntry(relativePath, stats, absolutePath) {
  return {
    relative_path: relativePath,
    entry_type: "file",
    byte_size: stats.size,
    sha256: hashRegularFile(absolutePath, stats.size),
  };
}

function directoryEntry(relativePath) {
  return {
    relative_path: relativePath,
    entry_type: "directory",
  };
}

function symlinkEntry(relativePath, absolutePath) {
  let linkTarget;
  try {
    linkTarget = readlinkSync(absolutePath, { encoding: "utf8" });
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read symlink ${JSON.stringify(relativePath)}: ${error.code ?? error.message}`,
    );
  }
  return {
    relative_path: relativePath,
    entry_type: "symlink",
    link_target: linkTarget,
  };
}

function sortedDirentNames(directory) {
  let dirents;
  try {
    dirents = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read directory ${JSON.stringify(directory)}: ${error.code ?? error.message}`,
    );
  }
  return dirents.map((entry) => entry.name).sort(compareUtf8);
}

function walk(root, current, entries) {
  let stats;
  try {
    stats = lstatSync(current);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not stat ${JSON.stringify(current)}: ${error.code ?? error.message}`,
    );
  }
  const kind = fileTypeKind(stats);
  if (current === root) {
    if (kind !== "directory" || stats.isSymbolicLink()) {
      throw new ManifestStop(
        "INVALID_ROOT",
        "fixture root must be a real directory, not a symlink",
      );
    }
  } else {
    const relativePath = posixRelative(root, current);
    assertAllowedKind(kind, relativePath);
    if (kind === "directory") {
      entries.push(directoryEntry(relativePath));
    } else if (kind === "symlink") {
      entries.push(symlinkEntry(relativePath, current));
      return;
    } else {
      entries.push(fileEntry(relativePath, stats, current));
      return;
    }
  }

  if (kind !== "directory") {
    return;
  }
  for (const name of sortedDirentNames(current)) {
    walk(root, path.join(current, name), entries);
  }
}

export function captureRoot(rootPath) {
  const root = path.resolve(rootPath);
  let rootStats;
  try {
    rootStats = lstatSync(root);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not stat fixture root: ${error.code ?? error.message}`,
    );
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new ManifestStop(
      "INVALID_ROOT",
      "fixture root must be a real directory, not a symlink",
    );
  }
  const entries = [];
  walk(root, root, entries);
  entries.sort((left, right) =>
    compareUtf8(left.relative_path, right.relative_path),
  );
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.relative_path)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `duplicate relative path ${JSON.stringify(entry.relative_path)}`,
      );
    }
    seen.add(entry.relative_path);
  }
  return {
    schema: MANIFEST_SCHEMA,
    entry_count: entries.length,
    entries,
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeJsonAtomic(outputPath, value) {
  const destination = path.resolve(outputPath);
  mkdirSync(path.dirname(destination), { recursive: true });
  const partial = destination + PARTIAL_SUFFIX;
  try {
    writeFileSync(partial, serializeManifest(value), { flag: "w", mode: 0o600 });
    renameSync(partial, destination);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // Ignore cleanup failure; the completed destination must not be a partial.
    }
    if (error instanceof ManifestStop) {
      throw error;
    }
    throw new ManifestStop(
      "WRITE_FAILED",
      `could not write ${destination}: ${error.code ?? error.message}`,
    );
  }
}

export function captureToFile(rootPath, outputPath) {
  const root = path.resolve(rootPath);
  const destination = path.resolve(outputPath);
  assertOutputOutsideRoot(root, destination);
  const manifest = captureRoot(root);
  writeJsonAtomic(destination, manifest);
  return manifest;
}

function requireObject(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestStop(code, message);
  }
  return value;
}

export function parseManifest(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestStop("MALFORMED_MANIFEST", `${label} is not valid JSON`);
  }
  const manifest = requireObject(
    parsed,
    "MALFORMED_MANIFEST",
    `${label} is not an object`,
  );
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new ManifestStop(
      "SCHEMA_MISMATCH",
      `${label} schema is ${JSON.stringify(manifest.schema)}`,
    );
  }
  if (!Array.isArray(manifest.entries)) {
    throw new ManifestStop("MALFORMED_MANIFEST", `${label} entries are missing`);
  }
  const seen = new Set();
  const entries = [];
  for (const entry of manifest.entries) {
    const item = requireObject(
      entry,
      "MALFORMED_MANIFEST",
      `${label} contains a malformed entry`,
    );
    if (typeof item.relative_path !== "string" || item.relative_path === "") {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} contains an entry without a relative path`,
      );
    }
    if (seen.has(item.relative_path)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `${label} duplicates ${JSON.stringify(item.relative_path)}`,
      );
    }
    seen.add(item.relative_path);
    if (item.entry_type === "file") {
      if (
        typeof item.byte_size !== "number" ||
        typeof item.sha256 !== "string" ||
        !item.sha256.startsWith(HASH_PREFIX)
      ) {
        throw new ManifestStop(
          "MALFORMED_MANIFEST",
          `${label} file entry ${JSON.stringify(item.relative_path)} is malformed`,
        );
      }
    } else if (item.entry_type === "symlink") {
      if (typeof item.link_target !== "string") {
        throw new ManifestStop(
          "MALFORMED_MANIFEST",
          `${label} symlink ${JSON.stringify(item.relative_path)} is missing link_target`,
        );
      }
    } else if (item.entry_type !== "directory") {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} has unsupported entry type ${JSON.stringify(item.entry_type)}`,
      );
    }
    entries.push(item);
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (
      compareUtf8(entries[index - 1].relative_path, entries[index].relative_path) >
      0
    ) {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} entries are not in deterministic path order`,
      );
    }
  }
  return { ...manifest, entries };
}

export function loadManifestFile(filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read ${label}: ${error.code ?? error.message}`,
    );
  }
  return parseManifest(raw, label);
}

function identityKey(entry) {
  if (entry.entry_type === "file") {
    return `file:${entry.byte_size}:${entry.sha256}`;
  }
  if (entry.entry_type === "symlink") {
    return `symlink:${entry.link_target}`;
  }
  return "directory";
}

function identitiesEqual(left, right) {
  return (
    left.entry_type === right.entry_type &&
    left.byte_size === right.byte_size &&
    left.sha256 === right.sha256 &&
    left.link_target === right.link_target
  );
}

export function diffManifests(pre, post) {
  const preByPath = new Map(pre.entries.map((entry) => [entry.relative_path, entry]));
  const postByPath = new Map(
    post.entries.map((entry) => [entry.relative_path, entry]),
  );
  const paths = [...new Set([...preByPath.keys(), ...postByPath.keys()])].sort(
    compareUtf8,
  );
  const diffs = [];
  let unchangedCount = 0;
  for (const relativePath of paths) {
    const before = preByPath.get(relativePath);
    const after = postByPath.get(relativePath);
    if (before && after) {
      if (before.entry_type !== after.entry_type) {
        diffs.push({
          class: "type_changed",
          relative_path: relativePath,
          pre: before,
          post: after,
        });
      } else if (
        before.entry_type === "symlink" &&
        before.link_target !== after.link_target
      ) {
        diffs.push({
          class: "link_changed",
          relative_path: relativePath,
          pre: before,
          post: after,
        });
      } else if (!identitiesEqual(before, after)) {
        diffs.push({
          class: "content_changed",
          relative_path: relativePath,
          pre: before,
          post: after,
        });
      } else {
        unchangedCount += 1;
      }
    } else if (before && !after) {
      diffs.push({
        class: "removed",
        relative_path: relativePath,
        pre: before,
        post: null,
      });
    } else {
      diffs.push({
        class: "added",
        relative_path: relativePath,
        pre: null,
        post: after,
      });
    }
  }

  const removed = diffs.filter((diff) => diff.class === "removed");
  const added = diffs.filter((diff) => diff.class === "added");
  const usedRemoved = new Set();
  const usedAdded = new Set();
  const renames = [];
  for (const gone of removed) {
    const match = added.find(
      (incoming) =>
        !usedAdded.has(incoming.relative_path) &&
        gone.pre &&
        incoming.post &&
        identityKey(gone.pre) === identityKey(incoming.post) &&
        gone.pre.entry_type !== "directory",
    );
    if (!match) {
      continue;
    }
    usedRemoved.add(gone.relative_path);
    usedAdded.add(match.relative_path);
    renames.push({
      class: "renamed",
      relative_path: match.relative_path,
      from: gone.relative_path,
      to: match.relative_path,
      pre: gone.pre,
      post: match.post,
    });
  }

  const remaining = diffs.filter(
    (diff) =>
      !(
        (diff.class === "removed" && usedRemoved.has(diff.relative_path)) ||
        (diff.class === "added" && usedAdded.has(diff.relative_path))
      ),
  );
  remaining.push(...renames);
  remaining.sort(
    (left, right) =>
      compareUtf8(left.relative_path, right.relative_path) ||
      compareUtf8(left.class, right.class),
  );
  return { diffs: remaining, unchangedCount };
}

export function compareManifests(pre, post) {
  if (pre.schema !== post.schema) {
    return {
      schema: COMPARE_SCHEMA,
      verdict: "FAIL",
      stop_reason: "SCHEMA_MISMATCH: manifest schema mismatch",
      pre_entry_count: pre.entry_count,
      post_entry_count: post.entry_count,
      unchanged_count: 0,
      diffs: [],
    };
  }
  const { diffs, unchangedCount } = diffManifests(pre, post);
  return {
    schema: COMPARE_SCHEMA,
    verdict: diffs.length === 0 ? "PASS" : "FAIL",
    stop_reason:
      diffs.length === 0
        ? null
        : `UNEXPECTED_DIFF: ${diffs.map((diff) => `${diff.class}:${diff.relative_path}`).join(",")}`,
    pre_entry_count: pre.entry_count,
    post_entry_count: post.entry_count,
    unchanged_count: unchangedCount,
    diffs,
  };
}

export function formatSummary(report) {
  const lines = [
    `verdict: ${report.verdict}`,
    `unchanged: ${report.unchanged_count}`,
    `diffs: ${report.diffs.length}`,
  ];
  if (report.stop_reason) {
    lines.push(`stop_reason: ${report.stop_reason}`);
  }
  for (const diff of report.diffs) {
    const rename =
      diff.class === "renamed" ? ` ${JSON.stringify(diff.from)} ->` : "";
    lines.push(`${diff.class}${rename} ${JSON.stringify(diff.relative_path)}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage:
  node scripts/pse-fixture-manifest.mjs capture --root <tree> --output <manifest.json>
  node scripts/pse-fixture-manifest.mjs compare --pre <pre.json> --post <post.json> [--report <report.json>]

Write manifests and reports outside the copied Project tree.
`;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new ManifestStop("USAGE", `missing value for ${name}`);
  }
  return value;
}

export function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];
  if (command === "capture") {
    const root = takeOption(args, "--root");
    const output = takeOption(args, "--output");
    if (!root || !output) {
      throw new ManifestStop("USAGE", usage());
    }
    const manifest = captureToFile(root, output);
    process.stdout.write(
      `captured entries=${manifest.entry_count} output=${output}\n`,
    );
    return 0;
  }
  if (command === "compare") {
    const prePath = takeOption(args, "--pre");
    const postPath = takeOption(args, "--post");
    const reportPath = takeOption(args, "--report");
    if (!prePath || !postPath) {
      throw new ManifestStop("USAGE", usage());
    }
    const pre = loadManifestFile(prePath, "pre-run manifest");
    const post = loadManifestFile(postPath, "post-run manifest");
    const report = compareManifests(pre, post);
    process.stdout.write(formatSummary(report));
    if (reportPath) {
      writeJsonAtomic(reportPath, report);
    }
    return report.verdict === "PASS" ? 0 : 2;
  }
  throw new ManifestStop("USAGE", usage());
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    const code = error instanceof ManifestStop ? error.code : "ERROR";
    process.stderr.write(`STOP ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
