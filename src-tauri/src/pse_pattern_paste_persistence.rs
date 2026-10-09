//! Read-only cross-bank Pattern Paste persistence harness. No fixture writes and no bank Apply.

#[cfg(test)]
mod tests {
    use ot_tools_io::BankFile;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    const CAPTURES: &[&str] = &[
        "s0_baseline_saved",
        "s1_destination_selected_before_paste",
        "s2_after_pattern_paste",
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
            parse_states_section("[STATES]\nBANK=1\nPATTERN=0\n[/STATES]\n"),
            Some(ParsedStates {
                bank: 1,
                pattern: 0
            })
        );
        assert_eq!(parse_states_section("[STATES]\nBANK=1\nPATTERN=0\n"), None);
        assert_eq!(
            parse_states_section("[STATES]\nBANK=1\nBANK=1\nPATTERN=0\n[/STATES]\n"),
            None
        );
        assert_eq!(
            parse_states_section("[STATES]\nBANK=1\nPATTERN=0\nPATTERN=1\n[/STATES]\n"),
            None
        );
    }

    #[test]
    fn destination_typed_delta_is_independent_of_raw_equality() {
        let pre = BankFile::default();
        assert!(typed_field_delta(&pre, &pre).is_empty());
        let mut pasted = pre.clone();
        pasted.parts_edited_bitmask = 1;
        assert_eq!(
            typed_field_delta(&pre, &pasted),
            vec!["parts_edited_bitmask"]
        );
    }

    #[test]
    fn template_fixture_is_not_decoded_while_device_generated_is_false() {
        let before = meta_digest();
        for name in CAPTURES {
            let path = fixture_root().join(name).join("capture.meta.json");
            let metadata = fs::symlink_metadata(&path).expect("meta metadata");
            assert!(!metadata.file_type().is_symlink());
            let meta: Value =
                serde_json::from_str(&fs::read_to_string(&path).expect("meta")).expect("json");
            assert_eq!(meta["device_generated"], false);
            assert_eq!(meta["operation_kind"], "CROSS_BANK_PATTERN_COPY_PASTE");
            assert_eq!(meta["capture_sequence_proven"], Value::Null);
        }
        assert_eq!(meta_digest(), before);
    }
}
