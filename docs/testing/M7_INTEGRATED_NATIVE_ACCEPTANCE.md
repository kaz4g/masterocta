# M7 Integrated Native Acceptance

**Work ID:** `MO-M7-INTEGRATED-NATIVE-ACCEPTANCE-1`  
**Status:** **NOT_RUN** (operator Native GUI required; do not mark PASS without completed checklist below)  
**Supersedes (when PASS):** operator intent of #153 / #154 only — historical checklists remain **NOT_RUN** in their files.

**Canonical checklist source:** [`../planning/M7_EXIT_AUDIT.md`](../planning/M7_EXIT_AUDIT.md) §15.A

---

## Start gate (2026-09-21)

| Item | Value |
| --- | --- |
| `origin/main` | `37f86c9603e74bbb59735a98fa79dc51d888ec24` (#154 merge) |
| PR #155 (exit audit + review-fix) | **OPEN** — not on `main` yet |
| Expected M7 status on canonical `main` | **IN_PROGRESS** until #155 merges and Native **PASS** |
| Catalog schema | **13** |
| **Gate decision** | **STOP** — begin full operator Native on **`main` + merged #155**; this record started on product `37f86c9` with audit docs pending merge |

---

## Environment (sanitized)

| Item | Recorded |
| --- | --- |
| Host OS | Darwin (macOS) |
| Product commit (harness) | `37f86c9603e74bbb59735a98fa79dc51d888ec24` (acceptance branch tracks `main`) |
| Harness | [`scripts/prepare-ui-workspace-native-acceptance.sh`](../../scripts/prepare-ui-workspace-native-acceptance.sh) |
| Launcher | [`scripts/launch-native-acceptance-tauri.sh`](../../scripts/launch-native-acceptance-tauri.sh) `<isolated_home>` |
| Fixture sample | `SET/AUDIO/RANGE.wav` |
| RANGE SHA256 (expected) | `43ceb3dc7e42bd89ee1b83da57682cb0b2f846c5b12caf210cbf61ba29e429b1` |
| Isolated HOME | `<managed /tmp prefix — not committed>` |
| Isolated catalog (code-derived) | `$HOME/Library/Application Support/MasterOCTa/catalog.sqlite3` |
| Derived storage (code-derived) | `$HOME/Library/Application Support/MasterOCTa/derived-audio/published/v1/` |
| Real Octatrack media | **Forbidden** |

**Prep script (automated):** **PASS** — fixture generated; RANGE byte SHA verified (2026-09-21).

**Fixture manifest (pre):** captured in isolated `fixture-manifest.json` (relative paths + SHA256 per file). Do not commit operator paths.

---

## Operator checklist

| Step | Result | Notes |
| --- | --- | --- |
| Launch Tauri dev with isolated `HOME` | **NOT_RUN** | |
| `lsof` / catalog binding on isolated DB | **NOT_RUN** | |
| Register fixture root (read-only); scan; list `RANGE.wav` | **NOT_RUN** | |
| **Waveform:** render | **NOT_RUN** | |
| **Waveform:** stereo observation (lanes) | **NOT_RUN** | Expect **PARTIAL** until `MO-M7-STEREO-CHANNEL-LANES-1` |
| **Waveform:** zoom / pan | **NOT_RUN** | |
| **Waveform:** range + preview | **NOT_RUN** | |
| **Slice:** draft load / marker / selection | **NOT_RUN** | Existing draft OK |
| **Export:** review → confirm → success | **NOT_RUN** | |
| **Published WAV** exists; output SHA recorded | **NOT_RUN** | #153 requirement |
| **No** `.part`, symlinks, duplicate published files | **NOT_RUN** | |
| **RANGE.wav** SHA256 pre == post | **NOT_RUN** | |
| **Fixture root** manifest pre == post | **NOT_RUN** | |
| **Inspector Info:** SLICE_EXPORT child fields | **NOT_RUN** | kind, range, processor, createdAt, opaque id |
| **No** raw hash / abs path / SQLite row id in UI | **NOT_RUN** | |
| **Retry** same slice export (idempotent) | **NOT_RUN** | #153 requirement |
| **Stale:** draft revision advanced during export review | **NOT_RUN** | Expect fail-closed; no new derived/lineage |
| **Quit + relaunch;** same lineage child | **NOT_RUN** | #154 requirement |
| **Post-quit** `slice_drafts` SELECT (sanitized) | **NOT_RUN** | M7-05 step C |
| **Info-tab lazy load** (no lineage IPC on Preview/Slice) | **NOT_RUN** | UI observation |
| **Intermediate TRIM → SLICE chain** | **NOT_APPLICABLE** | mac_derived not in Library browse |

**Overall integrated Native:** **NOT_RUN**

---

## Automated verification (not Native PASS)

Recorded on acceptance branch @ `main` product tree (2026-09-21):

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm run typecheck` | **PASS** | |
| `pnpm run check:architecture` | **PASS** | `$HOME/.cargo/bin` on PATH |
| `pnpm run check:containment` | **PASS** | |
| `pnpm run test:frontend` | **FAIL** | 1/666: `AudioFileTable` assigned popover (unrelated to M7 path; re-run on operator machine) |
| `pnpm run build` | **PASS** | |
| `pnpm run test:e2e` | **NOT_RUN** | not executed in this session |
| `cargo fmt --check` | **PASS** | |
| `cargo clippy --exclude masterocta` | **PASS** | |
| `cargo test --workspace --locked` | **PASS** | workspace crates |
| Playwright / mock IPC | **N/A** | Not Native evidence |

Re-run full AGENTS.md verification on operator machine before marking Ready for review.

---

## Failure criteria (any → do not PASS)

Source SHA change; fixture root diff; derived file on Octatrack root; duplicate export growth; lineage lost after restart; wrong range; raw hash/path exposure; stale export success; `.part` left behind; crash; catalog errors hidden.

---

## Findings (acceptance session)

| ID | Severity | Finding | Work ID |
| --- | --- | --- | --- |
| — | — | Native GUI not executed in agent session | Operator completes checklist above |

---

## Historical documents (unchanged)

- [`M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md`](./M7_SLICE_DERIVED_EXPORT_NATIVE_ACCEPTANCE.md) — **NOT_RUN**
- [`M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md`](./M7_DERIVED_LINEAGE_QUERY_NATIVE_ACCEPTANCE.md) — **NOT_RUN**

**Merge / public distribution:** not authorized by this document.
