# M7 Integrated Native Acceptance (session 4)

## 1. Work ID / overall result

| Item | Value |
| --- | --- |
| Work ID | `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-4` |
| Stop record Work ID | `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-4-STOP-RECORD` |
| Issue | `#177` |
| Recorded | 2026-10-06 |
| **Overall result** | **STOP_WITH_FINDINGS** |
| **M7 milestone** | **IN_PROGRESS** (not COMPLETE) |

Session 3 ([`M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md)) remains a frozen historical STOP at **`04725cb3`**. PASS rows from session 3, session 2, or any other SHA are not reused in this matrix.

**A12 normative criteria:** [`M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §15.A.1 (amendment 1). Layer A and layer B must both PASS on the same execution SHA.

## 2. Execution SHA

| Item | Value |
| --- | --- |
| Execution SHA | **`a84433c04e392e4463a19ae80f2c0745e8b6c59f`** |
| origin/main at session start | **`a84433c04e392e4463a19ae80f2c0745e8b6c59f`** (PR #213) |
| Execution worktree | `.worktrees/m7-native-final-a84433c0` (detached; product tree clean) |
| Evidence branch | `docs/m7-integrated-native-acceptance-4-stop` |
| Single-SHA rule | Native layer A, Rust layer B, and every executed row used this SHA |

## 3. Environment

| Item | Value |
| --- | --- |
| macOS | 26.6.2 (build 25G83) |
| Architecture | arm64 |
| Node | v22.18.0 |
| pnpm | 11.24.0 |
| cargo / rustc | 1.98.0 |
| Open PRs at preflight | none |
| CI on this SHA | Actions `37284288367` success; Project Structure `37284288289` success |
| Sanitized copy | [`evidence/M7_INT4_20261006_a84433c0_stop/environment.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/environment.txt) |

Preflight: A12 layer B test `slice_export_ipc_rejects_stale_revision_after_draft_advance_without_writes` present on this SHA. Fixture generators and `scripts/launch-native-acceptance-tauri.sh` present in the execution worktree.

## 4. Isolated HOME identity

Fresh directory for this session only (prefix `masterocta-m7-int4-a84433c0-`). Prior session isolated HOMEs were not reused.

| Item | Value |
| --- | --- |
| Catalog (expected) | `$ISOLATED_HOME/Library/Application Support/MasterOCTa/catalog.sqlite3` |
| Published (expected) | `$ISOLATED_HOME/Library/Application Support/MasterOCTa/derived-audio/published/v1/` |
| PRE catalog | absent |
| PRE published count | **0** |
| Real-home catalog | read-only snapshot; SHA256 `94f17898f501beaaa8a859a6bc1e4c425de7cf74e6ba146fdcbf7a8f88f848cf`, size 307200. POST hash unchanged. Not opened by app PID during acceptance |

Raw AX logs, PIDs, and absolute local paths from the operator session were not committed to the repo.

## 5. Mono fixture

Generated this session from the execution-SHA generator (`prepare-ui-workspace-native-acceptance.sh` / `generate-ui-workspace-native-fixture.mjs`).

| Item | Value |
| --- | --- |
| Fixture identity | temp root basename `mo-ui-native-set-pnJGcK` |
| Primary sample | `SET/AUDIO/RANGE.wav` |
| RANGE.wav PRE SHA256 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| PRE file count | **9** |
| PRE manifest | [`evidence/M7_INT4_20261006_a84433c0_stop/mono-pre-manifest.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/mono-pre-manifest.txt) |
| Range A (frames) | 44100–132300 |
| Range B (frames) | 176400–220500 |
| File length | 264600 frames @ 44100 Hz |

## 6. Stereo fixture

Generated this session with `generate-m7-stereo-native-fixture.mjs` (not session 3 stereo root).

| Item | Value |
| --- | --- |
| Fixture identity | temp root basename `mo-ui-native-set-lX22Dp` |
| Primary sample | `SET/AUDIO/STEREO_RANGE.wav` |
| PRE SHA256 | `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| channels | **2** |
| leftDistinctFromRight | **true** |
| frameCount | 176400 |
| attackFramesLeft | `[4410, 26460, 88200]` |
| attackFramesRight | `[13230, 52920, 110250]` |
| byteSize | 705644 |
| PRE file count | **1** |
| PRE manifest | [`evidence/M7_INT4_20261006_a84433c0_stop/stereo-pre-manifest.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/stereo-pre-manifest.txt) |

## 7. PRE evidence

| Check | Result | Method |
| --- | --- | --- |
| Real-home catalog snapshot | recorded, not modified | filesystem hash before launch |
| Isolated catalog | absent before first launch | filesystem |
| Published inventory | count **0** | filesystem |
| Execution worktree | clean at session start | `git status --short` empty on detached worktree |

## 8. A01–A15 matrix

`native-acceptance-a04-live.sh` is **NOT_CANONICAL_EVIDENCE** and is not the A04 PASS source.

| Row | Result | Canonical observation (INT4 `a84433c0` only) |
| --- | --- | --- |
| A01 | **PASS** | Isolated catalog FD opened by app PID; real-home catalog FD none (rechecked on relaunch PIDs) |
| A02 | **PASS** | Native register of mono fixture root; `SET/AUDIO/RANGE.wav` selected; waveform region visible. Go-to suggestion mismatch in repo AX script fail-closed; operator committed path via Return + Where basename + Open. No symlink register; no DB insert |
| A03 | **PASS** | Waveform render; zoom/pan/resize; Preview and Slice tabs; range 44100/132300; play then stop |
| A04 | **PASS** | Draft A rev 1, region 44100–132300, markers 66106/110206. Range B pending, re-analyze, cancel; post-cancel SQL unchanged; `CANCEL_TERMINAL_STATE=PASS`; session usable. RANGE SHA unchanged |
| A05 | **PASS** | Export review → confirm; export lock observed; success path completed |
| A06 | **PASS** | Published WAV on disk: size 88244, mono 44100 Hz 16-bit, 44100 frames; SHA256 `702cb25dc12fe8f6841c02ea911acca1a9e28a33f208a806bf7892851f79be5f` |
| A07 | **PASS** | Exactly one published `.wav`; no `.part`, symlink, or extra file |
| A08 | **PASS** | RANGE SHA256 unchanged; mono root manifest unchanged (9 files) |
| A09 | **PASS** | Inspector Info: kind スライス書き出し; range `1.499 s → 2.499 s`; processor `masterocta-trim`; child `asset:v1:20bc3564916be5128891103789fa2b2f080709476060a77ac244bfa1ea65de73`; parent `asset:v1:98a935c8ed6dae16c803247e5a655ed50cbd15633953c99d10fc502eedd9347f`. No raw content hash, absolute path, or SQLite row id in Inspector static-text scan |
| A10 | **PASS** | Opaque `asset:v1:` identities; library path root-relative |
| A11 | **PASS** | Idempotent retry: same child id and same published WAV SHA256; published count 1; derivation edge count 1; lock observed |
| A12_LAYER_A | **PASS** | Export review at rev 1; insert frame 90000 via paste+Return; rev 1→2; confirm control absent; derivation count unchanged |
| A12_LAYER_B | **PASS** | Rust test PASS on this SHA — [`a12-layer-b.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/a12-layer-b.txt) |
| A12 | **PASS** | Both layers on `a84433c0` |
| A13 | **PASS** | Process exit; post-quit SQL: rev 2, region 44100–132300, three markers, one `SLICE_EXPORT` edge — [`a13-draft.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/a13-draft.txt) |
| A14 | **NOT_RUN** | Partial relaunch: catalog binding PASS; mono root re-registered; `RANGE.wav` reselected; Inspector showed same child/parent/kind/range/processor. **Missing:** draft summary UI text (`revision 2`) after slice workspace restore. Session ended by operator screen lock before observation completed. Not classified FAIL or STOP |
| A15 | **PASS** | POST mono manifest equals PRE (9 files); RANGE SHA256 unchanged — [`mono-post-manifest.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/mono-post-manifest.txt) |

## 9. B01–B03 matrix

Mono waveform does not prove stereo lanes.

| Row | Result | Canonical observation |
| --- | --- | --- |
| B01 | **PASS** | This session stereo generator: channels 2, leftDistinctFromRight true, PRE SHA and attacks in §6, one-file PRE manifest |
| B02 | **NOT_RUN** | Stereo fixture root not registered in Native UI; session ended before group B UI |
| B03 | **NOT_RUN** | Requires POST manifest comparison after Native stereo observation; not performed |

At session stop, stereo fixture bytes still matched PRE ([`stereo-post-manifest.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/stereo-post-manifest.txt)). That does not close row B03.

## 10. A12 composite evidence

**Layer A (Native):** Export review open at revision 1. Supported insert at frame 90000 (paste + Return). Revision 1→2; markers 66106, 90000, 110206; export confirm unavailable; no confirm after advance; derivation edge count stayed 1.

**Layer B (Rust):** `slice_export_apply::tests::slice_export_ipc_rejects_stale_revision_after_draft_advance_without_writes -- --exact` → 1 passed, 0.34s.

## 11. POST / cleanup evidence

| Check | Result |
| --- | --- |
| RANGE.wav POST SHA256 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` (unchanged) |
| Mono manifest POST | equals PRE (9 files) |
| Stereo manifest at stop | equals PRE (1 file); B03 row still **NOT_RUN** |
| Published inventory | one WAV — [`published-inventory.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/published-inventory.txt) |
| Real-home catalog POST | SHA256 unchanged |
| Post-quit draft | revision 2, three markers, one edge |
| **Cleanup (not acceptance PASS)** | [`cleanup.txt`](./evidence/M7_INT4_20261006_a84433c0_stop/cleanup.txt): masterocta residual **NO**, port 1420 residual **NO**, background job residual **NO** |

## 12. Findings

No **PRODUCT_BUG** is recorded from this session. Product code was not edited on the execution worktree.

| Finding ID | Row | Expected | Observed | Classification | Impact |
| --- | --- | --- | --- | --- | --- |
| F-INT4-1 | A14 | Full relaunch restore including draft summary UI at revision 2 with same lineage identity | Catalog binding, re-register, reselect, and Inspector lineage matched; draft summary UI text not captured | **MISSING_CANONICAL_EVIDENCE** | Blocks group A PASS |
| F-INT4-2 | B02 | Native independent L/R lanes on `STEREO_RANGE.wav` | UI not started | **MISSING_CANONICAL_EVIDENCE** | Blocks group B PASS |
| F-INT4-3 | B03 | POST stereo manifest after Native observation | No Native stereo observation | **MISSING_CANONICAL_EVIDENCE** | Blocks group B PASS |

**Harness notes (not M7 blockers):** Discarded AXPress attempts on expanded-slice close and insert-boundary closed the window without catalog or fixture changes; successful A04 cancel and A12 insert used alternate input paths. Repo Go-to AX fail-closed on long temp paths; registration still used the real fixture directory.

## 13. Screen-lock interruption note

```text
INTERRUPTED_JOB_CLASSIFICATION = ENVIRONMENTAL_INTERRUPTION_AFTER_SCREEN_LOCK
PRODUCT_FAILURE = NO
ACCEPTANCE_FAILURE = NO
```

During A14 restore, the operator session screen locked (`CGSSessionScreenIsLocked = 1`). AX lost the app window; no crash report or Rust panic. Catalog remained revision 2 with three markers and one derivation edge. Background launch/operation jobs terminated; cleanup confirmed no residual `masterocta` or port 1420 listener.

This event is **not** a product failure and is **not** listed under M7 blockers below.

## 14. Product code status

```text
PRODUCT_CODE_CHANGED = NO
```

No changes under `src/`, `src-tauri/`, or acceptance automation on the evidence branch.

## 15. Overall decision

```text
A01 = PASS
A02 = PASS
A03 = PASS
A04 = PASS
A05 = PASS
A06 = PASS
A07 = PASS
A08 = PASS
A09 = PASS
A10 = PASS
A11 = PASS
A12_LAYER_A = PASS
A12_LAYER_B = PASS
A12 = PASS
A13 = PASS
A14 = NOT_RUN
A15 = PASS

B01 = PASS
B02 = NOT_RUN
B03 = NOT_RUN

GROUP_A = STOP_WITH_FINDINGS
GROUP_B = STOP_WITH_FINDINGS

INTEGRATED_NATIVE_ACCEPTANCE = STOP_WITH_FINDINGS
M7 = IN_PROGRESS

M7_BLOCKERS =
  MISSING_CANONICAL_EVIDENCE — A14 relaunch draft summary UI
  MISSING_CANONICAL_EVIDENCE — B02 Native stereo lanes
  MISSING_CANONICAL_EVIDENCE — B03 post-observation stereo manifest row
```

`#177` remains **OPEN** (not CLOSE_READY). Do not start `MO-M7-FINAL-EXIT-AUDIT-1` from this record.

## 16. Next work

1. Merge this docs-only STOP record (PR on `docs/m7-integrated-native-acceptance-4-stop`).
2. Do **not** immediately start INT5 on the same partial HOME or reuse PASS rows.
3. After any required product or harness fixes are merged to `main`, run **`MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-5`** from the then-current reviewed `main` SHA from the beginning (fresh isolated HOME, fresh fixtures, full A01–A15 and B01–B03).

No new blocker Issue is opened for screen lock or cleanup alone.
