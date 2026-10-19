# Native Bank Copy state-document device evidence

Work ID: `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Classification parent: [`PSE_BANK_STATE_DOC_SEMANTICS_2.md`](./PSE_BANK_STATE_DOC_SEMANTICS_2.md)

Base SHA: [`4eaf4ce9d3421786cd2c058bcb0333398522498a`](https://github.com/kaz4g/masterocta/commit/4eaf4ce9d3421786cd2c058bcb0333398522498a) (`main` after PR #235)

## Judgment (Phase B — operator capture revalidated)

Operator-local bytes: `~/octa-captures/P_BANK_COPY_STATE/` (not committed). S3/S4/S5
were recaptured after a control-bank correction (2026-10-19). That redo has no run
id proving it continued from the stored S2 tree.

```text
DISPOSABLE_PROJECT = P_BANK_COPY_STATE
REPO_FIXTURE_ROOT = src-tauri/tests/fixtures/pse_bank_copy_state_doc/  (still empty receptacle)
OPERATOR_CAPTURE_ROOT = ~/octa-captures/P_BANK_COPY_STATE/

DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RESULT = STOP_WITH_FINDINGS
PATTERN_UI_QUALIFICATION = FAIL
PRE_SOURCE_WORK_STRD_DIVERGENCE = PASS
SOURCE_ONLY_PRECONDITION = CONTAMINATED
CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN
IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE
POST_COPY_SESSION_CONTINUITY = NOT_PROVEN
CONTROL_SWITCH_ATTRIBUTION = INCONCLUSIVE
PROJECT_SAVE_ATTRIBUTION = INCONCLUSIVE
PROJECT_RELOAD_ATTRIBUTION = INCONCLUSIVE
DESTINATION_UI_SENTINEL = NOT_RECORDED
COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE

COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN

READINESS_GAP_WORKING_SAVEDCHECKPOINT = OPEN
ISSUE_217_CLOSE_READY = NO
ISSUE_221 = OPEN
APPLY_AUTHORIZED = NO
MASTER_OCTA_FILESYSTEM_WRITE = NO
```

Full hash-level directory diffs:
[`PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md`](./PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE_PHASE_B_MATRIX.md).

S2–S5 fail closed because operator `current_pattern_ui` is `A01` on Banks D and B.
Raw `[STATES]` are pattern **D01** at S2 and **B01** at S3–S5. Label correction alone
does not promote the run: the source-only step also changes `bank04.work`, the CF
copy has no flush exclusion, S3–S5 continuity is not proven, and no destination UI
sentinel is recorded. Domain rules stay **BLOCKED**. Repo fixture tree remains
without device bytes.

## Scope

Answer on disposable Octatrack MkII (`R0173` / `1.40`) only:

1. Native **Bank Copy A → D** — which destination roles change (`bank04.work`, `bank04.strd`)?
2. If `bank04.strd` changes — provenance vs source `.work`, source `.strd`, prior destination, or other?
3. Effect on `project.work` `[STATES] BANK` / `PATTERN`?
4. First attributable persistence transition: `NATIVE_BANK_COPY`, `CONTROL_SWITCH`, `PROJECT_SAVE`, `PROJECT_RELOAD`?

Not in scope: MasterOCTa Apply, Bank writer, #221 internal identity resolution.

## Bank roles (fixed)

| UI | File index | Role |
| --- | --- | --- |
| A | `bank01` | Source |
| B | `bank02` | Control (switch target) |
| C | `bank03` | Untouched negative control |
| D | `bank04` | Destination |

Do not reuse [`pse_bank_copy_persistence/`](../../src-tauri/tests/fixtures/pse_bank_copy_persistence/) (Pattern Paste, #227).

## Schemas

| Symbol | Value |
| --- | --- |
| `META_SCHEMA` | `masterocta.pse-bank-copy-state-doc-capture:v1` |
| `MANIFEST_SCHEMA` | `masterocta-pse-bank-copy-state-doc-manifest:v1` |
| `OPERATION_KIND` | `NATIVE_BANK_COPY` |

## Stages

| Stage | Directory | Semantics | Prior transition |
| --- | --- | --- | --- |
| S0 | `s0_baseline_saved` | `BASELINE_SAVED` | — |
| S1 | `s1_source_working_diverged_pre_copy` | `SOURCE_WORKING_DIVERGED_PRE_COPY` | `SOURCE_WORKING_ONLY_EDIT` |
| S2 | `s2_immediately_after_bank_copy` | `IMMEDIATE_NATIVE_BANK_COPY` | `NATIVE_BANK_COPY` |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` | `CONTROL_SWITCH` |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` | `PROJECT_RELOAD` |

### S1 hard gate

After working-only edit on Bank A (no Project Save), **`bank01.work` MUST NOT equal `bank01.strd`** on the acquisition path. If equal: **STOP** — do not perform Bank Copy; record `PRE_SOURCE_ROLE_DIVERGENCE = NOT_PROVEN`.

### Transport

Every stage records `capture_transport`, `capture_required_mode_change`, `capture_may_flush_device_state` (non-empty, not `unknown`), and, when `capture_may_flush_device_state` is `no`, a non-empty `capture_flush_exclusion` that says why this acquisition cannot flush device state. `no` alone is `CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN`. If acquisition may flush device state, retain bytes but classify `IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE` and do not promote Copy timing rules.

Do **not** assume USB disk mode, CF removal, power-off, or Mac mount is non-mutating.

## Harness

```bash
node scripts/pse-bank-copy-state-doc-device-evidence.mjs status
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze
node scripts/pse-bank-copy-state-doc-device-evidence.mjs write-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest <stage>
node scripts/pse-bank-copy-state-doc-device-evidence.mjs dataset
```

The commands above use the empty repository fixture. Pass the operator root as the next argument, or set `CAPTURE_ROOT`. For `write-manifest` and `verify-manifest`, the root is the argument after the stage name. `CAPTURE_ROOT` is also used when that argument is omitted.

```bash
CAPTURE_ROOT="$HOME/octa-captures/P_BANK_COPY_STATE"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze "$CAPTURE_ROOT"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs verify-manifest s2_immediately_after_bank_copy "$CAPTURE_ROOT"
```

`write-manifest` updates `SHA256SUMS.json` only.

## Operator runbook (ordered)

A. Prepare disposable project **P_BANK_COPY_STATE** on Octatrack MkII (`R0173` / `1.40`).  
B. Establish distinguishable sentinels on Bank **A** (source) and Bank **D** (destination). Record both on S0 and S1 as `source_ui_sentinel` and `prior_destination_ui_sentinel`. The two values must differ.
C. Select source Bank **A** and a **non-zero** Pattern (preferred UI **A04**, raw `PATTERN=3` — record actual UI + raw). Pattern UI is bank-qualified (`A04`, `B01`, `D01`). An `A` prefix on Bank B or D is rejected.
D. Explicit **Project Save** (baseline).  
E. Capture **S0** (+ `save_operation` text).  
F. Working-only edit on Bank **A** — **no Project Save** (+ `working_edit_operation`).  
G. Capture **S1**.  
H. Verify on acquisition path: **`bank01.work` ≠ `bank01.strd`**.  
I. If equality persists: **STOP** (do not copy).  
J. Native **Bank Copy A → D** (+ exact `copy_operation` free text).  
K. Capture **S2** before control switch / Save / Reload.  
L. Switch to control Bank **B** (+ `control_switch_operation`).  
M. Capture **S3**.  
N. Explicit **Project Save** (+ `save_operation`).  
O. Capture **S4**.  
P. **Project Reload** (recommended) (+ `reload_operation`).  
Q. Capture **S5** (binaries before extra UI navigation where practical).  
R. Record `destination_ui_sentinel` on S2 and S5. Promotion requires both to equal `source_ui_sentinel`. The prior destination value, or a different S5 value, stays unpromoted.
S. Rebuild and verify all manifests; set `device_generated` / `capture_sequence_proven` only after operator confirmation.

## Phase B findings (summary)

| Question | Observation (this run) |
| --- | --- |
| Destination roles on Copy | Stored S1→S2 diffs show `bank04.work` and `bank04.strd` both differ. **COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE** (contaminated S0→S1, unknown transport, sentinel not recorded). |
| Destination UI sentinel | **NOT_RECORDED** at S2 and S5. Hash changes alone do not show that the source sentinel was visible on Bank D or survived reload. |
| First persistence transition | Not attributed. The first stored hash difference vs S1 is the S2 directory; that is not a proven `NATIVE_BANK_COPY` persistence time. |
| Byte provenance vs source | **INCONCLUSIVE**. |
| `project.work` BANK/PATTERN | S0/S1 are Bank **A** / Pattern **A04**. Stored S2 is Bank **D** / Pattern **D01**. Stored S3–S5 are Bank **B** / Pattern **B01**. Operator meta still says `A01` for S2–S5 and is rejected. S2→S3 is not attributed to **CONTROL_SWITCH**. |
| Control bank `bank02` | S2→S3 directory diff shows no `bank02` hash change. **CONTROL_SWITCH_ATTRIBUTION = INCONCLUSIVE**. |
| Save / Reload | Stored S3→S4 and S4→S5 diffs are **INCONCLUSIVE** because those stages were recaptured without a run id continuing from this S2. |

Regenerate the harness judgment from the operator root:

```bash
CAPTURE_ROOT="$HOME/octa-captures/P_BANK_COPY_STATE"
node scripts/pse-bank-copy-state-doc-device-evidence.mjs analyze "$CAPTURE_ROOT"
```

Move/Swap rules stay **BLOCKED**; `ReadinessGap::WorkingSavedCheckpointRule` stays **OPEN**.

## Safety

```text
WRITE = NO (MasterOCTa)
DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
BANK_MUTATION_ENVELOPE = NO
APPLY = NO
```
