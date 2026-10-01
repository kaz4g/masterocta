import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateAggregate, runCli } from "./pse-ci-aggregate.mjs";

const successJobs = {
  scope: "success",
  "script-contracts": "success",
  "linux-read-model": "success",
  "macos-fs-contract": "success",
};

describe("pse ci aggregate", () => {
  it("passes only when in-scope required jobs succeed", () => {
    const report = evaluateAggregate({ inScope: true, jobs: successJobs });
    assert.equal(report.verdict, "PASS");
    assert.equal(report.exit_code, 0);
  });

  it("reports NOT_APPLICABLE, not PASS, when rust jobs are expected skips", () => {
    const report = evaluateAggregate({
      inScope: false,
      scopeReason: "docs-only",
      jobs: {
        scope: "success",
        "script-contracts": "success",
        "linux-read-model": "skipped",
        "macos-fs-contract": "skipped",
      },
    });
    assert.equal(report.verdict, "NOT_APPLICABLE");
    assert.equal(report.exit_code, 0);
    assert.match(report.reason, /not a test PASS/);
  });

  it("fails on failure, cancel, unexpected skip, and unknown scope", () => {
    assert.equal(
      evaluateAggregate({
        inScope: true,
        jobs: { ...successJobs, "linux-read-model": "failure" },
      }).verdict,
      "FAIL",
    );
    assert.equal(
      evaluateAggregate({
        inScope: true,
        jobs: { ...successJobs, "macos-fs-contract": "cancelled" },
      }).verdict,
      "FAIL",
    );
    assert.equal(
      evaluateAggregate({
        inScope: true,
        jobs: { ...successJobs, "linux-read-model": "skipped" },
      }).verdict,
      "FAIL",
    );
    assert.equal(
      evaluateAggregate({
        inScope: "unknown",
        jobs: successJobs,
      }).verdict,
      "FAIL",
    );
    assert.equal(
      evaluateAggregate({
        inScope: false,
        jobs: {
          scope: "success",
          "script-contracts": "skipped",
        },
      }).verdict,
      "FAIL",
    );
  });

  it("does not exit 0 for a failing CLI evaluation", () => {
    const previous = process.exitCode;
    const code = runCli([
      "node",
      "scripts/pse-ci-aggregate.mjs",
      "--in-scope",
      "true",
      "--scope-result",
      "success",
      "--script-contracts",
      "success",
      "--linux-read-model",
      "failure",
      "--macos-fs-contract",
      "success",
    ]);
    process.exitCode = previous;
    assert.equal(code, 1);
  });
});
