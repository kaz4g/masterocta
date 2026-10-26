# M6-06 N7 composite acceptance proposal

- Status: **PROPOSAL. Not approved. Does not change the current N7 bar.**
- Work ID: `MO-M6-06-N7-ACCEPTANCE-POLICY-1`
- Current bar: [`M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](./M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md) and [`../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md`](../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md)
- Decision required from the acceptance owner: `KEEP_STRICT_NATIVE` | `APPROVE_COMPOSITE` | `DEFER`
- Until that decision is recorded, M6 stays **IN_PROGRESS** and Issue #178 stays **OPEN**.

This file does not rewrite §6 or §7 of the smoke record, and it does not mark M6-06, M6-08, or M6 **COMPLETE**.

## 1. Evidence classes

Do not treat these as the same result.

| Class | What it shows | What it is not |
| --- | --- | --- |
| `E2E_DETERMINISTIC` | PR #249, merged as `6be21e43`. Mock IPC holds `v2_rename_prepare`. Escape closes the drawer, prepare is not cancelled, the status bar does not reopen while no operation is prepared, the same operation reopens after release, and Apply / Cancel / Recover are not called. | A macOS WebView session or a real Rust prepare. |
| `NATIVE_REAL_IPC_DIAGNOSTIC` | Clean `d7754d30`, prepared count 0, `CONSOLE_DRIVEN`, `isTrusted=false`. One real `renameApi.prepare` call, 222ms, drawer closed during the IPC, status-bar click did not reopen it, journal `prepared`, same operation reopened after PREPARED. Apply / Continue / Recover were not invoked. Issue [#178 comment](https://github.com/kaz4g/masterocta/issues/178#issuecomment-6417763945). | A manual Native acceptance pass. |
| `NATIVE_OPERATOR_ACCEPTANCE` | Clean `4fbae7bb` (§7): N0–N6 PASS, N8 PASS, post-PREPARED close and status-bar reopen PASS, in-flight window **NOT_OBSERVED**, Apply / Continue not invoked. Earlier §6 is a separate dirty-tree STOP. | Proof of the in-flight status-bar block. |

## 2. Current acceptance condition

Native N7 requires the operator session to show both of the following:

- After PREPARED, Escape closes the drawer and the status bar reopens the same operation.
- While prepare is still in flight and no rename is prepared yet, Escape closes the drawer and the status bar does not reopen it. Prepare is not cancelled.

The second bullet was not observed by manual operation. The prepare IPC on the diagnostic session returned in 222ms. Repeating manual attempts is not a reliable way to sample that window. The current bar still stands. Missing the window is **NOT_OBSERVED**, not a product defect by itself.

## 3. Proposed condition

`N7_COMPOSITE_ACCEPTANCE_PROPOSAL` would accept N7 only when all of the following are true:

```text
A = DETERMINISTIC_E2E_PASS
B = REAL_IPC_DIAGNOSTIC_PASS
C = NATIVE_OPERATOR_POST_PREPARED_PASS
D = MANAGED_CLONE_AND_PREPARE_PASS
E = SOURCE_INTEGRITY_PASS
F = NO_APPLY_NO_CONTINUE
G = REQUIRED_CI_PASS
```

A–F above are already evidenced at the SHAs in §1, except G must be the required checks on the PR that records the decision. This proposal does not score G, and it does not convert A–F into a PASS.

## 4. Why this is proposed

The safety claim is that closing the drawer during prepare does not cancel prepare, and the status bar cannot open a new operator view before a prepared operation exists. That claim is now supported by a deterministic UI test and by one real IPC on the production prepare path. The manual post-PREPARED reopen is already on the Native session. The remaining gap is a human completing Escape and a status-bar click inside a window of about 222ms.

## 5. What the evidence does not show

- A trusted (`isTrusted=true`) key and click during a live prepare. The drawer dismiss handler does not read `isTrusted`, and the diagnostic event reached that handler (`defaultPrevented=true`), but the trusted input path was not sampled in flight.
- A second manual Native session after `d7754d30`. The operator N0–N8 record remains the `4fbae7bb` STOP.
- Case B as a fresh experiment on a session that starts with zero prepared operations and then prepares a second rename. The earlier reopen-during-prepare happened because a prepared operation already existed. That is a different rule from the zero-prepared block.

## 6. Residual risk

| Risk | Assessment |
| --- | --- |
| E2E versus Native state | The E2E hold replaces the IPC timing. The Native diagnostic used the real `renameApi.prepare` promise and did not delay it. Call count was 1 and the journal reached `prepared`. |
| Console events versus manual input | `isTrusted=false`. Same dismiss and status-bar handlers. Not a substitute for a trusted event if the strict bar is kept. |
| Wrapper changing prepare | The wrapper called the original method once and returned its promise. No Rust prepare change. |
| Wrong operation after reopen | The diagnostic reopen showed the same operation id that the IPC returned. |
| Case B, prepared count > 0 | `resolveRenameDrawerPin` allows the operator view when a prepared rename exists. `openOperations` does not swap `pinnedAsset` while `renamePrepareBusy` is set. Continue, Apply, and Recover on the operator panel stay disabled while that busy flag is passed as `disabled`. Showing the older card is the current rule. It is not, by itself, a defect. Executing Continue or Apply during the in-flight prepare is blocked by that disabled prop. |
| Paths not covered by the composite set | Copy drawer, shortcut-open during rename prepare, and recovery-required state were not part of this N7 sample. |

## 7. Why the proposal does not weaken the write boundary

Apply, Continue, and Recover stay out of the acceptance action. The source fixture inventory and RANGE SHA remain mandatory. The production catalog is not the session catalog. A composite PASS would still require the real prepare journal and the post-PREPARED Native reopen, not the E2E alone.

## 8. Approval

The implementer does not approve this change.

| Choice | Effect |
| --- | --- |
| `KEEP_STRICT_NATIVE` | In-flight manual observation remains required. M6 stays **IN_PROGRESS**. Further in-flight attempts must be bounded, not open-ended. |
| `APPROVE_COMPOSITE` | A follow-up docs change may record the new bar and score A–G. Approval alone does not mark M6 **COMPLETE**. |
| `DEFER` | M6 stays **IN_PROGRESS**. Issue #178 keeps the open item “N7 acceptance method is undecided”. |

Current recommendation while waiting: **`DEFER`**. Do not edit the acceptance bar in the same change as this proposal.
