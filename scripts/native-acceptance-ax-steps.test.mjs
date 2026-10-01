import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import "./native-acceptance-ax-steps.js";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "native-acceptance-ax-steps.js");
const source = readFileSync(scriptPath, "utf8");
const axSteps = globalThis.NativeAcceptanceAxSteps;

assert.equal(typeof axSteps, "object");
assert.equal(typeof axSteps.stepGotoGo, "function");

function clock() {
  let t = 0;
  return {
    now: () => t,
    delay: (seconds) => {
      t += seconds * 1000;
    },
  };
}

function invoke(fn, extraRuntime = {}) {
  const lines = [];
  const time = clock();
  let exitCode = null;
  axSteps.resetRuntime();
  axSteps.setRuntime({
    now: time.now,
    delay: time.delay,
    log: (line) => {
      lines.push(line);
    },
    exit: (code) => {
      exitCode = code;
      throw new Error("AX_EXIT_" + code);
    },
    ...extraRuntime,
  });
  let result = null;
  let error = null;
  try {
    result = fn();
  } catch (err) {
    error = err;
  }
  axSteps.resetRuntime();
  return { result, error, exitCode, lines, output: lines.join("\n") };
}

function el(attrs) {
  const actions = attrs.actions || ["AXPress"];
  return {
    role: () => attrs.role,
    name: () => (Object.prototype.hasOwnProperty.call(attrs, "name") ? attrs.name : null),
    title: () => null,
    description: () => (Object.prototype.hasOwnProperty.call(attrs, "description") ? attrs.description : null),
    value: () => (typeof attrs.value === "function" ? attrs.value() : attrs.value),
    subrole: () => attrs.subrole || null,
    focused: () => (typeof attrs.focused === "function" ? attrs.focused() : !!attrs.focused),
    enabled: () => (typeof attrs.enabled === "function" ? attrs.enabled() : attrs.enabled !== false),
    selected: () => !!attrs.selected,
    actions: {
      name: () => actions,
      byName: (actionName) => ({
        perform: () => {
          if (typeof attrs.onPress === "function") attrs.onPress(actionName);
        },
      }),
    },
  };
}

function makeAx({ pid, contents, frontmostPid }) {
  const events = [];
  let clipboard = "";
  const win = {
    name: () => "Masta-Octa",
    subrole: () => "AXStandardWindow",
    sheets: () => [],
    entireContents: () => (typeof contents === "function" ? contents() : contents),
  };
  const ax = {
    se: {
      processes: {
        whose: () => [{ unixId: () => (frontmostPid === undefined ? pid : frontmostPid) }],
      },
      keystroke: (key) => {
        events.push("keystroke:" + key);
      },
      keyCode: (code) => {
        events.push("keyCode:" + code);
      },
    },
    proc: {},
    win,
  };
  return {
    ax,
    events,
    Application: () => ({
      includeStandardAdditions: false,
      theClipboard: () => clipboard,
      setTheClipboardTo: (value) => {
        clipboard = String(value);
        events.push("clipboard");
      },
    }),
  };
}

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

test("usage documents this helper, not missing driver files", () => {
  assert.match(source, /osascript -l JavaScript scripts\/native-acceptance-ax-steps\.js/);
  assert.doesNotMatch(source, /native-acceptance-ax-full-v3\.sh/);
  assert.doesNotMatch(source, /ax-choose-root-stages\.js/);
  assert.doesNotMatch(source, /focus-timeout-smoke/);
});

test("legacy Go button branch pastes instead of requiring a prefilled path", () => {
  assert.doesNotMatch(source, /no Go to Folder field equals the fixture path/);
  assert.match(source, /found\.go !== null/);
  assert.match(source, /previouslyEnabledAre/);
});

test("focus timeout on the real goto-go path stops before any paste", () => {
  const pid = 4242;
  const path = "/tmp/masterocta-fixture";
  const field = el({
    role: "AXTextField",
    description: "text field",
    focused: false,
    value: "",
  });
  const header = el({
    role: "AXStaticText",
    value: "Go to:",
  });
  const harness = makeAx({ pid, contents: [header, field] });
  const run = invoke(() => axSteps.stepGotoGo(pid, path), {
    attach: () => harness.ax,
    Application: harness.Application,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /\[GTF\]\[OPEN\] PASS/);
  assert.match(run.output, /\[GTF\]\[FIELD\] FOUND/);
  assert.match(run.output, /\[GTF_FOCUS\] START/);
  assert.match(run.output, /\[GTF_FOCUS\] WAIT/);
  assert.match(run.output, /\[GTF_FOCUS\] FAIL elapsed_ms=\d+/);
  assert.match(run.output, /GO_TO_FOLDER_FOCUS_TIMEOUT/);
  assert.doesNotMatch(run.output, /\[GTF\]\[PASTE\]/);
  assert.equal(harness.events.includes("clipboard"), false);
  assert.equal(harness.events.some((e) => e.startsWith("keystroke:")), false);
});

test("legacy Go button focuses, pastes, verifies, then presses Go", () => {
  const pid = 4242;
  const path = "/tmp/masterocta-fixture";
  let fieldValue = "";
  let focused = true;
  let goPressed = false;
  const field = el({
    role: "AXComboBox",
    description: "text field",
    focused: () => focused,
    value: () => fieldValue,
  });
  const go = el({
    role: "AXButton",
    name: "Go",
    enabled: true,
    onPress: () => {
      goPressed = true;
    },
  });
  const header = el({
    role: "AXStaticText",
    value: "Go to:",
  });
  const harness = makeAx({ pid, contents: [header, field, go] });
  harness.ax.se.keystroke = (key) => {
    harness.events.push("keystroke:" + key);
    if (key === "v") fieldValue = path;
  };
  const run = invoke(() => axSteps.stepGotoGo(pid, path), {
    attach: () => harness.ax,
    Application: harness.Application,
  });
  assert.equal(run.error, null, run.output);
  assert.equal(run.result, "goto-go-pressed");
  assert.equal(goPressed, true);
  assert.match(run.output, /\[GTF\]\[PASTE\] START/);
  assert.match(run.output, /\[GOTO-03\] path field PASS/);
  assert.match(run.output, /\[GOTO-05\] AXPress PASS/);
  assert.doesNotMatch(run.output, /keyCode:36/);
});

test("export lock requires every previously enabled marker to disable", () => {
  const before = [true, true];
  assert.equal(axSteps.previouslyEnabledAre(before, [false, true], false), false);
  assert.equal(axSteps.previouslyEnabledAre(before, [false, false], false), true);
  assert.equal(axSteps.previouslyEnabledAre(before, [true, true], true), true);

  const pid = 99;
  let phase = 0;
  const enabledAt = () => {
    if (phase === 0) return [true, true];
    if (phase === 1) return [false, true];
    return [true, true];
  };
  const confirm = el({
    role: "AXButton",
    name: axSteps.NAMES.exportConfirm,
    enabled: true,
    onPress: () => {
      phase = 1;
    },
  });
  const selectA = el({
    role: "AXButton",
    name: axSteps.NAMES.markerSelect,
    enabled: () => enabledAt()[0],
  });
  const selectB = el({
    role: "AXButton",
    name: axSteps.NAMES.markerSelect,
    enabled: () => enabledAt()[1],
  });
  const harness = makeAx({ pid, contents: [confirm, selectA, selectB] });
  const failPartial = invoke(() => axSteps.stepExportLock(pid), {
    attach: () => harness.ax,
  });
  assert.equal(failPartial.exitCode, 1);
  assert.match(failPartial.output, /EXPORT_MARKER_LOCK_NOT_OBSERVED/);

  let pressed = false;
  let afterPressReads = 0;
  const afterPress = [
    [false, false],
    [true, true],
  ];
  const enabledAfter = (index) => () => {
    if (!pressed) return true;
    const snapshot = afterPress[Math.min(Math.floor(afterPressReads / 2), afterPress.length - 1)];
    const value = snapshot[index];
    afterPressReads += 1;
    return value;
  };
  const confirmAll = el({
    role: "AXButton",
    name: axSteps.NAMES.exportConfirm,
    enabled: true,
    onPress: () => {
      pressed = true;
    },
  });
  const selectAllA = el({
    role: "AXButton",
    name: axSteps.NAMES.markerSelect,
    enabled: enabledAfter(0),
  });
  const selectAllB = el({
    role: "AXButton",
    name: axSteps.NAMES.markerSelect,
    enabled: enabledAfter(1),
  });
  const passHarness = makeAx({ pid, contents: [confirmAll, selectAllA, selectAllB] });
  const pass = invoke(() => axSteps.stepExportLock(pid), {
    attach: () => passHarness.ax,
  });
  assert.equal(pass.error, null, pass.output);
  assert.equal(pass.result, "export-lock-observed");
  assert.match(pass.output, /EXPORT_MARKER_LOCK\] PASS/);
});
