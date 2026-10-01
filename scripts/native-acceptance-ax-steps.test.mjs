import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "native-acceptance-ax-steps.js");
const source = readFileSync(scriptPath, "utf8");

test("canonical path does not assign AXValue", () => {
  const assignments = source.split("\n").filter((line) => /\.value\s*=[^=]/.test(line));
  assert.ok(assignments.length > 0);
  for (const line of assignments) {
    assert.match(line, /AXFocused/);
  }
  assert.match(source, /setTheClipboardTo/);
  assert.match(source, /keystroke\("v"/);
  assert.doesNotMatch(source, /\.value\s*=\s*path/);
  assert.doesNotMatch(source, /\.value\s*=\s*value/);
});

test("focus and export-lock polls stay inside the requested bounds", () => {
  assert.match(source, /const GTF_FOCUS_POLL_MS = 80;/);
  assert.match(source, /const GTF_FOCUS_TIMEOUT_MS = 4000;/);
  assert.match(source, /const EXPORT_LOCK_POLL_MS = 30;/);
  assert.match(source, /const EXPORT_LOCK_TIMEOUT_MS = 8000;/);
  assert.match(source, /GO_TO_FOLDER_FOCUS_TIMEOUT/);
  assert.match(source, /EXPORT_MARKER_LOCK_NOT_OBSERVED/);
  assert.match(source, /\[GTF_FOCUS\]/);
  assert.match(source, /\[RANGE_CLIPBOARD\]/);
  assert.match(source, /\[EXPORT_MARKER_LOCK\]/);
});

test("focus timeout stops before any paste", { skip: process.platform !== "darwin" }, () => {
  const run = spawnSync("osascript", ["-l", "JavaScript", scriptPath, "focus-timeout-smoke"], {
    encoding: "utf8",
  });
  const output = `${run.stdout}\n${run.stderr}`;
  assert.notEqual(run.status, 0);
  assert.match(output, /\[GTF\]\[OPEN\] PASS/);
  assert.match(output, /\[GTF\]\[FIELD\] FOUND/);
  assert.match(output, /\[GTF_FOCUS\] START/);
  assert.match(output, /\[GTF_FOCUS\] WAIT/);
  assert.match(output, /\[GTF_FOCUS\] FAIL elapsed_ms=\d+/);
  assert.match(output, /GO_TO_FOLDER_FOCUS_TIMEOUT/);
  assert.doesNotMatch(output, /\[GTF\]\[PASTE\]/);
  assert.doesNotMatch(output, /setTheClipboardTo|keystroke/);
});
