# MO-M6-06 Operations Drawer Native write smoke

- Work ID: `MO-M6-06-DRAWER-SPEC-AND-NATIVE-1`
- Spec: [`../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](../planning/M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md)
- Shared harness: [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](./MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) (fixture generator, isolated `HOME`, launcher)
- **Native run on this PR: `NOT_RUN`**

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
| **Native Tauri WebView + real IPC write** | **macOS** with GTK-free Tauri shell: `scripts/launch-native-acceptance-tauri.sh` after the prepare script | **NOT_RUN** (Linux Cloud Agent; no operator Native session) |

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
