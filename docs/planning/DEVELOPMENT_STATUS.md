# Development status (canonical)

- Work ID: `MO-M7-EXIT-AUDIT-1` (M7 rows); earlier canonicalization: `MO-DEVELOPMENT-PLAN-CANONICALIZATION-1`
- Updated: 2026-09-23 (PR #156 premise reconciliation; no Native execution)
- Baseline: GitHub `origin/main` **`b2c7765772bd3894472ba936664cabc0db92fcf1`** (merge PR #155; product baseline inherited from #154)

Milestone **numbers and names:** [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md).
Architecture **principles:** [`../NEXT_GENERATION_ARCHITECTURE.md`](../NEXT_GENERATION_ARCHITECTURE.md).
**M7 completion map:** [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md).

## Status vocabulary

| Label | Meaning |
| --- | --- |
| **COMPLETE** | Exit criteria met for this row’s scope on `main`, including agreed acceptance where applicable |
| **READY_FOR_FINAL_ACCEPTANCE** | Exit Gate **implementation** on `main`; remaining gap is required operator/Native only. **Explicitly DEFERRED** WPs (documented in [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md)) do not count as missing. Exit Gate rows still **PARTIAL** (e.g. stereo UI) prevent this label |
| **IMPLEMENTED_NOT_FULLY_ACCEPTED** | Merged to `main`; automated tests may pass; native/hardware/operator acceptance incomplete |
| **IN_PROGRESS** | Partial delivery on `main`; material WPs remain |
| **PLANNED** | Defined in v0.1; no substantial `main` implementation |
| **DEFERRED** | Explicitly postponed (not a blocker for current track) |
| **UNDOCUMENTED** | Not specified in ingested v0.1 text |

Do **not** conflate: code exists · merged to `main` · CI/automated tests · native acceptance · hardware acceptance.

## Current reconciliation snapshot (2026-09-23)

PR #155 is **MERGED** at `b2c7765772bd3894472ba936664cabc0db92fcf1`
(2026-09-21 19:22:56 UTC / 2026-09-22 04:22:56 JST).
PR #156 remains **Draft**. Its integrated Native record is
[`M7_INTEGRATED_NATIVE_ACCEPTANCE.md`](../testing/M7_INTEGRATED_NATIVE_ACCEPTANCE.md):
**NOT_RUN**. The former "#155 unmerged" start blocker is removed, not converted
into Native PASS. Stereo independent display remains an implementation/acceptance
gap; M7 is **IN_PROGRESS**, not READY_FOR_FINAL_ACCEPTANCE or COMPLETE.

## Historical GitHub audit snapshot (M7 exit audit, 2026-09-21)

```text
origin/main:     37f86c9603e74bbb59735a98fa79dc51d888ec24
PR #154:         MERGED
#154 final head: 6a5ec66b9be48de37613240b262a3f352cadcc9b
#154 merge SHA:  37f86c9603e74bbb59735a98fa79dc51d888ec24
open PRs:        none (2026-09-21)
CI (#154 push):  success — run 35545049683
catalog schema:  13
```

Historical WFM2 snapshot (`#145` / `95ca4cb`) remains valid for cache implementation. See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §1–3.

---

## Milestone summary

| Milestone | Status | Summary |
| --- | --- | --- |
| **M5** | **COMPLETE** | Gate C PASS (personal/local); rename/reference-safe; RC8 ledger frozen |
| **M6** | **IN_PROGRESS** | Library workspace largely merged; M6-06/M6-08 vs v0.1 exit gaps |
| **M7** | **IN_PROGRESS** | Exit Gate stereo display **PARTIAL**; M7-05/M7-06 Native open; M7-07/08 **DEFERRED** (M11). See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) |
| **M8** | **PLANNED** | No PerformanceSession / MockNode on `main` |
| **M9** | **PLANNED** | No OCTA-node prototype in repo |
| **M10** | **PLANNED** | — |
| **M11** | **PLANNED** | Slice `.ot`/media Apply not started |

Public distribution / signing / notarization: **NOT AUTHORIZED** (unchanged).

---

## M5 — Safety / Gate C Completion

| Dimension | Status | Evidence |
| --- | --- | --- |
| Domain / merge | **COMPLETE** | M5-A/B/C/C5 PRs; #82 recovery/mutation gate |
| Gate C (personal/local) | **COMPLETE** | [`../testing/GATE_C_RC_LEDGER.md`](../testing/GATE_C_RC_LEDGER.md) §RC8 — **do not re-evaluate or edit** |
| Human Gate C | **COMPLETE** | Formal continuous trial documented; RC7 Prepare STOP remains historical |
| Public release | **NOT AUTHORIZED** | Separate from M5 COMPLETE |

---

## M6 — Library Workspace & AudioAsset Foundation

Judged by **responsibility**, not exact v0.1 widget names.

| WP | Status | Main merge / evidence | Automated | Native / operator | Notes |
| --- | --- | --- | --- | --- | --- |
| M6-01 AppShell | **COMPLETE** | #122, #132 | CI on merges | [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) PASS (post-#142 doc) | Five-region shell |
| M6-02 Top Context Bar | **COMPLETE** | #122, #132 | CI | Native doc | Context bar + root panel |
| M6-03 Navigation Pane | **COMPLETE** | #132 | CI | Native doc | Location nav |
| M6-04 Sample Browser v2 | **COMPLETE** | #122, #132 | CI + frontend tests | Native doc | Search/sort/pagination |
| M6-05 Sample Inspector v2 | **COMPLETE** | #133, #135, #138 | CI | Native doc | Tabbed inspector + slice workspace |
| M6-06 Operation Modal | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #134 Operations **Drawer** (not modal) | CI | — | v0.1 exit: remove always-visible prepared-operation panel. **Gate C rename/clone/copy still uses Change Drawer** (`RenameOperatorPanel` etc.). Drawer consolidates low-frequency ops; not identical to v0.1 “Operation Modal” acceptance |
| M6-07 AudioAsset baseline | **COMPLETE** | M3-C1 #13 (`AudioAsset` / `FileInstance`) | Catalog tests | — | v0.1 “migration-free read” satisfied via existing catalog |
| M6-08 keyboard / resize / persisted UI | **IN_PROGRESS** | Resize/split (#132, #139–#140); keyboard partial | CI | Narrow layout verified #140 | **Pane persistence to localStorage** not evidenced as M6-08 complete |

**M6 exit gate (v0.1):** Partially met; **M6-06** and **M6-08** prevent calling M6 **COMPLETE**.

---

## M7 — Waveform v2 & Audio Analysis

| WP | Status | Main merge / evidence | Automated | Native | Notes |
| --- | --- | --- | --- | --- | --- |
| M7-01 waveform query model | **COMPLETE** | #124 | CI + ot-audio tests | N/A | `v2_audio_waveform_query`. Audit: [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §4 |
| M7-02 multi-resolution cache (WFM2) | **COMPLETE** | #145 (`820183b`) | CI + `wfm2`/`waveform_v2` tests (see MO_M7_WFM2 doc) | **NOT_RUN** | Native NOT_RUN is completion quality, not Exit Gate. Fail-closed truncated header; invalid peak regen; warm path uses header/table + seek peak reads |
| M7-03 stereo/channel representation | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #124, #145 | Tests | **NOT_RUN** | Per-channel peaks in query/cache; **UI overlays channels** (implementation audit **PARTIAL**). Native stereo **NOT_RUN** (mono fixture; B01–B03). Follow-on: `MO-M7-STEREO-CHANNEL-LANES-1` |
| M7-04 zoom / range / scroll UI | **COMPLETE** | #129, #130 | CI + frontend tests + zoom E2E | PARTIAL | Button zoom/pan/drag range. **Canvas is a WAVEFORM_V2 follow-on, not v0.1 Exit Gate** |
| M7-05 transient analysis | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #102, #131, #141/#142 | Rust/UI/E2E | **PARTIAL** on `0f39f50` | Implementation on main. Native: A/B/D exercised; **C post-quit SQLite not recorded**. Integrated Native must include quit + `slice_drafts` SELECT. 100-clip / `.ot` are Auto Slice / M11 |
| M7-06 derived AudioAsset framework | **IMPLEMENTED_NOT_FULLY_ACCEPTED** | #147–#154 (`37f86c9`) | ot-domain / ot-catalog v13 / lineage query IPC / Inspector Info / export E2E | **NOT_RUN** (#153 + #154 checklists) | Lineage, Mac TRIM, `SLICE_EXPORT` UI, Inspector parent/children **on main**. mac_derived Library browse / derived waveform / batch / `.ot` are **non-goals**. Exit blocker = integrated Native (original SHA + restart lineage) |
| M7-07 stem separation adapter spike | **DEFERRED** | enum `STEM` / `StemRole` only | — | — | Not in v0.1 Exit Gate; spike deferred to **M11 prep** (enum-only ≠ spike). See audit §11 |
| M7-08 optional stem separation workflow | **DEFERRED** | — | — | — | Optional WP; production stem is **M11**. Not an M7 exit blocker |

**M7 exit gate (v0.1):** Width/zoom **PASS**; **stereo independent display PARTIAL**; analysis non-blocking **PASS** (implementation); derived original-preservation **PARTIAL** until integrated Native. Full matrix: [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §13–14.

---

## M8 – M11

| Milestone | Status | Notes |
| --- | --- | --- |
| M8 Performance Domain & Node Protocol | **PLANNED** | v0.1 §17; no `MockNode` / Performance workspace in product tree |
| M9 OCTA-node Prototype | **PLANNED** | Hardware/software prototype out of repo |
| M10 Integrated Performance System | **PLANNED** | — |
| M11 Advanced Sample Preparation | **PLANNED** | Partial overlap with Auto Slice **analysis UI** only |

---

## Auto Slice (cross-cutting; not a separate milestone ID)

Boundary on `main` per [`AUTO_SLICE_1_IMPLEMENTATION_STATUS.md`](./AUTO_SLICE_1_IMPLEMENTATION_STATUS.md):

| Capability | Status |
| --- | --- |
| Detect attacks / candidates / draft apply / manual edit / preview | **On main** (#102, slice workbench) |
| Library range → analysis (#131) | **Merged** |
| Analysis session recovery (#141/#142) | **Merged** |
| Draft SQLite persistence | **On main** |
| `.ot` output / Intent→Plan→Apply media Apply | **NOT_STARTED** |
| Real music corpus evaluation (100 clips) | **NOT_STARTED** |
| AS-1 disk snapshot / cache budget | **NOT_STARTED** |

**Do not** equate “Slice UI exists” with “Octatrack-safe `.ot` generation/apply”.

---

## PR map (#122–#154, selected)

| PR | Theme |
| --- | --- |
| #122 | M6 library layout |
| #124 | M7-01 v2 waveform query |
| #127 | Range preview |
| #128–#130 | i18n, pane resolution, zoom/range |
| #131 | Range→slice analysis |
| #132–#133 | Workspace foundation, inspector migration |
| #134 | Operations drawer (M6-06 partial) |
| #135–#140 | Slice workspace, native acceptance, layout fixes |
| #141–#142 | Slice analysis session recovery |
| #143–#144 | Native acceptance harness docs |
| #145 | M7-02 WFM2 multi-res cache |
| #147–#151 | M7-06 lineage + TRIM generation / verify |
| #152–#153 | Slice Draft → `SLICE_EXPORT` + UI |
| #154 | Lineage query IPC + Inspector Info |

#103 / #104 / #105 remain **closed** — do not reopen.

---

## Dependency chain (current)

```text
M5 (COMPLETE)
  → M6 Library shell (IN_PROGRESS)
  → M7 WF2 + analysis (IN_PROGRESS)
  → M7-06 derived Native (IMPLEMENTED_NOT_FULLY_ACCEPTED; exit blocker)
  → safe sample/slice `.ot` output (PLANNED / M11)
  → M7-07/08 stem (DEFERRED → M11)
  → M8 MockNode + protocol (PLANNED)
  → M9 hardware → M10 integration
```

Aligned with v0.1 §23; stem separation does not precede M7-06 without explicit replan.

---

## Recommended next product Work ID

**Primary:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`

**Reason:** One remaining M7 Exit Gate gap is operator Native on current `main`: Waveform → Slice → Derived export → Inspector lineage → restart, with original SHA unchanged. Do not rewrite #153/#154 historical **NOT_RUN** checklists to PASS.

**Other Exit blocker:** `MO-M7-STEREO-CHANNEL-LANES-1` — stereo must be independently displayable, not merely per-channel data. Implement/accept separately; existing mono `RANGE.wav` does not cover it. The integrated record separates derived-flow group A from stereo group B; both are needed for full M7 closure.

**Dependencies:** M5 COMPLETE; #147–#155 on `main`; Gate C boundaries unchanged.

**Secondary (not next):** Auto Slice 100-clip quality; WFM2 dedicated Native; stem adapter spike; Canvas renderer. See [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) §15–17.

---

## M7-05 native acceptance re-audit (2026-09-20)

| Source | Overall | Scope |
| --- | --- | --- |
| [`M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md`](../testing/M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md) | **NOT_COMPLETE** (historical) | #131 head `31ef6ca`; A–D **NOT_RUN** |
| [`MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md`](../testing/MO_UI_WORKSPACE_NATIVE_ACCEPTANCE.md) § post-#142 | **PASS** | `main` `0f39f50`; integrated workspace + slice/range |

**A–D mapping (integrated PASS):**

| ID | Original step | Superseded on `0f39f50`? |
| --- | --- | --- |
| A | Range preview Play + Stop | **Yes** — “Preview range” PASS |
| B | Analyze range; candidates vs attacks | **Yes** — analysis region, 2 candidates / 2 suppressed PASS |
| C | Apply candidates; draft + SQLite after quit | **Partial** — Apply + draft revision PASS; persistence verified via **file switch**, not documented post-quit `SELECT` |
| D | Range B → `ANALYSIS_REGION_MISMATCH` | **Yes** — fail-closed mismatch PASS |

**Conclusion (2026-09-21 review fix):** Do **not** treat M7-05 Native as **PASS**. Step C (post-quit draft persistence) was **Partial** only. Integrated Native (`MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`) must record quit + isolated-catalog `slice_drafts` evidence before M7-05 → **COMPLETE**. Keep `M7_RANGE_TO_SLICE_NATIVE_ACCEPTANCE.md` historical.

---

## Unresolved ambiguities

1. **M6-06:** Operations Drawer (#134) vs v0.1 Operation Modal vs Gate C Change Drawer — three UX surfaces coexist; document operator path in future UX ADR if consolidating.
2. **M6-08:** Persisted pane widths / workspace layout — no canonical acceptance doc marking COMPLETE.
3. **M7-04 Canvas:** **Resolved (2026-09-21 exit audit).** v0.1 Exit Gate does not name Canvas; WAVEFORM_V2 §13.2/§13.5 treats it as follow-on. M7-04 is **COMPLETE** with SVG/DOM zoom/pan/range. Canvas remains post-M7 quality unless a later ADR elevates it.
4. **`docs/OCTATRACK_PERFORMANCE_SYSTEM.md`:** Exists in user’s other clone but **not** on GitHub `main`; canonical ingest is `planning/sources/MASTA_OCTA_*_v0.1.md` only.
5. **ADR-015 / Performance System:** Referenced in WAVEFORM_V2 as draft only; not accepted in ADR_INDEX.

---

## Docs-only indexes

| Artifact | Path |
| --- | --- |
| Milestone numbers | [`MILESTONE_INDEX.md`](./MILESTONE_INDEX.md) |
| This status | [`DEVELOPMENT_STATUS.md`](./DEVELOPMENT_STATUS.md) |
| M7 exit audit | [`M7_EXIT_AUDIT.md`](./M7_EXIT_AUDIT.md) |
| ADR list | [`ADR_INDEX.md`](./ADR_INDEX.md) |
| v0.1 verbatim | [`sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md`](./sources/MASTA_OCTA_OCTA_NODE_IMPLEMENTATION_PLAN_v0.1.md) |
