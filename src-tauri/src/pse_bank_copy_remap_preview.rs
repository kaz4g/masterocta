//! Read-only Bank Copy remap preview integration on committed fixtures.

#[cfg(test)]
mod tests {
    use crate::bank_reference_inventory::build_bank_reference_inventory;
    use crate::project_structure_reader::read_project_structure;
    use ot_codec::parse_project_document;
    use ot_domain::project_structure::BankIndex;
    use ot_domain::{RootId, RootRelativePath, SampleReferenceStatus, StateDocumentRole};
    use ot_plan::bank_copy_remap_preview::{
        compute_bank_copy_remap_preview, preview_input_from_inventory, BankCopyDocumentHealth,
        BankCopyRemapPreviewStatus, BankCopySlotPlacementPolicy, MasterTrackSetting,
        ProjectIdentity, SampleSlotSnapshot, SampleSlotSnapshotEntry,
    };
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    fn project_relative_path(name: &str) -> RootRelativePath {
        RootRelativePath::parse(format!("pse_bank_copy_persistence/{name}")).unwrap()
    }

    fn tree_digest(root: &std::path::Path) -> BTreeMap<PathBuf, (u64, String)> {
        let mut digest = BTreeMap::new();
        for entry in walkdir::WalkDir::new(root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
        {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|ext| ext == "work" || ext == "strd")
            {
                let bytes = fs::read(path).unwrap();
                let hash = format!("{:x}", Sha256::digest(&bytes));
                digest.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    (bytes.len() as u64, hash),
                );
            }
        }
        digest
    }

    fn snapshot_from_project_work(
        root: &std::path::Path,
        project: &RootRelativePath,
    ) -> SampleSlotSnapshot {
        let project_work = root.join(project.as_str()).join("project.work");
        let bytes = fs::read(project_work).expect("project.work");
        let parsed = parse_project_document(&bytes);
        let mut entries = parsed
            .regular_assignments
            .into_iter()
            .map(|assignment| {
                let occupied = !assignment.raw_path.is_empty();
                SampleSlotSnapshotEntry {
                    slot: assignment.slot,
                    occupied,
                    reference_status: if occupied {
                        Some(SampleReferenceStatus::Resolved)
                    } else {
                        Some(SampleReferenceStatus::UnassignedSlot)
                    },
                }
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| {
            (
                ot_domain::slot_kind_rank(entry.slot.kind()),
                entry.slot.number(),
            )
        });
        SampleSlotSnapshot { entries }
    }

    #[test]
    fn bank_copy_remap_fixture_bytes_stay_unchanged() {
        let root = fixture_root();
        let capture = "s0_baseline_saved";
        let project = project_relative_path(capture);
        let before = tree_digest(&root.join("pse_bank_copy_persistence"));
        let structure = read_project_structure(&root, &project).unwrap();
        let inventory = build_bank_reference_inventory(&root, &project, &structure, 1).unwrap();
        let slot_snapshot = snapshot_from_project_work(&root, &project);
        let identity = ProjectIdentity {
            root_id: RootId::new("root-session-fixture").unwrap(),
            project_relative_path: project.clone(),
        };
        let master_track = structure
            .project_state
            .as_ref()
            .and_then(|state| state.master_track)
            .map(|enabled| {
                if enabled {
                    MasterTrackSetting::Enabled
                } else {
                    MasterTrackSetting::Disabled
                }
            })
            .unwrap_or(MasterTrackSetting::Unavailable);
        let input = preview_input_from_inventory(
            identity.clone(),
            identity,
            BankIndex::new(0).unwrap(),
            BankIndex::new(1).unwrap(),
            StateDocumentRole::Working,
            StateDocumentRole::Working,
            slot_snapshot.clone(),
            slot_snapshot,
            &inventory,
            BankCopySlotPlacementPolicy::PreserveSlotNumbers,
            master_track,
            BankCopyDocumentHealth::Ok,
            BankCopyDocumentHealth::Ok,
        );
        let preview = compute_bank_copy_remap_preview(&input);
        assert!(!preview.apply_authorized());
        assert_eq!(
            preview.status,
            BankCopyRemapPreviewStatus::SameProjectPreserved
        );
        let after = tree_digest(&root.join("pse_bank_copy_persistence"));
        assert_eq!(before, after);
    }

    #[test]
    fn bank_copy_remap_preview_on_fixture_is_read_only() {
        let source = include_str!("pse_bank_copy_remap_preview.rs");
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//")
                || trimmed.contains("forbidden in")
                || trimmed.starts_with('"')
            {
                continue;
            }
            for forbidden in ["to_data_file(", "fs::write(", "copy_bank("] {
                assert!(
                    !trimmed.contains(forbidden),
                    "forbidden token {forbidden} in code line: {trimmed}"
                );
            }
        }
    }
}
