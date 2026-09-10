# MO-RC8-STATIC-LINK-INVESTIGATION-1

- Status: **INVESTIGATION COMPLETE** (no product fix; Human Gate C remains **STOP**)
- Work ID: `MO-RC8-STATIC-LINK-INVESTIGATION-1`
- Related PR work: `MO-RC8-STATIC-LINK-INVESTIGATION-PR-1`
- Recorded: 2026-09-11
- Frozen candidate evaluated: RC8 `gate-c-rc8-8382de2ed1d2`
- Frozen source commit: `8382de2ed1d2ce7323ed17c1a8833da267abc635`
- Gate C: **NOT_PASS** / Human Gate C: **STOP** / M5: **INCOMPLETE**

## Purpose

Investigate why Octatrack MkII reported `FILE NOT FOUND` for `STATIC[0]` with a
**pre-rename** sample path after RC8 rename Apply reported `COMMITTED / VERIFIED`
with zero Missing / Invalid / Unresolved counts.

This record is sanitized: no personal absolute paths, no raw card manifests, no
real sample stems from operator evidence. Operator evidence remains outside the
repository in an operator-local preserved copy.

## Code baseline

Code references in section B target **RC8 source**
`8382de2ed1d2ce7323ed17c1a8833da267abc635`. At the time of this PR, `origin/main`
points at the same commit. If `main` advances later, line numbers and symbols may
diverge; re-resolve against the frozen RC8 SHA before citing implementation facts.

Synthetic tests live on branch `docs/mo-rc8-static-link-investigation-pr-1`.

## Evidence classification

### A. Measured facts (operator-local preserved copy)

| Phase | Observation |
|---|---|
| Rename | Same-directory basename rename: `…/AUDIO/<OLD>.wav` → `…/AUDIO/<NEW>.wav` |
| Prepare / restart | Prepare succeeded; app restart; re-verification; Continue; Apply succeeded |
| Apply | `COMMITTED / VERIFIED`; Missing / Invalid / Unresolved = 0; rescan completed |
| Byte compare | Expected diffs only; 81 unrelated entries unchanged |
| MkII session | Operator did **not** explicitly load the Project; device opened the last-used Project |
| MkII LOG | `Couldn't load STATIC[0] with '../AUDIO/<OLD>.wav' ('FILE NOT FOUND')` |
| After MkII return | `project.strd` / `project.work` retained **new** PATH in `[SAMPLE]` blocks |
| After MkII return | `LOG` added; `bank01.work` and `project.work` byte changes observed |
| Autosave | Operator reported autosave behavior; **which device action caused each post-return diff is not determined** |

Slot mapping: device `STATIC[0]` (0-based log index) = project `TYPE=STATIC`
`SLOT=001` (1-based in project documents and MasterOCTa APIs).

Hash chain (recomputed from preserved files; matched JSON manifests):

| Artifact | Phase | Size (bytes) | SHA256 (prefix) |
|---|---|---:|---|
| `project.work` / `project.strd` | PRE | 3513 | `6108cc70…2d2a65` |
| `project.work` / `project.strd` | POST (Apply) | 3517 | `0b27a954…3b32c1` |
| `project.strd` | AFTER MkII | 3517 | `0b27a954…3b32c1` (unchanged) |
| `project.work` | AFTER MkII | 3518 | `cbc66171…33766e` |
| `bank01.work` | PRE / POST | 636113 | `34d04291…9bdc94` |
| `bank01.work` | AFTER MkII | 636113 | `a6e233e8…75f52b` |
| `bank01.strd`, `markers.*` | AFTER MkII | — | unchanged from PRE |
| destination audio | POST / AFTER | 176444 | same content hash as source audio |
| source audio | PRE | 176444 | absent at POST |

Apply-post `project.work` bytes were not captured as a separate artifact. Post-Apply
project state is attested by POST manifest hashes and by AFTER `project.strd`, which
matches the post-Apply hash. Replacing `<OLD>.wav` → `<NEW>.wav` in PRE project bytes
reconstructs the post-Apply hash exactly.

String search in preserved project/bank/markers bytes (ASCII and UTF-16LE/BE):

| Location | `<OLD>` / `<OLD>.wav` | `<NEW>` / `<NEW>.wav` |
|---|---|---|
| PRE `project.work` / `project.strd` | present | absent |
| POST / AFTER `project.strd` | absent | present |
| AFTER `project.work` | absent | present |
| `bank01.work` (PRE / POST / AFTER) | not found | not found |
| `markers.work` / `markers.strd` | not found | not found |
| MkII `LOG` | present (error text) | absent |

This search scope does **not** prove absence in unknown encodings, undocumented
bank fields, or device-internal state.

AFTER MkII diffs on preserved media:

- **`project.work` vs post-Apply `project.strd`:** `[SAMPLE]` PATH blocks match;
  `[STATES]` fields differ (`TRACK`, `SCENE_A_MUTE`, `TRACK_MUTE_MASK`).
- **`bank01.work`:** four single-byte changes; no filename-like ASCII/UTF-16 text.

### B. Code-confirmed behavior (RC8 SHA `8382de2`)

| Stage | Location | Behavior relevant to this incident |
|---|---|---|
| PATH inspect/patch | `src-tauri/crates/ot-codec/src/lib.rs` — `MemoryProjectReferenceCodec`, `apply_path_patches` | Rewrites only `[SAMPLE]` `PATH=` values for targeted slots |
| Prepare | `src-tauri/crates/ot-executor/src/rename_prepare.rs` — `build_slot_path_patches`, `rewrite_project_into_staging` | Builds patches from plan; stages `project.work` / `project.strd` independently |
| Plan | `src-tauri/crates/ot-plan/src/rename.rs` — `collect_reference_updates`, `build_state_document_impacts` | Collects resolved slot assignments; Bank files are usage-checked, not rewritten (M5-B) |
| Committed verify | `src-tauri/src/v2_api.rs` — `evaluate_rename_committed_verification` (~L2673), `count_sample_reference_status`, `count_unresolved_planned_references` | Post-rescan checks listed in section “VERIFIED scope” below |

MasterOCTa does not implement Octatrack boot auto-open, device RAM sample-path
cache, or MkII autosave. Those are outside this codebase.

### C. Synthetic-test properties (in-repo; not hardware reproduction)

Tests: `src-tauri/crates/ot-codec/src/tests/rc8_static_slot_investigation.rs`

| Test | Confirms | Does not confirm |
|---|---|---|
| `rc8_static_slot_same_directory_basename_patch_changes_only_path_bytes` | Static slot 001 PATH basename patch changes only PATH bytes | Real WAV files; catalog rescan |
| `rc8_working_and_saved_documents_patch_independently` | `project.work` and `project.strd` can be patched independently | Device SAVE/RELOAD choice at boot |
| `rc8_states_drift_after_path_patch_leaves_sample_path_resolved_to_new_name` | `[STATES]` drift after patch leaves inspected PATH at new name | MkII autosave caused the drift |
| `rc8_project_path_codec_does_not_touch_bank_blob` | Project PATH codec does not mutate unrelated bank-like bytes | Real `bank01.work` layout or checksum fields |
| `rc8_verification_blind_spot_old_path_absent_from_inspect_after_successful_patch` | Codec inspect reports new PATH, not old PATH, after patch | `v2_api` integration verify; device RAM |

These tests reproduce **on-disk PATH codec semantics only**. They do **not**
reproduce MkII RAM, last-used auto-open, or autosave behavior.

Run:

```bash
cd src-tauri && cargo test -p ot-codec rc8_static_slot -- --nocapture
```

### D. Undetermined cause candidates

| Candidate | Status | Notes |
|---|---|---|
| Apply failed to patch static slot 1 PATH on media | **Not supported by preserved media** | POST hashes; PATH inspect; basename reconstruction |
| Only one of `project.work` / `project.strd` was patched | **Not supported by preserved media** | Plan listed both; POST updated both |
| Stale filename in bank/markers preserved bytes (this search scope) | **Not observed** | Does not exclude undocumented encodings or device-internal references |
| MkII used non-disk state (last-used auto-open / session) with old PATH | **Undetermined; plausible** | LOG old PATH + card new PATH + no explicit Project load |
| MkII autosave rolled back PATH on card | **Not supported by preserved media** | AFTER PATH still `<NEW>`; diffs are STATES / bank bytes |
| RAM / last-used auto-open **is the root cause** | **Undetermined** | Requires controlled hardware contrast; see [`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md) |

**Product fix root cause remains undetermined.** Do not patch PATH codec or Bank
rewrite from this investigation alone.

## VERIFIED scope (RC8 `evaluate_rename_committed_verification`)

| Verified by implementation | Not verified by implementation |
|---|---|
| Fresh rescan completed | MkII RAM or last-used session sample paths |
| Source audio absent from catalog; destination present | Whether operator explicitly LOADed vs auto-opened Project |
| Destination content hash matches plan source hash | `[STATES]` transport/mute fields on device |
| Project rewrite live hashes match journal staged content hashes | Undocumented bank binary payload beyond slot usage resolution |
| Global Missing / Invalid counts across slot assignments and usage edges | Device clock vs host clock for LOG timestamps |
| Planned reference updates resolve to destination relative path | External card edits while device holds an older session |

`COMMITTED / VERIFIED` and byte-manifest **PASS** are therefore **consistent**
with MkII later attempting an old PATH that is no longer present in on-media
project documents searched in section A.

## Related documents

- Hardware contrast trial plan (not executed):
  [`MO_RC8_HARDWARE_CONTRAST_TRIAL.md`](MO_RC8_HARDWARE_CONTRAST_TRIAL.md)
- Gate C smoke checklist:
  [`GATE_C_CLONE_SMOKE.md`](GATE_C_CLONE_SMOKE.md)

## Gate status

- RC8 Human Gate C: **STOP** (hardware FILE NOT FOUND after otherwise passing Apply)
- Gate C: **NOT_PASS**
- M5: **INCOMPLETE**
- RC8 artifact rebuild / workflow redispatch: **not authorized**
