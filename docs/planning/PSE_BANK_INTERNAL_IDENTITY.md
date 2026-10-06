# Bank internal identity evidence

Work ID: `MO-PSE-BANK-REAL-DEVICE-FIXTURE-1`  
Companion: [PSE_BANK_MULTI_DEVICE_EVIDENCE.md](./PSE_BANK_MULTI_DEVICE_EVIDENCE.md)

## Question

When Copy / Move / Swap ChangePlan is built, must the plan rewrite a **bank slot number inside** `bankNN.work` / `bankNN.strd` bytes, or is **filename** (`bank01`–`bank16`) the only stable identity the read model uses today?

## PSE read model (code fact)

- [`project_structure_reader.rs`](../../src-tauri/src/project_structure_reader.rs) discovers banks by **filename** and `BankIndex` from `NN` in `bankNN.work` / `bankNN.strd`.
- [`BankIndex`](../../src-tauri/crates/ot-domain/src/project_structure.rs) maps UI letter `A` → index `0` → file number `01`.

No second identity is decoded into `BankStructure` today.

## Pinned `ot-tools-io` `BankFile` (struct audit)

Source: git rev `cd246d8…` (`ot-tools-io/src/banks.rs`).

| Field | Role |
| --- | --- |
| `header` | Fixed 21-byte bank header |
| `datatype_version` | Format version |
| `patterns` | Pattern array payload |
| `parts` | Part payload |
| `parts_saved_state` | Part saved flags |
| `parts_edited_bitmask` | Part edited flags |
| `part_names` | Part names |
| `checksum` | File checksum |

There is **no** serde field named bank index, bank number, or slot identity duplicate of the filename.

## Judgment (without multi-bank device captures)

```text
BANK_INTERNAL_IDENTITY = NOT_OBSERVED
```

Interpretation:

- **Not** `PROVEN_ABSENT` globally (unknown bytes outside the typed struct may exist).
- **Not** `PROVEN_PRESENT` (no field with demonstrated slot identity semantics).
- Multi-bank **device-generated** captures are required to compare `bank01.*` vs `bank02.*` content and optional device Bank Copy (#21 in work unit) before upgrading to `PROVEN_*`.

## Experiments still required

1. Labeled Bank A vs Bank B fixtures with distinct Track 1 slot/machine markers.
2. Optional: device UI Bank Copy A→B, then byte-compare whether non-content identity bytes change.
3. If a candidate byte run correlates with slot across captures **and** content edits are ruled out, document provenance and still avoid naming it “bank number” until operationally verified.

## ChangePlan impact (unchanged)

[`PSE_BANK_MUTATION_SAFETY_CONTRACT.md`](./PSE_BANK_MUTATION_SAFETY_CONTRACT.md): do not assume destination bank bytes equal source after copy. `ReadinessGap::BankInternalIdentity` stays open in `ReadinessEvidence::current_main()` until reviewed closure.
