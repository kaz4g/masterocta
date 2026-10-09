# Cross-bank Pattern Copy/Paste persistence

Work ID: `MO-PSE-CROSS-BANK-PATTERN-PASTE-PERSISTENCE-1`  
Legacy work ID: `MO-PSE-BANK-COPY-PERSISTENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
PR: [#227](https://github.com/kaz4g/masterocta/pull/227)

Originally scaffolded as `MO-PSE-BANK-COPY-PERSISTENCE-1`. Scope corrected before device-evidence promotion because the observed Octatrack operation is cross-bank Pattern Copy/Paste, not Bank Copy.

Disposable project: **`P_BANK_PERSIST`**. Operation:

1. Pattern **A01** Copy to clipboard
2. Select Bank **B** / Pattern **B01** (before paste)
3. Pattern Paste
4. Switch to control bank **D**
5. Explicit project save
6. Project reload, then capture files, then open B/B01 only to record the UI sentinel

This does not prove native Bank Copy. `COPY_STATE_DOC_RULE` stays **BLOCKED**. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **UNKNOWN**. `#217` and `#221` stay **OPEN**. `BANK_CHANGEPLAN_READINESS` stays **NOT_READY**.

## Stages

| Stage | Directory | Transition into the stage |
| --- | --- | --- |
| S0 | `s0_baseline_saved` | `BASELINE_SAVED` |
| S1 | `s1_destination_selected_before_paste` | `DESTINATION_SELECT_BEFORE_PASTE` |
| S2 | `s2_after_pattern_paste` | `PATTERN_PASTE` |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` |

S0→S1 includes clipboard copy plus destination selection. It is not a pure bank switch and it is not Bank Copy.

S5 binaries are captured immediately after reload, before opening Bank B to check the sentinel. Record `destination_ui_sentinel_after_reload` in metadata after that UI check, then rebuild the manifest.

## Promotion

`device_generated` stays false until the operator confirms the capture sequence, OS, sentinels, transport, and a rebuilt manifest. File bytes alone are not reclassified. While sequence provenance is unproven and compared files are already on disk, status is `STOP_FOR_OPERATOR_CONFIRMATION` and `DEVICE_EVIDENCE_PROMOTION = BLOCKED`.

## Commands

```bash
node scripts/pse-pattern-paste-persistence.mjs status
node scripts/pse-pattern-paste-persistence.mjs analyze
node scripts/pse-pattern-paste-persistence.mjs write-manifest s0_baseline_saved
node scripts/pse-pattern-paste-persistence.mjs verify-manifest s0_baseline_saved
```

Fixture root remains `src-tauri/tests/fixtures/pse_bank_copy_persistence/` so existing local copies can be renamed in place. Schema is `masterocta.pse-pattern-paste-persistence-capture:v1`.
