# PSE Bank internal identity device-evidence-2 receptacle

Work ID: `MO-PSE-BANK-INTERNAL-IDENTITY-DEVICE-EVIDENCE-2`  
GitHub: [#221](https://github.com/kaz4g/masterocta/issues/221) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Disposable project: `P_BANK_ID2`. Do not reuse or overwrite `P_BANK_ID` (evidence-1).

After device Bank Copy (A → B and A → C), switch **current bank to D** (not A/B/C), save, reload if possible, save again, then copy project files into `abc_equal_current_d/` without nesting another folder.

```text
DEVICE_CAPTURE = NOT_RUN
TYPED_CONTENT_EQUAL_A_B_C = NOT_RUN
OFFSET_585459_CLASSIFICATION = CONTENT_DEPENDENT
READINESS_GAP_BANK_INTERNAL_IDENTITY = OPEN
BANK_CHANGEPLAN_READINESS = NOT_READY
RESULT = STOP_FOR_DEVICE
```

See `docs/planning/PSE_BANK_INTERNAL_IDENTITY.md` §12.

```bash
node scripts/pse-bank-identity-device-2.mjs status
node scripts/pse-bank-identity-device-2.mjs analyze
node scripts/pse-bank-identity-device-2.mjs write-manifest abc_equal_current_d
node scripts/pse-bank-identity-device-2.mjs verify-manifest abc_equal_current_d
```
