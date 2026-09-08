# Waveform 2.0 — M7

Status: implementation and synthetic automated/visual verification completed locally. M7 acceptance remains open until approved copied samples receive visual review. See [implementation and verification record](WAVEFORM_2_IMPLEMENTATION_STATUS.md).

## Milestone boundary

M6 Waveform 1.5 prepares the Inspector's available space, measured width/DPR, cancellable consumers, and one Workspace Preview Controller. M7 owns the analyzer, query contract, binary cache, Canvas rendering, navigation, frame selection, ranged preview, and read-only marker contract. Portable Project and Slice/Sample Chain remain separate milestones. AUTO-SLICE-1 already present on main is retained as an independent module/API; this integration does not replace its analysis or draft contracts.

## Query contract

The unit is an audio frame (one simultaneous value per channel). All ranges are half-open `[startFrame, endFrameExclusive)` and use safe integer frame numbers. `channelMode` initially accepts only `separate`; mono is one lane, stereo is independent L/R, and other layouts return `UNSUPPORTED_CHANNEL_LAYOUT`. No approximate downmix is exposed. An actual mix would require PCM analysis with an explicitly versioned mix formula.

`v2_audio_waveform_prepare(rootId, assetId)` schedules bounded background work and reports QUEUED, GENERATING, READY with sampleRate/channelCount/totalFrames, or a terminal error. The read-only source is resolved from the live catalog and RootRegistry. No path or content hash is exposed to the frontend. Shared preparation is keyed by content; consumers can stop polling without destroying useful work.

`v2_audio_waveform_query(rootId, assetId, query)` accepts startFrame, endFrameExclusive, targetPoints and channelMode. A successful response has `schema: waveform-query:v2`, `analyzerVersion: waveform:v2`, source metadata, the requested range, P+1 `bucketBoundaries`, and P peaks per channel. Boundary i is `start + floor((end-start)*i/P)`, calculated with u128 intermediates. P must be 1..4096 and cannot exceed the range's frame count. Invalid requests are rejected, not silently resampled or padded with invented empty buckets. The UI caps its request to the available frames.

Each peak contains min, max, rms and frameCount. Boundaries are shared by all channels. There is deliberately no misleading uniform framesPerBucket field. Queries are deterministic for the same source revision and query. Frame selection does not depend on bucket boundaries or display seconds.

## Analysis and precise edges

The canonical pyramid starts at 64 frames, then 256, 1024, 4096, and so on to one bucket. Internal records hold min/max f32, sumSquares f64 and frameCount u64. RMS is computed only for the response as sqrt(sumSquares / frameCount). Parents merge sums and counts, never averaged RMS values.

Query execution greedily merges completely contained, aligned pyramid buckets. Partial base-bucket boundaries are decoded from PCM. Nearby edge ranges are grouped into a single seek/read, including one-frame zoom. This prevents reporting peaks outside the requested frame interval and supports exact P-point output without adding raw PCM editing to M7.

The existing Symphonia 0.5.5 AIFF demuxer includes the eight SSND control bytes in its data length. The v2 path validates COMM/SSND extents and supplies bounded PCM packets directly to the codec. Source bytes are never patched. AIFF chunk sizes, layout and frame counts are checked; unsupported compression/block alignment is rejected.

## WFM2 cache

Local Application Support only; v1 JSON files coexist untouched.

Filename: `waveform-v2-<content-hash>.wfm2`.

All integers and IEEE float fields are little endian. Header: 8-byte WFM2 magic, u32 schema=2, u32 analyzer=2, 64 ASCII SHA-256 hex bytes, u32 sample rate, u32 channel count, u64 total frames, u32 level count. Each level index is u64 frames/bucket, u64 bucket count, u64 absolute offset. Header plus index is followed by a SHA-256 checksum.

Levels contain channel-major records. Each record is f32 min, f32 max, f64 sumSquares and u64 frameCount (24 bytes). Every chunk of at most 256 records is followed by SHA-256. Header/index validation checks version, identity, shape, offsets, arithmetic, declared length and the 256 MiB per-entry bound before reading records. Queries verify the chunks they read and validate finite amplitudes/counts. A corrupt entry is retained until a successfully generated replacement can be published atomically. Unsafe filesystem entries fail closed rather than being repaired.

The engine pins the cache directory descriptor and verifies its device/inode before publication. Cache writes use an exclusive operation-specific partial (0600), flush/fsync, atomic descriptor-relative rename and directory fsync. Descriptor-relative no-follow traversal prevents symlink swaps from redirecting opens or cache publication. Cache writes are reconstructible application-local state; they do not grant original-media write authority or bypass Intent → Plan → Apply for source changes.

## Source revision validation

Waveform queries reuse a verified hash only on macOS APFS with unchanged device, inode, size, mtime and ctime (including nanoseconds). FAT/exFAT, unknown filesystems and other platforms rehash conservatively. Reads use no-follow descriptor traversal, reject nonregular files and check source identity again after work. Preview creation and token redemption always rehash, including APFS. A mismatch fails closed; no source bytes are rewritten.

## Preview and interaction

`v2_audio_preview_range_create(rootId, assetId, range)` returns a one-shot ticket bound to the source/root with the actual frame range, sampleRate, byteLength, duration and truncation reason. Limits are 60 seconds and 32 MiB including the WAV header. Tickets expire after two minutes. Reading the ticket checks live root authority and source revision before redemption. Playback uses bounded PCM WAV, not continuous whole-file streaming.

One Workspace Preview Controller owns playback, pending load generation, object URL and source-frame clock. A replaced sample stops old audio, invalidates pending loads, clears loading state and revokes object URLs. The absolute playhead is previewStartFrame + floor(currentTime * sampleRate).

Canvas separates waveform/RMS drawing from lightweight selection/marker/playhead overlays. ResizeObserver and display DPR determine requested points. A shared API queue bounds active waveform queries to two; cancelled queued consumers never dispatch and completed stale queries cannot update the current view. Preparation has at most eight active jobs, one generation worker, and 32 retained job records. A source/query failure clears both canvases and stops preview until explicit retry. Wheel zooms around the pointer; Shift+wheel and Alt/middle drag pan; drag selects; click moves playhead and clears an outside selection; double click/F fits all; Escape clears selection; arrows move by one frame (Shift by 100ms). Shortcuts only run when waveform navigation owns keyboard focus. Overview permits viewport repositioning and keyboard pan.

Marker input contains assetId, analyzerVersion and read-only frame markers (transient/slice/loop). No analysis, slice generation or source write is implemented.

## Verification and acceptance

Synthetic temporary WAV/AIFF fixtures check direct PCM oracle agreement, exact point counts, unaligned edges, one-frame zoom, mono/stereo inverse phase, weighted RMS tails, source immutability, source changes, corrupt header/chunk recovery, unsafe paths and preview beyond 60 seconds. Frontend tests cover measured resolution, frame interactions, consumer cancellation, stale preview loads and bounded tickets.

Visual acceptance must use explicitly approved copied samples. No physical SD/CF card or original production library is test input. Record source hashes before/after and inspect mono, stereo with a silent lane, inverse phase, transient/sustained audio, long audio, resize, zoom/pan, selection and playback synchronization. Synthetic Canvas inspection alone does not complete real-sample acceptance.
