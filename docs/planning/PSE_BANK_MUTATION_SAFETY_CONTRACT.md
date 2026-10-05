# Bank Mutation Safety Contract

- Work ID: `MO-PSE-BANK-MUTATION-CONTRACT-1`
- Parent issue: #182
- Contract schema: `masterocta.bank-mutation-contract:v1`
- Code: [`ot_plan::bank_mutation`](../../src-tauri/crates/ot-plan/src/bank_mutation.rs)（pure、filesystem 非依存）
- Contract tests on fixtures: [`src-tauri/src/bank_mutation_contract.rs`](../../src-tauri/src/bank_mutation_contract.rs)
- Inventory: [`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)（`ot-plan-bank-mutation-contract`、`masterocta-bank-mutation-contract`）
- Related: [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md) §6 / §9、[`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md) §7C / §11、[`../testing/PSE_CI_FOUNDATION.md`](../testing/PSE_CI_FOUNDATION.md)、[`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md) P4 / P5 / §5.6–5.8

## 0. この文書の位置づけ

Bank Copy / Move / Swap の Apply（#183）が満たすべき安全契約である。Apply を実装してよい条件と、Apply を始めてはいけない STOP 条件を、テストで検証できる形に固定する。

この文書と付随コードは次をしない。

- Apply、Recovery、Backup の実装。Bank 用の write API、Tauri command、frontend 操作
- 実機 CF 原本、ユーザー原本、tracked fixture への書き込み
- PSE-3 の承認。control plane §9 のとおり、PSE-3 は別文書で明示承認するまで着手しない
- #181 ChangePlan の内容決定。Plan をどう計算するかは #181 の責任。この契約は Plan が何を持ち、どう検査されるかだけを決める
- Sample management（AudioAsset、lineage、hash、catalog、slice）の変更。Bank 側は Sample Slot 参照だけを持つ

```text
BANK_MUTATION_CONTRACT = DEFINED (v1)
APPLY_READINESS        = NOT_READY
```

## 1. 依存と現在の判定

`ReadinessEvidence::current_main()` は下の 7 項目をすべて未解決として返す。1 つでも未解決なら、他の検査がすべて通っても Apply entry permit は発行されない（テスト `current_main_withholds_the_permit_even_for_a_clean_plan`、`a_single_open_gap_withholds_the_permit`）。

| `ReadinessGap` | 未解決の理由 | 追跡 |
| --- | --- | --- |
| `BankChangePlan` | #181 は `BANK_CHANGEPLAN_READINESS = NOT_READY` | #181 |
| `ArrangementFileSlot` | `[STATES] ARRANGEMENT` が `arr01`–`arr08` に対応付いていない | #204 |
| `ArrangerPatternReferences` | Arranger `pattern_id`（`n_rows == 0` を含む）の番号付けが未証明 | 監査 §7C / §8 |
| `BankInternalIdentity` | tracked fixture は `bank01` のみ。Bank ファイル内に自己 index があるか未証明 | 監査 §7C |
| `SceneAndRecorderDependencies` | Scene / Recorder は unmodeled。unmodeled 依存は計画を失敗で閉じる | 監査 §7C、control plane §6 |
| `WorkingSavedCheckpointRule` | `.work` / `.strd` のどちらを動かすか、`[STATES] BANK` をどう扱うか未決 | 監査 §7C、control plane §12 |
| `ApplyAuthorization` | PSE-3 Apply の明示承認文書がない | control plane §9 |

項目を解決済みにするには、`ReadinessEvidence::current_main()` とそれを固定するテスト `current_main_readiness_keeps_every_gap_open` を、追跡先の証拠を添えたレビュー済み PR で変更する。`ReadinessEvidence::assume_resolved` は契約テストで permit 経路を検証するためのものであり、製品コードから呼ばない。

## 2. 既存 safety primitive の再利用監査

| 既存 | 場所 | Bank mutation での扱い |
| --- | --- | --- |
| `RootRegistry` / `RootId` / 登録時のみ raw path | `root_registry.rs`、`v2_api.rs` | **再利用**。Bank 操作も `RootId` + `RootRelativePath` だけを受ける |
| contained read（non-following descriptor、root 内確認） | `legacy_read_adapter.rs`、`project_structure_reader.rs` | **再利用**。PRE/POST の read model と manifest 取得はこの境界を通す |
| write grant（`v2_root_enable_write` / `disable_write`） | `v2_api.rs` | **再利用**。`LiveTargetObservation.write_enabled` が false なら STOP |
| cross-domain mutation gate | `mutation_gate.rs` `ensure_cross_domain_mutation_allowed` | **拡張が必要**（#185）。現在は additive / rename journal だけを見る。Bank journal を加え、同じ root の未完了 journal があれば `recovery_pending = true` とする |
| PlanId（`plan:v1:` + SHA-256、canonical field encoding） | `ot-plan` `lib.rs` / `rename.rs` | **再利用**。`derive_bank_mutation_plan_id` は同じ形式で envelope の全 field を封じる |
| freshness / stale 再検証 | `ot-plan` `validate_rename_plan_freshness` | **型を踏襲**。Bank では project scope 全体の manifest 差分で判定する |
| verified backup snapshot（Mac 側、complete、再読込検証） | `ot-backup` `BackupStore` | **型を踏襲**。Bank 用 manifest（plan binding、file 一覧）は #185 で追加する。`BackupEvidence` が満たすべき値を定義する |
| executor lock / journal / staging | `ot-executor` | **型を踏襲**。Bank 用 journal と Apply は #183 / #185。媒体を変更できるのは `ot-executor` だけ（P3） |
| fixture PRE/POST manifest（Node） | `scripts/pse-fixture-manifest.mjs` | **同じ意味論を Rust 型にした**。path、entry type、size、SHA-256、symlink を記録。mtime は使わない |
| legacy write 停止 | `legacy_command_gate.rs` | **維持**。`copy_bank` / `copy_parts` / `copy_patterns` / `copy_tracks` / `copy_sample_slots` は DISABLED のまま。復活させない |
| rename API | `v2_rename_*` | **流用しない**。Bank swap を rename として実装しない（control plane §5、CI foundation §8） |

## 3. Flow（BMS-FLOW）

```text
Intent → Plan → Review → Backup → Prepare → Apply → Verify → Committed
                                              │        │
                                              └────────┴→ Recovery → RolledBack
                                                              │
                                                              └→ RecoveryRequired ⇄ Recovery
Intent / Plan / Review / Backup / Prepare → Cancelled
```

| ルール | 内容 | テスト |
| --- | --- | --- |
| BMS-FLOW-1 | 段階を飛ばさない（例: Plan → Apply、Backup → Apply は不可） | `phase_flow_cannot_skip_steps_or_cancel_mid_apply` |
| BMS-FLOW-2 | Apply 中・Verify 中は Cancel しない。Recovery へ進むか Verify を終える（architecture §5.8） | 同上 |
| BMS-FLOW-3 | Committed / RolledBack / Cancelled は終端。stale になった Plan は rebase せず Cancelled にして再計画する | 同上 |
| BMS-FLOW-4 | target へ write してよい phase は Apply と Recovery だけ。Verify は read only | `only_apply_and_recovery_may_write_and_failures_have_one_disposition` |

## 4. 何を write とみなすか（BMS-WRITE / BMS-NOWRITE）

project directory 配下の全 entry を `TreeManifest` に取る。key は root 相対 path。entry は `File { byte_size, content_hash }`、`Directory`、`Symlink { target_digest }`、`Other` のいずれか。

次のどれか 1 つでも起きれば write とみなす（`TreeChangeKind`）。

- `Created`: PRE に無い entry が POST にある
- `Removed`: PRE の entry が POST に無い
- `ContentChanged`: regular file の size または SHA-256 が変わった
- `EntryKindChanged`: file / directory / symlink / other の種別が変わった
- `SymlinkRetargeted`: symlink の参照先テキストが変わった

symlink の参照先は digest だけを保持し、manifest に root 外の path を持たせない。mtime、atime、permission bit は契約に含めない。FAT 系媒体では信用できないためである。

**no-write 証明**（`prove_no_write`）は PRE と POST の manifest が等しいことである。CI foundation §5 と同じく、これは byte と entry 種別が変わっていない証拠であり、write syscall が起きなかった証明ではない。no-write を主張するコードパスは、write API を持たないことと組み合わせて示す。

| ルール | 内容 | テスト |
| --- | --- | --- |
| BMS-WRITE-1 | 上の 5 種類はすべて write として検出される | `every_kind_of_tree_difference_counts_as_a_write` |
| BMS-NOWRITE-1 | Intent〜Prepare、Cancelled、RolledBack では target は PRE と byte 一致でなければならない | `only_apply_and_recovery_may_write_and_failures_have_one_disposition` |
| BMS-NOWRITE-2 | 契約評価（read model の取得、envelope の封印、entry gate）は TempDir コピーを変更しない | `contract_evaluation_on_a_real_read_model_leaves_the_copy_byte_identical` |

## 5. Plan envelope（BMS-PLAN / BMS-SCHEMA）

`BankMutationEnvelope` は #181 ChangePlan の安全に関わる射影である。#181 の Plan は、少なくとも次を envelope として出せなければならない。

| field | 意味 |
| --- | --- |
| `contract_schema` | `masterocta.bank-mutation-contract:v1` |
| `read_model_schema` | Plan を計算した read model の DTO schema（現行 `masterocta.project-structure:v3`） |
| `root_id`、`device_fingerprint`、`base_observed_revision` | root の identity と観測 revision |
| `project_relative_path` | 対象 project directory |
| `kind`、`source`、`destination` | Copy / Move / Swap と Bank index |
| `affected_roles` | 動かす文書 role（Working / SavedCheckpoint）。含まれない role は両 Bank とも不変 |
| `scope_manifest` | Plan 時点の project scope 全体の manifest |
| `documents` | Plan が読んだ state 文書と parse status |
| `expected_changes` | 変更してよい path ごとの `before` / `after`（`Absent` または size + SHA-256） |
| `unmodeled` | Plan がモデル化できなかった依存 |

`BankMutationEnvelope::seal` が全 field を canonical encoding して `PlanId` を作る。どの field を書き換えても `validate_integrity` が失敗する（`sealed_plan_id_is_deterministic_and_detects_tampering`）。

`expected_changes[].after` は Prepare で作った staged bytes から取る。Bank internal identity が未証明なので、複製先 Bank が複製元と byte 一致すると仮定しない。

schema 慣行は #197 / #199 と同じである。rule または encode する field を変えるときは `contract_schema` と canonical prefix を上げ、v1 を in-place で拡張しない。read model の DTO schema が Plan 時点と Apply 直前で違えば STOP する（`ReadModelSchemaChanged`）。

## 6. Apply entry の STOP 条件（BMS-ENTRY）

`evaluate_apply_entry(envelope, live, backup, readiness)` だけが `ApplyEntryPermit` を作る。将来の Apply 入口はこの permit を引数に取る。STOP 条件は 1 つ見つけた時点で止めず、該当するものをすべて決定的な順序で返す。各条件には `BMS_*` の安定コードがある（`stop_condition_codes_are_unique`）。

| 区分 | `StopCondition` | テスト |
| --- | --- | --- |
| readiness | `ReadinessGap(_)` | `current_main_withholds_the_permit_even_for_a_clean_plan` |
| envelope | `ContractSchemaMismatch`、`PlanIntegrityMismatch`、`InvalidRootFingerprint`、`InvalidObservedRevision`、`SourceEqualsDestination`、`NoAffectedRoles`、`DuplicateAffectedRole`、`EmptyChangeSet` | `envelope_shape_fails_closed`、`sealed_plan_id_is_deterministic_and_detects_tampering` |
| change set | `DuplicateExpectedChange`、`NoOpExpectedChange`、`ExpectedChangeOutsideProject`、`ExpectedChangeBeforeMismatch` | `expected_changes_must_be_unique_real_and_inside_the_project`、`project_prefix_check_does_not_accept_a_sibling_with_the_same_prefix` |
| parse / model | `DocumentNotParsed`（`Malformed`、`UnsupportedVersion`）、`UnmodeledDependency(_)`、`NonRegularEntryInScope`（symlink、FIFO など） | `unparsed_documents_unmodeled_dependencies_and_links_block_the_plan`、`a_symlink_in_the_project_scope_blocks_the_plan_without_being_followed` |
| stale / root | `RootMismatch`、`DeviceFingerprintChanged`、`UnstableRootIdentity`、`ObservedRevisionChanged`、`ReadModelSchemaChanged`、`StalePrecondition(_)` | `stale_live_observation_withholds_the_permit`、`a_byte_changed_after_planning_makes_the_plan_stale` |
| 権限 / 他操作 | `WriteNotEnabled`、`RecoveryPending` | `stale_live_observation_withholds_the_permit` |
| target | `TargetNotFixtureScope(_)` | `only_fixture_scope_targets_are_writable` |
| backup | `BackupMissing`、`BackupPlanMismatch`、`BackupIncomplete`、`BackupNotReverified`、`BackupNotLocal(_)`、`BackupDoesNotCover`、`BackupHashMismatch` | `backup_must_be_complete_local_reverified_and_cover_every_changed_file` |

stale 判定は対象ファイルだけでなく project scope 全体で行う。Plan 後に scope 内のどの entry が増減・変化しても、その Plan は使えない。

## 7. Target（BMS-TARGET）

#183 の間、Apply 先は `TrackedFixtureCopy` と `TemporaryProjectCopy` だけである。`UserProject`、`OriginalMedia`、`Unclassified` は STOP する。target class は backend が root について持つ証拠から決める。frontend の flag や表示名から決めない。tracked fixture そのものは対象にしない（コピーだけ）。

## 8. Backup（BMS-BACKUP）

Apply 前に、次をすべて満たす backup が必要である。

- この Plan の `PlanId` に束縛されている
- `complete` であり、作成後に再読込して検証済み（`reverified`）
- Mac 側 Application Support にある（target 媒体上の backup は認めない。architecture §5.7）
- `before` が `File` の全 expected change について、同じ path、size、SHA-256 のファイルを含む

`before` が `Absent` の path（Copy 先など）は backup 対象のファイルが無い。その path が PRE で存在しなかったことは `scope_manifest` が記録しており、Recovery はそれを根拠に作成物を取り除く。取り除いたファイルは即時削除せず、回復可能な隔離を優先する（AGENTS.md）。

## 9. Partial failure（BMS-FAIL）

複数ファイルの原子的更新は約束しない（architecture P5）。代わりに phase ごとの扱いを固定する（`BankMutationPhase::on_failure`）。

| 失敗した phase | 義務 |
| --- | --- |
| Intent / Plan / Review / Backup / Prepare | `CancelWithoutTargetChange`。target は PRE と byte 一致であることを示して閉じる |
| Apply / Verify | `RecoverToPre`。Recovery へ進む。途中で止めて成功扱いにしない |
| Recovery / RecoveryRequired | `BlockRootUntilRecovered`。同じ root の mutation をすべて止める（`RecoveryPending`） |

app の再起動や中断のあとも未完了 journal が残っていれば、通常操作を止めて resume か restore を提示する（architecture §5.8）。journal の形式と再開手順は #185 の範囲である。

## 10. Verify（BMS-VERIFY）

Apply 後は 2 つの検査を両方通す。片方だけでは Committed にしない。

**byte-level**（`verify_expected_changes`）: 宣言した path だけが変わり、それぞれ `after` に一致し、project scope の他の entry はすべて不変であること。Project 内の sample ファイルや `markers.work`、`arrNN.work` など宣言外の変更は `UnexpectedChange` になる。

**structure-level**（`verify_bank_structure`）: POST を read model で再読込し、PRE と比べる。

- 操作対象外の Bank は、全 role で PRE と完全一致
- 操作対象の Bank でも `affected_roles` に含まれない role は不変
- `project.work` の project state は不変（`[STATES] BANK` の扱いが決まるまで変えてはならない）
- Copy: 複製先の内容が複製元の PRE と一致し、複製元は不変
- Swap: 両方向で一致
- Move: 複製先が複製元の PRE と一致。**移動元に何を残すかは未決**なので、常に `MoveVacatedSourceUndefined` で失敗する
- 比較は Pattern、Part、Track、Sample Slot 参照、parse status、unmodeled 一覧で行う。ファイル名と Bank index は比較しない。比較する Bank は両側とも `Parsed` でなければならない

| ルール | テスト |
| --- | --- |
| BMS-VERIFY-BYTES | `expected_change_verification_rejects_unplanned_and_wrong_results`、`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy` |
| BMS-VERIFY-STRUCTURE | `copy_structure_check_compares_content_not_file_names`、`swap_structure_check_requires_both_directions`、`move_structure_check_stays_closed_until_the_vacated_state_is_decided`、`structure_check_rejects_unparsed_banks_and_project_state_drift` |

`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy` の POST はテスト自身が TempDir 内で作ったものである。検査器の動作を示すだけで、Bank Copy の正しい実装方法を示すものではない。

## 11. Recovery（BMS-RECOVER）

Recovery の成功条件は、project scope 全体の manifest が Plan 時点の `scope_manifest` と一致することである（`verify_recovered_to_pre`）。変更したファイルだけを戻しても、他の entry が変わっていれば失敗とする。成功で RolledBack、失敗で RecoveryRequired。

テスト: `recovery_must_restore_the_whole_scope_to_pre`、`verifiers_check_a_simulated_post_state_and_rollback_on_a_copy`。

## 12. UI と filesystem（BMS-UI）

- frontend は filesystem へ直接書かない。`fs` / `shell` plugin とその capability を持たない
- Bank 操作の v2 command は存在しない。Project Structure の command は `v2_project_structure_read` だけ
- legacy の Bank / Part / Pattern / Track / Slot 系 write command は DISABLED のまま
- 将来の Bank command も `RootId` と root 相対 path だけを受け、raw absolute path を返さない。command の追加は `scripts/check-architecture.mjs` の command 一覧の更新を伴う

テスト: `frontend_has_no_direct_filesystem_write_capability`、`no_bank_mutation_command_is_exposed_to_the_frontend`。既存の `check-architecture.mjs` も v2 command 一覧を固定している。

## 13. Sample Slot 境界（BMS-SAMPLE）

Bank 側が持つのは Sample Slot 参照（`TrackSlotReference`）だけである。Bank mutation は AudioAsset、FileInstance、lineage、catalog、slice、`.ot` を変更しない。expected change set に sample ファイルを入れる設計は、この契約の範囲外であり、Sample management 側との合意（#187）なしに追加しない。Project 内の sample ファイルが変われば byte-level verify が `UnexpectedChange` として失敗させる。

## 14. #191 への gate 提案（workflow は変更しない）

この PR は workflow ファイルを変更しない。既存の `Project Structure CI` が inventory runner 経由で次を required test として実行する。

| suite | package | 内容 |
| --- | --- | --- |
| `ot-plan-bank-mutation-contract` | `ot-plan` | 契約の純粋検査 22 件 |
| `masterocta-bank-mutation-contract` | `masterocta --features test-seams` | 実 reader + TempDir PRE/POST 5 件、UI 境界 2 件 |

#191 で配線してほしい gate（提案）:

1. `Bank Mutation Safety` は #183 の Apply 実装が入るまで **BLOCKED** のまま。空テストや `continue-on-error` で PASS にしない（CI foundation §4）
2. #183 では、Apply の各テストが `evaluate_apply_entry` の permit を経由していること、POST に `verify_expected_changes` と `verify_bank_structure` を適用していることを inventory の required test で固定する
3. failure injection（#185）では、各 phase での失敗後に `BankMutationPhase::on_failure` の義務どおりになったことを `prove_no_write` または `verify_recovered_to_pre` で示す
4. `current_main_readiness_keeps_every_gap_open` の変更を含む PR は、追跡先の証拠リンクがあるかを review gate で確認する
5. scope: `src-tauri/crates/ot-plan/src/bank_mutation.rs`、`src-tauri/src/bank_mutation_contract.rs` は `pse-ci-scope.mjs` の in-scope に追加済み

## 15. 残作業

| Issue | この契約のあとに必要なこと |
| --- | --- |
| #181 | Copy / Move / Swap の ChangePlan が `BankMutationEnvelope` を出す。§1 の §7C 系 gap（#204 ほか）が先 |
| #183 | Prepare（staged bytes）、Apply、Verify を fixture / temporary copy 上で実装する。Apply 入口は `ApplyEntryPermit` を取る。production 用の contained manifest capture（symlink 非追従、root 内）を実装する。target class を backend 証拠から決める |
| #184 | 正常系・境界・失敗系の reference integrity。Arranger / arrangement 参照が読めるようになったら structure verify に加える |
| #185 | Bank 用 backup manifest、journal、resume / rollback、`mutation_gate` への Bank journal 追加、failure injection、retry / idempotency |
| #186 | Native 受入。実機 CF 原本は別承認まで対象外 |
| #191 | §14 の gate 配線と required-check 候補の整理 |

## 16. Owner への未決事項

1. **Move の移動元**: Move 後の移動元 Bank は何になるべきか（空 Bank テンプレート、ファイル不在、別の初期状態）。決まるまで Move の structure verify は常に失敗する
2. **Working / SavedCheckpoint**: Bank 操作は `.work` と `.strd` を両方動かすのか、Working だけか。片方だけだと装置の SAVE / RELOAD と食い違う（control plane §12）
3. **`[STATES] BANK`**: active Bank が操作対象のとき、`project.work` の選択を追従させるか。現契約では project state の変更を一切認めない
4. **Scene / Recorder**: Bank ファイルを丸ごと動かすなら Part 内の Scene も一緒に動く、という扱いで unmodeled gap を閉じてよいか。それとも Scene の read model を先に要求するか
5. **Backup の範囲**: 変更ファイルだけで足りるか、project directory 全体を snapshot するか
6. **readiness の粒度**: 監査 §11 のとおり 3 操作まとめての解禁を前提にしている。Copy だけ先に fixture Apply する選択肢を残すか
7. **Project Snapshot（control plane §7）**: 構造編集の Undo を、この契約の backup / recovery とどう関係づけるか

## 判定

```text
BANK_MUTATION_CONTRACT   = DEFINED (masterocta.bank-mutation-contract:v1)
CONTRACT_TESTS           = IN_INVENTORY (Project Structure CI)
BANK_CHANGEPLAN_READINESS = NOT_READY (#181, #204, §7C)
APPLY_READINESS          = NOT_READY
APPLY_AUTHORIZATION      = NOT_GRANTED (PSE-3)
```
