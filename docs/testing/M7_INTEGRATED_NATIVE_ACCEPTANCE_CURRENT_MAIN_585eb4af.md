# M7 Integrated Native Acceptance — historical main @ `585eb4af`

**Historical record:** Operator session on **`585eb4afbd38c361c5af8c32e1b5920a8bbaf9c8`** (2026-09-30). Current product `main`: **`ad4953c7f2c6d559e24f0b28e2037606691df1e6`**. **A12 PASS criteria:** [`M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §15.A.1 **Stale (A12)** (amendment 1). **A12** **NOT_RUN**; **M7** **IN_PROGRESS**.

**Work ID:** `MO-M7-CURRENT-MAIN-NATIVE-ACCEPTANCE-1` (Native session)  
**Prior prep:** `MO-SAMPLE-MANAGEMENT-CURRENT-MAIN-1`  
**Issue:** [#177](https://github.com/kaz4g/masterocta/issues/177) (OPEN)  
**Recorded:** 2026-09-30 (UTC session stamp `20260930T214101Z`)  
**Overall result:** **STOP_WITH_FINDINGS** — **A01** / **B01** PASS; **A12** **NOT_RUN** (by design); **A02–A11**, **A13–A15**, **B02–B03** **NOT_RUN** (Native root registration blocked)

Operator-local evidence bundles (isolated HOME, fixture roots, lsof captures) were **not** committed to the repository; paths below use placeholders.

## Product baseline

| Item | Value |
| --- | --- |
| Execution SHA | **`585eb4afbd38c361c5af8c32e1b5920a8bbaf9c8`** |
| origin/main @ session start | **`585eb4afbd38c361c5af8c32e1b5920a8bbaf9c8`** (PR #176 merge) |
| Execution worktree | detached @ `585eb4af` (product tree unchanged) |
| Isolated HOME | `$ISOLATED_HOME` (fresh under `/tmp/masterocta-m7-native-585eb4af-*`) |

**Cross-session rule:** No reuse of `caa47660`, `04725cb3`, or other isolated HOME / PASS rows.

## Preparation evidence

| Step | Result | Notes |
| --- | --- | --- |
| `git fetch origin main` + SHA match | **PASS** | |
| Worktree clean (product) | **PASS** | Session docs untracked only |
| Catalog absent before first launch | **PASS** | `catalog.sqlite3` missing pre-launch |
| Mono/stereo PRE byte manifests | **PASS** | `gate-c-byte-manifest.mjs capture` |
| PR #176 contract tests (prior work ID) | **PASS** | [`A12_JUDGMENT_MEMO.md`](./evidence/MO_SAMPLE_MGMT_585eb4af_20261001/A12_JUDGMENT_MEMO.md) |

### Mono fixture (Group A)

| Item | Value |
| --- | --- |
| fixtureRoot | `$MONO_FIXTURE_ROOT` (generator-owned temp; read-only register) |
| RANGE.wav PRE SHA256 | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |

### Stereo fixture (Group B)

| Item | Value |
| --- | --- |
| fixtureRoot | `$STEREO_FIXTURE_ROOT` (generator-owned temp) |
| STEREO_RANGE PRE SHA256 | `219088198bd411f7def4db2861dc7260cce5c76fccf2de888ef2c2144e25065c` |
| leftDistinctFromRight | **true** (generator) |

## Operator matrix

| ID | Result | Summary |
| --- | --- | --- |
| A01 | **PASS** | Isolated `HOME`; catalog FD on isolated DB only |
| A02–A11 | **NOT_RUN** | STOP at root register |
| A12 | **NOT_RUN** | See [`A12_JUDGMENT_MEMO.md`](./evidence/MO_SAMPLE_MGMT_585eb4af_20261001/A12_JUDGMENT_MEMO.md); normative criteria now in exit audit §15.A.1 |
| A13–A15 | **NOT_RUN** | — |
| B01 | **PASS** | Stereo PRE integrity |
| B02–B03 | **NOT_RUN** | — |

**M7 milestone:** **IN_PROGRESS**. Do **not** update `M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md` or `DEVELOPMENT_STATUS.md` to COMPLETE.

## Findings

### F-NATIVE-UI-1 — Root picker not completed (STOP)

Catalog remained at **0** roots after automation attempts. Operator must continue A02+ manually on the **same** isolated HOME if completing the matrix (local STOP bundle not in repo).

### F-A12

Native A12 remains **NOT_RUN**; Rust command test is layer B only per amendment 1.

## Operator handoff (resume — historical)

Same order as [`M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md`](./M7_INTEGRATED_NATIVE_ACCEPTANCE_3.md) §5 on a **new** isolated HOME if retrying. For **A12**, follow exit audit §15.A.1 Native layer A (review invalidation), not a deliberate stale export send.

## Evidence index (repository)

| Artifact | Path |
| --- | --- |
| A12 memo | [`evidence/MO_SAMPLE_MGMT_585eb4af_20261001/A12_JUDGMENT_MEMO.md`](./evidence/MO_SAMPLE_MGMT_585eb4af_20261001/A12_JUDGMENT_MEMO.md) |

## Product code

No Rust/frontend/catalog changes during this session.
