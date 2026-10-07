//! Read-only Bank internal identity evidence (#221 / MO-PSE-BANK-INTERNAL-IDENTITY-1).

#[cfg(test)]
mod tests {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::Read;
    use std::path::{Path, PathBuf};

    const CAPTURES: &[&str] = &[
        "bank_a_active",
        "bank_b_active",
        "bank_b_pattern_4",
        "bank_a_working_diverged",
        "bank_a_after_save",
    ];

    const BANK_FILES: &[&str] = &["bank01.work", "bank01.strd", "bank02.work", "bank02.strd"];

    const BANK_FILE_SIZE: u64 = 636_113;
    const HEADER_LEN: usize = 21;
    const CHECKSUM_LEN: usize = 2;
    const PINNED_SLOT_CORRELATED_OFFSET: usize = 585_459;

    #[derive(serde::Deserialize)]
    struct ManifestEntry {
        path: String,
        sha256: String,
        size: u64,
    }

    #[derive(serde::Deserialize)]
    struct Sha256Sums {
        files: Vec<ManifestEntry>,
    }

    #[derive(serde::Deserialize)]
    struct CaptureMeta {
        #[serde(default)]
        same_content_different_slot_evidence: bool,
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_multi_device")
    }

    fn capture_dir(name: &str) -> PathBuf {
        fixture_root().join(name)
    }

    fn read_fixture_regular_file(path: &Path) -> Result<Vec<u8>, String> {
        let metadata = fs::symlink_metadata(path).map_err(|e| format!("metadata: {e}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("symlink not allowed: {}", path.display()));
        }
        if !metadata.is_file() {
            return Err(format!("not a regular file: {}", path.display()));
        }
        let root = fixture_root()
            .canonicalize()
            .map_err(|e| format!("fixture root: {e}"))?;
        let parent = path
            .parent()
            .ok_or_else(|| "missing parent".to_string())?
            .canonicalize()
            .map_err(|e| format!("parent canonicalize: {e}"))?;
        if !parent.starts_with(&root) {
            return Err(format!("path escapes fixture root: {}", path.display()));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(path)
                .map_err(|e| format!("open nofollow: {e}"))?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| format!("read: {e}"))?;
            Ok(bytes)
        }

        #[cfg(not(unix))]
        {
            fs::read(path).map_err(|e| format!("read: {e}"))
        }
    }

    fn sha256_file(path: &Path) -> String {
        format!(
            "{:x}",
            Sha256::digest(
                read_fixture_regular_file(path).expect("fixture read must stay in-root")
            )
        )
    }

    fn manifest_tree(dir: &Path) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.file_type().is_symlink() {
                panic!("symlink not allowed in fixture tree: {}", path.display());
            }
            if metadata.is_file() {
                out.insert(
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    sha256_file(&path),
                );
            }
        }
        out
    }

    fn read_bank_bytes(capture: &str, file: &str) -> Vec<u8> {
        read_fixture_regular_file(&capture_dir(capture).join(file)).unwrap()
    }

    fn varying_offsets(buffers: &[Vec<u8>]) -> Vec<usize> {
        let len = buffers[0].len();
        let mut out = Vec::new();
        for i in 0..len {
            let first = buffers[0][i];
            if buffers.iter().any(|b| b[i] != first) {
                out.push(i);
            }
        }
        out
    }

    fn slot_correlated_candidates(bank01: &[Vec<u8>], bank02: &[Vec<u8>]) -> Vec<usize> {
        let len = bank01[0].len();
        let mut out = Vec::new();
        for i in 0..len {
            let v01 = bank01.iter().map(|b| b[i]).collect::<Vec<_>>();
            let v02 = bank02.iter().map(|b| b[i]).collect::<Vec<_>>();
            if v01.iter().all(|v| *v == v01[0])
                && v02.iter().all(|v| *v == v02[0])
                && v01[0] != v02[0]
            {
                out.push(i);
            }
        }
        out
    }

    fn unresolved_slot_correlated(raw: &[usize], file_len: usize) -> Vec<usize> {
        let checksum_start = file_len - CHECKSUM_LEN;
        raw.iter()
            .copied()
            .filter(|offset| *offset >= HEADER_LEN && *offset < checksum_start)
            .collect()
    }

    fn same_content_different_slot_evidence() -> bool {
        for capture in CAPTURES {
            let meta_path = capture_dir(capture).join("capture.meta.json");
            let text = read_fixture_regular_file(&meta_path).expect("capture meta");
            let meta: CaptureMeta = serde_json::from_slice(&text).expect("capture meta json");
            if meta.same_content_different_slot_evidence {
                return true;
            }
        }
        false
    }

    #[test]
    fn bank_files_match_sha256_manifest_for_all_captures() {
        for capture in CAPTURES {
            let dir = capture_dir(capture);
            let manifest: Sha256Sums =
                serde_json::from_str(&fs::read_to_string(dir.join("SHA256SUMS.json")).unwrap())
                    .unwrap();
            for file in BANK_FILES {
                let entry = manifest
                    .files
                    .iter()
                    .find(|e| e.path == *file)
                    .unwrap_or_else(|| panic!("{capture} manifest missing {file}"));
                let path = dir.join(file);
                assert_eq!(fs::metadata(&path).unwrap().len(), entry.size);
                assert_eq!(sha256_file(&path), entry.sha256);
            }
        }
    }

    #[test]
    fn typed_parser_decodes_all_target_bank_files() {
        for capture in CAPTURES {
            for file in BANK_FILES {
                let bytes = read_bank_bytes(capture, file);
                assert_eq!(bytes.len() as u64, BANK_FILE_SIZE);
                BankFile::from_bytes(&bytes)
                    .unwrap_or_else(|_| panic!("decode failed for {capture}/{file}"));
            }
        }
    }

    #[test]
    fn same_slot_temporal_hashes_are_pinned() {
        let hash = |capture: &str, file: &str| sha256_file(&capture_dir(capture).join(file));

        assert_ne!(
            hash("bank_a_active", "bank01.work"),
            hash("bank_b_active", "bank01.work")
        );
        assert_eq!(
            hash("bank_b_active", "bank01.work"),
            hash("bank_b_pattern_4", "bank01.work")
        );
        assert_eq!(
            hash("bank_b_pattern_4", "bank01.work"),
            hash("bank_a_working_diverged", "bank01.work")
        );
        assert_ne!(
            hash("bank_a_working_diverged", "bank01.work"),
            hash("bank_a_after_save", "bank01.work")
        );

        assert_ne!(
            hash("bank_a_active", "bank02.work"),
            hash("bank_b_active", "bank02.work")
        );
        assert_ne!(
            hash("bank_b_active", "bank02.work"),
            hash("bank_b_pattern_4", "bank02.work")
        );
        assert_ne!(
            hash("bank_b_pattern_4", "bank02.work"),
            hash("bank_a_working_diverged", "bank02.work")
        );
        assert_eq!(
            hash("bank_a_working_diverged", "bank02.work"),
            hash("bank_a_after_save", "bank02.work")
        );
    }

    #[test]
    fn unresolved_slot_correlated_candidate_stays_unknown() {
        let bank01: Vec<_> = CAPTURES
            .iter()
            .map(|c| read_bank_bytes(c, "bank01.work"))
            .collect();
        let bank02: Vec<_> = CAPTURES
            .iter()
            .map(|c| read_bank_bytes(c, "bank02.work"))
            .collect();
        let raw = slot_correlated_candidates(&bank01, &bank02);
        assert_eq!(raw, vec![PINNED_SLOT_CORRELATED_OFFSET]);
        let bank01_v = varying_offsets(&bank01);
        let bank02_v = varying_offsets(&bank02);
        assert_eq!(bank01_v.len(), 6);
        assert_eq!(bank02_v.len(), 12);
        let unresolved = unresolved_slot_correlated(&raw, bank01[0].len());
        assert_eq!(unresolved, vec![PINNED_SLOT_CORRELATED_OFFSET]);
        assert!(!same_content_different_slot_evidence());
    }

    #[test]
    fn candidate_offset_analysis_is_deterministic() {
        let bank01: Vec<_> = CAPTURES
            .iter()
            .map(|c| read_bank_bytes(c, "bank01.work"))
            .collect();
        let bank02: Vec<_> = CAPTURES
            .iter()
            .map(|c| read_bank_bytes(c, "bank02.work"))
            .collect();
        let a = slot_correlated_candidates(&bank01, &bank02);
        let b = slot_correlated_candidates(&bank01, &bank02);
        assert_eq!(a, b);
    }

    #[test]
    fn fixture_tree_hashes_unchanged_after_audit_reads() {
        let before: BTreeMap<String, BTreeMap<String, String>> = CAPTURES
            .iter()
            .map(|name| {
                let dir = capture_dir(name);
                ((*name).to_string(), manifest_tree(&dir))
            })
            .collect();
        for capture in CAPTURES {
            for file in BANK_FILES {
                let bytes = read_bank_bytes(capture, file);
                let _ = BankFile::from_bytes(&bytes).unwrap();
            }
        }
        for capture in CAPTURES {
            let after = manifest_tree(&capture_dir(capture));
            assert_eq!(
                before.get(*capture).unwrap(),
                &after,
                "fixture bytes changed for {capture}"
            );
        }
    }

    #[test]
    fn audit_rejects_symlinked_bank_fixture_file() {
        use std::os::unix::fs::symlink;
        use tempfile::TempDir;

        let temp = TempDir::new_in(fixture_root()).unwrap();
        let outside = fixture_root().join("_audit_symlink_outside.bin");
        fs::write(&outside, b"outside").unwrap();
        let link = temp.path().join("bank01.work");
        symlink(&outside, &link).unwrap();
        let err = read_fixture_regular_file(&link).unwrap_err();
        assert!(
            err.contains("symlink"),
            "expected symlink rejection, got {err}"
        );
        let _ = fs::remove_file(outside);
    }
}

#[cfg(test)]
mod p_bank_id_device {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use std::path::PathBuf;

    fn device_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_identity_device")
    }

    fn read_bank(capture: &str, file: &str) -> Vec<u8> {
        let path = device_root().join(capture).join(file);
        // Reuse the multi-device reader only for symlink rejection shape.
        // This fixture has its own root, so open it directly with the same checks.
        let metadata = std::fs::symlink_metadata(&path).unwrap();
        assert!(!metadata.file_type().is_symlink());
        assert!(metadata.is_file());
        let root = device_root().canonicalize().unwrap();
        let parent = path.parent().unwrap().canonicalize().unwrap();
        assert!(parent.starts_with(&root));
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&path)
                .unwrap();
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut bytes).unwrap();
            bytes
        }
        #[cfg(not(unix))]
        {
            std::fs::read(&path).unwrap()
        }
    }

    fn volume_lines(left: &BankFile, right: &BankFile) -> Vec<String> {
        (0..8)
            .filter_map(|index| {
                let before = left.parts.unsaved[0].audio_track_volumes[index];
                let after = right.parts.unsaved[0].audio_track_volumes[index];
                (before != after).then(|| {
                    format!(
                        "track {index} main {}/{} cue {}/{}",
                        before.main, after.main, before.cue, after.cue
                    )
                })
            })
            .collect()
    }

    fn decode(capture: &str, file: &str) -> BankFile {
        BankFile::from_bytes(&read_bank(capture, file)).unwrap()
    }

    #[test]
    fn p_bank_id_copy_excludes_offset_585459_as_slot_identity() {
        let captures = ["bank_ab_current_a", "bank_ab_current_b", "bank_abc_slot_c"];
        let before: Vec<_> = captures
            .iter()
            .map(|capture| {
                (
                    read_bank(capture, "bank01.work"),
                    read_bank(capture, "bank02.work"),
                    read_bank(capture, "bank03.work"),
                )
            })
            .collect();
        for (capture, banks) in captures.iter().zip(before.iter()) {
            for (file, bytes) in [
                ("bank01.work", &banks.0),
                ("bank02.work", &banks.1),
                ("bank03.work", &banks.2),
            ] {
                assert_eq!(bytes.len(), 636_113, "{capture}/{file}");
                assert_eq!(
                    bytes,
                    &read_bank(capture, &file.replace(".work", ".strd")),
                    "{capture} {file} work/strd"
                );
                assert_eq!(bytes[585_459], 108, "{capture}/{file} pinned offset");
            }
        }
        assert_eq!(before[0].0, before[1].0);
        assert_eq!(before[0].0, before[2].0);
        assert_eq!(before[0].1, before[1].1);
        assert_eq!(before[0].1, before[2].1);
        assert_eq!(before[0].2, before[1].2);
        assert_ne!(before[0].2, before[2].2);
        assert_eq!(read_bank("bank_ab_current_a", "bank04.work")[585_459], 108);

        let bank_a = decode("bank_ab_current_a", "bank01.work");
        let bank_b = decode("bank_ab_current_a", "bank02.work");
        let bank_c = decode("bank_abc_slot_c", "bank03.work");
        assert!(bank_a.patterns == bank_b.patterns && bank_a.patterns == bank_c.patterns);
        assert_eq!(bank_a.part_names, bank_b.part_names);
        assert_eq!(bank_a.part_names, bank_c.part_names);
        assert_eq!(bank_a.parts.saved, bank_b.parts.saved);
        assert_eq!(bank_a.parts.saved, bank_c.parts.saved);
        assert_eq!(bank_a.parts_edited_bitmask, 1);
        assert_eq!(bank_b.parts_edited_bitmask, 1);
        assert_eq!(bank_c.parts_edited_bitmask, 0);
        for index in 0..4 {
            assert_eq!(bank_a.parts.unsaved[index].part_id, index as u8);
            assert_eq!(bank_b.parts.unsaved[index].part_id, index as u8);
            assert_eq!(bank_c.parts.unsaved[index].part_id, index as u8);
        }
        assert_eq!(
            volume_lines(&bank_a, &bank_b),
            vec!["track 7 main 108/97 cue 108/108".to_string()]
        );
        assert!(volume_lines(&bank_a, &bank_c).is_empty());
        assert_ne!(
            bank_a.parts.unsaved[0].audio_track_params_values,
            bank_b.parts.unsaved[0].audio_track_params_values
        );
        assert_eq!(
            bank_b.parts.unsaved[0].audio_track_params_values,
            bank_c.parts.unsaved[0].audio_track_params_values
        );
        assert_eq!(
            bank_a.encode().unwrap(),
            read_bank("bank_ab_current_a", "bank01.work")
        );

        let mut distinct_payload = Vec::new();
        let a_bytes = &before[0].0;
        let b_bytes = &before[0].1;
        let c_bytes = &before[2].2;
        for offset in 0..a_bytes.len() - 2 {
            let values = [a_bytes[offset], b_bytes[offset], c_bytes[offset]];
            if values[0] != values[1] && values[1] != values[2] && values[0] != values[2] {
                distinct_payload.push(offset);
            }
        }
        assert!(
            distinct_payload.is_empty(),
            "non-checksum bytes with three slot values: {distinct_payload:?}"
        );

        for (capture, banks) in captures.iter().zip(before.iter()) {
            assert_eq!(read_bank(capture, "bank01.work"), banks.0);
            assert_eq!(read_bank(capture, "bank02.work"), banks.1);
            assert_eq!(read_bank(capture, "bank03.work"), banks.2);
        }
    }
}

#[cfg(test)]
mod p_bank_id2_device {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use serde_json::Value;
    use std::path::PathBuf;

    fn capture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/pse_bank_identity_device_2/abc_equal_current_d")
    }

    fn meta_json() -> Value {
        let text = std::fs::read_to_string(capture_root().join("capture.meta.json"))
            .expect("capture.meta");
        serde_json::from_str(&text).expect("capture.meta json")
    }

    fn device_generated() -> bool {
        meta_json()
            .get("device_generated")
            .and_then(|v| v.as_bool())
            == Some(true)
    }

    fn read_bank_file(name: &str) -> Vec<u8> {
        let path = capture_root().join(name);
        let metadata = std::fs::symlink_metadata(&path).unwrap();
        assert!(!metadata.file_type().is_symlink());
        assert!(metadata.is_file());
        #[cfg(unix)]
        {
            use std::io::Read;
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&path)
                .unwrap();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            bytes
        }
        #[cfg(not(unix))]
        {
            std::fs::read(&path).unwrap()
        }
    }

    fn decode(name: &str) -> BankFile {
        BankFile::from_bytes(&read_bank_file(name)).unwrap()
    }

    #[test]
    fn p_bank_id2_abc_equal_current_d_analysis() {
        let meta = meta_json();
        assert_eq!(meta["project_name"].as_str(), Some("P_BANK_ID2"));
        assert_eq!(meta["current_bank_ui"].as_str(), Some("D"));
        if !device_generated() {
            return;
        }

        let before: Vec<_> = ["bank01.work", "bank02.work", "bank03.work"]
            .iter()
            .map(|name| read_bank_file(name))
            .collect();

        let project = read_bank_file("project.work");
        let project_text = String::from_utf8_lossy(&project);
        assert!(
            project_text.contains("BANK=3"),
            "capture must keep current bank D (raw 3) in project.work"
        );

        for suffix in ["work", "strd"] {
            let bank_a = decode(&format!("bank01.{suffix}"));
            let bank_b = decode(&format!("bank02.{suffix}"));
            let bank_c = decode(&format!("bank03.{suffix}"));

            assert_eq!(bank_a.parts.saved, bank_b.parts.saved);
            assert_eq!(bank_a.parts.saved, bank_c.parts.saved);
            assert_eq!(bank_a.parts_saved_state, bank_b.parts_saved_state);
            assert_eq!(bank_a.parts_saved_state, bank_c.parts_saved_state);
            assert_eq!(bank_a.part_names, bank_b.part_names);
            assert_eq!(bank_a.part_names, bank_c.part_names);

            assert_ne!(bank_a.patterns, bank_b.patterns);
            assert_eq!(bank_a.patterns, bank_c.patterns);
            assert_ne!(bank_b.patterns, bank_c.patterns);
            assert_ne!(bank_a.parts.unsaved, bank_b.parts.unsaved);
            assert_ne!(bank_a.parts.unsaved, bank_c.parts.unsaved);
            assert_eq!(bank_b.parts.unsaved, bank_c.parts.unsaved);
            assert_eq!(bank_a.parts_edited_bitmask, 1);
            assert_eq!(bank_b.parts_edited_bitmask, 0);
            assert_eq!(bank_c.parts_edited_bitmask, 0);

            let bytes: Vec<_> = (1..=3)
                .map(|slot| read_bank_file(&format!("bank0{slot}.{suffix}")))
                .collect();
            assert_eq!(bytes[0].len(), 636_113);
            for (slot, file_bytes) in bytes.iter().enumerate() {
                assert_eq!(
                    file_bytes,
                    &read_bank_file(&format!("bank0{}.{suffix}", slot + 1)),
                );
                assert_eq!(file_bytes[585_459], 108);
            }
            for slot in 1..=3 {
                assert_eq!(
                    read_bank_file(&format!("bank0{slot}.work")),
                    read_bank_file(&format!("bank0{slot}.strd")),
                );
            }
            assert_eq!(read_bank_file("bank04.work")[585_459], 108);

            let mut three_distinct = Vec::new();
            for offset in 0..bytes[0].len() - 2 {
                let values = [bytes[0][offset], bytes[1][offset], bytes[2][offset]];
                if values[0] != values[1] && values[1] != values[2] && values[0] != values[2] {
                    three_distinct.push(offset);
                }
            }
            assert!(
                three_distinct.is_empty(),
                "non-checksum bytes with three slot values: {three_distinct:?}"
            );
            assert_eq!(bank_a.encode().unwrap(), bytes[0]);
        }

        for (index, bytes) in before.iter().enumerate() {
            assert_eq!(
                bytes,
                &read_bank_file(["bank01.work", "bank02.work", "bank03.work"][index])
            );
        }
    }
}
