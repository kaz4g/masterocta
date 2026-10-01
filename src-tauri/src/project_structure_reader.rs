//! Read-only Project structure adapter (`MO-PSE-READ-MODEL-1`).
//!
//! Reads `bankNN.work` and `bankNN.strd` as independent documents inside an
//! already-registered canonical root. Each Bank file is opened once with a
//! non-following descriptor, and that descriptor is checked against the
//! registered root before its bytes are decoded. Symlinked or non-regular
//! Bank files are absent. Filesystem I/O failures propagate; decode failures
//! stay malformed and expose no Pattern or Part values. This module exposes
//! no write path.

// Wired to `v2_project_structure_read`; exercised by tests until then.
#![cfg_attr(not(test), allow(dead_code))]

use crate::bank_validation::{bank_machine_slot_to_usage_index, bank_parse_status};
use crate::legacy_read_adapter::{join_relative, resolve_relative_for_read};
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
use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

const BANK_UNASSIGNED_SLOT: u8 = 255;

pub(crate) fn read_project_structure(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let project_directory = resolve_relative_for_read(canonical_root, project_relative_path)?;
    read_banks_in_directory(canonical_root, &project_directory, project_relative_path)
}

#[cfg(unix)]
fn read_banks_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let project_dir = open_contained_directory(canonical_root, project_directory)?;
    let mut banks = Vec::new();
    for bank in BankIndex::all() {
        for (role, extension) in [
            (StateDocumentRole::Working, "work"),
            (StateDocumentRole::SavedCheckpoint, "strd"),
        ] {
            let file_name = format!("bank{:02}.{extension}", bank.file_number());
            let Some(bytes) = read_contained_bank_bytes(canonical_root, &project_dir, &file_name)?
            else {
                continue;
            };
            let source_relative_path = join_relative(project_relative_path, &file_name)?;
            banks.push(read_bank_document(bank, role, source_relative_path, &bytes));
        }
    }
    banks.sort_by_key(|entry| (entry.bank, state_role_rank(entry.role)));
    Ok(ProjectStructure {
        project_relative_path: project_relative_path.clone(),
        banks,
    })
}

#[cfg(not(unix))]
fn read_banks_in_directory(
    canonical_root: &Path,
    project_directory: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<ProjectStructure, StorageError> {
    let _ = (canonical_root, project_directory, project_relative_path);
    Err(StorageError::new(
        "LIBRARY_SCAN_FAILED: contained bank reads require a non-following descriptor",
    ))
}

fn read_bank_document(
    bank: BankIndex,
    role: StateDocumentRole,
    source_relative_path: RootRelativePath,
    bytes: &[u8],
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
    // Bytes were already read from a contained descriptor. A decode failure is
    // format damage, not a filesystem error.
    let Ok(decoded) = BankFile::from_bytes(bytes) else {
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

#[cfg(unix)]
fn open_contained_directory(canonical_root: &Path, directory: &Path) -> Result<File, StorageError> {
    let file = open_nofollow_read(directory).map_err(map_directory_open_error)?;
    let metadata = file.metadata().map_err(io_unavailable)?;
    if !metadata.is_dir() {
        return Err(StorageError::new(
            "ROOT_REMOVED: project path is not a directory",
        ));
    }
    ensure_descriptor_inside_root(canonical_root, &file)?;
    Ok(file)
}

#[cfg(unix)]
fn read_contained_bank_bytes(
    canonical_root: &Path,
    project_dir: &File,
    file_name: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    let Some(mut file) = open_bank_nofollow(project_dir, file_name)? else {
        return Ok(None);
    };
    let metadata = file.metadata().map_err(io_unavailable)?;
    if !metadata.file_type().is_file() {
        return Ok(None);
    }
    ensure_descriptor_inside_root(canonical_root, &file)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(io_unavailable)?;
    Ok(Some(bytes))
}

#[cfg(unix)]
fn open_nofollow_read(path: &Path) -> Result<File, std::io::Error> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

#[cfg(unix)]
fn open_bank_nofollow(project_dir: &File, file_name: &str) -> Result<Option<File>, StorageError> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new(file_name).map_err(|_| {
        StorageError::new("PATH_ESCAPE: bank file name is not a single path component")
    })?;
    // SAFETY: `project_dir` owns an open directory descriptor. `name` is a
    // NUL-terminated single component. A non-negative result is a new fd
    // transferred to `File` below.
    let fd = unsafe {
        libc::openat(
            project_dir.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == ErrorKind::NotFound || is_symlink_open_error(&error) {
            return Ok(None);
        }
        return Err(io_unavailable(error));
    }
    // SAFETY: `fd` was just created by `openat` and is not owned elsewhere.
    Ok(Some(unsafe { File::from_raw_fd(fd) }))
}

#[cfg(unix)]
fn ensure_descriptor_inside_root(canonical_root: &Path, file: &File) -> Result<(), StorageError> {
    let opened = opened_file_path(file).map_err(io_unavailable)?;
    if opened.starts_with(canonical_root) {
        Ok(())
    } else {
        Err(StorageError::new(
            "PATH_ESCAPE: opened descriptor left its registered root",
        ))
    }
}

#[cfg(target_os = "linux")]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    use std::os::fd::AsRawFd;
    let link = format!("/proc/self/fd/{}", file.as_raw_fd());
    let path = std::fs::read_link(link)?;
    Ok(strip_proc_deleted(path))
}

#[cfg(target_os = "macos")]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    use std::ffi::CStr;
    use std::os::fd::AsRawFd;
    let mut buf = vec![0u8; libc::PATH_MAX as usize];
    // SAFETY: `file` is an open descriptor and `buf` is at least PATH_MAX bytes,
    // which is what F_GETPATH writes a NUL-terminated path into.
    let rc = unsafe {
        libc::fcntl(
            file.as_raw_fd(),
            libc::F_GETPATH,
            buf.as_mut_ptr().cast::<libc::c_char>(),
        )
    };
    if rc == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let bytes = buf.split(|byte| *byte == 0).next().unwrap_or(&[]);
    let text = std::str::from_utf8(bytes)
        .map_err(|error| std::io::Error::new(ErrorKind::InvalidData, error))?;
    Ok(PathBuf::from(text))
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn opened_file_path(file: &File) -> Result<PathBuf, std::io::Error> {
    let _ = file;
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "opened descriptor path is unavailable",
    ))
}

#[cfg(target_os = "linux")]
fn strip_proc_deleted(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    match text.strip_suffix(" (deleted)") {
        Some(stripped) => PathBuf::from(stripped),
        None => path,
    }
}

#[cfg(unix)]
fn map_directory_open_error(error: std::io::Error) -> StorageError {
    if error.kind() == ErrorKind::NotFound {
        StorageError::new(format!("ROOT_REMOVED: {error}"))
    } else if is_symlink_open_error(&error) {
        StorageError::new("SYMLINK_ESCAPE: symlinks are not valid read targets")
    } else {
        io_unavailable(error)
    }
}

#[cfg(unix)]
fn is_symlink_open_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(unix)]
fn io_unavailable(error: std::io::Error) -> StorageError {
    StorageError::new(format!("LIBRARY_SCAN_FAILED: {error}"))
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
    fn multipart_pattern_part_cycle_matches_tracked_fixture() {
        let (_temp, root) = copied_project("multipart", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(working.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
        for index in 0..16u8 {
            let pattern = working.pattern(PatternIndex::new(index).unwrap()).unwrap();
            assert_eq!(pattern.part.get(), index % 4, "pattern {index}");
        }
        for part in 0..4u8 {
            let track = &working.part(PartIndex::new(part).unwrap()).unwrap().tracks[2];
            assert_eq!(track.machine, MachineKind::Static);
            assert_eq!(
                track.slot,
                TrackSlotReference::Slot(
                    SampleSlotId::new(SampleSlotKind::Static, 41 + u16::from(part)).unwrap()
                )
            );
        }
    }

    #[test]
    fn real_device_patterns_all_use_part_zero() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let working = structure
            .bank(bank_a(), StateDocumentRole::Working)
            .unwrap();
        assert_eq!(working.patterns.len(), 16);
        for pattern in &working.patterns {
            assert_eq!(pattern.part.get(), 0);
        }
        assert_eq!(working.unmodeled, BANK_UNMODELED_DEPENDENCIES.to_vec());
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
    fn repeated_reads_return_equal_structure() {
        let (_temp, root) = copied_project(
            "real_device",
            &["project.work", "bank01.work", "bank01.strd"],
        );
        let first = read_project_structure(&root, &project_path()).unwrap();
        let second = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(first, second);
        let roles: Vec<_> = first
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
    }

    #[test]
    fn project_path_escaping_the_root_is_rejected() {
        let (_temp, root) = copied_project("real_device", &["project.work"]);
        assert!(RootRelativePath::parse("../outside").is_err());
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_project_structure(&root, &missing).is_err());
    }

    #[test]
    fn missing_project_rejection_leaves_fixture_bytes_unchanged() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let before = tree_digest(&root);
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_project_structure(&root, &missing).is_err());
        assert_eq!(tree_digest(&root), before);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_bank_file_is_a_storage_error() {
        use std::os::unix::fs::PermissionsExt;
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        let bank = root.join(PROJECT).join("bank02.work");
        fs::copy(root.join(PROJECT).join("bank01.work"), &bank).unwrap();
        let before = tree_digest(&root);
        let mut permissions = fs::metadata(&bank).unwrap().permissions();
        permissions.set_mode(0o0);
        fs::set_permissions(&bank, permissions.clone()).unwrap();
        assert!(
            fs::File::open(&bank).is_err(),
            "mode 000 must deny this user from reading the bank"
        );
        let error = read_project_structure(&root, &project_path()).unwrap_err();
        assert!(
            error.message().starts_with("LIBRARY_SCAN_FAILED"),
            "{}",
            error.message()
        );
        permissions.set_mode(0o644);
        fs::set_permissions(&bank, permissions).unwrap();
        assert_eq!(tree_digest(&root), before);
    }

    #[test]
    fn directory_named_as_bank_file_is_absent() {
        let (_temp, root) = copied_project("real_device", &["project.work", "bank01.work"]);
        fs::create_dir(root.join(PROJECT).join("bank02.work")).unwrap();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        assert!(structure
            .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
            .is_none());
        assert_eq!(
            structure
                .bank(bank_a(), StateDocumentRole::Working)
                .unwrap()
                .parse_status,
            StateDocumentParseStatus::Parsed
        );
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

    #[test]
    fn external_copy_harness_reads_when_root_is_set() {
        let Ok(root) = std::env::var("PSE_READ_MODEL_ROOT") else {
            return;
        };
        // Registered roots are canonical. macOS /var -> /private/var must not
        // be treated as PATH_ESCAPE when the copied tree itself did not move.
        let root = PathBuf::from(root)
            .canonicalize()
            .expect("copied fixture root");
        let project = RootRelativePath::parse(
            std::env::var("PSE_READ_MODEL_PROJECT")
                .as_deref()
                .unwrap_or("SET/PROJECT"),
        )
        .expect("project path");
        let expect = std::env::var("PSE_READ_MODEL_EXPECT").unwrap_or_else(|_| "ok".into());
        match expect.as_str() {
            "ok" => {
                let first = read_project_structure(Path::new(&root), &project).unwrap();
                let second = read_project_structure(Path::new(&root), &project).unwrap();
                assert_eq!(first, second);
                assert!(first
                    .banks
                    .iter()
                    .any(|entry| entry.parse_status == StateDocumentParseStatus::Parsed));
                assert!(first
                    .banks
                    .iter()
                    .filter(|entry| entry.parse_status == StateDocumentParseStatus::Parsed)
                    .all(|entry| entry.unmodeled == BANK_UNMODELED_DEPENDENCIES.to_vec()));
            }
            "missing" => {
                let missing = RootRelativePath::parse("SET/MISSING").unwrap();
                assert!(read_project_structure(Path::new(&root), &missing).is_err());
            }
            "mixed" => {
                let structure = read_project_structure(Path::new(&root), &project).unwrap();
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
            "symlink_absent" => {
                let structure = read_project_structure(Path::new(&root), &project).unwrap();
                assert!(structure
                    .bank(BankIndex::new(1).unwrap(), StateDocumentRole::Working)
                    .is_none());
                assert_eq!(
                    structure
                        .bank(bank_a(), StateDocumentRole::Working)
                        .unwrap()
                        .parse_status,
                    StateDocumentParseStatus::Parsed
                );
            }
            other => panic!("unknown PSE_READ_MODEL_EXPECT {other}"),
        }
        eprintln!("PSE_READ_MODEL_HARNESS_OK={expect}");
    }
}
