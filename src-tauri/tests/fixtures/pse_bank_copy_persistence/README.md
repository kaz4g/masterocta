# PSE Bank Copy persistence receptacle

Work ID: `MO-PSE-BANK-COPY-PERSISTENCE-1`  
GitHub: [#217](https://github.com/kaz4g/masterocta/issues/217) (Working / SavedCheckpoint; child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Disposable project only: `P_BANK_PERSIST`. Do not reuse a live project. Do not modify `pse_bank_identity_crossover/` or other identity fixtures.

Six stages observe Bank Copy persistence boundaries on Octatrack MkII. Until real-device bytes are captured, only `capture.meta.json` templates are committed (`device_generated: false`, `WAITING_FOR_REAL_DEVICE`).

```text
s0_baseline_saved/           saved baseline before copy
s1_after_copy/               after A → B copy
s2_after_destination_switch/ after switching to destination bank B
s3_after_control_switch/     after switching to control bank D
s4_after_project_save/       after project save
s5_after_project_reload/     after project reload
```

Copy banks on the device only. Do not `cp` bank files on the Mac.

Each capture directory stays flat and, once captured, holds:

```text
capture.meta.json
project.work
project.strd
bank01.work … bank04.strd
SHA256SUMS.json
```

`[STATES]` must contain exactly one `BANK=` and one `PATTERN=` between `[/STATES]`. Read values from files; do not embed expected states in metadata.

```bash
node scripts/pse-bank-copy-persistence.mjs status
node scripts/pse-bank-copy-persistence.mjs analyze
node scripts/pse-bank-copy-persistence.mjs write-manifest s0_baseline_saved
node scripts/pse-bank-copy-persistence.mjs verify-manifest s0_baseline_saved
```

`BANK_CHANGEPLAN_READINESS` stays `NOT_READY`. `#217` / `COPY_SAVED_CHECKPOINT_SEMANTICS` stay open until six verified device captures and the copy-success gate pass. This receptacle does not implement Bank Copy / Move / Swap Apply.
