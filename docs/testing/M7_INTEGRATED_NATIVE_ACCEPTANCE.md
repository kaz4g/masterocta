# M7 Integrated Native Acceptance

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`
**Reconciled:** 2026-09-23, PR #156 (docs only)
**Current integrated Native result:** **NOT_RUN**
**M7 milestone:** **IN_PROGRESS** — not READY_FOR_FINAL_ACCEPTANCE or COMPLETE.

Historical #153/#154 checklists remain **NOT_RUN**. New evidence may supersede
only their covered operator intent; it does not rewrite their recorded results.
A plan, fixture generation, CI, browser/mock IPC, or a PR merge is not Native PASS.

Canonical criteria: [`M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §6,
§13, §15.A and §18; status vocabulary:
[`DEVELOPMENT_STATUS.md`](../planning/DEVELOPMENT_STATUS.md).

## 1. Current start gate (not an execution claim)

| Item | Verified repository state / required operator record |
| --- | --- |
| Canonical main at reconciliation | `b2c7765772bd3894472ba936664cabc0db92fcf1` |
| PR #155 | **MERGED**, merge SHA equals the canonical main above |
| Merge time | 2026-09-21 19:22:56 UTC / 2026-09-22 04:22:56 JST |
| Original #156 head | `d9dd7e3b400c64eba1442dc3738611dc38056db1` |
| Historical product baseline | `37f86c9603e74bbb59735a98fa79dc51d888ec24` (#154) |
| PR branch | `accept/m7-integrated-native-1`, base `main`, both `kaz4g/masterocta` |
| Old "#155 unmerged" prerequisite | **SATISFIED**; not a Native result |
| Actual Native executed SHA / host / session | **NOT_RECORDED** — no current Native session |
| Catalog schema expected from main | 13; runtime value still **NOT_RUN** |
| Operator start decision | Repository prerequisite cleared; require verified isolated macOS environment before launch |
| M7 closure decision | **BLOCKED** by Native gaps and stereo independent-display gap |

The reconciliation session has Linux tooling, not a connected operator Mac/Tauri
GUI. It performed repository/document inspection, not Native acceptance.
Do not copy the historical Darwin environment or automated PASS rows into the
current session. No product, Rust, frontend, Tauri, catalog, lockfile, CI, RC8, or
real Octatrack-media changes are part of this reconciliation.

## 2. Scope and result rules

**Group A:** integrated Waveform → Slice → derived export → Inspector lineage →
quit/relaunch, including original preservation, retry, stale rejection, and
post-quit draft persistence. This closes the #153/#154 evidence gap only when
all A rows have observed PASS and durable evidence. M7-05 step C is included.

**Group B:** stereo independently displayable. Main's audit records overlapping
channel paths and Exit row 3 **PARTIAL**. This requires the separate minimal
product work `MO-M7-STEREO-CHANNEL-LANES-1` and real Native evidence. Merely
observing the known gap is not a PASS.

The existing generator
[`generate-ui-workspace-native-fixture.mjs`](../../scripts/generate-ui-workspace-native-fixture.mjs)
sets `CHANNELS = 1`. Its `RANGE.wav` is **mono**, so it cannot prove group B.
Use a separately reviewed disposable two-channel fixture with distinguishable
left/right content; do not modify RANGE or its expected SHA to fake coverage.

Group A may be recorded PASS independently after actual execution, while group B
and full M7 remain open. Full integrated acceptance requires A and B PASS on the
final reviewed main product baseline. A later product change requires an explicit
delta review and relevant re-execution; an old SHA's PASS is not silently carried
forward. Keep PR #156 Draft until required evidence and verification are complete.
Do not merge, enable auto-merge, release, or modify Gate C/RC8 through this record.

Canvas, wheel-scroll, long-file quality observation, 100-clip corpus, stem,
mac_derived Library injection, parent navigation, batch export and `.ot`/media
Apply are not added as M7 Exit blockers. Info-tab IPC diagnostics remain a separately tracked quality row Q01, not a new
Exit requirement. TRIM→SLICE via derived Library browse
remains **NOT_APPLICABLE** to this acceptance scope, not an unperformed PASS.

## 3. Isolated Mac execution procedure — NOT_RUN

**Harness note (macOS realpath, `MO-M7-NATIVE-HARNESS-MACOS-REALPATH-FIX-1`):** On
Darwin, invoking `scripts/generate-ui-workspace-native-fixture.mjs` or
`scripts/verify-ui-workspace-range-sha.mjs` via a logical absolute path (for example
`/var/...` while the module resolves under `/private/var/...`) previously failed the
direct-run guard and exited **0 with empty stdout**, so
`scripts/prepare-ui-workspace-native-acceptance.sh` could proceed with an empty manifest.
Harness scripts now canonicalize invocation paths (`compare-script-invocation.mjs`),
use `pwd -P` for `ROOT_DIR`, and fail closed on empty or invalid manifest JSON.
That removes the preparation blocker only; **integrated Native remains NOT_RUN** until
an operator records A/B matrix evidence on isolated macOS.

**Harness note (macOS realpath, `MO-M7-NATIVE-HARNESS-MACOS-REALPATH-FIX-2`):** The same
logical-vs-physical path mismatch affected
`scripts/launch-native-acceptance-env.mjs` when invoked from
`scripts/launch-native-acceptance-tauri.sh` with a logical repo root (`/var/...`), causing
**exit 0 with empty stdout** and downstream `JSON.parse` failures before Tauri start.
The launcher now canonicalizes `ROOT_DIR`, reuses `compare-script-invocation.mjs` for the env
helper CLI guard, and fails closed on empty or invalid child-environment JSON. This removes
the launcher preparation blocker only; **integrated Native remains NOT_RUN**.

Read `AGENTS.md`, `docs/CODEX_HANDOFF.md`, and the fixture-safety / PR-gate skills.
Keep the currently running app and unrelated worktrees untouched. Use a new
acceptance worktree at the current, reviewed `origin/main` and record its full
SHA. Do not run the stale original #156 product checkout as "current main".

Suggested preparation, run from the operator's repository in **bash**:

```bash
set -euo pipefail
[ "$(uname -s)" = Darwin ] || { echo "STOP: macOS required" >&2; exit 1; }
git remote get-url origin                  # must be kaz4g/masterocta
# Stop on a different repository; do not mutate upstream.
git fetch origin
BASELINE_SHA="b2c7765772bd3894472ba936664cabc0db92fcf1"
PRODUCT_SHA="$(git rev-parse origin/main)"
if ! git merge-base --is-ancestor "$BASELINE_SHA" "$PRODUCT_SHA"; then
  echo "STOP: origin/main is not descended from recorded baseline $BASELINE_SHA" >&2
  exit 1
fi
if [ "$PRODUCT_SHA" != "$BASELINE_SHA" ]; then
  echo "STOP: origin/main moved to $PRODUCT_SHA. Review delta and update this doc baseline before continuing:" >&2
  git diff --name-status "$BASELINE_SHA" "$PRODUCT_SHA"
  exit 1
fi
SESSION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/masterocta-m7-accept.XXXXXX")"
git worktree add --detach "$SESSION_DIR/worktree" "$PRODUCT_SHA"
cd "$SESSION_DIR/worktree"
git status --short
pnpm install --frozen-lockfile
bash scripts/prepare-ui-workspace-native-acceptance.sh | tee "$SESSION_DIR/prep.log"
ISOLATED_HOME="$(sed -n 's/^isolated_home=//p' "$SESSION_DIR/prep.log")"
FIXTURE_ROOT="$(sed -n 's/^fixture_root=//p' "$SESSION_DIR/prep.log")"
test -d "$ISOLATED_HOME"
test -d "$FIXTURE_ROOT"
bash scripts/launch-native-acceptance-tauri.sh --print-child-env "$ISOLATED_HOME" "$PWD"
# Record pre-manifests before GUI operations; keep raw paths private.
bash scripts/launch-native-acceptance-tauri.sh "$ISOLATED_HOME" "$PWD"
```

Use the existing launcher, which preserves the real toolchain environment for
the child process. Do not globally replace HOME/PATH or repair the product to
work around a launcher/environment problem. Port/process collisions: record and
stop; do not kill unrelated development processes.

**Isolation gate (before A02 — mandatory):** As soon as the Tauri dev process is
running, verify the **live app process** catalog binding with `lsof` (or
equivalent). Do **not** register, scan, or select the fixture until this passes.
Startup opens the catalog before any operator registration
([`RootRegistryPanel`](../../src/features/roots/RootRegistryPanel.tsx) writes later).
If `HOME` isolation is wrong, registration would contaminate the real user catalog.

On macOS `/tmp` may appear as `/private/tmp`; compare canonical paths. Inspect
**all** catalog-related open files for the `masterocta` process. **STOP** if any
handle resolves outside `$ISOLATED_HOME` (especially the operator's real HOME).
File existence under isolated HOME alone is not proof.

Expected paths (code-derived; not runtime proof):

```text
catalog: $ISOLATED_HOME/Library/Application Support/MasterOCTa/catalog.sqlite3
derived: $ISOLATED_HOME/Library/Application Support/MasterOCTa/derived-audio/published/v1/
source:  $FIXTURE_ROOT/SET/AUDIO/RANGE.wav
RANGE expected SHA256:
43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1
```

Only managed synthetic fixtures are allowed. No original SD/CF card, real music
root, or real catalog. Reject symlinks and unexpected files. Store logs/evidence
outside the fixture root. Never delete an unverified directory for cleanup.

## 4. Operator matrix — every current execution row remains NOT_RUN

| ID | Required observation | Result | Evidence to retain |
| --- | --- | --- | --- |
| A01 | Launch exact reviewed main SHA in isolated HOME; **lsof catalog binding before any register/scan** | **NOT_RUN** | SHA, OS/tool versions, sanitized `lsof` on live process; stop if real HOME |
| A02 | After A01 PASS: register read-only fixture, scan, select RANGE; Info initially has no children | **NOT_RUN** | Root-relative fixture inventory and initial Info screenshot |
| A03 | Waveform renders; resize/zoom/pan and range preview Play/Stop work | **NOT_RUN** | Viewport/range and screenshots; distinguish mono from stereo |
| A04 | Analyze/apply or verify an existing saved draft; marker/select/preview work | **NOT_RUN** | Opaque draft identity, range, revision and marker/slice state. After first analysis, record iterative **pending range → explicit re-analyze → new candidates → draft update** in Slice workspace (library preview selection vs analysis region remain distinct). |
| A05 | Export selected slice: review → confirm → success | **NOT_RUN** | Selected source-frame interval, success UI, opaque child asset id |
| A06 | Published WAV is in isolated Mac storage with the expected audio range | **NOT_RUN** | Relative output name, SHA256, rate/channels/frame count; independently check selected source range |
| A07 | No `.part`, symlink, extra published WAV, or derived file inside fixture | **NOT_RUN** | Full relative published inventory; staging check; fixture inventory |
| A08 | Original RANGE SHA and complete fixture manifest unchanged | **NOT_RUN** | Before/after RANGE SHA; sorted path/type/size/SHA256 manifests |
| A09 | Re-select original; Inspector Info shows persisted SLICE_EXPORT child | **NOT_RUN** | kind, range, processor, createdAt, opaque child id; not only a toast |
| A10 | UI exposes no raw content hash, absolute path or SQLite row id | **NOT_RUN** | Info/export screenshots; sanitized UI inspection |
| A11 | Retry identical slice export is idempotent | **NOT_RUN** | Same child id/output SHA; per-source lineage and published inventories unchanged |
| A12 | Advance draft revision during pending review; stale export fails closed | **NOT_RUN** | Old/new revision; disabled/rejected confirm; no new derived file or lineage |
| A13 | Quit app; read saved draft from isolated catalog with read-only SQL | **NOT_RUN** | Post-quit slice_drafts SELECT matching the latest pre-quit revision/range/markers |
| A14 | Relaunch same HOME; **re-register fixture, rescan, reselect RANGE** (in-memory roots are not persisted); then Info shows same child and draft persists | **NOT_RUN** | Second A01 binding; register+scan evidence; child/revision comparison vs pre-quit |
| A15 | Final source/fixture invariant and derived/lineage inventories hold | **NOT_RUN** | Final manifests after retry, stale attempt, quit and restart |
| Q01 | Info-tab lazy loading (completion-quality observation, not an added Exit blocker): no lineage query while Preview/Slice only | **NOT_RUN** | Native IPC observation using existing diagnostics; visual tab switching alone is insufficient |
| B01 | Reviewed synthetic stereo fixture has distinct left/right data | **NOT_RUN** | Generator/spec provenance, 2-channel header and pre-SHA/manifest |
| B02 | Left and right are independently readable, including after zoom/pan/range | **NOT_RUN** | Native screenshots and channel-specific expected/observed positions |
| B03 | Stereo fixture unchanged after observation | **NOT_RUN** | Before/after SHA and complete relative manifest |
| N01 | Intermediate TRIM→SLICE through derived Library browsing | **NOT_APPLICABLE** | mac_derived Library browse is outside this WP |

**Group A result:** **NOT_RUN**. **Group B result:** **NOT_RUN**.
**Full integrated Native:** **NOT_RUN**. **M7:** **IN_PROGRESS**.
The existing stereo Exit status **PARTIAL** is a baseline audit finding, not a
Native observation performed in this reconciliation session.

Stale test: use a supported real UI path or existing Native IPC against this
isolated fixture; never write SQLite directly or add test-only product hooks.
There must be a demonstrated revision advance. A modal preventing edits alone
does not prove stale rejection. If no supported reproduction is available,
record **NOT_RUN/BLOCKED** and the precise missing path instead of PASS.

The stale test intentionally changes the draft. Capture the **latest** expected
draft state before quit; compare A13/A14 against that state, not the earlier
export review revision. If the UI blocks stale confirm after a real revision
advance, a STALE_DRAFT error is not additionally required; no-write evidence is.

Post-quit SQL: confirm the app process exited; require the catalog already to
exist, then open it **read-only**. Inspect `.schema slice_drafts` and
`.schema asset_derivations` before selecting documented columns. Retain opaque
ids/revision/range/markers and per-source lineage identity/count; sanitize raw
hashes and paths in the published evidence. Do not copy a live SQLite DB without
its journal state and call the copy post-quit evidence. No SQL writes/migrations.

## 5. Durable evidence bundle — NOT_RECORDED

Keep raw environment/paths local. Commit only a reviewed, sanitized summary and
stable evidence references. Hashes may be in evidence; they must not appear in
product UI. Do not commit the real catalog, credentials, absolute operator paths,
or artifacts from real media.

| Artifact / checkpoint | Required content | Current availability |
| --- | --- | --- |
| session summary | Work ID, exact product SHA, evidence commit, OS/architecture, tool versions, timestamps, row-by-row result | **NOT_RECORDED** |
| fixture pre/post manifest | Every relative entry, type, byte size, SHA256; project.work included; reject symlinks | **NOT_RECORDED** |
| output G0/G1/G2/G3/G4 | Inventories before export / after export / retry / stale / restart | **NOT_RECORDED** |
| lineage G0–G4 | Per-source child ids/counts, kind/range/processor; compare retry/stale/restart | **NOT_RECORDED** |
| draft pre-quit/post-quit/restart | Matching latest revision/range/markers after the stale scenario | **NOT_RECORDED** |
| UI and Native diagnostics | Export, Info initial/child/restart, range, stereo, lazy-load evidence | **NOT_RECORDED** |
| artifact index | Relative filenames, SHA256, associated matrix row and durable location | **NOT_RECORDED** |

G1 must add exactly the intended export. G2 and G3 must not grow published files
or lineage relative to G1. G4 must preserve the same derived child/output. Fixture
bytes must match pre-state across all checkpoints. Do not substitute a catalog
file hash invariant: the catalog is expected to change during acceptance.

## 6. Current automated verification — NOT_RUN

No product suite has been run in this reconciliation environment. The operator
must run the relevant current `AGENTS.md` / PR-gate checks and record the exact
SHA, command, exit code and log reference. Existing main commands include:

```bash
pnpm run typecheck
pnpm run check:architecture
pnpm run check:containment
pnpm run test:ui-native-fixture
pnpm run test:frontend
pnpm run build
pnpm run test:e2e
(cd src-tauri && cargo fmt --all -- --check)
(cd src-tauri && cargo clippy --workspace --all-targets --locked -- -D warnings)
(cd src-tauri && cargo test --workspace --locked)
git diff --check
```

Test failures must be reproduced/triaged or documented as blockers. Do not
suppress tests or call them unrelated solely because the historical note did.
Full application clippy is not established by `--exclude masterocta` results.
CI and mock E2E never fill A/B Native rows.

## 7. Historical 2026-09-21 preparation / automated record (unchanged meaning)

Source: original #156 head `d9dd7e3b400c64eba1442dc3738611dc38056db1`, product
`37f86c9603e74bbb59735a98fa79dc51d888ec24`, reported host Darwin.
At that time #155 was OPEN and the start decision was STOP. That historical
statement was true then; it is **not** the current start prerequisite.

| Historical check | Recorded result | Limit |
| --- | --- | --- |
| Fixture prep / expected RANGE SHA | **PASS** | Historical record only; not rerun here |
| typecheck / architecture / containment / build | **PASS** | Historical record only |
| test:frontend | **FAIL** | 1/666 AudioFileTable assigned-popover failure; "unrelated" was the old report, not current re-triage |
| test:e2e | **NOT_RUN** | Not replaced by a later result in this record |
| cargo fmt --check | **PASS** | Historical record only |
| cargo clippy --exclude masterocta | **PASS** | Does not prove full app clippy |
| cargo test --workspace --locked | **PASS** | Historical reported workspace check |
| Operator GUI / integrated Native | **NOT_RUN** | Never converted to PASS by this update |

Historical pre-manifest was reported at the isolated `fixture-manifest.json`.
It has not been retrieved/verified in this reconciliation and is not a substitute
for the current session's durable bundle.

## 8. Completion / STOP rules

M7-05 stays **IMPLEMENTED_NOT_FULLY_ACCEPTED** until its post-quit persistence
gap is actually closed. M7-06 stays **IMPLEMENTED_NOT_FULLY_ACCEPTED** until
group A is evidenced PASS. M7-03 / Exit row 3 stay open until the separate stereo
implementation and group B acceptance are evidenced on main. Full M7 closure
requires the audit §18 rules, not just a successful export or a green CI run.

Any source/fixture mutation, escaped output path, wrong audio range, duplicate
retry output, stale success, missing restarted lineage/draft, leaked UI hash/path,
leftover `.part`, symlink, crash, or hidden catalog error prevents PASS. Retain
failed/partial rows and attach evidence; do not make unrelated product changes.

Historical documents (result rows preserved):
[`M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md`](./M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md)
and [`M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md`](./M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md).

**Merge / public distribution:** not authorized by this document.
