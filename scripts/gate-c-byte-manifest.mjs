#!/usr/bin/env node
/**
 * Deterministic pre/post per-file byte manifest for Human Gate C.
 *
 * Content hashes are SHA-256 of file bytes. Catalog hash reuse is never used.
 * Generated manifests may contain personal sample names; keep them outside the
 * repository and do not commit them.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  closeSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_SCHEMA = "masterocta-gate-c-byte-manifest:v1";
export const EXCLUSION_POLICY = "host-metadata-allowlist:v1";
export const EXPECTED_SCHEMA = "masterocta-gate-c-expected-changes:v1";
export const COMPARE_SCHEMA = "masterocta-gate-c-byte-manifest-compare:v1";
export const COMMITTED_EVIDENCE_SCHEMA = "rename-committed-evidence:v1";
export const RENAME_PLAN_SCHEMA = "rename-plan:v1";
export const PREPARED_RENAME_PLAN_SCHEMA = "masterocta-prepared-rename-plan:v1";
export const EXCLUSION_POLICY_NAMES = [
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".DS_Store",
  "._*",
];

const HASH_PREFIX = "sha256:";
const PARTIAL_SUFFIX = ".partial";

export class ManifestStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManifestStop";
    this.code = code;
  }
}

export function isIgnoredHostMetadata(name) {
  return (
    name === ".Spotlight-V100" ||
    name === ".Trashes" ||
    name === ".fseventsd" ||
    name === ".DS_Store" ||
    name.startsWith("._")
  );
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
      "write the manifest outside the clone root",
    );
  }
}

function sameResolvedPath(left, right) {
  return resolvedPathForContainment(left) === resolvedPathForContainment(right);
}

function assertReportDoesNotClobberInputs(reportPath, inputPaths) {
  for (const inputPath of inputPaths) {
    if (inputPath && sameResolvedPath(reportPath, inputPath)) {
      throw new ManifestStop(
        "OUTPUT_ALIASES_INPUT",
        "report path must not overwrite pre, post, or expected files",
      );
    }
  }
}

function isContentHash(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function posixRelative(root, target) {
  const relative = path.relative(root, target);
  const parts = relative.split(path.sep);
  if (relative === "" || parts.includes("..") || path.isAbsolute(relative)) {
    throw new ManifestStop(
      "PATH_ESCAPE",
      "captured path left the clone root",
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
  if (kind === "file" || kind === "directory") {
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
  const after = lstatSync(absolutePath);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.size !== expectedSize ||
    after.mtimeMs !== before.mtimeMs
  ) {
    throw new ManifestStop(
      "CHANGED_DURING_CAPTURE",
      "file changed while hashing",
    );
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

export function decodeUtf8EntryName(name) {
  if (typeof name === "string") {
    if (Buffer.from(name, "utf8").toString("utf8") !== name) {
      throw new ManifestStop(
        "NON_UTF8_NAME",
        "directory contains a non-UTF-8 name",
      );
    }
    return name;
  }
  if (!Buffer.isBuffer(name)) {
    throw new ManifestStop(
      "NON_UTF8_NAME",
      "directory contains a non-UTF-8 name",
    );
  }
  const decoded = name.toString("utf8");
  if (Buffer.from(decoded, "utf8").compare(name) !== 0) {
    throw new ManifestStop(
      "NON_UTF8_NAME",
      "directory contains a non-UTF-8 name",
    );
  }
  return decoded;
}

function sortedDirentNames(directory) {
  let dirents;
  try {
    dirents = readdirSync(directory, { withFileTypes: true, encoding: "buffer" });
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not read directory ${JSON.stringify(directory)}: ${error.code ?? error.message}`,
    );
  }
  const names = [];
  for (const dirent of dirents) {
    names.push(decodeUtf8EntryName(dirent.name));
  }
  return names.sort(compareUtf8);
}

function walk(root, current, entries, excludedCount) {
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
  const relativePath = current === root ? "" : posixRelative(root, current);
  if (current !== root) {
    assertAllowedKind(kind, relativePath);
    if (kind === "directory") {
      entries.push(directoryEntry(relativePath));
    } else {
      entries.push(fileEntry(relativePath, stats, current));
    }
  } else if (kind !== "directory" || stats.isSymbolicLink()) {
    throw new ManifestStop(
      "INVALID_ROOT",
      "clone root must be a real directory",
    );
  }

  if (kind !== "directory") {
    return excludedCount;
  }

  for (const name of sortedDirentNames(current)) {
    if (isIgnoredHostMetadata(name)) {
      excludedCount += 1;
      continue;
    }
    excludedCount = walk(root, path.join(current, name), entries, excludedCount);
  }
  return excludedCount;
}

export function captureRoot(rootPath) {
  const root = path.resolve(rootPath);
  let rootStats;
  try {
    rootStats = lstatSync(root);
  } catch (error) {
    throw new ManifestStop(
      "UNREADABLE",
      `could not stat clone root: ${error.code ?? error.message}`,
    );
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new ManifestStop(
      "INVALID_ROOT",
      "clone root must be a real directory, not a symlink",
    );
  }
  const entries = [];
  const excludedEntryCount = walk(root, root, entries, 0);
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
    exclusion_policy: EXCLUSION_POLICY,
    exclusion_policy_names: [...EXCLUSION_POLICY_NAMES],
    excluded_entry_count: excludedEntryCount,
    entry_count: entries.length,
    entries,
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeManifestAtomic(outputPath, manifest) {
  const destination = path.resolve(outputPath);
  const directory = path.dirname(destination);
  mkdirSync(directory, { recursive: true });
  const partial = destination + PARTIAL_SUFFIX;
  try {
    writeFileSync(partial, serializeManifest(manifest), {
      flag: "w",
      mode: 0o600,
    });
    chmodSync(partial, 0o600);
    renameSync(partial, destination);
    chmodSync(destination, 0o600);
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
      `could not write manifest: ${error.code ?? error.message}`,
    );
  }
}

export function captureToFile(rootPath, outputPath) {
  const root = path.resolve(rootPath);
  const destination = path.resolve(outputPath);
  assertOutputOutsideRoot(root, destination);
  const manifest = captureRoot(root);
  writeManifestAtomic(destination, manifest);
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
  if (manifest.exclusion_policy !== EXCLUSION_POLICY) {
    throw new ManifestStop(
      "EXCLUSION_POLICY_MISMATCH",
      `${label} exclusion policy is ${JSON.stringify(manifest.exclusion_policy)}`,
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
    } else if (item.entry_type !== "directory") {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} has unsupported entry type ${JSON.stringify(item.entry_type)}`,
      );
    }
    entries.push(item);
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (compareUtf8(entries[index - 1].relative_path, entries[index].relative_path) > 0) {
      throw new ManifestStop(
        "MALFORMED_MANIFEST",
        `${label} entries are not in deterministic path order`,
      );
    }
  }
  return {
    ...manifest,
    entries,
  };
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

function entryIdentity(entry) {
  if (entry.entry_type === "directory") {
    return { entry_type: "directory" };
  }
  return {
    entry_type: "file",
    byte_size: entry.byte_size,
    sha256: entry.sha256,
  };
}

function identitiesEqual(left, right) {
  return (
    left.entry_type === right.entry_type &&
    left.byte_size === right.byte_size &&
    left.sha256 === right.sha256
  );
}

export function diffManifests(pre, post) {
  const preByPath = new Map(pre.entries.map((entry) => [entry.relative_path, entry]));
  const postByPath = new Map(post.entries.map((entry) => [entry.relative_path, entry]));
  const paths = [
    ...new Set([...preByPath.keys(), ...postByPath.keys()]),
  ].sort(compareUtf8);
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
      } else if (!identitiesEqual(entryIdentity(before), entryIdentity(after))) {
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
  return { diffs, unchangedCount };
}

export function parseExpectedChanges(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestStop("MALFORMED_EXPECTED", `${label} is not valid JSON`);
  }
  const expected = requireObject(
    parsed,
    "MALFORMED_EXPECTED",
    `${label} is not an object`,
  );
  if (expected.schema !== EXPECTED_SCHEMA) {
    throw new ManifestStop(
      "SCHEMA_MISMATCH",
      `${label} schema is ${JSON.stringify(expected.schema)}`,
    );
  }
  if (!Array.isArray(expected.changes)) {
    throw new ManifestStop("MALFORMED_EXPECTED", `${label} changes are missing`);
  }
  const changes = [];
  const seen = new Set();
  for (const change of expected.changes) {
    const item = requireObject(
      change,
      "MALFORMED_EXPECTED",
      `${label} contains a malformed change`,
    );
    const key = `${item.op}:${item.relative_path}`;
    if (
      typeof item.op !== "string" ||
      typeof item.relative_path !== "string" ||
      item.relative_path === ""
    ) {
      throw new ManifestStop("MALFORMED_EXPECTED", `${label} has an invalid change`);
    }
    if (seen.has(key)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `${label} duplicates ${JSON.stringify(key)}`,
      );
    }
    seen.add(key);
    if (
      item.op === "added" ||
      item.op === "content_changed" ||
      item.op === "removed"
    ) {
      if (!isContentHash(item.sha256)) {
        throw new ManifestStop(
          "INCOMPLETE_EXPECTED",
          `expected ${item.op} ${JSON.stringify(item.relative_path)} is missing a valid sha256`,
        );
      }
    }
    if (item.op === "removed" && item.entry_type !== "file") {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        `expected removed ${JSON.stringify(item.relative_path)} must be a file with a preimage hash`,
      );
    }
    changes.push(item);
  }
  const incomplete = parseIncompleteProjectPostHashes(
    expected.incomplete_project_post_hashes,
    label,
  );
  return {
    ...expected,
    changes,
    incomplete_project_post_hashes: incomplete,
  };
}

function parseIncompleteProjectPostHashes(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ManifestStop(
      "MALFORMED_EXPECTED",
      `${label} incomplete_project_post_hashes must be an array`,
    );
  }
  const paths = [];
  const seen = new Set();
  for (const relativePath of value) {
    if (typeof relativePath !== "string" || relativePath === "") {
      throw new ManifestStop(
        "MALFORMED_EXPECTED",
        `${label} incomplete_project_post_hashes contains an invalid path`,
      );
    }
    assertContainedRelativePath(
      relativePath,
      `${label} incomplete_project_post_hashes path`,
    );
    if (seen.has(relativePath)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `${label} incomplete_project_post_hashes duplicates ${JSON.stringify(relativePath)}`,
      );
    }
    seen.add(relativePath);
    paths.push(relativePath);
  }
  return paths;
}

function expectedMatchesDiff(expected, diff) {
  if (expected.relative_path !== diff.relative_path) {
    return false;
  }
  if (expected.op !== diff.class) {
    return false;
  }
  if (expected.op === "removed") {
    return (
      diff.pre !== null &&
      expected.entry_type === "file" &&
      diff.pre.entry_type === "file" &&
      isContentHash(expected.sha256) &&
      expected.sha256 === diff.pre.sha256
    );
  }
  if (expected.op === "added") {
    return (
      diff.post !== null &&
      diff.post.entry_type === (expected.entry_type ?? "file") &&
      (expected.byte_size === undefined ||
        expected.byte_size === diff.post.byte_size) &&
      expected.sha256 === diff.post.sha256
    );
  }
  if (expected.op === "content_changed") {
    return (
      diff.pre !== null &&
      diff.post !== null &&
      diff.post.entry_type === (expected.entry_type ?? "file") &&
      (expected.pre_sha256 === undefined ||
        expected.pre_sha256 === diff.pre.sha256) &&
      expected.sha256 === diff.post.sha256 &&
      (expected.byte_size === undefined ||
        expected.byte_size === diff.post.byte_size)
    );
  }
  if (expected.op === "type_changed") {
    return diff.pre !== null && diff.post !== null;
  }
  return false;
}

export function compareManifests(pre, post, expected) {
  if (pre.schema !== post.schema) {
    return stopReport(pre, post, "SCHEMA_MISMATCH", "manifest schema mismatch", []);
  }
  if (pre.exclusion_policy !== post.exclusion_policy) {
    return stopReport(
      pre,
      post,
      "EXCLUSION_POLICY_MISMATCH",
      "exclusion policy mismatch",
      [],
    );
  }
  const { diffs, unchangedCount } = diffManifests(pre, post);
  if (!expected) {
    const unexplained = diffs.length > 0;
    return {
      schema: COMPARE_SCHEMA,
      verdict: unexplained ? "STOP" : "PASS",
      stop_reason: unexplained
        ? "NO_EXPECTED_CHANGES: all diffs must be matched to plan evidence"
        : null,
      pre_entry_count: pre.entry_count,
      post_entry_count: post.entry_count,
      unchanged_count: unchangedCount,
      unrelated_entries_unchanged: diffs.length === 0,
      diffs,
      unmatched_expected: [],
    };
  }
  const remaining = [...diffs];
  const unmatchedExpected = [];
  const matched = [];
  for (const change of expected.changes) {
    const index = remaining.findIndex((diff) => expectedMatchesDiff(change, diff));
    if (index === -1) {
      unmatchedExpected.push(change);
    } else {
      matched.push({ ...remaining[index], expected: true });
      remaining.splice(index, 1);
    }
  }
  const unexplained = remaining.map((diff) => ({ ...diff, expected: false }));
  const missing = unmatchedExpected.length > 0;
  const extra = unexplained.length > 0;
  const incompleteProjects = expected.incomplete_project_post_hashes ?? [];
  const incomplete = incompleteProjects.length > 0;
  let stopReason = null;
  if (missing && extra) {
    stopReason = "EXPECTED_MISMATCH: missing expected changes and unexplained diffs";
  } else if (missing) {
    stopReason = "EXPECTED_MISSING: an expected change did not occur";
  } else if (extra) {
    stopReason = "UNEXPECTED_DIFF: unexplained add/remove/modify/type change";
  }
  if (incomplete) {
    const incompleteReason = `INCOMPLETE_EXPECTED: rewritten project post-write SHA256 is missing: ${incompleteProjects.join(", ")}`;
    stopReason = stopReason ? `${stopReason}; ${incompleteReason}` : incompleteReason;
  }
  return {
    schema: COMPARE_SCHEMA,
    verdict: stopReason ? "STOP" : "PASS",
    stop_reason: stopReason,
    pre_entry_count: pre.entry_count,
    post_entry_count: post.entry_count,
    unchanged_count: unchangedCount,
    unrelated_entries_unchanged: unexplained.length === 0 && !missing && !incomplete,
    diffs: [...matched, ...unexplained],
    unmatched_expected: unmatchedExpected,
    incomplete_project_post_hashes: incompleteProjects,
  };
}

function stopReport(pre, post, code, message, diffs) {
  return {
    schema: COMPARE_SCHEMA,
    verdict: "STOP",
    stop_reason: `${code}: ${message}`,
    pre_entry_count: pre.entry_count,
    post_entry_count: post.entry_count,
    unchanged_count: 0,
    unrelated_entries_unchanged: false,
    diffs,
    unmatched_expected: [],
  };
}

function assertContainedRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath === "") {
    throw new ManifestStop(
      "INVALID_PATH",
      `${label} is missing a relative path`,
    );
  }
  if (path.isAbsolute(relativePath)) {
    throw new ManifestStop(
      "PATH_ESCAPE",
      `${label} must be a root-relative path`,
    );
  }
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ManifestStop(
        "PATH_ESCAPE",
        `${label} must stay inside the clone root`,
      );
    }
  }
}

function appendExpectedChange(changes, seenPaths, change) {
  assertContainedRelativePath(change.relative_path, "expected change path");
  if (seenPaths.has(change.relative_path)) {
    throw new ManifestStop(
      "DUPLICATE_PATH",
      `expected changes duplicate ${JSON.stringify(change.relative_path)}`,
    );
  }
  seenPaths.add(change.relative_path);
  changes.push(change);
}

export function expectedFromPreparedPlan(plan) {
  const payload = plan.plan ?? plan;
  const sourcePath = payload.source_relative_path ?? payload.sourceRelativePath;
  const destinationPath =
    payload.destination_relative_path ?? payload.destinationRelativePath;
  const sourceHash = payload.source_content_hash ?? payload.sourceContentHash;
  const sourceSize = payload.source_byte_size ?? payload.sourceByteSize;
  if (
    typeof sourcePath !== "string" ||
    typeof destinationPath !== "string" ||
    typeof sourceHash !== "string"
  ) {
    throw new ManifestStop(
      "INCOMPLETE_EXPECTED",
      "prepared plan is missing source/destination path or source content hash",
    );
  }
  const changes = [];
  const seenPaths = new Set();
  appendExpectedChange(changes, seenPaths, {
    op: "removed",
    relative_path: sourcePath,
    entry_type: "file",
    sha256: sourceHash,
  });
  appendExpectedChange(changes, seenPaths, {
    op: "added",
    relative_path: destinationPath,
    entry_type: "file",
    byte_size: sourceSize,
    sha256: sourceHash,
  });
  const sidecarImpacts = payload.sidecar_impacts ?? payload.sidecarImpacts ?? [];
  for (const impact of sidecarImpacts) {
    const sourceSidecar =
      impact.source_sidecar_relative_path ?? impact.sourceSidecarRelativePath;
    const destSidecar =
      impact.destination_sidecar_relative_path ??
      impact.destinationSidecarRelativePath;
    const sidecarHash = impact.content_hash ?? impact.contentHash;
    const sidecarSize = impact.byte_size ?? impact.byteSize;
    if (
      typeof sourceSidecar !== "string" ||
      typeof destSidecar !== "string" ||
      typeof sidecarHash !== "string"
    ) {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        "sidecar impact is missing paths or content hash",
      );
    }
    appendExpectedChange(changes, seenPaths, {
      op: "removed",
      relative_path: sourceSidecar,
      entry_type: "file",
      sha256: sidecarHash,
    });
    appendExpectedChange(changes, seenPaths, {
      op: "added",
      relative_path: destSidecar,
      entry_type: "file",
      byte_size: sidecarSize,
      sha256: sidecarHash,
    });
  }
  const documents =
    payload.state_document_impacts ?? payload.stateDocumentImpacts ?? [];
  const incompleteProjects = [];
  for (const document of documents) {
    const relativePath = document.relative_path ?? document.relativePath;
    if (typeof relativePath !== "string" || relativePath === "") {
      throw new ManifestStop(
        "INCOMPLETE_EXPECTED",
        "state document impact is missing a relative path",
      );
    }
    assertContainedRelativePath(relativePath, "state document impact path");
    const updates = document.reference_updates ?? document.referenceUpdates ?? [];
    if (!Array.isArray(updates) || updates.length === 0) {
      continue;
    }
    incompleteProjects.push(relativePath);
  }
  return {
    schema: EXPECTED_SCHEMA,
    changes,
    incomplete_project_post_hashes: incompleteProjects,
  };
}

function requireHash(value, label) {
  if (!isContentHash(value)) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      `${label} is missing a valid SHA256`,
    );
  }
  return value;
}

function requireByteSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      `${label} is missing a valid byte size`,
    );
  }
  return value;
}

function normalizedPlanField(payload, snakeName, camelName) {
  return payload[snakeName] ?? payload[camelName];
}

function normalizePlanEnvelope(planInput) {
  const envelope = requireObject(
    planInput,
    "MALFORMED_EVIDENCE",
    "rename plan is not an object",
  );
  if (envelope.schema === RENAME_PLAN_SCHEMA) {
    return {
      schema: RENAME_PLAN_SCHEMA,
      planId: normalizedPlanField(envelope, "plan_id", "planId"),
      operationId: normalizedPlanField(envelope, "operation_id", "operationId"),
      payload: envelope,
    };
  }
  if (envelope.schema === PREPARED_RENAME_PLAN_SCHEMA) {
    const payload = requireObject(
      envelope.plan,
      "MALFORMED_EVIDENCE",
      "prepared rename plan payload is not an object",
    );
    const planId =
      normalizedPlanField(envelope, "plan_id", "planId") ??
      normalizedPlanField(payload, "plan_id", "planId");
    const operationId =
      normalizedPlanField(envelope, "operation_id", "operationId") ??
      normalizedPlanField(payload, "operation_id", "operationId");
    return {
      schema: PREPARED_RENAME_PLAN_SCHEMA,
      planId,
      operationId,
      payload,
    };
  }
  throw new ManifestStop(
    "SCHEMA_MISMATCH",
    `rename plan schema is ${JSON.stringify(envelope.schema)}`,
  );
}

function requirePlanContentHash(value, label) {
  if (!isContentHash(value)) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      `${label} is missing a valid SHA256 preimage`,
    );
  }
  return value;
}

function requireMatchingPreimage(observed, expected, label) {
  if (observed !== expected) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      `${label} does not match the rename plan preimage`,
    );
  }
}

function requireMatchingByteSize(observed, expected, label) {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      `${label} is missing a valid byte size in the rename plan`,
    );
  }
  if (observed !== expected) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      `${label} byte size does not match the rename plan preimage`,
    );
  }
}

export function expectedFromCommittedEvidence(evidenceInput, planInput) {
  const evidence = requireObject(
    evidenceInput,
    "MALFORMED_EVIDENCE",
    "committed evidence is not an object",
  );
  if (evidence.schema !== COMMITTED_EVIDENCE_SCHEMA) {
    throw new ManifestStop(
      "SCHEMA_MISMATCH",
      `committed evidence schema is ${JSON.stringify(evidence.schema)}`,
    );
  }
  if (
    evidence.mutationState !== "committed" ||
    evidence.verificationState !== "passed" ||
    evidence.rescanCompleted !== true
  ) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      "evidence is not from a verified committed transaction",
    );
  }

  const { planId, operationId, payload: plan } = normalizePlanEnvelope(planInput);
  if (
    typeof evidence.planId !== "string" ||
    typeof evidence.operationId !== "string" ||
    evidence.planId === "" ||
    evidence.operationId === "" ||
    evidence.planId !== planId ||
    evidence.operationId !== operationId
  ) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      "committed evidence does not match the rename plan identity",
    );
  }

  const audio = requireObject(
    evidence.audio,
    "INCOMPLETE_EVIDENCE",
    "committed evidence is missing audio identity",
  );
  const sourcePath = normalizedPlanField(
    plan,
    "source_relative_path",
    "sourceRelativePath",
  );
  const destinationPath = normalizedPlanField(
    plan,
    "destination_relative_path",
    "destinationRelativePath",
  );
  if (
    audio.sourceRelativePath !== sourcePath ||
    audio.destinationRelativePath !== destinationPath
  ) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      "committed audio paths do not match the rename plan",
    );
  }
  const sourceHash = requireHash(audio.sourceSha256, "audio source");
  const destinationHash = requireHash(
    audio.destinationSha256,
    "audio destination",
  );
  if (sourceHash !== destinationHash) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      "rename audio source and destination SHA256 differ",
    );
  }
  const sourceSize = requireByteSize(audio.byteSize, "audio");
  const planSourceHash = requirePlanContentHash(
    normalizedPlanField(plan, "source_content_hash", "sourceContentHash"),
    "audio",
  );
  requireMatchingPreimage(sourceHash, planSourceHash, "committed audio SHA256");
  requireMatchingByteSize(
    sourceSize,
    normalizedPlanField(plan, "source_byte_size", "sourceByteSize"),
    "audio",
  );

  const changes = [];
  const seenPaths = new Set();
  appendExpectedChange(changes, seenPaths, {
    op: "removed",
    relative_path: sourcePath,
    entry_type: "file",
    sha256: sourceHash,
  });
  appendExpectedChange(changes, seenPaths, {
    op: "added",
    relative_path: destinationPath,
    entry_type: "file",
    byte_size: sourceSize,
    sha256: destinationHash,
  });

  const evidenceSidecars = evidence.sidecars;
  if (!Array.isArray(evidenceSidecars)) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      "committed evidence sidecars are missing",
    );
  }
  const planSidecars =
    normalizedPlanField(plan, "sidecar_impacts", "sidecarImpacts") ?? [];
  if (!Array.isArray(planSidecars) || evidenceSidecars.length !== planSidecars.length) {
    throw new ManifestStop(
      "IDENTITY_MISMATCH",
      "committed sidecar evidence does not match the rename plan",
    );
  }
  const expectedSidecarPaths = new Map();
  for (const impact of planSidecars) {
    const source = normalizedPlanField(
      impact,
      "source_sidecar_relative_path",
      "sourceSidecarRelativePath",
    );
    const destination = normalizedPlanField(
      impact,
      "destination_sidecar_relative_path",
      "destinationSidecarRelativePath",
    );
    assertContainedRelativePath(source, "plan sidecar source");
    assertContainedRelativePath(destination, "plan sidecar destination");
    const key = `${source}\u0000${destination}`;
    if (expectedSidecarPaths.has(key)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        "rename plan duplicates a sidecar path pair",
      );
    }
    expectedSidecarPaths.set(key, {
      contentHash: requirePlanContentHash(
        normalizedPlanField(impact, "content_hash", "contentHash"),
        `sidecar ${JSON.stringify(source)}`,
      ),
      byteSize: normalizedPlanField(impact, "byte_size", "byteSize"),
    });
  }
  const observedSidecarPaths = new Set();
  for (const sidecarValue of evidenceSidecars) {
    const sidecar = requireObject(
      sidecarValue,
      "MALFORMED_EVIDENCE",
      "committed sidecar evidence contains a malformed entry",
    );
    const key = `${sidecar.sourceRelativePath}\u0000${sidecar.destinationRelativePath}`;
    const preimagePlan = expectedSidecarPaths.get(key);
    if (!preimagePlan || observedSidecarPaths.has(key)) {
      throw new ManifestStop(
        "IDENTITY_MISMATCH",
        "committed sidecar paths are duplicate or absent from the rename plan",
      );
    }
    observedSidecarPaths.add(key);
    const preimage = requireHash(sidecar.sourceSha256, "sidecar source");
    const postimage = requireHash(sidecar.destinationSha256, "sidecar destination");
    if (preimage !== postimage) {
      throw new ManifestStop(
        "IDENTITY_MISMATCH",
        "rename sidecar source and destination SHA256 differ",
      );
    }
    const byteSize = requireByteSize(sidecar.byteSize, "sidecar");
    requireMatchingPreimage(
      preimage,
      preimagePlan.contentHash,
      `committed sidecar ${JSON.stringify(sidecar.sourceRelativePath)} SHA256`,
    );
    requireMatchingByteSize(
      byteSize,
      preimagePlan.byteSize,
      `committed sidecar ${JSON.stringify(sidecar.sourceRelativePath)}`,
    );
    appendExpectedChange(changes, seenPaths, {
      op: "removed",
      relative_path: sidecar.sourceRelativePath,
      entry_type: "file",
      sha256: preimage,
    });
    appendExpectedChange(changes, seenPaths, {
      op: "added",
      relative_path: sidecar.destinationRelativePath,
      entry_type: "file",
      byte_size: byteSize,
      sha256: postimage,
    });
  }

  const documents =
    normalizedPlanField(plan, "state_document_impacts", "stateDocumentImpacts") ?? [];
  if (!Array.isArray(documents)) {
    throw new ManifestStop(
      "MALFORMED_EVIDENCE",
      "rename plan state-document impacts are malformed",
    );
  }
  const expectedProjectPaths = new Map();
  for (const document of documents) {
    const updates =
      normalizedPlanField(document, "reference_updates", "referenceUpdates") ?? [];
    if (!Array.isArray(updates)) {
      throw new ManifestStop(
        "MALFORMED_EVIDENCE",
        "rename plan reference updates are malformed",
      );
    }
    if (updates.length === 0) continue;
    const relativePath = normalizedPlanField(
      document,
      "relative_path",
      "relativePath",
    );
    assertContainedRelativePath(relativePath, "plan Project path");
    if (expectedProjectPaths.has(relativePath)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        `rename plan duplicates Project ${JSON.stringify(relativePath)}`,
      );
    }
    expectedProjectPaths.set(relativePath, {
      contentHash: requirePlanContentHash(
        normalizedPlanField(document, "content_hash", "contentHash"),
        `Project ${JSON.stringify(relativePath)} pre-write`,
      ),
      byteSize: normalizedPlanField(document, "byte_size", "byteSize"),
    });
  }
  if (
    !Array.isArray(evidence.projectRewrites) ||
    evidence.projectRewrites.length !== expectedProjectPaths.size
  ) {
    throw new ManifestStop(
      "INCOMPLETE_EVIDENCE",
      "Project rewrite evidence is missing or has an unexpected record count",
    );
  }
  const observedProjects = new Set();
  for (const rewriteValue of evidence.projectRewrites) {
    const rewrite = requireObject(
      rewriteValue,
      "MALFORMED_EVIDENCE",
      "Project rewrite evidence contains a malformed entry",
    );
    assertContainedRelativePath(rewrite.relativePath, "Project rewrite path");
    const preimagePlan = expectedProjectPaths.get(rewrite.relativePath);
    if (!preimagePlan || observedProjects.has(rewrite.relativePath)) {
      throw new ManifestStop(
        "DUPLICATE_PATH",
        "Project rewrite path is duplicate or absent from the rename plan",
      );
    }
    observedProjects.add(rewrite.relativePath);
    const preWriteHash = requireHash(
      rewrite.preWriteSha256,
      "Project pre-write identity",
    );
    requireMatchingPreimage(
      preWriteHash,
      preimagePlan.contentHash,
      `Project ${JSON.stringify(rewrite.relativePath)} pre-write SHA256`,
    );
    const byteSize = requireByteSize(rewrite.byteSize, "Project rewrite");
    requireMatchingByteSize(
      byteSize,
      preimagePlan.byteSize,
      `Project ${JSON.stringify(rewrite.relativePath)}`,
    );
    appendExpectedChange(changes, seenPaths, {
      op: "content_changed",
      relative_path: rewrite.relativePath,
      entry_type: "file",
      pre_sha256: preWriteHash,
      sha256: requireHash(
        rewrite.postWriteSha256,
        "Project post-write identity",
      ),
      byte_size: byteSize,
    });
  }

  changes.sort(
    (left, right) =>
      compareUtf8(left.relative_path, right.relative_path) ||
      compareUtf8(left.op, right.op),
  );
  return {
    schema: EXPECTED_SCHEMA,
    operation_id: evidence.operationId,
    plan_id: evidence.planId,
    changes,
    incomplete_project_post_hashes: [],
  };
}

export function formatSummary(report) {
  const lines = [
    `verdict: ${report.verdict}`,
    `unchanged: ${report.unchanged_count}`,
    `diffs: ${report.diffs.length}`,
    `unrelated_entries_unchanged: ${report.unrelated_entries_unchanged}`,
  ];
  if (report.stop_reason) {
    lines.push(`stop_reason: ${report.stop_reason}`);
  }
  for (const diff of report.diffs) {
    lines.push(
      `${diff.class}${diff.expected ? " (expected)" : ""} ${JSON.stringify(diff.relative_path)}`,
    );
  }
  for (const change of report.unmatched_expected ?? []) {
    lines.push(
      `missing expected ${change.op} ${JSON.stringify(change.relative_path)}`,
    );
  }
  for (const relativePath of report.incomplete_project_post_hashes ?? []) {
    lines.push(
      `incomplete project post-write sha256 ${JSON.stringify(relativePath)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage:
  node scripts/gate-c-byte-manifest.mjs capture --root <clone-root> --output <manifest.json>
  node scripts/gate-c-byte-manifest.mjs compare --pre <pre.json> --post <post.json> [--expected <expected.json>] [--report <report.json>]
  node scripts/gate-c-byte-manifest.mjs expected-from-prepared --plan <prepared-plan.json> --output <expected.json>
  node scripts/gate-c-byte-manifest.mjs expected-from-evidence --plan <rename-plan.json> --evidence <committed-evidence.json> --output <expected.json>

Keep generated manifests outside the repository. They may contain personal sample names.
Do not commit capture output.
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

function runCli(argv) {
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
      `captured entries=${manifest.entry_count} excluded=${manifest.excluded_entry_count} output=${output}\n`,
    );
    process.stdout.write(
      "Store this file outside the repository. Do not commit it.\n",
    );
    return 0;
  }
  if (command === "compare") {
    const prePath = takeOption(args, "--pre");
    const postPath = takeOption(args, "--post");
    const expectedPath = takeOption(args, "--expected");
    const reportPath = takeOption(args, "--report");
    if (!prePath || !postPath) {
      throw new ManifestStop("USAGE", usage());
    }
    const pre = loadManifestFile(prePath, "pre-run manifest");
    const post = loadManifestFile(postPath, "post-run manifest");
    let expected = null;
    if (expectedPath) {
      expected = parseExpectedChanges(
        readFileSync(expectedPath, "utf8"),
        "expected changes",
      );
    }
    const report = compareManifests(pre, post, expected);
    process.stdout.write(formatSummary(report));
    if (reportPath) {
      assertReportDoesNotClobberInputs(reportPath, [
        prePath,
        postPath,
        expectedPath,
      ]);
      writeManifestAtomic(reportPath, report);
    }
    return report.verdict === "PASS" ? 0 : 2;
  }
  if (command === "expected-from-prepared") {
    const planPath = takeOption(args, "--plan");
    const output = takeOption(args, "--output");
    if (!planPath || !output) {
      throw new ManifestStop("USAGE", usage());
    }
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const expected = expectedFromPreparedPlan(plan);
    writeManifestAtomic(output, {
      schema: expected.schema,
      changes: expected.changes,
      incomplete_project_post_hashes: expected.incomplete_project_post_hashes,
    });
    if (expected.incomplete_project_post_hashes.length > 0) {
      process.stderr.write(
        `STOP INCOMPLETE_EXPECTED: rewritten project post-write SHA256 is not in the prepared plan and was not invented: ${expected.incomplete_project_post_hashes.join(", ")}\n`,
      );
      process.stderr.write(
        "Audio/sidecar expected changes were written. Fill project content_changed hashes from apply-time rewrite evidence before compare can PASS.\n",
      );
      return 1;
    }
    process.stdout.write(`wrote expected changes to ${output}\n`);
    return 0;
  }
  if (command === "expected-from-evidence") {
    const planPath = takeOption(args, "--plan");
    const evidencePath = takeOption(args, "--evidence");
    const output = takeOption(args, "--output");
    if (!planPath || !evidencePath || !output) {
      throw new ManifestStop("USAGE", usage());
    }
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const expected = expectedFromCommittedEvidence(evidence, plan);
    writeManifestAtomic(output, expected);
    process.stdout.write(`wrote expected changes to ${output}\n`);
    return 0;
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

export { runCli };
