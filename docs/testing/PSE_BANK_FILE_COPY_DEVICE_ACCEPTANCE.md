# PSE Bank file copy — device acceptance runbook (operator)

Work ID: `MO-PSE-BANK-FILE-COPY-DEVICE-CAPTURE-1` (reserved; **not executed** in
`MO-PSE-BANK-COPY-SEMANTICS-RECONCILIATION-1`)  
Parent reconciliation: [`PSE_BANK_COPY_OPERATION_SEMANTICS.md`](../planning/PSE_BANK_COPY_OPERATION_SEMANTICS.md)

**Read-only planning document.** The repository does not run these steps. Use
**disposable** Octatrack projects only. Never capture from irreplaceable media.

Do **not** reuse capture roots `P_BANK_COPY_STATE` or `P_BANK_PERSIST`. Do **not**
store File Manager evidence under `masterocta.pse-bank-copy-state-doc-capture:v1`
(`operation_kind` must remain `pattern_copy_paste` / legacy `NATIVE_BANK_COPY`
only).

## Reserved metadata schemas

| Experiment | `capture.meta.json` schema | `operation_kind` |
| --- | --- | --- |
| A — Pattern paste gaps | `masterocta.pse-pattern-paste-gap-capture:v1` | `pattern_copy_paste` |
| B — File Manager bank file copy | `masterocta.pse-bank-file-copy-device-capture:v1` | `file_manager_bank_file_copy` |

Harness implementation for Experiment B is a **follow-on** work unit. Until then,
record metadata manually and keep bytes under a new local root (for example
`~/octa-captures/P_PATTERN_PASTE_GAP_*` or `~/octa-captures/P_FM_BANK_COPY_*`).

## Shared requirements (both experiments)

Every stage directory must include:

- `capture.meta.json` with a **non-empty** `capture_run_id` shared across S0–S5
  of one continuous session (new UUID per experiment run)
- Pinned `os_revision` / `os_release` (MkII **R0173 / 1.40** unless explicitly
  rescoped)
- `capture_transport`, `capture_required_mode_change`,
  `capture_may_flush_device_state` (same vocabulary as
  [`PSE_PATTERN_PASTE_PERSISTENCE.md`](../planning/PSE_PATTERN_PASTE_PERSISTENCE.md))
- UI sentinels: `current_bank_ui`, `current_pattern_ui` (bank-qualified pattern
  labels, e.g. `B01` not bare `01`)
- `SHA256SUMS.json` per stage (hash **all** compared project/bank documents)

Compared files (minimum): `project.work`, `project.strd`, `bank01`–`bank04`
`.work`/`.strd` (extend if the experiment touches other banks).

Power-cycle control (optional but recommended when transport is uncertain): copy
the pattern from
[`PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE.md`](../planning/PSE_BANK_COPY_STATE_DOC_DEVICE_EVIDENCE.md)
E2 — if S0 hashes change after power cycle, **STOP** and record transport as
mutating.

## Experiment A — Pattern Copy/Paste persistence gaps (Operation A)

**Goal:** Close gaps in [`PSE_PATTERN_PASTE_PERSISTENCE.md`](../planning/PSE_PATTERN_PASTE_PERSISTENCE.md)
without claiming Bank file copy or whole-bank semantics.

**Disposable project:** new name, e.g. `P_PATTERN_PASTE_GAP_1`.

**Procedure (same musical steps as `P_BANK_PERSIST`):**

1. Pattern **A01** Copy
2. Select Bank **B** / Pattern **B01** (before paste)
3. Pattern Paste — record **S2 UI sentinel** (audible/visual confirmation)
4. Switch to control Bank **D**
5. Explicit Project Save — record non-empty `save_operation` on **S4**
6. Project Reload — capture bytes **before** opening Bank B; then open **B/B01**
   and record `destination_ui_sentinel_after_reload`

### Stages

| Stage | Semantics | Record |
| --- | --- | --- |
| S0 | `BASELINE_SAVED` | Baseline after save |
| S1 | `DESTINATION_SELECT_BEFORE_PASTE` | After copy + destination select |
| S2 | `PATTERN_PASTE` | Immediately after paste + sentinel |
| S3 | `CONTROL_SWITCH` | After switch to Bank D |
| S4 | `PROJECT_SAVE` | After save + `save_operation` |
| S5 | `PROJECT_RELOAD` | After reload + post-open sentinel |

**Untouched banks:** C and D bank files must stay byte-identical across S0–S5
unless the procedure intentionally selects them.

**Do not** attribute Pattern paste `.work`/`.strd` timing to File Manager copy.

Optional harness reuse: [`scripts/pse-pattern-paste-persistence.mjs`](../../scripts/pse-pattern-paste-persistence.mjs)
after metadata schema is extended in a future PR (gap schema only).

## Experiment B — File Manager Bank file copy (Operation B)

**Goal:** Device evidence for firmware **File Manager** copying a **bank** into
another **Project**, independent of Pattern paste.

**Disposable projects:** two empty-ish projects in the same Set, e.g.
`P_FM_SRC` and `P_FM_DST`. Use unique bank sentinels on source Bank **A** and
destination Bank **D** (slot / pattern markers recorded in operator notes).

**Before copy:** record manual PDF section + verbatim quote in `capture.meta.json`
field `manual_citation` (required for `MANUAL_CONFIRMED` promotion).

**Procedure (high level — operator confirms exact menu path on hardware):**

1. Prepare source project with identifiable content on Bank A only
2. Prepare destination project with distinct sentinel on Bank D
3. Use **File Manager** (not Sequencer Copy/Paste) to copy source Bank A into
   destination project Bank D (cross-project path per manual)
4. **Do not** expect sample **audio** files to duplicate — verify AUDIO pool /
   slot assignments per runbook questions below
5. Staged saves and reloads on **destination** project only where noted

### Stages (destination-focused; source project optional S0 only)

| Stage | Semantics | Record |
| --- | --- | --- |
| S0 | `BASELINE_BOTH_PROJECTS_SAVED` | Hashes for src + dst projects (separate subfolders or dual meta) |
| S1 | `PRE_FILE_MANAGER_COPY` | Dst Bank D sentinel before copy |
| S2 | `IMMEDIATE_AFTER_FILE_MANAGER_COPY` | **Before** bank switch or Project Save |
| S3 | `AFTER_BANK_SWITCH` | Active bank not destination — observe flush |
| S4 | `AFTER_PROJECT_SAVE` | Explicit save on destination |
| S5 | `AFTER_PROJECT_RELOAD` | Reload + UI sentinel on Bank D |

**Questions Experiment B must answer (byte + UI):**

- Are destination `bankD.work` / `bankD.strd` both updated immediately or only
  after save/switch?
- Do Static/Flex **slot numbers** in the bank file match source references while
  sample **files** remain absent in destination AUDIO?
- Do untouched banks (B/C on destination) remain byte-identical S0→S5?
- Does `project.work` / `project.strd` change when only a bank file copy occurred?

**Negative contract:** `assertOperationKind` in
[`pse-bank-copy-state-doc-device-evidence.mjs`](../../scripts/pse-bank-copy-state-doc-device-evidence.mjs)
must **reject** `file_manager_bank_file_copy` (see classification contract test).

## Promotion gates

Promotion to `DEVICE_CONFIRMED` for Operation B requires:

- Continuous session (`capture_run_id` + no undocumented S3 redo)
- Manifest-verified bytes at stage roots (not nested-only paths)
- Recorded transport with confidence better than `UNKNOWN` when attributing
  `.work` vs `.strd` timing
- No contamination of source-only preconditions (cf. Phase B matrix)

Failed captures stay **REJECTED**; do not rewrite historical matrices.

## Safety

```text
BANK_COPY_APPLY_AUTHORIZED = NO
DEVICE_CAPTURE = NOT_RUN (this document)
RESULT = RUNBOOK_ONLY
```

Classification canonical source: [`PSE_BANK_COPY_OPERATION_SEMANTICS.md`](../planning/PSE_BANK_COPY_OPERATION_SEMANTICS.md).
