# M6 Final Exit Audit

- Work ID: `MO-M6-FINAL-EXIT-AUDIT-1`
- Date: 2026-10-19
- Kind: **docs-only**（製品 / Rust / frontend / catalog / CI の変更なし）
- Issue: [#178](https://github.com/kaz4g/masterocta/issues/178) `[M6] Final Exit Audit and remaining UI closure`
- Audit baseline: GitHub `origin/main` **`6f68ff127e25b8282c00ef77b783ddd149796673`**（merge PR #236）
- Native workspace harness（歴史記録）: [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) @ `0f39f5056c25e996f1e3ff69b7a51ca20b0c45bb`（PR #142）

本文書は baseline **`6f68ff1` に対する M6 完了判定の記録**である。Gate C / RC7 / RC8、M7 Exit Audit、Bank Editor（Project Structure / ChangePlan / Apply）は再評価しない。

その後の `main` は §9 の判定表を書き換えない。#239 で pane split の localStorage 復元、#240 で Library キーボード最小セット（Up/Down、Space、Ctrl/Cmd+F）、#241 で Drawer 受入と close-without-cancel が入った。2026-10-19 時点の残件は Native write smoke と configurable Copy/Rename だった。2026-10-26 の clean `main` 再受入は §10、診断は §11。2026-10-27 の複合受入判定は §12。現行の M6 行は [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) を見る。§9 の判定表は変えない。

**M6-06 決定: DECIDED (C)** — 2026-10-19、ユーザー。Operations Drawer が唯一の操作 overlay。中央 Modal は作らない。operator パネルは Drawer 内に残す。configurable shortcut は M6-06 から外し **M6-08** へ移す。`MO-M6-06-OPERATION-MODAL-1` は **不採用**。

判定語彙は [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) に合わせ、WP は **責務**で見る（v0.1 のウィジェット名そのものではない）。Exit Gate 原文は v0.1 §17 をそのまま使う。

---

## 1. Audit identity

```text
origin/main:     6f68ff127e25b8282c00ef77b783ddd149796673
merge at HEAD:   PR #236 (PSE bank copy state-doc device evidence)
open issue:      #178 OPEN（本監査は docs のみ。Issue は作成・close しない）
```

#178 の Done:

- M6 Exit Gate 各項目に PASS / PARTIAL / STOP と根拠
- 残件があれば最小 follow-up 作業単位へ分解（GitHub Issue は作らない）
- M6 COMPLETE 可否

本監査の結論: **M6 は COMPLETE にできない。** Exit Gate 6 項目は責務判定でおおむね満たす。M6-06 の overlay 形状は (C) で確定したが、Native write smoke と close 契約が残る。**M6-08** は pane persistence、Library キーボード、および M6-06 から移した configurable shortcut が未完。

**範囲外（本線では監査しない）:**

- Bank Editor / Project Structure Control Plane の Viewer 以降、ChangePlan、Apply
- M7 Waveform v2（M7 は [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) で **COMPLETE**）
- 公開配布 / 署名 / notarization
- 未修正脆弱性の詳細、ユーザーローカル path、実音源

Canonical sources:

| Role | Path |
| --- | --- |
| Milestone 番号 / WP 名 | [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md) |
| 実装ステータス語彙 | [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) |
| Exit Gate **原文** | [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md) §5 / §17 / §18 |
| UI Native | [`../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) |
| Operations Drawer | [`../testing/MO_UI_OPERATIONS_DRAWER_1_PR.md`](../testing/MO_UI_OPERATIONS_DRAWER_1_PR.md) |

**STOP check:** v0.1 M6 Work Packages は `MILESTONE_INDEX` の M6-01–08 と一致する。競合する WP 一覧はない。続行。

---

## 2. Canonical M6 scope

v0.1 §17 / `MILESTONE_INDEX`（WP を足さない）:

| WP | Name |
| --- | --- |
| M6-01 | AppShell |
| M6-02 | Top Context Bar |
| M6-03 | Navigation Pane |
| M6-04 | Sample Browser v2 |
| M6-05 | Sample Inspector v2 |
| M6-06 | Operation Modal（歴史名。**DECIDED (C):** 実装面は Operations Drawer） |
| M6-07 | AudioAsset domain baseline |
| M6-08 | keyboard / resize / persisted UI state（**含む:** v0.1 §5.9 Copy/Rename configurable。M6-06 から移管） |

**Exit Gate（v0.1 §17 原文）:**

1. Source管理がtop context / dialogへ整理されている
2. Browserが主要面積を占める
3. waveformがInspectorで十分なサイズを持つ
4. Prepared Operation常設panelが消えている
5. file write safetyが維持されている
6. AudioAssetが既存Octatrack sampleを表現できる

**WP Acceptance（v0.1 §18 原文）:**

| ID | Acceptance |
| --- | --- |
| M6-01 | 既存機能を壊さず新layoutが成立 |
| M6-02 | Source panelなしで現在Contextが判別可能 |
| M6-03 | browse操作が左paneだけで完結 |
| M6-04 | sample探索が画面主目的として成立 |
| M6-05 | waveformが実用サイズで表示 |
| M6-06 | copy / rename / plan review。bottom drawer不要、safety維持。**(C) 改正:** overlay は Operations Drawer（`role=dialog`）。中央 Modal は要求しない。configurable shortcut は対象外（M6-08） |
| M6-07 | 現行sampleをmigrationなしでもread可能 |
| M6-08 | 再起動後に主要UI state復元。keyboard 最小セット + **Copy/Rename configurable** |

v0.1 §5.8 は操作 UI を **Operation Dialog**（COPY/RENAME → Review Plan → Apply → Verify）と書く。§5.9 はキーボード候補（Up/Down、Space、Cmd+K、Enter、Esc、Copy/Rename configurable）。§5.2 推奨比率は Navigation **18 : 52 : 30**。

本監査は Exit Gate と WP を分けて判定する。Exit Gate は「常設 prepared panel をやめ、Browser / Inspector を主役にし、M5 安全境界を迂回しない」ことであり、中央 Modal ウィジェットそのものは Exit Gate 原文に無い。**(C) により WP 名「Operation Modal」は歴史名として残し、受入面は Operations Drawer とする。**

---

## 3. PR / evidence inventory

`main` 祖先の merge SHA（番号だけを信じない）:

| PR | Merge SHA | 範囲 |
| --- | --- | --- |
| [#13](https://github.com/kaz4g/masterocta/pull/13) | `58c215ca3ff1d72644c70cb829daf6f8a0b7dbaf` | M3-C1 `AudioAsset` / `FileInstance` inventory |
| [#122](https://github.com/kaz4g/masterocta/pull/122) | `bed38a46f1c8e644b4bfaae2d1aaac1a3f290eb6` | M6 Library layout / context / paging |
| [#132](https://github.com/kaz4g/masterocta/pull/132) | `bb9b81484eebd941f8b477fdd23c9824101bce6e` | 5-region workspace foundation |
| [#133](https://github.com/kaz4g/masterocta/pull/133) | `3af9e324a5d08c99931e4761fe2506251987ddbe` | Tabbed inspector migration |
| [#134](https://github.com/kaz4g/masterocta/pull/134) | `a3dafcc0beca1b6e9a304f86b355a982d03621cf` | Operations **Drawer**（M6-06 partial） |
| [#135](https://github.com/kaz4g/masterocta/pull/135) | `22344fb386b1f5e17ee7fea524130eb101fd53ab` | Slice workspace |
| [#138](https://github.com/kaz4g/masterocta/pull/138) | `c2bf80c77bb7658ef2687032bf3d363f3788f79e` | Inspector layout stability |
| [#139](https://github.com/kaz4g/masterocta/pull/139) | `2fee043dbcaa65177cc561c1f49b88917a820d75` | Narrow workspace |
| [#140](https://github.com/kaz4g/masterocta/pull/140) | `14b37f506d0538f7eedd3d1dd5ff4091d914cb9a` | Narrow verify |
| [#142](https://github.com/kaz4g/masterocta/pull/142) | `0f39f5056c25e996f1e3ff69b7a51ca20b0c45bb` | Native acceptance 記録の実行 SHA |

Native write（Operations Drawer）は harness 文書上 **NOT_RUN**。本監査は製品テストを再実行していない（docs-only）。根拠は現行 tree のファイル / 既存テスト名 / merge SHA / 既存 Native 記録である。

---

## 4. Work package verdicts

### 4.1 M6-01 AppShell — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| 実装 | `src/app/AppShell.tsx` `AppShellProps` L8–41、`AppShell` L48–193。`contextBar` / Sources / Main / Inspector / `statusBar` / 任意 `changeDrawer`。既定 `defaultSourcesSize = 16`（L56）、`defaultMainSize = 62`（L59） |
| 配線 | `src/features/roots/RootRegistryPanel.tsx` `workspaceShell` L755–892。`className="mo-app-shell--workspace"`（L757） |
| テスト | `src/app/AppShell.test.tsx`: `renders an optional context bar`、`renders an optional status bar`、`hides the sources column in wide layout when navigation is closed` |
| E2E | `e2e/workspace-layout.spec.ts` `wide layout keeps list and inspector visible together at 1280px` |
| Native | `MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md` Location → list → Inspector **PASS** @ `0f39f50` |
| PR | #122 `bed38a46…`、#132 `bb9b8148…` |

既存機能を壊さない layout-only 移行として成立している。`AppShell.changeDrawer` は本番で未接続（§5）。Modal layer は sibling の `OperationsDrawerHost` と狭幅 Sources `Drawer` が担う。

### 4.2 M6-02 Top Context Bar — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| 実装 | `src/features/workspace/WorkspaceTopBar.tsx` `WorkspaceTopBar` L25–149。root `displayName`（L53）、read/write `StatusBadge`（L54–56）、検索（L61–70）、choose root / refresh / close / edit mode（L74–128）、browse trail（L133–147） |
| Source 選択 | `RootRegistryPanel.tsx` `pickRootDirectory`（dialog、ディレクトリ選択） |
| Refresh | `refreshLibrary` L373–383 → `api.listLibrary`（再インデックス IPC ではなく catalog 再取得） |
| テスト | `RootRegistryPanel.test.tsx` `shows catalog refresh status only while the catalog request is in flight` |
| Native | Root register / Scan / SET / Audio Pool **PASS** @ `0f39f50` |
| PR | #122、#132 |

巨大 Source panel なしで現在 Context が判別できる（§18）。v0.1 が列挙する専用 **Scan** ボタンは Top Bar に無い。登録時スキャンと `workspace.refreshCatalog` が責務を満たす。専用 Scan コントロールは非ブロッカー（§8 任意）。

### 4.3 M6-03 Navigation Pane — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| 実装 | `src/features/library/CatalogWorkspaceViews.tsx` `CatalogWorkspaceNav` L16–40。`CatalogLocationNav` `variant="tree"` |
| Tree | `src/features/library/CatalogLocationNav.tsx` L24–（source + nested locations） |
| テスト | `src/features/roots/RootRegistryPanel.workspace.test.tsx` `updates the center list when a catalog location is selected in the left nav` |
| E2E | `e2e/workspace-layout.spec.ts` `connects catalog nav to sample list and inspector at 1280px` |
| PR | #132 `bb9b8148…` |

Acceptance「browse が左 pane で完結」は満たす。v0.1 §5.5 図の **FAVORITES / RECENT** は `src/` に実装が無い。Exit Gate 原文にも WP §18 にも必須として書かれていない。非ブロッカー（§8 任意）。

### 4.4 M6-04 Sample Browser v2 — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| 実装 | `CatalogWorkspaceMain` `CatalogFileList`（`CatalogWorkspaceViews.tsx` L61–74）。表列 Name / Size / Format（`CatalogFileList.tsx` L114–123）。`CATALOG_PAGE_SIZE = 100`（`catalogFileQuery.ts` L5）。sort `name \| size`（L3） |
| 選択 | `CatalogFileList.tsx` L127–141 `aria-selected`、click、Enter/Space |
| レイアウト | `AppShell` 既定: nav 16%、inner main 62% → Browser 実効 ≈52%。`minPrimary={55}` |
| テスト | `CatalogFileList.test.tsx` `renders name, size, and format columns`、`calls onSelectFile when a row is clicked`、`marks the selected row with aria-selected` |
| E2E | `workspace-layout.spec.ts` 1280px で list heading と inspector 同時可視 |
| PR | #122、#132 |

Browser が画面の主目的として成立。Grid view は v0.1 でも後付け。

### 4.5 M6-05 Sample Inspector v2 — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| 実装 | `src/features/inspector/InspectorTabbedAssetPanel.tsx` L228–269。Tabs Preview / Slice / Info / Usage / Notes。Preview に `WaveformPreview`（L257–268） |
| 配線 | `RootRegistryPanel.tsx` Inspector 列（L848 付近 `InspectorTabbedAssetPanel`） |
| 波形高さ | `src/features/waveform/WaveformPreview.css` `.waveform-preview-plot` **固定 `height: 8.75rem`**（L38–44）。幅は `ResizeObserver`（M7 幅駆動） |
| テスト | `InspectorTabbedAssetPanel.test.tsx`（Preview での waveform query） |
| E2E | `e2e/library-inspector-tabs.spec.ts` |
| Native | Inspector tabs **PASS** @ `0f39f50` |
| PR | #133 `3af9e32…`、#135 `22344fb…`、#138 `c2bf80c…` |

Inspector 列は伸縮し、波形は専用 Preview に載る。固定 8.75rem は品質フォロー（§8 任意）であり、Native が tabs を PASS しているため WP は **PASS**。M7 の高解像度取得は本 WP のブロッカーではない。

### 4.6 M6-06 Operation Modal — **PARTIAL**

詳細比較と選択肢は **§6**。要約:

| 観点 | 判定 | 根拠 |
| --- | --- | --- |
| 常設 bottom prepared panel の撤去 | **PASS** | `RootRegistryPanel` は `AppShell.changeDrawer` を渡さない（L755–892）。本番 slot 未使用（`AppShell.tsx` L188–192）。操作は `operationsOpen` のときだけ `OperationsDrawerHost`（L943–975） |
| copy / rename / plan review | **PASS**（自動） | `OperationsDrawerHost` が `RenameSampleModal`（embedded）+ `RenameOperatorPanel` + `AdditiveCopyChangeDrawer` + `CloneOperatorPanel` を同一 Drawer に載せる（`OperationsDrawerHost.tsx` L113–179） |
| 安全境界の再利用 | **PASS**（自動） | 同一 `v2_*` IPC / `mutation_gate`。E2E `e2e/rename-prepare.spec.ts`、`e2e/rename-operator.spec.ts` |
| v0.1 中央 Operation **Modal** | **N/A（(C) 不採用）** | 実装は右 Drawer（`Drawer.tsx` `role="dialog"` L128、`aria-modal` L129）。standalone Modal 経路は本番未使用。**(C) により中央 Modal は M6-06 受入から外す** |
| Native write smoke | **STOP**（受入・残件） | Native 文書「Operations Drawer / writes **NOT_RUN**」 |
| 設定可能な Copy/Rename shortcut | **M6-08 へ移管** | Library workspace に無し。M6-06 の残件ではない（FU-9） |

Status ラベル（`DEVELOPMENT_STATUS`）**IMPLEMENTED_NOT_FULLY_ACCEPTED** を維持する（Native write / close 契約が残る。overlay 形状は (C) で確定）。コード上の本番マウントは **1 系統**（Drawer host）。「Change Drawer」はパネルコンポーネント名と Gate C オペレータ語彙であり、第二の bottom shell ではない。

### 4.7 M6-07 AudioAsset baseline — **PASS**

| 証拠 | 詳細 |
| --- | --- |
| Domain | `src-tauri/crates/ot-domain/src/lib.rs` `AudioAsset` L454–457、`FileInstance` L572–579 |
| Adapter | `src-tauri/src/legacy_read_adapter.rs` `scan_audio_inventory` / `scan_audio_inventory_with` L202–268。既存 WAV/AIFF を hash し catalog へ。媒体ファイルの書き換えなし |
| テスト | `inventory_separates_content_identity_from_relative_path`（`ot-domain` L812）；`inventory_detects_only_octatrack_candidates_and_is_deterministically_sorted`（`legacy_read_adapter.rs`）；catalog `duplicate_content_round_trips_as_one_asset_and_two_file_instances_after_reopen` |
| PR | #13 `58c215ca…` |

「migration なしで現行 sample を read」は、カード上の WAV を変換せず catalog が `AudioAsset`/`FileInstance` として投影することを指す。catalog SQLite スキーマ移行は別件でテスト済み。

### 4.8 M6-08 keyboard / resize / persisted UI — **PARTIAL**

| 下位項目 | 判定 | 根拠 |
| --- | --- | --- |
| Pane resize（セッション内） | **PASS** | `SplitPane` ドラッグ + フォーカス時 ArrowLeft/Right（`SplitPane.tsx` L186–194）。`RootRegistryPanel` `sourcesSplitPercent` / `mainSplitPercent`（L183–184、L773–776）。テスト `SplitPane.test.tsx` `updates size while dragging the divider`、`AppShell.test.tsx` `resizes Sources width in uncontrolled mode by default`。Narrow #139/#140 |
| 既定比率 vs 18:52:30 | **PARTIAL** | 実効 ≈ **16 : 52 : 32**（nav 16%、inner 62/38）。Browser 52% は一致。非ブロッカー |
| Pane / browse の再起動 persistence | **STOP** | Library workspace に `localStorage` / `sessionStorage` キーなし。split % は React `useState` のみ。`src/features/roots/` に storage 無し |
| Sample Up/Down | **STOP** | `src/features/library` に ArrowUp/Down 無し。行は Enter/Space で選択（`CatalogFileList.tsx` L137–141） |
| Preview Space play/stop | **STOP** | Library Inspector にグローバル Space トグル無し。ボタン操作 |
| Search Cmd+K | **STOP** | `WorkspaceTopBar` 検索（L61–70）にグローバルショートカット無し。レガシー `useSearchShortcut` は **Cmd/Ctrl+F** で Home / `AudioFileTable` / `SampleSlotsTable` 向け。Library Top Bar 未配線 |
| Open folder Enter | **PARTIAL** | 左 nav は `<button>`（ネイティブ Enter）。専用ショートカットは無い |
| Close dialog Esc | **PASS**（Drawer） | `useModalDismiss` `closeOnEscape: true`（`Drawer.tsx` L97）。`Drawer.test.tsx` `calls onClose from Escape and keeps children mounted when closed` |
| Copy/Rename configurable | **STOP**（**(C) により M6-06 から移管**） | 設定 UI なし。v0.1 §5.9 の当該行は M6-08 の残件（FU-9） |
| 再起動後の主要 UI state | **STOP** | 選択・検索・sort・page・split はセッション内のみ（`useCatalogBrowse.ts`）。テーマ / locale の localStorage は M6-08 の Library pane 契約ではない |

#132 / #139 / #140 の resize / narrow は実在する。v0.1 §18「再起動後に主要 UI state 復元」は未達。configurable shortcut は (C) 以降 M6-08 に属する。WP 全体は **PARTIAL**（`DEVELOPMENT_STATUS` の **IN_PROGRESS** と一致）。

---

## 5. Exit Gate matrix

責務判定（ウィジェット名ではない）:

| # | Exit Gate（v0.1） | 判定 | 主証拠 |
| --- | --- | --- | --- |
| 1 | Source管理がtop context / dialogへ整理されている | **PASS** | `WorkspaceTopBar.tsx` L47–149；`pickRootDirectory`；狭幅 Sources `Drawer`（`RootRegistryPanel.tsx` L907–919） |
| 2 | Browserが主要面積を占める | **PASS** | `AppShell` 既定 16 / 62；`e2e/workspace-layout.spec.ts` 1280px 同時表示；`AppShell.css` `.mo-app-shell--workspace` L123–180 |
| 3 | waveformがInspectorで十分なサイズを持つ | **PASS** | Inspector 列 flex（`AppShell.css` L190–208）；`WaveformPreview` in Preview tab；Native tabs PASS。固定 8.75rem は品質メモ |
| 4 | Prepared Operation常設panelが消えている | **PASS** | `changeDrawer` 未接続；`OperationsDrawerHost` オンデマンド（#134 `a3dafcc`） |
| 5 | file write safetyが維持されている | **PASS** | M5 **COMPLETE** / Gate C RC8 PASS（再評価しない）。`mutation_gate`（`src-tauri/src/v2_api.rs` `ensure_cross_domain_mutation_allowed`）。rename E2E。Drawer は UI 再配置のみ（handoff §State contracts）。Native Drawer **書き込み**は NOT_RUN（品質残、安全迂回ではない） |
| 6 | AudioAssetが既存Octatrack sampleを表現できる | **PASS** | §4.7 |

**Exit Gate 集計: 6 / 6 PASS**（責務）。

**マイルストーン COMPLETE にしない理由:** WP **M6-06** の残件は Native write smoke と close-without-cancel 契約（overlay 形状は (C) で確定。中央 Modal は要求しない）。**M6-08** は pane persistence、Library キーボード最小セット、および Copy/Rename configurable が未完。`DEVELOPMENT_STATUS` は WP 完了を milestone 完了の条件にしており、本監査もそれに従う。

---

## 6. M6-06 決定メモ — **DECIDED (C)**（2026-10-19、ユーザー）

### 6.1 現状の図

本番 Library の操作 UI は **1 マウント**:

```text
Inspector SampleOperationsMenu / Top Bar Clone / Status bar
        ↓
OperationsDrawerHost  (Drawer, role=dialog, focus trap, Esc)
        ├── clone  → CloneOperatorPanel
        ├── rename → RenameSampleModal (embedded) + RenameOperatorPanel
        └── copy   → AdditiveCopyChangeDrawer (embeddedInDrawer)
```

`DEVELOPMENT_STATUS` の「3 面共存」は **仕様上の名前**（v0.1 Modal / Drawer chrome / レガシー Change Drawer パネル）であり、3 つの bottom shell が同時に出ているわけではない。Gate C オペレータは同じパネル（Continue / Apply 承認、plan review）を Drawer 内で使う。

v0.1 §5.8 が求める流れとの対応:

| 段 | Drawer 上の実装 | テスト |
| --- | --- | --- |
| 確認 | Copy 承認チェック、Rename「Approve & Prepare」、Apply チェック、Clone disposable ack | `AdditiveCopyChangeDrawer.test.tsx`、`RenameSampleModal.test.tsx`、`RenameOperatorPanel.test.tsx`、`CloneOperatorPanel.test.tsx` |
| 進捗 | Rename prepare `progress` / `aria-live`；各 panel `busy` | `RenameSampleModal.test.tsx` |
| キャンセル | Drawer × と Esc → `closeOperations`（表示のみ。in-flight prepare を IPC cancel しない） | `Drawer.test.tsx` Escape；handoff `MO_UI_OPERATIONS_DRAWER_1_PR.md` State contracts |
| 結果 / エラー | `role="alert"` / status | 各 operator テスト |
| Focus trap | `useDrawerFocusTrap` + `queryTabFocusableElements`（hidden 節を除外） | `Drawer.test.tsx` `focus trap ignores hidden inactive sections`、`focusable.test.ts` |
| キーボード Esc | **PASS** | 同上 |
| Plan review | Copy「Review plan」、Rename「Review Rename」 | `AdditiveCopyChangeDrawer.test.tsx`、`e2e/rename-prepare.spec.ts` |

欠落（(C) 採択後の M6-06 残件）:

- 中央 Modal ではない → **受入対象外**（(C)）
- Copy/Rename ショートカット未設定 → **M6-08**（FU-9）
- embedded rename に Cancel ボタンが無い（`RenameSampleModal.tsx` L475–478）— close は Drawer × / Esc
- close は apply/cancel IPC を呼ばない（契約としてテスト固定が残件）
- Native Tauri での Drawer 書き込み **NOT_RUN**
- Operator パネル本文の i18n は部分的（handoff Remaining。M6 COMPLETE のブロッカーにしない）

### 6.2 選択肢

#### (A) Operations Drawer を M6-06 充足とみなし、仕様 / Acceptance を改正する

Drawer を「操作 overlay（`role=dialog`）」として正本化する。中央 Modal は作らない。Gate C パネルは Drawer の中身として維持。

| | |
| --- | --- |
| 利点 | Exit Gate 4 と 5 に直結。#134 を再利用。Gate C / RC8 オペレータ導線を動かさない。実装量最小 |
| 欠点 | mockup / §5.8 の「Dialog」字義から外れる。残テストは別途必要 |
| 規模 | **S**（docs + 残テスト。製品レイアウト変更なし） |
| リスク | 低。安全境界は触らない |
| 他線への影響 | Bank Editor / ChangePlan / Apply に無し。M7 に無し。Gate C チェックリストの「operator」文言はそのまま使える |

**改正後も残るテスト / 受入（A を採っても CLOSE しないもの）:**

1. Native Tauri 合成 fixture での Operations Drawer **書き込み**最小スモーク（clone verify または rename prepare のどれか 1 本。原本媒体禁止）
2. Drawer close が in-flight prepare を **キャンセルしない**ことの回帰（既存 handoff 契約。フロントテストで固定）
3. Focus trap + Esc は既存テストで足りる。**追加必須ではない**
4. v0.1 §5.9「Copy/Rename configurable」は **M6-08 へ移管済み**（(C)。M6-06 COMPLETE の条件ではない）

#### (B) v0.1 字義の Operation Modal を新規実装する

中央 Modal に COPY/RENAME → Review → Apply → Verify を載せ、Drawer を置き換えるか第二面にする。

| | |
| --- | --- |
| 利点 | mockup / §5.8 に一致。Escape / focus trap を Modal primitive に寄せられる |
| 欠点 | オペレータパネルの再ホスト。Gate C 人間導線と E2E（`getByRole("dialog")` は Drawer でも通るが、レイアウト・フォーカス・busy 契約が変わる）。二重 UI のリスク |
| 規模 | **L** |
| リスク | **高**（安全操作 UX の回帰。RC8 は operator panel 語彙で PASS） |
| 他線への影響 | Gate C harness 文書・rename E2E。Bank Editor には直接影響しないが、将来の Bank Apply UI が「Modal が正」と誤解する余地 |

#### (C) ハイブリッド — **採択（DECIDED）**

**(A) を核にする。** Drawer を M6-06 の唯一の操作 overlay とする。中央 Modal は作らない。`RenameOperatorPanel` / `AdditiveCopyChangeDrawer` / `CloneOperatorPanel` は Drawer コンテンツとして残す（第二 shell にしない）。仕様改正に次を書く:

- 「Operation Modal」WP 名は歴史名。実装は **Operations Drawer（dialog セマンティクス）**
- 常設 bottom Change Drawer は禁止（現行どおり）
- Gate C は同一パネルを Drawer 内で使う
- (A) の残テスト 1–2 を M6-06 受入の残件とする
- configurable shortcut と pane persistence は **M6-08** に置く（M6-06 と混ぜない）

| | |
| --- | --- |
| 利点 | (A) の低リスク + 3 面叙事の解消。M6-06 と M6-08 の境界が明確 |
| 欠点 | 中央 Modal を望む場合は満たさない |
| 規模 | **S**（docs）+ 残テストは **S–M**（Native smoke が M） |
| リスク | 低 |
| 他線への影響 | (A) に同じ |

### 6.3 決定 — **DECIDED (C)**（2026-10-19、ユーザー）

ユーザーが **(C)** を採択した。監査時の推奨理由（記録）:

1. Exit Gate 原文は「常設 prepared panel を消す」「write safety を維持する」であり、中央 Modal を要求していない。
2. 現行 Drawer はすでに `role="dialog"` / `aria-modal` / focus trap / Esc を実装し、plan review と承認ゲートをパネル側で持つ。
3. (B) は Gate C で PASS したオペレータ導線を動かし、安全 UX の回帰コストが大きい。
4. Native write NOT_RUN と close-without-cancel 契約は、Modal を新造しなくてもテストで閉じられる。

**確定した境界:**

| 項目 | 帰属 |
| --- | --- |
| 唯一の操作 overlay | Operations Drawer（M6-06） |
| 中央 Operation Modal | **作らない。** `MO-M6-06-OPERATION-MODAL-1` **不採用** |
| operator パネル | Drawer 内に残す（第二 shell にしない） |
| Copy/Rename configurable shortcut | **M6-08**（FU-9） |
| Native write smoke / close-without-cancel | M6-06 残件（FU-1） |

v0.1 ingest 原文（`sources/MASTA_OCTA_*_v0.1.md`）は書き換えない。差分は本節と `DEVELOPMENT_STATUS` / `MILESTONE_INDEX` の M6 行に置く。Native smoke と close 契約の製品テストは FU-1（本 PR の範囲外）。

---

## 7. Follow-up 作業単位（Issue は作らない）

PARTIAL / STOP から最小単位へ分解する。実装は本 PR の範囲外。

### FU-1 `MO-M6-06-DRAWER-SPEC-AND-NATIVE-1`

- **前提:** **(C) DECIDED。** overlay 形状の正本化は本監査で記録済み。残るのは Native / 回帰テスト
- **タイトル:** Operations Drawer の Native 最小スモークと close 契約
- **範囲:** 合成 fixture 上の Native Drawer 書き込み 1 本（原本媒体禁止）。in-flight close 契約の回帰テスト固定。必要なら testing 文書の更新。v0.1 ingest 原文は書き換えない
- **Acceptance:**
  - Overlay 形状の正本（Drawer = M6-06）は本監査 §6.3 で記録済み。再改正は不要
  - Native: 合成 root で Drawer 経由の rename prepare **または** clone verify が 1 本 PASS
  - close 中の prepare が自動 cancel/apply されない
  - Gate C パネルの IPC を増やさない
- **想定ファイル:** `docs/testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`、必要なら `src/features/roots/RootRegistryPanel.test.tsx` / `RenameSampleModal.test.tsx`

### FU-2 `MO-M6-08-PANE-PERSISTENCE-1`

- **タイトル:** Library pane 幅を再起動後に復元する
- **範囲:** `sourcesSplitPercent` / `mainSplitPercent`（および合意した browse キー）を `localStorage` へ。root 切替で不正値を捨てる。テーマ / locale キーと混ぜない
- **Acceptance:**
  - リロード後に split % が復元される（unit + E2E または reload テスト）
  - 欠落・壊れた JSON は既定 16 / 62 にフォールバック
  - 絶対 path を保存しない
- **想定ファイル:** `src/features/roots/RootRegistryPanel.tsx`、新規 storage helper + test、`e2e/workspace-layout.spec.ts` または専用 spec、`docs/planning/DEVELOPMENT_STATUS.md` M6-08 行

### FU-3 `MO-M6-08-LIBRARY-KEYBOARD-1`

- **タイトル:** Library workspace の v0.1 キーボード最小セット
- **範囲:** Sample リスト Up/Down、Preview Space play/stop、検索フォーカス（Cmd+K または Cmd+F を仕様で固定）、Esc は既存 Drawer を維持。Copy/Rename configurable は **含めない**（FU-9。M6-08 だが本単位の外）
- **Acceptance:**
  - リストがフォーカス可能なとき Up/Down で選択が動く
  - Preview タブで Space が play/stop（入力中は無効）
  - 検索ショートカットが `WorkspaceTopBar` の input をフォーカス
  - Vitest および可能なら E2E
- **想定ファイル:** `CatalogFileList.tsx`、`WorkspaceTopBar.tsx`、`WaveformPreview.tsx` または Inspector、対応 `*.test.tsx`、`docs/I18N.md`（ja/en を同時）

### FU-4 `MO-M6-06-OPERATION-MODAL-1` — **不採用**

- **状態:** **NOT ADOPTED**（2026-10-19、(C) DECIDED）
- **タイトル:** v0.1 中央 Operation Modal
- **範囲:** 開かない。中央 Modal は作らない。既存 operator パネルを Drawer から移さない
- 歴史記録として残す。後続作業のキューに入れない

### FU-9 `MO-M6-08-CONFIGURABLE-OPS-SHORTCUTS-1`

- **移管:** (C) により M6-06 から **M6-08** へ
- **タイトル:** Copy / Rename の設定可能なキーボードショートカット
- **範囲:** Library workspace で Copy/Rename overlay を開く shortcut をユーザーが設定できる。既定値とドキュメント（ja/en）。M6-06 Drawer の IPC / レイアウトは変えない
- **Acceptance:**
  - 未設定時の既定（または「未割り当て」）が文書化されている
  - 設定した shortcut が Drawer を開く
  - 入力フィールドにフォーカス中は発火しない
- **想定ファイル:** workspace / i18n（ja+en）、設定 UI または既存設定面、対応テスト

### 任意（M6 COMPLETE のブロッカーにしない）

| ID | 内容 |
| --- | --- |
| FU-5 | Inspector 波形 plot の高さ（8.75rem 固定を列に追従）。品質。M7 Canvas とは別 |
| FU-6 | Navigation Favorites / Recent。v0.1 図の nicety |
| FU-7 | Top Bar 専用 Scan コントロール（登録 + `listLibrary` で責務は充足済み） |
| FU-8 | Operator パネル本文 i18n（#134 Remaining） |

---

## 8. Bank Editor / Project Structure 依存（本線の外）

Library の project location は read-only `ProjectStructureViewer` を **ホストするだけ**である（`CatalogWorkspaceViews.tsx` L84–92）。

| 対象 | 本監査 |
| --- | --- |
| Sample の clone / rename / additive copy（M5 Intent → Plan → Apply） | M6-06 の操作 UI として見る。安全境界は M5 のまま |
| Project Structure Viewer（#180 系） | 表示ホストのみ。PSE 完了判定をしない |
| Bank ChangePlan / mutation contract / Apply | **対象外。** [`PROJECT_STRUCTURE_CONTROL_PLANE.md`](./PROJECT_STRUCTURE_CONTROL_PLANE.md)。`BANK_CHANGEPLAN_READINESS` は本監査で触らない |
| Sample Slot ↔ AudioAsset（#187） | M6-07 の補助。境界契約の再監査はしない |

M6 COMPLETE は Bank Apply を待たない。逆に Bank Editor は M6-06 Drawer 受容の有無を待たない（Bank 操作 UI は未承認）。

---

## 9. 結論

| 項目 | 判定 |
| --- | --- |
| M6-01 AppShell | **PASS** |
| M6-02 Top Context Bar | **PASS** |
| M6-03 Navigation Pane | **PASS** |
| M6-04 Sample Browser v2 | **PASS** |
| M6-05 Sample Inspector v2 | **PASS** |
| M6-06 Operation Modal | **PARTIAL**（overlay は (C) 確定。残件は Native / close 契約） |
| M6-07 AudioAsset baseline | **PASS** |
| M6-08 keyboard / resize / persisted UI | **PARTIAL**（persistence **STOP**。configurable shortcut を含む） |
| Exit Gate 1–6（責務） | **6 / 6 PASS** |
| **M6 milestone** | **IN_PROGRESS**（COMPLETE にしない） |
| M6-06 決定 | **DECIDED (C)** — 2026-10-19、ユーザー。Drawer を正。Modal 新造なし。`MO-M6-06-OPERATION-MODAL-1` **不採用** |

#178 の「残件が実装済みなら Native 受入まで完了」は満たしていない。Operations Drawer 書き込み Native は **NOT_RUN**。pane persistence と Library キーボード（configurable 含む）は未実装。

次の製品作業: FU-1（M6-06 残テスト）、独立して FU-2 / FU-3 / FU-9（いずれも M6-08）。FU-4 は開かない。

関連: [#178](https://github.com/kaz4g/masterocta/issues/178)、[`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md)、[`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md)、[`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md)。

---

## 10. Later native session (2026-10-26) — does not revise §9

§9 は 2026-10-19、`6f68ff1` の判定表のままである。この節は clean `main` の再受入記録であり、上の表を PASS に書き換えるものではない。

```text
Product SHA:           4fbae7bbc21db79f9687ec7c0b6326702f48a0d4
Native run:            STOP
N0–N8:                 N0–N6 PASS; N8 PASS;
                       N7 post-PREPARED close / status-bar reopen PASS;
                       N7 in-flight non-reopen NOT_OBSERVED
Apply invoked:         NO
M6-06_NATIVE:          not PASS
M6:                    IN_PROGRESS
Issue #178:            OPEN
```

詳細は [`../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md`](../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md) §7。次の作業は、本番の Prepare 意味論を変えずに N7 実行中を観測すること。テスト専用の待機を入れる場合は通常ビルドでは無効とし、その PASS を本番 Native PASS に昇格しない。

---

## 11. Diagnostic in-flight session (2026-10-26) — does not revise §9

§9 の判定表は変えない。§10 も変えない。この節は prepared count 0 のコンソール駆動診断であり、本番 Native PASS ではない。

```text
Product SHA:           d7754d30f671a4f2a97100a3825ac4eba0d6fc0b
Native run:            DIAGNOSTIC_PASS / PRODUCTION_NOT_YET_ACCEPTED
N7 in-flight:          reopen blocked while the first prepare IPC was open;
                       same operation reopened after PREPARED
Interaction:           CONSOLE_DRIVEN (isTrusted false)
Apply invoked:         NO
M6-06_NATIVE:          not production PASS
M6:                    IN_PROGRESS
Issue #178:            OPEN
```

詳細は [`../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md`](../testing/MO_M6_06_OPERATIONS_DRAWER_NATIVE_SMOKE.md) §8。既存 PREPARED が 1 件以上あるときのステータスバー再表示は、ゼロ件の N7 禁止とは別条件であり、この節では製品仕様を変えない。

---

## 12. Composite N7 judgment (2026-10-27) — does not revise §9

§9、§10、§11 は変えない。この節は受入責任者が `APPROVE_COMPOSITE` としたあとの判定である。承認そのものは COMPLETE の根拠ではない。根拠は下表と、`4fbae7bb` から `d7754d30` まで `src/` と `src-tauri/` の差分が空であること。

```text
POLICY:                MO-M6-06-N7-ACCEPTANCE-POLICY-1
DECISION:              APPROVE_COMPOSITE
SCOPE:                 zero-prepared Rename Prepare;
                       in-flight close and status-bar block;
                       same operation reopen after PREPARED
N7_STRICT_MANUAL:      NOT_OBSERVED (preserved)
N7_COMPOSITE:          PASS
INTERACTION_GAP:       diagnostic events are isTrusted=false
PRODUCT_CODE:          identical 4fbae7bb .. d7754d30
REQUIRED_CI:           PR #249 run 40302749379 PASS
M6-01 .. M6-05:        COMPLETE (unchanged)
M6-06:                 COMPLETE
M6-07:                 COMPLETE (unchanged)
M6-08:                 COMPLETE
M6:                    COMPLETE
ISSUE_178_CLOSE_READY: YES
PREPARE_SEMANTICS:     unchanged
APPLY_CONTROL:         unchanged
GATE_C:                unchanged
```

判定の詳細は [`M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md`](./M6_06_OPERATIONS_DRAWER_ACCEPTANCE.md) §5.1。公開配布は引き続き **NOT AUTHORIZED**。
