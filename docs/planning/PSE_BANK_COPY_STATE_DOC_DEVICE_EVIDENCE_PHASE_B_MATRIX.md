# P_BANK_COPY_STATE — Phase B transition matrix

Operator capture root (local, not in git): `~/octa-captures/P_BANK_COPY_STATE`
Generated: 2026-10-19 (harness `MO-PSE-BANK-COPY-STATE-DOC-DEVICE-EVIDENCE-1`)
Revalidated: 2026-10-19. Hash rows below are stored-directory diffs. They are not attributed effects where this judgment says **INCONCLUSIVE**.

## Judgment

```text
DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RESULT = STOP_WITH_FINDINGS
PATTERN_UI_QUALIFICATION = FAIL
PRE_SOURCE_WORK_STRD_DIVERGENCE = PASS
SOURCE_ONLY_PRECONDITION = CONTAMINATED
CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN
IMMEDIATE_COPY_TIMING_ATTRIBUTION = INCONCLUSIVE
POST_COPY_SESSION_CONTINUITY = NOT_PROVEN
CONTROL_SWITCH_ATTRIBUTION = INCONCLUSIVE
PROJECT_SAVE_ATTRIBUTION = INCONCLUSIVE
PROJECT_RELOAD_ATTRIBUTION = INCONCLUSIVE
DESTINATION_UI_SENTINEL = NOT_RECORDED
COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE
COPY_STATE_DOC_RULE = BLOCKED
```

`bank01.work` ≠ `bank01.strd` at S1 remains true. That single inequality does not make the source-only step a controlled baseline.

Harness `analyze` on this operator root rejects S2–S5 because `current_pattern_ui` is `A01` while `[STATES]` selects Bank D or Bank B. Rewriting those labels to **D01** / **B01** does not clear transport, contamination, continuity, or sentinel.

## Review gates

### Bank-qualified pattern labels

| Stage | BANK raw | PATTERN raw | Bank UI | Pattern UI from raw | Operator `current_pattern_ui` |
| --- | --- | --- | --- | --- | --- |
| S0 | 0 | 3 | A | A04 | A04 |
| S1 | 0 | 3 | A | A04 | A04 |
| S2 | 3 | 0 | D | D01 | A01 (rejected) |
| S3 | 1 | 0 | B | B01 | A01 (rejected) |
| S4 | 1 | 0 | B | B01 | A01 (rejected) |
| S5 | 1 | 0 | B | B01 | A01 (rejected) |

### Transport (all six stages)

| Field | Recorded value |
| --- | --- |
| `capture_transport` | Operator copied P_BANK_COPY_STATE bytes from CF to macOS capture tree |
| `capture_required_mode_change` | `no` |
| `capture_may_flush_device_state` | `no` |
| `capture_flush_exclusion` | absent |

CF copy can enter an acquisition mode that flushes device state. `may_flush=no` with no exclusion reason is not proof that this transport is non-mutating. **CAPTURE_TRANSPORT_CONFIDENCE = UNKNOWN**. S1→S2 timing is **INCONCLUSIVE**.

### Source-only precondition

S0→S1 is a working-only edit on source Bank A. `bank01.work` changes and `bank01.strd` does not, and `bank04.work` also changes (`1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19` → `cba6f40e5922f3b35478db438ac2c570f37b45f68ea89c6c5e58b05dac01d4b8`) while `bank04.strd` stays on the first hash. The cause is unrecorded. **SOURCE_ONLY_PRECONDITION = CONTAMINATED**. Copy provenance is not established.

### S2→S3 and later continuity

S3 `operator_note` is `S3 redo: control Bank B`. S4 is `S4 recaptured after S3 redo`. S5 is `S5 recaptured after S3 redo`. No `capture_run_id` is recorded. The redo procedure allows replaying Copy A→D instead of continuing from this stored S2 tree. Hash equality on the left side of S2→S3 is the stored S2 directory, not a device-session boundary. **POST_COPY_SESSION_CONTINUITY = NOT_PROVEN**. CONTROL_SWITCH, PROJECT_SAVE, and PROJECT_RELOAD are **INCONCLUSIVE**.

### Destination sentinel

No stage records `destination_ui_sentinel`. Whether a source sentinel was visible on Bank D at S2, or still visible after reload at S5, is **NOT_RECORDED**.

## project.work [STATES] by stage

| Stage | Directory | BANK raw | PATTERN raw | Bank UI | Pattern UI |
| --- | --- | --- | --- | --- | --- |
| S0 | s0_baseline_saved | 0 | 3 | A | A04 |
| S1 | s1_source_working_diverged_pre_copy | 0 | 3 | A | A04 |
| S2 | s2_immediately_after_bank_copy | 3 | 0 | D | D01 |
| S3 | s3_after_control_switch | 1 | 0 | B | B01 |
| S4 | s4_after_project_save | 1 | 0 | B | B01 |
| S5 | s5_after_project_reload | 1 | 0 | B | B01 |

Pattern UI is the bank-qualified label implied by `[STATES]`. Operator metadata still says `A01` for S2–S5 and fails the corrected matcher.

## Transition: SOURCE_WORKING_ONLY_EDIT

`s0_baseline_saved` → `s1_source_working_diverged_pre_copy`

**CONTAMINATED.** `bank04.work` changes on a step that may change only `bank01.work`. Cause unrecorded. This pair is not a controlled pre-copy baseline.

Changed files: **2** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e |
| project.strd | no | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e |
| bank01.work | YES | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | e3a4fe1f3bf5b3c02e8cbdfca4d343c7986ac2a87eb4b3c117302b4b1e21e22a |
| bank01.strd | no | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | cba6f40e5922f3b35478db438ac2c570f37b45f68ea89c6c5e58b05dac01d4b8 |
| bank04.strd | no | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 |

## Transition: NATIVE_BANK_COPY

`s1_source_working_diverged_pre_copy` → `s2_immediately_after_bank_copy`

Directory diff only. Timing attribution is **INCONCLUSIVE** (transport exclusion absent; source-only step contaminated).

Changed files: **6** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | YES | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 |
| project.strd | YES | 3327 | 3327 | 3639d6565978dc77b6fe563639341bf09e23ee034b8486b144e712080cae9d1e | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 |
| bank01.work | YES | 636113 | 636113 | e3a4fe1f3bf5b3c02e8cbdfca4d343c7986ac2a87eb4b3c117302b4b1e21e22a | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | YES | 636113 | 636113 | 17039a45e7bbba206bcd33fe53fc56986841ae1133e280a93dfd61af38c45688 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | cba6f40e5922f3b35478db438ac2c570f37b45f68ea89c6c5e58b05dac01d4b8 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |
| bank04.strd | YES | 636113 | 636113 | 1e5031ca8b0a03105a4e065a7a9f653f9937641ea1e8914307f018e60d9d2a19 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |

## Transition: CONTROL_SWITCH

`s2_immediately_after_bank_copy` → `s3_after_control_switch`

**INCONCLUSIVE.** S3–S5 were recaptured. Nothing records that the recapture continued from this S2 tree. These diffs stay unattributed.

Changed files: **3** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | YES | 3327 | 3327 | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | YES | 3327 | 3327 | 443cc6233abcb66502de8a57d0048159a2a79d3642581aab47f7d75d08193199 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | YES | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | no | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b |

## Transition: PROJECT_SAVE

`s3_after_control_switch` → `s4_after_project_save`

**INCONCLUSIVE.** S4 was recaptured after the S3 redo, with no run id tying it to the stored S2.

Changed files: **1** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | YES | 636113 | 636113 | c0cef899d61b6a9425feb95ed10c3eaa7ce117696208486efe95de2c069bae9b | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |

## Transition: PROJECT_RELOAD

`s4_after_project_save` → `s5_after_project_reload`

**INCONCLUSIVE.** S5 was recaptured after the S3 redo. A zero-diff between the stored directories does not prove reload persistence for the S2 session.

Changed files: **0** / 10

| File | Changed | Size before | Size after | SHA256 before | SHA256 after |
| --- | --- | --- | --- | --- | --- |
| project.work | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| project.strd | no | 3327 | 3327 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 | 495cb410145666c2f5bdc7f4ceebba913eb8b5f12b853dfd7a718e35747053c8 |
| bank01.work | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank01.strd | no | 636113 | 636113 | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb | afc6a060b05601fc47ee5b77b6d86f953268fe92a0bf6487327dc7ed06375afb |
| bank02.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank02.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.work | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank03.strd | no | 636113 | 636113 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 | 5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312 |
| bank04.work | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |
| bank04.strd | no | 636113 | 636113 | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee | 0cbf7186227991fc52c4eb8a0907f9c69c506483dee16625e1d96f1bd1781fee |

## First hash difference vs stored S1 (not an attributed persistence transition)

- bank04.work first differs from stored S1 at the stored S2 directory
- bank04.strd first differs from stored S1 at the stored S2 directory

**COPY_EFFECT_ATTRIBUTION = INCONCLUSIVE.** The source-only step already changed `bank04.work`, transport flush exclusion is absent, and no destination UI sentinel is recorded.

## Salvage closure (2026-10-25)

Addendum only. The hash tables above stay the 2026-10-19 stored-directory record. They are not replaced, recomputed, or treated as a manifest for the bytes now on disk.

Read-only `inspect-mixed` on `~/octa-captures/P_BANK_COPY_STATE` (PR #245, merge `ba8156ec`) found no project or bank document at the stage roots (`0/60` device files). S0 has no `SHA256SUMS.json`. S1–S5 manifests are stale against those missing stage-root paths. The capture tree's mode, size, and mtime set was unchanged by the inspection.

Current device bytes sit under each stage at `P_BANK_COPY_STATE3/` and were not moved. Compared read-only with the S1–S5 manifests, `bank02` and `bank03` (`.work` and `.strd`) match the recorded digests, including historical `bank02.work` `5e073a5435039df19d77249b42f80de6704b532febec008c34f96c05ce9e6312`. `project`, `bank01`, and `bank04` do not match. Nested `project.work` is 3054 bytes; the tables above record 3327 bytes. The repository fixture receptacle was not used to fill the gap.

S0–S2 and S3–S5 remain separate sessions (`POST_COPY_SESSION_CONTINUITY = NOT_PROVEN`). Pattern Paste working-content transfer stays a separate recorded observation. It does not settle Bank Copy, Move, or Swap.

```text
DEVICE_CAPTURE = REJECTED
DEVICE_EVIDENCE_PROMOTION = BLOCKED
RAW_SNAPSHOT_INTEGRITY = UNVERIFIED
RESULT = STOP_WITH_FINDINGS

WORKING_CONTENT_TRANSFER_OBSERVATION = RECORDED
COPY_SAVED_CHECKPOINT_SEMANTICS = UNKNOWN

COPY_STATE_DOC_RULE = BLOCKED
MOVE_STATE_DOC_RULE = BLOCKED
SWAP_STATE_DOC_RULE = BLOCKED

ISSUE_217_CLOSE_READY = NO
BANK_CHANGEPLAN_READINESS = NOT_READY
APPLY_AUTHORIZED = NO
```

These keys are document audit items. No runtime schema change. Salvage of this capture is closed.

Operation classification canonical source: [`PSE_BANK_COPY_OPERATION_SEMANTICS.md`](./PSE_BANK_COPY_OPERATION_SEMANTICS.md) (`MO-PSE-BANK-COPY-SEMANTICS-RECONCILIATION-1`).
