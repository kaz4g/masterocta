# Sample Slot ↔ AudioAsset 所有境界

- Work ID: `MO-INTEGRATION-SLOT-ASSET-BOUNDARY-1`
- Issue: #187（関連: #181 Bank ChangePlan、#184 Bank Reference Integrity）
- Status: **ACCEPTED**（境界はプロジェクトリード承認済み。この文書と回帰テストで固定する）
- Updated: 2026-10-04
- Canonical milestone numbers: [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md)（この文書は M5–M11 を増やさない）
- Project 側の設計: [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md)、[`PSE_READ_MODEL_EXIT_AUDIT.md`](./PSE_READ_MODEL_EXIT_AUDIT.md)
- Sample 側の設計: [`M7_DERIVED_AUDIOASSET.md`](./M7_DERIVED_AUDIOASSET.md)、[`M7_AUTO_SLICE_DERIVED_EXPORT.md`](./M7_AUTO_SLICE_DERIVED_EXPORT.md)
- Write boundary: [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md)
- 回帰テスト: `src-tauri/src/sample_slot_boundary.rs`、`src/features/project-structure/sampleSlotBoundary.test.ts`

## 1. 目的

Project Structure / Bank Editor ライン（以下 Project 側）と Sample Management ライン（以下 Sample 側）は、別 worktree で並行して進む。両者の接点は Sample Slot Reference だけである。

この文書は、その接点の所有者、中身、解決方法、書き込み権限、不変条件を固定する。両ラインが同じ概念を別々に実装せず、main へ安全に統合できることが目的である。

この文書は製品挙動を変えない。新しい書き込みも承認しない。

## 2. 所有境界

| 側 | 所有するもの | 現行コード上の実体 |
| --- | --- | --- |
| Project 側 | Project | `LibraryProject`、`ot_domain::project_structure::ProjectStructure`、`ProjectStateDocument` |
| Project 側 | Bank | `BankStructure`（Working `.work` と SavedCheckpoint `.strd` は別エントリ） |
| Project 側 | Pattern | `PatternStructure`（Part を index で参照する） |
| Project 側 | Part | `PartStructure` |
| Project 側 | Track | `TrackStructure`、`TrackPlayback`、`MachineKind` |
| Project 側 | Sample Slot Reference | `TrackSlotReference::Slot(SampleSlotId)`、`project.work` の `[SAMPLE] TYPE/SLOT/PATH`、slot-local の `SampleSettings`（owner `SlotAssignment`） |
| Sample 側 | Library | catalog の root / scan / file inventory（`LibrarySnapshot` の Sample 部分） |
| Sample 側 | AudioAsset | `AudioAsset`（identity は `ContentHash`） |
| Sample 側 | FileInstance | `FileInstance`（identity は root + `RootRelativePath`） |
| Sample 側 | Waveform | `ot-audio` の WF2 query / WFM2 cache（Mac 側 app data） |
| Sample 側 | Slice | `SliceDraft`（catalog `slice_drafts`）、`.ot` sidecar の `SampleSettings`（owner `FileInstanceSidecar`） |
| Sample 側 | Derived AudioAsset | `asset_derivations`、`mac_derived` storage scope、derived-audio publisher |
| Sample 側 | lineage と hash | `DerivationEdge`、`AssetDerivation`、`content_hash` / `source_hash_evidence` |

### 2.1 どちらにも属さない共有語彙

次は `ot-domain` の共有型である。どちらのラインも再定義しない。

| 型 / 関数 | 役割 |
| --- | --- |
| `RootId`、`RootRelativePath`、`RootRegistry` | 承認済み root と root 相対パス |
| `SampleSlotId`、`SampleSlotKind` | Slot の識別子（Static / Flex、1–128） |
| `SampleReferenceStatus` | 解決結果（`Resolved` / `Missing` / `InvalidPath` / `Ambiguous` / `UnassignedSlot`） |
| `reference_identity::resolve_against_inventory` | `PATH=` 文字列を root 相対パスと解決結果に変える純粋関数 |
| `StateDocumentRole`、`StateDocumentParseStatus` | Working / SavedCheckpoint と parse 状態 |

### 2.2 catalog 上の投影

catalog（Mac 側 SQLite）は両側の観測を一つの DB に持つ。所有はテーブル単位で分ける。

| テーブル | 意味の所有者 | 書くもの |
| --- | --- | --- |
| `state_documents`、`slot_assignments`、`usage_edges` | Project 側 | library scan の観測投影だけ。操作の書き込み先にしない |
| `audio_assets`、`file_instances` | Sample 側 | library scan と derived 登録 |
| `asset_derivations` | Sample 側 | derived 登録（追記のみ。scan や Project 操作は書き換えない） |
| `slice_drafts`、sidecar `sample_settings` | Sample 側 | Slice workbench と scan |

`slot_assignments` は `file_instances` への外部キーを持たない。持つのは `referenced_relative_path` と `reference_status` だけである（migration `0003`）。この形を変えない。

## 3. Sample Slot Reference の中身と解決

### 3.1 中身

Sample Slot Reference が持つのは次だけである。

- Project 文書（`project.work` / `project.strd`）の root 相対パス
- Slot の種別と番号（`SampleSlotId`）
- Track からの参照座標（Bank 文書、Part、Track。sample lock は Pattern と Step）
- `[SAMPLE]` ブロックの生の `PATH=` 文字列

持たないもの:

- AudioAsset の content hash や opaque asset ID
- FileInstance ID
- 絶対パス
- lineage、waveform、slice

Flex 129–136 は Recorder buffer である。Slot ではない。AudioAsset へ解決しない（`TrackSlotReference::RecorderBuffer`、`UnmodeledDependency::RecorderSetup`）。

### 3.2 解決の連鎖

```text
Track (Bank 文書, Part, Track, Static/Flex machine)
  → TrackSlotReference::Slot(SampleSlotId)                 [Project 側]
  → project.work [SAMPLE] TYPE / SLOT / PATH=(raw)          [Project 側データ]
  → resolve_against_inventory(Project dir, raw PATH)       [共有関数]
      → (RootRelativePath, SampleReferenceStatus)
  → FileInstance (root, relative_path)                      [Sample 側]
  → AudioAsset (content_hash)                               [Sample 側]
  → lineage (asset_derivations: output → source)            [Sample 側]
```

規則:

1. 解決は観測時点のパスで行う。join key は (root, root 相対パス) である。
2. Slot の identity は Slot 番号である。AudioAsset でも FileInstance でもない。
3. 同じ内容の二つのファイルは、別々の FileInstance と一つの AudioAsset になる。Slot は自分の `PATH=` が指す FileInstance に着地する。
4. 解決は Sample 側の投影であり、Project 側の構造モデルに書き戻さない。
5. Slot 番号を別 Project へ写しても同じ AudioAsset に着地するとは限らない。Project 間の再割当は PSE-6 まで扱わない（control plane §9）。
6. Slot 参照の正本は Project 構造モデルである。catalog の `usage_edges` は使用箇所の投影であり、範囲が狭い。Pattern で鳴らない Static machine が既定の Slot（Slot 番号 = Track 番号）を指している場合、`usage_edges` には出ない（`project_reader::compute_sample_usage_for_documents`）。影響範囲を数える計画は構造モデルから数える。

### 3.3 欠落と変更の検出

| 状況 | 検出する側 | 結果 |
| --- | --- | --- |
| `PATH=` が空 | Sample 側の投影 | `UnassignedSlot` |
| `PATH=` が root の外、絶対パス、NUL | 共有関数 | `InvalidPath` |
| 解決先にファイルが無い | Sample 側の投影（rescan） | `Missing`。参照パスは残す |
| 大文字小文字違いの候補が複数 | 共有関数 | `Ambiguous` |
| 同じパスの内容が変わった | Sample 側の投影（rescan） | 同じパスのまま新しい content hash = 別 AudioAsset。旧 AudioAsset の lineage は書き換えない |
| derived 作成時に元ファイルが catalog の hash と違う | Sample 側の Apply | `SOURCE_CHANGED` で失敗。書き込みなし |

変更の判定は content hash で行う。mtime とサイズは scan の再利用判断にだけ使い、正しさの根拠にしない。

Project 側の構造モデル（Bank / Pattern / Part / Track / Slot 参照）は、欠落や変更があっても変わらない。

## 4. 書き込み権限

| データ | Project 側 | Sample 側 | M5 rename（Gate C） |
| --- | --- | --- | --- |
| `bankNN.work` / `bankNN.strd` | 将来（PSE-3 Apply。**未承認**） | 書かない | 書かない |
| `project.work` の `[SAMPLE] PATH=` | 将来（PSE-6 の再割当。**未承認**） | 書かない | 対象 Slot の `PATH=` 値だけ（M5-B） |
| `project.work` のその他（slot-local 設定、`[STATES]`） | 将来（**未承認**） | 書かない | 書かない |
| 媒体上の音声ファイル本体 | 書かない | 書かない。derived 出力は Mac 側 derived root にだけ置く | パスだけ動かす。バイトは変えない |
| `audio_assets` / `file_instances` | 書かない（scan の投影は除く） | scan と derived 登録 | rescan で反映 |
| `asset_derivations`（lineage） | 書かない | derived 登録だけ（追記） | 書かない |
| `slice_drafts`、waveform cache | 書かない | 書く | 書かない |
| `state_documents` / `slot_assignments` / `usage_edges` | scan の投影だけ | scan の投影だけ | rescan で反映 |

現行 `main` の状態:

- Project 側に書き込み経路は無い（`v2_project_structure_read` と Viewer だけ）。
- Sample 側の書き込みは、derived export（Mac 側 app data）、catalog の lineage 登録、slice draft、WFM2 cache である。
- Project データへ書く既存経路は M5 rename だけである。Gate C、backup、journal、recovery の内側にあり、対象 Slot の `PATH=` 値以外を変えない。

## 5. 不変条件

| ID | 不変条件 | 固定するテスト | 状態 |
| --- | --- | --- | --- |
| I-1 | Project 側のモデルと DTO は Slot の identity だけを持つ。hash、asset ID、FileInstance ID、絶対パスを持たない | `project_structure_dto_exposes_slot_identity_only`、frontend `sampleSlotBoundary.test.ts` | TESTED |
| I-2 | `Resolved` の Slot 参照は、ちょうど一つの FileInstance と一つの AudioAsset に解決する。`[SAMPLE]` ブロックが無い Slot は `UnassignedSlot` のまま。`usage_edges` が省くのは §3.2 規則 6 の既定 Static Slot だけ | `slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset` | TESTED |
| I-3 | 同一内容は一つの AudioAsset を共有し、各 Slot は自分の FileInstance に着地する | `duplicate_content_shares_one_asset_while_each_slot_keeps_its_file_instance` | TESTED |
| I-4 | 参照先の欠落は Sample 側の投影だけが `Missing` として出す。Project 構造と Project 文書のバイトは変わらない | `missing_referenced_file_is_reported_by_the_sample_projection_only` | TESTED |
| I-5 | 同じパスの内容変更は新しい AudioAsset になる。記録済み lineage と Project 構造は変わらない | `changed_referenced_file_rebinds_the_slot_to_a_new_asset_and_keeps_recorded_lineage`、既存 `slice_export_ipc_rejects_source_changed` | TESTED |
| I-6 | Sample 側の操作は Project / Bank / Slot データを変えない | `slice_export_leaves_project_bank_and_slot_projection_unchanged` | TESTED（slice export。TRIM は同じ publisher） |
| I-7 | Project 側の操作は AudioAsset 本体、lineage、hash を変えない | `project_structure_read_leaves_assets_hashes_and_lineage_unchanged` | TESTED（現行の read 面）。ChangePlan / Apply は PENDING（P-1） |
| I-8 | パスの付け替え（M5 rename の出力）は Slot の identity、Bank 側の参照、AudioAsset の identity を保つ | `path_rebinding_keeps_slot_identity_bank_references_and_asset_identity`、既存 `ot-codec` `real_device_rewrite_changes_only_target_path_value_bytes` | TESTED |
| I-9 | ドメインモデルを重複させない。Project 側ソースは Sample 側の型を名指ししない。逆も同じ | `project_line_sources_do_not_name_sample_line_entities`、`sample_line_sources_do_not_name_project_structure_entities` | TESTED（ソース文字列ガード。P-8） |

## 6. 最小インターフェース

両ラインのドメイン同士の呼び出しはゼロにする。接点は次だけである。

| 方向 | 許すもの | 許さないもの |
| --- | --- | --- |
| Project → Sample | catalog の `usage_edges` 投影を読み取り専用で受け取り、Viewer の欠落表示に使う（型だけの import） | AudioAsset / FileInstance / lineage / Slice / Waveform の型や API の呼び出し |
| Sample → Project | catalog の `usage_edges` 投影を使用箇所表示に使う | `ProjectStructure` 系の型、Bank reader、Project reference codec の呼び出し |
| 共有 | §2.1 の共有語彙 | どちらかのラインによる共有語彙の再定義 |

新しいインターフェースが要るときは、この文書を先に更新する。

## 7. #181 / #184 への引き継ぎ

### #181 Bank Copy / Move / Swap ChangePlan

- 影響 Slot 参照は (Project 文書, `SampleSlotId`, 参照座標) で列挙する。数える元は Project 構造モデルである。`usage_edges` だけから数えると既定 Static Slot を落とす（§3.2 規則 6）。
- 観測した解決結果（root 相対パス、`SampleReferenceStatus`、content hash）は precondition の証拠として計画に記録する。計画はそれを書き換え対象にしない。
- 計画の変更対象に `audio_assets`、`file_instances`、`asset_derivations`、媒体上の音声バイトを入れない。入っていたら計画を失敗として閉じる。
- `Missing` / `InvalidPath` / `Ambiguous` は Broken refs として数える（control plane §6）。
- 同一 Project 内の Bank 操作で Slot 番号は変わらない。Project をまたぐ移植は PSE-6 であり、#181 の範囲外である。

### #184 Bank Reference Integrity Tests

`sample_slot_boundary.rs` の fixture（一時 root に fixture をコピーし、合成 WAV を置き、登録と索引を行う）を再利用する。Bank 操作の後状態では少なくとも次を確認する。

- 音声ファイルの tree digest が操作前と同じ
- `audio_assets` の hash 一覧と `asset_derivations` が操作前と同じ
- 操作前に `Resolved` だった Slot 参照が、同じ content hash に `Resolved` のまま
- Slot 投影の差分が計画に書いた変更だけ

## 8. Pending（まだテストできない、または未実装）

| ID | 内容 | 止まる理由 |
| --- | --- | --- |
| P-1 | Bank ChangePlan / Apply が Sample 側データに触れないこと | #181 / #183 のコードが無い |
| P-2 | Bank 変更後の参照整合 | #184。Apply が無い |
| P-3 | Project 間の Slot 再割当（AudioAsset 経由） | PSE-6 |
| P-4 | WFM2 cache が Project 側の操作で無効化されないこと | Project 側に書き込みが無い。現状はソースガードだけ |
| P-5 | `.ot` sidecar slice（`FileInstanceSidecar`）と slot-local 設定（`SlotAssignment`）の書き込み分担 | どちらにも writer が無い（Auto Slice `.ot` Apply は NOT_STARTED） |
| P-6 | Recorder buffer の扱い | `RecorderSetup` は未モデル |
| P-7 | SavedCheckpoint（`project.strd`）側の Slot 解決を計画でどう扱うか | Working / SavedCheckpoint の操作規則が未決（PSE 監査 §7C） |
| P-8 | I-9 を crate 依存で強制すること | 現状はソース文字列ガード。Project Structure を独立 crate に分ける等は製品コード変更なので、この PR では提案だけ |
| P-9 | catalog の Project 側投影テーブルと Sample 側テーブルが同じ crate にあること | 所有はテーブル単位の意味だけで分けている。分割は将来の判断 |

## 9. 回帰テスト一覧

Rust（`masterocta --features test-seams`、filter `sample_slot_boundary::`）。PSE CI の required-test inventory（[`scripts/pse-read-model-inventory.json`](../../scripts/pse-read-model-inventory.json)）に載せている。

| テスト | 保証すること |
| --- | --- |
| `slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset` | Project 構造の Slot 参照 → catalog の Slot 投影 → FileInstance → AudioAsset が一意に決まる。usage edge があれば状態が一致し、無いのは既定 Static Slot だけ |
| `duplicate_content_shares_one_asset_while_each_slot_keeps_its_file_instance` | 同一内容で AudioAsset は一つ、Slot の着地先は各自のパス |
| `missing_referenced_file_is_reported_by_the_sample_projection_only` | 欠落は `Missing` で出て、Project 構造と Project 文書は不変 |
| `changed_referenced_file_rebinds_the_slot_to_a_new_asset_and_keeps_recorded_lineage` | 内容変更で新 AudioAsset。lineage と Project 構造は不変 |
| `slice_export_leaves_project_bank_and_slot_projection_unchanged` | Sample 側の書き込み（slice export）後も root 全体のバイト、Project 構造、Slot 投影が不変。Slot は元の AudioAsset を指したまま |
| `project_structure_read_leaves_assets_hashes_and_lineage_unchanged` | Project 側の読取が音声バイト、AudioAsset hash、lineage、catalog snapshot を変えない |
| `path_rebinding_keeps_slot_identity_bank_references_and_asset_identity` | 同一ディレクトリ rename 後も Slot 集合、Bank バイト、Project 構造、AudioAsset が同じ |
| `project_structure_dto_exposes_slot_identity_only` | DTO の Slot は `kind` / `slotKind` / `number` だけ。Sample 側キーと絶対パスが無い |
| `project_line_sources_do_not_name_sample_line_entities` | Project 側ソースが AudioAsset、FileInstance、lineage、Slice、Waveform、catalog を名指ししない |
| `sample_line_sources_do_not_name_project_structure_entities` | Sample 側ソースが Project 構造、Bank reader、Project reference codec を名指ししない |

Frontend（`pnpm run test:frontend`）:

| テスト | 保証すること |
| --- | --- |
| `sampleSlotBoundary.test.ts` | `SlotReference` の slot 変種は slot identity だけ（型検査）。Viewer と Project Structure API は Sample 側モジュールを型としてだけ import し、IPC を直接呼ばない |

fixture の安全:

- 追跡済み fixture（`src-tauri/tests/fixtures/real_device`）は一時ディレクトリへコピーしてから使う。原本は読むだけで書かない。
- 音声はテストが一時ディレクトリに書く合成 WAV だけである。実機媒体と元の音声ファイルは使わない。
- catalog と derived 出力はテストごとの一時 data ディレクトリに置く。

## 10. この文書が変えないもの

- 製品コード、DTO、catalog schema、IPC コマンド
- M5 は COMPLETE。Gate C は personal / local の PASS。RC8 は再ビルド・再投入しない
- `BANK_CHANGEPLAN_READINESS = NOT_READY`、`APPLY_READINESS = NOT_READY`（PSE 監査）
- 公開配布、署名、notarization は NOT AUTHORIZED
- M7 の完了条件と #103–#105 の再開禁止
