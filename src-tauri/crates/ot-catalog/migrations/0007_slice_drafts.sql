-- User edits are independent of scan projections. Never cascade a rescan into
-- these tables. Decimal TEXT preserves every source PCM u64 frame exactly.
CREATE TABLE slice_drafts (
    id INTEGER PRIMARY KEY,
    root_fingerprint TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    frame_count TEXT NOT NULL,
    region_start TEXT NOT NULL,
    region_end TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    UNIQUE(root_fingerprint, relative_path, source_hash)
);
CREATE TABLE slice_draft_markers (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    marker_id TEXT NOT NULL,
    start_frame TEXT NOT NULL,
    locked INTEGER NOT NULL CHECK(locked IN (0, 1)),
    manual INTEGER NOT NULL CHECK(manual IN (0, 1)),
    candidate_id TEXT,
    estimated_attack TEXT,
    PRIMARY KEY(draft_id, ordinal),
    UNIQUE(draft_id, marker_id)
);
CREATE TABLE slice_draft_suppressed (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL,
    PRIMARY KEY(draft_id, candidate_id)
);
CREATE TABLE slice_draft_exclusions (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    start_frame TEXT NOT NULL,
    end_frame TEXT NOT NULL,
    PRIMARY KEY(draft_id, ordinal)
);
