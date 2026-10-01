// Staged JXA steps for native-acceptance-ax-full-v3.sh.
// usage: osascript -l JavaScript ax-choose-root-stages.js <step> <pid> [arg]
// steps: diagnose | choose-root | goto-visible | goto-go <path> | open <basename>
//        | select-row <relpath> | play-stop
//        | paste-range <fieldName> <value> | export-lock | focus-timeout-smoke
// Range fields are filled by clipboard paste. Go to Folder waits until its
// path field is focused, then pastes. Neither path assigns AXValue.
// Every stage logs to stderr as [AX-NN] / [<STEP>-NN]. Errors exit 1 with the
// failing stage, exception and element fields. No retries.
//
// System Events has no "performAction" command; calling element.performAction("AXPress")
// fails with -1700. The dictionary command is perform(action):
// element.actions.byName("AXPress").perform().
ObjC.import("stdlib");

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
};

const GTF_FOCUS_POLL_MS = 80;
const GTF_FOCUS_TIMEOUT_MS = 4000;
const RANGE_VERIFY_POLL_MS = 50;
const RANGE_VERIFY_TIMEOUT_MS = 2000;
const EXPORT_LOCK_POLL_MS = 30;
const EXPORT_LOCK_TIMEOUT_MS = 8000;

function log(line) {
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
  $.exit(1);
}

function stage(id, fn, extraOnError) {
  try {
    return fn();
  } catch (err) {
    fail(id, err, extraOnError ? extraOnError() : "");
  }
}

function attach(pid) {
  const se = stage("AX-01", () => {
    const app = Application("System Events");
    log("[AX-01] System Events connected");
    return app;
  });
  const proc = stage("AX-02", () => {
    const all = se.processes();
    let found = null;
    let hits = 0;
    let readErrors = 0;
    for (let i = 0; i < all.length; i++) {
      const u = safeScalar(() => all[i].unixId());
      if (!u.ok) { readErrors += 1; continue; }
      if (u.value === pid) { found = all[i]; hits += 1; }
    }
    if (hits !== 1 || found === null) throw new Error("ax-process-count=" + hits);
    log("[AX-02] process lookup PASS pid=" + pid + " processes=" + all.length + " unixId_read_errors=" + readErrors);
    return found;
  });
  stage("AX-03", () => {
    log("[AX-03] name=" + show(safeScalar(() => proc.name())) +
      " frontmost_before=" + show(safeScalar(() => proc.frontmost())));
    proc.frontmost = true;
    delay(0.6);
    const fm = safeScalar(() => proc.frontmost());
    log("[AX-03] frontmost=" + show(fm));
    if (fm.value !== true) throw new Error("process is not frontmost");
  });
  const win = stage("AX-04", () => {
    const wins = proc.windows();
    log("[AX-04] window_count=" + wins.length);
    if (wins.length !== 1) throw new Error("expected exactly one masterocta window");
    return wins[0];
  });
  stage("AX-05", () => {
    const name = safeScalar(() => win.name());
    log("[AX-05] target_window name=" + show(name) + " subrole=" + show(safeScalar(() => win.subrole())));
    if (name.value !== "Masta-Octa") throw new Error("unexpected window name");
    log("[AX-05] target_window PASS");
  });
  return { se: se, proc: proc, win: win };
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
  const started = Date.now();
  log("[" + id + "] START");
  let announced = false;
  while (Date.now() - started <= timeoutMs) {
    let hit = false;
    try { hit = probe() === true; } catch (err) { hit = false; }
    if (hit) {
      const elapsed = Date.now() - started;
      log("[" + id + "] PASS elapsed_ms=" + elapsed);
      return elapsed;
    }
    if (!announced) {
      log("[" + id + "] WAIT");
      announced = true;
    }
    const remain = timeoutMs - (Date.now() - started);
    if (remain <= 0) break;
    delay(Math.min(intervalMs, remain) / 1000);
  }
  log("[" + id + "] FAIL elapsed_ms=" + (Date.now() - started));
  return null;
}

function clipboardToken(value) {
  const app = Application.currentApplication();
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

function pasteIntoFocused(ax, pid, element, value, logTag) {
  const front = safeScalar(() => ax.se.processes.whose({ frontmost: true })[0].unixId());
  const focused = safeScalar(() => element.focused());
  log(logTag + " frontmost_pid=" + show(front) + " focused=" + show(focused));
  if (front.value !== pid || focused.value !== true) {
    throw new Error("paste target is not the key input");
  }
  log(logTag + " clipboard_value=" + JSON.stringify(String(value)));
  const token = clipboardToken(value);
  try {
    delay(0.15);
    ax.se.keystroke("a", { using: ["command down"] });
    delay(0.15);
    ax.se.keystroke("v", { using: ["command down"] });
    delay(0.25);
  } catch (err) {
    restoreClipboard(token);
    throw err;
  }
  return token;
}

function fieldIsKeyInput(ax, pid, element) {
  const front = safeScalar(() => ax.se.processes.whose({ frontmost: true })[0].unixId());
  const focused = safeScalar(() => element.focused());
  return front.value === pid && focused.value === true;
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

function locateGotoField(ax) {
  const containers = gotoContainerList(ax);
  for (let c = 0; c < containers.length; c++) {
    let ui = null;
    try { ui = containers[c].el.entireContents(); } catch (err) { continue; }
    let header = false;
    let field = null;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => ui[i].value())) >= 0) header = true;
      if (role !== "AXTextField" || str(() => ui[i].subrole()) === "AXSearchField") continue;
      const desc = str(() => ui[i].description());
      const focused = safeScalar(() => ui[i].focused()).value === true;
      if (focused || field === null && (desc === "text field" || desc === null)) {
        field = { el: ui[i], index: i, name: null };
      }
    }
    if (header && field !== null) return { container: containers[c], field: field };
  }
  return null;
}

function waitGotoReady(ax, pid) {
  const started = Date.now();
  log("[GTF_FOCUS] START");
  let located = null;
  let openedLogged = false;
  let announced = false;
  while (Date.now() - started <= GTF_FOCUS_TIMEOUT_MS) {
    if (located === null) located = locateGotoField(ax);
    if (located !== null) {
      if (!openedLogged) {
        log("[GTF][OPEN] PASS");
        log("[GTF][FIELD] FOUND");
        openedLogged = true;
      }
      if (fieldIsKeyInput(ax, pid, located.field.el)) {
        const elapsed = Date.now() - started;
        log("[GTF][FOCUS] PASS");
        log("[GTF_FOCUS] PASS elapsed_ms=" + elapsed);
        return located;
      }
    }
    if (!announced) {
      log("[GTF][FOCUS] waiting...");
      log("[GTF_FOCUS] WAIT");
      announced = true;
    }
    const remain = GTF_FOCUS_TIMEOUT_MS - (Date.now() - started);
    if (remain <= 0) break;
    delay(Math.min(GTF_FOCUS_POLL_MS, remain) / 1000);
  }
  log("[GTF_FOCUS] FAIL elapsed_ms=" + (Date.now() - started));
  fail("GTF_FOCUS", new Error("GO_TO_FOLDER_FOCUS_TIMEOUT"));
}

function findTextField(ui, name) {
  for (let i = 0; i < ui.length; i++) {
    if (str(() => ui[i].role()) !== "AXTextField") continue;
    const n = str(() => ui[i].name()) || str(() => ui[i].description());
    if (n === name) return { el: ui[i], index: i, name: n };
  }
  return null;
}

function waitFor(id, seconds, probe) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    last = probe();
    if (last.done) return last;
    delay(0.5);
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
  const ui = enumerate("AX-06", ax.win);
  const target = stage("AX-07", () => {
    const buttons = scanButtons("AX-07", ui, false);
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
    const ui = stage("GOTO-02", () => c.el.entireContents());
    const buttons = scanButtons("GOTO-02", ui, false);
    const go = findByName(buttons, NAMES.go);
    if (go !== null) {
      log("[GOTO-02] go_button container=" + c.label + " " + describe(go.el, go.index));
      return { container: c, ui: ui, go: go, field: null };
    }
    let header = false;
    let field = null;
    for (let i = 0; i < ui.length; i++) {
      const role = str(() => ui[i].role());
      if (role === "AXStaticText" && NAMES.gotoHeader.indexOf(str(() => ui[i].value())) >= 0) header = true;
      if (role === "AXTextField" && str(() => ui[i].subrole()) !== "AXSearchField" &&
        safeScalar(() => ui[i].focused()).value === true) {
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

function stepGotoGo(pid, path) {
  const ax = attach(pid);
  const found = findGoto(ax);
  if (found !== null && found.go !== null && found.field === null) {
    stage("GOTO-03", () => {
      const values = [];
      for (let i = 0; i < found.ui.length; i++) {
        const role = str(() => found.ui[i].role());
        if (role !== "AXTextField" && role !== "AXComboBox") continue;
        const value = str(() => found.ui[i].value());
        values.push(value);
        log("[GOTO-03] field index=" + i + " role=" + role + " value=" + JSON.stringify(value));
      }
      if (values.indexOf(path) < 0) throw new Error("no Go to Folder field equals the fixture path");
      log("[GOTO-03] path field PASS");
    });
    if (!readEnabled("GOTO-04", found.go)) fail("GOTO-04", new Error("goto-go disabled"));
    press("GOTO-05", found.go);
    return "goto-go-pressed";
  }
  let ready = null;
  if (found !== null && found.field !== null && fieldIsKeyInput(ax, pid, found.field.el)) {
    ready = { container: found.container, field: found.field };
    log("[GTF][OPEN] PASS");
    log("[GTF][FIELD] FOUND");
    log("[GTF][FOCUS] PASS");
    log("[GTF_FOCUS] START");
    log("[GTF_FOCUS] PASS elapsed_ms=0");
  } else {
    ready = waitGotoReady(ax, pid);
  }
  stage("GOTO-03", () => {
    log("[GTF][PASTE] START");
    const token = pasteIntoFocused(ax, pid, ready.field.el, path, "[GTF][PASTE]");
    try {
      confirmGotoFieldValue(ready.field.el, path);
    } finally {
      restoreClipboard(token);
    }
  });
  // AXConfirm on this field returns without navigating (observed on macOS 26.6),
  // so Return is sent only after the selected suggestion equals the fixture path
  // and the panel's Open button is disabled.
  stage("GOTO-04", () => {
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
    log("[GOTO-04] selected_suggestion=" + JSON.stringify(suggestion));
    if (suggestion !== path) throw new Error("selected Go to suggestion does not equal the fixture path");
    const openEnabled = open === null ? null : safeScalar(() => open.enabled()).value;
    log("[GOTO-04] picker_open_enabled=" + JSON.stringify(openEnabled));
    if (openEnabled !== false) throw new Error("picker Open is not disabled while Go to Folder is open");
    log("[GOTO-04] suggestion PASS");
  });
  stage("GOTO-05", () => {
    const stillFocused = waitUntil("GTF_RETURN_FOCUS", GTF_FOCUS_TIMEOUT_MS, GTF_FOCUS_POLL_MS, () => {
      return fieldIsKeyInput(ax, pid, ready.field.el);
    });
    if (stillFocused === null) throw new Error("GO_TO_FOLDER_FOCUS_TIMEOUT");
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
      if (row !== null && role === "AXStaticText" && str(() => ui[i].name()) === relpath) {
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
  const state = () => ({
    playName: show(safeScalar(() => play.el.name())),
    playEnabled: safeScalar(() => play.el.enabled()).value,
    stopEnabled: safeScalar(() => stop.el.enabled()).value,
  });
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
  delay(1.0);
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
  const ui = enumerate("RANGE-01", ax.win);
  const field = stage("RANGE-02", () => {
    const hit = findTextField(ui, name);
    if (hit === null) throw new Error("range field not found: " + name);
    return hit;
  });
  log("[RANGE][START] expected=" + JSON.stringify(String(value)));
  log("[RANGE_CLIPBOARD] START");
  stage("RANGE-03", () => {
    field.el.attributes.byName("AXFocused").value = true;
  });
  const focused = waitUntil("RANGE_FOCUS", GTF_FOCUS_TIMEOUT_MS, GTF_FOCUS_POLL_MS, () => {
    return fieldIsKeyInput(ax, pid, field.el);
  });
  if (focused === null) {
    log("[RANGE_CLIPBOARD] FAIL elapsed_ms=" + GTF_FOCUS_TIMEOUT_MS);
    fail("RANGE_CLIPBOARD", new Error("RANGE_FOCUS_TIMEOUT"));
  }
  log("[RANGE][FOCUS] PASS");
  const started = Date.now();
  const token = stage("RANGE-04", () => {
    log("[RANGE][PASTE] START");
    const held = pasteIntoFocused(ax, pid, field.el, value, "[RANGE][PASTE]");
    log("[RANGE][PASTE] PASS");
    return held;
  });
  let verified = null;
  let actual = null;
  try {
    verified = waitUntil("RANGE_VERIFY", RANGE_VERIFY_TIMEOUT_MS, RANGE_VERIFY_POLL_MS, () => {
      return str(() => field.el.value()) === String(value);
    });
    actual = str(() => field.el.value());
  } finally {
    restoreClipboard(token);
  }
  log("[RANGE][VERIFY] actual=" + JSON.stringify(actual));
  if (verified === null || actual !== String(value)) {
    log("[RANGE_CLIPBOARD] FAIL elapsed_ms=" + (Date.now() - started));
    fail("RANGE_CLIPBOARD", new Error("range value did not match after paste"));
  }
  log("[RANGE][RESULT] PASS");
  log("[RANGE_CLIPBOARD] PASS value=" + value + " elapsed_ms=" + (Date.now() - started));
  return "range-pasted";
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
  const started = Date.now();
  log("[EXPORT_MARKER_LOCK] WAIT");
  let disabledAt = null;
  let postEnabled = false;
  while (Date.now() - started <= EXPORT_LOCK_TIMEOUT_MS) {
    const now = selects.map((b) => safeScalar(() => b.el.enabled()).value);
    if (disabledAt === null && now.some((v, i) => before[i] === true && v === false)) {
      disabledAt = Date.now() - started;
      log("[EXPORT_LOCK][POLL] disabled detected after " + disabledAt + "ms");
    }
    if (disabledAt !== null && now.every((v, i) => before[i] !== true || v === true)) {
      postEnabled = true;
      break;
    }
    const remain = EXPORT_LOCK_TIMEOUT_MS - (Date.now() - started);
    if (remain <= 0) break;
    delay(Math.min(EXPORT_LOCK_POLL_MS, remain) / 1000);
  }
  const elapsed = Date.now() - started;
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

function stepFocusTimeoutSmoke() {
  log("[GTF][OPEN] PASS");
  log("[GTF][FIELD] FOUND");
  const hit = waitUntil("GTF_FOCUS", 400, GTF_FOCUS_POLL_MS, () => false);
  if (hit !== null) fail("GTF_FOCUS", new Error("focus timeout smoke observed a focus"));
  fail("GTF_FOCUS", new Error("GO_TO_FOLDER_FOCUS_TIMEOUT"));
}

function run(argv) {
  const step = String(argv[0] || "");
  if (step === "focus-timeout-smoke") return stepFocusTimeoutSmoke();
  const pid = Number(argv[1]);
  const arg = argv.length > 2 ? String(argv[2]) : "";
  const arg2 = argv.length > 3 ? String(argv[3]) : "";
  if (!isFinite(pid) || pid <= 0) fail("AX-00", new Error("bad pid"));
  log("[AX-00] step=" + step + " pid=" + pid + (arg ? " arg=" + JSON.stringify(arg) : ""));
  switch (step) {
    case "diagnose": return stepDiagnose(pid);
    case "choose-root": return stepChooseRoot(pid);
    case "goto-visible": return stepGotoVisible(pid);
    case "goto-go": return stepGotoGo(pid, arg);
    case "open": return stepOpen(pid, arg);
    case "select-row": return stepSelectRow(pid, arg);
    case "play-stop": return stepPlayStop(pid);
    case "paste-range": return stepPasteRange(pid, arg, arg2);
    case "export-lock": return stepExportLock(pid);
    default: fail("AX-00", new Error("unknown step " + step));
  }
}
