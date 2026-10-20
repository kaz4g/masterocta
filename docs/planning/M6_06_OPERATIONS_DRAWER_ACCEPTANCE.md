# M6-06 Operations Drawer acceptance (option C)

- Work ID: `MO-M6-06-DRAWER-SPEC-AND-NATIVE-1`
- Date: 2026-10-19
- Decision: **(C)** — Operations Drawer is the single operation overlay
- Does **not** depend on draft PR [#238](https://github.com/kaz4g/masterocta/pull/238) (`M6_FINAL_EXIT_AUDIT.md`) being merged. The audit recommended (C); this document records the adopted acceptance.

v0.1 ingest ([`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md)) is **not rewritten**. Historical WP name **Operation Modal** stays in `MILESTONE_INDEX`. This file is the M6-06 acceptance amendment.

---

## 1. Decision

| Item | Adopted |
| --- | --- |
| Overlay | **One** `OperationsDrawerHost` (`Drawer`, `role="dialog"`, `aria-modal`) |
| Central Operation Modal | **Not built.** Do not add a second overlay for copy / rename / clone |
| Gate C operator panels | Stay **inside** the Drawer: `CloneOperatorPanel`, `RenameSampleModal` (embedded) + `RenameOperatorPanel`, `AdditiveCopyChangeDrawer` (`embeddedInDrawer`) |
| Always-visible bottom Change Drawer | **Forbidden** (unchanged from #134: `AppShell.changeDrawer` unused in Library) |
| Configurable Copy/Rename shortcuts | **M6-08**, not M6-06 (`MO-M6-08-LIBRARY-KEYBOARD-1` follow-up). Esc to close the Drawer remains M6-06 |

Bank Editor / Project Structure / ChangePlan / Apply are out of this WP.

---

## 2. Delta vs v0.1 (ingest unchanged)

| v0.1 locus | Historical text | Amendment |
| --- | --- | --- |
| §5.8 title | File Operation Modal / Operation Dialog | Implement as **Operations Drawer** with dialog semantics |
| §17 WP name | M6-06 Operation Modal | Historical ID only |
| §18 M6-06 | copy / rename / plan review; bottom drawer不要; safety維持 | copy / rename / clone / plan review in the **on-demand Drawer**; always-visible prepared panel remains forbidden; M5 write safety unchanged |
| §5.9 Copy/Rename dialog configurable | listed with M6 keyboard UX | **Moved to M6-08.** M6-06 requires Esc close of the Drawer only |
| §23 step 7 | M6-06 Operation Modal で bottom prepared-operation UIを撤去 | Satisfied by #134 Drawer; no central Modal replacement |

Exit Gate 4 (“Prepared Operation常設panelが消えている”) is the v0.1 gate this WP serves. A centered Modal widget is **not** an Exit Gate requirement.

---

## 3. Production mount

```text
Inspector SampleOperationsMenu / Top Bar Clone / Status bar
        ↓
OperationsDrawerHost  (Drawer, role=dialog, focus trap, Esc)
        ├── clone  → CloneOperatorPanel
        ├── rename → RenameSampleModal (embedded) + RenameOperatorPanel
        └── copy   → AdditiveCopyChangeDrawer (embeddedInDrawer)
```

One shell. Operator Continue / Apply approval and plan review run in these panels, not in a separate bottom drawer and not in a new central Modal.

---

## 4. Acceptance (M6-06)

A row may be **COMPLETE** only when all of the following hold. This PR locks the spec and automated close contract; Native write remains a remaining gate.

| # | Criterion | Automated | Native |
| --- | --- | --- | --- |
| A | Overlay is `OperationsDrawerHost` / `Drawer` with `role="dialog"` | `Drawer.test.tsx`; Library E2E `getByRole("dialog")` | Operator: dialog chrome |
| B | Focus trap; Tab does not enter hidden kind sections | `Drawer.test.tsx` `focus trap ignores hidden inactive sections`; `focusable.test.ts` | — |
| C | Esc (and ×) close the Drawer | `Drawer.test.tsx`; Library E2E | Operator Esc |
| D | Copy / rename expose plan review and an explicit approval gate before prepare / apply | `RenameSampleModal.test.tsx`; `AdditiveCopyChangeDrawer.test.tsx`; `e2e/rename-prepare.spec.ts` | Native smoke §5 |
| E | Close is display-only: no apply / cancel / recover IPC. In-flight **prepare is not cancelled**. After the result is PREPARED or recovery-required, reopen the same session or use status-bar Operations. Status bar does not reopen while the prepare request is still pending | `RenameSampleModal.test.tsx`; `RootRegistryPanel.test.tsx`; `e2e/operations-drawer-prepare-close.spec.ts` | Native N7 |
| F | Always-visible prepared-operation panel remains absent | Architecture of `RootRegistryPanel` (no `changeDrawer`) | Native layout |
| G | No new Gate C IPC; no Bank Editor line | Diff review | — |
| H | Synthetic-fixture Native **write** through the Drawer requires **both** managed clone create and rename prepare, never original media. Either stage alone is insufficient | Fixture generator + prepare script (CI) | [`../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md`](../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md) N3 and N6 |

Configurable Copy/Rename shortcuts are **not** in this table.

### Close semantics (current design — do not change silently)

From [`../testing/MO_UI_OPERATIONS_DRAWER_1_PR.md`](../testing/MO_UI_OPERATIONS_DRAWER_1_PR.md) State contracts:

- Close hides the panel; children stay mounted.
- Close does **not** call apply / cancel / recover.
- There is **no** `v2_rename_cancel` (or equivalent) IPC.
- Rename prepare in flight: Drawer may close; `renamePrepareBusy` still blocks root close, pin swap, and Inspector Rename re-entry. Status bar **Open operations** does not reopen that Drawer while the request is pending: `resolveRenameDrawerPin({ operatorOnly: true })` returns `{ open: false }` until a prepared or recovery-required operation exists.
- After prepare completes, status bar **Open operations** reopens the operator view, and embedded rename state still shows PREPARED.

If product code were found to cancel prepare on close, stop and report; do not “fix” that by adding cancel IPC in this WP.

---

## 5. Native smoke (remaining for COMPLETE)

Protocol: [`../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md`](../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md).

- Fixture: existing UI workspace generator (`scripts/generate-ui-workspace-native-fixture.mjs`) via `scripts/prepare-m6-06-operations-drawer-native-smoke.sh` — managed temp only.
- Write: Drawer **rename prepare** on `SET/AUDIO/ops_rename_src.wav` after a Drawer **managed clone** of the synthetic Set (clone-first). Do **not** Apply.
- Host: macOS Tauri (`scripts/launch-native-acceptance-tauri.sh`), isolated `HOME`.
- This Cloud Agent VM: Native **NOT_RUN**.

---

## 6. Out of scope

- `MO-M6-06-OPERATION-MODAL-1` (v0.1 central Modal) — **do not open**
- M6-08 pane persistence and Library keyboard (Up/Down, Space, Cmd+K, configurable Copy/Rename)
- Bank Editor, Project Structure ChangePlan / Apply
- Public distribution / signing
- Operator-panel body i18n (historical remainder from #134)
