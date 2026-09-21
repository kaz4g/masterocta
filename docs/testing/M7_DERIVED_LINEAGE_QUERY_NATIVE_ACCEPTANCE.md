# M7 Derived lineage query — native acceptance

> Historical Work ID checklist. **NOT_RUN** unchanged. Superseding evidence when PASS: [`M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE.md).

**Work ID:** `MO-M7-DERIVED-LINEAGE-QUERY-UI-1`  
**Status:** **NOT_RUN** (operator checklist; do not mark PASS until completed)  
**Harness:** `scripts/prepare-ui-workspace-native-acceptance.sh` (fixture `SET/AUDIO/RANGE.wav`)

## Scope

Real Tauri dev build, synthetic Set fixture only. Confirms read-only
`v2_asset_derivation_get` / `v2_asset_derivation_list_children` and Inspector Info
derivation section after slice export, without mutating fixture Octatrack bytes.

Reuses the #153 export harness path; **does not** inherit #153 Native PASS
([`M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md`](./M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md)
remains **NOT_RUN**).

## Checklist (operator)

| Step | Result | Notes |
| --- | --- | --- |
| Launch app with isolated `HOME` | **NOT_RUN** | |
| Register fixture root, select `RANGE.wav` | **NOT_RUN** | |
| Inspector Info shows original / no children | **NOT_RUN** | |
| Slice Workspace: analyze, accept one slice, export derived | **NOT_RUN** | |
| Re-select `RANGE.wav`, Info lists SLICE_EXPORT child (kind, range, processor, createdAt, opaque child id) | **NOT_RUN** | Catalog query, not session toast |
| Quit and relaunch app | **NOT_RUN** | |
| Select `RANGE.wav` again; same child lineage visible | **NOT_RUN** | |
| `RANGE.wav` SHA unchanged on fixture root | **NOT_RUN** | |

**Merge / public distribution:** not authorized by this document.
