# MO-M6-06 Operations Drawer Native write smoke

- Work ID: `MO-M6-06-DRAWER-SPEC-AND-NATIVE-1`
- Spec: [`../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md)
- Shared harness: [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](./MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) (fixture generator, isolated `HOME`, launcher)
- **Strict operator bar: `STOP`.** §6 is the earlier dirty-tree session. §7 is the clean `4fbae7bb` re-run. §8 is a console-driven diagnostic on `d7754d30` (`isTrusted=false`). None of §6–§8 is a strict manual in-flight **PASS**. §9 is the later composite score under `MO-M6-06-N7-ACCEPTANCE-POLICY-1`.

Mock IPC / Vitest / Playwright success is **not** Native acceptance.

---

## 1. Isolation (mandatory)

| Item | Rule |
| --- | --- |
| Media | Synthetic Set only. Never original Octatrack cards, never operator music folders, never `$HOME` production catalog |
| Fixture root | Managed temp from `generate-ui-workspace-native-fixture.mjs` (no CLI output path) |
| App `HOME` | Isolated directory from the prepare script |
| WAV bytes | Not committed. Before launch, record the source fixture inventory. After the session it must match, including `ops_rename_src.wav`, `project.work`, and `RANGE.wav` |
| Writes | Disposable managed clone under app data / clone runtime. Do **not** Apply a rename |

---

## 2. Where it must be run

| Layer | Where | This PR |
| --- | --- | --- |
| Fixture generator + RANGE SHA | Any OS with Node 22 + repo checkout | **RUN** via `pnpm run test:ui-native-fixture` |
| Prepare script contracts | Same | **RUN** (`scripts/prepare-m6-06-operations-drawer-native-smoke.test.mjs`) |
| Frontend close-without-cancel | Vitest | **RUN** |
| Drawer write path (mock IPC) | Playwright `e2e/operations-drawer-prepare-close.spec.ts` + existing `e2e/rename-prepare.spec.ts` | **RUN** in CI E2E |
| **Native Tauri WebView + real IPC write** | **macOS** with GTK-free Tauri shell: `scripts/launch-native-acceptance-tauri.sh` after the prepare script | **STOP** (2026-10-26 macOS sessions, §6 and §7). A new prepare still prints `native_write_status=NOT_RUN` until a session is executed |

Linux Cloud Agents may compile Tauri with WebKitGTK, but this smoke is defined as the **macOS native launcher + isolated catalog `lsof`**, same class as `MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`. Do not record a Linux `tauri:dev` click-through as this row.

---

## 3. Prepare (automated)

From a **current** checkout (not a historical worktree):

```bash
bash scripts/prepare-m6-06-operations-drawer-native-smoke.sh
```

Prints `isolated_home`, `fixture_root`, and the operator steps. Then:

```bash
REAL_HOME="${REAL_HOME:-$HOME}" \
  ./scripts/launch-native-acceptance-tauri.sh "<isolated_home>" "$(pwd)"
```

Register folder (read-only first): the printed `fixture_root` (synthetic `SET/`).

Target sample after clone: `SET/AUDIO/ops_rename_src.wav` (generator role `opsRename`).

---

## 4. Operator matrix (Native)

Clone-first, then one Drawer write (rename **prepare**, not Apply).

| Step | Action | Pass |
| --- | --- | --- |
| N0 | Isolated catalog file exists under `isolated_home` | file present |
| N1 | Register synthetic `fixture_root` | Library lists SET / `ops_rename_src.wav` |
| N2 | Top bar or Sources **Clone operator** → Operations Drawer (`role=dialog`) | Drawer title クローン操作 / Clone operator |
| N3 | Record source evidence → **Create managed clone** | Source root closed; session on clone; VERIFIED (or equivalent clone badge) |
| N4 | Enable Edit on the clone | context edit-enabled |
| N5 | Select `ops_rename_src.wav` → Inspector **リネーム** | Rename Drawer; plan review form |
| N6 | New name (example `ops_rename_dst.wav`) → Review Rename → Approve & Prepare | PREPARED; copy that **no Octatrack media Apply** occurred |
| N7 | Esc or × | Close does not Apply. While rename prepare is still pending, status **操作を開く** does not reopen the Drawer. After the result is PREPARED, **操作を開く** reopens it and still shows PREPARED |
| N8 | Source fixture unchanged | Compare the prepare-script inventory, then re-check RANGE.wav. Both are required |

Do not run Apply / Continue-to-media. Do not point the picker at a real card.

Before launch the prepare script writes `<isolated_home>/source-inventory.json`: every relative path under `fixture_root`, with kind, byte size, and SHA-256 for regular files. Symlinks are recorded and not followed. After the session:

```bash
node scripts/verify-ui-workspace-source-inventory.mjs --expect "<isolated_home>/source-inventory.json" "<fixture_root>"
node scripts/verify-ui-workspace-range-sha.mjs "<fixture_root>/SET/AUDIO/RANGE.wav"
```

A clone that moves, deletes, or modifies `ops_rename_src.wav`, `project.work`, or any other source file fails N8 even when RANGE.wav alone still matches.

**PASS criterion:** N0–N8 are all PASS, and the record template below is PASS on every safety field: `lsof catalog` PASS, N3 PASS, N6 PASS, `Apply invoked` **NO**, source inventory PASS, RANGE SHA PASS. N3 or N6 alone is insufficient. Any FAIL, or Apply invoked, makes the overall result **STOP**, not PASS.

---

## 5. Record template (fill only on a real Native host)

```text
Native run:            NOT_RUN | PASS | STOP
Host OS:
Product SHA:
Isolated HOME:         (sanitized /tmp/... only)
Fixture root:          (sanitized)
Catalog path observed:
lsof catalog:          PASS | FAIL | NOT_RUN
N0–N8:                 PASS | FAIL | NOT_RUN
N3 managed clone:      PASS | FAIL | NOT_RUN
N6 rename prepare:     PASS | FAIL | NOT_RUN
Apply invoked:         NO (required)
Source inventory:      PASS | FAIL | NOT_RUN
RANGE SHA after:       PASS | FAIL | NOT_RUN
```

`Native run: PASS` requires every N0–N8 step PASS and every safety field above PASS, with `Apply invoked: NO`. Any other combination is **STOP** (or remains **NOT_RUN** when the macOS session was not executed). Until a macOS operator fills this block on a named SHA, keep **`NOT_RUN`**.

---

## 6. Session record (2026-10-26)

Filled on the macOS host that ran the launcher. This is **not** `Native run: PASS`. M6 stays **IN_PROGRESS**.

```text
Native run:            STOP
Host OS:               macOS 26.6.2 (25G83)
Product SHA:           ad13ba9b9c8c2e5ee9b9733322e06700231f1880
                       plus uncommitted src-tauri/src/root_registry.rs
                       (statfs mount point before diskutil info)
                       and src-tauri/Cargo.toml default-run = masterocta
Isolated HOME:         /private/tmp/masterocta-m6-06-native-ad13ba9b-20261026T073752Z
Fixture root:          prepare-script managed temp (mo-ui-native-set-*)
Catalog path observed: <isolated HOME>/Library/Application Support/MasterOCTa/catalog.sqlite3
lsof catalog:          PASS
N0–N8:                 N0–N6 PASS; N7 close and post-PREPARED reopen PASS;
                       N7 in-flight non-reopen not observed; N8 PASS
N3 managed clone:      PASS
N6 rename prepare:     PASS (SET/AUDIO/ops_rename_src.wav → ops_rename_dst.wav)
Apply invoked:         NO
Source inventory:      PASS (entries=12)
RANGE SHA after:       PASS (43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1)
```

Journal status after N6 was `prepared`. The clone file remained `ops_rename_src.wav`. The destination name existed only under isolated write-state. Source inventory still listed `ops_rename_src.wav` and did not list `ops_rename_dst.wav`.

N7 in-flight was not sampled: Approve & Prepare finished before Escape, so the status-bar control was not clicked while the request was still pending. That clause is required for **PASS**. Do not treat this record as M6-06 **COMPLETE**.

macOS 26.6.2 `diskutil info` accepts a mount point, disk identifier, device node, or UUID. Passing the registered subdirectory returns no Volume UUID, so clone creation failed closed with `UNSTABLE_DEVICE_IDENTITY` until `root_registry` resolved the `statfs` mount point. That fix is not in `ad13ba9b`. A **PASS** record needs a commit that contains it, then a session whose N7 in-flight check is observed.

---

## 7. Session record (2026-10-26, clean `main`)

Filled on the macOS host that ran a new isolated HOME and a new fixture. This does **not** replace §6. It is **not** `Native run: PASS`. M6 stays **IN_PROGRESS**.

```text
Native run:            STOP
Host OS:               macOS 26.6.2 (25G83)
Product SHA:           4fbae7bbc21db79f9687ec7c0b6326702f48a0d4
                       clean worktree; no uncommitted product changes
Isolated HOME:         /private/tmp/masterocta-m6-06-native-4fbae7bbc21d-20261026T095036Z
Fixture root:          prepare-script managed temp (mo-ui-native-set-Jwif45)
Catalog path observed: <isolated HOME>/Library/Application Support/MasterOCTa/catalog.sqlite3
lsof catalog:          PASS (masterocta pid 72221)
N0–N8:                 N0–N6 PASS; N7 post-PREPARED close and status-bar reopen PASS;
                       N7 in-flight non-reopen NOT_OBSERVED; N8 PASS
N3 managed clone:      PASS (VERIFIED CLONE)
N6 rename prepare:     PASS (SET/AUDIO/ops_rename_src.wav → ops_rename_dst.wav)
Apply invoked:         NO
Continue invoked:      NO
Source inventory:      PASS (entries=12)
RANGE SHA after:       PASS (43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1)
```

Journal status after N6 was `prepared`. The clone file remained `ops_rename_src.wav`. The source fixture still listed only `ops_rename_src.wav`. The production catalog directory mtime stayed 2026-09-17.

N7 after PREPARED: Escape closed the Drawer (`role=dialog` count 0). The status-bar control 「操作ドロワーで詳細を確認」 reopened 「リネーム」 with PREPARED and `ops_rename_dst.wav`. CONTINUE PREPARED RENAME was visible and was not clicked.

N7 in-flight was **NOT_OBSERVED**. Approve & Prepare finished before a WebView accessibility walk could sample 「処理中…」 and click the status bar. `exists` on `window 1` does not see that WebView text, and `entire contents` takes longer than the prepare. No production prepare semantics were changed, and no test-only hold was enabled. Do not treat this record as M6-06 **COMPLETE**. Mock-IPC coverage of the pending status bar is a separate change and is not this Native result.

---

## 8. Diagnostic session (2026-10-26, clean `main`, prepared count 0)

This does **not** replace §6 or §7. It is **not** a production Native **PASS**. Interaction was `CONSOLE_DRIVEN` (`event.isTrusted=false`). Classify as `N7_DIAGNOSTIC=PASS` and `N7_PRODUCTION_NATIVE=NOT_YET_ACCEPTED`. M6 stays **IN_PROGRESS**.

```text
PRODUCT_SHA:           d7754d30f671a4f2a97100a3825ac4eba0d6fc0b
WORKTREE_STATUS:       clean; origin/main matched
HOST_OS:               macOS
ISOLATED_HOME:         /private/tmp/masterocta-m6-06-native-d7754d30-20261026T133946Z
FIXTURE_ROOT:          mo-ui-native-set-H6W1w4
CATALOG_LSOF:          PASS (masterocta pid 22824 on that isolated catalog)
PREPARED_COUNT_BEFORE: 0 (no rename journals before Approve)
SOURCE:                SET/AUDIO/ops_rename_src.wav
DESTINATION:           SET/AUDIO/ops_rename_dst.wav
PLAN_ID:               plan:v1:59bc76cb47d637275c50c86503c7a48d8b62cd16d66f0a238d8db17c435ecb66
OPERATION_ID:          operation:v1:59bc76cb47d637275c50c86503c7a48d8b62cd16d66f0a238d8db17c435ecb66
IPC_START:             performance.now 692631
IPC_END:               performance.now 692853
PREPARE_DURATION:      222ms
PREPARE_IPC_CALL_COUNT: 1
INTERACTION_SOURCE:    CONSOLE_DRIVEN
EVENT_IS_TRUSTED:      false
N7_RESULT:             DIAGNOSTIC_PASS (reopen blocked while IPC open; same operation reopened after PREPARED)
APPLY_INVOKED:         NO
CONTINUE_INVOKED:      NO
RECOVER_INVOKED:       NO
SOURCE_INVENTORY:      PASS (entries=12)
RANGE_SHA:             PASS (43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1)
```

`renameApi.prepare` was an own writable and configurable method. The wrapper called the original once and returned its promise without delaying it. The resolved state was `prepared`. Escape during the IPC reached the drawer dismiss handler (`defaultPrevented=true`). After the following React update, and still before IPC end, the drawer was closed, the status-bar button 「操作ドロワーで詳細を確認」 was clicked, and the drawer stayed closed. After `prepared`, the same operation id reopened in the drawer. The clone file remained `ops_rename_src.wav`. The production catalog mtime stayed 2026-09-17.

An earlier same-day console trace on a different HOME reopened the drawer during a second prepare because a previous PREPARED operation already existed. That trace is not this result and is not a Native PASS. With prepared count 0, `resolveRenameDrawerPin({ operatorOnly: true })` returns closed. With prepared count greater than 0, the status bar may open the existing operator view even while `renamePrepareBusy` is true. `openOperations` does not swap `pinnedAsset` during that busy flag. Continue, Apply, and Recover on `RenameOperatorPanel` stay disabled while the panel `disabled` prop (session busy, including `renamePrepareBusy`) is set. Seeing the older prepared card during a later prepare is therefore the current pin rule, not by itself a defect, and it must not be confused with the zero-prepared N7 block.

---

## 9. Composite score (2026-10-27)

This section does not rewrite §6, §7, or §8. Those sessions stay classified as written. The acceptance owner approved `MO-M6-06-N7-ACCEPTANCE-POLICY-1` as **APPROVE_COMPOSITE**. The score against that bar is **PASS**. The strict manual in-flight window stays **NOT_OBSERVED**. `isTrusted=false` stays an unsampled trusted-input gap. Prepare semantics were not changed.

Evidence and SHAs: [`../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md) §5.1.
