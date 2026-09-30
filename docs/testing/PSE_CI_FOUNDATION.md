# Project Structure CI / Safety Gate foundation

- Work ID: `MO-PSE-CI-FOUNDATION-1`
- Parent issue: #191
- Start `origin/main`: `e71d737609cdbda1af25975c4e6a7aa4471b5264` (PR #188 Read Model)
- Workflow: [`.github/workflows/pse-ci.yml`](../../.github/workflows/pse-ci.yml)
- Shared entry: `pnpm run test:pse-read-model` / `node scripts/pse-read-model-check.mjs`
- Inventory: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)

This document is the CI audit, reuse map, and Gate ledger for the Project
Structure / Bank Editor line. It does **not** authorize Bank Apply, Recovery,
or public distribution. M5–M11 numbers are unchanged.

## 1. Canonical state at foundation start

| Item | Value |
| --- | --- |
| `origin/main` | `e71d737609cdbda1af25975c4e6a7aa4471b5264` |
| Worktree | `.worktrees/pse-ci-foundation-1` |
| Branch | `cursor/pse-ci-foundation-1-6c5e` |
| Parallel open PRs | #189 DTO boundary, #190 Arranger read |
| Shared files avoided | `scripts/check-architecture.mjs`, `scripts/check-containment.mjs` |

## 2. Existing CI reuse map

Inspected on `e71d737`. Existing [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
already owns workspace-wide product checks. The dedicated Project Structure
workflow does **not** rebuild the full workspace for format, frontend, E2E, or
Gate C.

| Inspection | Workflow / job | Command | OS | Trigger | Evidence | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| Rust format | `CI` / `Rust Tests` | `cargo fmt --all -- --check` | ubuntu-22.04 | PR + push `main` (path-filtered) | existing CI | none; reused |
| Rust clippy | `CI` / `Rust Tests` | `clippy --workspace --exclude masterocta` then `clippy -p masterocta --features test-seams` | ubuntu-22.04 | same | existing CI | none; feature split kept |
| Rust tests | `CI` / `Rust Tests` | `cargo test --workspace --exclude masterocta` then `cargo test -p masterocta --features test-seams` | ubuntu-22.04 | same | existing CI | includes reader tests, but no inventory / 0-test guard |
| Architecture | `CI` / `Rust Tests` | `node scripts/check-architecture.mjs` | ubuntu-22.04 | same | existing CI | none; reused |
| Containment | `CI` / `Rust Tests` | `node scripts/check-containment.mjs` + legacy command tests | ubuntu-22.04 | same | existing CI | none; reused |
| Frontend typecheck / unit / build | `CI` / `Frontend Checks` | `pnpm run typecheck`, `test:frontend`, `build` | ubuntu-latest | same | existing CI | none; reused |
| E2E | `CI` / `E2E Tests` | `pnpm run test:e2e` | ubuntu-latest | same | existing CI | none; reused |
| Gate C Synthetic Smoke | `CI` / `Gate C Synthetic Smoke` | `scripts/gate-c-synthetic-smoke.sh` | ubuntu-22.04 + macos-latest | same | existing CI | none; not deleted or weakened |
| Gate C byte-manifest / candidate contracts | `CI` / `Frontend Checks` | `test:gate-c-manifest`, `test:gate-c-candidate` | ubuntu-latest | same | existing CI | Gate C forbids symlinks; PSE needs its own recorder |
| macOS app bundle / signed build | `Gate C Candidate Build` | dispatch-only freeze + codesign | macos-latest | `workflow_dispatch` only | not a PR check | **not reused** for PR CI (signing / draft release) |
| Project Structure inventory + PRE/POST | **new** `Project Structure CI` | `node scripts/pse-read-model-check.mjs` | ubuntu-22.04 + macos-latest | PR + push `main` | this workflow | added |
| Script / aggregate contracts | **new** `Project Structure Scripts` | `pnpm run test:pse-scripts` | ubuntu-22.04 | always | this workflow | added |

### Why a dedicated workflow

- Existing CI already compiles the whole workspace. Duplicating that in a second
  workflow would add cost without new proof.
- A required-check candidate must always report. Workflow-level `paths:` would
  leave the check Pending on docs-only PRs.
- Feature-branch `push` is omitted so a PR and its branch do not run the same
  SHA twice. `push` is `main` only, matching existing CI.
- Merge queue / `merge_group` is not configured on this repository (ruleset
  `Protect main` has no merge-queue rule).

## 3. Shared inspection entry

Local and CI use the same commands.

```bash
pnpm run test:pse-scripts
pnpm run test:pse-read-model
```

`test:pse-read-model`:

1. Loads [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json).
2. Lists and runs the real `ot-domain` / `masterocta --features test-seams` tests.
3. Fails on missing, ignored, failed, or **zero executed** tests.
4. Copies tracked fixtures into a temporary tree (never the tracked originals).
5. Captures PRE, invokes the product reader harness, captures POST, compares.

Adding a required contract test means adding it to the inventory. Do not add a
CI-only parser.

## 4. Implemented gates

| Gate | Issue | Implementation | Verification | Status | Next enablement |
| --- | --- | --- | --- | --- | --- |
| Read Model / domain contracts | #179 / #191 | `ot_domain::project_structure` + `project_structure_reader` + inventory runner | inventory suites on the PR head | **PASS** when the Linux/macOS jobs succeed | keep inventory current |
| Fixture PRE/POST + symlink text | #191 | `scripts/pse-fixture-manifest.mjs` + preserve scenarios | happy / mixed / missing / symlink | **PASS** when preserve reports identical PRE/POST | none |
| Comparator negative tests | #191 | 1-byte / add / delete / rename / link change | `pse-fixture-manifest.test.mjs` | **PASS** when script job succeeds | none |
| Zero-test / ignore / skip detection | #191 | inventory parser + aggregate evaluator | unit tests + CI aggregate | **PASS** when those tests succeed | none |
| Architecture / containment | existing | unchanged existing CI jobs | existing CI | reused; this workflow does not re-run them | none |
| Sample Management / Gate C regression | existing | unchanged `CI` workflow | existing CI | reused; not weakened | none |
| Linux / macOS FS + symlink | #191 | same read-model entry on both OSes | Linux + macOS jobs | **PASS** when both succeed | none |
| macOS signed / notarized app | — | Gate C Candidate only | not a PR check | **NOT_APPLICABLE** for this read-only foundation | do not run release workflows from PR CI |
| Viewer UI / E2E | #180 | none | — | **BLOCKED** | Viewer implementation |
| ChangePlan determinism / stale | #181 | none | — | **BLOCKED** | ChangePlan implementation |
| Expected-changed-files Apply | #183 | none | — | **BLOCKED** | Apply authorization + implementation |
| Reference integrity after mutation | #184 | none | — | **BLOCKED** | Apply + integrity suite |
| Backup / failure injection / Recovery | #185 | none | — | **BLOCKED** | Recovery implementation |
| Native acceptance | #186 | none | — | **BLOCKED** | Native session after Viewer/Apply |
| Slot ↔ AudioAsset boundary | #187 | none | — | **BLOCKED** | ownership-boundary implementation |

Unimplemented gates are not empty tests, `continue-on-error`, or unconditional
skips. They stay **BLOCKED** until the product code exists.

## 5. Fixture safety and proof scope

Tracked fixtures used after copy into a dedicated temporary directory:

| Fixture | Provenance | Files copied |
| --- | --- | --- |
| `src-tauri/tests/fixtures/real_device` | tracked repo fixture used by PR #188 | `project.work`, `bank01.work`, `bank01.strd`, `markers.work`, `arr01.work` |
| `src-tauri/tests/fixtures/multipart` | tracked synthetic Bank spanning four Parts | used by inventory rust tests (their own temp copies) |

Preserve scenarios (Node harness):

- `happy`: read a copied `real_device` tree twice
- `mixed`: valid `bank01.work` plus undecodable `bank02.work`
- `missing`: containment / missing project path
- `symlink`: `bank02.work` is a symlink and is treated as absent

PRE and POST manifests record root-relative path, entry type, regular-file size
and SHA-256, and raw symlink text. External symlink targets are not followed or
hashed. Manifests and reports are written **outside** the copied tree.

### Proof scope

PRE/POST hash identity is evidence that the copied tree bytes and symlink text
are unchanged after the read. It is **not** a proof that no write syscall
occurred. Combine it with:

- `project_structure_reader` has no write API
- containment via `resolve_relative_for_read` / `is_regular_source_file`
- existing architecture / containment guards in `CI`
- rust tests that hash the copied tree before and after a read

mtime / atime are not used as correctness.

The product reader requires a **canonical** registered root (`resolve_relative_for_read`
uses `canonicalize()` then `starts_with(root)`). On macOS, `/var` → `/private/var`.
The CI harness therefore `realpath`s / `canonicalize`s the temporary copy before
the read. That is a path-contract check, not a weakening of containment.

## 6. Workflow behavior

| Topic | Behavior |
| --- | --- |
| Triggers | `pull_request` to `main`; `push` to `main` only |
| Feature-branch push | not used (avoids PR + branch double-run) |
| `workflow_dispatch` | not added; must not replace required PR checks |
| `pull_request_target` | forbidden / unused |
| Path filter | job-level via `pse-ci-scope.mjs`, not workflow `paths:` |
| Docs-only | rust jobs skip; aggregate verdict `NOT_APPLICABLE` (not “tests passed”) |
| Unknown path state | treated as in-scope (fail closed) |
| Concurrency | `pse-ci-${{ pr.number \|\| ref }}`, cancel in progress |
| Timeouts | 10 / 45 / 5 minutes by job |
| Permissions | `contents: read` |
| Secrets | none |
| Action pins | same full SHAs as existing CI |
| Artifacts | PRE/POST/summary JSON only; no catalog, user audio, or Project originals |
| Aggregate | `always()`; evaluates `needs.*.result`; never unconditional `exit 0` |

Required-check candidate name: **`Project Structure CI / Project Structure`**.

## 7. Compatibility

| Surface | This change | Status |
| --- | --- | --- |
| M6 / M7 completion text | not edited except one additive PSE CI bullet | unchanged |
| Gate C jobs / scripts | not deleted or weakened | reused |
| `cargo test --workspace` replacement | not done; `test-seams` split kept | preserved |
| Linux read-model | new job | this workflow |
| macOS path / symlink | new job | this workflow |
| Full Tauri `.app` bundle | not added | **NOT_APPLICABLE** here |

## 8. Deferred findings from PR #188

| Finding | Current main (`e71d737`) | Gate status |
| --- | --- | --- |
| Arranger Bank / Pattern references | still unmodeled (`UnmodeledDependency::Arrangements`); #190 is an open follow-up | **BLOCKED** for ChangePlan |
| `project.work` BANK / PATTERN / ARRANGEMENT | not decoded by the structure reader | **BLOCKED** |
| Working / SavedCheckpoint must not mix in a later plan | reader keeps separate entries today | keep as a later ChangePlan check |
| Bank file self-index | still unverified | **BLOCKED** |
| Multiple Bank fixtures | still only `bank01` tracked | **BLOCKED** for multi-bank plans |
| Scenes / Recorder unmodeled | listed, never treated as absent | keep listed; do not skip |

Do not revive disabled legacy `copy_bank`. Do not reuse rename APIs as Bank swap.

This CI PASS is **not** Bank Apply approval.

## 9. Required checks vs repository protection

Read-only check of ruleset `Protect main` (`21538639`) on 2026-09-30:

- Enforcement: active on the default branch
- Rules: `deletion`, `non_fast_forward`, `pull_request` (0 approving reviews)
- **No required status checks are configured**
- Classic branch-protection API: **UNKNOWN** (403 to this integration)

No ruleset or branch-protection change is made by this work.

### Required-check candidates (documentation only)

| Candidate | Source | Notes |
| --- | --- | --- |
| `CI / Rust Tests` | existing | format, clippy, architecture, containment, rust tests |
| `CI / Frontend Checks` | existing | typecheck, unit, Gate C script contracts, build |
| `CI / E2E Tests` | existing | Playwright |
| `CI / Gate C Synthetic Smoke (ubuntu-22.04)` | existing | Gate C regression |
| `CI / Gate C Synthetic Smoke (macos-latest)` | existing | Gate C regression |
| `Project Structure CI / Project Structure` | **new aggregate** | read-model + fixture + skip/fail propagation |

`Bank Mutation Safety` is **not** a candidate until #183/#185 exist.

## 10. Reproduction

```bash
# script contracts (no Rust)
pnpm run test:pse-scripts

# real reader + inventory + PRE/POST (needs Rust / GTK stack on Linux)
pnpm run test:pse-read-model
```

Record the checked SHA, OS, rustc/cargo/node versions, suite counts from the
inventory summary, and the Actions run URL. Do not reuse another branch’s
green result. Do not treat the GitHub test-merge SHA as the PR head SHA.
