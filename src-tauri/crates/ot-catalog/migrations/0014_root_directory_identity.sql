-- Device fingerprint stays a physical-device attribute and is no longer the
-- sole catalog identity. A logical root is the canonical directory locator
-- (`canonical_path_hash`, SHA-256 of `rootloc:v1\0` + the canonical path).
-- Existing rows are copied with a NULL locator. Display names are not used to
-- guess a path. The synthetic mac-derived root is the only backfill, and it
-- uses a fixed locator rather than a filesystem path.

CREATE TABLE roots_v14 (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    canonical_path_hash TEXT CHECK (
        canonical_path_hash IS NULL
        OR (
            length(canonical_path_hash) = 64
            AND canonical_path_hash NOT GLOB '*[^0-9a-f]*'
        )
    ),
    identity_is_stable INTEGER NOT NULL CHECK (identity_is_stable IN (0, 1)),
    display_name TEXT NOT NULL,
    last_observed_revision INTEGER NOT NULL CHECK (last_observed_revision >= 0),
    last_observed_at TEXT NOT NULL,
    latest_completed_scan_revision INTEGER CHECK (latest_completed_scan_revision > 0),
    observational_projection_untrusted INTEGER NOT NULL DEFAULT 0
        CHECK (observational_projection_untrusted IN (0, 1))
);

INSERT INTO roots_v14 (
    id,
    fingerprint,
    canonical_path_hash,
    identity_is_stable,
    display_name,
    last_observed_revision,
    last_observed_at,
    latest_completed_scan_revision,
    observational_projection_untrusted
)
SELECT
    id,
    fingerprint,
    NULL,
    identity_is_stable,
    display_name,
    last_observed_revision,
    last_observed_at,
    latest_completed_scan_revision,
    observational_projection_untrusted
FROM roots;

DROP TABLE roots;
ALTER TABLE roots_v14 RENAME TO roots;

CREATE UNIQUE INDEX roots_legacy_fingerprint
    ON roots(fingerprint)
    WHERE canonical_path_hash IS NULL;

CREATE UNIQUE INDEX roots_logical_root
    ON roots(fingerprint, canonical_path_hash)
    WHERE canonical_path_hash IS NOT NULL;

UPDATE roots
SET canonical_path_hash = 'db99f06b42c08df29edd9d7f0a7a0ccfe8fc47aac831c41a23d82bedb6eda84b'
WHERE fingerprint = 'rootfp:v1:13bdc6604b00a52484f01428a1a34715c78b14fb852702113a04631db05f6951'
  AND canonical_path_hash IS NULL;
