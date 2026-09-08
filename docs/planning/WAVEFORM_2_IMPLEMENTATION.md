# M6 Library Workspace → Waveform 2.0

Status: implemented in [PR #103](https://github.com/kaz4g/masterocta/pull/103); exact-head CI results and merge recommendation are maintained on the PR. Release and Human Gate C evidence remain separate.

## Scope and order

The current request authorizes advancing the Library Workspace and Waveform 2.0
implementation on a feature branch. It does not change the frozen M5 candidate,
declare Human Gate C PASS, or authorize original-media writes.

| Step | Deliverable | Acceptance |
| --- | --- | --- |
| M6 workspace | Compact source/context controls, searchable sortable sample list, larger Inspector, operation dialog | Browsing stays primary; pending/recovery work stays discoverable when the dialog closes |
| M6 asset foundation | Reuse existing content-addressed AudioAsset and separate FileInstance | Tags remain asset-owned; selection remains file-instance-owned; no duplicate schema |
| WF2 query | Versioned range/resolution API with independent channels, source-frame coordinates | Canonical decimal u64 on IPC; half-open intervals; no raw paths |
| WF2 analysis | Independent channel min/max pyramid and exact range detail | Real detail below the old 256-frame floor; silence and opposite-polarity stereo preserved |
| WF2 interaction | Zoom, fit, scroll, range selection, channel views | Viewport and selection are separate; resize changes resolution; stale responses cannot replace the selected asset |
| WF2 audition | Bounded preview of the selected range, including beyond 60 seconds | Source coordinates retained; one-shot root-bound tokens; whole source validated |
| Follow-on AS | Transient detector, persisted slice draft, marker editing, derived output | Follow AUTO_SLICE_1_TECHNICAL_DESIGN.md and PR #102; not implied by waveform display completion |

## Ownership and contracts

`ot-audio::waveform_v2` owns peak calculation, cache validation and bounded
decoding. The Tauri composition root resolves the existing live RootId/AssetId
before work, runs decoding off the UI thread, and revalidates the session before
returning results. Catalog locks are held only while resolving sources.

The public query specifies an optional `[startFrame, endFrame)` and a point
budget (32–4096 per channel). An omitted range means the complete file. Frame
positions/counts are canonical decimal strings; sample rate and channel indices
are small JSON numbers. Coordinates count interleaved PCM frames, never samples
summed across channels or positions in resampled preview audio. This matches
AUTO-SLICE-1 without importing its unmerged draft implementation.

The original is opened read-only and its SHA-256 must match the catalog. Decoder
input is a private, verified local snapshot. The cache is versioned separately
from waveform:v1, keyed by content-derived AssetId. Cache hits still verify the
live source. Corrupt caches regenerate; unsafe cache entries fail closed.

Symphonia 0.5.5 includes the eight AIFF SSND control bytes in its PCM payload
length. The v2 decoder validates FORM/COMM/SSND boundaries and frame counts,
then corrects that length field only in the private copy. PCM bytes and original
files remain unchanged. Regression coverage includes a final SSND chunk, trailing
metadata and padding, truncation, inconsistent counts and unsupported offsets.

Large overview data use bounded multiresolution peaks. Requests below the cached
resolution, or crossing partial cache buckets, decode the exact requested
interval instead of stretching existing peaks or including out-of-range attacks.
No whole-file PCM is returned to React. Detailed reads can require a whole-file
decode; performance targets must be measured on the Mac before claiming them.

## UI behavior

- Source/session controls occupy the context bar; Set and location remain explicit.
- Search is scoped to the selected location; sorting and paging do not change identity.
- Waveform is primary in the Inspector; usage and local metadata remain available.
- Zoom operates around the current selection or viewport center. Fit restores the
  full file. Selection is independent of viewport; keyboard/numeric alternatives
  are provided for pointer interactions.
- Each asset change invalidates waveform/preview responses and releases Blob URLs.
- Changing the effective audition range also invalidates pending/completed previews.
- Single-frame and constant-value peaks render across their actual bucket extent;
  sample-level zoom never hides them as zero-length SVG strokes.
- Closing the operations dialog does not unmount or discard a prepared plan,
  execution status, recovery state, or backup approval flow. The dialog cannot
  close during a mutation. A persistent status button exposes pending operations.

## Verification and handoff

Use only generated WAV/AIFF data and temporary cache directories. Verify channel
separation, exact range boundaries, truncated sources, invalid ranges, changed
source rejection on cache hits, cache corruption, preview beyond 60 seconds,
and byte-for-byte original preservation. Test asset-switch races and continued
operation discovery after closing the dialog. Run frontend/build/architecture,
Rust fmt/clippy/tests, and the available UI E2E suite. Record actual results and
environment blockers here before handoff. Dependency/lockfile changes are not
needed. M7 transient analysis, derived-asset writes and hardware sign-off are
separate acceptance items; this document does not mark the full M7 milestone done.

## Validation record (2026-09-08)

- Initial local frontend suite: 63 files / 489 tests PASS, with the thread pool
  selected for this restricted runtime. Subsequent waveform regression tests:
  15/15 PASS, including stale previews, precise coordinates and constant peaks.
- TypeScript and Vite production build: PASS. Existing bundle-size warnings remain.
- Containment: PASS; the exact allowlist adds only the two read-only audio commands.
- Gate C contracts: 117/118 PASS. The existing unreadable-file subprocess test
  cannot run its uid/gid-switched child in this environment; no gate rule was changed.
- Rust tooling and architecture metadata: unavailable locally because
  cargo/rustc/rustfmt are absent. GitHub CI is the Rust validation environment.
- Local Chromium E2E: blocked before tests by `socket() failed: Operation not
  permitted` in Chromium process-singleton startup. The existing rename E2E routes
  were adapted to the operations dialog; two Waveform Workspace E2Es were added.
- Dependencies, lockfiles, release workflow, frozen candidates and media: unchanged.

GitHub validation before the final AIFF/drawing refinements (run 34173970881)
passed architecture, containment, Rust formatting and Clippy; frontend checks
(63 files / 490 tests), both Gate C contract suites (118 tests total), production
build, 426 E2Es and Linux/macOS synthetic smoke passed. The new AIFF regression
exposed the decoder length issue above; its correction and the retained regression
are subject to the final PR checks. Do not infer final-head success from this
earlier run; use the checks and evidence recorded on PR #103.

Merge requires confirmed Rust and UI E2E checks. Peak cache
budget is 256 MiB for v2 entries, individual entries at most 64 MiB. Input is capped
at 2 GiB; snapshot bytes live only in application cache and are unlinked immediately
on Unix. Range preview is bounded to 30 seconds / 16 MiB. Fine range requests can
re-decode a complete file; Mac latency/large-library targets are not measured here.
