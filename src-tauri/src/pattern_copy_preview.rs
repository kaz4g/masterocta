//! In-memory Pattern Copy projection and read-only preview (`MO-PSE-UPSTREAM-PATTERN-COPY-READONLY-1`).
//!
//! Does not call legacy `copy_patterns` or filesystem write APIs.

#![allow(dead_code)]

use ot_domain::project_structure::TrackSlotReference;
use ot_domain::{
    locked_sample_slot_raw, track_slot_reference_from_machine, track_slot_reference_from_raw,
    SampleSlotKind, StateDocumentParseStatus,
};
use ot_plan::pattern_copy_preview::{
    finalize_pattern_copy_preview, AffectedSampleReferencePreview, AffectedTrackPreview, ModeScope,
    PartAssignmentMode, PatternCopyBlocker, PatternCopyIntent, PatternCopyPreview,
    PreviewObservation, TrackCopyMode,
};
use ot_tools_io::BankFile;

const SAMPLE_LOCK_NONE: u8 = 255;

/// Project one pattern copy into a clone of `destination_bank`. `source_bank` is never mutated.
pub fn project_pattern_copy_in_memory(
    source_bank: &BankFile,
    destination_bank: &BankFile,
    intent: &PatternCopyIntent,
) -> Result<BankFile, PatternCopyBlocker> {
    let src_idx = usize::from(intent.source_pattern.get());
    let dst_idx = usize::from(intent.destination_pattern.get());
    let source_pattern = source_bank
        .patterns
        .0
        .get(src_idx)
        .ok_or(PatternCopyBlocker::SourceDocumentUnavailable)?;
    let mut projected = destination_bank.clone();
    let dest_slot = projected
        .patterns
        .0
        .get_mut(dst_idx)
        .ok_or(PatternCopyBlocker::DestinationDocumentUnavailable)?;

    let dest_part_before = dest_slot.part_assignment;
    let new_part_assignment = match intent.part_assignment {
        PartAssignmentMode::KeepOriginal => dest_part_before,
        PartAssignmentMode::CopySourcePartAssignment => source_pattern.part_assignment,
        PartAssignmentMode::SelectSpecific(part) => part.get(),
    };

    match intent.track_mode {
        TrackCopyMode::All => {
            let dest_audio = dest_slot.audio_track_trigs.clone();
            let dest_midi = dest_slot.midi_track_trigs.clone();
            *dest_slot = source_pattern.clone();
            match intent.mode_scope {
                ModeScope::Audio => {
                    dest_slot.midi_track_trigs = dest_midi;
                }
                ModeScope::Midi => {
                    dest_slot.audio_track_trigs = dest_audio;
                }
                ModeScope::Both => {}
            }
            dest_slot.part_assignment = new_part_assignment;
        }
        TrackCopyMode::Specific => {
            if intent.specific_tracks.iter().any(|track| *track > 15) {
                return Err(PatternCopyBlocker::TrackIndicesOutOfRange);
            }
            for track in &intent.specific_tracks {
                let idx = *track;
                if idx < 8 {
                    let audio_idx = usize::from(idx);
                    let audio = source_pattern
                        .audio_track_trigs
                        .0
                        .get(audio_idx)
                        .ok_or(PatternCopyBlocker::TrackIndicesOutOfRange)?;
                    dest_slot.audio_track_trigs.0[audio_idx] = audio.clone();
                } else {
                    let midi_idx = usize::from(idx - 8);
                    let midi = source_pattern
                        .midi_track_trigs
                        .0
                        .get(midi_idx)
                        .ok_or(PatternCopyBlocker::TrackIndicesOutOfRange)?;
                    dest_slot.midi_track_trigs.0[midi_idx] = midi.clone();
                }
            }
            dest_slot.part_assignment = new_part_assignment;
        }
    }

    Ok(projected)
}

pub fn plan_pattern_copy_preview(
    intent: &PatternCopyIntent,
    source_bank: &BankFile,
    destination_bank: &BankFile,
    source_parse: StateDocumentParseStatus,
    destination_parse: StateDocumentParseStatus,
    track_eight_is_master: bool,
) -> PatternCopyPreview {
    let mut blockers = Vec::new();
    if source_parse != StateDocumentParseStatus::Parsed {
        blockers.push(match source_parse {
            StateDocumentParseStatus::UnsupportedVersion => {
                PatternCopyBlocker::DocumentUnsupportedVersion
            }
            _ => PatternCopyBlocker::DocumentMalformed,
        });
    }
    if destination_parse != StateDocumentParseStatus::Parsed {
        blockers.push(match destination_parse {
            StateDocumentParseStatus::UnsupportedVersion => {
                PatternCopyBlocker::DocumentUnsupportedVersion
            }
            _ => PatternCopyBlocker::DocumentMalformed,
        });
    }

    if !blockers.is_empty() {
        return finalize_pattern_copy_preview(
            intent,
            blockers,
            PreviewObservation::Unknown,
            PreviewObservation::Unknown,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
    }

    let dest_before = destination_bank.clone();
    let projected = match project_pattern_copy_in_memory(source_bank, destination_bank, intent) {
        Ok(bank) => bank,
        Err(blocker) => {
            return finalize_pattern_copy_preview(
                intent,
                vec![blocker],
                PreviewObservation::Unknown,
                PreviewObservation::Unknown,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            );
        }
    };

    let src_idx = usize::from(intent.source_pattern.get());
    let dst_idx = usize::from(intent.destination_pattern.get());
    let source_pattern = &source_bank.patterns.0[src_idx];
    let dest_before_pattern = &dest_before.patterns.0[dst_idx];
    let dest_after_pattern = &projected.patterns.0[dst_idx];

    let pattern_content_change = PreviewObservation::Observed;
    let part_assignment_change = PreviewObservation::Observed;

    let (affected_tracks, preserved) = describe_track_scope(
        intent,
        dest_before_pattern,
        source_pattern,
        dest_after_pattern,
    );

    let (sample_refs, sample_blockers) = sample_references_for_pattern(
        &projected,
        dest_after_pattern,
        dst_idx,
        track_eight_is_master,
    );
    blockers.extend(sample_blockers);

    finalize_pattern_copy_preview(
        intent,
        blockers,
        pattern_content_change,
        part_assignment_change,
        affected_tracks,
        sample_refs,
        preserved,
    )
}

fn describe_track_scope(
    intent: &PatternCopyIntent,
    dest_before: &ot_tools_io::patterns::Pattern,
    _source: &ot_tools_io::patterns::Pattern,
    dest_after: &ot_tools_io::patterns::Pattern,
) -> (Vec<AffectedTrackPreview>, Vec<String>) {
    let mut preserved = Vec::new();
    let mut tracks = Vec::new();

    match intent.track_mode {
        TrackCopyMode::All => match intent.mode_scope {
            ModeScope::Audio => {
                preserved.push("destination_midi_track_trigs".to_string());
                for track in 0..8u8 {
                    tracks.push(AffectedTrackPreview {
                        track_number: track,
                        copied: dest_before.audio_track_trigs.0[usize::from(track)]
                            != dest_after.audio_track_trigs.0[usize::from(track)],
                    });
                }
                for track in 8..16u8 {
                    tracks.push(AffectedTrackPreview {
                        track_number: track,
                        copied: false,
                    });
                }
            }
            ModeScope::Midi => {
                preserved.push("destination_audio_track_trigs".to_string());
                for track in 0..8u8 {
                    tracks.push(AffectedTrackPreview {
                        track_number: track,
                        copied: false,
                    });
                }
                for track in 8..16u8 {
                    let midi = usize::from(track - 8);
                    tracks.push(AffectedTrackPreview {
                        track_number: track,
                        copied: dest_before.midi_track_trigs.0[midi]
                            != dest_after.midi_track_trigs.0[midi],
                    });
                }
            }
            ModeScope::Both => {
                for track in 0..16u8 {
                    let copied = if track < 8 {
                        dest_before.audio_track_trigs.0[usize::from(track)]
                            != dest_after.audio_track_trigs.0[usize::from(track)]
                    } else {
                        let midi = usize::from(track - 8);
                        dest_before.midi_track_trigs.0[midi] != dest_after.midi_track_trigs.0[midi]
                    };
                    tracks.push(AffectedTrackPreview {
                        track_number: track,
                        copied,
                    });
                }
            }
        },
        TrackCopyMode::Specific => {
            for track in 0..16u8 {
                let copied = intent.specific_tracks.contains(&track);
                tracks.push(AffectedTrackPreview {
                    track_number: track,
                    copied,
                });
            }
        }
    }

    (tracks, preserved)
}

fn sample_references_for_pattern(
    bank: &BankFile,
    pattern: &ot_tools_io::patterns::Pattern,
    pattern_idx: usize,
    track_eight_is_master: bool,
) -> (Vec<AffectedSampleReferencePreview>, Vec<PatternCopyBlocker>) {
    let mut refs = Vec::new();
    let mut blockers = Vec::new();
    let part_idx = (pattern.part_assignment as usize).min(3);
    let part = &bank.parts.unsaved.0[part_idx];

    for track_idx in 0..8usize {
        if track_eight_is_master && track_idx == 7 {
            continue;
        }
        let machine_type = part.audio_track_machine_types[track_idx];
        let slots = &part.audio_track_machine_slots[track_idx];
        let machine = ot_domain::project_structure::MachineKind::from_raw(machine_type);
        let slot_ref =
            track_slot_reference_from_machine(machine, slots.static_slot_id, slots.flex_slot_id);
        if !matches!(
            slot_ref,
            TrackSlotReference::NoSampleMachine | TrackSlotReference::Unassigned
        ) {
            refs.push(AffectedSampleReferencePreview {
                track_number: track_idx as u8,
                step: None,
                summary: format!("part_machine:{slot_ref:?}"),
            });
            if matches!(slot_ref, TrackSlotReference::Unrecognized(_)) {
                blockers.push(PatternCopyBlocker::UnresolvedSampleReference);
            }
        }

        let track_trigs = &pattern.audio_track_trigs.0[track_idx];
        for (step_idx, parameter_lock) in track_trigs.plocks.0.iter().enumerate() {
            let Some(lock) = locked_sample_slot_raw(
                machine_type,
                parameter_lock.static_slot_id,
                parameter_lock.flex_slot_id,
            ) else {
                continue;
            };
            if lock == SAMPLE_LOCK_NONE {
                continue;
            }
            let pool = if machine_type == 0 {
                SampleSlotKind::Static
            } else {
                SampleSlotKind::Flex
            };
            let slot_ref = track_slot_reference_from_raw(pool, lock);
            refs.push(AffectedSampleReferencePreview {
                track_number: track_idx as u8,
                step: Some(step_idx as u8),
                summary: format!(
                    "sample_lock raw={lock} resolved={slot_ref:?} pattern={pattern_idx}"
                ),
            });
            if matches!(slot_ref, TrackSlotReference::Unrecognized(_)) {
                blockers.push(PatternCopyBlocker::UnresolvedSampleReference);
            }
        }
    }

    blockers.sort_by_key(|b| format!("{b:?}"));
    blockers.dedup();
    (refs, blockers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bank_validation::bank_parse_status;
    use ot_domain::project_structure::{BankIndex, PatternIndex};
    use ot_domain::{RootId, StateDocumentRole};
    use ot_plan::pattern_copy_preview::{PatternCopyScope, PreviewObservation, TrackCopyMode};
    use ot_plan::PatternCopyPreviewStatus;
    use ot_tools_io::OctatrackFileIO;
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    const PROJECT: &str = "SET/PROJECT";

    fn fixture_dir(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn copied_project(fixture: &str, files: &[&str]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let project = temp.path().join(PROJECT);
        fs::create_dir_all(&project).unwrap();
        for file in files {
            fs::copy(fixture_dir(fixture).join(file), project.join(file)).unwrap();
        }
        let root = temp.path().canonicalize().unwrap();
        (temp, root)
    }

    fn load_bank(root: &Path, file: &str) -> BankFile {
        BankFile::from_bytes(&fs::read(root.join(PROJECT).join(file)).unwrap()).unwrap()
    }

    fn tree_digest(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| {
                let bytes = fs::read(entry.path()).unwrap();
                (
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    (bytes.len() as u64, format!("{:x}", Sha256::digest(&bytes))),
                )
            })
            .collect()
    }

    fn base_intent(source_bank: u8, dest_bank: u8, src_pat: u8, dst_pat: u8) -> PatternCopyIntent {
        PatternCopyIntent {
            root_id: RootId::new("root:preview-test").unwrap(),
            project_relative_path: ot_domain::RootRelativePath::parse(PROJECT).unwrap(),
            scope: PatternCopyScope::SinglePairSameProject,
            source_bank: BankIndex::new(source_bank).unwrap(),
            source_pattern: PatternIndex::new(src_pat).unwrap(),
            source_role: StateDocumentRole::Working,
            destination_bank: BankIndex::new(dest_bank).unwrap(),
            destination_pattern: PatternIndex::new(dst_pat).unwrap(),
            destination_role: StateDocumentRole::Working,
            part_assignment: PartAssignmentMode::KeepOriginal,
            track_mode: TrackCopyMode::All,
            mode_scope: ModeScope::Both,
            specific_tracks: Vec::new(),
            include_part_body_copy: false,
            observed_revision: 1,
        }
    }

    fn parsed(bank: &BankFile) -> StateDocumentParseStatus {
        bank_parse_status(bank)
    }

    #[test]
    fn pattern_copy_preview_module_has_no_write_syscalls_in_source() {
        let source = include_str!("pattern_copy_preview.rs");
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//")
                || trimmed.contains("forbidden in")
                || trimmed.starts_with('"')
            {
                continue;
            }
            for forbidden in [
                "to_data_file(",
                "fs::write(",
                "fs::rename(",
                "fs::remove_file(",
            ] {
                assert!(
                    !trimmed.contains(forbidden),
                    "forbidden token {forbidden} in code line: {trimmed}"
                );
            }
        }
    }

    #[test]
    fn a01_to_a05_same_bank_leaves_source_and_other_patterns_unchanged() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let before = tree_digest(&root);
        let bank = load_bank(&root, "bank01.work");
        let source_snapshot = bank.clone();
        let intent = base_intent(0, 0, 0, 4);
        let preview =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(preview.status, PatternCopyPreviewStatus::Ready);
        assert_eq!(preview.pattern_content_change, PreviewObservation::Observed);
        let projected = project_pattern_copy_in_memory(&bank, &bank, &intent).unwrap();
        assert_eq!(bank.patterns.0[0], source_snapshot.patterns.0[0]);
        assert_ne!(projected.patterns.0[4], bank.patterns.0[4]);
        for (idx, pattern) in bank.patterns.0.iter().enumerate() {
            if idx != 4 {
                assert_eq!(pattern, &projected.patterns.0[idx]);
            }
        }
        assert_eq!(before, tree_digest(&root));
    }

    fn copied_two_banks_from_real_device() -> (TempDir, PathBuf) {
        let (temp, root) = copied_project("real_device", &["bank01.work"]);
        let project = root.join(PROJECT);
        fs::copy(project.join("bank01.work"), project.join("bank02.work")).unwrap();
        (temp, root)
    }

    #[test]
    fn a01_to_b03_cross_bank_uses_separate_bank_snapshots() {
        let (_temp, root) = copied_two_banks_from_real_device();
        let bank_a = load_bank(&root, "bank01.work");
        let bank_b = load_bank(&root, "bank02.work");
        let intent = base_intent(0, 1, 0, 2);
        let preview = plan_pattern_copy_preview(
            &intent,
            &bank_a,
            &bank_b,
            parsed(&bank_a),
            parsed(&bank_b),
            false,
        );
        assert_eq!(preview.status, PatternCopyPreviewStatus::Ready);
        let projected = project_pattern_copy_in_memory(&bank_a, &bank_b, &intent).unwrap();
        assert_eq!(projected.patterns.0[2], bank_a.patterns.0[0]);
        assert_ne!(bank_a.patterns.0[0], bank_b.patterns.0[2]);
    }

    #[test]
    fn copy_source_part_assignment_does_not_copy_part_bodies() {
        let (_temp, root) = copied_project("multipart", &["bank01.work"]);
        let bank = load_bank(&root, "bank01.work");
        let parts_before = bank.parts.unsaved.0;
        let mut intent = base_intent(0, 0, 0, 1);
        intent.part_assignment = PartAssignmentMode::CopySourcePartAssignment;
        let projected = project_pattern_copy_in_memory(&bank, &bank, &intent).unwrap();
        assert_eq!(projected.parts.unsaved.0, parts_before);
        assert_eq!(
            projected.patterns.0[1].part_assignment,
            bank.patterns.0[0].part_assignment
        );
    }

    #[test]
    fn part_body_copy_request_blocks_preview() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let bank = load_bank(&root, "bank01.work");
        let mut intent = base_intent(0, 0, 0, 2);
        intent.include_part_body_copy = true;
        let preview =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(preview.status, PatternCopyPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&PatternCopyBlocker::PartBodyCopyRequested));
    }

    #[test]
    fn sample_lock_zero_and_255_are_classified_without_blocking() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let mut bank = load_bank(&root, "bank01.work");
        let part_idx = bank.patterns.0[0].part_assignment as usize;
        bank.parts.unsaved.0[part_idx].audio_track_machine_types[0] = 0;
        let locks = &mut bank.patterns.0[0].audio_track_trigs.0[0].plocks.0;
        locks[0].static_slot_id = 0;
        locks[0].flex_slot_id = 255;
        locks[1].static_slot_id = 255;
        locks[1].flex_slot_id = 42;
        let intent = base_intent(0, 0, 0, 3);
        let preview =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(preview.status, PatternCopyPreviewStatus::Ready);
        assert!(preview
            .affected_sample_references
            .iter()
            .any(|obs| obs.summary.contains("raw=0")));
        assert!(preview
            .affected_sample_references
            .iter()
            .all(|obs| !obs.summary.contains("raw=42")));
    }

    #[test]
    fn unrecognized_sample_lock_blocks_preview() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let mut bank = load_bank(&root, "bank01.work");
        let part_idx = bank.patterns.0[0].part_assignment as usize;
        bank.parts.unsaved.0[part_idx].audio_track_machine_types[0] = 0;
        let lock = &mut bank.patterns.0[0].audio_track_trigs.0[0].plocks.0[0];
        lock.static_slot_id = 200;
        lock.flex_slot_id = 255;
        let intent = base_intent(0, 0, 0, 3);
        let preview =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(preview.status, PatternCopyPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&PatternCopyBlocker::UnresolvedSampleReference));
    }

    #[test]
    fn same_input_yields_deterministic_preview() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let bank = load_bank(&root, "bank01.work");
        let intent = base_intent(0, 0, 0, 5);
        let a =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        let b =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(a, b);
    }

    #[test]
    fn malformed_source_parse_status_blocks_preview() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let bank = load_bank(&root, "bank01.work");
        let intent = base_intent(0, 0, 0, 4);
        let preview = plan_pattern_copy_preview(
            &intent,
            &bank,
            &bank,
            StateDocumentParseStatus::Malformed,
            StateDocumentParseStatus::Parsed,
            false,
        );
        assert_eq!(preview.status, PatternCopyPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&PatternCopyBlocker::DocumentMalformed));
    }

    #[test]
    fn specific_track_past_midi_range_is_blocked_without_panic() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let bank = load_bank(&root, "bank01.work");
        let mut intent = base_intent(0, 0, 0, 4);
        intent.track_mode = TrackCopyMode::Specific;
        intent.specific_tracks = vec![16];
        let preview =
            plan_pattern_copy_preview(&intent, &bank, &bank, parsed(&bank), parsed(&bank), false);
        assert_eq!(preview.status, PatternCopyPreviewStatus::Blocked);
        assert!(preview
            .blockers
            .contains(&PatternCopyBlocker::TrackIndicesOutOfRange));
        assert!(matches!(
            project_pattern_copy_in_memory(&bank, &bank, &intent),
            Err(PatternCopyBlocker::TrackIndicesOutOfRange)
        ));
    }

    #[test]
    fn master_track_leftover_lock_is_not_a_sample_reference() {
        let (_temp, root) = copied_project("real_device", &["bank01.work"]);
        let mut bank = load_bank(&root, "bank01.work");
        let part_idx = bank.patterns.0[0].part_assignment as usize;
        bank.parts.unsaved.0[part_idx].audio_track_machine_types[7] = 0;
        bank.parts.unsaved.0[part_idx].audio_track_machine_slots[7].static_slot_id = 200;
        let lock = &mut bank.patterns.0[0].audio_track_trigs.0[7].plocks.0[0];
        lock.static_slot_id = 200;
        lock.flex_slot_id = 1;
        let intent = base_intent(0, 0, 0, 4);
        let as_master = plan_pattern_copy_preview(
            &intent,
            &bank,
            &bank,
            StateDocumentParseStatus::Parsed,
            StateDocumentParseStatus::Parsed,
            true,
        );
        assert_eq!(as_master.status, PatternCopyPreviewStatus::Ready);
        assert!(as_master
            .affected_sample_references
            .iter()
            .all(|obs| obs.track_number != 7));
        let as_audio = plan_pattern_copy_preview(
            &intent,
            &bank,
            &bank,
            StateDocumentParseStatus::Parsed,
            StateDocumentParseStatus::Parsed,
            false,
        );
        assert_eq!(as_audio.status, PatternCopyPreviewStatus::Blocked);
        assert!(as_audio
            .blockers
            .contains(&PatternCopyBlocker::UnresolvedSampleReference));
    }
}
