import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CODESIGN_CLASSIFICATIONS,
  CONFIRMATION_PHRASE,
  EVIDENCE_SCHEMA,
  CandidateStop,
  artifactFilenameFor,
  assertEvidenceDoesNotLeakSecrets,
  assertHashUnchanged,
  buildChecksumManifest,
  buildEvidence,
  classifyCodesign,
  classifySpctl,
  collectMatchingPaths,
  containsAbsoluteFilesystemPath,
  discoverDmgPaths,
  formatRunnerImage,
  sanitizeCodesignCommandResult,
  sanitizeSpctlResult,
  sanitizeVerificationOutputs,
  selectUniquePath,
  serializeDeterministicJson,
  validateCandidateId,
  validateEvidence,
  validatePreReleaseEvidence,
  validateRunnerImage,
  validateUploadCompleteness,
  validateWorkflowInputs,
  validateWorkflowYaml,
} from "./gate-c-candidate-contract.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflowPath = path.join(repositoryRoot, ".github/workflows/gate-c-candidate.yml");
const workflowContent = readFileSync(workflowPath, "utf8");

const sourceSha = "cc6523fc34ccd69e8242188f74d9df59a3102e1f";
const sourceTree = "3078a03a3a047c9aa8764e40c5a80de5823381d3";
const candidateId = "gate-c-rc2-cc6523fc34cc";

function baseInputs(overrides = {}) {
  return {
    candidate_id: candidateId,
    expected_source_sha: sourceSha,
    expected_source_tree: sourceTree,
    confirmation: CONFIRMATION_PHRASE,
    github_ref: "refs/heads/main",
    github_sha: sourceSha,
    run_attempt: 1,
    ...overrides,
  };
}

function sampleEvidence(overrides = {}) {
  return buildEvidence({
    schema: EVIDENCE_SCHEMA,
    candidate_id: candidateId,
    source_commit: sourceSha,
    source_tree: sourceTree,
    checkout_sha: sourceSha,
    workflow_name: "Gate C Candidate Build",
    workflow_ref: "kaz4g/masterocta/.github/workflows/gate-c-candidate.yml@refs/heads/main",
    workflow_sha: sourceSha,
    run_id: 1,
    run_attempt: 1,
    run_url: "https://github.com/kaz4g/masterocta/actions/runs/1",
    repository: "kaz4g/masterocta",
    ref: "refs/heads/main",
    artifact_filename: artifactFilenameFor(candidateId, sourceSha, "0.1.0"),
    target_architecture: "aarch64-apple-darwin",
    dmg_sha256: `sha256:${"a".repeat(64)}`,
    enclosed_binary_relative_path: "Masta-Octa.app/Contents/MacOS/masterocta",
    enclosed_binary_sha256: `sha256:${"b".repeat(64)}`,
    dmg_verification_result: "PASS",
    codesign_classification: "AD_HOC_VERIFIED",
    codesign_command_result: "valid_on_disk_and_designated_requirement_satisfied",
    spctl_result: "rejected_expected",
    build_environment: "github-actions-macos-arm64",
    node_version: "v22.0.0",
    pnpm_version: "11.24.0",
    rust_version: "1.85.0",
    cargo_version: "1.85.0",
    xcode_version: "16.0",
    runner_os: "macOS",
    runner_arch: "ARM64",
    runner_image: "macos-15@20240922.1",
    checksum_manifest_filename: `${candidateId}-checksum-manifest.json`,
    checksum_manifest_sha256: `sha256:${"c".repeat(64)}`,
    candidate_storage_type: "github_draft_release",
    draft_release_tag: candidateId,
    draft_release_id: 12345,
    access_boundary_classification: "authenticated_collaborators_only",
    generated_at: "auxiliary_non_identity",
    ...overrides,
  });
}

describe("candidate identity", () => {
  it("accepts a valid candidate_id bound to source sha prefix", () => {
    assert.equal(validateCandidateId(candidateId, sourceSha), candidateId);
  });

  it("builds deterministic artifact filenames", () => {
    assert.equal(
      artifactFilenameFor(candidateId, sourceSha, "0.1.0"),
      "Masta-Octa_0.1.0_gate-c-rc2_cc6523fc34cc_aarch64.dmg",
    );
  });

  it("rejects malformed candidate_id and suffix mismatch", () => {
    assert.throws(
      () => validateCandidateId("rc2-cc6523fc34cc", sourceSha),
      (error) => error instanceof CandidateStop && error.code === "INVALID_CANDIDATE_ID",
    );
    assert.throws(
      () => validateCandidateId("gate-c-rc2-aaaaaaaaaaaa", sourceSha),
      (error) => error instanceof CandidateStop && error.code === "IDENTITY_MISMATCH",
    );
  });
});

describe("workflow inputs", () => {
  it("requires main ref, matching sha, tree, attempt 1, and confirmation", () => {
    assert.doesNotThrow(() => validateWorkflowInputs(baseInputs()));
    assert.throws(
      () => validateWorkflowInputs(baseInputs({ github_ref: "refs/heads/other" })),
      (error) => error instanceof CandidateStop && error.code === "INVALID_REF",
    );
    assert.throws(
      () => validateWorkflowInputs(baseInputs({ github_sha: "f".repeat(40) })),
      (error) => error instanceof CandidateStop && error.code === "SHA_MISMATCH",
    );
    assert.throws(
      () => validateWorkflowInputs(baseInputs({ run_attempt: 2 })),
      (error) => error instanceof CandidateStop && error.code === "INVALID_ATTEMPT",
    );
    assert.throws(
      () => validateWorkflowInputs(baseInputs({ confirmation: "NOPE" })),
      (error) => error instanceof CandidateStop && error.code === "INVALID_CONFIRMATION",
    );
  });
});

describe("workflow yaml contract", () => {
  it("accepts the Gate C candidate workflow", () => {
    assert.doesNotThrow(() => validateWorkflowYaml(workflowContent));
  });

  it("is workflow_dispatch only", () => {
    assert.match(workflowContent, /^on:\s*\n\s*workflow_dispatch:/m);
    assert.doesNotMatch(workflowContent, /^\s*push:/m);
    assert.doesNotMatch(workflowContent, /^\s*pull_request:/m);
  });

  it("requires source binding, locked build, verification, and draft storage", () => {
    for (const pattern of [
      /expected_source_sha/,
      /expected_source_tree/,
      /pnpm[^\n]*--frozen-lockfile/,
      /--locked/,
      /hdiutil verify/,
      /Contents\/MacOS\/masterocta/,
      /shasum -a 256/,
      /codesign --verify --deep --strict/,
      /spctl --assess --type execute/,
      /draft:\s*true|--draft/,
      /prerelease:\s*true|--prerelease/,
      /make_latest:\s*false/,
      /gate-c-candidate-contract\.mjs/,
      /releases\/tags/,
    ]) {
      assert.match(workflowContent, pattern, String(pattern));
    }
  });

  it("forbids overwrite, publish, public artifact, and rc-release reuse", () => {
    for (const pattern of [
      /gh release delete/i,
      /git push origin --delete/i,
      /--clobber/i,
      /publish-release/,
      /draft:\s*false/,
      /make_latest:\s*true/,
      /tauri-apps\/tauri-action/,
      /actions\/upload-artifact/,
      /rc-release\.yml/,
      /Swatinem\/rust-cache/,
      /sed -i[^\n]*Cargo\.toml/i,
    ]) {
      assert.doesNotMatch(workflowContent, pattern, String(pattern));
    }
  });

  it("does not use mapfile or readarray", () => {
    assert.doesNotMatch(workflowContent, /\bmapfile\b/);
    assert.doesNotMatch(workflowContent, /\breadarray\b/);
  });
});

describe("DMG discovery", () => {
  it("stops on zero or multiple DMG paths", () => {
    assert.throws(
      () => discoverDmgPaths([]),
      (error) => error instanceof CandidateStop && error.code === "DMG_NOT_FOUND",
    );
    assert.throws(
      () => discoverDmgPaths(["a.dmg", "b.dmg"]),
      (error) => error instanceof CandidateStop && error.code === "DMG_AMBIGUOUS",
    );
    assert.equal(discoverDmgPaths(["bundle/aarch64.dmg"]), "bundle/aarch64.dmg");
  });
});

describe("portable unique discovery", () => {
  function withTempRoot(fn) {
    const root = mkdtempSync(path.join(tmpdir(), "gate-c-discover-"));
    try {
      return fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function writeFile(filePath, contents = "fixture") {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  it("rejects zero DMG matches", () => {
    withTempRoot((root) => {
      mkdirSync(path.join(root, "aarch64-apple-darwin"), { recursive: true });
      assert.throws(
        () => selectUniquePath({
          root,
          suffix: ".dmg",
          pathContains: "aarch64-apple-darwin",
        }),
        (error) => error instanceof CandidateStop && error.code === "DMG_NOT_FOUND",
      );
    });
  });

  it("selects exactly one DMG", () => {
    withTempRoot((root) => {
      const expected = path.join(root, "aarch64-apple-darwin", "release", "Masta-Octa.dmg");
      writeFile(expected);
      writeFile(path.join(root, "x86_64-apple-darwin", "other.dmg"));
      assert.equal(
        selectUniquePath({
          root,
          suffix: ".dmg",
          pathContains: "aarch64-apple-darwin",
        }),
        expected,
      );
    });
  });

  it("rejects multiple DMG matches", () => {
    withTempRoot((root) => {
      writeFile(path.join(root, "aarch64-apple-darwin", "a.dmg"));
      writeFile(path.join(root, "aarch64-apple-darwin", "b.dmg"));
      assert.throws(
        () => selectUniquePath({
          root,
          suffix: ".dmg",
          pathContains: "aarch64-apple-darwin",
        }),
        (error) => error instanceof CandidateStop && error.code === "DMG_AMBIGUOUS",
      );
    });
  });

  it("rejects zero .app matches", () => {
    withTempRoot((root) => {
      writeFile(path.join(root, "README.txt"));
      assert.throws(
        () => selectUniquePath({ root, suffix: ".app", maxDepth: 1 }),
        (error) => error instanceof CandidateStop && error.code === "APP_NOT_FOUND",
      );
    });
  });

  it("selects exactly one .app", () => {
    withTempRoot((root) => {
      const expected = path.join(root, "Masta-Octa.app");
      mkdirSync(expected, { recursive: true });
      mkdirSync(path.join(root, "nested", "Ignored.app"), { recursive: true });
      assert.equal(
        selectUniquePath({ root, suffix: ".app", maxDepth: 1 }),
        expected,
      );
    });
  });

  it("rejects multiple .app matches", () => {
    withTempRoot((root) => {
      mkdirSync(path.join(root, "Alpha.app"), { recursive: true });
      mkdirSync(path.join(root, "Beta.app"), { recursive: true });
      assert.throws(
        () => selectUniquePath({ root, suffix: ".app", maxDepth: 1 }),
        (error) => error instanceof CandidateStop && error.code === "APP_AMBIGUOUS",
      );
    });
  });

  it("preserves paths that contain spaces", () => {
    withTempRoot((root) => {
      const dmg = path.join(root, "aarch64-apple-darwin", "Masta Octa.dmg");
      const app = path.join(root, "Masta Octa.app");
      writeFile(dmg);
      mkdirSync(app, { recursive: true });
      assert.equal(
        selectUniquePath({
          root,
          suffix: ".dmg",
          pathContains: "aarch64-apple-darwin",
        }),
        dmg,
      );
      assert.equal(
        selectUniquePath({ root, suffix: ".app", maxDepth: 1 }),
        app,
      );
    });
  });

  it("returns matching paths in deterministic order", () => {
    withTempRoot((root) => {
      writeFile(path.join(root, "aarch64-apple-darwin", "z.dmg"));
      writeFile(path.join(root, "aarch64-apple-darwin", "a.dmg"));
      writeFile(path.join(root, "aarch64-apple-darwin", "m.dmg"));
      const first = collectMatchingPaths({
        root,
        suffix: ".dmg",
        pathContains: "aarch64-apple-darwin",
      });
      const second = collectMatchingPaths({
        root,
        suffix: ".dmg",
        pathContains: "aarch64-apple-darwin",
      });
      assert.deepEqual(
        first.map((entry) => path.basename(entry)),
        ["a.dmg", "m.dmg", "z.dmg"],
      );
      assert.deepEqual(first, second);
    });
  });
});

describe("hash and upload contracts", () => {
  it("rejects post-hash byte changes", () => {
    assert.doesNotThrow(() =>
      assertHashUnchanged(`sha256:${"a".repeat(64)}`, `sha256:${"a".repeat(64)}`, "DMG"),
    );
    assert.throws(
      () => assertHashUnchanged(`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, "DMG"),
      (error) => error instanceof CandidateStop && error.code === "HASH_CHANGED",
    );
  });

  it("requires complete uploads", () => {
    assert.doesNotThrow(() =>
      validateUploadCompleteness(
        ["a.dmg", "manifest.json", "evidence.json"],
        ["a.dmg", "manifest.json", "evidence.json"],
      ),
    );
    assert.throws(
      () => validateUploadCompleteness(["a.dmg"], ["a.dmg", "manifest.json"]),
      (error) => error instanceof CandidateStop && error.code === "INCOMPLETE_UPLOAD",
    );
  });
});

describe("codesign classification", () => {
  it("classifies ad-hoc and developer id outcomes", () => {
    assert.equal(
      classifyCodesign("valid on disk", "Signature=adhoc"),
      "AD_HOC_VERIFIED",
    );
    assert.equal(
      classifyCodesign("valid on disk", "Authority=Developer ID Application: Example"),
      "DEVELOPER_ID_VERIFIED",
    );
    assert.equal(
      classifyCodesign("invalid signature", "Authority=Developer ID Application: Example"),
      "SIGNATURE_INTEGRITY_FAILURE",
    );
    assert.equal(classifyCodesign("", ""), "UNKNOWN");
  });

  it("records expected spctl rejection without treating it as signed", () => {
    const adhoc = classifySpctl("rejected", "AD_HOC_VERIFIED");
    assert.equal(adhoc.acceptable, true);
    const signed = classifySpctl("rejected", "DEVELOPER_ID_VERIFIED");
    assert.equal(signed.acceptable, false);
  });
});

describe("evidence contract", () => {
  it("builds deterministic evidence JSON", () => {
    const first = serializeDeterministicJson(sampleEvidence());
    const second = serializeDeterministicJson(sampleEvidence());
    assert.equal(first, second);
  });

  it("validates required evidence fields and hash formats", () => {
    assert.doesNotThrow(() => validateEvidence(sampleEvidence()));
    assert.throws(
      () => validateEvidence({ ...sampleEvidence(), dmg_sha256: "bad" }),
      (error) => error instanceof CandidateStop && error.code === "INVALID_HASH",
    );
    assert.throws(
      () => validateEvidence({ ...sampleEvidence(), source_commit: "f".repeat(40) }),
      (error) => error instanceof CandidateStop && error.code === "IDENTITY_MISMATCH",
    );
    assert.throws(
      () => validateEvidence({ ...sampleEvidence(), codesign_classification: "UNKNOWN" }),
      (error) => error instanceof CandidateStop && error.code === "CODESIGN_STOP",
    );
  });

  it("rejects secrets and absolute user paths in evidence", () => {
    assert.doesNotThrow(() => assertEvidenceDoesNotLeakSecrets(sampleEvidence()));
    assert.throws(
      () =>
        assertEvidenceDoesNotLeakSecrets(
          sampleEvidence({ run_url: "file:///Users/secret/run" }),
        ),
      (error) => error instanceof CandidateStop && error.code === "PATH_LEAK",
    );
    assert.throws(
      () =>
        assertEvidenceDoesNotLeakSecrets({
          ...sampleEvidence(),
          node_version: "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
        }),
      (error) => error instanceof CandidateStop && error.code === "SECRET_LEAK",
    );
  });

  it("builds checksum manifest entries for DMG and enclosed binary", () => {
    const manifest = buildChecksumManifest({
      candidateId,
      artifactFilename: artifactFilenameFor(candidateId, sourceSha, "0.1.0"),
      dmgSha256: `sha256:${"a".repeat(64)}`,
      enclosedBinaryRelativePath: "Masta-Octa.app/Contents/MacOS/masterocta",
      enclosedBinarySha256: `sha256:${"b".repeat(64)}`,
    });
    assert.equal(manifest.candidate_id, candidateId);
    assert.equal(manifest.artifacts.length, 2);
  });

  it("covers all codesign classification labels", () => {
    assert.deepEqual(CODESIGN_CLASSIFICATIONS.length, 5);
  });
});

describe("runner image identity", () => {
  it("passes a non-empty runtime runner_image into evidence", () => {
    const evidence = sampleEvidence();
    assert.equal(evidence.runner_image, "macos-15@20240922.1");
    assert.match(evidence.runner_image, /^[a-z]+-[0-9]+@\d{8}(?:\.\d+)+$/);
  });

  it("stops when ImageOS is missing", () => {
    assert.throws(
      () => formatRunnerImage("", "20240922.1"),
      (error) => error instanceof CandidateStop && error.code === "MISSING_IMAGE_OS",
    );
  });

  it("stops when ImageVersion is missing", () => {
    assert.throws(
      () => formatRunnerImage("macos15", ""),
      (error) => error instanceof CandidateStop && error.code === "MISSING_IMAGE_VERSION",
    );
  });

  it("rejects placeholder and unknown runner image values", () => {
    assert.throws(
      () => formatRunnerImage("unknown", "20240922.1"),
      (error) => error instanceof CandidateStop && error.code === "INVALID_IMAGE_OS",
    );
    assert.throws(
      () => validateRunnerImage("unknown"),
      (error) => error instanceof CandidateStop && error.code === "INVALID_RUNNER_IMAGE",
    );
    assert.throws(
      () => validateRunnerImage("macos-latest"),
      (error) => error instanceof CandidateStop && error.code === "INVALID_RUNNER_IMAGE",
    );
    assert.throws(
      () => validateEvidence({ ...sampleEvidence(), runner_image: "macos-latest" }),
      (error) => error instanceof CandidateStop && error.code === "INVALID_RUNNER_IMAGE",
    );
  });

  it("builds a deterministic runtime image identity", () => {
    assert.equal(formatRunnerImage("macos15", "20240922.1"), "macos-15@20240922.1");
    assert.equal(formatRunnerImage("macos26", "20260824.0482.1"), "macos-26@20260824.0482.1");
    assert.equal(
      formatRunnerImage("macos15", "20240922.1"),
      formatRunnerImage("macos15", "20240922.1"),
    );
  });
});

describe("verification output sanitization", () => {
  const adhocVerify = [
    "/var/folders/d8/hvxvltxn0fl4rmnd52sncbth0000gn/T/tmp.uNPBO0Z6MO/Masta-Octa.app: valid on disk",
    "/var/folders/d8/hvxvltxn0fl4rmnd52sncbth0000gn/T/tmp.uNPBO0Z6MO/Masta-Octa.app: satisfies its Designated Requirement",
  ].join("\n");
  const privateVerify = [
    "/private/var/folders/zz/abc/T/tmp.AAA/Masta-Octa.app: valid on disk",
    "/private/var/folders/zz/abc/T/tmp.AAA/Masta-Octa.app: satisfies its Designated Requirement",
  ].join("\n");
  const spacedVerify = [
    "/var/folders/d8/hvxvltxn0fl4rmnd52sncbth0000gn/T/tmp.uNPBO0Z6MO/Masta Octa.app: valid on disk",
    "/var/folders/d8/hvxvltxn0fl4rmnd52sncbth0000gn/T/tmp.uNPBO0Z6MO/Masta Octa.app: satisfies its Designated Requirement",
  ].join("\n");
  const adhocDisplay = "Signature=adhoc";
  const adhocSpctl = "/var/folders/d8/hvxvltxn0fl4rmnd52sncbth0000gn/T/tmp.uNPBO0Z6MO/Masta-Octa.app: rejected";

  it("does not export /var/folders app paths", () => {
    const sanitized = sanitizeVerificationOutputs({
      verifyOutput: adhocVerify,
      displayOutput: adhocDisplay,
      spctlOutput: adhocSpctl,
    });
    assert.equal(
      sanitized.codesign_command_result,
      "valid_on_disk_and_designated_requirement_satisfied",
    );
    assert.doesNotMatch(JSON.stringify(sanitized), /\/var\/folders/);
  });

  it("does not export /private/var/folders paths", () => {
    const sanitized = sanitizeVerificationOutputs({
      verifyOutput: privateVerify,
      displayOutput: adhocDisplay,
      spctlOutput: "/private/var/folders/zz/abc/T/tmp.AAA/Masta-Octa.app: rejected",
    });
    assert.doesNotMatch(JSON.stringify(sanitized), /\/private\/var\/folders/);
    assert.equal(sanitized.spctl_result, "rejected_expected");
  });

  it("sanitizes app paths that contain spaces", () => {
    const sanitized = sanitizeVerificationOutputs({
      verifyOutput: spacedVerify,
      displayOutput: adhocDisplay,
      spctlOutput: "/var/folders/d8/x/T/tmp.x/Masta Octa.app: rejected",
    });
    assert.equal(
      sanitized.codesign_command_result,
      "valid_on_disk_and_designated_requirement_satisfied",
    );
    assert.doesNotMatch(JSON.stringify(sanitized), /Masta Octa\.app/);
  });

  it("rejects /Users paths in evidence", () => {
    assert.equal(containsAbsoluteFilesystemPath("/Users/runner/work/app"), true);
    assert.throws(
      () =>
        assertEvidenceDoesNotLeakSecrets({
          ...sampleEvidence(),
          xcode_version: "/Users/runner/work/Xcode.app",
        }),
      (error) => error instanceof CandidateStop && error.code === "PATH_LEAK",
    );
  });

  it("rejects /home paths in evidence", () => {
    assert.equal(containsAbsoluteFilesystemPath("/home/runner/work/app"), true);
    assert.throws(
      () =>
        assertEvidenceDoesNotLeakSecrets({
          ...sampleEvidence(),
          rust_version: "/home/runner/.rustup",
        }),
      (error) => error instanceof CandidateStop && error.code === "PATH_LEAK",
    );
  });

  it("rejects Windows absolute paths in evidence", () => {
    assert.equal(containsAbsoluteFilesystemPath("C:\\Users\\runner\\work\\app"), true);
    assert.throws(
      () =>
        assertEvidenceDoesNotLeakSecrets({
          ...sampleEvidence(),
          cargo_version: "C:\\Users\\runner\\work\\app",
        }),
      (error) => error instanceof CandidateStop && error.code === "PATH_LEAK",
    );
  });

  it("converts valid codesign output into an allowed token", () => {
    assert.equal(
      sanitizeCodesignCommandResult(adhocVerify, "AD_HOC_VERIFIED"),
      "valid_on_disk_and_designated_requirement_satisfied",
    );
  });

  it("classifies expected ad-hoc spctl rejection", () => {
    assert.equal(
      sanitizeSpctlResult(adhocSpctl, "AD_HOC_VERIFIED"),
      "rejected_expected",
    );
    const classified = classifySpctl(adhocSpctl, "AD_HOC_VERIFIED");
    assert.equal(classified.acceptable, true);
  });

  it("stops on unknown verification output", () => {
    assert.throws(
      () => sanitizeVerificationOutputs({
        verifyOutput: "something unexplained",
        displayOutput: "also unexplained",
        spctlOutput: "mystery",
      }),
      (error) => error instanceof CandidateStop && (
        error.code === "CODESIGN_STOP" || error.code === "CODESIGN_OUTPUT_MISMATCH"
      ),
    );
  });

  it("keeps sanitized evidence free of absolute paths", () => {
    const sanitized = sanitizeVerificationOutputs({
      verifyOutput: adhocVerify,
      displayOutput: adhocDisplay,
      spctlOutput: adhocSpctl,
    });
    const evidence = sampleEvidence({
      codesign_classification: sanitized.codesign_classification,
      codesign_command_result: sanitized.codesign_command_result,
      spctl_result: sanitized.spctl_result,
    });
    assert.doesNotMatch(JSON.stringify(evidence), /\/var\/folders/);
    assert.doesNotMatch(JSON.stringify(evidence), /\/private\/var/);
    assert.doesNotMatch(JSON.stringify(evidence), /\/Users\//);
    assert.doesNotThrow(() => validateEvidence(evidence));
  });
});

describe("workflow evidence ordering", () => {
  it("validates evidence inputs before creating the draft release", () => {
    const preflight = workflowContent.indexOf("Preflight candidate evidence inputs");
    const release = workflowContent.indexOf("Create draft candidate release");
    assert.ok(preflight !== -1 && release !== -1);
    assert.ok(preflight < release);
    assert.match(workflowContent, /validate-prerelease-evidence/);
  });

  it("writes final evidence only after the numeric release ID exists", () => {
    const release = workflowContent.indexOf("Create draft candidate release");
    const evidence = workflowContent.indexOf("Write candidate evidence");
    assert.ok(release !== -1 && evidence !== -1);
    assert.ok(release < evidence);
    assert.match(workflowContent, /databaseId/);
    assert.match(workflowContent, /steps\.release\.outputs\.release_id/);
  });

  it("does not pass raw codesign or spctl output into evidence env", () => {
    assert.doesNotMatch(
      workflowContent,
      /CODESIGN_COMMAND_RESULT:.*tr '\\n' ' '/,
    );
    assert.doesNotMatch(workflowContent, /spctl_result=\$\(tr '\\n' ' '/);
    assert.doesNotMatch(
      workflowContent,
      /echo "codesign_command_result=\$\(tr/,
    );
  });

  it("passes only sanitized verification outputs", () => {
    assert.match(workflowContent, /sanitize-verification/);
    assert.ok(
      workflowContent.includes(
        "CODESIGN_COMMAND_RESULT: ${{ steps.verify.outputs.codesign_command_result }}",
      ),
    );
    assert.ok(
      workflowContent.includes(
        "SPCTL_RESULT: ${{ steps.verify.outputs.spctl_result }}",
      ),
    );
  });

  it("wires runner_image from toolchain output", () => {
    assert.match(workflowContent, /format-runner-image/);
    assert.match(workflowContent, /ImageOS/);
    assert.match(workflowContent, /ImageVersion/);
    assert.ok(
      workflowContent.includes(
        "RUNNER_IMAGE: ${{ steps.toolchain.outputs.runner_image }}",
      ),
    );
  });

  it("does not reintroduce mapfile or readarray", () => {
    assert.doesNotMatch(workflowContent, /\bmapfile\b/);
    assert.doesNotMatch(workflowContent, /\breadarray\b/);
  });

  it("does not delete releases, clobber uploads, publish, or rerun", () => {
    assert.doesNotMatch(workflowContent, /gh release delete/i);
    assert.doesNotMatch(workflowContent, /--clobber/);
    assert.doesNotMatch(workflowContent, /publish-release/);
    assert.doesNotMatch(workflowContent, /draft:\s*false/);
    assert.doesNotMatch(workflowContent, /gh run rerun/i);
  });
});

describe("pre-release evidence validation", () => {
  it("accepts complete inputs without a release ID", () => {
    const { draft_release_id: _omitted, ...preRelease } = sampleEvidence();
    assert.doesNotThrow(() => validatePreReleaseEvidence(preRelease));
  });

  it("rejects a placeholder release ID before draft creation", () => {
    assert.throws(
      () => validatePreReleaseEvidence({ ...sampleEvidence(), draft_release_id: 0 }),
      (error) => error instanceof CandidateStop && error.code === "PREMATURE_RELEASE_ID",
    );
  });
});
