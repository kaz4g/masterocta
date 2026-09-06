#!/usr/bin/env node
/**
 * Gate C immutable candidate workflow contract helpers and static validators.
 * No YAML parser dependency; workflow text is inspected directly.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EVIDENCE_SCHEMA = "masterocta-gate-c-candidate-evidence:v1";
export const CHECKSUM_MANIFEST_SCHEMA = "masterocta-gate-c-candidate-checksum-manifest:v1";
export const CONFIRMATION_PHRASE = "FREEZE_NON_PUBLIC_GATE_C_CANDIDATE";
export const WORKFLOW_FILE = ".github/workflows/gate-c-candidate.yml";
export const WORKFLOW_NAME = "Gate C Candidate Build";
export const HASH_PREFIX = "sha256:";
export const CANDIDATE_ID_PATTERN = /^gate-c-rc[1-9][0-9]*-[0-9a-f]{12}$/;
export const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
export const FULL_TREE_PATTERN = /^[0-9a-f]{40}$/;

export const CODESIGN_CLASSIFICATIONS = [
  "AD_HOC_VERIFIED",
  "DEVELOPER_ID_VERIFIED",
  "UNSIGNED_EXPECTED_AND_RECORDED",
  "SIGNATURE_INTEGRITY_FAILURE",
  "UNKNOWN",
];

export const STOP_CODESIGN = new Set([
  "SIGNATURE_INTEGRITY_FAILURE",
  "UNKNOWN",
]);

export const EVIDENCE_FIELD_ORDER = [
  "schema",
  "candidate_id",
  "source_commit",
  "source_tree",
  "checkout_sha",
  "workflow_name",
  "workflow_ref",
  "workflow_sha",
  "run_id",
  "run_attempt",
  "run_url",
  "repository",
  "ref",
  "artifact_filename",
  "target_architecture",
  "dmg_sha256",
  "enclosed_binary_relative_path",
  "enclosed_binary_sha256",
  "dmg_verification_result",
  "codesign_classification",
  "codesign_command_result",
  "spctl_result",
  "build_environment",
  "node_version",
  "pnpm_version",
  "rust_version",
  "cargo_version",
  "xcode_version",
  "runner_os",
  "runner_arch",
  "runner_image",
  "checksum_manifest_filename",
  "checksum_manifest_sha256",
  "candidate_storage_type",
  "draft_release_tag",
  "draft_release_id",
  "access_boundary_classification",
  "generated_at",
];

export class CandidateStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CandidateStop";
    this.code = code;
  }
}

export function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

export function isContentHash(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

export function sha256HexOfBytes(buffer) {
  return HASH_PREFIX + createHash("sha256").update(buffer).digest("hex");
}

export function sha256HexOfFile(filePath) {
  return sha256HexOfBytes(readFileSync(filePath));
}

export function shortShaFromCommit(commitSha) {
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new CandidateStop("INVALID_SHA", "source commit must be a full 40-char SHA");
  }
  return commitSha.slice(0, 12);
}

export function validateCandidateId(candidateId, expectedSourceSha) {
  if (typeof candidateId !== "string" || !CANDIDATE_ID_PATTERN.test(candidateId)) {
    throw new CandidateStop(
      "INVALID_CANDIDATE_ID",
      "candidate_id must match gate-c-rc<N>-<12hex>",
    );
  }
  const suffix = candidateId.slice(candidateId.lastIndexOf("-") + 1);
  const expectedSuffix = shortShaFromCommit(expectedSourceSha);
  if (suffix !== expectedSuffix) {
    throw new CandidateStop(
      "IDENTITY_MISMATCH",
      "candidate_id suffix must match expected_source_sha prefix",
    );
  }
  return candidateId;
}

export function readProductVersion(repositoryRoot) {
  const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (typeof config.version !== "string" || config.version === "") {
    throw new CandidateStop("INVALID_VERSION", "tauri.conf.json version is missing");
  }
  return config.version;
}

export function artifactFilenameFor(candidateId, expectedSourceSha, version) {
  validateCandidateId(candidateId, expectedSourceSha);
  const shortSha = candidateId.slice(candidateId.lastIndexOf("-") + 1);
  const rcTag = candidateId.slice(0, candidateId.lastIndexOf("-"));
  return `Masta-Octa_${version}_${rcTag}_${shortSha}_aarch64.dmg`;
}

export function checksumManifestFilename(candidateId) {
  return `${candidateId}-checksum-manifest.json`;
}

export function evidenceFilename(candidateId) {
  return `${candidateId}-evidence.json`;
}

export function validateWorkflowInputs(inputs) {
  const required = [
    "candidate_id",
    "expected_source_sha",
    "expected_source_tree",
    "confirmation",
    "github_ref",
    "github_sha",
    "run_attempt",
  ];
  for (const key of required) {
    if (inputs[key] === undefined || inputs[key] === null || inputs[key] === "") {
      throw new CandidateStop("MISSING_INPUT", `${key} is required`);
    }
  }
  if (inputs.github_ref !== "refs/heads/main") {
    throw new CandidateStop("INVALID_REF", "workflow must run on refs/heads/main");
  }
  if (!FULL_SHA_PATTERN.test(inputs.expected_source_sha)) {
    throw new CandidateStop("INVALID_SHA", "expected_source_sha must be 40 lowercase hex chars");
  }
  if (!FULL_TREE_PATTERN.test(inputs.expected_source_tree)) {
    throw new CandidateStop("INVALID_TREE", "expected_source_tree must be 40 lowercase hex chars");
  }
  if (inputs.github_sha !== inputs.expected_source_sha) {
    throw new CandidateStop("SHA_MISMATCH", "github.sha must equal expected_source_sha");
  }
  if (Number(inputs.run_attempt) !== 1) {
    throw new CandidateStop("INVALID_ATTEMPT", "run_attempt must be 1");
  }
  if (inputs.confirmation !== CONFIRMATION_PHRASE) {
    throw new CandidateStop("INVALID_CONFIRMATION", "confirmation phrase mismatch");
  }
  validateCandidateId(inputs.candidate_id, inputs.expected_source_sha);
  return inputs;
}

export function discoverDmgPaths(paths) {
  const dmgs = paths.filter((entry) => entry.endsWith(".dmg"));
  if (dmgs.length === 0) {
    throw new CandidateStop("DMG_NOT_FOUND", "no DMG artifact found");
  }
  if (dmgs.length > 1) {
    throw new CandidateStop("DMG_AMBIGUOUS", "multiple DMG artifacts found");
  }
  return dmgs[0];
}

function uniquenessCodes(suffix) {
  if (suffix === ".dmg") {
    return { zero: "DMG_NOT_FOUND", multiple: "DMG_AMBIGUOUS" };
  }
  if (suffix === ".app") {
    return { zero: "APP_NOT_FOUND", multiple: "APP_AMBIGUOUS" };
  }
  return { zero: "NOT_FOUND", multiple: "AMBIGUOUS" };
}

function assertInsideRoot(root, candidatePath) {
  const relative = path.relative(root, candidatePath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new CandidateStop("PATH_ESCAPE", "discovered path escaped search root");
  }
  return relative;
}

export function collectMatchingPaths(options) {
  if (!options || typeof options.root !== "string" || options.root.trim() === "") {
    throw new CandidateStop("DISCOVERY_ROOT_INVALID", "search root is required");
  }
  const suffix = options.suffix;
  if (typeof suffix !== "string" || suffix === "" || suffix.includes("/") || suffix.includes("\\")) {
    throw new CandidateStop("DISCOVERY_SUFFIX_INVALID", "suffix must be a file-name ending");
  }
  let maxDepth = Number.POSITIVE_INFINITY;
  if (options.maxDepth !== undefined && options.maxDepth !== null) {
    maxDepth = Number(options.maxDepth);
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new CandidateStop("DISCOVERY_DEPTH_INVALID", "maxDepth must be a positive integer");
    }
  }
  const pathContains = options.pathContains ?? null;
  if (pathContains !== null && (typeof pathContains !== "string" || pathContains === "")) {
    throw new CandidateStop("DISCOVERY_FILTER_INVALID", "pathContains must be a non-empty string");
  }

  const root = path.resolve(options.root);
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    throw new CandidateStop("DISCOVERY_ROOT_INVALID", "search root does not exist");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CandidateStop("DISCOVERY_ROOT_INVALID", "search root must be a real directory");
  }

  const matches = [];

  function matchesFilter(fullPath, relativePath) {
    if (pathContains === null) return true;
    const relativePosix = relativePath.split(path.sep).join("/");
    return relativePosix.includes(pathContains) || fullPath.includes(pathContains);
  }

  function walk(currentDir, depth) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      throw new CandidateStop("DISCOVERY_UNREADABLE", "unreadable path under search root");
    }
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = assertInsideRoot(root, fullPath);
      const childDepth = depth + 1;
      if (entry.name.endsWith(suffix) && matchesFilter(fullPath, relativePath)) {
        matches.push(fullPath);
      }
      if (entry.isDirectory() && childDepth < maxDepth) {
        walk(fullPath, childDepth);
      }
    }
  }

  walk(root, 0);
  matches.sort(compareUtf8);
  return matches;
}

export function selectUniquePath(options) {
  const matches = collectMatchingPaths(options);
  const codes = uniquenessCodes(options.suffix);
  if (matches.length === 0) {
    throw new CandidateStop(codes.zero, `no ${options.suffix} found`);
  }
  if (matches.length > 1) {
    throw new CandidateStop(codes.multiple, `multiple ${options.suffix} found`);
  }
  return matches[0];
}

export function assertHashUnchanged(before, after, label) {
  if (before !== after) {
    throw new CandidateStop(
      "HASH_CHANGED",
      `${label} SHA256 changed after finalization`,
    );
  }
}

export function classifyCodesign(verifyOutput, displayOutput) {
  const verify = String(verifyOutput ?? "");
  const display = String(displayOutput ?? "");
  const combined = `${verify}\n${display}`;
  if (/Developer ID Application:/i.test(combined)) {
    if (/valid on disk/i.test(verify)) {
      return "DEVELOPER_ID_VERIFIED";
    }
    return "SIGNATURE_INTEGRITY_FAILURE";
  }
  if (/Signature=adhoc/i.test(display) || /Signature=adhoc/i.test(verify)) {
    return "AD_HOC_VERIFIED";
  }
  if (/invalid signature/i.test(combined) || /code object is not signed at all/i.test(combined)) {
    return "UNSIGNED_EXPECTED_AND_RECORDED";
  }
  if (/valid on disk/i.test(verify)) {
    return "AD_HOC_VERIFIED";
  }
  if (verify.trim() === "" && display.trim() === "") {
    return "UNKNOWN";
  }
  if (/failed/i.test(verify) || /a sealed resource is missing or invalid/i.test(verify)) {
    return "SIGNATURE_INTEGRITY_FAILURE";
  }
  return "UNKNOWN";
}

export function classifySpctl(spctlOutput, codesignClassification) {
  const output = String(spctlOutput ?? "");
  if (output.trim() === "") {
    return { result: "NOT_RUN", acceptable: false };
  }
  if (/accepted/i.test(output) && codesignClassification === "DEVELOPER_ID_VERIFIED") {
    return { result: "accepted", acceptable: true };
  }
  if (/rejected/i.test(output)) {
    if (
      codesignClassification === "AD_HOC_VERIFIED"
      || codesignClassification === "UNSIGNED_EXPECTED_AND_RECORDED"
    ) {
      return { result: "rejected_expected", acceptable: true };
    }
    return { result: "rejected_unexpected", acceptable: false };
  }
  return { result: "unknown", acceptable: false };
}

function requireObject(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CandidateStop(code, message);
  }
  return value;
}

export function buildChecksumManifest({
  candidateId,
  artifactFilename,
  dmgSha256,
  enclosedBinaryRelativePath,
  enclosedBinarySha256,
}) {
  return {
    schema: CHECKSUM_MANIFEST_SCHEMA,
    candidate_id: candidateId,
    artifacts: [
      {
        filename: artifactFilename,
        sha256: dmgSha256,
        role: "final_dmg",
      },
      {
        relative_path: enclosedBinaryRelativePath,
        sha256: enclosedBinarySha256,
        role: "enclosed_app_binary",
      },
    ],
  };
}

export function serializeDeterministicJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildEvidence(payload) {
  const evidence = {};
  for (const key of EVIDENCE_FIELD_ORDER) {
    if (payload[key] === undefined) {
      throw new CandidateStop("INCOMPLETE_EVIDENCE", `${key} is required`);
    }
    evidence[key] = payload[key];
  }
  if (evidence.schema !== EVIDENCE_SCHEMA) {
    throw new CandidateStop("SCHEMA_MISMATCH", "evidence schema mismatch");
  }
  validateEvidence(evidence);
  return evidence;
}

export function validateEvidence(evidenceInput) {
  const evidence = requireObject(
    evidenceInput,
    "MALFORMED_EVIDENCE",
    "evidence must be an object",
  );
  if (evidence.schema !== EVIDENCE_SCHEMA) {
    throw new CandidateStop("SCHEMA_MISMATCH", "evidence schema mismatch");
  }
  for (const key of EVIDENCE_FIELD_ORDER) {
    if (!(key in evidence)) {
      throw new CandidateStop("INCOMPLETE_EVIDENCE", `${key} is missing`);
    }
  }
  const keys = Object.keys(evidence).sort(compareUtf8);
  const ordered = [...EVIDENCE_FIELD_ORDER];
  ordered.sort(compareUtf8);
  if (keys.length !== ordered.length || keys.some((key, index) => key !== ordered[index])) {
    throw new CandidateStop("MALFORMED_EVIDENCE", "evidence keys are not in the expected set");
  }
  if (!CANDIDATE_ID_PATTERN.test(evidence.candidate_id)) {
    throw new CandidateStop("INVALID_CANDIDATE_ID", "candidate_id is invalid");
  }
  validateCandidateId(evidence.candidate_id, evidence.source_commit);
  if (evidence.source_commit !== evidence.checkout_sha) {
    throw new CandidateStop("IDENTITY_MISMATCH", "checkout_sha must equal source_commit");
  }
  if (evidence.source_commit !== evidence.source_tree && evidence.source_tree.length !== 40) {
    throw new CandidateStop("INVALID_TREE", "source_tree must be 40 hex chars");
  }
  if (!FULL_SHA_PATTERN.test(evidence.source_commit)) {
    throw new CandidateStop("INVALID_SHA", "source_commit must be full SHA");
  }
  if (!FULL_TREE_PATTERN.test(evidence.source_tree)) {
    throw new CandidateStop("INVALID_TREE", "source_tree must be full tree SHA");
  }
  if (!isContentHash(evidence.dmg_sha256)) {
    throw new CandidateStop("INVALID_HASH", "dmg_sha256 must be sha256:<hex>");
  }
  if (!isContentHash(evidence.enclosed_binary_sha256)) {
    throw new CandidateStop("INVALID_HASH", "enclosed_binary_sha256 must be sha256:<hex>");
  }
  if (!isContentHash(evidence.checksum_manifest_sha256)) {
    throw new CandidateStop("INVALID_HASH", "checksum_manifest_sha256 must be sha256:<hex>");
  }
  if (evidence.dmg_verification_result !== "PASS") {
    throw new CandidateStop("DMG_VERIFY_FAILED", "DMG verification must be PASS");
  }
  if (STOP_CODESIGN.has(evidence.codesign_classification)) {
    throw new CandidateStop("CODESIGN_STOP", "codesign classification is STOP");
  }
  if (!CODESIGN_CLASSIFICATIONS.includes(evidence.codesign_classification)) {
    throw new CandidateStop("CODESIGN_STOP", "unknown codesign classification");
  }
  if (evidence.candidate_storage_type !== "github_draft_release") {
    throw new CandidateStop("STORAGE_MISMATCH", "candidate storage type mismatch");
  }
  if (evidence.draft_release_tag !== evidence.candidate_id) {
    throw new CandidateStop("IDENTITY_MISMATCH", "draft_release_tag must equal candidate_id");
  }
  if (evidence.access_boundary_classification !== "authenticated_collaborators_only") {
    throw new CandidateStop("ACCESS_BOUNDARY", "access boundary classification mismatch");
  }
  if (Number(evidence.run_attempt) !== 1) {
    throw new CandidateStop("INVALID_ATTEMPT", "run_attempt must be 1");
  }
  assertEvidenceDoesNotLeakSecrets(evidence);
  return evidence;
}

export function assertEvidenceDoesNotLeakSecrets(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/gh[pousr]_[A-Za-z0-9_]+/.test(serialized)) {
    throw new CandidateStop("SECRET_LEAK", "evidence must not contain tokens");
  }
  if (/\/Users\/[^/"\\]+/.test(serialized)) {
    throw new CandidateStop("PATH_LEAK", "evidence must not contain user home paths");
  }
  if (/\/home\/[^/"\\]+/.test(serialized)) {
    throw new CandidateStop("PATH_LEAK", "evidence must not contain user home paths");
  }
  if (/GITHUB_TOKEN|secrets\./i.test(serialized)) {
    throw new CandidateStop("SECRET_LEAK", "evidence must not contain secret references");
  }
}

export function validateUploadCompleteness(uploadedNames, expectedNames) {
  const uploaded = new Set(uploadedNames);
  const missing = expectedNames.filter((name) => !uploaded.has(name));
  if (missing.length > 0) {
    throw new CandidateStop(
      "INCOMPLETE_UPLOAD",
      `missing uploaded assets: ${missing.join(", ")}`,
    );
  }
  return true;
}

function stripYamlInlineComment(line) {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

export function validateWorkflowYaml(content, options = {}) {
  const failures = [];
  const fileLabel = options.fileLabel ?? WORKFLOW_FILE;

  function fail(message) {
    failures.push(`${fileLabel}: ${message}`);
  }

  if (!/^name:\s*Gate C Candidate Build\s*$/m.test(content)) {
    fail("workflow display name must be Gate C Candidate Build");
  }
  if (!/^on:\s*\n\s*workflow_dispatch:/m.test(content)) {
    fail("workflow must be workflow_dispatch only");
  }
  for (const trigger of ["push:", "pull_request:", "release:", "schedule:", "workflow_call:"]) {
    if (content.includes(`\n  ${trigger}`) || content.includes(`\non:\n${trigger}`)) {
      fail(`forbidden trigger ${trigger}`);
    }
  }

  const requiredInputs = [
    "candidate_id",
    "expected_source_sha",
    "expected_source_tree",
    "confirmation",
  ];
  for (const inputName of requiredInputs) {
    if (!new RegExp(`^\\s+${inputName}:\\s*$`, "m").test(content)) {
      fail(`missing workflow_dispatch input ${inputName}`);
    }
  }

  const forbiddenPatterns = [
    [/gh release delete/i, "release delete"],
    [/git push origin --delete/i, "tag delete"],
    [/--clobber/i, "clobber upload"],
    [/draft:\s*false/i, "non-draft release"],
    [/publish-release/i, "publish-release job"],
    [/updateRelease\([\s\S]*draft:\s*false/i, "undraft release"],
    [/make_latest:\s*true/i, "make_latest true"],
    [/uses:\s*tauri-apps\/tauri-action/i, "tauri-action upload"],
    [/uses:\s*actions\/upload-artifact/i, "actions artifact upload"],
    [/uses:[^\n]*rc-release\.yml/i, "rc-release workflow reuse"],
    [/Swatinem\/rust-cache/i, "branch-shared rust cache"],
    [/actions\/cache/i, "actions cache"],
    [/sed -i[^\n]*Cargo\.toml/i, "Cargo.toml sed mutation"],
    [/sed -i[^\n]*tauri\.conf\.json/i, "tauri.conf.json sed mutation"],
    [/\bmapfile\b/, "Bash 4 mapfile builtin"],
    [/\breadarray\b/, "Bash 4 readarray builtin"],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(content)) {
      fail(`forbidden pattern: ${label}`);
    }
  }

  const requiredPatterns = [
    [/permissions:\s*\n\s*contents:\s*write/m, "contents: write permission"],
    [/actions:\s*read/m, "actions: read permission"],
    [/github\.run_attempt\s*!=\s*'?1'?|run_attempt[^\n]*1/m, "run attempt guard"],
    [/expected_source_sha/m, "source SHA binding"],
    [/expected_source_tree/m, "source tree binding"],
    [/FREEZE_NON_PUBLIC_GATE_C_CANDIDATE/m, "confirmation phrase"],
    [/pnpm[^\n]*--frozen-lockfile/m, "frozen lockfile install"],
    [/--locked/m, "locked cargo build"],
    [/hdiutil verify/m, "hdiutil verify"],
    [/hdiutil attach[^\n]*-readonly/m, "readonly attach"],
    [/Contents\/MacOS\/masterocta/m, "enclosed binary path"],
    [/shasum -a 256/m, "sha256 hashing"],
    [/codesign --verify --deep --strict/m, "codesign verify"],
    [/spctl --assess --type execute/m, "spctl assess"],
    [/draft:\s*true|--draft/m, "draft release"],
    [/prerelease:\s*true|--prerelease/m, "prerelease release"],
    [/make_latest:\s*false/m, "make_latest false"],
    [/gate-c-candidate-contract\.mjs/m, "contract script usage"],
    [/anonymous|without authentication|curl[^\n]*releases\/tags/m, "anonymous access denial check"],
    [/aarch64-apple-darwin/m, "aarch64 target"],
    [/NO_STRIP:\s*1|NO_STRIP=1/m, "NO_STRIP build flag"],
    [/select-unique/m, "portable unique-path discovery"],
  ];
  for (const [pattern, label] of requiredPatterns) {
    if (!pattern.test(content)) {
      fail(`missing required pattern: ${label}`);
    }
  }

  if (!/runs-on:\s*macos-(latest|14)/m.test(content)) {
    fail("must run on macos-latest or macos-14");
  }

  const usesLine = /^\s*(?:-\s*)?uses:\s+/im;
  for (const line of content.split(/\r?\n/)) {
    if (!usesLine.test(line)) continue;
    const withoutComment = stripYamlInlineComment(line).trim();
    const match = withoutComment.match(/uses:\s+(\S+)/i);
    if (!match) continue;
    const actionRef = match[1];
    if (actionRef.startsWith("./")) continue;
    const pin = actionRef.slice(actionRef.lastIndexOf("@") + 1);
    if (!/^[0-9a-f]{40}$/i.test(pin)) {
      fail(`unpinned action ${actionRef}`);
    }
  }

  if (failures.length > 0) {
    throw new CandidateStop("WORKFLOW_CONTRACT", failures.join("; "));
  }
  return true;
}

function usage() {
  return `Usage:
  node scripts/gate-c-candidate-contract.mjs validate-workflow [--file PATH]
  node scripts/gate-c-candidate-contract.mjs validate-inputs --json INPUTS.json
  node scripts/gate-c-candidate-contract.mjs classify-codesign --verify FILE --display FILE
  node scripts/gate-c-candidate-contract.mjs write-evidence --payload FILE --output FILE
  node scripts/gate-c-candidate-contract.mjs validate-evidence --file FILE
  node scripts/gate-c-candidate-contract.mjs select-unique --root DIR --suffix .dmg|.app [--max-depth N] [--path-contains TEXT]
`;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CandidateStop("USAGE", `missing value for ${name}`);
  }
  return value;
}

function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );

  if (command === "validate-workflow") {
    const filePath = takeOption(args, "--file")
      ?? path.join(repositoryRoot, WORKFLOW_FILE);
    const content = readFileSync(filePath, "utf8");
    validateWorkflowYaml(content, {
      fileLabel: path.relative(repositoryRoot, filePath),
    });
    process.stdout.write(`workflow contract PASS ${path.relative(repositoryRoot, filePath)}\n`);
    return 0;
  }

  if (command === "validate-inputs") {
    const jsonPath = takeOption(args, "--json");
    if (!jsonPath) throw new CandidateStop("USAGE", usage());
    validateWorkflowInputs(JSON.parse(readFileSync(jsonPath, "utf8")));
    process.stdout.write("inputs contract PASS\n");
    return 0;
  }

  if (command === "classify-codesign") {
    const verifyPath = takeOption(args, "--verify");
    const displayPath = takeOption(args, "--display");
    if (!verifyPath || !displayPath) throw new CandidateStop("USAGE", usage());
    const classification = classifyCodesign(
      readFileSync(verifyPath, "utf8"),
      readFileSync(displayPath, "utf8"),
    );
    process.stdout.write(`${classification}\n`);
    return STOP_CODESIGN.has(classification) ? 2 : 0;
  }

  if (command === "write-evidence") {
    const payloadPath = takeOption(args, "--payload");
    const outputPath = takeOption(args, "--output");
    if (!payloadPath || !outputPath) throw new CandidateStop("USAGE", usage());
    const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
    const evidence = buildEvidence(payload);
    writeFileSync(outputPath, serializeDeterministicJson(evidence), { mode: 0o600 });
    process.stdout.write(`wrote evidence to ${outputPath}\n`);
    return 0;
  }

  if (command === "validate-evidence") {
    const filePath = takeOption(args, "--file");
    if (!filePath) throw new CandidateStop("USAGE", usage());
    validateEvidence(JSON.parse(readFileSync(filePath, "utf8")));
    process.stdout.write("evidence contract PASS\n");
    return 0;
  }

  if (command === "select-unique") {
    const root = takeOption(args, "--root");
    const suffix = takeOption(args, "--suffix");
    const maxDepthRaw = takeOption(args, "--max-depth");
    const pathContains = takeOption(args, "--path-contains");
    if (!root || !suffix) throw new CandidateStop("USAGE", usage());
    const selected = selectUniquePath({
      root,
      suffix,
      maxDepth: maxDepthRaw === null ? undefined : Number(maxDepthRaw),
      pathContains: pathContains ?? undefined,
    });
    process.stdout.write(`${selected}\n`);
    return 0;
  }

  throw new CandidateStop("USAGE", usage());
}

const invokedAsCli =
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  try {
    process.exitCode = runCli(process.argv);
  } catch (error) {
    const code = error instanceof CandidateStop ? error.code : "ERROR";
    process.stderr.write(`STOP ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
