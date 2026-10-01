# Project Structure Viewer — read-only slice

Work ID: `MO-PSE-VIEWER-1` · Issue #180

Base: `3a5812879d01a323db181cb7be102c71c157fc2d` (current main at start).
PR #200 audit is in the base; no Read Model parser or schema is changed.

## Contract and entry point

Select a catalog Project in Sources. Its Project workspace has a separate
Project Structure panel, above the sample list. Both shell and inline catalog
entry points use the same Viewer. The API accepts a registered opaque RootId
and project-relative path, invokes only `v2_project_structure_read`, and checks
`masterocta.project-structure:v3` and response target identity.

Bank documents are selected by full root-relative source document identity.
Working and SavedCheckpoint are separate options; they are never merged.
Pattern selection resolves its Part index, then that Part's audio Tracks and
Sample Slot Reference. Display coordinates add one to zero-based indices;
Static/Flex slot and recorder numbers retain their backend numbering.

Normal/per-track scale, finite master length and INF remain distinct. A Master
Track has no sample machine or slot. Malformed and unsupported documents show
status and source only, even if a response contains partial structure.

Project state is a read-only observation, separate from browsing selection.
Arrangement stays `Unmapped(raw)`; absent values remain unknown. Scene says
"not read". Arranger rows are not displayed. Recorder buffer references are
shown, but Recorder setup is not inferred.

Catalog reference evidence (including missing/invalid/unassigned statuses and
sample locks) is explicitly labeled as a separate snapshot. It matches exact
Bank source document, Track and Part/Pattern coordinates. It is not a fresh
filesystem existence check; no catalog evidence is not a resolved reference.
Reload reads structure again, not the catalog. Refresh the catalog separately
when updated sample-reference evidence is needed.

## Request lifecycle and safety

Root/project changes remount the session and clear old data immediately. Late
responses from an obsolete target or earlier reload are discarded. Errors show
a generic retry message rather than raw filesystem paths. No write authority,
ChangePlan, Apply, Copy/Move/Swap, or legacy Project editor is connected.

#181 and M7 acceptance documents/fixtures are unchanged. This slice is not an
M7 exit or Native acceptance claim.

## Verification and CI

- TypeScript typecheck: PASS.
- All frontend tests: PASS, 86 files / 699 tests (includes 10 new API/UI tests).
- Frontend build: PASS (existing bundle-size and dynamic-import warnings).
- Containment guard: PASS.
- PSE script contracts: PASS, 29 tests.
- API/UI regressions cover schema/target rejection, role separation, malformed
  and unsupported suppression, INF vs finite 255, per-track scale, Master,
  slot variants, missing/lock evidence, stale requests, retry, empty and Japanese UI.
- Browser regressions: PASS, 6 Chromium tests (2 Viewer + 4 existing workspace).
  Local Playwright used the installed Chrome headless shell 146 via a temporary
  config because the pinned Chromium 143 download was blocked/truncated. Full
  E2E/WebKit suite remains NOT_RUN locally; standard CI uses its pinned browsers.
  Screenshot layout inspected at both widths; Japanese glyph rendering is
  limited by missing CJK fonts in this Linux environment.
- New browser integration tests exercise the actual Project navigation at
  1280px and 840px and assert no mutation command is invoked.
- Rust fmt/clippy/workspace tests and architecture dependency guard are locally
  BLOCKED: `cargo: command not found` / `spawnSync cargo ENOENT`.
- Native Tauri/Octatrack acceptance: NOT_RUN on this Linux frontend environment.

Existing CI retains full frontend/build/E2E, Rust and Gate C jobs. Frontend
Checks explicitly addresses the two required Viewer test files so their removal
cannot silently pass with zero Viewer tests. PSE scope now includes Viewer/API,
integration entry points and existing DTO/IPC code, activating Linux/macOS
read-model evidence for related changes. No gate is weakened.

Draft until remote CI and a human desktop inspection have passed. No auto-merge.
