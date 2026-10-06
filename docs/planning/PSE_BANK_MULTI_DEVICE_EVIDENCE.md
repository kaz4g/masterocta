# Real-device multi-Bank fixture evidence

Work ID: `MO-PSE-BANK-REAL-DEVICE-FIXTURE-1`  
GitHub: [#219](https://github.com/kaz4g/masterocta/issues/219) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

Related: [#217](https://github.com/kaz4g/masterocta/issues/217) Working / SavedCheckpoint semantics, [#204](https://github.com/kaz4g/masterocta/issues/204) Arrangement, [#210](https://github.com/kaz4g/masterocta/issues/210) RecorderBuffer (historical).

## Judgment (current)

```text
WORK_ID = MO-PSE-BANK-REAL-DEVICE-FIXTURE-1

BASE_SHA = 83b128d499d06f42576b21b8aee97aacdb31659f

HEAD_SHA = (see branch evidence/pse-bank-real-device-fixture-1)

DEVICE = Octatrack MkII (declared; capture pending)

OS = PENDING

DISPOSABLE_PROJECT = REQUIRED_NOT_YET_RECORDED

CAPTURE_A = PENDING
CAPTURE_B = PENDING
CAPTURE_C = PENDING
WORKING_DIVERGENCE_CAPTURE = PENDING
AFTER_SAVE_CAPTURE = PENDING

UI_BANK_A_RAW = UNKNOWN
UI_BANK_B_RAW = UNKNOWN
UI_PATTERN_MAPPING = UNKNOWN

BANK_FILENAME_MAPPING = UNKNOWN

BANK_INTERNAL_IDENTITY = NOT_OBSERVED

WORKING_ROLE = PARTIAL
SAVED_CHECKPOINT_ROLE = PARTIAL

WORK_STRD_FALLBACK = FORBIDDEN

FIXTURE_NO_WRITE = PASS (protocol + tests; no capture bytes committed)

ISSUE_217 = OPEN

BANK_CHANGEPLAN_READINESS = NOT_READY

REMAINING_BLOCKERS = #204 Arrangement file slot; Arranger pattern_id; Scene/Recorder; active Move/Swap retarget; multi-bank UI↔filename mapping; bank internal identity under multi-slot device evidence

CI = (run on PR)

PROJECT_STRUCTURE_CI = (run on PR)

RESULT = STOP_WITH_FINDINGS
REASON = Device captures not committed; only acquisition protocol, manifest tooling, and gated tests landed.
```

## What exists today (baseline, not multi-bank proof)

| Source | Multi-bank? | Notes |
| --- | --- | --- |
| `real_device/` | **No** (bank01 only) | CF copy OS 1.40B; `BANK=0` / `PATTERN=0`; bank01.work ≠ bank01.strd bytes |
| `multipart/` | **No** | Synthetic single bank |
| `pse_bank_multi_device/` | **Pending** | Protocol in [README](../../src-tauri/tests/fixtures/pse_bank_multi_device/README.md) |

Prior single-bank observations support **PARTIAL** Working/SavedCheckpoint (separate files, byte difference on `real_device`) but not Save choreography or multi-slot mapping. See [PSE_BANK_STATE_DOC_SEMANTICS.md](./PSE_BANK_STATE_DOC_SEMANTICS.md).

## When captures commit (operator checklist)

1. Perform captures on disposable project only; record exact UI Save steps in `capture.meta.json`.
2. Copy each capture tree under `src-tauri/tests/fixtures/pse_bank_multi_device/<label>/`.
3. Run `node scripts/pse-bank-multi-device-manifest.mjs write <label>` per directory.
4. Fill tables below from Mac-side read-only analysis (no byte editing).
5. Update `ACQUISITION_STATUS.json` `result` to `PASS` only if A/B/C minimum and mapping proofs succeed.
6. Re-run `cargo test --test pse_bank_multi_device` and full PSE CI.

## Capture analysis template (fill per directory)

| Capture | `[STATES] BANK` | `[STATES] PATTERN` | bank files present | Notes |
| --- | --- | --- | --- | --- |
| bank_a_active | _pending_ | _pending_ | _pending_ | |
| bank_b_active | _pending_ | _pending_ | _pending_ | |
| bank_b_pattern_4 | _pending_ | _pending_ | _pending_ | |
| bank_a_working_diverged | _pending_ | _pending_ | _pending_ | |
| bank_a_after_save | _pending_ | _pending_ | _pending_ | |

## Mapping conclusions (pending device evidence)

| Claim | Status |
| --- | --- |
| UI Bank A → zero-based `BANK` raw | **UNKNOWN** |
| UI Bank B → zero-based `BANK` raw | **UNKNOWN** |
| UI Pattern N → zero-based `PATTERN` raw | **UNKNOWN** (existing code assumes zero-based; only bank01 + pattern0 on `real_device`) |
| UI Bank A → `bank01.*` filename | **UNKNOWN** |
| UI Bank B → `bank02.*` filename | **UNKNOWN** |

## Working / SavedCheckpoint (E/F pending)

| Observation | Status |
| --- | --- |
| Device Save updates `.strd` | **UNKNOWN** (needs Capture F vs E) |
| Working edit without Save leaves `.work` ≠ `.strd` | **UNKNOWN** (needs Capture E with provenance) |
| `.strd` always present per bank | **UNKNOWN** |

Do not generalize from a single `real_device` snapshot.

## #181 / #217 impact

- Does **not** set `BANK_CHANGEPLAN_READINESS = READY`.
- Does **not** close [#217](https://github.com/kaz4g/masterocta/issues/217) until labeled multi-bank captures prove Save/Working semantics beyond `real_device`.
- When `BANK_FILENAME_MAPPING` and `BANK_INTERNAL_IDENTITY` become proven, update [PSE_READ_MODEL_EXIT_AUDIT.md](./PSE_READ_MODEL_EXIT_AUDIT.md) §7C narrative and consider narrowing `ReadinessGap::BankInternalIdentity` only with reviewed evidence + pinned test changes.

## Safety

```text
WRITE = NO (during CI tests; manifest script writes SHA256SUMS.json sidecar only when operator runs it)
APPLY = NO
SYNTHETIC_BANK_EDIT = FORBIDDEN
```
