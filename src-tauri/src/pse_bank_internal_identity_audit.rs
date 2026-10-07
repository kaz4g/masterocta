//! Read-only Bank internal identity evidence (#221 / MO-PSE-BANK-INTERNAL-IDENTITY-1).

#[cfg(test)]
mod tests {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
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
    const CONTENT_NEIGHBORHOOD: usize = 32;

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

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_multi_device")
    }

    fn capture_dir(name: &str) -> PathBuf {
        fixture_root().join(name)
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
                out.insert(
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    sha256_file(&path),
                );
            }
        }
        out
    }

    fn read_bank_bytes(capture: &str, file: &str) -> Vec<u8> {
        fs::read(capture_dir(capture).join(file)).unwrap()
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

    fn overlaps_neighborhood(offset: usize, varying: &[usize], radius: usize) -> bool {
        varying.iter().any(|v| offset.abs_diff(*v) <= radius)
    }

    fn surviving_identity_candidates(
        raw: &[usize],
        bank01_varying: &[usize],
        bank02_varying: &[usize],
        file_len: usize,
    ) -> Vec<usize> {
        let checksum_start = file_len - CHECKSUM_LEN;
        raw.iter()
            .copied()
            .filter(|offset| {
                if *offset < HEADER_LEN {
                    return false;
                }
                if *offset >= checksum_start {
                    return false;
                }
                if overlaps_neighborhood(*offset, bank01_varying, CONTENT_NEIGHBORHOOD)
                    || overlaps_neighborhood(*offset, bank02_varying, CONTENT_NEIGHBORHOOD)
                {
                    return false;
                }
                true
            })
            .collect()
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
    fn checksum_and_content_neighborhood_exclude_identity_candidates() {
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
        let surviving = surviving_identity_candidates(&raw, &bank01_v, &bank02_v, bank01[0].len());
        assert!(surviving.is_empty(), "unexpected survivors: {surviving:?}");
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
}
