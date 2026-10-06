# PSE multi-Bank real-device fixtures

Work ID: `MO-PSE-BANK-REAL-DEVICE-FIXTURE-1`  
GitHub: [#219](https://github.com/kaz4g/masterocta/issues/219) (child of [#181](https://github.com/kaz4g/masterocta/issues/181))

## Disposable project declaration

- Use only a **copied** test project on Octatrack media, never the operator’s original library project.
- Recommended project label: `MASTER_OCTA_PSE_FIXTURE` (or clearly marked disposable name).
- Original production projects and CF cards: **READ ONLY** on the Mac side.

## Device (fill on first capture)

| Field | Value |
| --- | --- |
| Device | Octatrack MkII |
| DEVICE_OS | 1.40 (R0173) |
| PROJECT_NAME | P_TEST (`/Volumes/OCTA2/O3TC_260001/P_TEST`) |
| Capture date | _pending_ |

## Forbidden

- Python / hex / serializer edits to bank bytes
- Renaming existing repo fixtures to fake multi-bank evidence
- Treating synthetic `multipart/` as multi-slot device mapping proof

## Capture directories

| Label | Path | UI (expected) | Status |
| --- | --- | --- | --- |
| Capture A | `bank_a_active/` | Bank A, Pattern 1, after Save | **COMMITTED** (from disposable `P_TEST` on OCTA2) |
| Capture B | `bank_b_active/` | Bank B, Pattern 1, after Save | **COMMITTED** (`BANK=1`, 2026-10-06) |
| Capture C | `bank_b_pattern_4/` | Bank B, Pattern 4, after Save | **COMMITTED** (`BANK=1`, `PATTERN=3`, 2026-10-06) |
| Capture D | `bank_p_active/` (optional) | Final bank slot, Pattern 1 | **NOT_RUN** |
| Capture E | `bank_a_working_diverged/` | T1 Hold/Release edit, **no** PROJECT SAVE | **COMMITTED** (`BANK=0`; CF `.work`==`.strd` at copy) |
| Capture F | `bank_a_after_save/` | Same project after device Save | **PENDING** |

Each committed capture must include:

- `project.work` (required)
- `project.strd` if present on device
- `bankNN.work` / `bankNN.strd` for every bank file copied
- `capture.meta.json` (UI labels, save actions, operator notes)
- `SHA256SUMS.txt` (run `node scripts/pse-bank-multi-device-manifest.mjs write <capture-dir>`)

### `capture.meta.json` schema (v1)

```json
{
  "schema": "masterocta-pse-bank-capture-meta:v1",
  "capture_label": "bank_a_active",
  "ui_active_bank_letter": "A",
  "ui_active_pattern_number": 1,
  "expected_bank_index": 0,
  "expected_pattern_index": 0,
  "save_actions": ["describe exact UI saves performed"],
  "distinguishing_content": "e.g. Bank A Track 1 static slot 3 vs Bank B slot 7"
}
```

## Acquisition status

```text
RESULT = STOP_WITH_FINDINGS
REASON = Captures A/B/C committed; E/F Save provenance still pending.
```

When captures land, update [ACQUISITION_STATUS.json](./ACQUISITION_STATUS.json) and [docs/planning/PSE_BANK_MULTI_DEVICE_EVIDENCE.md](../../../../docs/planning/PSE_BANK_MULTI_DEVICE_EVIDENCE.md), then regenerate manifests.
