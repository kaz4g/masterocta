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
    fn crossover_fixture_reads_do_not_rewrite_capture_metadata() {
        let before = meta_digest();
        for name in CAPTURES {
            let path = fixture_root().join(name).join("capture.meta.json");
            let metadata = fs::symlink_metadata(&path).expect("meta metadata");
            assert!(!metadata.file_type().is_symlink());
            assert!(metadata.is_file());
            let text = fs::read_to_string(&path).expect("meta text");
            let meta: Value = serde_json::from_str(&text).expect("meta json");
            assert_eq!(meta["device_generated"], true);
            assert_eq!(meta["synthetic_modification"], false);
            assert_eq!(meta["current_bank_ui"], "D");
            assert_eq!(meta["source_bank_ui"], "A");
            for bank in COMPARED_BANKS {
                let bank_path = fixture_root().join(name).join(bank);
                if meta["device_generated"] == true {
                    let bank_meta = fs::symlink_metadata(&bank_path).expect("bank metadata");
                    assert!(!bank_meta.file_type().is_symlink());
                    assert!(bank_meta.is_file());
                } else {
                    assert!(!bank_path.exists());
                }
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
            }
        }
    }

    fn bank_work(capture: &str, bank_index: u8) -> BankFile {
        let name = format!("bank0{bank_index}.work");
        let bytes = read_regular(capture, &name);
        BankFile::from_bytes(&bytes).expect("decode")
    }

    #[test]
    fn crossover_typed_deltas_match_pre_and_post_for_each_bank() {
        for (pre, post) in [("run_a_pre", "run_a_post"), ("run_b_pre", "run_b_post")] {
            for bank_index in 1..=4 {
                let pre_bank = bank_work(pre, bank_index);
                let post_bank = bank_work(post, bank_index);
                let _ = typed_field_delta(&pre_bank, &post_bank);
            }
        }

        let a_pre_a = bank_work("run_a_pre", 1);
        let a_post_a = bank_work("run_a_post", 1);
        assert!(typed_field_delta(&a_pre_a, &a_post_a).is_empty());

        let a_pre_b = bank_work("run_a_pre", 2);
        let a_post_b = bank_work("run_a_post", 2);
        assert_eq!(typed_field_delta(&a_pre_b, &a_post_b), vec!["patterns"]);
        let a_pre_c = bank_work("run_a_pre", 3);
        let a_post_c = bank_work("run_a_post", 3);
        assert_eq!(typed_field_delta(&a_pre_c, &a_post_c), vec!["patterns"]);

        let a_pre_d = bank_work("run_a_pre", 4);
        let a_post_d = bank_work("run_a_post", 4);
        assert_eq!(
            typed_field_delta(&a_pre_d, &a_post_d),
            vec!["parts.unsaved", "parts_edited_bitmask"]
        );

        for bank_index in 1..=4 {
            let b_pre = bank_work("run_b_pre", bank_index);
            let b_post = bank_work("run_b_post", bank_index);
            assert!(
                typed_field_delta(&b_pre, &b_post).is_empty(),
                "run_b bank0{bank_index}"
            );
        }

        assert_eq!(
            read_regular("run_a_post", "bank02.work"),
            read_regular("run_a_post", "bank03.work")
        );
        let post_b = bank_work("run_a_post", 2);
        let post_c = bank_work("run_a_post", 3);
        assert!(typed_field_delta(&post_b, &post_c).is_empty());
    }

    fn read_regular(capture: &str, name: &str) -> Vec<u8> {
        let path = fixture_root().join(capture).join(name);
        let metadata = fs::symlink_metadata(&path).expect("metadata");
        assert!(!metadata.file_type().is_symlink(), "{capture}/{name}");
        assert!(metadata.is_file(), "{capture}/{name}");
        fs::read(&path).expect("read")
    }

    #[test]
    fn crossover_captures_do_not_show_a_stable_slot_field() {
        let compared = ["bank01.work", "bank02.work", "bank03.work", "bank04.work"];
        for capture in CAPTURES {
            let project =
                String::from_utf8_lossy(&read_regular(capture, "project.work")).into_owned();
            assert!(current_bank_is_d(&project), "{capture}");
            for name in compared {
                let work = read_regular(capture, name);
                let stored = name.replace(".work", ".strd");
                assert_eq!(work, read_regular(capture, &stored), "{capture}/{name}");
                let decoded = BankFile::from_bytes(&work).expect("decode");
                assert_eq!(decoded.encode().expect("encode"), work, "{capture}/{name}");
            }
        }

        let a_pre_b = read_regular("run_a_pre", "bank02.work");
        let a_pre_c = read_regular("run_a_pre", "bank03.work");
        let a_post_a = read_regular("run_a_post", "bank01.work");
        let a_post_b = read_regular("run_a_post", "bank02.work");
        let a_post_c = read_regular("run_a_post", "bank03.work");
        assert_eq!(a_pre_b, a_pre_c);
        assert_eq!(a_post_b, a_post_c);
        assert_ne!(a_pre_b, a_post_b);
        for offset in [46_usize, 36_599] {
            assert_ne!(a_pre_b[offset], a_post_b[offset]);
            assert_eq!(a_post_b[offset], a_post_a[offset]);
            assert_eq!(a_post_c[offset], a_post_a[offset]);
        }
        let a_pre_a = BankFile::from_bytes(&read_regular("run_a_pre", "bank01.work")).unwrap();
        let a_post_a_typed = BankFile::from_bytes(&a_post_a).unwrap();
        assert!(typed_field_delta(&a_pre_a, &a_post_a_typed).is_empty());
        let a_b_delta = typed_field_delta(
            &BankFile::from_bytes(&a_pre_b).unwrap(),
            &BankFile::from_bytes(&a_post_b).unwrap(),
        );
        assert_eq!(a_b_delta, vec!["patterns"]);
        assert_eq!(
            typed_field_delta(
                &BankFile::from_bytes(&a_pre_c).unwrap(),
                &BankFile::from_bytes(&a_post_c).unwrap(),
            ),
            vec!["patterns"]
        );
        let a_pre_d = read_regular("run_a_pre", "bank04.work");
        let a_post_d = read_regular("run_a_post", "bank04.work");
        assert_eq!(a_pre_d[585_459], 108);
        assert_eq!(a_post_d[585_459], 64);
        assert_eq!(
            typed_field_delta(
                &BankFile::from_bytes(&a_pre_d).unwrap(),
                &BankFile::from_bytes(&a_post_d).unwrap(),
            ),
            vec!["parts.unsaved", "parts_edited_bitmask"]
        );

        for capture in ["run_a_pre", "run_a_post", "run_b_pre", "run_b_post"] {
            for name in ["bank01.work", "bank02.work", "bank03.work"] {
                assert_eq!(
                    read_regular(capture, name)[585_459],
                    108,
                    "{capture}/{name}"
                );
            }
        }

        for name in compared {
            assert_eq!(
                read_regular("run_b_pre", name),
                read_regular("run_b_post", name),
                "{name}"
            );
        }
        assert_ne!(
            read_regular("run_b_post", "bank01.work"),
            read_regular("run_b_post", "bank02.work")
        );
        assert_eq!(
            read_regular("run_b_pre", "bank02.work"),
            read_regular("run_b_pre", "bank03.work")
        );
    }
}
