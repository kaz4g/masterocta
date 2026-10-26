# M6-06 N7 composite acceptance decision

- Status: **APPROVED** on 2026-10-27. Decision: `APPROVE_COMPOSITE`.
- Work ID: `MO-M6-06-N7-ACCEPTANCE-POLICY-1`
- Canonical bar: [`M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](./M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md) §5.1
- This file records the decision. It does not change prepare semantics, Apply control, or Gate C.

## Former bar

Native N7 required a manual operator to show both of the following in one session:

- After PREPARED, Escape closes the drawer and the status bar reopens the same operation.
- While the first prepare is still in flight, Escape closes the drawer and the status bar does not reopen it. Prepare is not cancelled.

The second bullet was **NOT_OBSERVED**. The prepare IPC returned in 222ms. That miss stays on the record. It is not reclassified as a product defect.

## Approved bar

Scope is a Rename Prepare that starts with zero prepared operations: drawer close and status-bar block during that prepare, and reopen of the same operation after PREPARED.

All of the following are required:

```text
DETERMINISTIC_E2E = PASS
REAL_IPC_DIAGNOSTIC = PASS
NATIVE_OPERATOR_POST_PREPARED = PASS
MANAGED_CLONE_AND_PREPARE = PASS
SOURCE_INTEGRITY = PASS
NO_APPLY_NO_CONTINUE = PASS
REQUIRED_CI = PASS
```

The scored result is in the acceptance doc §5.1. `N7_COMPOSITE = PASS`. `N7_STRICT_MANUAL = NOT_OBSERVED`.

## Evidence classes

| Class | Record |
| --- | --- |
| `E2E_DETERMINISTIC` | PR #249, `6be21e43`. Mock IPC. Not a macOS WebView session. |
| `NATIVE_REAL_IPC_DIAGNOSTIC` | `d7754d30`, smoke §8. `CONSOLE_DRIVEN`, `isTrusted=false`. Not a manual Native pass. |
| `NATIVE_OPERATOR_ACCEPTANCE` | `4fbae7bb`, smoke §7. Post-PREPARED reopen **PASS**. In-flight window **NOT_OBSERVED**. §6 remains a separate dirty-tree **STOP**. |

`src/` and `src-tauri/` do not differ between `4fbae7bb` and `d7754d30`.

## What remains unsampled

A trusted (`isTrusted=true`) key and click inside the 222ms window. The dismiss handler does not read `isTrusted`. The diagnostic Escape reached that handler (`defaultPrevented=true`).

Case B, a later prepare while an older prepared operation already exists, is a different rule. The status bar may show that older card. Continue, Apply, and Recover stay disabled while `renamePrepareBusy` is passed through as the panel `disabled` prop. Viewing that card is not, by itself, a defect.

## Why the write boundary holds

Apply, Continue, and Recover stay outside the acceptance actions. Source inventory and RANGE SHA stay mandatory. The session catalog is not the production catalog. The E2E hold does not replace the real prepare journal.
