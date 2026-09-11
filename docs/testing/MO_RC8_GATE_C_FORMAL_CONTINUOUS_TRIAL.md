# MO-RC8 Gate C Formal Continuous Trial Plan

- Status: **NOT_RUN** (plan only; no execution in this document)
- Work ID: `MO-RC8-GATE-C-FORMAL-CONTINUOUS-1`
- Related investigation: [`MO_RC8_STATIC_LINK_INVESTIGATION.md`](MO_RC8_STATIC_LINK_INVESTIGATION.md)
- Related contrast trials: [`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md)
- Gate C smoke contract: [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md)
- Gate C: **NOT_PASS** / Human Gate C: **STOP** / M5: **INCOMPLETE**

## Purpose

Define the **continuous** Human Gate C trial required to evaluate RC8 rename Apply
on **one** verified disposable clone from PRE through MkII hardware load and back.

OCTA2 reconstruction Trial A recorded playback success after a compact-card warning.
That evidence is preserved but is **not** a substitute for this trial. It used
**different media**, was **not** continuous with the primary RC8 Apply session, and
did not follow the full Gate C smoke contract on one clone.

This document does **not** authorize execution in the task that creates it. It does
**not** weaken Gate C PASS requirements. It does **not** authorize RC8 rebuild,
workflow redispatch, or product PATH/Bank changes.

## Why a new continuous trial is required

Gate C PASS requires a verified disposable clone on which the frozen RC8 artifact
completes Rename and **the same clone** loads on MkII with the new sample name
playing as expected. See [`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) Gate C PASS
conditions and [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md) steps 7–15.

| Condition | Current judgment | Reason |
|---|---|---|
| Frozen RC8 DMG / launched binary identity | Partially satisfied | RC8 freeze tuple recorded. Whether OCTA2 Trial A used the identical launched binary is **not re-verified** here |
| Same disposable clone PRE → Apply → hardware | **Not satisfied** | Primary RC8 Apply evidence and OCTA2 reconstruction playback are **separate media** and **non-continuous** |
| Expected-only compare immediately after Apply | Partially satisfied | Primary RC8 POST compare **PASS**. OCTA2 state is reconstruction placement, not Apply on the formal trial clone |
| MkII Set/Project load + new-name playback | Partially satisfied | OCTA2 operator report after CONTINUE YES. **Not** explicit LOAD. May not satisfy CLONE_SMOKE step 15 auto-open note |
| Root cause of primary RC8 incident | **Not satisfied** | Gate C PASS does not require full root-cause closure; cause investigation remains separate |

**Conclusion:** OCTA2 reconstruction playback is supplementary evidence only.
Formal Gate C acceptance requires `MO-RC8-GATE-C-FORMAL-CONTINUOUS-1` on a fresh
disposable clone. PASS conditions are **not** relaxed.

Cause investigation (Trial B/C on [`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md))
and formal acceptance remain **separate tracks**.

## Preconditions

- Original CF/SD media stay disconnected for the entire run.
- Do **not** modify the failed primary card or operator-local preserved evidence.
- Do **not** use OCTA2 post-trial or POST reconstruction media as the formal trial
  clone. Build PRE-equivalent state from operator-local preserved `source/` only.
- Use a **new** disposable clone root, manifest, Application Support session, and
  journal context. Do not reuse RC7 or prior RC8 runtime state.
- Frozen RC8 artifact only. Re-verify DMG SHA256 and launched executable SHA256
  against [`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) §RC8 before operator launch.
  Do **not** rebuild or redispatch RC8 in this plan.
- If any precondition fails, **STOP** without Apply.

## Procedure skeleton

### Agent responsibilities

1. From operator-local preserved `source/`, prepare a **PRE-equivalent** disposable
   clone (not POST reconstruction, not OCTA2 trial-after state).
2. Capture pre-run per-file manifest; verify clone integrity.
3. Re-verify frozen RC8 artifact and launched binary identity (read-only).
4. Organize operator-local evidence directories for Plan, Committed, post-Apply
   manifest, and post-hardware capture.
5. After operator steps, run expected-only byte compare and post-hardware manifest
   diff tooling. Preserve evidence outside the repository.

### Operator responsibilities

1. Register the disposable clone root in MasterOCTa (dedicated session).
2. Plan → Prepare → application restart → Continue → Apply on the **clone only**.
3. Confirm `COMMITTED / VERIFIED`, zero Missing / Invalid / Unresolved counts.
4. Save Committed evidence JSON unchanged outside the clone and repository.
5. Safely eject; load the **same clone** on Octatrack MkII.
6. Record MkII OS version, power state, card insert/remove sequence, warnings, and
   keys pressed. Perform **explicit Project LOAD** when CLONE_SMOKE step 15 requires
   it (boot auto-open alone is insufficient).
7. Confirm target Static Slot plays the **new** name without ERROR.
8. Return clone to Mac for read-only post-trial capture and preservation.

### Success criteria

All of the following on **one** continuous disposable clone:

- Pre-run manifest captured and reviewed
- Apply `COMMITTED / VERIFIED` with zero Missing / Invalid / Unresolved
- Post-Apply expected-only compare **PASS**
- MkII hardware smoke **PASS** per CLONE_SMOKE step 15 (including explicit LOAD when required)
- Post-hardware manifest captured; unexplained diffs vs post-Apply baseline **none**

Success updates Human Gate C evaluation; it does **not** automatically close root-cause
investigation or authorize product fixes without a separate proposal.

### Failure handling

- Any compare failure, verification failure, hardware ERROR, or unexplained media
  change vs post-Apply baseline → **STOP** for that trial.
- Do **not** auto-repair the card. Preserve operator-local evidence and record STOP.
- Do not substitute OCTA2 reconstruction results as a retry of the same trial ID.

## Relationship to other work

| Work | Relationship |
|---|---|
| OCTA2 reconstruction Trial A | Supplementary playback evidence; **not** formal continuous trial |
| Trial B (explicit LOAD) | **BLOCKED** on current POST copy (no second Project). Separate from this plan |
| Trial C (RELOAD) | **NOT_RUN**. Does not substitute for formal continuous acceptance |
| RC8 product fix | **Not authorized** from investigation or OCTA2 trial alone |
| RC8 rebuild / redispatch | **Not authorized** by this plan |

## Evidence record (operator-local)

Record outside the repository (sanitized; no personal paths in repo):

- Trial ID `MO-RC8-GATE-C-FORMAL-CONTINUOUS-1`
- Frozen RC8 identity and launched binary SHA256 match yes/no
- Clone manifest SHA256 and entry count (pre, post-Apply, post-hardware)
- Plan identity, Committed evidence reference, compare verdict
- MkII session log (warnings, LOAD steps, slot display, playback result)
- Preservation selection counts if post-hardware capture differs from manifest scope

## Gate status

- This plan: **NOT_RUN**
- RC8 Human Gate C: **STOP** (unchanged until a successful formal continuous trial)
- Gate C: **NOT_PASS**
- M5: **INCOMPLETE**
