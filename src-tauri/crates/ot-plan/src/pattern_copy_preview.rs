//! Read-only Pattern Copy preview contract (`MO-PSE-UPSTREAM-PATTERN-COPY-READONLY-1`).
//!
//! Not a ChangePlan Apply envelope and not authorized to write media.

use ot_domain::project_structure::{
    BankIndex, PartIndex, PatternIndex, TrackSlotReference, UnmodeledDependency,
    BANK_UNMODELED_DEPENDENCIES,
};
use ot_domain::{RootId, RootRelativePath, StateDocumentRole};
use std::fmt;

pub const PATTERN_COPY_PREVIEW_SCHEMA: &str = "masterocta.pattern-copy-preview:v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternCopyOperation {
    PatternCopy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternCopyScope {
    /// Single source pattern → single destination pattern, one project.
    SinglePairSameProject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PartAssignmentMode {
    KeepOriginal,
    /// Copies the source pattern's part **assignment index** only (not Part body).
    CopySourcePartAssignment,
    SelectSpecific(PartIndex),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrackCopyMode {
    All,
    Specific,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModeScope {
    Audio,
    Midi,
    Both,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PatternCopyIntent {
    pub root_id: RootId,
    pub project_relative_path: RootRelativePath,
    pub scope: PatternCopyScope,
    pub source_bank: BankIndex,
    pub source_pattern: PatternIndex,
    pub source_role: StateDocumentRole,
    pub destination_bank: BankIndex,
    pub destination_pattern: PatternIndex,
    pub destination_role: StateDocumentRole,
    pub part_assignment: PartAssignmentMode,
    pub track_mode: TrackCopyMode,
    pub mode_scope: ModeScope,
    /// Audio 0–7 and MIDI 8–15 (legacy Tools copy scope).
    pub specific_tracks: Vec<u8>,
    /// When true, preview must block (Part body copy is out of scope).
    pub include_part_body_copy: bool,
    pub observed_revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewObservation {
    Observed,
    Unknown,
    NotIncluded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedTrackPreview {
    pub track_number: u8,
    pub copied: bool,
}

/// Where a preview observed a sample slot. This is not a file-existence check.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SampleReferenceOrigin {
    PartMachine,
    SampleLock,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AffectedSampleReferencePreview {
    pub track_number: u8,
    pub step: Option<u8>,
    pub summary: String,
    pub origin: SampleReferenceOrigin,
    pub slot: TrackSlotReference,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PatternCopyBlocker {
    UnsupportedScope,
    CrossProjectNotSupported,
    MultiPairNotSupported,
    MoveOrSwapNotSupported,
    PartBodyCopyRequested,
    CrossRoleCopySemanticsUnknown,
    WorkingSavedCheckpointRuleUnresolved,
    SourceEqualsDestinationPattern,
    InvalidTrackSelection,
    SpecificTracksRequired,
    TrackIndicesOutOfRange,
    SourceDocumentUnavailable,
    DestinationDocumentUnavailable,
    DocumentMalformed,
    DocumentUnsupportedVersion,
    UnresolvedSampleReference,
    UnmodeledDependency(UnmodeledDependency),
    /// `project.work` did not yield a definite master-track flag.
    MasterTrackSettingUnavailable,
    /// Bank or project bytes changed between the two reads of one preview.
    DocumentChangedDuringRead,
}

impl fmt::Display for PatternCopyBlocker {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternCopyPreviewStatus {
    Ready,
    Blocked,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PatternCopyPreview {
    pub schema: &'static str,
    pub operation: PatternCopyOperation,
    pub source_bank: BankIndex,
    pub source_pattern: PatternIndex,
    pub destination_bank: BankIndex,
    pub destination_pattern: PatternIndex,
    pub source_role: StateDocumentRole,
    pub destination_role: StateDocumentRole,
    pub pattern_content_change: PreviewObservation,
    pub part_assignment_change: PreviewObservation,
    pub part_content_change: PreviewObservation,
    pub affected_tracks: Vec<AffectedTrackPreview>,
    pub affected_sample_references: Vec<AffectedSampleReferencePreview>,
    pub preserved_destination_fields: Vec<String>,
    pub unmodeled_dependencies: Vec<UnmodeledDependency>,
    pub status: PatternCopyPreviewStatus,
    pub blockers: Vec<PatternCopyBlocker>,
}

impl PatternCopyPreview {
    pub fn apply_authorized(&self) -> bool {
        false
    }
}

/// Fail-closed validation that does not need bank bytes.
pub fn validate_pattern_copy_intent(intent: &PatternCopyIntent) -> Vec<PatternCopyBlocker> {
    let mut blockers = Vec::new();

    if intent.scope != PatternCopyScope::SinglePairSameProject {
        blockers.push(PatternCopyBlocker::UnsupportedScope);
    }
    if intent.include_part_body_copy {
        blockers.push(PatternCopyBlocker::PartBodyCopyRequested);
    }
    if intent.source_role != intent.destination_role {
        blockers.push(PatternCopyBlocker::CrossRoleCopySemanticsUnknown);
        blockers.push(PatternCopyBlocker::WorkingSavedCheckpointRuleUnresolved);
    }
    // SavedCheckpoint semantics stay unresolved even when both sides match.
    // Working → Working is the only preview scope.
    if intent.source_role != StateDocumentRole::Working
        || intent.destination_role != StateDocumentRole::Working
    {
        blockers.push(PatternCopyBlocker::WorkingSavedCheckpointRuleUnresolved);
    }
    if intent.source_bank == intent.destination_bank
        && intent.source_pattern == intent.destination_pattern
    {
        blockers.push(PatternCopyBlocker::SourceEqualsDestinationPattern);
    }
    match intent.track_mode {
        TrackCopyMode::All => {}
        TrackCopyMode::Specific => {
            if intent.specific_tracks.is_empty() {
                blockers.push(PatternCopyBlocker::SpecificTracksRequired);
            }
            for track in &intent.specific_tracks {
                if *track > 15 {
                    blockers.push(PatternCopyBlocker::TrackIndicesOutOfRange);
                    break;
                }
            }
        }
    }

    blockers.sort_by_key(|blocker| format!("{blocker:?}"));
    blockers.dedup();
    blockers
}

pub fn finalize_pattern_copy_preview(
    intent: &PatternCopyIntent,
    mut blockers: Vec<PatternCopyBlocker>,
    pattern_content_change: PreviewObservation,
    part_assignment_change: PreviewObservation,
    affected_tracks: Vec<AffectedTrackPreview>,
    affected_sample_references: Vec<AffectedSampleReferencePreview>,
    preserved_destination_fields: Vec<String>,
) -> PatternCopyPreview {
    blockers.extend(validate_pattern_copy_intent(intent));
    blockers.sort_by_key(|blocker| format!("{blocker:?}"));
    blockers.dedup();

    let status = if blockers.is_empty() {
        PatternCopyPreviewStatus::Ready
    } else {
        PatternCopyPreviewStatus::Blocked
    };

    PatternCopyPreview {
        schema: PATTERN_COPY_PREVIEW_SCHEMA,
        operation: PatternCopyOperation::PatternCopy,
        source_bank: intent.source_bank,
        source_pattern: intent.source_pattern,
        destination_bank: intent.destination_bank,
        destination_pattern: intent.destination_pattern,
        source_role: intent.source_role,
        destination_role: intent.destination_role,
        pattern_content_change,
        part_assignment_change,
        part_content_change: PreviewObservation::NotIncluded,
        affected_tracks,
        affected_sample_references,
        preserved_destination_fields,
        unmodeled_dependencies: BANK_UNMODELED_DEPENDENCIES.to_vec(),
        status,
        blockers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::RootId;

    fn sample_intent() -> PatternCopyIntent {
        PatternCopyIntent {
            root_id: RootId::new("root:test").unwrap(),
            project_relative_path: RootRelativePath::parse("SET/PROJECT").unwrap(),
            scope: PatternCopyScope::SinglePairSameProject,
            source_bank: BankIndex::new(0).unwrap(),
            source_pattern: PatternIndex::new(0).unwrap(),
            source_role: StateDocumentRole::Working,
            destination_bank: BankIndex::new(0).unwrap(),
            destination_pattern: PatternIndex::new(4).unwrap(),
            destination_role: StateDocumentRole::Working,
            part_assignment: PartAssignmentMode::KeepOriginal,
            track_mode: TrackCopyMode::All,
            mode_scope: ModeScope::Both,
            specific_tracks: Vec::new(),
            include_part_body_copy: false,
            observed_revision: 1,
        }
    }

    #[test]
    fn apply_authorization_is_always_denied() {
        let preview = finalize_pattern_copy_preview(
            &sample_intent(),
            Vec::new(),
            PreviewObservation::Observed,
            PreviewObservation::Observed,
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        assert!(!preview.apply_authorized());
    }

    #[test]
    fn cross_role_copy_is_blocked_without_bank_bytes() {
        let mut intent = sample_intent();
        intent.destination_role = StateDocumentRole::SavedCheckpoint;
        let blockers = validate_pattern_copy_intent(&intent);
        assert!(blockers.contains(&PatternCopyBlocker::CrossRoleCopySemanticsUnknown));
    }

    #[test]
    fn part_body_copy_request_is_blocked() {
        let mut intent = sample_intent();
        intent.include_part_body_copy = true;
        let blockers = validate_pattern_copy_intent(&intent);
        assert!(blockers.contains(&PatternCopyBlocker::PartBodyCopyRequested));
    }

    #[test]
    fn same_source_and_destination_pattern_is_blocked() {
        let mut intent = sample_intent();
        intent.destination_pattern = intent.source_pattern;
        let blockers = validate_pattern_copy_intent(&intent);
        assert!(blockers.contains(&PatternCopyBlocker::SourceEqualsDestinationPattern));
    }

    #[test]
    fn saved_checkpoint_pair_is_blocked_without_bank_bytes() {
        let mut intent = sample_intent();
        intent.source_role = StateDocumentRole::SavedCheckpoint;
        intent.destination_role = StateDocumentRole::SavedCheckpoint;
        let blockers = validate_pattern_copy_intent(&intent);
        assert!(blockers.contains(&PatternCopyBlocker::WorkingSavedCheckpointRuleUnresolved));
        assert!(!blockers.contains(&PatternCopyBlocker::CrossRoleCopySemanticsUnknown));
    }
}
