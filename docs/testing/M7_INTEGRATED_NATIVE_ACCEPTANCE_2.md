# M7 Integrated Native Acceptance (session 2)

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-2` · **FINAL session:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-2-FINAL`
**Recorded:** 2026-09-27 (historical prep) · **2026-09-28** (`af4097a` partial) · **2026-09-28** (`eb40ffb` final single-session attempt)
**Overall result:** **STOP_WITH_FINDINGS** — operator GUI **NOT_RUN** on execution baseline `eb40ffb` (automated prep/launch + **A01** / **B01** only)
**M7 milestone:** **IN_PROGRESS** (not COMPLETE)

Supersedes operator intent planning in [`M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE.md) only after an operator records PASS rows here. That document remains **NOT_RUN**; do not rewrite its matrix to PASS.

## 1. Product baseline

| Item | Value |
| --- | --- |
| **Execution baseline (final session)** | **`eb40ffb0f582917e414b8c8e86d134f91d347aae`** — detached worktree `.worktrees/m7-native-final-eb40ffb` (#161–#166 Home / RootRegistry entry, #165, #164 `7d15b15`, …) |
| Partial automated attempt (historical) | **`af4097a42b247aab420a5217752afaf54869577f`** — prep/launch + **A01** / **B01** only; **not** mixed into final session PASS |
| Historical prep SHA | `008478dbcd4e82d21d71e2d0575da7bd92f8c226` (not an execution target) |
| Historical session 2 stop | **`55eadcc`** — matrix **NOT_RUN**; not backfilled |
| Superseded session 1 baseline | `b2c7765772bd3894472ba936664cabc0db92fcf1` (do not execute) |
| Evidence docs commit base | **`151da632d9e810b92a2078f928b4bb4404fd9aa6`** (`origin/main` after PR #168) on branch `docs/m7-integrated-native-acceptance-2-final-pass` |
| Catalog schema (code) | 13 |
| macOS | 26.6.2 (Build 25G83), arm64 (2026-09-28 final session) |
| Node | v22.18.0 |
| pnpm | 11.24.0 |
| Rust | 1.98.0 (via `~/.cargo/bin`) |

**Gate note:** M7 exit requires Group A/B **PASS** on **`eb40ffb`** (or newer reviewed `main` recorded here before PASS). The **`af4097a`** and **`55eadcc`** rows stay historical. This final session re-ran prep/launch and **A01** / **B01** on **`eb40ffb`**; GUI rows were not observed in this automated pass.

## 2. Preparation evidence

### 2c. 2026-09-28 final session @ `eb40ffb` (automated prep/launch — PASS)

| Step | Result | Notes |
| --- | --- | --- |
| Detached worktree @ `eb40ffb` | **PASS** | `.worktrees/m7-native-final-eb40ffb`; `git rev-parse HEAD` = `eb40ffb0f582917e414b8c8e86d134f91d347aae` |
| Fresh isolated HOME | **PASS** | `/tmp/masterocta-ui-native-eb40ffb0f582-20260928T043652Z` (not reused from `af4097a` path) |
| Mono fixture + PRE manifest | **PASS** | `prepare-ui-workspace-native-acceptance.sh`; `RANGE.wav` SHA `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Stereo fixture generator | **PASS** | `generate-m7-stereo-native-fixture.mjs`; `STEREO_RANGE.wav` SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c`; `leftDistinctFromRight: true` |
| Pre-launch real-home catalog `lsof` | **PASS** | No handle on operator `~/Library/Application Support/MasterOCTa/catalog.sqlite3` |
| `derived-audio/published/v1` inventory (pre GUI) | **PASS** | 0 entries under isolated HOME |
| Native launch (`launch-native-acceptance-tauri.sh`) | **PASS** | Child `HOME` = isolated path; `masterocta` PID **33208** (observed 2026-09-28) with catalog FD under isolated HOME only |

Mono fixture root (register read-only for Group A):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-J2YHEs
```

Mono manifest (repo + isolated HOME):

```text
docs/testing/evidence/M7_INT2_20260928_eb40ffb_mono_fixture_manifest.json
/tmp/masterocta-ui-native-eb40ffb0f582-20260928T043652Z/fixture-manifest.json
```

Stereo fixture root (separate; Group B — **exact** path for B02):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-BChHQY
```

Stereo manifest (repo copy + isolated HOME copy):

```text
docs/testing/evidence/M7_INT2_20260928_eb40ffb_stereo_fixture_manifest.json
/tmp/masterocta-ui-native-eb40ffb0f582-20260928T043652Z/m7-session2-evidence/stereo-fixture-manifest.json
```

If either temporary root is gone before B02, regenerate with the scripts above, record the new `fixtureRoot` here, and commit an updated manifest under `docs/testing/evidence/` before registering.

Launch (2026-09-28 final session):

```bash
REAL_HOME="${REAL_HOME:-$HOME}" \
  .worktrees/m7-native-final-eb40ffb/scripts/launch-native-acceptance-tauri.sh \
  /tmp/masterocta-ui-native-eb40ffb0f582-20260928T043652Z \
  .worktrees/m7-native-final-eb40ffb
```

Post-launch catalog binding (A01):

```text
lsof (real home catalog): no handles
lsof (isolated catalog): masterocta PID 33208 → .../masterocta-ui-native-eb40ffb0f582-20260928T043652Z/Library/Application Support/MasterOCTa/catalog.sqlite3
ps eww: child HOME=/tmp/masterocta-ui-native-eb40ffb0f582-20260928T043652Z (PIDs 33077, 33133, 33208)
```

### 2a. 2026-09-28 run @ `af4097a` (historical partial — not final session evidence)

| Step | Result | Notes |
| --- | --- | --- |
| Detached worktree @ `af4097a` | **PASS** | `.worktrees/m7-native-exec-af4097a` |
| Fresh isolated HOME | **PASS** | `/tmp/masterocta-ui-native-af4097a42b24-20260928T041235Z` |
| Mono fixture + PRE manifest | **PASS** | `RANGE.wav` SHA `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Stereo fixture generator | **PASS** | `STEREO_RANGE.wav` SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |

Mono fixture root (historical):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-OIDdxv
```

Stereo fixture root (historical):

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-JIFQug
```

Stereo manifest (historical):

```text
docs/testing/evidence/M7_INT2_20260928_af4097a_stereo_fixture_manifest.json
```

### 2b. Historical prep @ `008478d` (2026-09-27 — not re-used as execution target)

| Step | Result | Notes |
| --- | --- | --- |
| Fresh detached worktree @ `008478d` | **PASS** | `/tmp/masterocta-m7-int2-1790489459` |
| Mono fixture + PRE manifest | **PASS** | `prepare-ui-workspace-native-acceptance.sh`; `RANGE.wav` SHA `43ceb3dc…` |
| Stereo fixture generator | **PASS** | `generate-m7-stereo-native-fixture.mjs`; `STEREO_RANGE.wav` SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| Pre-launch catalog `lsof` | **PASS** | No live `catalog.sqlite3` handle on isolated path before register |

Isolated HOME used for prep:

```text
/tmp/masterocta-ui-native-008478dbcd4e-20260927T061101Z
```

Stereo fixture root generated by that prep:

```text
/private/var/folders/sk/_4wz3w4x0q332fry3ryng1mr0000gn/T/mo-ui-native-set-o7S03Y
```

## 3. Operator matrix — final session @ `eb40ffb` (2026-09-28)

| ID | Required observation | Result | Evidence |
| --- | --- | --- | --- |
| A01 | Isolated catalog binding before register | **PASS** | Real-home catalog: no `lsof` handle. Post-launch: `masterocta` FD on isolated `.../MasterOCTa/catalog.sqlite3` only; child `HOME` isolated |
| A02 | Register fixture, select `RANGE.wav` (#166 Home entry) | **NOT_RUN** | — |
| A03 | Waveform resize/zoom/pan/range Play/Stop | **NOT_RUN** | — |
| A04 | Range A → Analyze → Apply → Draft A; pending Range B; fail/cancel preserves Draft A | **NOT_RUN** | — |
| A05 | Selected slice export; marker lock during export (#164) | **NOT_RUN** | — |
| A06 | Published WAV rate/channels/frames/SHA256 vs source interval | **NOT_RUN** | — |
| A07 | No `.part`/symlink/extra published/fixture derived | **NOT_RUN** | Pre GUI: published inventory 0 |
| A08 | Original RANGE SHA unchanged | **NOT_RUN** | PRE manifest §2c |
| A09 | Re-select `RANGE.wav`; SLICE_EXPORT child in Info | **NOT_RUN** | — |
| A10 | No raw hash/path/SQLite id in UI | **NOT_RUN** | — |
| A11 | Identical slice retry: same child id and output SHA256 | **NOT_RUN** | — |
| A12 | Stale export after draft revision advance | **NOT_RUN** | — |
| A13 | Post-quit `slice_drafts` persistence | **NOT_RUN** | — |
| A14 | Quit/relaunch; re-register; compare draft and child | **NOT_RUN** | — |
| A15 | Final fixture manifest vs PRE | **NOT_RUN** | — |
| B01 | Stereo fixture distinct L/R | **PASS** | Manifest `leftDistinctFromRight: true`; SHA `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` @ `BChHQY` root |
| B02 | Register stereo `fixtureRoot`; L/R lanes independent | **NOT_RUN** | Use exact root §2c |
| B03 | Stereo fixture SHA/manifest unchanged after observation | **NOT_RUN** | — |

**Group A:** **NOT_RUN** (A01 **PASS**; A02–A15 **NOT_RUN**). **Group B:** **NOT_RUN** (B01 **PASS**; B02–B03 **NOT_RUN**).

### 3a. Historical matrix @ `af4097a` (2026-09-28 — do not use for M7 exit)

Same row IDs as above; **A01** / **B01** **PASS**; **A02–A15** / **B02–B03** **NOT_RUN**. Recorded in PR #168; not rewritten to PASS for exit.

## 4. Findings (STOP)

1. **F-OP-2 — Operator GUI matrix not completed on `eb40ffb` (2026-09-28).** Final single-session prep, fixture integrity, Native launch, **A01**, and **B01** **PASS** on **`eb40ffb`**. **A02–A15** and **B02–B03** require a human operator in the Native window (#166 Home register path, slice/export/stale/relaunch, stereo lanes). This automated session did not perform those steps; rows remain **NOT_RUN**. Do not infer PASS from CI, file existence, or **`af4097a`** partial rows.
2. **F-OP-1 — Historical @ `af4097a`.** Partial attempt remains historical; not completion evidence.
3. **Historical stop @ `55eadcc`.** The 2026-09-27 **NOT_RUN** matrix stays historical.
4. **Next operator session:** same isolated HOME is optional; prefer fresh isolated HOME + worktree @ **`eb40ffb`** (or newer reviewed `main` recorded here). Complete **A02–A15** and **B02–B03** using §2c fixture roots or regenerated manifests committed before B02. Product code must not be patched mid-session.

## 5. Product code

This record is **docs-only**. No Rust/frontend/catalog changes on the evidence branch.
