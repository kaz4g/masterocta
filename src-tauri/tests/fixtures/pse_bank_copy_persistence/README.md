# Cross-bank Pattern Copy/Paste receptacle

Work ID: `MO-PSE-CROSS-BANK-PATTERN-PASTE-PERSISTENCE-1`  
Legacy: `MO-PSE-BANK-COPY-PERSISTENCE-1`

Originally scaffolded as Bank Copy persistence. Scope corrected before device-evidence promotion because the observed Octatrack operation is Pattern A01 Copy, Bank B / Pattern B01 selection, then Pattern Paste. This is not Bank Copy.

```text
s0_baseline_saved/
s1_destination_selected_before_paste/
s2_after_pattern_paste/
s3_after_control_switch/
s4_after_project_save/
s5_after_project_reload/
```

Do not copy bank binaries on the Mac. Do not set `device_generated` until the operator confirms this sequence. `COPY_SAVED_CHECKPOINT_SEMANTICS` stays `UNKNOWN`.

```bash
node scripts/pse-pattern-paste-persistence.mjs status
node scripts/pse-pattern-paste-persistence.mjs analyze
node scripts/pse-pattern-paste-persistence.mjs write-manifest s0_baseline_saved
node scripts/pse-pattern-paste-persistence.mjs verify-manifest s0_baseline_saved
```
