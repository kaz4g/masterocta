//! CT-04 — populated schema v7 databases must survive the production migrator.

use super::{apply_migration, configure_connection, SqliteCatalog, LATEST_SCHEMA_VERSION};
use ot_domain::{
    SampleReferenceStatus, SampleSettingsOwner, SampleSlotKind, SampleUsageKind, StateDocumentKind,
    StateDocumentParseStatus, StateDocumentRole,
};
use ot_storage_ports::{CatalogRootIdentity, LibraryCatalog};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use tempfile::TempDir;

const CT04: &str = "CT-04";
const HISTORICAL_V7: &[(u64, &str)] = &[
    (1, include_str!("historical_v7/0001_catalog_foundation.sql")),
    (2, include_str!("historical_v7/0002_file_inventory.sql")),
    (
        3,
        include_str!("historical_v7/0003_project_usage_graph.sql"),
    ),
    (
        4,
        include_str!("historical_v7/0004_sample_settings_slices.sql"),
    ),
    (
        5,
        include_str!("historical_v7/0005_manual_asset_metadata.sql"),
    ),
    (
        6,
        include_str!("historical_v7/0006_project_compatibility_evidence.sql"),
    ),
    (7, include_str!("historical_v7/0007_slice_drafts.sql")),
];
const ROOT_FINGERPRINT: &str =
    "rootfp:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ASSET_HASH: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STAMP: &str = "2020-01-01T00:00:00.000Z";

fn fail(stage: &str, expected: &str, observed: &str) -> ! {
    panic!("{CT04} failed at {stage}: expected {expected}; observed {observed}");
}

fn database_path(directory: &TempDir) -> PathBuf {
    directory
        .path()
        .canonicalize()
        .unwrap()
        .join("v7-populated.sqlite3")
}

fn apply_historical_v7(connection: &mut Connection) {
    configure_connection(connection).unwrap();
    for (version, sql) in HISTORICAL_V7 {
        connection.execute_batch(sql).unwrap_or_else(|error| {
            fail(
                "historical_v7_apply",
                &format!("migration {version} applies"),
                &error.to_string(),
            );
        });
        connection
            .execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![*version as i64, STAMP],
            )
            .unwrap();
    }
}

fn populate_v7(connection: &Connection) {
    connection
        .execute_batch(&format!(
            "
INSERT INTO roots (
    id, fingerprint, identity_is_stable, display_name,
    last_observed_revision, last_observed_at, latest_completed_scan_revision
) VALUES (
    1, '{ROOT_FINGERPRINT}', 1, 'Populated V7', 1, '{STAMP}', 1
);

INSERT INTO scan_sessions (
    id, root_id, revision, status, started_at, completed_at
) VALUES (1, 1, 1, 'completed', '{STAMP}', '{STAMP}');

INSERT INTO sets (
    root_id, scan_session_id, relative_path, display_name, has_audio_pool, sort_order
) VALUES (1, 1, 'SET', 'SET', 1, 0);

INSERT INTO projects (
    root_id, scan_session_id, relative_path, display_name, is_standalone,
    parent_set_relative_path, has_project_file, has_banks, sort_order
) VALUES (
    1, 1, 'SET/PROJECT', 'PROJECT', 0, 'SET', 1, 1, 0
);

INSERT INTO state_documents (
    id, root_id, scan_session_id, project_relative_path, source_relative_path,
    document_kind, document_role, bank_index, parse_status,
    parser_name, parser_revision, source_version, compatibility_evidence
) VALUES
    (1, 1, 1, 'SET/PROJECT', 'SET/PROJECT/project.work',
     'project', 'working', NULL, 'parsed',
     'masterocta/ot-codec-project', 'v1', 'R0173      1.40', 'verified_master_octa_fixture'),
    (2, 1, 1, 'SET/PROJECT', 'SET/PROJECT/project.strd',
     'project', 'saved_checkpoint', NULL, 'parsed',
     'masterocta/ot-codec-project', 'v1', 'R0173      1.40', 'verified_master_octa_fixture'),
    (3, 1, 1, 'SET/PROJECT', 'SET/PROJECT/bank01.work',
     'bank', 'working', 0, 'parsed',
     'masterocta/ot-tools-io', 'fixture-revision', 'bank:23', NULL);

INSERT INTO slot_assignments (
    id, state_document_id, slot_kind, slot_number,
    referenced_relative_path, reference_status
) VALUES
    (10, 1, 'static', 1, 'SET/AUDIO/kick.wav', 'resolved'),
    (11, 1, 'flex', 2, 'SET/AUDIO/gone.wav', 'missing');

INSERT INTO usage_edges (
    id, state_document_id, project_document_id, slot_assignment_id,
    slot_kind, slot_number, usage_kind, track_index, part_index,
    pattern_index, step_index, audible, referenced_relative_path, reference_status
) VALUES
    (20, 3, 1, 10, 'static', 1, 'machine', 0, 0, NULL, NULL, 1,
     'SET/AUDIO/kick.wav', 'resolved'),
    (21, 3, 1, 11, 'flex', 2, 'sample_lock', 1, NULL, 0, 0, 0,
     'SET/AUDIO/gone.wav', 'missing');

INSERT INTO audio_assets (id, content_hash, byte_size)
VALUES (40, '{ASSET_HASH}', 128);

INSERT INTO file_instances (
    id, root_id, scan_session_id, relative_path, audio_asset_id,
    byte_size, modified_at_unix_ns, storage_scope, hash_freshness
) VALUES (
    50, 1, 1, 'SET/AUDIO/kick.wav', 40, 128, 1, 'set_audio_pool', 'computed_this_scan'
);

INSERT INTO sample_settings (
    id, root_id, scan_session_id, owner_kind, source_relative_path,
    marker_source_relative_path, slot_assignment_id, file_instance_id,
    parse_status, parser_name, parser_revision, source_version, source_os_version,
    evidence, gain, tempo_x24, trim_bars_x100, loop_bars_x100, stretch_mode,
    loop_mode, trig_quantization, trim_start, trim_end, loop_start
) VALUES
    (30, 1, 1, 'slot_assignment', 'SET/PROJECT/project.work',
     'SET/PROJECT/markers.work', 10, NULL,
     'parsed', 'masterocta/ot-tools-io', 'fixture-revision', '1.40A', '1.40A',
     'reproduced_fixture_observation', 48, 2880, 400, NULL, 2,
     0, -1, 0, 1000, 0),
    (31, 1, 1, 'file_instance_sidecar', 'SET/AUDIO/kick.ot',
     NULL, NULL, 50,
     'parsed', 'masterocta/ot-tools-io', 'fixture-revision', 'sample-settings:2', NULL,
     'legacy_implementation_observation', NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL);

INSERT INTO sample_slices (
    sample_settings_id, slice_index, trim_start, trim_end, loop_start
) VALUES (30, 0, 0, 1000, 4294967295);

INSERT INTO tags (id, name, created_at) VALUES (60, 'kick', '{STAMP}');
INSERT INTO tag_assignments (audio_asset_id, tag_id, source, assigned_at)
VALUES (40, 60, 'user', '{STAMP}');
INSERT INTO notes (audio_asset_id, body, source, created_at, updated_at)
VALUES (40, 'owned kick note', 'user', '{STAMP}', '{STAMP}');
"
        ))
        .unwrap_or_else(|error| {
            fail(
                "populate_v7",
                "v7-only columns accept the fixture rows",
                &error.to_string(),
            );
        });
}

struct PreservedRows {
    assignment_ids: Vec<i64>,
    usage_ids: Vec<i64>,
    settings_ids: Vec<i64>,
    slice_count: i64,
    tag_name: String,
    note_body: String,
    file_path: String,
    asset_hash: String,
}

fn read_preserved(connection: &Connection) -> PreservedRows {
    let assignment_ids = query_ids(connection, "SELECT id FROM slot_assignments ORDER BY id");
    let usage_ids = query_ids(connection, "SELECT id FROM usage_edges ORDER BY id");
    let settings_ids = query_ids(connection, "SELECT id FROM sample_settings ORDER BY id");
    let slice_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM sample_slices", [], |row| row.get(0))
        .unwrap();
    let tag_name: String = connection
        .query_row("SELECT name FROM tags WHERE id = 60", [], |row| row.get(0))
        .unwrap();
    let note_body: String = connection
        .query_row(
            "SELECT body FROM notes WHERE audio_asset_id = 40",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let file_path: String = connection
        .query_row(
            "SELECT relative_path FROM file_instances WHERE id = 50",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let asset_hash: String = connection
        .query_row(
            "SELECT content_hash FROM audio_assets WHERE id = 40",
            [],
            |row| row.get(0),
        )
        .unwrap();
    PreservedRows {
        assignment_ids,
        usage_ids,
        settings_ids,
        slice_count,
        tag_name,
        note_body,
        file_path,
        asset_hash,
    }
}

fn query_ids(connection: &Connection, sql: &str) -> Vec<i64> {
    let mut statement = connection.prepare(sql).unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|value| value.unwrap())
        .collect()
}

fn assert_integrity(catalog: &SqliteCatalog) {
    let enabled: bool = catalog
        .connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    if !enabled {
        fail("foreign_keys", "ON", "OFF");
    }
    let mut foreign_keys = catalog
        .connection
        .prepare("PRAGMA foreign_key_check")
        .unwrap();
    if foreign_keys.query([]).unwrap().next().unwrap().is_some() {
        fail("foreign_key_check", "no violations", "violations present");
    }
    let integrity: String = catalog
        .connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    if integrity != "ok" {
        fail("integrity_check", "ok", &integrity);
    }
}

fn assert_preserved_graph(catalog: &SqliteCatalog, expected: &PreservedRows) {
    let observed = read_preserved(&catalog.connection);
    if observed.assignment_ids != expected.assignment_ids {
        fail(
            "slot_assignment_ids",
            &format!("{:?}", expected.assignment_ids),
            &format!("{:?}", observed.assignment_ids),
        );
    }
    if observed.usage_ids != expected.usage_ids {
        fail(
            "usage_edge_ids",
            &format!("{:?}", expected.usage_ids),
            &format!("{:?}", observed.usage_ids),
        );
    }
    if observed.settings_ids != expected.settings_ids {
        fail(
            "sample_settings_ids",
            &format!("{:?}", expected.settings_ids),
            &format!("{:?}", observed.settings_ids),
        );
    }
    if observed.slice_count != expected.slice_count {
        fail(
            "sample_slices",
            &expected.slice_count.to_string(),
            &observed.slice_count.to_string(),
        );
    }
    if observed.tag_name != expected.tag_name || observed.note_body != expected.note_body {
        fail(
            "manual_metadata",
            &format!("{} / {}", expected.tag_name, expected.note_body),
            &format!("{} / {}", observed.tag_name, observed.note_body),
        );
    }
    if observed.file_path != expected.file_path || observed.asset_hash != expected.asset_hash {
        fail(
            "file_inventory",
            &format!("{} {}", expected.file_path, expected.asset_hash),
            &format!("{} {}", observed.file_path, observed.asset_hash),
        );
    }

    let snapshot = catalog
        .load_latest_snapshot(&CatalogRootIdentity::new(ROOT_FINGERPRINT).unwrap())
        .unwrap()
        .unwrap_or_else(|| fail("catalog_load", "snapshot present", "None"));
    if snapshot.slot_assignments.len() != 2 {
        fail(
            "loaded_assignments",
            "2",
            &snapshot.slot_assignments.len().to_string(),
        );
    }
    let static_slot = snapshot
        .slot_assignments
        .iter()
        .find(|assignment| assignment.slot.kind() == SampleSlotKind::Static)
        .unwrap();
    if static_slot.reference_status != SampleReferenceStatus::Resolved
        || static_slot
            .referenced_file_relative_path
            .as_ref()
            .map(|path| path.as_str())
            != Some("SET/AUDIO/kick.wav")
    {
        fail(
            "static_assignment",
            "Resolved SET/AUDIO/kick.wav",
            &format!(
                "{:?} {:?}",
                static_slot.reference_status, static_slot.referenced_file_relative_path
            ),
        );
    }
    let flex_slot = snapshot
        .slot_assignments
        .iter()
        .find(|assignment| assignment.slot.kind() == SampleSlotKind::Flex)
        .unwrap();
    if flex_slot.reference_status != SampleReferenceStatus::Missing {
        fail(
            "flex_assignment",
            "Missing",
            &format!("{:?}", flex_slot.reference_status),
        );
    }
    if snapshot.usage_edges.len() != 2 {
        fail(
            "loaded_usage",
            "2 usage edges with preserved ownership",
            &snapshot.usage_edges.len().to_string(),
        );
    }
    let machine = snapshot
        .usage_edges
        .iter()
        .find(|edge| edge.usage_kind == SampleUsageKind::Machine)
        .unwrap();
    if machine.track_index != 0 || machine.part_index != Some(0) {
        fail(
            "machine_usage",
            "track 0 part 0",
            &format!("{} {:?}", machine.track_index, machine.part_index),
        );
    }
    let lock = snapshot
        .usage_edges
        .iter()
        .find(|edge| edge.usage_kind == SampleUsageKind::SampleLock)
        .unwrap();
    if lock.pattern_index != Some(0) || lock.step_index != Some(0) {
        fail(
            "sample_lock_usage",
            "pattern 0 step 0",
            &format!("{:?} {:?}", lock.pattern_index, lock.step_index),
        );
    }
    if snapshot.sample_settings.len() != 2 {
        fail(
            "loaded_settings",
            "slot-owned and file-owned settings both present",
            &snapshot.sample_settings.len().to_string(),
        );
    }
    let slot_settings = snapshot
        .sample_settings
        .iter()
        .find(|settings| settings.owner == SampleSettingsOwner::SlotAssignment)
        .unwrap();
    if slot_settings.slices.len() != 1 || slot_settings.gain != Some(48) {
        fail(
            "slot_settings",
            "gain 48 and one slice",
            &format!(
                "gain={:?} slices={}",
                slot_settings.gain,
                slot_settings.slices.len()
            ),
        );
    }
    let file_settings = snapshot
        .sample_settings
        .iter()
        .find(|settings| settings.owner == SampleSettingsOwner::FileInstanceSidecar)
        .unwrap();
    if file_settings
        .file_instance_relative_path
        .as_ref()
        .map(|path| path.as_str())
        != Some("SET/AUDIO/kick.wav")
    {
        fail(
            "file_settings",
            "owned by SET/AUDIO/kick.wav",
            &format!("{:?}", file_settings.file_instance_relative_path),
        );
    }
    let work = snapshot
        .state_documents
        .iter()
        .find(|document| {
            document.role == StateDocumentRole::Working
                && document.kind == StateDocumentKind::Project
        })
        .unwrap();
    if work.parse_status != StateDocumentParseStatus::Parsed {
        fail(
            "state_documents",
            "working Project remains Parsed",
            &format!("{:?}", work.parse_status),
        );
    }
    let strd = snapshot
        .state_documents
        .iter()
        .find(|document| {
            document.role == StateDocumentRole::SavedCheckpoint
                && document.kind == StateDocumentKind::Project
        })
        .unwrap_or_else(|| {
            fail(
                "state_documents",
                "saved_checkpoint Project present",
                "missing",
            )
        });
    if strd.parse_status != StateDocumentParseStatus::Parsed {
        fail(
            "state_documents",
            "saved_checkpoint Project remains Parsed",
            &format!("{:?}", strd.parse_status),
        );
    }
    let has_saved_checkpoint: i64 = catalog
        .connection
        .query_row(
            "SELECT has_saved_checkpoint FROM projects WHERE relative_path = 'SET/PROJECT'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    if has_saved_checkpoint != 1 {
        fail(
            "has_saved_checkpoint",
            "1 after saved_checkpoint backfill",
            &has_saved_checkpoint.to_string(),
        );
    }
}

#[test]
fn ct04_v7_migration_leaves_projection_trusted() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    {
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_historical_v7(&mut connection);
        populate_v7(&connection);
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 7);
    }

    let catalog = SqliteCatalog::open(&path).unwrap();
    let version: i64 = catalog
        .connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, LATEST_SCHEMA_VERSION as i64);
    let untrusted_flag: i64 = catalog
        .connection
        .query_row(
            "SELECT observational_projection_untrusted FROM roots WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    if untrusted_flag != 0 {
        fail(
            "projection_trust",
            "observational_projection_untrusted=0 after v7→latest",
            &untrusted_flag.to_string(),
        );
    }
    if catalog
        .observational_projection_untrusted(&CatalogRootIdentity::new(ROOT_FINGERPRINT).unwrap())
        .unwrap()
    {
        fail(
            "projection_trust",
            "trusted after v7→latest migration",
            "observational_projection_untrusted=true",
        );
    }
}

#[test]
fn ct04_populated_v7_survives_production_migrator() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let expected = {
        let mut connection = Connection::open(&path).unwrap();
        apply_historical_v7(&mut connection);
        populate_v7(&connection);
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        if version != 7 {
            fail("input_schema", "7", &version.to_string());
        }
        let expected = read_preserved(&connection);
        drop(connection);
        expected
    };

    let catalog = SqliteCatalog::open(&path).unwrap_or_else(|error| {
        fail(
            "production_open",
            "SqliteCatalog::open migrates v7 to latest",
            &error.to_string(),
        )
    });
    let versions: i64 = catalog
        .connection
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    if versions != LATEST_SCHEMA_VERSION as i64 {
        fail(
            "schema_version",
            &LATEST_SCHEMA_VERSION.to_string(),
            &versions.to_string(),
        );
    }
    assert_integrity(&catalog);
    assert_preserved_graph(&catalog, &expected);
    drop(catalog);

    let reopened = SqliteCatalog::open(&path).unwrap();
    let versions_again: i64 = reopened
        .connection
        .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    if versions_again != LATEST_SCHEMA_VERSION as i64 {
        fail(
            "reopen_schema",
            &LATEST_SCHEMA_VERSION.to_string(),
            &versions_again.to_string(),
        );
    }
    assert_integrity(&reopened);
    assert_preserved_graph(&reopened, &expected);
}

#[test]
fn ct04_failed_migration_8_restores_foreign_keys_outside_transaction() {
    let mut connection = Connection::open_in_memory().unwrap();
    configure_connection(&connection).unwrap();
    apply_historical_v7(&mut connection);
    populate_v7(&connection);
    let version_before: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    if version_before != 7 {
        fail(
            "precondition",
            "schema version 7",
            &version_before.to_string(),
        );
    }
    let before: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    if !before {
        fail("precondition", "foreign_keys ON", "OFF");
    }

    let migration_8 = include_str!("../migrations/0008_reference_ambiguous.sql");
    let failing_sql = format!("{migration_8}\nTHIS IS NOT SQL;");
    let error = apply_migration(&mut connection, 8, &failing_sql).unwrap_err();
    if !matches!(
        error,
        ot_storage_ports::CatalogError::Migration { version: 8, .. }
    ) {
        fail(
            "fault_injection",
            "Migration error for version 8",
            &format!("{error:?}"),
        );
    }

    let after: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    if !after {
        fail(
            "foreign_keys_restore",
            "foreign_keys ON after failed migration 8",
            "OFF",
        );
    }
    let version_after: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    if version_after != 7 {
        fail(
            "rollback",
            "schema version remains 7",
            &version_after.to_string(),
        );
    }
    let assignment_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM slot_assignments", [], |row| {
            row.get(0)
        })
        .unwrap();
    if assignment_count != 2 {
        fail(
            "rollback",
            "slot_assignments preserved",
            &assignment_count.to_string(),
        );
    }
}

#[test]
fn ct04_migration_8_foreign_key_check_blocks_commit() {
    let mut connection = Connection::open_in_memory().unwrap();
    configure_connection(&connection).unwrap();
    apply_historical_v7(&mut connection);
    populate_v7(&connection);

    let migration_8 = include_str!("../migrations/0008_reference_ambiguous.sql");
    let orphan_insert = "
INSERT INTO slot_assignments (
    id, state_document_id, slot_kind, slot_number,
    referenced_relative_path, reference_status
) VALUES (99999, 99999, 'static', 99, 'SET/AUDIO/orphan.wav', 'resolved');";
    let violating_sql = format!("{migration_8}{orphan_insert}");
    let error = apply_migration(&mut connection, 8, &violating_sql).unwrap_err();
    if !matches!(
        error,
        ot_storage_ports::CatalogError::Migration { version: 8, .. }
            | ot_storage_ports::CatalogError::Integrity { .. }
    ) {
        fail(
            "integrity_injection",
            "migration 8 blocked by foreign key check",
            &format!("{error:?}"),
        );
    }

    let after: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    if !after {
        fail(
            "foreign_keys_restore",
            "foreign_keys ON after integrity failure",
            "OFF",
        );
    }
    let version_after: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    if version_after != 7 {
        fail(
            "rollback",
            "schema version remains 7",
            &version_after.to_string(),
        );
    }
    let orphan_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM slot_assignments WHERE id = 99999)",
            [],
            |row| row.get(0),
        )
        .unwrap();
    if orphan_exists {
        fail("rollback", "orphan row absent", "orphan row committed");
    }
}

#[test]
fn ct04_existing_v9_database_marks_projection_untrusted() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    {
        let mut connection = Connection::open(&path).unwrap();
        configure_connection(&connection).unwrap();
        apply_historical_v7(&mut connection);
        for (version, sql) in super::MIGRATIONS {
            if *version >= 8 && *version <= 9 {
                apply_migration(&mut connection, *version, sql).unwrap();
            }
        }
        connection
            .execute_batch(&format!(
                "INSERT INTO roots (
                    id, fingerprint, identity_is_stable, display_name,
                    last_observed_revision, last_observed_at, latest_completed_scan_revision
                ) VALUES (
                    1, '{ROOT_FINGERPRINT}', 1, 'V9 Root', 1, '{STAMP}', 1
                );"
            ))
            .unwrap();
    }

    let catalog = SqliteCatalog::open(&path).unwrap();
    if !catalog
        .observational_projection_untrusted(&CatalogRootIdentity::new(ROOT_FINGERPRINT).unwrap())
        .unwrap()
    {
        fail(
            "projection_trust",
            "observational_projection_untrusted=true for existing v9",
            "trusted",
        );
    }
}
