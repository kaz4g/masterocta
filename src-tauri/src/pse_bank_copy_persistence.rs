//! Read-only Bank Copy persistence harness for #217. No fixture writes and no bank Apply.

#[cfg(test)]
mod tests {
    use ot_tools_io::{BankFile, OctatrackFileIO};
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    const CAPTURES: &[&str] = &[
        "s0_baseline_saved",
        "s1_after_copy",
        "s2_after_destination_switch",
        "s3_after_control_switch",
        "s4_after_project_save",
        "s5_after_project_reload",
    ];

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pse_bank_copy_persistence")
    }

    #[derive(Debug, PartialEq, Eq)]
    struct ParsedStates {
        bank: u8,
        pattern: u8,
    }

    fn parse_states_section(project_text: &str) -> Option<ParsedStates> {
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
        let mut bank_count = 0usize;
        let mut pattern_count = 0usize;
        let mut bank = None;
        let mut pattern = None;
        let mut closed = false;
        for line in lines.iter().skip(starts[0] + 1) {
            let trimmed = line.trim();
            if trimmed == "[/STATES]" {
                closed = true;
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("BANK=") {
                bank_count += 1;
                if let Ok(value) = rest.parse::<u16>() {
                    bank = u8::try_from(value).ok();
                }
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("PATTERN=") {
                pattern_count += 1;
                if let Ok(value) = rest.parse::<u16>() {
                    pattern = u8::try_from(value).ok();
                }
            }
        }
        if !closed || bank_count != 1 || pattern_count != 1 {
            return None;
        }
        Some(ParsedStates {
            bank: bank?,
            pattern: pattern?,
        })
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
    fn project_states_parse_requires_close_tag_and_single_bank_pattern() {
        assert_eq!(
            parse_states_section("[STATES]\nBANK=3\nPATTERN=0\n[/STATES]\n"),
            Some(ParsedStates {
                bank: 3,
                pattern: 0
            })
        );
        assert_eq!(parse_states_section("[STATES]\nBANK=3\nPATTERN=0\n"), None);
        assert_eq!(
            parse_states_section("[STATES]\nBANK=3\nBANK=3\nPATTERN=0\n[/STATES]\n"),
            None
        );
        assert_eq!(
            parse_states_section("[STATES]\nBANK=3\nPATTERN=0\nPATTERN=1\n[/STATES]\n"),
            None
        );
        assert_eq!(
            parse_states_section(
                "[STATES]\nBANK=3\nPATTERN=0\n[/STATES]\n[STATES]\nBANK=1\nPATTERN=0\n[/STATES]\n"
            ),
            None
        );
    }

    #[test]
    fn compared_banks_typed_delta_names_changed_fields() {
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
    fn persistence_fixture_reads_do_not_rewrite_capture_metadata() {
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
            assert_eq!(meta["project_name"], "P_BANK_PERSIST");
            let bank_path = fixture_root().join(name).join("bank02.work");
            assert!(!bank_path.exists(), "template must not commit bank bytes");
        }
        let _ = parse_states_section("[STATES]\nBANK=3\nPATTERN=0\n[/STATES]\n");
        assert_eq!(meta_digest(), before);
    }

    #[test]
    fn dest_typed_first_change_is_assertable_when_device_banks_present() {
        for index in 0..CAPTURES.len().saturating_sub(1) {
            let pre_name = CAPTURES[index];
            let post_name = CAPTURES[index + 1];
            let pre_dir = fixture_root().join(pre_name);
            let post_dir = fixture_root().join(post_name);
            let pre_meta: Value = serde_json::from_str(
                &fs::read_to_string(pre_dir.join("capture.meta.json")).expect("meta"),
            )
            .expect("json");
            if pre_meta["device_generated"] != true {
                continue;
            }
            let pre_bytes = fs::read(pre_dir.join("bank02.work")).expect("pre bank");
            let post_bytes = fs::read(post_dir.join("bank02.work")).expect("post bank");
            let pre = BankFile::from_bytes(&pre_bytes).expect("decode pre");
            let post = BankFile::from_bytes(&post_bytes).expect("decode post");
            let _delta = typed_field_delta(&pre, &post);
        }
    }
}
