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
    name: () => {
      if (!Object.prototype.hasOwnProperty.call(attrs, "name")) return null;
      return typeof attrs.name === "function" ? attrs.name() : attrs.name;
    },
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
    attributes: attrs.parent ? {
      byName: (attrName) => ({
        value: () => (attrName === "AXParent" ? attrs.parent : null),
      }),
    } : undefined,
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
        whose: () => [{
          unixId: () => (frontmostPid === undefined ? pid : frontmostPid),
          name: () => (frontmostPid === undefined || frontmostPid === pid ? "masterocta" : "Vivaldi"),
        }],
      },
      keystroke: (key, opts) => {
        events.push("keystroke:" + key + ":" + JSON.stringify(opts || {}));
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
  assert.match(source, /keystroke\(key, \{ using: \["command down"\] \}\)/);
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
  assert.match(source, /register-root/);
  assert.match(source, /a04-reanalyze-cancel/);
  assert.doesNotMatch(source, /native-acceptance-ax-full-v3\.sh/);
  assert.doesNotMatch(source, /ax-choose-root-stages\.js/);
  assert.doesNotMatch(source, /focus-timeout-smoke/);
  assert.doesNotMatch(source, /canonical-ax-ui\.js/);
});

test("register-root integrates Go to Folder shortcut and fail-closed preconditions", () => {
  assert.match(source, /GOTO_FOLDER_PRECONDITION_FAILED/);
  assert.match(source, /\[GTF-SHORTCUT\]/);
  assert.match(source, /function stepRegisterRoot/);
  assert.match(source, /sendGotoFolderShortcut/);
});

test("A04 state machine guards are present in source", () => {
  assert.match(source, /A04_S2_EXPANDED_SLICE_CLOSED/);
  assert.match(source, /A04_RANGE_INPUT_NOT_AVAILABLE/);
  assert.match(source, /A04_REANALYZE_GUARD_FAIL/);
  assert.match(source, /CANCEL_POLL_MS = 15/);
  assert.match(source, /FRONTMOST_AX_NOT_STABLE/);
  assert.match(source, /REANALYSIS_ACTIVE_STATE_OBSERVED/);
  assert.doesNotMatch(source, /A04_REANALYZE_CANCEL_DELAY_MS/);
  assert.match(source, /end-first reason=start 176400 would invert/);
  assert.ok(176400 > 132300);
  assert.match(source, /a04-verify-pending/);
  assert.match(source, /slice-prepare-workspace/);
  assert.match(source, /analyzeRange: "この範囲を解析"/);
});

test("sendGotoFolderShortcut requires frontmost pid", () => {
  const pid = 77;
  const harness = makeAx({ pid, frontmostPid: 99, contents: [] });
  const run = invoke(() => axSteps.sendGotoFolderShortcut(harness.ax, pid), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /GOTO_FOLDER_PRECONDITION_FAILED/);
  assert.equal(harness.events.some((event) => event.startsWith("keystroke:")), false);
});

test("soft Go to Folder shortcut refuses when another process is frontmost", () => {
  const pid = 77;
  const harness = makeAx({ pid, frontmostPid: 99, contents: [] });
  const run = invoke(() => axSteps.sendGotoFolderShortcut(harness.ax, pid, { soft: true }), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, null);
  assert.equal(run.result, false);
  assert.match(run.output, /\[GTF-SHORTCUT\] refused/);
  assert.equal(harness.events.some((event) => event.startsWith("keystroke:")), false);
});

function frontHarness(mode) {
  const pid = 42;
  const state = { front: mode === "already", sets: 0 };
  const proc = {};
  Object.defineProperty(proc, "frontmost", {
    configurable: true,
    get() {
      return () => state.front;
    },
    set() {
      state.sets += 1;
      if (mode === "never") state.front = false;
      else if (mode === "second") state.front = state.sets >= 2;
      else state.front = true;
    },
  });
  return {
    state,
    ax: {
      proc,
      se: {
        processes: {
          whose: () => [{ unixId: () => pid, name: () => "masterocta" }],
        },
      },
      win: { name: () => "Masta-Octa", entireContents: () => [] },
    },
    pid,
  };
}

test("frontmost activates when the target is not frontmost", () => {
  const harness = frontHarness("first");
  const run = invoke(() => axSteps.ensureFrontmost(harness.ax, harness.pid));
  assert.equal(run.exitCode, null);
  assert.match(run.output, /\[AX-FRONT\] PASS/);
  assert.equal(harness.state.front, true);
});

test("frontmost retries once then passes", () => {
  const harness = frontHarness("second");
  const run = invoke(() => axSteps.ensureFrontmost(harness.ax, harness.pid));
  assert.equal(run.exitCode, null);
  assert.ok(harness.state.sets >= 2);
  assert.match(run.output, /attempt=2/);
});

test("frontmost times out fail-closed", () => {
  const harness = frontHarness("never");
  const run = invoke(() => axSteps.ensureFrontmost(harness.ax, harness.pid));
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /AX_FRONTMOST_TIMEOUT/);
  assert.equal(harness.state.sets, 3);
});

function acquisitionSession(pid, options = {}) {
  const calls = { contents: 0 };
  const win = {
    name: () => "Masta-Octa",
    entireContents() {
      calls.contents += 1;
      if (typeof options.contents === "function") return options.contents(win, calls);
      return options.contents || [{ role: () => "AXGroup" }];
    },
  };
  let polls = 0;
  const proc = {
    unixId: () => pid,
    name: () => "masterocta",
    frontmost: false,
    windows: () => {
      polls += 1;
      if (typeof options.windows === "function") return options.windows(polls, win);
      return options.windows || [win];
    },
  };
  function processes() { return [proc]; }
  processes.whose = () => [{
    unixId: () => (options.frontPid === undefined ? pid : options.frontPid),
    name: () => options.frontName || "masterocta",
  }];
  return { se: { processes }, win, calls };
}

test("activation acquires frontmost window and accessibility tree", () => {
  const run = invoke(() => axSteps.acquireAx(42), {
    systemEvents: () => acquisitionSession(42).se,
  });
  assert.equal(run.exitCode, null);
  assert.equal(run.result.pid, 42);
  assert.match(run.output, /frontmost_app="masterocta"/);
  assert.match(run.output, /frontmost_pid=42/);
  assert.match(run.output, /window_count=1/);
  assert.match(run.output, /ax_tree=pass/);
  assert.match(run.output, /ax_error=none/);
});

test("window count zero later becomes available", () => {
  const run = invoke(() => axSteps.acquireAx(42), {
    systemEvents: () => acquisitionSession(42, {
      windows: (polls, win) => (polls < 3 ? [] : [win]),
    }).se,
  });
  assert.equal(run.exitCode, null);
  assert.match(run.output, /ax_tree=waiting-window/);
  assert.match(run.output, /ax_tree=pass/);
});

test("missing window stops with window timeout", () => {
  const run = invoke(() => axSteps.acquireAx(42), {
    systemEvents: () => acquisitionSession(42, { windows: () => [] }).se,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /MASTER_OCTA_WINDOW_TIMEOUT/);
  assert.match(run.output, /FRONTMOST_AX_NOT_STABLE/);
  assert.match(run.output, /attempt=3/);
  assert.doesNotMatch(run.output, /ax_tree=pass/);
});

test("stale accessibility tree is discarded and reacquired", () => {
  const wins = [];
  let generation = 0;
  const run = invoke(() => axSteps.acquireAx(42), {
    systemEvents: () => {
      generation += 1;
      const session = acquisitionSession(42, {
        contents: () => {
          if (generation === 1) {
            const err = new Error("オブジェクトを取得できません。");
            err.errorNumber = -1728;
            throw err;
          }
          return [{ role: () => "AXGroup" }];
        },
      });
      wins.push(session.win);
      return session.se;
    },
  });
  assert.equal(run.exitCode, null);
  assert.equal(generation, 2);
  assert.notEqual(wins[0], wins[1]);
  assert.equal(wins[0], wins[0]);
  assert.match(run.output, /ax_error=-1728/);
  assert.match(run.output, /attempt=2/);
  assert.match(run.output, /ax_tree=pass/);
});

test("three stale accessibility reads fail closed", () => {
  let generation = 0;
  const run = invoke(() => axSteps.acquireAx(42), {
    systemEvents: () => {
      generation += 1;
      return acquisitionSession(42, {
        contents: () => {
          const err = new Error("オブジェクトを取得できません。");
          err.errorNumber = -1728;
          throw err;
        },
      }).se;
    },
  });
  assert.equal(run.exitCode, 1);
  assert.equal(generation, 3);
  assert.match(run.output, /FRONTMOST_AX_NOT_STABLE/);
});

function cancelHarness(script) {
  const state = { phase: "idle", cancelPresses: 0, armed: false, reanalyzeEnabled: true };
  const reanalyze = el({
    role: "AXButton",
    name: axSteps.NAMES.reanalyzePending,
    enabled: () => state.reanalyzeEnabled,
    onPress: () => {
      state.phase = script;
      state.reanalyzeEnabled = false;
    },
  });
  const status = el({
    role: "AXStaticText",
    value: () => {
      if (state.phase === "disabled") return axSteps.NAMES.readingSource;
      return null;
    },
  });
  const slot = el({
    role: "AXButton",
    name: () => {
      if (state.cancelPresses > 0) return axSteps.NAMES.closeAnalysis;
      if (state.phase === "immediate" || state.phase === "delayed" || state.phase === "disabled") {
        return axSteps.NAMES.cancelAnalysis;
      }
      return axSteps.NAMES.closeAnalysis;
    },
    enabled: () => {
      if (state.phase === "disabled" && state.cancelPresses === 0) {
        if (!state.armed) {
          state.armed = true;
          return false;
        }
      }
      return true;
    },
    onPress: () => { state.cancelPresses += 1; },
  });
  return { state, harness: makeAx({ pid: 8, contents: [reanalyze, status, slot] }) };
}

test("cancel press happens on the first enabled observation", () => {
  const { state, harness } = cancelHarness("immediate");
  const run = invoke(() => axSteps.stepA04ReanalyzeAndCancel(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, null);
  assert.match(run.output, /REANALYSIS_ACTIVE_STATE_OBSERVED=YES/);
  assert.match(run.output, /CANCEL_FIRST_SEEN_MS=\d+/);
  assert.match(run.output, /CANCEL_ENABLED_MS=\d+/);
  assert.match(run.output, /\[A04\]\[CANCEL_PRESS\] PASS/);
  assert.match(run.output, /CANCEL_PRESS_MS=\d+/);
  assert.match(run.output, /\[A04\]\[CANCEL_TERMINAL\] PASS/);
  assert.equal(state.cancelPresses, 1);
  assert.doesNotMatch(run.output, /340/);
});

test("cancel appears after several polls", () => {
  const state = { phase: "idle", reads: 0, cancelPresses: 0, reanalyzeEnabled: true };
  const reanalyze = el({
    role: "AXButton",
    name: axSteps.NAMES.reanalyzePending,
    enabled: () => state.reanalyzeEnabled,
    onPress: () => {
      state.phase = "delayed";
      state.reanalyzeEnabled = false;
    },
  });
  const status = el({
    role: "AXStaticText",
    value: () => (state.phase === "delayed" ? axSteps.NAMES.readingSource : null),
  });
  const slot = el({
    role: "AXButton",
    name: () => {
      if (state.cancelPresses > 0) return axSteps.NAMES.closeAnalysis;
      if (state.phase !== "delayed") return axSteps.NAMES.closeAnalysis;
      state.reads += 1;
      return state.reads < 3 ? axSteps.NAMES.closeAnalysis : axSteps.NAMES.cancelAnalysis;
    },
    enabled: true,
    onPress: () => { state.cancelPresses += 1; },
  });
  const harness = makeAx({ pid: 8, contents: [reanalyze, status, slot] });
  const run = invoke(() => axSteps.stepA04ReanalyzeAndCancel(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, null);
  assert.ok(state.reads >= 1);
  assert.equal(state.cancelPresses, 1);
  const seen = run.output.match(/CANCEL_FIRST_SEEN_MS=(\d+)/);
  assert.ok(seen);
  assert.ok(Number(seen[1]) >= 15);
});

test("cancel becomes enabled after a disabled observation", () => {
  const { state, harness } = cancelHarness("disabled");
  const run = invoke(() => axSteps.stepA04ReanalyzeAndCancel(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, null);
  assert.match(run.output, /visible-disabled/);
  assert.match(run.output, /\[A04\]\[CANCEL_PRESS\] PASS/);
  assert.equal(state.cancelPresses, 1);
});

test("stale close button rebinds from its parent without a window tree walk", () => {
  const state = { phase: "idle", cancelPresses: 0, reanalyzeEnabled: true, replaced: false };
  const replacement = el({
    role: "AXButton",
    name: () => (state.cancelPresses > 0 ? axSteps.NAMES.closeAnalysis : axSteps.NAMES.cancelAnalysis),
    enabled: true,
    onPress: () => { state.cancelPresses += 1; },
  });
  const siblings = [];
  const parent = {
    role: () => "AXGroup",
    buttons: () => (state.replaced ? [replacement] : siblings),
  };
  const slot = el({
    role: "AXButton",
    parent,
    name: () => {
      if (state.replaced) {
        const err = new Error("オブジェクトを取得できません。");
        err.errorNumber = -1728;
        throw err;
      }
      return axSteps.NAMES.closeAnalysis;
    },
    enabled: true,
  });
  siblings.push(slot);
  const reanalyze = el({
    role: "AXButton",
    name: axSteps.NAMES.reanalyzePending,
    enabled: () => state.reanalyzeEnabled,
    onPress: () => {
      state.phase = "replaced";
      state.reanalyzeEnabled = false;
      state.replaced = true;
    },
  });
  const harness = makeAx({ pid: 8, contents: [reanalyze, slot] });
  let windowWalks = 0;
  const original = harness.ax.win.entireContents;
  harness.ax.win.entireContents = () => {
    windowWalks += 1;
    return original();
  };
  const run = invoke(() => axSteps.stepA04ReanalyzeAndCancel(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, null);
  assert.equal(state.cancelPresses, 1);
  assert.match(run.output, /\[A04\]\[CANCEL_SCOPE\]/);
  assert.match(run.output, /stale -1728; rebind scope/);
  assert.match(run.output, /\[A04\]\[CANCEL_PRESS\] PASS/);
  assert.doesNotMatch(run.output, /full tree/);
  assert.equal(windowWalks, 3);
});

test("cancel window missed before analysis ends is not a press failure", () => {
  const { state, harness } = cancelHarness("completed");
  const run = invoke(() => axSteps.stepA04ReanalyzeAndCancel(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /CANCEL_WINDOW_NOT_OBSERVED/);
  assert.match(run.output, /observed=NO/);
  assert.equal(state.cancelPresses, 0);
  assert.doesNotMatch(run.output, /\[A04\]\[CANCEL_PRESS\]/);
});

test("range fields are not ready unless both start and end exist outside expanded slice", () => {
  const start = el({ role: "AXTextField", description: "開始フレーム", enabled: true });
  const end = el({ role: "AXTextField", description: "終了フレーム", enabled: true });
  const closeBtn = el({ role: "AXButton", name: axSteps.NAMES.sliceCloseExpanded, enabled: true });
  const onlyStart = makeAx({ pid: 1, contents: [start] });
  const onlyEnd = makeAx({ pid: 1, contents: [end] });
  const both = makeAx({ pid: 1, contents: [start, end] });
  const expanded = makeAx({ pid: 1, contents: [start, end, closeBtn] });
  const runStart = invoke(() => axSteps.catalogRangeFieldsReady(onlyStart.ax));
  const runEnd = invoke(() => axSteps.catalogRangeFieldsReady(onlyEnd.ax));
  const runBoth = invoke(() => axSteps.catalogRangeFieldsReady(both.ax));
  const runExpanded = invoke(() => axSteps.catalogRangeFieldsReady(expanded.ax));
  assert.equal(runStart.result, null);
  assert.equal(runEnd.result, null);
  assert.equal(runExpanded.result, null);
  assert.equal(runBoth.result.start.via, "attribute");
  assert.equal(runBoth.result.end.via, "attribute");
});

test("soft Go to Folder timeout does not paste or press Return", () => {
  const pid = 8;
  const harness = makeAx({ pid, contents: [] });
  const run = invoke(() => axSteps.stepGotoGo(pid, "/tmp/fixture", { soft: true }), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, null);
  assert.equal(run.result, "goto-focus-timeout");
  assert.equal(harness.events.filter((event) => event === "clipboard" || event.indexOf("keyCode:36") === 0).length, 0);
});

test("range input is refused until the preview tab is active", () => {
  const pid = 8;
  const panel = el({ role: "AXGroup", subrole: "AXTabPanel", description: "スライス" });
  const start = el({ role: "AXTextField", description: "開始フレーム", enabled: true });
  const end = el({ role: "AXTextField", description: "終了フレーム", enabled: true });
  const harness = makeAx({ pid, contents: [panel, start, end] });
  const run = invoke(() => axSteps.stepA04RangeInputCheck(pid), { attach: () => harness.ax });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /PREVIEW_TAB_ACTIVATION_TIMEOUT/);
  assert.equal(harness.events.filter((event) => event === "clipboard").length, 0);
});

test("pending copy waits until the slice tab is active", () => {
  const pid = 8;
  const panel = el({ role: "AXGroup", subrole: "AXTabPanel", description: "プレビュー" });
  const slice = el({ role: "AXRadioButton", name: "スライス", selected: false, enabled: true });
  const copy = el({ role: "AXButton", name: "プレビュー選択範囲をコピー", enabled: true });
  const harness = makeAx({ pid, contents: [panel, slice, copy] });
  const run = invoke(() => axSteps.stepA04CopyPending(pid), { attach: () => harness.ax });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /SLICE_TAB_ACTIVATION_TIMEOUT/);
  assert.doesNotMatch(run.output, /A04-COPY-PENDING-PRESS/);
});

test("slice tab switches to preview before range input", () => {
  const pid = 8;
  const state = { tab: "スライス" };
  const panel = {
    role: () => "AXGroup",
    subrole: () => "AXTabPanel",
    title: () => null,
    name: () => null,
    description: () => state.tab,
    value: () => null,
    focused: () => false,
    enabled: () => true,
    selected: () => false,
    actions: { name: () => [], byName: () => ({ perform: () => {} }) },
  };
  const preview = el({
    role: "AXRadioButton",
    name: "プレビュー",
    selected: false,
    onPress: () => {
      state.tab = "プレビュー";
    },
  });
  const start = el({ role: "AXTextField", description: "開始フレーム", enabled: true, value: "0" });
  const end = el({ role: "AXTextField", description: "終了フレーム", enabled: true, value: "0" });
  const harness = makeAx({ pid, contents: [panel, preview, start, end] });
  const switched = invoke(
    () => axSteps.activateInspectorTab(pid, "プレビュー", "PREVIEW_TAB_ACTIVATION_TIMEOUT"),
    { attach: () => harness.ax },
  );
  assert.equal(switched.exitCode, null);
  assert.match(switched.output, /\[A04\]\[TAB\] active=プレビュー PASS/);
  assert.equal(harness.events.filter((event) => event === "clipboard").length, 0);
  const check = invoke(() => axSteps.stepA04RangeInputCheck(pid), { attach: () => harness.ax });
  assert.equal(check.exitCode, null);
  assert.equal(check.result, "a04-range-input-available");
});

test("preview tab switches to slice before pending copy", () => {
  const pid = 8;
  const state = { tab: "プレビュー" };
  const panel = {
    role: () => "AXGroup",
    subrole: () => "AXTabPanel",
    title: () => null,
    name: () => null,
    description: () => state.tab,
    value: () => null,
    focused: () => false,
    enabled: () => true,
    selected: () => false,
    actions: { name: () => [], byName: () => ({ perform: () => {} }) },
  };
  const slice = el({
    role: "AXRadioButton",
    name: "スライス",
    selected: false,
    onPress: () => {
      state.tab = "スライス";
    },
  });
  let copied = false;
  const copy = el({
    role: "AXButton",
    name: "プレビュー選択範囲をコピー",
    enabled: true,
    onPress: () => {
      copied = true;
    },
  });
  const harness = makeAx({ pid, contents: [panel, slice, copy] });
  const run = invoke(() => axSteps.stepA04CopyPending(pid), { attach: () => harness.ax });
  assert.equal(run.exitCode, null);
  assert.match(run.output, /\[A04\]\[TAB\] active=スライス PASS/);
  assert.match(run.output, /A04-COPY-PENDING-PRESS/);
  assert.equal(copied, true);
  assert.equal(run.result, "a04-pending-copied");
});

test("pending range exact values pass", () => {
  const pid = 8;
  const text = el({ role: "AXStaticText", value: "フレーム [176400, 220500)" });
  const harness = makeAx({ pid, contents: [text] });
  const run = invoke(() => axSteps.stepA04VerifyPending(pid, "176400", "220500"), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, null);
  assert.equal(run.result, "a04-pending-verified");
  assert.match(run.output, /\[A04\]\[PENDING_RANGE\] start=176400 end=220500 PASS/);
});

test("pending range mismatch fails closed", () => {
  const pid = 8;
  const text = el({ role: "AXStaticText", value: "フレーム [44100, 132300)" });
  const harness = makeAx({ pid, contents: [text] });
  const run = invoke(() => axSteps.stepA04VerifyPending(pid, "176400", "220500"), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /PENDING_RANGE_MISMATCH/);
});

test("expanded slice still open blocks range B paste", () => {
  const pid = 9;
  const closeBtn = el({ role: "AXButton", name: axSteps.NAMES.sliceCloseExpanded, enabled: true });
  const harness = makeAx({ pid, contents: [closeBtn] });
  const run = invoke(() => axSteps.stepA04CloseExpanded(pid), { attach: () => harness.ax });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /A04_EXPANDED_CLOSE_FAIL/);
  assert.equal(harness.events.filter((e) => e === "clipboard").length, 0);
});

test("a04 reanalyze start is blocked while expanded slice workspace is open", () => {
  const pid = 5;
  const closeBtn = el({
    role: "AXButton",
    name: axSteps.NAMES.sliceCloseExpanded,
    enabled: true,
  });
  const harness = makeAx({ pid, contents: [closeBtn] });
  const run = invoke(() => axSteps.stepA04ReanalyzeStart(pid), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /A04_REANALYZE_GUARD_FAIL/);
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

test("cancel title disappears before press is classified as too short", () => {
  let polls = 0;
  const slot = el({
    role: "AXButton",
    name: () => {
      polls += 1;
      return polls <= 2 ? axSteps.NAMES.cancelAnalysis : axSteps.NAMES.closeAnalysis;
    },
    enabled: false,
    onPress: () => undefined,
  });
  const harness = makeAx({ pid: 8, contents: [slot] });
  const run = invoke(() => axSteps.observeAndPressCancel(8, harness.ax, 0), {
    attach: () => harness.ax,
  });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE/);
  assert.match(run.output, /visible-disabled/);
  assert.match(run.output, /CANCEL_WINDOW_OBSERVED=YES/);
});

test("reanalyze start fails closed without an active state signal", () => {
  const reanalyze = el({
    role: "AXButton",
    name: axSteps.NAMES.reanalyzePending,
    enabled: true,
    onPress: () => undefined,
  });
  const close = el({
    role: "AXButton",
    name: axSteps.NAMES.closeAnalysis,
    enabled: true,
  });
  const harness = makeAx({ pid: 8, contents: [reanalyze, close] });
  const run = invoke(() => axSteps.stepA04ReanalyzeStart(8), { attach: () => harness.ax });
  assert.equal(run.exitCode, 1);
  assert.match(run.output, /A04_REANALYSIS_ACTIVE_TIMEOUT/);
  assert.match(run.output, /REANALYSIS_ACTIVE_STATE_OBSERVED=NO/);
  assert.doesNotMatch(run.output, /\[A04_S6_REANALYSIS_STARTED\] PASS/);
});

test("cancel poll reacquires after stale accessibility reads", () => {
  let treeReads = 0;
  const ax = { proc: {}, win: null, pid: 8 };
  ax.win = {
    name: () => "Masta-Octa",
    entireContents: () => {
      treeReads += 1;
      if (treeReads === 1) {
        const err = new Error("stale");
        err.errorNumber = -1728;
        throw err;
      }
      return [{ role: () => "AXGroup" }];
    },
  };
  const run = invoke(() => axSteps.refreshCancelTree(8, ax), {
    systemEvents: () => acquisitionSession(8).se,
  });
  assert.equal(run.error, null, run.output);
  assert.ok(Array.isArray(run.result));
  assert.ok(treeReads >= 1);
  assert.match(run.output, /(-1728|ax_error=-1728)/);
  assert.match(run.output, /ax_tree=pass/);
});
