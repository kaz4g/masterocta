//! Real-device multi-Bank fixture contract tests (#219).

#[cfg(test)]
mod tests {
    use crate::project_structure_reader::read_project_structure;
    use ot_domain::project_structure::{
        BankIndex, PatternIndex, ProjectBankSelection, ProjectPatternSelection, ProjectStructure,
    };
    use ot_domain::{RootRelativePath, StateDocumentParseStatus, StateDocumentRole};
    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";
    const CAPTURES: &[&str] = &[
        "bank_a_active",
        "bank_b_active",
        "bank_b_pattern_4",
        "bank_a_working_diverged",
        "bank_a_after_save",
    ];

    #[derive(Debug, Deserialize)]
    struct AcquisitionStatus {
        result: String,
        captures: BTreeMap<String, String>,
    }

    #[derive(Debug, Deserialize)]
    struct CaptureMeta {
        ui_active_bank_letter: char,
        #[allow(dead_code)]
        ui_active_pattern_number: u8,
        expected_bank_index: u8,
        expected_pattern_index: u8,
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_multi_device")
    }

    fn capture_dir(name: &str) -> PathBuf {
        fixture_root().join(name)
    }

    fn capture_ready(name: &str) -> bool {
        let dir = capture_dir(name);
        dir.join("project.work").is_file() && dir.join("capture.meta.json").is_file()
    }

    fn load_acquisition_status() -> AcquisitionStatus {
        let path = fixture_root().join("ACQUISITION_STATUS.json");
        let text = fs::read_to_string(path).expect("ACQUISITION_STATUS.json");
        serde_json::from_str(&text).expect("acquisition status json")
    }

    fn sha256_file(path: &Path) -> String {
        format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
    }

    fn manifest(dir: &Path) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if name == "SHA256SUMS.json" || name == "capture.meta.json" {
                    continue;
                }
                out.insert(name, sha256_file(&path));
            }
        }
        out
    }

    fn copied_capture(name: &str) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for entry in fs::read_dir(capture_dir(name)).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = path.file_name().unwrap();
            let stem = file_name.to_string_lossy();
            if stem == "capture.meta.json" || stem == "SHA256SUMS.json" {
                continue;
            }
            fs::copy(&path, project.join(file_name)).unwrap();
        }
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    fn read_structure(name: &str) -> ProjectStructure {
        let (_temp, root) = copied_capture(name);
        let project = RootRelativePath::parse(PROJECT).unwrap();
        read_project_structure(&root, &project).expect("read project structure")
    }

    fn bank_index_from_letter(letter: char) -> BankIndex {
        let offset = letter.to_ascii_uppercase() as u8 - b'A';
        BankIndex::new(offset).expect("UI bank letter must map to A..P")
    }

    fn selected_bank(structure: &ProjectStructure) -> BankIndex {
        let state = structure
            .project_state
            .as_ref()
            .expect("working project.work state");
        assert_eq!(state.parse_status, StateDocumentParseStatus::Parsed);
        match state.bank {
            Some(ProjectBankSelection::Selected(index)) => index,
            other => panic!("expected selected bank, got {other:?}"),
        }
    }

    fn selected_pattern(structure: &ProjectStructure) -> PatternIndex {
        let state = structure
            .project_state
            .as_ref()
            .expect("working project.work state");
        match state.pattern {
            Some(ProjectPatternSelection::Selected(index)) => index,
            other => panic!("expected selected pattern, got {other:?}"),
        }
    }

    #[test]
    fn acquisition_status_stop_with_findings_until_captures_land() {
        let status = load_acquisition_status();
        if capture_ready("bank_a_active") {
            assert_eq!(
                status.captures.get("bank_a_active").map(String::as_str),
                Some("COMMITTED")
            );
        } else {
            assert_eq!(status.result, "STOP_WITH_FINDINGS");
            assert_eq!(
                status.captures.get("bank_a_active").map(String::as_str),
                Some("PENDING")
            );
        }
        if capture_ready("bank_b_active") {
            assert_eq!(
                status.captures.get("bank_b_active").map(String::as_str),
                Some("COMMITTED")
            );
        } else if status.captures.get("bank_b_active").map(String::as_str) == Some("PENDING") {
            assert_eq!(status.result, "STOP_WITH_FINDINGS");
        }
        if capture_ready("bank_b_pattern_4") {
            assert_eq!(
                status.captures.get("bank_b_pattern_4").map(String::as_str),
                Some("COMMITTED")
            );
        }
        if capture_ready("bank_a_working_diverged") {
            assert_eq!(
                status
                    .captures
                    .get("bank_a_working_diverged")
                    .map(String::as_str),
                Some("COMMITTED")
            );
        }
    }

    #[test]
    fn bank_a_working_diverged_states_match_meta_when_committed() {
        if !capture_ready("bank_a_working_diverged") {
            return;
        }
        let meta: CaptureMeta = serde_json::from_str(
            &fs::read_to_string(capture_dir("bank_a_working_diverged").join("capture.meta.json"))
                .unwrap(),
        )
        .unwrap();
        let structure = read_structure("bank_a_working_diverged");
        assert_eq!(
            selected_bank(&structure),
            bank_index_from_letter(meta.ui_active_bank_letter)
        );
        assert_eq!(
            selected_pattern(&structure),
            PatternIndex::new(meta.expected_pattern_index).unwrap()
        );
    }

    #[test]
    fn bank_a_active_states_match_meta_when_committed() {
        if !capture_ready("bank_a_active") {
            return;
        }
        let meta: CaptureMeta = serde_json::from_str(
            &fs::read_to_string(capture_dir("bank_a_active").join("capture.meta.json")).unwrap(),
        )
        .unwrap();
        let structure = read_structure("bank_a_active");
        assert_eq!(
            selected_bank(&structure),
            BankIndex::new(meta.expected_bank_index).unwrap()
        );
        assert_eq!(
            selected_bank(&structure),
            bank_index_from_letter(meta.ui_active_bank_letter)
        );
        assert_eq!(
            selected_pattern(&structure),
            PatternIndex::new(meta.expected_pattern_index).unwrap()
        );
    }

    #[test]
    fn bank_b_active_states_match_meta_when_committed() {
        if !capture_ready("bank_b_active") {
            return;
        }
        let meta: CaptureMeta = serde_json::from_str(
            &fs::read_to_string(capture_dir("bank_b_active").join("capture.meta.json")).unwrap(),
        )
        .unwrap();
        let structure = read_structure("bank_b_active");
        assert_eq!(
            selected_bank(&structure),
            bank_index_from_letter(meta.ui_active_bank_letter)
        );
        if capture_ready("bank_a_active") {
            assert_ne!(
                selected_bank(&read_structure("bank_a_active")),
                selected_bank(&structure),
                "Bank A and B captures must not share the same active BANK raw"
            );
        }
    }

    #[test]
    fn bank_b_pattern_4_states_match_meta_when_committed() {
        if !capture_ready("bank_b_pattern_4") {
            return;
        }
        let meta: CaptureMeta = serde_json::from_str(
            &fs::read_to_string(capture_dir("bank_b_pattern_4").join("capture.meta.json"))
                .unwrap(),
        )
        .unwrap();
        let structure = read_structure("bank_b_pattern_4");
        assert_eq!(
            selected_bank(&structure),
            bank_index_from_letter(meta.ui_active_bank_letter)
        );
        assert_eq!(
            selected_pattern(&structure),
            PatternIndex::new(meta.expected_pattern_index).unwrap()
        );
        if capture_ready("bank_b_active") {
            assert_eq!(
                selected_bank(&read_structure("bank_b_active")),
                selected_bank(&structure),
                "Pattern change must not alter BANK raw when bank stays on B"
            );
            assert_ne!(
                selected_pattern(&read_structure("bank_b_active")),
                selected_pattern(&structure),
            );
        }
    }

    #[test]
    fn multiple_bank_files_read_as_separate_slots_when_committed() {
        let capture = if capture_ready("bank_b_active") {
            "bank_b_active"
        } else if capture_ready("bank_a_active") {
            "bank_a_active"
        } else {
            return;
        };
        let structure = read_structure(capture);
        let working_banks: Vec<_> = structure
            .banks
            .iter()
            .filter(|b| b.role == StateDocumentRole::Working)
            .map(|b| b.source_relative_path.as_str())
            .collect();
        assert!(
            working_banks.len() >= 2,
            "multi-bank fixture must expose at least bank01 and bank02 working entries"
        );
    }

    #[test]
    fn bank_a_and_b_working_bytes_differ_when_both_committed() {
        if !(capture_ready("bank_a_active") && capture_ready("bank_b_active")) {
            return;
        }
        let a = capture_dir("bank_a_active").join("bank01.work");
        let b = capture_dir("bank_b_active").join("bank02.work");
        if !(a.is_file() && b.is_file()) {
            panic!("expected bank01.work and bank02.work in committed A/B captures");
        }
        assert_ne!(fs::read(a).unwrap(), fs::read(b).unwrap());
    }

    #[test]
    fn work_and_strd_are_separate_roles_when_both_present() {
        if !capture_ready("bank_a_active") {
            return;
        }
        let structure = read_structure("bank_a_active");
        let roles: Vec<_> = structure
            .banks
            .iter()
            .filter(|b| b.source_relative_path.as_str().contains("bank01"))
            .map(|b| b.role)
            .collect();
        if roles.contains(&StateDocumentRole::Working)
            && roles.contains(&StateDocumentRole::SavedCheckpoint)
        {
            assert_eq!(roles.len(), 2);
        }
    }

    #[test]
    fn working_diverged_and_after_save_observation_when_committed() {
        if !(capture_ready("bank_a_working_diverged") && capture_ready("bank_a_after_save")) {
            let status = load_acquisition_status();
            if capture_ready("bank_a_working_diverged") {
                assert_eq!(
                    status.captures.get("bank_a_after_save").map(String::as_str),
                    Some("PENDING")
                );
            } else {
                assert_eq!(
                    status
                        .captures
                        .get("bank_a_working_diverged")
                        .map(String::as_str),
                    Some("PENDING")
                );
            }
            return;
        }
        let before = manifest(&capture_dir("bank_a_working_diverged"));
        let after = manifest(&capture_dir("bank_a_after_save"));
        assert_ne!(
            before, after,
            "Save sequence must change at least one tracked file hash"
        );
    }

    #[test]
    fn reading_structure_leaves_capture_bytes_unchanged() {
        for name in CAPTURES {
            if !capture_ready(name) {
                continue;
            }
            let dir = capture_dir(name);
            let before = manifest(&dir);
            let (_temp, root) = copied_capture(name);
            let project = RootRelativePath::parse(PROJECT).unwrap();
            let _ = read_project_structure(&root, &project).unwrap();
            assert_eq!(
                manifest(&dir),
                before,
                "capture {name} bytes must stay identical"
            );
        }
    }
}
