# Bank internal identity evidence

Work ID: `MO-PSE-BANK-INTERNAL-IDENTITY-1`  
GitHub: [#221](https://github.com/kaz4g/masterocta/issues/221) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))  
Companion: [PSE_BANK_MULTI_DEVICE_EVIDENCE.md](./PSE_BANK_MULTI_DEVICE_EVIDENCE.md) ([#219](https://github.com/kaz4g/masterocta/issues/219))

## 1. Question

When Copy / Move / Swap ChangePlan is built, must the plan rewrite a **bank slot number inside** `bankNN.work` / `bankNN.strd` bytes, or is **filename** (`bank01`–`bank16`) the only stable identity the read model uses today?

## 2. Evidence baseline

| Field | Value |
| --- | --- |
| `BASE_SHA` | `3639a1780d40234a1ad302a4de650980db78bf19` |
| Fixture set | A/B/C/E/F under `pse_bank_multi_device/` (Capture D `NOT_RUN`) |
| Device | Octatrack MkII OS 1.40 (R0173), disposable `P_TEST` |
| Pinned `ot-tools-io` | git rev `cd246d8a595647364eb4cc78211033b2d1302526` |
| Read-only tooling | [`scripts/pse-bank-internal-identity-audit.mjs`](../../scripts/pse-bank-internal-identity-audit.mjs), [`pse_bank_internal_identity_audit.rs`](../../src-tauri/src/pse_bank_internal_identity_audit.rs) |

PSE read model discovers banks by **filename** ([`project_structure_reader.rs`](../../src-tauri/src/project_structure_reader.rs)); no second identity is decoded into `BankStructure`.

## 3. Fixture matrix

Each committed capture includes `project.work/strd`, `bank01.work/strd`, `bank02.work/strd` (636113 bytes per bank file on P_TEST).

| Capture | `bank01.work` | `bank01.strd` | `bank02.work` | `bank02.strd` |
| --- | --- | --- | --- | --- |
| A `bank_a_active` | `f9cac541…cb0c` | same as `.work` | `0030470e…10c1` | same as `.work` |
| B `bank_b_active` | `27303716…072f` | same | `d073ab40…2749` | same |
| C `bank_b_pattern_4` | same as B | same | `5ebcdc6a…9f65` | same |
| E `bank_a_working_diverged` | same as B/C | same | `df8e24d8…01a` | same |
| F `bank_a_after_save` | `573643a0…14c1` | same | same as E | same |

Transition files that changed (SHA-256):

| Step | Changed bank/project files |
| --- | --- |
| A→B | all four bank files |
| B→C | `bank02.work`, `bank02.strd` |
| C→E | `bank02.work`, `bank02.strd` |
| E→F | `bank01.work`, `bank01.strd` |

## 4. Parser field audit

Source: `ot-tools-io/src/banks.rs` at pin `cd246d8…`.

| Field | Role |
| --- | --- |
| `header` | 21-byte constant `BANK_HEADER` |
| `datatype_version` | `u8` (`BANK_FILE_VERSION = 23`) |
| `patterns` | Pattern array payload |
| `parts` | Part payload (saved + unsaved) |
| `parts_saved_state` | 4 bytes |
| `parts_edited_bitmask` | `u8` |
| `part_names` | 4 × 7 bytes |
| `checksum` | `u16`; payload sum skips first 20 serialized bytes and last 2 |

There is **no** serde field named bank index, bank number, or slot identity duplicate of the filename.

```text
PARSER_INTERNAL_BANK_ID_FIELD = ABSENT
```

Serializer: `BankFile::encode()` recomputes checksum over bincode-serialized payload; entire file is consumed by the typed struct (no trailing unknown blob on 636113-byte fixtures).

## 5. Raw byte comparison

| Observation | Classification |
| --- | --- |
| `bank01.work` ≠ `bank02.work` in every capture | **CONTENT_DEPENDENT** (Bank A vs B distinguishing content on P_TEST) |
| Headers byte-identical across bank01/bank02 | **KNOWN_HEADER** |
| Last two bytes differ with content edits | **CHECKSUM_DERIVED** |
| `bank01` bytes varying across A/B/C/E/F | 6 offsets (includes checksum byte); Save on F updates `bank01` |
| `bank02` bytes varying across captures | 12 offsets (pattern edit on C, session drift, checksum) |
| Any `bank01.*` byte-equal to `bank02.*` in same capture | **No** |

Same-slot temporal comparison shows content and Save drive byte changes; no offset stays fixed for a slot while unrelated content changes elsewhere in a way that would support immutable slot identity.

## 6. Candidate offsets

Strict search: offset where all `bank01.work` shares one value and all `bank02.work` shares another, across A/B/C/E/F.

| Offset | bank01 | bank02 | Raw label |
| --- | --- | --- | --- |
| 585459 | `0x40` (64) | `0x6c` (108) | `SLOT_CORRELATED_CANDIDATE` |

This is the **only** raw candidate. It was **not** promoted to slot identity.

## 7. Candidate elimination

| Check | Result for offset 585459 |
| --- | --- |
| Header constant region | No (offset in part/pattern payload band ~585k) |
| Checksum | No |
| Temporal variance within ±32 bytes on bank01 | Yes (`585471`, `585727`–`585730` vary on Save/session) |
| Temporal variance within ±32 bytes on bank02 | Yes (`585461`, `585471`, … vary on pattern Save) |
| Typed parser field with operational slot semantics | No |

After elimination:

```text
SLOT_CORRELATED_CANDIDATES_SURVIVING = (none)
```

## 8. Limitations

```text
SAME_CONTENT_DIFFERENT_SLOT_DEVICE_EVIDENCE = ABSENT
```

No capture shows identical bank bytes in `bank01.*` and `bank02.*`. P_TEST meta documents distinct Bank A vs Bank B content; device Bank Copy with identical payload into two slots was not performed.

Working/SavedCheckpoint ([#217](https://github.com/kaz4g/masterocta/issues/217)) remains **OPEN**; E/F observations are not reinterpreted here.

Optional serializer roundtrip on TempDir was **not required**: the sole raw candidate was eliminated before identity semantics; roundtrip would not prove device slot identity.

## 9. Judgment

```text
BANK_INTERNAL_IDENTITY = NOT_OBSERVED
```

- **Not** `PROVEN_PRESENT` (no field or byte with demonstrated slot identity semantics).
- **Not** `PROVEN_ABSENT` (full-byte semantic map plus same-content/different-slot device proof is not available).
- **Not** `UNKNOWN` (parser coverage is complete for file length; unexplained slot-correlated bytes do not survive elimination).

```text
READINESS_GAP_BANK_INTERNAL_IDENTITY = OPEN
```

Do not close `ReadinessGap::BankInternalIdentity` without owner review, contract update, and pinned tests.

## 10. #181 impact

```text
BANK_CHANGEPLAN_READINESS = NOT_READY
```

No internal identity rewrite can currently be justified. Fail-closed readiness gap remains unless an owner accepts a filename-only contract.

Remaining blockers unchanged: #204 Arrangement mapping, Arranger `pattern_id`, Scene / Recorder, Working/SavedCheckpoint rule, active Move/Swap retarget, and this gap while open.

```text
WRITE = NONE
FIXTURE_NO_WRITE = PASS (audit reads only; PRE == POST)
RESULT = PASS
```
