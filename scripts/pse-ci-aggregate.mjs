#!/usr/bin/env node
/**
 * Required-check candidate evaluator for Project Structure CI.
 *
 * Never exits 0 unconditionally. Skipped in-scope jobs, cancelled jobs,
 * missing results, and unknown scope all fail. Out-of-scope rust jobs are
 * reported as NOT_APPLICABLE, not as a test PASS.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AGGREGATE_SCHEMA = "masterocta-pse-ci-aggregate:v1";

const ALWAYS_REQUIRED = ["scope", "script-contracts", "bank-mutation-safety"];
const IN_SCOPE_REQUIRED = ["linux-read-model", "macos-fs-contract"];

function fail(reason, jobs, extras = {}) {
  return {
    schema: AGGREGATE_SCHEMA,
    verdict: "FAIL",
    exit_code: 1,
    reason,
    jobs,
    ...extras,
  };
}

export function evaluateAggregate({
  inScope,
  jobs,
  scopeReason = "",
} = {}) {
  const observed = jobs ?? {};
  for (const name of ALWAYS_REQUIRED) {
    const result = observed[name];
    if (!result) {
      return fail(`${name} result is missing`, observed);
    }
    if (result === "cancelled") {
      return fail(`${name} was cancelled`, observed);
    }
    if (result === "skipped") {
      return fail(`${name} skipped unexpectedly`, observed);
    }
    if (result !== "success") {
      return fail(`${name} ${result}`, observed);
    }
  }

  if (inScope === "unknown" || inScope === "" || inScope == null) {
    return fail("scope is unknown; not treated as out of scope", observed);
  }

  const scoped = inScope === true || inScope === "true";
  if (!scoped) {
    for (const name of IN_SCOPE_REQUIRED) {
      const result = observed[name];
      if (result === "failure" || result === "cancelled") {
        return fail(`${name} ${result} while marked out of scope`, observed);
      }
    }
    const detail = scopeReason ? `${scopeReason}; ` : "";
    return {
      schema: AGGREGATE_SCHEMA,
      verdict: "NOT_APPLICABLE",
      exit_code: 0,
      reason: `${detail}out of scope: rust read-model jobs were not executed and this is not a test PASS`,
      jobs: observed,
    };
  }

  for (const name of IN_SCOPE_REQUIRED) {
    const result = observed[name];
    if (!result) {
      return fail(`${name} result is missing while in scope`, observed);
    }
    if (result === "skipped") {
      return fail(`${name} skipped while in scope`, observed);
    }
    if (result === "cancelled") {
      return fail(`${name} was cancelled`, observed);
    }
    if (result !== "success") {
      return fail(`${name} ${result}`, observed);
    }
  }

  return {
    schema: AGGREGATE_SCHEMA,
    verdict: "PASS",
    exit_code: 0,
    reason: "required Project Structure jobs succeeded",
    jobs: observed,
  };
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

export function runCli(argv) {
  const args = argv.slice(2);
  const report = evaluateAggregate({
    inScope: takeOption(args, "--in-scope"),
    scopeReason: takeOption(args, "--reason") ?? "",
    jobs: {
      scope: takeOption(args, "--scope-result"),
      "script-contracts": takeOption(args, "--script-contracts"),
      "bank-mutation-safety": takeOption(args, "--bank-mutation-safety"),
      "linux-read-model": takeOption(args, "--linux-read-model"),
      "macos-fs-contract": takeOption(args, "--macos-fs-contract"),
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.exit_code;
}

const invokedAsCli =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsCli) {
  process.exitCode = runCli(process.argv);
}
