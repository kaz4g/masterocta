# PSE Bank file copy — device acceptance runbook (operator)

Work ID: `MO-PSE-BANK-FILE-COPY-DEVICE-CAPTURE-1`  
Harness: [`scripts/pse-bank-file-copy-device-capture.mjs`](../../scripts/pse-bank-file-copy-device-capture.mjs)  
Parent reconciliation: [`PSE_BANK_COPY_OPERATION_SEMANTICS.md`](../planning/PSE_BANK_COPY_OPERATION_SEMANTICS.md)

**Read-only operator runbook.** The repository does not run Octatrack steps for you. Use
**disposable** projects only. Never capture from irreplaceable media.

Do **not** reuse capture roots `P_BANK_COPY_STATE` or `P_BANK_PERSIST`. Do **not**
store File Manager evidence under `masterocta.pse-bank-copy-state-doc-capture:v1`
(`operation_kind` must remain `pattern_copy_paste` / legacy `NATIVE_BANK_COPY`
only).

## Reserved metadata schemas

| Experiment | `capture.meta.json` schema | `operation_kind` |
| --- | --- | --- |
| A — Pattern paste gaps | `masterocta.pse-pattern-paste-gap-capture:v1` | `pattern_copy_paste` |
| B — File Manager bank file copy | `masterocta.pse-bank-file-copy-device-capture:v1` | `file_manager_bank_file_copy` |

## Capture root layout (Operation B)

Use a **new local directory outside the git repository**, for example:

```text
~/octa-captures/P_FM_BANK_COPY_1/
```

Each stage is one subdirectory. Inside every stage:

```text
<capture-root>/<stage>/
  capture.meta.json
  SHA256SUMS.json          # after write-manifest
  source/                  # project P_FM_SRC bytes
    project.work
    project.strd
    bank01.work … bank04.strd
  destination/             # project P_FM_DST bytes
    project.work
    project.strd
    bank01.work … bank04.strd
```

Optional power-cycle control (recommended when transport is uncertain):

```text
<capture-root>/control_s0_power_cycle/
  source/ … destination/ …
  capture.meta.json
  SHA256SUMS.json
```

Repository empty receptacle (no device bytes):  
`src-tauri/tests/fixtures/pse_bank_file_copy_device/`

## CLI (read-only except write-manifest)

```bash
CAPTURE_ROOT=~/octa-captures/P_FM_BANK_COPY_1

node scripts/pse-bank-file-copy-device-capture.mjs status "$CAPTURE_ROOT"
node scripts/pse-bank-file-copy-device-capture.mjs analyze "$CAPTURE_ROOT"
node scripts/pse-bank-file-copy-device-capture.mjs verify-manifest s2_immediately_after_file_manager_copy "$CAPTURE_ROOT"
node scripts/pse-bank-file-copy-device-capture.mjs dataset "$CAPTURE_ROOT"

# Writes SHA256SUMS.json only — explicit non-repo root required
node scripts/pse-bank-file-copy-device-capture.mjs write-manifest s0_baseline_both_projects_saved "$CAPTURE_ROOT"
```

`status` on an empty root reports `CAPTURE_STATUS = WAITING_FOR_OPERATOR_CAPTURE`.
That is **not** `DEVICE_CAPTURE = PASS`.

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
  labels, e.g. `D01` not bare `01`)
- `SHA256SUMS.json` per stage (hash **all** compared project/bank documents under
  `source/` and `destination/`)

Compared files (minimum per side): `project.work`, `project.strd`, `bank01`–`bank04`
`.work`/`.strd`. If the copy touches another bank stem (`bank05` … `bank16`), add
those files and record `actual_source_filename` / `actual_destination_filename`.

Power-cycle control: immediately after S0, power off, remove CF, copy **both**
projects’ compared files into `control_s0_power_cycle/`, reinsert, power on, do
nothing else, then `write-manifest control_s0_power_cycle`. If any hash differs
from S0, **STOP** and record transport as mutating (`MAY_FLUSH` / `UNKNOWN`).

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

**Goal:** Device evidence for firmware **File Manager** copying **bank files**
between disposable projects `P_FM_SRC` and `P_FM_DST`, independent of Pattern
paste.

**Disposable projects:** two projects in the same Set, e.g. `P_FM_SRC` and
`P_FM_DST`. Use identifiable sentinels on source Bank **A** (`bank01`) and
destination Bank **D** (`bank04`) unless the device menu requires same-name copy
first (record `actual_*_filename` accordingly).

**Manual citation:** keep `manual_citation.status = UNKNOWN` until you record
PDF edition, section, page, URL, and a verbatim quote from the Elektron manual.
Do not promote File Manager cross-project claims to `MANUAL_CONFIRMED` from issue
text alone.

**Menu path:** `OPERATOR_CONFIRMATION_REQUIRED` — record the exact File Manager
path in `copy_menu_path` after hardware verification.

### Stages

| Stage | Directory | Semantics | Record |
| --- | --- | --- | --- |
| S0 | `s0_baseline_both_projects_saved` | `BASELINE_BOTH_PROJECTS_SAVED` | Both projects saved; hashes for `source/` + `destination/` |
| S1 | `s1_after_file_manager_entry_pre_copy` | `FILE_MANAGER_ENTRY_PRE_COPY` | After File Manager entry / sync; **before** copy |
| S2 | `s2_immediately_after_file_manager_copy` | `IMMEDIATE_FILE_MANAGER_BANK_FILE_COPY` | Immediately after COPY/PASTE; **before** bank switch or save |
| S3 | `s3_after_bank_switch` | `AFTER_BANK_SWITCH` | Active bank not destination; `bank_switch_operation` |
| S4 | `s4_after_destination_project_save` | `DESTINATION_PROJECT_SAVE` | Explicit save on **destination** project only |
| S5 | `s5_after_destination_project_reload` | `DESTINATION_PROJECT_RELOAD` | Reload + UI sentinel on destination Bank D |

S0 and S1 are **separate** captures: File Manager entry may change project bytes.
Classify S0→S1 diffs as File Manager entry sync (`file_manager_entry_operation`
and/or `file_manager_entry_sync_observed`).

If S2 bytes require File Manager exit, power-off, or CF removal, record that in
`operator_note` and transport fields. Without non-mutating transport proof, treat
S1→S2 copy timing as **INCONCLUSIVE** (do not infer from hash change alone).

If copy target filenames differ only because Bank A→D maps to `bank01`→`bank04`,
that is **not** a separate RENAME. Record a distinct `rename_operation` only when
the device performed an explicit rename step (COPY and RENAME are separate
operations).

Post-copy stages S3–S5 must share the same `capture_run_id` and set
`continues_from_previous_stage = yes`. Do **not** splice stages from another
session into one experiment.

### Questions Experiment B must answer (byte + UI)

- Are destination `bankD.work` / `bankD.strd` updated immediately or only after
  switch/save/reload?
- Do Static/Flex **slot numbers** in the bank file match source references while
  sample **audio** files remain absent in destination AUDIO? (Record dedicated
  observation fields — do not infer from bank hashes alone.)
- Do untouched banks on **destination** remain byte-identical S0→S5?
- Does `destination/project.work` / `project.strd` change when only a bank file
  copy occurred?

### STOP conditions

- Missing or mismatched `capture_run_id` across S0–S5
- Manifest missing, stale, or extra files not listed in `SHA256SUMS.json`
- Source project bytes change after S0 (unexpected mutation on `P_FM_SRC`)
- Symlink, non-regular file, or path escape under the capture root
- Transport `UNKNOWN` when attributing immediate copy timing
- Power-cycle control mismatch vs S0
- Undocumented RENAME (copy text mentions rename but `rename_operation` empty)
- Mixing Operation A capture schema or `NATIVE_BANK_COPY` metadata

**Negative contract:** [`pse-bank-copy-state-doc-device-evidence.mjs`](../../scripts/pse-bank-copy-state-doc-device-evidence.mjs)
must **reject** `file_manager_bank_file_copy` (classification contract test).

## Promotion gates

Promotion to `DEVICE_CONFIRMED` for Operation B requires **future** owner review
after a full device capture. This harness keeps `DEVICE_EVIDENCE_PROMOTION =
BLOCKED` until then.

Minimum structural gates (synthetic fixtures never satisfy device promotion):

- Continuous session (`capture_run_id` + S3–S5 continuity)
- Manifest-verified bytes at stage roots
- Recorded transport with `NON_MUTATING_CONFIRMED` when attributing S1→S2 copy
- No source-project contamination after baseline
- Documented File Manager entry sync on S1

Failed captures stay **REJECTED**; do not rewrite historical matrices or old
captures.

## Safety

```text
BANK_COPY_APPLY_AUTHORIZED = NO
DEVICE_CAPTURE = NOT_RUN (until operator executes Experiment B)
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RESULT = RUNBOOK_READY_FOR_OPERATOR
```

Classification canonical source: [`PSE_BANK_COPY_OPERATION_SEMANTICS.md`](../planning/PSE_BANK_COPY_OPERATION_SEMANTICS.md).

Next work ID after harness merge: `MO-PSE-BANK-FILE-COPY-DEVICE-EXECUTE-1` (operator
device capture using this runbook).
