# Waveform 2.0 implementation status — 2026-09-08

Implementation and synthetic verification are complete locally. M7 is not yet accepted: visual acceptance with explicitly approved copied real samples remains open. This record captures pre-commit validation; subsequent delivery is recorded in Git and the pull request.

## Delivered

- M6 Inspector sizing, measured width/DPR, cancellable consumers and Workspace Preview Controller.
- M7 exact P-point frame queries with P+1 shared integer boundaries, independent mono/stereo min/max/RMS, weighted sumSquares/count aggregation and exact PCM edges.
- 64-frame, 4x binary pyramid; versioned WFM2 header/index and chunk checksums; bounded, descriptor-relative no-follow cache reads and atomic publication. v1 cache/API coexist.
- Conservative source revision verification (APFS high-resolution identity reuse for waveform queries only; all other filesystems rehash). Preview creation/redemption always rehash. Source bytes remain read-only.
- Bounded shared background generation and two concurrent frontend range queries. Stale results are ignored; source errors clear both canvases and stop playback until retry.
- Canvas/RMS, independent L/R lanes, zoom/pan/overview, frame selection, keyboard navigation, marker input and absolute preview playhead. Switching samples clears the previous frame clock and pending playback.
- One-shot, root/source-bound ranged preview with actual range, 60-second and 32 MiB limits, expiry and revalidation at delivery.
- M6/M7 milestone boundaries reconciled in the architecture document; previous Portable Project/Slice/AI/cloud work moves to M8–M11. Existing source-write gates remain unchanged.

## Final verification

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | Passed |
| `pnpm run test:frontend` | 53 files, 455 tests passed |
| `pnpm run build` | Passed; existing large-chunk and mixed dynamic/static Tauri import warnings remain |
| `pnpm run check:architecture` | Passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets --locked --offline -- -D warnings` | Passed |
| `cargo test --workspace --locked --offline -- --skip device_detection::tests::test_discover_devices` | 938 passed, 3 existing ignored, 1 explicitly excluded |
| `WAVEFORM_TEST_BROWSER_CHANNEL=chrome pnpm exec playwright test e2e/waveform-v2.spec.ts --reporter=line` | 1 passed with installed Chrome; latest run 16.8s |
| Scoped `git diff --check` | Passed |

Rust regressions include exact direct-PCM oracle agreement, unaligned ranges, one-frame zoom, stereo inverse phase, weighted tails, WAV/AIFF bounds, cache corruption and unsafe paths, same-size source changes with restored mtime, exact 32 MiB WAV limit, background queue sharing/bounds, closed/wrong roots and one-shot redemption. The ot-audio crate has 17 passing tests.

The browser test uses generated 120-second mono/stereo PCM and a mocked Tauri gateway, while playing an actual bounded WAV Blob. It covers resize, pointer zoom/pan, selection after 60 seconds, advancing absolute playhead, and sample switch back to Frame 0. Stereo, selected-range and mono screenshots were visually reviewed. It is not evidence of a native Tauri end-to-end run or real-sample acceptance. One intermediate Chrome run timed out waiting for playback to start; the subsequent final run passed without relaxing assertions. Unrelated legacy browser suites were not rerun.

The physical-device discovery test is deliberately excluded because it enumerates actual mounted media. All exercised filesystem tests use generated TempDirs or copies of repository fixtures, never original removable media. The 3 ignored tests are pre-existing. macOS Trash-dependent fixture tests require execution outside the sandbox; the final safe suite passed there.

## Dependency audit

Only an existing locked Rust dependency, `rustix =1.1.4`, became a direct ot-audio dependency; Cargo regenerated the lockfile offline with no version changes. JavaScript manifests/lockfiles are unchanged.

- `pnpm audit` completed and reported two HIGH advisories in existing development dependency browserslist 4.27.0: GHSA-c83g-rgw3-j3cx (unbounded query-result cache growth) and GHSA-73wf-gq98-2v4g (untrusted custom stats crash/prototype write). Both are in the Babel/Vite build dependency path. They are retained as an explicit existing build-tool risk for this feature-only change; dependency remediation is separate work, not an audit pass.
- `cargo audit` was not run: cargo-audit is not installed (`no such command: audit`). The repository skill prohibits globally installing it just to satisfy the gate.

## Environment and review boundary

The original worktree and dependencies were evicted by iCloud. After user authorization, hydration requests were issued and Finder Keep Downloaded was enabled. Whole-repository Git refresh/status can still stall; those pending commands were interrupted. Explicitly scoped diffs/stat/whitespace checks succeeded. No claim is made that the global untracked-file inventory completed.

Verification used a local temporary snapshot of baseline `b575ae2fd195dd77625c83ab231a069c1f55f187` plus the implementation files, with frozen dependencies restored offline from the existing cache. Final source files are byte-compared with the authorized worktree. No generated browser screenshots, dependency tree or build outputs are added to the repository.

## Remaining acceptance

Provide an approved copied-sample path before real-sample visual acceptance. Review mono, silent L/R lane, inverse phase, transient and sustained audio, long recordings, resize, zoom/pan, frame selection and preview synchronization; record copied-source hashes before/after. No approved path has been received. Synthetic results do not close this requirement. The pull request remains draft until this acceptance is completed; native release qualification is separate.
