# M7 Integrated Native Acceptance (session 3)

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-3`
**Recorded:** 2026-09-28
**Overall result:** **STOP_WITH_FINDINGS** — operator GUI **NOT_RUN** (automated prep/launch + **A01** / **B01** only)
**M7 milestone:** **IN_PROGRESS** (not COMPLETE)

Canonical execution record for product **`04725cb3a1942716e11f1b90a6387733f9302da4`** (PR #170 merge).
Session 2 ([`M7_INTEGRATED_NATIVE_ACCEPTANCE_2.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE_2.md)) remains historical; do not backfill its matrix to PASS.

## 1. Product baseline

| Item | Value |
| --- | --- |
| Execution SHA | **`04725cb3a1942716e11f1b90a6387733f9302da4`** |
| origin/main @ run start | **`04725cb3a1942716e11f1b90a6387733f9302da4`** (PR #170) |
| Execution worktree | `.worktrees/m7-native-final-04725cb3` (detached; read-only) |
| Evidence branch | `docs/m7-integrated-native-acceptance-3-stop` |
| Includes (non-exhaustive) | #161 stereo lanes, #163 persisted-draft export, #164 export marker lock, #165 UI consolidation, #166 Home / RootRegistry, #170 SliceWorkbench i18n |
| macOS | 26.6.2 (Build 25G83), arm64 |
| Node | v22.18.0 |
| pnpm | 11.24.0 |
| Rust | 1.98.0 |
| Open PRs @ preflight | none |

**Cross-session rule:** PASS rows from `55eadcc`, `af4097a`, or `eb40ffb` are **not** reused in this session.

## 2. Isolated environment

| Item | Value |
| --- | --- |
| Isolated HOME | `/tmp/masterocta-ui-native-04725cb3-20260928T093024Z` |
| Catalog (expected) | `$ISOLATED_HOME/Library/Application Support/MasterOCTa/catalog.sqlite3` |
| Published (PRE) | absent (`derived-audio/published/v1` count **0**) |

### Mono fixture (Group A)

| Item | Value |
| --- | --- |
| fixtureRoot | `/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-gnZoFc` |
| Register read-only | above path |
| Primary sample | `SET/AUDIO/RANGE.wav` |
| RANGE.wav PRE SHA256 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| PRE manifest (repo) | [`evidence/M7_INT3_20260928_04725cb3_mono_fixture_manifest.json`](./evidence/M7_INT3_20260928_04725cb3_mono_fixture_manifest.json) |
| Generator | `prepare-ui-workspace-native-acceptance.sh` → `generate-ui-workspace-native-fixture.mjs` |
| PRE inventory file count | **9** (full root walk; includes `SET/ACCEPT_PROJ/project.work`) |

### Stereo fixture (Group B)

| Item | Value |
| --- | --- |
| fixtureRoot | `/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-Yy3sZp` |
| Sample path | `SET/AUDIO/STEREO_RANGE.wav` |
| STEREO_RANGE PRE SHA256 | `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| channels | **2** |
| leftDistinctFromRight | **true** |
| attackFramesLeft | `[4410, 26460, 88200]` |
| attackFramesRight | `[13230, 52920, 110250]` |
| PRE manifest (repo) | [`evidence/M7_INT3_20260928_04725cb3_stereo_fixture_manifest.json`](./evidence/M7_INT3_20260928_04725cb3_stereo_fixture_manifest.json) |
| Generator | `generate-m7-stereo-native-fixture.mjs` |
| PRE inventory file count | **1** |

## 3. Preparation evidence

| Step | Result | Notes |
| --- | --- | --- |
| Detached worktree @ `04725cb3` | **PASS** | `.worktrees/m7-native-final-04725cb3` |
| Fresh isolated HOME | **PASS** | path above; no reuse of prior `/tmp/masterocta-ui-native-*` |
| Mono fixture + PRE manifest | **PASS** | RANGE SHA verified at generation |
| Stereo fixture + PRE manifest | **PASS** | distinct L/R; SHA matches generator constant |
| PRE real-home catalog `lsof` | **PASS** | no handle on operator real-home catalog path |
| PRE isolated catalog | **PASS** | file absent before first launch |
| PRE published inventory | **PASS** | count **0** |
| Native build + launch | **PASS** | `pnpm install --frozen-lockfile`; `launch-native-acceptance-tauri.sh` compiled product; sustained process via isolated-HOME `masterocta` binary for A01 observation |
| Product code in execution worktree | **PASS** | `git status` clean (no source edits) |

Launch (compile via harness):

```bash
REAL_HOME="${REAL_HOME:-$HOME}" \
  .worktrees/m7-native-final-04725cb3/scripts/launch-native-acceptance-tauri.sh \
  /tmp/masterocta-ui-native-04725cb3-20260928T093024Z \
  .worktrees/m7-native-final-04725cb3
```

A01 observation PID **46845** (child `HOME` = isolated HOME above). Evidence: isolated `catalog.sqlite3` FD only; no real-home catalog FD on that PID.

## 4. Operator matrix

| ID | Required observation | Result | Evidence |
| --- | --- | --- | --- |
| A01 | Isolated catalog binding | **PASS** | PID **46845**; `lsof`: isolated `.../MasterOCTa/catalog.sqlite3` only; real-home catalog: no handle |
| A02 | Register mono fixture, select `RANGE.wav` | **NOT_RUN** | requires operator GUI |
| A03 | Waveform resize/zoom/pan/range Play/Stop (+ ja Slice/Preview functional) | **NOT_RUN** | — |
| A04 | Draft A/B + failure/cancel safety | **NOT_RUN** | success path alone is not PASS |
| A05 | Selected slice export + #164 in-flight lock | **NOT_RUN** | — |
| A06 | Independent published WAV verification | **NOT_RUN** | — |
| A07 | Published inventory hygiene | **NOT_RUN** | — |
| A08 | Original RANGE SHA unchanged | **NOT_RUN** | PRE SHA captured |
| A09 | Persisted lineage in Inspector Info | **NOT_RUN** | — |
| A10 | UI identity boundary | **NOT_RUN** | — |
| A11 | Idempotent retry | **NOT_RUN** | — |
| A12 | Stale draft fail-closed (no-write) | **NOT_RUN** | — |
| A13 | Post-quit `slice_drafts` persistence | **NOT_RUN** | — |
| A14 | Relaunch + restore after re-register | **NOT_RUN** | — |
| A15 | Final mono fixture manifest vs PRE | **NOT_RUN** | PRE full-root manifest on file |
| B01 | Stereo fixture distinct L/R + SHA | **PASS** | session 3 generator manifest; SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| B02 | Stereo Native lanes (register stereo root) | **NOT_RUN** | exact stereo `fixtureRoot` above |
| B03 | Stereo POST manifest vs PRE | **NOT_RUN** | — |

**Group A:** **NOT_RUN** (A01 **PASS**; A02–A15 **NOT_RUN**). **Group B:** **NOT_RUN** (B01 **PASS**; B02–B03 **NOT_RUN**).

## 5. Operator handoff (next steps)

Use the **same** isolated HOME and execution worktree. If the Native window is not open, re-run the launch command in §3.

1. **A02:** 「ワークスペースを開く」→ register **mono** `fixtureRoot` (read-only) → SET → オーディオプール → `RANGE.wav`. Confirm Inspector, Preview, Home / RootRegistry (#166).
2. **A03–A05:** Slice workspace on `RANGE.wav` per matrix; record export marker interval and opaque child asset id for A06.
3. **Agent checkpoint:** notify when A05 export succeeds → agent collects A06–A08 filesystem evidence.
4. **A09–A12:** lineage UI, retry, stale export; agent verifies inventory/lineage counts for A11–A12.
5. **A13–A14:** quit fully; agent reads `slice_drafts` read-only; relaunch same isolated HOME; re-register mono root, rescan, reselect `RANGE.wav`.
6. **A15:** agent POST mono full-root manifest vs PRE.
7. **B02–B03:** register **stereo** `fixtureRoot` (separate root); select `SET/AUDIO/STEREO_RANGE.wav`; zoom/pan/range; agent POST stereo manifest.

## 6. Findings (STOP)

### F-INT3-1 — Operator GUI matrix not completed

**Matrix row:** A02–A15, B02–B03
**Execution SHA:** `04725cb3a1942716e11f1b90a6387733f9302da4`
**Steps:** Automated session completed preflight, fixtures, PRE evidence, Native compile/launch, **A01**, **B01**.
**Expected:** Human operator completes remaining rows in one Native session on this SHA.
**Observed:** GUI rows **NOT_RUN**; no export, lineage, stale, quit/relaunch, or stereo lane observation recorded.
**Evidence:** this document §4; PRE manifests under `docs/testing/evidence/M7_INT3_*`.
**Impact:** Native overall **STOP_WITH_FINDINGS**; M7 remains **IN_PROGRESS**. Do not patch product mid-session.

## 7. Product code

This record is **docs-only** on the evidence branch. No Rust/frontend/catalog changes.
