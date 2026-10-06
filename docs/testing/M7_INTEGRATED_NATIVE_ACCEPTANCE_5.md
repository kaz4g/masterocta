# M7 Integrated Native Acceptance (session 5)

## 1. Work ID / overall result

| Item | Value |
| --- | --- |
| Work ID | `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-5` |
| Issue | `#177` |
| Recorded | 2026-10-06 |
| **Overall result** | **PASS** |
| **#177** | **CLOSE_READY** (not closed by this record) |
| **M7 milestone** | **IN_PROGRESS** (not COMPLETE) |
| Next | `MO-M7-FINAL-EXIT-AUDIT-1` |

Session 4 ([`M7_INTEGRATED_NATIVE_ACCEPTANCE_4.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE_4.md)) stays a frozen historical **STOP_WITH_FINDINGS** at **`a84433c0`**. No PASS row from session 4, session 3, or any other SHA is reused here. Every A01–A15 and B01–B03 row below was executed again on this session’s SHA.

**A12 normative criteria:** [`M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §15.A.1 (amendment 1). Layer A and layer B both PASS on this SHA.

## 2. Execution SHA

| Item | Value |
| --- | --- |
| Execution SHA | **`40ba99c4a5b1a28b1552ff98093b35684d22cfc7`** |
| origin/main at session start | **`40ba99c4a5b1a28b1552ff98093b35684d22cfc7`** |
| Execution worktree | `.worktrees/m7-int5-40ba99c4` (detached; product tree clean) |
| Evidence branch | `docs/m7-integrated-native-acceptance-5` |
| Product code changed | **NO** |
| Single-SHA rule | Native rows and Rust layer B used this SHA |

## 3. Environment

| Item | Value |
| --- | --- |
| macOS | 26.6.2 (build 25G83) |
| Architecture | arm64 |
| Node | v22.18.0 |
| pnpm | 11.24.0 |
| cargo / rustc | 1.98.0 |
| Open PRs at preflight | none |
| Sleep prevention | `caffeinate -dimsu` for the session (not acceptance evidence). Stopped after the matrix. |
| Screen lock | not observed |
| Sanitized copy | [`evidence/M7_INT5_20261006_40ba99c4/`](./evidence/M7_INT5_20261006_40ba99c4/) |

Preflight: no `masterocta` process and no listener on port 1420. The same was true after quit.

## 4. Isolated HOME and fixtures

Fresh `mktemp` directory for this session only (token `masterocta-m7-int5-40ba99c4-20261006T054410Z-PyhYMb`). Session 4 HOME and fixtures were not reused.

| Item | Value |
| --- | --- |
| Published inventory before launch | 0 |
| Mono fixture | `mo-ui-native-set-4pfgkE` (9 files) |
| `RANGE.wav` SHA256 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Stereo fixture | `mo-ui-native-set-saVPFJ` (1 file) |
| `STEREO_RANGE.wav` SHA256 | `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| Stereo channels | 2; left distinct from right |
| Operator catalog | SHA256 `94f17898f501beaaa8a859a6bc1e4c425de7cf74e6ba146fdcbf7a8f88f848cf` unchanged (307200 bytes) |

Launch used `scripts/launch-native-acceptance-tauri.sh` with this isolated HOME. `lsof` showed the isolated catalog open and the operator catalog not open.

## 5. Result matrix

| Row | Result | Observation on this SHA |
| --- | --- | --- |
| A01 | **PASS** | Isolated catalog FD open. Operator catalog FD absent. |
| A02 | **PASS** | Mono root `mo-ui-native-set-4pfgkE` registered. `SET/AUDIO/RANGE.wav` selected. Waveform region visible. |
| A03 | **PASS** | Zoom, pan, resize, Preview, Slice, range paste, Play then Stop. |
| A04 | **PASS** | Draft A applied (revision 1, region 44100–132300, markers 66106 and 110206). Range B copied, reanalysis cancelled at 108 ms. Revision, region, markers, and slice count unchanged. Apply and edit controls stayed usable. Not scored from the automation smoke script. |
| A05 | **PASS** | Slice export review, confirm, in-flight lock, success. Child `asset:v1:20bc3564916be5128891103789fa2b2f080709476060a77ac244bfa1ea65de73`. Frames [66106, 110206). |
| A06 | **PASS** | Published WAV SHA256 `702cb25dc12fe8f6841c02ea911acca1a9e28a33f208a806bf7892851f79be5f`, size 88244, PCM mono 44100 Hz 16-bit, 44100 frames. |
| A07 | **PASS** | One published WAV. No `.part`, symlink, or extra WAV. |
| A08 | **PASS** | `RANGE.wav` SHA256 unchanged. |
| A09 | **PASS** | Inspector Info: スライス書き出し, `1.499 s → 2.499 s`, `masterocta-trim`, `2026-10-06T06:07:17.545Z`, parent and child opaque ids. No content hash, absolute path, or SQLite row id. |
| A10 | **PASS** | UI identities stayed `asset:v1:` opaque ids. |
| A11 | **PASS** | Same child id, same WAV SHA256, published count 1, lineage count 1. In-flight lock observed. |
| A12 layer A | **PASS** | Export confirm visible at revision 1. Insert frame 90000. Revision 2, markers 66106 / 90000 / 110206. Confirm absent. Derivation count 1. No confirm after the advance. |
| A12 layer B | **PASS** | `slice_export_ipc_rejects_stale_revision_after_draft_advance_without_writes` — 1 passed, 0.21s. |
| A12 | **PASS** | Layer A and layer B on `40ba99c4`. |
| A13 | **PASS** | Process and port 1420 gone. Isolated catalog still revision 2, region 44100–132300, three markers, one `SLICE_EXPORT`. |
| A14 | **PASS** | Same HOME relaunch. Isolated catalog FD only. Mono root re-registered and `RANGE.wav` reselected. UI text `draft スライス 3 · revision 2`. Frames [44100, 132300). Same child id on Inspector Info. SQL unchanged by that restore. |
| A15 | **PASS** | Mono full-root manifest 9 files, path/size/SHA256 equal before and after. |
| B01 | **PASS** | Fresh stereo fixture: 2 channels, left distinct from right, PRE SHA recorded above. |
| B02 | **PASS** | Stereo root `mo-ui-native-set-saVPFJ`. `STEREO_RANGE.wav` selected. Separate accessibility images `オーディオ波形 左` and `オーディオ波形 右`. Zoom, pan, range [66150, 154350), then fit-all. Lane captures differ. |
| B03 | **PASS** | Stereo manifest and `STEREO_RANGE.wav` SHA256 unchanged. |

## 6. Groups

| Item | Result |
| --- | --- |
| GROUP_A | **PASS** |
| GROUP_B | **PASS** |
| MONO_MANIFEST | **PASS** |
| STEREO_MANIFEST | **PASS** |
| ORIGINAL_RANGE_SHA | **PASS** |
| STEREO_RANGE_SHA | **PASS** |
| PUBLISHED_WAV | **PASS** |
| LINEAGE | **PASS** |
| IDEMPOTENT_RETRY | **PASS** |
| RELAUNCH_DRAFT_UI | **PASS** |
| STEREO_NATIVE_LANES | **PASS** |
| INTEGRATED_NATIVE_ACCEPTANCE | **PASS** |

A14 restore used the product path that loads a saved draft after `アタックを検出` with an empty explicit region. The backend kept the saved region 44100–132300 and revision 2. The draft summary was then visible in the Native slice workspace. SQLite alone was not treated as A14 PASS.

## 7. Cleanup

| Item | Value |
| --- | --- |
| `masterocta` residual | **NO** |
| Port 1420 residual | **NO** |
| Sleep prevention | stopped |

No product defect was found. No product patch was made.
