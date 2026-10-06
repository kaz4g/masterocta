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
    const CAPTURE_META_SCHEMA: &str = "masterocta-pse-bank-capture-meta:v1";
    const MANIFEST_SCHEMA: &str = "masterocta-pse-bank-multi-device-manifest:v1";

    /// Minimum multi-Bank / pattern mapping proof per acquisition protocol.
    const MANDATORY_MAPPING_CAPTURES: &[&str] =
        &["bank_a_active", "bank_b_active", "bank_b_pattern_4"];

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
        schema: String,
        capture_label: String,
        capture_id: String,
        device_generated: bool,
        ui_active_bank_letter: char,
        #[allow(dead_code)]
        ui_active_pattern_number: u8,
        expected_bank_index: u8,
        expected_pattern_index: u8,
        save_actions: Vec<String>,
        distinguishing_content: String,
    }

    #[derive(Debug, Deserialize)]
    struct ManifestEntry {
        path: String,
        sha256: String,
        size: u64,
    }

    #[derive(Debug, Deserialize)]
    struct Sha256Sums {
        schema: String,
        capture: String,
        files: Vec<ManifestEntry>,
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

    fn mandatory_mapping_ready() -> bool {
        MANDATORY_MAPPING_CAPTURES
            .iter()
            .all(|name| capture_ready(name))
    }

    fn load_acquisition_status() -> AcquisitionStatus {
        let path = fixture_root().join("ACQUISITION_STATUS.json");
        let text = fs::read_to_string(path).expect("ACQUISITION_STATUS.json");
        serde_json::from_str(&text).expect("acquisition status json")
    }

    fn load_and_validate_meta(capture_name: &str) -> CaptureMeta {
        let meta: CaptureMeta = serde_json::from_str(
            &fs::read_to_string(capture_dir(capture_name).join("capture.meta.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(meta.schema, CAPTURE_META_SCHEMA);
        assert_eq!(meta.capture_label, capture_name);
        assert_eq!(meta.capture_id, capture_name);
        assert!(
            meta.device_generated,
            "{capture_name} must be device_generated"
        );
        assert!(
            !meta.save_actions.is_empty(),
            "{capture_name} save_actions required"
        );
        assert!(
            !meta.distinguishing_content.is_empty(),
            "{capture_name} distinguishing_content required"
        );
        meta
    }

    fn sha256_file(path: &Path) -> String {
        format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
    }

    fn manifest_tree(dir: &Path) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_file() {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                out.insert(name, sha256_file(&path));
            }
        }
        out
    }

    fn verify_sha256_manifest(capture_name: &str) {
        let dir = capture_dir(capture_name);
        let manifest_path = dir.join("SHA256SUMS.json");
        assert!(
            manifest_path.is_file(),
            "{capture_name} missing SHA256SUMS.json"
        );
        let recorded: Sha256Sums =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        assert_eq!(recorded.schema, MANIFEST_SCHEMA);
        assert_eq!(recorded.capture, capture_name);
        let mut seen = BTreeMap::new();
        for entry in &recorded.files {
            assert!(
                seen.insert(entry.path.clone(), entry.sha256.clone())
                    .is_none(),
                "duplicate manifest path {}",
                entry.path
            );
            let file_path = dir.join(&entry.path);
            assert!(file_path.is_file(), "manifest lists missing {}", entry.path);
            assert_eq!(
                fs::metadata(&file_path).unwrap().len(),
                entry.size,
                "size mismatch for {}",
                entry.path
            );
            assert_eq!(
                sha256_file(&file_path),
                entry.sha256,
                "hash mismatch for {}",
                entry.path
            );
        }
    }

    fn copied_capture(name: &str) -> (TempDir, PathBuf, PathBuf) {
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
        let project_canon = project.canonicalize().unwrap();
        (temp, root, project_canon)
    }

    fn read_structure(name: &str) -> ProjectStructure {
        let (_temp, root, _project) = copied_capture(name);
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
        for name in MANDATORY_MAPPING_CAPTURES {
            if capture_ready(name) {
                assert_eq!(
                    status.captures.get(*name).map(String::as_str),
                    Some("COMMITTED"),
                    "mandatory capture {name} on disk must be COMMITTED in status"
                );
            }
        }
        if !mandatory_mapping_ready() {
            assert_eq!(
                status.result, "STOP_WITH_FINDINGS",
                "missing mandatory A/B/C captures requires STOP_WITH_FINDINGS"
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
        if capture_ready("bank_a_working_diverged") {
            assert_eq!(
                status
                    .captures
                    .get("bank_a_working_diverged")
                    .map(String::as_str),
                Some("COMMITTED")
            );
        }
        if capture_ready("bank_a_after_save") {
            assert_eq!(
                status.captures.get("bank_a_after_save").map(String::as_str),
                Some("COMMITTED")
            );
        }
    }

    #[test]
    fn committed_captures_match_sha256_manifest() {
        for name in CAPTURES {
            if !capture_ready(name) {
                continue;
            }
            load_and_validate_meta(name);
            verify_sha256_manifest(name);
        }
    }

    #[test]
    fn bank_a_working_diverged_states_match_meta_when_committed() {
        if !capture_ready("bank_a_working_diverged") {
            return;
        }
        let meta = load_and_validate_meta("bank_a_working_diverged");
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
        let meta = load_and_validate_meta("bank_a_active");
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
        let meta = load_and_validate_meta("bank_b_active");
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
        let meta = load_and_validate_meta("bank_b_pattern_4");
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
        if !mandatory_mapping_ready() {
            return;
        }
        let structure = read_structure("bank_b_active");
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
        let e_dir = capture_dir("bank_a_working_diverged");
        let f_dir = capture_dir("bank_a_after_save");
        let e_bank01_work = fs::read(e_dir.join("bank01.work")).unwrap();
        let e_bank01_strd = fs::read(e_dir.join("bank01.strd")).unwrap();
        assert_eq!(
            e_bank01_work, e_bank01_strd,
            "Capture E: mounted CF did not show bank01.work != bank01.strd before Save"
        );
        assert_ne!(
            e_bank01_work,
            fs::read(f_dir.join("bank01.work")).unwrap(),
            "Save must update bank01.work vs Capture E"
        );
        assert_ne!(
            fs::read(e_dir.join("project.work")).unwrap(),
            fs::read(f_dir.join("project.work")).unwrap(),
            "Save must update project.work vs Capture E"
        );
        assert_eq!(
            fs::read(e_dir.join("bank02.work")).unwrap(),
            fs::read(f_dir.join("bank02.work")).unwrap(),
            "bank02.work unchanged across E/F on P_TEST"
        );
        assert_eq!(
            fs::read(f_dir.join("bank01.work")).unwrap(),
            fs::read(f_dir.join("bank01.strd")).unwrap(),
            "Capture F: bank01.work and bank01.strd remain paired on mount"
        );
    }

    #[test]
    fn reading_structure_leaves_capture_bytes_unchanged() {
        for name in CAPTURES {
            if !capture_ready(name) {
                continue;
            }
            let (_temp, root, project_dir) = copied_capture(name);
            let before = manifest_tree(&project_dir);
            let project = RootRelativePath::parse(PROJECT).unwrap();
            let _ = read_project_structure(&root, &project).unwrap();
            assert_eq!(
                manifest_tree(&project_dir),
                before,
                "read_project_structure must not mutate opened copy for {name}"
            );
        }
    }
}
