import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runnerPath = path.join(repositoryRoot, "scripts/run-initial-contracts.mjs");
const packageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);

describe("run-initial-contracts runner", () => {
  it("package.json delegates to the Node runner", () => {
    assert.equal(
      packageJson.scripts["test:initial-contracts"],
      "node scripts/run-initial-contracts.mjs",
    );
  });

  it("runner executes each contract suite independently", () => {
    const source = readFileSync(runnerPath, "utf8");
    assert.match(source, /masterocta CT-01\.\.03/);
    assert.match(source, /ot-catalog CT-04/);
    assert.match(source, /spawnSync\("cargo"/);
    assert.match(source, /process\.exit\(failures > 0 \? 1 : 0\)/);
  });
});
