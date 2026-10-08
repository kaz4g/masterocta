# PSE Bank Copy persistence evidence

Work ID: `MO-PSE-BANK-COPY-PERSISTENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Related: [#221](https://github.com/kaz4g/masterocta/issues/221) (unchanged), [#226](https://github.com/kaz4g/masterocta/pull/226) crossover copy gate lesson

Disposable project: **`P_BANK_PERSIST`** on Octatrack MkII. Roles: **A** source, **B** destination, **C** untouched, **D** control. Do not reuse a live project.

## Current judgment

| Field | Value |
| --- | --- |
| `HARNESS` | `READY` |
| `DEVICE_CAPTURE` | `WAITING_FOR_REAL_DEVICE` |
| `PERSISTENCE_JUDGMENT` | `NOT_RUN` |
| `COPY_SAVED_CHECKPOINT_SEMANTICS` | `UNKNOWN` |
| `#217` | `OPEN` |
| `BANK_CHANGEPLAN_READINESS` | `NOT_READY` |
| `RESULT` | `WAITING_FOR_REAL_DEVICE` |

No device bytes are committed yet. Template-only `capture.meta.json` files stay `device_generated: false`.

## Capture stages (S0–S5)

Perform one transition between stages, then copy the flat project directory from the mounted CF card (or approved transport) into the matching fixture folder.

| Stage | Directory | Prior transition |
| --- | --- | --- |
| S0 | `s0_baseline_saved` | (saved baseline) |
| S1 | `s1_after_copy` | `COPY` (A → B) |
| S2 | `s2_after_destination_switch` | `DESTINATION_SWITCH` (select bank B) |
| S3 | `s3_after_control_switch` | `CONTROL_SWITCH` (select bank D) |
| S4 | `s4_after_project_save` | `PROJECT_SAVE` |
| S5 | `s5_after_project_reload` | `PROJECT_RELOAD` |

Each capture directory must contain:

```text
capture.meta.json
project.work
project.strd
bank01.work … bank04.strd
SHA256SUMS.json   (via write-manifest after copy)
```

## Sentinel and copy-success gate

Before persistence labels run, the harness requires:

1. **S0** metadata: `source_sentinel_present_a` confirms the source edit marker on bank A; `dest_sentinel_present_b` confirms bank B has **no** marker yet.
2. **S2** metadata: `destination_ui_sentinel` = `PRESENT` (UI-visible copy effect on destination).

If the gate fails, `COPY_COMMAND_EFFECT = UNCONFIRMED`, `PERSISTENCE_JUDGMENT = NOT_RUN`, and `RESULT = STOP_WITH_FINDINGS` (same discipline as unconfirmed copy on crossover Run B).

Record `destination_ui_sentinel_after_reload` on **S5** for `COPY_SURVIVES_PROJECT_RELOAD`. Leave unrecorded values as `null` / `UNKNOWN`; do not infer firmware rules.

## Transport confounding

Document `capture_transport`, `capture_required_mode_change`, and `capture_may_flush_device_state` on every stage after measurement. While any remain `unknown`, `COPY_SAVED_CHECKPOINT_SEMANTICS` stays **`UNKNOWN`** and this work must **not** emit `CLOSE_REVIEW` for #217.

## Analysis commands

```bash
node scripts/pse-bank-copy-persistence.mjs status
node scripts/pse-bank-copy-persistence.mjs analyze
node scripts/pse-bank-copy-persistence.mjs write-manifest s0_baseline_saved
node scripts/pse-bank-copy-persistence.mjs verify-manifest s0_baseline_saved
```

Fixture root: `src-tauri/tests/fixtures/pse_bank_copy_persistence/`.

Rust typed deltas (destination bank B only) live in `src-tauri/src/pse_bank_copy_persistence.rs` (`cfg(test)`). JS owns transition matrices and persistence labels; Rust owns BankFile PRE/POST fields once `device_generated: true` banks exist.

## Non-goals

- No Bank Copy / Move / Swap Apply, encoder, or writer enablement.
- No change to `#221` identity closure or `BANK_CHANGEPLAN_READINESS`.
- No generalization of Working/SavedCheckpoint until six verified captures, gate pass, UI reload notes, work/strd timing, and transport limits are recorded.
