//! Contract tests for the Bank mutation safety contract (#182).
//!
//! These run the pure `ot_plan::bank_mutation` gate against the real
//! read-only Project Structure reader on temporary copies of tracked fixtures.
//! No product write path exists for Bank mutation; any file change below is
//! made by the test inside its own temporary directory.

#[cfg(test)]
mod tests {
    use crate::project_structure_command::PROJECT_STRUCTURE_SCHEMA;
    use crate::project_structure_reader::read_project_structure;
    use ot_domain::project_structure::{BankIndex, ProjectStructure};
    use ot_domain::{
        ContentHash, RootId, RootRelativePath, StateDocumentParseStatus, StateDocumentRole,
    };
    use ot_plan::bank_mutation::{
        evaluate_apply_entry, prove_no_write, verify_bank_structure, verify_expected_changes,
        verify_recovered_to_pre, ApplyTargetClass, BankMutationEnvelope,
        BankMutationEnvelopeFields, BankMutationKind, ExpectedChange, ExpectedState,
        LiveTargetObservation, ManifestEntry, PlannedDocument, ReadinessEvidence, ReadinessGap,
        StopCondition, TreeChange, TreeChangeKind, TreeManifest, BANK_MUTATION_CONTRACT_SCHEMA,
    };
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";
    const REAL_DEVICE_FILES: [&str; 5] = [
        "project.work",
        "bank01.work",
        "bank01.strd",
        "markers.work",
        "arr01.work",
    ];

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn copied_real_device() -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in REAL_DEVICE_FILES {
            fs::copy(fixture_dir("real_device").join(file), project.join(file)).unwrap();
        }
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    fn project_path() -> RootRelativePath {
        RootRelativePath::parse(PROJECT).unwrap()
    }

    fn relative(value: &str) -> RootRelativePath {
        RootRelativePath::parse(value).unwrap()
    }

    fn sha256(bytes: &[u8]) -> ContentHash {
        ContentHash::parse(format!("sha256:{:x}", Sha256::digest(bytes))).unwrap()
    }

    /// Test-only project-scope manifest. Never follows a symlink.
    fn capture_manifest(root: &Path) -> TreeManifest {
        let mut manifest = TreeManifest::new();
        let project = root.join(PROJECT);
        manifest.insert(project_path(), ManifestEntry::Directory);
        let mut pending = vec![project];
        while let Some(directory) = pending.pop() {
            let mut children: Vec<_> = fs::read_dir(&directory)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            children.sort();
            for child in children {
                let metadata = fs::symlink_metadata(&child).unwrap();
                let relative_text = child
                    .strip_prefix(root)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .replace('\\', "/");
                let entry = if metadata.file_type().is_symlink() {
                    let target = fs::read_link(&child).unwrap();
                    ManifestEntry::Symlink {
                        target_digest: sha256(target.as_os_str().as_encoded_bytes()),
                    }
                } else if metadata.is_dir() {
                    pending.push(child.clone());
                    ManifestEntry::Directory
                } else if metadata.is_file() {
                    let bytes = fs::read(&child).unwrap();
                    ManifestEntry::File {
                        byte_size: bytes.len() as u64,
                        content_hash: sha256(&bytes),
                    }
                } else {
                    ManifestEntry::Other
                };
                manifest.insert(relative(&relative_text), entry);
            }
        }
        manifest
    }

    fn planned_documents(structure: &ProjectStructure) -> Vec<PlannedDocument> {
        let mut documents: Vec<_> = structure
            .project_state
            .iter()
            .map(|state| PlannedDocument {
                relative_path: state.source_relative_path.clone(),
                role: state.role,
                parse_status: state.parse_status,
            })
            .collect();
        documents.extend(structure.banks.iter().map(|bank| PlannedDocument {
            relative_path: bank.source_relative_path.clone(),
            role: bank.role,
            parse_status: bank.parse_status,
        }));
        documents
    }

    /// Envelope for a hypothetical Copy A → B of the Working Bank only. This is
    /// contract scaffolding, not a #181 ChangePlan.
    fn copy_envelope(
        structure: &ProjectStructure,
        manifest: &TreeManifest,
        expected_after: ExpectedState,
        include_unmodeled: bool,
    ) -> BankMutationEnvelope {
        let source = BankIndex::new(0).unwrap();
        let unmodeled = if include_unmodeled {
            structure
                .bank(source, StateDocumentRole::Working)
                .unwrap()
                .unmodeled
                .clone()
        } else {
            Vec::new()
        };
        BankMutationEnvelope::seal(BankMutationEnvelopeFields {
            contract_schema: BANK_MUTATION_CONTRACT_SCHEMA.to_owned(),
            read_model_schema: PROJECT_STRUCTURE_SCHEMA.to_owned(),
            root_id: RootId::new("root-session-1").unwrap(),
            device_fingerprint: format!("rootfp:v1:{}", "a".repeat(64)),
            base_observed_revision: 1,
            project_relative_path: project_path(),
            kind: BankMutationKind::Copy,
            source,
            destination: BankIndex::new(1).unwrap(),
            affected_roles: vec![StateDocumentRole::Working],
            scope_manifest: manifest.clone(),
            documents: planned_documents(structure),
            expected_changes: vec![ExpectedChange {
                relative_path: relative("SET/PROJECT/bank02.work"),
                before: ExpectedState::Absent,
                after: expected_after,
            }],
            unmodeled,
        })
    }

    fn live_for(
        envelope: &BankMutationEnvelope,
        manifest: TreeManifest,
        project_structure: ProjectStructure,
    ) -> LiveTargetObservation {
        LiveTargetObservation {
            root_id: envelope.root_id.clone(),
            device_fingerprint: envelope.device_fingerprint.clone(),
            identity_is_stable: true,
            observed_revision: envelope.base_observed_revision,
            write_enabled: true,
            recovery_pending: false,
            read_model_schema: PROJECT_STRUCTURE_SCHEMA.to_owned(),
            target_class: ApplyTargetClass::TemporaryProjectCopy,
            scope_manifest: manifest,
            project_structure,
        }
    }

    fn bank01_working_state() -> ExpectedState {
        let bytes = fs::read(fixture_dir("real_device").join("bank01.work")).unwrap();
        ExpectedState::File {
            byte_size: bytes.len() as u64,
            content_hash: sha256(&bytes),
        }
    }

    #[test]
    fn contract_evaluation_on_a_real_read_model_leaves_the_copy_byte_identical() {
        let (_temp, root) = copied_real_device();
        let pre = capture_manifest(&root);
        assert_eq!(pre.len(), REAL_DEVICE_FILES.len() + 1);

        let structure = read_project_structure(&root, &project_path()).unwrap();
        let envelope = copy_envelope(&structure, &pre, bank01_working_state(), true);
        let live = live_for(&envelope, capture_manifest(&root), structure);
        let stops = evaluate_apply_entry(envelope, &live, None, &ReadinessEvidence::current_main())
            .unwrap_err();

        let gaps: Vec<_> = stops
            .iter()
            .filter_map(|stop| match stop {
                StopCondition::ReadinessGap(gap) => Some(*gap),
                _ => None,
            })
            .collect();
        assert_eq!(gaps, ReadinessGap::ALL.to_vec());
        assert!(stops
            .iter()
            .any(|stop| matches!(stop, StopCondition::UnmodeledDependency(_))));
        assert!(stops.contains(&StopCondition::BackupMissing));

        assert_eq!(prove_no_write(&pre, &capture_manifest(&root)), Ok(()));
    }

    #[test]
    fn tracked_real_device_documents_are_parsed_and_unmodeled_dependencies_are_listed() {
        let (_temp, root) = copied_real_device();
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let documents = planned_documents(&structure);
        assert_eq!(documents.len(), 3);
        assert!(documents
            .iter()
            .all(|document| document.parse_status == StateDocumentParseStatus::Parsed));
        let bank = structure
            .bank(BankIndex::new(0).unwrap(), StateDocumentRole::Working)
            .unwrap();
        assert!(!bank.unmodeled.is_empty());
    }

    #[test]
    fn a_byte_changed_after_planning_makes_the_plan_stale() {
        let (_temp, root) = copied_real_device();
        let pre = capture_manifest(&root);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let envelope = copy_envelope(&structure, &pre, bank01_working_state(), false);

        let markers = root.join(PROJECT).join("markers.work");
        let mut bytes = fs::read(&markers).unwrap();
        bytes[0] ^= 0x01;
        fs::write(&markers, bytes).unwrap();

        let live = live_for(&envelope, capture_manifest(&root), structure);
        let stops = evaluate_apply_entry(envelope, &live, None, &ReadinessEvidence::current_main())
            .unwrap_err();
        assert!(
            stops.contains(&StopCondition::StalePrecondition(TreeChange {
                relative_path: relative("SET/PROJECT/markers.work"),
                kind: TreeChangeKind::ContentChanged,
            }))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_the_project_scope_blocks_the_plan_without_being_followed() {
        let (temp, root) = copied_real_device();
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("bank02.work");
        fs::copy(fixture_dir("real_device").join("bank01.work"), &target).unwrap();
        std::os::unix::fs::symlink(&target, temp.path().join(PROJECT).join("bank03.work")).unwrap();
        let outside_before = fs::read(&target).unwrap();

        let pre = capture_manifest(&root);
        let structure = read_project_structure(&root, &project_path()).unwrap();
        let envelope = copy_envelope(&structure, &pre, bank01_working_state(), false);
        let live = live_for(&envelope, capture_manifest(&root), structure);
        let stops = evaluate_apply_entry(envelope, &live, None, &ReadinessEvidence::current_main())
            .unwrap_err();

        assert!(stops.contains(&StopCondition::NonRegularEntryInScope {
            relative_path: relative("SET/PROJECT/bank03.work"),
        }));
        assert_eq!(prove_no_write(&pre, &capture_manifest(&root)), Ok(()));
        assert_eq!(fs::read(&target).unwrap(), outside_before);
    }

    /// The post-state is produced by the test, not by product code. It only
    /// shows that the verifiers accept a matching result and reject collateral
    /// change and an incomplete rollback.
    #[test]
    fn verifiers_check_a_simulated_post_state_and_rollback_on_a_copy() {
        let (_temp, root) = copied_real_device();
        let pre_manifest = capture_manifest(&root);
        let pre_structure = read_project_structure(&root, &project_path()).unwrap();
        let envelope = copy_envelope(&pre_structure, &pre_manifest, bank01_working_state(), false);

        let project = root.join(PROJECT);
        fs::copy(project.join("bank01.work"), project.join("bank02.work")).unwrap();
        let post_manifest = capture_manifest(&root);
        let post_structure = read_project_structure(&root, &project_path()).unwrap();
        assert_eq!(
            verify_expected_changes(&pre_manifest, &post_manifest, &envelope.expected_changes),
            Ok(())
        );
        assert_eq!(
            verify_bank_structure(&envelope, &pre_structure, &post_structure),
            Ok(())
        );
        assert!(verify_recovered_to_pre(&envelope, &post_manifest).is_err());

        let markers = project.join("markers.work");
        let mut bytes = fs::read(&markers).unwrap();
        bytes[0] ^= 0x01;
        fs::write(&markers, &bytes).unwrap();
        let collateral = verify_expected_changes(
            &pre_manifest,
            &capture_manifest(&root),
            &envelope.expected_changes,
        )
        .unwrap_err();
        assert_eq!(collateral.len(), 1);

        bytes[0] ^= 0x01;
        fs::write(&markers, &bytes).unwrap();
        fs::remove_file(project.join("bank02.work")).unwrap();
        assert_eq!(
            verify_recovered_to_pre(&envelope, &capture_manifest(&root)),
            Ok(())
        );
    }

    fn v2_command_names() -> Vec<&'static str> {
        include_str!("v2_api.rs")
            .split("pub async fn ")
            .skip(1)
            .filter_map(|rest| rest.split('(').next())
            .filter(|name| name.starts_with("v2_"))
            .collect()
    }

    #[test]
    fn no_bank_mutation_command_is_exposed_to_the_frontend() {
        let commands = v2_command_names();
        assert!(commands.contains(&"v2_project_structure_read"));
        let structure_commands: Vec<_> = commands
            .iter()
            .filter(|name| name.contains("project_structure") || name.contains("bank"))
            .collect();
        assert_eq!(structure_commands, vec![&"v2_project_structure_read"]);

        for legacy in [
            "copy_bank",
            "copy_parts",
            "copy_patterns",
            "copy_tracks",
            "copy_sample_slots",
            "save_parts",
            "commit_part",
            "commit_all_parts",
        ] {
            assert!(
                crate::legacy_command_gate::is_disabled(legacy),
                "{legacy} must stay disabled"
            );
        }
    }

    /// Generic commands that can write media today. A new one, or Bank roles
    /// routed through one of these, needs a reviewed contract change.
    const GENERIC_MEDIA_MUTATION_COMMANDS: [&str; 6] = [
        "v2_change_apply",
        "v2_change_recover",
        "v2_rename_apply",
        "v2_rename_continue",
        "v2_rename_recover",
        "v2_slice_export_apply",
    ];

    #[test]
    fn generic_mutation_commands_are_pinned_and_carry_no_bank_mutation() {
        let mut mutating: Vec<_> = v2_command_names()
            .into_iter()
            .filter(|name| {
                name.split('_')
                    .any(|word| matches!(word, "apply" | "continue" | "commit" | "recover"))
            })
            .collect();
        mutating.sort_unstable();
        assert_eq!(mutating, GENERIC_MEDIA_MUTATION_COMMANDS.to_vec());

        for (file, source) in [
            ("v2_api.rs", include_str!("v2_api.rs")),
            ("write_runtime.rs", include_str!("write_runtime.rs")),
            (
                "rename_write_runtime.rs",
                include_str!("rename_write_runtime.rs"),
            ),
            (
                "slice_export_apply.rs",
                include_str!("slice_export_apply.rs"),
            ),
            ("mutation_gate.rs", include_str!("mutation_gate.rs")),
        ] {
            let touches_bank_mutation =
                source.contains("bank_mutation") || source.contains("BankMutation");
            assert!(
                !touches_bank_mutation || source.contains("evaluate_apply_entry"),
                "{file} handles Bank mutation without evaluate_apply_entry"
            );
        }
    }

    /// Production part of the contract module, before its test module.
    fn contract_production_source() -> &'static str {
        let source = include_str!("../crates/ot-plan/src/bank_mutation.rs");
        source.split("\n#[cfg(test)]\nmod tests").next().unwrap()
    }

    fn item_body<'a>(source: &'a str, header: &str) -> &'a str {
        let start = source.find(header).unwrap_or_else(|| panic!("{header}"));
        let rest = &source[start..];
        &rest[..rest.find("\n}").unwrap()]
    }

    #[test]
    fn production_cannot_resolve_readiness_or_forge_a_permit() {
        let source = contract_production_source();
        let lines: Vec<_> = source.lines().map(str::trim).collect();
        let constructor = lines
            .iter()
            .position(|line| line.starts_with("pub fn assume_resolved"))
            .unwrap();
        assert_eq!(lines[constructor - 1], "#[cfg(test)]");

        let readiness = item_body(source, "impl ReadinessEvidence {");
        let constructors: Vec<_> = readiness
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with("pub fn") && line.contains("-> Self"))
            .collect();
        assert_eq!(
            constructors,
            vec![
                "pub fn current_main() -> Self {",
                "pub fn assume_resolved(gaps: impl IntoIterator<Item = ReadinessGap>) -> Self {",
            ]
        );
        assert!(source
            .contains("pub struct ReadinessEvidence {\n    resolved: BTreeSet<ReadinessGap>,"));
        assert!(
            source.contains("pub struct ApplyEntryPermit {\n    envelope: BankMutationEnvelope,")
        );
        assert!(source.contains(
            "pub struct BankMutationEnvelope {\n    id: PlanId,\n    fields: BankMutationEnvelopeFields,"
        ));
        assert!(!source.contains("DerefMut"));

        let constructions = lines
            .iter()
            .filter(|line| {
                !line.starts_with("//") && line.contains("ApplyEntryPermit { envelope }")
            })
            .count();
        assert_eq!(constructions, 1);
        let gate = item_body(source, "pub fn evaluate_apply_entry(");
        assert!(gate.contains("Ok(ApplyEntryPermit { envelope })"));
    }

    #[test]
    fn envelope_records_no_audio_asset_or_sample_identity() {
        let source = contract_production_source();
        let start = source
            .find("pub struct BankMutationEnvelopeFields {")
            .unwrap();
        let fields = &source[start..start + source[start..].find("\n}").unwrap()];
        for forbidden in [
            "AudioAsset",
            "AssetId",
            "FileInstance",
            "ContentHashFreshness",
            "Lineage",
            "Derivation",
            "SliceDraft",
            "sample_hash",
            "audio",
        ] {
            assert!(
                !fields.contains(forbidden),
                "envelope field set must not carry {forbidden}"
            );
            assert!(
                !source.contains(&format!("ot_domain::{forbidden}")),
                "contract must not import {forbidden}"
            );
        }
        assert!(fields.contains("scope_manifest: TreeManifest"));
    }

    #[test]
    fn frontend_has_no_direct_filesystem_write_capability() {
        let capabilities = include_str!("../capabilities/default.json");
        let package_json = include_str!("../../package.json");
        let cargo_toml = include_str!("../Cargo.toml");
        assert!(!capabilities.contains("\"fs:"));
        assert!(!capabilities.contains("shell:"));
        assert!(!package_json.contains("@tauri-apps/plugin-fs"));
        assert!(!package_json.contains("@tauri-apps/plugin-shell"));
        assert!(!cargo_toml.contains("tauri-plugin-fs"));
        assert!(!cargo_toml.contains("tauri-plugin-shell"));
    }
}
