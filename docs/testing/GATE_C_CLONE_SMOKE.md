# Gate C cloned-media rename smoke

**Current-main authorization:** After PR #109 / #111, do **not** run Human Gate C
on RC6. RC7 is the post-rebaseline current-main candidate. Read
[`GATE_C_POST109_111_REBASELINE.md`](GATE_C_POST109_111_REBASELINE.md) and
[`GATE_C_RC_LEDGER.md`](GATE_C_RC_LEDGER.md) §RC7. Human Gate C on RC7 starts
**only after** the RC7 freeze ledger PR merges to `main`. Until then, this
checklist is **not** authorized for current-main execution.

## Purpose

This checklist is the human-reviewed evidence for the final Gate C sign-off
items that automated tests cannot cover: loading a renamed clone on real
Octatrack hardware and exercising rename Apply through a controlled operator
harness with explicit approval UI.

Automated proof for catalog rescan, missing-reference counts, sentinel hash
invariance, rollback byte restoration, fail-closed unknown-byte handling, and
production-route rename recovery (`v2_rename_recover` + restart discovery) lives
in `src-tauri/src/gate_c_clone_rescan.rs`, `src-tauri/src/v2_api.rs` recovery
tests, and `scripts/gate-c-synthetic-smoke.sh`. Those artifacts do not replace
this checklist.

This checklist runs after the frozen RC candidate is recorded in
`GATE_C_RC_LEDGER.md`. Executing it is not required to complete FAT-HASH
assessment or to freeze RC2. Missing evidence here is STOP for Human Gate C.

Human Gate C unrelated-byte proof uses the deterministic per-file tool
`scripts/gate-c-byte-manifest.mjs`. It hashes file bytes directly and does not
use catalog hash reuse. Keep generated manifests outside the repository; they
may contain personal sample names. Record only the manifest digest, entry
counts, and verdict in repository evidence.

Clone integrity excludes explicitly-known host OS metadata (for example
`.Spotlight-V100`, `.Trashes`, `.fseventsd`, `.DS_Store`, and AppleDouble
`._*` sidecars). Unknown files and unreadable unknown paths remain fail-closed.
This policy applies to source evidence, managed clone creation, external clone
verification, re-verification semantics, and byte-manifest capture; it does not
mean all macOS dotfiles are ignored.

## Preconditions

- A human prepares a disposable clone from non-original media. Record provenance
  outside the repository.
- The original SD/CF card stays disconnected for the entire smoke.
- The clone is not the sole copy of personal audio or project data.
- Capture a complete pre-run per-file byte manifest with
  `scripts/gate-c-byte-manifest.mjs` **before** root registration and **before**
  rename. Whole-image checksums are not a substitute.
- Human Gate C uses the **current-main** frozen candidate recorded in
  `GATE_C_RC_LEDGER.md` (§Next candidate after post-#109/#111 rebaseline).
  Install or launch from that verified DMG only.
- RC6 (`gate-c-rc6-3485118e9a19`) and RC5 are **historical** freezes only.
  Current-main Human Gate C on RC5 or RC6 after #109 / #111 is **FORBIDDEN**.
- Use candidate bytes retrieved from private candidate storage. Do not record
  local absolute paths for that storage in repository evidence.
- Do not rebuild the application from source for this smoke, even from the
  frozen commit. Rebuilding from the recorded commit is **STOP**.
- Confirm the launched executable SHA256 matches the recorded inner app binary
  SHA256 for **that** frozen candidate (from the ledger — not RC6 after #109/#111).
- Do not use the RC5 DMG, the RC6 DMG, or an unfrozen later-main build for
  current-main Human Gate C.
- Use the frozen candidate produced by **`Gate C Candidate Build`**
  (`.github/workflows/gate-c-candidate.yml`). Do **not** use
  `.github/workflows/rc-release.yml` for Gate C candidates.
- No updater, release, deploy, cloud sync, or remote filesystem is involved.

If any precondition cannot be demonstrated, stop without registering the root.

## Controlled operator harness

Production now exposes rename Apply through:

- an approved Octatrack root registered in `RootRegistry`
- clone-first setup (`Clone operator`) with verified disposable clone attestation
- explicit two-stage Continue / Apply approvals in `Rename operator`
- durable prepared plan review after restart (`v2_rename_get_prepared_plan`)
- fail-closed committed evidence export (`v2_rename_get_committed_evidence`)
  after a fresh verified rescan

M5-C5 Phase 4D automated UI/harness coverage is complete on branch
`m5c5-phase4d-operator-ux`. **Human Gate C clone-load smoke on real Octatrack MkII
hardware remains outstanding** before this checklist can be signed off end-to-end.

After Phase 3 merge, the first RC2 candidate dispatch failed before freeze.
Treat run `34016038137` as a historical record only. RC3 then failed after
draft creation and before evidence freeze. Treat run `34061897324` as a
historical record only. See `GATE_C_RC_LEDGER.md`. Operator order is now:

```text
RC2 attempt 34016038137 FAILURE recorded
  (gate-c-rc2-c324f048e3b9 retired; rerun forbidden)
→ macOS Bash portability fix merge
→ main CI success confirmation
→ RC3 dispatched once as gate-c-rc3-390f90578422
→ RC3 attempt 34061897324 FAILURE recorded
  (gate-c-rc3-390f90578422 retired; rerun forbidden;
   orphan draft 383727077 assets=0; do not delete or publish)
→ evidence runtime hotfix merge
→ main CI success confirmation
→ RC4 source commit/tree fixed by a new preflight on the new main tip
→ Gate C Candidate Build dispatched once as gate-c-rc4-<12hex>
→ RC4 attempt 34068535069 FAILURE recorded
  (gate-c-rc4-d324a1e6a05b retired; rerun forbidden;
   orphan draft 383761286 assets=3; do not delete or publish)
→ access-boundary proof fix merge
→ main CI success confirmation
→ RC5 source commit/tree fixed by operator preflight on the new main tip
  7b5b740d1db195f99d2bd78b46713531cfda41c5 /
  1b32b802d779e8ef9fe6a06183ded160355a1f88
→ Gate C Candidate Build dispatched once as gate-c-rc5-7b5b740d1db1
→ RC5 attempt 34077117176 SUCCESS recorded
→ draft candidate retrieved and SHA256 re-verified locally PASS
→ provenance / access boundary confirmed PASS
→ docs-only freeze ledger PR merged (#106 / 87a46b9)
→ P2 correction PR merged
→ review + CI
→ merge SHA main CI success
→ open PR を 0 件にする
  (#103 / #104 / #105 は branch を残して一時 close。M5 完了後に reopen/rebase)
→ RC6 source commit/tree fixed by operator preflight on the new main tip
  3485118e9a19413eae9a3203338d0b361660a902 /
  498da55fa04aead01ed13161379d84d8e734beac
→ Gate C Candidate Build dispatched once as gate-c-rc6-3485118e9a19
→ RC6 attempt 34182724485 SUCCESS recorded
→ draft candidate retrieved and SHA256 re-verified locally PASS
→ provenance / access boundary confirmed PASS
→ RC6 freeze ledger PR merged (#108)
→ #109 / #111 shared Project + contract fixes merged to main
→ post-#109/#111 rebaseline docs merged (GATE_C_POST109_111_REBASELINE.md)
→ operator preflight on new main tip for next candidate (RC7 identity UNSET)
→ Gate C Candidate Build dispatched once as gate-c-rc7-31107ae4ae21
→ RC7 attempt 34438615252 SUCCESS recorded
→ draft candidate retrieved and SHA256 re-verified locally PASS
→ provenance / access boundary confirmed PASS
→ RC7 freeze ledger PR (merge pending)
→ Human Gate C on RC7 frozen candidate only after ledger merge
→ M5 closure PR
```

Historical RC6 candidate coordinates (**not** for current-main Human Gate C after #109 / #111):

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc6-3485118e9a19` |
| source commit | `3485118e9a19413eae9a3203338d0b361660a902` |
| source tree | `498da55fa04aead01ed13161379d84d8e734beac` |
| workflow run ID | `34182724485` |
| draft release ID | `384424635` |
| artifact filename | `Masta-Octa_0.1.0_gate-c-rc6_3485118e9a19_aarch64.dmg` |
| DMG SHA256 | `sha256:b87197976619ba0dce8b2d167a36e2a1ef9a4ee79275a6174328f61b98c701fb` |
| checksum manifest SHA256 | `sha256:b0b70770b0be51c9a050f462357daa7c89438e9f7d68270efe0e39c133072bed` |
| candidate evidence SHA256 | `sha256:650d531ccf003191709f63d5c5f5b916b9a6435da86f4a9bd6300977a709537a` |
| inner app binary SHA256 | `sha256:6d50961f080d9f9a1522ec5c6b90639dc608c950d0e636a78300227699d61088` |
| access boundary verdict | `AUTHENTICATED_DRAFT_AND_ANONYMOUS_WEB_DENIED` |
| public distribution | `NOT AUTHORIZED` |

RC6 was frozen on `main` by #108 but is **not** authorized for current-main
Human Gate C after #109 / #111 (see GATE_C_POST109_111_REBASELINE.md). Do not
rebuild the RC6 DMG from source. Do not substitute RC5, RC6, or an unfrozen
later-main build for current-main Human Gate C.

Current RC7 candidate coordinates (**authorization pending ledger merge**):

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc7-31107ae4ae21` |
| source commit | `31107ae4ae21fc5445cdb153cfaf9310fc7d474d` |
| source tree | `b33434d874868b38ede838ae241080afe5d0f26e` |
| workflow run ID | `34438615252` |
| draft release ID | `386014076` |
| artifact filename | `Masta-Octa_0.1.0_gate-c-rc7_31107ae4ae21_aarch64.dmg` |
| DMG SHA256 | `sha256:aa99cb00d7f39b1686a3fa3cba21d460fe9c6c0510914dc92bfc28e533d3b5b0` |
| checksum manifest SHA256 | `sha256:1a39386ea00695c9953e2bd436015fa5199ffc2149895a8b63019618303cea0d` |
| candidate evidence SHA256 | `sha256:2a5a687342e70ec7f1679da439881a202fc04c508279b715ba0ae0710c0612de` |
| inner app binary SHA256 | `sha256:8c44c909f4d46295c0be3bcc7b519a083795c5514ad8333cf4f157bdf10295b0` |
| access boundary verdict | `AUTHENTICATED_DRAFT_AND_ANONYMOUS_WEB_DENIED` |
| public distribution | `NOT AUTHORIZED` |

RC7 is the post-rebaseline current-main candidate. Human Gate C on RC7 is
**NOT AUTHORIZED** until the RC7 freeze ledger PR merges to `main`. Do not
rebuild the RC7 DMG from source. Do not substitute RC5, RC6, or an unfrozen
later-main build for current-main Human Gate C.

Historical RC5 candidate coordinates (not for current-main Human Gate C):

| Field | Value |
|---|---|
| candidate_id | `gate-c-rc5-7b5b740d1db1` |
| source commit | `7b5b740d1db195f99d2bd78b46713531cfda41c5` |
| source tree | `1b32b802d779e8ef9fe6a06183ded160355a1f88` |
| workflow run ID | `34077117176` |
| draft release ID | `383801533` |
| artifact filename | `Masta-Octa_0.1.0_gate-c-rc5_7b5b740d1db1_aarch64.dmg` |
| DMG SHA256 | `sha256:2d186fa141e6a829cfa0b74a15db823d3efe56da9389e3423da7cc67af699887` |
| checksum manifest SHA256 | `sha256:e6239b1af6cbc0bbfa2b1d4a29a14f035d827782ac7ac489450b0c5dce633435` |
| candidate evidence SHA256 | `sha256:284c04d7c16f70cba9c0fe2a912b58e2e6c3d07457dc9430847fc589cc48f7ef` |
| inner app binary SHA256 | `sha256:ca76fedcc7a18e8f61350a14f7ddf4303da91126ebdba4ee70fef3dd921290dc` |
| access boundary verdict | `AUTHENTICATED_DRAFT_AND_ANONYMOUS_WEB_DENIED` |
| public distribution | `NOT AUTHORIZED` |

RC5 is a historical frozen candidate only. Current-main Human Gate C on RC5 is
**FORBIDDEN**. Do not substitute the RC5 DMG, a later-main build, or any RC5
bytes for current-main Human Gate C.

Do not reuse the RC2, RC3, RC4, RC5, RC6, or RC7 run, their candidate IDs, or any
in-progress DMG as later candidate evidence. RC6 and RC7 dispatch are one-shot. Do not
rerun run `34182724485`, redispatch `gate-c-rc6-3485118e9a19`, rerun run
`34438615252`, redispatch `gate-c-rc7-31107ae4ae21`, or reopen pull requests #103,
#104, or #105. A successful workflow run alone does not freeze the candidate.
Human Gate C starts only after the RC7 freeze ledger PR merges to `main` (see
GATE_C_RC_LEDGER.md §RC7).

## Byte-manifest commands

Store `PRE`, `POST`, `EXPECTED`, and `REPORT` outside the repository. Do not
commit those files. Replace the path arguments with local operator paths; do
not record those paths in repository evidence.

Capture:

```bash
node scripts/gate-c-byte-manifest.mjs capture \
  --root CLONE_ROOT \
  --output PRE.json
```

Capture must print a non-zero `entries` count and exit 0. Any `STOP` code,
partial file, or output written inside the clone root is Gate C STOP.

After Prepare, restart, Continue, and Apply, confirm `COMMITTED / VERIFIED`,
rescan completed, and zero Missing / Invalid / Unresolved counts. In
`Rename operator`, select **Copy prepared plan JSON** and **Copy committed
evidence JSON**, paste each export unchanged into `PREPARED_PLAN.json` and
`COMMITTED_EVIDENCE.json` outside the clone root and repository, and restrict
those private files to the operator:

```bash
chmod 600 PREPARED_PLAN.json COMMITTED_EVIDENCE.json

node scripts/gate-c-byte-manifest.mjs expected-from-evidence \
  --plan PREPARED_PLAN.json \
  --evidence COMMITTED_EVIDENCE.json \
  --output EXPECTED.json
```

The backend returns `rename-committed-evidence:v1` only after it binds the
persisted prepared snapshot, committed journal, verified backup, and current
stable clone fingerprint, then performs a fresh rescan and live SHA256 checks.
The export contains operation/plan identity, root-relative paths, and actual
audio, sidecar, and Project pre/post SHA256 values. It contains no root ID,
media fingerprint, UUID, absolute path, username, or host directory.

`expected-from-evidence` verifies the plan/operation identity, path sets, and
plan pre-image SHA256 bindings for audio, sidecar, and Project pre-write bytes,
rejects missing, malformed, duplicate, extra, or escaping evidence, and writes
deterministically ordered expected changes. It uses the committed Project
post-write SHA256; it never predicts that hash from the rename string or old
Project bytes. Failure to export, a disabled export button, clipboard failure,
JSON alteration, identity mismatch, or `STOP` from this command is Human Gate C
STOP. Do not complete hashes by hand. `expected-from-prepared` remains available
for diagnostic use but cannot produce a complete expected set for Project
rewrites.

Post-run capture and compare:

```bash
node scripts/gate-c-byte-manifest.mjs capture \
  --root CLONE_ROOT \
  --output POST.json

node scripts/gate-c-byte-manifest.mjs compare \
  --pre PRE.json \
  --post POST.json \
  --expected EXPECTED.json \
  --report REPORT.json
```

Compare must report `verdict: PASS` and `unrelated_entries_unchanged: true`.
Any unexplained add, remove, content change, type change, schema mismatch,
exclusion-policy mismatch, missing expected change, or hash mismatch is STOP.

Record evidence with file digests only:

```bash
shasum -a 256 \
  PRE.json COMMITTED_EVIDENCE.json POST.json EXPECTED.json REPORT.json
```

## Real-hardware clone-load smoke

1. Disconnect original media. Keep it disconnected for the entire run.
2. Prepare the disposable clone from non-original media.
3. Before root registration and before rename, capture the pre-run per-file
   manifest with the `capture` command above. Write the output outside the
   clone root and outside the repository.
4. Confirm capture succeeded: exit 0, complete JSON, `schema` is
   `masterocta-gate-c-byte-manifest:v1`, and no `.partial` file remains.
5. Verify the **current-main** frozen candidate DMG from `GATE_C_RC_LEDGER.md`
   (`hdiutil verify` must succeed), record the codesign/`spctl` outcome, install
   or launch from that DMG, and confirm the launched executable SHA256 matches
   the ledger's recorded inner app binary SHA256 for that candidate.
   Using the RC5 or RC6 historical DMG, their inner binary SHA256 values, or an
   unfrozen later-main build is **STOP**. Rebuilding from the recorded commit is STOP.
6. Register the disposable clone read-only and confirm baseline catalog scan
   shows the intended source sample as `Resolved` with zero blocking
   references.
7. Plan a sample rename to an unused destination stem in the same Set Audio Pool.
8. Review backup count, impacted Project documents, sidecars, and destination
   collision state before approval.
9. Prepare the exact displayed plan, restart the application, reopen the same
   disposable clone, review the durable prepared plan, and use the separate
   Continue and Apply approvals once on the **clone** only.
10. Confirm `COMMITTED / VERIFIED`, completed rescan, and zero Missing / Invalid
    / Unresolved counts. Copy the committed evidence JSON through the operator
    action and save it unchanged as private mode-0600 evidence outside the clone
    root and repository.
11. Capture the post-run per-file manifest with the same `capture` command.
12. Generate `EXPECTED.json` with `expected-from-evidence`, then run `compare`.
    Expected rename changes must occur with the expected post hashes. Every
    other entry must match on path, type, size, and SHA256.
13. If compare is not `PASS`, Gate C is STOP. Do not continue to hardware load.
14. Rescan the clone in MasterOCTa and confirm missing/invalid/unresolved
    reference counts are zero and affected slots resolve to the destination.
15. Safely eject the clone, load it on Octatrack MkII hardware, and confirm the
    renamed sample and Project references behave as expected in a minimal
    playback/smoke pattern chosen by the operator.
16. Retain the disposable clone or discard it according to the external test
    plan; do not use MasterOCTa to mutate the original removable media.

## Evidence record

Record the following in the Pull Request or a follow-up issue without absolute
paths, volume identifiers, personal filenames, or media fingerprints:

- frozen RC identity, DMG SHA256, launched executable SHA256 match, and host OS
- clone provenance reviewed: yes/no
- original media disconnected: yes/no
- pre/post byte-manifest SHA256, entry counts, compare verdict, and
  `unrelated_entries_unchanged`
- committed evidence schema plus sanitized operation/plan identity and evidence
  file SHA256; do not commit the private evidence JSON
- rename apply + rescan result on clone
- hardware load result
- deviations, failures, and whether the disposable clone was retained

Gate C remains incomplete until both the controlled operator harness and this
human clone-load checklist are executed and signed off.

Automated synthetic-clone smoke (no original media) is available via
`scripts/gate-c-synthetic-smoke.sh`. Generated reports under `/tmp` are not
committed to the repository. Byte-manifest unit tests are
`pnpm run test:gate-c-manifest` and also do not access removable media.
