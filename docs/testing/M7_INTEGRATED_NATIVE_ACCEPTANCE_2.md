# M7 Integrated Native Acceptance (session 2)

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-2`
**Recorded:** 2026-09-27 (agent prep + operator gate)
**Overall result:** **STOP_WITH_FINDINGS** — operator GUI matrix **NOT_RUN**
**M7 milestone:** **IN_PROGRESS** (not COMPLETE)

Supersedes operator intent planning in [`M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE.md) only after an operator records PASS rows here. That document remains **NOT_RUN**; do not rewrite its matrix to PASS.

## 1. Product baseline

| Item | Value |
| --- | --- |
| Intended baseline | PR [#161](https://github.com/kaz4g/masterocta/pull/161) head (stereo lanes) after merge to `main` |
| Recorded product SHA (prep session) | `008478dbcd4e82d21d71e2d0575da7bd92f8c226` |
| Prior main (Phase 1 post-merge) | `d5a7cedcd547b540f7d34a0518d0e8b63a2791c4` (PR #160) |
| Catalog schema (code) | 13 |
| macOS | darwin 25.6.0 (operator host) |
| Node | v22.18.0 |
| pnpm | workspace lockfile (frozen install on CI) |

**Gate note:** Integrated Native on `main` must re-run on the **merge commit of PR #161**, not only this prep SHA, if merge introduces delta.

## 2. Preparation evidence (automated — PASS)

| Step | Result | Notes |
| --- | --- | --- |
| Fresh detached worktree @ `008478d` | **PASS** | `/tmp/masterocta-m7-int2-1790489459` |
| Mono fixture + PRE manifest | **PASS** | `prepare-ui-workspace-native-acceptance.sh`; `RANGE.wav` SHA `43ceb3dc…` |
| Stereo fixture generator | **PASS** | `generate-m7-stereo-native-fixture.mjs`; `STEREO_RANGE.wav` SHA `21908819…` |
| Pre-launch catalog `lsof` | **PASS** | No live `catalog.sqlite3` handle on isolated path before register |

Isolated HOME used for prep:

```text
/tmp/masterocta-ui-native-008478dbcd4e-20260927T061101Z
```

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
| A01 | Isolated catalog binding before register | **NOT_RUN** | Requires live Native launch + sanitized `lsof` |
| A02 | Register fixture, select `RANGE.wav` | **NOT_RUN** | — |
| A03 | Waveform resize/zoom/pan/range Play/Stop | **NOT_RUN** | — |
| A04 | Range A → Draft A; Pending B; re-analyze → Draft B | **NOT_RUN** | Phase 1 safety on #160; Native not replayed on #161 baseline |
| A05 | Slice export success | **NOT_RUN** | — |
| A06 | Published WAV PCM evidence | **NOT_RUN** | — |
| A07 | No `.part`/symlink/extra published/fixture derived | **NOT_RUN** | — |
| A08 | Original RANGE SHA unchanged | **NOT_RUN** | PRE manifest captured at prep |
| A09 | Inspector lineage child | **NOT_RUN** | — |
| A10 | No raw hash/path/SQLite id in UI | **NOT_RUN** | — |
| A11 | Export idempotency | **NOT_RUN** | — |
| A12 | Stale export fail-closed | **NOT_RUN** | — |
| A13 | Post-quit `slice_drafts` persistence | **NOT_RUN** | M7-05 historical partial gap |
| A14 | Restart + draft/lineage restore | **NOT_RUN** | — |
| A15 | Final fixture manifest vs PRE | **NOT_RUN** | — |
| B01 | Stereo fixture distinct L/R | **NOT_RUN** | Generator provenance only (automated) |
| B02 | Independent L/R lanes in UI | **NOT_RUN** | Blocked until PR #161 on `main` + operator |
| B03 | Stereo fixture SHA unchanged | **NOT_RUN** | — |

**Group A:** **NOT_RUN**. **Group B:** **NOT_RUN**.

## 4. Findings (STOP)

1. **Operator GUI matrix not executed** in this session (no substitute for A01–A15 / B01–B03 PASS).
2. **PR #161** (stereo lanes) remains **Draft** — canonical `main` product baseline for final acceptance is not yet updated.
3. Re-run full matrix on merge SHA of #161 with the same isolated HOME procedure; any product delta requires explicit delta review.

## 5. Product code

This record is **docs-only**. No Rust/frontend/catalog changes.
