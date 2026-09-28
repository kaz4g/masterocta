# M7 Integrated Native Acceptance (session 3)

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-3`
**Recorded:** 2026-09-28
**Overall result:** **STOP_WITH_FINDINGS** — operator matrix **NOT_RUN** (§3 automated harness only; no operator-session PASS rows)
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

§3 automated launch recorded **A01** on PID **46845** (child `HOME` = isolated HOME above; isolated `catalog.sqlite3` FD only). That observation is **harness / prep evidence only** — see §4 exit rule.

## 4. Operator matrix

**M7 exit rule:** Integrated acceptance requires **one operator session** on a **fresh isolated `HOME`**, with **every** row **A01–A15** and **B01–B03** observed **PASS** in that same session ([`M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §15.A). The automated prep in §3 recorded **A01** / **B01** for harness debugging only; those rows **do not** carry forward to a later GUI continuation. The next operator run must **re-execute the full matrix** (including a new pre-register **A01** `lsof` catalog-binding check). Do **not** merge §3 automated **PASS** rows with a partial GUI run or mark session 3 complete using catalog binding from a different process.

| ID | Required observation | Result | Evidence |
| --- | --- | --- | --- |
| A01 | Isolated catalog binding **before register** | **NOT_RUN** (harness only) | §3 PID **46845** is prep evidence, not operator-session PASS |
| A02 | Register mono fixture, select `RANGE.wav` (#166 Home entry) | **NOT_RUN** | requires operator GUI |
| A03 | Waveform resize/zoom/pan/range Play/Stop (+ ja Slice/Preview functional) | **NOT_RUN** | — |
| A04 | Range A → Analyze → Apply → Draft A. Record region, revision, markers. Pending Range B, play pending, explicit re-analyze → Draft B. Separately fail or cancel a re-analysis and assert Draft A region, revision, and markers are unchanged | **NOT_RUN** | Success path alone is not PASS |
| A05 | Selected slice export: review → confirm → success. Record selected source-frame interval and opaque child asset id. Marker lock during export (#164) | **NOT_RUN** | Success UI alone is not PASS |
| A06 | Published WAV under isolated `derived-audio/published/v1/`. Independently verify **sample rate**, **channels**, **frame count**, and **SHA256** against the **selected source interval** from A05 | **NOT_RUN** | Any readable PCM file is not PASS |
| A07 | No `.part`/symlink/extra published/fixture derived | **NOT_RUN** | — |
| A08 | Original RANGE SHA unchanged | **NOT_RUN** | PRE SHA captured |
| A09 | Re-select `RANGE.wav`; SLICE_EXPORT child in Inspector Info (kind, range, processor, createdAt, opaque child id) | **NOT_RUN** | Toast alone is not PASS |
| A10 | No raw hash/path/SQLite id in UI | **NOT_RUN** | — |
| A11 | Retry the identical slice. Same child id and output SHA256. Published inventory and per-source lineage count unchanged | **NOT_RUN** | A second file or lineage row is FAIL |
| A12 | **Advance** the saved draft revision, then attempt export confirm with the **stale** revision. Expect reject / no-write. **Published file count and lineage count unchanged** vs pre-attempt | **NOT_RUN** | A modal that only blocks edits, without a real revision advance and inventory proof, is not PASS |
| A13 | Post-quit `slice_drafts` persistence (read-only SQL) | **NOT_RUN** | — |
| A14 | Quit. Relaunch the **same** isolated HOME. **Second catalog-binding check (`lsof` — isolated catalog only; not operator real-home catalog) before re-register.** Then read-only fixture re-register, rescan, reselect `RANGE.wav`. Compare restored draft and the same child | **NOT_RUN** | Relaunch alone is not PASS; re-register **before** catalog re-check is FAIL |
| A15 | Final fixture-root manifest vs PRE (full generator inventory — all WAVs + `project.work`; not `RANGE.wav` alone) | **NOT_RUN** | PRE: §2 / `M7_INT3_*_mono_fixture_manifest.json` |
| B01 | Stereo fixture distinct L/R + SHA | **NOT_RUN** (harness only) | §2 generator manifest is prep evidence; re-run in operator session if fixtures regenerated |
| B02 | Register stereo `fixtureRoot`; L/R lanes independent across zoom/pan/range | **NOT_RUN** | exact stereo `fixtureRoot` §2 |
| B03 | Stereo fixture SHA/manifest unchanged after observation | **NOT_RUN** | — |

**Group A:** **NOT_RUN** (all rows; §3 harness does not count). **Group B:** **NOT_RUN** (all rows; §3 harness does not count).

### 4a. Automated prep @ `04725cb3` (2026-09-28 — harness only)

| ID | Harness observation | Notes |
| --- | --- | --- |
| A01 | catalog binding observed | PID **46845**; not operator-session PASS |
| B01 | generator manifest | distinct L/R; SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |

## 5. Operator handoff (next steps)

**Do not** resume at A02 on the isolated HOME or catalog from §3. Start a **new** single operator session:

1. **Fresh isolated `HOME`** (new `/tmp/masterocta-ui-native-04725cb3-<timestamp>`; do not reuse §2 path).
2. Regenerate mono/stereo fixtures; commit updated **full** manifests under `docs/testing/evidence/` if paths change.
3. Launch via §3 command shape on worktree @ **`04725cb3`**.
4. In **one** session, observe **PASS** on **A01–A15** and **B01–B03** in matrix order ( **A01** `lsof` before any register).

Sequence (same session):

1. **A01:** pre-register catalog binding.
2. **A02–A05:** mono register → `RANGE.wav` → slice/export; record interval + child id for **A06**.
3. **Agent checkpoint:** after A05 success → agent verifies **A06** rate/channels/frames/SHA256 vs interval, **A07–A08**.
4. **A09–A12:** lineage UI, idempotent retry (**A11** counts), stale revision advance + no-write proof (**A12**).
5. **A13–A14:** quit → agent `slice_drafts` SQL; relaunch → **A01-class binding before re-register** → re-register/rescan/reselect → compare draft/child.
6. **A15:** POST mono full-root manifest vs PRE.
7. **B01–B03:** stereo manifest check, register stereo root, lanes, POST manifest.

## 6. Findings (STOP)

### F-INT3-1 — Operator GUI matrix not completed

**Matrix row:** A01–A15, B01–B03 (operator session)
**Execution SHA:** `04725cb3a1942716e11f1b90a6387733f9302da4`
**Steps:** Automated session completed preflight, fixtures, PRE evidence, Native compile/launch; harness **A01** / **B01** in §4a only.
**Expected:** One new operator session on **fresh isolated `HOME`** with **all** rows **A01–A15** / **B01–B03** **PASS** together (re-run **A01** before register; do not merge §4a harness with a partial GUI run).
**Observed:** Operator matrix **NOT_RUN**; no integrated export, lineage, stale, quit/relaunch, or stereo lane observation.
**Evidence:** this document §4–§5; PRE manifests under `docs/testing/evidence/M7_INT3_*`.
**Impact:** Native overall **STOP_WITH_FINDINGS**; M7 remains **IN_PROGRESS**. Do not patch product mid-session.

## 7. Product code

This record is **docs-only** on the evidence branch. No Rust/frontend/catalog changes.
