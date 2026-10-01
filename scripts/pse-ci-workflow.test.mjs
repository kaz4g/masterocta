import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflow = readFileSync(
  path.join(repositoryRoot, ".github/workflows/pse-ci.yml"),
  "utf8",
);

describe("pse-ci workflow contract", () => {
  it("uses pull_request and main push, not pull_request_target", () => {
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /branches:\s*\[main\]/);
    assert.doesNotMatch(workflow, /pull_request_target/);
    assert.doesNotMatch(workflow, /workflow_dispatch:/);
  });

  it("pins actions to full SHAs and stays contents: read", () => {
    assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
    const uses = [...workflow.matchAll(/uses:\s+(\S+)/g)].map((match) => match[1]);
    assert.ok(uses.length > 0);
    for (const action of uses) {
      if (action.startsWith("./")) {
        continue;
      }
      const pin = action.slice(action.lastIndexOf("@") + 1);
      assert.match(pin, /^[0-9a-f]{40}$/i, action);
    }
  });

  it("keeps concurrency, timeouts, and an always() aggregate that evaluates results", () => {
    assert.match(workflow, /concurrency:/);
    assert.match(workflow, /timeout-minutes:/);
    assert.match(workflow, /if:\s*always\(\)/);
    assert.match(workflow, /pse-ci-aggregate\.mjs/);
    assert.match(workflow, /--linux-read-model/);
    assert.match(workflow, /--macos-fs-contract/);
    assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  });

  it("does not launch a signed release or Gate C candidate build", () => {
    assert.doesNotMatch(workflow, /gate-c-candidate/);
    assert.doesNotMatch(workflow, /tauri build/);
    assert.doesNotMatch(workflow, /softprops\/action-gh-release/);
  });
});
