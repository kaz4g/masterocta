# M7 Exit Audit

- Work ID: `MO-M7-EXIT-AUDIT-1`
- Date: 2026-09-21
- Kind: **docs-only** (no product / Rust / frontend / catalog / CI change)
- Baseline: GitHub `origin/main` **`37f86c9603e74bbb59735a98fa79dc51d888ec24`** (merge PR #154)

This document is the **current** M7 completion map. It does not rewrite Gate C, RC7/RC8, or historical Native checklists.

---

## 1. Audit identity

```text
origin/main:     37f86c9603e74bbb59735a98fa79dc51d888ec24
PR #154:         MERGED
#154 final head: 6a5ec66b9be48de37613240b262a3f352cadcc9b
#154 merge SHA:  37f86c9603e74bbb59735a98fa79dc51d888ec24
main CI:         success — Actions run 35545049683 (push of #154 merge)
open PRs:        none (2026-09-21 fetch)
catalog schema:  13 (LATEST_SCHEMA_VERSION; migrations 0012 asset_derivations, 0013 mac_derived)
worktree:        tracked tree clean on audit/m7-exit-1 @ origin/main
```

Canonical sources (this audit):

| Role | Path |
| --- | --- |
| Milestone numbers / WP names | [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md) |
| Live status vocabulary | [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) |
| Exit Gate **verbatim** | [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md) §17 M7 |
| WF2 design / follow-ons | [`WAVEFORM_V2_INTEGRATION.md`](./WAVEFORM_V2_INTEGRATION.md) |
| Auto Slice boundary | [`AUTO_SLICE_1_IMPLEMENTATION_STATUS.md`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md) |
| Derived framework | [`M7_DERIVED_AUDIOASSET.md`](./M7_DERIVED_AUDIOASSET.md), [`M7_AUTO_SLICE_DERIVED_EXPORT.md`](./M7_AUTO_SLICE_DERIVED_EXPORT.md) |

**STOP check:** Implementation Plan v0.1 M7 Work Packages match `MILESTONE_INDEX` M7-01–08 exactly. No competing WP list. Proceed.

---

## 2. Canonical M7 scope

From v0.1 §17 / `MILESTONE_INDEX` (do not add WPs):

| WP | Name |
| --- | --- |
| M7-01 | waveform query model |
| M7-02 | multi-resolution waveform cache |
| M7-03 | stereo/channel representation |
| M7-04 | zoom / range / scroll UI |
| M7-05 | transient analysis |
| M7-06 | derived AudioAsset framework |
| M7-07 | stem separation adapter spike |
| M7-08 | optional stem separation workflow |

**Exit Gate (v0.1, 原文):**

1. window幅に応じた高解像度waveform取得
2. zoomしても640point固定制約に縛られない
3. stereoを独立表示可能
4. analysis jobがLibrary UIをblockしない
5. 派生Assetがoriginalを変更しない

Stem, Canvas renderer, `.ot` media Apply, 100-clip music corpus, and mac_derived Library browse are **not** in this Exit Gate.

---

## 3. PR / evidence inventory

Merged PRs inspected (title + merge SHA; numbers not trusted alone):

| PR | Merge SHA | Title / scope |
| --- | --- | --- |
| [#102](https://github.com/kaz4g/masterocta/pull/102) | `827c7c5252f8ac8daf484b372202315845fdaf31` | Attack detect, draft, slice editor |
| [#124](https://github.com/kaz4g/masterocta/pull/124) | `9f587328b46645dcefa280be88d6421c3dff5aca` | WF2 library query IPC |
| [#127](https://github.com/kaz4g/masterocta/pull/127) | `5771bad28b1c7bfd30fbade2ee115b66d37e82c5` | Library range preview |
| [#129](https://github.com/kaz4g/masterocta/pull/129) | `170e4102cd92f51a862404663b32d0f915b87cb4` | Width-driven `targetPoints` |
| [#130](https://github.com/kaz4g/masterocta/pull/130) | `4da00644493b79195be7082221a1753082652ec5` | Zoom / pan / drag range |
| [#131](https://github.com/kaz4g/masterocta/pull/131) | `e3f8cdb7596c97610a2d80f4f15cd20ed0ade6d0` | Library range → analysis |
| [#135](https://github.com/kaz4g/masterocta/pull/135) | `22344fb386b1f5e17ee7fea524130eb101fd53ab` | Expanded slice workspace |
| [#141](https://github.com/kaz4g/masterocta/pull/141) | `f0437eff824b7274bfe0235a6b5f207713407faa` | Analysis session recovery |
| [#142](https://github.com/kaz4g/masterocta/pull/142) | `0f39f5056c25e996f1e3ff69b7a51ca20b0c45bb` | Rescue recovery onto main |
| [#145](https://github.com/kaz4g/masterocta/pull/145) | `95ca4cbda8fb3846fd41b892f705785b7bc23558` | WFM2 multi-resolution cache (head `820183b`) |
| [#147](https://github.com/kaz4g/masterocta/pull/147) | `df6f9b0ecc3225d5d6c393443b2fa40d534033bf` | Derived lineage foundation |
| [#148](https://github.com/kaz4g/masterocta/pull/148) | `0534625150316afefc2730a922acbd102650f188` | TRIM generation pipeline |
| [#149](https://github.com/kaz4g/masterocta/pull/149) | `d1f363eb2fc64c4063478089d5be942e578a4520` | TRIM verification/recovery |
| [#150](https://github.com/kaz4g/masterocta/pull/150) | `0d8be48eb0d8b46f84e0d84836244c4aa8bc4160` | Strict TRIM writes |
| [#151](https://github.com/kaz4g/masterocta/pull/151) | `6df7b48988ad28a566f2a46a6887505188a0b387` | Independent PCM verify |
| [#152](https://github.com/kaz4g/masterocta/pull/152) | `c9671d2185dd639f7d8538aa4a2d1d85c213d839` | Slice → `SLICE_EXPORT` |
| [#153](https://github.com/kaz4g/masterocta/pull/153) | `e4f4ebdfc1b6dc011aca641229cb5893f5ee5221` | Slice export UI |
| [#154](https://github.com/kaz4g/masterocta/pull/154) | `37f86c9603e74bbb59735a98fa79dc51d888ec24` | Lineage query IPC + Inspector |

Native / operator docs (classification):

| Doc | Class | Recorded status |
| --- | --- | --- |
| [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) | **CURRENT** (integrated, `0f39f50`) | Overall **PASS** (workspace + slice/range + recovery) |
| [`M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`](../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md) | **HISTORICAL / SUPERSEDED** | #131 head A–D **NOT_RUN**; superseded by workspace native |
| [`MO_M7_WFM2_MULTIRES_CACHE_1.md`](../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md) | **CURRENT** (format + automated) | Native **NOT_RUN**; E2E **NOT_RUN** at #145 write-up |
| [`M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md`](../testing/M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md) | **CURRENT** | **NOT_RUN** (do not rewrite to PASS) |
| [`M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md`](../testing/M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md) | **CURRENT** | **NOT_RUN** (do not rewrite to PASS) |

No later Native document **contains** derived export + lineage restart. Workspace native **PASS** at `0f39f50` is **before** #145 WFM2 and **before** #147–#154 derived work. It may supersede #131 A–D only.

---

## 4. M7-01 — waveform query model

**Status: COMPLETE**

| Axis | Evidence |
| --- | --- |
| Implementation | `v2_audio_waveform_query`; opaque asset/file ids; decimal-string frames; `targetPoints`; range; `AUDIO_SOURCE_CHANGED` |
| Main | #124 `9f58732` |
| Automated | ot-audio + v2_api tests; CI on main |
| E2E | `e2e/waveform-target-points.spec.ts` |
| Native | **N/A** as dedicated WF2 query session; Inspector waveform exercised on `0f39f50` workspace native |
| Hardware | **N/A** |

**Exit blocker:** no.

---

## 5. M7-02 — multi-resolution waveform cache

**Status: COMPLETE**

WFM2 pyramid, partial header/table read, seek peak reads, truncated/malformed regen, 64 MiB bound, proportional buckets, source-change rejection: documented in [`MO_M7_WFM2_MULTIRES_CACHE_1.md`](../testing/MO_M7_WFM2_MULTIRES_CACHE_1.md) and merged #145.

| Axis | Evidence |
| --- | --- |
| Implementation | `ot-audio` `wfm2` + `waveform_v2`; IPC DTO unchanged |
| Main | #145 `95ca4cb` (head `820183b`) |
| Automated | **PASS** (`wfm2` / `waveform_v2`); long-file hook `#[ignore]` |
| E2E | **N/A** at WP (IPC unchanged) |
| Native | **NOT_RUN** |
| Hardware | **N/A** |

Native NOT_RUN is **not** an M7 Exit Gate item (cache is an implementation of width-driven high-res, already covered by query + tests). Treat as completion quality.

**Exit blocker:** no.

---

## 6. M7-03 — stereo / channel representation

**Status: COMPLETE**

Per-channel peaks in v2 query (#124). Auto Slice docs: inverse-phase stereo uses per-channel max. Preview remains compatible with existing PCM path.

| Axis | Evidence |
| --- | --- |
| Implementation | `channelPeaks` / planar WFM2 |
| Main | #124, #145 |
| Automated | **PASS** |
| E2E | **PARTIAL** (plots exist; not a stereo-polarity fixture) |
| Native | **PARTIAL** (workspace native used fixture WAV, not polarity QA) |
| Hardware | **N/A** |

**Exit blocker:** no.

---

## 7. M7-04 — zoom / range / scroll UI

**Status: COMPLETE** (previous **IN_PROGRESS** was Canvas-driven)

Canonical WP delivered by #129 (width `targetPoints`) + #130 (viewport zoom ×2, pan ¼ width, drag range, non-null query `range`). Range preview #127. Renderer is **SVG/DOM**, not Canvas.

**Canvas:** [`WAVEFORM_V2_INTEGRATION.md`](./WAVEFORM_V2_INTEGRATION.md) §13.2 lists “Zoom / scroll / Canvas (#104)” as **後続でよい**. §13.5 marks Canvas **未実装** while zoom/pan/range query is **#130 済**. v0.1 Exit Gate does **not** name Canvas. Therefore Canvas is **not** an M7 exit blocker.

Persisted zoom state / wheel-scroll: not required by Exit Gate; button pan is the WP’s specified pan.

| Axis | Evidence |
| --- | --- |
| Implementation | `WaveformPreview` zoom/pan/drag; `e2e/waveform-zoom-range-select.spec.ts` |
| Main | #127, #129, #130 |
| Automated | frontend tests + CI |
| E2E | **PASS** (zoom spec; layout specs) |
| Native | **PARTIAL** — workspace native **Preview range PASS** on `0f39f50`; dedicated zoom/pan operator row not in that matrix; pre-WFM2 |
| Hardware | **N/A** |

**Exit blocker:** no.

---

## 8. M7-05 — transient analysis

**Status: COMPLETE** for canonical M7-05 / Exit Gate item 4.

Implementation on main: PCM onsets, ROI, candidates, apply to draft, protected/manual markers, SQLite draft, preview, stale/expiry/recovery (#102, #131, #135, #141/#142). Analysis is job-based (`v2_audio_onsets_*`); Library browse is not a synchronous decode on the UI thread.

**Implementation vs acceptance:** the remaining gaps in [`AUTO_SLICE_1_IMPLEMENTATION_STATUS.md`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md) §残る実装・評価 (100-clip corpus, AS-1 disk budget, `.ot`) are **Auto Slice / M11**, not v0.1 M7 Exit Gate.

| Axis | Evidence |
| --- | --- |
| Implementation | slice workbench + catalog drafts |
| Main | #102, #131, #141, #142 |
| Automated | Rust + frontend + E2E (`slicing`, `range-to-slice-analysis`) |
| E2E | **PASS** |
| Native | Integrated **PASS** on `0f39f50` ([`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md)). Historical #131 A–D **NOT_RUN** remains historical |
| Hardware | **N/A** for M7 (MkII slice apply is M11) |

Previous row **IMPLEMENTED_NOT_FULLY_ACCEPTED** mixed “native gap on #131” with “implementation incomplete”. Native product path for range→slice is superseded **PASS**. Quality corpus remains open and is classified **C. POST-M7**.

**Exit blocker:** no (for M7 Exit Gate). Re-run on post-#154 main is recommended only as part of integrated Native, not as a separate M7-05 implementation WP.

---

## 9. M7-06 — derived AudioAsset framework

**Status: IMPLEMENTED_NOT_FULLY_ACCEPTED**

On `main` after #147–#154:

- Lineage domain + catalog v12/v13, cycle prevention, legacy TRIM read
- TRIM generation: source bind, independent PCM verify, no-op reject, staging/publish, retry/idempotency
- Slice Draft → `SLICE_EXPORT` IPC/UI
- Read-only `v2_asset_derivation_get` / `list_children`; Inspector parent **and** children; Info-tab gated queries

Explicit **non-goals** of the landed WPs ([`M7_AUTO_SLICE_DERIVED_EXPORT.md`](./M7_AUTO_SLICE_DERIVED_EXPORT.md)): multi-slice batch, `.ot`, media Apply, mac_derived in `v2_library_list`, derived waveform, parent navigation. Those are **not** required to call the *framework* complete for Exit Gate item 5 (“派生Assetがoriginalを変更しない”).

**Why not COMPLETE:** operator Native for export + lineage + restart is **NOT_RUN**. Automated tests and E2E mocks exist; they do not replace the Native checklists that the Work IDs themselves required.

| Axis | Evidence |
| --- | --- |
| Implementation | #147–#154 on `37f86c9` |
| Automated | ot-domain / ot-catalog / masterocta tests; frontend lineage tests |
| E2E | `e2e/slice-derived-export.spec.ts` **PASS** (mock IPC) |
| Native | #153 and #154 docs **NOT_RUN** |
| Hardware | **N/A** |

**Exit blocker:** **yes** — Native confirmation that originals are unchanged and lineage survives restart.

---

## 10. #153 / #154 Native evidence (do not rewrite)

| PR | Doc | Historical / current status |
| --- | --- | --- |
| #153 | `M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md` | **NOT_RUN** |
| #154 | `M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md` | **NOT_RUN** |

**Superseding evidence:** none. Workspace native `0f39f50` does not include derived export or Inspector lineage.

Do not edit those checklists to PASS in this audit.

---

## 11. M7-07 — stem separation adapter spike

**Status: PLANNED**

`DerivationKind::STEM` and `StemRole` exist in `ot-domain` / catalog tests. There is **no** adapter interface, processor runtime, or model dependency. Enum-only is not a spike COMPLETE.

v0.1 Exit Gate does not mention stems. `MILESTONE_INDEX` M11 lists production stem; dependency order only forbids doing stem *before* WF2/derived, not as M7 close-out.

**Exit blocker:** no.

---

## 12. M7-08 — optional stem separation workflow

**Status: DEFERRED** (to **M11**)

WP name is **optional**. M11 purpose (v0.1): production stem separation. Exit Gate omits stem workflow. No product UI/workflow on main.

**Exit blocker:** no.

---

## 13. Exit Criteria matrix

| Exit Criterion (v0.1) | Evidence | Status | Gap |
| --- | --- | --- | --- |
| Width-driven high-res waveform | #129 + WFM2 #145 + query #124 | **PASS** | Native zoom matrix optional |
| Zoom not stuck at 640 points | #129/#130; `targetPoints` 32–4096 | **PASS** | Canvas follow-on only |
| Stereo independently displayable | #124/#145 per-channel peaks | **PASS** | Polarity visual QA not Native |
| Analysis job does not block Library UI | Job API + workspace native analysis PASS | **PASS** | 100-clip quality is Auto Slice |
| Derived assets do not mutate originals | TRIM/SLICE_EXPORT tests + invariant docs | **PARTIAL** | Native SHA + restart **NOT_RUN** |

Items **not** in Exit Gate (do not promote): Canvas, descriptor-relative cache, prepare-job UI, mac_derived Library injection, derived waveform, navigation, batch export, stem engine, `.ot`.

---

## 14. Acceptance matrix

| WP | Implementation | Main | Automated | E2E | Native | Hardware | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M7-01 | PASS | PASS | PASS | PASS | N/A | N/A | COMPLETE |
| M7-02 | PASS | PASS | PASS | N/A | NOT_RUN | N/A | COMPLETE |
| M7-03 | PASS | PASS | PASS | PARTIAL | PARTIAL | N/A | COMPLETE |
| M7-04 | PASS | PASS | PASS | PASS | PARTIAL | N/A | COMPLETE |
| M7-05 | PASS | PASS | PASS | PASS | PASS | N/A | COMPLETE |
| M7-06 | PASS | PASS | PASS | PASS | NOT_RUN | N/A | IMPLEMENTED_NOT_FULLY_ACCEPTED |
| M7-07 | PARTIAL (enum only) | N/A | N/A | N/A | N/A | N/A | PLANNED |
| M7-08 | N/A | N/A | N/A | N/A | N/A | N/A | DEFERRED |

---

## 15. Remaining work (three buckets)

### A. M7 EXIT BLOCKER

1. **Integrated Native acceptance** on current `main` (`37f86c9` or later): Waveform (preview/range) → Slice analyze/apply → Derived export → Inspector lineage (parent/children) → Quit/relaunch → original SHA unchanged. Covers #153/#154 checklists without rewriting them.

### B. M7 COMPLETION QUALITY (not Exit Gate)

1. Dedicated WFM2 Native / long-file operator observation (#145 Native NOT_RUN).
2. Dedicated zoom/pan Native row (beyond `0f39f50` preview-range).
3. Stereo polarity visual QA.
4. Canvas renderer / wheel-scroll (WAVEFORM_V2 follow-on).

### C. POST-M7 / FUTURE

1. **M7-07** adapter spike (before production stem).
2. **M7-08** optional stem workflow → **M11**.
3. Auto Slice 100-clip corpus, AS-1 cache budget.
4. `.ot` / media Apply / sample chain (M11 + Intent→Plan→Apply).
5. mac_derived Library injection, derived waveform, parent navigation, multi-slice batch.

---

## 16. Native integration recommendation

Do **not** reopen #153/#154 Native as separate historical PASSes.

**Primary next Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`

One operator session on latest main, isolated `HOME`, existing fixture harness (`scripts/prepare-ui-workspace-native-acceptance.sh`). Record results in a **new** current Native doc. Leave `M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md` and `M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md` as **NOT_RUN** historical Work ID checklists, with a pointer to the integrated doc once it exists.

Until that integrated Native **PASS**, M7-06 stays **IMPLEMENTED_NOT_FULLY_ACCEPTED** and M7 as a milestone stays **READY_FOR_FINAL_ACCEPTANCE** (not COMPLETE).

---

## 17. Recommended next Work ID

**Primary:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`

**Reason:** sole remaining M7 Exit Gate gap is operator Native for derived original-preservation + lineage restart. Implementation of M7-01–06 (except that acceptance) is on `main`.

**Secondary (not next):**

- `MO-M7-AUTO-SLICE-QUALITY-ACCEPTANCE-1` — 100-clip corpus (post-M7 / Auto Slice)
- `MO-M7-STEM-ADAPTER-SPIKE-1` — M7-07, after M7 close or in M11 prep
- Canvas WP — only if a later ADR makes it an exit criterion (it is not today)

---

## 18. M7 completion rule

Call M7 **COMPLETE** only when:

1. Exit Gate rows 1–4 remain PASS on main, and
2. Integrated Native **PASS** records original SHA unchanged + lineage after restart, and
3. M7-07/08 remain documented as planned/deferred (not silently required).

Do not require Canvas, stem engine, `.ot`, or Library injection.

**Recommended milestone status now:** **READY_FOR_FINAL_ACCEPTANCE** (implementation of canonical exit items is on main; required derived Native is missing).

---

## 19. Findings (do not fix in product code)

| ID | Finding | Disposition |
| --- | --- | --- |
| F1 | `M7_AUTO_SLICE_DERIVED_EXPORT.md` still labels lineage UI IN_PROGRESS after #154 merge | Docs pointer in this PR |
| F2 | `DEVELOPMENT_STATUS.md` baseline was #153 HEAD | Updated this PR |
| F3 | `WAVEFORM_V2_INTEGRATION.md` SHA baseline is historical `bed38a46` | **HISTORICAL**; current status is this file |
| F4 | MILESTONE_INDEX legacy table still said range→slice “in progress” | Pointer to this audit |
| F5 | No product defect opened; Native gap is evidence, not a code bug | Next Work ID |

---

## 20. Document classification (consistency)

| Document | Class |
| --- | --- |
| This file | **CURRENT** |
| `DEVELOPMENT_STATUS.md` / `MILESTONE_INDEX.md` | **CURRENT** (status rows follow this audit) |
| v0.1 Implementation Plan | **CURRENT** for WP/Exit Gate text |
| `WAVEFORM_V2_INTEGRATION.md` | **CURRENT** design; **HISTORICAL** main SHA |
| `M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md` | **SUPERSEDED** (operator A–D) |
| `MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md` | **CURRENT** for pre-derived workspace/slice |
| #153/#154 Native docs | **CURRENT NOT_RUN** (Work ID checklists) |
| `NEXT_GENERATION_ARCHITECTURE.md` §12 legacy M7 | **HISTORICAL** (mapped in MILESTONE_INDEX) |
