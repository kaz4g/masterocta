# PSE Bank internal identity device-evidence receptacle

Work ID: `MO-PSE-BANK-INTERNAL-IDENTITY-DEVICE-EVIDENCE-1`  
GitHub: [#221](https://github.com/kaz4g/masterocta/issues/221) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Disposable project: `P_BANK_ID` on Octatrack MkII. Do not reuse a live project
or the Bank-evidence project `P_TEST`.

No device copy is in this directory yet.

```text
DEVICE_CAPTURE = NOT_RUN
SAME_CONTENT_DIFFERENT_SLOT_DEVICE_EVIDENCE = ABSENT
BANK_INTERNAL_IDENTITY = UNKNOWN
READINESS_GAP_BANK_INTERNAL_IDENTITY = OPEN
BANK_CHANGEPLAN_READINESS = NOT_READY
```

Offset `585459` stays the unresolved raw candidate from `P_TEST`. This
receptacle does not classify it, and it does not copy bank binaries on the Mac.

## Device steps

1. On the Octatrack, create a new project named `P_BANK_ID`.
2. Put a small identifiable pattern on Bank A. Use the device Bank copy to
   copy that whole bank onto Bank B. Do not rebuild Bank B by hand.
3. Capture 1: current bank A, save with the device's normal project save, then
   copy the project directory contents into `bank_ab_current_a/`.
4. Capture 2: do not edit the music. Switch the current bank to B, save again,
   and copy into `bank_ab_current_b/` as a separate tree.
5. Optional capture 3: device-copy the same Bank A content onto Bank C, save,
   and copy into `bank_abc_slot_c/`.

Copy directory contents next to `capture.meta.json`. Do not nest another
project folder. Do not delete `capture.meta.json`.

## After the copy

Fill only the blank operator fields. Set `device_generated` and
`same_content_different_slot_evidence` to `true` only after that copy exists.
Leave `synthetic_modification` at `false` and `content_edited_after_copy` at
`false`. Record `os_version` from the copied `project.work` `OS_VERSION`
field. If a menu label is unclear, write that in `copy_operation`,
`save_operation`, or `operator_note`. Do not guess a label.

Do not record the card mount path or any absolute machine path.

Minimum tracked files in each capture:

- `project.work`, `project.strd`
- `bank01.work`, `bank01.strd`
- `bank02.work`, `bank02.strd`

Capture 3 also needs `bank03.work` and `bank03.strd`. Other copied files stay
untracked.

```bash
node scripts/pse-bank-identity-device.mjs status
node scripts/pse-bank-identity-device.mjs inspect bank_ab_current_a
node scripts/pse-bank-identity-device.mjs write-manifest bank_ab_current_a
node scripts/pse-bank-identity-device.mjs verify-manifest bank_ab_current_a
```

`write-manifest` writes `SHA256SUMS.json` only, and refuses a symlink or other
non-regular destination. Inspection does not modify bank or project bytes.
