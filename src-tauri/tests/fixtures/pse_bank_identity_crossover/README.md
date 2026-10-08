# PSE Bank internal identity crossover receptacle

Work ID: `MO-PSE-BANK-INTERNAL-IDENTITY-CROSSOVER-1`  
GitHub: [#221](https://github.com/kaz4g/masterocta/issues/221) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Disposable projects only: `P_BANK_XA` and `P_BANK_XB`. Do not reuse a live project, and do not modify `pse_bank_identity_device/` or `pse_bank_identity_device_2/`.

The four directories hold the 2026-10-08 device copies. Reviewed result is `STOP_WITH_FINDINGS`: Run A changes `patterns` on Bank B and Bank C together and keeps B/C equal; Run B leaves all compared bank bytes unchanged (`RUN_B_COPY_EFFECT_OBSERVED = NO`). Bank D supplies runtime negative control. Absolute slot comparison passes with no stable field. Offset 585459 stays content-dependent. `#221` stays open.

```text
run_a_pre/    P_BANK_XA before copy, current bank D
run_a_post/   P_BANK_XA after A→B then A→C, current bank D
run_b_pre/    P_BANK_XB before copy, current bank D
run_b_post/   P_BANK_XB after A→C then A→B, current bank D
```

Copy banks on the device only. Do not `cp` `bank01.work` onto `bank02.work` or `bank03.work` on the Mac.

Each capture directory stays flat (no nested project folder) and, once captured, holds:

```text
capture.meta.json
project.work
project.strd
bank01.work … bank04.strd
SHA256SUMS.json
```

`[STATES]` must contain exactly one `BANK=3` (UI D). Offset 585459 remains content-dependent.

```bash
node scripts/pse-bank-identity-crossover.mjs status
node scripts/pse-bank-identity-crossover.mjs analyze
node scripts/pse-bank-identity-crossover.mjs write-manifest run_a_pre
node scripts/pse-bank-identity-crossover.mjs verify-manifest run_a_pre
```

`BANK_CHANGEPLAN_READINESS` stays `NOT_READY`. This receptacle does not implement Bank Copy / Move / Swap.
