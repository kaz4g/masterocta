#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tauriDir = path.join(repositoryRoot, "src-tauri");
const cargoBin = path.join(process.env.HOME ?? "", ".cargo", "bin");
const pathEnv = cargoBin ? `${cargoBin}:${process.env.PATH ?? ""}` : process.env.PATH;

/** @type {{ name: string; args: string[] }[]} */
const suites = [
  {
    name: "masterocta CT-01..03",
    args: [
      "test",
      "-p",
      "masterocta",
      "--features",
      "test-seams",
      "--locked",
      "ct0",
      "--",
      "--nocapture",
    ],
  },
  {
    name: "ot-catalog CT-04",
    args: ["test", "-p", "ot-catalog", "--locked", "ct04", "--", "--nocapture"],
  },
];

let failures = 0;

for (const suite of suites) {
  console.log(`\n>>> initial-contracts: ${suite.name}`);
  const result = spawnSync("cargo", suite.args, {
    cwd: tauriDir,
    env: { ...process.env, PATH: pathEnv },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(
      `initial-contracts: failed to start ${suite.name}: ${result.error.message}`,
    );
    failures += 1;
    continue;
  }
  if (result.signal) {
    console.error(
      `initial-contracts: ${suite.name} terminated by signal ${result.signal}`,
    );
    failures += 1;
    continue;
  }
  if (result.status !== 0) {
    console.error(
      `initial-contracts: ${suite.name} exited with status ${result.status ?? "unknown"}`,
    );
    failures += 1;
  }
}

process.exit(failures > 0 ? 1 : 0);
