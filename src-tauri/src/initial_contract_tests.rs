//! Initial inter-process contract tests (CT-01 / CT-02 / CT-03).
//!
//! These tests drive the real Scan → SQLite store/load → Plan → Prepare →
//! Continue → Apply → rescan path. Observed SlotAssignment, Ambiguous,
//! RenameImpactPlan, and Prepared values come from production code, not
//! hand-built success fixtures.

use super::{
    apply_rename_sync, authorize_rename_sync, catalog_identity, create_rename_backup_sync,
    enable_write_sync, load_library_snapshot, opaque_file_instance_id, plan_rename_sample_sync,
    prepare_rename_sync, register_root_sync, rename_continue_sync, scan_library_sync,
    RenameApplyStatusDto, RenamePlanDto, RenamePlanResponseDto,
};
use crate::catalog_runtime::{open_shared_catalog, SharedCatalog};
use crate::clone_runtime::{open_shared_clone_runtime, SharedCloneRuntime};
use crate::prepared_rename_runtime::{
    open_shared_prepared_rename_runtime, SharedPreparedRenameRuntime,
};
use crate::rename_write_runtime::{
    executor_local_paths_for_data_directory, open_shared_rename_write_runtime,
    SharedRenameWriteRuntime,
};
use crate::root_registry::{
    DeviceIdentityProvider, DeviceObservation, RootRegistry, RootRegistryError,
};
use crate::test_fixtures::default_bank_bytes;
use crate::write_runtime::{open_shared_write_runtime, SharedWriteRuntime};
use ot_codec::resolve_against_inventory;
use ot_domain::{
    LibrarySnapshot, RootId, RootRelativePath, SampleReferenceStatus, SampleSlotId, SampleSlotKind,
    SlotAssignment, StateDocumentParseStatus,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

const CT01: &str = "CT-01";
const CT02: &str = "CT-02";
const CT03: &str = "CT-03";

struct StableTestIdentity;

impl DeviceIdentityProvider for StableTestIdentity {
    fn observe(&self, _root: &Path) -> Result<DeviceObservation, RootRegistryError> {
        Ok(DeviceObservation {
            stable_key: "fixture-volume".into(),
            filesystem_type: Some("fixturefs".into()),
            total_capacity: Some(4096),
            mount_token: "fixture-mount".into(),
            stable: true,
        })
    }
}

struct ContractHarness {
    media_root: TempDir,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    data_directory: TempDir,
    registry: RootRegistry,
    catalog: SharedCatalog,
    clone_runtime: SharedCloneRuntime,
    rename_runtime: SharedRenameWriteRuntime,
    prepared_runtime: SharedPreparedRenameRuntime,
    write: SharedWriteRuntime,
    root_id: RootId,
}

struct FileRecord {
    size: u64,
    hash: String,
}

fn fail(scenario: &str, stage: &str, expected: &str, observed: &str) -> ! {
    panic!("{scenario} failed at {stage}: expected {expected}; observed {observed}");
}

fn assert_apply_verification_contract(
    scenario: &str,
    applied: &RenameApplyStatusDto,
    expected_file_count: u64,
) {
    if applied.mutation_state != "committed" {
        fail(
            scenario,
            "apply_mutation",
            "mutation_state=committed",
            &applied.mutation_state,
        );
    }
    if applied.verification_state != "passed" {
        fail(
            scenario,
            "apply_verification",
            "verification_state=passed",
            &format!(
                "{} (code={:?})",
                applied.verification_state, applied.verification_code
            ),
        );
    }
    if !applied.rescan_completed {
        fail(
            scenario,
            "apply_rescan",
            "rescan_completed=true",
            "rescan_completed=false",
        );
    }
    if applied.observed_file_count != expected_file_count {
        fail(
            scenario,
            "apply_file_count",
            &expected_file_count.to_string(),
            &applied.observed_file_count.to_string(),
        );
    }
    if applied.missing_reference_count != 0 {
        fail(
            scenario,
            "apply_missing_refs",
            "0",
            &applied.missing_reference_count.to_string(),
        );
    }
    if applied.invalid_reference_count != 0 {
        fail(
            scenario,
            "apply_invalid_refs",
            "0",
            &applied.invalid_reference_count.to_string(),
        );
    }
    if applied.unresolved_reference_count != 0 {
        fail(
            scenario,
            "apply_unresolved_refs",
            "0",
            &applied.unresolved_reference_count.to_string(),
        );
    }
}

fn encode_windows_1258(text: &str) -> Vec<u8> {
    let (encoded, _, had_unmappable) = encoding_rs::WINDOWS_1258.encode(text);
    assert!(
        !had_unmappable,
        "contract fixture text must be Windows-1258 reversible"
    );
    encoded.into_owned()
}

fn sample_block(kind: &str, number: &str, path: &str) -> String {
    format!(
        "[SAMPLE]\r\nTYPE={kind}\r\nSLOT={number}\r\nPATH={path}\r\nTRIGQUANTIZATION=-1\r\n[/SAMPLE]"
    )
}

fn project_meta() -> &'static str {
    "[META]\r\nTYPE=OCTATRACK DPS-1 PROJECT\r\nVERSION=19\r\nOS_VERSION=R0173      1.40\r\n[/META]\r\n"
}

fn project_containers() -> &'static str {
    "[SETTINGS]\r\nWRITEPROTECTED=0\r\n[/SETTINGS]\r\n\r\n[STATES]\r\nBANK=0\r\n[/STATES]\r\n"
}

fn build_project_document(samples: &[(&str, &str, &str)]) -> Vec<u8> {
    let mut body = project_meta().to_owned();
    body.push_str(project_containers());
    for (kind, number, path) in samples {
        body.push_str("\r\n");
        body.push_str(&sample_block(kind, number, path));
    }
    body.push_str("\r\n");
    encode_windows_1258(&body)
}

fn ct01_samples(
    static001_path: &str,
    flex133_path: &str,
) -> Vec<(&'static str, &'static str, String)> {
    vec![
        ("STATIC", "001", static001_path.to_owned()),
        ("STATIC", "002", "../AUDIO/002.wav".to_owned()),
        ("STATIC", "004", "../AUDIO/004.wav".to_owned()),
        ("STATIC", "005", "../AUDIO/005.wav".to_owned()),
        ("FLEX", "129", String::new()),
        ("FLEX", "130", String::new()),
        ("FLEX", "131", String::new()),
        ("FLEX", "132", String::new()),
        ("FLEX", "133", flex133_path.to_owned()),
        ("FLEX", "134", String::new()),
        ("FLEX", "135", String::new()),
        ("FLEX", "136", String::new()),
    ]
}

fn ct01_project_bytes(static001_path: &str, flex133_path: &str) -> Vec<u8> {
    let samples = ct01_samples(static001_path, flex133_path);
    let refs: Vec<(&str, &str, &str)> = samples
        .iter()
        .map(|(kind, number, path)| (*kind, *number, path.as_str()))
        .collect();
    build_project_document(&refs)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn write_labeled_wav(path: &Path, label: &str) {
    let sample_rate = 8_000_u32;
    let channels = 1_u16;
    let mut samples = (0..4_000)
        .flat_map(|index| {
            let sample = if index % 200 < 100 {
                i16::MAX / 2
            } else {
                i16::MIN / 2
            };
            sample.to_le_bytes()
        })
        .collect::<Vec<_>>();
    let label_bytes = label.as_bytes();
    samples.splice(0..label_bytes.len(), label_bytes.iter().copied());
    let data_size = u32::try_from(samples.len()).unwrap();
    let byte_rate = sample_rate * u32::from(channels) * 2;
    let block_align = channels * 2;
    let mut wav = Vec::with_capacity(44 + samples.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(&samples);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, wav).unwrap();
}

fn collect_media_manifest(root: &Path) -> BTreeMap<String, FileRecord> {
    let mut records = BTreeMap::new();
    collect_media_manifest_into(root, root, &mut records);
    records
}

fn collect_media_manifest_into(
    root: &Path,
    directory: &Path,
    output: &mut BTreeMap<String, FileRecord>,
) {
    let mut entries = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).unwrap();
        if metadata.file_type().is_symlink() {
            fail(
                "fixture",
                "manifest",
                "no symlinks under the media root",
                "symlink present",
            );
        }
        if metadata.is_dir() {
            collect_media_manifest_into(root, &path, output);
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let bytes = fs::read(&path).unwrap();
            output.insert(
                relative,
                FileRecord {
                    size: metadata.len(),
                    hash: sha256_hex(&bytes),
                },
            );
        }
    }
}

fn write_project_pair(project_dir: &Path, bytes: &[u8]) {
    fs::create_dir_all(project_dir).unwrap();
    fs::write(project_dir.join("project.work"), bytes).unwrap();
    fs::write(project_dir.join("project.strd"), bytes).unwrap();
    fs::write(project_dir.join("bank01.work"), default_bank_bytes()).unwrap();
    fs::write(project_dir.join("bank01.strd"), default_bank_bytes()).unwrap();
}

fn extract_sample_block(document: &[u8], kind: &str, number: &str) -> Vec<u8> {
    let needle = encode_windows_1258(&format!("[SAMPLE]\r\nTYPE={kind}\r\nSLOT={number}\r\n"));
    let start = document
        .windows(needle.len())
        .position(|window| window == needle.as_slice())
        .unwrap_or_else(|| {
            fail(
                "fixture",
                "extract_sample_block",
                &format!("{kind} {number} present"),
                "block missing",
            )
        });
    let end_marker = encode_windows_1258("[/SAMPLE]");
    let rest = &document[start..];
    let end = rest
        .windows(end_marker.len())
        .position(|window| window == end_marker.as_slice())
        .unwrap_or_else(|| {
            fail(
                "fixture",
                "extract_sample_block",
                "closed SAMPLE block",
                "unclosed block",
            )
        });
    document[start..start + end + end_marker.len()].to_vec()
}

#[cfg(target_os = "linux")]
fn filesystem_is_case_sensitive(directory: &Path) -> bool {
    let upper = directory.join("CaseProbeA");
    let lower = directory.join("caseprobea");
    fs::write(&upper, b"A").unwrap();
    fs::write(&lower, b"B").unwrap();
    let distinct = fs::read(&upper).unwrap() != fs::read(&lower).unwrap();
    let _ = fs::remove_file(&upper);
    let _ = fs::remove_file(&lower);
    distinct
}

fn open_harness_on(media_root: TempDir) -> ContractHarness {
    let registry = RootRegistry::new(Arc::new(StableTestIdentity), Duration::from_secs(60));
    let data_directory = TempDir::new().unwrap();
    let catalog = open_shared_catalog(data_directory.path()).unwrap();
    let clone_runtime = open_shared_clone_runtime(data_directory.path()).unwrap();
    let rename_runtime = open_shared_rename_write_runtime(data_directory.path()).unwrap();
    let prepared_runtime = open_shared_prepared_rename_runtime(
        data_directory.path(),
        executor_local_paths_for_data_directory(data_directory.path()).unwrap(),
    )
    .unwrap();
    let write = open_shared_write_runtime(data_directory.path()).unwrap();
    let session = match register_root_sync(&registry, &catalog, media_root.path().to_str().unwrap())
    {
        Ok(session) => session,
        Err(error) => fail(
            "harness",
            "register_scan_store",
            "successful root registration and catalog store",
            &format!("{error:?}"),
        ),
    };
    let root_id = RootId::new(session.root_id.clone()).unwrap();
    let resolved = registry.resolve(&root_id).unwrap();
    clone_runtime.install_test_verification(&resolved).unwrap();
    ContractHarness {
        media_root,
        data_directory,
        registry,
        catalog,
        clone_runtime,
        rename_runtime,
        prepared_runtime,
        write,
        root_id,
    }
}

impl ContractHarness {
    fn load_snapshot(&self) -> LibrarySnapshot {
        let resolved = self.registry.resolve(&self.root_id).unwrap();
        let identity = catalog_identity(&resolved.session).unwrap();
        match load_library_snapshot(&self.catalog, &identity) {
            Ok(snapshot) => snapshot,
            Err(error) => fail(
                "harness",
                "catalog_load",
                "loaded LibrarySnapshot",
                &format!("{error:?}"),
            ),
        }
    }

    fn file_instance_id(&self, snapshot: &LibrarySnapshot, relative_path: &str) -> String {
        let resolved = self.registry.resolve(&self.root_id).unwrap();
        let identity = catalog_identity(&resolved.session).unwrap();
        let file = snapshot
            .file_instances
            .iter()
            .find(|file| file.relative_path.as_str() == relative_path)
            .unwrap_or_else(|| {
                fail(
                    "harness",
                    "file_instance_lookup",
                    relative_path,
                    "file instance missing from catalog snapshot",
                )
            });
        opaque_file_instance_id(&identity, file)
    }

    fn enable_write(&self) {
        if let Err(error) = enable_write_sync(
            &self.registry,
            &self.catalog,
            &self.write,
            &self.rename_runtime,
            &self.root_id,
        ) {
            fail(
                "harness",
                "enable_write",
                "write grant issued",
                &format!("{error:?}"),
            );
        }
    }

    fn plan(&self, source_id: &str, destination: &str) -> RenamePlanResponseDto {
        match plan_rename_sample_sync(
            &self.registry,
            &self.catalog,
            &self.clone_runtime,
            &self.rename_runtime,
            &self.root_id,
            source_id,
            destination,
        ) {
            Ok(response) => response,
            Err(error) => fail(
                "harness",
                "plan",
                "RenamePlanResponseDto from production planner",
                &format!("{error:?}"),
            ),
        }
    }

    fn prepare_continue_apply(&self, plan: &RenamePlanDto) -> LibrarySnapshot {
        let authority = authorize_rename_sync(
            &self.registry,
            &self.catalog,
            &self.clone_runtime,
            &self.write,
            &self.rename_runtime,
            &self.root_id,
            &plan.plan_id,
        )
        .unwrap_or_else(|error| {
            fail(
                "harness",
                "authorize",
                "rename authority",
                &format!("{error:?}"),
            )
        });
        let backup = create_rename_backup_sync(
            &self.registry,
            &self.catalog,
            &self.clone_runtime,
            &self.write,
            &self.rename_runtime,
            &self.root_id,
            &plan.plan_id,
            &authority.authority_id,
        )
        .unwrap_or_else(|error| {
            fail(
                "harness",
                "backup",
                "verified rename backup",
                &format!("{error:?}"),
            )
        });
        if let Err(error) = prepare_rename_sync(
            &self.registry,
            &self.catalog,
            &self.clone_runtime,
            &self.write,
            &self.rename_runtime,
            &self.prepared_runtime,
            &self.root_id,
            &plan.plan_id,
            &authority.authority_id,
            &backup.snapshot_id,
        ) {
            fail(
                "harness",
                "prepare",
                "Prepared rename (raw PATH identity must follow the shared contract)",
                &format!("{error:?}"),
            );
        }
        let continuation = rename_continue_sync(
            &self.registry,
            &self.write,
            &self.clone_runtime,
            &self.rename_runtime,
            &self.prepared_runtime,
            &self.root_id,
            &plan.operation_id,
            &plan.operation_id,
        )
        .unwrap_or_else(|error| {
            fail(
                "harness",
                "continue",
                "continuation authority",
                &format!("{error:?}"),
            )
        });
        let pre_apply_snapshot = self.load_snapshot();
        let expected_file_count = pre_apply_snapshot.file_instances.len() as u64;
        let applied = apply_rename_sync(
            &self.registry,
            &self.catalog,
            &self.clone_runtime,
            &self.write,
            &self.rename_runtime,
            &self.prepared_runtime,
            &self.root_id,
            &plan.operation_id,
            &plan.operation_id,
            &continuation.continuation_authority_id,
        )
        .unwrap_or_else(|error| fail("harness", "apply", "committed apply", &format!("{error:?}")));
        assert_apply_verification_contract("harness", &applied, expected_file_count);
        match scan_library_sync(&self.registry, &self.catalog, &self.root_id) {
            Ok((_, live)) => live,
            Err(error) => fail(
                "harness",
                "rescan",
                "production live rescan after apply",
                &format!("{error:?}"),
            ),
        }
    }

    #[cfg(target_os = "linux")]
    fn prepared_snapshot_exists(&self) -> bool {
        let prepared_dir = self
            .data_directory
            .path()
            .join("MasterOCTa")
            .join("prepared-rename-plans");
        prepared_dir.is_dir()
            && fs::read_dir(&prepared_dir).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "json")
            })
    }
}

fn regular_assignments_for<'a>(
    snapshot: &'a LibrarySnapshot,
    document: &str,
) -> Vec<&'a SlotAssignment> {
    snapshot
        .slot_assignments
        .iter()
        .filter(|assignment| assignment.project_document_relative_path.as_str() == document)
        .collect()
}

fn assignment_for<'a>(
    snapshot: &'a LibrarySnapshot,
    document: &str,
    kind: SampleSlotKind,
    number: u16,
) -> &'a SlotAssignment {
    snapshot
        .slot_assignments
        .iter()
        .find(|assignment| {
            assignment.project_document_relative_path.as_str() == document
                && assignment.slot == SampleSlotId::new(kind, number).unwrap()
        })
        .unwrap_or_else(|| {
            fail(
                "catalog",
                "slot_assignment",
                &format!("{document} {kind:?} {number}"),
                "assignment missing",
            )
        })
}

fn assert_project_documents_parsed(scenario: &str, snapshot: &LibrarySnapshot) {
    let work = snapshot
        .state_documents
        .iter()
        .find(|document| document.source_relative_path.as_str() == "SET/PROJECT/project.work");
    let strd = snapshot
        .state_documents
        .iter()
        .find(|document| document.source_relative_path.as_str() == "SET/PROJECT/project.strd");
    match (work, strd) {
        (Some(work), Some(strd))
            if work.parse_status == StateDocumentParseStatus::Parsed
                && strd.parse_status == StateDocumentParseStatus::Parsed => {}
        (Some(work), Some(strd)) => fail(
            scenario,
            "scan_parse",
            "both Project documents Parsed",
            &format!("work={:?} strd={:?}", work.parse_status, strd.parse_status),
        ),
        _ => fail(
            scenario,
            "scan_parse",
            "project.work and project.strd present",
            "one or both Project documents missing",
        ),
    }
}

/// Recorder buffers are FLEX 129–136 and cannot be stored as `SampleSlotId`
/// (domain max is 128). A leaked buffer would appear as an unexpected Flex
/// assignment, not as `number() >= 129`.
fn assert_no_flex_assignments(scenario: &str, snapshot: &LibrarySnapshot) {
    let flex = snapshot
        .slot_assignments
        .iter()
        .filter(|assignment| assignment.slot.kind() == SampleSlotKind::Flex)
        .count();
    if flex != 0 {
        fail(
            scenario,
            "catalog_assignments",
            "zero Flex assignments (FLEX 129–136 must stay RecorderBufferId)",
            &flex.to_string(),
        );
    }
}

fn assignment_observation_keys(
    snapshot: &LibrarySnapshot,
) -> Vec<(String, String, u16, String, String)> {
    let mut keys = snapshot
        .slot_assignments
        .iter()
        .map(|assignment| {
            (
                assignment
                    .project_document_relative_path
                    .as_str()
                    .to_owned(),
                format!("{:?}", assignment.slot.kind()),
                assignment.slot.number(),
                format!("{:?}", assignment.reference_status),
                assignment
                    .referenced_file_relative_path
                    .as_ref()
                    .map(|path| path.as_str().to_owned())
                    .unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    keys.sort();
    keys
}

fn file_instance_paths(snapshot: &LibrarySnapshot) -> Vec<String> {
    let mut paths = snapshot
        .file_instances
        .iter()
        .map(|file| file.relative_path.as_str().to_owned())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn assert_live_matches_catalog(scenario: &str, live: &LibrarySnapshot, catalog: &LibrarySnapshot) {
    let live_assignments = assignment_observation_keys(live);
    let catalog_assignments = assignment_observation_keys(catalog);
    if live_assignments != catalog_assignments {
        fail(
            scenario,
            "rescan_vs_catalog",
            "live scan assignments match catalog load",
            &format!("live={live_assignments:?} catalog={catalog_assignments:?}"),
        );
    }
    let live_files = file_instance_paths(live);
    let catalog_files = file_instance_paths(catalog);
    if live_files != catalog_files {
        fail(
            scenario,
            "rescan_vs_catalog",
            "live scan file paths match catalog load",
            &format!("live={live_files:?} catalog={catalog_files:?}"),
        );
    }
}

/// Same-directory basename replace that does not call production
/// `rewrite_same_directory_path`. The observed prefix and separator stay as
/// written in the fixture PATH.
fn expected_rewritten_raw_path(from_raw_path: &str, new_basename: &str) -> String {
    match from_raw_path.rfind(['/', '\\']) {
        Some(index) if !from_raw_path[index + 1..].is_empty() => {
            format!("{}{new_basename}", &from_raw_path[..=index])
        }
        _ => fail(
            "fixture",
            "expected_rewritten_raw_path",
            "PATH with a directory prefix and basename",
            from_raw_path,
        ),
    }
}

fn assert_plan_targets_only_static001(scenario: &str, plan: &RenamePlanDto) {
    let updates: Vec<(String, String, u16)> = plan
        .state_document_impacts
        .iter()
        .flat_map(|impact| {
            impact.reference_updates.iter().map(|update| {
                (
                    update.project_document_relative_path.clone(),
                    update.slot_kind.to_owned(),
                    update.slot_number,
                )
            })
        })
        .collect();
    let expected = [
        (
            "SET/PROJECT/project.work".to_owned(),
            "static".to_owned(),
            1_u16,
        ),
        (
            "SET/PROJECT/project.strd".to_owned(),
            "static".to_owned(),
            1_u16,
        ),
    ];
    if updates.len() != 2 || !expected.iter().all(|item| updates.contains(item)) {
        fail(
            scenario,
            "plan_targets",
            "STATIC001 on project.work and project.strd only",
            &format!("{updates:?}"),
        );
    }
    if updates
        .iter()
        .any(|(_, kind, number)| kind == "flex" && *number == 133)
    {
        fail(
            scenario,
            "plan_targets",
            "FLEX133 excluded from rename plan",
            "FLEX133 present",
        );
    }
}

fn seed_standard_tree(root: &Path, project_bytes: &[u8], audio_files: &[(&str, &str)]) {
    let project_dir = root.join("SET/PROJECT");
    let audio_dir = root.join("SET/AUDIO");
    write_project_pair(&project_dir, project_bytes);
    for (name, label) in audio_files {
        write_labeled_wav(&audio_dir.join(name), label);
    }
    fs::write(root.join("SET/PROJECT/readme.txt"), b"unrelated-document").unwrap();
}

#[test]
fn ct01_recorder_buffer_survives_rename() {
    let media = TempDir::new().unwrap();
    let original = ct01_project_bytes("../AUDIO/001.wav", "../AUDIO/001.wav");
    seed_standard_tree(
        media.path(),
        &original,
        &[
            ("001.wav", "wav-001"),
            ("002.wav", "wav-002"),
            ("004.wav", "wav-004"),
            ("005.wav", "wav-005"),
            ("unused.wav", "wav-unused"),
        ],
    );
    let before = collect_media_manifest(media.path());
    let harness = open_harness_on(media);
    let snapshot = harness.load_snapshot();
    assert_project_documents_parsed(CT01, &snapshot);
    assert_no_flex_assignments(CT01, &snapshot);

    let work = regular_assignments_for(&snapshot, "SET/PROJECT/project.work");
    let strd = regular_assignments_for(&snapshot, "SET/PROJECT/project.strd");
    if work.len() != 4 || strd.len() != 4 || snapshot.slot_assignments.len() != 8 {
        fail(
            CT01,
            "catalog_assignments",
            "4 regular assignments per document, 8 total",
            &format!(
                "work={} strd={} total={}",
                work.len(),
                strd.len(),
                snapshot.slot_assignments.len()
            ),
        );
    }

    harness.enable_write();
    let source_id = harness.file_instance_id(&snapshot, "SET/AUDIO/001.wav");
    let response = harness.plan(&source_id, "SET/AUDIO/001-renamed.wav");
    let RenamePlanResponseDto::Planned(plan) = response else {
        fail(CT01, "plan", "Planned", "Blocked");
    };
    assert_plan_targets_only_static001(CT01, &plan);
    let live_after = harness.prepare_continue_apply(&plan);
    let after_snapshot = harness.load_snapshot();
    assert_live_matches_catalog(CT01, &live_after, &after_snapshot);
    for document in ["SET/PROJECT/project.work", "SET/PROJECT/project.strd"] {
        let static001 = assignment_for(&after_snapshot, document, SampleSlotKind::Static, 1);
        if static001.reference_status != SampleReferenceStatus::Resolved
            || static001
                .referenced_file_relative_path
                .as_ref()
                .map(|path| path.as_str())
                != Some("SET/AUDIO/001-renamed.wav")
        {
            fail(
                CT01,
                "rescan_static001",
                "Resolved SET/AUDIO/001-renamed.wav",
                &format!(
                    "{:?} {:?}",
                    static001.reference_status, static001.referenced_file_relative_path
                ),
            );
        }
        for (kind, number, expected_path) in [
            (SampleSlotKind::Static, 2_u16, "SET/AUDIO/002.wav"),
            (SampleSlotKind::Static, 4, "SET/AUDIO/004.wav"),
            (SampleSlotKind::Static, 5, "SET/AUDIO/005.wav"),
        ] {
            let assignment = assignment_for(&after_snapshot, document, kind, number);
            if assignment.reference_status != SampleReferenceStatus::Resolved
                || assignment
                    .referenced_file_relative_path
                    .as_ref()
                    .map(|path| path.as_str())
                    != Some(expected_path)
            {
                fail(
                    CT01,
                    "rescan_other_slots",
                    &format!("{expected_path} Resolved and unchanged"),
                    &format!(
                        "{:?} {:?}",
                        assignment.reference_status, assignment.referenced_file_relative_path
                    ),
                );
            }
        }
    }
    assert_no_flex_assignments(CT01, &after_snapshot);

    let expected_project = ct01_project_bytes("../AUDIO/001-renamed.wav", "../AUDIO/001.wav");
    for name in ["project.work", "project.strd"] {
        let observed = fs::read(harness.media_root.path().join("SET/PROJECT").join(name)).unwrap();
        if observed != expected_project {
            fail(
                CT01,
                "project_bytes",
                "independent expected bytes (only STATIC001 PATH changed)",
                &format!(
                    "{name} differed (len {} vs {})",
                    observed.len(),
                    expected_project.len()
                ),
            );
        }
        for slot in 129..=136_u16 {
            let before_block = extract_sample_block(&original, "FLEX", &format!("{slot:03}"));
            let after_block = extract_sample_block(&observed, "FLEX", &format!("{slot:03}"));
            if before_block != after_block {
                fail(
                    CT01,
                    "buffer_bytes",
                    &format!("FLEX{slot:03} byte-for-byte unchanged"),
                    "buffer block changed",
                );
            }
        }
    }

    let after = collect_media_manifest(harness.media_root.path());
    let renamed = after.get("SET/AUDIO/001-renamed.wav").unwrap_or_else(|| {
        fail(
            CT01,
            "audio_path",
            "SET/AUDIO/001-renamed.wav exists",
            "missing",
        )
    });
    let original_audio = before.get("SET/AUDIO/001.wav").unwrap();
    if renamed.hash != original_audio.hash || renamed.size != original_audio.size {
        fail(
            CT01,
            "audio_hash",
            "renamed WAV keeps content hash and size",
            "hash or size changed",
        );
    }
    if after.contains_key("SET/AUDIO/001.wav") {
        fail(
            CT01,
            "audio_path",
            "source path removed",
            "SET/AUDIO/001.wav still present",
        );
    }
    for unchanged in [
        "SET/AUDIO/002.wav",
        "SET/AUDIO/004.wav",
        "SET/AUDIO/005.wav",
        "SET/AUDIO/unused.wav",
        "SET/PROJECT/readme.txt",
        "SET/PROJECT/bank01.work",
        "SET/PROJECT/bank01.strd",
    ] {
        match (before.get(unchanged), after.get(unchanged)) {
            (Some(left), Some(right)) if left.size == right.size && left.hash == right.hash => {}
            _ => fail(
                CT01,
                "unrelated_media",
                &format!("{unchanged} path/size/hash unchanged"),
                "changed or missing",
            ),
        }
    }
}

fn run_ct02_case(scenario_suffix: &str, raw_path: &str) {
    let scenario = format!("{CT02}/{scenario_suffix}");
    let media = TempDir::new().unwrap();
    let original = build_project_document(&[("STATIC", "001", raw_path)]);
    seed_standard_tree(media.path(), &original, &[("Kick.wav", "wav-kick")]);
    let before = collect_media_manifest(media.path());
    let harness = open_harness_on(media);
    let snapshot = harness.load_snapshot();
    assert_project_documents_parsed(&scenario, &snapshot);

    let work = assignment_for(
        &snapshot,
        "SET/PROJECT/project.work",
        SampleSlotKind::Static,
        1,
    );
    if work.reference_status != SampleReferenceStatus::Resolved
        || work
            .referenced_file_relative_path
            .as_ref()
            .map(|path| path.as_str())
            != Some("SET/AUDIO/Kick.wav")
    {
        fail(
            &scenario,
            "catalog_resolve",
            "Resolved to SET/AUDIO/Kick.wav",
            &format!(
                "{:?} {:?}",
                work.reference_status, work.referenced_file_relative_path
            ),
        );
    }

    harness.enable_write();
    let source_id = harness.file_instance_id(&snapshot, "SET/AUDIO/Kick.wav");
    let response = harness.plan(&source_id, "SET/AUDIO/Renamed.wav");
    let RenamePlanResponseDto::Planned(plan) = response else {
        fail(&scenario, "plan", "Planned including STATIC001", "Blocked");
    };
    let planned_slots: Vec<u16> = plan
        .state_document_impacts
        .iter()
        .flat_map(|impact| {
            impact
                .reference_updates
                .iter()
                .map(|update| update.slot_number)
        })
        .collect();
    if !planned_slots.contains(&1) {
        fail(
            &scenario,
            "plan",
            "target slot STATIC001 included",
            "slot missing",
        );
    }
    let live_after = harness.prepare_continue_apply(&plan);
    let after_snapshot = harness.load_snapshot();
    assert_live_matches_catalog(&scenario, &live_after, &after_snapshot);
    for document in ["SET/PROJECT/project.work", "SET/PROJECT/project.strd"] {
        let updated = assignment_for(&after_snapshot, document, SampleSlotKind::Static, 1);
        if updated.reference_status != SampleReferenceStatus::Resolved
            || updated
                .referenced_file_relative_path
                .as_ref()
                .map(|path| path.as_str())
                != Some("SET/AUDIO/Renamed.wav")
        {
            fail(
                &scenario,
                "rescan",
                &format!("{document} Resolved SET/AUDIO/Renamed.wav"),
                &format!(
                    "{:?} {:?}",
                    updated.reference_status, updated.referenced_file_relative_path
                ),
            );
        }
    }

    let expected_raw = expected_rewritten_raw_path(raw_path, "Renamed.wav");
    let expected = build_project_document(&[("STATIC", "001", &expected_raw)]);
    for name in ["project.work", "project.strd"] {
        let observed = fs::read(harness.media_root.path().join("SET/PROJECT").join(name)).unwrap();
        if observed != expected {
            fail(
                &scenario,
                "project_bytes",
                "only the target PATH basename changed",
                &format!("{name} bytes differed"),
            );
        }
    }

    let after = collect_media_manifest(harness.media_root.path());
    let renamed = after.get("SET/AUDIO/Renamed.wav").unwrap_or_else(|| {
        fail(
            &scenario,
            "audio_path",
            "SET/AUDIO/Renamed.wav exists",
            "missing",
        )
    });
    let original_audio = before.get("SET/AUDIO/Kick.wav").unwrap();
    if renamed.hash != original_audio.hash {
        fail(
            &scenario,
            "audio_hash",
            "WAV content hash unchanged",
            "hash changed",
        );
    }
}

#[test]
fn ct02_unique_basename_case_is_consistent_through_prepare() {
    run_ct02_case("basename", "../AUDIO/kick.wav");
}

#[test]
fn ct02_unique_directory_case_is_consistent_through_prepare() {
    run_ct02_case("directory", "../audio/kick.wav");
}

#[test]
fn ct03_resolver_ambiguous_inventory_is_not_filesystem_substitute() {
    let project = RootRelativePath::parse("SET/PROJECT").unwrap();
    let inventory = HashSet::from([
        "SET/AUDIO/Kick.wav".to_owned(),
        "SET/AUDIO/kick.wav".to_owned(),
    ]);
    let (_path, status) = resolve_against_inventory(&project, "../AUDIO/KICK.wav", &inventory);
    if status != SampleReferenceStatus::Ambiguous {
        fail(
            CT03,
            "pure_resolver",
            "Ambiguous for two case-insensitive inventory hits",
            &format!("{status:?}"),
        );
    }
}

fn ct03_project_bytes() -> Vec<u8> {
    build_project_document(&[("STATIC", "001", "../AUDIO/KICK.wav")])
}

#[cfg(target_os = "linux")]
#[test]
fn ct03_filesystem_ambiguous_blocks_plan() {
    let media = TempDir::new().unwrap();
    fs::create_dir_all(media.path().join("SET/AUDIO")).unwrap();
    if !filesystem_is_case_sensitive(&media.path().join("SET/AUDIO")) {
        fail(
            CT03,
            "host_capability",
            "case-sensitive filesystem so Kick.wav and kick.wav can coexist",
            "case-insensitive host (this case is not executed and must not be counted as PASS)",
        );
    }
    eprintln!("{CT03} filesystem: case-sensitive host; executing binding case");
    seed_standard_tree(
        media.path(),
        &ct03_project_bytes(),
        &[("Kick.wav", "wav-Kick"), ("kick.wav", "wav-kick")],
    );
    let before = collect_media_manifest(media.path());
    let harness = open_harness_on(media);
    let snapshot = harness.load_snapshot();
    assert_project_documents_parsed(CT03, &snapshot);
    let assignment = assignment_for(
        &snapshot,
        "SET/PROJECT/project.work",
        SampleSlotKind::Static,
        1,
    );
    if assignment.reference_status != SampleReferenceStatus::Ambiguous {
        fail(
            CT03,
            "catalog_resolve",
            "Ambiguous from production resolver/store/load",
            &format!("{:?}", assignment.reference_status),
        );
    }

    harness.enable_write();
    for (source_path, destination) in [
        ("SET/AUDIO/Kick.wav", "SET/AUDIO/KickRenamed.wav"),
        ("SET/AUDIO/kick.wav", "SET/AUDIO/kickRenamed.wav"),
    ] {
        let source_id = harness.file_instance_id(&snapshot, source_path);
        match harness.plan(&source_id, destination) {
            RenamePlanResponseDto::Blocked(blocked) => {
                let codes: Vec<&str> = blocked
                    .block_reasons
                    .iter()
                    .map(|reason| reason.code.as_str())
                    .collect();
                if !codes.contains(&"UNRESOLVED_REFERENCE") {
                    fail(
                        CT03,
                        "plan",
                        "Blocked with UNRESOLVED_REFERENCE (planner mapping for Ambiguous)",
                        &format!("{codes:?}"),
                    );
                }
            }
            RenamePlanResponseDto::Planned(_) => {
                fail(
                    CT03,
                    "plan",
                    "Blocked (resolver-derived Ambiguous must stop planning)",
                    "Planned",
                );
            }
        }
    }
    if harness.prepared_snapshot_exists() {
        fail(
            CT03,
            "prepare_authority",
            "no Prepared snapshot on disk",
            "prepared-rename-plans JSON present",
        );
    }
    let after = collect_media_manifest(harness.media_root.path());
    if before.iter().any(|(path, left)| {
        after
            .get(path)
            .is_none_or(|right| right.size != left.size || right.hash != left.hash)
    }) || after.len() != before.len()
    {
        fail(
            CT03,
            "media_invariant",
            "every media path/size/hash unchanged",
            "media root changed",
        );
    }
}

#[test]
fn ct03_filesystem_unique_control_reaches_prepare() {
    let media = TempDir::new().unwrap();
    fs::create_dir_all(media.path().join("SET/AUDIO")).unwrap();
    seed_standard_tree(
        media.path(),
        &ct03_project_bytes(),
        &[("Kick.wav", "wav-Kick")],
    );
    let harness = open_harness_on(media);
    let snapshot = harness.load_snapshot();
    let assignment = assignment_for(
        &snapshot,
        "SET/PROJECT/project.work",
        SampleSlotKind::Static,
        1,
    );
    if assignment.reference_status != SampleReferenceStatus::Resolved
        || assignment
            .referenced_file_relative_path
            .as_ref()
            .map(|path| path.as_str())
            != Some("SET/AUDIO/Kick.wav")
    {
        fail(
            CT03,
            "control_catalog",
            "unique case match Resolved to SET/AUDIO/Kick.wav",
            &format!(
                "{:?} {:?}",
                assignment.reference_status, assignment.referenced_file_relative_path
            ),
        );
    }
    harness.enable_write();
    let source_id = harness.file_instance_id(&snapshot, "SET/AUDIO/Kick.wav");
    let response = harness.plan(&source_id, "SET/AUDIO/ControlRenamed.wav");
    let RenamePlanResponseDto::Planned(plan) = response else {
        fail(CT03, "control_plan", "Planned", "Blocked");
    };
    let authority = authorize_rename_sync(
        &harness.registry,
        &harness.catalog,
        &harness.clone_runtime,
        &harness.write,
        &harness.rename_runtime,
        &harness.root_id,
        &plan.plan_id,
    )
    .unwrap_or_else(|error| {
        fail(
            CT03,
            "control_authorize",
            "authority issued",
            &format!("{error:?}"),
        )
    });
    let backup = create_rename_backup_sync(
        &harness.registry,
        &harness.catalog,
        &harness.clone_runtime,
        &harness.write,
        &harness.rename_runtime,
        &harness.root_id,
        &plan.plan_id,
        &authority.authority_id,
    )
    .unwrap_or_else(|error| {
        fail(
            CT03,
            "control_backup",
            "backup verified",
            &format!("{error:?}"),
        )
    });
    if let Err(error) = prepare_rename_sync(
        &harness.registry,
        &harness.catalog,
        &harness.clone_runtime,
        &harness.write,
        &harness.rename_runtime,
        &harness.prepared_runtime,
        &harness.root_id,
        &plan.plan_id,
        &authority.authority_id,
        &backup.snapshot_id,
    ) {
        fail(
            CT03,
            "control_prepare",
            "Prepare succeeds for the unique-Resolved control",
            &format!("{error:?}"),
        );
    }
}
