DROP TRIGGER IF EXISTS sample_settings_owner_scope_insert;
DROP TRIGGER IF EXISTS sample_settings_owner_scope_update;

CREATE TABLE slot_assignments_new (
    id INTEGER PRIMARY KEY,
    state_document_id INTEGER NOT NULL
        REFERENCES state_documents(id) ON DELETE CASCADE,
    slot_kind TEXT NOT NULL CHECK (slot_kind IN ('static', 'flex')),
    slot_number INTEGER NOT NULL CHECK (
        (slot_kind = 'static' AND slot_number BETWEEN 1 AND 128)
        OR (slot_kind = 'flex' AND slot_number BETWEEN 1 AND 128)
    ),
    referenced_relative_path TEXT,
    reference_status TEXT NOT NULL CHECK (
        reference_status IN ('resolved', 'missing', 'invalid_path', 'ambiguous')
    ),
    UNIQUE (state_document_id, slot_kind, slot_number),
    CHECK (
        (reference_status IN ('resolved', 'missing', 'ambiguous')
            AND referenced_relative_path IS NOT NULL)
        OR (reference_status = 'invalid_path' AND referenced_relative_path IS NULL)
    )
);

INSERT INTO slot_assignments_new (
    id,
    state_document_id,
    slot_kind,
    slot_number,
    referenced_relative_path,
    reference_status
)
SELECT
    id,
    state_document_id,
    slot_kind,
    slot_number,
    referenced_relative_path,
    reference_status
FROM slot_assignments;

DROP TABLE slot_assignments;
ALTER TABLE slot_assignments_new RENAME TO slot_assignments;

CREATE INDEX slot_assignments_reference
    ON slot_assignments(reference_status, referenced_relative_path);

CREATE TABLE usage_edges_new (
    id INTEGER PRIMARY KEY,
    state_document_id INTEGER NOT NULL
        REFERENCES state_documents(id) ON DELETE CASCADE,
    project_document_id INTEGER NOT NULL
        REFERENCES state_documents(id) ON DELETE CASCADE,
    slot_assignment_id INTEGER
        REFERENCES slot_assignments(id) ON DELETE CASCADE,
    slot_kind TEXT NOT NULL CHECK (slot_kind IN ('static', 'flex')),
    slot_number INTEGER NOT NULL CHECK (
        (slot_kind = 'static' AND slot_number BETWEEN 1 AND 128)
        OR (slot_kind = 'flex' AND slot_number BETWEEN 1 AND 128)
    ),
    usage_kind TEXT NOT NULL CHECK (usage_kind IN ('machine', 'sample_lock')),
    track_index INTEGER NOT NULL CHECK (track_index BETWEEN 0 AND 7),
    part_index INTEGER CHECK (part_index BETWEEN 0 AND 3),
    pattern_index INTEGER CHECK (pattern_index BETWEEN 0 AND 15),
    step_index INTEGER CHECK (step_index BETWEEN 0 AND 63),
    audible INTEGER NOT NULL CHECK (audible IN (0, 1)),
    referenced_relative_path TEXT,
    reference_status TEXT NOT NULL CHECK (
        reference_status IN (
            'resolved',
            'missing',
            'invalid_path',
            'ambiguous',
            'unassigned_slot'
        )
    ),
    CHECK (
        (usage_kind = 'machine' AND part_index IS NOT NULL
            AND pattern_index IS NULL AND step_index IS NULL)
        OR (usage_kind = 'sample_lock' AND part_index IS NULL
            AND pattern_index IS NOT NULL AND step_index IS NOT NULL)
    ),
    CHECK (
        (reference_status IN ('resolved', 'missing', 'ambiguous')
            AND referenced_relative_path IS NOT NULL
            AND slot_assignment_id IS NOT NULL)
        OR (reference_status = 'invalid_path'
            AND referenced_relative_path IS NULL
            AND slot_assignment_id IS NOT NULL)
        OR (reference_status = 'unassigned_slot'
            AND referenced_relative_path IS NULL
            AND slot_assignment_id IS NULL)
    )
);

INSERT INTO usage_edges_new (
    id,
    state_document_id,
    project_document_id,
    slot_assignment_id,
    slot_kind,
    slot_number,
    usage_kind,
    track_index,
    part_index,
    pattern_index,
    step_index,
    audible,
    referenced_relative_path,
    reference_status
)
SELECT
    id,
    state_document_id,
    project_document_id,
    slot_assignment_id,
    slot_kind,
    slot_number,
    usage_kind,
    track_index,
    part_index,
    pattern_index,
    step_index,
    audible,
    referenced_relative_path,
    reference_status
FROM usage_edges;

DROP TABLE usage_edges;
ALTER TABLE usage_edges_new RENAME TO usage_edges;

CREATE INDEX usage_edges_reference
    ON usage_edges(reference_status, referenced_relative_path);

CREATE INDEX usage_edges_project_slot
    ON usage_edges(project_document_id, slot_kind, slot_number);

CREATE UNIQUE INDEX usage_edges_machine_coordinate
    ON usage_edges(state_document_id, track_index, part_index)
    WHERE usage_kind = 'machine';

CREATE UNIQUE INDEX usage_edges_sample_lock_coordinate
    ON usage_edges(state_document_id, track_index, pattern_index, step_index)
    WHERE usage_kind = 'sample_lock';

CREATE TRIGGER sample_settings_owner_scope_insert
BEFORE INSERT ON sample_settings
WHEN (
    NEW.owner_kind = 'slot_assignment'
    AND NOT EXISTS (
        SELECT 1
        FROM slot_assignments
        JOIN state_documents
          ON state_documents.id = slot_assignments.state_document_id
        WHERE slot_assignments.id = NEW.slot_assignment_id
          AND state_documents.root_id = NEW.root_id
          AND state_documents.scan_session_id = NEW.scan_session_id
    )
) OR (
    NEW.owner_kind = 'file_instance_sidecar'
    AND NOT EXISTS (
        SELECT 1
        FROM file_instances
        WHERE file_instances.id = NEW.file_instance_id
          AND file_instances.root_id = NEW.root_id
          AND file_instances.scan_session_id = NEW.scan_session_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'sample settings owner scope mismatch');
END;

CREATE TRIGGER sample_settings_owner_scope_update
BEFORE UPDATE OF root_id, scan_session_id, owner_kind, slot_assignment_id, file_instance_id
ON sample_settings
WHEN (
    NEW.owner_kind = 'slot_assignment'
    AND NOT EXISTS (
        SELECT 1
        FROM slot_assignments
        JOIN state_documents
          ON state_documents.id = slot_assignments.state_document_id
        WHERE slot_assignments.id = NEW.slot_assignment_id
          AND state_documents.root_id = NEW.root_id
          AND state_documents.scan_session_id = NEW.scan_session_id
    )
) OR (
    NEW.owner_kind = 'file_instance_sidecar'
    AND NOT EXISTS (
        SELECT 1
        FROM file_instances
        WHERE file_instances.id = NEW.file_instance_id
          AND file_instances.root_id = NEW.root_id
          AND file_instances.scan_session_id = NEW.scan_session_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'sample settings owner scope mismatch');
END;
