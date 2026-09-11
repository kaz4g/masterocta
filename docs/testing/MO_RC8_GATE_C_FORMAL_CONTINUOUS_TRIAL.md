# MO-RC8 Gate C Formal Continuous Trial

- Status: **EXECUTED** (Human Gate C **PASS**; operator sign-off 2026-09-12)
- Work ID: `MO-RC8-GATE-C-FORMAL-CONTINUOUS-1`
- Related investigation: [`MO_RC8_STATIC_LINK_INVESTIGATION.md`](MO_RC8_STATIC_LINK_INVESTIGATION.md)
- Related contrast trials: [`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md)
- Gate C smoke contract: [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md)
- Gate C: **NOT_PASS** / Human Gate C: **PASS** / M5: **INCOMPLETE**

## Purpose

Define the **continuous** Human Gate C trial required to evaluate RC8 rename Apply
on **one** verified disposable clone from PRE through MkII hardware load and back.

OCTA2 reconstruction Trial A recorded playback success after a compact-card warning.
That evidence is preserved but is **not** a substitute for this trial. It used
**different media**, was **not** continuous with the primary RC8 Apply session, and
did not follow the full Gate C smoke contract on one clone.

This document recorded the plan first and now records the executed trial.
It does **not** weaken Gate C PASS requirements. It does **not** authorize RC8
rebuild, workflow redispatch, or product PATH/Bank changes.

## Why a new continuous trial is required

Gate C PASS requires a verified disposable clone on which the frozen RC8 artifact
completes Rename and **the same clone** loads on MkII with the new sample name
playing as expected. See [`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) Gate C PASS
conditions and [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md) steps 7–15.

| Condition | Current judgment | Reason |
|---|---|---|
| Frozen RC8 DMG / launched binary identity | Partially satisfied | RC8 freeze tuple recorded. OCTA2 Trial A did **not** launch MasterOCTa or Apply; launched-binary identity for that trial is **N/A**. This formal trial must re-verify identity before operator launch |
| Same disposable clone PRE → Apply → hardware | **Not satisfied** | Primary RC8 Apply evidence and OCTA2 reconstruction playback are **separate media** and **non-continuous** |
| Expected-only compare immediately after Apply | Partially satisfied | Primary RC8 POST compare **PASS**. OCTA2 state is reconstruction placement, not Apply on the formal trial clone |
| MkII Set/Project load + new-name playback | Partially satisfied | OCTA2 operator report: compact-card warning → YES → target Project loaded → new-name playback without ERROR. **Not** explicit LOAD. Power state for that session is **unconfirmed** |
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
  clone. Reconstruct the card from operator-local preserved `source/` first,
  then re-baseline as below. Do **not** overwrite that original `source/`.
- The frozen PRE clone **must** contain a second Project in the same Set before
  PRE capture. See **Second Project and PRE freeze** below. Do not start Plan /
  Apply while Trial B-style CHANGE-away remains impossible.
- After the second Project is added, clone verification must use a **new**
  two-Project trial source. The original one-Project `source/` cannot fully
  match the card. See **Trial source re-baseline**. Do not weaken clone
  verification to ignore the extra Project.
- Use a **new** disposable clone root, manifest, Application Support session, and
  journal context. Do not reuse RC7 or prior RC8 runtime state.
- Frozen RC8 artifact only. Re-verify DMG SHA256 and launched executable SHA256
  against [`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) §RC8 before operator launch.
  Do **not** rebuild or redispatch RC8 in this plan. OCTA2 Trial A binary identity
  is **N/A** and does not substitute for this check.
- If any precondition fails, **STOP** without Apply.

## Second Project and PRE freeze

[`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md) step 15 does **not** accept boot
auto-open of the last-used Project as hardware evidence. Explicit Project LOAD
requires CHANGE **away** then CHANGE **back**, as defined in
[`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md) Trial B.
Staying on an already-open target is not a LOAD.

The OCTA2 reconstruction copy has **no second Project**, so Trial B on that copy
is **BLOCKED**. This formal trial must not inherit that blocker. Do **not**
retry PRE→Apply on a one-Project clone and hope LOAD can be invented later.

### How to add the second Project

Allowed on a **new disposable clone only**. Original media, the failed primary
card, OCTA2 trial-after media, and POST reconstruction media stay unused.

1. Reconstruct PRE-equivalent files from operator-local preserved `source/` onto
   the disposable clone (rename-target Project present; second Project absent).
   Capture a **pre-second-Project** inventory for later comparison. This inventory
   is **not** the frozen PRE.
2. Add a second Project in the **same Set** by an official MkII Project-create
   action (NEW / equivalent per the OS 1.40A manual). Do **not** use MasterOCTa
   to create Projects. Do **not** duplicate the rename-target Project directory
   on the host (shared slot PATH would invalidate the LOAD distinction).
3. The second Project is a CHANGE destination only. It must not be the rename
   target and must not receive the planned sample rename.
4. Return the clone to Mac. Confirm:
   - two Project directories exist in the same Set
   - rename-target Project bytes still match the pre-second-Project inventory
5. If the rename-target Project drifted (device autosave or other rewrite),
   **STOP** that copy. Do not freeze PRE. Preserve evidence and start a new
   disposable reconstruction.

Forbidden: adding the second Project after PRE freeze, after Plan, or after
Apply; treating filesystem copy of the rename-target folder as a second
Project; using Trial B on the existing OCTA2 copy as this trial’s LOAD;
recording CloneSourceEvidence from the original one-Project `source/` against
the two-Project card.

### Trial source re-baseline (VERIFIED CLONE)

Clone verification compares a live clone manifest to immutable
`CloneSourceEvidence` (`v2_clone_record_source_evidence` →
`v2_clone_verify_external`). A mismatch is `CLONE_SOURCE_EVIDENCE_MISMATCH`.
The original preserved `source/` has **no second Project**, so it cannot be the
source for verifying the two-Project trial card. Do **not** relax that match.

Keep the original `source/` and all prior RC8 / OCTA2 evidence unchanged.

1. **Target-Project check (not clone verification).** After the second Project
   is added and the clone is back on Mac, confirm the **rename-target Project**
   files still match the original preserved `source/` (path, type, size,
   SHA256). The second Project is expected extra content versus that original
   source. If the target Project drifted, **STOP** (same as step 5 above).
2. **New trial source.** Copy the two-Project card state to a **new**
   operator-local preserved source. Do not write into the original `source/`.
   Label it as the formal-trial source for this work ID only.
3. **Full-file compare.** Capture the new trial source and the trial card with
   the same Gate C byte-manifest tool and compare **entry-for-entry**. Verdict
   must be **PASS** with diffs=0. This is the first complete match of the
   two-Project state. If it fails, **STOP**. Do not record clone source
   evidence. Do not freeze PRE.
4. **Clone source evidence from the new trial source.** Register the **new
   trial source** read-only. This is a different root from the trial card.
   Recording source evidence here does **not** count as trial-card root
   registration. Record `CloneSourceEvidence` from **that** source (not from
   the original one-Project `source/`). The trial card remains a distinct
   device from the source (source-equals-clone is still forbidden).
5. **PRE freeze, then trial-card registration.** Capture the frozen PRE byte
   manifest of the trial card **before any registration of that card**,
   including read-only registration (same contract as
   [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md)). Then register the trial
   card and run existing clone verification against the new trial source’s
   evidence until the card is a **VERIFIED CLONE**. Only then register write
   intent and proceed to Plan.

Do **not** treat the target-Project subset check as VERIFIED CLONE. Do **not**
skip full-file compare by attesting the extra Project. Managed-clone copy from
the original one-Project source is also insufficient: it would omit the
second Project needed for explicit LOAD.

### When PRE is frozen

PRE freeze is the first complete per-file byte manifest of the trial card taken
**after** all of:

- the second Project is present
- the rename-target Project still matches the original `source/`
- the new two-Project trial source is preserved separately
- full-file compare of new trial source vs trial card is **PASS** (diffs=0)

That PRE manifest is captured **before root registration of the trial card**,
including read-only registration, and before Plan, Prepare, and Apply. This
matches [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md). Registration of the
**new trial source** is a separate root and may already have occurred in order
to record `CloneSourceEvidence`. From this point:

- clone verification uses the new trial source’s `CloneSourceEvidence`
- expected-only compare treats second-Project files as **unrelated** (must be
  unchanged by Apply)
- hardware LOAD is CHANGE to the second Project, then CHANGE back to the
  rename-target Project
- a clone frozen without a second Project, or verified against the original
  one-Project `source/`, is **not** a valid formal-trial PRE

Trial B on the existing OCTA2 reconstruction remains **BLOCKED**. Adding a
second Project to that copy after the fact does **not** convert it into this
formal trial.

## Procedure skeleton

### Agent responsibilities

1. From operator-local preserved `source/`, prepare a **PRE-equivalent** disposable
   clone (not POST reconstruction, not OCTA2 trial-after state). Do not modify
   that original `source/`.
2. After the operator adds the second Project, confirm rename-target Project
   hashes still match the original `source/`. Preserve the two-Project card as
   a **new** trial source. Full-file compare new trial source vs trial card
   (PASS, diffs=0). Capture the **frozen PRE** from the trial card **before
   registering that card** (read-only included). The new trial source may
   already be registered.
3. After PRE freeze, register the trial card (read-only first) and run
   existing clone verification against `CloneSourceEvidence` already recorded
   from the **new** trial source until the card is **VERIFIED CLONE**. Do not
   use the original one-Project `source/` for this verify.
4. Re-verify frozen RC8 artifact and launched binary identity (read-only) for
   **this** trial. Do not cite OCTA2 Trial A for binary identity.
5. Organize operator-local evidence directories for Plan, Committed, post-Apply
   manifest, and post-hardware capture.
6. After operator steps, run expected-only byte compare and post-hardware manifest
   diff tooling. Preserve evidence outside the repository.

### Operator responsibilities

1. On the disposable clone, create the second Project (see above) **before**
   PRE freeze. Do not proceed if only one Project exists.
2. After PRE freeze of the trial card (no trial-card registration yet, including
   read-only), register that card and confirm **VERIFIED CLONE** against the
   new trial source (existing clone operator flow). The new trial source may
   already be registered. Register write intent on the clone only after
   VERIFIED CLONE.
3. Plan → Prepare → application restart → Continue → Apply on the **clone only**.
4. Confirm `COMMITTED / VERIFIED`, zero Missing / Invalid / Unresolved counts.
5. Save Committed evidence JSON unchanged outside the clone and repository.
6. Safely eject; insert the **same clone** on Octatrack MkII. Record observed
   warnings, keys pressed, OS version, and insert/remove sequence. Do **not**
   record a power-on/off fact unless the operator confirmed that power state.
7. Explicit LOAD (required for this trial; boot auto-open is not enough):
   - If a compact-card or similar warning appears, record the text and the key
     pressed (for example YES). That warning response is **not** LOAD.
   - PROJECT menu → CHANGE → select the **second** Project.
   - Record any SAVE prompt when leaving the rename-target. Decline writing a
     new SAVE checkpoint of the rename-target. If the device refuses to leave
     without SAVE, **STOP** that copy (`BLOCKED: SAVE required to switch`).
   - PROJECT menu → CHANGE → select the **rename-target** Project. This
     CHANGE-back is the LOAD under test.
8. Confirm target Static Slot plays the **new** name without ERROR.
9. Return clone to Mac for read-only post-trial capture and preservation.

### Success criteria

All of the following on **one** continuous disposable clone:

- New two-Project trial source preserved separately; original `source/` unchanged
- Full-file compare of new trial source vs trial card **PASS** (diffs=0)
- `CloneSourceEvidence` recorded from the new trial source; existing clone
  verification **VERIFIED CLONE** (not against the original one-Project `source/`)
- Frozen PRE captured **after** that re-baseline
- Launched RC8 executable SHA256 matches the frozen ledger (this trial)
- Apply `COMMITTED / VERIFIED` with zero Missing / Invalid / Unresolved
- Post-Apply expected-only compare **PASS** (second-Project files unchanged)
- MkII hardware smoke **PASS** per CLONE_SMOKE step 15 via CHANGE-away then
  CHANGE-back (boot auto-open and warning-YES alone are insufficient)
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
| OCTA2 reconstruction Trial A | Supplementary playback evidence; **not** formal continuous trial. Launched-binary identity **N/A** (no Apply) |
| Trial B (explicit LOAD) | **BLOCKED** on current OCTA2 POST copy (no second Project). This formal trial does **not** unblock that copy; it prepares a second Project on a **new** clone **before PRE freeze** |
| Trial C (RELOAD) | **NOT_RUN**. Does not substitute for formal continuous acceptance |
| RC8 product fix | **Not authorized** from investigation or OCTA2 trial alone |
| RC8 rebuild / redispatch | **Not authorized** by this plan |

## Evidence record (operator-local)

Record outside the repository (sanitized; no personal paths in repo):

- Trial ID `MO-RC8-GATE-C-FORMAL-CONTINUOUS-1`
- Frozen RC8 identity and launched binary SHA256 match yes/no (**this** trial)
- Second Project present at PRE freeze yes/no; rename-target hash match vs
  original preserved `source/`
- New two-Project trial source preserved separately yes/no; original `source/`
  left unchanged
- Full-file compare of new trial source vs trial card: verdict and entry count
- CloneSourceEvidence recorded from new trial source; VERIFIED CLONE yes/no
- Clone manifest SHA256 and entry count (pre-second-Project inventory, frozen
  PRE, post-Apply, post-hardware)
- Plan identity, Committed evidence reference, compare verdict
- MkII session log: confirmed observations only (warnings, keys, CHANGE-away /
  CHANGE-back). Do not fill unconfirmed power-on/off as fact
- Slot display, playback result
- Preservation selection counts if post-hardware capture differs from manifest scope

## Execution record (2026-09-12)

Operator sign-off: Human Gate C **PASS**. Evidence remains operator-local; this
section is sanitized (no personal paths, volume names, or sample stems).

| Item | Result |
|---|---|
| Frozen RC8 launched binary SHA256 | Matches [`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) §RC8 |
| Second Project present before PRE freeze | Yes |
| New two-Project trial source preserved separately | Yes; original one-Project `source/` unchanged |
| Full-file compare new trial source vs trial card | **PASS** (diffs=0) |
| Clone verification | **VERIFIED CLONE** against the new two-Project source |
| PRE freeze | Before trial-card registration |
| Plan → Prepare → restart → Continue → Apply | `COMMITTED` / `VERIFIED` |
| `rename-committed-evidence:v1` / `expected-from-evidence` | Exported; accepted without manual hash completion |
| Apply-time byte-manifest vs PRE | **PASS**; unrelated entries unchanged (second-Project files unchanged by Apply) |
| MkII OS | 1.4 |
| Explicit LOAD | Observed: device presented the **second** Project first; operator CHANGE to the rename-target Project. That CHANGE onto the rename-target is the LOAD under test. Boot auto-open of the rename-target was **not** used as evidence. SAVE / RELOAD / slot reassignment were **not** performed |
| MkII session UI | No boot Error/warning recorded. Rename-target Static Slot 1 displayed and played the destination basename without ERROR and without `FILE NOT FOUND` |
| After-hardware card-root LOG | None observed at after-hardware capture. LOG absence is **not** the same observation as the session UI having no Error/warning |
| After MkII vs post-Apply | One 2-byte change in an **unrelated** Bank working file. Rename-target Project documents and destination WAV hashes unchanged vs post-Apply. Bank checksum field matched the payload before and after; that match is **not** proof the file was uncorrupted and **not** proof of normal autosave. Payload field identity **unknown**. **Not** attributed to Apply |

Interpretation used for this PASS: unrelated-bytes versus the pre-run
manifest are evaluated at Apply time ([`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md)
compare before eject). The after-MkII Bank working-file delta is a recorded
deviation, not an Apply failure. This does **not** rewrite Gate C PASS
conditions and does **not** close the original FILE NOT FOUND cause
investigation.

## Gate status

- This trial: **EXECUTED**
- RC8 Human Gate C: **PASS** (operator sign-off 2026-09-12)
- Gate C: **NOT_PASS**
- M5: **INCOMPLETE**
- Historical non-continuous FILE NOT FOUND session: remains **STOP** in
  [`MO_RC8_STATIC_LINK_INVESTIGATION.md`](MO_RC8_STATIC_LINK_INVESTIGATION.md)
- RC8 artifact rebuild / workflow redispatch / product PATH/Bank fix: **not authorized**
- Public distribution: **not authorized**
