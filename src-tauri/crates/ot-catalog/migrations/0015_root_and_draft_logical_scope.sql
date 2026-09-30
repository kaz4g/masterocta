-- Repair catalogs that applied an earlier 0014 build with a globally unique
-- directory locator. Logical roots are keyed by device fingerprint plus locator.

DROP INDEX IF EXISTS roots_directory_locator;

CREATE UNIQUE INDEX IF NOT EXISTS roots_logical_root
    ON roots(fingerprint, canonical_path_hash)
    WHERE canonical_path_hash IS NOT NULL;

-- Slice drafts must not collide across logical roots on the same device.
CREATE TABLE slice_drafts_v15 (
    id INTEGER PRIMARY KEY,
    root_fingerprint TEXT NOT NULL,
    root_directory_hash TEXT NOT NULL DEFAULT '',
    relative_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    frame_count TEXT NOT NULL,
    region_start TEXT NOT NULL,
    region_end TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    UNIQUE (root_fingerprint, root_directory_hash, relative_path, source_hash)
);

INSERT INTO slice_drafts_v15 (
    id,
    root_fingerprint,
    root_directory_hash,
    relative_path,
    source_hash,
    sample_rate,
    frame_count,
    region_start,
    region_end,
    revision
)
SELECT
    id,
    root_fingerprint,
    '',
    relative_path,
    source_hash,
    sample_rate,
    frame_count,
    region_start,
    region_end,
    revision
FROM slice_drafts;

DROP TABLE slice_drafts;
ALTER TABLE slice_drafts_v15 RENAME TO slice_drafts;

CREATE TABLE slice_draft_markers_v15 (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    marker_id TEXT NOT NULL,
    start_frame TEXT NOT NULL,
    locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
    manual INTEGER NOT NULL CHECK (manual IN (0, 1)),
    candidate_id TEXT,
    estimated_attack TEXT,
    PRIMARY KEY (draft_id, ordinal),
    UNIQUE (draft_id, marker_id)
);

INSERT INTO slice_draft_markers_v15 SELECT * FROM slice_draft_markers;
DROP TABLE slice_draft_markers;
ALTER TABLE slice_draft_markers_v15 RENAME TO slice_draft_markers;

CREATE TABLE slice_draft_suppressed_v15 (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL,
    PRIMARY KEY (draft_id, candidate_id)
);

INSERT INTO slice_draft_suppressed_v15 SELECT * FROM slice_draft_suppressed;
DROP TABLE slice_draft_suppressed;
ALTER TABLE slice_draft_suppressed_v15 RENAME TO slice_draft_suppressed;

CREATE TABLE slice_draft_exclusions_v15 (
    draft_id INTEGER NOT NULL REFERENCES slice_drafts(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    start_frame TEXT NOT NULL,
    end_frame TEXT NOT NULL,
    PRIMARY KEY (draft_id, ordinal)
);

INSERT INTO slice_draft_exclusions_v15 SELECT * FROM slice_draft_exclusions;
DROP TABLE slice_draft_exclusions;
ALTER TABLE slice_draft_exclusions_v15 RENAME TO slice_draft_exclusions;
