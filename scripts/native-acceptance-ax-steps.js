// Staged JXA steps for macOS Native acceptance automation.
// usage: osascript -l JavaScript scripts/native-acceptance-ax-steps.js <step> <pid> [arg]
// steps: diagnose | choose-root | register-root <path> | goto-visible | goto-go <path>
//        | open <basename> | select-row <relpath> | play-stop
//        | paste-range <fieldName> <value> | export-lock
//        | slice-prepare-workspace | slice-tab | slice-expand | slice-detect | slice-wait-apply | slice-apply
//        | slice-wait-draft | a04-close-expanded | a04-range-input-check
//        | a04-paste-range-b <start> <end> | a04-copy-pending | a04-verify-pending <start> <end>
//        | a04-reanalyze-start | a04-reanalyze-cancel
// Range fields are filled by clipboard paste. Go to Folder waits until its
// path field is focused, then pastes (legacy Go button and modern Return).
// Neither path assigns AXValue.
// Every stage logs to stderr as [AX-NN] / [<STEP>-NN]. Errors exit 1 with the
// failing stage, exception and element fields. Range paste retries a stale
// accessibility tree up to 3 times after focus changes.
//
// System Events has no "performAction" command; calling element.performAction("AXPress")
// fails with -1700. The dictionary command is perform(action):
// element.actions.byName("AXPress").perform().
if (typeof ObjC !== "undefined") {
  ObjC.import("stdlib");
}

const runtime = {
  now: null,
  delay: null,
  exit: null,
  log: null,
  attach: null,
  Application: null,
};

function setRuntime(overrides) {
  if (!overrides) return;
  const keys = Object.keys(overrides);
  for (let i = 0; i < keys.length; i++) runtime[keys[i]] = overrides[keys[i]];
}

function resetRuntime() {
  runtime.now = null;
  runtime.delay = null;
  runtime.exit = null;
  runtime.log = null;
  runtime.attach = null;
  runtime.Application = null;
  runtime.systemEvents = null;
  runtime.softStage = false;
}

function nowMs() {
  return typeof runtime.now === "function" ? runtime.now() : Date.now();
}

function sleepSec(seconds) {
  if (typeof runtime.delay === "function") {
    runtime.delay(seconds);
    return;
  }
  delay(seconds);
}

const NATIVE_ACCEPTANCE_RANGE_ROW = "SET/AUDIO/RANGE.wav";

const NAMES = {
  chooseRoot: ["ルートを選択…", "Choose root..."],
  open: ["Open", "開く"],
  cancel: ["Cancel", "キャンセル"],
  go: ["Go", "移動"],
  gotoHeader: ["Go to:", "移動先:"],
  where: ["Where:", "場所:"],
  play: "選択区間を再生",
  preparing: "区間を準備中…",
  stop: "停止",
  exportConfirm: "書き出しを実行",
  markerSelect: "選択",
  sliceTab: "スライス",
  previewTab: "プレビュー",
  sliceExpand: "スライス編集を中央ワークスペースで広く開く",
  sliceCloseExpanded: "拡張スライス編集を閉じてカタログ表示に戻る",
  detectAttacks: "アタックを検出",
  analyzeAgain: "再解析",
  analyzeRange: "この範囲を解析",
  applyCandidates: "候補を draft に反映",
  copyPreviewPending: "プレビュー選択範囲をコピー",
  reanalyzePending: "この範囲で再解析",
  cancelAnalysis: "解析をキャンセル",
  closeAnalysis: "解析を閉じる",
  readingSource: "ソース PCM を読み込み・検証中…",
  detectingAttacks: "アタックを検出中…",
  rangeStartField: "開始フレーム",
  rangeEndField: "終了フレーム",
};

const REANALYSIS_ACTIVE_STATUS_TEXTS = [
  NAMES.readingSource,
  NAMES.detectingAttacks,
];

const GTF_FOCUS_POLL_MS = 80;
const GTF_FOCUS_TIMEOUT_MS = 4000;
const RANGE_VERIFY_POLL_MS = 50;
const RANGE_VERIFY_TIMEOUT_MS = 2000;
const EXPORT_LOCK_POLL_MS = 30;
const EXPORT_LOCK_TIMEOUT_MS = 8000;
const AX_REACQUIRE_ATTEMPTS = 3;
const AX_WINDOW_POLL_MS = 80;
const AX_WINDOW_TIMEOUT_MS = 15000;
const CANCEL_POLL_MS = 15;
const CANCEL_OBSERVE_TIMEOUT_MS = 5000;
const REANALYSIS_ACTIVE_TIMEOUT_MS = 8000;
const A04_PENDING_VERIFY_TIMEOUT_MS = 5000;

function log(line) {
  if (typeof runtime.log === "function") {
    runtime.log(line);
    return;
  }
  console.log(line);
}

function errFields(err) {
  if (err === null || err === undefined) return "name=? number=? message=?";
  let name = "?";
  let message = "?";
  let number = "?";
  try { name = String(err.name); } catch (e) {}
  try { message = String(err.message); } catch (e) {}
  try { if (err.errorNumber !== undefined) number = String(err.errorNumber); } catch (e) {}
  return "name=" + name + " number=" + number + " message=" + message;
}

function safeScalar(fn) {
  try {
    const v = fn();
    const t = typeof v;
    if (v === null || v === undefined) return { ok: true, type: String(v), value: null };
    if (t === "string" || t === "number" || t === "boolean") return { ok: true, type: t, value: v };
    return { ok: true, type: t, value: null };
  } catch (err) {
    return { ok: false, type: "error", value: null, error: errFields(err) };
  }
}

function str(fn) {
  const r = safeScalar(fn);
  return r.ok && typeof r.value === "string" ? r.value : null;
}

function show(r) {
  if (!r.ok) return "<" + r.error + ">";
  if (r.value === null) return "<" + r.type + ">";
  return JSON.stringify(r.value);
}

function describe(el, index) {
  if (!el) return "element=<none>";
  return "index=" + index +
    " role=" + show(safeScalar(() => el.role())) +
    " name=" + show(safeScalar(() => el.name())) +
    " title=" + show(safeScalar(() => el.title())) +
    " description=" + show(safeScalar(() => el.description()));
}

function fail(stage, err, extra) {
  log("[" + stage + "][ERROR] " + errFields(err) + (extra ? " " + extra : ""));
  if (typeof runtime.exit === "function") {
    runtime.exit(1);
    return;
  }
  if (typeof $ !== "undefined") {
    $.exit(1);
    return;
  }
  throw new Error("AX_EXIT_1");
}

function stage(id, fn, extraOnError) {
  try {
    return fn();
  } catch (err) {
    if (runtime.softStage) throw err;
    fail(id, err, extraOnError ? extraOnError() : "");
  }
}

function withoutExit(fn) {
  const previous = runtime.softStage;
  runtime.softStage = true;
  try {
    return fn();
  } finally {
    runtime.softStage = previous;
  }
}

function axErrorCode(err) {
  if (!err) return "none";
  try {
    if (err.errorNumber !== undefined && err.errorNumber !== null) return String(err.errorNumber);
  } catch (ignore) { /* keep message parse */ }
  const message = err && err.message ? String(err.message) : "";
  const match = message.match(/-1728/);
  return match ? match[0] : "none";
}

function isAxStale(err) {
  return axErrorCode(err) === "-1728";
}

function connectSystemEvents() {
  if (typeof runtime.systemEvents === "function") return runtime.systemEvents();
  return Application("System Events");
}

function findMasteroctaProcess(se, pid) {
  const all = se.processes();
  let found = null;
  let hits = 0;
  for (let i = 0; i < all.length; i++) {
    const u = safeScalar(() => all[i].unixId());
    if (!u.ok) continue;
    if (Number(u.value) === Number(pid)) { found = all[i]; hits += 1; }
  }
  if (hits !== 1 || found === null) throw new Error("ax-process-count=" + hits);
  return found;
}

function frontMatches(front, pid) {
  return !!front && front.name === "masterocta" && Number(front.pid) === Number(pid);
}

function logAcquire(attempt, front, pid, windowCount, treeResult, errorCode, elapsedMs) {
  log("[AX-ACQUIRE] attempt=" + attempt +
    " ts=" + nowMs() +
    " frontmost_app=" + JSON.stringify(front && front.name) +
    " frontmost_pid=" + (front && front.pid) +
    " masterocta_pid=" + pid +
    " window_count=" + windowCount +
    " ax_tree=" + treeResult +
    " ax_error=" + errorCode +
    " elapsed_ms=" + elapsedMs);
}

function activateMasteroctaApp(pid) {
  try {
    if (typeof ObjC === "undefined" || typeof ObjC.import !== "function") return;
    ObjC.import("AppKit");
    const running = $.NSWorkspace.sharedWorkspace.runningApplications;
    const count = Number(running.count);
    for (let i = 0; i < count; i++) {
      const app = running.objectAtIndex(i);
      if (Number(app.processIdentifier) !== Number(pid)) continue;
      // 2 = NSApplicationActivateIgnoringOtherApps
      const ok = app.activateWithOptions(2);
      log("[AX-ACTIVATE] ignoring_other_apps pid=" + pid + " ok=" + ok);
      return;
    }
    log("[AX-ACTIVATE] pid not in running applications pid=" + pid);
  } catch (err) {
    log("[AX-ACTIVATE] " + errFields(err));
  }
}

function acquireAx(pid) {
  let last = null;
  for (let attempt = 1; attempt <= AX_REACQUIRE_ATTEMPTS; attempt++) {
    const attemptStart = nowMs();
    let front = { name: null, pid: null };
    try {
      const se = connectSystemEvents();
      const proc = findMasteroctaProcess(se, pid);
      activateMasteroctaApp(pid);
      try { proc.frontmost = true; } catch (err) {
        log("[AX-ACQUIRE] activate error " + errFields(err));
      }
      const frontDeadline = nowMs() + 2000;
      let hidFront = false;
      front = readFrontProcess(se);
      while (!frontMatches(front, pid) && nowMs() <= frontDeadline) {
        if (!hidFront) {
          hidFront = hideOtherFrontApp(se, pid);
          raiseMasteroctaWindow(proc);
        }
        sleepSec(AX_WINDOW_POLL_MS / 1000);
        try { proc.frontmost = true; } catch (err) { /* next poll */ }
        activateMasteroctaApp(pid);
        front = readFrontProcess(se);
      }
      if (!frontMatches(front, pid)) {
        const elapsed = nowMs() - attemptStart;
        logAcquire(attempt, front, pid, "na", "frontmost-fail", "AX_FRONTMOST_TIMEOUT", elapsed);
        last = new Error("AX_FRONTMOST_TIMEOUT");
        if (attempt < AX_REACQUIRE_ATTEMPTS) {
          sleepSec(AX_WINDOW_POLL_MS / 1000);
          continue;
        }
        break;
      }
      const winDeadline = nowMs() + AX_WINDOW_TIMEOUT_MS;
      let wins = proc.windows();
      let lastWindowLog = -1000;
      while ((!wins || wins.length < 1) && nowMs() <= winDeadline) {
        if (nowMs() - lastWindowLog >= 1000) {
          logAcquire(attempt, front, pid, wins ? wins.length : 0, "waiting-window", "none", nowMs() - attemptStart);
          lastWindowLog = nowMs();
        }
        sleepSec(AX_WINDOW_POLL_MS / 1000);
        front = readFrontProcess(se);
        if (!frontMatches(front, pid)) {
          try { proc.frontmost = true; } catch (err) { /* next poll */ }
        }
        wins = proc.windows();
      }
      if (!wins || wins.length < 1) {
        const elapsed = nowMs() - attemptStart;
        logAcquire(attempt, front, pid, 0, "fail", "MASTER_OCTA_WINDOW_TIMEOUT", elapsed);
        last = new Error("MASTER_OCTA_WINDOW_TIMEOUT");
        if (attempt < AX_REACQUIRE_ATTEMPTS) {
          sleepSec(AX_WINDOW_POLL_MS / 1000);
          continue;
        }
        break;
      }
      const win = wins[0];
      const winName = str(() => win.name());
      if (winName !== "Masta-Octa") throw new Error("unexpected window name");
      const ui = win.entireContents();
      if (!ui || ui.length < 1) throw new Error("empty accessibility tree");
      const elapsed = nowMs() - attemptStart;
      logAcquire(attempt, front, pid, wins.length, "pass", "none", elapsed);
      log("[AX-04] window_count=" + wins.length);
      log("[AX-05] target_window PASS");
      log("FRONTMOST_AX_STABLE=YES");
      return { se: se, proc: proc, win: win, pid: pid, ui: ui };
    } catch (err) {
      last = err;
      logAcquire(attempt, front, pid, "na", "fail", axErrorCode(err), nowMs() - attemptStart);
      if (attempt < AX_REACQUIRE_ATTEMPTS) {
        sleepSec(AX_WINDOW_POLL_MS / 1000);
        continue;
      }
    }
  }
  log("FRONTMOST_AX_STABLE=NO");
  fail("AX-FRONT", new Error("FRONTMOST_AX_NOT_STABLE"));
}

function attach(pid) {
  if (typeof runtime.attach === "function") return runtime.attach(pid);
  log("[AX-01] System Events connected");
  const session = acquireAx(pid);
  log("[AX-02] process lookup PASS pid=" + pid);
  log("[AX-03] name=\"masterocta\"");
  return session;
}

function enumerate(id, container) {
  return stage(id, () => {
    const ui = container.entireContents();
    log("[" + id + "] element_count=" + ui.length);
    return ui;
  });
}

// Role-filtered scan. Property reads never throw; each value is a JS primitive.
function scanButtons(id, ui, logEach) {
  const buttons = [];
  for (let i = 0; i < ui.length; i++) {
    const role = safeScalar(() => ui[i].role());
    if (!role.ok) { log("[" + id + "][WARN] index=" + i + " role_read " + role.error); continue; }
    if (role.value !== "AXButton") continue;
    const name = str(() => ui[i].name());
    buttons.push({ el: ui[i], index: i, name: name });
    if (logEach) log("[" + id + "] button " + describe(ui[i], i));
  }
  log("[" + id + "] button_count=" + buttons.length);
  return buttons;
}

function findByName(buttons, names) {
  for (const b of buttons) {
    if (typeof b.name === "string" && names.indexOf(b.name) >= 0) return b;
  }
  return null;
}

function readEnabled(id, b) {
  return stage(id, () => {
    const enabled = safeScalar(() => b.el.enabled());
    const actions = safeScalar(() => JSON.stringify(b.el.actions.name()));
    log("[" + id + "] " + describe(b.el, b.index) + " enabled=" + show(enabled) + " actions=" + show(actions));
    if (!enabled.ok || typeof enabled.value !== "boolean") throw new Error("enabled unreadable");
    if (typeof actions.value !== "string" || JSON.parse(actions.value).indexOf("AXPress") < 0) {
      throw new Error("AXPress not offered");
    }
    log("[" + id + "] properties PASS");
    return enabled.value;
  }, () => describe(b.el, b.index));
}

function press(id, b) {
  stage(id, () => {
    log("[" + id + "] AXPress attempted " + describe(b.el, b.index));
    b.el.actions.byName("AXPress").perform();
    log("[" + id + "] AXPress PASS");
  }, () => describe(b.el, b.index));
}

function waitUntil(id, timeoutMs, intervalMs, probe) {
  const started = nowMs();
  log("[" + id + "] START");
  let announced = false;
  while (nowMs() - started <= timeoutMs) {
    let hit = false;
    const previousSoft = runtime.softStage;
    runtime.softStage = true;
    try { hit = probe() === true; } catch (err) {
      hit = false;
      log("[" + id + "] probe error " + errFields(err));
    } finally {
      runtime.softStage = previousSoft;
    }
    if (hit) {
      const elapsed = nowMs() - started;
      log("[" + id + "] PASS elapsed_ms=" + elapsed);
      return elapsed;
    }
    if (!announced) {
      log("[" + id + "] WAIT");
      announced = true;
    }
    const remain = timeoutMs - (nowMs() - started);
    if (remain <= 0) break;
    sleepSec(Math.min(intervalMs, remain) / 1000);
  }
  log("[" + id + "] FAIL elapsed_ms=" + (nowMs() - started));
  return null;
}

function clipboardToken(value) {
  const app = typeof runtime.Application === "function"
    ? runtime.Application()
    : Application.currentApplication();
  app.includeStandardAdditions = true;
  let saved = null;
  let had = false;
  try { saved = app.theClipboard(); had = true; } catch (err) { had = false; }
  app.setTheClipboardTo(String(value));
  return { app: app, saved: saved, had: had };
}

function restoreClipboard(token) {
  if (!token || !token.had) return;
  try { token.app.setTheClipboardTo(token.saved); } catch (err) { /* restore is best-effort */ }
}

function appIsKey(ax, pid) {
  const front = readFrontProcess(ax.se);
  return front.name === "masterocta" && Number(front.pid) === Number(pid);
}

function pasteIntoFocused(ax, pid, element, value, logTag) {
  const front = readFrontProcess(ax.se);
  const focused = safeScalar(() => element.focused());
  log(logTag + " front_name=" + JSON.stringify(front.name) + " front_pid=" + front.pid + " focused=" + show(focused));
  if (!appIsKey(ax, pid) || focused.value !== true) {
    throw new Error("paste target is not the key input");
  }
  log(logTag + " clipboard_value=" + JSON.stringify(String(value)));
  const token = clipboardToken(value);
  try {
    sendCommandKey(ax, pid, "a", logTag);
    sendCommandKey(ax, pid, "v", logTag);
    sleepSec(0.1);
  } catch (err) {
    restoreClipboard(token);
    throw err;
  }
  return token;
}

function sendCommandKey(ax, pid, key, logTag) {
  sleepSec(0.05);
  const front = readFrontProcess(ax.se);
  if (!appIsKey(ax, pid)) {
    log(logTag + " keystroke refused key=" + key + " front_name=" + JSON.stringify(front.name) + " front_pid=" + front.pid);
    throw new Error("frontmost left masterocta before keystroke");
  }
  ax.se.keystroke(key, { using: ["command down"] });
}

function fieldIsKeyInput(ax, pid, element) {
  const focused = safeScalar(() => element.focused());
  return appIsKey(ax, pid) && focused.value === true;
}

function gotoContainerList(ax) {
  const out = [];
  const sheets = safeScalar(() => ax.win.sheets().length);
  if (sheets.ok && typeof sheets.value === "number") {
    for (let s = 0; s < sheets.value; s++) out.push({ label: "sheet" + s, el: ax.win.sheets[s] });
  }
  out.push({ label: "window", el: ax.win });
  return out;
}

function isGotoPathRole(role, el) {
  if (role !== "AXTextField" && role !== "AXComboBox") return false;
  return str(() => el.subrole()) !== "AXSearchField";
}

function pickGotoField(ui) {
  let field = null;
  for (let i = 0; i < ui.length; i++) {
    const role = str(() => ui[i].role());
    if (!isGotoPathRole(role, ui[i])) continue;
    const focused = safeScalar(() => ui[i].focused()).value === true;
    if (focused || field === null) field = { el: ui[i], index: i, name: null };
  }
  return field;
}

function locateGotoField(ax) {
  const containers = gotoContainerList(ax);
  for (let c = 0; c < containers.length; c++) {
    let ui = null;
    try { ui = containers[c].el.entireContents(); } catch (err) { continue; }
    let header = false;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => ui[i].value())) >= 0) header = true;
    }
    const field = pickGotoField(ui);
    if (header && field !== null) return { container: containers[c], field: field };
  }
  return null;
}

function waitGotoReady(ax, pid, options) {
  const started = nowMs();
  log("[GTF_FOCUS] START");
  let located = options && options.located ? options.located : null;
  let openedLogged = false;
  let announced = false;
  let refocusLogged = false;
  let pressed = false;
  let probeLogged = false;
  let focusStarted = null;
  let reclaimLogged = false;
  while (true) {
    if (!appIsKey(ax, pid)) {
      const front = readFrontProcess(ax.se);
      if (!reclaimLogged) {
        log("[GTF][FOCUS] reclaim front=" + JSON.stringify(front.name));
        reclaimLogged = true;
      }
      try { ax.proc.frontmost = true; } catch (err) {
        log("[GTF][FOCUS] reclaim error " + errFields(err));
      }
    } else {
      reclaimLogged = false;
    }
    if (located === null) located = locateGotoField(ax);
    if (located !== null) {
      if (focusStarted === null) focusStarted = nowMs();
      if (!openedLogged) {
        log("[GTF][OPEN] PASS");
        log("[GTF][FIELD] FOUND");
        openedLogged = true;
      }
      if (!pressed) {
        try { located.field.el.actions.byName("AXPress").perform(); } catch (err) {
          if (isAxStale(err)) {
            log("[GTF][FOCUS] field stale; relocate");
            located = null;
            pressed = false;
            continue;
          }
          log("[GTF][FOCUS] press error " + errFields(err));
        }
        pressed = true;
      }
      try { located.field.el.attributes.byName("AXFocused").value = true; } catch (err) {
        if (isAxStale(err)) {
          log("[GTF][FOCUS] field stale; relocate");
          located = null;
          pressed = false;
          continue;
        }
        if (!refocusLogged) {
          log("[GTF][FOCUS] refocus error " + errFields(err));
          refocusLogged = true;
        }
      }
      if (!probeLogged) {
        const focused = safeScalar(() => located.field.el.focused());
        const front = readFrontProcess(ax.se);
        log("[GTF][FOCUS] probe focused=" + show(focused) + " front=" + JSON.stringify(front.name));
        probeLogged = true;
      }
      if (fieldIsKeyInput(ax, pid, located.field.el)) {
        const elapsed = nowMs() - started;
        log("[GTF][FOCUS] PASS");
        log("[GTF_FOCUS] PASS elapsed_ms=" + elapsed);
        return located;
      }
    }
    const budgetStart = focusStarted === null ? started : focusStarted;
    if (nowMs() - budgetStart > GTF_FOCUS_TIMEOUT_MS) break;
    if (!announced) {
      log("[GTF][FOCUS] waiting...");
      log("[GTF_FOCUS] WAIT");
      announced = true;
    }
    const remain = GTF_FOCUS_TIMEOUT_MS - (nowMs() - budgetStart);
    if (remain <= 0) break;
    sleepSec(Math.min(GTF_FOCUS_POLL_MS, remain) / 1000);
  }
  log("[GTF_FOCUS] FAIL elapsed_ms=" + (nowMs() - started));
  if (options && options.soft) return null;
  fail("GTF_FOCUS", new Error("GO_TO_FOLDER_FOCUS_TIMEOUT"));
}

const RANGE_FIELD_ROLES = ["AXTextField", "AXTextArea", "AXComboBox"];
const FRONTMOST_ATTEMPTS = 3;
const FRONTMOST_POLL_MS = 80;
const FRONTMOST_ATTEMPT_MS = 2000;
const RANGE_FIELD_POLL_MS = 80;
const RANGE_FIELD_TIMEOUT_MS = 8000;

function axAttr(el, name) {
  return str(() => el.attributes.byName(name).value());
}

function readOwnFrontmost(proc) {
  if (typeof proc.frontmost === "function") return safeScalar(() => proc.frontmost());
  return safeScalar(() => proc.frontmost);
}

function readFrontProcess(se) {
  try {
    const proc = se.processes.whose({ frontmost: true })[0];
    return { name: str(() => proc.name()), pid: safeScalar(() => proc.unixId()).value };
  } catch (err) {
    return { name: null, pid: null };
  }
}

function hideOtherFrontApp(se, pid) {
  const front = readFrontProcess(se);
  if (!front.name || frontMatches(front, pid)) return false;
  if (front.name === "Cursor" || front.name === "loginwindow") return false;
  log("[AX-ACTIVATE] hide front=" + JSON.stringify(front.name) + " pid=" + front.pid);
  try {
    const other = se.processes.whose({ name: front.name })[0];
    other.visible = false;
    const wins = other.windows();
    const count = wins ? wins.length : 0;
    for (let i = 0; i < count; i++) {
      try { wins[i].miniaturized = true; } catch (err) { /* one window is enough to lose front */ }
    }
    return true;
  } catch (err) {
    log("[AX-ACTIVATE] hide error " + errFields(err));
    return false;
  }
}

function raiseMasteroctaWindow(proc) {
  try {
    const wins = proc.windows();
    if (!wins || wins.length < 1) return false;
    try { wins[0].actions.byName("AXRaise").perform(); } catch (err) { /* press next */ }
    try { wins[0].actions.byName("AXPress").perform(); } catch (err) { /* frontmost poll retries */ }
    return true;
  } catch (err) {
    log("[AX-ACTIVATE] raise error " + errFields(err));
    return false;
  }
}

function ensureFrontmost(ax, pid) {
  const before = readFrontProcess(ax.se);
  log("[AX-FRONT] before name=" + JSON.stringify(before.name) + " pid=" + before.pid + " target=" + pid);
  for (let attempt = 1; attempt <= FRONTMOST_ATTEMPTS; attempt++) {
    const own = readOwnFrontmost(ax.proc);
    const now = readFrontProcess(ax.se);
    if (own.value === true && frontMatches(now, pid)) {
      log("[AX-FRONT] PASS attempt=" + attempt + " name=" + JSON.stringify(now.name) + " pid=" + now.pid);
      return true;
    }
    log("[AX-FRONT] activate attempt=" + attempt + " front_name=" + JSON.stringify(now.name) + " front_pid=" + now.pid);
    activateMasteroctaApp(pid);
    hideOtherFrontApp(ax.se, pid);
    try { ax.proc.frontmost = true; } catch (err) {
      log("[AX-FRONT] activate error " + errFields(err));
    }
    const started = nowMs();
    while (nowMs() - started <= FRONTMOST_ATTEMPT_MS) {
      const own2 = readOwnFrontmost(ax.proc);
      const polled = readFrontProcess(ax.se);
      if (own2.value === true && frontMatches(polled, pid)) {
        log("[AX-FRONT] PASS attempt=" + attempt + " name=" + JSON.stringify(polled.name) + " pid=" + polled.pid +
          " elapsed_ms=" + (nowMs() - started));
        return true;
      }
      const remain = FRONTMOST_ATTEMPT_MS - (nowMs() - started);
      if (remain <= 0) break;
      sleepSec(Math.min(FRONTMOST_POLL_MS, remain) / 1000);
    }
  }
  const after = readFrontProcess(ax.se);
  log("[AX-FRONT] FAIL name=" + JSON.stringify(after.name) + " pid=" + after.pid);
  fail("AX-FRONT", new Error("AX_FRONTMOST_TIMEOUT"));
}

function isRangeFieldRole(role) {
  return RANGE_FIELD_ROLES.indexOf(role) >= 0;
}

function exactLabel(el, label) {
  const values = [
    str(() => el.name()),
    str(() => el.description()),
    str(() => el.title()),
    str(() => el.help()),
    axAttr(el, "AXIdentifier"),
    axAttr(el, "AXDescription"),
    axAttr(el, "AXTitle"),
    axAttr(el, "AXHelp"),
  ];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === label) return true;
  }
  return false;
}

function collectRangeFields(ui, label) {
  const hits = [];
  for (let i = 0; i < ui.length; i++) {
    if (!isRangeFieldRole(str(() => ui[i].role()))) continue;
    if (exactLabel(ui[i], label)) hits.push({ el: ui[i], index: i, name: label, via: "attribute" });
  }
  if (hits.length > 0) return hits;
  const nearby = findRangeFieldNearby(ui, label);
  return nearby === null ? [] : [nearby];
}

function findRangeFieldNearby(ui, label) {
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXStaticText") continue;
    const value = str(() => ui[i].value()) || str(() => ui[i].name());
    if (value !== label) continue;
    for (let j = i + 1; j < ui.length && j < i + 8; j++) {
      const role = str(() => ui[j].role());
      if (isRangeFieldRole(role)) return { el: ui[j], index: j, name: label, via: "nearby-label" };
      if (role === "AXStaticText") break;
    }
  }
  return null;
}

function findRangeField(ui, label) {
  const hits = collectRangeFields(ui, label);
  return hits.length === 0 ? null : hits[0];
}

function findTextField(ui, name) {
  return findRangeField(ui, name);
}

function logElementDiag(el, index) {
  log("[A04][POST_CLOSE_AX_DIAG] index=" + index +
    " role=" + JSON.stringify(str(() => el.role())) +
    " subrole=" + JSON.stringify(str(() => el.subrole())) +
    " title=" + JSON.stringify(str(() => el.title())) +
    " description=" + JSON.stringify(str(() => el.description())) +
    " help=" + JSON.stringify(str(() => el.help())) +
    " identifier=" + JSON.stringify(axAttr(el, "AXIdentifier")) +
    " value=" + JSON.stringify(str(() => el.value())) +
    " focused=" + show(safeScalar(() => el.focused())) +
    " enabled=" + show(safeScalar(() => el.enabled())));
}

function logPostCloseAxDiag(ax) {
  log("[A04][POST_CLOSE_AX_DIAG]");
  const wins = safeScalar(() => ax.proc.windows().length);
  const sheets = safeScalar(() => ax.win.sheets().length);
  log("[A04][POST_CLOSE_AX_DIAG] window_count=" + show(wins) + " sheet_count=" + show(sheets));
  const ui = uiEntire(ax);
  const interesting = ["AXTextField", "AXTextArea", "AXComboBox", "AXStaticText", "AXGroup", "AXButton"];
  let logged = 0;
  for (let i = 0; i < ui.length; i++) {
    const role = str(() => ui[i].role());
    if (interesting.indexOf(role) < 0) continue;
    const blob = [
      str(() => ui[i].name()),
      str(() => ui[i].title()),
      str(() => ui[i].description()),
      str(() => ui[i].value()),
    ].join(" ");
    const textRole = role === "AXTextField" || role === "AXTextArea" || role === "AXComboBox";
    if (!textRole && !/フレーム|波形|RANGE|スライス|draft/.test(blob)) continue;
    if (logged >= 160) {
      log("[A04][POST_CLOSE_AX_DIAG] truncated");
      break;
    }
    logElementDiag(ui[i], i);
    logged += 1;
  }
  log("[A04][POST_CLOSE_AX_DIAG] logged=" + logged + " elements=" + ui.length);
}

function uiEntire(ax) {
  try {
    return withoutExit(() => enumerate("UI-01", ax.win));
  } catch (err) {
    if (!isAxStale(err) || ax.pid === undefined || ax.pid === null) fail("UI-01", err);
    log("[UI-01][STALE] discard process/window and reacquire ax_error=" + axErrorCode(err));
    const fresh = acquireAx(ax.pid);
    ax.se = fresh.se;
    ax.proc = fresh.proc;
    ax.win = fresh.win;
    ax.ui = fresh.ui;
    return fresh.ui;
  }
}

function failGotoPrecondition(detail) {
  fail("GTF-PRE", new Error("GOTO_FOLDER_PRECONDITION_FAILED: " + detail));
}

function failA04(code, detail) {
  fail("A04", new Error(code + (detail ? ": " + detail : "")));
}

function sendGotoFolderShortcut(ax, pid, options) {
  const front = readFrontProcess(ax.se);
  log("[GTF-SHORTCUT] front name=" + JSON.stringify(front.name) + " pid=" + front.pid + " target=" + pid);
  if (front.name !== "masterocta" || Number(front.pid) !== Number(pid)) {
    const detail = "target pid is not frontmost name=" + front.name + " pid=" + front.pid;
    if (options && options.soft) {
      log("[GTF-SHORTCUT] refused " + detail);
      return false;
    }
    failGotoPrecondition(detail);
  }
  stage("GTF-SHORTCUT", () => {
    ax.se.keystroke("g", { using: ["command down", "shift down"] });
    log("[GTF-SHORTCUT] Cmd+Shift+G PASS");
  });
  return true;
}

function findPressableByName(ax, names, roles) {
  const want = Array.isArray(names) ? names : [names];
  const roleOk = roles || ["AXButton", "AXRadioButton"];
  const ui = uiEntire(ax);
  for (let i = 0; i < ui.length; i++) {
    const role = str(() => ui[i].role());
    if (roleOk.indexOf(role) < 0) continue;
    const name = str(() => ui[i].name()) || str(() => ui[i].title());
    if (want.indexOf(name) >= 0) return { el: ui[i], index: i, name: name };
  }
  return null;
}

function pressNamed(ax, id, names, roles) {
  const hit = stage(id, () => {
    const b = findPressableByName(ax, names, roles);
    if (b === null) throw new Error("control not found: " + JSON.stringify(names));
    return b;
  });
  if (!readEnabled(id + "-EN", hit)) fail(id, new Error("control disabled"), describe(hit.el, hit.index));
  press(id + "-PRESS", hit);
  return hit.name;
}

function staticTextsContaining(ax, needle) {
  const ui = uiEntire(ax);
  const hits = [];
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXStaticText") continue;
    const value = str(() => ui[i].value()) || str(() => ui[i].name());
    if (value && value.indexOf(needle) >= 0) hits.push(value);
  }
  return hits;
}

function expandedSliceCloseVisible(ax) {
  return findPressableByName(ax, [NAMES.sliceCloseExpanded], ["AXButton"]) !== null;
}

function fieldEnabled(field) {
  return safeScalar(() => field.el.enabled()).value === true;
}

function catalogWorkspaceVisible(ax) {
  const ui = uiEntire(ax);
  for (let i = 0; i < ui.length; i++) {
    const role = str(() => ui[i].role());
    const blob = [str(() => ui[i].name()), str(() => ui[i].value()), str(() => ui[i].description())].join(" ");
    if ((role === "AXGroup" || role === "AXStaticText") && (
      blob.indexOf("波形プレビュー") >= 0 || blob.indexOf(NATIVE_ACCEPTANCE_RANGE_ROW) >= 0
    )) return true;
    if (role === "AXTextField" && blob.indexOf("この場所のサンプルを検索") >= 0) return true;
    if (role === "AXButton" && blob.indexOf(NAMES.sliceExpand) >= 0) return true;
    if (role === "AXButton" && (
      blob.indexOf(NAMES.play) >= 0 ||
      blob.indexOf(NAMES.chooseRoot[0]) >= 0 ||
      blob.indexOf(NAMES.chooseRoot[1]) >= 0
    )) return true;
  }
  return false;
}

function rangeRowSelected(ax, relpath) {
  const ui = uiEntire(ax);
  let row = null;
  for (let i = 0; i < ui.length; i++) {
    const role = str(() => ui[i].role());
    if (role === "AXRow") { row = ui[i]; continue; }
    if (role === "AXColumn") row = null;
    if (row !== null && role === "AXStaticText") {
      const label = str(() => ui[i].name()) || str(() => ui[i].value());
      if (label === relpath) return safeScalar(() => row.selected()).value === true;
    }
  }
  return false;
}

function catalogRangeFieldsReady(ax) {
  const ui = uiEntire(ax);
  const start = findRangeField(ui, NAMES.rangeStartField);
  const end = findRangeField(ui, NAMES.rangeEndField);
  if (start === null || end === null) {
    log("[A04][RANGE_FIELDS] missing start=" + (start !== null) + " end=" + (end !== null) + " elements=" + ui.length);
    return null;
  }
  if (!fieldEnabled(start) || !fieldEnabled(end)) {
    log("[A04][RANGE_FIELDS] disabled start=" + fieldEnabled(start) + " end=" + fieldEnabled(end));
    return null;
  }
  if (expandedSliceCloseVisible(ax)) return null;
  return { start: start, end: end };
}

function logRangeFieldsReady(fields) {
  log("[A04][RANGE_FIELDS_READY]");
  log("[A04][RANGE_FIELDS_READY] start_found=true via=" + fields.start.via);
  log("[A04][RANGE_FIELDS_READY] end_found=true via=" + fields.end.via);
  log("[A04][RANGE_FIELDS_READY] start_enabled=true");
  log("[A04][RANGE_FIELDS_READY] end_enabled=true");
  log("[A04][RANGE_FIELDS_READY] RESULT=PASS");
}

const GTF_RETRY_ATTEMPTS = 3;

function dismissStaleGoto(ax) {
  if (findGoto(ax) === null) return false;
  log("[GTF][DISMISS] stale Go to Folder; Escape without Return");
  ax.se.keyCode(53);
  return true;
}

function masteroctaIsFront(ax, pid) {
  const front = readFrontProcess(ax.se);
  log("[GTF][FRONT] name=" + JSON.stringify(front.name) + " pid=" + front.pid + " target=" + pid);
  return front.name === "masterocta" && Number(front.pid) === Number(pid);
}

function stepRegisterRoot(pid, path) {
  if (!path) failGotoPrecondition("missing fixture path");
  log("[REGISTER-00] START path=" + JSON.stringify(path));
  stepChooseRoot(pid);
  sleepSec(0.4);
  let committed = false;
  for (let attempt = 1; attempt <= GTF_RETRY_ATTEMPTS; attempt++) {
    log("[GTF][ATTEMPT] " + attempt + "/" + GTF_RETRY_ATTEMPTS);
    let ax = attach(pid);
    ensureFrontmost(ax, pid);
    ax = attach(pid);
    if (!masteroctaIsFront(ax, pid)) continue;
    if (dismissStaleGoto(ax)) {
      sleepSec(0.35);
      ax = attach(pid);
    }
    ensureFrontmost(ax, pid);
    ax = attach(pid);
    if (!masteroctaIsFront(ax, pid)) {
      log("[GTF][ATTEMPT] lost frontmost before shortcut");
      continue;
    }
    if (!sendGotoFolderShortcut(ax, pid, { soft: true })) {
      log("[GTF][ATTEMPT] shortcut refused; not frontmost");
      continue;
    }
    const opened = waitUntil("GTF-REOPEN", 2500, 80, () => findGoto(attach(pid)) !== null);
    if (opened === null) {
      log("[GTF][ATTEMPT] sheet did not open");
      continue;
    }
    log("[REGISTER-01] goto sheet visible PASS");
    const result = stepGotoGo(pid, path, { soft: true });
    if (result === "goto-go-pressed") {
      committed = true;
      break;
    }
    log("[GTF][ATTEMPT] " + result + "; no paste commit, no Return");
  }
  if (!committed) fail("GTF_FOCUS", new Error("GO_TO_FOLDER_FOCUS_TIMEOUT"));
  sleepSec(1.0);
  const basename = path.split("/").pop();
  stepOpen(pid, basename);
  log("[REGISTER-02] register-root PASS");
  return "register-root";
}

function stepSliceTab(pid) {
  const ax = attach(pid);
  pressNamed(ax, "SLICE-TAB", [NAMES.sliceTab], ["AXRadioButton", "AXButton"]);
  return "slice-tab";
}

function stepSliceExpand(pid) {
  const ax = attach(pid);
  pressNamed(ax, "SLICE-EXPAND", [NAMES.sliceExpand], ["AXButton"]);
  sleepSec(0.8);
  return "slice-expanded";
}

function sliceDetectControlsVisible(ax) {
  return findPressableByName(ax, [NAMES.detectAttacks, NAMES.analyzeRange], ["AXButton"]) !== null;
}

function stepSlicePrepareWorkspace(pid) {
  const ax = attach(pid);
  if (expandedSliceCloseVisible(ax)) {
    log("[SLICE-PREP] expanded workspace already open");
  } else {
    stepSliceTab(pid);
    stepSliceExpand(pid);
  }
  const ready = waitUntil("SLICE-PREP-READY", 15000, 200, () => {
    const fresh = attach(pid);
    return sliceDetectControlsVisible(fresh);
  });
  if (ready === null) failA04("A04_SLICE_WORKSPACE_FAIL", "analyze control not available");
  log("[SLICE-PREP] analyze control visible PASS");
  return expandedSliceCloseVisible(attach(pid)) ? "slice-workspace-expanded" : "slice-workspace-opened";
}

function stepSliceDetect(pid) {
  const ax = attach(pid);
  pressNamed(ax, "SLICE-DETECT", [NAMES.detectAttacks, NAMES.analyzeRange], ["AXButton"]);
  log("[A04_S1_DRAFT_A_READY] detect-started");
  return "slice-detect-started";
}

function stepSliceWaitApply(pid) {
  const ok = waitUntil("SLICE-WAIT-APPLY", 120000, 500, () => {
    const ax = attach(pid);
    const b = findPressableByName(ax, [NAMES.applyCandidates, NAMES.closeAnalysis], ["AXButton"]);
    return b !== null && safeScalar(() => b.el.enabled()).value === true;
  });
  if (ok === null) failA04("A04_DRAFT_A_TIMEOUT", "apply/close not available");
  log("[A04_S1_DRAFT_A_READY] analysis-ready PASS");
  return "slice-apply-ready";
}

function stepSliceApply(pid) {
  const ax = attach(pid);
  const apply = findPressableByName(ax, [NAMES.applyCandidates], ["AXButton"]);
  if (apply !== null && safeScalar(() => apply.el.enabled()).value === true) {
    press("SLICE-APPLY", apply);
  } else {
    log("[SLICE-APPLY] apply skipped; close-only path");
  }
  return "slice-apply-pressed";
}

function stepSliceWaitDraft(pid) {
  const ok = waitUntil("SLICE-WAIT-DRAFT", 60000, 400, () => {
    const ax = attach(pid);
    const hits = staticTextsContaining(ax, "draft スライス");
    return hits.some((t) => t.indexOf("revision") >= 0);
  });
  if (ok === null) failA04("A04_DRAFT_A_TIMEOUT", "draft summary not visible");
  const ax = attach(pid);
  const summary = staticTextsContaining(ax, "draft スライス").join(" | ");
  log("[A04][BASELINE-UI] " + summary);
  log("[A04_S1_DRAFT_A_READY] PASS");
  return "slice-draft-ready";
}

function stepA04CloseExpanded(pid) {
  let ax = attach(pid);
  log("[A04_S2_EXPANDED_SLICE_CLOSED] START");
  const closeBtn = findPressableByName(ax, [NAMES.sliceCloseExpanded], ["AXButton"]);
  if (closeBtn !== null) {
    if (safeScalar(() => closeBtn.el.enabled()).value !== true) {
      failA04("A04_EXPANDED_CLOSE_FAIL", "close button disabled");
    }
    press("A04-CLOSE-EXPANDED", closeBtn);
  }
  const closed = waitUntil("A04-CLOSE-STATE", 10000, RANGE_FIELD_POLL_MS, () => {
    const fresh = attach(pid);
    return !expandedSliceCloseVisible(fresh) && catalogWorkspaceVisible(fresh);
  });
  if (closed === null) {
    ax = attach(pid);
    log("[A04][CLOSE_EXPANDED]");
    log("[A04][CLOSE_EXPANDED] expanded_absent=" + (!expandedSliceCloseVisible(ax)));
    log("[A04][CLOSE_EXPANDED] catalog_visible=" + catalogWorkspaceVisible(ax));
    log("[A04][CLOSE_EXPANDED] range_row_selected=false");
    log("[A04][CLOSE_EXPANDED] RESULT=FAIL");
    logPostCloseAxDiag(ax);
    failA04("A04_EXPANDED_CLOSE_FAIL", "catalog workspace not restored");
  }
  ax = attach(pid);
  let rowSelected = rangeRowSelected(ax, NATIVE_ACCEPTANCE_RANGE_ROW);
  if (!rowSelected) {
    log("[A04][CLOSE_EXPANDED] range row not selected; selecting once");
    stepSelectRow(pid, NATIVE_ACCEPTANCE_RANGE_ROW);
    ax = attach(pid);
    rowSelected = rangeRowSelected(ax, NATIVE_ACCEPTANCE_RANGE_ROW);
  }
  const expandedAbsent = !expandedSliceCloseVisible(ax);
  const catalogVisible = catalogWorkspaceVisible(ax);
  log("[A04][CLOSE_EXPANDED]");
  log("[A04][CLOSE_EXPANDED] expanded_absent=" + expandedAbsent);
  log("[A04][CLOSE_EXPANDED] catalog_visible=" + catalogVisible);
  log("[A04][CLOSE_EXPANDED] range_row_selected=" + rowSelected);
  if (!expandedAbsent || !catalogVisible || !rowSelected) {
    logPostCloseAxDiag(ax);
    log("[A04][CLOSE_EXPANDED] RESULT=FAIL");
    failA04("A04_EXPANDED_CLOSE_FAIL", "catalog workspace not restored");
  }
  log("[A04][CLOSE_EXPANDED] RESULT=PASS");
  log("[A04_S2_EXPANDED_SLICE_CLOSED] PASS");
  return "a04-expanded-closed";
}

function inspectorTabTitle(ax) {
  const ui = uiEntire(ax);
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXGroup") continue;
    if (str(() => ui[i].subrole()) !== "AXTabPanel") continue;
    return str(() => ui[i].title()) || str(() => ui[i].description()) || str(() => ui[i].name());
  }
  return null;
}

function radioSelected(ax, name) {
  const ui = uiEntire(ax);
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXRadioButton") continue;
    const label = str(() => ui[i].name()) || str(() => ui[i].title());
    if (label !== name) continue;
    if (safeScalar(() => ui[i].selected()).value === true) return true;
  }
  return false;
}

function previewTabActive(ax) {
  return inspectorTabTitle(ax) === NAMES.previewTab || radioSelected(ax, NAMES.previewTab);
}

function sliceTabActive(ax) {
  return inspectorTabTitle(ax) === NAMES.sliceTab || radioSelected(ax, NAMES.sliceTab);
}

function activateInspectorTab(pid, name, timeoutCode) {
  const active = name === NAMES.previewTab ? previewTabActive : sliceTabActive;
  let ax = attach(pid);
  if (!active(ax)) {
    const present = waitUntil("TAB-FIND-" + name, 4000, 200, () => {
      const fresh = attach(pid);
      if (active(fresh)) return true;
      const btn = findPressableByName(fresh, [name], ["AXRadioButton", "AXButton"]);
      return btn !== null && safeScalar(() => btn.el.enabled()).value === true;
    });
    if (present === null) failA04(timeoutCode, name + " tab control not found");
    let pressed = false;
    for (let attempt = 1; attempt <= 3 && !pressed; attempt++) {
      ax = attach(pid);
      if (active(ax)) { pressed = true; break; }
      const btn = findPressableByName(ax, [name], ["AXRadioButton", "AXButton"]);
      if (btn === null || safeScalar(() => btn.el.enabled()).value !== true) {
        log("[A04][TAB] press lookup miss attempt=" + attempt + " name=" + name);
        continue;
      }
      press("TAB-" + name + "-PRESS", btn);
      pressed = true;
    }
    if (!pressed) failA04(timeoutCode, name + " tab control not found");
  }
  const ok = waitUntil("TAB-" + name, 8000, RANGE_FIELD_POLL_MS, () => active(attach(pid)));
  if (ok === null) failA04(timeoutCode, name + " tab did not become active");
  log("[A04][TAB] active=" + name + " PASS");
  return name;
}

function stepA04RangeInputCheck(pid) {
  const ax = attach(pid);
  if (!previewTabActive(ax)) failA04("PREVIEW_TAB_ACTIVATION_TIMEOUT", "range search before preview tab is active");
  let fields = null;
  const ready = waitUntil("A04-RANGE-FIELDS", 20000, RANGE_FIELD_POLL_MS, () => {
    fields = catalogRangeFieldsReady(attach(pid));
    return fields !== null;
  });
  if (ready === null || fields === null) {
    failA04("A04_RANGE_INPUT_NOT_AVAILABLE", "start/end fields missing or disabled");
  }
  logRangeFieldsReady(fields);
  log("[A04_S3_RANGE_B_INPUT_AVAILABLE] PASS");
  return "a04-range-input-available";
}

function stepA04PasteRangeB(pid, start, end) {
  stepA04CloseExpanded(pid);
  activateInspectorTab(pid, NAMES.previewTab, "PREVIEW_TAB_ACTIVATION_TIMEOUT");
  stepA04RangeInputCheck(pid);
  log("[A04][RANGE_ORDER] end-first reason=start 176400 would invert the current end and clear the committed library range");
  stepPasteRange(pid, NAMES.rangeEndField, String(end));
  stepPasteRange(pid, NAMES.rangeStartField, String(start));
  let lastReadback = "missing";
  const readback = waitUntil("A04-RANGE-READBACK", 45000, 100, () => {
    const fresh = attach(pid);
    const ui = fresh.ui || uiEntire(fresh);
    const startField = findTextField(ui, NAMES.rangeStartField);
    const endField = findTextField(ui, NAMES.rangeEndField);
    if (startField === null || endField === null) {
      lastReadback = "missing";
      return false;
    }
    const actualStart = str(() => startField.el.value());
    const actualEnd = str(() => endField.el.value());
    lastReadback = actualStart + "/" + actualEnd;
    log("[A04][RANGE_B] expected_start=" + start + " expected_end=" + end +
      " actual_start=" + actualStart + " actual_end=" + actualEnd);
    return actualStart === String(start) && actualEnd === String(end);
  });
  if (readback === null) failA04("A04_RANGE_B_VERIFY_FAIL", "paste readback " + lastReadback);
  const committed = waitUntil("A04-RANGE-COMMIT", 3000, 100, () => {
    const fresh = attach(pid);
    const play = findPressableByName(fresh, [NAMES.play], ["AXButton"]);
    return play !== null && safeScalar(() => play.el.enabled()).value === true;
  });
  if (committed === null) {
    failA04("A04_RANGE_B_VERIFY_FAIL", "play control stayed disabled after paste");
  }
  log("[A04][RANGE_B] react_commit=PASS");
  log("[A04_S4_RANGE_B_PASTED] PASS");
  return "a04-range-b-pasted";
}

function stepA04CopyPending(pid) {
  activateInspectorTab(pid, NAMES.sliceTab, "SLICE_TAB_ACTIVATION_TIMEOUT");
  const ax = attach(pid);
  if (!sliceTabActive(ax)) failA04("SLICE_TAB_ACTIVATION_TIMEOUT", "slice tab is not active");
  const enabled = waitUntil("A04-COPY-ENABLED", 4000, 150, () => {
    const fresh = attach(pid);
    if (!sliceTabActive(fresh)) return false;
    const btn = findPressableByName(fresh, [NAMES.copyPreviewPending], ["AXButton"]);
    return btn !== null && safeScalar(() => btn.el.enabled()).value === true;
  });
  if (enabled === null) {
    const sampleAx = attach(pid);
    const sample = staticTextsContaining(sampleAx, "プレビュー").concat(staticTextsContaining(sampleAx, "フレーム")).slice(0, 6).join(" | ");
    failA04("PENDING_RANGE_MISMATCH", "copy control disabled; sample=" + sample);
  }
  pressNamed(attach(pid), "A04-COPY-PENDING", [NAMES.copyPreviewPending], ["AXButton"]);
  sleepSec(0.4);
  return "a04-pending-copied";
}

function stepA04VerifyPending(pid, start, end) {
  const frameLabel = "[" + start + ", " + end + ")";
  const ok = waitUntil("A04-PENDING-RANGE", A04_PENDING_VERIFY_TIMEOUT_MS, 200, () => {
    const fresh = attach(pid);
    const hits = staticTextsContaining(fresh, String(start));
    return hits.some((t) => t.indexOf(String(end)) >= 0 || t.indexOf(frameLabel) >= 0);
  });
  if (ok === null) {
    const sampleAx = attach(pid);
    const sample = staticTextsContaining(sampleAx, "フレーム").slice(0, 5).join(" | ");
    failA04("PENDING_RANGE_MISMATCH", "pending range not " + start + ".." + end + "; sample=" + sample);
  }
  log("[A04][PENDING_RANGE] start=" + start + " end=" + end + " PASS");
  log("[A04_S5_PENDING_RANGE_VERIFIED] PASS");
  return "a04-pending-verified";
}

function mergeAxSession(ax, fresh) {
  ax.se = fresh.se;
  ax.proc = fresh.proc;
  ax.win = fresh.win;
  ax.ui = fresh.ui;
  ax.pid = fresh.pid;
}

function refreshCancelTree(pid, ax) {
  try {
    if (ax.proc && typeof ax.proc.windows === "function" && ax.win) {
      const wins = ax.proc.windows();
      if (wins && wins.length > 0) ax.win = wins[0];
    }
    if (ax.win && typeof ax.win.entireContents === "function") {
      const ui = ax.win.entireContents();
      if (ui && ui.length > 0) {
        ax.ui = ui;
        return ui;
      }
    }
  } catch (err) {
    log("[A04][CANCEL_WINDOW] tree refresh " + errFields(err));
    if (!isAxStale(err)) return null;
  }
  try {
    const fresh = acquireAx(pid);
    mergeAxSession(ax, fresh);
    return ax.ui;
  } catch (err) {
    log("[A04][CANCEL_WINDOW] reacquire fail " + errFields(err));
    return null;
  }
}

function logCancelControlAudit(el, index) {
  if (!el) return;
  log("[A04][CANCEL_AUDIT] index=" + index +
    " role=" + show(safeScalar(() => el.role())) +
    " title=" + show(safeScalar(() => el.title())) +
    " name=" + show(safeScalar(() => el.name())) +
    " description=" + show(safeScalar(() => el.description())) +
    " identifier=" + show(safeScalar(() => (typeof el.identifier === "function" ? el.identifier() : null))) +
    " enabled=" + show(safeScalar(() => el.enabled())) +
    " visible=" + show(safeScalar(() => el.visible())));
}

function findExactCancelButton(ui) {
  if (!ui) return null;
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXButton") continue;
    const name = str(() => ui[i].name()) || str(() => ui[i].title());
    if (name === NAMES.cancelAnalysis) return { el: ui[i], index: i, name: name };
  }
  return null;
}

function findAnalysisCloseButton(ui) {
  if (!ui) return null;
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXButton") continue;
    const name = str(() => ui[i].name()) || str(() => ui[i].title());
    if (name === NAMES.closeAnalysis || name === NAMES.cancelAnalysis) {
      return { el: ui[i], index: i, name: name };
    }
  }
  return null;
}

function findReanalyzeButton(ui) {
  if (!ui) return null;
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXButton") continue;
    const name = str(() => ui[i].name()) || str(() => ui[i].title());
    if (name === NAMES.reanalyzePending) return { el: ui[i], index: i, name: name };
  }
  return null;
}

function detectReanalysisActive(ui, reanalyzeEl) {
  const cancel = findExactCancelButton(ui);
  if (cancel !== null) {
    return { signal: "cancel_button_title", detail: NAMES.cancelAnalysis };
  }
  for (let t = 0; t < REANALYSIS_ACTIVE_STATUS_TEXTS.length; t++) {
    const want = REANALYSIS_ACTIVE_STATUS_TEXTS[t];
    for (let i = 0; i < ui.length; i++) {
      if (str(() => ui[i].role()) !== "AXStaticText") continue;
      const value = str(() => ui[i].value()) || str(() => ui[i].name());
      if (value === want) return { signal: "status_text", detail: want };
    }
  }
  const found = findReanalyzeButton(ui);
  const target = found ? found.el : reanalyzeEl;
  if (target) {
    const enabled = safeScalar(() => target.enabled()).value;
    if (enabled === false) return { signal: "reanalyze_disabled", detail: NAMES.reanalyzePending };
  }
  return null;
}

function waitReanalysisActiveState(pid, ax, origin, reanalyzeEl) {
  const deadline = origin + REANALYSIS_ACTIVE_TIMEOUT_MS;
  while (nowMs() <= deadline) {
    const ui = refreshCancelTree(pid, ax);
    if (ui) {
      const active = detectReanalysisActive(ui, reanalyzeEl);
      if (active) {
        const elapsed = nowMs() - origin;
        log("REANALYSIS_ACTIVE_STATE_OBSERVED=YES");
        log("[A04][REANALYSIS_ACTIVE] signal=" + active.signal + " detail=" + JSON.stringify(active.detail) +
          " elapsed_ms=" + elapsed);
        return active;
      }
    }
    sleepSec(CANCEL_POLL_MS / 1000);
  }
  log("REANALYSIS_ACTIVE_STATE_OBSERVED=NO");
  failA04("A04_REANALYSIS_ACTIVE_TIMEOUT", "no active signal before cancel window");
}

function buttonNameRead(el) {
  const read = safeScalar(() => el.name());
  if (!read.ok) return read;
  if (typeof read.value === "string" && read.value !== "") return read;
  const title = safeScalar(() => el.title());
  return title.ok ? title : read;
}

function readIsStale(read) {
  return !!read && read.ok === false && String(read.error).indexOf("-1728") !== -1;
}

function axParent(el) {
  try {
    if (!el || !el.attributes || typeof el.attributes.byName !== "function") return null;
    const parent = el.attributes.byName("AXParent").value();
    return parent || null;
  } catch (err) {
    return null;
  }
}

function findButtonOnParent(parent, name) {
  if (!parent) return null;
  try {
    if (parent.buttons && typeof parent.buttons.whose === "function") {
      const hits = parent.buttons.whose({ name: name });
      if (hits && hits.length > 0) {
        const role = str(() => hits[0].role());
        if (role === null || role === "AXButton") return { el: hits[0], index: 0, name: name };
      }
    }
  } catch (err) {
    if (isAxStale(err)) return { stale: true };
  }
  let list = null;
  try {
    if (typeof parent.buttons === "function") list = parent.buttons();
  } catch (err) {
    if (isAxStale(err)) return { stale: true };
    return null;
  }
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const read = buttonNameRead(list[i]);
    if (readIsStale(read)) return { stale: true };
    const role = str(() => list[i].role());
    if ((role === null || role === "AXButton") && read.value === name) {
      return { el: list[i], index: i, name: name };
    }
  }
  return null;
}

function findButtonInScope(parent, name) {
  const direct = findButtonOnParent(parent, name);
  if (direct && (direct.el || direct.stale)) return direct;
  try {
    if (parent && typeof parent.entireContents === "function") {
      const ui = parent.entireContents();
      if (name === NAMES.cancelAnalysis) return findExactCancelButton(ui);
      return findAnalysisCloseButton(ui);
    }
  } catch (err) {
    if (isAxStale(err)) return { stale: true };
  }
  return null;
}

function bindCancelScope(buttonEl) {
  let current = buttonEl;
  for (let depth = 1; depth <= 6; depth++) {
    const parent = axParent(current);
    if (!parent) return null;
    const hit = findButtonInScope(parent, NAMES.closeAnalysis);
    let directCount = "na";
    try {
      if (typeof parent.buttons === "function") directCount = String(parent.buttons().length);
    } catch (err) {
      directCount = "err";
    }
    log("[A04][CANCEL_SCOPE] depth=" + depth +
      " role=" + JSON.stringify(str(() => parent.role())) +
      " direct_buttons=" + directCount +
      " contains_close=" + (hit && hit.el ? "YES" : "NO"));
    if (hit && hit.el) return parent;
    if (hit && hit.stale) return null;
    current = parent;
  }
  return null;
}

function rebindAnalysisButton(pid, ax, scope) {
  if (scope) {
    const cancel = findButtonInScope(scope, NAMES.cancelAnalysis);
    if (cancel && (cancel.el || cancel.stale)) return cancel;
    const close = findButtonInScope(scope, NAMES.closeAnalysis);
    if (close && close.stale) return close;
    return close && close.el ? close : null;
  }
  const ui = refreshCancelTree(pid, ax);
  if (!ui) return null;
  return findExactCancelButton(ui) || findAnalysisCloseButton(ui);
}

function observeAndPressCancel(pid, ax, origin, bound) {
  const deadline = origin + CANCEL_OBSERVE_TIMEOUT_MS;
  let slot = bound || null;
  if (slot === null) {
    const ui = ax.win && typeof ax.win.entireContents === "function" ? ax.win.entireContents() : null;
    slot = ui ? (findExactCancelButton(ui) || findAnalysisCloseButton(ui)) : null;
  }
  if (slot === null) failA04("A04_CANCEL_FAIL", "analysis close control missing");
  let scope = slot.scope || bindCancelScope(slot.el);
  let firstSeen = null;
  let pressMs = null;
  let cancelEverSeen = false;
  let lastName = null;
  let activeLogged = false;
  let auditLogged = false;
  let disabledLogged = false;
  let namePolls = 0;
  while (nowMs() <= deadline) {
    const nameRead = buttonNameRead(slot.el);
    const enabledRead = safeScalar(() => slot.el.enabled());
    if (readIsStale(nameRead) || readIsStale(enabledRead)) {
      log("[A04][CANCEL_WINDOW] stale -1728; rebind scope");
      const rebound = rebindAnalysisButton(pid, ax, scope);
      if (rebound && rebound.stale) {
        log("[A04][CANCEL_WINDOW] scope stale; full tree");
        scope = null;
        const wide = rebindAnalysisButton(pid, ax, null);
        if (wide && wide.el) {
          slot = wide;
          scope = bindCancelScope(wide.el) || scope;
        }
      } else if (rebound && rebound.el) {
        slot = rebound;
      }
      sleepSec(CANCEL_POLL_MS / 1000);
      continue;
    }
    namePolls += 1;
    const name = nameRead.value;
    if (name !== lastName) {
      log("[A04][CANCEL_WINDOW] name=" + JSON.stringify(name) + " elapsed_ms=" + (nowMs() - origin));
      lastName = name;
    }
    if (name === NAMES.cancelAnalysis && !activeLogged) {
      activeLogged = true;
      log("REANALYSIS_ACTIVE_STATE_OBSERVED=YES");
      log("[A04][REANALYSIS_ACTIVE] signal=cancel_button_title detail=" + JSON.stringify(name) +
        " elapsed_ms=" + (nowMs() - origin));
    }
    if (name === NAMES.cancelAnalysis) {
      if (!cancelEverSeen) {
        cancelEverSeen = true;
        firstSeen = nowMs() - origin;
        log("[A04][CANCEL_WINDOW] observed=YES");
        log("CANCEL_WINDOW_OBSERVED=YES");
        log("CANCEL_FIRST_SEEN_MS=" + firstSeen);
      }
      if (!auditLogged) {
        log("[A04][CANCEL_AUDIT] index=" + slot.index +
          " role=" + show(safeScalar(() => slot.el.role())) +
          " name=" + show(nameRead) +
          " enabled=" + show(enabledRead));
        auditLogged = true;
      }
      if (enabledRead.value !== true) {
        if (!disabledLogged) {
          log("[A04][CANCEL_WINDOW] visible-disabled elapsed_ms=" + (nowMs() - origin));
          disabledLogged = true;
        }
      } else if (pressMs === null) {
        const enabledSeen = nowMs() - origin;
        log("CANCEL_ENABLED_MS=" + enabledSeen);
        try {
          press("A04-CANCEL", slot);
          pressMs = nowMs() - origin;
          log("[A04][CANCEL_PRESS] PASS");
          log("CANCEL_PRESS=PASS");
          log("CANCEL_PRESS_MS=" + pressMs);
          ax.cancelSlot = slot;
          ax.cancelScope = scope;
          return { firstSeen: firstSeen, enabledSeen: enabledSeen, pressMs: pressMs };
        } catch (err) {
          log("[A04][CANCEL_PRESS] FAIL " + errFields(err));
          log("CANCEL_PRESS=FAIL");
          log("CLASSIFICATION=AUTOMATION_BUG");
          failA04("A04_CANCEL_PRESS_FAIL", errFields(err));
        }
      }
    } else if (cancelEverSeen && name === NAMES.closeAnalysis) {
      log("CANCEL_WINDOW_OBSERVED=YES");
      log("CLASSIFICATION=CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE");
      failA04("CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE", "cancel title disappeared before press");
    }
    sleepSec(CANCEL_POLL_MS / 1000);
  }
  log("[A04][CANCEL_WINDOW] observed=" + (cancelEverSeen ? "YES" : "NO"));
  log("CANCEL_NAME_POLLS=" + namePolls);
  log("CANCEL_WINDOW_OBSERVED=" + (cancelEverSeen ? "YES" : "NO"));
  if (!cancelEverSeen) {
    log("CLASSIFICATION=CANCEL_WINDOW_NOT_OBSERVED");
    failA04("CANCEL_WINDOW_NOT_OBSERVED", "last_close_name=" + lastName);
  }
  log("CLASSIFICATION=CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE");
  failA04("CANCEL_WINDOW_TOO_SHORT_OR_AUTOMATION_LATE", "enabled press not reached");
}

function waitCancelTerminal(pid, ax, origin) {
  const terminalOrigin = origin;
  let lastTerminalName = null;
  const done = waitUntil("A04-CANCEL-DONE", 8000, CANCEL_POLL_MS, () => {
    if (ax.cancelScope) {
      const close = findButtonOnParent(ax.cancelScope, NAMES.closeAnalysis);
      if (close && close.el) {
        if (lastTerminalName !== NAMES.closeAnalysis) {
          log("[A04][CANCEL_TERMINAL] name=" + JSON.stringify(NAMES.closeAnalysis));
          lastTerminalName = NAMES.closeAnalysis;
        }
        return true;
      }
      const cancel = findButtonOnParent(ax.cancelScope, NAMES.cancelAnalysis);
      if (cancel && cancel.el && lastTerminalName !== NAMES.cancelAnalysis) {
        log("[A04][CANCEL_TERMINAL] still=" + JSON.stringify(NAMES.cancelAnalysis));
        lastTerminalName = NAMES.cancelAnalysis;
      }
      if (close && close.stale) return false;
      if (cancel && cancel.el) return false;
    }
    const slot = ax.cancelSlot;
    if (slot && slot.el) {
      const nameRead = buttonNameRead(slot.el);
      if (readIsStale(nameRead)) return false;
      return nameRead.value !== null && nameRead.value !== NAMES.cancelAnalysis;
    }
    const ui = refreshCancelTree(pid, ax);
    if (!ui) return false;
    return findExactCancelButton(ui) === null;
  });
  if (done === null) {
    log("[A04][CANCEL_TERMINAL] FAIL");
    log("CANCEL_TERMINAL_STATE=FAIL");
    failA04("A04_CANCEL_FAIL", "cancel terminal state not observed");
  }
  const terminalMs = nowMs() - terminalOrigin;
  log("[A04][CANCEL_TERMINAL] PASS name=" + JSON.stringify(lastTerminalName));
  log("CANCEL_TERMINAL_STATE=PASS");
  log("ANALYSIS_TERMINAL_MS=" + terminalMs);
  return terminalMs;
}

function stepA04ReanalyzeStart(pid) {
  const ax = attach(pid);
  if (expandedSliceCloseVisible(ax)) failA04("A04_REANALYZE_GUARD_FAIL", "expanded slice still open");
  const btn = findPressableByName(ax, [NAMES.reanalyzePending], ["AXButton"]);
  if (btn === null) failA04("A04_REANALYZE_GUARD_FAIL", "reanalyze button missing");
  if (safeScalar(() => btn.el.enabled()).value !== true) failA04("A04_REANALYZE_GUARD_FAIL", "reanalyze disabled");
  const origin = nowMs();
  log("[A04][REANALYZE] t0_ms=" + origin);
  press("A04-REANALYZE", btn);
  waitReanalysisActiveState(pid, ax, origin, btn.el);
  log("[A04_S6_REANALYSIS_STARTED] PASS");
  return "a04-reanalyze-started";
}

function stepA04ReanalyzeCancel(pid) {
  const ax = attach(pid);
  if (findAnalysisCloseButton(uiEntire(ax)) === null) {
    failA04("A04_CANCEL_FAIL", "analysis close control missing");
  }
  const origin = nowMs();
  observeAndPressCancel(pid, ax, origin);
  waitCancelTerminal(pid, ax, origin);
  log("[A04_S7_REANALYSIS_CANCELLED] PASS");
  log("CANCEL_AUTOMATION=PASS");
  return "a04-reanalyze-cancelled";
}

function stepA04ReanalyzeAndCancel(pid) {
  const ax = attach(pid);
  if (expandedSliceCloseVisible(ax)) failA04("A04_REANALYZE_GUARD_FAIL", "expanded slice still open");
  const reanalyze = findPressableByName(ax, [NAMES.reanalyzePending], ["AXButton"]);
  if (reanalyze === null) failA04("A04_REANALYZE_GUARD_FAIL", "reanalyze button missing");
  if (safeScalar(() => reanalyze.el.enabled()).value !== true) {
    failA04("A04_REANALYZE_GUARD_FAIL", "reanalyze disabled");
  }
  const close = findAnalysisCloseButton(uiEntire(ax));
  if (close === null) failA04("A04_CANCEL_FAIL", "analysis close control missing before start");
  const scope = bindCancelScope(close.el);
  close.scope = scope;
  log("[A04][CANCEL_BIND] name=" + JSON.stringify(close.name) + " index=" + close.index +
    " scope=" + (scope ? "YES" : "NO"));
  const origin = nowMs();
  log("[A04][REANALYZE] t0_ms=" + origin);
  press("A04-REANALYZE", reanalyze);
  observeAndPressCancel(pid, ax, origin, close);
  waitCancelTerminal(pid, ax, origin);
  log("[A04_S7_REANALYSIS_CANCELLED] PASS");
  log("CANCEL_AUTOMATION=PASS");
  return "a04-reanalyze-cancelled";
}

function stepAxReady(pid) {
  const ax = attach(pid);
  let count = "na";
  try {
    if (ax.proc && typeof ax.proc.windows === "function") count = String(ax.proc.windows().length);
  } catch (err) {
    count = "na";
  }
  log("AX_READY=YES");
  log("window_count=" + count);
  return "ax-ready";
}

function stepA04SessionUsable(pid) {
  const ax = attach(pid);
  const close = findPressableByName(ax, [NAMES.closeAnalysis], ["AXButton"]);
  const apply = findPressableByName(ax, [NAMES.applyCandidates], ["AXButton"]);
  const edit = findPressableByName(ax, [NAMES.detectAttacks, NAMES.analyzeAgain], ["AXButton"]);
  const retained = close !== null && safeScalar(() => close.el.enabled()).value === true;
  const applyOk = apply !== null && safeScalar(() => apply.el.enabled()).value === true;
  const editOk = edit !== null && safeScalar(() => edit.el.enabled()).value === true;
  log("RETAINED_SESSION=" + (retained ? "PASS" : "NOT_OBSERVED"));
  log("APPLY_CONTROLS=" + (applyOk ? "PASS" : "NOT_OBSERVED"));
  log("EDIT_CONTROLS=" + (editOk ? "PASS" : "NOT_OBSERVED"));
  return "a04-session-usable";
}

function waitFor(id, seconds, probe) {
  const deadline = nowMs() + seconds * 1000;
  let last = null;
  while (nowMs() < deadline) {
    try {
      last = probe();
    } catch (err) {
      log("[" + id + "] probe error " + errFields(err));
      last = { done: false, detail: errFields(err) };
    }
    if (last && last.done) return last;
    sleepSec(0.5);
  }
  fail(id, new Error("timeout after " + seconds + "s"), last ? last.detail : "");
}

function stepDiagnose(pid) {
  const ax = attach(pid);
  const ui = enumerate("AX-06", ax.win);
  const buttons = stage("AX-07", () => scanButtons("AX-07", ui, true));
  const target = findByName(buttons, NAMES.chooseRoot);
  log("[AX-07] choose_root_candidate=" + (target ? describe(target.el, target.index) : "<none>"));
  return "diagnose-ok";
}

function stepChooseRoot(pid) {
  const ax = attach(pid);
  const appeared = waitUntil("AX-CHOOSE-ROOT", 8000, 100, () => {
    const fresh = attach(pid);
    const buttons = scanButtons("AX-07", fresh.win.entireContents(), false);
    return findByName(buttons, NAMES.chooseRoot) !== null;
  });
  if (appeared === null) fail("AX-07", new Error("choose-root button not found"));
  const target = stage("AX-07", () => {
    const buttons = scanButtons("AX-07", attach(pid).win.entireContents(), false);
    const b = findByName(buttons, NAMES.chooseRoot);
    if (b === null) throw new Error("choose-root button not found");
    log("[AX-07] candidate " + describe(b.el, b.index));
    return b;
  });
  if (!readEnabled("AX-08", target)) fail("AX-08", new Error("choose-root disabled"), describe(target.el, target.index));
  press("AX-09", target);
  waitFor("AX-10", 10, () => {
    const now = scanButtons("AX-10", ax.win.entireContents(), false);
    const open = findByName(now, NAMES.open);
    const cancel = findByName(now, NAMES.cancel);
    return { done: open !== null && cancel !== null, detail: "open=" + (open !== null) + " cancel=" + (cancel !== null) };
  });
  log("[AX-10] picker Open/Cancel visible PASS");
  return "choose-root";
}

// Go to Folder is looked up in sheets first (as in v2), then in the window.
function gotoContainers(ax) {
  const out = [];
  const sheets = safeScalar(() => ax.win.sheets().length);
  log("[GOTO-01] sheet_count=" + show(sheets));
  if (sheets.ok && typeof sheets.value === "number") {
    for (let s = 0; s < sheets.value; s++) out.push({ label: "sheet" + s, el: ax.win.sheets[s] });
  }
  out.push({ label: "window", el: ax.win });
  return out;
}

// macOS 26 Go to Folder has no Go button: a focused text field above a "Go to:"
// suggestion table. That field offers AXConfirm, which is scoped to the field.
function findGoto(ax) {
  for (const c of gotoContainers(ax)) {
    let ui = null;
    try {
      ui = c.el.entireContents();
    } catch (err) {
      log("[GOTO-02] container=" + c.label + " stale " + errFields(err));
      continue;
    }
    const buttons = scanButtons("GOTO-02", ui, false);
    const go = findByName(buttons, NAMES.go);
    if (go !== null) {
      const field = pickGotoField(ui);
      log("[GOTO-02] go_button container=" + c.label + " " + describe(go.el, go.index));
      if (field !== null) log("[GOTO-02] path_field index=" + field.index);
      return { container: c, ui: ui, go: go, field: field };
    }
    let header = false;
    let field = null;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => ui[i].value())) >= 0) header = true;
      if (isGotoPathRole(role, ui[i]) && safeScalar(() => ui[i].focused()).value === true) {
        field = { el: ui[i], index: i, name: null };
      }
    }
    if (header && field !== null) {
      log("[GOTO-02] goto_field container=" + c.label + " index=" + field.index + " (no Go button; AXConfirm)");
      return { container: c, ui: ui, go: null, field: field };
    }
  }
  return null;
}

function stepGotoVisible(pid) {
  const ax = attach(pid);
  const found = findGoto(ax);
  return found === null ? "goto-go-missing" : "goto-go-visible";
}

function confirmGotoFieldValue(element, path) {
  const matched = waitUntil("GTF_PASTE_VERIFY", RANGE_VERIFY_TIMEOUT_MS, RANGE_VERIFY_POLL_MS, () => {
    return str(() => element.value()) === path;
  });
  const actual = str(() => element.value());
  log("[GOTO-03] field value=" + JSON.stringify(actual));
  if (matched === null || actual !== path) throw new Error("Go to Folder field does not equal the fixture path");
  log("[GOTO-03] path field PASS");
}

function stepGotoGo(pid, path, options) {
  const ax = attach(pid);
  const found = findGoto(ax);
  let ready = null;
  if (found !== null && found.field !== null && fieldIsKeyInput(ax, pid, found.field.el)) {
    ready = { container: found.container, field: found.field };
    log("[GTF][OPEN] PASS");
    log("[GTF][FIELD] FOUND");
    log("[GTF][FOCUS] PASS");
    log("[GTF_FOCUS] START");
    log("[GTF_FOCUS] PASS elapsed_ms=0");
  } else {
    const focusOptions = options || {};
    if (found !== null && found.field !== null) {
      focusOptions.located = { container: found.container, field: found.field };
    }
    ready = waitGotoReady(ax, pid, focusOptions);
    if (ready === null) return "goto-focus-timeout";
  }
  let pasted = false;
  let token = null;
  try {
    log("[GTF][PASTE] START");
    token = pasteIntoFocused(ax, pid, ready.field.el, path, "[GTF][PASTE]");
    confirmGotoFieldValue(ready.field.el, path);
    pasted = true;
  } catch (err) {
    log("[GOTO-03][ERROR] " + errFields(err));
    if (!(options && options.soft)) fail("GOTO-03", err);
  } finally {
    if (token) restoreClipboard(token);
  }
  if (!pasted) return "goto-paste-mismatch";
  if (found !== null && found.go !== null) {
    if (!readEnabled("GOTO-04", found.go)) fail("GOTO-04", new Error("goto-go disabled"));
    press("GOTO-05", found.go);
    return "goto-go-pressed";
  }
  // AXConfirm on this field returns without navigating (observed on macOS 26.6),
  // so Return is sent only after the selected suggestion equals the fixture path
  // and the panel's Open button is disabled.
  let lastSuggestion = null;
  const suggestionReady = waitUntil("GOTO-04", 4000, 80, () => {
    const ui = ready.container.el.entireContents();
    let inTable = false;
    let inSelected = false;
    const parts = [];
    let open = null;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXButton" && NAMES.open.indexOf(str(() => ui[i].name())) >= 0) open = ui[i];
      if (role === "AXTable") { inTable = true; continue; }
      if (!inTable) continue;
      if (role === "AXRow") { inSelected = safeScalar(() => ui[i].selected()).value === true; continue; }
      if (role === "AXColumn") inTable = false;
      if (inSelected && role === "AXStaticText") parts.push(str(() => ui[i].value()));
    }
    const suggestion = "/" + parts.join("/");
    if (suggestion !== lastSuggestion) {
      log("[GOTO-04] selected_suggestion=" + JSON.stringify(suggestion));
      lastSuggestion = suggestion;
    }
    const openEnabled = open === null ? null : safeScalar(() => open.enabled()).value;
    return suggestion === path && openEnabled === false;
  });
  if (suggestionReady === null) {
    fail("GOTO-04", new Error("selected Go to suggestion does not equal the fixture path"));
  }
  log("[GOTO-04] suggestion PASS");
  stage("GOTO-05", () => {
    if (!appIsKey(ax, pid)) {
      const front = readFrontProcess(ax.se);
      log("[GOTO-05] reclaim front=" + JSON.stringify(front.name));
      try { ax.proc.frontmost = true; } catch (err) {
        log("[GOTO-05] reclaim error " + errFields(err));
      }
      const reclaimStart = nowMs();
      while (!appIsKey(ax, pid) && nowMs() - reclaimStart <= FRONTMOST_ATTEMPT_MS) {
        sleepSec(FRONTMOST_POLL_MS / 1000);
      }
    }
    try { ready.field.el.attributes.byName("AXFocused").value = true; } catch (err) {
      log("[GOTO-05] refocus error " + errFields(err));
    }
    if (!appIsKey(ax, pid)) throw new Error("GO_TO_FOLDER_FOCUS_TIMEOUT");
    const focused = fieldIsKeyInput(ax, pid, ready.field.el);
    log("[GOTO-05] return_target focused=" + focused + " suggestion_verified=YES");
    log("[GOTO-05] Return (key code 36) attempted");
    ax.se.keyCode(36);
    log("[GOTO-05] Return sent");
  }, () => describe(ready.field.el, ready.field.index));
  const basename = path.split("/").pop();
  waitFor("GOTO-06", 10, () => {
    const ui = safeScalar(() => ready.container.el.entireContents().length);
    let header = false;
    let where = null;
    const list = ax.win.entireContents();
    for (let i = 0; i < list.length; i++) {
      const role = str(() => list[i].role());
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => list[i].value())) >= 0) header = true;
      if (role === "AXPopUpButton" && NAMES.where.indexOf(str(() => list[i].name())) >= 0) where = str(() => list[i].value());
    }
    return { done: !header && where === basename, detail: "elements=" + show(ui) + " goto_open=" + header + " where=" + JSON.stringify(where) };
  });
  log("[GOTO-06] Go to Folder closed and location=" + JSON.stringify(basename) + " PASS");
  return "goto-go-pressed";
}

function stepOpen(pid, basename) {
  const ax = attach(pid);
  const ui = enumerate("OPEN-01", ax.win);
  const open = stage("OPEN-02", () => {
    let locationMatch = false;
    let browsers = 0;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXPopUpButton") {
        const name = str(() => ui[i].name());
        const value = str(() => ui[i].value());
        log("[OPEN-02] popup index=" + i + " name=" + JSON.stringify(name) + " value=" + JSON.stringify(value));
        if (NAMES.where.indexOf(name) >= 0 && value === basename) locationMatch = true;
      }
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => ui[i].value())) >= 0) {
        throw new Error("Go to Folder is still open");
      }
      if (role === "AXList" && str(() => ui[i].subrole()) === "AXCollectionList" ||
        role === "AXOutline" && str(() => ui[i].description()) !== "sidebar" ||
        role === "AXBrowser") {
        browsers += 1;
        const selected = safeScalar(() => ui[i].attributes.byName("AXSelectedChildren").value().length);
        const rows = safeScalar(() => ui[i].attributes.byName("AXSelectedRows").value().length);
        log("[OPEN-02] browser index=" + i + " role=" + role + " selected_children=" + show(selected) + " selected_rows=" + show(rows));
        const count = typeof selected.value === "number" ? selected.value : rows.value;
        if (typeof count !== "number") throw new Error("browser selection unreadable");
        if (count !== 0) throw new Error("an item inside the folder is selected; Open would choose it");
      }
    }
    if (!locationMatch) throw new Error("picker Where popup does not show " + basename);
    if (browsers === 0) throw new Error("file browser not found");
    log("[OPEN-02] picker location PASS where=" + JSON.stringify(basename) + " browsers=" + browsers + " selection=none");
    const b = findByName(scanButtons("OPEN-02", ui, false), NAMES.open);
    if (b === null) throw new Error("Open button not found");
    return b;
  });
  if (!readEnabled("OPEN-03", open)) fail("OPEN-03", new Error("Open disabled"), describe(open.el, open.index));
  press("OPEN-04", open);
  return "open-pressed";
}

function stepSelectRow(pid, relpath) {
  const ax = attach(pid);
  const ui = enumerate("ROW-01", ax.win);
  const target = stage("ROW-02", () => {
    let row = null;
    let rowIndex = -1;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXRow") { row = ui[i]; rowIndex = i; continue; }
      if (role === "AXColumn") row = null;
      if (row !== null && role === "AXStaticText" &&
        ((str(() => ui[i].name()) || str(() => ui[i].value())) === relpath)) {
        log("[ROW-02] row index=" + rowIndex + " text_index=" + i + " text=" + JSON.stringify(relpath));
        return { el: row, index: rowIndex, name: null };
      }
    }
    throw new Error("row for " + relpath + " not found");
  });
  stage("ROW-03", () => {
    log("[ROW-03] selected_before=" + show(safeScalar(() => target.el.selected())) +
      " actions=" + show(safeScalar(() => JSON.stringify(target.el.actions.name()))));
  });
  press("ROW-04", target);
  const basename = relpath.split("/").pop();
  waitFor("ROW-05", 10, () => {
    const sel = safeScalar(() => target.el.selected());
    const region = safeScalar(() => ax.win.entireContents().filter((e) => {
      try { return e.role() === "AXGroup" && e.name() === basename + " の波形プレビュー"; } catch (x) { return false; }
    }).length);
    return { done: sel.value === true && region.value === 1, detail: "selected=" + show(sel) + " waveform_region=" + show(region) };
  });
  log("[ROW-05] row selected and waveform region visible PASS");
  return "row-selected";
}

function stepPlayStop(pid) {
  const ax = attach(pid);
  const ui = enumerate("PLAY-01", ax.win);
  const buttons = scanButtons("PLAY-01", ui, false);
  const play = stage("PLAY-02", () => {
    const b = findByName(buttons, [NAMES.play]);
    if (b === null) throw new Error("play button not found");
    return b;
  });
  const stop = stage("PLAY-02", () => {
    const b = findByName(buttons, [NAMES.stop]);
    if (b === null) throw new Error("stop button not found");
    return b;
  });
  const alerts = () => safeScalar(() => ax.win.entireContents().filter((e) => {
    try { return e.subrole() === "AXApplicationAlert" || e.role() === "AXApplicationAlert"; } catch (x) { return false; }
  }).length);
  let playReacquired = false;
  const state = () => {
    const name = safeScalar(() => play.el.name());
    if (!name.ok && String(name.error).indexOf("-1728") !== -1 && !playReacquired) {
      playReacquired = true;
      log("[PLAY] stale reference discarded; reacquire once");
      const fresh = acquireAx(pid);
      ax.se = fresh.se;
      ax.proc = fresh.proc;
      ax.win = fresh.win;
      const buttons = scanButtons("PLAY-01", fresh.ui, false);
      const nextPlay = findByName(buttons, [NAMES.play]);
      const nextStop = findByName(buttons, [NAMES.stop]);
      if (nextPlay !== null) play.el = nextPlay.el;
      if (nextStop !== null) stop.el = nextStop.el;
      if (safeScalar(() => play.el.enabled()).value === true) press("PLAY-04", play);
    }
    return {
      playName: show(safeScalar(() => play.el.name())),
      playEnabled: safeScalar(() => play.el.enabled()).value,
      stopEnabled: safeScalar(() => stop.el.enabled()).value,
    };
  };
  stage("PLAY-03", () => {
    const s = state();
    log("[PLAY-03] before play=" + s.playName + " play_enabled=" + s.playEnabled + " stop_enabled=" + s.stopEnabled);
    if (s.playEnabled !== true || s.stopEnabled !== false) throw new Error("unexpected idle state");
  });
  press("PLAY-04", play);
  waitFor("PLAY-05", 15, () => {
    const s = state();
    const playing = s.playName === JSON.stringify(NAMES.play) && s.playEnabled === false && s.stopEnabled === true;
    return { done: playing, detail: "play=" + s.playName + " play_enabled=" + s.playEnabled + " stop_enabled=" + s.stopEnabled };
  });
  log("[PLAY-05] playing PASS (play disabled, stop enabled)");
  sleepSec(1.0);
  stage("PLAY-06", () => {
    const s = state();
    log("[PLAY-06] still playing play_enabled=" + s.playEnabled + " stop_enabled=" + s.stopEnabled);
    if (s.stopEnabled !== true) throw new Error("playback ended before stop");
  });
  press("STOP-01", stop);
  waitFor("STOP-02", 10, () => {
    const s = state();
    return { done: s.playEnabled === true && s.stopEnabled === false, detail: "play_enabled=" + s.playEnabled + " stop_enabled=" + s.stopEnabled };
  });
  log("[STOP-02] stopped PASS (play enabled, stop disabled)");
  stage("STOP-03", () => {
    const a = alerts();
    log("[STOP-03] alert_count=" + show(a));
    if (a.value !== 0) throw new Error("alert present after play/stop");
  });
  return "play-stop";
}

function stepPasteRange(pid, name, value) {
  if (!name || value === undefined || value === "") fail("RANGE_CLIPBOARD", new Error("paste-range needs a field name and value"));
  const ax = attach(pid);
  let ui = uiEntire(ax);
  log("[RANGE-01] element_count=" + ui.length);
  let field = findTextField(ui, name);
  const fieldDeadline = nowMs() + RANGE_FIELD_TIMEOUT_MS;
  while (field === null && nowMs() <= fieldDeadline) {
    sleepSec(RANGE_FIELD_POLL_MS / 1000);
    ui = uiEntire(ax);
    field = findTextField(ui, name);
  }
  if (field === null) {
    fail("RANGE-02", new Error("range field not found: " + name));
  }
  log("[RANGE][START] expected=" + JSON.stringify(String(value)) + " candidates=" + collectRangeFields(ui, name).length);
  log("[RANGE_CLIPBOARD] START");
  const candidates = collectRangeFields(ui, name);
  let focusedField = null;
  for (let c = 0; c < candidates.length && focusedField === null; c++) {
    const candidate = candidates[c];
    const startedFocus = nowMs();
    while (nowMs() - startedFocus <= 2000) {
      ensureFrontmost(ax, pid);
      try { ax.se.click(candidate.el); } catch (err) { /* AXFocused is the fallback */ }
      try { candidate.el.attributes.byName("AXFocused").value = true; } catch (err) { /* keep polling */ }
      if (fieldIsKeyInput(ax, pid, candidate.el)) {
        focusedField = candidate;
        log("[RANGE][FOCUS] PASS via=" + candidate.via + " index=" + candidate.index);
        break;
      }
      sleepSec(GTF_FOCUS_POLL_MS / 1000);
    }
  }
  if (focusedField === null) {
    log("[RANGE_CLIPBOARD] FAIL elapsed_ms=" + GTF_FOCUS_TIMEOUT_MS);
    fail("RANGE_CLIPBOARD", new Error("RANGE_FOCUS_TIMEOUT"));
  }
  const started = nowMs();
  let verified = null;
  let actual = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    ensureFrontmost(ax, pid);
    try { ax.se.click(focusedField.el); } catch (err) { /* AXFocused is the fallback */ }
    try { focusedField.el.attributes.byName("AXFocused").value = true; } catch (err) { /* keep the keystroke guard */ }
    if (!fieldIsKeyInput(ax, pid, focusedField.el)) {
      log("[RANGE][PASTE] focus lost before attempt=" + attempt);
      continue;
    }
    let token = null;
    try {
      token = withoutExit(() => {
        log("[RANGE][PASTE] START attempt=" + attempt);
        const held = pasteIntoFocused(ax, pid, focusedField.el, value, "[RANGE][PASTE]");
        log("[RANGE][PASTE] PASS attempt=" + attempt);
        return held;
      });
      verified = waitUntil("RANGE_VERIFY", RANGE_VERIFY_TIMEOUT_MS, RANGE_VERIFY_POLL_MS, () => {
        return str(() => focusedField.el.value()) === String(value);
      });
      actual = str(() => focusedField.el.value());
    } catch (err) {
      log("[RANGE][PASTE] attempt=" + attempt + " " + errFields(err));
      actual = str(() => focusedField.el.value());
      verified = null;
    } finally {
      restoreClipboard(token);
    }
    log("[RANGE][VERIFY] attempt=" + attempt + " actual=" + JSON.stringify(actual));
    if (verified !== null && actual === String(value)) break;
  }
  if (verified === null || actual !== String(value)) {
    log("[RANGE_CLIPBOARD] FAIL elapsed_ms=" + (nowMs() - started));
    fail("RANGE_CLIPBOARD", new Error("range value did not match after paste"));
  }
  log("[RANGE][RESULT] PASS");
  log("[RANGE_CLIPBOARD] PASS value=" + value + " elapsed_ms=" + (nowMs() - started));
  return "range-pasted";
}

function previouslyEnabledAre(before, now, expected) {
  if (!before || !now || before.length !== now.length) return false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === true && now[i] !== expected) return false;
  }
  return true;
}

function stepExportLock(pid) {
  const ax = attach(pid);
  const ui = enumerate("EXPORT-01", ax.win);
  let confirm = null;
  const selects = [];
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXButton") continue;
    const name = str(() => ui[i].name());
    if (name === NAMES.exportConfirm && confirm === null) confirm = { el: ui[i], index: i, name: name };
    if (name === NAMES.markerSelect) selects.push({ el: ui[i], index: i, name: name });
  }
  if (confirm === null || selects.length === 0) {
    fail("EXPORT_MARKER_LOCK", new Error("export review is not open"));
  }
  const before = selects.map((b) => safeScalar(() => b.el.enabled()).value);
  log("[EXPORT_LOCK][PRE] " + before.map((v) => v === true ? "enabled" : "disabled").join(","));
  if (before.indexOf(true) < 0) fail("EXPORT_MARKER_LOCK", new Error("marker selector was not enabled before export"));
  log("[EXPORT_MARKER_LOCK] START");
  log("[EXPORT_LOCK][START]");
  press("EXPORT-02", confirm);
  const started = nowMs();
  log("[EXPORT_MARKER_LOCK] WAIT");
  let disabledAt = null;
  let postEnabled = false;
  while (nowMs() - started <= EXPORT_LOCK_TIMEOUT_MS) {
    const now = selects.map((b) => safeScalar(() => b.el.enabled()).value);
    if (disabledAt === null && previouslyEnabledAre(before, now, false)) {
      disabledAt = nowMs() - started;
      log("[EXPORT_LOCK][POLL] disabled detected after " + disabledAt + "ms");
    }
    if (disabledAt !== null && previouslyEnabledAre(before, now, true)) {
      postEnabled = true;
      break;
    }
    const remain = EXPORT_LOCK_TIMEOUT_MS - (nowMs() - started);
    if (remain <= 0) break;
    sleepSec(Math.min(EXPORT_LOCK_POLL_MS, remain) / 1000);
  }
  const elapsed = nowMs() - started;
  if (disabledAt === null) {
    log("[EXPORT_MARKER_LOCK] FAIL disabled_seen=false elapsed_ms=" + elapsed);
    fail("EXPORT_MARKER_LOCK", new Error("EXPORT_MARKER_LOCK_NOT_OBSERVED"));
  }
  if (!postEnabled) {
    log("[EXPORT_MARKER_LOCK] FAIL disabled_seen=true elapsed_ms=" + elapsed);
    fail("EXPORT_MARKER_LOCK", new Error("marker selector did not return to enabled"));
  }
  log("[EXPORT_LOCK][POST] enabled");
  log("[EXPORT_MARKER_LOCK] PASS disabled_seen=true elapsed_ms=" + disabledAt);
  return "export-lock-observed";
}

function run(argv) {
  const step = String(argv[0] || "");
  const pid = Number(argv[1]);
  const arg = argv.length > 2 ? String(argv[2]) : "";
  const arg2 = argv.length > 3 ? String(argv[3]) : "";
  if (!isFinite(pid) || pid <= 0) fail("AX-00", new Error("bad pid"));
  log("[AX-00] step=" + step + " pid=" + pid + (arg ? " arg=" + JSON.stringify(arg) : ""));
  switch (step) {
    case "diagnose": return stepDiagnose(pid);
    case "choose-root":
      if (arg) return stepRegisterRoot(pid, arg);
      return stepChooseRoot(pid);
    case "register-root": return stepRegisterRoot(pid, arg);
    case "goto-visible": return stepGotoVisible(pid);
    case "goto-go": return stepGotoGo(pid, arg);
    case "open": return stepOpen(pid, arg);
    case "select-row": return stepSelectRow(pid, arg);
    case "play-stop": return stepPlayStop(pid);
    case "paste-range": return stepPasteRange(pid, arg, arg2);
    case "export-lock": return stepExportLock(pid);
    case "slice-prepare-workspace": return stepSlicePrepareWorkspace(pid);
    case "slice-tab": return stepSliceTab(pid);
    case "slice-expand": return stepSliceExpand(pid);
    case "slice-detect": return stepSliceDetect(pid);
    case "slice-wait-apply": return stepSliceWaitApply(pid);
    case "slice-apply": return stepSliceApply(pid);
    case "slice-wait-draft": return stepSliceWaitDraft(pid);
    case "a04-close-expanded": return stepA04CloseExpanded(pid);
    case "a04-range-input-check": return stepA04RangeInputCheck(pid);
    case "a04-paste-range-b": return stepA04PasteRangeB(pid, arg, arg2);
    case "a04-copy-pending": return stepA04CopyPending(pid);
    case "a04-verify-pending": return stepA04VerifyPending(pid, arg, arg2);
    case "a04-reanalyze-start": return stepA04ReanalyzeStart(pid);
    case "a04-reanalyze-cancel": return stepA04ReanalyzeCancel(pid);
    case "a04-reanalyze-and-cancel": return stepA04ReanalyzeAndCancel(pid);
    case "a04-session-usable": return stepA04SessionUsable(pid);
    case "ax-ready": return stepAxReady(pid);
    default: fail("AX-00", new Error("unknown step " + step));
  }
}

if (typeof ObjC === "undefined" && typeof globalThis !== "undefined") {
  globalThis.NativeAcceptanceAxSteps = {
    setRuntime: setRuntime,
    resetRuntime: resetRuntime,
    stepGotoGo: stepGotoGo,
    waitGotoReady: waitGotoReady,
    stepRegisterRoot: stepRegisterRoot,
    sendGotoFolderShortcut: sendGotoFolderShortcut,
    stepA04CloseExpanded: stepA04CloseExpanded,
    stepA04RangeInputCheck: stepA04RangeInputCheck,
    stepA04CopyPending: stepA04CopyPending,
    stepA04VerifyPending: stepA04VerifyPending,
    previewTabActive: previewTabActive,
    sliceTabActive: sliceTabActive,
    activateInspectorTab: activateInspectorTab,
    ensureFrontmost: ensureFrontmost,
    acquireAx: acquireAx,
    findRangeField: findRangeField,
    catalogRangeFieldsReady: catalogRangeFieldsReady,
    catalogWorkspaceVisible: catalogWorkspaceVisible,
    stepA04ReanalyzeStart: stepA04ReanalyzeStart,
    stepA04ReanalyzeCancel: stepA04ReanalyzeCancel,
    stepA04ReanalyzeAndCancel: stepA04ReanalyzeAndCancel,
    detectReanalysisActive: detectReanalysisActive,
    findExactCancelButton: findExactCancelButton,
    waitReanalysisActiveState: waitReanalysisActiveState,
    observeAndPressCancel: observeAndPressCancel,
    refreshCancelTree: refreshCancelTree,
    mergeAxSession: mergeAxSession,
    stepExportLock: stepExportLock,
    previouslyEnabledAre: previouslyEnabledAre,
    expandedSliceCloseVisible: expandedSliceCloseVisible,
    NAMES: NAMES,
    GTF_FOCUS_TIMEOUT_MS: GTF_FOCUS_TIMEOUT_MS,
    EXPORT_LOCK_TIMEOUT_MS: EXPORT_LOCK_TIMEOUT_MS,
    CANCEL_POLL_MS: CANCEL_POLL_MS,
  };
}
