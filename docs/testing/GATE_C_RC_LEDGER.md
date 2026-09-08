# Gate C release-candidate ledger

This ledger freezes Human Gate C artifact identity and STOP boundaries.
It is not a substitute for `GATE_C_CLONE_SMOKE.md` and does not authorize
writes to original Octatrack media.

Do not record local absolute paths, volume UUIDs, media fingerprints, or
personal sample names here.

Ambiguous results, missing evidence, or a failed precondition are **STOP**.
Do not classify those outcomes as `PASS_WITH_NOTES`.

Recording a source SHA next to an artifact SHA256 in this table is not, by
itself, source-to-artifact binding. Binding requires the provenance chain in
the RC2 freeze rules below.

A Gate C candidate is not a public release. Candidate creation, Human Gate C,
and public distribution are separate operations and separate gates.

## FAT-HASH-1 status and verdict contract

FAT-HASH-1 uses the same vocabulary in this ledger and in
[FAT_HASH_1_ASSESSMENT.md](FAT_HASH_1_ASSESSMENT.md).

status:

- `ASSESSMENT_REQUIRED`: assessment is incomplete
- `ASSESSED`: assessment and verdict recording are complete

verdict:

- `UNSET`: not judged
- `BLOCKED`: a Gate C blocking finding exists
- `ACCEPTED_WITH_EVIDENCE`: required evidence shows no Gate C blocking finding
  in the assessed scope

Allowed combinations:

| status | verdict | Meaning |
|---|---|---|
| `ASSESSMENT_REQUIRED` | `UNSET` | Waiting for assessment. RC2 freeze is forbidden. |
| `ASSESSED` | `BLOCKED` | Assessed. RC2 freeze is forbidden. |
| `ASSESSED` | `ACCEPTED_WITH_EVIDENCE` | FAT-HASH condition only. Other RC2 conditions remain. |

Any other combination, missing evidence, or inconsistency is **STOP**.

Transition:

- Move from `ASSESSMENT_REQUIRED` to `ASSESSED` only when required evidence and
  a verdict are recorded together, including assessed SHA, scope, and evidence
  references.
- If related implementation or assumptions change so that recorded evidence no
  longer applies, keep the past record and reassess.
- FAT-HASH condition satisfaction is not Gate C PASS and is not M5 COMPLETE.

Current FAT-HASH-1 state: `ASSESSED` / `ACCEPTED_WITH_EVIDENCE`.

Assessment evidence:

| Field | Value |
|---|---|
| evidence implementation head | `e0d04b55f9826362d9052f4679aa2d1c24c685bf` |
| merged main commit | `affd2fb3983f824b01462dfda99a15aebf979123` |
| assessed tree | `713c0187d29b828737e7a3252e187fe1cc654a0b` |
| pull request | [#93](https://github.com/kaz4g/masterocta/pull/93) |
| CI workflow | `CI` |
| CI run | [`33991886715`](https://github.com/kaz4g/masterocta/actions/runs/33991886715), `completed` / `success` |

The completed successful workflow run is the authoritative CI evidence; an
unchecked checkbox in the PR description is not evidence. PR #93 proves that a
stale catalog destination blocks planning even when the live destination is
absent, a successful unused-destination plan has no destination baseline, the
first post-apply rescan records `ComputedThisScan` rather than
`ReusedUnchangedMetadata`, live destination tamper fails with
`DESTINATION_HASH_MISMATCH`, and independent byte-manifest comparison stops on
same-size / same-mtime / different-content.

The FAT-HASH-derived RC2 blocker is cleared for these assessed identities.
General incremental catalog hash reuse and coarse-timestamp regression remain
open as hardening; they are not evidence inputs for the independently live-
hashed and byte-manifested Gate C judgments.

This FAT-HASH-only decision is not RC2 creation, Gate C PASS, or M5 COMPLETE.

## RC1

| Field | Value |
|---|---|
| status | `FROZEN_FAILED` |
| source commit | `466fe6e72a639e6501eb5929b0de7d66247f263b` |
| source tree | `bd1810cd7facb6eb5b46c1b3b08d2c1c23258a98` |
| artifact filename | `Masta-Octa_0.1.0_aarch64.dmg` |
| artifact SHA256 | `29213b04f58a774054dfd7fd0638c5990a7160168e2d28b22ee5212bc665a477` |
| local artifact availability | `CONFIRMED` |
| local hash re-verification | `PASS` |
| Human Gate C | `FAIL` |
| build environment | `NOT RECORDED IN THIS LEDGER` |
| codesign verification | `NOT RECORDED IN THIS LEDGER` |
| DMG verification | `NOT RECORDED IN THIS LEDGER` |
| workflow name | `NOT RECORDED IN THIS LEDGER` |
| workflow run ID | `NOT RECORDED IN THIS LEDGER` |
| workflow run attempt | `NOT RECORDED IN THIS LEDGER` |
| workflow run URL | `NOT RECORDED IN THIS LEDGER` |
| workflow checkout SHA | `NOT RECORDED IN THIS LEDGER` |
| app binary SHA256 | `NOT RECORDED IN THIS LEDGER` |
| in-run checksum manifest | `NOT RECORDED IN THIS LEDGER` |
| candidate storage | `NOT RECORDED IN THIS LEDGER` |
| public distribution | `NOT AUTHORIZED` |

Local hash re-verification proves only that the existing artifact bytes match
the historical SHA256. It is not a reproduction of source-to-artifact binding
and is not a cryptographic proof of that binding.

RC1 source-to-artifact binding is **not proven**. Do not infer, reconstruct, or
backfill workflow provenance, in-run digests, or candidate-storage evidence for
RC1. Do not reopen RC1 under later identity rules.

Failure boundary:

Record Source Evidence returned `clone runtime storage failed`.

Root cause:

Known macOS-managed metadata directories were incorrectly included in physical
filesystem traversal.

Remediation landed after this freeze and does not reopen RC1:

- PR #86
- PR #87
- PR #88

RC1 freeze rules:

- Do not rebuild the RC1 artifact.
- Do not replace the RC1 artifact.
- Do not retest under the RC1 name.
- Do not reclassify RC1 as PASS.

## RC2

| Field | Value |
|---|---|
| status | `NOT_CREATED` |
| source commit | `UNSET` |
| source tree | `UNSET` |
| artifact | `UNSET` |
| artifact SHA256 | `UNSET` |
| app binary SHA256 | `UNSET` |
| workflow name | `UNSET` |
| workflow run ID | `UNSET` |
| workflow run attempt | `UNSET` |
| workflow run URL | `UNSET` |
| workflow checkout SHA | `UNSET` |
| build environment | `UNSET` |
| codesign verification | `UNSET` |
| DMG verification | `UNSET` |
| in-run checksum manifest identity | `UNSET` |
| in-run checksum manifest storage | `UNSET` |
| in-run checksum manifest retrieval | `UNSET` |
| candidate storage | `UNSET` |
| candidate access boundary | `UNSET` |
| public distribution | `NOT AUTHORIZED` |

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC2 freeze records them together. A failed pre-freeze dispatch is
not a freeze: do not copy run `34016038137` into this identity table.

This document does not record that provenance has been obtained. The current
`.github/workflows/rc-release.yml` does not satisfy the freeze rules below.

### RC2 pre-freeze attempt (run 34016038137)

A Gate C Candidate Build was dispatched once for candidate ID
`gate-c-rc2-c324f048e3b9`. Application and DMG build completed. The run then
failed in `Discover final DMG` before checksum-manifest generation, draft
release creation, candidate evidence generation, asset upload, and
access-boundary confirmation. No artifact was frozen. Provenance is
incomplete. This is not an RC2 freeze and must not be reclassified as
`FROZEN_FAILED`.

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc2-c324f048e3b9` |
| source commit | `c324f048e3b952745e4b259a9876b4a37cc98d4a` |
| source tree | `89b5ac04174a3787dfd35e4b252eee5caa348eda` |
| workflow name | `Gate C Candidate Build` |
| workflow run ID | `34016038137` |
| workflow run attempt | `1` |
| job ID | `101439851786` |
| workflow run URL | [`34016038137`](https://github.com/kaz4g/masterocta/actions/runs/34016038137) |
| result | `FAILURE` |
| failed step | Discover final DMG |
| failure phase | pre-manifest / pre-release / pre-upload |
| cause | macOS `/bin/bash` 3.2 does not provide `mapfile` (`exit 127`) |
| artifact frozen | `NO` |
| provenance complete | `NO` |
| candidate ID reusable | `NO` |

One-shot dispatch contract for this attempt:

```text
gate-c-rc2-c324f048e3b9 = RETIRED
run 34016038137 = rerun forbidden
RC2 candidate name = not reusable
next candidate number = RC3
```

Do not rerun this workflow run or its failed jobs. Do not redispatch the same
candidate ID. Do not recover or reuse any in-run DMG from this attempt as later
candidate evidence. RC2 official identity fields remain `UNSET`. RC2 status
remains `NOT_CREATED`. Human Gate C remains `NOT_RUN`. Gate C remains
`NOT_PASS`. M5 remains `INCOMPLETE`.

### Gate C candidate versus public distribution

Gate C candidate creation and public distribution are separate operations.

- A Gate C candidate build stores a personal/local evaluation artifact.
- Candidate creation must not start a public release, public distribution, or
  updater delivery.
- Human Gate C PASS does not authorize public distribution.
- Public distribution additionally requires signing, notarization or equivalent
  public-distribution conditions, and an explicit public-release decision.
- That public-distribution gate is separate from this ledger freeze and from
  `GATE_C_CLONE_SMOKE.md`, which excludes updater, release, and deploy from the
  smoke.

Do not treat the current `RC Release Build` workflow as the required Gate C
candidate builder. That workflow creates a GitHub Release with `draft: false`,
overwrites tag `v0.0.1-rc`, retries uploads with `--clobber`, and has a
`publish-release` job that publishes the release. Using it as written would
expose a candidate before Human Gate C and before the public-distribution gate
in `docs/security/SECURITY_STATUS.md`.

Do not conclude non-public status from the names “Actions artifact” or “draft
release” alone. Before freeze, confirm all of the following for the chosen
candidate store:

- repository visibility
- who can view and download the candidate
- whether any publish, undraft, or make-latest step runs
- whether an updater or release endpoint can consume the candidate
- whether an unapproved party can replace the stored bytes

If candidate storage or its access boundary is undetermined, **STOP** and keep
RC2 `NOT_CREATED`. This docs change does not select a storage method and does
not change workflow or repository settings.

### RC2 provenance freeze rules

An RC2 artifact may be frozen only when this chain is recorded and mutually
consistent:

```text
frozen source commit/tree
→ workflow checkout of that SHA in a recorded run/attempt
→ same run/attempt builds the candidate
→ same run/attempt generates a checksum manifest or equivalent attestation
  of the final packaged bytes
→ candidate stored under a recorded non-public-distribution store
→ freeze RC identity from that run-scoped digest
```

Required evidence for that chain:

- frozen `source commit` SHA
- frozen `source tree` SHA belonging to that commit
- `workflow name` of the Gate C candidate workflow, not a public-release
  workflow
- `workflow run ID`, `workflow run attempt`, and canonical `workflow run URL`
- `workflow checkout SHA` actually checked out by that run
- `artifact` filename
- DMG SHA256 of the final packaged DMG
- app binary SHA256 of the binary enclosed in that DMG, after signing,
  packaging, or any other byte-changing step has finished
- proof that the hashed binary is the binary enclosed in that DMG
- `build environment`
- `codesign verification` result that matches an acceptable outcome below
- `DMG verification` result that matches an acceptable outcome below
- in-run checksum manifest or equivalent attestation identity, storage
  location, and retrieval path
- candidate storage location and confirmed access boundary

Acceptable artifact-verification outcomes for RC2 freeze and Gate C PASS
follow the Gate B personal/local procedure in `GATE_B_CLONE_SMOKE.md`:

- `DMG verification` must be `PASS`: `hdiutil verify` against the frozen DMG
  succeeds.
- `codesign verification` must record `codesign --verify --deep --strict
  --verbose=2` and `spctl --assess --type execute --verbose=4`.
- Expected unsigned or ad-hoc state for a personal/local candidate is
  acceptable. Record it explicitly. Do not treat it as signed, and do not
  treat it as public-distribution approval.
- A valid Developer ID signature may be recorded, but still does not
  authorize public distribution without the separate public-distribution gate.

All other codesign or DMG outcomes are **STOP**, including:

- `hdiutil verify` failure, skip, or ambiguous output
- codesign or `spctl` not run
- signature integrity failure, including a claimed signature that does not
  verify
- recording unsigned or ad-hoc as `signed` or as public-distribution approval
- `FAIL` recorded as freeze evidence without treating it as STOP

In-run digest rules:

- The checksum manifest or equivalent attestation must be generated inside the
  same workflow run and attempt that built the candidate.
- Hash the final bytes after signing, packaging, or other mutations.
- After digest generation, do not modify or replace the hashed artifacts.
- Local re-hash after retrieval is only a check against the run-generated
  digest. It is not an independent source of identity.

A checksum manifest by itself is not cryptographic provenance. Binding also
requires the recorded run identity, a change-controlled store, and an explicit
trust premise for who can write that store.

The following are insufficient:

- a run URL placed next to a hash computed later
- hashing a mutable Release asset after later download
- a checksum file whose origin cannot be shown
- a store where the artifact and its manifest can be replaced together
- source SHA and artifact SHA256 recorded in the same table without the chain
  above

STOP. Do not freeze RC2 when any of the following is true:

- workflow checkout SHA and frozen source SHA disagree
- workflow run provenance is missing
- the in-run checksum manifest is missing
- the artifact was rebuilt or replaced after digest generation or outside that
  workflow run
- the origin of the artifact hash is unknown
- the same RC number or tag was overwritten
- candidate storage would publish, distribute, or feed an updater
- candidate storage or access boundary is undetermined
- `DMG verification` is not `PASS`
- `codesign verification` is missing, integrity-failed, or recorded as signed
  when the candidate is unsigned or ad-hoc
- a unique source-to-artifact correspondence cannot be proven

Missing, ambiguous, or mismatched provenance is **STOP**, not
`PASS_WITH_NOTES`. Keep RC2 `NOT_CREATED`.

### Current workflow gap

`.github/workflows/rc-release.yml` currently:

- does not generate a DMG or app-binary digest in the build run
- uploads to a GitHub Release that is created non-draft and later force-published
- deletes and recreates the same RC tag
- retries failed uploads with `--clobber`

Those behaviors do not satisfy the provenance or candidate-isolation rules.
They are requirements for a future workflow change. This document update does
not implement that change and does not claim that provenance has been obtained.

## RC2 start conditions

All of the following must be true before RC2 may be created:

- A Gate C candidate workflow exists that does not publish, overwrite a public
  RC identity, or start updater delivery.
- Candidate storage and its access boundary are recorded and confirmed.
- The Gate C candidate workflow generates an in-run checksum manifest or
  equivalent attestation of the final packaged bytes.
- `DMG verification` of that candidate is `PASS`, and `codesign verification`
  is an acceptable recorded outcome as defined in the freeze rules.
- The Gate C impact of FAT-HASH-1 is recorded as `ASSESSED` /
  `ACCEPTED_WITH_EVIDENCE`. See
  [FAT_HASH_1_ASSESSMENT.md](FAT_HASH_1_ASSESSMENT.md).
- If FAT-HASH-1 is `ASSESSMENT_REQUIRED` / `UNSET`, or `ASSESSED` / `BLOCKED`,
  keep RC2 `NOT_CREATED`.
- All CI checks for the intended `main` source commit are green.
- No open Pull Request or required fix remains that belongs in the RC2 source.
- The RC number, source commit SHA, tree SHA, artifact SHA256, app binary
  SHA256, workflow name, run ID, run attempt, canonical run URL, workflow
  checkout SHA, in-run manifest identity, and candidate storage can be recorded
  as a unique, immutable tuple with provenance consistency.

If any condition is unmet, keep RC2 `NOT_CREATED`.

### Current RC2 blockers after FAT-HASH-1 assessment

FAT-HASH-1 is no longer an RC2 blocker. The Project post-write SHA256 evidence
export blocker is **cleared** on `main` by Phase 2 merge evidence below.

Phase 2 merge evidence:

| Field | Value |
|---|---|
| Phase 2 head | `aa754afd89a5f60ccee97032abb6d3c1239897e9` |
| Phase 2 merge | `cc6523fc34ccd69e8242188f74d9df59a3102e1f` |
| Phase 2 merged tree | `3078a03a3a047c9aa8764e40c5a80de5823381d3` |
| Phase 2 PR | [#95](https://github.com/kaz4g/masterocta/pull/95) |
| Phase 2 CI | [`34011073593`](https://github.com/kaz4g/masterocta/actions/runs/34011073593), `completed` / `success` |

RC2 remains `NOT_CREATED`. The retired candidate ID `gate-c-rc2-c324f048e3b9`
and run `34016038137` cannot satisfy RC2 freeze conditions. The later-RC freeze
evidence conditions below are satisfied by RC5 run
`34077117176` and the recorded local re-verification. They become formally cleared only when this ledger is merged to `main`. RC2 official identity fields
remain `UNSET`.

Later-RC freeze evidence conditions satisfied by RC5:

- Gate C candidate workflow **`.github/workflows/gate-c-candidate.yml`**
  (`Gate C Candidate Build`) merged to `main` with required CI evidence, including
  macOS Bash 3.2 portable artifact discovery (no `mapfile` / `readarray`) —
  **satisfied**
- source-to-artifact provenance from a single workflow run/attempt, including
  run/attempt-bound final DMG and enclosed binary digests — **satisfied**
- a confirmed non-public candidate storage path and access boundary recorded
  from that run's draft release evidence — **satisfied**
- freeze-time DMG and enclosed binary digests recorded from that run — **satisfied**
- access boundary confirmed for that draft release — **satisfied**

Phase 3 workflow merge (#96 / #97) did **not** clear these blockers by itself.
Runs `34016038137`, `34061897324`, and `34068535069` failed before a complete
freeze tuple existed. RC5 run `34077117176` and local re-verification satisfied
the later-RC freeze conditions; this docs-only ledger records that tuple.

Adopted Gate C candidate workflow name: **`Gate C Candidate Build`**
(`.github/workflows/gate-c-candidate.yml`). Do not use
`.github/workflows/rc-release.yml` for Gate C candidates.

Draft candidate storage boundary (GitHub official REST / About releases):

- published release information is available to everyone
- draft release listings and draft assets require repository push access
- `GET /repos/{owner}/{repo}/releases/tags/{tag}` returns a **published**
  release by tag; anonymous lookup of a draft candidate tag must fail closed
- draft/prerelease releases cannot be set as latest

Recorded access boundary for the Phase 3 workflow design:

```text
repository visibility = public
candidate release = draft
candidate download = authenticated repository write collaborators only
anonymous access = denied
updater consumption = none
public release listing = absent
```

Phase 3 merge operator sequence:

```text
Phase 3 merge
→ env-fix merge (#97)
→ RC2 dispatch attempt 34016038137 FAILURE
  (pre-manifest; gate-c-rc2-c324f048e3b9 retired; rerun forbidden)
→ macOS Bash portability fix merge
→ main CI success confirmation
→ RC3 source commit/tree fixed by operator preflight on main
  390f90578422a33822a6b469e493eaa6984e5b75 /
  7a5af2c46ede6df9ea6aa36f60f6d9decc988cc8
→ Gate C Candidate Build dispatched once as gate-c-rc3-390f90578422
→ RC3 dispatch attempt 34061897324 FAILURE
  (evidence generation; gate-c-rc3-390f90578422 retired; rerun forbidden)
→ evidence runtime hotfix merge
→ main CI success confirmation
→ RC4 source commit/tree fixed by operator preflight on the new main tip
→ Gate C Candidate Build dispatched once as gate-c-rc4-<12hex of new source SHA>
→ RC4 dispatch attempt 34068535069 FAILURE recorded
  (gate-c-rc4-d324a1e6a05b retired; rerun forbidden)
→ access-boundary proof fix merge
→ main CI success confirmation
→ RC5 source commit/tree fixed by operator preflight on the new main tip
  7b5b740d1db195f99d2bd78b46713531cfda41c5 /
  1b32b802d779e8ef9fe6a06183ded160355a1f88
→ Gate C Candidate Build dispatched once as gate-c-rc5-7b5b740d1db1
→ RC5 dispatch attempt 34077117176 SUCCESS recorded
→ draft candidate retrieved
→ local SHA256 re-verification PASS
→ provenance / access boundary confirmation PASS
→ docs-only freeze ledger PR (this branch)
→ ledger merge
→ Human Gate C on the frozen RC5 candidate
```

A successful workflow run alone does **not** freeze an RC. A docs-only ledger
PR must record the run evidence before that RC may be treated as `FROZEN`.
Until this ledger merges to `main`, RC5 is not formally frozen on `main`.
Do not reuse RC2 run `34016038137`, RC3 run `34061897324`, RC4 run
`34068535069`, or any in-progress DMG from those attempts as later candidate
evidence. RC5 dispatch is one-shot. Do not rerun run `34077117176`, redispatch
`gate-c-rc5-7b5b740d1db1`, or create RC6 without a new operator sequence.

After RC5 ledger merge and before Human Gate C:

```text
RC1 = FROZEN_FAILED
RC2 = NOT_CREATED / identity UNSET
RC3 = NOT_CREATED / historical pre-freeze failure
RC4 = NOT_CREATED / historical pre-freeze failure
RC5 = FROZEN
Human Gate C = NOT_RUN
Gate C = NOT_PASS
M5 = INCOMPLETE
public distribution = NOT AUTHORIZED
```

RC1 remains `FROZEN_FAILED` with its recorded identity unchanged. RC2 source
commit, source tree, artifact, artifact SHA256, and all other identity fields
remain `UNSET`. RC3 official identity fields remain `UNSET`. RC4 official
identity fields remain `UNSET`. Human Gate C remains `NOT_RUN`; Gate C remains
`NOT_PASS`; M5 remains `INCOMPLETE`. The remaining M5 blocker is Human Gate C
only. Signing, notarization, and public distribution remain separate gates.

## RC3

| Field | Value |
|---|---|
| status | `NOT_CREATED` |
| source commit | `UNSET` |
| source tree | `UNSET` |
| artifact | `UNSET` |
| artifact SHA256 | `UNSET` |
| app binary SHA256 | `UNSET` |
| workflow name | `UNSET` |
| workflow run ID | `UNSET` |
| workflow run attempt | `UNSET` |
| workflow run URL | `UNSET` |
| workflow checkout SHA | `UNSET` |
| build environment | `UNSET` |
| codesign verification | `UNSET` |
| DMG verification | `UNSET` |
| in-run checksum manifest identity | `UNSET` |
| in-run checksum manifest storage | `UNSET` |
| in-run checksum manifest retrieval | `UNSET` |
| candidate storage | `UNSET` |
| candidate access boundary | `UNSET` |
| public distribution | `NOT AUTHORIZED` |

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC3 freeze records them together. A failed pre-freeze dispatch is
not a freeze: do not copy run `34061897324` into this identity table.

### RC3 pre-freeze attempt (run 34061897324)

A Gate C Candidate Build was dispatched once for candidate ID
`gate-c-rc3-390f90578422` from source commit
`390f90578422a33822a6b469e493eaa6984e5b75` / tree
`7a5af2c46ede6df9ea6aa36f60f6d9decc988cc8`. Application and DMG build,
checksum-manifest generation, and draft release creation completed. The run
then failed in `Write candidate evidence` because `runner_image` was not
passed into the evidence payload (`STOP INCOMPLETE_EVIDENCE: runner_image is
required`). Asset upload and access-boundary confirmation did not run. No
artifact was frozen. Provenance is incomplete. This is not an RC3 freeze and
must not be reclassified as `FROZEN_FAILED`.

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc3-390f90578422` |
| source commit | `390f90578422a33822a6b469e493eaa6984e5b75` |
| source tree | `7a5af2c46ede6df9ea6aa36f60f6d9decc988cc8` |
| workflow name | `Gate C Candidate Build` |
| workflow run ID | `34061897324` |
| workflow run attempt | `1` |
| workflow run URL | [`34061897324`](https://github.com/kaz4g/masterocta/actions/runs/34061897324) |
| result | `FAILURE` |
| failed step | Write candidate evidence |
| failure phase | post-draft / pre-upload |
| cause | `runner_image` missing from evidence payload (`INCOMPLETE_EVIDENCE`) |
| draft release ID | `383727077` |
| draft | `true` |
| prerelease | `true` |
| draft assets | `0` |
| anonymous release-by-tag | `404` |
| artifact frozen | `NO` |
| provenance complete | `NO` |
| candidate ID reusable | `NO` |
| intermediate hashes | not freeze evidence |

The orphan draft release `383727077` is a historical audit record. Do not
delete, publish, edit, or upload assets to it. Do not add cleanup automation
for it. Intermediate DMG and binary hashes from the failed run are not
freeze identity and must not be reused.

Raw codesign and spctl output from that run included runner absolute paths
under `/var/folders/...`. Those strings are not freeze evidence.

One-shot dispatch contract for this attempt:

```text
gate-c-rc3-390f90578422 = RETIRED
run 34061897324 = rerun forbidden
RC3 candidate name = not reusable
next candidate number = RC4
```

Do not rerun this workflow run or its failed jobs. Do not redispatch the same
candidate ID. Do not recover or reuse any in-run DMG from this attempt as later
candidate evidence. RC3 official identity fields remain `UNSET`. RC3 status
remains `NOT_CREATED`. Human Gate C remains `NOT_RUN`. Gate C remains
`NOT_PASS`. M5 remains `INCOMPLETE`.

The next candidate is RC4. Its source commit and tree must be chosen by a
fresh operator preflight on `main` after this evidence runtime hotfix merges.
Do not pre-fix an RC4 identity here.

## RC4

| Field | Value |
|---|---|
| status | `NOT_CREATED` |
| source commit | `UNSET` |
| source tree | `UNSET` |
| artifact | `UNSET` |
| artifact SHA256 | `UNSET` |
| app binary SHA256 | `UNSET` |
| workflow name | `UNSET` |
| workflow run ID | `UNSET` |
| workflow run attempt | `UNSET` |
| workflow run URL | `UNSET` |
| workflow checkout SHA | `UNSET` |
| build environment | `UNSET` |
| codesign verification | `UNSET` |
| DMG verification | `UNSET` |
| in-run checksum manifest identity | `UNSET` |
| in-run checksum manifest storage | `UNSET` |
| in-run checksum manifest retrieval | `UNSET` |
| candidate storage | `UNSET` |
| candidate access boundary | `UNSET` |
| public distribution | `NOT AUTHORIZED` |

Do not infer these values from the current `main` tip. They stay `UNSET` until
an explicit RC4 freeze records them together. A failed pre-freeze dispatch is
not a freeze: do not copy run `34068535069` into this identity table.

### RC4 pre-freeze attempt (run 34068535069)

A Gate C Candidate Build was dispatched once for candidate ID
`gate-c-rc4-d324a1e6a05b` from source commit
`d324a1e6a05bfda83b1ae136242280a427866c4b` / tree
`ab843da4303f82305a17afc99b8ca2bbc023bbb8`. Application and DMG build,
checksum-manifest generation, draft release creation, candidate evidence
generation, and asset upload completed. The run then failed in
`Confirm draft release access boundary` because the workflow treated anonymous
REST API status `403` as a hard failure while expecting `404`. Asset upload
completed with three orphan assets. Only access-boundary confirmation failed.
No artifact was frozen. Provenance is incomplete. This is not an RC4 freeze
and must not be reclassified as `FROZEN_FAILED`.

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc4-d324a1e6a05b` |
| source commit | `d324a1e6a05bfda83b1ae136242280a427866c4b` |
| source tree | `ab843da4303f82305a17afc99b8ca2bbc023bbb8` |
| workflow name | `Gate C Candidate Build` |
| workflow run ID | `34068535069` |
| workflow run attempt | `1` |
| workflow run URL | [`34068535069`](https://github.com/kaz4g/masterocta/actions/runs/34068535069) |
| result | `FAILURE` |
| failed step | Confirm draft release access boundary |
| failure phase | post-upload / access-boundary |
| cause | access-boundary check expected 404 but received 403 |
| draft release ID | `383761286` |
| draft | `true` |
| prerelease | `true` |
| draft assets | `3` |
| workflow conclusion | `failure` |
| artifact frozen | `NO` |
| provenance complete | `NO` |
| candidate ID reusable | `NO` |
| freeze identity | `UNSET` |
| intermediate hashes | not freeze evidence |

Uploaded orphan assets from the failed run:

```text
Masta-Octa_0.1.0_gate-c-rc4_d324a1e6a05b_aarch64.dmg
gate-c-rc4-d324a1e6a05b-checksum-manifest.json
gate-c-rc4-d324a1e6a05b-evidence.json
```

These assets exist on orphan draft release `383761286`, but the workflow
conclusion is `failure`. Do not promote their artifact hash or evidence into
the formal freeze table.

The orphan draft release `383761286` is a historical audit record. Do not
delete, publish, edit, rename, or upload assets to it. Do not download its
assets for freeze verification. Do not add cleanup automation for it.
Intermediate DMG and binary hashes from the failed run are not freeze identity
and must not be reused.

One-shot dispatch contract for this attempt:

```text
gate-c-rc4-d324a1e6a05b = RETIRED
run 34068535069 = rerun forbidden
RC4 candidate name = not reusable
next candidate number = RC5
```

Do not rerun this workflow run or its failed jobs. Do not redispatch the same
candidate ID. Do not recover or reuse any in-run DMG from this attempt as later
candidate evidence. RC4 official identity fields remain `UNSET`. RC4 status
remains `NOT_CREATED`. Human Gate C remains `NOT_RUN`. Gate C remains
`NOT_PASS`. M5 remains `INCOMPLETE`.

The next candidate is RC5. Its source commit and tree must be chosen by a
fresh operator preflight on `main` after the access-boundary proof fix merges.
Do not pre-fix an RC5 identity here.

### Post-RC5 M5 scope audit

| Field | Value |
|---|---|
| audited RC5 source commit | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| audited RC5 source tree | `1b32b802d779e8ef9fe6a06183ded160355a1f88` |
| audited later-main endpoint | `827c7c5252f8ac8daf484b372202315845fdaf31` |
| audited later-main tree | `837454269ae6bc6b2b005cf77efdd7dc20a2ddb8` |
| changed feature area | Auto Slice / PCM analysis and draft editing |
| M5 Gate C semantic change | `NO` |
| verdict | `POST_RC5_M5_SCOPE_AUDIT_PASS` |

The reviewed post-RC5 diff adds the Auto Slice / PCM analysis feature.
It does not modify the frozen RC5 Rename Plan → Prepare → Continue → Apply
transaction, committed rename evidence contract, Gate C byte-manifest
comparison, or Gate C candidate workflow.

This audit does not extend RC5 certification to later commits. RC5 certifies
only source commit `7b5b740d1db195f99d2bd78b46713531cfda41c5`
and source tree `1b32b802d779e8ef9fe6a06183ded160355a1f88`.
Post-RC5 Auto Slice functionality is outside the RC5 Gate C certification scope.

## RC5

| Field | Value |
|---|---|
| status | `FROZEN` after this ledger merges to `main`; not formally frozen on `main` until then |
| candidate_id | `gate-c-rc5-7b5b740d1db1` |
| source commit | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| source tree | `1b32b802d779e8ef9fe6a06183ded160355a1f88` |
| workflow name | `Gate C Candidate Build` |
| workflow file | `.github/workflows/gate-c-candidate.yml` |
| workflow ref | `kaz4g/masterocta/.github/workflows/gate-c-candidate.yml@refs/heads/main` |
| workflow SHA | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| workflow run ID | `34077117176` |
| workflow run attempt | `1` |
| job ID | `101605327915` |
| workflow run URL | [`34077117176`](https://github.com/kaz4g/masterocta/actions/runs/34077117176) |
| workflow result | `completed` / `success` |
| workflow checkout SHA | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| draft release ID | `383801533` |
| draft release tag | `gate-c-rc5-7b5b740d1db1` |
| draft | `true` |
| prerelease | `true` |
| published | `false` |
| target commitish | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| candidate storage | `GitHub draft release` |
| candidate access boundary | `AUTHENTICATED_DRAFT_AND_ANONYMOUS_WEB_DENIED` |
| public distribution | `NOT AUTHORIZED` |
| artifact filename | `Masta-Octa_0.1.0_gate-c-rc5_7b5b740d1db1_aarch64.dmg` |
| artifact SHA256 | `sha256:2d186fa141e6a829cfa0b74a15db823d3efe56da9389e3423da7cc67af699887` |
| enclosed binary relative path | `Masta-Octa.app/Contents/MacOS/masterocta` |
| app binary SHA256 | `sha256:ca76fedcc7a18e8f61350a14f7ddf4303da91126ebdba4ee70fef3dd921290dc` |
| in-run checksum manifest identity | `gate-c-rc5-7b5b740d1db1-checksum-manifest.json` |
| in-run checksum manifest SHA256 | `sha256:e6239b1af6cbc0bbfa2b1d4a29a14f035d827782ac7ac489450b0c5dce633435` |
| in-run checksum manifest storage | `GitHub draft release 383801533` |
| in-run checksum manifest retrieval | `authenticated draft release asset download` |
| candidate evidence identity | `gate-c-rc5-7b5b740d1db1-evidence.json` |
| candidate evidence SHA256 | `sha256:284c04d7c16f70cba9c0fe2a912b58e2e6c3d07457dc9430847fc589cc48f7ef` |
| target architecture | `aarch64-apple-darwin` |
| build environment | `github-actions-macos-arm64` |
| Node version | `v22.23.2` |
| pnpm version | `11.24.0` |
| Rust version | `1.98.1` |
| Cargo version | `1.98.1` |
| Xcode version | `26.6` |
| runner OS | `macOS` |
| runner architecture | `ARM64` |
| runner image | `macos-26@20260831.0337.3` |
| DMG verification | `PASS` |
| codesign classification | `AD_HOC_VERIFIED` |
| codesign command result | `valid_on_disk_and_designated_requirement_satisfied` |
| spctl result | `rejected_expected` |
| Human Gate C | `NOT_RUN` |

RC5 source-to-artifact provenance chain:

```text
frozen source commit/tree
  7b5b740d1db195f99d2bd78b46713531cfda41c5 /
  1b32b802d779e8ef9fe6a06183ded160355a1f88
→ run 34077117176 attempt 1 checkout of that SHA
→ same run builds DMG
→ same run writes checksum manifest + evidence
→ stored as draft release 383801533
→ local re-hash matches run-scoped digests
```

Exact draft release asset set (3 assets):

```text
Masta-Octa_0.1.0_gate-c-rc5_7b5b740d1db1_aarch64.dmg
  sha256:2d186fa141e6a829cfa0b74a15db823d3efe56da9389e3423da7cc67af699887
gate-c-rc5-7b5b740d1db1-checksum-manifest.json
  sha256:e6239b1af6cbc0bbfa2b1d4a29a14f035d827782ac7ac489450b0c5dce633435
gate-c-rc5-7b5b740d1db1-evidence.json
  sha256:284c04d7c16f70cba9c0fe2a912b58e2e6c3d07457dc9430847fc589cc48f7ef
```

Local re-verification after authenticated draft release retrieval:

| Check | Result |
|---|---|
| authenticated release identity | `PASS` |
| exact asset set | `PASS` / exactly 3 assets |
| downloaded asset digest comparison | `PASS` |
| DMG local SHA256 re-verification | `PASS` |
| checksum manifest local SHA256 re-verification | `PASS` |
| candidate evidence contract | `PASS` |
| candidate evidence identity comparison | `PASS` |
| checksum manifest content comparison | `PASS` |
| `hdiutil verify` | `PASS` |
| readonly attach | `PASS` |
| unique enclosed `.app` | `PASS` |
| enclosed binary SHA256 comparison | `PASS` |
| local codesign classification comparison | `PASS` |
| local spctl comparison | `PASS` |
| DMG detached | `PASS` |

Access boundary (formal record):

```text
access boundary verdict = AUTHENTICATED_DRAFT_AND_ANONYMOUS_WEB_DENIED
anonymous REST API = NOT_FOUND
anonymous Web release tag = NOT_FOUND
anonymous assets = ALL_NOT_FOUND
draft = true
prerelease = true
published = false
local access-verdict SHA256 = sha256:7e721be45569d7e74513adc88b57a53c6e4ed1576ee523df87c1c00332bf4013
```

The workflow `Finalize access-boundary verdict` step completed successfully.
The workflow summary `access_boundary_verdict` field rendered blank. That blank
is a **summary rendering gap**, not a successful verdict string and not a
reason to treat access boundary as undetermined. The verdict above was fixed by
complementary evidence:

- authenticated draft confirmation in the workflow — `PASS`
- anonymous API probe — `NOT_FOUND`
- anonymous Web tag probe — `NOT_FOUND`
- anonymous asset probes — `ALL_NOT_FOUND`
- `Finalize access-boundary verdict` step — `PASS`
- local re-evaluation with the same main contract evaluator
- local access-verdict SHA256 recorded above

Do not rerun run `34077117176` or redispatch `gate-c-rc5-7b5b740d1db1`. Do
not create RC6 without a new operator sequence. Do not rebuild the RC5 artifact
from source for Human Gate C. RC5 is a personal/local evaluation candidate,
not a public release. Human Gate C remains `NOT_RUN`. Gate C remains
`NOT_PASS`. M5 remains `INCOMPLETE`.

## Gate C safety boundary

- Original CF/SD media stay disconnected for the entire Gate C run.
- Sole-copy media are forbidden.
- Only a verified disposable clone may receive writes.
- A pre-run per-file byte manifest of the clone is required before root
  registration and rename. Capture and compare with
  `scripts/gate-c-byte-manifest.mjs`. That capture is Human Gate C execution
  evidence, not a pre-freeze FAT-HASH required item. Whole-image checksums
  are not a substitute.
- Updater, cloud sync, remote filesystems, public release, and public
  distribution are out of scope.
- After a code change, do not reuse the same RC. Advance to the next RC
  number with a new frozen identity.

If any safety boundary cannot be demonstrated, STOP without registering a
root and without applying a rename.

## Gate C PASS conditions

Gate C is PASS only when every item below is demonstrated:

- Artifact identity is verified against the frozen RC filename, DMG SHA256, and
  app binary SHA256.
- Human Gate C installs or launches only from that verified frozen DMG. A
  rebuild from the frozen source commit is **STOP**.
- The launched executable SHA256 matches the recorded inner app binary SHA256
  of that DMG.
- `DMG verification` is `PASS` and `codesign verification` is an acceptable
  recorded outcome as defined in the freeze rules.
- Source-to-artifact provenance is verified against the in-run checksum
  manifest or equivalent attestation from the recorded workflow run/attempt,
  including workflow name, run ID, run attempt, canonical URL, workflow
  checkout SHA, and candidate storage.
- Local re-hash matches that run-generated digest.
- Automated Gate C is PASS.
- External clone verification is PASS.
- Rename Plan → Prepare → restart → Continue → Apply completes on the
  verified disposable clone, using the launched frozen candidate.
- The operation ends `COMMITTED` / `VERIFIED`.
- `rename-committed-evidence:v1` is exported through the operator surface, its
  private file identity is recorded without publishing its contents, and
  `expected-from-evidence` accepts it without manual hash completion.
- Missing / Invalid / Unresolved reference counts are 0.
- Unrelated bytes are unchanged versus the pre-run per-file byte manifest.
  Compare with `scripts/gate-c-byte-manifest.mjs` must report `PASS` and
  `unrelated_entries_unchanged: true`.
- Octatrack MkII can load the Set and Project from the clone.
- The renamed sample can be played on that hardware.
- Original media remained disconnected for the entire run.
- No public release, public distribution, or updater delivery was started by
  the candidate build or by this Gate C run.

Any gap in this evidence is STOP, not PASS.

Human Gate C PASS does not authorize public distribution.
