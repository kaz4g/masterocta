//! Read-only Project structure adapter (`MO-PSE-READ-MODEL-1`).
//!
//! Reads `bankNN.work` and `bankNN.strd` as independent documents inside an
//! already-registered canonical root. Symlinked or non-regular Bank files are
//! treated as absent, matching the catalog state inventory. This module exposes
//! no write path.

// Wired to a v2 command in a later unit; exercised by tests until then.
#![cfg_attr(not(test), allow(dead_code))]

use crate::bank_validation::{bank_machine_slot_to_usage_index, bank_parse_status};
use crate::legacy_read_adapter::{
    is_regular_source_file, join_relative, resolve_relative_for_read,
};
use ot_domain::project_structure::{
    state_role_rank, BankIndex, BankStructure, MachineKind, PartIndex, PartStructure, PatternIndex,
    PatternStructure, ProjectStructure, TrackIndex, TrackSlotReference, TrackStructure,
    BANK_UNMODELED_DEPENDENCIES,
};
use ot_domain::{
    RecorderBufferId, RootRelativePath, SampleSlotId, SampleSlotKind, StateDocumentParseStatus,
    StateDocumentRole,
};
use ot_storage_ports::StorageError;
use ot_tools_io::{BankFile, OctatrackFileIO};
use std::path::Path;

const BANK_UNASSIGNED_SLOT: u8 = 255;

pub(crate) fn read_project_structure(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let project_directory = resolve_relative_for_read(canonical_root, project_relative_path)?;
    let mut banks = Vec::new();
    for bank in BankIndex::all() {
        for (role, extension) in [
            (StateDocumentRole::Working, "work"),
            (StateDocumentRole::SavedCheckpoint, "strd"),
        ] {
            let file_name = format!("bank{:02}.{extension}", bank.file_number());
            let bank_file = project_directory.join(&file_name);
            if !is_regular_source_file(canonical_root, &bank_file)? {
                continue;
            }
            let source_relative_path = join_relative(project_relative_path, &file_name)?;
            banks.push(read_bank_document(
                bank,
                role,
                source_relative_path,
                &bank_file,
            ));
        }
    }
    banks.sort_by_key(|entry| (entry.bank, state_role_rank(entry.role)));
    Ok(ProjectStructure {
        project_relative_path: project_relative_path.clone(),
        banks,
    })
}

fn read_bank_document(
    bank: BankIndex,
    role: StateDocumentRole,
    source_relative_path: RootRelativePath,
    bank_file: &Path,
) -> BankStructure {
    let mut structure = BankStructure {
        bank,
        role,
        source_relative_path,
        parse_status: StateDocumentParseStatus::Malformed,
        patterns: Vec::new(),
        parts: Vec::new(),
        unmodeled: BANK_UNMODELED_DEPENDENCIES.to_vec(),
    };
    let Ok(decoded) = BankFile::from_data_file(bank_file) else {
        return structure;
    };
    structure.parse_status = bank_parse_status(&decoded);
    if structure.parse_status != StateDocumentParseStatus::Parsed {
        return structure;
    }
    match (bank_patterns(&decoded), bank_parts(&decoded)) {
        (Some(patterns), Some(parts)) => {
            structure.patterns = patterns;
            structure.parts = parts;
        }
        _ => structure.parse_status = StateDocumentParseStatus::Malformed,
    }
    structure
}

fn bank_patterns(bank: &BankFile) -> Option<Vec<PatternStructure>> {
    PatternIndex::all()
        .map(|index| {
            let pattern = bank.patterns.0.get(usize::from(index.get()))?;
            Some(PatternStructure {
                index,
                part: PartIndex::new(pattern.part_assignment).ok()?,
                master_length: u16::from(pattern.scale.master_len),
            })
        })
        .collect()
}

fn bank_parts(bank: &BankFile) -> Option<Vec<PartStructure>> {
    PartIndex::all()
        .map(|index| {
            let part = bank.parts.unsaved.0.get(usize::from(index.get()))?;
            let tracks = TrackIndex::all()
                .map(|track| {
                    let position = usize::from(track.get());
                    let machine =
                        MachineKind::from_raw(*part.audio_track_machine_types.get(position)?);
                    let slots = part.audio_track_machine_slots.get(position)?;
                    let slot = match machine {
                        MachineKind::Static => {
                            machine_slot_reference(SampleSlotKind::Static, slots.static_slot_id)
                        }
                        MachineKind::Flex => {
                            machine_slot_reference(SampleSlotKind::Flex, slots.flex_slot_id)
                        }
                        _ => TrackSlotReference::NoSampleMachine,
                    };
                    Some(TrackStructure {
                        index: track,
                        machine,
                        slot,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(PartStructure { index, tracks })
        })
        .collect()
}

fn machine_slot_reference(kind: SampleSlotKind, raw: u8) -> TrackSlotReference {
    if raw == BANK_UNASSIGNED_SLOT {
        return TrackSlotReference::Unassigned;
    }
    if let Some(index) = bank_machine_slot_to_usage_index(raw) {
        return u16::try_from(index + 1)
            .ok()
            .and_then(|number| SampleSlotId::new(kind, number).ok())
            .map_or(
                TrackSlotReference::Unrecognized(raw),
                TrackSlotReference::Slot,
            );
    }
    if kind == SampleSlotKind::Flex {
        if let Ok(buffer) = RecorderBufferId::new(u16::from(raw)) {
            return TrackSlotReference::RecorderBuffer(buffer);
        }
    }
    TrackSlotReference::Unrecognized(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    /// Copies the listed fixture files into `<tmp>/SET/PROJECT/` and returns the
    /// canonical temporary root. Tracked fixtures are never read in place.
    fn copied_project(fixture: &str, files: &[&str]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in files {
            fs::copy(fixture_dir(fixture).join(file), project.join(file)).unwrap();
        }
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    fn project_path() -> RootRelativePath {
        RootRelativePath::parse(PROJECT).unwrap()
    }

    fn tree_digest(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| {
                let bytes = fs::read(entry.path()).unwrap();
                let digest = format!("{:x}", Sha256::digest(&bytes));
                (
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    (bytes.len() as u64, digest),
                )
            })
            .collect()
    }

    fn bank_a() -> BankIndex {
        BankIndex::new(0).unwrap()
    }

    #[test]
    fn working_and_saved_bank_documents_stay_separate_entries() {
        let (_temp, root) = copied_project(
            "real_device",
            &[
                "project.work",
                "bank01.work",
                "bank01.strd",
                "markers.work",
                "arr01.work",
            ],
        );
        let structure = read_project_structure(&root, &project_path()).unwrap();

        let roles: Vec<_> = structure
            .banks
            .iter()
            .map(|entry| (entry.bank.get(), entry.role))
            .collect();
        assert_eq!(
            roles,
            vec![
                (0, StateDocumentRole::Working),
                (0, StateDocumentRole::SavedCheckpoint)
            ]
        );
        for entry in &structure.banks {
            assert_eq!(entry.parse_status, StateDocumentParseStatus::Parsed);
            assert_eq!(entry.patterns.len(), 16);
            assert_eq!(entry.parts.len(), 4);
            assert!(entry.parts.iter().all(|part| part.tracks.len() == 8));
            assert_eq!(entry.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
        }
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .source_relative_path
                .as_str(),
            "SET/PROJECT/bank01.work"
        );
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::SavedCheckpoint)
                .unwrap()
                .source_relative_path
                .as_str(),
            "SET/PROJECT/bank01.strd"
        );
    }

    #[test]
    fn working_only_bank_does_not_invent_a_saved_checkpoint() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(structure.banks.len(), 1);
        assert_eq!(structure.banks[0].role, StateDocumentRole::Working);
        assert!(structure
            .bank(bank_a(), StateDocumentRole::SavedCheckpoint)
            .is_none());
    }

    #[test]
    fn saved_only_bank_is_not_promoted_to_working() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.strd"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(structure.banks.len(), 1);
        assert_eq!(structure.banks[0].role, StateDocumentRole::SavedCheckpoint);
        assert!(structure
            .bank(bank_a(), StateDocumentRole::Working)
            .is_none());
    }

    #[test]
    fn pattern_part_assignment_matches_the_legacy_reader() {
        for fixture in ["real_device", "multipart"] {
            let (_temp, root) = copied_project(fixture, &["project.work", "bank01.work"]);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let working = structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap();

            let project_dir = root.join(PROJECT);
            let legacy =
                crate::project_reader::read_project_banks(project_dir.to_str().unwrap()).unwrap();
            let legacy_patterns = &legacy[0].parts[0].patterns;
            assert_eq!(legacy_patterns.len(), 16);
            for legacy_pattern in legacy_patterns {
                let pattern = working
                    .pattern(PatternIndex::new(legacy_pattern.id).unwrap())
                    .unwrap();
                assert_eq!(
                    pattern.part.get(),
                    legacy_pattern.part_assignment,
                    "{fixture}"
                );
                assert_eq!(pattern.master_length, legacy_pattern.length, "{fixture}");
            }
        }
    }

    #[test]
    fn multipart_fixture_uses_more_than_one_part() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        let used_parts = PartIndex::all()
            .filter(|part| working.patterns_using_part(*part).next().is_some())
            .count();
        assert!(used_parts > 1);
    }

    #[test]
    fn track_slots_match_catalog_machine_usage_edges() {
        for fixture in ["real_device", "multipart"] {
            let (_temp, root) = copied_project(fixture, &["project.work", "bank01.work"]);
            let structure = read_project_structure(&root, &project_path()).unwrap();
            let working = structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap();

            let project_dir = root.join(PROJECT);
            let usage = crate::project_reader::compute_sample_usage_for_documents(
                &project_dir.join("project.work"),
                &project_dir.join("bank01.work"),
                0,
            )
            .unwrap();
            let mut compared = 0;
            for (kind, pool) in [
                (SampleSlotKind::Static, &usage.static_usage),
                (SampleSlotKind::Flex, &usage.flex_usage),
            ] {
                for (index, entries) in pool.iter().enumerate() {
                    for entry in entries.iter().filter(|entry| entry.kind == "machine") {
                        let part = working
                            .part(PartIndex::new(entry.part.unwrap()).unwrap())
                            .unwrap();
                        let track = &part.tracks[usize::from(entry.track)];
                        let expected =
                            SampleSlotId::new(kind, u16::try_from(index + 1).unwrap()).unwrap();
                        assert_eq!(track.slot, TrackSlotReference::Slot(expected), "{fixture}");
                        compared += 1;
                    }
                }
            }
            assert!(
                compared > 0,
                "{fixture} produced no machine usage to compare"
            );
        }
    }

    #[test]
    fn undecodable_bank_is_malformed_without_partial_structure() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        fs::write(root.join(PROJECT).join("bank02.work"), b"not a bank").unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let broken = structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(broken.parse_status, StateDocumentParseStatus::Malformed);
        assert!(broken.patterns.is_empty());
        assert!(broken.parts.is_empty());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
    }

    #[test]
    fn bank_failing_validation_is_malformed_without_partial_structure() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let bank_file = root.join(PROJECT).join("bank01.work");
        let mut bytes = fs::read(&bank_file).unwrap();
        bytes[0] ^= 0x01;
        fs::write(&bank_file, bytes).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let entry = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_ne!(entry.parse_status, StateDocumentParseStatus::Parsed);
        assert!(entry.patterns.is_empty());
        assert!(entry.parts.is_empty());
    }

    #[test]
    fn reading_structure_leaves_every_file_byte_identical() {
        let (_temp, root) = copied_project(
            "real_device",
            &[
                "project.work",
                "bank01.work",
                "bank01.strd",
                "markers.work",
                "arr01.work",
            ],
        );
        let before = tree_digest(&root);
        read_project_structure(&root, &project_path()).unwrap();
        read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(tree_digest(&root), before);
    }

    #[test]
    fn project_path_escaping_the_root_is_rejected() {
        let (_temp, root) = copied_project("real_device", &["project.work"]);
        assert!(RootRelativePath::parse("../outside").is_err());
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_project_structure(&root, &missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_bank_is_treated_as_absent() {
        let (temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("bank02.work");
        fs::copy(fixture_dir("real_device").join("bank01.work"), &target).unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join(PROJECT).join("bank02.work")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .is_none());
    }

    #[test]
    fn machine_slot_raw_values_map_without_guessing() {
        let flex = SampleSlotKind::Flex;
        assert_eq!(
            machine_slot_reference(flex, 0),
            TrackSlotReference::Slot(SampleSlotId::new(flex, 1).unwrap())
        );
        assert_eq!(
            machine_slot_reference(flex, 127),
            TrackSlotReference::Slot(SampleSlotId::new(flex, 128).unwrap())
        );
        assert_eq!(
            machine_slot_reference(flex, 255),
            TrackSlotReference::Unassigned
        );
        assert_eq!(
            machine_slot_reference(flex, 129),
            TrackSlotReference::RecorderBuffer(RecorderBufferId::new(129).unwrap())
        );
        assert_eq!(
            machine_slot_reference(flex, 128),
            TrackSlotReference::Unrecognized(128)
        );
        assert_eq!(
            machine_slot_reference(SampleSlotKind::Static, 129),
            TrackSlotReference::Unrecognized(129)
        );
    }
}
