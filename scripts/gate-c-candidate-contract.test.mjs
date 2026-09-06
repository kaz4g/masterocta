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
  discoverDmgPaths,
  selectUniquePath,
  serializeDeterministicJson,
  validateCandidateId,
  validateEvidence,
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
    codesign_command_result: "valid on disk",
    spctl_result: "rejected",
    build_environment: "github-actions-macos-arm64",
    node_version: "v22.0.0",
    pnpm_version: "11.24.0",
    rust_version: "1.85.0",
    cargo_version: "1.85.0",
    xcode_version: "16.0",
    runner_os: "macOS",
    runner_arch: "ARM64",
    runner_image: "macos-latest",
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
        assertEvidenceDoesNotLeakSecrets(
          sampleEvidence({ codesign_command_result: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }),
        ),
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
