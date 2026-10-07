//! Read-only crossover harness for #221. No fixture writes and no bank Apply.

#[cfg(test)]
mod tests {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    const CAPTURES: &[&str] = &["run_a_pre", "run_a_post", "run_b_pre", "run_b_post"];
    const COMPARED_BANKS: &[&str] = &[
        "bank01.work",
        "bank01.strd",
        "bank02.work",
        "bank02.strd",
        "bank03.work",
        "bank03.strd",
        "bank04.work",
        "bank04.strd",
    ];

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_identity_crossover")
    }

    fn parse_states_bank_raw(project_text: &str) -> Option<u8> {
        let lines: Vec<&str> = project_text
            .lines()
            .map(|line| line.trim_end_matches('\r'))
            .collect();
        let starts: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.trim() == "[STATES]")
            .map(|(index, _)| index)
            .collect();
        if starts.len() != 1 {
            return None;
        }
        let bank_values: Vec<u8> = lines
            .iter()
            .skip(starts[0] + 1)
            .take_while(|line| line.trim() != "[/STATES]")
            .filter_map(|line| {
                let rest = line.trim().strip_prefix("BANK=")?;
                let value = rest.parse::<u16>().ok()?;
                u8::try_from(value).ok()
            })
            .collect();
        if bank_values.len() == 1 {
            Some(bank_values[0])
        } else {
            None
        }
    }

    fn current_bank_is_d(project_text: &str) -> bool {
        parse_states_bank_raw(project_text) == Some(3)
    }

    fn typed_field_delta(pre: &BankFile, post: &BankFile) -> Vec<&'static str> {
        [
            ("patterns", pre.patterns != post.patterns),
            ("parts.saved", pre.parts.saved != post.parts.saved),
            ("parts.unsaved", pre.parts.unsaved != post.parts.unsaved),
            (
                "parts_saved_state",
                pre.parts_saved_state != post.parts_saved_state,
            ),
            (
                "parts_edited_bitmask",
                pre.parts_edited_bitmask != post.parts_edited_bitmask,
            ),
            ("part_names", pre.part_names != post.part_names),
        ]
        .into_iter()
        .filter_map(|(name, differs)| differs.then_some(name))
        .collect()
    }

    fn meta_digest() -> [u8; 32] {
        let mut hasher = Sha256::new();
        for name in CAPTURES {
            let bytes = fs::read(fixture_root().join(name).join("capture.meta.json"))
                .expect("template meta");
            hasher.update(name.as_bytes());
            hasher.update(bytes);
        }
        hasher.finalize().into()
    }

    #[test]
    fn project_states_bank_parse_accepts_only_a_single_bank_d() {
        assert!(current_bank_is_d("[STATES]\nBANK=3\n[/STATES]\n"));
        assert!(!current_bank_is_d("[STATES]\nBANK=30\n[/STATES]\n"));
        assert!(!current_bank_is_d("[STATES]\nPATTERN=0\n[/STATES]\n"));
        assert!(!current_bank_is_d("[STATES]\nBANK=3\nBANK=3\n[/STATES]\n"));
        assert!(!current_bank_is_d(
            "[NOTES]\nBANK=3\n[/NOTES]\n[STATES]\nPATTERN=0\n[/STATES]\n"
        ));
        assert_eq!(
            parse_states_bank_raw("[STATES]\nBANK=3\n[/STATES]\n[STATES]\nBANK=3\n[/STATES]\n"),
            None
        );
    }

    #[test]
    fn compared_banks_roundtrip_and_typed_delta_names_changed_fields() {
        for (index, name) in COMPARED_BANKS.iter().enumerate() {
            let bank = BankFile {
                parts_edited_bitmask: u8::try_from(index % 4).expect("bitmask"),
                ..BankFile::default()
            };
            let bytes = bank.encode().expect("encode");
            let decoded = BankFile::from_bytes(&bytes).expect("decode");
            assert_eq!(decoded.encode().expect("re-encode"), bytes, "{name}");
        }

        let pre = BankFile::default();
        assert!(typed_field_delta(&pre, &pre).is_empty());

        let mut bitmask = pre.clone();
        bitmask.parts_edited_bitmask = 1;
        assert_eq!(
            typed_field_delta(&pre, &bitmask),
            vec!["parts_edited_bitmask"]
        );

        let mut names = pre.clone();
        names.part_names[0][0] = b'Z';
        assert_eq!(typed_field_delta(&pre, &names), vec!["part_names"]);

        let mut saved_state = pre.clone();
        saved_state.parts_saved_state[0] = 1;
        assert_eq!(
            typed_field_delta(&pre, &saved_state),
            vec!["parts_saved_state"]
        );

        let mut saved = pre.clone();
        saved.parts.saved[0].part_id = 3;
        assert_eq!(typed_field_delta(&pre, &saved), vec!["parts.saved"]);

        let mut unsaved = pre.clone();
        unsaved.parts.unsaved[0].part_id = 2;
        assert_eq!(typed_field_delta(&pre, &unsaved), vec!["parts.unsaved"]);
    }

    #[test]
    fn receptacle_templates_are_not_device_evidence_and_stay_unwritten() {
        let before = meta_digest();
        for name in CAPTURES {
            let path = fixture_root().join(name).join("capture.meta.json");
            let metadata = fs::symlink_metadata(&path).expect("meta metadata");
            assert!(!metadata.file_type().is_symlink());
            assert!(metadata.is_file());
            let text = fs::read_to_string(&path).expect("meta text");
            let meta: Value = serde_json::from_str(&text).expect("meta json");
            assert_eq!(meta["device_generated"], false);
            assert_eq!(meta["synthetic_modification"], false);
            assert_eq!(meta["current_bank_ui"], "D");
            assert_eq!(meta["source_bank_ui"], "A");
            for bank in COMPARED_BANKS {
                assert!(!fixture_root().join(name).join(bank).exists());
            }
        }
        let _ = parse_states_bank_raw("[STATES]\nBANK=3\n[/STATES]\n");
        assert_eq!(meta_digest(), before);
    }

    #[test]
    fn present_device_banks_roundtrip_or_the_receptacle_stays_waiting() {
        for name in CAPTURES {
            let dir = fixture_root().join(name);
            let text = fs::read_to_string(dir.join("capture.meta.json")).expect("meta");
            let meta: Value = serde_json::from_str(&text).expect("json");
            if meta["device_generated"] != true {
                continue;
            }
            let project = fs::read_to_string(dir.join("project.work")).expect("project");
            assert!(current_bank_is_d(&project), "{name} current bank");
            for bank_name in COMPARED_BANKS {
                let bytes = fs::read(dir.join(bank_name)).expect("bank");
                let decoded = BankFile::from_bytes(&bytes).expect("decode");
                assert_eq!(
                    decoded.encode().expect("encode"),
                    bytes,
                    "{name}/{bank_name}"
                );
                let delta = typed_field_delta(&decoded, &decoded);
                assert!(delta.is_empty(), "{name}/{bank_name}");
            }
        }
    }
}
