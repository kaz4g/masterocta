//! Read-only Arranger file inspection (`MO-PSE-ARRANGER-READ-1`).
//!
//! Opens `arr01.work`..=`arr08.work` inside an already-registered canonical
//! root. Bank and Pattern indexes are not produced. `arrNN.strd` is not given
//! a SavedCheckpoint role. This module exposes no write path.

#![cfg_attr(not(test), allow(dead_code))]

use crate::legacy_read_adapter::{
    is_regular_source_file, join_relative, resolve_relative_for_read,
};
use ot_domain::arrangement::{
    ArrangementFileIndex, ArrangementFileObservation, ArrangementInspection,
};
use ot_domain::RootRelativePath;
use ot_storage_ports::StorageError;
use ot_tools_io::{ArrangementFile, HasFileVersionField, HasHeaderField, OctatrackFileIO};
use std::path::Path;

pub(crate) fn read_arrangement_files(
    canonical_root: &Path,
    project_relative_path: &RootRelativePath,
) -> Result<Vec<ArrangementFileObservation>, StorageError> {
    let project_directory = resolve_relative_for_read(canonical_root, project_relative_path)?;
    let mut observations = Vec::new();
    for index in ArrangementFileIndex::all() {
        let file_name = format!("arr{:02}.work", index.file_number());
        let arrangement_file = project_directory.join(&file_name);
        if !is_regular_source_file(canonical_root, &arrangement_file)? {
            continue;
        }
        let source_relative_path = join_relative(project_relative_path, &file_name)?;
        observations.push(ArrangementFileObservation {
            index,
            source_relative_path,
            inspection: inspect_arrangement_file(&arrangement_file),
        });
    }
    Ok(observations)
}

fn inspect_arrangement_file(path: &Path) -> ArrangementInspection {
    let Ok(bytes) = std::fs::read(path) else {
        return ArrangementInspection::Malformed;
    };
    let Ok(decoded) = ArrangementFile::decode(&bytes) else {
        return ArrangementInspection::Malformed;
    };
    if !decoded.check_header().unwrap_or(false) {
        return ArrangementInspection::Malformed;
    }
    if !decoded.check_file_version().unwrap_or(false) {
        return ArrangementInspection::UnsupportedVersion {
            observed_version: decoded.datatype_version,
        };
    }
    if !raw_checksum_matches(&bytes) {
        return ArrangementInspection::Malformed;
    }
    ArrangementInspection::ReferencesWithheld {
        datatype_version: decoded.datatype_version,
        current_n_rows: decoded.arrangement_state_current.n_rows,
        previous_n_rows: decoded.arrangement_state_previous.n_rows,
    }
}

/// Byte-sum checksum from pinned ot-tools-io (`arrangements.rs`,
/// `raw_file_verification`). Struct re-encoding is not used: the library
/// documents that deserialize-then-serialize drops bytes on non-blank files.
fn raw_checksum_matches(bytes: &[u8]) -> bool {
    if bytes.len() < 18 {
        return false;
    }
    let payload = &bytes[16..bytes.len() - 2];
    let mut computed: u16 = 0;
    for &byte in payload {
        computed = computed.wrapping_add(u16::from(byte));
    }
    let stored = (u16::from(bytes[bytes.len() - 2]) << 8) | u16::from(bytes[bytes.len() - 1]);
    computed == stored
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::project_structure::{BankIndex, PatternIndex};
    use ot_tools_io::arrangements::{ArrangeRow, ARRANGEMENT_FILE_VERSION};
    use ot_tools_io::OctatrackFileIO;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";
    const TRACKED_ARR01_SHA256: &str =
        "e21ee32c5571a9c0b8c89cf3877fc1fae20dce25c158e0d6dfc6cb90a165a80c";

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn copied_project(files: &[&str]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in files {
            fs::copy(fixture_dir("real_device").join(file), project.join(file)).unwrap();
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

    fn tracked_arr01_digest() -> String {
        let bytes = fs::read(fixture_dir("real_device").join("arr01.work")).unwrap();
        format!("{:x}", Sha256::digest(bytes))
    }

    fn read_copy(files: &[&str]) -> (TempDir, PathBuf, Vec<ArrangementFileObservation>) {
        let (temp, root) = copied_project(files);
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        (temp, root, observations)
    }

    #[test]
    fn tracked_fixture_digest_is_unchanged_by_inspection() {
        assert_eq!(tracked_arr01_digest(), TRACKED_ARR01_SHA256);
        let (_temp, root) = copied_project(&["arr01.work", "project.work", "bank01.work"]);
        let before = tree_digest(&root);
        read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(tree_digest(&root), before);
        assert_eq!(tracked_arr01_digest(), TRACKED_ARR01_SHA256);
    }

    #[test]
    fn real_device_arranger_withholds_bank_and_pattern_indexes() {
        let (_temp, root, observations) = read_copy(&["arr01.work", "project.work", "bank01.work"]);
        assert_eq!(observations.len(), 1);
        let observation = &observations[0];
        assert_eq!(observation.index, ArrangementFileIndex::new(0).unwrap());
        assert_eq!(
            observation.source_relative_path.as_str(),
            "SET/PROJECT/arr01.work"
        );
        assert!(
            !observation.source_relative_path.as_str().starts_with('/'),
            "relative path must not be absolute"
        );
        assert_eq!(
            observation.inspection,
            ArrangementInspection::ReferencesWithheld {
                datatype_version: ARRANGEMENT_FILE_VERSION,
                current_n_rows: 0,
                previous_n_rows: 0,
            }
        );
        assert!(observation.inspection.withholds_references());
        assert!(observation.inspection.active_row_count_is_ambiguous());

        let decoded =
            ArrangementFile::from_data_file(&root.join(PROJECT).join("arr01.work")).unwrap();
        let pattern_rows = decoded
            .arrangement_state_current
            .rows
            .0
            .iter()
            .filter(|row| matches!(row, ArrangeRow::PatternRow { .. }))
            .count();
        assert_eq!(pattern_rows, 0);
    }

    #[test]
    fn missing_arrangement_files_are_absent() {
        let (_temp, _root, observations) = read_copy(&["project.work"]);
        assert!(observations.is_empty());
    }

    #[test]
    fn strd_sibling_is_not_a_saved_checkpoint() {
        let (temp, root, observations) = read_copy(&["arr01.work"]);
        fs::copy(
            temp.path().join(PROJECT).join("arr01.work"),
            temp.path().join(PROJECT).join("arr01.strd"),
        )
        .unwrap();
        let again = read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(again, observations);
        assert_eq!(again.len(), 1);
        assert!(again[0].source_relative_path.as_str().ends_with(".work"));
    }

    #[test]
    fn short_file_is_malformed_without_a_partial_row() {
        let (_temp, root) = copied_project(&["project.work"]);
        fs::write(root.join(PROJECT).join("arr03.work"), b"not an arrangement").unwrap();
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].index.file_number(), 3);
        assert_eq!(observations[0].inspection, ArrangementInspection::Malformed);
        assert!(!observations[0].inspection.withholds_references());
    }

    #[test]
    fn wrong_datatype_version_is_unsupported() {
        let (_temp, root) = copied_project(&["arr01.work"]);
        let path = root.join(PROJECT).join("arr01.work");
        let mut bytes = fs::read(&path).unwrap();
        bytes[21] = 0;
        fs::write(&path, bytes).unwrap();
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(
            observations[0].inspection,
            ArrangementInspection::UnsupportedVersion {
                observed_version: 0
            }
        );
    }

    #[test]
    fn bad_header_or_checksum_is_malformed() {
        let (_temp, root) = copied_project(&["arr01.work"]);
        let path = root.join(PROJECT).join("arr01.work");
        let original = fs::read(&path).unwrap();

        let mut header = original.clone();
        header[0] ^= 0xff;
        fs::write(&path, &header).unwrap();
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(observations[0].inspection, ArrangementInspection::Malformed);

        let mut checksum = original;
        let last = checksum.len() - 1;
        checksum[last] ^= 0xff;
        fs::write(&path, &checksum).unwrap();
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        assert_eq!(observations[0].inspection, ArrangementInspection::Malformed);
    }

    #[test]
    fn project_path_outside_the_root_is_rejected() {
        let (_temp, root) = copied_project(&["arr01.work"]);
        assert!(RootRelativePath::parse("../outside").is_err());
        let missing = RootRelativePath::parse("SET/MISSING").unwrap();
        assert!(read_arrangement_files(&root, &missing).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_arrangement_is_absent() {
        let (temp, root) = copied_project(&["project.work"]);
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("arr01.work");
        fs::copy(fixture_dir("real_device").join("arr01.work"), &target).unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join(PROJECT).join("arr01.work")).unwrap();
        let observations = read_arrangement_files(&root, &project_path()).unwrap();
        assert!(observations.is_empty());
    }

    #[test]
    fn withheld_rows_do_not_invent_b1_indexes() {
        let (_temp, root, observations) = read_copy(&["arr01.work", "bank01.work"]);
        let structure =
            crate::project_structure_reader::read_project_structure(&root, &project_path())
                .unwrap();
        assert!(structure
            .bank(
                BankIndex::new(0).unwrap(),
                ot_domain::StateDocumentRole::Working
            )
            .is_some());
        assert!(structure
            .bank(
                BankIndex::new(1).unwrap(),
                ot_domain::StateDocumentRole::Working
            )
            .is_none());
        assert!(observations[0].inspection.withholds_references());
        assert!(PatternIndex::new(16).is_err());
    }
}
