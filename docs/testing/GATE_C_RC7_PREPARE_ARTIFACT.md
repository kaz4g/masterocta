# RC7 Human Gate C — Prepare ArtifactTampered

- Work ID: `MO-GATE-C-RC7-PREPARE-ARTIFACT-1`
- Recorded: 2026-09-10
- Frozen candidate: `gate-c-rc7-31107ae4ae21`
- Frozen source: `31107ae4ae21fc5445cdb153cfaf9310fc7d474d`
- Evaluation main at recording: `af04f793cba1c229e30ede4aedeb4f697583c327`

Do not record local absolute paths, volume identifiers, media fingerprints, or
personal sample names here. Raw operator evidence stays outside the repository.

This document does **not** authorize Human Gate C resume, candidate rebuild,
workflow dispatch, or original-media writes.

## Verdict

Human Gate C on RC7 is **STOP** at Approve & Prepare.

- Gate C: **NOT_PASS**
- M5: **INCOMPLETE**
- RC7 freeze identity: **unchanged** (do not rebuild or replace RC7)
- Do not Continue / Apply on the RC7 session that stopped
- Do not treat the RC7 stop as Gate C FAIL of unrelated-byte proof; media
  comparison for the stopped Prepare was unchanged on inspected entries
- A code fix is required before a **new** candidate can be frozen

## Observed operator outcome

On the frozen RC7 app, after clone verification (`VERIFIED CLONE` /
`EDIT ENABLED`) and review of an unused-destination sample rename:

- Plan approved
- Authority verified
- Backup created and verified
- Prepare returned `prepared artifact error: ArtifactTampered`

The UI also showed a Prepared rename still present and media mutation not
applied. UI copy alone is not proof of durable success. Read-only runtime
inspection after the stop found a Prepared journal, a prepared-plan snapshot,
and a verified backup for the same operation identity. Inspected clone
manifest entries were unchanged (`diffs=0`). That is consistent with Prepare
stopping after Mac-side persist, before Apply.

## Confirmed cause

`v2_rename_prepare` → `prepare_rename_sync` always:

1. Creates or reloads the Prepared journal (`RenameSampleExecutor::prepare`)
2. Calls `persist_after_prepare` → `persist_prepared_snapshot`

`persist_prepared_snapshot` derives `prepared-rename-plan:v1:{operation digest}`
from the plan-bound `OperationId`, then writes JSON with `write_json_create_once`.
The snapshot includes `created_at_unix` from a wall clock. `content_binding`
intentionally omits that timestamp.

`write_json_create_once` is byte-identical create-once. A second persist of the
same operation (legitimate retry, concurrent Prepare, or a later Approve &
Prepare of the same deterministic plan) generates a new `created_at_unix`.
The existing file therefore fails the byte comparison and surfaces as
`LocalArtifactError::ArtifactTampered` / UI `prepared artifact error: ArtifactTampered`.

The colliding artifact class is the prepared-rename-plan snapshot whose file
stem equals the operation digest. On this incident the durable snapshot already
existed with a valid `content_binding`; the failing call was a later persist of
the same identity, not proof that the first persist failed.

This is a general product bug in RC7 / current main, not a media-integrity
finding. Isolated tests reproduce it with a controllable clock and no sleep.

## What this is not

- Not a demonstrated clone-manifest byte change
- Not a reason to weaken create-once or content-binding checks
- Not authorization to overwrite an existing snapshot that fails integrity
- Not proof of how many Prepare IPC calls the operator session issued; sequential
  retry and concurrent persist are both sufficient to hit the bug

## Fix contract

Keep create-once. Do not overwrite. Do not ignore integrity.

If create-once reports a byte mismatch, load the existing snapshot and accept it
only when `content_binding` and plan/backup/clone/recovery identity match the
generated snapshot. Return the **existing** snapshot. A different binding remains
`PREPARED_SNAPSHOT_TAMPERED`.

Clock-controlled tests cover:

- first persist succeeds
- same-operation retry with a later clock returns the original snapshot
- a mutated existing artifact is still rejected
- journal-without-snapshot remains `PREPARED_ARTIFACT_INCOMPLETE` until persist
- persist after a missing snapshot creates a new create-once file
- same-operation concurrent persist started after exclusive create and before
  JSON write completion returns the same saved snapshot, not a tamper rejection
  of the in-progress write. Create-once still rejects a divergent binding,
  a leftover incomplete file, and a symlink.

## Resume conditions (not this work)

Resume Human Gate C only after:

1. This fix merges to `main`
2. A new Gate C preflight on that main
3. A new candidate ID / freeze (not RC7 reuse)
4. A fresh disposable clone and pre-run byte manifest

Do not rebuild RC7. Do not dispatch `gate-c-rc7-31107ae4ae21`. Do not reopen
#103 / #104 / #105.
