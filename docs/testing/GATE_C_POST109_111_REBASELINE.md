# Gate C post-#109 / #111 rebaseline assessment

- Work ID: `MO-GATE-C-POST109-111-REBASELINE-1`
- Assessment date: 2026-09-10
- Branch: `docs/gate-c-post109-111-rebaseline`
- Verdict header: **`MO_GATE_C_REBASELINE_CODE_READY`**

Do not record local absolute paths, volume UUIDs, media fingerprints, or personal
sample names here.

## Evaluation baseline

| Field | Value |
|---|---|
| evaluation commit | `2cbb4a38c9b0df9801859a63a1763e7bbd2289cb` |
| evaluation tree | `a91b64765fcf138e2a7d5c5647e2dac973d574aa` |
| base branch | `main` |
| RC6 source commit | `3485118e9a19413eae9a3203338d0b361660a902` |
| commits RC6 → evaluation | 34 (non-merge count on ancestry) |

## Start snapshot (re-fetched 2026-09-10)

| Item | Observed |
|---|---|
| OPEN PRs (repo-wide) | 0 |
| duplicate rebaseline branch/PR | none |
| RC7 tag / draft release / ledger section | not present |
| next candidate number (uncreated) | 7 (not reserved; identity `UNSET`) |
| Human Gate C | `NOT_RUN` |
| Gate C | `NOT_PASS` |
| M5 | `INCOMPLETE` |
| #103 / #104 / #105 | CLOSED / unmerged (untouched) |

## #109 / #111 merge confirmation

| PR | Merge commit | Reviewed head | On evaluation commit |
|---|---|---|---|
| #109 shared Project parser / reference contracts | `2be490aecae4fd8602fade638d253699ca136ca1` | `9c121a1a2d24ab5a3070c2e4beb07f2e60e7780e` | ancestor of `2cbb4a3` |
| #111 shared contract tests / product blockers | `2cbb4a38c9b0df9801859a63a1763e7bbd2289cb` | `877ebbfcef6936ae1e5f5e0cbd4b77ed36f85ea4` | **is** evaluation commit |
| #110 / #112 CSS / design tokens | merged | — | ancestors of `2cbb4a3` |

## CI evidence (event-separated)

PR-triggered success does **not** substitute for merge-after-main push success.

| Merge / head | Event | Workflow | Run | Conclusion | Notes |
|---|---|---|---|---|---|
| #109 head `9c121a1…` | `pull_request` | CI | [`34404495185`](https://github.com/kaz4g/masterocta/actions/runs/34404495185) | success | PR event only |
| #109 merge `2be490a…` | `push` | CI | [`34426469903`](https://github.com/kaz4g/masterocta/actions/runs/34426469903) | **cancelled** | concurrency cancel; do not treat as main PASS |
| #111 head `877ebbf…` | `pull_request` | CI | [`34413416445`](https://github.com/kaz4g/masterocta/actions/runs/34413416445) | success | PR event only |
| #111 merge / evaluation `2cbb4a3` | `push` | CI | [`34426771538`](https://github.com/kaz4g/masterocta/actions/runs/34426771538) | **success** | authoritative for evaluation commit |

Local `cargo test` for targeted suites: **not run** (`cargo` unavailable in agent
environment). Product-behavior claims below are from code inspection plus merged
PR CI above.

## #109 / #111 contract points on evaluation commit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Schema 11 + catalog trust repair; legacy catalog not trusted unconditionally | **CONFIRMED** | `ot-catalog/migrations/0010_observational_projection_trust.sql`, `0011_projection_trust_repair.sql`; `CatalogStore::observational_projection_untrusted`, `mark_observational_projection_untrusted` in `ot-catalog/src/lib.rs`; write gates in `v2_api.rs` |
| 2 | Required Project container validation | **CONFIRMED** | `ot-codec` project structure / `parse_project_document`; contract `docs/planning/GATE_C_SHARED_PROJECT_CONTRACT.md` §Required Project containers |
| 3 | Shared codec + upstream compatibility use same held bytes | **CONFIRMED** | `legacy_read_adapter.rs` upstream verification writes bytes read for codec parsing to TempDir before `ProjectFile::from_data_file` |
| 4 | Upstream document rejection → `Malformed`; no assignments retained | **CONFIRMED** | `GATE_C_SHARED_PROJECT_CONTRACT.md` §Compatibility; adapter marks rejection without assignment retention |
| 5 | Verify I/O failure → scan failure / root untrusted; write/rename blocked | **CONFIRMED** | `VERIFY_UNAVAILABLE:` in `legacy_read_adapter.rs`; `v2_api.rs` `mark_observational_projection_untrusted` + fail-closed write/rename paths |
| 6 | Project / Bank decode / Bank validation / sample-settings provenance separated | **CONFIRMED** | `GATE_C_SHARED_PROJECT_CONTRACT.md` §Parser provenance by document kind; `bank_validation.rs` `BANK_VALIDATOR_NAME` / `v1` |
| 7 | Bank machine type 0–4 only; others not treated as normal for usage | **CONFIRMED** | `bank_validation.rs` `machine_type_valid` (`matches!(0..=4)`); invalid → `BankValidationError::InvalidMachineType` → non-`Parsed` |
| 8 | CT-01–04; Apply checks verification + rescan + reference counts | **CONFIRMED** | `initial_contract_tests.rs` `assert_apply_verification_contract` (`verification_state=passed`, `rescan_completed=true`); `migration_contract_tests.rs` CT-04 |
| 9 | Case-insensitive unique inventory control on macOS volumes | **CONFIRMED** | `ot-domain/reference_identity.rs`; `ot-plan/rename.rs` case-insensitive collision checks; CT-03 inventory rules in `initial_contract_tests.rs` |
| 10 | Saved checkpoint / FK restore / multi-suite exit aggregation | **CONFIRMED** | `migration_contract_tests.rs` `ct04_failed_migration_8_restores_foreign_keys_outside_transaction`; CT-04 populated v7 migrator contract |

## RC6 → evaluation commit (Gate C–relevant)

| Change | PR / commit | Acceptance path | In RC6? | New candidate needs |
|---|---|---|---|---|
| Shared Project parser + reference contracts | #109 / `2be490a` | Project read, plan, prepare, apply verify | no | yes |
| Contract tests + remaining blockers | #111 / `2cbb4a3` | CT-01–04, apply verification gaps | no | yes |
| Catalog trust 0010/0011 + migration 8 FK fix | #109 chain | scan, write gate, rename gate | no | yes |
| Bank machine type 0–4 validation | #109 chain | usage graph, rename completeness | no | yes |
| Upstream fail-closed on held bytes | #109 chain | catalog Parsed / Malformed | no | yes |
| RC6 freeze ledger | #108 | candidate identity only | yes (historical) | preserve; do not reuse artifact |
| CSS / design tokens | #110, #112 | UI only | partial CSS baseline | no Gate C product-path retest required |

**RC6 positioning:** RC6 `gate-c-rc6-3485118e9a19` remains `FROZEN` with full freeze
evidence (run `34182724485`, DMG/binary hashes unchanged). It is **not** the
current-main Human Gate C authorization target after #109 / #111. Human Gate C
on RC6 without a new frozen candidate is **FORBIDDEN** for current main.

## Bank checksum impact judgment

**Verdict: `NON_BLOCKING_FOR_CURRENT_RENAME_GATE`**

| Question | Finding |
|---|---|
| Is Bank checksum verified at catalog read? | **No** — intentional. `bank_validation.rs` validates header/version/bounds/machine type only; module doc states checksum enforcement awaits role-specific fixtures. |
| `.ot` sidecar vs Bank checksum | **Separate.** Sidecar uses `masterocta/sample-settings` / `v1` with `validate()` / checksum at read. Bank uses `ot-tools-io` decode + `bank-validation` / `v1` without `check_checksum` at catalog gate. |
| Does rename Apply rewrite Bank bytes? | **No.** `ot-plan/rename.rs` `build_state_document_impacts` skips non-`Project` documents; codec rewrites Project `PATH=` only. |
| Can bad Bank bytes break rename safety without checksum reject? | **Partially mitigated, not checksum-proven.** Decode/validation/machine-type gates mark Bank non-`Parsed` and block incomplete usage; checksum mismatch alone can still parse as `Parsed` until future enforcement. |
| What #109/#111 prove | Structural validation, machine type gate, CT contracts, apply verification/rescan; **not** role-specific Bank checksum reject fixtures. |
| What remains (not resolved) | `.work` vs `.strd` Bank checksum enforcement fixtures per `GATE_C_SHARED_PROJECT_CONTRACT.md` §Bank checksum and PR #109/#111 remaining notes. |

This judgment does **not** clear Bank checksum work for future Bank write features.
It does **not** authorize Human Gate C or candidate dispatch.

## Next candidate readiness

| Gate | Status |
|---|---|
| Code aligned with evaluation commit | yes (on `main`) |
| Bank checksum blocks rename gate | no (`NON_BLOCKING`) |
| Rebaseline docs + ledger + smoke aligned | this PR |
| Operator preflight on new main tip | **not done** |
| RC7 identity (source/tree/DMG/run/release) | **UNSET** |
| Candidate workflow dispatch | **not authorized** by this PR |
| Human Gate C | **NOT_RUN** |
| Gate C | **NOT_PASS** |
| M5 | **INCOMPLETE** |

**Candidate creation proceed?** After this PR merges: **yes, to operator preflight
only** — not to dispatch. Operator must fix source commit/tree on current main,
run main CI success confirmation, then one-shot `Gate C Candidate Build` per
ledger rules. Do not pre-fill RC7 hashes or run IDs.

## FAT-HASH-1 interaction

Prior assessment remains `ASSESSED` / `ACCEPTED_WITH_EVIDENCE` for assessed tree
`713c0187…` (PR #93). This rebaseline does **not** revoke that verdict.

Post-#109/#111 Gate C rename path uses live post-apply rescan and byte-manifest
comparison (`scripts/gate-c-byte-manifest.mjs`); CT-01 harness asserts
`rescan_completed` and verification state. No evidence that current rename gate
judgments consume catalog hash reuse for write safety on evaluation commit.

## Verification performed for this PR

| Check | Result |
|---|---|
| Code inspection on evaluation commit | PASS |
| `git diff --check` (docs-only) | run at commit time |
| Local `cargo test bank_validation` | **not run** — `cargo` not in PATH |
| Local full CI suite | **not run** — docs-only PR; evaluation commit covered by CI run `34426771538` |
| GitHub Actions on this docs PR | expected **skipped** (CI paths exclude `docs/**`) |

## Remaining blockers (outside this PR)

- Operator preflight + RC7 freeze (future docs-only ledger after successful dispatch)
- Human Gate C clone-load smoke on frozen post-rebaseline candidate
- Bank checksum role-specific fixtures (future; non-blocking for rename gate)
- M5 closure PR (after Human Gate C PASS)

## Next action

| Step | Owner | Expected output |
|---|---|---|
| Merge this rebaseline PR | reviewer | ledger + smoke + handoff aligned on `main` |
| Operator preflight on merged main tip | human operator | recorded source commit/tree for RC7 |
| Main CI success after preflight base | CI | green `push` run on preflight commit |
| One-shot Gate C Candidate Build | human operator | draft release + evidence JSON (not in this work) |

This assessment did **not** merge, dispatch workflows, create candidates, or access
removable media.
