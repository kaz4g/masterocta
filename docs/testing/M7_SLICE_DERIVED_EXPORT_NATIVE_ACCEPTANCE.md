# M7 Slice derived export — native acceptance

**Work ID:** `MO-M7-AUTO-SLICE-DERIVED-EXPORT-UI-1`  
**Status:** **NOT_RUN** (do not mark PASS until operator completes checklist)  
**Harness:** `scripts/prepare-ui-workspace-native-acceptance.sh` (fixture `SET/AUDIO/RANGE.wav`)

## Scope

Real Tauri dev build, synthetic Set fixture only. Confirms persisted draft →
`v2_slice_export_apply` → derived WAV under Application Support + lineage, without
mutating fixture Octatrack bytes.

## Checklist (operator)

| Step | Result | Notes |
| --- | --- | --- |
| Launch app with isolated `HOME` | **NOT_RUN** | |
| Register fixture root, open Slice Workspace on `RANGE.wav` | **NOT_RUN** | |
| Analyze, accept candidates, select one slice | **NOT_RUN** | |
| Export derived sample; note opaque `derivedAssetId` | **NOT_RUN** | |
| Derived WAV present under `MasterOCTa/derived-audio/published/` | **NOT_RUN** | |
| `RANGE.wav` SHA unchanged on fixture root | **NOT_RUN** | |
| Restart app; lineage still resolvable (manual catalog inspect) | **NOT_RUN** | |
| Retry export same slice (idempotent) | **NOT_RUN** | |

**Merge / public distribution:** not authorized by this document.
