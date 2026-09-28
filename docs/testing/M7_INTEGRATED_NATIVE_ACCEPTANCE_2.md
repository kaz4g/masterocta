# M7 Integrated Native Acceptance (session 2)

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-2`
**Recorded:** 2026-09-27 (historical prep) · **2026-09-28** (product execution @ `af4097a`)
**Overall result:** **STOP_WITH_FINDINGS** — Group A/B operator GUI **NOT_RUN** (partial automated + A01 only)
**M7 milestone:** **IN_PROGRESS** (not COMPLETE)

Supersedes operator intent planning in [`M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE.md) only after an operator records PASS rows here. That document remains **NOT_RUN**; do not rewrite its matrix to PASS.

## 1. Product baseline

| Item | Value |
| --- | --- |
| Next execution baseline | **`eb40ffb0f582917e414b8c8e86d134f91d347aae`** — current product `origin/main` (PR [#167](https://github.com/kaz4g/masterocta/pull/167) merge tip; includes [#166](https://github.com/kaz4g/masterocta/pull/166) Home / RootRegistry entry, #165, #164 `7d15b15`, …). Record remaining GUI **PASS** only on this SHA or a newer reviewed `main` SHA written here before the run. |
| Partial automated attempt | **`af4097a42b247aab420a5217752afaf54869577f`** — prep/launch + **A01** / **B01** only; **not** M7 completion evidence |
| Historical prep SHA | `008478dbcd4e82d21d71e2d0575da7bd92f8c226` (not an execution target) |
| Superseded session 1 baseline | `b2c7765772bd3894472ba936664cabc0db92fcf1` (do not execute) |
| Prior main (Phase 1 post-merge) | `d5a7cedcd547b540f7d34a0518d0e8b63a2791c4` (PR #160) |
| Catalog schema (code) | 13 |
| macOS | 26.6.2 (Build 25G83), arm64 (2026-09-28 run) |
| Node | v22.18.0 |
| pnpm | 11.24.0 |
| Rust | 1.98.0 (via `~/.cargo/bin`) |
| Partial attempt product SHA | **`af4097a42b247aab420a5217752afaf54869577f`** (detached worktree `.worktrees/m7-native-exec-af4097a`) |
| Evidence docs base | **`eb40ffb0f582917e414b8c8e86d134f91d347aae`** (`origin/main` after PR #167) |

**Gate note:** M7 exit requires Group A/B **PASS** on the **next execution baseline** (`eb40ffb` or newer reviewed `main`). The **`af4097a`** partial attempt (A01/B01 only) does not exercise #166 Home entry used by A02/B02. Historical `55eadcc` **NOT_RUN** and `008478d` prep are not completion evidence.

## 2. Preparation evidence

### 2a. 2026-09-28 run @ `af4097a` (automated — PASS)

| Step | Result | Notes |
| --- | --- | --- |
| Detached worktree @ `af4097a` | **PASS** | `.worktrees/m7-native-exec-af4097a` |
| Fresh isolated HOME | **PASS** | `/tmp/masterocta-ui-native-af4097a42b24-20260928T041235Z` |
| Mono fixture + PRE manifest | **PASS** | `prepare-ui-workspace-native-acceptance.sh`; `RANGE.wav` SHA `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Stereo fixture generator | **PASS** | `generate-m7-stereo-native-fixture.mjs`; `STEREO_RANGE.wav` SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c`; `leftDistinctFromRight: true` |
| Pre-launch catalog `lsof` | **PASS** | No `catalog.sqlite3` file/handle before Native launch |
| Native launch (`launch-native-acceptance-tauri.sh`) | **PASS** | Child `HOME` isolated; `masterocta` PID observed with catalog handle under isolated HOME only |

Mono fixture root (register read-only for Group A):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-OIDdxv
```

Mono manifest copy (isolated HOME):

```text
/tmp/masterocta-ui-native-af4097a42b24-20260928T041235Z/fixture-manifest.json
```

Stereo fixture root (separate; Group B — **exact** path for B02):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-JIFQug
```

Stereo manifest (repo copy + isolated HOME copy):

```text
docs/testing/evidence/M7_INT2_20260928_af4097a_stereo_fixture_manifest.json
/tmp/masterocta-ui-native-af4097a42b24-20260928T041235Z/m7-session2-evidence/stereo-fixture-manifest.json
```

If either temporary root is gone before B02, regenerate with `generate-m7-stereo-native-fixture.mjs` (or re-run prep for mono), record the new `fixtureRoot` in this document and commit an updated manifest under `docs/testing/evidence/` before registering.

Launch (2026-09-28):

```bash
REAL_HOME="${REAL_HOME:-$HOME}" \
  .worktrees/m7-native-exec-af4097a/scripts/launch-native-acceptance-tauri.sh \
  /tmp/masterocta-ui-native-af4097a42b24-20260928T041235Z \
  .worktrees/m7-native-exec-af4097a
```

### 2b. Historical prep @ `008478d` (2026-09-27 — not re-used as execution target)

| Step | Result | Notes |
| --- | --- | --- |
| Fresh detached worktree @ `008478d` | **PASS** | `/tmp/masterocta-m7-int2-1790489459` |
| Mono fixture + PRE manifest | **PASS** | `prepare-ui-workspace-native-acceptance.sh`; `RANGE.wav` SHA `43ceb3dc…` |
| Stereo fixture generator | **PASS** | `generate-m7-stereo-native-fixture.mjs`; owned root recorded below; `STEREO_RANGE.wav` SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| Pre-launch catalog `lsof` | **PASS** | No live `catalog.sqlite3` handle on isolated path before register |

Isolated HOME used for prep:

```text
/tmp/masterocta-ui-native-008478dbcd4e-20260927T061101Z
```

Stereo fixture root generated by that prep (read-only; do not copy into the mono fixture):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-o7S03Y
```

`SET/AUDIO/STEREO_RANGE.wav` in that root. For B02, register **this directory** read-only, scan, and select that file. If the managed directory is gone, regenerate with `scripts/generate-m7-stereo-native-fixture.mjs`, record the new `fixtureRoot` from the script manifest here, then register that path. Do not hand-build a stereo WAV.

Launch command (operator):

```bash
REAL_HOME="${REAL_HOME:-$HOME}" \
  /path/to/worktree/scripts/launch-native-acceptance-tauri.sh \
  /tmp/masterocta-ui-native-008478dbcd4e-20260927T061101Z \
  /path/to/worktree
```

## 3. Operator matrix

| ID | Required observation | Result | Evidence |
| --- | --- | --- | --- |
| A01 | Isolated catalog binding before register | **PASS** | Pre-launch: no catalog file. Post-launch `lsof`: `masterocta` FD on isolated `.../MasterOCTa/catalog.sqlite3` only; not on operator real-home catalog |
| A02 | Register fixture, select `RANGE.wav` | **NOT_RUN** | — |
| A03 | Waveform resize/zoom/pan/range Play/Stop | **NOT_RUN** | — |
| A04 | Range A → Analyze → Apply → Draft A. Record region, revision, markers. Pending Range B, play pending, explicit re-analyze → Draft B. Separately fail or cancel a re-analysis and assert Draft A region, revision, and markers are unchanged | **NOT_RUN** | Success path alone is not PASS |
| A05 | Selected slice export: review → confirm → success. Record the selected source-frame interval and opaque child asset id | **NOT_RUN** | Success UI alone is not PASS |
| A06 | Published WAV under isolated `derived-audio/published/v1/`. Independently check rate, channels, frame count, and SHA256 against the selected source interval | **NOT_RUN** | Any PCM file is not PASS |
| A07 | No `.part`/symlink/extra published/fixture derived | **NOT_RUN** | — |
| A08 | Original RANGE SHA unchanged | **NOT_RUN** | PRE manifest captured at prep |
| A09 | Re-select `RANGE.wav`. Info shows the persisted SLICE_EXPORT child: kind, range, processor, createdAt, opaque child id | **NOT_RUN** | A toast or an unspecified child row is not PASS |
| A10 | No raw hash/path/SQLite id in UI | **NOT_RUN** | — |
| A11 | Retry the identical slice. Same child id and output SHA256. Published inventory and per-source lineage count unchanged | **NOT_RUN** | A second file or lineage row is FAIL |
| A12 | Advance the saved draft revision, then reject the stale export. Published file count and lineage count unchanged | **NOT_RUN** | A modal that only blocks edits, without a real revision advance and a no-write check, is not PASS |
| A13 | Post-quit `slice_drafts` persistence | **NOT_RUN** | M7-05 historical partial gap |
| A14 | Quit. Relaunch the same isolated HOME. Second catalog-binding check. Re-register the read-only fixture, rescan, reselect `RANGE.wav`. Compare restored draft and the same child | **NOT_RUN** | Relaunch alone is not PASS; in-memory roots are not persisted |
| A15 | Final fixture manifest vs PRE | **NOT_RUN** | — |
| B01 | Stereo fixture distinct L/R | **PASS** | Generator manifest: distinct L/R attack frames; SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| B02 | Read-only register the recorded stereo `fixtureRoot` (not the mono root). Scan. Select `SET/AUDIO/STEREO_RANGE.wav`. Left and Right lanes stay independently readable across zoom, pan, and range | **NOT_RUN** | Do not improvise a stereo asset |
| B03 | Stereo fixture SHA and relative manifest unchanged after observation | **NOT_RUN** | — |

**Group A:** **NOT_RUN** (A01 **PASS**; A02–A15 **NOT_RUN**). **Group B:** **NOT_RUN** (B01 **PASS**; B02–B03 **NOT_RUN**).

## 4. Findings (STOP)

1. **F-OP-1 — Operator GUI matrix not completed (2026-09-28).** Prep, fixture integrity, Native launch, and **A01** (catalog binding) **PASS** on **`af4097a`**. **A02–A15** and **B02–B03** require a human operator in the Native window (register, slice, export, stale, quit/relaunch, stereo lanes). This automated session did not perform those steps; rows remain **NOT_RUN**. Do not infer PASS from CI or file existence alone.
2. **Historical stop @ `55eadcc`.** The 2026-09-27 **NOT_RUN** matrix at `55eadcc` stays historical; it was not backfilled to PASS.
3. **Next operator session:** fresh isolated HOME, worktree @ **`eb40ffb`** (current product `main`, includes #166 Home). Complete **A02–A15** and **B02–B03**; use the exact stereo `fixtureRoot` above or a regenerated manifest recorded here before B02. Product code must not be patched mid-session.

## 5. Product code

This record is **docs-only**. No Rust/frontend/catalog changes.
