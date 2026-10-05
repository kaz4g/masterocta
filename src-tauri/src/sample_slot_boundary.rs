//! Cross-line contract between the Project/Bank line and the Sample line
//! (#187, `docs/planning/SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md`).
//!
//! Every test works on a temporary copy of tracked fixtures plus synthetic WAV
//! files written by the test. Tracked fixtures are never read in place.

use crate::catalog_runtime::{open_shared_catalog, SharedCatalog};
use crate::derived_audio_runtime::{
    open_shared_derived_audio_runtime, DerivedAudioRuntime, OtAudioTrimProcessor,
    OtAudioTrimVerifier,
};
use crate::project_structure_command::read_project_structure_dto;
use crate::project_structure_reader::read_project_structure;
use crate::root_registry::RootRegistry;
use crate::slice_export_apply::slice_export_apply_sync;
use crate::v2_api::{
    catalog_identity, gate_c_register_and_index_root, gate_c_rescan_and_store,
    load_library_snapshot, opaque_asset_id, opaque_file_instance_id,
};
use ot_application::ApplyTrimDerivation;
use ot_domain::project_structure::{
    BankIndex, MachineKind, PartIndex, ProjectStructure, TrackIndex, TrackPlayback,
    TrackSlotReference,
};
use ot_domain::slice_draft::{DraftMarker, SliceDraft};
use ot_domain::slicing::{FrameRange, PcmFrame};
use ot_domain::{
    resolve_project_reference_syntax, slot_kind_rank, ContentHash, FileInstance, LibrarySnapshot,
    RootId, RootRelativePath, SampleReferenceStatus, SampleSlotId, SampleUsageKind,
    StateDocumentRole, TrimIntent,
};
use ot_storage_ports::slice_drafts::{SliceDraftBinding, SliceDraftCatalog};
use ot_storage_ports::{AssetDerivationCatalog, CatalogRootIdentity};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tempfile::TempDir;

const PROJECT: &str = "SET/PROJECT";
const PROJECT_WORK: &str = "SET/PROJECT/project.work";
const WORKING_BANK: &str = "SET/PROJECT/bank01.work";
const FIXTURE_FILES: [&str; 3] = ["project.work", "bank01.work", "bank01.strd"];
const FIRST_WAV_FRAMES: u32 = 2_000;

type TreeDigest = BTreeMap<String, (u64, String)>;

/// A Project slot reference whose catalog assignment resolved to a file.
#[derive(Clone, Debug)]
struct ResolvedMachineSlot {
    part: PartIndex,
    track: TrackIndex,
    slot: SampleSlotId,
    file: FileInstance,
}

struct Fixture {
    ot_root: TempDir,
    data: TempDir,
    registry: Arc<RootRegistry>,
    catalog: SharedCatalog,
    root_id: RootId,
    identity: CatalogRootIdentity,
    canonical_root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        Self::build(false)
    }

    /// The first two `[SAMPLE]` paths get byte-identical audio.
    fn with_duplicate_content() -> Self {
        Self::build(true)
    }

    fn build(duplicate_first_two: bool) -> Self {
        let ot_root = TempDir::new().unwrap();
        let project = ot_root.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in FIXTURE_FILES {
            fs::copy(fixture_dir().join(file), project.join(file)).unwrap();
        }
        let project_bytes = fs::read(project.join("project.work")).unwrap();
        let parsed = ot_codec::parse_project_document(&project_bytes);
        assert!(
            !parsed.regular_assignments.is_empty(),
            "fixture must reference samples"
        );
        let project_path = RootRelativePath::parse(PROJECT).unwrap();
        for (index, assignment) in parsed.regular_assignments.iter().enumerate() {
            let target =
                resolve_project_reference_syntax(&project_path, &assignment.raw_path).unwrap();
            let frames = if duplicate_first_two && index == 1 {
                FIRST_WAV_FRAMES
            } else {
                FIRST_WAV_FRAMES + u32::try_from(index).unwrap()
            };
            let path = ot_root.path().join(target.as_str());
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, ot_audio::test_minimal_wav(frames)).unwrap();
        }

        let data = TempDir::new().unwrap();
        let registry = Arc::new(RootRegistry::default());
        let catalog = open_shared_catalog(data.path()).unwrap();
        let (session, _) =
            gate_c_register_and_index_root(&registry, &catalog, ot_root.path().to_str().unwrap())
                .unwrap();
        let root_id = session.root_id.clone();
        let resolved = registry.resolve(&root_id).unwrap();
        let identity = catalog_identity(&resolved.session).unwrap();
        Self {
            ot_root,
            data,
            registry,
            catalog,
            root_id,
            identity,
            canonical_root: resolved.canonical_path,
        }
    }

    fn project_path() -> RootRelativePath {
        RootRelativePath::parse(PROJECT).unwrap()
    }

    fn structure(&self) -> ProjectStructure {
        read_project_structure(&self.canonical_root, &Self::project_path()).unwrap()
    }

    fn library(&self) -> LibrarySnapshot {
        load_library_snapshot(&self.catalog, &self.identity).unwrap()
    }

    fn rescan(&self) -> LibrarySnapshot {
        gate_c_rescan_and_store(&self.registry, &self.catalog, &self.root_id).unwrap();
        self.library()
    }

    fn absolute(&self, relative: &RootRelativePath) -> PathBuf {
        self.ot_root.path().join(relative.as_str())
    }

    fn derivation_edges(&self) -> BTreeSet<(String, String)> {
        self.catalog
            .lock()
            .unwrap()
            .list_derivation_edges()
            .unwrap()
            .into_iter()
            .map(|(output, source)| (output.as_str().to_owned(), source.as_str().to_owned()))
            .collect()
    }

    fn audio_asset_hashes(&self) -> Vec<ContentHash> {
        self.catalog
            .lock()
            .unwrap()
            .list_audio_asset_content_hashes()
            .unwrap()
    }

    /// Registers a TRIM lineage edge from `file` through the Sample line.
    fn register_trim(&self, file: &FileInstance) -> ContentHash {
        let source_bytes = fs::read(self.absolute(&file.relative_path)).unwrap();
        let range = FrameRange::new(PcmFrame::new(100), PcmFrame::new(900)).unwrap();
        let mut runtime = DerivedAudioRuntime::open(self.data.path()).unwrap();
        let mut catalog = self.catalog.lock().unwrap();
        ApplyTrimDerivation::new(
            &OtAudioTrimProcessor,
            &OtAudioTrimVerifier,
            &mut runtime,
            &mut *catalog,
            "2026-10-04T00:00:00.000Z",
        )
        .execute(
            &TrimIntent::new(file.content_hash.clone(), range),
            &source_bytes,
            &file.content_hash,
            &file.content_hash,
        )
        .unwrap()
        .output
    }
}

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/real_device")
}

fn tree_digest(root: &Path) -> TreeDigest {
    walkdir::WalkDir::new(root)
        .into_iter()
        .map(Result::unwrap)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            let bytes = fs::read(entry.path()).unwrap();
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            (
                relative,
                (bytes.len() as u64, format!("{:x}", Sha256::digest(&bytes))),
            )
        })
        .collect()
}

fn project_files(digest: &TreeDigest) -> TreeDigest {
    digest
        .iter()
        .filter(|(path, _)| path.starts_with(&format!("{PROJECT}/")))
        .map(|(path, value)| (path.clone(), value.clone()))
        .collect()
}

fn working_bank_a(structure: &ProjectStructure) -> &ot_domain::project_structure::BankStructure {
    structure
        .bank(BankIndex::new(0).unwrap(), StateDocumentRole::Working)
        .unwrap()
}

struct MachineSlotReference {
    part: PartIndex,
    track: TrackIndex,
    machine: MachineKind,
    slot: SampleSlotId,
}

fn machine_slot_references(structure: &ProjectStructure) -> Vec<MachineSlotReference> {
    working_bank_a(structure)
        .parts
        .iter()
        .flat_map(|part| {
            part.tracks
                .iter()
                .filter_map(move |track| match track.playback {
                    TrackPlayback::Audio {
                        machine,
                        slot: TrackSlotReference::Slot(slot),
                    } => Some(MachineSlotReference {
                        part: part.index,
                        track: track.index,
                        machine,
                        slot,
                    }),
                    _ => None,
                })
        })
        .collect()
}

/// Project slot reference → catalog slot assignment (`PATH=` resolved to a
/// root-relative path) → FileInstance at that path. The Project model carries
/// only the slot identity; every later hop is a Sample-line projection.
fn resolve_machine_slots(
    structure: &ProjectStructure,
    library: &LibrarySnapshot,
) -> Vec<ResolvedMachineSlot> {
    machine_slot_references(structure)
        .into_iter()
        .filter_map(
            |MachineSlotReference {
                 part, track, slot, ..
             }| {
                let assignment = library.slot_assignments.iter().find(|assignment| {
                    assignment.project_document_relative_path.as_str() == PROJECT_WORK
                        && assignment.slot == slot
                })?;
                if assignment.reference_status != SampleReferenceStatus::Resolved {
                    return None;
                }
                let path = assignment.referenced_file_relative_path.as_ref()?;
                let file = library
                    .file_instances
                    .iter()
                    .find(|file| &file.relative_path == path)?
                    .clone();
                Some(ResolvedMachineSlot {
                    part,
                    track,
                    slot,
                    file,
                })
            },
        )
        .collect()
}

/// First resolved slot that the catalog usage projection also lists.
fn first_resolved_slot(fixture: &Fixture) -> ResolvedMachineSlot {
    let library = fixture.library();
    resolve_machine_slots(&fixture.structure(), &library)
        .into_iter()
        .find(|entry| machine_usage_status(&library, entry.part, entry.track).is_some())
        .expect("fixture has a machine slot that resolves to a file")
}

fn slot_assignment_status(
    library: &LibrarySnapshot,
    slot: SampleSlotId,
) -> (Option<String>, SampleReferenceStatus) {
    let assignment = library
        .slot_assignments
        .iter()
        .find(|assignment| {
            assignment.project_document_relative_path.as_str() == PROJECT_WORK
                && assignment.slot == slot
        })
        .expect("slot assignment is projected");
    (
        assignment
            .referenced_file_relative_path
            .as_ref()
            .map(|path| path.as_str().to_owned()),
        assignment.reference_status,
    )
}

fn machine_usage_status(
    library: &LibrarySnapshot,
    part: PartIndex,
    track: TrackIndex,
) -> Option<SampleReferenceStatus> {
    library
        .usage_edges
        .iter()
        .find(|edge| {
            edge.bank_document_relative_path.as_str() == WORKING_BANK
                && edge.usage_kind == SampleUsageKind::Machine
                && edge.part_index == Some(part.get())
                && edge.track_index == track.get()
        })
        .map(|edge| edge.reference_status)
}

/// Slot, usage, and file projections without scan bookkeeping
/// (`hash_freshness`, mtime) that legitimately changes on rescan.
fn slot_projection(library: &LibrarySnapshot) -> impl PartialEq + std::fmt::Debug {
    let files: BTreeSet<(String, String, u64)> = library
        .file_instances
        .iter()
        .map(|file| {
            (
                file.relative_path.as_str().to_owned(),
                file.content_hash.as_str().to_owned(),
                file.byte_size,
            )
        })
        .collect();
    (
        library.state_documents.clone(),
        library.slot_assignments.clone(),
        library.usage_edges.clone(),
        files,
    )
}

fn wav_layout(bytes: &[u8]) -> ot_audio::pcm::WavLayout {
    ot_audio::pcm::inspect_wav_layout(bytes, &AtomicBool::new(false)).unwrap()
}

fn save_single_slice_draft(fixture: &Fixture, file: &FileInstance) -> u64 {
    let bytes = fs::read(fixture.absolute(&file.relative_path)).unwrap();
    let layout = wav_layout(&bytes);
    let frames = layout.info.frame_count;
    let marker = |id: &str, start: u64| DraftMarker {
        id: id.into(),
        start: PcmFrame::new(start),
        locked: false,
        manual: true,
        candidate_id: None,
        estimated_attack: None,
    };
    let draft = SliceDraft {
        revision: 0,
        region: FrameRange::new(PcmFrame::new(0), PcmFrame::new(frames)).unwrap(),
        markers: vec![marker("mid", 200), marker("tail", frames - 200)],
        suppressed_candidate_ids: Default::default(),
        exclusions: vec![],
    };
    draft.validate().unwrap();
    let binding = SliceDraftBinding {
        root: fixture.identity.clone(),
        relative_path: file.relative_path.clone(),
        source_hash: file.content_hash.clone(),
        sample_rate: layout.info.sample_rate,
        frame_count: frames,
    };
    fixture
        .catalog
        .lock()
        .unwrap()
        .save_slice_draft(&binding, &draft, 0)
        .unwrap()
        .revision
}

fn replace_unique(haystack: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    let positions: Vec<usize> = haystack
        .windows(needle.len())
        .enumerate()
        .filter(|(_, window)| *window == needle)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(positions.len(), 1, "needle must occur exactly once");
    let start = positions[0];
    let mut bytes = haystack[..start].to_vec();
    bytes.extend_from_slice(replacement);
    bytes.extend_from_slice(&haystack[start + needle.len()..]);
    bytes
}

#[test]
fn slot_reference_resolves_through_catalog_path_to_one_file_instance_and_one_asset() {
    let fixture = Fixture::new();
    let structure = fixture.structure();
    let library = fixture.library();
    let references = machine_slot_references(&structure);
    assert!(
        !references.is_empty(),
        "fixture has machine slot references"
    );

    let resolved = resolve_machine_slots(&structure, &library);
    assert!(!resolved.is_empty(), "at least one slot resolves to a file");
    for entry in &resolved {
        let same_path: Vec<_> = library
            .file_instances
            .iter()
            .filter(|file| file.relative_path == entry.file.relative_path)
            .collect();
        assert_eq!(same_path.len(), 1, "{:?}", entry.slot);
        let assets: Vec<_> = library
            .audio_assets
            .iter()
            .filter(|asset| asset.content_hash == entry.file.content_hash)
            .collect();
        assert_eq!(assets.len(), 1, "{:?}", entry.slot);
        assert_eq!(assets[0].byte_size, entry.file.byte_size);
    }

    // Within Machine edges (unsaved Part, active machine) the usage projection
    // drops only an inaudible Static machine on its default slot (slot number =
    // track number). The structure keeps it.
    let mut listed = 0;
    let mut omitted = 0;
    for reference in references {
        let expected = library
            .slot_assignments
            .iter()
            .find(|assignment| {
                assignment.project_document_relative_path.as_str() == PROJECT_WORK
                    && assignment.slot == reference.slot
            })
            .map_or(SampleReferenceStatus::UnassignedSlot, |assignment| {
                assignment.reference_status
            });
        match machine_usage_status(&library, reference.part, reference.track) {
            Some(status) => {
                assert_eq!(status, expected, "{:?}", reference.slot);
                listed += 1;
            }
            None => {
                assert_eq!(
                    reference.machine,
                    MachineKind::Static,
                    "{:?}",
                    reference.slot
                );
                assert_eq!(
                    reference.slot.number(),
                    u16::from(reference.track.get()) + 1,
                    "{:?}",
                    reference.slot
                );
                omitted += 1;
            }
        }
    }
    assert!(listed > 0, "usage projection lists machine slots");
    assert!(omitted > 0, "fixture exercises the default Static omission");
}

/// Both the read model and the catalog usage projection read only the active
/// machine of `parts.unsaved`. Inactive-side slots, `parts.saved`, and
/// `recorder_slot_id` are in neither. Each of these must be modeled or fail
/// closed before #181 can plan.
#[test]
fn structure_and_usage_cover_only_unsaved_active_machine_slots() {
    use crate::bank_validation::bank_machine_slot_to_usage_index;
    use ot_tools_io::{BankFile, OctatrackFileIO};

    let fixture = Fixture::new();
    let structure = fixture.structure();
    let library = fixture.library();
    let bank = BankFile::from_data_file(
        &fixture.absolute(&RootRelativePath::parse(WORKING_BANK).unwrap()),
    )
    .unwrap();
    let working = working_bank_a(&structure);

    let mut saved_differs = 0;
    let mut inactive_slots = 0;
    let mut recorder_buffers = 0;
    for part in &working.parts {
        let index = usize::from(part.index.get());
        let unsaved = &bank.parts.unsaved.0[index];
        let saved = &bank.parts.saved.0[index];
        for track in &part.tracks {
            let position = usize::from(track.index.get());
            let slots = &unsaved.audio_track_machine_slots[position];
            let saved_slots = &saved.audio_track_machine_slots[position];
            if (
                saved.audio_track_machine_types[position],
                saved_slots.static_slot_id,
                saved_slots.flex_slot_id,
            ) != (
                unsaved.audio_track_machine_types[position],
                slots.static_slot_id,
                slots.flex_slot_id,
            ) {
                saved_differs += 1;
            }
            let TrackPlayback::Audio { machine, slot } = track.playback else {
                continue;
            };
            let (active, inactive) = match machine {
                MachineKind::Static => (slots.static_slot_id, slots.flex_slot_id),
                MachineKind::Flex => (slots.flex_slot_id, slots.static_slot_id),
                _ => continue,
            };
            match slot {
                TrackSlotReference::Slot(id) => assert_eq!(
                    Some(usize::from(id.number()) - 1),
                    bank_machine_slot_to_usage_index(active)
                ),
                TrackSlotReference::RecorderBuffer(buffer) => {
                    assert_eq!(machine, MachineKind::Flex);
                    // Raw range vs `RecorderBufferId` (129..=136) is under review in #210.
                    assert_eq!(u16::from(active), buffer.flex_slot());
                    recorder_buffers += 1;
                }
                _ => {}
            }
            if bank_machine_slot_to_usage_index(inactive).is_some() && inactive != active {
                inactive_slots += 1;
            }
            let machine_edges: Vec<_> = library
                .usage_edges
                .iter()
                .filter(|edge| {
                    edge.bank_document_relative_path.as_str() == WORKING_BANK
                        && edge.usage_kind == SampleUsageKind::Machine
                        && edge.part_index == Some(part.index.get())
                        && edge.track_index == track.index.get()
                })
                .collect();
            assert!(machine_edges.len() <= 1);
            if let (Some(edge), TrackSlotReference::Slot(id)) = (machine_edges.first(), slot) {
                assert_eq!(edge.slot, id, "usage edge follows the active machine only");
            }
        }
    }
    assert!(
        saved_differs > 0,
        "fixture parts.saved differs from parts.unsaved"
    );
    assert!(inactive_slots > 0, "fixture has inactive-side slot values");
    assert!(
        recorder_buffers > 0,
        "recorder buffers come from flex_slot_id only"
    );
}

#[test]
fn duplicate_content_shares_one_asset_while_each_slot_keeps_its_file_instance() {
    let fixture = Fixture::with_duplicate_content();
    let library = fixture.library();
    let project_bytes =
        fs::read(fixture.absolute(&RootRelativePath::parse(PROJECT_WORK).unwrap())).unwrap();
    let parsed = ot_codec::parse_project_document(&project_bytes);
    let first = parsed.regular_assignments[0].slot;
    let second = parsed.regular_assignments[1].slot;

    let (first_path, first_status) = slot_assignment_status(&library, first);
    let (second_path, second_status) = slot_assignment_status(&library, second);
    assert_eq!(first_status, SampleReferenceStatus::Resolved);
    assert_eq!(second_status, SampleReferenceStatus::Resolved);
    assert_ne!(first_path, second_path);

    let hash_of = |path: &Option<String>| {
        library
            .file_instances
            .iter()
            .find(|file| Some(file.relative_path.as_str()) == path.as_deref())
            .unwrap()
            .content_hash
            .clone()
    };
    let shared = hash_of(&first_path);
    assert_eq!(hash_of(&second_path), shared);
    assert_eq!(
        library
            .audio_assets
            .iter()
            .filter(|asset| asset.content_hash == shared)
            .count(),
        1
    );
}

#[test]
fn missing_referenced_file_is_reported_by_the_sample_projection_only() {
    let fixture = Fixture::new();
    let target = first_resolved_slot(&fixture);
    let structure_before = fixture.structure();
    let project_before = project_files(&tree_digest(fixture.ot_root.path()));

    fs::remove_file(fixture.absolute(&target.file.relative_path)).unwrap();
    let library = fixture.rescan();

    let (path, status) = slot_assignment_status(&library, target.slot);
    assert_eq!(status, SampleReferenceStatus::Missing);
    assert_eq!(path.as_deref(), Some(target.file.relative_path.as_str()));
    assert_eq!(
        machine_usage_status(&library, target.part, target.track),
        Some(SampleReferenceStatus::Missing)
    );
    assert!(!library
        .file_instances
        .iter()
        .any(|file| file.relative_path == target.file.relative_path));
    assert_eq!(fixture.structure(), structure_before);
    assert_eq!(
        project_files(&tree_digest(fixture.ot_root.path())),
        project_before
    );
}

#[test]
fn changed_referenced_file_rebinds_the_slot_to_a_new_asset_and_keeps_recorded_lineage() {
    let fixture = Fixture::new();
    let target = first_resolved_slot(&fixture);
    let derived = fixture.register_trim(&target.file);
    let lineage_before = fixture.derivation_edges();
    assert!(lineage_before.contains(&(
        derived.as_str().to_owned(),
        target.file.content_hash.as_str().to_owned()
    )));
    let structure_before = fixture.structure();

    fs::write(
        fixture.absolute(&target.file.relative_path),
        ot_audio::test_minimal_wav(FIRST_WAV_FRAMES + 500),
    )
    .unwrap();
    let library = fixture.rescan();

    let (path, status) = slot_assignment_status(&library, target.slot);
    assert_eq!(status, SampleReferenceStatus::Resolved);
    assert_eq!(path.as_deref(), Some(target.file.relative_path.as_str()));
    let rebound = library
        .file_instances
        .iter()
        .find(|file| file.relative_path == target.file.relative_path)
        .unwrap();
    assert_ne!(rebound.content_hash, target.file.content_hash);
    assert_eq!(fixture.derivation_edges(), lineage_before);
    assert_eq!(fixture.structure(), structure_before);
}

#[test]
fn slice_export_leaves_project_bank_and_slot_projection_unchanged() {
    let fixture = Fixture::new();
    let target = first_resolved_slot(&fixture);
    let revision = save_single_slice_draft(&fixture, &target.file);
    let tree_before = tree_digest(fixture.ot_root.path());
    let structure_before = fixture.structure();
    let projection_before = slot_projection(&fixture.library());
    let derived_runtime = open_shared_derived_audio_runtime(fixture.data.path()).unwrap();

    let exported = slice_export_apply_sync(
        &fixture.registry,
        &fixture.catalog,
        &derived_runtime,
        &fixture.root_id,
        &opaque_file_instance_id(&fixture.identity, &target.file),
        "mid",
        revision,
    )
    .unwrap();
    assert!(exported.source_unchanged);
    assert_ne!(
        exported.derived_asset_id,
        opaque_asset_id(&target.file.content_hash)
    );

    assert_eq!(tree_digest(fixture.ot_root.path()), tree_before);
    assert_eq!(fixture.structure(), structure_before);
    assert_eq!(slot_projection(&fixture.library()), projection_before);
    assert!(fixture
        .derivation_edges()
        .iter()
        .any(|(_, source)| source == target.file.content_hash.as_str()));

    let rescanned = fixture.rescan();
    assert_eq!(slot_projection(&rescanned), projection_before);
    let still = resolve_machine_slots(&fixture.structure(), &rescanned)
        .into_iter()
        .find(|entry| entry.slot == target.slot)
        .unwrap();
    assert_eq!(still.file.content_hash, target.file.content_hash);
}

#[test]
fn project_structure_read_leaves_assets_hashes_and_lineage_unchanged() {
    let fixture = Fixture::new();
    let target = first_resolved_slot(&fixture);
    fixture.register_trim(&target.file);
    let tree_before = tree_digest(fixture.ot_root.path());
    let assets_before = fixture.audio_asset_hashes();
    let lineage_before = fixture.derivation_edges();
    let library_before = fixture.library();

    for _ in 0..2 {
        read_project_structure_dto(
            &fixture.registry,
            &fixture.root_id,
            &Fixture::project_path(),
        )
        .unwrap();
    }

    assert_eq!(tree_digest(fixture.ot_root.path()), tree_before);
    assert_eq!(fixture.audio_asset_hashes(), assets_before);
    assert_eq!(fixture.derivation_edges(), lineage_before);
    assert_eq!(fixture.library(), library_before);
}

#[test]
fn path_rebinding_keeps_slot_identity_bank_references_and_asset_identity() {
    let fixture = Fixture::new();
    let target = first_resolved_slot(&fixture);
    let project_work = fixture.absolute(&RootRelativePath::parse(PROJECT_WORK).unwrap());
    let original_bytes = fs::read(&project_work).unwrap();
    let raw_path = ot_codec::parse_project_document(&original_bytes)
        .regular_assignments
        .into_iter()
        .find(|assignment| assignment.slot == target.slot)
        .unwrap()
        .raw_path;
    let renamed_raw =
        ot_codec::rewrite_same_directory_path(&raw_path, "renamed-contract.wav").unwrap();
    let structure_before = fixture.structure();
    let slots_before: BTreeSet<_> = fixture
        .library()
        .slot_assignments
        .iter()
        .map(|assignment| {
            (
                slot_kind_rank(assignment.slot.kind()),
                assignment.slot.number(),
            )
        })
        .collect();
    let bank_before = tree_digest(fixture.ot_root.path())
        .into_iter()
        .filter(|(path, _)| path.contains("/bank01."))
        .collect::<TreeDigest>();

    // Same-directory rename as M5 produces it: the file moves and only the
    // slot's `PATH=` value changes (byte scope is pinned in ot-codec tests).
    let old_absolute = fixture.absolute(&target.file.relative_path);
    fs::rename(
        &old_absolute,
        old_absolute.with_file_name("renamed-contract.wav"),
    )
    .unwrap();
    let rewritten = replace_unique(
        &original_bytes,
        format!("PATH={raw_path}").as_bytes(),
        format!("PATH={renamed_raw}").as_bytes(),
    );
    fs::write(&project_work, rewritten).unwrap();
    let library = fixture.rescan();

    let (path, status) = slot_assignment_status(&library, target.slot);
    assert_eq!(status, SampleReferenceStatus::Resolved);
    let path = path.unwrap();
    assert!(path.ends_with("/renamed-contract.wav"), "{path}");
    let renamed = library
        .file_instances
        .iter()
        .find(|file| file.relative_path.as_str() == path)
        .unwrap();
    assert_eq!(renamed.content_hash, target.file.content_hash);
    let slots_after: BTreeSet<_> = library
        .slot_assignments
        .iter()
        .map(|assignment| {
            (
                slot_kind_rank(assignment.slot.kind()),
                assignment.slot.number(),
            )
        })
        .collect();
    assert_eq!(slots_after, slots_before);
    assert_eq!(fixture.structure(), structure_before);
    let bank_after = tree_digest(fixture.ot_root.path())
        .into_iter()
        .filter(|(path, _)| path.contains("/bank01."))
        .collect::<TreeDigest>();
    assert_eq!(bank_after, bank_before);
}

#[test]
fn project_structure_dto_exposes_slot_identity_only() {
    let fixture = Fixture::new();
    let dto = read_project_structure_dto(
        &fixture.registry,
        &fixture.root_id,
        &Fixture::project_path(),
    )
    .unwrap();
    let json = serde_json::to_value(&dto).unwrap();
    let root_text = fixture.canonical_root.to_string_lossy().into_owned();
    let forbidden_keys = [
        "contentHash",
        "assetId",
        "audioAssetId",
        "fileInstanceId",
        "referencedFileRelativePath",
        "referenceStatus",
        "byteSize",
        "derivation",
        "lineage",
        "sourceHash",
    ];
    let mut slot_objects = 0;
    let mut stack = vec![&json];
    while let Some(value) = stack.pop() {
        match value {
            serde_json::Value::Object(map) => {
                for key in forbidden_keys {
                    assert!(!map.contains_key(key), "DTO carries Sample-line key {key}");
                }
                if map.get("kind").and_then(|kind| kind.as_str()) == Some("slot") {
                    let keys: BTreeSet<&str> = map.keys().map(String::as_str).collect();
                    assert_eq!(keys, BTreeSet::from(["kind", "number", "slotKind"]));
                    slot_objects += 1;
                }
                stack.extend(map.values());
            }
            serde_json::Value::Array(items) => stack.extend(items.iter()),
            serde_json::Value::String(text) => {
                assert!(!text.contains(&root_text), "DTO leaks an absolute path");
            }
            _ => {}
        }
    }
    assert!(slot_objects > 0, "fixture DTO contains slot references");
}

const PROJECT_LINE_SOURCES: [(&str, &str); 3] = [
    (
        "ot-domain/project_structure.rs",
        include_str!("../crates/ot-domain/src/project_structure.rs"),
    ),
    (
        "project_structure_reader.rs",
        include_str!("project_structure_reader.rs"),
    ),
    (
        "project_structure_command.rs",
        include_str!("project_structure_command.rs"),
    ),
];

const SAMPLE_LINE_SOURCES: [(&str, &str); 18] = [
    (
        "derived_audio_runtime.rs",
        include_str!("derived_audio_runtime.rs"),
    ),
    (
        "slice_export_apply.rs",
        include_str!("slice_export_apply.rs"),
    ),
    ("slice_workbench.rs", include_str!("slice_workbench.rs")),
    (
        "asset_derivation_query.rs",
        include_str!("asset_derivation_query.rs"),
    ),
    ("audio_runtime.rs", include_str!("audio_runtime.rs")),
    (
        "ot-application/derived_trim.rs",
        include_str!("../crates/ot-application/src/derived_trim.rs"),
    ),
    (
        "ot-application/slice_export.rs",
        include_str!("../crates/ot-application/src/slice_export.rs"),
    ),
    (
        "ot-catalog/derived_audio.rs",
        include_str!("../crates/ot-catalog/src/derived_audio.rs"),
    ),
    (
        "ot-catalog/asset_derivations.rs",
        include_str!("../crates/ot-catalog/src/asset_derivations.rs"),
    ),
    (
        "ot-catalog/slice_drafts.rs",
        include_str!("../crates/ot-catalog/src/slice_drafts.rs"),
    ),
    (
        "ot-domain/derivation.rs",
        include_str!("../crates/ot-domain/src/derivation.rs"),
    ),
    (
        "ot-domain/derived_trim.rs",
        include_str!("../crates/ot-domain/src/derived_trim.rs"),
    ),
    (
        "ot-domain/derived_slice_export.rs",
        include_str!("../crates/ot-domain/src/derived_slice_export.rs"),
    ),
    (
        "ot-domain/slice_draft.rs",
        include_str!("../crates/ot-domain/src/slice_draft.rs"),
    ),
    (
        "ot-domain/slicing.rs",
        include_str!("../crates/ot-domain/src/slicing.rs"),
    ),
    (
        "ot-audio/lib.rs",
        include_str!("../crates/ot-audio/src/lib.rs"),
    ),
    (
        "ot-audio/waveform_v2.rs",
        include_str!("../crates/ot-audio/src/waveform_v2.rs"),
    ),
    (
        "ot-audio/wfm2.rs",
        include_str!("../crates/ot-audio/src/wfm2.rs"),
    ),
];

fn assert_sources_avoid(sources: &[(&str, &str)], forbidden: &[&str]) {
    for (name, source) in sources {
        for token in forbidden {
            assert!(
                !source.contains(token),
                "{name} names {token}; see SAMPLE_SLOT_AUDIOASSET_BOUNDARY.md"
            );
        }
    }
}

#[test]
fn project_line_sources_do_not_name_sample_line_entities() {
    assert_sources_avoid(
        &PROJECT_LINE_SOURCES,
        &[
            "AudioAsset",
            "FileInstance",
            "asset_derivation",
            "DerivationEdge",
            "derived_audio",
            "SliceDraft",
            "waveform",
            "ot_catalog",
            "ot_audio",
            "ot_application",
        ],
    );
}

#[test]
fn sample_line_sources_do_not_name_project_structure_entities() {
    assert_sources_avoid(
        &SAMPLE_LINE_SOURCES,
        &[
            "project_structure",
            "ProjectStructure",
            "BankStructure",
            "PartStructure",
            "PatternStructure",
            "TrackSlotReference",
            "bank_validation",
            "BankFile",
            "ProjectReferenceCodec",
            "ot_codec",
        ],
    );
}
